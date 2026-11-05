/**
 * scripts/scan-invoice-duplicates.js: exit 0 only for a complete scan with no conflicting group,
 * 2 for duplicates, 1 for a failed or incomplete scan; read-only; no credentials in its output.
 * The script is run as a child process (its real output and exit code) against databases this suite
 * creates and drops on the disposable verification server (RN_PG_VERIFY_URL).
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { canonicalBillingMonth } from "../apps/erp/src/server/finance/billingPeriod";
import { useVerifyDatabase, createAsserter } from "./helpers/pgVerifyTarget";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres = require(path.resolve(__dirname, "../../../node_modules/postgres"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrate = require(path.resolve(__dirname, "../../../scripts/migrate.js"));
const SCRIPT = path.resolve(__dirname, "../../../scripts/scan-invoice-duplicates.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const scanner = require(SCRIPT);

const baseUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const MIGRATIONS = path.resolve(__dirname, "../../../apps/erp/src/server/database/drizzle");
const tag = crypto.randomBytes(3).toString("hex");
const dataDb = `rn_erp_verify_scan_${tag}_test`;
const emptyDb = `rn_erp_verify_scanempty_${tag}_test`;

function urlFor(db: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
}
function folderUpTo(lastIdx: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-scan-mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: any) => e.idx <= lastIdx);
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal, null, 2));
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}
function run(url: string) {
  const r = spawnSync(process.execPath, [SCRIPT, url], { encoding: "utf8" });
  const text = `${r.stdout || ""}${r.stderr || ""}`.trim();
  const last = text.split(/\r?\n/).filter(Boolean).pop() || "";
  return { code: r.status, text, last };
}
function show(label: string, r: { code: number | null; last: string }) {
  console.log(`  [${label}] exit ${r.code}: ${r.last}`);
}

async function main() {
  console.log("================================================================================");
  console.log("DUPLICATE INVOICE SCAN: exit codes, read-only, no credentials");
  console.log("================================================================================");
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${dataDb}"`);
  await admin.unsafe(`CREATE DATABASE "${emptyDb}"`);
  await admin.end();
  const log = console.log;
  console.log = () => {};
  await migrate.runMigrations(urlFor(dataDb), folderUpTo(19)); // as production is before 0020: no unique index yet
  console.log = log;
  const u = postgres(urlFor(dataDb), { max: 1, onnotice: () => {} });
  try {
    const now = new Date().toISOString();
    await u`INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
            VALUES ('stf_s', ${`scan_${tag}`}, ${`scan_${tag}@example.invalid`}, 'Scan Staff', 'x', 'SUPER_ADMIN', 1, ${now}, ${now})`;
    for (const c of ["cust_s1", "cust_s2"]) {
      await u`INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, created_by, created_at, updated_at)
              VALUES (${c}, ${`Scan ${c}`}, ${`9${crypto.randomInt(100000000, 999999999)}`}, 'Lane', 'stf_s', ${now}, ${now})`;
    }
    await u`INSERT INTO tiffin_products (id, code, name, category, billing_unit, price, created_by, created_at, updated_at)
            VALUES ('prod_s', ${`SCAN_${tag}`.toUpperCase()}, 'Scan Thali', 'STANDARD_MEAL', 'PER_MEAL', 100, 'stf_s', ${now}, ${now})`;
    for (const [sub, c] of [["sub_s1", "cust_s1"], ["sub_s2", "cust_s1"], ["sub_s3", "cust_s2"]]) {
      await u`INSERT INTO tiffin_subscriptions (id, customer_id, product_id, start_date, price, delivery_address, created_by, created_at, updated_at)
              VALUES (${sub}, ${c}, 'prod_s', '2041-01-01', 100, 'Lane', 'stf_s', ${now}, ${now})`;
    }
    const inv = (id: string, cust: string, sub: string | null, period: string, total: number, status = "ISSUED") =>
      u`INSERT INTO invoices (id, invoice_number, invoice_type, invoice_category, status, customer_id, subscription_id, issue_date, due_date,
          billing_period, subtotal, total_amount, balance_due, company_name, company_address, recipient_name, recipient_phone, created_by, created_at, updated_at)
        VALUES (${id}, ${id.toUpperCase()}, 'REGULAR_BILL', 'TIFFIN', ${status}, ${cust}, ${sub}, '2041-11-30', '2041-12-07',
          ${period}, ${total}, ${total}, ${total}, 'Co', 'Addr', 'Scan Customer', '9000000001', 'stf_s', ${now}, ${now})`;
    // Legitimate invoices only: other subscription, other month, manual, cancelled, non-month period.
    await inv("inv_ok1", "cust_s1", "sub_s1", "Nov 2041", 3000);
    await inv("inv_ok2", "cust_s1", "sub_s2", "November 2041", 3000);
    await inv("inv_ok3", "cust_s1", "sub_s1", "2041-12", 3000);
    await inv("inv_ok4", "cust_s1", null, "Nov 2041", 500);
    await inv("inv_ok5", "cust_s1", "sub_s1", "November 2041", 3000, "CANCELLED");
    await inv("inv_ok6", "cust_s1", "sub_s1", "Special catering week", 900);
    await inv("inv_ok7", "cust_s2", "sub_s3", "Nov 2041", 3000);

    console.log("\n--- 1. Zero duplicates ---");
    const r1 = run(urlFor(dataDb));
    show("zero", r1);
    const j1 = JSON.parse(r1.text.slice(0, r1.text.lastIndexOf("}") + 1));
    assert(r1.code === 0 && /^RESULT: NO DUPLICATES - scanned 5 active subscription invoice\(s\) completely/.test(r1.last) && j1.complete === true && j1.duplicateGroups === 0,
      "Complete scan, legitimate invoices only (other subscription, other month, manual, cancelled, non-month): exit 0, NO DUPLICATES");

    console.log("\n--- 2. One duplicate group ---");
    await inv("inv_d1", "cust_s1", "sub_s1", "NOV 2041", 3100); // same subscription and month as inv_ok1, other spelling and amount
    const r2 = run(urlFor(dataDb));
    show("one group", r2);
    const j2 = JSON.parse(r2.text.slice(0, r2.text.lastIndexOf("}") + 1));
    const g = j2.duplicates[0];
    assert(r2.code === 2 && /^RESULT: DUPLICATES FOUND - 1 group\(s\), 1 subscription\(s\), 2 invoice\(s\)/.test(r2.last) && g.month === "2041-11" && g.spellingOnly && g.differentAmounts
      && g.invoices.map((i: any) => i.id).sort().join(",") === "inv_d1,inv_ok1",
      "One group (\"Nov 2041\" ₹3,000 and \"NOV 2041\" ₹3,100): exit 2, the pair listed by id with spelling and amount flags");

    console.log("\n--- 3. Multiple duplicate groups ---");
    await inv("inv_d2", "cust_s2", "sub_s3", "November 2041", 3000);
    await inv("inv_d3", "cust_s2", "sub_s3", "11/2041", 3000, "DRAFT");
    const r3 = run(urlFor(dataDb));
    show("several groups", r3);
    assert(r3.code === 2 && /^RESULT: DUPLICATES FOUND - 2 group\(s\), 2 subscription\(s\), 5 invoice\(s\)/.test(r3.last),
      "Two groups (a draft counts as active): exit 2, 2 groups, 2 subscriptions, 5 invoices");
    const counts = await u`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS c FROM invoices`;
    assert(counts[0].n === 10 && counts[0].c === 1, `The scans changed nothing (10 invoices, 1 cancelled: ${counts[0].n}, ${counts[0].c})`);
    assert(!/Scan Customer|9000000001|Addr/.test(r3.text), "Output has no customer name, phone or address");
  } finally {
    await u.end();
  }

  console.log("\n--- 4. Connection failure ---");
  const secret = `pw-${tag}-secret`;
  const deadUrl = `postgresql://scanuser_${tag}:${secret}@127.0.0.1:1/rn_erp_verify_nothing_test`;
  const r4 = run(deadUrl);
  show("no connection", r4);
  assert(r4.code === 1 && /^RESULT: SCAN FAILED - .*NOT a clean result/.test(r4.last) && !r4.text.includes(secret) && !r4.text.includes(`scanuser_${tag}`),
    "Unreachable database: exit 1, SCAN FAILED, password and user not shown");
  const r4b = run("");
  show("no url", r4b);
  assert(r4b.code === 1 && /^RESULT: SCAN FAILED - no database URL given/.test(r4b.last), "No URL given: exit 1, SCAN FAILED");

  console.log("\n--- 5. Query failure ---");
  const r5 = run(urlFor(emptyDb));
  show("query fails", r5);
  assert(r5.code === 1 && /^RESULT: SCAN FAILED - relation "invoices" does not exist/.test(r5.last), "Database without the invoices table: exit 1, SCAN FAILED (not zero duplicates)");

  console.log("\n--- 6. Incomplete scan ---");
  // A client that returns fewer rows than it counted, and one whose transaction is not read-only.
  const fake = (readOnly: string, counted: number, rows: any[]) => ({
    begin: async (_mode: string, fn: (tx: any) => Promise<any>) =>
      fn((strings: TemplateStringsArray) => {
        const q = strings.join("?");
        if (/SHOW transaction_read_only/.test(q)) return Promise.resolve([{ transaction_read_only: readOnly }]);
        if (/COUNT\(\*\)/.test(q)) return Promise.resolve([{ n: counted }]);
        return Promise.resolve(rows);
      }),
  });
  const row = { id: "inv_x", invoice_number: "X", customer_id: "c", subscription_id: "s", billing_period: "Nov 2041", status: "ISSUED", total_amount: 1, amount_paid: 0, issue_date: "2041-11-01" };
  for (const [label, client, expect] of [
    ["fewer rows than counted", fake("on", 3, [row]), /scan incomplete: read 1 of 3 active subscription invoices/],
    ["transaction not read-only", fake("off", 1, [row]), /scan incomplete: the scan transaction is not read-only/],
  ] as Array<[string, any, RegExp]>) {
    const lines: string[] = [];
    const code = await scanner.main([], { out: (s: string) => lines.push(s), err: (s: string) => lines.push(s) }, { client });
    console.log(`  [${label}] exit ${code}: ${lines[lines.length - 1]}`);
    assert(code === 1 && expect.test(lines[lines.length - 1]) && /NOT a clean result/.test(lines[lines.length - 1]), `${label}: exit 1, SCAN FAILED (incomplete), never reported as clean`);
  }

  console.log("\n--- 7. Month formats ---");
  const samples = ["Nov 2041", "November 2041", "NOV 2041", " nov  2041 ", "Nov. 2041", "Nov-2041", "nov2041", "2041-11", "2041/11", "11/2041", "11-2041",
    "Sept 2041", "Sep 2041", "2041-1", "1/2041", "2041-13", "Ma 2041", "Nov 41", "2041-11-01 to 2041-11-30", "Special catering week", ""];
  const diff = samples.filter((s) => scanner.canonicalMonth(s) !== canonicalBillingMonth(s));
  assert(diff.length === 0, `Scanner and application read ${samples.length} period texts the same way (${diff.length} differences)`);
  const nov = samples.slice(0, 11).map((s) => scanner.canonicalMonth(s));
  assert(nov.every((m) => m === "2041-11"), "Eleven spellings of November 2041 are one month (2041-11)");
  assert(["2041-13", "Ma 2041", "Nov 41", "2041-11-01 to 2041-11-30", "Special catering week", ""].every((s) => scanner.canonicalMonth(s) === null),
    "Ambiguous or non-month text is not treated as a month (not constrained, never a false duplicate)");

  console.log("\n================================================================================");
  console.log(`DUPLICATE SCAN RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
  console.log("================================================================================");
}

main()
  .catch((err) => {
    state.failed++;
    console.error("Test runner error:", err?.stack ?? err?.message ?? err);
  })
  .finally(async () => {
    const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
    try {
      for (const db of [dataDb, emptyDb]) await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    } catch (e: any) {
      console.error("cleanup:", e.message);
    } finally {
      await admin.end();
    }
    process.exit(state.failed > 0 ? 1 : 0);
  });
