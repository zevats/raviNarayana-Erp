import { AsyncDb } from "../database/db";
import { hasDeliveryOpsSchema, activeCollectionSql } from "../delivery/deliveryRules";

export interface CustomerBalance {
  /** What the customer owes now (negative = paid ahead). Same rule as Finance -> Receivables. */
  due: number;
  /** Delivered orders still unpaid. */
  orders: number;
  /** Open tiffin bills. */
  bills: number;
  /** Advances and payments not yet set against a bill. */
  credit: number;
  unpaidOrders: number;
  oldestUnpaid: string | null;
}

/**
 * Balances of many tiffin customers in three grouped queries, run side by side: delivered orders
 * (collections that still count; a reversed UPI does not), open tiffin bills, and credit (advances
 * paid at the door and tiffin payments not yet allocated). PostgreSQL only; empty elsewhere.
 */
export async function loadCustomerBalancesById(db: AsyncDb, customerIds: string[]): Promise<Map<string, CustomerBalance>> {
  const out = new Map<string, CustomerBalance>();
  const ids = Array.from(new Set(customerIds.filter(Boolean)));
  if (ids.length === 0 || !db.isPostgres) return out;
  const marks = ids.map(() => "?").join(", ");
  const active = (await hasDeliveryOpsSchema(db)) ? `AND ${activeCollectionSql("dc")}` : "";
  const [orders, bills, credits] = await Promise.all([
    db.query<{ customer_id: string; owed: number | string; ahead: number | string; unpaid: number | string; oldest: string | null }>(
      `SELECT x.customer_id,
              SUM(CASE WHEN x.open > 0 THEN x.open ELSE 0 END) AS owed,
              SUM(CASE WHEN x.open < 0 THEN -x.open ELSE 0 END) AS ahead,
              COUNT(*) FILTER (WHERE x.open > 0) AS unpaid,
              MIN(x.service_date) FILTER (WHERE x.open > 0) AS oldest
       FROM (
         SELECT o.customer_id, o.service_date, COALESCE(d.due, 0) - COALESCE(cl.collected, 0) AS open
         FROM orders o JOIN delivery_tasks t ON t.id = o.delivery_task_id AND t.status = 'DELIVERED'
         LEFT JOIN (SELECT order_id, SUM(COALESCE(delivered_quantity, quantity) * unit_price) AS due FROM order_items GROUP BY order_id) d ON d.order_id = o.id
         LEFT JOIN (SELECT dc.delivery_task_id, SUM(dc.amount) AS collected FROM delivery_collections dc WHERE 1 = 1 ${active} GROUP BY dc.delivery_task_id) cl ON cl.delivery_task_id = o.delivery_task_id
         WHERE o.order_type = 'DELIVERY' AND o.status = 'COMPLETED' AND o.customer_id IN (${marks})
       ) x
       GROUP BY x.customer_id`,
      ids
    ),
    db.query<{ customer_id: string; due: number | string }>(
      `SELECT customer_id, SUM(balance_due) AS due FROM invoices
       WHERE invoice_category = 'TIFFIN' AND status IN ('ISSUED', 'PARTIALLY_PAID') AND balance_due > 0 AND customer_id IN (${marks})
       GROUP BY customer_id`,
      ids
    ),
    db.query<{ customer_id: string; credit: number | string }>(
      `SELECT t.customer_id, SUM(t.amount - COALESCE(a.allocated, 0)) AS credit
       FROM financial_transactions t
       LEFT JOIN (SELECT payment_transaction_id, SUM(amount) AS allocated FROM invoice_payment_allocations GROUP BY payment_transaction_id) a ON a.payment_transaction_id = t.id
       WHERE t.transaction_type = 'TIFFIN_PAYMENT' AND t.status = 'POSTED' AND t.amount > COALESCE(a.allocated, 0) AND t.customer_id IN (${marks})
       GROUP BY t.customer_id`,
      ids
    ),
  ]);
  for (const id of ids) out.set(id, { due: 0, orders: 0, bills: 0, credit: 0, unpaidOrders: 0, oldestUnpaid: null });
  for (const r of orders) {
    const b = out.get(r.customer_id)!;
    b.orders = Number(r.owed);
    b.credit += Number(r.ahead);
    b.unpaidOrders = Number(r.unpaid);
    b.oldestUnpaid = r.oldest || null;
  }
  for (const r of bills) out.get(r.customer_id)!.bills = Number(r.due);
  for (const r of credits) out.get(r.customer_id)!.credit += Number(r.credit);
  for (const b of out.values()) b.due = b.orders + b.bills - b.credit;
  return out;
}
