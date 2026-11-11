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

/** Migration 0024 is installed: a dine-in order may be Pay Later (no ledger entry until paid). */
let dineInPayLater: boolean | null = null;
let dineInCheckedAt = 0;
export async function hasDineInPayLaterSchema(db: AsyncDb): Promise<boolean> {
  if (dineInPayLater) return true;
  if (!db.isPostgres) return false;
  if (dineInPayLater === false && Date.now() - dineInCheckedAt < 60_000) return false;
  const row = await db.queryOne<{ d: string | null }>("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'chk_orders_links' LIMIT 1");
  dineInCheckedAt = Date.now();
  dineInPayLater = Boolean(row?.d && row.d.includes("PAY_LATER"));
  return dineInPayLater;
}

/** Migration 0025 is installed: a dine-in meal fully covered by a monthly plan (total 0, no ledger entry). */
let planDineIn: boolean | null = null;
let planDineInCheckedAt = 0;
export async function hasPlanDineInSchema(db: AsyncDb): Promise<boolean> {
  if (planDineIn) return true;
  if (!db.isPostgres) return false;
  if (planDineIn === false && Date.now() - planDineInCheckedAt < 60_000) return false;
  const row = await db.queryOne<{ d: string | null }>("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'chk_orders_links' LIMIT 1");
  planDineInCheckedAt = Date.now();
  planDineIn = Boolean(row?.d && row.d.includes("total_amount"));
  return planDineIn;
}

/** Migration 0026 is installed: a one-thali plan may be taken at any meal (meal_types ANY). */
let anyMeal: boolean | null = null;
let anyMealCheckedAt = 0;
export async function hasAnyMealPlanSchema(db: AsyncDb): Promise<boolean> {
  if (anyMeal) return true;
  if (!db.isPostgres) return false;
  if (anyMeal === false && Date.now() - anyMealCheckedAt < 60_000) return false;
  const row = await db.queryOne<{ d: string | null }>("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'chk_tiffin_sub_meal_types' LIMIT 1");
  anyMealCheckedAt = Date.now();
  anyMeal = Boolean(row?.d && row.d.includes("'ANY'"));
  return anyMeal;
}

/** Migration 0023 is installed: readable tiffin customer codes (TC-0001). */
export const hasCustomerCodeSchema = (db: AsyncDb) => hasColumn(db, "tiffin_customers", "customer_code");

/** Migration 0027 is installed: bills kept as documents, and the bill a payment was made against. */
export const hasBillsSchema = (db: AsyncDb) => hasColumn(db, "bills", "share_token");
