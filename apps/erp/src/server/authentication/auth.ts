import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getAsyncDb, AsyncDb } from "../database/db";
import { performDatabaseCleanupAsync } from "../database/cleanup";
import { StaffUser, AuthenticatedUser } from "../../types";
import { getEmailAdapter } from "../notifications/emailAdapter";
import { recordAuditEventAsync } from "../audit/audit";
import { getAdminEmail } from "../database/env";

const SESSION_TTL_DAYS = 7;
const MAX_IP_FAILED_ATTEMPTS = 20; // Layer 1: Max failed attempts from single IP across all accounts
const MAX_PAIR_FAILED_ATTEMPTS = 5; // Layer 2: Max failed attempts from single IP for specific account
const DISTRIBUTED_ABUSE_THRESHOLD = 10; // Layer 3: High distributed failures triggers slowdown (no account lockout)
const RATE_LIMIT_WINDOW_MINUTES = 15;

export const ERP_COOKIE_NAME = "rn_erp_session";
export const DUMMY_PASSWORD_HASH = "$2a$12$6Kl.3MNW1HtR0bJWduKAGe9PTiL9Pkz6DV.yfthDSGUppMXhV2Agy";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface RateLimitCheckResult {
  isLimited: boolean;
  remainingMinutes: number;
  shouldSlowDown: boolean;
  reason?: string;
}

/**
 * Layered rate-limiting check:
 * 1. IP-based limit (blocks aggressive credential-stuffing from a single IP)
 * 2. Identifier + IP limit (blocks targeted brute forcing of an account from a single IP)
 * 3. Distributed account abuse check (applies timing delay without locking out the legitimate account owner)
 */
export async function checkRateLimit(
  identifier: string,
  ipAddress: string,
  asyncDb?: AsyncDb
): Promise<RateLimitCheckResult> {
  const db = asyncDb || getAsyncDb();
  const cleanId = identifier.trim().toLowerCase();
  const cleanIp = ipAddress.trim().toLowerCase();
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  // Unified single SQL query to evaluate Layer 1, Layer 2, and Layer 3 rate-limiting in one DB roundtrip
  const aggResult = await db.queryOne<{
    ipFailedCount: number | string;
    ipOldestAttempt: string | null;
    pairFailedCount: number | string;
    pairOldestAttempt: string | null;
    distFailedCount: number | string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN ip_address = ? THEN 1 ELSE 0 END), 0) as "ipFailedCount",
       MIN(CASE WHEN ip_address = ? THEN attempted_at ELSE NULL END) as "ipOldestAttempt",
       COALESCE(SUM(CASE WHEN identifier = ? AND ip_address = ? THEN 1 ELSE 0 END), 0) as "pairFailedCount",
       MIN(CASE WHEN identifier = ? AND ip_address = ? THEN attempted_at ELSE NULL END) as "pairOldestAttempt",
       COALESCE(SUM(CASE WHEN identifier = ? THEN 1 ELSE 0 END), 0) as "distFailedCount"
     FROM login_attempts
     WHERE (ip_address = ? OR identifier = ?) AND success = 0 AND attempted_at >= ?`,
    [cleanIp, cleanIp, cleanId, cleanIp, cleanId, cleanIp, cleanId, cleanIp, cleanId, windowStart]
  );

  const ipFailedCount = Number(aggResult?.ipFailedCount || 0);
  if (ipFailedCount >= MAX_IP_FAILED_ATTEMPTS) {
    let remainingMinutes = RATE_LIMIT_WINDOW_MINUTES;
    if (aggResult?.ipOldestAttempt) {
      const elapsedMs = Date.now() - new Date(aggResult.ipOldestAttempt).getTime();
      remainingMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - elapsedMs) / 60000));
    }
    return {
      isLimited: true,
      remainingMinutes,
      shouldSlowDown: false,
      reason: "Too many failed login attempts from this network. Access temporarily restricted.",
    };
  }

  const pairFailedCount = Number(aggResult?.pairFailedCount || 0);
  if (pairFailedCount >= MAX_PAIR_FAILED_ATTEMPTS) {
    let remainingMinutes = RATE_LIMIT_WINDOW_MINUTES;
    if (aggResult?.pairOldestAttempt) {
      const elapsedMs = Date.now() - new Date(aggResult.pairOldestAttempt).getTime();
      remainingMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - elapsedMs) / 60000));
    }
    return {
      isLimited: true,
      remainingMinutes,
      shouldSlowDown: false,
      reason: "Too many failed attempts for this account from this network. Please try again later.",
    };
  }

  const totalFailures = Number(aggResult?.distFailedCount || 0);
  const shouldSlowDown = totalFailures >= DISTRIBUTED_ABUSE_THRESHOLD;

  return {
    isLimited: false,
    remainingMinutes: 0,
    shouldSlowDown,
  };
}

/**
 * Atomic rate-limiting evaluation and attempt reservation.
 * Evaluates Layer 1 (IP), Layer 2 (Identifier + IP), and Layer 3 (Distributed velocity)
 * using a single unified query, followed by atomic attempt reservation.
 * 
 * If the request is permitted, an initial failed attempt record (success = 0) is atomically
 * reserved in the database. If authentication subsequently succeeds, recordLoginSuccess()
 * wipes the failed attempts for this (identifier, ip) pair.
 * 
 * This guarantees that concurrent burst requests cannot bypass rate limits during
 * asynchronous password verification (bcrypt execution).
 */
export async function checkRateLimitAndRecord(
  identifier: string,
  ipAddress: string,
  asyncDb?: AsyncDb
): Promise<RateLimitCheckResult> {
  const db = asyncDb || getAsyncDb();
  const cleanId = identifier.trim().toLowerCase();
  const cleanIp = ipAddress.trim().toLowerCase();
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  return db.transaction(async (tx) => {
    // Unified single SQL query to evaluate all 3 layers concurrently in one DB roundtrip
    const aggResult = await tx.queryOne<{
      ipFailedCount: number | string;
      ipOldestAttempt: string | null;
      pairFailedCount: number | string;
      pairOldestAttempt: string | null;
      distFailedCount: number | string;
    }>(
      `SELECT
         COALESCE(SUM(CASE WHEN ip_address = ? THEN 1 ELSE 0 END), 0) as "ipFailedCount",
         MIN(CASE WHEN ip_address = ? THEN attempted_at ELSE NULL END) as "ipOldestAttempt",
         COALESCE(SUM(CASE WHEN identifier = ? AND ip_address = ? THEN 1 ELSE 0 END), 0) as "pairFailedCount",
         MIN(CASE WHEN identifier = ? AND ip_address = ? THEN attempted_at ELSE NULL END) as "pairOldestAttempt",
         COALESCE(SUM(CASE WHEN identifier = ? THEN 1 ELSE 0 END), 0) as "distFailedCount"
       FROM login_attempts
       WHERE (ip_address = ? OR identifier = ?) AND success = 0 AND attempted_at >= ?`,
      [cleanIp, cleanIp, cleanId, cleanIp, cleanId, cleanIp, cleanId, cleanIp, cleanId, windowStart]
    );

    const ipFailedCount = Number(aggResult?.ipFailedCount || 0);
    if (ipFailedCount >= MAX_IP_FAILED_ATTEMPTS) {
      let remainingMinutes = RATE_LIMIT_WINDOW_MINUTES;
      if (aggResult?.ipOldestAttempt) {
        const elapsedMs = Date.now() - new Date(aggResult.ipOldestAttempt).getTime();
        remainingMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - elapsedMs) / 60000));
      }
      return {
        isLimited: true,
        remainingMinutes,
        shouldSlowDown: false,
        reason: "Too many failed login attempts from this network. Access temporarily restricted.",
      };
    }

    const pairFailedCount = Number(aggResult?.pairFailedCount || 0);
    if (pairFailedCount >= MAX_PAIR_FAILED_ATTEMPTS) {
      let remainingMinutes = RATE_LIMIT_WINDOW_MINUTES;
      if (aggResult?.pairOldestAttempt) {
        const elapsedMs = Date.now() - new Date(aggResult.pairOldestAttempt).getTime();
        remainingMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - elapsedMs) / 60000));
      }
      return {
        isLimited: true,
        remainingMinutes,
        shouldSlowDown: false,
        reason: "Too many failed attempts for this account from this network. Please try again later.",
      };
    }

    const totalFailures = Number(aggResult?.distFailedCount || 0);
    const shouldSlowDown = totalFailures >= DISTRIBUTED_ABUSE_THRESHOLD;

    // Atomically reserve attempt record with success = 0
    const id = `att_${crypto.randomUUID()}`;
    await tx.execute(
      `INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success)
       VALUES (?, ?, ?, ?, 0)`,
      [id, cleanId, cleanIp, now]
    );

    return {
      isLimited: false,
      remainingMinutes: 0,
      shouldSlowDown,
    };
  });
}

export async function recordLoginSuccess(
  identifier: string,
  ipAddress: string,
  asyncDb?: AsyncDb
): Promise<void> {
  const db = asyncDb || getAsyncDb();
  const cleanId = identifier.trim().toLowerCase();
  const cleanIp = ipAddress.trim().toLowerCase();
  const now = new Date().toISOString();
  const id = `att_${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    await Promise.all([
      tx.execute(
        `DELETE FROM login_attempts
         WHERE identifier = ? AND ip_address = ? AND success = 0`,
        [cleanId, cleanIp]
      ),
      tx.execute(
        `INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success)
         VALUES (?, ?, ?, ?, 1)`,
        [id, cleanId, cleanIp, now]
      ),
    ]);
  });
}

export async function recordLoginAttempt(
  identifier: string,
  ipAddress: string,
  success: boolean,
  asyncDb?: AsyncDb
): Promise<void> {
  const db = asyncDb || getAsyncDb();
  const id = `att_${crypto.randomUUID()}`;
  const cleanId = identifier.trim().toLowerCase();
  const cleanIp = ipAddress.trim().toLowerCase();
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success)
       VALUES (?, ?, ?, ?, ?)`,
      [id, cleanId, cleanIp, now, success ? 1 : 0]
    );

    // If successful, reset failed attempt counters for this (identifier, ip) client
    if (success) {
      await tx.execute(
        `DELETE FROM login_attempts
         WHERE identifier = ? AND ip_address = ? AND success = 0`,
        [cleanId, cleanIp]
      );
    }
  });
}

export async function findStaffByIdentifier(
  identifier: string,
  asyncDb?: AsyncDb
): Promise<(StaffUser & { password_hash: string }) | null> {
  const db = asyncDb || getAsyncDb();
  const cleanId = identifier.trim().toLowerCase();
  const targetAdminEmail = getAdminEmail();
  const isAdminEmailInput = cleanId === targetAdminEmail;

  let row = await db.queryOne<StaffUser & { password_hash: string }>(
    `SELECT
       id, username, email, full_name as "fullName", password_hash,
       role, is_active as "isActive", created_at as "createdAt",
       updated_at as "updatedAt", last_login_at as "lastLoginAt"
     FROM staff_users
     WHERE (LOWER(username) = ? OR LOWER(email) = ? ${isAdminEmailInput ? "OR LOWER(username) = 'admin' OR role = 'SUPER_ADMIN'" : ""}) AND is_active = 1`,
    [cleanId, cleanId]
  );

  // If this is the administrator account, ensure its email is synchronized to targetAdminEmail
  if (row && (row.role === "SUPER_ADMIN" || row.username.toLowerCase() === "admin")) {
    if (row.email.toLowerCase() !== targetAdminEmail) {
      const now = new Date().toISOString();
      await db.execute(
        `UPDATE staff_users SET email = ?, updated_at = ? WHERE id = ?`,
        [targetAdminEmail, now, row.id]
      );
      row.email = targetAdminEmail;
    }
  }

  return row || null;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Creates a cryptographically random session token for the client cookie,
 * while storing only a one-way SHA-256 digest at rest in the database.
 * Enforces Single Active Session Per Account across web and mobile.
 */
export async function createSession(
  staffId: string,
  metadata?: { ip?: string; userAgent?: string; preempt?: boolean },
  asyncDb?: AsyncDb
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const db = asyncDb || getAsyncDb();
  const id = `sess_${crypto.randomUUID()}`;
  
  // 32 cryptographically secure random bytes = 256 bits of entropy
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date().toISOString();

  // Atomically preempt existing sessions when requested (single active session enforcement)
  const shouldPreempt = metadata?.preempt === true;

  await db.transaction(async (tx) => {
    if (shouldPreempt) {
      try {
        const existing = await tx.query<{ token_hash: string; expires_at: string }>(
          "SELECT token_hash, expires_at FROM sessions WHERE staff_id = ?",
          [staffId]
        );

        if (existing.length > 0) {
          await Promise.all(
            existing.map((s) =>
              tx.execute(
                `INSERT INTO session_preemptions (id, token_hash, staff_id, preempted_at, expires_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  `prm_${crypto.randomUUID()}`,
                  s.token_hash,
                  staffId,
                  now,
                  s.expires_at || expiresAt.toISOString(),
                  now,
                ]
              )
            )
          );
          await tx.execute("DELETE FROM sessions WHERE staff_id = ?", [staffId]);
        }
      } catch {
        // Fallback if session_preemptions is not yet migrated in test runner
        await tx.execute("DELETE FROM sessions WHERE staff_id = ?", [staffId]);
      }
    }

    await Promise.all([
      tx.execute(
        `INSERT INTO sessions (id, token_hash, staff_id, expires_at, created_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          tokenHash,
          staffId,
          expiresAt.toISOString(),
          now,
          metadata?.ip || null,
          metadata?.userAgent || null,
        ]
      ),
      tx.execute("UPDATE staff_users SET last_login_at = ? WHERE id = ?", [now, staffId]),
    ]);
  });

  // Throttled background cleanup for expired records (non-blocking)
  performDatabaseCleanupAsync(db).catch(() => {});

  return { sessionToken: rawToken, expiresAt };
}

/**
 * Validates a session token presented by the client cookie by hashing it
 * and matching against the SHA-256 token digest at rest.
 */
export async function validateSession(
  sessionToken: string,
  asyncDb?: AsyncDb
): Promise<AuthenticatedUser | null> {
  const res = await validateSessionDetailed(sessionToken, asyncDb);
  return res.user;
}

export async function validateSessionDetailed(
  sessionToken: string,
  asyncDb?: AsyncDb
): Promise<{
  user: AuthenticatedUser | null;
  isPreempted?: boolean;
}> {
  if (!sessionToken || sessionToken.length < 32) {
    return { user: null };
  }

  const db = asyncDb || getAsyncDb();
  const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
  const now = new Date().toISOString();

  const row = await db.queryOne<AuthenticatedUser & { isActive: number; expiresAt: string }>(
    `SELECT
       u.id, u.username, u.email, u.full_name as "fullName", u.role, u.is_active as "isActive",
       s.expires_at as "expiresAt"
     FROM sessions s
     JOIN staff_users u ON s.staff_id = u.id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1`,
    [tokenHash, now]
  );

  if (!row) {
    let isPreempted = false;
    try {
      const preempted = await db.queryOne<{ staff_id: string }>(
        `SELECT staff_id FROM session_preemptions
         WHERE token_hash = ? AND expires_at > ?`,
        [tokenHash, now]
      );

      if (preempted) {
        isPreempted = true;
      }
    } catch {
      // Table may not exist yet in legacy test isolation
    }

    return { user: null, isPreempted: isPreempted || undefined };
  }

  // Periodic throttled cleanup of expired records (non-blocking)
  performDatabaseCleanupAsync(db).catch(() => {});

  return {
    user: {
      id: row.id,
      username: row.username,
      email: row.email,
      fullName: row.fullName,
      role: row.role as any,
    },
  };
}

/**
 * Destroys an active session by deleting its corresponding SHA-256 hash.
 */
export async function destroySession(sessionToken: string, asyncDb?: AsyncDb): Promise<void> {
  if (!sessionToken) return;
  const db = asyncDb || getAsyncDb();
  const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
  await Promise.all([
    db.execute("DELETE FROM session_preemptions WHERE token_hash = ?", [tokenHash]).catch(() => {}),
    db.execute("DELETE FROM sessions WHERE token_hash = ?", [tokenHash]),
  ]);
}

/**
 * Revokes all active sessions for a given staff user (e.g., upon deactivation or password reset).
 */
export async function revokeAllUserSessions(staffId: string, asyncDb?: AsyncDb): Promise<void> {
  if (!staffId) return;
  const db = asyncDb || getAsyncDb();
  await Promise.all([
    db.execute("DELETE FROM session_preemptions WHERE staff_id = ?", [staffId]).catch(() => {}),
    db.execute("DELETE FROM sessions WHERE staff_id = ?", [staffId]),
  ]);
}

// -----------------------------------------------------------------------------
// Email OTP Challenge Flow (10-minute expiry, max 3 attempts)
// -----------------------------------------------------------------------------
export interface OtpPersistenceMetrics {
  throttleCheckMs: number;
  cleanupPriorMs: number;
  insertChallengeMs: number;
  totalPersistenceMs: number;
  smtpDispatchMs: number;
  totalChallengeFlowMs: number;
}

export async function createOtpChallenge(
  staffId: string,
  email: string,
  asyncDb?: AsyncDb
): Promise<{ challengeId: string; maskedEmail: string; metrics?: OtpPersistenceMetrics }> {
  const tFlowStart = Date.now();
  const db = asyncDb || getAsyncDb();
  const now = new Date();

  // Resend throttling: check if a challenge was created in the last 60 seconds
  const tCheckStart = Date.now();
  const recent = await db.queryOne<{ created_at: string }>(
    `SELECT created_at FROM auth_challenges
     WHERE staff_id = ? AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    [staffId, now.toISOString()]
  );
  const throttleCheckMs = Date.now() - tCheckStart;

  if (recent) {
    const elapsedSec = (now.getTime() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsedSec < 60) {
      const waitSec = Math.ceil(60 - elapsedSec);
      throw new Error(`Please wait ${waitSec} seconds before requesting a new verification code.`);
    }
  }

  // Clear prior challenges for this staff member
  const tCleanStart = Date.now();
  await db.execute("DELETE FROM auth_challenges WHERE staff_id = ?", [staffId]);
  const cleanupPriorMs = Date.now() - tCleanStart;

  // Generate cryptographically secure 6-digit numeric OTP (100000 - 999999)
  const rawOtp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = crypto.createHash("sha256").update(rawOtp).digest("hex");

  const challengeId = `chl_${crypto.randomUUID()}`;
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

  const tInsStart = Date.now();
  await db.execute(
    `INSERT INTO auth_challenges (id, staff_id, otp_hash, attempts, expires_at, created_at)
     VALUES (?, ?, ?, 0, ?, ?)`,
    [challengeId, staffId, otpHash, expiresAt, now.toISOString()]
  );
  const insertChallengeMs = Date.now() - tInsStart;
  const totalPersistenceMs = throttleCheckMs + cleanupPriorMs + insertChallengeMs;

  // Dispatch OTP via Email Adapter
  const tSmtpStart = Date.now();
  let sent = false;
  try {
    sent = await getEmailAdapter().sendOtp(email, rawOtp);
  } catch {
    sent = false;
  }
  const smtpDispatchMs = Date.now() - tSmtpStart;

  if (!sent) {
    await db.execute("DELETE FROM auth_challenges WHERE id = ?", [challengeId]);
    throw new Error("Unable to deliver verification code. Please check your email configuration or contact system administrator.");
  }

  const totalChallengeFlowMs = Date.now() - tFlowStart;
  const metrics: OtpPersistenceMetrics = {
    throttleCheckMs,
    cleanupPriorMs,
    insertChallengeMs,
    totalPersistenceMs,
    smtpDispatchMs,
    totalChallengeFlowMs,
  };

  console.log(
    `[OTP Lifecycle] total=${totalChallengeFlowMs}ms | persistence=${totalPersistenceMs}ms (check=${throttleCheckMs}ms, clean=${cleanupPriorMs}ms, ins=${insertChallengeMs}ms) | smtp=${smtpDispatchMs}ms`
  );

  return {
    challengeId,
    maskedEmail: maskEmail(email),
    metrics,
  };
}

export async function verifyOtpChallenge(
  challengeId: string,
  otp: string,
  metadata?: { ip?: string; userAgent?: string },
  asyncDb?: AsyncDb
): Promise<{ user: AuthenticatedUser; sessionToken: string; expiresAt: Date }> {
  const db = asyncDb || getAsyncDb();
  const cleanOtp = (otp || "").trim();
  const now = new Date().toISOString();

  // Unified single-roundtrip query joining auth_challenges and staff_users
  const challenge = await db.queryOne<{
    id: string;
    staff_id: string;
    otp_hash: string;
    attempts: number;
    expires_at: string;
    username: string;
    email: string;
    fullName: string;
    role: string;
    isActive: number;
  }>(
    `SELECT
       c.id, c.staff_id, c.otp_hash, c.attempts, c.expires_at,
       u.username, u.email, u.full_name as "fullName", u.role, u.is_active as "isActive"
     FROM auth_challenges c
     JOIN staff_users u ON c.staff_id = u.id
     WHERE c.id = ?`,
    [challengeId]
  );

  if (!challenge) {
    throw new Error("Invalid or expired verification challenge. Please log in again.");
  }

  if (Number(challenge.isActive) !== 1) {
    await db.execute("DELETE FROM auth_challenges WHERE id = ?", [challengeId]);
    throw new Error("Account is inactive or no longer exists.");
  }

  if (challenge.expires_at <= now) {
    await db.execute("DELETE FROM auth_challenges WHERE id = ?", [challengeId]);
    throw new Error("Verification code has expired. Please log in again.");
  }

  if (challenge.attempts >= 3) {
    await db.execute("DELETE FROM auth_challenges WHERE id = ?", [challengeId]);
    throw new Error("Too many failed attempts. Verification code has been invalidated. Please log in again.");
  }

  const presentedHash = crypto.createHash("sha256").update(cleanOtp).digest("hex");
  const presentedBuf = Buffer.from(presentedHash, "hex");
  const storedBuf = Buffer.from(challenge.otp_hash, "hex");
  const isMatch =
    presentedBuf.length === storedBuf.length &&
    crypto.timingSafeEqual(presentedBuf, storedBuf);

  if (!isMatch) {
    const newAttempts = challenge.attempts + 1;
    if (newAttempts >= 3) {
      await db.execute("DELETE FROM auth_challenges WHERE id = ?", [challengeId]);
      throw new Error("Too many failed attempts. Verification code has been invalidated. Please log in again.");
    }
    await db.execute("UPDATE auth_challenges SET attempts = ? WHERE id = ?", [newAttempts, challengeId]);
    throw new Error(`Invalid verification code. ${3 - newAttempts} attempts remaining.`);
  }

  // Verification succeeded:
  // Atomically claim challenge and create session inside a single transaction
  const { sessionToken, expiresAt } = await db.transaction(async (tx) => {
    const delRes = await tx.execute("DELETE FROM auth_challenges WHERE id = ?", [challengeId]);
    if (!delRes || delRes.changes === 0) {
      throw new Error("Invalid or expired verification challenge. Please log in again.");
    }
    return createSession(challenge.staff_id, { ...metadata, preempt: true }, tx);
  });

  return {
    user: {
      id: challenge.staff_id,
      username: challenge.username,
      email: challenge.email,
      fullName: challenge.fullName,
      role: challenge.role as any,
    },
    sessionToken,
    expiresAt,
  };
}

/**
 * Resends a verification OTP for an active challenge, respecting 60-second cooldown throttling.
 */
export async function resendOtpChallenge(
  challengeId: string,
  asyncDb?: AsyncDb
): Promise<{ challengeId: string; maskedEmail: string }> {
  const db = asyncDb || getAsyncDb();
  const now = new Date().toISOString();

  const challenge = await db.queryOne<{
    id: string;
    staff_id: string;
    expires_at: string;
  }>(
    `SELECT id, staff_id, expires_at
     FROM auth_challenges
     WHERE id = ?`,
    [challengeId]
  );

  if (!challenge || challenge.expires_at <= now) {
    throw new Error("Verification session has expired. Please log in again.");
  }

  const staff = await db.queryOne<{ id: string; email: string; isActive: number }>(
    `SELECT id, email, is_active as "isActive"
     FROM staff_users
     WHERE id = ? AND is_active = 1`,
    [challenge.staff_id]
  );

  if (!staff) {
    throw new Error("Account is inactive or no longer exists.");
  }

  return createOtpChallenge(staff.id, staff.email, db);
}

// -----------------------------------------------------------------------------
// Password Recovery Flow (256-bit token, 1-hour expiry, single-use, session wipe)
// -----------------------------------------------------------------------------
export async function initiatePasswordReset(
  identifier: string,
  origin?: string,
  asyncDb?: AsyncDb
): Promise<{ success: true; message: string }> {
  const db = asyncDb || getAsyncDb();
  const cleanId = (identifier || "").trim().toLowerCase();

  const genericResponse = {
    success: true as const,
    message: "If an account matching that identifier exists, a password reset link has been dispatched.",
  };

  if (!cleanId) {
    return genericResponse;
  }

  const staff = await findStaffByIdentifier(cleanId, db);

  if (!staff) {
    // Timing-safe: return generic response without leaking existence
    return genericResponse;
  }

  // Invalidate any previous unused password resets for this staff member
  await db.execute("DELETE FROM password_resets WHERE staff_id = ?", [staff.id]);

  // Generate cryptographically secure 256-bit token (32 random bytes)
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const resetId = `pr_${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  await db.execute(
    `INSERT INTO password_resets (id, staff_id, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [resetId, staff.id, tokenHash, expiresAt, now.toISOString()]
  );

  const baseUrl = origin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  const resetUrl = `${baseUrl}/login?token=${rawToken}`;

  await getEmailAdapter().sendPasswordReset(staff.email, resetUrl);

  return genericResponse;
}

export async function completePasswordReset(
  token: string,
  newPassword: string,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<{ success: boolean; error?: string }> {
  if (!token || token.length < 32) {
    return { success: false, error: "Invalid or expired password reset token." };
  }

  if (!newPassword || newPassword.length < 12) {
    return { success: false, error: "New password must be at least 12 characters long." };
  }

  const db = asyncDb || getAsyncDb();
  const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
  const now = new Date().toISOString();

  const resetRecord = await db.queryOne<{
    id: string;
    staff_id: string;
    expires_at: string;
    used_at: string | null;
  }>(
    `SELECT id, staff_id, expires_at, used_at
     FROM password_resets
     WHERE token_hash = ? AND used_at IS NULL`,
    [tokenHash]
  );

  if (!resetRecord || resetRecord.expires_at <= now) {
    return { success: false, error: "Invalid or expired password reset token." };
  }

  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    // 1. Update password
    await tx.execute(
      `UPDATE staff_users
       SET password_hash = ?, updated_at = ?
       WHERE id = ?`,
      [passwordHash, now, resetRecord.staff_id]
    );

    // 2. Mark reset token as used (single-use)
    await tx.execute(
      `UPDATE password_resets
       SET used_at = ?
       WHERE id = ?`,
      [now, resetRecord.id]
    );

    // 3. Revoke all active sessions for this account across all devices
    await revokeAllUserSessions(resetRecord.staff_id, tx);

    // 4. Record audit event
    await recordAuditEventAsync(
      {
        actorId: resetRecord.staff_id,
        actorUsername: "system_password_reset",
        action: "staff.password_reset",
        targetType: "staff",
        targetId: resetRecord.staff_id,
        metadata: { reason: "Self-service recovery via email token" },
        ipAddress: clientIp,
      },
      tx
    );
  });

  return { success: true };
}
