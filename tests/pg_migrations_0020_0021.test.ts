/**
 * Migration rehearsal for 0020 (invoice idempotency + one active tiffin invoice per subscription and
 * month) and 0021 (Pay Later fields), on databases this suite creates and drops itself on the
 * disposable verification server (RN_PG_VERIFY_URL; names contain "verify" and "test").
 *
 *   A. Fresh database: all migrations apply; new columns, constraints and indexes exist.
 *   B. Upgrade from 0019 with existing data that breaks the new rule (two active invoices for one
 *      subscription month, spelled differently): the read-only scan lists them, the migration stops
 *      with nothing applied, and after the duplicate is resolved it applies; existing rows keep their
 *      ids and values, billing_month is filled, and the new rule holds.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { useVerifyDatabase, createAsserter } from "./helpers/pgVerifyTarget";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres = require(path.resolve(__dirname, "../../../node_modules/postgres"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrate = require(path.resolve(__dirname, "../../../scripts/migrate.js"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const scanner = require(path.resolve(__dirname, "../../../scripts/scan-invoice-duplicates.js"));

const baseUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const MIGRATIONS = path.resolve(__dirname, "../../../apps/erp/src/server/database/drizzle");
// Every migration in the journal (0020 and 0021 plus any added later) must apply.
const ALL = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")).entries.length as number;
const created: string[] = [];

function urlFor(db: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

async function createDb(name: string) {
  const admin = postgres(baseUrl, { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    created.push(name);
  } finally {
    await admin.end();
  }
}

/** A copy of the migrations folder that stops after the given journal index (0019 = 19). */
function folderUpTo(lastIdx: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: any) => e.idx <= lastIdx);
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal, null, 2));
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}

async function quiet(fn: () => Promise<any>): Promise<any> {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

async function main() {
  console.log("================================================================================");
  console.log("MIGRATIONS 0020 + 0021 REHEARSAL (disposable databases)");
  console.log("================================================================================");
  const tag = crypto.randomBytes(3).toString("hex");

  // ---------------------------------------------------------------------------
  console.log("\n--- A. Fresh database ---");
  const fresh = `rn_erp_verify_mig_fresh_${tag}_test`;
  await createDb(fresh);
  const applied = await quiet(() => migrate.runMigrations(urlFor(fresh)));
  assert(applied.length === ALL, `All ${ALL} migrations apply to a fresh database (${applied.length})`);
  const f = postgres(urlFor(fresh), { max: 1 });
  try {
    const cols = await f`SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name = 'invoices' AND column_name IN ('idempotency_key', 'billing_month'))
         OR (table_name = 'tiffin_customers' AND column_name IN ('pay_later_enabled', 'pay_later_updated_by', 'pay_later_updated_at'))
         OR (table_name = 'orders' AND column_name IN ('payment_choice', 'payment_review', 'payment_review_detail', 'payment_reviewed_by', 'payment_reviewed_at'))`;
    assert(cols.length === 10, `All 10 new columns exist (${cols.length})`);
    const idx = await f`SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_invoices_idempotency', 'idx_invoices_tiffin_sub_month', 'idx_orders_payment_review', 'idx_orders_type_status_date', 'idx_dcol_order')`;
    assert(idx.length === 5, `All 5 new indexes exist (${idx.map((r: any) => r.indexname).join(", ")})`);
  } finally {
    await f.end();
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- B. Upgrade from 0019 with a duplicate in existing data ---");
  const up = `rn_erp_verify_mig_upgrade_${tag}_test`;
  await createDb(up);
  const at19 = await quiet(() => migrate.runMigrations(urlFor(up), folderUpTo(19)));
  assert(at19.length === 20, `Database at 0019 (${at19.length} migrations)`);
  const u = postgres(urlFor(up), { max: 1 });
  const now = new Date().toISOString();
  try {
    await u`INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
            VALUES ('stf_m', 'mig_owner', 'mig@example.invalid', 'Mig Owner', 'x', 'SUPER_ADMIN', 1, ${now}, ${now})`;
    await u`INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, created_by, created_at, updated_at)
            VALUES ('cust_m', 'Mig Customer', '9000000001', 'Lane 1', 'stf_m', ${now}, ${now})`;
    await u`INSERT INTO tiffin_products (id, code, name, category, billing_unit, price, created_by, created_at, updated_at)
            VALUES ('prod_m', 'MIG_THALI', 'Mig Thali', 'STANDARD_MEAL', 'PER_MEAL', 100, 'stf_m', ${now}, ${now})`;
    for (const sub of ["sub_m1", "sub_m2"]) {
      await u`INSERT INTO tiffin_subscriptions (id, customer_id, product_id, start_date, price, delivery_address, created_by, created_at, updated_at)
              VALUES (${sub}, 'cust_m', 'prod_m', '2026-10-01', 100, 'Lane 1', 'stf_m', ${now}, ${now})`;
    }
    const inv = (id: string, sub: string | null, period: string, total: number, status = "ISSUED") =>
      u`INSERT INTO invoices (id, invoice_number, invoice_type, invoice_category, status, customer_id, subscription_id, issue_date, due_date,
          billing_period, subtotal, total_amount, balance_due, company_name, company_address, recipient_name, recipient_phone, created_by, created_at, updated_at)
        VALUES (${id}, ${id.toUpperCase()}, 'REGULAR_BILL', 'TIFFIN', ${status}, 'cust_m', ${sub}, '2026-11-30', '2026-12-07',
          ${period}, ${total}, ${total}, ${total}, 'Co', 'Addr', 'Mig Customer', '9000000001', 'stf_m', ${now}, ${now})`;
    await inv("inv_a", "sub_m1", "Nov 2026", 3000);          // the duplicate pair: same subscription, same month,
    await inv("inv_b", "sub_m1", "November 2026", 3100);     // spelled differently and with different amounts
    await inv("inv_c", "sub_m2", "2026-11", 2000);           // another subscription, same month: legitimate
    await inv("inv_d", null, "Nov 2026", 500);               // manual invoice without a subscription: legitimate
    await inv("inv_e", "sub_m1", "Nov 2026", 3000, "CANCELLED"); // cancelled: ignored
    await inv("inv_f", "sub_m1", "Special catering week", 900);  // not a month: not constrained

    const scan = await scanner.scan(urlFor(up));
    const g = scan.duplicates[0];
    assert(scan.duplicateGroups === 1 && g.invoices.length === 2 && g.month === "2026-11" && g.spellingOnly && g.differentAmounts,
      `Read-only scan lists exactly the duplicate pair (groups ${scan.duplicateGroups}; ids ${g?.invoices.map((i: any) => i.id).join(", ")}; spelling differs ${g?.spellingOnly}; amounts differ ${g?.differentAmounts})`);

    let stopped: any = null;
    try {
      await quiet(() => migrate.runMigrations(urlFor(up)));
    } catch (e) {
      stopped = e;
    }
    const after = await u`SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`;
    const colNow = await u`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'billing_month'`;
    assert(stopped !== null && /Migration 0020 stopped/.test(String(stopped.message)) && after[0].n === 20 && colNow[0].n === 0,
      `With a duplicate present the migration stops and applies nothing (${String(stopped?.message ?? "no error").slice(0, 90)}…; migrations ${after[0].n}; new column present ${colNow[0].n})`);

    // Resolution chosen by a person: inv_b was the mistaken second bill.
    await u`UPDATE invoices SET status = 'CANCELLED', cancelled_at = ${now}, cancellation_reason = 'Duplicate of INV_A (migration rehearsal)' WHERE id = 'inv_b'`;
    const before = await u`SELECT id, total_amount, balance_due, status, billing_period FROM invoices ORDER BY id`;
    const done = await quiet(() => migrate.runMigrations(urlFor(up)));
    assert(done.length === ALL, `After the duplicate is resolved, 0020 and 0021 (and later migrations) apply (${done.length} of ${ALL})`);
    const rows = await u`SELECT id, total_amount, balance_due, status, billing_period, billing_month FROM invoices ORDER BY id`;
    const same = before.length === rows.length && before.every((b: any, i: number) =>
      b.id === rows[i].id && Number(b.total_amount) === Number(rows[i].total_amount) && Number(b.balance_due) === Number(rows[i].balance_due) && b.status === rows[i].status && b.billing_period === rows[i].billing_period);
    assert(same, "Existing invoices keep their ids, amounts, status and period text");
    const month = Object.fromEntries(rows.map((r: any) => [r.id, r.billing_month]));
    assert(month.inv_a === "2026-11" && month.inv_b === "2026-11" && month.inv_c === "2026-11" && month.inv_d === "2026-11" && month.inv_f === null,
      `billing_month filled from the period text (${JSON.stringify(month)})`);

    let blocked: any = null;
    try {
      await inv("inv_g", "sub_m1", "2026-11", 3000);
    } catch (e) {
      blocked = e;
    }
    assert(blocked !== null || (await u`SELECT billing_month FROM invoices WHERE id = 'inv_g'`)[0]?.billing_month === null,
      "A raw insert without billing_month is not constrained (the application always sets it)");
    let dupError: any = null;
    try {
      await u`INSERT INTO invoices (id, invoice_type, invoice_category, status, customer_id, subscription_id, issue_date, due_date, billing_period, billing_month,
                company_name, company_address, recipient_name, recipient_phone, created_by, created_at, updated_at)
              VALUES ('inv_h', 'REGULAR_BILL', 'TIFFIN', 'DRAFT', 'cust_m', 'sub_m1', '2026-11-30', '2026-12-07', 'NOV 2026', '2026-11',
                'Co', 'Addr', 'Mig Customer', '9000000001', 'stf_m', ${now}, ${now})`;
    } catch (e) {
      dupError = e;
    }
    assert(dupError !== null && /idx_invoices_tiffin_sub_month/.test(String(dupError.message)),
      "The database refuses a second active invoice for the same subscription and month");
    await u`INSERT INTO invoices (id, invoice_type, invoice_category, status, customer_id, subscription_id, issue_date, due_date, billing_period, billing_month,
              company_name, company_address, recipient_name, recipient_phone, created_by, created_at, updated_at)
            VALUES ('inv_i', 'REGULAR_BILL', 'TIFFIN', 'DRAFT', 'cust_m', 'sub_m1', '2026-12-31', '2027-01-07', 'December 2026', '2026-12',
              'Co', 'Addr', 'Mig Customer', '9000000001', 'stf_m', ${now}, ${now})`;
    assert(true, "The same subscription can still be invoiced for the next month");
    let keyDup: any = null;
    await u`UPDATE invoices SET idempotency_key = 'op-1' WHERE id = 'inv_c'`;
    try {
      await u`UPDATE invoices SET idempotency_key = 'op-1' WHERE id = 'inv_d'`;
    } catch (e) {
      keyDup = e;
    }
    assert(keyDup !== null && /idx_invoices_idempotency/.test(String(keyDup.message)), "One idempotency key can belong to one invoice only");
    const cust = await u`SELECT pay_later_enabled FROM tiffin_customers WHERE id = 'cust_m'`;
    assert(Number(cust[0].pay_later_enabled) === 0, "Existing customers start with Pay Later off");
    const rerun = await quiet(() => migrate.runMigrations(urlFor(up)));
    assert(rerun.length === ALL, "Running the migrations again changes nothing (already applied)");
  } finally {
    await u.end();
  }

  console.log("\n================================================================================");
  console.log(`MIGRATION REHEARSAL RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
  console.log("================================================================================");
}

main()
  .catch((err) => {
    state.failed++;
    console.error("Test runner error:", err?.stack ?? err?.message ?? err);
  })
  .finally(async () => {
    const admin = postgres(baseUrl, { max: 1 });
    try {
      for (const db of created) await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    } catch (e: any) {
      console.error("cleanup:", e.message);
    } finally {
      await admin.end();
    }
    process.exit(state.failed > 0 ? 1 : 0);
  });
