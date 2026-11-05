import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { recordAuditEventAsync } from "../audit/audit";
import { hasPayLaterSchema } from "../database/schemaFeatures";
import { hasDeliveryOpsSchema, activeCollectionSql } from "../delivery/deliveryRules";
import { getBusinessDateString } from "../finance/financeService";
import { AuthenticatedUser } from "@/types";

/**
 * Pay Later approval for delivery customers (migration 0021). The approval belongs to the tiffin
 * customer record, which every delivery order is attached to (orders.customer_id). Owner and
 * Manager change it (tiffin.manage); delivery staff never can. There is no credit limit (decision
 * D2). Every change keeps who and when on the customer and the previous and new state in the audit log.
 */

export class PayLaterUnavailableError extends Error {
  readonly statusCode = 409;
  constructor() {
    super("Pay Later needs database migration 0021, which is not installed yet.");
  }
}

export interface PayLaterStatus {
  customerId: string;
  customerName: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  outstandingDelivery: number;
  unpaidOrders: number;
  oldestUnpaidDate: string | null;
  oldestUnpaidDays: number | null;
  reviewsOpen: number;
}

/** Delivered orders of one customer that are not fully paid (collections that still count). */
async function deliveryBalance(db: AsyncDb, customerId: string) {
  const active = (await hasDeliveryOpsSchema(db)) ? `AND ${activeCollectionSql("dc")}` : "";
  const row = await db.queryOne<any>(
    `SELECT COALESCE(SUM(due - collected), 0) AS outstanding, COUNT(*) AS orders, MIN(service_date) AS oldest
     FROM (
       SELECT o.service_date,
              (SELECT COALESCE(SUM(COALESCE(oi.delivered_quantity, oi.quantity) * oi.unit_price), 0) FROM order_items oi WHERE oi.order_id = o.id) AS due,
              (SELECT COALESCE(SUM(dc.amount), 0) FROM delivery_collections dc WHERE dc.delivery_task_id = o.delivery_task_id ${active}) AS collected
       FROM orders o JOIN delivery_tasks t ON t.id = o.delivery_task_id AND t.status = 'DELIVERED'
       WHERE o.customer_id = ? AND o.order_type = 'DELIVERY' AND o.status = 'COMPLETED'
     ) x WHERE due > collected`,
    [customerId]
  );
  return { outstanding: Number(row?.outstanding || 0), orders: Number(row?.orders || 0), oldest: (row?.oldest as string) || null };
}

export async function getPayLaterStatus(actor: AuthenticatedUser, customerId: string, asyncDb?: AsyncDb): Promise<PayLaterStatus> {
  if (!hasPermission(actor.role, "tiffin.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }
  const db = asyncDb ?? getAsyncDb();
  if (!(await hasPayLaterSchema(db))) throw new PayLaterUnavailableError();
  const c = await db.queryOne<any>(
    `SELECT c.id, c.full_name, c.pay_later_enabled, c.pay_later_updated_at, u.full_name AS updated_by
     FROM tiffin_customers c LEFT JOIN staff_users u ON u.id = c.pay_later_updated_by WHERE c.id = ?`,
    [customerId]
  );
  if (!c) throw new Error("Customer not found.");
  const bal = await deliveryBalance(db, customerId);
  const reviews = await db.queryOne<any>(
    "SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND payment_review IS NOT NULL AND payment_reviewed_at IS NULL",
    [customerId]
  );
  const today = getBusinessDateString(new Date());
  return {
    customerId: c.id,
    customerName: c.full_name,
    enabled: Number(c.pay_later_enabled) === 1,
    updatedAt: c.pay_later_updated_at || null,
    updatedBy: c.updated_by || null,
    outstandingDelivery: bal.outstanding,
    unpaidOrders: bal.orders,
    oldestUnpaidDate: bal.oldest,
    oldestUnpaidDays: bal.oldest ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${bal.oldest}T00:00:00Z`)) / 86400000)) : null,
    reviewsOpen: Number(reviews?.n || 0),
  };
}

export async function setPayLater(
  actor: AuthenticatedUser,
  customerId: string,
  enabled: boolean,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<PayLaterStatus> {
  requirePermission(actor, "tiffin.manage", { ip: clientIp, action: "tiffin.customer_pay_later_changed" });
  if (typeof enabled !== "boolean") throw new Error("Say whether Pay Later is allowed (true or false).");
  const db = asyncDb ?? getAsyncDb();
  if (!(await hasPayLaterSchema(db))) throw new PayLaterUnavailableError();
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    const c = await tx.queryOne<any>(
      `SELECT id, full_name, pay_later_enabled FROM tiffin_customers WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`,
      [customerId]
    );
    if (!c) throw new Error("Customer not found.");
    const previous = Number(c.pay_later_enabled) === 1;
    if (previous === enabled) return;
    await tx.execute(
      "UPDATE tiffin_customers SET pay_later_enabled = ?, pay_later_updated_by = ?, pay_later_updated_at = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      [enabled ? 1 : 0, actor.id, now, now, actor.id, customerId]
    );
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "tiffin.customer_pay_later_changed",
        targetType: "tiffin_customer",
        targetId: customerId,
        metadata: { customerName: c.full_name, previous, next: enabled },
        ipAddress: clientIp,
      },
      tx
    );
  });
  return getPayLaterStatus(actor, customerId, db);
}

/**
 * A Manager has looked at an order flagged because a balance was left without Pay Later approval.
 * The balance itself is untouched (it is collected or followed up as usual); only the flag closes.
 */
export async function closePaymentReview(
  actor: AuthenticatedUser,
  orderId: string,
  note: string,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<void> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "orders.payment_review_closed" });
  const db = asyncDb ?? getAsyncDb();
  if (!(await hasPayLaterSchema(db))) throw new PayLaterUnavailableError();
  const clean = (note || "").trim();
  if (clean.length < 3) throw new Error("Add a short note on what was decided.");
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    const o = await tx.queryOne<any>(
      `SELECT id, payment_review, payment_reviewed_at FROM orders WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`,
      [orderId]
    );
    if (!o) throw new Error("Order not found.");
    if (!o.payment_review || o.payment_reviewed_at) return;
    await tx.execute("UPDATE orders SET payment_reviewed_by = ?, payment_reviewed_at = ?, updated_at = ? WHERE id = ?", [actor.id, now, now, orderId]);
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "orders.payment_review_closed",
        targetType: "order",
        targetId: orderId,
        metadata: { review: o.payment_review, note: clean },
        ipAddress: clientIp,
      },
      tx
    );
  });
}
