/**
 * READ-ONLY scan for invoices that migration 0020 would treat as duplicates: more than one active
 * (not cancelled) TIFFIN invoice for the same customer, subscription and canonical month.
 *
 * usage: node scripts/scan-invoice-duplicates.js <postgres-url>
 *
 * Exit codes (the last line says the same in words):
 *   0  RESULT: NO DUPLICATES      the scan completed and found no conflicting group
 *   2  RESULT: DUPLICATES FOUND   one or more groups; migration 0020 would stop
 *   1  RESULT: SCAN FAILED        connection, query or read-only check failed, or the scan read fewer
 *                                 rows than it counted: NOT a clean result
 *
 * Everything runs in one READ ONLY transaction (one snapshot), so the scan cannot change data even
 * through a pooled connection. It works before and after migration 0020 (the canonical month is
 * computed here from billing_period). It also lists groups whose periods differ only in spelling and
 * groups with different amounts, so a person can decide which invoice is the real one. Nothing is
 * merged, cancelled or deleted by this script. Error messages never show the database URL, user,
 * password or host.
 */
const path = require("path");

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function canonicalMonth(text) {
  if (!text) return null;
  const s = String(text).trim().toLowerCase().replace(/\s+/g, " ");
  let m = /^([a-z]+)\.?[\s,\-/]*(\d{4})$/.exec(s);
  if (m) {
    const name = m[1];
    const i = name === "sept" ? 8 : MONTHS.findIndex((x) => x === name || (name.length >= 3 && x.startsWith(name)));
    return i >= 0 ? `${m[2]}-${String(i + 1).padStart(2, "0")}` : null;
  }
  m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${m[1].padStart(2, "0")}`;
  return null;
}

class ScanIncompleteError extends Error {}

/** Removes the URL and its user, password and host from a message before it is printed. */
function redact(text, url) {
  let s = String(text ?? "");
  if (!url) return s;
  s = s.split(url).join("<database url>");
  try {
    const u = new URL(url);
    for (const [part, label] of [[u.password, "<password>"], [decodeURIComponent(u.password || ""), "<password>"], [u.username, "<user>"], [u.hostname, "<database host>"]]) {
      if (part && part.length >= 3) s = s.split(part).join(label);
    }
  } catch {
    // Not a parseable URL: nothing more to hide than the text itself.
  }
  return s;
}

async function scan(url, options = {}) {
  if (!url && !options.client) throw new Error("Pass the database URL to scan.");
  const postgres = options.client ? null : require(path.resolve(__dirname, "../node_modules/postgres"));
  const sql = options.client || postgres(url, { max: 1, connect_timeout: 15, onnotice: () => {} });
  try {
    return await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
      const ro = await tx`SHOW transaction_read_only`;
      if (!ro[0] || ro[0].transaction_read_only !== "on") throw new ScanIncompleteError("the scan transaction is not read-only");
      const counted = await tx`
        SELECT COUNT(*)::int AS n FROM invoices
        WHERE invoice_category = 'TIFFIN' AND status <> 'CANCELLED' AND subscription_id IS NOT NULL`;
      const rows = await tx`
        SELECT id, invoice_number, customer_id, subscription_id, billing_period, status, total_amount, amount_paid, issue_date, created_at
        FROM invoices
        WHERE invoice_category = 'TIFFIN' AND status <> 'CANCELLED' AND subscription_id IS NOT NULL
        ORDER BY created_at`;
      const expected = Number(counted[0] && counted[0].n);
      if (!Number.isInteger(expected) || rows.length !== expected) {
        throw new ScanIncompleteError(`read ${rows.length} of ${Number.isInteger(expected) ? expected : "an unknown number of"} active subscription invoices`);
      }
      return group(rows);
    });
  } finally {
    if (!options.client) await sql.end({ timeout: 5 });
  }
}

function group(rows) {
  const groups = new Map();
  for (const r of rows) {
    const month = canonicalMonth(r.billing_period);
    if (!month) continue;
    const key = `${r.customer_id}|${r.subscription_id}|${month}`;
    if (!groups.has(key)) groups.set(key, { month, customerId: r.customer_id, subscriptionId: r.subscription_id, invoices: [] });
    groups.get(key).invoices.push(r);
  }
  const duplicates = [...groups.values()].filter((g) => g.invoices.length > 1).map((g) => ({
    ...g,
    spellingOnly: new Set(g.invoices.map((i) => i.billing_period)).size > 1,
    differentAmounts: new Set(g.invoices.map((i) => Number(i.total_amount))).size > 1,
    invoices: g.invoices.map((i) => ({
      id: i.id, number: i.invoice_number, period: i.billing_period, status: i.status,
      total: Number(i.total_amount), paid: Number(i.amount_paid), issueDate: i.issue_date,
    })),
  }));
  return {
    complete: true,
    scannedActiveSubscriptionInvoices: rows.length,
    duplicateGroups: duplicates.length,
    affectedSubscriptions: new Set(duplicates.map((g) => g.subscriptionId)).size,
    affectedInvoices: duplicates.reduce((a, g) => a + g.invoices.length, 0),
    duplicates,
  };
}

/** Runs the scan and reports it; returns the exit code (0 clean, 2 duplicates, 1 failed). */
async function main(argv, io = { out: console.log, err: console.error }, options = {}) {
  const url = argv[0];
  if (!url && !options.client) {
    io.err("usage: node scripts/scan-invoice-duplicates.js <postgres-url>");
    io.err("RESULT: SCAN FAILED - no database URL given. Nothing was scanned.");
    return 1;
  }
  let r;
  try {
    r = await scan(url, options);
  } catch (e) {
    const why = e instanceof ScanIncompleteError ? `scan incomplete: ${e.message}` : (e && e.message) || String(e);
    io.err(`RESULT: SCAN FAILED - ${redact(why, url)}. This is NOT a clean result; migration 0020 eligibility is unknown.`);
    return 1;
  }
  io.out(JSON.stringify(r, null, 2));
  if (r.duplicateGroups === 0) {
    io.out(`RESULT: NO DUPLICATES - scanned ${r.scannedActiveSubscriptionInvoices} active subscription invoice(s) completely; migration 0020's unique index can be created.`);
    return 0;
  }
  io.out(
    `RESULT: DUPLICATES FOUND - ${r.duplicateGroups} group(s), ${r.affectedSubscriptions} subscription(s), ${r.affectedInvoices} invoice(s). ` +
      "Migration 0020 will stop until a person resolves each group (cancel the invoice that should not exist, after checking its payments). Nothing was changed."
  );
  return 2;
}

module.exports = { scan, main, canonicalMonth, redact, ScanIncompleteError };

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`RESULT: SCAN FAILED - ${redact(e && e.message, process.argv[2])}. This is NOT a clean result.`);
      process.exit(1);
    }
  );
}
