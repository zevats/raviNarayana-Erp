import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { resolveCatalogItems } from "./orderService";
import { cancelDeliveryTask, OpsClock } from "../delivery/deliveryOps";
import { isPastCutoff, refreshMealSchedule } from "../delivery/deliveryRules";
import { AuthenticatedUser, MealType } from "@/types";

/**
 * Editing and cancelling orders (migration 0019). Rules (Owner decisions 2026-11-01):
 * - Only delivery orders whose delivery has not been attempted can change: no money collected,
 *   not delivered or reported undelivered, not on an invoice. A dine-in order is paid at the counter
 *   and is never edited or cancelled here (a correction is a reversal in Finance).
 * - An order with any money collected cannot be cancelled.
 * - After the meal's cutoff a change or cancellation needs an explicit Manager override and reason.
 * - Prices: lines for products already on the order keep the price agreed when it was placed; a
 *   product added by the edit is priced from the menu now. The browser never sets a price.
 * - Before every change the previous version is kept as a revision; nothing is deleted.
 */

export interface OrderEditInput {
  items?: Array<{ productId: string; quantity: number; productName?: string }>;
  deliveryAddress?: string;
  notes?: string | null;
  reason?: string;
  overrideCutoff?: boolean;
}

export interface OrderRevision {
  revisionNo: number;
  snapshot: { items: Array<{ productName: string; quantity: number; unitPrice: number; lineTotal: number }>; deliveryAddress: string | null; notes: string | null; totalAmount: number; totalQuantity: number };
  reason: string | null;
  changedByName: string | null;
  createdAt: string;
}

let revisionsPresent = false;
async function requireOrderLifecycleSchema(db: AsyncDb): Promise<void> {
  if (revisionsPresent) return;
  const row = db.isPostgres
    ? await db.queryOne<{ t: string | null }>("SELECT to_regclass('public.order_revisions')::text AS t")
    : await db.queryOne<{ t: string | null }>("SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name = 'order_revisions'");
  revisionsPresent = Boolean(row?.t);
  if (!revisionsPresent) {
    const err: any = new Error("Editing orders needs the latest database update, which is not installed yet.");
    err.statusCode = 409;
    throw err;
  }
}

/** Why an order can no longer be changed, or null when it can (task row locked by the caller). */
async function blockingReason(tx: AsyncDb, order: any, task: any): Promise<string | null> {
  if (order.order_type !== "DELIVERY") return "A dine-in order is paid at the counter and cannot be changed here. Record a correction in Finance.";
  if (order.status === "CANCELLED") return "This order was cancelled.";
  if (order.status !== "CONFIRMED") return "This order is complete and can no longer be changed.";
  if (!task) return "This order has no delivery to change.";
  if (task.status === "DELIVERED" || task.status === "EXCEPTION") return "The delivery has already been attempted, so the order can no longer be changed.";
  if (task.status === "CANCELLED") return "The delivery was cancelled.";
  if (task.invoice_id) return "This delivery is already on an invoice.";
  const paid = await tx.queryOne<{ n: number | string }>("SELECT COUNT(*) AS n FROM delivery_collections WHERE delivery_task_id = ?", [task.id]);
  if (Number(paid?.n || 0) > 0 || Number(task.collected_amount || 0) > 0) return "Money has been collected for this order, so it can no longer be changed or cancelled.";
  return null;
}

/** Changes the items, address or notes of a delivery order that has not gone out yet. */
export async function updateDeliveryOrder(
  actor: AuthenticatedUser,
  orderId: string,
  input: OrderEditInput,
  clientIp?: string,
  asyncDb?: AsyncDb,
  clock?: OpsClock
) {
  requirePermission(actor, "delivery.manage", { ip: clientIp, targetId: orderId, action: "orders.order_updated" });
  const db = asyncDb ?? getAsyncDb();
  await requireOrderLifecycleSchema(db);
  await refreshMealSchedule(db);
  const now = clock?.now ?? new Date();
  const at = now.toISOString();
  const reason = input.reason?.trim() || null;
  let changes: string[] = [];

  await db.transaction(async (tx) => {
    const order = await tx.queryOne<any>(`SELECT * FROM orders WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [orderId]);
    if (!order) throw new Error("Order not found.");
    const task = order.delivery_task_id
      ? await tx.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [order.delivery_task_id])
      : null;
    const blocked = await blockingReason(tx, order, task);
    if (blocked) throw new Error(blocked);
    const past = isPastCutoff(order.service_date, order.meal_type as MealType, now);
    if (past && (!input.overrideCutoff || !reason || reason.length < 3)) {
      throw new Error("This meal is past its cutoff. Confirm the Manager override and give a reason to change the order.");
    }

    const oldItems = await tx.query<any>("SELECT * FROM order_items WHERE order_id = ? ORDER BY line_no", [orderId]);
    let newItems = oldItems.map((it) => ({ productId: it.product_id, productName: it.product_name, quantity: Number(it.quantity), unitPrice: Number(it.unit_price), lineTotal: Number(it.line_total) }));
    if (input.items) {
      const merged = new Map<string, number>();
      for (const it of input.items) {
        const id = String(it.productId || "").trim();
        merged.set(id, (merged.get(id) || 0) + Number(it.quantity));
      }
      const resolved = await resolveCatalogItems(tx, Array.from(merged.entries()).map(([productId, quantity]) => ({ productId, quantity, productName: "", unitPrice: 0 } as any)));
      const agreed = new Map(oldItems.filter((it) => it.product_id).map((it) => [it.product_id, Number(it.unit_price)]));
      newItems = resolved.map((it) => {
        const unitPrice = agreed.has(it.productId!) ? agreed.get(it.productId!)! : it.unitPrice;
        return { productId: it.productId as string, productName: it.productName, quantity: it.quantity, unitPrice, lineTotal: unitPrice * it.quantity };
      });
      const describe = (list: Array<{ productName: string; quantity: number }>) => list.map((i) => `${i.quantity}× ${i.productName}`).join(", ");
      const before = describe(oldItems.map((i) => ({ productName: i.product_name, quantity: Number(i.quantity) })));
      const after = describe(newItems);
      if (before !== after) changes.push(`items ${before} → ${after}`);
    }
    const address = input.deliveryAddress !== undefined ? input.deliveryAddress.trim() : order.delivery_address;
    if (!address || address.length < 5) throw new Error("Delivery address must be at least 5 characters.");
    if (address !== order.delivery_address) changes.push("address");
    const notes = input.notes !== undefined ? input.notes?.trim() || null : order.notes;
    if ((notes || null) !== (order.notes || null)) changes.push("notes");
    if (changes.length === 0) return;

    const revisionNo = Number(order.revision || 0) + 1;
    await tx.execute(
      "INSERT INTO order_revisions (id, order_id, revision_no, snapshot, reason, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        `orev_${crypto.randomUUID()}`, orderId, revisionNo,
        JSON.stringify({
          items: oldItems.map((i) => ({ productName: i.product_name, quantity: Number(i.quantity), unitPrice: Number(i.unit_price), lineTotal: Number(i.line_total) })),
          deliveryAddress: order.delivery_address, notes: order.notes, totalAmount: Number(order.total_amount), totalQuantity: Number(order.total_quantity),
        }),
        reason, actor.id, at,
      ]
    );
    if (input.items) {
      await tx.execute("DELETE FROM order_items WHERE order_id = ?", [orderId]);
      let lineNo = 0;
      for (const it of newItems) {
        lineNo++;
        // New line ids per revision: an offline completion queued against the old lines is refused
        // as a conflict instead of being applied to different items.
        await tx.execute(
          "INSERT INTO order_items (id, order_id, line_no, product_id, product_name, quantity, unit_price, line_total, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [`${orderId}_r${revisionNo}_l${lineNo}`, orderId, lineNo, it.productId, it.productName, it.quantity, it.unitPrice, it.lineTotal, at]
        );
      }
    }
    const totalQuantity = newItems.reduce((a, i) => a + i.quantity, 0);
    const totalAmount = newItems.reduce((a, i) => a + i.lineTotal, 0);
    await tx.execute(
      "UPDATE orders SET total_quantity = ?, total_amount = ?, delivery_address = ?, notes = ?, revision = ?, updated_at = ? WHERE id = ?",
      [totalQuantity, totalAmount, address, notes, revisionNo, at, orderId]
    );
    await tx.execute("UPDATE delivery_tasks SET delivery_address = ?, updated_at = ? WHERE id = ?", [address, at, task.id]);
    await tx.execute(
      `INSERT INTO delivery_task_events (id, task_id, event_type, from_status, to_status, actor_id, actor_name, notes, created_at)
       VALUES (?, ?, 'UPDATED', ?, ?, ?, ?, ?, ?)`,
      [`devt_${crypto.randomUUID()}`, task.id, task.status, task.status, actor.id, actor.fullName, `Order changed: ${changes.join("; ")}${past ? " (after the cutoff, Manager override)" : ""}${reason ? `. Reason: ${reason}` : ""}`, at]
    );
    await recordAuditEventAsync({
      actorId: actor.id, actorUsername: actor.username, action: "orders.order_updated", targetType: "order", targetId: orderId,
      metadata: { revisionNo, changes, previousTotal: Number(order.total_amount), newTotal: totalAmount, afterCutoff: past, reason }, ipAddress: clientIp,
    }, tx);
  });
  return { changed: changes.length > 0, changes };
}

/**
 * Cancels a delivery order that has not been delivered and has no money collected: the delivery
 * is cancelled with the reason (same rules as on the Delivery page) and the order keeps who
 * cancelled it, when and why.
 */
export async function cancelOrder(
  actor: AuthenticatedUser,
  orderId: string,
  input: { reason?: string; overrideCutoff?: boolean },
  clientIp?: string,
  asyncDb?: AsyncDb,
  clock?: OpsClock
) {
  requirePermission(actor, "delivery.manage", { ip: clientIp, targetId: orderId, action: "orders.order_cancelled" });
  const db = asyncDb ?? getAsyncDb();
  await requireOrderLifecycleSchema(db);
  const order = await db.queryOne<any>("SELECT * FROM orders WHERE id = ?", [orderId]);
  if (!order) throw new Error("Order not found.");
  if (order.order_type !== "DELIVERY") throw new Error("A dine-in order is paid at the counter and cannot be cancelled. Record a correction in Finance.");
  if (order.status === "CANCELLED") return { cancelled: true, alreadyCancelled: true };
  if (!order.delivery_task_id) throw new Error("This order has no delivery to cancel.");
  const task = await db.queryOne<any>("SELECT * FROM delivery_tasks WHERE id = ?", [order.delivery_task_id]);
  if (task && task.status === "EXCEPTION") throw new Error("The delivery was already attempted. Resolve it on the Delivery page instead.");
  const paid = await db.queryOne<{ n: number | string }>("SELECT COUNT(*) AS n FROM delivery_collections WHERE delivery_task_id = ?", [order.delivery_task_id]);
  if (Number(paid?.n || 0) > 0) throw new Error("Money has been collected for this order, so it cannot be cancelled.");
  await cancelDeliveryTask(actor, order.delivery_task_id, { reason: input.reason, overrideCutoff: input.overrideCutoff }, clientIp, db, clock);
  const at = (clock?.now ?? new Date()).toISOString();
  await db.execute(
    "UPDATE orders SET cancelled_at = COALESCE(cancelled_at, ?), cancelled_by = COALESCE(cancelled_by, ?), cancel_reason = COALESCE(cancel_reason, ?), updated_at = ? WHERE id = ? AND status = 'CANCELLED'",
    [at, actor.id, input.reason?.trim() || null, at, orderId]
  );
  await recordAuditEventAsync({
    actorId: actor.id, actorUsername: actor.username, action: "orders.order_cancelled", targetType: "order", targetId: orderId,
    metadata: { deliveryTaskId: order.delivery_task_id, reason: input.reason?.trim() || null, totalAmount: Number(order.total_amount) }, ipAddress: clientIp,
  }, db);
  return { cancelled: true, alreadyCancelled: false };
}

/** The order's earlier versions, newest first. */
export async function listOrderRevisions(actor: AuthenticatedUser, orderId: string, asyncDb?: AsyncDb): Promise<OrderRevision[]> {
  // Owner/Manager only: delivery staff see their own stops, not the order's change history.
  requirePermission(actor, "delivery.manage");
  const db = asyncDb ?? getAsyncDb();
  await requireOrderLifecycleSchema(db);
  const rows = await db.query<any>(
    `SELECT r.*, s.full_name AS changed_by_name FROM order_revisions r LEFT JOIN staff_users s ON s.id = r.changed_by WHERE r.order_id = ? ORDER BY r.revision_no DESC`,
    [orderId]
  );
  return rows.map((r) => ({ revisionNo: Number(r.revision_no), snapshot: JSON.parse(r.snapshot), reason: r.reason ?? null, changedByName: r.changed_by_name ?? null, createdAt: r.created_at }));
}
