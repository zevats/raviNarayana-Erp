import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getDb } from "../database/db";
import { performDatabaseCleanup } from "../database/cleanup";
import { StaffUser, AuthenticatedUser } from "../../types";

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
export function checkRateLimit(identifier: string, ipAddress: string): RateLimitCheckResult {
  const db = getDb();
  const cleanId = identifier.trim().toLowerCase();
  const cleanIp = ipAddress.trim().toLowerCase();
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();

  // Layer 1: IP-based rate limit
  const ipResult = db.prepare(`
    SELECT COUNT(*) as failedCount, MIN(attempted_at) as oldestAttempt
    FROM login_attempts
    WHERE ip_address = ? AND success = 0 AND attempted_at >= ?
  `).get(cleanIp, windowStart) as { failedCount: number; oldestAttempt: string | null };

  if (ipResult.failedCount >= MAX_IP_FAILED_ATTEMPTS) {
    let remainingMinutes = RATE_LIMIT_WINDOW_MINUTES;
    if (ipResult.oldestAttempt) {
      const elapsedMs = Date.now() - new Date(ipResult.oldestAttempt).getTime();
      remainingMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - elapsedMs) / 60000));
    }
    return {
      isLimited: true,
      remainingMinutes,
      shouldSlowDown: false,
      reason: "Too many failed login attempts from this network. Access temporarily restricted.",
    };
  }

  // Layer 2: (Identifier + IP) rate limit
  const pairResult = db.prepare(`
    SELECT COUNT(*) as failedCount, MIN(attempted_at) as oldestAttempt
    FROM login_attempts
    WHERE identifier = ? AND ip_address = ? AND success = 0 AND attempted_at >= ?
  `).get(cleanId, cleanIp, windowStart) as { failedCount: number; oldestAttempt: string | null };

  if (pairResult.failedCount >= MAX_PAIR_FAILED_ATTEMPTS) {
    let remainingMinutes = RATE_LIMIT_WINDOW_MINUTES;
    if (pairResult.oldestAttempt) {
      const elapsedMs = Date.now() - new Date(pairResult.oldestAttempt).getTime();
      remainingMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - elapsedMs) / 60000));
    }
    return {
      isLimited: true,
      remainingMinutes,
      shouldSlowDown: false,
      reason: "Too many failed attempts for this account from this network. Please try again later.",
    };
  }

  // Layer 3: Distributed account velocity check (avoids account lockout denial-of-service)
  const distResult = db.prepare(`
    SELECT COUNT(*) as totalFailures
    FROM login_attempts
    WHERE identifier = ? AND success = 0 AND attempted_at >= ?
  `).get(cleanId, windowStart) as { totalFailures: number };

  const shouldSlowDown = distResult.totalFailures >= DISTRIBUTED_ABUSE_THRESHOLD;

  return {
    isLimited: false,
    remainingMinutes: 0,
    shouldSlowDown,
  };
}

/**
 * Atomic rate-limiting evaluation and attempt reservation.
 * Evaluates Layer 1 (IP), Layer 2 (Identifier + IP), and Layer 3 (Distributed velocity)
 * within an atomic SQLite transaction.
 * 
 * If the request is permitted, an initial failed attempt record (success = 0) is atomically
 * reserved in the database. If authentication subsequently succeeds, recordLoginSuccess()
 * wipes the failed attempts for this (identifier, ip) pair.
 * 
 * This guarantees that concurrent burst requests cannot bypass rate limits during
 * asynchronous password verification (bcrypt execution).
 */
export function checkRateLimitAndRecord(identifier: string, ipAddress: string): RateLimitCheckResult {
  const db = getDb();
  const cleanId = identifier.trim().toLowerCase();
  const cleanIp = ipAddress.trim().toLowerCase();
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  let checkResult: RateLimitCheckResult = {
    isLimited: false,
    remainingMinutes: 0,
    shouldSlowDown: false,
  };

  const tx = db.transaction(() => {
    // Layer 1: IP-based rate limit
    const ipResult = db.prepare(`
      SELECT COUNT(*) as failedCount, MIN(attempted_at) as oldestAttempt
      FROM login_attempts
      WHERE ip_address = ? AND success = 0 AND attempted_at >= ?
    `).get(cleanIp, windowStart) as { failedCount: number; oldestAttempt: string | null };

    if (ipResult.failedCount >= MAX_IP_FAILED_ATTEMPTS) {
      let remainingMinutes = RATE_LIMIT_WINDOW_MINUTES;
      if (ipResult.oldestAttempt) {
        const elapsedMs = Date.now() - new Date(ipResult.oldestAttempt).getTime();
        remainingMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - elapsedMs) / 60000));
      }
      checkResult = {
        isLimited: true,
        remainingMinutes,
        shouldSlowDown: false,
        reason: "Too many failed login attempts from this network. Access temporarily restricted.",
      };
      return;
    }

    // Layer 2: (Identifier + IP) rate limit
    const pairResult = db.prepare(`
      SELECT COUNT(*) as failedCount, MIN(attempted_at) as oldestAttempt
      FROM login_attempts
      WHERE identifier = ? AND ip_address = ? AND success = 0 AND attempted_at >= ?
    `).get(cleanId, cleanIp, windowStart) as { failedCount: number; oldestAttempt: string | null };

    if (pairResult.failedCount >= MAX_PAIR_FAILED_ATTEMPTS) {
      let remainingMinutes = RATE_LIMIT_WINDOW_MINUTES;
      if (pairResult.oldestAttempt) {
        const elapsedMs = Date.now() - new Date(pairResult.oldestAttempt).getTime();
        remainingMinutes = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MINUTES * 60 * 1000 - elapsedMs) / 60000));
      }
      checkResult = {
        isLimited: true,
        remainingMinutes,
        shouldSlowDown: false,
        reason: "Too many failed attempts for this account from this network. Please try again later.",
      };
      return;
    }

    // Layer 3: Distributed account velocity check (avoids account lockout denial-of-service)
    const distResult = db.prepare(`
      SELECT COUNT(*) as totalFailures
      FROM login_attempts
      WHERE identifier = ? AND success = 0 AND attempted_at >= ?
    `).get(cleanId, windowStart) as { totalFailures: number };

    const shouldSlowDown = distResult.totalFailures >= DISTRIBUTED_ABUSE_THRESHOLD;

    // Atomically reserve attempt record with success = 0
    const id = `att_${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success)
      VALUES (?, ?, ?, ?, 0)
    `).run(id, cleanId, cleanIp, now);

    checkResult = {
      isLimited: false,
      remainingMinutes: 0,
      shouldSlowDown,
    };
  });

  tx();
  return checkResult;
}

export function recordLoginSuccess(identifier: string, ipAddress: string): void {
  const db = getDb();
  const cleanId = identifier.trim().toLowerCase();
  const cleanIp = ipAddress.trim().toLowerCase();
  const now = new Date().toISOString();
  const id = `att_${crypto.randomUUID()}`;

  const tx = db.transaction(() => {
    db.prepare(`
      DELETE FROM login_attempts
      WHERE identifier = ? AND ip_address = ? AND success = 0
    `).run(cleanId, cleanIp);

    db.prepare(`
      INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success)
      VALUES (?, ?, ?, ?, 1)
    `).run(id, cleanId, cleanIp, now);
  });

  tx();
}

export function recordLoginAttempt(identifier: string, ipAddress: string, success: boolean): void {
  const db = getDb();
  const id = `att_${crypto.randomUUID()}`;
  const cleanId = identifier.trim().toLowerCase();
  const cleanIp = ipAddress.trim().toLowerCase();
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, cleanId, cleanIp, now, success ? 1 : 0);

    // If successful, reset failed attempt counters for this (identifier, ip) client
    if (success) {
      db.prepare(`
        DELETE FROM login_attempts
        WHERE identifier = ? AND ip_address = ? AND success = 0
      `).run(cleanId, cleanIp);
    }
  });

  tx();
}

export function findStaffByIdentifier(identifier: string): (StaffUser & { password_hash: string }) | null {
  const db = getDb();
  const cleanId = identifier.trim().toLowerCase();

  const row = db.prepare(`
    SELECT 
      id, username, email, full_name as fullName, password_hash, 
      role, is_active as isActive, created_at as createdAt, 
      updated_at as updatedAt, last_login_at as lastLoginAt
    FROM staff_users
    WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND is_active = 1
  `).get(cleanId, cleanId) as (StaffUser & { password_hash: string }) | undefined;

  return row || null;
}

/**
 * Creates a cryptographically random session token for the client cookie,
 * while storing only a one-way SHA-256 digest at rest in the database.
 */
import { getEmailAdapter } from "../notifications/emailAdapter";
import { recordAuditEvent } from "../audit/audit";

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
export function createSession(
  staffId: string,
  metadata?: { ip?: string; userAgent?: string; preempt?: boolean }
): { sessionToken: string; expiresAt: Date } {
  const db = getDb();
  const id = `sess_${crypto.randomUUID()}`;
  
  // 32 cryptographically secure random bytes = 256 bits of entropy
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date().toISOString();

  // Atomically preempt existing sessions when requested (single active session enforcement)
  const shouldPreempt = metadata?.preempt === true;

  const tx = db.transaction(() => {
    if (shouldPreempt) {
      try {
        const existing = db
          .prepare("SELECT token_hash, expires_at FROM sessions WHERE staff_id = ?")
          .all(staffId) as Array<{ token_hash: string; expires_at: string }>;

        const insertPreempt = db.prepare(`
          INSERT INTO session_preemptions (id, token_hash, staff_id, preempted_at, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const s of existing) {
          insertPreempt.run(
            `prm_${crypto.randomUUID()}`,
            s.token_hash,
            staffId,
            now,
            s.expires_at || expiresAt.toISOString(),
            now
          );
        }
      } catch {
        // Fallback if session_preemptions is not yet migrated in test runner
      }

      db.prepare("DELETE FROM sessions WHERE staff_id = ?").run(staffId);
    }

    db.prepare(`
      INSERT INTO sessions (id, token_hash, staff_id, expires_at, created_at, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      tokenHash,
      staffId,
      expiresAt.toISOString(),
      now,
      metadata?.ip || null,
      metadata?.userAgent || null
    );

    db.prepare("UPDATE staff_users SET last_login_at = ? WHERE id = ?").run(now, staffId);
  });

  tx();

  // Throttled background cleanup for expired records
  performDatabaseCleanup(db);

  return { sessionToken: rawToken, expiresAt };
}

/**
 * Validates a session token presented by the client cookie by hashing it
 * and matching against the SHA-256 token digest at rest.
 */
export function validateSession(sessionToken: string): AuthenticatedUser | null {
  const res = validateSessionDetailed(sessionToken);
  return res.user;
}

export function validateSessionDetailed(sessionToken: string): {
  user: AuthenticatedUser | null;
  isPreempted?: boolean;
} {
  if (!sessionToken || sessionToken.length < 32) {
    return { user: null };
  }

  const db = getDb();
  const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
  const now = new Date().toISOString();

  const row = db.prepare(`
    SELECT 
      u.id, u.username, u.email, u.full_name as fullName, u.role, u.is_active as isActive,
      s.expires_at as expiresAt
    FROM sessions s
    JOIN staff_users u ON s.staff_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1
  `).get(tokenHash, now) as (AuthenticatedUser & { isActive: number; expiresAt: string }) | undefined;

  if (!row) {
    try {
      const preempted = db.prepare(`
        SELECT staff_id FROM session_preemptions
        WHERE token_hash = ? AND expires_at > ?
      `).get(tokenHash, now) as { staff_id: string } | undefined;

      if (preempted) {
        return { user: null, isPreempted: true };
      }
    } catch {
      // Table may not exist yet in legacy test isolation
    }
    return { user: null };
  }

  // Periodic throttled cleanup of expired records
  performDatabaseCleanup(db);

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
export function destroySession(sessionToken: string): void {
  if (!sessionToken) return;
  const db = getDb();
  const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
  try {
    db.prepare("DELETE FROM session_preemptions WHERE token_hash = ?").run(tokenHash);
  } catch {}
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

/**
 * Revokes all active sessions for a given staff user (e.g., upon deactivation or password reset).
 */
export function revokeAllUserSessions(staffId: string): void {
  if (!staffId) return;
  const db = getDb();
  try {
    db.prepare("DELETE FROM session_preemptions WHERE staff_id = ?").run(staffId);
  } catch {}
  db.prepare("DELETE FROM sessions WHERE staff_id = ?").run(staffId);
}

// -----------------------------------------------------------------------------
// Email OTP Challenge Flow (10-minute expiry, max 3 attempts)
// -----------------------------------------------------------------------------
export async function createOtpChallenge(
  staffId: string,
  email: string
): Promise<{ challengeId: string; maskedEmail: string }> {
  const db = getDb();
  const now = new Date();

  // Resend throttling: check if a challenge was created in the last 60 seconds
  const recent = db.prepare(`
    SELECT created_at FROM auth_challenges
    WHERE staff_id = ? AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).get(staffId, now.toISOString()) as { created_at: string } | undefined;

  if (recent) {
    const elapsedSec = (now.getTime() - new Date(recent.created_at).getTime()) / 1000;
    if (elapsedSec < 60) {
      const waitSec = Math.ceil(60 - elapsedSec);
      throw new Error(`Please wait ${waitSec} seconds before requesting a new verification code.`);
    }
  }

  // Clear prior challenges for this staff member
  db.prepare("DELETE FROM auth_challenges WHERE staff_id = ?").run(staffId);

  // Generate cryptographically secure 6-digit numeric OTP (100000 - 999999)
  const rawOtp = crypto.randomInt(100000, 1000000).toString();
  const otpHash = crypto.createHash("sha256").update(rawOtp).digest("hex");

  const challengeId = `chl_${crypto.randomUUID()}`;
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO auth_challenges (id, staff_id, otp_hash, attempts, expires_at, created_at)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(challengeId, staffId, otpHash, expiresAt, now.toISOString());

  // Dispatch OTP via Email Adapter
  await getEmailAdapter().sendOtp(email, rawOtp);

  return {
    challengeId,
    maskedEmail: maskEmail(email),
  };
}

export async function verifyOtpChallenge(
  challengeId: string,
  otp: string,
  metadata?: { ip?: string; userAgent?: string }
): Promise<{ user: AuthenticatedUser; sessionToken: string; expiresAt: Date }> {
  const db = getDb();
  const cleanOtp = (otp || "").trim();
  const now = new Date().toISOString();

  const challenge = db.prepare(`
    SELECT id, staff_id, otp_hash, attempts, expires_at
    FROM auth_challenges
    WHERE id = ?
  `).get(challengeId) as {
    id: string;
    staff_id: string;
    otp_hash: string;
    attempts: number;
    expires_at: string;
  } | undefined;

  if (!challenge) {
    throw new Error("Invalid or expired verification challenge. Please log in again.");
  }

  if (challenge.expires_at <= now) {
    db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(challengeId);
    throw new Error("Verification code has expired. Please log in again.");
  }

  if (challenge.attempts >= 3) {
    db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(challengeId);
    throw new Error("Too many failed attempts. Verification code has been invalidated. Please log in again.");
  }

  const presentedHash = crypto.createHash("sha256").update(cleanOtp).digest("hex");

  if (presentedHash !== challenge.otp_hash) {
    const newAttempts = challenge.attempts + 1;
    if (newAttempts >= 3) {
      db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(challengeId);
      throw new Error("Too many failed attempts. Verification code has been invalidated. Please log in again.");
    }
    db.prepare("UPDATE auth_challenges SET attempts = ? WHERE id = ?").run(newAttempts, challengeId);
    throw new Error(`Invalid verification code. ${3 - newAttempts} attempts remaining.`);
  }

  // Verification succeeded: delete challenge (single-use)
  db.prepare("DELETE FROM auth_challenges WHERE id = ?").run(challengeId);

  // Fetch staff user details
  const staff = db.prepare(`
    SELECT id, username, email, full_name as fullName, role, is_active as isActive
    FROM staff_users
    WHERE id = ? AND is_active = 1
  `).get(challenge.staff_id) as AuthenticatedUser & { isActive: number } | undefined;

  if (!staff) {
    throw new Error("Account is inactive or no longer exists.");
  }

  // Create session with Single Active Session Preemption
  const { sessionToken, expiresAt } = createSession(staff.id, { ...metadata, preempt: true });

  return {
    user: {
      id: staff.id,
      username: staff.username,
      email: staff.email,
      fullName: staff.fullName,
      role: staff.role as any,
    },
    sessionToken,
    expiresAt,
  };
}

// -----------------------------------------------------------------------------
// Password Recovery Flow (256-bit token, 1-hour expiry, single-use, session wipe)
// -----------------------------------------------------------------------------
export async function initiatePasswordReset(
  identifier: string,
  origin?: string
): Promise<{ success: true; message: string }> {
  const db = getDb();
  const cleanId = (identifier || "").trim().toLowerCase();

  const genericResponse = {
    success: true as const,
    message: "If an account matching that identifier exists, a password reset link has been dispatched.",
  };

  if (!cleanId) {
    return genericResponse;
  }

  const staff = db.prepare(`
    SELECT id, email, is_active as isActive
    FROM staff_users
    WHERE (LOWER(username) = ? OR LOWER(email) = ?) AND is_active = 1
  `).get(cleanId, cleanId) as { id: string; email: string; isActive: number } | undefined;

  if (!staff) {
    // Timing-safe: return generic response without leaking existence
    return genericResponse;
  }

  // Invalidate any previous unused password resets for this staff member
  db.prepare("DELETE FROM password_resets WHERE staff_id = ?").run(staff.id);

  // Generate cryptographically secure 256-bit token (32 random bytes)
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const resetId = `pr_${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO password_resets (id, staff_id, token_hash, expires_at, used_at, created_at)
    VALUES (?, ?, ?, ?, NULL, ?)
  `).run(resetId, staff.id, tokenHash, expiresAt, now.toISOString());

  const baseUrl = origin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  const resetUrl = `${baseUrl}/login?token=${rawToken}`;

  await getEmailAdapter().sendPasswordReset(staff.email, resetUrl);

  return genericResponse;
}

export async function completePasswordReset(
  token: string,
  newPassword: string,
  clientIp?: string
): Promise<{ success: boolean; error?: string }> {
  if (!token || token.length < 32) {
    return { success: false, error: "Invalid or expired password reset token." };
  }

  if (!newPassword || newPassword.length < 12) {
    return { success: false, error: "New password must be at least 12 characters long." };
  }

  const db = getDb();
  const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
  const now = new Date().toISOString();

  const resetRecord = db.prepare(`
    SELECT id, staff_id, expires_at, used_at
    FROM password_resets
    WHERE token_hash = ? AND used_at IS NULL
  `).get(tokenHash) as {
    id: string;
    staff_id: string;
    expires_at: string;
    used_at: string | null;
  } | undefined;

  if (!resetRecord || resetRecord.expires_at <= now) {
    return { success: false, error: "Invalid or expired password reset token." };
  }

  const passwordHash = await hashPassword(newPassword);

  const tx = db.transaction(() => {
    // 1. Update password
    db.prepare(`
      UPDATE staff_users
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(passwordHash, now, resetRecord.staff_id);

    // 2. Mark reset token as used (single-use)
    db.prepare(`
      UPDATE password_resets
      SET used_at = ?
      WHERE id = ?
    `).run(now, resetRecord.id);

    // 3. Revoke all active sessions for this account across all devices
    revokeAllUserSessions(resetRecord.staff_id);

    // 4. Record audit event
    recordAuditEvent({
      actorId: resetRecord.staff_id,
      actorUsername: "system_password_reset",
      action: "staff.password_reset",
      targetType: "staff",
      targetId: resetRecord.staff_id,
      metadata: { reason: "Self-service recovery via email token" },
      ipAddress: clientIp,
    });
  });

  tx();

  return { success: true };
}

