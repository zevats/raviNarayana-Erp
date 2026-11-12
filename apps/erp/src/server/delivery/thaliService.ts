import crypto from "crypto";
import { AsyncDb, getAsyncDb } from "../database/db";
import type { AuthenticatedUser } from "@/types";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { recordAuditEventAsync } from "../audit/audit";
import { acquireLedgerKeyLock } from "../finance/financeService";
import { hasThaliCustodySchema } from "../database/schemaFeatures";

/**
 * Thalis carried by staff (owner, 2026-11-12; migration 0030).
 *
 *  - A thali not delivered is either brought back by the staff member (they hold it) or damaged.
 *  - A thali delivered beyond the order is charged on the order (the order line grows) and comes out
 *    of what the staff member holds.
 *  - What a staff member holds is handed back to the PG like cash: they declare the count, the
 *    owner or a manager verifies what was received; the received thalis join the PG's spare stock.
 *    The owner's own return needs no one else (it is with the owner already).
 *  - Spare thalis are given to a staff member for other deliveries, so nothing is wasted.
 */

export interface ThaliMove {
  id: string;
  staffId: string;
  staffName: string | null;
  kind: "HELD" | "EXTRA" | "DAMAGED" | "RETURN" | "SHORT" | "ISSUED";
  quantity: number;
  staffDelta: number;
  stockDelta: number;
  status: "DONE" | "PENDING" | "VERIFIED";
  productName: string | null;
  customerName: string | null;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  verifiedQuantity: number | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
}

export interface ThaliSummary {
  ready: boolean;
  /** Spare thalis at the PG, ready to be used again. */
  stock: number;
  staff: Array<{ staffId: string; staffName: string; holding: number; pending: number; extras: number; damaged: number }>;
  pending: ThaliMove[];
  recent: ThaliMove[];
}

const n = (v: unknown) => Number(v ?? 0) || 0;

const MOVE_SELECT = `SELECT m.*, s.full_name AS staff_name, c.full_name AS created_by_name, v.full_name AS verified_by_name,
       COALESCE(t.customer_name, t.resident_name) AS customer_name
  FROM thali_moves m
  LEFT JOIN staff_users s ON s.id = m.staff_id
  LEFT JOIN staff_users c ON c.id = m.created_by
  LEFT JOIN staff_users v ON v.id = m.verified_by
  LEFT JOIN delivery_tasks t ON t.id = m.task_id`;

function mapMove(r: any): ThaliMove {
  return {
    id: r.id,
    staffId: r.staff_id,
    staffName: r.staff_name ?? null,
    kind: r.kind,
    quantity: n(r.quantity),
    staffDelta: n(r.staff_delta),
    stockDelta: n(r.stock_delta),
    status: r.status,
    productName: r.product_name ?? null,
    customerName: r.customer_name ?? null,
    note: r.note ?? null,
    createdAt: r.created_at,
    createdByName: r.created_by_name ?? null,
    verifiedQuantity: r.verified_quantity === null || r.verified_quantity === undefined ? null : n(r.verified_quantity),
    verifiedByName: r.verified_by_name ?? null,
    verifiedAt: r.verified_at ?? null,
  };
}

async function insertMove(
  tx: AsyncDb,
  m: { staffId: string; kind: ThaliMove["kind"]; quantity: number; staffDelta: number; stockDelta?: number; status?: ThaliMove["status"]; taskId?: string | null; orderId?: string | null; productName?: string | null; note?: string | null; createdBy: string; at: string }
): Promise<string> {
  const id = `thm_${crypto.randomUUID()}`;
  await tx.execute(
    `INSERT INTO thali_moves (id, staff_id, kind, quantity, staff_delta, stock_delta, status, task_id, order_id, product_name, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, m.staffId, m.kind, m.quantity, m.staffDelta, m.stockDelta ?? 0, m.status ?? "DONE", m.taskId ?? null, m.orderId ?? null, m.productName ?? null, m.note ?? null, m.createdBy, m.at]
  );
  return id;
}

/** What a staff member holds now (never below 0 on screen). */
export async function staffHolding(db: AsyncDb, staffId: string): Promise<number> {
  const r = await db.queryOne<{ h: number | string }>("SELECT COALESCE(SUM(staff_delta), 0) AS h FROM thali_moves WHERE staff_id = ?", [staffId]);
  return n(r?.h);
}

async function stockNow(db: AsyncDb): Promise<number> {
  const r = await db.queryOne<{ s: number | string }>("SELECT COALESCE(SUM(stock_delta), 0) AS s FROM thali_moves");
  return n(r?.s);
}

/**
 * Called inside the delivery's own transaction: records what happened to the thalis at the door.
 * `lines`: per item, extra delivered beyond the order, and the undelivered count with where it went.
 */
export async function recordDoorThalis(
  tx: AsyncDb,
  args: {
    staffId: string;
    actor: AuthenticatedUser;
    taskId: string;
    orderId: string | null;
    at: string;
    lines: Array<{ productName: string; extra: number; undelivered: number; disposition: string | null }>;
  }
): Promise<void> {
  if (!(await hasThaliCustodySchema(tx))) return;
  const relevant = args.lines.filter((l) => l.extra > 0 || l.undelivered > 0);
  if (relevant.length === 0) return;
  await acquireLedgerKeyLock(tx, `thalis:${args.staffId}`);
  let holding = await staffHolding(tx, args.staffId);
  for (const l of relevant) {
    if (l.undelivered > 0) {
      const damaged = l.disposition === "DISCARDED";
      await insertMove(tx, {
        staffId: args.staffId,
        kind: damaged ? "DAMAGED" : "HELD",
        quantity: l.undelivered,
        staffDelta: damaged ? 0 : l.undelivered,
        taskId: args.taskId,
        orderId: args.orderId,
        productName: l.productName,
        note: damaged ? "Damaged at the door" : "Not delivered: brought back",
        createdBy: args.actor.id,
        at: args.at,
      });
      if (!damaged) holding += l.undelivered;
    }
    if (l.extra > 0) {
      // Extras come out of what the staff member carries; beyond that they came from the kitchen.
      const fromHand = Math.max(0, Math.min(l.extra, holding));
      await insertMove(tx, {
        staffId: args.staffId,
        kind: "EXTRA",
        quantity: l.extra,
        staffDelta: -fromHand,
        taskId: args.taskId,
        orderId: args.orderId,
        productName: l.productName,
        note: `Delivered ${l.extra} more than ordered (charged on the order)`,
        createdBy: args.actor.id,
        at: args.at,
      });
      holding -= fromHand;
    }
  }
}

function canSeeAll(actor: AuthenticatedUser) {
  return actor.role !== "DELIVERY_PERSON" && hasPermission(actor.role, "delivery.manage");
}

/** The thali picture: spare stock at the PG, who holds how many, returns waiting to be verified. */
export async function getThaliSummary(actor: AuthenticatedUser, asyncDb?: AsyncDb): Promise<ThaliSummary> {
  requirePermission(actor, "delivery.read");
  const db = asyncDb ?? getAsyncDb();
  if (!(await hasThaliCustodySchema(db))) return { ready: false, stock: 0, staff: [], pending: [], recent: [] };
  const all = canSeeAll(actor);
  const where = all ? "" : " WHERE m.staff_id = ?";
  const params = all ? [] : [actor.id];
  const [stock, perStaff, pending, recent] = await Promise.all([
    stockNow(db),
    db.query<any>(
      `SELECT m.staff_id, s.full_name,
              COALESCE(SUM(m.staff_delta), 0) AS holding,
              COALESCE(SUM(CASE WHEN m.kind = 'RETURN' AND m.status = 'PENDING' THEN m.quantity ELSE 0 END), 0) AS pending,
              COALESCE(SUM(CASE WHEN m.kind = 'EXTRA' THEN m.quantity ELSE 0 END), 0) AS extras,
              COALESCE(SUM(CASE WHEN m.kind = 'DAMAGED' THEN m.quantity ELSE 0 END), 0) AS damaged
       FROM thali_moves m LEFT JOIN staff_users s ON s.id = m.staff_id${where}
       GROUP BY m.staff_id, s.full_name
       ORDER BY s.full_name`,
      params
    ),
    db.query<any>(`${MOVE_SELECT} WHERE m.kind = 'RETURN' AND m.status = 'PENDING'${all ? "" : " AND m.staff_id = ?"} ORDER BY m.created_at`, params),
    db.query<any>(`${MOVE_SELECT}${where} ORDER BY m.created_at DESC LIMIT 60`, params),
  ]);
  return {
    ready: true,
    stock: all ? stock : 0,
    staff: perStaff.map((r) => ({ staffId: r.staff_id, staffName: r.full_name || "Staff", holding: Math.max(0, n(r.holding)), pending: n(r.pending), extras: n(r.extras), damaged: n(r.damaged) })),
    pending: pending.map(mapMove),
    recent: recent.map(mapMove),
  };
}

async function ready(db: AsyncDb) {
  if (!(await hasThaliCustodySchema(db))) throw Object.assign(new Error("Thali tracking is being set up on this server. Try again in a minute."), { statusCode: 409 });
}

function whole(q: unknown, what: string): number {
  const v = Number(q);
  if (!Number.isInteger(v) || v <= 0) throw new Error(`Enter how many thalis ${what} (a whole number, 1 or more).`);
  if (v > 500) throw new Error("That is more thalis than one person can carry. Check the number.");
  return v;
}

/**
 * Hands thalis back to the PG. Delivery staff hand back their own; a manager or the owner may record
 * it for someone. The owner's own return is accepted at once.
 */
export async function declareThaliReturn(actor: AuthenticatedUser, input: { staffId?: string; quantity: number; note?: string }, clientIp?: string, asyncDb?: AsyncDb): Promise<ThaliMove> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.thalis_returned" });
  const db = asyncDb ?? getAsyncDb();
  await ready(db);
  const staffId = actor.role === "DELIVERY_PERSON" ? actor.id : String(input.staffId || actor.id);
  const qty = whole(input.quantity, "are handed back");
  const at = new Date().toISOString();
  let id = "";
  await db.transaction(async (tx) => {
    await acquireLedgerKeyLock(tx, `thalis:${staffId}`);
    const holding = await staffHolding(tx, staffId);
    if (qty > holding) throw new Error(holding > 0 ? `Only ${holding} thali${holding === 1 ? " is" : "s are"} with ${staffId === actor.id ? "you" : "this person"}.` : "No thalis are recorded with this person.");
    const own = staffId === actor.id && actor.role === "SUPER_ADMIN";
    id = await insertMove(tx, { staffId, kind: "RETURN", quantity: qty, staffDelta: -qty, stockDelta: own ? qty : 0, status: own ? "VERIFIED" : "PENDING", note: input.note?.trim().slice(0, 300) || null, createdBy: actor.id, at });
    if (own) await tx.execute("UPDATE thali_moves SET verified_by = ?, verified_at = ?, verified_quantity = ? WHERE id = ?", [actor.id, at, qty, id]);
    await recordAuditEventAsync({ actorId: actor.id, actorUsername: actor.username, action: "delivery.thalis_returned", targetType: "thali_move", targetId: id, metadata: { staffId, quantity: qty, autoVerified: own }, ipAddress: clientIp }, tx);
  });
  const row = await db.queryOne<any>(`${MOVE_SELECT} WHERE m.id = ?`, [id]);
  return mapMove(row);
}

/** The owner or a manager counts what was handed back. Fewer received stay with the staff member. */
export async function verifyThaliReturn(actor: AuthenticatedUser, moveId: string, input: { receivedQuantity: number; note?: string }, clientIp?: string, asyncDb?: AsyncDb): Promise<ThaliMove> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.thalis_verified" });
  const db = asyncDb ?? getAsyncDb();
  await ready(db);
  const received = Number(input.receivedQuantity);
  if (!Number.isInteger(received) || received < 0) throw new Error("Enter how many thalis you received (a whole number, 0 or more).");
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    const m = await tx.queryOne<any>(`SELECT * FROM thali_moves WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [moveId]);
    if (!m || m.kind !== "RETURN") throw new Error("This return was not found. Reload and try again.");
    if (m.status !== "PENDING") throw new Error("This return was already checked.");
    if (m.staff_id === actor.id && actor.role !== "SUPER_ADMIN") throw new AuthorizationError(403, "Someone else must check the thalis you hand back.");
    const declared = n(m.quantity);
    if (received > declared) throw new Error(`${declared} thali${declared === 1 ? " was" : "s were"} handed back; you cannot receive more than that.`);
    if (received < declared && String(input.note || "").trim().length < 3) throw new Error(`Say why ${declared - received} thali${declared - received === 1 ? " is" : "s are"} missing.`);
    await acquireLedgerKeyLock(tx, `thalis:${m.staff_id}`);
    await tx.execute("UPDATE thali_moves SET status = 'VERIFIED', verified_by = ?, verified_at = ?, verified_quantity = ?, stock_delta = ? WHERE id = ?", [actor.id, at, received, received, moveId]);
    if (received < declared) {
      await insertMove(tx, { staffId: m.staff_id, kind: "SHORT", quantity: declared - received, staffDelta: declared - received, note: `Not received when checked: ${String(input.note).trim().slice(0, 250)}`, createdBy: actor.id, at });
    }
    await recordAuditEventAsync({ actorId: actor.id, actorUsername: actor.username, action: "delivery.thalis_verified", targetType: "thali_move", targetId: moveId, metadata: { staffId: m.staff_id, declared, received, note: input.note ?? null }, ipAddress: clientIp }, tx);
  });
  const row = await db.queryOne<any>(`${MOVE_SELECT} WHERE m.id = ?`, [moveId]);
  return mapMove(row);
}

/** Thalis a staff member holds that got damaged (a loss, out of what they hold). */
export async function reportThaliDamage(actor: AuthenticatedUser, input: { staffId?: string; quantity: number; note: string }, clientIp?: string, asyncDb?: AsyncDb): Promise<ThaliMove> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.thalis_damaged" });
  const db = asyncDb ?? getAsyncDb();
  await ready(db);
  const staffId = actor.role === "DELIVERY_PERSON" ? actor.id : String(input.staffId || actor.id);
  const qty = whole(input.quantity, "were damaged");
  const note = String(input.note || "").trim();
  if (note.length < 3) throw new Error("Say what happened to the thalis.");
  const at = new Date().toISOString();
  let id = "";
  await db.transaction(async (tx) => {
    await acquireLedgerKeyLock(tx, `thalis:${staffId}`);
    const holding = await staffHolding(tx, staffId);
    if (qty > holding) throw new Error(holding > 0 ? `Only ${holding} thali${holding === 1 ? " is" : "s are"} recorded with this person.` : "No thalis are recorded with this person.");
    id = await insertMove(tx, { staffId, kind: "DAMAGED", quantity: qty, staffDelta: -qty, note: note.slice(0, 300), createdBy: actor.id, at });
    await recordAuditEventAsync({ actorId: actor.id, actorUsername: actor.username, action: "delivery.thalis_damaged", targetType: "thali_move", targetId: id, metadata: { staffId, quantity: qty, note }, ipAddress: clientIp }, tx);
  });
  const row = await db.queryOne<any>(`${MOVE_SELECT} WHERE m.id = ?`, [id]);
  return mapMove(row);
}

/** Spare thalis from the PG given to a staff member to use on other deliveries. */
export async function issueSpareThalis(actor: AuthenticatedUser, input: { staffId: string; quantity: number; note?: string }, clientIp?: string, asyncDb?: AsyncDb): Promise<ThaliMove> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.thalis_issued" });
  const db = asyncDb ?? getAsyncDb();
  await ready(db);
  const staffId = String(input.staffId || "").trim();
  if (!staffId) throw new Error("Choose who takes the spare thalis.");
  const person = await db.queryOne<any>("SELECT id, full_name, is_active FROM staff_users WHERE id = ?", [staffId]);
  if (!person || !Boolean(Number(person.is_active))) throw new Error("Choose an active staff member.");
  const qty = whole(input.quantity, "are given");
  const at = new Date().toISOString();
  let id = "";
  await db.transaction(async (tx) => {
    await acquireLedgerKeyLock(tx, "thalis:stock");
    const stock = await stockNow(tx);
    if (qty > stock) throw new Error(stock > 0 ? `Only ${stock} spare thali${stock === 1 ? " is" : "s are"} at the PG.` : "There are no spare thalis at the PG.");
    id = await insertMove(tx, { staffId, kind: "ISSUED", quantity: qty, staffDelta: qty, stockDelta: -qty, note: input.note?.trim().slice(0, 300) || "Spare thalis for deliveries", createdBy: actor.id, at });
    await recordAuditEventAsync({ actorId: actor.id, actorUsername: actor.username, action: "delivery.thalis_issued", targetType: "thali_move", targetId: id, metadata: { staffId, quantity: qty }, ipAddress: clientIp }, tx);
  });
  const row = await db.queryOne<any>(`${MOVE_SELECT} WHERE m.id = ?`, [id]);
  return mapMove(row);
}
