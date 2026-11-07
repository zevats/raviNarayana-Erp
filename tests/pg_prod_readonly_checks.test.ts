/**
 * scripts/prod-readonly-checks.js: the production gate checks (Q0-Q5) run read-only, never print
 * credentials or personal data, and never report PASS from a failure. The script runs as a child
 * process against databases this suite creates and drops on the disposable verification server.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { useVerifyDatabase, createAsserter } from "./helpers/pgVerifyTarget";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const postgres = require(path.resolve(__dirname, "../../../node_modules/postgres"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrate = require(path.resolve(__dirname, "../../../scripts/migrate.js"));
const SCRIPT = path.resolve(__dirname, "../../../scripts/prod-readonly-checks.js");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const checker = require(SCRIPT);

const baseUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const MIGRATIONS = path.resolve(__dirname, "../../../apps/erp/src/server/database/drizzle");
const tag = crypto.randomBytes(3).toString("hex");
const at15 = `rn_erp_verify_gate15_${tag}_test`;
const at21 = `rn_erp_verify_gate21_${tag}_test`;

function urlFor(db: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
}
function folderUpTo(lastIdx: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-gate-mig-"));
  fs.mkdirSync(path.join(dir, "meta"));
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((e: any) => e.idx <= lastIdx);
  fs.writeFileSync(path.join(dir, "meta", "_journal.json"), JSON.stringify(journal, null, 2));
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`));
  return dir;
}
function run(url: string) {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env, PROD_DB_URL: url } });
  const text = `${r.stdout || ""}${r.stderr || ""}`;
  const lines = text.split(/\r?\n/).filter(Boolean);
  return { code: r.status, text, gates: lines.filter((l) => l.startsWith("GATE ")), last: lines[lines.length - 1] || "" };
}
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
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
  console.log("PRODUCTION READ-ONLY CHECKS (gate Q0-Q5): read-only, no credentials, no false PASS");
  console.log("================================================================================");
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${at15}"`);
  await admin.unsafe(`CREATE DATABASE "${at21}"`);
  await admin.end();
  await quiet(() => migrate.runMigrations(urlFor(at15), folderUpTo(15)));
  await quiet(() => migrate.runMigrations(urlFor(at21)));
  const fullName = `Gate Person ${tag}`;
  const phone = `98765${crypto.randomInt(10000, 99999)}`;
  const db15 = postgres(urlFor(at15), { max: 1, onnotice: () => {} });
  try {
    const now = new Date().toISOString();
    await db15`INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
               VALUES ('stf_g', ${`gate_${tag}`}, ${`gate_${tag}@example.invalid`}, 'Gate Staff', 'x', 'SUPER_ADMIN', 1, ${now}, ${now})`;
    for (const id of ["cust_g1", "cust_g2"]) {
      await db15`INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, created_by, created_at, updated_at)
                 VALUES (${id}, ${fullName}, ${phone}, 'Gate Lane 1', 'stf_g', ${now}, ${now})`;
    }

    console.log("\n--- 1. A production-like database at 0015 ---");
    const before = await db15`SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS h FROM tiffin_customers t`;
    const r1 = run(`${urlFor(at15)}?sslmode=disable&channel_binding=require`);
    r1.gates.forEach((g) => console.log(`  ${g}`));
    console.log(`  [exit ${r1.code}] ${r1.last}`);
    assert(r1.code === 0 && /^RESULT: CHECKS COMPLETE/.test(r1.last), "A Neon-style URL (channel_binding) is accepted; all queries ran and were rolled back (exit 0)");
    assert(r1.gates.some((g) => /^GATE Q1 migration level: PASS - newest record 1792471200000 hash 0f0652008797519f .*0016-0021 objects absent: yes; schema of 0000-0015 present: all; 16 record\(s\) for 16 migrations$/.test(g)),
      "Q1 PASS at the production baseline: newest record 0015 (1792471200000, hash 0f0652008797519f), 0016-0021 absent, all 0000-0015 schema present, 16 records");
    assert(r1.gates.some((g) => /^GATE Q2 shared phones: REVIEW - 1 number\(s\), 2 customer\(s\)/.test(g)), "Q2 finds the shared phone (REVIEW, not PASS)");
    assert(r1.text.includes(`******${phone.slice(-4)}`) && !r1.text.includes(phone) && !r1.text.includes(fullName) && !r1.text.includes("Gate Lane"),
      "Output shows only the last four digits: no full phone, name or address");
    assert(r1.gates.some((g) => /^GATE Q3 delivered work outside Receivables: PASS - 0 order/.test(g)) && r1.gates.some((g) => /^GATE Q4 orders without a customer: PASS/.test(g)),
      "Q3 and Q4 PASS on an empty order history");
    const after = await db15`SELECT md5(string_agg(t::text, '|' ORDER BY t::text)) AS h FROM tiffin_customers t`;
    const idle = await db15`SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = ${at15} AND state = 'idle in transaction'`;
    assert(before[0].h === after[0].h && idle[0].n === 0, "Data unchanged and no transaction left open");
  } finally {
    await db15.end();
  }

  console.log("\n--- 2. A database that is already past 0015 ---");
  const r2 = run(urlFor(at21));
  r2.gates.forEach((g) => console.log(`  ${g}`));
  assert(r2.code === 0 && r2.gates.some((g) => /^GATE Q1 migration level: BLOCK - newest record \d+ .*0016-0021 objects absent: NO/.test(g)), "Q1 BLOCK when the database is already past 0015 (newest record after 0015)");

  console.log("\n--- 2b. Production's state: 0015 schema, one older record missing ---");
  // Neon history applied some early migrations by hand, without a record. Drizzle reads only the
  // newest record, so a missing OLDER record changes nothing; a missing SCHEMA must still block.
  const db15b = postgres(urlFor(at15), { max: 1, onnotice: () => {} });
  try {
    await db15b`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1792212000000`; // 0012, disposable copy only
    const r2b = run(urlFor(at15));
    r2b.gates.filter((g) => g.startsWith("GATE Q1")).forEach((g) => console.log(`  ${g}`));
    assert(r2b.gates.some((g) => /^GATE Q1 migration level: PASS - .*schema of 0000-0015 present: all; 15 record\(s\) for 16 migrations - no record for 0012 \(schema present/.test(g)),
      "15 records with newest = 0015 and all schema present: PASS, and the missing record (0012) is named");
    await db15b.unsafe("ALTER TABLE push_tokens RENAME TO push_tokens_hidden");
    const r2c = run(urlFor(at15));
    await db15b.unsafe("ALTER TABLE push_tokens_hidden RENAME TO push_tokens");
    r2c.gates.filter((g) => g.startsWith("GATE Q1")).forEach((g) => console.log(`  ${g}`));
    assert(r2c.gates.some((g) => /^GATE Q1 migration level: BLOCK - .*schema of 0000-0015 present: MISSING 0015/.test(g)),
      "A migration whose schema is absent BLOCKS even when the newest record looks right");
    await db15b`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('stray', 1700000000000)`;
    const r2d = run(urlFor(at15));
    r2d.gates.filter((g) => g.startsWith("GATE Q1")).forEach((g) => console.log(`  ${g}`));
    assert(r2d.gates.some((g) => /^GATE Q1 migration level: BLOCK - .*UNKNOWN record timestamp\(s\) 1700000000000/.test(g)), "A record that matches no journal entry BLOCKS");
  } finally {
    await db15b.end();
  }
  const quietRun = await quiet(() => migrate.runMigrations(urlFor(at15)));
  const probe15 = postgres(urlFor(at15), { max: 1, onnotice: () => {} });
  const objs = await probe15`SELECT to_regclass('public.business_settings') IS NOT NULL AS a, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'payment_review') AS f`;
  await probe15.end();
  assert(Array.isArray(quietRun) && objs[0].a === true && objs[0].f === true, "Drizzle then applies 0016-0021 on top of that state (newest record decides; the missing older record is never re-run)");

  console.log("\n--- 3. Failures never look like a clean result ---");
  const secret = `pw-${tag}-secret`;
  const r3 = run(`postgresql://gateuser_${tag}:${secret}@127.0.0.1:1/x_test`);
  console.log(`  [exit ${r3.code}] ${r3.last}`);
  assert(r3.code === 1 && /^RESULT: CHECKS FAILED/.test(r3.last) && r3.gates.length === 0 && !r3.text.includes(secret) && !r3.text.includes(`gateuser_${tag}`),
    "Unreachable database: exit 1, no GATE lines, password and user hidden");
  const r4 = run(`postgresql://u:${secret}@ep-example-123-pooler.eu-central-1.aws.neon.tech/db?sslmode=require`);
  console.log(`  [exit ${r4.code}] ${r4.last}`);
  assert(r4.code === 1 && /pooled connection string/.test(r4.last) && !r4.text.includes(secret), "Pooled (-pooler) string refused before connecting");
  const r5 = run("");
  assert(r5.code === 1 && /PROD_DB_URL is not set/.test(r5.last), "No URL: exit 1, nothing queried");
  const lines: string[] = [];
  const io = { out: (s: string) => lines.push(s), table: () => {}, err: (s: string) => lines.push(s) };
  const notReadOnly = {
    begin: async (_m: string, fn: (tx: any) => Promise<any>) => fn({ unsafe: async (q: string) => (/SHOW transaction_read_only/.test(q) ? [{ transaction_read_only: "off" }] : []) }),
  };
  const code6 = await checker.main({ PROD_DB_URL: "x" }, io, { client: notReadOnly });
  assert(code6 === 1 && /not read-only; nothing was queried/.test(lines[lines.length - 1]), "A session that is not read-only: stops before any query (exit 1)");

  console.log("\n--- 4. The database refuses writes inside the checker's transaction ---");
  const evil = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rn-gate-")), "evil.sql");
  fs.writeFileSync(evil, "\\echo '== Q9 write attempt'\nINSERT INTO business_settings (key, value, updated_at) VALUES ('gate_probe', '1', 'x');\n");
  const out7: string[] = [];
  const code7 = await checker.main({ PROD_DB_URL: urlFor(at21) }, { out: (s: string) => out7.push(s), table: () => {}, err: (s: string) => out7.push(s) }, { sqlFile: evil });
  const probe = postgres(urlFor(at21), { max: 1, onnotice: () => {} });
  const written = await probe`SELECT COUNT(*)::int AS n FROM business_settings WHERE key = 'gate_probe'`;
  await probe.end();
  console.log(`  [exit ${code7}] ${out7[out7.length - 1]}`);
  assert(code7 === 1 && /read-only transaction/.test(out7[out7.length - 1]) && written[0].n === 0, "An INSERT is refused by the database (read-only transaction); nothing written");

  console.log("\n================================================================================");
  console.log(`PROD READ-ONLY CHECKS RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
      for (const db of [at15, at21]) await admin.unsafe(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    } catch (e: any) {
      console.error("cleanup:", e.message);
    } finally {
      await admin.end();
    }
    process.exit(state.failed > 0 ? 1 : 0);
  });
