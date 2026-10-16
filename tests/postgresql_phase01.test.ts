import crypto from "crypto";
import path from "path";
import fs from "fs";
import { pathToFileURL } from "url";
import { NextRequest } from "next/server";

import {
  createOtpChallenge,
  verifyOtpChallenge,
  initiatePasswordReset,
  completePasswordReset,
  createSession,
  validateSessionDetailed,
  revokeAllUserSessions,
  destroySession,
  maskEmail,
} from "../apps/erp/src/server/authentication/auth";
import {
  getEmailAdapter,
  setEmailAdapterForTesting,
  mockSentEmails,
  clearMockSentEmails,
  MockEmailAdapter,
} from "../apps/erp/src/server/notifications/emailAdapter";
import { validateCsrf, ERP_COOKIE_NAME } from "../apps/erp/src/server/security/csrf";
import { pingDatabase, isPostgresConfigured, getDatabaseUrl } from "../apps/erp/src/server/database/client";
import {
  migrateSqliteToPostgres,
  rollbackPostgresMigration,
  TABLES_IN_ORDER,
} from "../apps/erp/src/server/database/migrateSqliteToPg";
import { resolveDbPath, getDb, getAsyncDb, closeDb } from "../apps/erp/src/server/database/db";
import { validateProductionDatabaseEnvironment } from "../apps/erp/src/server/database/env";

let passCount = 0;
let failCount = 0;
let blockedCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
  }
}

function assertBlocked(reason: string, message: string) {
  console.log(`  ⚠ BLOCKED: ${message} (Prerequisite: ${reason})`);
  blockedCount++;
}

console.log("================================================================================");
console.log("RAVINARAYAN ERP — PHASE 01: POSTGRESQL, AUTHENTICATION & SECURITY TEST SUITE");
console.log("================================================================================\n");

async function runPhase01Tests() {
  // Ensure MockEmailAdapter is active for testing
  setEmailAdapterForTesting(new MockEmailAdapter());
  clearMockSentEmails();

  const db = getDb();

  // ---------------------------------------------------------------------------
  // TEST SUITE 1: Drizzle PostgreSQL Schema & Versioning
  // ---------------------------------------------------------------------------
  console.log("[TEST SUITE 1] PostgreSQL Schema Definition & Versioned Migrations");

  const drizzleDir = path.resolve(process.cwd(), "apps/erp/src/server/database/drizzle");
  assert(fs.existsSync(drizzleDir), "Drizzle migrations directory exists");

  const migrationFiles = fs.readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));
  assert(migrationFiles.length >= 2, `Generated Drizzle SQL migrations exist (found ${migrationFiles.length} migrations)`);

  const initialSql = fs.readFileSync(path.join(drizzleDir, migrationFiles[0]), "utf8");
  assert(initialSql.includes('CREATE TABLE "staff_users"'), "Migration defines staff_users table");
  assert(initialSql.includes('CREATE TABLE "rooms"'), "Migration defines rooms table");
  assert(initialSql.includes('CREATE TABLE "residents"'), "Migration defines residents table");
  assert(initialSql.includes('CREATE TABLE "resident_stays"'), "Migration defines resident_stays table");
  assert(initialSql.includes('CREATE TABLE "financial_transactions"'), "Migration defines financial_transactions table");
  assert(initialSql.includes('CREATE TABLE "auth_challenges"'), "Migration defines auth_challenges table for Email OTP");
  assert(initialSql.includes('CREATE TABLE "password_resets"'), "Migration defines password_resets table for recovery");
  assert(
    initialSql.includes('idx_rooms_number_nocase') && initialSql.includes('lower("room_number")'),
    "Migration enforces case-insensitive room number uniqueness via functional index"
  );
  assert(
    initialSql.includes('idx_unique_active_resident_stay'),
    "Migration enforces at most 1 active stay per resident via partial unique index"
  );
  assert(
    initialSql.includes('chk_fin_tx_amount'),
    "Migration enforces positive financial amount check constraint (whole INR)"
  );

  // Check second migration for session_preemptions table
  const allSqlContent = migrationFiles
    .map((f) => fs.readFileSync(path.join(drizzleDir, f), "utf8"))
    .join("\n");
  assert(allSqlContent.includes('CREATE TABLE "session_preemptions"'), "Migration defines persistent session_preemptions register");

  // Verify all 18 tables are registered in migration order
  assert(TABLES_IN_ORDER.length === 18, `All 18 operational tables mapped in topological order (got ${TABLES_IN_ORDER.length})`);

  // ---------------------------------------------------------------------------
  // TEST SUITE 2: Email OTP Challenge Lifecycle & Security
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Email OTP Two-Factor Authentication Lifecycle");

  const testStaffId = "usr_test_otp_user";
  const testEmail = "doctor.test@ravinarayan.in";
  db.prepare(`
    INSERT OR REPLACE INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, 'test_otp_doctor', ?, 'Dr. OTP Tester', 'dummy_hash', 'SUPER_ADMIN', 1, ?, ?)
  `).run(testStaffId, testEmail, new Date().toISOString(), new Date().toISOString());

  const challengeRes = await createOtpChallenge(testStaffId, testEmail);
  assert(challengeRes.challengeId.startsWith("chl_"), "Generated prefixed challenge ID");
  assert(challengeRes.maskedEmail === "d***t@ravinarayan.in", "Masked email generated without exposing full address");

  assert(mockSentEmails.length === 1, "OTP dispatched via email adapter");
  const sentOtpEmail = mockSentEmails[0];
  const otpMatch = (sentOtpEmail.text || sentOtpEmail.html).match(/([0-9]{6})/);
  assert(otpMatch !== null, "Dispatched email contains 6-digit numeric OTP");
  const plaintextOtp = otpMatch ? otpMatch[1] : "";
  const numericOtp = parseInt(plaintextOtp, 10);
  assert(numericOtp >= 100000 && numericOtp <= 999999, "Generated OTP falls within inclusive 100000..999999 numeric range");

  const challengeDbRow = db
    .prepare("SELECT * FROM auth_challenges WHERE id = ?")
    .get(challengeRes.challengeId) as any;
  assert(challengeDbRow !== undefined, "Challenge persisted in auth_challenges table");
  assert(challengeDbRow.otp_hash !== plaintextOtp, "Plaintext OTP is strictly NOT stored in the database");
  const expectedHash = crypto.createHash("sha256").update(plaintextOtp).digest("hex");
  assert(challengeDbRow.otp_hash === expectedHash, "Database stores SHA-256 one-way digest of OTP");

  let throttledBlocked = false;
  try {
    await createOtpChallenge(testStaffId, testEmail);
  } catch (err: any) {
    throttledBlocked = err.message.includes("wait");
  }
  assert(throttledBlocked, "Resend throttling strictly enforced within 60-second window");

  let badAttemptBlocked = false;
  try {
    await verifyOtpChallenge(challengeRes.challengeId, "000000");
  } catch (err: any) {
    badAttemptBlocked = err.message.includes("2 attempts remaining");
  }
  assert(badAttemptBlocked, "Invalid OTP increments attempt counter and reports remaining attempts");

  try {
    await verifyOtpChallenge(challengeRes.challengeId, "000001");
  } catch {}
  let thirdFailedThrew = false;
  try {
    await verifyOtpChallenge(challengeRes.challengeId, "000002");
  } catch (err: any) {
    thirdFailedThrew = err.message.includes("invalidated");
  }
  assert(thirdFailedThrew, "Challenge automatically invalidated and deleted on 3rd failed attempt");

  const purgedChallenge = db
    .prepare("SELECT * FROM auth_challenges WHERE id = ?")
    .get(challengeRes.challengeId);
  assert(purgedChallenge === undefined, "Invalidated challenge purged from database");

  db.prepare("DELETE FROM auth_challenges WHERE staff_id = ?").run(testStaffId);
  clearMockSentEmails();
  const freshChallenge = await createOtpChallenge(testStaffId, testEmail);
  const freshOtpMatch = (mockSentEmails[0].text || mockSentEmails[0].html).match(/([0-9]{6})/);
  const freshOtp = freshOtpMatch ? freshOtpMatch[1] : "";

  const verifySuccess = await verifyOtpChallenge(freshChallenge.challengeId, freshOtp, {
    ip: "127.0.0.1",
    userAgent: "JestTestRunner",
  });
  assert(verifySuccess.user.id === testStaffId, "OTP verification authenticated correct staff user");
  assert(verifySuccess.sessionToken.length === 64, "Issued 256-bit cryptographically secure session token");

  let replayBlocked = false;
  try {
    await verifyOtpChallenge(freshChallenge.challengeId, freshOtp);
  } catch (err: any) {
    replayBlocked = err.message.includes("Invalid or expired");
  }
  assert(replayBlocked, "Replay of used OTP challenge is strictly rejected (single-use guarantee)");

  // ---------------------------------------------------------------------------
  // TEST SUITE 3: Password Recovery Workflow
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Self-Service Password Recovery (Forgot/Reset)");

  clearMockSentEmails();
  const nonExistentResult = await initiatePasswordReset("nonexistent_user@ravinarayan.in");
  assert(nonExistentResult.success === true, "Nonexistent account identifier returns generic success (no user enumeration)");
  assert(mockSentEmails.length === 0, "No email sent for non-existent user");

  const validForgotResult = await initiatePasswordReset("test_otp_doctor");
  assert(validForgotResult.success === true, "Valid account returns generic confirmation");
  assert(mockSentEmails.length === 1, "Password reset link sent to registered email");

  const resetEmail = mockSentEmails[0];
  const tokenMatch = (resetEmail.text || resetEmail.html).match(/token=([a-f0-9]{64})/);
  assert(tokenMatch !== null, "Reset email contains 256-bit hexadecimal reset token");
  const rawResetToken = tokenMatch ? tokenMatch[1] : "";

  const expectedTokenHash = crypto.createHash("sha256").update(rawResetToken).digest("hex");
  const resetDbRow = db
    .prepare("SELECT * FROM password_resets WHERE token_hash = ?")
    .get(expectedTokenHash) as any;
  assert(resetDbRow !== undefined, "Password reset record created in database");
  assert(resetDbRow.token_hash !== rawResetToken, "Plaintext reset token is strictly NOT stored in database");
  assert(resetDbRow.token_hash === expectedTokenHash, "Database stores SHA-256 digest of reset token");
  assert(resetDbRow.used_at === null, "Token initialized as unused (used_at IS NULL)");

  const weakPasswordResult = await completePasswordReset(rawResetToken, "short");
  assert(
    weakPasswordResult.success === false && Boolean(weakPasswordResult.error?.includes("at least 12 characters")),
    "Reset rejects passwords shorter than 12 characters"
  );

  const resetSuccess = await completePasswordReset(rawResetToken, "NewSecurePassword2026!#Strong");
  assert(resetSuccess.success === true, "Password reset completed successfully");

  const replayReset = await completePasswordReset(rawResetToken, "AnotherStrongPassword2026!#");
  assert(replayReset.success === false, "Replay of already consumed reset token is strictly rejected");

  // ---------------------------------------------------------------------------
  // TEST SUITE 4: Single Active Session Preemption & Process Restart Persistence
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Single Active Session Preemption & Process Restart Persistence");

  // 4a: Device 1 login
  const sessionDevice1 = createSession(testStaffId, { ip: "192.168.1.1", userAgent: "Laptop", preempt: true });
  assert(validateSessionDetailed(sessionDevice1.sessionToken).user !== null, "Device 1 session is initially valid");

  // 4b: Device 2 login with preemption -> Device 1 session must be preempted atomically
  const sessionDevice2 = createSession(testStaffId, { ip: "192.168.1.2", userAgent: "Mobile", preempt: true });
  assert(validateSessionDetailed(sessionDevice2.sessionToken).user !== null, "Device 2 session is active");

  // 4c: Validate Device 1: Must be recognized as PREEMPTED
  const device1Check = validateSessionDetailed(sessionDevice1.sessionToken);
  assert(device1Check.user === null, "Device 1 session can no longer access protected resources");
  assert(device1Check.isPreempted === true, "Preempted session specifically recognized with isPreempted: true");

  // 4d: PROCESS RESTART PERSISTENCE VERIFICATION:
  // Close database connection to simulate complete server/process shutdown
  closeDb();
  // Re-open fresh database connection
  const reopenedDb = getDb();
  assert(reopenedDb.open === true, "Database connection re-opened after simulated process restart");

  // Device 1 session MUST STILL be recognized as preempted from the persistent database table
  const device1AfterRestart = validateSessionDetailed(sessionDevice1.sessionToken);
  assert(device1AfterRestart.user === null, "Device 1 remains unauthenticated after process restart");
  assert(device1AfterRestart.isPreempted === true, "Preemption status persists across process restarts via database table");

  // 4e: Explicit user logout (destroySession) does not mark session as preempted
  destroySession(sessionDevice2.sessionToken);
  const device2AfterLogout = validateSessionDetailed(sessionDevice2.sessionToken);
  assert(device2AfterLogout.user === null, "Logged-out session is invalidated");
  assert(device2AfterLogout.isPreempted !== true, "Logged-out session returns standard 401 without preemption flag");

  // 4f: Cleanup
  revokeAllUserSessions(testStaffId);

  // ---------------------------------------------------------------------------
  // TEST SUITE 5: Cross-Site Request Forgery (CSRF) Defense
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Cross-Site Request Forgery (CSRF) Origin Validation");

  // 5a: Legitimate same-origin POST request
  const legitReq = new NextRequest("http://localhost:3001/api/rooms", {
    method: "POST",
    headers: {
      origin: "http://localhost:3001",
      host: "localhost:3001",
    },
  });
  assert(validateCsrf(legitReq).valid === true, "Same-origin mutating request accepted");

  // 5b: Malicious cross-origin POST request from attacker.com
  const attackerReq = new NextRequest("http://localhost:3001/api/rooms", {
    method: "POST",
    headers: {
      origin: "https://evil-attacker.com",
      host: "localhost:3001",
    },
  });
  const attackerResult = validateCsrf(attackerReq);
  assert(attackerResult.valid === false, "Cross-origin mutating request strictly rejected");
  assert(attackerResult.error?.includes("CSRF policy"), "CSRF rejection includes explanatory reason");

  // 5c: Public constant header MUST NOT bypass a hostile origin
  const hostileWithCustomHeader = new NextRequest("http://localhost:3001/api/rooms", {
    method: "POST",
    headers: {
      origin: "https://evil-attacker.com",
      host: "localhost:3001",
      "x-rn-csrf": "1",
    },
  });
  assert(
    validateCsrf(hostileWithCustomHeader).valid === false,
    "Public constant header X-RN-CSRF: 1 cannot independently authorize a cross-origin browser request"
  );

  // 5d: Sec-Fetch-Site: cross-site must be strictly rejected
  const crossSiteFetchReq = new NextRequest("http://localhost:3001/api/rooms", {
    method: "POST",
    headers: {
      "sec-fetch-site": "cross-site",
      host: "localhost:3001",
    },
  });
  assert(
    validateCsrf(crossSiteFetchReq).valid === false,
    "Sec-Fetch-Site: cross-site unconditionally rejected"
  );

  // 5e: Cookie-authenticated mutating request missing both origin and referer must be rejected
  const cookieNoOriginReq = new NextRequest("http://localhost:3001/api/rooms", {
    method: "POST",
    headers: {
      host: "localhost:3001",
      cookie: `${ERP_COOKIE_NAME}=dummy_session_token_for_csrf_test_1234567890`,
    },
  });
  assert(
    validateCsrf(cookieNoOriginReq).valid === false,
    "Cookie-authenticated mutating request missing Origin and Referer is strictly rejected"
  );

  // 5f: Non-browser / mobile-native client without ambient cookies using x-rn-csrf is permitted
  const mobileApiReq = new NextRequest("http://localhost:3001/api/rooms", {
    method: "POST",
    headers: {
      host: "localhost:3001",
      "x-rn-csrf": "1",
    },
  });
  assert(
    validateCsrf(mobileApiReq).valid === true,
    "Non-browser API request without ambient session cookie is accepted with client header"
  );

  // 5g: Safe GET requests are exempt from CSRF rejection
  const safeGetReq = new NextRequest("http://localhost:3001/api/rooms", {
    method: "GET",
    headers: {
      origin: "https://external-search.com",
    },
  });
  assert(validateCsrf(safeGetReq).valid === true, "Safe GET requests exempt from CSRF restrictions");

  // ---------------------------------------------------------------------------
  // TEST SUITE 6: HTTP Security Headers Configuration
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Security Headers Verification");

  const erpNextConfigPath = path.resolve(process.cwd(), "apps/erp/next.config.mjs");
  const websiteNextConfigPath = path.resolve(process.cwd(), "apps/website/next.config.mjs");

  const dynamicImport = new Function("specifier", "return import(specifier)");
  const erpConfigMod = await dynamicImport(pathToFileURL(erpNextConfigPath).href);
  const websiteConfigMod = await dynamicImport(pathToFileURL(websiteNextConfigPath).href);

  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const erpHeadersResult = await erpConfigMod.default.headers();
  const websiteHeadersResult = await websiteConfigMod.default.headers();
  process.env.NODE_ENV = prevEnv;

  const erpHdrs = erpHeadersResult[0].headers;
  const erpCsp = erpHdrs.find((h: any) => h.key === "Content-Security-Policy")?.value || "";
  const erpHsts = erpHdrs.find((h: any) => h.key === "Strict-Transport-Security")?.value || "";
  const erpXFrame = erpHdrs.find((h: any) => h.key === "X-Frame-Options")?.value || "";
  const erpNosniff = erpHdrs.find((h: any) => h.key === "X-Content-Type-Options")?.value || "";
  const erpReferrer = erpHdrs.find((h: any) => h.key === "Referrer-Policy")?.value || "";
  const erpPermissions = erpHdrs.find((h: any) => h.key === "Permissions-Policy")?.value || "";

  assert(erpCsp.length > 0, "ERP next.config includes Content-Security-Policy header");
  assert(!erpCsp.includes("'unsafe-eval'"), "Production ERP CSP strictly excludes 'unsafe-eval'");
  assert(erpCsp.includes("'unsafe-inline'"), "ERP CSP permits 'unsafe-inline' for Next.js App Router hydration");
  assert(erpXFrame === "DENY", "ERP next.config includes X-Frame-Options: DENY");
  assert(erpNosniff === "nosniff", "ERP next.config includes X-Content-Type-Options: nosniff");
  assert(erpReferrer === "strict-origin-when-cross-origin", "ERP next.config includes Referrer-Policy");
  assert(erpPermissions.length > 0, "ERP next.config includes Permissions-Policy");
  assert(erpHsts.includes("max-age=31536000"), "ERP next.config includes HSTS in production");
  assert(!erpHsts.includes("preload"), "ERP next.config omits HSTS preload by default pending HTTPS verification");
  assert(!erpHsts.includes("includeSubDomains"), "ERP next.config omits includeSubDomains pending HTTPS verification");

  const webHdrs = websiteHeadersResult[0].headers;
  const webCsp = webHdrs.find((h: any) => h.key === "Content-Security-Policy")?.value || "";
  const webXFrame = webHdrs.find((h: any) => h.key === "X-Frame-Options")?.value || "";
  const webHsts = webHdrs.find((h: any) => h.key === "Strict-Transport-Security")?.value || "";
  assert(webCsp.length > 0, "Website next.config includes Content-Security-Policy header");
  assert(!webCsp.includes("'unsafe-eval'"), "Production Website CSP strictly excludes 'unsafe-eval'");
  assert(webXFrame === "DENY", "Website next.config includes X-Frame-Options: DENY");
  assert(webHsts.includes("max-age=31536000"), "Website next.config includes HSTS in production");
  assert(!webHsts.includes("preload"), "Website next.config omits HSTS preload pending HTTPS verification");

  // ---------------------------------------------------------------------------
  // TEST SUITE 7: Health Endpoint & Production Fallback Safety
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Health Endpoint & Production Safety Verification");

  const healthCheck = await pingDatabase();
  assert(healthCheck.ok === true, "Database ping returns ok: true");
  assert(typeof healthCheck.latencyMs === "number" && healthCheck.latencyMs >= 0, `Measured database latency: ${healthCheck.latencyMs}ms`);
  assert(healthCheck.engine === "sqlite" || healthCheck.engine === "postgresql", `Active database engine identified (${healthCheck.engine})`);

  // Production Environment Safety: Prove silent SQLite fallback CANNOT activate in production
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDbUrl = process.env.DATABASE_URL;
  const originalDirectUrl = process.env.DIRECT_URL;

  try {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_URL;

    let envCheckThrew = false;
    try {
      validateProductionDatabaseEnvironment();
    } catch (err: any) {
      envCheckThrew = err.message.includes("FATAL PRODUCTION CONFIGURATION");
    }
    assert(envCheckThrew, "validateProductionDatabaseEnvironment throws fatal error when DATABASE_URL is missing in production");

    let asyncDbThrew = false;
    try {
      getAsyncDb();
    } catch (err: any) {
      asyncDbThrew = err.message.includes("Silent fallback to local ephemeral SQLite is strictly prohibited");
    }
    assert(asyncDbThrew, "getAsyncDb throws fatal error in production when DATABASE_URL is missing (silent fallback blocked)");

    const prodHealthCheck = await pingDatabase();
    assert(prodHealthCheck.ok === false, "pingDatabase returns ok: false in production when PostgreSQL is unconfigured");
    assert(prodHealthCheck.error?.includes("PostgreSQL required in production"), "pingDatabase accurately diagnoses missing PostgreSQL in production");
  } finally {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDbUrl) process.env.DATABASE_URL = originalDbUrl;
    if (originalDirectUrl) process.env.DIRECT_URL = originalDirectUrl;
  }

  // ---------------------------------------------------------------------------
  // TEST SUITE 8: SQLite-to-PostgreSQL Data Migration & Guarded Rollback
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] SQLite to PostgreSQL Migration & Guarded Rollback Verification");

  const sourceDbPath = resolveDbPath();
  assert(fs.existsSync(sourceDbPath), `Source SQLite database verified at ${sourceDbPath}`);

  // Test dry-run migration without modifying destination
  const dryRunResult = await migrateSqliteToPostgres({ dryRun: true });
  if (!getDatabaseUrl()) {
    assert(
      dryRunResult.errors.some((e) => e.includes("not configured in environment")),
      "Migration utility safely detects missing PostgreSQL configuration"
    );
    assertBlocked(
      "PostgreSQL target instance credentials (DATABASE_URL / DIRECT_URL)",
      "Live SQLite to PostgreSQL data migration execution"
    );
    assertBlocked(
      "Live PostgreSQL connection pooler",
      "Concurrent room overbooking row lock (FOR UPDATE) verification"
    );
  } else {
    assert(dryRunResult.success === true, "Migration dry-run succeeded against configured target");
  }

  // Verify guarded rollback refuses unconfirmed execution
  const unconfirmedRollback = await rollbackPostgresMigration({ confirmDestructive: false });
  assert(unconfirmedRollback.success === false, "Guarded rollback rejects unconfirmed execution");
  assert(
    unconfirmedRollback.error?.includes("confirmDestructive must be explicitly set to true"),
    "Guarded rollback specifies required confirmation flag"
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`FINAL PHASE 01 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED, ${blockedCount} BLOCKED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runPhase01Tests().catch((err) => {
  console.error("Test execution aborted:", err);
  process.exit(1);
});
