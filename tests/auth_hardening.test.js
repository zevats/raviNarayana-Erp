const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

// Test database location
const TEST_DB_PATH = path.resolve(__dirname, "test_erp.db");

// Ensure clean slate for test DB
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
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
const { runMigrations } = require("../apps/erp/src/server/database/migrations");
runMigrations(db);

const userVersion = db.pragma("user_version", { simple: true });
assert(userVersion === 1, "Database user_version successfully advanced to 1");

// Verify staff record preserved exactly
const preservedUser = db.prepare("SELECT * FROM staff_users WHERE id = 'usr_legacy_01'").get();
assert(preservedUser && preservedUser.password_hash === testUserHash, "Staff user and password hash strictly preserved during migration");

// Verify sessions table was migrated to token_hash
const sessionsCols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
assert(sessionsCols.includes("token_hash") && !sessionsCols.includes("session_token"), "Sessions table now uses token_hash column");

// Verify legacy session was hashed with SHA-256
const expectedLegacyHash = crypto.createHash("sha256").update(legacyRawToken).digest("hex");
const migratedSession = db.prepare("SELECT * FROM sessions WHERE id = 'sess_old_01'").get();
assert(migratedSession && migratedSession.token_hash === expectedLegacyHash, "Legacy raw session token converted to SHA-256 digest at rest");

// Verify login_attempts now has ip_address column
const attemptsCols = db.prepare("PRAGMA table_info(login_attempts)").all().map(c => c.name);
assert(attemptsCols.includes("ip_address"), "login_attempts table contains ip_address column for layered rate-limiting");

// -----------------------------------------------------------------------------
// TEST SUITE 2: Hashed Session Storage & Validation (Step 3 & Step 7 #5, #6, #7)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 2] Hashed Session Lifecycle & Token Security");

// Point environment to test DB
process.env.ERP_DATABASE_PATH = TEST_DB_PATH;
const auth = require("../apps/erp/src/server/authentication/auth");

const sessionCreation = auth.createSession("usr_legacy_01", { ip: "10.0.0.5", userAgent: "TestBrowser" });
assert(sessionCreation.sessionToken.length === 64, "Generated bearer cookie token has 256 bits of entropy (64 hex characters)");

// Verify database does NOT store the raw token
const dbSession = db.prepare("SELECT * FROM sessions WHERE id LIKE 'sess_%' AND id != 'sess_old_01'").get();
assert(dbSession.token_hash !== sessionCreation.sessionToken, "Raw cookie token is NOT stored in the database");

const expectedHash = crypto.createHash("sha256").update(sessionCreation.sessionToken).digest("hex");
assert(dbSession.token_hash === expectedHash, "Database strictly stores SHA-256 digest of the session token");

// Session lookup with valid token
const validatedUser = auth.validateSession(sessionCreation.sessionToken);
assert(validatedUser && validatedUser.id === "usr_legacy_01" && validatedUser.username === "legacyadmin", "Session validation succeeds via hashed lookup");

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
assert(ipSprayingCheck.isLimited && ipSprayingCheck.reason.includes("network"), "20 failed attempts from one IP: IP-based global rate limit triggered (Layer 1)");

// Counter reset upon successful login
auth.recordLoginAttempt(testTargetAccount, adminFromOfficeIp, false);
auth.recordLoginAttempt(testTargetAccount, adminFromOfficeIp, false);
const beforeSuccessFailures = db.prepare("SELECT count(*) as count FROM login_attempts WHERE identifier = ? AND ip_address = ? AND success = 0").get(testTargetAccount, adminFromOfficeIp);
assert(beforeSuccessFailures.count === 2, "Recorded 2 failed attempts for office IP");

auth.recordLoginAttempt(testTargetAccount, adminFromOfficeIp, true);
const afterSuccessFailures = db.prepare("SELECT count(*) as count FROM login_attempts WHERE identifier = ? AND ip_address = ? AND success = 0").get(testTargetAccount, adminFromOfficeIp);
assert(afterSuccessFailures.count === 0, "Successful login immediately cleared failed attempt counters for client");

// -----------------------------------------------------------------------------
// TEST SUITE 4: Client IP Trust & Spoofed Forwarding Headers (Step 2 & Step 7 #4)
// -----------------------------------------------------------------------------
console.log("\n[TEST SUITE 4] Client IP Trust Boundaries & Header Spoofing");

const { getClientIp, isValidIp } = require("../apps/erp/src/server/authentication/ip");

assert(isValidIp("192.168.1.1") && isValidIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334"), "Valid IPv4 and IPv6 addresses recognized");
assert(!isValidIp("invalid.ip") && !isValidIp("127.0.0.1; DROP TABLE"), "Malformed or malicious IP strings rejected");

// Case A: Untrusted mode (TRUST_PROXY_HEADERS=false)
process.env.TRUST_PROXY_HEADERS = "false";
const mockSpoofedReq = {
  headers: new Map([
    ["x-forwarded-for", "203.0.113.195, 198.51.100.1"],
    ["cf-connecting-ip", "203.0.113.195"],
  ]),
};
mockSpoofedReq.headers.get = (k) => mockSpoofedReq.headers.get(k);

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

const { performDatabaseCleanup } = require("../apps/erp/src/server/database/cleanup");

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

const { validateAdminEnvironment } = require("../apps/erp/src/server/database/env");

// 6a: Production with missing password
process.env.NODE_ENV = "production";
delete process.env.ERP_ADMIN_PASSWORD;

let prodMissingThrew = false;
try {
  validateAdminEnvironment(0);
} catch (e) {
  prodMissingThrew = e.message.includes("ERP_ADMIN_PASSWORD must be explicitly provided");
}
assert(prodMissingThrew, "Production fails safely if ERP_ADMIN_PASSWORD is missing on empty DB");

// 6b: Production with demo password
process.env.ERP_ADMIN_PASSWORD = "Ravinarayan@2026";
let prodDemoThrew = false;
try {
  validateAdminEnvironment(0);
} catch (e) {
  prodDemoThrew = e.message.includes("demonstration password");
}
assert(prodDemoThrew, "Production fails safely if demonstration password 'Ravinarayan@2026' is provided");

// 6c: Production with weak password (< 12 chars)
process.env.ERP_ADMIN_PASSWORD = "weakpassword";
let prodWeakThrew = false;
try {
  validateAdminEnvironment(0);
} catch (e) {
  prodWeakThrew = e.message.includes("at least 12 characters");
}
assert(prodWeakThrew, "Production fails safely if ERP_ADMIN_PASSWORD is shorter than 12 characters");

// 6d: Production with valid strong password
process.env.ERP_ADMIN_PASSWORD = "SuperStrongPassword2026#Secure";
const validProdConfig = validateAdminEnvironment(0);
assert(validProdConfig && validProdConfig.password === "SuperStrongPassword2026#Secure", "Production accepts valid strong administrator password");

// 6e: Existing users check (no overwrite)
const existingUsersCheck = validateAdminEnvironment(5);
assert(existingUsersCheck === null, "Existing database with staff users returns null (no seed overwrite)");

// Restore dev environment
process.env.NODE_ENV = "development";

// -----------------------------------------------------------------------------
// CLEANUP & SUMMARY
// -----------------------------------------------------------------------------
db.close();
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}
const walPath = `${TEST_DB_PATH}-wal`;
const shmPath = `${TEST_DB_PATH}-shm`;
if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

console.log("\n================================================================================");
console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log("================================================================================\n");

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
