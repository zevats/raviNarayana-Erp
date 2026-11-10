import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { getAdminEmail } from "../apps/erp/src/server/database/env";
import * as auth from "../apps/erp/src/server/authentication/auth";
import {
  getEmailAdapter,
  setEmailAdapterForTesting,
  mockSentEmails,
  clearMockSentEmails,
  EmailAdapter,
  GmailSmtpEmailAdapter,
  MockEmailAdapter,
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

  // ISSUE-011: there is no built-in administrator email; it comes only from ERP_ADMIN_EMAIL.
  const originalAdminEmail = process.env.ERP_ADMIN_EMAIL;
  delete process.env.ERP_ADMIN_EMAIL;
  assert(getAdminEmail() === null, "getAdminEmail() has no hardcoded default when ERP_ADMIN_EMAIL is unset");
  process.env.ERP_ADMIN_EMAIL = "  Owner.Admin@Example.com ";
  const resolvedEmail = getAdminEmail();
  assert(
    resolvedEmail === "owner.admin@example.com",
    `getAdminEmail() returns the configured address, normalized (got ${resolvedEmail})`
  );
  if (originalAdminEmail === undefined) delete process.env.ERP_ADMIN_EMAIL;
  else process.env.ERP_ADMIN_EMAIL = originalAdminEmail;

  const maskedGmail = auth.maskEmail("owner.admin@example.com");
  assert(
    maskedGmail === "o***n@example.com",
    `maskEmail('owner.admin@example.com') masks to o***n@example.com (got ${maskedGmail})`
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
  console.log("\n[TEST SUITE 2] Database Staff Lookup (exact match, no side effects)");

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
    VALUES ('usr_admin_001', 'admin', 'owner.admin@example.com', 'ERP Administrator', ?, 'SUPER_ADMIN', 1, ?, ?)
  `).run(passwordHash, now, now);
  // Second Owner account (PRD: two Owner accounts) with its own mailbox.
  rawDb.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES ('usr_owner_002', 'owner_two', 'second.owner@example.com', 'Second Owner', ?, 'SUPER_ADMIN', 1, ?, ?)
  `).run(passwordHash, now, now);

  // 1. Lookup by username returns the stored email unchanged
  const staffByUsername = await auth.findStaffByIdentifier("admin", asyncDb);
  assert(staffByUsername !== null, "findStaffByIdentifier finds admin by username");
  assert(staffByUsername?.email === "owner.admin@example.com", `Admin email returned as stored (got ${staffByUsername?.email})`);

  // 2. A second Owner keeps its own identity and email (login never rewrites emails, ISSUE-025)
  const secondOwner = await auth.findStaffByIdentifier("owner_two", asyncDb);
  assert(secondOwner?.id === "usr_owner_002", "Second Owner resolves to its own account by username");
  const storedSecond = rawDb.prepare("SELECT email FROM staff_users WHERE id = 'usr_owner_002'").get() as { email: string };
  assert(storedSecond.email === "second.owner@example.com", `Login lookup does not rewrite another Owner's email (got ${storedSecond.email})`);
  const bySecondEmail = await auth.findStaffByIdentifier("second.owner@example.com", asyncDb);
  assert(bySecondEmail?.id === "usr_owner_002", "Second Owner resolves by its own email");
  const unknownEmail = await auth.findStaffByIdentifier("nobody@example.com", asyncDb);
  assert(unknownEmail === null, "Unknown email matches no account (no 'any SUPER_ADMIN' fallback)");

  // 3. Lookup by email "owner.admin@example.com"
  const staffByGmail = await auth.findStaffByIdentifier("owner.admin@example.com", asyncDb);
  assert(
    staffByGmail !== null && staffByGmail.id === "usr_admin_001",
    "findStaffByIdentifier resolves admin user via owner.admin@example.com"
  );

  // ---------------------------------------------------------------------------
  // SUITE 3: OTP Challenge Creation & Mock Delivery
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] OTP Challenge Creation & Dispatch to Gmail");

  clearMockSentEmails();
  const challenge = await auth.createOtpChallenge(staffByUsername!.id, staffByUsername!.email, asyncDb);

  assert(challenge.challengeId.startsWith("chl_"), "Generated valid challengeId");
  assert(
    challenge.maskedEmail === "o***n@example.com",
    `Masked email on challenge returns o***n@example.com (got ${challenge.maskedEmail})`
  );

  assert(mockSentEmails.length === 1, "Exactly one email dispatched via email adapter");
  const sentMsg = mockSentEmails[0];
  assert(
    sentMsg.to === "owner.admin@example.com",
    `Email recipient is authoritative Gmail address: ${sentMsg.to}`
  );
  assert(
    /^\d{6} is your Ravinarayan sign-in code$/.test(sentMsg.subject),
    `Email subject leads with the 6-digit code (got "${sentMsg.subject}")`
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
    await auth.createOtpChallenge("usr_admin_001", "owner.admin@example.com", asyncDb);
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
  const initialChallenge = await auth.createOtpChallenge("usr_admin_001", "owner.admin@example.com", asyncDb);
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
    resendResult.maskedEmail === "o***n@example.com",
    `Resend returned masked email o***n@example.com`
  );

  // Verify old challenge was deleted
  const oldChallenge = rawDb.prepare("SELECT * FROM auth_challenges WHERE id = ?").get(initialChallenge.challengeId);
  assert(oldChallenge === undefined, "Prior challenge deleted upon resend");

  // Verify a second email was dispatched
  assert(mockSentEmails.length === 2, "Second email dispatched on resend");
  const secondMsg = mockSentEmails[1];
  assert(secondMsg.to === "owner.admin@example.com", "Second email sent to owner.admin@example.com");

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
    verifyResult.user.email === "owner.admin@example.com",
    `Authenticated user email is owner.admin@example.com (got ${verifyResult.user.email})`
  );
  assert(
    typeof verifyResult.sessionToken === "string" && verifyResult.sessionToken.length === 64,
    "Valid 256-bit hex session token issued"
  );

  // Verify session is valid in database
  const validatedUser = await auth.validateSession(verifyResult.sessionToken, asyncDb);
  assert(
    validatedUser !== null && validatedUser.email === "owner.admin@example.com",
    "Session validation succeeds and confirms user email is owner.admin@example.com"
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
  // SUITE 11: Gmail SMTP Adapter & Transport Verification
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 11] Gmail SMTP Adapter & Transport Verification");

  // 1. Missing credentials throw error
  let missingCredsError = "";
  try {
    new GmailSmtpEmailAdapter({ user: "", pass: "" });
  } catch (err: any) {
    missingCredsError = err.message;
  }
  assert(
    missingCredsError.includes("SMTP_USER and SMTP_APP_PASSWORD are required"),
    `GmailSmtpEmailAdapter constructor validates credentials (got "${missingCredsError}")`
  );

  // 2. Custom mock nodemailer transporter to verify sent message payload
  const capturedMailOptions: any[] = [];
  let shouldTransporterSucceed = true;

  const mockTransporter: any = {
    async sendMail(options: any) {
      capturedMailOptions.push(options);
      if (!shouldTransporterSucceed) {
        throw new Error("SMTP connection refused by host: 535 5.7.8 Bad credentials");
      }
      return {
        messageId: "<test-msg-12345@gmail.com>",
        accepted: [options.to],
        rejected: [],
      };
    },
    async verify() {
      if (!shouldTransporterSucceed) {
        throw new Error("535-5.7.8 Username and Password not accepted");
      }
      return true;
    },
  };

  const smtpAdapter = new GmailSmtpEmailAdapter(
    {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      user: "sender.mailbox@example.com",
      pass: "mock_google_app_password",
      from: "Ravinarayan ERP <sender.mailbox@example.com>",
    },
    mockTransporter
  );

  // 3. sendOtp verification
  const sendResult = await smtpAdapter.sendOtp("owner.admin@example.com", "482910");
  assert(sendResult === true, "sendOtp returns true on SMTP server acceptance");
  assert(capturedMailOptions.length === 1, "Transporter received sendMail call");

  const sentOptions = capturedMailOptions[0];
  assert(
    sentOptions.from === "Ravinarayan ERP <sender.mailbox@example.com>",
    `Sender identity is Ravinarayan ERP <sender.mailbox@example.com> (got "${sentOptions.from}")`
  );
  assert(
    sentOptions.to === "owner.admin@example.com",
    `Recipient is authoritative address owner.admin@example.com (got "${sentOptions.to}")`
  );
  assert(
    /^\d{6} is your Ravinarayan sign-in code$/.test(sentOptions.subject),
    `Email subject leads with the code (got "${sentOptions.subject}")`
  );
  assert(
    sentOptions.text.includes("482910") && sentOptions.html.includes("482910"),
    "Email text and HTML contain the 6-digit OTP code"
  );
  assert(
    sentOptions.text.includes("10 minutes"),
    "Email text includes 10-minute validity notice"
  );

  // 4. Transport failure handling
  shouldTransporterSucceed = false;
  const failResult = await smtpAdapter.sendOtp("owner.admin@example.com", "999999");
  assert(failResult === false, "sendOtp returns false when SMTP transport throws error");

  const connResult = await smtpAdapter.verifyConnection();
  assert(
    connResult.success === false && typeof connResult.error === "string",
    `verifyConnection reports connection error safely without crashing (got "${connResult.error}")`
  );

  // ---------------------------------------------------------------------------
  // SUITE 12: Fail-Safe Provider Selection & Production Guard
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 12] Fail-Safe Provider Selection & Production Guard");

  // Save current process.env
  const origEnv = { ...process.env };

  try {
    // 0. EMAIL_ADAPTER=smtp without SMTP_USER fails fast (no built-in sender mailbox, ISSUE-011)
    const originalSmtpUser = process.env.SMTP_USER;
    process.env.EMAIL_ADAPTER = "smtp";
    delete process.env.SMTP_USER;
    process.env.SMTP_APP_PASSWORD = "mock_google_app_password";
    setEmailAdapterForTesting(null);
    let smtpMissingUserError = "";
    try {
      getEmailAdapter();
    } catch (err: any) {
      smtpMissingUserError = err.message;
    }
    assert(
      smtpMissingUserError.includes("SMTP_USER is required when EMAIL_ADAPTER=smtp"),
      `Explicit EMAIL_ADAPTER=smtp fails fast if SMTP_USER is missing (got "${smtpMissingUserError}")`
    );

    // 1. EMAIL_ADAPTER=smtp with missing password throws clear error
    process.env.EMAIL_ADAPTER = "smtp";
    process.env.SMTP_USER = "sender.mailbox@example.com";
    delete process.env.SMTP_APP_PASSWORD;
    delete process.env.SMTP_PASS;
    setEmailAdapterForTesting(null);

    let smtpMissingPassError = "";
    try {
      getEmailAdapter();
    } catch (err: any) {
      smtpMissingPassError = err.message;
    }
    assert(
      smtpMissingPassError.includes("SMTP_APP_PASSWORD is required when EMAIL_ADAPTER=smtp"),
      `Explicit EMAIL_ADAPTER=smtp fails fast if password is missing (got "${smtpMissingPassError}")`
    );
    if (originalSmtpUser === undefined) delete process.env.SMTP_USER;
    else process.env.SMTP_USER = originalSmtpUser;

    // 2. Production with EMAIL_ADAPTER=mock is forbidden
    process.env.NODE_ENV = "production";
    process.env.EMAIL_ADAPTER = "mock";
    setEmailAdapterForTesting(null);

    let prodMockError = "";
    try {
      getEmailAdapter();
    } catch (err: any) {
      prodMockError = err.message;
    }
    assert(
      prodMockError.includes("MockEmailAdapter is strictly forbidden in production"),
      `Production forbids MockEmailAdapter (got "${prodMockError}")`
    );

    // 3. Production with missing password throws error
    delete process.env.EMAIL_ADAPTER;
    setEmailAdapterForTesting(null);

    let prodMissingPassError = "";
    try {
      getEmailAdapter();
    } catch (err: any) {
      prodMissingPassError = err.message;
    }
    assert(
      prodMissingPassError.includes("Production requires valid SMTP_APP_PASSWORD"),
      `Production enforces real SMTP delivery configuration (got "${prodMissingPassError}")`
    );
  } finally {
    // Restore environment
    process.env = origEnv;
    setEmailAdapterForTesting(null);
  }

  // 4. Verify .env.example contains SMTP variables with placeholder values
  const envExamplePath = path.resolve(projectRoot, ".env.example");
  const envExampleContent = fs.readFileSync(envExamplePath, "utf-8");

  assert(
    envExampleContent.includes("EMAIL_ADAPTER=smtp"),
    ".env.example specifies EMAIL_ADAPTER=smtp"
  );
  assert(
    envExampleContent.includes("SMTP_HOST=smtp.gmail.com"),
    ".env.example specifies SMTP_HOST=smtp.gmail.com"
  );
  assert(
    envExampleContent.includes("SMTP_PORT=465"),
    ".env.example specifies SMTP_PORT=465"
  );
  assert(
    /^SMTP_USER=\S+@example\.com$/m.test(envExampleContent),
    ".env.example uses a placeholder sender account (no personal mailbox)"
  );
  assert(
    /^ERP_ADMIN_PASSWORD=\s*$/m.test(envExampleContent),
    ".env.example ships no administrator password"
  );
  assert(
    envExampleContent.includes("your_16_char_google_app_password_here"),
    ".env.example uses placeholder for SMTP_APP_PASSWORD (no hardcoded secret)"
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
