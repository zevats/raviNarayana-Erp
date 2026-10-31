/**
 * Production database migrator (Render start step).
 *
 * The other migration tools in this repo refuse every remote database on purpose. This one is the
 * single, deliberate way to bring the production PostgreSQL (Neon) schema up to date. It only runs
 * when the deploy explicitly sets ERP_PRODUCTION_MIGRATE=apply, and it:
 *   1. applies pending Drizzle migrations (apps/erp/src/server/database/drizzle) using DIRECT_URL
 *      (non-pooled) or DATABASE_URL;
 *   2. if ERP_RESET_ALL_DATA="<database>:<label>" is set, empties all data once (see resetAllDataOnce);
 *   3. when the staff table is empty, creates the first Owner (SUPER_ADMIN) from ERP_ADMIN_USERNAME,
 *      ERP_ADMIN_EMAIL, ERP_ADMIN_PASSWORD (12+ characters) and ERP_ADMIN_NAME.
 * It never prints credentials: only the host, database name and counts.
 *
 * Usage (Render start command): node scripts/migrate-production.js && npm run start:render
 */
const path = require("path");
const crypto = require("crypto");

const PROTECTED = /ravi-narayana-erp-phase01b-test|phase01b-test/i;

function fail(message) {
  console.error(`[migrate-production] ${message}`);
  process.exit(1);
}

async function main() {
  if (process.env.ERP_PRODUCTION_MIGRATE !== "apply") {
    console.log("[migrate-production] ERP_PRODUCTION_MIGRATE is not 'apply': skipping migrations.");
    return;
  }
  const url = (process.env.DIRECT_URL || process.env.DATABASE_URL || "").trim();
  if (!url) fail("DATABASE_URL (or DIRECT_URL) is not set.");

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail("The database URL is malformed.");
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) fail(`Unsupported protocol '${parsed.protocol}'.`);
  const host = parsed.hostname.toLowerCase();
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).toLowerCase();
  const rehearsalHost = (process.env.EXPECTED_NEON_HOST || "").toLowerCase().trim();
  if (PROTECTED.test(url) || (rehearsalHost && host === rehearsalHost)) fail("Refusing the protected rehearsal database.");
  console.log(`[migrate-production] Target: ${host} / ${dbName}`);

  const postgres = require("postgres");
  const { drizzle } = require("drizzle-orm/postgres-js");
  const { migrate } = require("drizzle-orm/postgres-js/migrator");
  const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: /sslmode=disable/.test(url) ? false : host === "localhost" || host === "127.0.0.1" ? false : "require" });

  try {
    const before = await sql`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS t`;
    const appliedBefore = before[0].t ? Number((await sql`SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`)[0].n) : 0;
    await migrate(drizzle(sql), { migrationsFolder: path.resolve(__dirname, "../apps/erp/src/server/database/drizzle") });
    const appliedAfter = Number((await sql`SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`)[0].n);
    console.log(`[migrate-production] Migrations: ${appliedBefore} before, ${appliedAfter} now (${appliedAfter - appliedBefore} applied).`);

    await resetAllDataOnce(sql, dbName);

    const staff = Number((await sql`SELECT COUNT(*)::int AS n FROM staff_users`)[0].n);
    if (staff > 0) {
      console.log(`[migrate-production] ${staff} staff account(s) exist: no Owner created.`);
      return;
    }
    const email = (process.env.ERP_ADMIN_EMAIL || "").trim().toLowerCase();
    const password = process.env.ERP_ADMIN_PASSWORD || "";
    const username = (process.env.ERP_ADMIN_USERNAME || "").trim().toLowerCase();
    const fullName = (process.env.ERP_ADMIN_NAME || "Owner").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || !username || password.length < 12) {
      fail("No staff yet. Set ERP_ADMIN_USERNAME, ERP_ADMIN_EMAIL and ERP_ADMIN_PASSWORD (12+ characters) to create the first Owner, then redeploy.");
    }
    const bcrypt = require(require.resolve("bcryptjs", { paths: [path.resolve(__dirname, "../apps/erp"), process.cwd()] }));
    const hash = await bcrypt.hash(password, 12);
    const now = new Date().toISOString();
    await sql`INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
              VALUES (${`usr_${crypto.randomUUID()}`}, ${username}, ${email}, ${fullName}, ${hash}, 'SUPER_ADMIN', 1, ${now}, ${now})`;
    console.log(`[migrate-production] First Owner '${username}' created. Remove ERP_ADMIN_PASSWORD from Render now.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * One-time wipe of all business data (e.g. synthetic demo data), requested by setting
 * ERP_RESET_ALL_DATA="<database name>:<label>". The database name must match the target, so it
 * cannot hit another database by mistake. Every table in the public schema is emptied; the
 * schema and the migration history (drizzle schema) stay. The value is recorded in
 * drizzle.erp_maintenance, so the same value never wipes twice (restarts are safe); a new
 * label is needed for another wipe.
 */
async function resetAllDataOnce(sql, dbName) {
  const raw = (process.env.ERP_RESET_ALL_DATA || "").trim();
  if (!raw) return;
  const [target, ...rest] = raw.split(":");
  if (target.trim().toLowerCase() !== dbName || !rest.join(":").trim()) {
    fail(`ERP_RESET_ALL_DATA must be "${dbName}:<label>" for this database. Nothing was deleted.`);
  }
  await sql`CREATE TABLE IF NOT EXISTS drizzle.erp_maintenance (token text PRIMARY KEY, action text NOT NULL, done_at text NOT NULL)`;
  const done = await sql`SELECT done_at FROM drizzle.erp_maintenance WHERE token = ${raw}`;
  if (done.length) {
    console.log(`[migrate-production] Data reset '${raw}' already done on ${done[0].done_at}: skipped. Remove ERP_RESET_ALL_DATA from Render.`);
    return;
  }
  const tables = (await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`).map((r) => r.tablename);
  let rows = 0;
  for (const t of tables) rows += Number((await sql.unsafe(`SELECT COUNT(*)::int AS n FROM public."${t.replace(/"/g, '""')}"`))[0].n);
  await sql.begin(async (tx) => {
    if (tables.length) await tx.unsafe(`TRUNCATE TABLE ${tables.map((t) => `public."${t.replace(/"/g, '""')}"`).join(", ")} RESTART IDENTITY CASCADE`);
    await tx`INSERT INTO drizzle.erp_maintenance (token, action, done_at) VALUES (${raw}, 'reset_all_data', ${new Date().toISOString()})`;
  });
  console.log(`[migrate-production] Data reset '${raw}': emptied ${tables.length} tables (${rows} rows removed). Remove ERP_RESET_ALL_DATA from Render.`);
}

main().catch((e) => fail(`Failed: ${e && e.message ? e.message.replace(/postgres(ql)?:\/\/[^\s]+/g, "<url>") : "unknown error"}`));
