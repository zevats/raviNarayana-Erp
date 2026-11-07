import { AsyncDb } from "../database/db";
import { loadOrderLedgers } from "../delivery/orderLedger";

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
 * Balances of many tiffin customers in three queries, run side by side: delivered orders (one pool
 * of payments applied oldest first; a reversed UPI does not count), open tiffin bills, and credit
 * (paid beyond every delivered order, and tiffin payments not yet allocated). PostgreSQL only; empty elsewhere.
 */
export async function loadCustomerBalancesById(db: AsyncDb, customerIds: string[]): Promise<Map<string, CustomerBalance>> {
  const out = new Map<string, CustomerBalance>();
  const ids = Array.from(new Set(customerIds.filter(Boolean)));
  if (ids.length === 0 || !db.isPostgres) return out;
  const marks = ids.map(() => "?").join(", ");
  // Delivered orders: one pool of payments applied oldest first (orderLedger), so an advance paid at
  // the door pays the next orders and an order covered by credit is not counted as unpaid.
  const [ledgers, bills, credits] = await Promise.all([
    loadOrderLedgers(db, ids),
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
  for (const [id, l] of ledgers) {
    const b = out.get(id)!;
    b.orders = l.owed;
    b.credit += l.advance;
    b.unpaidOrders = l.unpaidOrders;
    b.oldestUnpaid = l.oldestUnpaid;
  }
  for (const r of bills) out.get(r.customer_id)!.bills = Number(r.due);
  for (const r of credits) out.get(r.customer_id)!.credit += Number(r.credit);
  for (const b of out.values()) b.due = b.orders + b.bills - b.credit;
  return out;
}
