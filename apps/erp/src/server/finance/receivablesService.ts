import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { RENT_SETTLEMENT_SQL } from "./financialDefinitions";
import { hasDeliveryOpsSchema, activeCollectionSql } from "../delivery/deliveryRules";
import { hasPayLaterSchema, hasDineInPayLaterSchema } from "../database/schemaFeatures";
import { acquireLedgerKeyLock, getBusinessDateString, recordRentPayment, assertClosingDateNotFinalized } from "./financeService";
import { recordTiffinPayment } from "../tiffin/tiffinBillingService";
import { recordDeliveryCollection } from "../delivery/deliveryService";
import { recordAuditEventAsync } from "../audit/audit";
import { AuthenticatedUser, PaymentMethod, normalizePaymentMethod } from "@/types";

/**
 * Finance → Receivables: who owes what, read from the records that already own each balance.
 * Nothing here stores a balance; every figure is computed from the source on each request.
 *
 *   PG        rent ledger (financial_transactions): posted RENT_CHARGE minus posted rent settlements
 *             (RENT_SETTLEMENT_SQL). Settlements are applied to the oldest charges first, so each
 *             unpaid charge keeps its own date for ageing.
 *   TIFFIN    tiffin invoices: balance_due of issued and partly paid invoices (it moves with valid
 *             allocations only), less payments not yet allocated to any invoice (a credit line), so
 *             the account equals the tiffin ledger (charges − customer payments).
 *   DELIVERY  delivered doorstep orders: delivered value (order lines) minus the delivery collections
 *             that still count (activeCollectionSql: a UPI collection whose cashbook entry was
 *             reversed no longer counts; cash always counts).
 *
 * Accounts are never merged by phone number: a resident (R:<id>) and a tiffin customer (C:<id>)
 * are different accounts even with the same number; tiffin invoices and delivery orders of one
 * customer share the customer's account. An order with no customer record is its own account
 * (O:<order id>).
 *
 * Ageing counts days since the amount became outstanding (charge date, invoice issue date, delivery
 * date). No overdue rule is applied: none is defined yet (decision D14).
 */

export type ReceivableSource = "PG" | "TIFFIN" | "DELIVERY";
export type AgeingBucket = "0_7" | "8_30" | "31_60" | "61_PLUS";

export interface ReceivableLine {
  source: ReceivableSource;
  accountKey: string;
  kind: "CHARGE" | "INVOICE" | "ORDER" | "UNALLOCATED" | "ADVANCE";
  refId: string;
  reference: string;
  description: string;
  date: string;
  dueDate: string | null;
  amount: number;
  paid: number;
  outstanding: number;
  status: "UNPAID" | "PARTIALLY_PAID" | "CREDIT";
  ageDays: number;
  bucket: AgeingBucket | null;
  paymentChoice: string | null;
  review: string | null;
  link: string;
}

export interface ReceivableAccount {
  accountKey: string;
  kind: "RESIDENT" | "CUSTOMER" | "ORDER";
  name: string;
  phone: string | null;
  place: string | null;
  pg: number;
  tiffin: number;
  delivery: number;
  total: number;
  oldestDate: string | null;
  ageDays: number | null;
  bucket: AgeingBucket | null;
  partiallyPaid: boolean;
  openItems: number;
  reviews: number;
  payLaterEnabled: boolean | null;
}

export interface ReceivablesQuery {
  source?: ReceivableSource | "ALL";
  q?: string;
  status?: "UNPAID" | "PARTIALLY_PAID" | "ALL";
  bucket?: AgeingBucket | "ALL";
  from?: string;
  to?: string;
  reviewOnly?: boolean;
  limit?: number;
  offset?: number;
  sort?: "total" | "oldest" | "name";
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const n = (v: unknown) => Number(v || 0);
const bucketSql = (age: string) =>
  `CASE WHEN ${age} <= 7 THEN '0_7' WHEN ${age} <= 30 THEN '8_30' WHEN ${age} <= 60 THEN '31_60' ELSE '61_PLUS' END`;

function requireReceivablesRead(actor: AuthenticatedUser) {
  requirePermission(actor, "finance.read");
}

/**
 * Every open receivable line, as SQL with one parameter list. `accountKey` narrows it to one account
 * (the account view and the payment dialog). Each line carries its account as kind + id
 * (R resident, C tiffin customer, O order without a customer record) so accounts join their names
 * on primary keys. For the whole list, order values and collections are summed once with grouped
 * aggregates; for one account, per-order lookups on the indexed keys are cheaper.
 * PostgreSQL only (window functions).
 */
async function linesSql(db: AsyncDb, today: string, accountKey?: string): Promise<{ sql: string; params: any[] }> {
  const ops = await hasDeliveryOpsSchema(db);
  const pay = await hasPayLaterSchema(db);
  const dine = await hasDineInPayLaterSchema(db);
  const activeDc = ops ? `AND ${activeCollectionSql("dc")}` : "";
  const age = (col: string) => `GREATEST(0, (DATE '${today}' - CAST(${col} AS date)))`;
  const params: any[] = [];
  let residentFilter = "";
  let customerFilter = "";
  let orderFilter = "";
  if (accountKey) {
    const [k, id] = [accountKey.slice(0, 1), accountKey.slice(2)];
    residentFilter = k === "R" ? "AND resident_id = ?" : "AND 1 = 0";
    customerFilter = k === "C" ? "AND i.customer_id = ?" : "AND 1 = 0";
    orderFilter = k === "C" ? "AND o.customer_id = ?" : k === "O" ? "AND o.id = ? AND o.customer_id IS NULL" : "AND 1 = 0";
    // Parameters follow the text order: pg_ch, pg_st, tf, tf_credit, od, then dn (dine-in Pay Later).
    if (k === "R") params.push(id, id);
    if (k === "C") params.push(id, id, id, ...(dine ? [id] : []));
    if (k === "O") params.push(id, ...(dine ? [id] : []));
  }
  const orderMoney = accountKey
    ? `(SELECT COALESCE(SUM(COALESCE(oi.delivered_quantity, oi.quantity) * oi.unit_price), 0) FROM order_items oi WHERE oi.order_id = o.id) AS due,
             (SELECT COALESCE(SUM(dc.amount), 0) FROM delivery_collections dc WHERE dc.delivery_task_id = o.delivery_task_id ${activeDc}) AS collected`
    : `d.due, COALESCE(cl.collected, 0) AS collected`;
  const orderJoins = accountKey
    ? ""
    : `JOIN (SELECT oi.order_id, SUM(COALESCE(oi.delivered_quantity, oi.quantity) * oi.unit_price) AS due FROM order_items oi GROUP BY oi.order_id) d ON d.order_id = o.id
       LEFT JOIN (SELECT dc.delivery_task_id, SUM(dc.amount) AS collected FROM delivery_collections dc WHERE 1 = 1 ${activeDc} GROUP BY dc.delivery_task_id) cl ON cl.delivery_task_id = o.delivery_task_id`;
  const sql = `
    WITH pg_ch AS (
      SELECT resident_id, id, transaction_date, amount, COALESCE(billing_period, '') AS billing_period, description,
             SUM(amount) OVER (PARTITION BY resident_id ORDER BY transaction_date, created_at, id) AS cum
      FROM financial_transactions
      WHERE transaction_type = 'RENT_CHARGE' AND status = 'POSTED' AND resident_id IS NOT NULL ${residentFilter}
    ),
    pg_st AS (
      SELECT resident_id, SUM(amount) AS settled
      FROM financial_transactions
      WHERE status = 'POSTED' AND resident_id IS NOT NULL AND ${RENT_SETTLEMENT_SQL} ${residentFilter}
      GROUP BY resident_id
    ),
    pg AS (
      SELECT 'PG' AS source, 'R' AS account_kind, c.resident_id AS account_id, 'CHARGE' AS kind, c.id AS ref_id,
             CASE WHEN c.billing_period <> '' THEN c.billing_period ELSE 'Rent charge' END AS reference,
             COALESCE(c.description, 'Rent charge') AS description,
             c.transaction_date AS date, NULL AS due_date, c.amount AS amount,
             c.amount - (c.cum - GREATEST(COALESCE(s.settled, 0), c.cum - c.amount)) AS paid,
             c.cum - GREATEST(COALESCE(s.settled, 0), c.cum - c.amount) AS outstanding,
             NULL AS payment_choice, NULL AS review,
             '/finance?tab=residents' AS link
      FROM pg_ch c LEFT JOIN pg_st s ON s.resident_id = c.resident_id
      WHERE c.cum > COALESCE(s.settled, 0)
    ),
    tf AS (
      SELECT 'TIFFIN' AS source, 'C' AS account_kind, i.customer_id AS account_id, 'INVOICE' AS kind, i.id AS ref_id,
             COALESCE(i.invoice_number, 'Draft') AS reference,
             'Invoice ' || COALESCE(i.invoice_number, '') || ' · ' || i.billing_period AS description,
             i.issue_date AS date, i.due_date AS due_date, i.total_amount AS amount, i.amount_paid AS paid,
             i.balance_due AS outstanding, NULL AS payment_choice, NULL AS review,
             '/finance?tab=invoices' AS link
      FROM invoices i
      WHERE i.invoice_category = 'TIFFIN' AND i.status IN ('ISSUED', 'PARTIALLY_PAID') AND i.balance_due > 0
        AND i.customer_id IS NOT NULL ${customerFilter}
    ),
    tf_credit AS (
      SELECT 'TIFFIN' AS source, 'C' AS account_kind, t.customer_id AS account_id, 'UNALLOCATED' AS kind, t.id AS ref_id,
             'Unallocated payment' AS reference,
             'Payment not yet allocated to an invoice (' || COALESCE(t.payment_method, '') || ')' AS description,
             t.transaction_date AS date, NULL AS due_date, t.amount AS amount, 0 AS paid,
             -(t.amount - COALESCE(a.allocated, 0)) AS outstanding,
             NULL AS payment_choice, NULL AS review,
             '/finance?tab=invoices' AS link
      FROM financial_transactions t
      LEFT JOIN (SELECT payment_transaction_id, SUM(amount) AS allocated FROM invoice_payment_allocations GROUP BY payment_transaction_id) a ON a.payment_transaction_id = t.id
      WHERE t.transaction_type = 'TIFFIN_PAYMENT' AND t.status = 'POSTED' AND t.customer_id IS NOT NULL
        AND t.amount > COALESCE(a.allocated, 0)
        ${customerFilter.replace("i.customer_id", "t.customer_id")}
    ),
    od AS (
      SELECT o.id, o.customer_id, o.service_date, o.meal_type, o.created_at,
             CASE WHEN o.customer_id IS NOT NULL THEN 'C' ELSE 'O' END AS account_kind,
             COALESCE(o.customer_id, o.id) AS account_id,
             ${pay ? "o.payment_choice, CASE WHEN o.payment_reviewed_at IS NULL THEN o.payment_review END AS review" : "NULL AS payment_choice, NULL AS review"},
             ${orderMoney}
      FROM orders o JOIN delivery_tasks t ON t.id = o.delivery_task_id AND t.status = 'DELIVERED'
      ${orderJoins}
      WHERE o.order_type = 'DELIVERY' AND o.status = 'COMPLETED' ${orderFilter}
    ),
    od_f AS (
      -- The delivered orders of a customer are one account (orderLedger): each order keeps what was
      -- paid for it; money paid beyond an order (advance, extra at the door) is credit that pays the
      -- orders still owing, oldest first. What is left is the advance.
      SELECT od.*,
             LEAST(od.due, od.collected) AS own_paid,
             od.due - LEAST(od.due, od.collected) AS short,
             SUM(GREATEST(0, od.collected - od.due)) OVER (PARTITION BY od.account_kind, od.account_id) AS surplus,
             SUM(od.due - LEAST(od.due, od.collected)) OVER (PARTITION BY od.account_kind, od.account_id) AS total_short,
             SUM(od.due - LEAST(od.due, od.collected)) OVER (PARTITION BY od.account_kind, od.account_id ORDER BY od.service_date, od.created_at, od.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_short
      FROM od
    ),
    od_p AS (
      SELECT od_f.*, od_f.own_paid + LEAST(od_f.short, GREATEST(0, od_f.surplus - (od_f.cum_short - od_f.short))) AS fifo_paid FROM od_f
    ),
    dl AS (
      SELECT 'DELIVERY' AS source, od.account_kind, od.account_id,
             'ORDER' AS kind, od.id AS ref_id,
             INITCAP(LOWER(od.meal_type)) || ' · ' || to_char(CAST(od.service_date AS date), 'DD Mon YYYY') AS reference,
             'Delivered order' AS description,
             od.service_date AS date, NULL AS due_date, od.due AS amount, od.fifo_paid AS paid, od.due - od.fifo_paid AS outstanding,
             od.payment_choice, od.review,
             '/delivery?tab=board&date=' || od.service_date || '&meal=' || od.meal_type AS link
      FROM od_p od WHERE od.due > od.fifo_paid
    ),
    dl_credit AS (
      -- Paid beyond every delivered order of the account: one credit line, used by the next orders.
      SELECT 'DELIVERY' AS source, od.account_kind, od.account_id,
             'ADVANCE' AS kind, MAX(od.id) AS ref_id,
             'Advance paid' AS reference,
             'Paid ahead at delivery; it pays the next orders' AS description,
             MAX(od.service_date) AS date, NULL AS due_date, MAX(od.surplus) - MAX(od.total_short) AS amount, 0 AS paid,
             -(MAX(od.surplus) - MAX(od.total_short)) AS outstanding,
             NULL AS payment_choice, NULL AS review,
             '/finance?tab=receivables' AS link
      FROM od_f od GROUP BY od.account_kind, od.account_id HAVING MAX(od.surplus) > MAX(od.total_short)
    ),
    ${dine ? `dn AS (
      -- Dine-in orders taken on Pay Later (migration 0024): owed in full until they are paid.
      SELECT 'DELIVERY' AS source, CASE WHEN o.customer_id IS NOT NULL THEN 'C' ELSE 'O' END AS account_kind,
             COALESCE(o.customer_id, o.id) AS account_id,
             'ORDER' AS kind, o.id AS ref_id,
             'Dine in · ' || INITCAP(LOWER(o.meal_type)) || ' · ' || to_char(CAST(o.service_date AS date), 'DD Mon YYYY') AS reference,
             'Dine-in order, Pay Later' AS description,
             o.service_date AS date, NULL AS due_date, o.total_amount AS amount, 0 AS paid, o.total_amount AS outstanding,
             o.payment_choice, NULL AS review,
             '/orders?date=' || o.service_date AS link
      FROM orders o
      WHERE o.order_type = 'DINE_IN' AND o.status <> 'CANCELLED' AND o.financial_transaction_id IS NULL AND o.payment_choice = 'PAY_LATER' AND o.total_amount > 0 ${orderFilter}
    ),` : ""}
    lines AS (
      SELECT * FROM pg UNION ALL SELECT * FROM tf UNION ALL SELECT * FROM tf_credit UNION ALL SELECT * FROM dl UNION ALL SELECT * FROM dl_credit${dine ? " UNION ALL SELECT * FROM dn" : ""}
    )
    SELECT l.*, l.account_kind || ':' || l.account_id AS account_key,
           ${age("l.date")} AS age_days,
           CASE WHEN l.outstanding > 0 THEN ${bucketSql(age("l.date"))} END AS bucket,
           CASE WHEN l.outstanding < 0 THEN 'CREDIT' WHEN l.paid > 0 THEN 'PARTIALLY_PAID' ELSE 'UNPAID' END AS status
    FROM lines l`;
  return { sql, params };
}

function mapLine(r: any): ReceivableLine {
  return {
    source: r.source,
    accountKey: r.account_key,
    kind: r.kind,
    refId: r.ref_id,
    reference: r.reference,
    description: r.description,
    date: r.date,
    dueDate: r.due_date || null,
    amount: n(r.amount),
    paid: n(r.paid),
    outstanding: n(r.outstanding),
    status: r.status,
    ageDays: n(r.age_days),
    bucket: r.bucket || null,
    paymentChoice: r.payment_choice || null,
    review: r.review || null,
    link: r.link,
  };
}

/**
 * Summary, ageing and one page of accounts in one query: the open lines are computed once
 * (PostgreSQL materialises a CTE used more than once), grouped per account, named on primary keys, filtered, and the page carries the
 * totals and ageing of every matching account (window and cross-joined aggregates).
 */
export async function listReceivables(actor: AuthenticatedUser, query: ReceivablesQuery = {}, asyncDb?: AsyncDb) {
  requireReceivablesRead(actor);
  const db = asyncDb ?? getAsyncDb();
  const today = getBusinessDateString(new Date());
  const pay = await hasPayLaterSchema(db);
  const { sql: base, params: baseParams } = await linesSql(db, today);

  const where: string[] = [];
  const params: any[] = [...baseParams];
  if (query.source && query.source !== "ALL") {
    where.push("x.source = ?");
    params.push(query.source);
  }
  if (query.status === "UNPAID" || query.status === "PARTIALLY_PAID") {
    where.push("x.status = ?");
    params.push(query.status);
  }
  if (query.bucket && query.bucket !== "ALL") {
    where.push("x.bucket = ?");
    params.push(query.bucket);
  }
  if (query.from && DATE.test(query.from)) {
    where.push("x.date >= ?");
    params.push(query.from);
  }
  if (query.to && DATE.test(query.to)) {
    where.push("x.date <= ?");
    params.push(query.to);
  }
  if (query.reviewOnly) where.push("x.review IS NOT NULL");
  const search = (query.q || "").trim().toLowerCase();
  const searchCond = search ? "WHERE (LOWER(name) LIKE ? OR COALESCE(phone, '') LIKE ? OR LOWER(COALESCE(place, '')) LIKE ?)" : "";
  if (search) params.push(`%${search}%`, `%${search.replace(/\s+/g, "")}%`, `%${search}%`);
  const order =
    query.sort === "oldest" ? "oldest ASC NULLS LAST, total DESC, account_key" : query.sort === "name" ? "LOWER(name) ASC, account_key" : "total DESC, oldest ASC, account_key";
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25));
  const offset = Math.max(0, Number(query.offset) || 0);

  const sql = `
    WITH f AS (
      SELECT * FROM (${base}) x${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
    ),
    acc AS (
      SELECT account_kind, account_id, MIN(account_key) AS account_key,
             SUM(CASE WHEN source = 'PG' THEN outstanding ELSE 0 END) AS pg,
             SUM(CASE WHEN source = 'TIFFIN' THEN outstanding ELSE 0 END) AS tiffin,
             SUM(CASE WHEN source = 'DELIVERY' THEN outstanding ELSE 0 END) AS delivery,
             SUM(outstanding) AS total,
             MIN(CASE WHEN outstanding > 0 THEN date END) AS oldest,
             BOOL_OR(status = 'PARTIALLY_PAID') AS partial,
             COUNT(*) FILTER (WHERE outstanding > 0) AS open_items,
             COUNT(*) FILTER (WHERE review IS NOT NULL) AS reviews
      FROM f GROUP BY account_kind, account_id
    ),
    named AS (
      SELECT acc.*,
             CASE acc.account_kind WHEN 'R' THEN 'RESIDENT' WHEN 'C' THEN 'CUSTOMER' ELSE 'ORDER' END AS kind,
             COALESCE(r.full_name, c.full_name, o.customer_name, '—') AS name,
             COALESCE(r.phone, c.phone, o.customer_phone) AS phone,
             (SELECT rm.room_number FROM resident_stays s JOIN rooms rm ON rm.id = s.room_id WHERE acc.account_kind = 'R' AND s.resident_id = acc.account_id AND s.status = 'ACTIVE' LIMIT 1) AS place,
             ${pay ? "c.pay_later_enabled" : "NULL"} AS pay_later_enabled
      FROM acc
      LEFT JOIN residents r ON acc.account_kind = 'R' AND r.id = acc.account_id
      LEFT JOIN tiffin_customers c ON acc.account_kind = 'C' AND c.id = acc.account_id
      LEFT JOIN orders o ON acc.account_kind = 'O' AND o.id = acc.account_id
    ),
    matched AS (SELECT * FROM named ${searchCond}),
    totals AS (
      SELECT COUNT(*) AS n, COALESCE(SUM(pg), 0) AS pg_sum, COALESCE(SUM(tiffin), 0) AS tiffin_sum, COALESCE(SUM(delivery), 0) AS delivery_sum,
             COALESCE(SUM(total), 0) AS total_sum, COUNT(*) FILTER (WHERE total > 0) AS owing, COALESCE(SUM(reviews), 0) AS reviews_sum
      FROM matched
    ),
    ageing AS (
      SELECT COALESCE(SUM(CASE WHEN f.bucket = '0_7' THEN f.outstanding END), 0) AS b0_7,
             COALESCE(SUM(CASE WHEN f.bucket = '8_30' THEN f.outstanding END), 0) AS b8_30,
             COALESCE(SUM(CASE WHEN f.bucket = '31_60' THEN f.outstanding END), 0) AS b31_60,
             COALESCE(SUM(CASE WHEN f.bucket = '61_PLUS' THEN f.outstanding END), 0) AS b61_plus,
             COALESCE(SUM(CASE WHEN f.status = 'CREDIT' THEN f.outstanding END), 0) AS credit
      FROM f ${search ? "JOIN matched m ON m.account_kind = f.account_kind AND m.account_id = f.account_id" : ""}
    ),
    page AS (SELECT * FROM matched ORDER BY ${order} LIMIT ${limit} OFFSET ${offset})
    SELECT t.*, a.*, p.* FROM totals t CROSS JOIN ageing a LEFT JOIN page p ON TRUE`;
  const rows = await db.query<any>(sql, params);
  const head = rows[0] ?? {};
  const pageRows = rows.filter((r) => r.account_key);

  const accounts: ReceivableAccount[] = pageRows.map((r) => {
    const ageDays = r.oldest ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.oldest}T00:00:00Z`)) / 86400000)) : null;
    return {
      accountKey: r.account_key,
      kind: r.kind,
      name: r.name,
      phone: r.phone || null,
      place: r.place || null,
      pg: n(r.pg),
      tiffin: n(r.tiffin),
      delivery: n(r.delivery),
      total: n(r.total),
      oldestDate: r.oldest || null,
      ageDays,
      bucket: ageDays === null ? null : ageDays <= 7 ? "0_7" : ageDays <= 30 ? "8_30" : ageDays <= 60 ? "31_60" : "61_PLUS",
      partiallyPaid: Boolean(r.partial),
      openItems: n(r.open_items),
      reviews: n(r.reviews),
      payLaterEnabled: r.pay_later_enabled === null || r.pay_later_enabled === undefined ? null : Number(r.pay_later_enabled) === 1,
    };
  });
  return {
    asOf: today,
    summary: {
      total: n(head.total_sum),
      bySource: { PG: n(head.pg_sum), TIFFIN: n(head.tiffin_sum), DELIVERY: n(head.delivery_sum) },
      ageing: { "0_7": n(head.b0_7), "8_30": n(head.b8_30), "31_60": n(head.b31_60), "61_PLUS": n(head.b61_plus) } as Record<AgeingBucket, number>,
      unallocatedCredit: n(head.credit),
      accountsOwing: n(head.owing),
      reviews: n(head.reviews_sum),
    },
    accounts,
    total: n(head.n),
    limit,
    offset,
  };
}

async function accountHeader(db: AsyncDb, accountKey: string) {
  const kind = accountKey.slice(0, 1);
  const id = accountKey.slice(2);
  const pay = await hasPayLaterSchema(db);
  if (kind === "R") {
    const r = await db.queryOne<any>(
      `SELECT r.id, r.full_name, r.phone, rm.room_number FROM residents r
       LEFT JOIN resident_stays s ON s.resident_id = r.id AND s.status = 'ACTIVE' LEFT JOIN rooms rm ON rm.id = s.room_id WHERE r.id = ?`,
      [id]
    );
    return r ? { accountKey, kind: "RESIDENT" as const, id, name: r.full_name, phone: r.phone, place: r.room_number || null, payLater: null } : null;
  }
  if (kind === "C") {
    const c = await db.queryOne<any>(
      `SELECT c.id, c.full_name, c.phone, c.delivery_address${pay ? ", c.pay_later_enabled, c.pay_later_updated_at, u.full_name AS pay_later_updated_by_name" : ""}
       FROM tiffin_customers c ${pay ? "LEFT JOIN staff_users u ON u.id = c.pay_later_updated_by" : ""} WHERE c.id = ?`,
      [id]
    );
    return c
      ? {
          accountKey, kind: "CUSTOMER" as const, id, name: c.full_name, phone: c.phone, place: c.delivery_address || null,
          payLater: pay ? { enabled: Number(c.pay_later_enabled) === 1, updatedAt: c.pay_later_updated_at || null, updatedBy: c.pay_later_updated_by_name || null } : null,
        }
      : null;
  }
  if (kind === "O") {
    const o = await db.queryOne<any>("SELECT id, customer_name, customer_phone, delivery_address FROM orders WHERE id = ? AND customer_id IS NULL", [id]);
    return o ? { accountKey, kind: "ORDER" as const, id, name: o.customer_name, phone: o.customer_phone || null, place: o.delivery_address || null, payLater: null } : null;
  }
  return null;
}

/** One account: its open lines (oldest first) and totals per source. */
export async function getReceivableAccount(actor: AuthenticatedUser, accountKey: string, asyncDb?: AsyncDb) {
  requireReceivablesRead(actor);
  const db = asyncDb ?? getAsyncDb();
  const header = await accountHeader(db, accountKey);
  if (!header) throw new Error("Account not found.");
  const today = getBusinessDateString(new Date());
  const { sql, params } = await linesSql(db, today, accountKey);
  const rows = await db.query<any>(`SELECT * FROM (${sql}) x ORDER BY x.date ASC, x.source`, params);
  const lines = rows.map(mapLine);
  const sum = (s?: ReceivableSource) => lines.filter((l) => !s || l.source === s).reduce((a, l) => a + l.outstanding, 0);
  return {
    account: header,
    asOf: today,
    totals: { PG: sum("PG"), TIFFIN: sum("TIFFIN"), DELIVERY: sum("DELIVERY"), total: sum() },
    lines,
  };
}

// ---------------------------------------------------------------------------
// Account statement: built from the source records each time (no statement ledger).
// ---------------------------------------------------------------------------

export interface StatementEntry {
  date: string;
  at: string;
  source: ReceivableSource;
  type: string;
  description: string;
  reference: string | null;
  charge: number;
  payment: number;
  /** A reversal or cancellation (signed: + raises the balance, − lowers it). */
  adjustment: number;
  /** The original row was later reversed: shown for history, its reversal appears on its own date. */
  reversedLater: boolean;
  method: string | null;
  balance: number;
  details?: Array<{ date: string; meal: string; boxes: number }>;
}

const istDate = (iso: string | null | undefined) => (iso ? getBusinessDateString(new Date(iso)) : "");

async function statementEvents(db: AsyncDb, accountKey: string): Promise<Omit<StatementEntry, "balance">[]> {
  const kind = accountKey.slice(0, 1);
  const id = accountKey.slice(2);
  const events: Omit<StatementEntry, "balance">[] = [];
  const ev = (e: Partial<Omit<StatementEntry, "balance">> & { date: string; at: string; source: ReceivableSource; type: string; description: string }) =>
    events.push({ reference: null, charge: 0, payment: 0, adjustment: 0, reversedLater: false, method: null, ...e });

  if (kind === "R") {
    const rows = await db.query<any>(
      `SELECT * FROM financial_transactions
       WHERE resident_id = ? AND (transaction_type = 'RENT_CHARGE' OR ${RENT_SETTLEMENT_SQL})
       ORDER BY transaction_date, created_at`,
      [id]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of rows) {
      const isCharge = r.transaction_type === "RENT_CHARGE";
      ev({
        date: r.transaction_date, at: r.created_at, source: "PG",
        type: isCharge ? "Rent charge" : r.category === "DEPOSIT_APPLICATION" ? "Deposit applied" : "Rent payment",
        description: r.description || (isCharge ? `Rent ${r.billing_period || ""}` : "Payment"),
        reference: r.billing_period || r.reference_number || null,
        charge: isCharge ? n(r.amount) : 0,
        payment: isCharge ? 0 : n(r.amount),
        reversedLater: r.status === "REVERSED",
        method: isCharge ? null : r.payment_method,
      });
    }
    if (byId.size) {
      const revs = await db.query<any>(
        `SELECT * FROM financial_transactions WHERE transaction_type = 'REVERSAL' AND reversal_of_id IN (${[...byId.keys()].map(() => "?").join(", ")})`,
        [...byId.keys()]
      );
      for (const v of revs) {
        const orig = byId.get(v.reversal_of_id);
        const wasCharge = orig.transaction_type === "RENT_CHARGE";
        ev({
          date: v.transaction_date, at: v.created_at, source: "PG", type: wasCharge ? "Charge reversed" : "Payment reversed",
          description: v.description || "Reversal", reference: orig.billing_period || null,
          adjustment: wasCharge ? -n(orig.amount) : n(orig.amount),
        });
      }
    }
  }

  if (kind === "C") {
    const rows = await db.query<any>(
      `SELECT t.*, i.invoice_number, i.cancelled_at AS invoice_cancelled_at, i.status AS invoice_status
       FROM financial_transactions t LEFT JOIN invoices i ON i.id = t.invoice_id
       WHERE t.customer_id = ? AND t.transaction_type IN ('TIFFIN_CHARGE', 'TIFFIN_PAYMENT')
       ORDER BY t.transaction_date, t.created_at`,
      [id]
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const revs = byId.size
      ? await db.query<any>(
          `SELECT * FROM financial_transactions WHERE transaction_type = 'REVERSAL' AND reversal_of_id IN (${[...byId.keys()].map(() => "?").join(", ")})`,
          [...byId.keys()]
        )
      : [];
    const reversalOf = new Map(revs.map((v) => [v.reversal_of_id, v]));
    const chargeInvoiceIds = rows.filter((r) => r.transaction_type === "TIFFIN_CHARGE" && r.invoice_id).map((r) => r.invoice_id);
    const days = new Map<string, Array<{ date: string; meal: string; boxes: number }>>();
    if (chargeInvoiceIds.length) {
      const ops = await hasDeliveryOpsSchema(db);
      const dayRows = await db.query<any>(
        `SELECT t.invoice_id, t.service_date, t.meal_type,
                ${ops ? "COALESCE((SELECT SUM(x.delivered_quantity) FROM delivery_task_items x WHERE x.task_id = t.id), s.quantity_per_meal, 1)" : "COALESCE(s.quantity_per_meal, 1)"} AS boxes
         FROM delivery_tasks t LEFT JOIN tiffin_subscriptions s ON s.id = t.subscription_id
         WHERE t.invoice_id IN (${chargeInvoiceIds.map(() => "?").join(", ")})
         ORDER BY t.service_date, t.meal_type`,
        chargeInvoiceIds
      );
      for (const d of dayRows) {
        const list = days.get(d.invoice_id) ?? [];
        list.push({ date: d.service_date, meal: d.meal_type, boxes: n(d.boxes) });
        days.set(d.invoice_id, list);
      }
    }
    for (const r of rows) {
      const isCharge = r.transaction_type === "TIFFIN_CHARGE";
      ev({
        date: r.transaction_date, at: r.created_at, source: "TIFFIN",
        type: isCharge ? "Tiffin invoice" : "Tiffin payment",
        description: isCharge ? `Invoice ${r.invoice_number || ""} · ${r.billing_period || ""}`.trim() : r.description || "Payment",
        reference: isCharge ? r.invoice_number || null : r.reference_number || null,
        charge: isCharge ? n(r.amount) : 0,
        payment: isCharge ? 0 : n(r.amount),
        reversedLater: r.status === "REVERSED",
        method: isCharge ? null : r.payment_method,
        details: isCharge && r.invoice_id ? days.get(r.invoice_id) : undefined,
      });
      if (r.status === "REVERSED") {
        const v = reversalOf.get(r.id);
        // A reversal row is the dated record; a tiffin charge withdrawn by cancelling its invoice has
        // none, so the invoice's cancellation date is used.
        const when = v ? { date: v.transaction_date, at: v.created_at } : { date: istDate(r.invoice_cancelled_at || r.updated_at), at: r.invoice_cancelled_at || r.updated_at };
        ev({
          ...when, source: "TIFFIN", type: isCharge ? (v ? "Charge reversed" : "Invoice cancelled") : "Payment reversed",
          description: v?.description || (isCharge ? `Invoice ${r.invoice_number || ""} cancelled` : "Reversal"),
          reference: isCharge ? r.invoice_number || null : null,
          adjustment: isCharge ? -n(r.amount) : n(r.amount),
        });
      }
    }
  }

  if ((kind === "C" || kind === "O") && (await hasDineInPayLaterSchema(db))) {
    const dine = await db.query<any>(
      `SELECT o.id, o.service_date, o.meal_type, o.total_amount, o.created_at, f.amount AS paid, f.transaction_date AS paid_on, f.created_at AS paid_at, f.payment_method AS paid_method, f.status AS paid_status
       FROM orders o LEFT JOIN financial_transactions f ON f.id = o.financial_transaction_id
       WHERE o.order_type = 'DINE_IN' AND o.payment_choice = 'PAY_LATER' AND o.status <> 'CANCELLED' AND ${kind === "C" ? "o.customer_id = ?" : "o.id = ? AND o.customer_id IS NULL"}`,
      [id]
    );
    for (const o of dine) {
      const label = `Dine in · ${String(o.meal_type).charAt(0)}${String(o.meal_type).slice(1).toLowerCase()} · ${o.service_date}`;
      ev({ date: o.service_date, at: o.created_at, source: "DELIVERY", type: "Dine-in order", description: "Dine-in order · Pay Later", reference: label, charge: n(o.total_amount) });
      if (o.paid_status === "POSTED") {
        ev({ date: o.paid_on, at: o.paid_at, source: "DELIVERY", type: "Order payment", description: "Payment for dine-in order", reference: label, payment: n(o.paid), method: o.paid_method });
      }
    }
  }
  if (kind === "C" || kind === "O") {
    const ops = await hasDeliveryOpsSchema(db);
    const pay = await hasPayLaterSchema(db);
    const orders = await db.query<any>(
      `SELECT o.id, o.service_date, o.meal_type, o.delivery_task_id, ${pay ? "o.payment_choice" : "NULL AS payment_choice"},
              (SELECT COALESCE(SUM(COALESCE(oi.delivered_quantity, oi.quantity) * oi.unit_price), 0) FROM order_items oi WHERE oi.order_id = o.id) AS due,
              t.delivered_at
       FROM orders o JOIN delivery_tasks t ON t.id = o.delivery_task_id AND t.status = 'DELIVERED'
       WHERE o.order_type = 'DELIVERY' AND o.status = 'COMPLETED' AND ${kind === "C" ? "o.customer_id = ?" : "o.id = ? AND o.customer_id IS NULL"}
       ORDER BY o.service_date`,
      [id]
    );
    const label = (o: any) => `${String(o.meal_type).charAt(0)}${String(o.meal_type).slice(1).toLowerCase()} · ${o.service_date}`;
    const choiceText = (c: string | null) => (c === "PAY_LATER" ? "Pay Later" : c === "UPI" ? "UPI" : c === "CASH" ? "Cash" : null);
    for (const o of orders) {
      ev({
        date: o.service_date, at: o.delivered_at || `${o.service_date}T00:00:00Z`, source: "DELIVERY", type: "Delivered order",
        description: `Delivered order${choiceText(o.payment_choice) ? ` · ${choiceText(o.payment_choice)}` : ""}`, reference: label(o),
        charge: n(o.due),
      });
    }
    if (orders.length) {
      const cols = await db.query<any>(
        `SELECT dc.*, ${ops ? "f.status AS entry_status, f.id AS entry_id" : "NULL AS entry_status, NULL AS entry_id"}
         FROM delivery_collections dc ${ops ? "LEFT JOIN financial_transactions f ON f.id = dc.transaction_id" : ""}
         WHERE dc.delivery_task_id IN (${orders.map(() => "?").join(", ")}) ORDER BY dc.collected_at`,
        orders.map((o) => o.delivery_task_id)
      );
      const orderOf = new Map(orders.map((o) => [o.delivery_task_id, o]));
      const reversedEntries = cols.filter((c) => c.entry_status === "REVERSED").map((c) => c.entry_id);
      const revs = reversedEntries.length
        ? await db.query<any>(
            `SELECT * FROM financial_transactions WHERE transaction_type = 'REVERSAL' AND reversal_of_id IN (${reversedEntries.map(() => "?").join(", ")})`,
            reversedEntries
          )
        : [];
      const revOf = new Map(revs.map((v) => [v.reversal_of_id, v]));
      for (const c of cols) {
        const o = orderOf.get(c.delivery_task_id);
        // What the money paid (migration 0022): this order, an earlier order (taken at a later stop),
        // or an advance. Either way it is one payment into the customer's account.
        const kindOf = c.allocation === "ADVANCE" ? "Advance paid" : c.allocation === "PREVIOUS_DUES" ? "Earlier dues paid" : "Order payment";
        const descOf =
          c.allocation === "ADVANCE"
            ? "Paid ahead at a delivery; it pays the next orders"
            : c.allocation === "PREVIOUS_DUES"
              ? "Paid at a later delivery for this order"
              : "Payment for delivered order";
        ev({
          date: istDate(c.collected_at), at: c.collected_at, source: "DELIVERY", type: kindOf,
          description: descOf, reference: o ? label(o) : null, payment: n(c.amount),
          method: c.payment_method, reversedLater: c.entry_status === "REVERSED",
        });
        if (c.entry_status === "REVERSED") {
          const v = revOf.get(c.entry_id);
          ev({
            date: v?.transaction_date || istDate(c.collected_at), at: v?.created_at || c.collected_at, source: "DELIVERY", type: "Payment reversed",
            description: v?.description || "Collection reversed", reference: o ? label(o) : null, adjustment: n(c.amount),
          });
        }
      }
    }
  }
  return events;
}

/**
 * Statement for one account over an optional date range: the opening balance is everything before
 * `from`, each entry carries a running balance, and the closing balance at today equals the
 * account's current outstanding (the same sources as Receivables). Reversed entries stay visible
 * and their reversal appears on its own date, so history and balance both hold.
 */
export async function getAccountStatement(actor: AuthenticatedUser, accountKey: string, range: { from?: string; to?: string } = {}, asyncDb?: AsyncDb) {
  requireReceivablesRead(actor);
  const db = asyncDb ?? getAsyncDb();
  const header = await accountHeader(db, accountKey);
  if (!header) throw new Error("Account not found.");
  const from = range.from && DATE.test(range.from) ? range.from : null;
  const to = range.to && DATE.test(range.to) ? range.to : null;
  const events = (await statementEvents(db, accountKey)).sort((a, b) => (a.date === b.date ? String(a.at).localeCompare(String(b.at)) : a.date.localeCompare(b.date)));
  const effect = (e: Omit<StatementEntry, "balance">) => e.charge - e.payment + e.adjustment;
  let opening = 0;
  const entries: StatementEntry[] = [];
  let running = 0;
  for (const e of events) {
    if (from && e.date < from) {
      opening += effect(e);
      continue;
    }
    if (to && e.date > to) continue;
    if (entries.length === 0) running = opening;
    running += effect(e);
    entries.push({ ...e, balance: running });
  }
  const closing = entries.length ? running : opening;
  const totals = entries.reduce(
    (t, e) => ({ charges: t.charges + e.charge, payments: t.payments + e.payment, adjustments: t.adjustments + e.adjustment }),
    { charges: 0, payments: 0, adjustments: 0 }
  );
  return { account: header, from, to, opening, closing, totals, entries };
}

// ---------------------------------------------------------------------------
// Receive payment for an account: each selected item goes through its own source's service
// (rent payment, tiffin payment + invoice allocation, delivery order collection), in one
// transaction, so either everything is recorded or nothing is.
// ---------------------------------------------------------------------------

export interface ReceivePaymentInput {
  accountKey: string;
  paymentMethod: PaymentMethod;
  transactionDate?: string;
  referenceNumber?: string;
  amountReceived: number;
  idempotencyKey: string;
  items: Array<{ source: ReceivableSource; refId: string; amount: number }>;
  notes?: string;
}

/** The same payment reference was already used for a different payment: nothing is recorded (409). */
export class PaymentKeyConflictError extends Error {
  statusCode = 409;
}

/**
 * What a payment reference already recorded: one row per item, found by the item keys
 * `<key>:<source>:<refId>` that receiveAccountPayment gives each source service. Rent and tiffin
 * items are ledger payments; delivery items are order collections.
 */
async function recordedUnderKey(tx: AsyncDb, key: string) {
  const like = `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}:%`;
  const ledger = await tx.query<{ idempotency_key: string; amount: number | string; payment_method: string | null; transaction_date: string; reference_number: string | null }>(
    "SELECT idempotency_key, amount, payment_method, transaction_date, reference_number FROM financial_transactions WHERE idempotency_key LIKE ? ESCAPE '\\' AND transaction_type IN ('RENT_PAYMENT', 'TIFFIN_PAYMENT')",
    [like]
  );
  const collections = await tx.query<{ idempotency_key: string; amount: number | string; payment_method: string | null }>(
    "SELECT idempotency_key, amount, payment_method FROM delivery_collections WHERE idempotency_key LIKE ? ESCAPE '\\'",
    [like]
  );
  const items = new Map<string, { amount: number; method: string | null; date: string | null; reference: string | null }>();
  const add = (k: string, sources: string[], row: { amount: number | string; payment_method: string | null }, date: string | null, reference: string | null) => {
    const m = /^([A-Z]+):([^:]+)$/.exec(k.slice(key.length + 1));
    if (m && sources.includes(m[1])) items.set(`${m[1]}:${m[2]}`, { amount: Number(row.amount), method: row.payment_method, date, reference });
  };
  for (const r of ledger) add(r.idempotency_key, ["PG", "TIFFIN", "DELIVERY"], r, r.transaction_date, r.reference_number || null);
  for (const r of collections) add(r.idempotency_key, ["DELIVERY"], r, null, null);
  return items;
}

export async function receiveAccountPayment(actor: AuthenticatedUser, input: ReceivePaymentInput, clientIp?: string, asyncDb?: AsyncDb) {
  // Owner and Manager (finance.record). Each source service checks its own rule again.
  requirePermission(actor, "finance.record", { ip: clientIp, action: "finance.account_payment_received" });
  if (!hasPermission(actor.role, "delivery.update") && input.items?.some((i) => i.source === "DELIVERY")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }
  const db = asyncDb ?? getAsyncDb();
  const key = String(input.idempotencyKey || "").trim();
  if (!key) throw new Error("A payment reference key is required.");
  const header = await accountHeader(db, input.accountKey);
  if (!header) throw new Error("Account not found.");
  const method = normalizePaymentMethod(input.paymentMethod);
  const date = input.transactionDate && DATE.test(input.transactionDate) ? input.transactionDate : getBusinessDateString(new Date());
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) throw new Error("Choose at least one balance to pay.");
  const seen = new Set<string>();
  for (const it of items) {
    if (!["PG", "TIFFIN", "DELIVERY"].includes(it.source)) throw new Error("Unknown balance type.");
    if (!Number.isInteger(Number(it.amount)) || Number(it.amount) <= 0) throw new Error("Each amount must be a whole number of rupees greater than 0.");
    const k = `${it.source}:${it.refId}`;
    if (seen.has(k)) throw new Error("The same balance is listed twice.");
    seen.add(k);
  }
  const total = items.reduce((a, it) => a + Number(it.amount), 0);
  if (Number(input.amountReceived) !== total) {
    throw new Error(`The amounts applied (₹${total.toLocaleString("en-IN")}) must equal the amount received (₹${Number(input.amountReceived || 0).toLocaleString("en-IN")}).`);
  }
  // The same order every time, so two payments touching the same records lock them alike.
  const ordered = [...items].sort((a, b) => `${a.source}:${a.refId}`.localeCompare(`${b.source}:${b.refId}`));
  const results: Array<{ source: ReceivableSource; refId: string; amount: number; recordId: string | null }> = [];

  await db.transaction(async (tx) => {
    await acquireLedgerKeyLock(tx, `receive:${key}`);
    // A reference already used must describe exactly the same payment: the same balances, amounts,
    // method, date and reference. A retry of that payment (double click, lost response) gets the
    // recorded payment back: every service below returns its existing record and no second audit
    // entry is written. Anything different is refused and the first payment stays as it was.
    const prior = await recordedUnderKey(tx, key);
    const replay = prior.size > 0;
    if (replay) {
      const reference = input.referenceNumber?.trim() || null;
      const changed: string[] = [];
      if (prior.size !== ordered.length || ordered.some((it) => prior.get(`${it.source}:${it.refId}`)?.amount !== Number(it.amount))) changed.push("balances or amounts");
      const kept = [...prior.values()];
      if (kept.some((p) => p.method !== method)) changed.push("method");
      if (kept.some((p) => p.date !== null && p.date !== date)) changed.push("date");
      if (kept.some((p) => p.date !== null && p.reference !== reference)) changed.push("reference");
      if (changed.length) {
        throw new PaymentKeyConflictError(
          `This payment was already recorded with different ${changed.join(", ")}. Nothing new was recorded and the first payment is unchanged. Close this window and check the account before recording another payment.`
        );
      }
    }
    for (const it of ordered) {
      const amount = Number(it.amount);
      const itemKey = `${key}:${it.source}:${it.refId}`;
      if (it.source === "PG") {
        if (header.kind !== "RESIDENT" || it.refId !== header.id) throw new Error("This rent balance does not belong to the account.");
        const t = await recordRentPayment(
          actor,
          { residentId: header.id, amount, transactionDate: date, paymentMethod: method, referenceNumber: input.referenceNumber?.trim() || undefined, idempotencyKey: itemKey, description: input.notes?.trim() || undefined } as any,
          clientIp,
          tx
        );
        results.push({ source: "PG", refId: it.refId, amount, recordId: t.id });
      } else if (it.source === "TIFFIN") {
        const inv = await tx.queryOne<{ customer_id: string | null; invoice_category: string }>("SELECT customer_id, invoice_category FROM invoices WHERE id = ?", [it.refId]);
        if (!inv || inv.invoice_category !== "TIFFIN" || header.kind !== "CUSTOMER" || inv.customer_id !== header.id) {
          throw new Error("This invoice does not belong to the account.");
        }
        const r = await recordTiffinPayment(
          actor,
          { customerId: header.id, amount, transactionDate: date, paymentMethod: method, referenceNumber: input.referenceNumber?.trim() || undefined, invoiceId: it.refId, idempotencyKey: itemKey, notes: input.notes } as any,
          clientIp,
          tx,
          { asAccountPayment: true }
        );
        results.push({ source: "TIFFIN", refId: it.refId, amount, recordId: r.transaction.id });
      } else if ((await tx.queryOne<{ n: number }>("SELECT 1 AS n FROM orders WHERE id = ? AND order_type = 'DINE_IN'", [it.refId])) !== null) {
        const o = await tx.queryOne<any>("SELECT * FROM orders WHERE id = ? FOR UPDATE", [it.refId]);
        const belongs = o && ((header.kind === "CUSTOMER" && o.customer_id === header.id) || (header.kind === "ORDER" && !o.customer_id && it.refId === header.id));
        if (!o || !belongs) throw new Error("This order does not belong to the account.");
        let txId: string | null = o.financial_transaction_id;
        if (txId) {
          const prior = await tx.queryOne<{ idempotency_key: string | null }>("SELECT idempotency_key FROM financial_transactions WHERE id = ?", [txId]);
          if (prior?.idempotency_key !== itemKey) throw new Error("This dine-in order is already paid.");
        } else {
          if (amount !== Number(o.total_amount)) {
            throw new Error(`A dine-in order is paid in full: ₹${Number(o.total_amount).toLocaleString("en-IN")}.`);
          }
          await assertClosingDateNotFinalized(tx, date, "TIFFIN");
          txId = `ftx_${crypto.randomUUID()}`;
          const nowIso = new Date().toISOString();
          await tx.execute(
            `INSERT INTO financial_transactions (
               id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, customer_id,
               stay_id, category, description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id,
               created_by, created_at, updated_at
             ) VALUES (?, 'TIFFIN_PAYMENT', ?, ?, ?, ?, NULL, NULL, NULL, 'TIFFIN_WALKIN_SALE', ?, NULL, NULL, ?, 'POSTED', NULL, ?, ?, ?)`,
            [txId, amount, date, method, input.referenceNumber?.trim() || null, `Dine-in Pay Later paid: ${o.customer_name} (${o.service_date})`, itemKey, actor.id, nowIso, nowIso]
          );
          await tx.execute("UPDATE orders SET financial_transaction_id = ?, payment_method = ?, updated_at = ? WHERE id = ?", [txId, method, nowIso, it.refId]);
        }
        results.push({ source: "DELIVERY", refId: it.refId, amount, recordId: txId });
      } else {
        const o = await tx.queryOne<{ customer_id: string | null; delivery_task_id: string }>("SELECT customer_id, delivery_task_id FROM orders WHERE id = ? AND order_type = 'DELIVERY'", [it.refId]);
        const belongs = o && ((header.kind === "CUSTOMER" && o.customer_id === header.id) || (header.kind === "ORDER" && !o.customer_id && it.refId === header.id));
        if (!o || !belongs) throw new Error("This order does not belong to the account.");
        await recordDeliveryCollection(actor, o.delivery_task_id, { collectedAmount: amount, paymentMethod: method, idempotencyKey: itemKey, notes: input.notes }, clientIp, tx);
        const c = await tx.queryOne<{ id: string }>("SELECT id FROM delivery_collections WHERE idempotency_key = ?", [itemKey]);
        results.push({ source: "DELIVERY", refId: it.refId, amount, recordId: c?.id ?? null });
      }
    }
    if (replay) return;
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "finance.account_payment_received",
        targetType: "receivable_account",
        targetId: input.accountKey,
        metadata: { idempotencyKey: key, paymentMethod: method, transactionDate: date, amountReceived: total, items: results },
        ipAddress: clientIp,
      },
      tx
    );
  });

  return { accountKey: input.accountKey, amountReceived: total, paymentMethod: method, results, account: await getReceivableAccount(actor, input.accountKey, db) };
}
