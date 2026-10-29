import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { recordAuditEventAsync } from "../audit/audit";
import { assertClosingDateNotFinalized } from "../finance/financeService";
import {
  getDefaultDeliveryStaff,
  createExternalDeliveryTask,
  assignDeliveryTask,
  dispatchDeliveryTask,
} from "../delivery/deliveryService";
import { normalizePhoneNumber } from "../tiffin/tiffinService";
import {
  AuthenticatedUser,
  UnifiedOrder,
  CreateOrderInput,
  BusinessOrderType,
  BusinessOrderStatus,
  OrderItem,
  PaymentMethod,
  normalizePaymentMethod,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Safely extracts JSON metadata from bracketed structured string [ORDER_JSON:{...}]
 * even when the JSON contains nested arrays or objects.
 */
function extractOrderJsonMetadata(notes: string | null | undefined): any | null {
  if (!notes || typeof notes !== "string" || !notes.includes("[ORDER_JSON:")) {
    return null;
  }
  try {
    const marker = "[ORDER_JSON:";
    const startIdx = notes.indexOf(marker);
    if (startIdx === -1) return null;
    const jsonStart = startIdx + marker.length;
    if (notes[jsonStart] !== "{") return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = jsonStart; i < notes.length; i++) {
      const char = notes[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === "{") depth++;
        else if (char === "}") {
          depth--;
          if (depth === 0) {
            const jsonStr = notes.slice(jsonStart, i + 1);
            return JSON.parse(jsonStr);
          }
        }
      }
    }
  } catch {
    // Return null on parsing failure
  }
  return null;
}

/**
 * Creates a new order (Delivery or Dine-in) with customer linking, item-level price snapshots,
 * automatic assignment to the default delivery person (for deliveries), and financial ledger integration (for dine-in).
 * Requires tiffin.manage or delivery.manage or kitchen.manage permission.
 */
export async function createUnifiedOrder(
  actor: AuthenticatedUser,
  input: CreateOrderInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<UnifiedOrder> {
  if (
    !hasPermission(actor.role, "tiffin.manage") &&
    !hasPermission(actor.role, "delivery.manage") &&
    !hasPermission(actor.role, "kitchen.manage")
  ) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions to create orders.");
  }

  const orderType: BusinessOrderType = input.orderType === "DINE_IN" ? "DINE_IN" : "DELIVERY";
  const serviceDate = input.serviceDate?.trim();
  const mealType = input.mealType;
  const items = Array.isArray(input.items) ? input.items : [];

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }
  if (!["BREAKFAST", "LUNCH", "DINNER"].includes(mealType)) {
    throw new Error(`Invalid meal type '${mealType}'. Must be BREAKFAST, LUNCH, or DINNER.`);
  }
  if (items.length === 0) {
    throw new Error("Order must contain at least one menu item.");
  }

  // Validate items and calculate totals
  const normalizedItems: OrderItem[] = items.map((it) => {
    const qty = Math.max(1, Math.round(Number(it.quantity) || 1));
    const price = Math.max(0, Math.round(Number(it.unitPrice) || 0));
    return {
      productId: it.productId?.trim() || undefined,
      productName: it.productName?.trim() || "Tiffin Meal",
      quantity: qty,
      unitPrice: price,
      lineTotal: qty * price,
    };
  });

  const totalQuantity = normalizedItems.reduce((acc, it) => acc + it.quantity, 0);
  const totalAmount = normalizedItems.reduce((acc, it) => acc + it.lineTotal, 0);
  const now = new Date().toISOString();
  const db = asyncDb || getAsyncDb();

  if (orderType === "DELIVERY") {
    const customerName = input.customerName?.trim();
    const rawCustomerPhone = input.customerPhone?.trim();
    const deliveryAddress = input.deliveryAddress?.trim();

    if (!customerName || customerName.length < 2) {
      throw new Error("Customer name must be at least 2 characters for delivery orders.");
    }
    if (!rawCustomerPhone || rawCustomerPhone.length < 7) {
      throw new Error("Valid customer phone number is required for delivery orders.");
    }
    if (!deliveryAddress || deliveryAddress.length < 5) {
      throw new Error("Valid delivery address is required for delivery orders (min 5 characters).");
    }

    const customerPhone = normalizePhoneNumber(rawCustomerPhone);

    // Customer creation or lookup in tiffin_customers
    let customerId = input.customerId?.trim() || null;
    if (!customerId) {
      const existingCustomer = await db.queryOne<{ id: string; full_name: string }>(`
        SELECT id, full_name FROM tiffin_customers WHERE phone = ? LIMIT 1
      `, [customerPhone]);

      if (existingCustomer) {
        throw new Error(
          `Customer with phone number '${customerPhone}' already exists ('${existingCustomer.full_name}'). Please select the existing customer or provide customerId.`
        );
      }

      customerId = `cust_${crypto.randomUUID()}`;
      await db.execute(`
        INSERT INTO tiffin_customers (
          id, full_name, phone, delivery_address, status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
      `, [customerId, customerName, customerPhone, deliveryAddress, actor.id, now, now]);
    } else {
      const existingCustomer = await db.queryOne<{ id: string }>(`
        SELECT id FROM tiffin_customers WHERE id = ? LIMIT 1
      `, [customerId]);
      if (existingCustomer) {
        await db.execute(`
          UPDATE tiffin_customers SET delivery_address = ?, updated_at = ? WHERE id = ?
        `, [deliveryAddress, now, customerId]);
      }
    }

    // Build structured items note
    const structuredMetadata = {
      orderType: "DELIVERY",
      items: normalizedItems,
      totalAmount,
      totalQuantity,
      userNotes: input.notes?.trim() || null,
      customerId,
      idempotencyKey: input.idempotencyKey?.trim() || null,
    };
    const structuredNotesStr = `[ORDER_JSON:${JSON.stringify(structuredMetadata)}]${input.notes?.trim() ? ` ${input.notes.trim()}` : ""}`;

    // Create the delivery task
    const extTask = await createExternalDeliveryTask(
      actor,
      {
        serviceDate,
        mealType,
        customerName,
        customerPhone,
        deliveryAddress,
        notes: structuredNotesStr,
      },
      clientIp,
      db
    );

    // Automatic assignment to the default delivery person AND automatic dispatch (OUT_FOR_DELIVERY)
    const defaultDriver = await getDefaultDeliveryStaff(db);
    let assignedStaffId: string | null = null;
    let assignedStaffName: string | null = null;
    let deliveryStatus = extTask.status;

    if (defaultDriver) {
      const assigned = await assignDeliveryTask(
        actor,
        extTask.id,
        { assignedToStaffId: defaultDriver.id },
        clientIp,
        db
      );
      assignedStaffId = assigned.assignedTo || defaultDriver.id;
      assignedStaffName = assigned.assignedToName || defaultDriver.fullName;
      deliveryStatus = assigned.status;

      try {
        const dispatched = await dispatchDeliveryTask(actor, extTask.id, clientIp, db);
        deliveryStatus = dispatched.status;
      } catch {
        // If actor lacks delivery.update or task already out, keep current deliveryStatus
      }
    }

    return {
      id: extTask.id,
      orderType: "DELIVERY",
      customerId,
      customerName,
      customerPhone,
      deliveryAddress,
      serviceDate,
      mealType,
      items: normalizedItems,
      totalQuantity,
      totalAmount,
      paymentStatus: "PENDING",
      paymentMethod: input.paymentMethod || null,
      collectedAmount: 0,
      remainingAmount: totalAmount,
      orderStatus: "CONFIRMED",
      deliveryTaskId: extTask.id,
      deliveryStatus,
      assignedTo: assignedStaffId,
      assignedToName: assignedStaffName,
      notes: input.notes?.trim() || null,
      createdAt: now,
    };
  } else {
    // DINE IN ORDER FLOW
    const customerName = input.customerName?.trim() || "Walk-in Guest";
    const customerPhone = input.customerPhone?.trim() || null;
    const paymentMethod: PaymentMethod = normalizePaymentMethod(input.paymentMethod || "CASH");
    const txId = `ftx_${crypto.randomUUID()}`;

    const itemsSummary = normalizedItems.map((it) => `${it.quantity}x ${it.productName}`).join(", ");
    const description = `Dine-in Sale: ${itemsSummary} - ${customerName}${customerPhone ? ` (${customerPhone})` : ""}`;

    const structuredMetadata = {
      orderType: "DINE_IN",
      items: normalizedItems,
      totalAmount,
      totalQuantity,
      customerName,
      customerPhone,
      userNotes: input.notes?.trim() || null,
      idempotencyKey: input.idempotencyKey?.trim() || null,
    };
    const structuredNotesStr = `[ORDER_JSON:${JSON.stringify(structuredMetadata)}]`;
    const fullDescription = `${description} ${structuredNotesStr}`;

    await db.transaction(async (tx) => {
      // Financial Closing lock assertion
      await assertClosingDateNotFinalized(tx, serviceDate, "TIFFIN");

      await tx.execute(`
        INSERT INTO financial_transactions (
          id, transaction_type, amount, transaction_date, payment_method,
          reference_number, resident_id, customer_id, stay_id, category, description,
          billing_period, payee_vendor, idempotency_key, status,
          reversal_of_id, created_by, created_at, updated_at
        ) VALUES (
          ?, 'TIFFIN_PAYMENT', ?, ?, ?,
          NULL, NULL, NULL, NULL, 'TIFFIN_WALKIN_SALE', ?,
          NULL, NULL, ?, 'POSTED',
          NULL, ?, ?, ?
        )
      `, [
        txId,
        totalAmount,
        serviceDate,
        paymentMethod,
        fullDescription,
        input.idempotencyKey?.trim() || null,
        actor.id,
        now,
        now,
      ]);

      await recordAuditEventAsync({
        actorId: actor.id,
        actorUsername: actor.username,
        action: "kitchen.walkin_sale_recorded",
        targetType: "financial_transaction",
        targetId: txId,
        metadata: {
          category: "TIFFIN_WALKIN_SALE",
          amount: totalAmount,
          paymentMethod,
          serviceDate,
          customerName,
          itemsCount: normalizedItems.length,
        },
        ipAddress: clientIp,
      }, tx);
    });

    return {
      id: txId,
      orderType: "DINE_IN",
      customerId: null,
      customerName,
      customerPhone,
      deliveryAddress: null,
      serviceDate,
      mealType,
      items: normalizedItems,
      totalQuantity,
      totalAmount,
      paymentStatus: "PAID",
      paymentMethod,
      collectedAmount: totalAmount,
      remainingAmount: 0,
      orderStatus: "COMPLETED",
      deliveryTaskId: null,
      deliveryStatus: null,
      assignedTo: null,
      assignedToName: null,
      notes: input.notes?.trim() || null,
      createdAt: now,
    };
  }
}

/**
 * Lists combined orders (Delivery & Dine-in) with real data counts and filtering.
 */
export async function listUnifiedOrders(
  actor: AuthenticatedUser,
  filters: {
    serviceDate?: string;
    orderType?: "DELIVERY" | "DINE_IN" | "ALL";
    status?: string;
    search?: string;
  },
  asyncDb?: AsyncDb
): Promise<{
  orders: UnifiedOrder[];
  counts: { today: number; active: number; completed: number };
}> {
  if (
    !hasPermission(actor.role, "tiffin.manage") &&
    !hasPermission(actor.role, "delivery.read") &&
    !hasPermission(actor.role, "kitchen.manage")
  ) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }

  const db = asyncDb || getAsyncDb();
  const serviceDate = filters.serviceDate?.trim() || new Date().toISOString().split("T")[0];
  const orderTypeFilter = filters.orderType || "ALL";
  const search = filters.search?.toLowerCase().trim() || "";

  const orders: UnifiedOrder[] = [];

  // 1. Fetch External Delivery Tasks
  if (orderTypeFilter === "ALL" || orderTypeFilter === "DELIVERY") {
    const taskRows = await db.query<any>(`
      SELECT
        t.*,
        u.full_name as assigned_to_name
      FROM delivery_tasks t
      LEFT JOIN staff_users u ON u.id = t.assigned_to
      WHERE t.order_type = 'EXTERNAL'
        AND t.service_date = ?
      ORDER BY t.created_at DESC
    `, [serviceDate]);

    for (const r of taskRows) {
      let parsedItems: OrderItem[] = [];
      let totalAmount = 0;
      let totalQty = 1;
      let userNotes = r.delivery_notes || null;

      // Check if structured metadata JSON exists in notes
      const meta = extractOrderJsonMetadata(r.delivery_notes);
      if (meta) {
        parsedItems = Array.isArray(meta.items) ? meta.items : [];
        totalAmount = Number(meta.totalAmount) || 0;
        totalQty = Number(meta.totalQuantity) || (parsedItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0) || 1);
        userNotes = meta.userNotes || null;
      }

      if (parsedItems.length === 0) {
        parsedItems.push({
          productName: "Tiffin Meal Delivery",
          quantity: 1,
          unitPrice: Number(r.collected_amount) || 120,
          lineTotal: Number(r.collected_amount) || 120,
        });
        totalAmount = parsedItems[0].lineTotal;
      }

      const collected = Number(r.collected_amount) || 0;
      const isDelivered = r.status === "DELIVERED";
      const isException = r.status === "EXCEPTION";
      let orderStatus: BusinessOrderStatus = "CONFIRMED";
      if (r.status === "OUT_FOR_DELIVERY") orderStatus = "OUT_FOR_DELIVERY";
      else if (isDelivered) orderStatus = "DELIVERED";
      else if (isException) orderStatus = "EXCEPTION";

      let paymentStatus: "PAID" | "PENDING" | "PARTIALLY_PAID" = "PENDING";
      if (collected >= totalAmount && totalAmount > 0) {
        paymentStatus = "PAID";
      } else if (collected > 0) {
        paymentStatus = "PARTIALLY_PAID";
      }

      orders.push({
        id: r.id,
        orderType: "DELIVERY",
        customerId: null,
        customerName: r.customer_name || "City Customer",
        customerPhone: r.customer_phone || null,
        deliveryAddress: r.delivery_address || null,
        serviceDate: r.service_date,
        mealType: r.meal_type,
        items: parsedItems,
        totalQuantity: totalQty,
        totalAmount,
        paymentStatus,
        paymentMethod: r.collected_payment_method || null,
        collectedAmount: collected,
        remainingAmount: Math.max(0, totalAmount - collected),
        orderStatus,
        deliveryTaskId: r.id,
        deliveryStatus: r.status,
        assignedTo: r.assigned_to || null,
        assignedToName: r.assigned_to_name || null,
        notes: userNotes,
        createdAt: r.created_at,
      });
    }
  }

  // 2. Fetch Dine-in Sales from financial_transactions
  if (orderTypeFilter === "ALL" || orderTypeFilter === "DINE_IN") {
    const txRows = await db.query<any>(`
      SELECT *
      FROM financial_transactions
      WHERE category = 'TIFFIN_WALKIN_SALE'
        AND transaction_date = ?
      ORDER BY created_at DESC
    `, [serviceDate]);

    for (const r of txRows) {
      let parsedItems: OrderItem[] = [];
      let totalAmount = Number(r.amount) || 0;
      let totalQty = 1;
      let customerName = "Walk-in Guest";
      let customerPhone: string | null = null;
      let userNotes: string | null = null;

      const meta = extractOrderJsonMetadata(r.description || r.notes);
      if (meta) {
        parsedItems = Array.isArray(meta.items) ? meta.items : [];
        totalAmount = Number(meta.totalAmount) || totalAmount;
        totalQty = Number(meta.totalQuantity) || (parsedItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0) || 1);
        customerName = meta.customerName || customerName;
        customerPhone = meta.customerPhone || null;
        userNotes = meta.userNotes || null;
      }

      if (parsedItems.length === 0) {
        parsedItems.push({
          productName: r.description || "Counter Meal",
          quantity: 1,
          unitPrice: totalAmount,
          lineTotal: totalAmount,
        });
      }

      orders.push({
        id: r.id,
        orderType: "DINE_IN",
        customerId: null,
        customerName,
        customerPhone,
        deliveryAddress: null,
        serviceDate: r.transaction_date,
        mealType: "LUNCH", // Default counter session
        items: parsedItems,
        totalQuantity: totalQty,
        totalAmount,
        paymentStatus: "PAID",
        paymentMethod: r.payment_method,
        collectedAmount: totalAmount,
        remainingAmount: 0,
        orderStatus: "COMPLETED",
        deliveryTaskId: null,
        deliveryStatus: null,
        assignedTo: null,
        assignedToName: null,
        notes: userNotes,
        createdAt: r.created_at,
      });
    }
  }

  // Search filter
  const filteredOrders = search
    ? orders.filter(
        (o) =>
          o.customerName.toLowerCase().includes(search) ||
          (o.customerPhone && o.customerPhone.includes(search)) ||
          (o.deliveryAddress && o.deliveryAddress.toLowerCase().includes(search))
      )
    : orders;

  // Real data counts for today
  const todayCount = orders.length;
  const activeCount = orders.filter(
    (o) => o.orderStatus === "CONFIRMED" || o.orderStatus === "OUT_FOR_DELIVERY"
  ).length;
  const completedCount = orders.filter(
    (o) => o.orderStatus === "DELIVERED" || o.orderStatus === "COMPLETED"
  ).length;

  return {
    orders: filteredOrders,
    counts: {
      today: todayCount,
      active: activeCount,
      completed: completedCount,
    },
  };
}

/**
 * Returns previous orders and reusable order patterns for an existing customer.
 */
export async function getCustomerOrderHistory(
  actor: AuthenticatedUser,
  query: { customerId?: string; phone?: string },
  asyncDb?: AsyncDb
): Promise<Array<{
  orderId: string;
  orderDate: string;
  mealType: string;
  orderType: string;
  items: OrderItem[];
  totalAmount: number;
  deliveryAddress?: string | null;
}>> {
  if (
    !hasPermission(actor.role, "tiffin.manage") &&
    !hasPermission(actor.role, "delivery.read")
  ) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }

  const db = asyncDb || getAsyncDb();
  const phone = query.phone?.trim();
  const customerId = query.customerId?.trim();

  if (!phone && !customerId) {
    return [];
  }

  let customerPhone = phone;
  if (!customerPhone && customerId) {
    const cust = await db.queryOne<{ phone: string }>(`
      SELECT phone FROM tiffin_customers WHERE id = ?
    `, [customerId]);
    customerPhone = cust?.phone;
  }

  if (!customerPhone) {
    return [];
  }

  const rows = await db.query<any>(`
    SELECT
      id, service_date, meal_type, delivery_address, delivery_notes, created_at
    FROM delivery_tasks
    WHERE order_type = 'EXTERNAL'
      AND (customer_phone = ? OR customer_phone = ?)
    ORDER BY created_at DESC
    LIMIT 5
  `, [customerPhone, customerPhone.replace(/\s+/g, "")]);

  const history: Array<{
    orderId: string;
    orderDate: string;
    mealType: string;
    orderType: string;
    items: OrderItem[];
    totalAmount: number;
    deliveryAddress?: string | null;
  }> = [];

  for (const r of rows) {
    let items: OrderItem[] = [];
    let totalAmount = 0;

    const meta = extractOrderJsonMetadata(r.delivery_notes);
    if (meta) {
      items = Array.isArray(meta.items) ? meta.items : [];
      totalAmount = Number(meta.totalAmount) || 0;
    }

    if (items.length > 0) {
      history.push({
        orderId: r.id,
        orderDate: r.service_date,
        mealType: r.meal_type,
        orderType: "DELIVERY",
        items,
        totalAmount,
        deliveryAddress: r.delivery_address || null,
      });
    }
  }

  return history;
}
