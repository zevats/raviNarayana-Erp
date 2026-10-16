import crypto from "crypto";
import path from "path";
import fs from "fs";
import { NextRequest } from "next/server";

import {
  createOtpChallenge,
  verifyOtpChallenge,
  initiatePasswordReset,
  completePasswordReset,
  createSession,
  validateSessionDetailed,
  revokeAllUserSessions,
  maskEmail,
} from "../apps/erp/src/server/authentication/auth";
import {
  getEmailAdapter,
  setEmailAdapterForTesting,
  mockSentEmails,
  clearMockSentEmails,
  MockEmailAdapter,
} from "../apps/erp/src/server/notifications/emailAdapter";
import { validateCsrf } from "../apps/erp/src/server/security/csrf";
import { pingDatabase, isPostgresConfigured, getDatabaseUrl } from "../apps/erp/src/server/database/client";
import { migrateSqliteToPostgres } from "../apps/erp/src/server/database/migrateSqliteToPg";
import { resolveDbPath, getDb, getAsyncDb } from "../apps/erp/src/server/database/db";

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
  assert(migrationFiles.length > 0, `Generated Drizzle SQL migration exists (found ${migrationFiles[0]})`);

  const sqlContent = fs.readFileSync(path.join(drizzleDir, migrationFiles[0]), "utf8");
  assert(sqlContent.includes('CREATE TABLE "staff_users"'), "Migration defines staff_users table");
  assert(sqlContent.includes('CREATE TABLE "rooms"'), "Migration defines rooms table");
  assert(sqlContent.includes('CREATE TABLE "residents"'), "Migration defines residents table");
  assert(sqlContent.includes('CREATE TABLE "resident_stays"'), "Migration defines resident_stays table");
  assert(sqlContent.includes('CREATE TABLE "financial_transactions"'), "Migration defines financial_transactions table");
  assert(sqlContent.includes('CREATE TABLE "auth_challenges"'), "Migration defines auth_challenges table for Email OTP");
  assert(sqlContent.includes('CREATE TABLE "password_resets"'), "Migration defines password_resets table for recovery");
  assert(
    sqlContent.includes('idx_rooms_number_nocase') && sqlContent.includes('lower("room_number")'),
    "Migration enforces case-insensitive room number uniqueness via functional index"
  );
  assert(
    sqlContent.includes('idx_unique_active_resident_stay'),
    "Migration enforces at most 1 active stay per resident via partial unique index"
  );
  assert(
    sqlContent.includes('chk_fin_tx_amount'),
    "Migration enforces positive financial amount check constraint (whole INR)"
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 2: Email OTP Challenge Lifecycle & Security
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Email OTP Two-Factor Authentication Lifecycle");

  // Create test staff user
  const testStaffId = "usr_test_otp_user";
  const testEmail = "doctor.test@ravinarayan.in";
  db.prepare(`
    INSERT OR REPLACE INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, 'test_otp_doctor', ?, 'Dr. OTP Tester', 'dummy_hash', 'SUPER_ADMIN', 1, ?, ?)
  `).run(testStaffId, testEmail, new Date().toISOString(), new Date().toISOString());

  // 2a: Generate OTP Challenge
  clearMockSentEmails();
  const challenge = await createOtpChallenge(testStaffId, testEmail);
  assert(challenge.challengeId.startsWith("chal_"), "Generated prefixed challenge ID");
  assert(challenge.maskedEmail === "d***t@ravinarayan.in", "Masked email generated without exposing full address");
  assert(mockSentEmails.length === 1, "OTP dispatched via email adapter");

  const sentMessage = mockSentEmails[0];
  const otpMatch = sentMessage.text?.match(/\b\d{6}\b/);
  assert(otpMatch !== null, "Dispatched email contains 6-digit numeric OTP");
  const plaintextOtp = otpMatch ? otpMatch[0] : "";
  assert(
    Number(plaintextOtp) >= 100000 && Number(plaintextOtp) <= 999999,
    "Generated OTP falls within inclusive 100000..999999 numeric range"
  );

  // 2b: Plaintext OTP is NOT stored in database
  const dbChal = db.prepare("SELECT * FROM auth_challenges WHERE id = ?").get(challenge.challengeId) as any;
  assert(dbChal !== undefined, "Challenge persisted in auth_challenges table");
  assert(dbChal.otp_hash !== plaintextOtp, "Plaintext OTP is strictly NOT stored in the database");
  assert(dbChal.otp_hash.length === 64, "Database stores SHA-256 one-way digest of OTP");

  // 2c: Resend throttling (must wait 60s)
  let throttled = false;
  try {
    await createOtpChallenge(testStaffId, testEmail);
  } catch (err: any) {
    throttled = err.message.includes("seconds before requesting");
  }
  assert(throttled, "Resend throttling strictly enforced within 60-second window");

  // 2d: Failed attempt counter increment
  let wrongAttemptThrew = false;
  try {
    await verifyOtpChallenge(challenge.challengeId, "000000");
  } catch (err: any) {
    wrongAttemptThrew = err.message.includes("2 attempts remaining");
  }
  assert(wrongAttemptThrew, "Invalid OTP increments attempt counter and reports remaining attempts");

  // 2e: Max attempts (3 attempts) invalidates challenge
  try {
    await verifyOtpChallenge(challenge.challengeId, "000001");
  } catch {}
  let invalidatedOnThird = false;
  try {
    await verifyOtpChallenge(challenge.challengeId, "000002");
  } catch (err: any) {
    invalidatedOnThird = err.message.includes("invalidated");
  }
  assert(invalidatedOnThird, "Challenge automatically invalidated and deleted on 3rd failed attempt");

  const deletedChal = db.prepare("SELECT * FROM auth_challenges WHERE id = ?").get(challenge.challengeId);
  assert(deletedChal === undefined, "Invalidated challenge purged from database");

  // 2f: Successful verification issues session
  // Reset challenge for successful verification test
  db.prepare("DELETE FROM auth_challenges WHERE staff_id = ?").run(testStaffId);
  const validChallenge = await createOtpChallenge(testStaffId, testEmail);
  const validOtp = mockSentEmails[mockSentEmails.length - 1].text!.match(/\b\d{6}\b/)![0];

  const verifyResult = await verifyOtpChallenge(validChallenge.challengeId, validOtp, {
    ip: "10.0.0.1",
    userAgent: "AutomatedTestBrowser/1.0",
  });
  assert(verifyResult.user.id === testStaffId, "OTP verification authenticated correct staff user");
  assert(verifyResult.sessionToken.length === 64, "Issued 256-bit cryptographically secure session token");

  // 2g: Single-use: Replay of used OTP is rejected
  let replayRejected = false;
  try {
    await verifyOtpChallenge(validChallenge.challengeId, validOtp);
  } catch {
    replayRejected = true;
  }
  assert(replayRejected, "Replay of used OTP challenge is strictly rejected (single-use guarantee)");

  // ---------------------------------------------------------------------------
  // TEST SUITE 3: Password Recovery Workflow
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Self-Service Password Recovery (Forgot/Reset)");

  clearMockSentEmails();
  // 3a: Timing-safe generic response for non-existent user
  const genericUnknown = await initiatePasswordReset("nonexistent_staff_xyz");
  assert(genericUnknown.success === true, "Nonexistent account identifier returns generic success (no user enumeration)");
  assert(mockSentEmails.length === 0, "No email sent for non-existent user");

  // 3b: Legitimate user receives recovery token
  const legitimateReset = await initiatePasswordReset(testEmail);
  assert(legitimateReset.success === true, "Valid account returns generic confirmation");
  assert(mockSentEmails.length === 1, "Password reset link sent to registered email");

  const resetEmailText = mockSentEmails[0].text || "";
  const tokenMatch = resetEmailText.match(/token=([a-f0-9]{64})/);
  assert(tokenMatch !== null, "Reset email contains 256-bit hexadecimal reset token");
  const rawResetToken = tokenMatch ? tokenMatch[1] : "";

  // 3c: Plaintext reset token is NOT stored in database
  const resetRow = db.prepare("SELECT * FROM password_resets WHERE staff_id = ?").get(testStaffId) as any;
  assert(resetRow !== undefined, "Password reset record created in database");
  assert(resetRow.token_hash !== rawResetToken, "Plaintext reset token is strictly NOT stored in database");
  assert(resetRow.token_hash.length === 64, "Database stores SHA-256 digest of reset token");
  assert(resetRow.used_at === null, "Token initialized as unused (used_at IS NULL)");

  // 3d: Weak password rejected (< 12 chars)
  const weakPasswordResult = await completePasswordReset(rawResetToken, "short123");
  assert(weakPasswordResult.success === false, "Reset rejects passwords shorter than 12 characters");

  // 3e: Complete password reset with valid strong password
  const strongNewPassword = "UltraSecurePassword2026!#";
  const resetSuccess = await completePasswordReset(rawResetToken, strongNewPassword, "10.0.0.1");
  assert(resetSuccess.success === true, "Password reset completed successfully");

  // 3f: Replay of used reset token rejected
  const replayReset = await completePasswordReset(rawResetToken, "AnotherStrongPassword2026!#");
  assert(replayReset.success === false, "Replay of already consumed reset token is strictly rejected");

  // ---------------------------------------------------------------------------
  // TEST SUITE 4: Single Active Session Preemption
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Single Active Session Per Account & Preemption");

  // User logs in from Device 1
  const sessionDevice1 = createSession(testStaffId, { ip: "192.168.1.1", userAgent: "Laptop", preempt: true });
  assert(validateSessionDetailed(sessionDevice1.sessionToken).user !== null, "Device 1 session is initially valid");

  // User logs in from Device 2 -> Device 1 session must be preempted atomically
  const sessionDevice2 = createSession(testStaffId, { ip: "192.168.1.2", userAgent: "Mobile", preempt: true });
  assert(validateSessionDetailed(sessionDevice2.sessionToken).user !== null, "Device 2 session is active");

  // Validate Device 1: Must be recognized as PREEMPTED
  const device1Check = validateSessionDetailed(sessionDevice1.sessionToken);
  assert(device1Check.user === null, "Device 1 session can no longer access protected resources");
  assert(device1Check.isPreempted === true, "Preempted session specifically recognized with isPreempted: true");

  // Cleanup
  revokeAllUserSessions(testStaffId);
  assert(validateSessionDetailed(sessionDevice2.sessionToken).user === null, "revokeAllUserSessions purges all active sessions");

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

  // 5c: Custom Anti-CSRF Header allows verified mobile/API requests
  const apiCustomHeaderReq = new NextRequest("http://localhost:3001/api/rooms", {
    method: "POST",
    headers: {
      "x-rn-csrf": "1",
      host: "localhost:3001",
    },
  });
  assert(validateCsrf(apiCustomHeaderReq).valid === true, "Request with custom X-RN-CSRF header accepted");

  // 5d: Safe GET requests are exempt from CSRF rejection
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

  const erpConfigText = fs.readFileSync(erpNextConfigPath, "utf8");
  assert(erpConfigText.includes("Content-Security-Policy"), "ERP next.config includes Content-Security-Policy header");
  assert(erpConfigText.includes("X-Frame-Options") && erpConfigText.includes("DENY"), "ERP next.config includes X-Frame-Options: DENY");
  assert(erpConfigText.includes("X-Content-Type-Options") && erpConfigText.includes("nosniff"), "ERP next.config includes X-Content-Type-Options: nosniff");
  assert(erpConfigText.includes("Referrer-Policy") && erpConfigText.includes("strict-origin-when-cross-origin"), "ERP next.config includes Referrer-Policy");
  assert(erpConfigText.includes("Permissions-Policy"), "ERP next.config includes Permissions-Policy");
  assert(erpConfigText.includes("Strict-Transport-Security"), "ERP next.config includes HSTS in production");

  const websiteConfigText = fs.readFileSync(websiteNextConfigPath, "utf8");
  assert(websiteConfigText.includes("Content-Security-Policy"), "Website next.config includes Content-Security-Policy header");
  assert(websiteConfigText.includes("X-Frame-Options") && websiteConfigText.includes("DENY"), "Website next.config includes X-Frame-Options: DENY");

  // ---------------------------------------------------------------------------
  // TEST SUITE 7: Health Endpoint Contract
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Health Endpoint & Database Diagnostics");

  const healthCheck = await pingDatabase();
  assert(healthCheck.ok === true, "Database ping returns ok: true");
  assert(typeof healthCheck.latencyMs === "number" && healthCheck.latencyMs >= 0, `Measured database latency: ${healthCheck.latencyMs}ms`);
  assert(healthCheck.engine === "sqlite" || healthCheck.engine === "postgresql", `Active database engine identified (${healthCheck.engine})`);

  // ---------------------------------------------------------------------------
  // TEST SUITE 8: SQLite-to-PostgreSQL Data Migration Utility
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] SQLite to PostgreSQL Migration Utility Verification");

  const sourceDbPath = resolveDbPath();
  assert(fs.existsSync(sourceDbPath), `Source SQLite database verified at ${sourceDbPath}`);

  // Test dry-run migration without modifying destination
  const dryRunResult = await migrateSqliteToPostgres({ dryRun: true });
  // If DIRECT_URL / DATABASE_URL is not configured in this test environment:
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
