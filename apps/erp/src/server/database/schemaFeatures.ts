import { AsyncDb } from "./db";

/**
 * Optional schema features (migrations that the code can run without). Code paths that read or
 * write columns from these migrations check here first, so a database that has not been migrated
 * yet keeps working with the feature switched off instead of failing. A feature found present is
 * remembered for the life of the process; an absent one is checked again after a minute (the same
 * pattern as hasDeliveryOpsSchema).
 *
 *   0020 invoice idempotency: invoices.idempotency_key, invoices.billing_month
 *   0021 Pay Later:           tiffin_customers.pay_later_*, orders.payment_choice / payment_review*
 */
const present = new Set<string>();
const checkedAt = new Map<string, number>();

async function hasColumn(db: AsyncDb, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  if (present.has(key)) return true;
  if (Date.now() - (checkedAt.get(key) ?? 0) < 60_000) return false;
  const row = db.isPostgres
    ? await db.queryOne<{ ok: number }>(
        "SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?",
        [table, column]
      )
    : await db.queryOne<{ ok: number }>(`SELECT 1 AS ok FROM pragma_table_info('${table.replace(/[^a-z_]/g, "")}') WHERE name = ?`, [column]);
  checkedAt.set(key, Date.now());
  if (row) present.add(key);
  return Boolean(row);
}

/** Migration 0020 (invoice idempotency and canonical billing month) is installed. */
export const hasInvoiceIdempotencySchema = (db: AsyncDb) => hasColumn(db, "invoices", "billing_month");

/** Migration 0021 (Pay Later eligibility and the payment choice on orders) is installed. */
export const hasPayLaterSchema = (db: AsyncDb) => hasColumn(db, "orders", "payment_review");

/**
 * Migration 0022 is installed: handover shortfalls (recorded vs physically handed over cash, Owner
 * write-off) and door payments allocated to the order, earlier orders or an advance.
 */
export const hasCashShortfallSchema = (db: AsyncDb) => hasColumn(db, "driver_cash_handovers", "recorded_cash");
