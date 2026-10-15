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
export function createSession(
  staffId: string,
  metadata?: { ip?: string; userAgent?: string }
): { sessionToken: string; expiresAt: Date } {
  const db = getDb();
  const id = `sess_${crypto.randomUUID()}`;
  
  // 32 cryptographically secure random bytes = 256 bits of entropy
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date().toISOString();

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

  // Throttled background cleanup for expired records
  performDatabaseCleanup(db);

  return { sessionToken: rawToken, expiresAt };
}

/**
 * Validates a session token presented by the client cookie by hashing it
 * and matching against the SHA-256 token digest at rest.
 */
export function validateSession(sessionToken: string): AuthenticatedUser | null {
  if (!sessionToken || sessionToken.length < 32) {
    return null;
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
    return null;
  }

  // Periodic throttled cleanup of expired records
  performDatabaseCleanup(db);

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.fullName,
    role: row.role as any,
  };
}

/**
 * Destroys an active session by deleting its corresponding SHA-256 hash.
 */
export function destroySession(sessionToken: string): void {
  if (!sessionToken) return;
  const db = getDb();
  const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}
