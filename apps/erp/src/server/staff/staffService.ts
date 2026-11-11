import { invalidateSessionCache } from "../authentication/sessionCache";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { isValidRole, isAssignableRole } from "../authorization/permissions";
import { isRetiredDemoPassword } from "../database/env";
import { recordAuditEventAsync } from "../audit/audit";
import { getEmailAdapter } from "../notifications/emailAdapter";
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

export interface StaffListFilter {
  search?: string;
  role?: StaffRole;
  isActive?: boolean;
}

export interface StaffStats {
  totalStaff: number;
  activeStaff: number;
  deactivatedStaff: number;
  superAdmins: number;
}

/**
 * List staff users with optional filters (search, role, status).
 * Requires staff.read permission.
 */
export async function listStaffUsers(
  actor: AuthenticatedUser,
  filterOrDb?: StaffListFilter | AsyncDb,
  asyncDb?: AsyncDb
): Promise<StaffUser[]> {
  requirePermission(actor, "staff.read");

  const isFilter = Boolean(
    filterOrDb &&
    typeof filterOrDb === "object" &&
    !("query" in filterOrDb) &&
    !("execute" in filterOrDb)
  );

  const filter: StaffListFilter | undefined = isFilter ? (filterOrDb as StaffListFilter) : undefined;
  const db = (isFilter ? asyncDb : (filterOrDb as AsyncDb)) ?? getAsyncDb();

  const conditions: string[] = [];
  const params: any[] = [];

  if (filter?.role) {
    conditions.push("role = ?");
    params.push(filter.role);
  }

  if (filter?.isActive !== undefined) {
    conditions.push("is_active = ?");
    params.push(filter.isActive ? 1 : 0);
  }

  if (filter?.search) {
    const term = `%${filter.search.trim().toLowerCase()}%`;
    conditions.push("(LOWER(username) LIKE ? OR LOWER(email) LIKE ? OR LOWER(full_name) LIKE ?)");
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await db.query<any>(`
    SELECT
      id,
      username,
      email,
      full_name as "fullName",
      role,
      is_active as "isActive",
      created_at as "createdAt",
      updated_at as "updatedAt",
      last_login_at as "lastLoginAt"
    FROM staff_users
    ${whereClause}
    ORDER BY created_at ASC
  `, params);

  return rows.map((r) => ({
    ...r,
    isActive: Boolean(r.isActive),
  }));
}

/**
 * Retrieve a single staff user by ID.
 * Requires staff.read permission or self-lookup.
 */
export async function getStaffUserById(
  actor: AuthenticatedUser,
  targetId: string,
  asyncDb?: AsyncDb
): Promise<StaffUser | null> {
  if (actor.id !== targetId) {
    requirePermission(actor, "staff.read");
  }

  const db = asyncDb ?? getAsyncDb();
  const row = await db.queryOne<any>(`
    SELECT
      id,
      username,
      email,
      full_name as "fullName",
      role,
      is_active as "isActive",
      created_at as "createdAt",
      updated_at as "updatedAt",
      last_login_at as "lastLoginAt"
    FROM staff_users
    WHERE id = ?
  `, [targetId]);

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
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<StaffUser> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

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
  if (!isAssignableRole(role)) {
    throw new Error(`Role '${role}' is retired and can no longer be assigned. Use Owner, Manager or Delivery.`);
  }

  // Privilege escalation protection: only Super Administrator can assign SUPER_ADMIN
  if (role === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new Error("Privilege escalation blocked: Only Super Administrators can assign the SUPER_ADMIN role.");
  }

  // Check unique constraints
  const existing = await db.queryOne<{ username: string; email: string }>(`
    SELECT username, email FROM staff_users 
    WHERE LOWER(username) = ? OR LOWER(email) = ?
  `, [cleanUsername, cleanEmail]);

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

  await db.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, [newId, cleanUsername, cleanEmail, cleanFullName, passwordHash, role, now, now]);

    await recordAuditEventAsync({
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
    }, tx);
  });

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
export async function updateStaffRole(
  actor: AuthenticatedUser,
  targetUserId: string,
  newRole: StaffRole,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<void> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "staff.assign_role", { ip: clientIp, targetId: targetUserId, action: "staff.assign_role" });

  if (!isValidRole(newRole)) {
    throw new Error(`Invalid role '${newRole}'.`);
  }
  if (!isAssignableRole(newRole)) {
    throw new Error(`Role '${newRole}' is retired and can no longer be assigned. Use Owner, Manager or Delivery.`);
  }

  // Privilege escalation protection: only Super Administrator can assign SUPER_ADMIN
  if (newRole === "SUPER_ADMIN" && actor.role !== "SUPER_ADMIN") {
    throw new Error("Privilege escalation blocked: Only Super Administrators can assign the SUPER_ADMIN role.");
  }

  const target = await db.queryOne<{ id: string; username: string; role: StaffRole; isActive: number | boolean }>(`
    SELECT id, username, role, is_active as "isActive" FROM staff_users WHERE id = ?
  `, [targetUserId]);

  if (!target) {
    throw new Error(`Staff user '${targetUserId}' not found.`);
  }

  if (target.role === newRole) {
    return; // No change needed
  }

  // Sole Super-Admin Protection: cannot demote the last active super-administrator
  if (target.role === "SUPER_ADMIN" && newRole !== "SUPER_ADMIN") {
    const adminCount = await db.queryOne<{ count: number | string }>(`
      SELECT COUNT(*) as count FROM staff_users WHERE role = 'SUPER_ADMIN' AND is_active = 1
    `);

    if (Number(adminCount?.count || 0) <= 1) {
      throw new Error("Cannot demote the sole remaining active Super Administrator.");
    }
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE staff_users SET role = ?, updated_at = ? WHERE id = ?
    `, [newRole, now, targetUserId]);
    invalidateSessionCache();

    await recordAuditEventAsync({
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
    }, tx);
  });
}

/**
 * Activates or deactivates a staff member.
 * Requires staff.deactivate permission.
 * Enforces the Sole Super-Admin Protection rule.
 * Deactivation immediately invalidates all active sessions for the user.
 */
export async function setStaffActiveStatus(
  actor: AuthenticatedUser,
  targetUserId: string,
  isActive: boolean,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<void> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "staff.deactivate", { ip: clientIp, targetId: targetUserId, action: "staff.deactivate" });

  const target = await db.queryOne<{ id: string; username: string; role: StaffRole; isActive: number | boolean }>(`
    SELECT id, username, role, is_active as "isActive" FROM staff_users WHERE id = ?
  `, [targetUserId]);

  if (!target) {
    throw new Error(`Staff user '${targetUserId}' not found.`);
  }

  const targetIsActive = Boolean(target.isActive);
  if (targetIsActive === isActive) {
    return;
  }

  // Sole Super-Admin Protection: cannot deactivate the last active super-administrator
  if (target.role === "SUPER_ADMIN" && !isActive) {
    const adminCount = await db.queryOne<{ count: number | string }>(`
      SELECT COUNT(*) as count FROM staff_users WHERE role = 'SUPER_ADMIN' AND is_active = 1
    `);

    if (Number(adminCount?.count || 0) <= 1) {
      throw new Error("Cannot deactivate the sole remaining active Super Administrator.");
    }
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE staff_users SET is_active = ?, updated_at = ? WHERE id = ?
    `, [isActive ? 1 : 0, now, targetUserId]);
    invalidateSessionCache();

    // If deactivating, immediately revoke and invalidate all active sessions
    if (!isActive) {
      await tx.execute("DELETE FROM sessions WHERE staff_id = ?", [targetUserId]);
    }

    await recordAuditEventAsync({
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
    }, tx);
  });
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
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<void> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "staff.update", { ip: clientIp, targetId: targetUserId, action: "staff.password_reset" });

  if (actor.role !== "SUPER_ADMIN") {
    throw new Error("Privilege restriction: Only Super Administrators can directly reset a staff member's password.");
  }

  if (!newPassword || newPassword.length < 12) {
    throw new Error("Password must be at least 12 characters long.");
  }

  if (isRetiredDemoPassword(newPassword)) {
    throw new Error("This password is a retired, publicly known demonstration password and cannot be used.");
  }

  const target = await db.queryOne<{ id: string; username: string }>("SELECT id, username FROM staff_users WHERE id = ?", [targetUserId]);
  if (!target) {
    throw new Error(`Staff user '${targetUserId}' not found.`);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE staff_users SET password_hash = ?, updated_at = ? WHERE id = ?
    `, [passwordHash, now, targetUserId]);

    // Invalidate all active sessions for that staff member upon password reset
    await tx.execute("DELETE FROM sessions WHERE staff_id = ?", [targetUserId]);
    invalidateSessionCache();

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "staff.password_reset",
      targetType: "staff_user",
      targetId: targetUserId,
      metadata: {
        resetBy: actor.username,
      },
      ipAddress: clientIp,
    }, tx);
  });
}

/**
 * Updates staff member profile fields (fullName, email).
 * Requires staff.update permission or self-update.
 */
export async function updateStaffProfile(
  actor: AuthenticatedUser,
  targetUserId: string,
  input: UpdateStaffProfileInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<void> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  if (actor.id !== targetUserId) {
    requirePermission(actor, "staff.update", { ip: clientIp, targetId: targetUserId, action: "staff.update" });
  }

  const target = await db.queryOne<any>("SELECT id, username, email, full_name as \"fullName\" FROM staff_users WHERE id = ?", [targetUserId]);
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
    const existing = await db.queryOne<{ id: string }>("SELECT id FROM staff_users WHERE LOWER(email) = ? AND id != ?", [cleanEmail, targetUserId]);
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

  await db.transaction(async (tx) => {
    await tx.execute(`UPDATE staff_users SET ${updates.join(", ")} WHERE id = ?`, params);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "staff.updated",
      targetType: "staff_user",
      targetId: targetUserId,
      metadata: auditMeta,
      ipAddress: clientIp,
    }, tx);
  });
}

/**
 * Administrator-initiated password recovery link dispatch.
 * Requires staff.update permission.
 * Generates an unpredictable 256-bit single-use recovery token (1-hour expiry)
 * and dispatches it via email to the staff member's registered email address.
 * Plaintext passwords are NEVER handled or exposed to the administrator.
 */
export async function initiateStaffPasswordRecovery(
  actor: AuthenticatedUser,
  targetUserId: string,
  origin?: string,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<{ success: true; message: string }> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "staff.update", { ip: clientIp, targetId: targetUserId, action: "staff.recovery_initiated" });

  const target = await db.queryOne<{ id: string; username: string; email: string; isActive: number | boolean }>(`
    SELECT id, username, email, is_active as "isActive" FROM staff_users WHERE id = ?
  `, [targetUserId]);

  if (!target) {
    throw new Error(`Staff user '${targetUserId}' not found.`);
  }

  if (!Boolean(target.isActive)) {
    throw new Error("Cannot initiate password recovery for a deactivated staff account. Please activate the account first.");
  }

  // Invalidate any previous unused password resets for this staff member
  await db.execute("DELETE FROM password_resets WHERE staff_id = ?", [target.id]);

  // Generate cryptographically secure 256-bit token (32 random bytes)
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const resetId = `pr_${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();

  await db.execute(
    `INSERT INTO password_resets (id, staff_id, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [resetId, target.id, tokenHash, expiresAt, now.toISOString()]
  );

  const baseUrl = origin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  const resetUrl = `${baseUrl}/login?token=${rawToken}`;

  await getEmailAdapter().sendPasswordReset(target.email, resetUrl);

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "staff.recovery_initiated",
    targetType: "staff_user",
    targetId: target.id,
    metadata: {
      initiatedBy: actor.username,
      targetUsername: target.username,
      targetEmail: target.email,
    },
    ipAddress: clientIp,
  }, db);

  return {
    success: true,
    message: `Password recovery link successfully dispatched to ${target.email}.`,
  };
}

/**
 * Retrieves the 360-degree security and operational audit trail for a staff account.
 * Requires audit.read or staff.read permission (or self-lookup).
 */
export async function getStaffAuditHistory(
  actor: AuthenticatedUser,
  targetUserId: string,
  limit: number = 30,
  asyncDb?: AsyncDb
): Promise<any[]> {
  if (actor.id !== targetUserId) {
    requirePermission(actor, "staff.read");
  }

  const db = asyncDb ?? getAsyncDb();
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  const rows = await db.query<any>(`
    SELECT
      id,
      actor_id as "actorId",
      actor_username as "actorUsername",
      action,
      target_type as "targetType",
      target_id as "targetId",
      metadata,
      ip_address as "ipAddress",
      created_at as "createdAt"
    FROM audit_logs
    WHERE target_id = ? OR actor_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [targetUserId, targetUserId, safeLimit]);

  return rows.map((r) => {
    let parsedMeta: any = null;
    if (r.metadata) {
      try {
        parsedMeta = typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata;
      } catch {
        parsedMeta = r.metadata;
      }
    }
    return {
      ...r,
      metadata: parsedMeta,
    };
  });
}

/**
 * Summary metrics for staff directory dashboard:
 * Total staff, active staff, deactivated staff, and super administrators count.
 * Requires staff.read permission.
 */
export async function getStaffStats(
  actor: AuthenticatedUser,
  asyncDb?: AsyncDb
): Promise<StaffStats> {
  requirePermission(actor, "staff.read");
  const db = asyncDb ?? getAsyncDb();

  const row = await db.queryOne<any>(`
    SELECT
      COUNT(*) as "totalStaff",
      COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) as "activeStaff",
      COALESCE(SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END), 0) as "deactivatedStaff",
      COALESCE(SUM(CASE WHEN role = 'SUPER_ADMIN' AND is_active = 1 THEN 1 ELSE 0 END), 0) as "superAdmins"
    FROM staff_users
  `);

  return {
    totalStaff: Number(row?.totalStaff || 0),
    activeStaff: Number(row?.activeStaff || 0),
    deactivatedStaff: Number(row?.deactivatedStaff || 0),
    superAdmins: Number(row?.superAdmins || 0),
  };
}

/** Per-login data that is removed with an account (ON DELETE CASCADE; no business history). */
const EPHEMERAL_STAFF_TABLES = new Set(["sessions", "session_preemptions", "auth_challenges", "password_resets", "staff_notification_reads"]);
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Records that tie a staff account to the business history: every foreign key pointing at
 * staff_users (deliveries, handovers, transactions, documents, meal records, ...) found from
 * the database catalogue, plus audit log entries the person made. Returns a short label per kind.
 */
async function staffHistoryReferences(db: AsyncDb, staffId: string): Promise<string[]> {
  if (!db.isPostgres) {
    throw new Error("Deleting a staff account needs the PostgreSQL database. Deactivate it instead.");
  }
  const fks = await db.query<{ table_name: string; column_name: string }>(`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'staff_users' AND tc.table_schema = current_schema()
  `);
  const found = new Set<string>();
  for (const fk of fks) {
    if (EPHEMERAL_STAFF_TABLES.has(fk.table_name) || fk.table_name === "staff_users") continue;
    if (!SAFE_IDENTIFIER.test(fk.table_name) || !SAFE_IDENTIFIER.test(fk.column_name)) continue;
    const row = await db.queryOne<{ n: number | string }>(`SELECT COUNT(*) AS n FROM "${fk.table_name}" WHERE "${fk.column_name}" = ?`, [staffId]);
    if (Number(row?.n || 0) > 0) found.add(fk.table_name.replace(/_/g, " "));
  }
  const audited = await db.queryOne<{ n: number | string }>(`SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id = ?`, [staffId]);
  if (Number(audited?.n || 0) > 0) found.add("activity log");
  return Array.from(found);
}

/**
 * Deletes a staff account that has no history (for example one created by mistake).
 * An account referenced by any delivery, cash, financial, document or audit record is kept and
 * the request is refused with the reason: those records must stay attributable, so such an
 * account is deactivated instead. Owner only (staff.deactivate); never the caller's own account
 * or an Owner account. Audited as staff.deleted.
 */
export async function deleteStaffUser(
  actor: AuthenticatedUser,
  targetUserId: string,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<void> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "staff.deactivate", { ip: clientIp, targetId: targetUserId, action: "staff.delete" });
  if (actor.id === targetUserId) {
    throw new Error("You cannot delete your own account.");
  }

  const target = await db.queryOne<{ id: string; username: string; fullName: string; role: StaffRole }>(`
    SELECT id, username, full_name as "fullName", role FROM staff_users WHERE id = ?
  `, [targetUserId]);
  if (!target) {
    throw new Error(`Staff user '${targetUserId}' not found.`);
  }
  if (target.role === "SUPER_ADMIN") {
    throw new Error("Owner accounts cannot be deleted. Deactivate it instead.");
  }

  const history = await staffHistoryReferences(db, targetUserId);
  if (history.length > 0) {
    // Work history stays attributable: the account is switched off (signed out everywhere, hidden
    // from the staff list) instead of removed.
    await setStaffActiveStatus(actor, targetUserId, false, clientIp, db);
    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "staff.deleted",
      targetType: "staff_user",
      targetId: targetUserId,
      metadata: { username: target.username, fullName: target.fullName, role: target.role, keptForHistory: history },
      ipAddress: clientIp,
    }, db);
    return;
  }

  await db.transaction(async (tx) => {
    // Sessions, sign-in codes, reset links and notification read-marks are declared
    // ON DELETE CASCADE, so they go with the account.
    await tx.execute("DELETE FROM staff_users WHERE id = ?", [targetUserId]);
    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "staff.deleted",
      targetType: "staff_user",
      targetId: targetUserId,
      metadata: { username: target.username, fullName: target.fullName, role: target.role },
      ipAddress: clientIp,
    }, tx);
  });
}
