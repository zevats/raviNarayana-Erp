import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { getAdminEmail, DEFAULT_ADMIN_EMAIL } from "../apps/erp/src/server/database/env";
import * as auth from "../apps/erp/src/server/authentication/auth";
import {
  getEmailAdapter,
  setEmailAdapterForTesting,
  mockSentEmails,
  clearMockSentEmails,
  EmailAdapter,
} from "../apps/erp/src/server/notifications/emailAdapter";
import { AsyncDb } from "../apps/erp/src/server/database/db";

// Isolated test database path
const TEST_DB_PATH = path.resolve(__dirname, "test_otp_auth.db");

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

// Minimal Better-SQLite3 to AsyncDb wrapper for test execution
function createSqliteAsyncDb(sqlite: Database.Database): AsyncDb {
  return {
    isPostgres: false,
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      const stmt = sqlite.prepare(sql);
      return stmt.all(...params) as T[];
    },
    async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
      const stmt = sqlite.prepare(sql);
      const row = stmt.get(...params);
      return (row as T) || null;
    },
    async execute(sql: string, params: any[] = []): Promise<{ changes: number }> {
      const stmt = sqlite.prepare(sql);
      const info = stmt.run(...params);
      return { changes: info.changes };
    },
    async transaction<T>(callback: (tx: AsyncDb) => Promise<T>): Promise<T> {
      sqlite.prepare("SAVEPOINT otp_tx").run();
      try {
        const result = await callback(createSqliteAsyncDb(sqlite));
        sqlite.prepare("RELEASE SAVEPOINT otp_tx").run();
        return result;
      } catch (err) {
        sqlite.prepare("ROLLBACK TO SAVEPOINT otp_tx").run();
        sqlite.prepare("RELEASE SAVEPOINT otp_tx").run();
        throw err;
      }
    },
  };
}

async function runTests() {
  console.log("================================================================================");
  console.log("RAVINARAYAN ERP — TASK 01B.28 OTP AUTHENTICATION & LOGIN FLOW TEST SUITE");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // SUITE 1: Authoritative Recipient & Email Masking
  // ---------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Authoritative Administrator Email & Masking");

  assert(
    DEFAULT_ADMIN_EMAIL === "rishabh27kumar2006@gmail.com",
    `DEFAULT_ADMIN_EMAIL is set to rishabh27kumar2006@gmail.com (got ${DEFAULT_ADMIN_EMAIL})`
  );

  const resolvedEmail = getAdminEmail();
  assert(
    resolvedEmail === "rishabh27kumar2006@gmail.com",
    `getAdminEmail() resolves to rishabh27kumar2006@gmail.com (got ${resolvedEmail})`
  );

  const maskedGmail = auth.maskEmail("rishabh27kumar2006@gmail.com");
  assert(
    maskedGmail === "r***6@gmail.com",
    `maskEmail('rishabh27kumar2006@gmail.com') masks to r***6@gmail.com (got ${maskedGmail})`
  );

  const maskedOrg = auth.maskEmail("admin@ravinarayan.in");
  assert(
    maskedOrg === "a***n@ravinarayan.in",
    `maskEmail('admin@ravinarayan.in') masks to a***n@ravinarayan.in (got ${maskedOrg})`
  );

  const maskedShort = auth.maskEmail("me@ravinarayan.in");
  assert(
    maskedShort === "m***@ravinarayan.in",
    `maskEmail short local handles correctly (got ${maskedShort})`
  );

  // ---------------------------------------------------------------------------
  // SUITE 2: Isolated Database Migration & Administrator Email Synchronization
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Database Staff Lookup & Email Synchronization");

  const rawDb = new Database(TEST_DB_PATH);
  rawDb.pragma("journal_mode = WAL");
  rawDb.pragma("foreign_keys = ON");

  runMigrations(rawDb);
  const asyncDb = createSqliteAsyncDb(rawDb);

  // Seed an admin user with legacy email "admin@ravinarayan.in"
  const passwordHash = await auth.hashPassword("SuperAdmin@2026!Secure");
  const now = new Date().toISOString();

  rawDb.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES ('usr_admin_001', 'admin', 'admin@ravinarayan.in', 'Dr. Ravinder Gulia', ?, 'SUPER_ADMIN', 1, ?, ?)
  `).run(passwordHash, now, now);

  // 1. Lookup by username "admin": should synchronize email to DEFAULT_ADMIN_EMAIL
  const staffByUsername = await auth.findStaffByIdentifier("admin", asyncDb);
  assert(staffByUsername !== null, "findStaffByIdentifier finds admin by username");
  assert(
    staffByUsername?.email === "rishabh27kumar2006@gmail.com",
    `Admin email synchronized to rishabh27kumar2006@gmail.com (got ${staffByUsername?.email})`
  );

  // Verify database record itself was updated
  const storedRow = rawDb.prepare("SELECT email FROM staff_users WHERE id = 'usr_admin_001'").get() as { email: string };
  assert(
    storedRow.email === "rishabh27kumar2006@gmail.com",
    `Database row persistently updated to rishabh27kumar2006@gmail.com (got ${storedRow.email})`
  );

  // 2. Lookup by email "rishabh27kumar2006@gmail.com"
  const staffByGmail = await auth.findStaffByIdentifier("rishabh27kumar2006@gmail.com", asyncDb);
  assert(
    staffByGmail !== null && staffByGmail.id === "usr_admin_001",
    "findStaffByIdentifier resolves admin user via rishabh27kumar2006@gmail.com"
  );

  // ---------------------------------------------------------------------------
  // SUITE 3: OTP Challenge Creation & Mock Delivery
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] OTP Challenge Creation & Dispatch to Gmail");

  clearMockSentEmails();
  const challenge = await auth.createOtpChallenge(staffByUsername!.id, staffByUsername!.email, asyncDb);

  assert(challenge.challengeId.startsWith("chl_"), "Generated valid challengeId");
  assert(
    challenge.maskedEmail === "r***6@gmail.com",
    `Masked email on challenge returns r***6@gmail.com (got ${challenge.maskedEmail})`
  );

  assert(mockSentEmails.length === 1, "Exactly one email dispatched via email adapter");
  const sentMsg = mockSentEmails[0];
  assert(
    sentMsg.to === "rishabh27kumar2006@gmail.com",
    `Email recipient is authoritative Gmail address: ${sentMsg.to}`
  );
  assert(
    sentMsg.subject.includes("Verification Code"),
    `Email subject contains Verification Code (got "${sentMsg.subject}")`
  );

  // Extract the generated 6-digit OTP code from email text
  const match = sentMsg.text?.match(/\b\d{6}\b/);
  assert(match !== null, "Email body contains 6-digit numeric OTP");
  const generatedOtp = match ? match[0] : "";

  // ---------------------------------------------------------------------------
  // SUITE 4: 60-Second Resend Throttling
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] 60-Second Resend Cooldown Throttling");

  let throttled = false;
  try {
    await auth.createOtpChallenge(staffByUsername!.id, staffByUsername!.email, asyncDb);
  } catch (err: any) {
    throttled = err.message.includes("Please wait") && err.message.includes("seconds");
  }
  assert(throttled, "Immediate repeat createOtpChallenge throttled with cooldown message");

  let resendThrottled = false;
  try {
    await auth.resendOtpChallenge(challenge.challengeId, asyncDb);
  } catch (err: any) {
    resendThrottled = err.message.includes("Please wait");
  }
  assert(resendThrottled, "Immediate resendOtpChallenge throttled with cooldown message");

  // ---------------------------------------------------------------------------
  // SUITE 5: Verification Attempts & 3-Attempt Lockout / Invalidation
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Verification Attempts & 3-Attempt Lockout");

  // Failed Attempt 1
  let attempt1Error = "";
  try {
    await auth.verifyOtpChallenge(challenge.challengeId, "000000", undefined, asyncDb);
  } catch (err: any) {
    attempt1Error = err.message;
  }
  assert(
    attempt1Error.includes("2 attempts remaining"),
    `Attempt 1 error reports 2 attempts remaining (got "${attempt1Error}")`
  );

  // Failed Attempt 2
  let attempt2Error = "";
  try {
    await auth.verifyOtpChallenge(challenge.challengeId, "111111", undefined, asyncDb);
  } catch (err: any) {
    attempt2Error = err.message;
  }
  assert(
    attempt2Error.includes("1 attempts remaining"),
    `Attempt 2 error reports 1 attempt remaining (got "${attempt2Error}")`
  );

  // Failed Attempt 3 — Must invalidate challenge
  let attempt3Error = "";
  try {
    await auth.verifyOtpChallenge(challenge.challengeId, "222222", undefined, asyncDb);
  } catch (err: any) {
    attempt3Error = err.message;
  }
  assert(
    attempt3Error.includes("Too many failed attempts"),
    `Attempt 3 error reports invalidation (got "${attempt3Error}")`
  );

  // Verify challenge row was deleted from database
  const deletedChallenge = rawDb.prepare("SELECT * FROM auth_challenges WHERE id = ?").get(challenge.challengeId);
  assert(deletedChallenge === undefined, "Challenge deleted from auth_challenges after 3 failed attempts");

  // Attempt 4 on invalidated challenge
  let attempt4Error = "";
  try {
    await auth.verifyOtpChallenge(challenge.challengeId, generatedOtp, undefined, asyncDb);
  } catch (err: any) {
    attempt4Error = err.message;
  }
  assert(
    attempt4Error.includes("Invalid or expired verification challenge"),
    `Post-invalidation attempt cleanly rejected (got "${attempt4Error}")`
  );

  // ---------------------------------------------------------------------------
  // SUITE 6: Expired Challenge Invalidation (10-minute window)
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] 10-Minute Expiry Enforcement");

  // Insert challenge already in the past
  const expiredId = "chl_expired_test_001";
  const pastTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const dummyHash = crypto.createHash("sha256").update("654321").digest("hex");

  rawDb.prepare(`
    INSERT INTO auth_challenges (id, staff_id, otp_hash, attempts, expires_at, created_at)
    VALUES (?, 'usr_admin_001', ?, 0, ?, ?)
  `).run(expiredId, dummyHash, pastTime, pastTime);

  let expiredError = "";
  try {
    await auth.verifyOtpChallenge(expiredId, "654321", undefined, asyncDb);
  } catch (err: any) {
    expiredError = err.message;
  }
  assert(
    expiredError.includes("expired"),
    `Expired challenge rejected with expiry message (got "${expiredError}")`
  );

  const expiredInDb = rawDb.prepare("SELECT * FROM auth_challenges WHERE id = ?").get(expiredId);
  assert(expiredInDb === undefined, "Expired challenge atomically cleaned up on presentation");

  // ---------------------------------------------------------------------------
  // SUITE 7: Email Provider Failure Handling (Fail-Safe Rollback)
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Email Provider Failure Handling & Rollback");

  // Temporarily install a failing email adapter
  class FailingEmailAdapter implements EmailAdapter {
    async sendOtp(): Promise<boolean> {
      return false; // Delivery failure
    }
    async sendPasswordReset(): Promise<boolean> {
      return false;
    }
  }

  setEmailAdapterForTesting(new FailingEmailAdapter());

  // Wait 1 second and clear challenges to bypass cooldown
  rawDb.prepare("DELETE FROM auth_challenges WHERE staff_id = 'usr_admin_001'").run();

  let providerError = "";
  try {
    await auth.createOtpChallenge("usr_admin_001", "rishabh27kumar2006@gmail.com", asyncDb);
  } catch (err: any) {
    providerError = err.message;
  }
  assert(
    providerError.includes("Unable to deliver verification code"),
    `Provider failure throws user-friendly error (got "${providerError}")`
  );

  // Verify no orphaned challenge was left in the database
  const orphanedChallenges = rawDb.prepare("SELECT COUNT(*) as count FROM auth_challenges WHERE staff_id = 'usr_admin_001'").get() as { count: number };
  assert(
    orphanedChallenges.count === 0,
    `No orphaned challenge persisted after email delivery failure (count: ${orphanedChallenges.count})`
  );

  // Restore MockEmailAdapter
  setEmailAdapterForTesting(null);

  // ---------------------------------------------------------------------------
  // SUITE 8: Resend OTP Workflow
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] OTP Resend Flow & Old Challenge Invalidation");

  clearMockSentEmails();
  const initialChallenge = await auth.createOtpChallenge("usr_admin_001", "rishabh27kumar2006@gmail.com", asyncDb);
  assert(initialChallenge.challengeId.startsWith("chl_"), "Initial challenge created");

  // Simulate 61 seconds passing by updating created_at in the database
  const sixtyOneSecondsAgo = new Date(Date.now() - 61 * 1000).toISOString();
  rawDb.prepare("UPDATE auth_challenges SET created_at = ? WHERE id = ?").run(sixtyOneSecondsAgo, initialChallenge.challengeId);

  const resendResult = await auth.resendOtpChallenge(initialChallenge.challengeId, asyncDb);
  assert(
    resendResult.challengeId !== initialChallenge.challengeId,
    `Resend generated fresh challengeId (got ${resendResult.challengeId})`
  );
  assert(
    resendResult.maskedEmail === "r***6@gmail.com",
    `Resend returned masked email r***6@gmail.com`
  );

  // Verify old challenge was deleted
  const oldChallenge = rawDb.prepare("SELECT * FROM auth_challenges WHERE id = ?").get(initialChallenge.challengeId);
  assert(oldChallenge === undefined, "Prior challenge deleted upon resend");

  // Verify a second email was dispatched
  assert(mockSentEmails.length === 2, "Second email dispatched on resend");
  const secondMsg = mockSentEmails[1];
  assert(secondMsg.to === "rishabh27kumar2006@gmail.com", "Second email sent to rishabh27kumar2006@gmail.com");

  // ---------------------------------------------------------------------------
  // SUITE 9: Successful OTP Verification & Single Active Session Creation
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 9] Successful OTP Verification & Session Issuance");

  const newOtpMatch = secondMsg.text?.match(/\b\d{6}\b/);
  assert(newOtpMatch !== null, "Second email contains valid 6-digit OTP");
  const validOtp = newOtpMatch ? newOtpMatch[0] : "";

  // Verify: no sessions exist prior to OTP completion
  const preSessions = rawDb.prepare("SELECT COUNT(*) as count FROM sessions WHERE staff_id = 'usr_admin_001'").get() as { count: number };
  assert(preSessions.count === 0, "Zero active sessions exist before OTP verification");

  const verifyResult = await auth.verifyOtpChallenge(
    resendResult.challengeId,
    validOtp,
    { ip: "127.0.0.1", userAgent: "AutomatedTest" },
    asyncDb
  );

  assert(verifyResult.user.id === "usr_admin_001", "Returned correct authenticated staff user ID");
  assert(
    verifyResult.user.email === "rishabh27kumar2006@gmail.com",
    `Authenticated user email is rishabh27kumar2006@gmail.com (got ${verifyResult.user.email})`
  );
  assert(
    typeof verifyResult.sessionToken === "string" && verifyResult.sessionToken.length === 64,
    "Valid 256-bit hex session token issued"
  );

  // Verify session is valid in database
  const validatedUser = await auth.validateSession(verifyResult.sessionToken, asyncDb);
  assert(
    validatedUser !== null && validatedUser.email === "rishabh27kumar2006@gmail.com",
    "Session validation succeeds and confirms user email is rishabh27kumar2006@gmail.com"
  );

  // Verify challenge was consumed (single-use)
  const consumedChallenge = rawDb.prepare("SELECT * FROM auth_challenges WHERE id = ?").get(resendResult.challengeId);
  assert(consumedChallenge === undefined, "Challenge deleted immediately after successful verification (single-use)");

  // ---------------------------------------------------------------------------
  // SUITE 10: CSP & Font Configuration Verification
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 10] CSP & Google Fonts Compliance");

  // Read next.config.mjs to verify CSP headers (resolve relative to repository root)
  const projectRoot = path.resolve(__dirname, "../../..");
  const nextConfigPath = path.resolve(projectRoot, "apps/erp/next.config.mjs");
  const nextConfigContent = fs.readFileSync(nextConfigPath, "utf-8");

  assert(
    nextConfigContent.includes("https://fonts.googleapis.com"),
    "next.config.mjs style-src explicitly permits https://fonts.googleapis.com"
  );
  assert(
    nextConfigContent.includes("https://fonts.gstatic.com"),
    "next.config.mjs font-src explicitly permits https://fonts.gstatic.com"
  );
  assert(
    !nextConfigContent.includes("*.googleapis.com"),
    "next.config.mjs strictly avoids wildcards (*.googleapis.com)"
  );

  // Read globals.css to ensure @import Google Fonts was removed
  const globalsCssPath = path.resolve(projectRoot, "apps/erp/src/styles/globals.css");
  const globalsCssContent = fs.readFileSync(globalsCssPath, "utf-8");

  assert(
    !globalsCssContent.includes("@import url('https://fonts.googleapis.com"),
    "globals.css does not include remote @import url for Google Fonts (system font stack used)"
  );

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------
  rawDb.close();
  cleanupTestDbFiles();

  console.log("\n================================================================================");
  console.log(`FINAL OTP AUTH TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
