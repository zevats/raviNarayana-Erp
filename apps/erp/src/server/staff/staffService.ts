import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { isValidRole } from "../authorization/permissions";
import { recordAuditEvent } from "../audit/audit";
import { AuthenticatedUser, StaffRole, StaffUser } from "@/types";

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateStaffInput {
  username: string;
  email: string;
  fullName: string;
  password: string;
  role: StaffRole;
}

export interface UpdateStaffProfileInput {
  fullName?: string;
  email?: string;
}

/**
 * List all staff users. Requires staff.read permission.
 */
export function listStaffUsers(actor: AuthenticatedUser): StaffUser[] {
  requirePermission(actor, "staff.read");
  const db = getDb();

  const rows = db.prepare(`
    SELECT 
      id, username, email, full_name as fullName, role, 
      is_active as isActive, created_at as createdAt, 
      updated_at as updatedAt, last_login_at as lastLoginAt
    FROM staff_users
    ORDER BY created_at ASC
  `).all() as any[];

  return rows.map((r) => ({
    ...r,
    isActive: Boolean(r.isActive),
  }));
}

/**
 * Retrieve a single staff user by ID.
 * Requires staff.read permission or self-lookup.
 */
export function getStaffUserById(actor: AuthenticatedUser, targetId: string): StaffUser | null {
  if (actor.id !== targetId) {
    requirePermission(actor, "staff.read");
  }

  const db = getDb();
  const row = db.prepare(`
    SELECT 
      id, username, email, full_name as fullName, role, 
      is_active as isActive, created_at as createdAt, 
      updated_at as updatedAt, last_login_at as lastLoginAt
    FROM staff_users
    WHERE id = ?
  `).get(targetId) as any;

  if (!row) return null;

  return {
    ...row,
    isActive: Boolean(row.isActive),
  };
}

/**
 * Provisions a new staff account.
 * Requires staff.create and staff.assign_role permissions.
 */
export async function createStaffUser(
  actor: AuthenticatedUser,
  input: CreateStaffInput,
  clientIp?: string
): Promise<StaffUser> {
  requirePermission(actor, "staff.create", { ip: clientIp, action: "staff.create" });
  requirePermission(actor, "staff.assign_role", { ip: clientIp, action: "staff.assign_role" });

  const cleanUsername = input.username?.trim().toLowerCase();
  const cleanEmail = input.email?.trim().toLowerCase();
  const cleanFullName = input.fullName?.trim();
  const password = input.password;
  const role = input.role;

  // Input validation
  if (!cleanUsername || !USERNAME_REGEX.test(cleanUsername)) {
    throw new Error("Username must be between 3 and 30 alphanumeric characters or underscores.");
  }
  if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
    throw new Error("A valid email address is required.");
  }
  if (!cleanFullName || cleanFullName.length < 2 || cleanFullName.length > 100) {
    throw new Error("Full name must be between 2 and 100 characters.");
  }
  if (!password || password.length < 12) {
    throw new Error("Password must be at least 12 characters long.");
  }
  if (!isValidRole(role)) {
    throw new Error(`Invalid role '${role}'.`);
  }

  const db = getDb();

  // Check unique constraints
  const existing = db.prepare(`
    SELECT username, email FROM staff_users 
    WHERE LOWER(username) = ? OR LOWER(email) = ?
  `).get(cleanUsername, cleanEmail) as { username: string; email: string } | undefined;

  if (existing) {
    if (existing.username.toLowerCase() === cleanUsername) {
      throw new Error(`Username '${cleanUsername}' is already in use.`);
    }
    if (existing.email.toLowerCase() === cleanEmail) {
      throw new Error(`Email address '${cleanEmail}' is already registered.`);
    }
  }

  // Hash password with 12 bcrypt salt rounds
  const passwordHash = await bcrypt.hash(password, 12);
  const newId = `usr_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(newId, cleanUsername, cleanEmail, cleanFullName, passwordHash, role, now, now);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "staff.created",
      targetType: "staff_user",
      targetId: newId,
      metadata: {
        username: cleanUsername,
        email: cleanEmail,
        fullName: cleanFullName,
        assignedRole: role,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return {
    id: newId,
    username: cleanUsername,
    email: cleanEmail,
    fullName: cleanFullName,
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  };
}

/**
 * Assigns or updates a staff member's role.
 * Requires staff.assign_role permission.
 * Enforces the Sole Super-Admin Protection rule.
 */
export function updateStaffRole(
  actor: AuthenticatedUser,
  targetUserId: string,
  newRole: StaffRole,
  clientIp?: string
): void {
  requirePermission(actor, "staff.assign_role", { ip: clientIp, targetId: targetUserId, action: "staff.assign_role" });

  if (!isValidRole(newRole)) {
    throw new Error(`Invalid role '${newRole}'.`);
  }

  const db = getDb();
  const target = db.prepare(`
    SELECT id, username, role, is_active as isActive FROM staff_users WHERE id = ?
  `).get(targetUserId) as { id: string; username: string; role: StaffRole; isActive: number } | undefined;

  if (!target) {
    throw new Error(`Staff user '${targetUserId}' not found.`);
  }

  if (target.role === newRole) {
    return; // No change needed
  }

  // Sole Super-Admin Protection: cannot demote the last active super-administrator
  if (target.role === "SUPER_ADMIN" && newRole !== "SUPER_ADMIN") {
    const adminCount = db.prepare(`
      SELECT COUNT(*) as count FROM staff_users WHERE role = 'SUPER_ADMIN' AND is_active = 1
    `).get() as { count: number };

    if (adminCount.count <= 1) {
      throw new Error("Cannot demote the sole remaining active Super Administrator.");
    }
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE staff_users SET role = ?, updated_at = ? WHERE id = ?
    `).run(newRole, now, targetUserId);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "staff.role_assigned",
      targetType: "staff_user",
      targetId: targetUserId,
      metadata: {
        previousRole: target.role,
        newRole,
      },
      ipAddress: clientIp,
    });
  });

  tx();
}

/**
 * Activates or deactivates a staff member.
 * Requires staff.deactivate permission.
 * Enforces the Sole Super-Admin Protection rule.
 * Deactivation immediately invalidates all active sessions for the user.
 */
export function setStaffActiveStatus(
  actor: AuthenticatedUser,
  targetUserId: string,
  isActive: boolean,
  clientIp?: string
): void {
  requirePermission(actor, "staff.deactivate", { ip: clientIp, targetId: targetUserId, action: "staff.deactivate" });

  const db = getDb();
  const target = db.prepare(`
    SELECT id, username, role, is_active as isActive FROM staff_users WHERE id = ?
  `).get(targetUserId) as { id: string; username: string; role: StaffRole; isActive: number } | undefined;

  if (!target) {
    throw new Error(`Staff user '${targetUserId}' not found.`);
  }

  const targetIsActive = Boolean(target.isActive);
  if (targetIsActive === isActive) {
    return;
  }

  // Sole Super-Admin Protection: cannot deactivate the last active super-administrator
  if (target.role === "SUPER_ADMIN" && !isActive) {
    const adminCount = db.prepare(`
      SELECT COUNT(*) as count FROM staff_users WHERE role = 'SUPER_ADMIN' AND is_active = 1
    `).get() as { count: number };

    if (adminCount.count <= 1) {
      throw new Error("Cannot deactivate the sole remaining active Super Administrator.");
    }
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE staff_users SET is_active = ?, updated_at = ? WHERE id = ?
    `).run(isActive ? 1 : 0, now, targetUserId);

    // If deactivating, immediately revoke and invalidate all active sessions
    if (!isActive) {
      db.prepare("DELETE FROM sessions WHERE staff_id = ?").run(targetUserId);
    }

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: isActive ? "staff.activated" : "staff.deactivated",
      targetType: "staff_user",
      targetId: targetUserId,
      metadata: {
        previousStatus: targetIsActive,
        newStatus: isActive,
      },
      ipAddress: clientIp,
    });
  });

  tx();
}

/**
 * Administratively resets a staff member's password.
 * Requires staff.update permission.
 * Immediately invalidates all active sessions for the user to prevent hijacked session persistence.
 */
export async function resetStaffPassword(
  actor: AuthenticatedUser,
  targetUserId: string,
  newPassword: string,
  clientIp?: string
): Promise<void> {
  requirePermission(actor, "staff.update", { ip: clientIp, targetId: targetUserId, action: "staff.password_reset" });

  if (!newPassword || newPassword.length < 12) {
    throw new Error("Password must be at least 12 characters long.");
  }

  if (process.env.NODE_ENV === "production" && newPassword === "Ravinarayan@2026") {
    throw new Error("Demonstration password cannot be used in production.");
  }

  const db = getDb();
  const target = db.prepare("SELECT id, username FROM staff_users WHERE id = ?").get(targetUserId) as { id: string; username: string } | undefined;
  if (!target) {
    throw new Error(`Staff user '${targetUserId}' not found.`);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE staff_users SET password_hash = ?, updated_at = ? WHERE id = ?
    `).run(passwordHash, now, targetUserId);

    // Invalidate all active sessions for that staff member upon password reset
    db.prepare("DELETE FROM sessions WHERE staff_id = ?").run(targetUserId);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "staff.password_reset",
      targetType: "staff_user",
      targetId: targetUserId,
      metadata: {
        resetBy: actor.username,
      },
      ipAddress: clientIp,
    });
  });

  tx();
}

/**
 * Updates staff member profile fields (fullName, email).
 * Requires staff.update permission or self-update.
 */
export function updateStaffProfile(
  actor: AuthenticatedUser,
  targetUserId: string,
  input: UpdateStaffProfileInput,
  clientIp?: string
): void {
  if (actor.id !== targetUserId) {
    requirePermission(actor, "staff.update", { ip: clientIp, targetId: targetUserId, action: "staff.update" });
  }

  const db = getDb();
  const target = db.prepare("SELECT id, username, email, full_name as fullName FROM staff_users WHERE id = ?").get(targetUserId) as any;
  if (!target) {
    throw new Error(`Staff user '${targetUserId}' not found.`);
  }

  const updates: string[] = [];
  const params: any[] = [];
  const auditMeta: Record<string, any> = {};

  if (input.fullName !== undefined) {
    const cleanName = input.fullName.trim();
    if (cleanName.length < 2 || cleanName.length > 100) {
      throw new Error("Full name must be between 2 and 100 characters.");
    }
    updates.push("full_name = ?");
    params.push(cleanName);
    auditMeta.previousFullName = target.fullName;
    auditMeta.newFullName = cleanName;
  }

  if (input.email !== undefined) {
    const cleanEmail = input.email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      throw new Error("A valid email address is required.");
    }
    const existing = db.prepare("SELECT id FROM staff_users WHERE LOWER(email) = ? AND id != ?").get(cleanEmail, targetUserId);
    if (existing) {
      throw new Error(`Email address '${cleanEmail}' is already registered.`);
    }
    updates.push("email = ?");
    params.push(cleanEmail);
    auditMeta.previousEmail = target.email;
    auditMeta.newEmail = cleanEmail;
  }

  if (updates.length === 0) {
    return;
  }

  const now = new Date().toISOString();
  updates.push("updated_at = ?");
  params.push(now, targetUserId);

  const tx = db.transaction(() => {
    db.prepare(`UPDATE staff_users SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "staff.updated",
      targetType: "staff_user",
      targetId: targetUserId,
      metadata: auditMeta,
      ipAddress: clientIp,
    });
  });

  tx();
}
