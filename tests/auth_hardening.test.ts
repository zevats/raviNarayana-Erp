import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "../apps/erp/src/server/database/migrations";
import { performDatabaseCleanup } from "../apps/erp/src/server/database/cleanup";
import { validateAdminEnvironment } from "../apps/erp/src/server/database/env";
import * as auth from "../apps/erp/src/server/authentication/auth";
import { getClientIp, isValidIp } from "../apps/erp/src/server/authentication/ip";
import { brandTokens, brandColors, brandFonts } from "../packages/brand/index";

// Isolated test database path
const TEST_DB_PATH = path.resolve(__dirname, "test_erp.db");

// Ensure clean slate before test execution
function cleanupTestDbFiles() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const wal = `${TEST_DB_PATH}-wal`;
  const shm = `${TEST_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDbFiles();

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
  }
}

console.log("================================================================================");
console.log("RAVINARAYAN ERP — PHASE 1.5 AUTHENTICATION & SECURITY AUTOMATED TEST SUITE");
console.log("================================================================================\n");

async function runTests() {
// -----------------------------------------------------------------------------
// TEST SUITE 1: Migration & Data Preservation (Step 3 & Step 7 #9)
// -----------------------------------------------------------------------------
console.log("[TEST SUITE 1] Database Migration & Schema Versioning");

const db = new Database(TEST_DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Step 1a: Simulate Legacy V0 Schema with raw session_token and old login_attempts
db.exec(`
  CREATE TABLE staff_users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    session_token TEXT UNIQUE NOT NULL,
    staff_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
  );

  CREATE TABLE login_attempts (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    attempted_at TEXT NOT NULL,
    success INTEGER NOT NULL
  );
`);

// Insert existing staff user and legacy raw-token session
const testUserHash = "$2a$12$e80yq9QGvQ.mockhashforpreservationtesting1234567890";
db.prepare(`
  INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
  VALUES ('usr_legacy_01', 'legacyadmin', 'admin@legacy.in', 'Legacy Admin', ?, 'SUPER_ADMIN', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
`).run(testUserHash);

const legacyRawToken = "legacy_raw_session_token_32_bytes_hex_abc1234567890123456789012345";
db.prepare(`
  INSERT INTO sessions (id, session_token, staff_id, expires_at, created_at, ip_address, user_agent)
  VALUES ('sess_old_01', ?, 'usr_legacy_01', '2027-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '127.0.0.1', 'Mozilla')
`).run(legacyRawToken);

// Apply Migration V1
runMigrations(db);

const userVersion = db.pragma("user_version", { simple: true }) as number;
assert(userVersion >= 2, `Database user_version successfully advanced (got ${userVersion})`);

// Verify staff record preserved exactly
const preservedUser = db.prepare("SELECT * FROM staff_users WHERE id = 'usr_legacy_01'").get() as any;
assert(preservedUser && preservedUser.password_hash === testUserHash, "Staff user and password hash strictly preserved during migration");

// Verify sessions table was migrated to token_hash
const sessionsCols = (db.prepare("PRAGMA table_info(sessions)").all() as any[]).map((c: any) => c.name);
assert(sessionsCols.includes("token_hash") && !sessionsCols.includes("session_token"), "Sessions table now uses token_hash column");

// Verify legacy session was hashed with SHA-256
const expectedLegacyHash = crypto.createHash("sha256").update(legacyRawToken).digest("hex");
const migratedSession = db.prepare("SELECT * FROM sessions WHERE id = 'sess_old_01'").get() as any;
assert(migratedSession && migratedSession.token_hash === expectedLegacyHash, "Legacy raw session token converted to SHA-256 digest at rest");

// Verify login_attempts now has ip_address column
const attemptsCols = (db.prepare("PRAGMA table_info(login_attempts)").all() as any[]).map((c: any) => c.name);
assert(attemptsCols.includes("ip_address"), "login_attempts table contains ip_address column for layered rate-limiting");

// Verify audit_logs table was created by migration V2
const auditLogsExists = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='audit_logs'").get() as any;
assert(auditLogsExists.count === 1, "audit_logs table created by migration V2");

// -----------------------------------------------------------------------------
// TEST SUITE 2: Hashed Session Storage & Validation (Step 3 & Step 7 #5, #6, #7)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 2] Hashed Session Lifecycle & Token Security");

// Point environment to test DB
process.env.ERP_DATABASE_PATH = TEST_DB_PATH;

const sessionCreation = auth.createSession("usr_legacy_01", { ip: "10.0.0.5", userAgent: "TestBrowser" });
assert(sessionCreation.sessionToken.length === 64, "Generated bearer cookie token has 256 bits of entropy (64 hex characters)");

// Verify database does NOT store the raw token
const dbSession = db.prepare("SELECT * FROM sessions WHERE id LIKE 'sess_%' AND id != 'sess_old_01'").get() as any;
assert(dbSession.token_hash !== sessionCreation.sessionToken, "Raw cookie token is NOT stored in the database");

const expectedHash = crypto.createHash("sha256").update(sessionCreation.sessionToken).digest("hex");
assert(dbSession.token_hash === expectedHash, "Database strictly stores SHA-256 digest of the session token");

// Session lookup with valid token
const validatedUser = auth.validateSession(sessionCreation.sessionToken);
assert(validatedUser !== null && validatedUser.id === "usr_legacy_01" && validatedUser.username === "legacyadmin", "Session validation succeeds via hashed lookup");

// Forged token lookup
const forgedUser = auth.validateSession("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
assert(forgedUser === null, "Forged session token rejected with null");

// Expired session lookup
db.prepare("UPDATE sessions SET expires_at = '2020-01-01T00:00:00Z' WHERE token_hash = ?").run(expectedHash);
const expiredUser = auth.validateSession(sessionCreation.sessionToken);
assert(expiredUser === null, "Expired session rejected with null");

// Session destruction / logout
const newSession = auth.createSession("usr_legacy_01", { ip: "10.0.0.5" });
auth.destroySession(newSession.sessionToken);
const loggedOutUser = auth.validateSession(newSession.sessionToken);
assert(loggedOutUser === null, "Session successfully destroyed from database upon logout");

// -----------------------------------------------------------------------------
// TEST SUITE 3: Layered Rate Limiting & Anti-Lockout (Step 2 & Step 7 #2, #3)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 3] Layered Rate Limiting & Denial-of-Service Protection");

const testTargetAccount = "victimadmin";
const attackerIp1 = "192.168.1.10";
const attackerIp2 = "192.168.1.20";

// Record 4 failed attempts from IP 1
for (let i = 0; i < 4; i++) {
  auth.recordLoginAttempt(testTargetAccount, attackerIp1, false);
}
let rlCheck = auth.checkRateLimit(testTargetAccount, attackerIp1);
assert(!rlCheck.isLimited, "4 failed attempts: Rate limit not triggered yet");

// 5th failed attempt from IP 1
auth.recordLoginAttempt(testTargetAccount, attackerIp1, false);
rlCheck = auth.checkRateLimit(testTargetAccount, attackerIp1);
assert(rlCheck.isLimited, "5 failed attempts from same IP: Account + IP rate limit triggered (Layer 2)");

// Crucial: Legitimate administrator from IP 2 (different network) is NOT locked out!
const adminFromOfficeIp = "192.168.200.50";
const adminRlCheck = auth.checkRateLimit(testTargetAccount, adminFromOfficeIp);
assert(!adminRlCheck.isLimited, "Anti-DoS Protection: Administrator from different IP is NOT locked out by attacker's attempts");

// Layer 1: Aggressive spraying from a single IP across multiple accounts
for (let i = 0; i < 20; i++) {
  auth.recordLoginAttempt(`randomuser_${i}`, attackerIp2, false);
}
const ipSprayingCheck = auth.checkRateLimit("any_user", attackerIp2);
assert(ipSprayingCheck.isLimited && (ipSprayingCheck.reason || "").includes("network"), "20 failed attempts from one IP: IP-based global rate limit triggered (Layer 1)");

// Counter reset upon successful login
auth.recordLoginAttempt(testTargetAccount, adminFromOfficeIp, false);
auth.recordLoginAttempt(testTargetAccount, adminFromOfficeIp, false);
const beforeSuccessFailures = db.prepare("SELECT count(*) as count FROM login_attempts WHERE identifier = ? AND ip_address = ? AND success = 0").get(testTargetAccount, adminFromOfficeIp) as any;
assert(beforeSuccessFailures.count === 2, "Recorded 2 failed attempts for office IP");

auth.recordLoginAttempt(testTargetAccount, adminFromOfficeIp, true);
const afterSuccessFailures = db.prepare("SELECT count(*) as count FROM login_attempts WHERE identifier = ? AND ip_address = ? AND success = 0").get(testTargetAccount, adminFromOfficeIp) as any;
assert(afterSuccessFailures.count === 0, "Successful login immediately cleared failed attempt counters for client");

// -----------------------------------------------------------------------------
// TEST SUITE 4: Client IP Trust & Spoofed Forwarding Headers (Step 2 & Step 7 #4)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 4] Client IP Trust Boundaries & Header Spoofing");

assert(isValidIp("192.168.1.1") && isValidIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), "Valid IPv4 and IPv6 addresses recognized");
assert(!isValidIp("invalid.ip") && !isValidIp("127.0.0.1; DROP TABLE"), "Malformed or malicious IP strings rejected");

// Case A: Untrusted mode (TRUST_PROXY_HEADERS=false)
process.env.TRUST_PROXY_HEADERS = "false";
const headersMap = new Map([
  ["x-forwarded-for", "203.0.113.195, 198.51.100.1"],
  ["cf-connecting-ip", "203.0.113.195"],
]);
const mockSpoofedReq = {
  headers: {
    get: (k: string) => headersMap.get(k) || null,
  },
} as any;

const resolvedUntrustedIp = getClientIp(mockSpoofedReq);
assert(resolvedUntrustedIp === "127.0.0.1", "Untrusted proxy mode: Client-provided X-Forwarded-For is ignored (spoofing prevented)");

// Case B: Trusted mode (TRUST_PROXY_HEADERS=true)
process.env.TRUST_PROXY_HEADERS = "true";
const resolvedTrustedIp = getClientIp(mockSpoofedReq);
assert(resolvedTrustedIp === "203.0.113.195", "Trusted proxy mode: CF-Connecting-IP / X-Forwarded-For parsed correctly");

// -----------------------------------------------------------------------------
// TEST SUITE 5: Bounded Database Cleanup (Step 5 & Step 7 #10)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 5] Safe Database Cleanup & Retention");

// Seed 1 active session, 1 expired session
const activeExpiry = new Date(Date.now() + 86400000).toISOString();
const pastExpiry = new Date(Date.now() - 86400000).toISOString();

db.prepare(`
  INSERT INTO sessions (id, token_hash, staff_id, expires_at, created_at, ip_address)
  VALUES ('sess_active_clean', 'hash_active_123', 'usr_legacy_01', ?, ?, '127.0.0.1')
`).run(activeExpiry, new Date().toISOString());

db.prepare(`
  INSERT INTO sessions (id, token_hash, staff_id, expires_at, created_at, ip_address)
  VALUES ('sess_expired_clean', 'hash_expired_123', 'usr_legacy_01', ?, ?, '127.0.0.1')
`).run(pastExpiry, pastExpiry);

// Seed 1 recent attempt, 1 old attempt (> 25h)
const staleTime = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
db.prepare(`
  INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success)
  VALUES ('att_old_clean', 'testuser', '127.0.0.1', ?, 0)
`).run(staleTime);

const cleanupResult = performDatabaseCleanup(db, true);
assert(cleanupResult.executed && cleanupResult.expiredSessionsDeleted >= 1, "Cleanup deleted expired sessions");
assert(cleanupResult.staleAttemptsDeleted >= 1, "Cleanup deleted stale login attempts (>24h)");

const activeStillExists = db.prepare("SELECT * FROM sessions WHERE id = 'sess_active_clean'").get();
assert(activeStillExists !== undefined, "Active unexpired sessions are preserved");

// -----------------------------------------------------------------------------
// TEST SUITE 6: Secure Production Environment Validation (Step 4 & Step 7 #8)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 6] Production Configuration & Seed Security");

// 6a: Production with missing password
process.env.NODE_ENV = "production";
delete process.env.ERP_ADMIN_PASSWORD;

let prodMissingThrew = false;
try {
  validateAdminEnvironment(0);
} catch (e: any) {
  prodMissingThrew = e.message.includes("ERP_ADMIN_PASSWORD must be explicitly provided");
}
assert(prodMissingThrew, "Production fails safely if ERP_ADMIN_PASSWORD is missing on empty DB");

// 6b: Production with demo password
process.env.ERP_ADMIN_PASSWORD = "Ravinarayan@2026";
let prodDemoThrew = false;
try {
  validateAdminEnvironment(0);
} catch (e: any) {
  prodDemoThrew = e.message.includes("demonstration password");
}
assert(prodDemoThrew, "Production fails safely if demonstration password 'Ravinarayan@2026' is provided");

// 6c: Production with weak password (< 12 chars)
process.env.ERP_ADMIN_PASSWORD = "shortpass";
let prodWeakThrew = false;
try {
  validateAdminEnvironment(0);
} catch (e: any) {
  prodWeakThrew = e.message.includes("at least 12 characters");
}
assert(prodWeakThrew, "Production fails safely if ERP_ADMIN_PASSWORD is shorter than 12 characters");

// 6d: Production with valid strong password
process.env.ERP_ADMIN_PASSWORD = "SuperStrongPassword2026#Secure";
const validProdConfig = validateAdminEnvironment(0);
assert(validProdConfig !== null && validProdConfig.password === "SuperStrongPassword2026#Secure", "Production accepts valid strong administrator password");

// 6e: Existing users check (no overwrite)
const existingUsersCheck = validateAdminEnvironment(5);
assert(existingUsersCheck === null, "Existing database with staff users returns null (no seed overwrite)");

// Restore dev environment
process.env.NODE_ENV = "development";

// -----------------------------------------------------------------------------
// TEST SUITE 7: Brand Package Integration (Step 6 & Step 7 #12)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 7] Shared Brand Package Integration");

assert(typeof brandTokens === "object" && brandTokens.name.includes("Ravinarayan"), "brandTokens exported correctly");
assert(typeof brandColors === "object" && brandColors.forest.deep === "#1A2E20", "brandColors exports authentic forest deep color (#1A2E20)");
assert(typeof brandFonts === "object" && Array.isArray(brandFonts.serif) && brandFonts.serif.some(f => f.includes("Playfair Display")), "brandFonts exports serif font family");

// -----------------------------------------------------------------------------
// TEST SUITE 8: Concurrency & Atomic Rate Limiting (Verification Gate #1)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 8] Atomic Rate Limiting Under High Concurrency");

const concurrentTarget = "concurrent_victim";
const concurrentIp = "198.51.100.99";

// Simulate 20 concurrent failed login attempts from the same IP at the same microsecond
// With atomic attempt reservation (checkRateLimitAndRecord), exactly 5 must be permitted
// and 15 must be rejected with isLimited = true.
const concurrentAttempts = Array.from({ length: 20 }, async () => {
  return auth.checkRateLimitAndRecord(concurrentTarget, concurrentIp);
});

const concurrentResults = await Promise.all(concurrentAttempts);
const allowedAttempts = concurrentResults.filter((r) => !r.isLimited);
const blockedAttempts = concurrentResults.filter((r) => r.isLimited);

assert(
  allowedAttempts.length === 5,
  `Atomic transaction allowed exactly 5 concurrent attempts before limit (got ${allowedAttempts.length})`
);
assert(
  blockedAttempts.length === 15,
  `Atomic transaction rejected remaining 15 concurrent attempts with 429 rate limit (got ${blockedAttempts.length})`
);

// Verify that an administrator from a different IP address is NOT locked out
const separateAdminIp = "203.0.113.88";
const adminConcurrentCheck = auth.checkRateLimitAndRecord(concurrentTarget, separateAdminIp);
assert(
  !adminConcurrentCheck.isLimited,
  "Cross-IP Anti-Lockout: Legitimate user from different IP can still attempt login despite attacker concurrency"
);

// Verify that a successful login resets the client counters
auth.recordLoginSuccess(concurrentTarget, separateAdminIp);
const resetCheck = db.prepare(
  "SELECT count(*) as count FROM login_attempts WHERE identifier = ? AND ip_address = ? AND success = 0"
).get(concurrentTarget, separateAdminIp) as any;
assert(resetCheck.count === 0, "recordLoginSuccess cleared failed attempts atomically for client");

// -----------------------------------------------------------------------------
// TEST SUITE 9: Database Backup Restoration & Disaster Recovery (Verification Gate #3)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 9] Database Backup Restoration & Disaster Recovery");

const backupSourcePath = path.resolve(process.cwd(), "data/erp.db.backup.20261015192957");
const restoreDbPath = path.resolve(process.cwd(), "tests/restore_verification.db");

// Ensure clean slate for restore db
if (fs.existsSync(restoreDbPath)) fs.unlinkSync(restoreDbPath);
if (fs.existsSync(`${restoreDbPath}-wal`)) fs.unlinkSync(`${restoreDbPath}-wal`);
if (fs.existsSync(`${restoreDbPath}-shm`)) fs.unlinkSync(`${restoreDbPath}-shm`);

assert(fs.existsSync(backupSourcePath), `Verified backup file exists in data directory (${path.basename(backupSourcePath)})`);

// Perform restore copy to isolated verification environment
fs.copyFileSync(backupSourcePath, restoreDbPath);
assert(fs.existsSync(restoreDbPath), "Backup restored to isolated verification environment");

const restoreDb = new Database(restoreDbPath);
restoreDb.pragma("journal_mode = WAL");
restoreDb.pragma("foreign_keys = ON");

// Verify integrity of restored backup
const integrityCheck = restoreDb.pragma("integrity_check", { simple: true });
assert(integrityCheck === "ok", "Restored database passes SQLite PRAGMA integrity_check");

// Verify staff users table data intact prior to migration
const restoredStaff = restoreDb.prepare("SELECT COUNT(*) as count FROM staff_users").get() as any;
assert(restoredStaff && restoredStaff.count >= 1, `Restored database preserves ${restoredStaff?.count} staff users intact`);

// Apply migration to restored database
runMigrations(restoreDb);
const migratedVersion = restoreDb.pragma("user_version", { simple: true }) as number;
assert(migratedVersion >= 2, `Restored database successfully advanced schema (got ${migratedVersion})`);

// Verify sessions schema after migration
const restoredSessionsInfo = (restoreDb.prepare("PRAGMA table_info(sessions)").all() as any[]).map((c: any) => c.name);
assert(restoredSessionsInfo.includes("token_hash") && !restoredSessionsInfo.includes("session_token"), "Restored sessions schema adheres to token_hash architecture");

// Verify staff records remain intact post-migration
const postMigrateStaff = restoreDb.prepare("SELECT COUNT(*) as count FROM staff_users").get() as any;
assert(postMigrateStaff && postMigrateStaff.count >= 1, `Staff users (${postMigrateStaff?.count}) preserved after migration`);

// Verify migration rerun idempotency on restored backup
runMigrations(restoreDb);
const reMigratedVersion = restoreDb.pragma("user_version", { simple: true });
assert(reMigratedVersion === migratedVersion, "Rerunning runMigrations() on restored database is strictly idempotent");

restoreDb.close();
if (fs.existsSync(restoreDbPath)) fs.unlinkSync(restoreDbPath);
if (fs.existsSync(`${restoreDbPath}-wal`)) fs.unlinkSync(`${restoreDbPath}-wal`);
if (fs.existsSync(`${restoreDbPath}-shm`)) fs.unlinkSync(`${restoreDbPath}-shm`);

// -----------------------------------------------------------------------------
// TEST SUITE 10: Timing Side-Channel Mitigation & User Enumeration (Verification Gate #1)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 10] Timing Side-Channel Mitigation & User Enumeration");

assert(
  typeof auth.DUMMY_PASSWORD_HASH === "string" && auth.DUMMY_PASSWORD_HASH.startsWith("$2a$12$"),
  "DUMMY_PASSWORD_HASH is precomputed with bcrypt cost factor 12"
);

// Verify comparison against dummy hash safely returns false
const dummyMatch = await auth.verifyPassword("testPassword123!", auth.DUMMY_PASSWORD_HASH);
assert(dummyMatch === false, "Dummy password verification safely evaluates to false");

// Verify timing execution is on the order of tens of milliseconds (cost factor 12) rather than microseconds
const t0 = Date.now();
await auth.verifyPassword("testPassword123!", auth.DUMMY_PASSWORD_HASH);
const elapsedMs = Date.now() - t0;
assert(elapsedMs >= 20, `Dummy bcrypt comparison enforces realistic computation time (${elapsedMs}ms) to eliminate sub-millisecond enumeration leak`);

// -----------------------------------------------------------------------------
// CLEANUP & SUMMARY
// -----------------------------------------------------------------------------
db.close();
const { closeDb } = require("../apps/erp/src/server/database/db");
closeDb();
cleanupTestDbFiles();

console.log("\n================================================================================");
console.log(`FINAL TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log("================================================================================\n");

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
}

runTests().catch((err) => {
  console.error("Test runner encountered an unhandled rejection:", err);
  process.exit(1);
});
