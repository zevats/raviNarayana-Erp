import { AsyncDb } from "../database/db";
import { hasDeliveryOpsSchema, activeCollectionSql } from "./deliveryRules";

/**
 * A tiffin customer's delivered doorstep orders as one account.
 *
 * Each order first keeps what was paid for it (cash or UPI, at the door or at the office). Money paid
 * beyond an order (an advance, or extra taken at the door) is the customer's credit, and the credit
 * pays the orders still owing, oldest first; what is left is the customer's advance. So an advance
 * paid on Monday pays Tuesday's order, and an order is never shown as unpaid while the customer has
 * credit. Which stop the money was taken at stays on the collection record (custody and handover
 * follow it); only the balances are read this way.
 *
 * Collections that no longer count are left out (activeCollectionSql: a UPI whose cashbook entry was
 * reversed). Cash always counts.
 */
export interface LedgerOrder {
  id: string;
  deliveryTaskId: string;
  serviceDate: string;
  /** Value of the delivered items. */
  due: number;
  /** Collected on this stop (what the custody ledger shows for it). */
  collected: number;
  /** Paid: its own collections, then the customer's credit (oldest owing order first). */
  paid: number;
  /** Still owed on this order. */
  open: number;
}

export interface CustomerOrderLedger {
  orders: LedgerOrder[];
  due: number;
  collected: number;
  /** Still owed across the orders. */
  owed: number;
  /** Paid beyond every delivered order (customer credit). */
  advance: number;
  unpaidOrders: number;
  oldestUnpaid: string | null;
}

type Row = { id: string; delivery_task_id: string; service_date: string; created_at: string | null; due: number | string; collected: number | string };

/** Own collections first, then credit (paid beyond orders) to the oldest owing orders. Rows oldest first. */
export function applyOldestFirst(rows: Array<{ id: string; deliveryTaskId: string; serviceDate: string; due: number; collected: number }>): CustomerOrderLedger {
  const collected = rows.reduce((s, r) => s + r.collected, 0);
  let credit = rows.reduce((s, r) => s + Math.max(0, r.collected - r.due), 0);
  const orders: LedgerOrder[] = rows.map((r) => {
    const own = Math.max(0, Math.min(r.due, r.collected));
    const fromCredit = Math.min(r.due - own, credit);
    credit -= fromCredit;
    const paid = own + fromCredit;
    return { id: r.id, deliveryTaskId: r.deliveryTaskId, serviceDate: r.serviceDate, due: r.due, collected: r.collected, paid, open: r.due - paid };
  });
  const open = orders.filter((o) => o.open > 0);
  return {
    orders,
    due: rows.reduce((s, r) => s + r.due, 0),
    collected,
    owed: open.reduce((s, o) => s + o.open, 0),
    advance: Math.max(0, credit),
    unpaidOrders: open.length,
    oldestUnpaid: open.length ? open[0].serviceDate : null,
  };
}

const empty = (): CustomerOrderLedger => ({ orders: [], due: 0, collected: 0, owed: 0, advance: 0, unpaidOrders: 0, oldestUnpaid: null });

/**
 * The order accounts of these customers, in one query. `excludeOrderId` leaves one order out
 * entirely (its value and what was collected on it): the balance from before that order.
 */
export async function loadOrderLedgers(
  db: AsyncDb,
  customerIds: string[],
  opts: {
    excludeOrderId?: string | null;
    /** Customers chosen by a subquery instead of a list (e.g. the customers behind some delivery stops), so the caller need not look them up first. */
    customerSql?: { sql: string; params: any[] };
  } = {}
): Promise<Map<string, CustomerOrderLedger>> {
  const out = new Map<string, CustomerOrderLedger>();
  const ids = Array.from(new Set(customerIds.filter(Boolean)));
  if (ids.length === 0 && !opts.customerSql) return out;
  const active = (await hasDeliveryOpsSchema(db)) ? ` AND ${activeCollectionSql("dc")}` : "";
  const who = opts.customerSql ? `o.customer_id IN (${opts.customerSql.sql})` : `o.customer_id IN (${ids.map(() => "?").join(", ")})`;
  const whoParams = opts.customerSql ? opts.customerSql.params : ids;
  const rows = await db.query<Row & { customer_id: string }>(
    `SELECT o.id, o.customer_id, o.delivery_task_id, o.service_date, o.created_at,
            (SELECT COALESCE(SUM(COALESCE(oi.delivered_quantity, oi.quantity) * oi.unit_price), 0) FROM order_items oi WHERE oi.order_id = o.id) AS due,
            (SELECT COALESCE(SUM(dc.amount), 0) FROM delivery_collections dc WHERE dc.delivery_task_id = o.delivery_task_id${active}) AS collected
     FROM orders o JOIN delivery_tasks t ON t.id = o.delivery_task_id AND t.status = 'DELIVERED'
     WHERE o.order_type = 'DELIVERY' AND o.status = 'COMPLETED' AND ${who} AND o.id <> ?
     ORDER BY o.customer_id, o.service_date, o.created_at, o.id`,
    [...whoParams, opts.excludeOrderId || ""]
  );
  const by = new Map<string, Array<{ id: string; deliveryTaskId: string; serviceDate: string; due: number; collected: number }>>();
  for (const r of rows) {
    const list = by.get(r.customer_id) ?? [];
    list.push({ id: r.id, deliveryTaskId: r.delivery_task_id, serviceDate: r.service_date, due: Number(r.due), collected: Number(r.collected) });
    by.set(r.customer_id, list);
  }
  for (const id of ids) out.set(id, by.has(id) ? applyOldestFirst(by.get(id)!) : empty());
  for (const [id, list] of by) if (!out.has(id)) out.set(id, applyOldestFirst(list));
  return out;
}
