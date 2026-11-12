import { AsyncDb } from "../database/db";
import { loadOrderLedgers } from "../delivery/orderLedger";
import { hasDineInPayLaterSchema } from "../database/schemaFeatures";

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
  const ids = Array.from(new Set(customerIds.filter(Boolean)));
  if (ids.length === 0 || !db.isPostgres) return new Map();
  const raw = await fetchBalanceRows(db, { sql: ids.map(() => "?").join(", "), params: ids });
  return buildBalances(raw, ids);
}

/**
 * The same balances for customers chosen by a subquery (e.g. one page of the customer list), so
 * they load in the same round trip as the page itself. Call the result with the page's ids.
 */
export function loadCustomerBalancesFor(db: AsyncDb, customers: { sql: string; params: any[] }): Promise<(ids: string[]) => Map<string, CustomerBalance>> {
  if (!db.isPostgres) return Promise.resolve(() => new Map());
  return fetchBalanceRows(db, customers).then((raw) => (ids: string[]) => buildBalances(raw, Array.from(new Set(ids.filter(Boolean)))));
}

type BalanceRows = {
  ledgers: Awaited<ReturnType<typeof loadOrderLedgers>>;
  bills: Array<{ customer_id: string; due: number | string }>;
  credits: Array<{ customer_id: string; credit: number | string }>;
  dine: Array<{ customer_id: string; owed: number | string; n: number | string; oldest: string | null }>;
};

async function fetchBalanceRows(db: AsyncDb, customers: { sql: string; params: any[] }): Promise<BalanceRows> {
  const marks = customers.sql;
  const ids = customers.params;
  // Delivered orders: one pool of payments applied oldest first (orderLedger), so an advance paid at
  // the door pays the next orders and an order covered by credit is not counted as unpaid.
  const [ledgers, bills, credits, dine] = await Promise.all([
    loadOrderLedgers(db, [], { customerSql: customers }),
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
    // Dine-in orders on Pay Later, not paid yet (migration 0024).
    hasDineInPayLaterSchema(db).then((ok) =>
      ok
        ? db.query<{ customer_id: string; owed: number | string; n: number | string; oldest: string | null }>(
            `SELECT customer_id, SUM(total_amount) AS owed, COUNT(*) AS n, MIN(service_date) AS oldest FROM orders
             WHERE order_type = 'DINE_IN' AND payment_choice = 'PAY_LATER' AND financial_transaction_id IS NULL AND status <> 'CANCELLED' AND customer_id IN (${marks})
             GROUP BY customer_id`,
            ids
          )
        : []
    ),
  ]);
  return { ledgers, bills, credits, dine };
}

function buildBalances(raw: BalanceRows, ids: string[]): Map<string, CustomerBalance> {
  const out = new Map<string, CustomerBalance>();
  const { ledgers, bills, credits, dine } = raw;
  for (const id of ids) out.set(id, { due: 0, orders: 0, bills: 0, credit: 0, unpaidOrders: 0, oldestUnpaid: null });
  for (const [id, l] of ledgers) {
    const b = out.get(id);
    if (!b) continue;
    b.orders = l.owed;
    b.credit += l.advance;
    b.unpaidOrders = l.unpaidOrders;
    b.oldestUnpaid = l.oldestUnpaid;
  }
  for (const r of dine) {
    const b = out.get(r.customer_id);
    if (!b) continue;
    b.orders += Number(r.owed);
    b.unpaidOrders += Number(r.n);
    if (r.oldest && (!b.oldestUnpaid || r.oldest < b.oldestUnpaid)) b.oldestUnpaid = r.oldest;
  }
  for (const r of bills) {
    const b = out.get(r.customer_id);
    if (b) b.bills = Number(r.due);
  }
  for (const r of credits) {
    const b = out.get(r.customer_id);
    if (b) b.credit += Number(r.credit);
  }
  for (const b of out.values()) b.due = b.orders + b.bills - b.credit;
  return out;
}
