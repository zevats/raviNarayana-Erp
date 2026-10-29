/**
 * Database Migration CLI Runner & Target Validator
 * Executes pending Drizzle SQL migrations strictly against an approved isolated local PostgreSQL database.
 * Remote targets and protected rehearsal databases are permanently blocked.
 */

const fs = require("fs");
const path = require("path");

const FORBIDDEN_DB_NAMES = new Set([
  "ravi-narayana-erp-phase01b-test",
  "neondb",
  "postgres",
  "template0",
  "template1",
  "production",
  "prod",
]);

const ALLOWED_LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

/**
 * Validates a PostgreSQL connection target URL.
 * Throws an Error with a safe, descriptive message (no credentials exposed) if the target is invalid or blocked.
 * Returns { valid: true, hostname, port, dbName } on success.
 */
function validateMigrationTarget(targetUrl) {
  if (!targetUrl || typeof targetUrl !== "string" || !targetUrl.trim()) {
    throw new Error("[DB:MIGRATE SAFETY BLOCK] No target database URL provided. Configuration is missing (fail-closed).");
  }

  const trimmed = targetUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new Error(`[DB:MIGRATE SAFETY BLOCK] Malformed database connection URL: ${err.message}`);
  }

  // 1. Protocol check
  const protocol = (parsed.protocol || "").toLowerCase();
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new Error(`[DB:MIGRATE SAFETY BLOCK] Unsupported protocol '${protocol}'. Only postgres: and postgresql: are permitted.`);
  }

  // 2. Decode and inspect database name
  const rawPath = parsed.pathname || "";
  const trimmedPath = rawPath.replace(/^\/+/, "");
  if (!trimmedPath) {
    throw new Error("[DB:MIGRATE SAFETY BLOCK] Target URL missing database name in pathname.");
  }

  let decodedDbName = "";
  try {
    decodedDbName = decodeURIComponent(trimmedPath).toLowerCase().trim();
  } catch (err) {
    throw new Error(`[DB:MIGRATE SAFETY BLOCK] Failed to decode URL pathname: ${err.message}`);
  }

  // Remove any query parameters attached to path
  const questionIdx = decodedDbName.indexOf("?");
  if (questionIdx !== -1) {
    decodedDbName = decodedDbName.slice(0, questionIdx).trim();
  }

  const hostname = (parsed.hostname || "").toLowerCase().trim();

  // 3. Absolute Permanent Block: Rehearsal Database & Protected Names
  const protectedPattern = /ravi-narayana-erp-phase01b-test|phase01b-test/i;
  if (
    protectedPattern.test(decodedDbName) ||
    protectedPattern.test(trimmedPath) ||
    protectedPattern.test(hostname) ||
    protectedPattern.test(trimmed)
  ) {
    throw new Error(
      "[DB:MIGRATE CRITICAL SAFETY BLOCK] Target identified as protected Neon rehearsal database (ravi-narayana-erp-phase01b-test). Migrations against this database are permanently prohibited under all conditions. No override permitted."
    );
  }

  if (FORBIDDEN_DB_NAMES.has(decodedDbName)) {
    throw new Error(
      `[DB:MIGRATE SAFETY BLOCK] Database name '${decodedDbName}' is forbidden for migration execution. Use an approved local development database.`
    );
  }

  // 4. Default-Deny: Remote Host Protection
  if (!ALLOWED_LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `[DB:MIGRATE SAFETY BLOCK] Remote migration target rejected (host: '${hostname}'). Remote migrations are default-denied. Migrations are permitted strictly against approved isolated local databases (localhost, 127.0.0.1, ::1).`
    );
  }

  // 5. Approved Local Database Name Check
  const isApprovedLocalDb =
    decodedDbName.includes("local") ||
    decodedDbName.includes("dev") ||
    decodedDbName.includes("test");

  if (!isApprovedLocalDb) {
    throw new Error(
      `[DB:MIGRATE SAFETY BLOCK] Database name '${decodedDbName}' is not recognized as an approved local development/test database (must contain 'local', 'dev', or 'test', e.g. 'ravinarayana_erp_local').`
    );
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`[DB:MIGRATE SAFETY BLOCK] Invalid port specified: ${parsed.port}`);
  }

  return {
    valid: true,
    hostname,
    port,
    dbName: decodedDbName,
  };
}

/**
 * Loads .env.development.local and .env.local safely into targetEnv object if not already present.
 */
function loadEnvLocal(targetEnv = process.env) {
  const envFiles = [
    path.resolve(__dirname, "../apps/erp/.env.development.local"),
    path.resolve(__dirname, "../apps/erp/.env.local"),
  ];
  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      const envContent = fs.readFileSync(envFile, "utf8");
      for (const line of envContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!targetEnv[key]) {
            targetEnv[key] = val;
          }
        }
      }
    }
  }
}

async function runMigrations(customDbUrl, customFolder) {
  console.log("================================================================================");
  console.log("  RAVI NARAYANA ERP — HARDENED DATABASE MIGRATION RUNNER");
  console.log("================================================================================");

  loadEnvLocal();
  const dbUrl = customDbUrl || process.env.DATABASE_URL || process.env.DIRECT_URL;

  // Fail-closed validation check before any connection attempt
  const targetInfo = validateMigrationTarget(dbUrl);
  console.log(`[DB:MIGRATE] Target validated: host='${targetInfo.hostname}', port=${targetInfo.port}, db='${targetInfo.dbName}' (isolated local)`);

  const postgres = require(path.resolve(__dirname, "../node_modules/postgres"));
  const { drizzle } = require(path.resolve(__dirname, "../node_modules/drizzle-orm/postgres-js"));
  const { migrate } = require(path.resolve(__dirname, "../node_modules/drizzle-orm/postgres-js/migrator"));

  const migrationsFolder = customFolder || path.resolve(__dirname, "../apps/erp/src/server/database/drizzle");
  if (!fs.existsSync(migrationsFolder)) {
    throw new Error(`[DB:MIGRATE] Migrations folder not found at: ${migrationsFolder}`);
  }

  const sql = postgres(dbUrl, { max: 1, connect_timeout: 15 });
  const db = drizzle(sql);

  try {
    console.log(`[DB:MIGRATE] Connecting to local database and applying migrations from: ${migrationsFolder}...`);
    await migrate(db, { migrationsFolder });
    console.log("[DB:MIGRATE] All PostgreSQL migrations applied successfully.");

    // Query applied migrations
    const applied = await sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`;
    console.log(`[DB:MIGRATE] Total applied migrations in DB: ${applied.length}`);
    await sql.end();
    return applied;
  } catch (err) {
    console.error("[DB:MIGRATE] Migration execution error:", err.message);
    try {
      await sql.end();
    } catch {}
    throw err;
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error(`[DB:MIGRATE FATAL] ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  FORBIDDEN_DB_NAMES,
  ALLOWED_LOCAL_HOSTS,
  validateMigrationTarget,
  runMigrations,
};
