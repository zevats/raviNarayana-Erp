import { hasDineInPayLaterSchema } from "../database/schemaFeatures";
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { recordAuditEventAsync } from "../audit/audit";
import { assertClosingDateNotFinalized, acquireLedgerKeyLock, getBusinessDateString } from "../finance/financeService";
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
const MAX_ORDER_LINES = 50;

/**
 * Safely extracts JSON metadata from bracketed structured string [ORDER_JSON:{...}]
 * even when the JSON contains nested arrays or objects.
 *
 * Orders are stored in the orders/order_items tables since migration 0012. This parser remains
 * for legacy rows (backfill and the read-only fallback) and for the delivery modal, which still
 * reads items from the note during the transition.
 */
export function extractOrderJsonMetadata(notes: string | null | undefined): any | null {
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

function assertCanCreateOrders(actor: AuthenticatedUser): void {
  if (
    !hasPermission(actor.role, "tiffin.manage") &&
    !hasPermission(actor.role, "delivery.manage") &&
    !hasPermission(actor.role, "kitchen.manage")
  ) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions to create orders.");
  }
}

function assertCanReadOrders(actor: AuthenticatedUser): void {
  if (
    !hasPermission(actor.role, "tiffin.manage") &&
    !hasPermission(actor.role, "delivery.read") &&
    !hasPermission(actor.role, "kitchen.manage")
  ) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }
}

/**
 * Resolves order lines against the menu. Every line must name an active, orderable menu product;
 * the product name and the price are taken from the menu at this moment and stored on the line
 * (price snapshot), so later menu changes never alter placed orders and the browser cannot set
 * prices. Monthly subscription packages are not order items.
 */
export async function resolveCatalogItems(db: AsyncDb, items: CreateOrderInput["items"]): Promise<OrderItem[]> {
  if (items.length === 0) {
    throw new Error("Order must contain at least one menu item.");
  }
  if (items.length > MAX_ORDER_LINES) {
    throw new Error(`An order can contain at most ${MAX_ORDER_LINES} lines.`);
  }
  const ids = Array.from(new Set(items.map((it) => it.productId?.trim() || "")));
  if (ids.some((id) => !id)) {
    throw new Error("Every order line must be a menu item. Refresh the menu and try again.");
  }
  const rows = await db.query<{ id: string; name: string; price: number | string; status: string; billing_unit: string }>(
    `SELECT id, name, price, status, billing_unit FROM tiffin_products WHERE id IN (${ids.map(() => "?").join(", ")})`,
    ids
  );
  const products = new Map(rows.map((r) => [r.id, r]));
  return items.map((it) => {
    const product = products.get(it.productId!.trim());
    const label = it.productName || "item";
    if (!product) {
      throw new Error(`'${label}' is no longer on the menu. Refresh the menu and try again.`);
    }
    if (product.status !== "ACTIVE") {
      throw new Error(`'${product.name}' is not available on the menu right now.`);
    }
    if (product.billing_unit === "PER_MONTH") {
      throw new Error(`'${product.name}' is a monthly package and cannot be added to an order.`);
    }
    const quantity = Number(it.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Quantity for '${product.name}' must be a positive whole number.`);
    }
    const unitPrice = Number(product.price);
    return { productId: product.id, productName: product.name, quantity, unitPrice, lineTotal: quantity * unitPrice };
  });
}

async function insertOrderRows(
  db: AsyncDb,
  order: {
    id: string;
    orderType: BusinessOrderType;
    status: "CONFIRMED" | "COMPLETED" | "CANCELLED";
    serviceDate: string;
    mealType: string;
    customerId: string | null;
    customerName: string;
    customerPhone: string | null;
    deliveryAddress: string | null;
    deliveryTaskId: string | null;
    financialTransactionId: string | null;
    paymentMethod: PaymentMethod | null;
    notes: string | null;
    idempotencyKey: string | null;
    source: "APP" | "LEGACY_BACKFILL";
    createdBy: string | null;
    createdAt: string;
  },
  items: OrderItem[]
): Promise<void> {
  const totalQuantity = items.reduce((s, it) => s + it.quantity, 0);
  const totalAmount = items.reduce((s, it) => s + it.lineTotal, 0);
  await db.execute(
    `INSERT INTO orders (
       id, order_type, status, service_date, meal_type, customer_id, customer_name, customer_phone,
       delivery_address, delivery_task_id, financial_transaction_id, total_quantity, total_amount,
       payment_method, notes, idempotency_key, source, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.id,
      order.orderType,
      order.status,
      order.serviceDate,
      order.mealType,
      order.customerId,
      order.customerName,
      order.customerPhone,
      order.deliveryAddress,
      order.deliveryTaskId,
      order.financialTransactionId,
      totalQuantity,
      totalAmount,
      order.paymentMethod,
      order.notes,
      order.idempotencyKey,
      order.source,
      order.createdBy,
      order.createdAt,
      order.createdAt,
    ]
  );
  let lineNo = 1;
  for (const it of items) {
    await db.execute(
      `INSERT INTO order_items (id, order_id, line_no, product_id, product_name, quantity, unit_price, line_total, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${order.id}_l${lineNo}`,
        order.id,
        lineNo,
        it.productId || null,
        it.productName,
        it.quantity,
        it.unitPrice,
        it.lineTotal,
        order.createdAt,
      ]
    );
    lineNo++;
  }
}

/** Builds UnifiedOrder views from orders rows (joined with delivery task / ledger state). */
async function loadOrders(db: AsyncDb, where: string, params: any[], limit?: number): Promise<UnifiedOrder[]> {
  const rows = await db.query<any>(
    `SELECT
       o.*,
       t.status AS task_status,
       t.collected_amount AS task_collected_amount,
       t.collected_payment_method AS task_collected_method,
       t.assigned_to AS task_assigned_to,
       u.full_name AS task_assigned_name,
       ft.status AS ledger_status
     FROM orders o
     LEFT JOIN delivery_tasks t ON t.id = o.delivery_task_id
     LEFT JOIN staff_users u ON u.id = t.assigned_to
     LEFT JOIN financial_transactions ft ON ft.id = o.financial_transaction_id
     WHERE ${where}
     ORDER BY o.created_at DESC${limit ? ` LIMIT ${Math.max(1, Math.floor(limit))}` : ""}`,
    params
  );
  if (rows.length === 0) return [];

  const itemRows = await db.query<any>(
    `SELECT order_id, product_id, product_name, quantity, unit_price, line_total, delivered_quantity, undelivered_reason
     FROM order_items
     WHERE order_id IN (${rows.map(() => "?").join(", ")})
     ORDER BY order_id, line_no`,
    rows.map((r) => r.id)
  );
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const it of itemRows) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push({
      productId: it.product_id || undefined,
      productName: it.product_name,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
      lineTotal: Number(it.line_total),
      deliveredQuantity: it.delivered_quantity === null || it.delivered_quantity === undefined ? null : Number(it.delivered_quantity),
      undeliveredReason: it.undelivered_reason || null,
    });
    itemsByOrder.set(it.order_id, list);
  }

  return rows.map((r) => {
    const totalAmount = Number(r.total_amount);
    const isDelivery = r.order_type === "DELIVERY";
    let orderStatus: BusinessOrderStatus;
    let collected: number;
    if (r.status === "CANCELLED") {
      orderStatus = "CANCELLED";
      collected = 0;
    } else if (isDelivery) {
      collected = Number(r.task_collected_amount) || 0;
      orderStatus =
        r.task_status === "OUT_FOR_DELIVERY"
          ? "OUT_FOR_DELIVERY"
          : r.task_status === "DELIVERED"
            ? "DELIVERED"
            : r.task_status === "EXCEPTION"
              ? "EXCEPTION"
              : "CONFIRMED";
    } else {
      collected = r.ledger_status === "POSTED" ? totalAmount : 0;
      orderStatus = "COMPLETED";
    }
    // Delivery orders are due for what was delivered (at the saved prices) once recorded.
    const items = itemsByOrder.get(r.id) ?? [];
    const outcomeRecorded =
      isDelivery && (r.task_status === "DELIVERED" || r.task_status === "EXCEPTION") && items.length > 0 && items.every((it) => it.deliveredQuantity !== null && it.deliveredQuantity !== undefined);
    const amountDue = outcomeRecorded ? items.reduce((s, it) => s + (it.deliveredQuantity as number) * it.unitPrice, 0) : totalAmount;
    const deliveredUnits = outcomeRecorded ? items.reduce((s, it) => s + (it.deliveredQuantity as number), 0) : 0;
    const deliveryOutcome: UnifiedOrder["deliveryOutcome"] = !outcomeRecorded
      ? null
      : deliveredUnits === 0
        ? "NONE"
        : items.every((it) => it.deliveredQuantity === it.quantity)
          ? "FULL"
          : "PARTIAL";
    const paymentStatus: UnifiedOrder["paymentStatus"] =
      amountDue > 0 && collected >= amountDue
        ? "PAID"
        : collected > 0
          ? "PARTIALLY_PAID"
          : isDelivery
            ? amountDue === 0 && outcomeRecorded
              ? "PAID"
              : "PENDING"
            : r.payment_choice === "PAY_LATER" && r.ledger_status !== "POSTED"
              ? "PENDING"
              : "PAID";
    return {
      id: isDelivery ? r.delivery_task_id : r.financial_transaction_id,
      orderId: r.id,
      orderType: r.order_type,
      customerId: r.customer_id || null,
      customerName: r.customer_name,
      customerPhone: r.customer_phone || null,
      deliveryAddress: r.delivery_address || null,
      serviceDate: r.service_date,
      mealType: r.meal_type,
      items,
      totalQuantity: Number(r.total_quantity),
      totalAmount,
      paymentStatus,
      paymentMethod: (isDelivery ? r.task_collected_method : r.payment_method) || null,
      collectedAmount: collected,
      amountDue,
      remainingAmount: Math.max(0, amountDue - collected),
      deliveryOutcome,
      orderStatus,
      deliveryTaskId: r.delivery_task_id || null,
      deliveryStatus: r.task_status || null,
      assignedTo: r.task_assigned_to || null,
      assignedToName: r.task_assigned_name || null,
      notes: r.notes || null,
      revision: r.revision !== undefined && r.revision !== null ? Number(r.revision) : 0,
      cancelReason: r.cancel_reason || null,
      createdAt: r.created_at,
    } as UnifiedOrder;
  });
}

/**
 * Creates a new order (Delivery or Dine-in) with customer linking, item-level price snapshots,
 * automatic assignment to the default delivery person (for deliveries), and financial ledger integration (for dine-in).
 *
 * Everything (customer, delivery task or ledger sale, order, items, assignment, dispatch) commits in
 * one transaction. A repeated idempotencyKey returns the original order instead of creating a second.
 * Requires tiffin.manage or delivery.manage or kitchen.manage permission.
 */
export async function createUnifiedOrder(
  actor: AuthenticatedUser,
  input: CreateOrderInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<UnifiedOrder> {
  assertCanCreateOrders(actor);

  const orderType: BusinessOrderType = input.orderType === "DINE_IN" ? "DINE_IN" : "DELIVERY";
  const serviceDate = input.serviceDate?.trim();
  const mealType = input.mealType;
  const items = Array.isArray(input.items) ? input.items : [];
  const idempotencyKey = input.idempotencyKey?.trim() || null;

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }
  if (!["BREAKFAST", "LUNCH", "DINNER"].includes(mealType)) {
    throw new Error(`Invalid meal type '${mealType}'. Must be BREAKFAST, LUNCH, or DINNER.`);
  }

  const db = asyncDb || getAsyncDb();
  // The menu prices and the replay lookup do not depend on each other: one round trip for both.
  const [normalizedItems, priorByKey] = await Promise.all([
    resolveCatalogItems(db, items),
    idempotencyKey ? loadOrders(db, "o.idempotency_key = ?", [idempotencyKey]) : Promise.resolve([] as UnifiedOrder[]),
  ]);
  const totalQuantity = normalizedItems.reduce((acc, it) => acc + it.quantity, 0);
  const totalAmount = normalizedItems.reduce((acc, it) => acc + it.lineTotal, 0);
  const now = new Date().toISOString();
  const userNotes = input.notes?.trim() || null;

  // Replay: the same idempotency key returns the stored order; a different payload is rejected.
  const replay = async (lookupDb: AsyncDb | null): Promise<UnifiedOrder | null> => {
    if (!idempotencyKey) return null;
    const existing = lookupDb ? await loadOrders(lookupDb, "o.idempotency_key = ?", [idempotencyKey]) : priorByKey;
    if (existing.length === 0) return null;
    const prior = existing[0];
    if (prior.orderType !== orderType || prior.totalAmount !== totalAmount || prior.serviceDate !== serviceDate) {
      throw new Error(
        `Idempotency key '${idempotencyKey}' was already used for a different order. Mismatched payload reuse is strictly rejected.`
      );
    }
    return prior;
  };
  const replayed = await replay(null);
  if (replayed) return replayed;

  const orderId = `ord_${crypto.randomUUID()}`;

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
    let raced: UnifiedOrder | null = null;
    let deliveryTaskId = "";

    await db.transaction(async (tx) => {
      if (idempotencyKey) {
        // Concurrent duplicates serialize here; the later one replays the committed order.
        await acquireLedgerKeyLock(tx, `order:${idempotencyKey}`);
        raced = await replay(tx);
        if (raced) return;
      }

      // Customer creation or lookup in tiffin_customers
      let customerId = input.customerId?.trim() || null;
      if (!customerId) {
        const existingCustomer = await tx.queryOne<{ id: string; full_name: string }>(`
          SELECT id, full_name FROM tiffin_customers WHERE phone = ? LIMIT 1
        `, [customerPhone]);

        if (existingCustomer) {
          throw new Error(
            `Customer with phone number '${customerPhone}' already exists ('${existingCustomer.full_name}'). Please select the existing customer or provide customerId.`
          );
        }

        customerId = `cust_${crypto.randomUUID()}`;
        await tx.execute(`
          INSERT INTO tiffin_customers (
            id, full_name, phone, delivery_address, status, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
        `, [customerId, customerName, customerPhone, deliveryAddress, actor.id, now, now]);
      } else {
        // One statement: the update tells whether the customer exists.
        const updated = await tx.execute(`
          UPDATE tiffin_customers SET delivery_address = ?, updated_at = ? WHERE id = ?
        `, [deliveryAddress, now, customerId]);
        if (updated.changes === 0) {
          throw new Error(`Customer '${customerId}' not found.`);
        }
      }

      const extTask = await createExternalDeliveryTask(
        actor,
        // order_items is the record of what was ordered; the notes carry only the customer's note.
        { serviceDate, mealType, customerName, customerPhone, deliveryAddress, notes: userNotes || undefined },
        clientIp,
        tx
      );
      deliveryTaskId = extTask.id;

      await insertOrderRows(
        tx,
        {
          id: orderId,
          orderType: "DELIVERY",
          status: "CONFIRMED",
          serviceDate,
          mealType,
          customerId,
          customerName,
          customerPhone,
          deliveryAddress,
          deliveryTaskId: extTask.id,
          financialTransactionId: null,
          paymentMethod: null,
          notes: userNotes,
          idempotencyKey,
          source: "APP",
          createdBy: actor.id,
          createdAt: now,
        },
        normalizedItems
      );

      // Automatic assignment to the default delivery person AND automatic dispatch (OUT_FOR_DELIVERY).
      // Errors propagate (no swallow inside a PostgreSQL transaction); dispatch is attempted only
      // when the actor may dispatch and the task is waiting in ASSIGNED.
      const defaultDriver = await getDefaultDeliveryStaff(tx);
      if (defaultDriver) {
        // Only the new status is needed here; the order is reloaded in full once committed.
        const assigned = await assignDeliveryTask(actor, extTask.id, { assignedToStaffId: defaultDriver.id }, clientIp, tx, { detail: false });
        if (assigned.status === "ASSIGNED" && hasPermission(actor.role, "delivery.update")) {
          await dispatchDeliveryTask(actor, extTask.id, clientIp, tx, { detail: false });
        }
      }

      await recordAuditEventAsync({
        actorId: actor.id,
        actorUsername: actor.username,
        action: "orders.order_created",
        targetType: "order",
        targetId: orderId,
        metadata: { orderType: "DELIVERY", deliveryTaskId: extTask.id, totalAmount, totalQuantity, serviceDate },
        ipAddress: clientIp,
      }, tx);
    });

    if (raced) return raced;
    const [created] = await loadOrders(db, "o.id = ?", [orderId]);
    // Creation response contract (unchanged since Task 01B.70): orderStatus reports the order
    // lifecycle (CONFIRMED); dispatch progress is in deliveryStatus. List views derive the
    // combined status from the delivery task.
    return { ...created, orderStatus: "CONFIRMED" };
  }

  // DINE IN ORDER FLOW
  const customerName = input.customerName?.trim() || "Walk-in Guest";
  const customerPhone = input.customerPhone?.trim() || null;
  // Pay Later at the counter (migration 0024): no cashbook entry now; the order stays on the
  // guest's account (Finance -> Receivables) until it is paid. The guest must be identifiable.
  const payLater = (input as any).payLater === true || String(input.paymentMethod || "").toUpperCase() === "PAY_LATER";
  if (payLater) {
    if (!(await hasDineInPayLaterSchema(db))) throw new Error("Pay Later for dine-in needs the latest database update, which is not installed yet.");
    if (!input.customerName?.trim() || input.customerName.trim().length < 2) throw new Error("Enter the guest name for a Pay Later order.");
    if (!customerPhone || customerPhone.replace(/\D/g, "").length < 7) throw new Error("Enter the guest phone number for a Pay Later order.");
  }
  const paymentMethod: PaymentMethod = normalizePaymentMethod(payLater ? "CASH" : input.paymentMethod || "CASH");
  const txId = `ftx_${crypto.randomUUID()}`;

  const itemsSummary = normalizedItems.map((it) => `${it.quantity}x ${it.productName}`).join(", ");
  const description = `Dine-in Sale: ${itemsSummary} - ${customerName}${customerPhone ? ` (${customerPhone})` : ""}`;
  let raced: UnifiedOrder | null = null;

  await db.transaction(async (tx) => {
    // Financial Closing lock assertion
    await assertClosingDateNotFinalized(tx, serviceDate, "TIFFIN");

    if (idempotencyKey) {
      await acquireLedgerKeyLock(tx, `order:${idempotencyKey}`);
      raced = await replay(tx);
      if (raced) return;
    }

    if (!payLater) {
      await tx.execute(`
        INSERT INTO financial_transactions (
          id, transaction_type, amount, transaction_date, payment_method,
          reference_number, resident_id, customer_id, stay_id, category, description,
          billing_period, payee_vendor, idempotency_key, status,
          reversal_of_id, created_by, created_at, updated_at
        ) VALUES (
          ?, 'TIFFIN_PAYMENT', ?, ?, ?,
          NULL, NULL, NULL, NULL, 'TIFFIN_WALKIN_SALE', ?,
          NULL, NULL, NULL, 'POSTED',
          NULL, ?, ?, ?
        )
      `, [txId, totalAmount, serviceDate, paymentMethod, description, actor.id, now, now]);
    }
    // A Pay Later guest who is already a customer (same phone) owes on that account.
    const linked = payLater && customerPhone
      ? await tx.queryOne<{ id: string }>("SELECT id FROM tiffin_customers WHERE phone = ? OR phone = ? LIMIT 1", [normalizePhoneNumber(customerPhone), customerPhone])
      : null;

    await insertOrderRows(
      tx,
      {
        id: orderId,
        orderType: "DINE_IN",
        status: "COMPLETED",
        serviceDate,
        mealType,
        customerId: linked?.id ?? null,
        customerName,
        customerPhone,
        deliveryAddress: null,
        deliveryTaskId: null,
        financialTransactionId: payLater ? null : txId,
        paymentMethod: payLater ? null : paymentMethod,
        notes: userNotes,
        idempotencyKey,
        source: "APP",
        createdBy: actor.id,
        createdAt: now,
      },
      normalizedItems
    );

    if (payLater) {
      await tx.execute("UPDATE orders SET payment_choice = 'PAY_LATER' WHERE id = ?", [orderId]);
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: payLater ? "orders.dine_in_pay_later" : "kitchen.walkin_sale_recorded",
      targetType: payLater ? "order" : "financial_transaction",
      targetId: payLater ? orderId : txId,
      metadata: {
        category: "TIFFIN_WALKIN_SALE",
        orderId,
        amount: totalAmount,
        paymentMethod: payLater ? "PAY_LATER" : paymentMethod,
        serviceDate,
        customerName,
        customerPhone,
        itemsCount: normalizedItems.length,
      },
      ipAddress: clientIp,
    }, tx);
  });

  if (raced) return raced;
  const [created] = await loadOrders(db, "o.id = ?", [orderId]);
  return created;
}

/** Legacy (pre-0012) delivery tasks and counter sales that have no orders row yet. */
async function loadLegacyOrders(db: AsyncDb, serviceDate: string, orderTypeFilter: string): Promise<UnifiedOrder[]> {
  // Subscription deliveries are not one-off orders (billed monthly, managed under Subscriptions);
  // they are excluded here, from a customer's order history and from the legacy backfill.
  const orders: UnifiedOrder[] = [];

  if (orderTypeFilter === "ALL" || orderTypeFilter === "DELIVERY") {
    const taskRows = await db.query<any>(`
      SELECT t.*, u.full_name as assigned_to_name
      FROM delivery_tasks t
      LEFT JOIN staff_users u ON u.id = t.assigned_to
      WHERE t.order_type = 'EXTERNAL' AND t.subscription_id IS NULL
        AND t.service_date = ?
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.delivery_task_id = t.id)
      ORDER BY t.created_at DESC
    `, [serviceDate]);

    for (const r of taskRows) {
      const converted = legacyDeliveryToOrderParts(r);
      const collected = Number(r.collected_amount) || 0;
      let orderStatus: BusinessOrderStatus = "CONFIRMED";
      if (r.status === "OUT_FOR_DELIVERY") orderStatus = "OUT_FOR_DELIVERY";
      else if (r.status === "DELIVERED") orderStatus = "DELIVERED";
      else if (r.status === "EXCEPTION") orderStatus = "EXCEPTION";

      orders.push({
        id: r.id,
        orderType: "DELIVERY",
        customerId: null,
        customerName: r.customer_name || "City Customer",
        customerPhone: r.customer_phone || null,
        deliveryAddress: r.delivery_address || null,
        serviceDate: r.service_date,
        mealType: r.meal_type,
        items: converted.items,
        totalQuantity: converted.totalQuantity,
        totalAmount: converted.totalAmount,
        paymentStatus: collected >= converted.totalAmount && converted.totalAmount > 0 ? "PAID" : collected > 0 ? "PARTIALLY_PAID" : "PENDING",
        paymentMethod: r.collected_payment_method || null,
        collectedAmount: collected,
        remainingAmount: Math.max(0, converted.totalAmount - collected),
        orderStatus,
        deliveryTaskId: r.id,
        deliveryStatus: r.status,
        assignedTo: r.assigned_to || null,
        assignedToName: r.assigned_to_name || null,
        notes: converted.notes,
        createdAt: r.created_at,
      });
    }
  }

  if (orderTypeFilter === "ALL" || orderTypeFilter === "DINE_IN") {
    const txRows = await db.query<any>(`
      SELECT ft.*
      FROM financial_transactions ft
      WHERE ft.category = 'TIFFIN_WALKIN_SALE'
        AND ft.transaction_date = ?
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.financial_transaction_id = ft.id)
      ORDER BY ft.created_at DESC
    `, [serviceDate]);

    for (const r of txRows) {
      const converted = legacyDineInToOrderParts(r);
      orders.push({
        id: r.id,
        orderType: "DINE_IN",
        customerId: null,
        customerName: converted.customerName,
        customerPhone: converted.customerPhone,
        deliveryAddress: null,
        serviceDate: r.transaction_date,
        mealType: "LUNCH",
        items: converted.items,
        totalQuantity: converted.totalQuantity,
        totalAmount: converted.totalAmount,
        paymentStatus: "PAID",
        paymentMethod: r.payment_method,
        collectedAmount: converted.totalAmount,
        remainingAmount: 0,
        orderStatus: r.status === "REVERSED" ? "CANCELLED" : "COMPLETED",
        deliveryTaskId: null,
        deliveryStatus: null,
        assignedTo: null,
        assignedToName: null,
        notes: converted.notes,
        createdAt: r.created_at,
      });
    }
  }

  return orders;
}

/**
 * Lists combined orders (Delivery & Dine-in) with real data counts and filtering.
 * Reads the orders table; legacy rows not yet backfilled are included read-only.
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
  assertCanReadOrders(actor);

  const db = asyncDb || getAsyncDb();
  const serviceDate = filters.serviceDate?.trim() || getBusinessDateString();
  const orderTypeFilter = filters.orderType || "ALL";
  const search = filters.search?.toLowerCase().trim() || "";

  const typeClause = orderTypeFilter === "ALL" ? "" : " AND o.order_type = ?";
  const params: any[] = orderTypeFilter === "ALL" ? [serviceDate] : [serviceDate, orderTypeFilter];
  const stored = await loadOrders(db, `o.service_date = ?${typeClause}`, params);
  const legacy = await loadLegacyOrders(db, serviceDate, orderTypeFilter);
  const orders = [...stored, ...legacy].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

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
  const compactPhone = customerPhone.replace(/\s+/g, "");

  const stored = await loadOrders(
    db,
    "o.order_type = 'DELIVERY' AND o.status <> 'CANCELLED' AND (o.customer_phone = ? OR o.customer_phone = ?)",
    [customerPhone, compactPhone],
    1
  );
  // Only the most recent order is offered for repeat (owner decision, 2026-11-09).
  const history = stored.slice(0, 1).map((o) => ({
    orderId: o.orderId || o.id,
    orderDate: o.serviceDate,
    mealType: o.mealType,
    orderType: "DELIVERY",
    items: o.items,
    totalAmount: o.totalAmount,
    deliveryAddress: o.deliveryAddress || null,
  }));
  if (history.length >= 5) return history;

  // Legacy delivery tasks without an orders row (before backfill).
  const rows = await db.query<any>(`
    SELECT id, service_date, meal_type, delivery_address, delivery_notes, collected_amount, created_at
    FROM delivery_tasks t
    WHERE t.order_type = 'EXTERNAL' AND t.subscription_id IS NULL
      AND (t.customer_phone = ? OR t.customer_phone = ?)
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.delivery_task_id = t.id)
    ORDER BY t.created_at DESC
    LIMIT 5
  `, [customerPhone, compactPhone]);

  for (const r of rows) {
    if (history.length >= 5) break;
    const meta = extractOrderJsonMetadata(r.delivery_notes);
    const items: OrderItem[] = meta && Array.isArray(meta.items) ? meta.items : [];
    if (items.length > 0) {
      history.push({
        orderId: r.id,
        orderDate: r.service_date,
        mealType: r.meal_type,
        orderType: "DELIVERY",
        items,
        totalAmount: Number(meta?.totalAmount) || 0,
        deliveryAddress: r.delivery_address || null,
      });
    }
  }

  return history;
}

// -----------------------------------------------------------------------------
// Legacy conversion (ISSUE-008): [ORDER_JSON] notes -> orders / order_items
// -----------------------------------------------------------------------------

/** Converts legacy JSON items into valid order lines; anything unrecoverable becomes one placeholder line. */
function recoverLegacyItems(rawItems: any, fallbackAmount: number, placeholderName: string): { items: OrderItem[]; recovered: boolean } {
  const items: OrderItem[] = [];
  if (Array.isArray(rawItems)) {
    for (const it of rawItems) {
      const quantity = Math.round(Number(it?.quantity));
      const unitPrice = Math.round(Number(it?.unitPrice));
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) continue;
      items.push({
        productId: typeof it?.productId === "string" && it.productId.trim() ? it.productId.trim() : undefined,
        productName: (typeof it?.productName === "string" && it.productName.trim()) || "Tiffin Meal",
        quantity,
        unitPrice,
        lineTotal: quantity * unitPrice,
      });
    }
  }
  if (items.length > 0) return { items, recovered: true };
  const amount = Math.max(0, Math.round(Number(fallbackAmount) || 0));
  return { items: [{ productName: placeholderName, quantity: 1, unitPrice: amount, lineTotal: amount }], recovered: false };
}

function stripOrderJson(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const meta = extractOrderJsonMetadata(notes);
  if (!meta) return notes.trim() || null;
  const start = notes.indexOf("[ORDER_JSON:");
  const json = JSON.stringify(meta);
  // Remove the marker block conservatively: everything from the marker to the matching "}]".
  const end = notes.indexOf("}]", start + json.length - 1);
  const rest = end >= 0 ? `${notes.slice(0, start)}${notes.slice(end + 2)}` : notes.slice(0, start);
  return rest.trim() || null;
}

function legacyDeliveryToOrderParts(r: any) {
  const meta = extractOrderJsonMetadata(r.delivery_notes);
  const { items, recovered } = recoverLegacyItems(
    meta?.items,
    meta?.totalAmount ?? r.collected_amount,
    "Legacy delivery order (items not recorded)"
  );
  return {
    meta,
    items,
    recovered,
    totalQuantity: items.reduce((s, it) => s + it.quantity, 0),
    totalAmount: items.reduce((s, it) => s + it.lineTotal, 0),
    notes: (meta?.userNotes as string) || stripOrderJson(r.delivery_notes),
  };
}

function legacyDineInToOrderParts(r: any) {
  const meta = extractOrderJsonMetadata(r.description);
  const { items, recovered } = recoverLegacyItems(meta?.items, r.amount, "Legacy counter sale (items not recorded)");
  return {
    meta,
    items,
    recovered,
    customerName: (meta?.customerName as string) || "Walk-in Guest",
    customerPhone: (meta?.customerPhone as string) || null,
    totalQuantity: items.reduce((s, it) => s + it.quantity, 0),
    totalAmount: items.reduce((s, it) => s + it.lineTotal, 0),
    notes: (meta?.userNotes as string) || null,
  };
}

export interface LegacyOrderBackfillResult {
  deliveryOrdersCreated: number;
  dineInOrdersCreated: number;
  alreadyConverted: number;
  itemsUnrecoverable: number;
  amountMismatches: string[];
  failures: Array<{ sourceId: string; error: string }>;
}

/**
 * Idempotent conversion of legacy order representations into orders/order_items.
 *
 * - Source rows are never modified; delivery notes and ledger descriptions are left intact.
 * - Order ids are deterministic (`ord_legacy_<source id>`) and the link columns are UNIQUE, so a
 *   re-run (or a concurrent run) creates nothing twice.
 * - Each source row converts in its own transaction; a malformed row is reported, not fatal.
 * - When JSON items are missing or invalid, a single placeholder line preserves the amount.
 * - For dine-in sales the ledger amount is authoritative; any JSON total that disagrees is reported.
 */
export async function backfillLegacyOrders(asyncDb?: AsyncDb): Promise<LegacyOrderBackfillResult> {
  const db = asyncDb || getAsyncDb();
  const result: LegacyOrderBackfillResult = {
    deliveryOrdersCreated: 0,
    dineInOrdersCreated: 0,
    alreadyConverted: 0,
    itemsUnrecoverable: 0,
    amountMismatches: [],
    failures: [],
  };

  const knownProduct = async (tx: AsyncDb, id: string | undefined) =>
    id ? Boolean(await tx.queryOne("SELECT id FROM tiffin_products WHERE id = ?", [id])) : false;

  const legacyTasks = await db.query<any>(`
    SELECT t.* FROM delivery_tasks t
    WHERE t.order_type = 'EXTERNAL' AND t.subscription_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.delivery_task_id = t.id)
    ORDER BY t.created_at
  `);
  for (const r of legacyTasks) {
    try {
      await db.transaction(async (tx) => {
        const orderId = `ord_legacy_${r.id}`;
        // Serializes concurrent backfill runs on this source row; the later run sees the order.
        await acquireLedgerKeyLock(tx, `backfill:${r.id}`);
        if (await tx.queryOne("SELECT id FROM orders WHERE id = ? OR delivery_task_id = ?", [orderId, r.id])) {
          result.alreadyConverted++;
          return;
        }
        const parts = legacyDeliveryToOrderParts(r);
        for (const it of parts.items) {
          if (!(await knownProduct(tx, it.productId))) it.productId = undefined;
        }
        let customerId: string | null = null;
        const metaCustomer = typeof parts.meta?.customerId === "string" ? parts.meta.customerId : null;
        if (metaCustomer && (await tx.queryOne("SELECT id FROM tiffin_customers WHERE id = ?", [metaCustomer]))) {
          customerId = metaCustomer;
        } else if (r.customer_phone) {
          const byPhone = await tx.queryOne<{ id: string }>("SELECT id FROM tiffin_customers WHERE phone = ? LIMIT 1", [r.customer_phone]);
          customerId = byPhone?.id ?? null;
        }
        const metaKey = typeof parts.meta?.idempotencyKey === "string" ? parts.meta.idempotencyKey : null;
        const keyFree = metaKey ? !(await tx.queryOne("SELECT id FROM orders WHERE idempotency_key = ?", [metaKey])) : false;
        await insertOrderRows(
          tx,
          {
            id: orderId,
            orderType: "DELIVERY",
            status: "CONFIRMED",
            serviceDate: r.service_date,
            mealType: r.meal_type,
            customerId,
            customerName: r.customer_name || "City Customer",
            customerPhone: r.customer_phone || null,
            deliveryAddress: r.delivery_address || null,
            deliveryTaskId: r.id,
            financialTransactionId: null,
            paymentMethod: null,
            notes: parts.notes,
            idempotencyKey: keyFree ? metaKey : null,
            source: "LEGACY_BACKFILL",
            createdBy: r.created_by || null,
            createdAt: r.created_at,
          },
          parts.items
        );
        if (!parts.recovered) result.itemsUnrecoverable++;
        result.deliveryOrdersCreated++;
      });
    } catch (err: any) {
      result.failures.push({ sourceId: r.id, error: err?.message ?? String(err) });
    }
  }

  const legacySales = await db.query<any>(`
    SELECT ft.* FROM financial_transactions ft
    WHERE ft.category = 'TIFFIN_WALKIN_SALE'
      AND ft.transaction_type = 'TIFFIN_PAYMENT'
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.financial_transaction_id = ft.id)
    ORDER BY ft.created_at
  `);
  for (const r of legacySales) {
    try {
      await db.transaction(async (tx) => {
        const orderId = `ord_legacy_${r.id}`;
        await acquireLedgerKeyLock(tx, `backfill:${r.id}`);
        if (await tx.queryOne("SELECT id FROM orders WHERE id = ? OR financial_transaction_id = ?", [orderId, r.id])) {
          result.alreadyConverted++;
          return;
        }
        const parts = legacyDineInToOrderParts(r);
        let items = parts.items;
        const ledgerAmount = Math.round(Number(r.amount) || 0);
        if (parts.totalAmount !== ledgerAmount) {
          // The ledger is authoritative for money; keep the recovered lines only if they agree.
          result.amountMismatches.push(`${r.id}: items ₹${parts.totalAmount} vs ledger ₹${ledgerAmount}`);
          items = [{ productName: "Legacy counter sale (items disagree with ledger)", quantity: 1, unitPrice: ledgerAmount, lineTotal: ledgerAmount }];
        }
        for (const it of items) {
          if (!(await knownProduct(tx, it.productId))) it.productId = undefined;
        }
        const metaKey = typeof parts.meta?.idempotencyKey === "string" ? parts.meta.idempotencyKey : null;
        const keyFree = metaKey ? !(await tx.queryOne("SELECT id FROM orders WHERE idempotency_key = ?", [metaKey])) : false;
        await insertOrderRows(
          tx,
          {
            id: orderId,
            orderType: "DINE_IN",
            status: r.status === "REVERSED" ? "CANCELLED" : "COMPLETED",
            serviceDate: r.transaction_date,
            mealType: "LUNCH",
            customerId: null,
            customerName: parts.customerName,
            customerPhone: parts.customerPhone,
            deliveryAddress: null,
            deliveryTaskId: null,
            financialTransactionId: r.id,
            paymentMethod: r.payment_method || null,
            notes: parts.notes,
            idempotencyKey: keyFree ? metaKey : null,
            source: "LEGACY_BACKFILL",
            createdBy: r.created_by || null,
            createdAt: r.created_at,
          },
          items
        );
        if (!parts.recovered) result.itemsUnrecoverable++;
        result.dineInOrdersCreated++;
      });
    } catch (err: any) {
      result.failures.push({ sourceId: r.id, error: err?.message ?? String(err) });
    }
  }

  return result;
}
