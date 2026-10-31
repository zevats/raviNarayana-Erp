/**
 * Local ERP Administrator Provisioning CLI Script
 *
 * Strictly local-only: targets isolated local PostgreSQL (127.0.0.1:5432/ravinarayana_erp_local).
 * Permanently fails closed if target points to any remote host, Neon endpoint, or production database.
 * Reuses the canonical seedInitialPostgresAdmin() implementation from pgIntegration.ts.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

// Register paths so TypeScript compiled modules can be required cleanly
try {
  require("../tests/register_paths.js");
} catch {
  // If already registered or not in test context
}

const FORBIDDEN_PATTERNS = [
  /ravi-narayana-erp-phase01b-test/i,
  /phase01b-test/i,
  /neondb/i,
  /neon\.tech/i,
  /\.aws\./i,
  /prod/i,
  /production/i,
];

const ALLOWED_LOCAL_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
]);

const REQUIRED_LOCAL_DB = "ravinarayana_erp_local";

const ADMIN_BOOTSTRAP_KEYS = ["ERP_ADMIN_EMAIL", "ERP_ADMIN_USERNAME", "ERP_ADMIN_NAME", "ERP_ADMIN_PASSWORD"];

/**
 * Loads the administrator bootstrap settings (ERP_ADMIN_*) from apps/erp/.env.development.local
 * when they are not already set in the environment. Values are never printed.
 */
function loadLocalAdminSettings() {
  const devLocalPath = path.resolve(__dirname, "../apps/erp/.env.development.local");
  if (!fs.existsSync(devLocalPath)) return;
  const content = fs.readFileSync(devLocalPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^"(.*)"$/, "$1");
    if (ADMIN_BOOTSTRAP_KEYS.includes(key) && val && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

/**
 * One-time display of a generated initial password. On an interactive terminal it is printed
 * once; when output is redirected or captured it is written to a file only the current user can
 * read, outside the repository, so it never lands in logs or CI output.
 */
function revealGeneratedPasswordOnce(username, password) {
  if (process.stdout.isTTY) {
    process.stdout.write("\n  Initial administrator password (shown once, not stored anywhere):\n\n");
    process.stdout.write(`      ${username}  /  ${password}\n\n`);
    process.stdout.write("  Sign in and change it from Staff Administration. It cannot be displayed again.\n\n");
    return;
  }
  const dir = path.join(os.homedir(), ".ravinarayan-erp");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "initial-admin-password.txt");
  fs.writeFileSync(file, `${username}\n${password}\n`, { mode: 0o600 });
  console.log(`[LOCAL SEED] Non-interactive output detected: the generated initial password was written to ${file}`);
  console.log("[LOCAL SEED] Read it, sign in, change the password, then delete that file.");
}

/**
 * Loads .env.development.local to ensure isolated local PostgreSQL configuration
 * without accidentally inheriting a cloud DATABASE_URL from .env.local.
 */
function resolveLocalDatabaseUrl() {
  // If explicitly provided in environment, use it directly (it will be strictly validated)
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  // Load from apps/erp/.env.development.local (isolated local development configuration)
  const devLocalPath = path.resolve(__dirname, "../apps/erp/.env.development.local");
  if (fs.existsSync(devLocalPath)) {
    const content = fs.readFileSync(devLocalPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key === "DATABASE_URL" && val) {
          return val;
        }
      }
    }
  }

  // Fallback to standard isolated local container URL if still unset
  return "postgresql://erp_local_user:erp_local_password@127.0.0.1:5432/ravinarayana_erp_local";
}

/**
 * Validates connection target strictly against isolated local boundaries.
 * Fails closed without exposing secrets if any rule is violated.
 */
function validateTarget(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("[LOCAL SEED SAFETY BLOCK] No target database URL provided (fail-closed).");
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch (err) {
    throw new Error(`[LOCAL SEED SAFETY BLOCK] Malformed target database URL: ${err.message}`);
  }

  const protocol = (parsed.protocol || "").toLowerCase();
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new Error(`[LOCAL SEED SAFETY BLOCK] Unsupported protocol '${protocol}'. Only postgres/postgresql allowed.`);
  }

  const hostname = (parsed.hostname || "").toLowerCase().trim();
  if (!ALLOWED_LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `[LOCAL SEED SAFETY BLOCK] Target host '${hostname}' is rejected. Provisioning is strictly limited to local loopback (127.0.0.1, localhost).`
    );
  }

  const pathname = (parsed.pathname || "").replace(/^\/+/, "").toLowerCase().trim();
  const dbName = pathname.split("?")[0];
  if (dbName !== REQUIRED_LOCAL_DB) {
    throw new Error(
      `[LOCAL SEED SAFETY BLOCK] Target database '${dbName}' is rejected. Target database must be exactly '${REQUIRED_LOCAL_DB}'.`
    );
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(rawUrl)) {
      throw new Error(
        "[LOCAL SEED CRITICAL SAFETY BLOCK] Connection string matches protected remote/cloud/production pattern. Seeding aborted."
      );
    }
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
  return { hostname, port, dbName };
}

async function main() {
  console.log("================================================================================");
  console.log("  RAVI NARAYANA ERP — ISOLATED LOCAL ADMINISTRATOR PROVISIONING");
  console.log("================================================================================");

  const dbUrl = resolveLocalDatabaseUrl();
  const target = validateTarget(dbUrl);
  loadLocalAdminSettings();

  console.log(`[LOCAL SEED] Target validated: host='${target.hostname}', port=${target.port}, db='${target.dbName}' (isolated local)`);

  // Ensure execution environment is set to development
  process.env.DATABASE_URL = dbUrl;
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = "development";
  }

  // Load compiled database integration modules
  const {
    seedInitialPostgresAdmin,
    validatePostgresTargetSafety,
  } = require("../tests/dist/apps/erp/src/server/database/pgIntegration");
  const { getAsyncDb } = require("../tests/dist/apps/erp/src/server/database/db");
  const { closePg } = require("../tests/dist/apps/erp/src/server/database/client");

  // Secondary project safety gate
  const safety = validatePostgresTargetSafety(dbUrl);
  if (!safety.safe) {
    throw new Error(`[LOCAL SEED SAFETY BLOCK] Target failed project safety gate: ${safety.reason}`);
  }

  const asyncDb = getAsyncDb();

  try {
    // 1. Check existing staff users
    const countRow = await asyncDb.queryOne("SELECT COUNT(*) as count FROM staff_users");
    const initialCount = Number(countRow?.count || 0);

    if (initialCount > 0) {
      console.log(`[LOCAL SEED NOTICE] staff_users table already contains ${initialCount} user(s).`);
      console.log("[LOCAL SEED NOTICE] Existing accounts preserved intact. Provisioning skipped safely.");
      return;
    }

    console.log("[LOCAL SEED] staff_users is empty (0 users). Provisioning initial SUPER_ADMIN via canonical function...");

    // 2. Execute canonical seeding function
    const result = await seedInitialPostgresAdmin(asyncDb);

    if (!result.seeded) {
      console.log(`[LOCAL SEED RESULT] Provisioning not performed: ${result.message}`);
      return;
    }

    console.log(`[LOCAL SEED RESULT] Initial administrator successfully provisioned: username='${result.username}'`);

    // 3. Verify provisioned administrator record without exposing secrets
    const adminRecord = await asyncDb.queryOne(
      "SELECT id, username, email, full_name as fullName, role, is_active as isActive, created_at as createdAt FROM staff_users WHERE username = ?",
      [result.username]
    );

    if (!adminRecord) {
      throw new Error("[LOCAL SEED VERIFICATION ERROR] Provisioned administrator record was not found after insert.");
    }

    if (Number(adminRecord.isActive) !== 1) {
      throw new Error(`[LOCAL SEED VERIFICATION ERROR] Administrator is not active (isActive = ${adminRecord.isActive}).`);
    }

    if (adminRecord.role !== "SUPER_ADMIN") {
      throw new Error(`[LOCAL SEED VERIFICATION ERROR] Administrator role is '${adminRecord.role}', expected 'SUPER_ADMIN'.`);
    }

    console.log("[LOCAL SEED VERIFICATION] Administrator record verified active:");
    console.log(`  - ID        : ${adminRecord.id}`);
    console.log(`  - Username  : ${adminRecord.username}`);
    console.log(`  - Email     : ${adminRecord.email}`);
    console.log(`  - Role      : ${adminRecord.role}`);
    console.log(`  - Is Active : ${adminRecord.isActive === 1 || adminRecord.isActive === "1" ? "true (1)" : "false"}`);
    console.log(`  - Created At: ${adminRecord.createdAt}`);
    console.log("[LOCAL SEED VERIFICATION] Password hash securely hidden and not exposed.");
    if (result.generatedPassword) {
      revealGeneratedPasswordOnce(result.username, result.generatedPassword);
    }
    console.log("================================================================================");
    console.log("  PROVISIONING COMPLETE");
    console.log("================================================================================");
  } finally {
    await closePg();
  }
}

main().catch((err) => {
  console.error("");
  console.error(`[FATAL LOCAL SEED ERROR] ${err.message}`);
  console.error("");
  process.exit(1);
});
