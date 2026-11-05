/**
 * READ-ONLY production checks before migrations 0016-0021 (Q0-Q5 of
 * docs/PRODUCTION_READONLY_RUNBOOK_2026-11.md). Queries are in scripts/prod-readonly-checks.sql.
 *
 * usage (PowerShell, repository root):  node scripts/prod-readonly-checks.js
 * The database URL is read from the PROD_DB_URL environment variable and is never printed. Use the
 * DIRECT Neon string (Connection pooling off). A `channel_binding` parameter, which the database
 * driver cannot pass on, is removed; `sslmode` (TLS) is kept as given.
 *
 * Every query runs inside one READ ONLY transaction that is always rolled back, and nothing runs
 * unless the database itself reports `transaction_read_only = on`. Output: counts, ids, dates and
 * amounts; phone numbers only as their last four digits; no names or addresses.
 *
 * Exit codes: 0 all checks ran (read the GATE lines), 1 failed or incomplete (no conclusion).
 */
const fs = require("fs");
const path = require("path");

const EXPECTED = { applied: 16, last: "1792471200000", hash: "0f0652008797519f" };

/** Removes channel_binding (unsupported by the driver) from a connection string; keeps everything else. */
function withoutChannelBinding(url) {
  return String(url || "")
    .trim()
    .replace(/([?&])channel_binding=[^&]*&?/, "$1")
    .replace(/[?&]$/, "");
}

/** Hides the URL and its user, password and host in a message. */
function hide(text, url) {
  let t = String(text ?? "");
  if (!url) return t;
  t = t.split(url).join("<hidden>");
  try {
    const u = new URL(url);
    for (const p of [u.password, decodeURIComponent(u.password || ""), u.username, u.hostname]) {
      if (p && p.length >= 3) t = t.split(p).join("<hidden>");
    }
  } catch {
    // not a parseable URL: nothing more to hide
  }
  return t;
}

/** The statements of the .sql file, each with its "== Qn ..." label; BEGIN/ROLLBACK are handled here. */
function loadSteps(file) {
  const steps = [];
  let label = null;
  for (const block of fs.readFileSync(file, "utf8").split(/;\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => !/^\s*--/.test(l));
    for (const l of lines) {
      const m = /^\\echo '(.*)'$/.exec(l.trim());
      if (m) label = m[1];
    }
    const text = lines.filter((l) => !/^\\echo/.test(l.trim())).join("\n").trim();
    if (!text || /^(BEGIN|ROLLBACK)\b/i.test(text)) continue;
    const id = (/^== (Q\d[a-z]?)/.exec(label || "") || [])[1] || `S${steps.length}`;
    steps.push({ id, label: label || text.slice(0, 60), text });
    label = null;
  }
  return steps;
}

const plain = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v])));
const n = (v) => Number(v ?? 0);

/** PASS / BLOCK / REVIEW lines from the results; never PASS from missing data. */
function gate(r) {
  const out = [];
  const q1 = r.Q1a?.[0];
  const q1b = r.Q1b?.[0];
  const q1c = r.Q1c?.[0];
  const atBaseline = q1 && n(q1.applied) === EXPECTED.applied && String(q1.last_applied) === EXPECTED.last && q1b && String(q1b.hash_start) === EXPECTED.hash;
  const pending = q1c && ["has_0016", "has_0017", "has_0018", "has_0019", "has_0020", "has_0021"].every((k) => q1c[k] === false);
  out.push(`GATE Q1 migration level: ${atBaseline && pending ? "PASS" : "BLOCK"} - ${q1 ? `${q1.applied} applied, last ${q1.last_applied}, newest hash ${q1b ? q1b.hash_start : "?"}; 0016-0021 objects absent: ${pending ? "yes" : "NO"}` : "no result"} (expected ${EXPECTED.applied} / ${EXPECTED.last} / ${EXPECTED.hash})`);
  const q2 = r.Q2a?.[0];
  out.push(`GATE Q2 shared phones: ${q2 ? (n(q2.shared_phone_numbers) === 0 ? "PASS" : "REVIEW") : "BLOCK"} - ${q2 ? `${q2.shared_phone_numbers} number(s), ${q2.customers_involved} customer(s)` : "no result"}`);
  const q3a = r.Q3a || [];
  const q3b = r.Q3b?.[0];
  const q3c = r.Q3c?.[0];
  const missingOrders = q3a.reduce((a, x) => a + n(x.orders), 0);
  const missingOwed = q3a.reduce((a, x) => a + n(x.outstanding_active_rule), 0);
  const unexplained = q3c ? n(q3c.differ_unexplained) : NaN;
  const q3 = !r.Q3a || !q3b || !q3c ? "BLOCK" : unexplained > 0 ? "BLOCK" : missingOrders + n(q3b.tasks) > 0 ? "REVIEW" : "PASS";
  out.push(`GATE Q3 delivered work outside Receivables: ${q3} - ${missingOrders} order(s) not marked completed (Rs ${missingOwed} owed by the Receivables rule), ${q3b ? q3b.tasks : "?"} task(s) without an order, ${Number.isNaN(unexplained) ? "?" : unexplained} unexplained collection difference(s)`);
  const q4 = r.Q4a?.[0];
  out.push(`GATE Q4 orders without a customer: ${q4 ? ((r.Q4b || []).length === 0 ? "PASS" : "REVIEW") : "BLOCK"} - ${q4 ? `${q4.orders} order(s), ${(r.Q4b || []).length} with money owed` : "no result"}`);
  const q5 = r.Q5 || [];
  const rows = (name) => n(q5.find((x) => x.tbl === name)?.rows_exact);
  out.push(`GATE Q5 table sizes: ${q5.length >= 8 ? "REVIEW" : "BLOCK"} - invoices ${rows("invoices")}, orders ${rows("orders")}, collections ${rows("delivery_collections")}, beds 0017 will create ${rows("room capacity (beds 0017 will add)")}`);
  return out;
}

async function main(env = process.env, io = { out: console.log, table: console.table, err: console.error }, options = {}) {
  const url = withoutChannelBinding(env.PROD_DB_URL);
  if (!url && !options.client) {
    io.err("RESULT: CHECKS FAILED - PROD_DB_URL is not set in this window. Nothing was queried.");
    return 1;
  }
  if (/-pooler\./i.test(url)) {
    io.err("RESULT: CHECKS FAILED - this is the pooled connection string (host contains -pooler). Turn Connection pooling off in Neon's Connect dialog and copy the direct string.");
    return 1;
  }
  const steps = loadSteps(options.sqlFile || path.join(__dirname, "prod-readonly-checks.sql"));
  const postgres = options.client ? null : require(path.resolve(__dirname, "../node_modules/postgres"));
  const sql = options.client || postgres(url, { max: 1, connect_timeout: 20, onnotice: () => {} });
  const results = {};
  let failure = null;
  try {
    await sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (tx) => {
      const ro = await tx.unsafe("SHOW transaction_read_only");
      if (!ro[0] || ro[0].transaction_read_only !== "on") throw new Error("the transaction is not read-only; nothing was queried");
      for (const s of steps) {
        const rows = plain(await tx.unsafe(s.text));
        results[s.id] = rows;
        io.out(`\n${s.label}`);
        if (rows.length === 0) io.out("  (no rows)");
        else io.table(rows);
      }
      // Always end the read-only transaction with ROLLBACK.
      throw Object.assign(new Error("rollback"), { rollback: true });
    });
  } catch (e) {
    if (!e.rollback) failure = e;
  } finally {
    if (!options.client) await sql.end({ timeout: 5 });
  }
  if (failure) {
    io.err(`\nRESULT: CHECKS FAILED - ${hide(failure.message, url)}. No conclusion can be drawn; results above (if any) are incomplete.`);
    return 1;
  }
  io.out("");
  for (const line of gate(results)) io.out(line);
  io.out(`\nRESULT: CHECKS COMPLETE - ${steps.length} read-only queries ran; the transaction was rolled back. Read the GATE lines above.`);
  return 0;
}

module.exports = { main, gate, loadSteps, withoutChannelBinding, hide };

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`RESULT: CHECKS FAILED - ${hide(e && e.message, withoutChannelBinding(process.env.PROD_DB_URL))}.`);
      process.exit(1);
    }
  );
}
