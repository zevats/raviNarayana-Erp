import { businessToday } from "../../lib/businessDate";
import { hasDineInPayLaterSchema, hasPlanDineInSchema } from "../database/schemaFeatures";
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
  const rows = await db.query<{ id: string; name: string; price: number | string; status: string; billing_unit: string; category: string }>(
    `SELECT id, name, price, status, billing_unit, category FROM tiffin_products WHERE id IN (${ids.map(() => "?").join(", ")})`,
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
    return { productId: product.id, productName: product.name, quantity, unitPrice, lineTotal: quantity * unitPrice, category: product.category } as OrderItem & { category?: string };
  });
}

/**
 * Subscription order: the customer's monthly plan already covers this meal's thalis. Up to the
 * plan's thalis per meal are free (meal thali lines, oldest line first); anything more, and every
 * other item, is charged at the menu price. Free only when the plan is active on that day and covers
 * the meal, and its regular delivery for that meal has not gone out yet (it is replaced by the order).
 */
export async function planAllowance(db: AsyncDb, subscriptionId: string, customerId: string | null, serviceDate: string, mealType: string): Promise<{ included: number; reason: string | null }> {
  const s = await db.queryOne<any>(
    `SELECT s.id, s.customer_id, s.status, s.start_date, s.end_date, s.meal_types, s.quantity_per_meal, s.pause_start_date, s.pause_resume_date
     FROM tiffin_subscriptions s WHERE s.id = ?`,
    [subscriptionId]
  );
  if (!s) throw new Error("This subscription was not found. Refresh and choose the customer again.");
  if (customerId && s.customer_id !== customerId) throw new Error("This subscription belongs to another customer.");
  if (s.status !== "ACTIVE") return { included: 0, reason: "The plan is not active, so every thali is charged." };
  if (serviceDate < s.start_date || (s.end_date && serviceDate > s.end_date)) return { included: 0, reason: "The plan does not cover this date, so every thali is charged." };
  if (s.pause_start_date && serviceDate >= s.pause_start_date && (!s.pause_resume_date || serviceDate < s.pause_resume_date)) return { included: 0, reason: "The plan is paused on this date." };
  const anyMeal = s.meal_types === "ANY";
  // A 2-meal plan is lunch and dinner; an any-meal plan covers breakfast too.
  const covers = anyMeal || (s.meal_types === "BOTH" && mealType !== "BREAKFAST") || s.meal_types === mealType;
  if (!covers) return { included: 0, reason: `The plan does not include ${String(mealType).toLowerCase()}.` };
  // Thalis of the plan already taken as orders: per meal, or per day for an any-meal plan.
  const used = await db.queryOne<{ n: number | string | null }>(
    `SELECT COALESCE(SUM(oi.quantity), 0) AS n FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.customer_id = ? AND o.service_date = ? AND o.status <> 'CANCELLED' AND oi.unit_price = 0 AND oi.product_name LIKE ?${anyMeal ? "" : " AND o.meal_type = ?"}`,
    anyMeal ? [s.customer_id, serviceDate, "%(in plan)"] : [s.customer_id, serviceDate, "%(in plan)", mealType]
  );
  const left = Math.max(0, (Number(s.quantity_per_meal) || 0) - (Number(used?.n) || 0));
  if (left === 0) return { included: 0, reason: anyMeal ? "Today's plan thali has already been taken." : "This meal's plan thali has already been taken." };
  if (anyMeal) return { included: left, reason: null };
  const sent = await db.queryOne<{ n: number | string }>(
    "SELECT COUNT(*) AS n FROM delivery_tasks WHERE subscription_id = ? AND service_date = ? AND meal_type = ? AND status IN ('OUT_FOR_DELIVERY', 'DELIVERED')",
    [subscriptionId, serviceDate, mealType]
  );
  if (Number(sent?.n || 0) > 0) return { included: 0, reason: "This meal of the plan has already gone out." };
  return { included: left, reason: null };
}

/** Splits meal thali lines so that up to `included` thalis cost nothing (marked "in plan"). */
export function applyPlanAllowance(items: Array<OrderItem & { category?: string }>, included: number): OrderItem[] {
  let left = included;
  const out: OrderItem[] = [];
  for (const it of items) {
    if (left > 0 && it.category === "STANDARD_MEAL") {
      const free = Math.min(left, it.quantity);
      left -= free;
      out.push({ productId: it.productId, productName: `${it.productName} (in plan)`, quantity: free, unitPrice: 0, lineTotal: 0 });
      if (it.quantity > free) out.push({ productId: it.productId, productName: it.productName, quantity: it.quantity - free, unitPrice: it.unitPrice, lineTotal: (it.quantity - free) * it.unitPrice });
    } else {
      out.push({ productId: it.productId, productName: it.productName, quantity: it.quantity, unitPrice: it.unitPrice, lineTotal: it.lineTotal });
    }
  }
  return out;
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
    throw new Error(`Invalid meal type '${mealType}'. Choose breakfast, lunch or dinner.`);
  }

  const db = asyncDb || getAsyncDb();
  // The menu prices, the replay lookup and the plan allowance do not depend on each other.
  // A monthly-plan customer may take the meal as a delivery or eat it at the counter (dine in).
  const subscriptionId = (input as any).subscriptionId?.trim() || null;
  if (subscriptionId && !input.customerId?.trim()) throw new Error("Choose the subscription customer.");
  const [catalogItems, priorByKey, allowance] = await Promise.all([
    resolveCatalogItems(db, items),
    idempotencyKey ? loadOrders(db, "o.idempotency_key = ?", [idempotencyKey]) : Promise.resolve([] as UnifiedOrder[]),
    subscriptionId ? planAllowance(db, subscriptionId, input.customerId?.trim() || null, serviceDate, mealType) : Promise.resolve({ included: 0, reason: null }),
  ]);
  // The plan's own delivery for this meal would bring the same thalis again: skip it (the order
  // brings them, or they were eaten at the counter). A failure here never undoes the order.
  const skipPlanDelivery = async (reason: string) => {
    try {
      const { setSubscriptionDayOverride } = await import("../delivery/deliveryOps");
      await setSubscriptionDayOverride(actor, { subscriptionId: subscriptionId!, serviceDate, mealType: mealType as "LUNCH" | "DINNER", action: "SKIP", reason }, clientIp, db);
    } catch {
      /* the plan delivery stays; the manager can skip it on the Subscriptions screen */
    }
  };
  // Subscription order: the plan's thalis for this meal are free, the rest is charged.
  const normalizedItems = subscriptionId ? applyPlanAllowance(catalogItems, allowance.included) : catalogItems.map(({ category: _c, ...it }: any) => it as OrderItem);
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
    // A name is not required (owner, 2026-11-11): an order without one is a one-time customer, kept
    // on the order only and never added to Customers (unless the phone already is a customer).
    const givenName = input.customerName?.trim() || "";
    const oneTime = givenName.length < 2 && !input.customerId?.trim();
    let customerName = givenName.length >= 2 ? givenName : "Guest";
    const rawCustomerPhone = input.customerPhone?.trim();
    const deliveryAddress = input.deliveryAddress?.trim();

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
      if (!customerId && oneTime) {
        // No name: the order belongs to the customer with this phone if there is one; otherwise it
        // stays a one-time order with no customer record.
        const known = await tx.queryOne<{ id: string; full_name: string }>("SELECT id, full_name FROM tiffin_customers WHERE phone = ? LIMIT 1", [customerPhone]);
        if (known) {
          customerId = known.id;
          customerName = known.full_name;
          await tx.execute("UPDATE tiffin_customers SET status = 'ACTIVE', updated_at = ? WHERE id = ? AND status <> 'ACTIVE'", [now, known.id]);
        }
      } else if (!customerId) {
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
          UPDATE tiffin_customers SET delivery_address = ?, status = 'ACTIVE', updated_at = ? WHERE id = ?
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
      // "Assign to" chosen while taking the order (any active staff member) wins over the default.
      const chosen = input.assignToStaffId ? String(input.assignToStaffId).trim() : "";
      const defaultDriver = chosen ? { id: chosen } : await getDefaultDeliveryStaff(tx);
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
    if (subscriptionId && allowance.included > 0 && !raced) await skipPlanDelivery("Taken as an order instead");
    return { ...created, orderStatus: "CONFIRMED" };
  }

  // DINE IN ORDER FLOW
  // A plan customer eating the plan meal at the counter: nothing to pay when the plan covers it all.
  const inPlanFree = Boolean(subscriptionId) && totalAmount === 0;
  if (inPlanFree && !(await hasPlanDineInSchema(db))) {
    throw new Error("A free plan meal at the counter needs the latest database update, which is not installed yet.");
  }
  const customerName = input.customerName?.trim() || "Walk-in Guest";
  const customerPhone = input.customerPhone?.trim() || null;
  // Pay Later at the counter (migration 0024): no cashbook entry now; the order stays on the
  // guest's account (Finance -> Receivables) until it is paid. The guest must be identifiable.
  const payLater = !inPlanFree && ((input as any).payLater === true || String(input.paymentMethod || "").toUpperCase() === "PAY_LATER");
  if (payLater) {
    if (!(await hasDineInPayLaterSchema(db))) throw new Error("Pay Later for dine-in needs the latest database update, which is not installed yet.");
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

    if (!payLater && !inPlanFree) {
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
    const linked = subscriptionId
      ? { id: input.customerId!.trim() }
      : payLater && customerPhone
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
        financialTransactionId: payLater || inPlanFree ? null : txId,
        paymentMethod: payLater || inPlanFree ? null : paymentMethod,
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
      action: inPlanFree ? "orders.dine_in_in_plan" : payLater ? "orders.dine_in_pay_later" : "kitchen.walkin_sale_recorded",
      targetType: payLater || inPlanFree ? "order" : "financial_transaction",
      targetId: payLater || inPlanFree ? orderId : txId,
      metadata: {
        category: "TIFFIN_WALKIN_SALE",
        orderId,
        amount: totalAmount,
        paymentMethod: inPlanFree ? "IN_PLAN" : payLater ? "PAY_LATER" : paymentMethod,
        subscriptionId,
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
  // Eaten at the counter: the plan delivery for this meal is not needed.
  if (subscriptionId && allowance.included > 0) await skipPlanDelivery("Ate at the counter instead");
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

/** One order line of a customer's month (Customer details → Orders and payments). */
export interface CustomerMonthOrder {
  orderId: string;
  date: string;
  mealType: string;
  orderType: "DELIVERY" | "DINE_IN";
  items: string;
  total: number;
  paid: number;
  due: number;
  /** PAID, PART_PAID, UNPAID, PAY_LATER (on the account) or IN_PLAN (nothing to pay). */
  payment: "PAID" | "PART_PAID" | "UNPAID" | "PAY_LATER" | "IN_PLAN";
  status: string;
}
export interface CustomerMonthBill {
  invoiceId: string;
  number: string | null;
  issueDate: string;
  total: number;
  paid: number;
  due: number;
  status: string;
}
export interface CustomerMonth {
  month: string;
  label: string;
  orders: CustomerMonthOrder[];
  bills: CustomerMonthBill[];
  totals: { orders: number; amount: number; paid: number; due: number };
}

/**
 * A tiffin customer's orders and monthly bills for this month and the previous `months - 1`
 * months, with what was paid and what is still due, newest month first.
 */
export async function getCustomerMonthlyActivity(
  actor: AuthenticatedUser,
  customerId: string,
  months = 3,
  asyncDb?: AsyncDb
): Promise<CustomerMonth[]> {
  if (!hasPermission(actor.role, "tiffin.manage") && !hasPermission(actor.role, "delivery.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }
  const db = asyncDb || getAsyncDb();
  const cust = await db.queryOne<{ id: string; phone: string | null }>("SELECT id, phone FROM tiffin_customers WHERE id = ?", [customerId]);
  if (!cust) throw new Error("This customer was not found.");
  const today = businessToday();
  const [y, m] = today.split("-").map(Number);
  const startMonth = new Date(Date.UTC(y, m - 1 - (Math.max(1, Math.min(12, months)) - 1), 1));
  const from = startMonth.toISOString().slice(0, 10);
  const phone = (cust.phone || "").trim();
  const compact = phone.replace(/\s+/g, "");

  const [orders, bills] = await Promise.all([
    loadOrders(
      db,
      "(o.customer_id = ? OR (? <> '' AND (o.customer_phone = ? OR o.customer_phone = ?))) AND o.service_date >= ? AND o.status <> 'CANCELLED'",
      [customerId, phone, phone, compact, from],
      400
    ),
    db.query<any>(
      `SELECT id, invoice_number, issue_date, total_amount, amount_paid, balance_due, status
       FROM invoices WHERE customer_id = ? AND invoice_category = 'TIFFIN' AND status <> 'CANCELLED' AND status <> 'DRAFT' AND issue_date >= ?
       ORDER BY issue_date DESC`,
      [customerId, from]
    ),
  ]);

  const byMonth = new Map<string, CustomerMonth>();
  const monthOf = (d: string) => d.slice(0, 7);
  const label = (key: string) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
  for (let i = 0; i < Math.max(1, Math.min(12, months)); i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    byMonth.set(key, { month: key, label: label(key), orders: [], bills: [], totals: { orders: 0, amount: 0, paid: 0, due: 0 } });
  }
  for (const o of orders) {
    const bucket = byMonth.get(monthOf(o.serviceDate));
    if (!bucket) continue;
    const total = Number(o.totalAmount) || 0;
    const due = Math.max(0, Number(o.remainingAmount ?? (o.paymentStatus === "PAID" ? 0 : total)) || 0);
    const paid = Math.max(0, total - due);
    const payLater = (o as any).paymentChoice === "PAY_LATER" || (o.orderType === "DINE_IN" && o.paymentStatus !== "PAID" && due > 0);
    const payment: CustomerMonthOrder["payment"] =
      total === 0 ? "IN_PLAN" : due === 0 ? "PAID" : payLater ? "PAY_LATER" : paid > 0 ? "PART_PAID" : "UNPAID";
    bucket.orders.push({
      orderId: o.orderId || o.id,
      date: o.serviceDate,
      mealType: o.mealType,
      orderType: o.orderType as "DELIVERY" | "DINE_IN",
      items: (o.items || []).map((it) => `${it.quantity}× ${it.productName}`).join(", "),
      total,
      paid,
      due,
      payment,
      status: o.orderStatus,
    });
    bucket.totals.orders += 1;
    bucket.totals.amount += total;
    bucket.totals.paid += paid;
    bucket.totals.due += due;
  }
  for (const b of bills) {
    const bucket = byMonth.get(monthOf(String(b.issue_date)));
    if (!bucket) continue;
    const total = Number(b.total_amount) || 0;
    const paid = Number(b.amount_paid) || 0;
    const due = Math.max(0, Number(b.balance_due) || 0);
    bucket.bills.push({ invoiceId: b.id, number: b.invoice_number || null, issueDate: String(b.issue_date), total, paid, due, status: b.status });
    bucket.totals.amount += total;
    bucket.totals.paid += paid;
    bucket.totals.due += due;
  }
  for (const b of byMonth.values()) b.orders.sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : 0));
  return [...byMonth.values()];
}
