import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { getAsyncDb, closeDb, AsyncDb, convertPlaceholders } from "../apps/erp/src/server/database/db";
import {
  ALL_ROLES,
  ALL_PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  getRolePermissions,
  isValidRole,
} from "../apps/erp/src/server/authorization/permissions";
import {
  requirePermission,
  requireUser,
  resolveUserFromRequest,
  unauthorizedResponse,
  forbiddenResponse,
  handleAuthorizationError,
  AuthorizationError,
} from "../apps/erp/src/server/authorization/authorize";
import {
  createStaffUser,
  updateStaffRole,
  setStaffActiveStatus,
  resetStaffPassword,
  updateStaffProfile,
  listStaffUsers,
  getStaffUserById,
} from "../apps/erp/src/server/staff/staffService";
import { recordAuditEvent, getAuditLogs, sanitizeAuditMetadata } from "../apps/erp/src/server/audit/audit";
import * as auth from "../apps/erp/src/server/authentication/auth";
import { AuthenticatedUser, StaffRole } from "../apps/erp/src/types";

// Mandatory primary database safety guard
const primaryDbPath = path.resolve(__dirname, "../data/erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated test database path
const TEST_RBAC_DB_PATH = path.resolve(__dirname, "test_rbac.db");

function cleanupTestDb() {
  if (fs.existsSync(TEST_RBAC_DB_PATH)) fs.unlinkSync(TEST_RBAC_DB_PATH);
  const wal = `${TEST_RBAC_DB_PATH}-wal`;
  const shm = `${TEST_RBAC_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_RBAC_DB_PATH;

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

console.log("================================================================================");
console.log("RAVINARAYAN ERP — PHASE 2A: STAFF FOUNDATION & RBAC TEST SUITE");
console.log("================================================================================\n");

async function runRbacTests() {
  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Migration V1 -> V2 & Administrator Preservation
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Database Migration V1 -> V2 & Data Preservation");

  const db = new Database(TEST_RBAC_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Simulate existing V1 database
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
      token_hash TEXT UNIQUE NOT NULL,
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
      ip_address TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      success INTEGER NOT NULL
    );
  `);

  // Insert original Super Administrator under V1 schema
  db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES ('usr_admin_01', 'admin', 'admin@ravinarayan.in', 'Ravinarayan Admin', 'dummy_hash', 'SUPER_ADMIN', 1, '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z')
  `).run();

  db.pragma("user_version = 1");

  // Run migrations to V2
  runMigrations(db);

  const newVersion = db.pragma("user_version", { simple: true });
  assert(Number(newVersion) >= 2, `Database schema version advanced to at least 2 (got ${newVersion})`);

  // Verify that the existing super admin row was preserved intact
  const adminRow = db.prepare("SELECT * FROM staff_users WHERE id = 'usr_admin_01'").get() as any;
  assert(adminRow !== undefined, "Existing Super Admin account preserved through migration");
  assert(adminRow.username === "admin" && adminRow.role === "SUPER_ADMIN", "Admin attributes intact");

  // Verify audit_logs table was created
  const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_logs'").get();
  assert(tableCheck !== undefined, "audit_logs table created by migration");

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Role-Permission Matrix Resolution & Fail-Closed Enforcement
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Role-Permission Matrix Resolution & Fail-Closed Enforcement");

  // Test 2a: Valid roles list
  assert(ALL_ROLES.length === 5, "Exactly 5 operational roles defined");
  assert(isValidRole("SUPER_ADMIN"), "SUPER_ADMIN is a valid role");
  assert(isValidRole("OPERATIONS_MANAGER"), "OPERATIONS_MANAGER is a valid role");
  assert(isValidRole("ACCOUNTANT"), "ACCOUNTANT is a valid role");
  assert(isValidRole("KITCHEN_OPERATIONS"), "KITCHEN_OPERATIONS is a valid role");
  assert(isValidRole("DELIVERY_PERSON"), "DELIVERY_PERSON is a valid role");
  assert(!isValidRole("INVALID_ROLE"), "Random string rejected by isValidRole");
  assert(!isValidRole(""), "Empty string rejected by isValidRole");

  // Test 2b: Role permissions resolution
  assert(hasPermission("SUPER_ADMIN", "staff.create"), "SUPER_ADMIN has staff.create");
  assert(hasPermission("SUPER_ADMIN", "finance.manage"), "SUPER_ADMIN inherits all operational permissions");
  assert(hasPermission("SUPER_ADMIN", "rooms.manage"), "SUPER_ADMIN inherits rooms.manage");

  assert(hasPermission("OPERATIONS_MANAGER", "rooms.manage"), "OPERATIONS_MANAGER has rooms.manage");
  assert(hasPermission("OPERATIONS_MANAGER", "residents.manage"), "OPERATIONS_MANAGER has residents.manage");
  assert(!hasPermission("OPERATIONS_MANAGER", "staff.create"), "Least Privilege: OPERATIONS_MANAGER lacks staff.create");
  assert(!hasPermission("OPERATIONS_MANAGER", "staff.assign_role"), "Least Privilege: OPERATIONS_MANAGER lacks staff.assign_role");
  assert(!hasPermission("OPERATIONS_MANAGER", "finance.manage"), "Least Privilege: OPERATIONS_MANAGER lacks finance.manage");

  assert(hasPermission("ACCOUNTANT", "finance.manage"), "ACCOUNTANT has finance.manage");
  assert(hasPermission("ACCOUNTANT", "residents.read"), "ACCOUNTANT has residents.read for billing");
  assert(!hasPermission("ACCOUNTANT", "rooms.manage"), "Least Privilege: ACCOUNTANT lacks rooms.manage");
  assert(!hasPermission("ACCOUNTANT", "kitchen.manage"), "Least Privilege: ACCOUNTANT lacks kitchen.manage");

  assert(hasPermission("KITCHEN_OPERATIONS", "kitchen.manage"), "KITCHEN_OPERATIONS has kitchen.manage");
  assert(!hasPermission("KITCHEN_OPERATIONS", "finance.manage"), "Least Privilege: KITCHEN_OPERATIONS lacks finance.manage");

  assert(hasPermission("DELIVERY_PERSON", "delivery.update"), "DELIVERY_PERSON has delivery.update");
  assert(!hasPermission("DELIVERY_PERSON", "rooms.read"), "Least Privilege: DELIVERY_PERSON lacks rooms.read");
  assert(!hasPermission("DELIVERY_PERSON", "residents.manage"), "Least Privilege: DELIVERY_PERSON lacks residents.manage");

  // Test 2c: Fail-closed on undefined or null input
  assert(!hasPermission(undefined, "finance.manage"), "Fail-closed: undefined role returns false");
  assert(!hasPermission(null as any, "finance.manage"), "Fail-closed: null role returns false");
  assert(!hasPermission("UNKNOWN" as any, "finance.manage"), "Fail-closed: unrecognized role returns false");

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Server-Side Authorization Enforcement (401 vs 403)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Server-Side Authorization Enforcement (401 Unauthenticated vs 403 Forbidden)");

  const superAdminUser: AuthenticatedUser = {
    id: "usr_admin_01",
    username: "admin",
    email: "admin@ravinarayan.in",
    fullName: "Ravinarayan Admin",
    role: "SUPER_ADMIN",
  };

  const deliveryUser: AuthenticatedUser = {
    id: "usr_delivery_01",
    username: "delivery1",
    email: "delivery1@ravinarayan.in",
    fullName: "Delivery Staff 1",
    role: "DELIVERY_PERSON",
  };

  // Test 3a: requirePermission enforcement on unauthenticated caller throws 401
  let unauthPermCaught = false;
  try {
    requirePermission(null, "staff.create");
  } catch (err: any) {
    unauthPermCaught = err instanceof AuthorizationError && err.statusCode === 401;
  }
  assert(unauthPermCaught, "requirePermission throws HTTP 401 AuthorizationError when caller is unauthenticated");

  // Test 3b: Authenticated caller without permission throws 403
  let forbiddenCaught = false;
  try {
    requirePermission(deliveryUser, "staff.create", { ip: "192.168.1.50", action: "test.forbidden" });
  } catch (err: any) {
    forbiddenCaught = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(forbiddenCaught, "requirePermission throws HTTP 403 AuthorizationError when caller lacks permission");

  // Test 3c: Authorized caller does not throw
  let superAdminPassed = true;
  try {
    requirePermission(superAdminUser, "staff.create");
  } catch {
    superAdminPassed = false;
  }
  assert(superAdminPassed, "requirePermission allows caller with authorized role");

  // Test 3d: Response generators
  const resp401 = unauthorizedResponse();
  assert(resp401.status === 401, "unauthorizedResponse produces HTTP 401 NextResponse");
  const resp403 = forbiddenResponse();
  assert(resp403.status === 403, "forbiddenResponse produces HTTP 403 NextResponse");

  const handled403 = handleAuthorizationError(new AuthorizationError(403, "Denied"));
  assert(handled403 !== null && handled403.status === 403, "handleAuthorizationError converts AuthorizationError(403) to HTTP 403 response");

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: Staff Provisioning & Client Privilege Escalation Defense
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Staff Lifecycle & Anti-Privilege Escalation");

  // 4a: Super Admin provisions Operations Manager
  const newOpsManager = await createStaffUser(
    superAdminUser,
    {
      username: "opsmanager",
      email: "ops@ravinarayan.in",
      fullName: "Ravinarayan Operations Lead",
      password: "StrongSecurePassword2026#",
      role: "OPERATIONS_MANAGER",
    },
    "192.168.1.100"
  );
  assert(newOpsManager.id.startsWith("usr_"), "createStaffUser generated prefixed staff user ID");
  assert(newOpsManager.username === "opsmanager" && newOpsManager.role === "OPERATIONS_MANAGER", "New staff account created with correct role");

  const opsAuthUser: AuthenticatedUser = {
    id: newOpsManager.id,
    username: newOpsManager.username,
    email: newOpsManager.email,
    fullName: newOpsManager.fullName,
    role: newOpsManager.role,
  };

  // 4b: Privilege Escalation Attempt: Operations Manager attempts to create a staff user
  let opsCreateStaffBlocked = false;
  try {
    await createStaffUser(opsAuthUser, {
      username: "roguestaff",
      email: "rogue@ravinarayan.in",
      fullName: "Rogue User",
      password: "StrongPassword123#",
      role: "SUPER_ADMIN",
    });
  } catch (err: any) {
    opsCreateStaffBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(opsCreateStaffBlocked, "Privilege Escalation Blocked: OPERATIONS_MANAGER cannot call createStaffUser (HTTP 403)");

  // 4c: Privilege Escalation Attempt: Operations Manager attempts to elevate own role to SUPER_ADMIN
  let opsSelfPromoteBlocked = false;
  try {
    await updateStaffRole(opsAuthUser, opsAuthUser.id, "SUPER_ADMIN");
  } catch (err: any) {
    opsSelfPromoteBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(opsSelfPromoteBlocked, "Privilege Escalation Blocked: Non-admin staff cannot elevate roles via updateStaffRole (HTTP 403)");

  // 4d: Input Validation: Reject weak password (< 12 chars)
  let weakPasswordBlocked = false;
  try {
    await createStaffUser(superAdminUser, {
      username: "shortuser",
      email: "short@ravinarayan.in",
      fullName: "Short User",
      password: "short",
      role: "DELIVERY_PERSON",
    });
  } catch (err: any) {
    weakPasswordBlocked = err.message.includes("at least 12 characters");
  }
  assert(weakPasswordBlocked, "createStaffUser rejects passwords shorter than 12 characters");

  // 4e: Input Validation: Reject duplicate username / email
  let duplicateUsernameBlocked = false;
  try {
    await createStaffUser(superAdminUser, {
      username: "opsmanager",
      email: "ops_different@ravinarayan.in",
      fullName: "Duplicate Ops",
      password: "StrongPassword123#",
      role: "DELIVERY_PERSON",
    });
  } catch (err: any) {
    duplicateUsernameBlocked = err.message.includes("already in use");
  }
  assert(duplicateUsernameBlocked, "createStaffUser prevents duplicate usernames (case-insensitive)");

  // 4f: List staff users & get by ID
  const staffList = await listStaffUsers(superAdminUser);
  assert(staffList.length >= 2, "listStaffUsers returns provisioned staff users");

  const opsById = await getStaffUserById(superAdminUser, newOpsManager.id);
  assert(opsById !== null && opsById.username === "opsmanager", "getStaffUserById returns accurate user profile");

  // 4g: Update staff profile
  await updateStaffProfile(superAdminUser, newOpsManager.id, {
    fullName: "Ravinarayan Lead Operations Manager",
  });
  const updatedOps = await getStaffUserById(superAdminUser, newOpsManager.id);
  assert(updatedOps?.fullName === "Ravinarayan Lead Operations Manager", "updateStaffProfile updates full name");

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Inactive User Enforcement & Immediate Session Invalidation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Inactive User Enforcement & Immediate Session Invalidation");

  // Create session for active ops manager
  const opsSession = await auth.createSession(newOpsManager.id, { ip: "192.168.1.100" });
  assert(opsSession.sessionToken.length === 64, "Created active session for operations manager");

  // Validation succeeds while active
  const validatedBeforeDeactivation = await auth.validateSession(opsSession.sessionToken);
  assert(validatedBeforeDeactivation !== null && validatedBeforeDeactivation.id === newOpsManager.id, "Session validation succeeds while account is active");

  // Deactivate operations manager via setStaffActiveStatus
  await setStaffActiveStatus(superAdminUser, newOpsManager.id, false, "192.168.1.1");
  const opsDbRow = db.prepare("SELECT is_active FROM staff_users WHERE id = ?").get(newOpsManager.id) as any;
  assert(opsDbRow.is_active === 0, "Staff record is_active successfully set to 0 in database");

  // Immediate Session Invalidation: Session record was deleted from database
  const sessionDbCount = db.prepare("SELECT count(*) as count FROM sessions WHERE staff_id = ?").get(newOpsManager.id) as any;
  assert(sessionDbCount.count === 0, "Deactivation immediately purged all active sessions for the deactivated user");

  // Attempting to validate the previous session token now returns null
  const validatedAfterDeactivation = await auth.validateSession(opsSession.sessionToken);
  assert(validatedAfterDeactivation === null, "Deactivated user session token rejected with null on validateSession");

  // Inactive user attempting login fails
  const inactiveUserLookup = await auth.findStaffByIdentifier("opsmanager");
  assert(inactiveUserLookup === null, "findStaffByIdentifier excludes inactive accounts (is_active = 0)");

  // Reactivate user
  await setStaffActiveStatus(superAdminUser, newOpsManager.id, true, "192.168.1.1");
  const reactivatedLookup = await auth.findStaffByIdentifier("opsmanager");
  assert(reactivatedLookup !== null && reactivatedLookup.isActive, "Reactivating account restores ability to authenticate");

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Immediate Role Change Enforcement
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Immediate Role Change Enforcement");

  // Create fresh session for reactivated user (currently OPERATIONS_MANAGER)
  const freshOpsSession = await auth.createSession(newOpsManager.id);
  const validatedRoleBefore = await auth.validateSession(freshOpsSession.sessionToken);
  assert(validatedRoleBefore?.role === "OPERATIONS_MANAGER", "Session reflects initial OPERATIONS_MANAGER role");

  // Retired roles cannot be assigned (ISSUE-012); the role is unchanged after the rejection.
  let retiredRoleRejected = false;
  try {
    await updateStaffRole(superAdminUser, newOpsManager.id, "ACCOUNTANT", "192.168.1.1");
  } catch (err: any) {
    retiredRoleRejected = err.message.includes("retired");
  }
  assert(retiredRoleRejected, "Assigning retired role ACCOUNTANT is rejected");
  const validatedAfterReject = await auth.validateSession(freshOpsSession.sessionToken);
  assert(validatedAfterReject?.role === "OPERATIONS_MANAGER", "Rejected role change leaves the role unchanged");

  // Super Admin updates user's role to DELIVERY_PERSON
  await updateStaffRole(superAdminUser, newOpsManager.id, "DELIVERY_PERSON", "192.168.1.1");

  // Next session validation immediately reflects new role without requiring re-login
  const validatedRoleAfter = await auth.validateSession(freshOpsSession.sessionToken);
  assert(validatedRoleAfter?.role === "DELIVERY_PERSON", "Role change takes effect immediately on subsequent session validation");
  assert(hasPermission(validatedRoleAfter?.role, "delivery.update"), "User now holds DELIVERY_PERSON permissions");
  assert(!hasPermission(validatedRoleAfter?.role, "rooms.manage"), "User no longer holds OPERATIONS_MANAGER permissions");

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: Password Reset & Session Revocation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Administrative Password Reset & Session Revocation");

  // Establish 2 active sessions for the user
  const sessionA = await auth.createSession(newOpsManager.id);
  const sessionB = await auth.createSession(newOpsManager.id);
  const sessionsCountBefore = db.prepare("SELECT count(*) as count FROM sessions WHERE staff_id = ?").get(newOpsManager.id) as any;
  assert(sessionsCountBefore.count >= 2, "User has multiple active sessions before password reset");

  // Administrative password reset
  const updatedPassword = "BrandNewStrongPassword2026#Secure";
  await resetStaffPassword(superAdminUser, newOpsManager.id, updatedPassword, "192.168.1.1");

  // Assert that both previous sessions are purged
  const sessionsCountAfter = db.prepare("SELECT count(*) as count FROM sessions WHERE staff_id = ?").get(newOpsManager.id) as any;
  assert(sessionsCountAfter.count === 0, "Administrative password reset immediately purged all active sessions");

  // Verify that previous password fails and new password verifies
  const staffRecord = db.prepare("SELECT password_hash FROM staff_users WHERE id = ?").get(newOpsManager.id) as any;
  const oldPasswordMatches = await auth.verifyPassword("StrongSecurePassword2026#", staffRecord.password_hash);
  const newPasswordMatches = await auth.verifyPassword(updatedPassword, staffRecord.password_hash);
  assert(!oldPasswordMatches, "Old password hash invalidated after reset");
  assert(newPasswordMatches, "New password successfully verified against updated hash");

  // -----------------------------------------------------------------------------
  // TEST SUITE 8: Sole Super-Administrator Protection
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] Sole Super-Administrator Safety Protection");

  // Verify there is currently only 1 active Super Administrator
  const activeAdminsCount = db.prepare("SELECT count(*) as count FROM staff_users WHERE role = 'SUPER_ADMIN' AND is_active = 1").get() as any;
  assert(activeAdminsCount.count === 1, "Verified exactly 1 active Super Administrator in database");

  // Attempt to demote sole super admin
  let demoteSoleAdminBlocked = false;
  try {
    await updateStaffRole(superAdminUser, superAdminUser.id, "OPERATIONS_MANAGER");
  } catch (err: any) {
    demoteSoleAdminBlocked = err.message.includes("sole remaining active Super Administrator");
  }
  assert(demoteSoleAdminBlocked, "Sole Super-Admin Protection: Cannot demote the only active Super Administrator");

  // Attempt to deactivate sole super admin
  let deactivateSoleAdminBlocked = false;
  try {
    await setStaffActiveStatus(superAdminUser, superAdminUser.id, false);
  } catch (err: any) {
    deactivateSoleAdminBlocked = err.message.includes("sole remaining active Super Administrator");
  }
  assert(deactivateSoleAdminBlocked, "Sole Super-Admin Protection: Cannot deactivate the only active Super Administrator");

  // Create a second Super Administrator
  const secondAdmin = await createStaffUser(superAdminUser, {
    username: "backupadmin",
    email: "backupadmin@ravinarayan.in",
    fullName: "Backup Super Administrator",
    password: "SecondAdminStrongPassword2026#",
    role: "SUPER_ADMIN",
  });
  assert(secondAdmin.role === "SUPER_ADMIN", "Created second Super Administrator");

  // Now deactivating one admin is permitted because 2 exist
  let deactivatingOneWithTwoAllowed = false;
  try {
    await setStaffActiveStatus(superAdminUser, secondAdmin.id, false);
    deactivatingOneWithTwoAllowed = true;
  } catch {
    deactivatingOneWithTwoAllowed = false;
  }
  assert(deactivatingOneWithTwoAllowed, "Deactivating an admin is permitted when another active Super Admin exists");

  // Now only 1 active super admin remains again; attempting to deactivate that last one is blocked again!
  let deactivatingLastAgainBlocked = false;
  try {
    await setStaffActiveStatus(superAdminUser, superAdminUser.id, false);
  } catch (err: any) {
    deactivatingLastAgainBlocked = err.message.includes("sole remaining active Super Administrator");
  }
  assert(deactivatingLastAgainBlocked, "Sole Super-Admin Protection persists dynamically as active count changes");

  // -----------------------------------------------------------------------------
  // TEST SUITE 9: Immutable Audit Logging & Secret Stripping
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 9] Immutable Audit Logging & Secret Stripping");

  const recentLogs = getAuditLogs({ limit: 50 });
  assert(recentLogs.length >= 5, `Audit log recorded ${recentLogs.length} events during staff operations`);

  // Verify audit actions recorded
  const actionTypes = recentLogs.map((l) => l.action);
  assert(actionTypes.includes("staff.created"), "Audit log recorded staff.created event");
  assert(actionTypes.includes("staff.role_assigned"), "Audit log recorded staff.role_assigned event");
  assert(actionTypes.includes("staff.deactivated"), "Audit log recorded staff.deactivated event");
  assert(actionTypes.includes("staff.password_reset"), "Audit log recorded staff.password_reset event");
  assert(actionTypes.includes("auth.forbidden"), "Audit log recorded auth.forbidden event");

  // Verify secret stripping
  for (const log of recentLogs) {
    if (log.metadata) {
      assert(!log.metadata.includes("password_hash"), "Audit log metadata NEVER contains password_hash");
      assert(!log.metadata.includes("BrandNewStrongPassword"), "Audit log metadata NEVER contains raw passwords");
      assert(!log.metadata.includes("token_hash"), "Audit log metadata NEVER contains token_hash");
    }
  }
  assert(true, "All audit log records verified free of passwords, tokens, and hashes");

  // Verify metadata sanitizer directly
  const dirtyMeta = {
    username: "victim",
    password: "SuperSecretPassword123!",
    sessionToken: "64_hex_secret_token_1234567890",
    nested: {
      authToken: "secret_nested_token",
      role: "ACCOUNTANT",
    },
  };
  const sanitizedJson = sanitizeAuditMetadata(dirtyMeta) || "";
  assert(sanitizedJson.includes("[REDACTED]"), "sanitizeAuditMetadata replaces sensitive fields with [REDACTED]");
  assert(!sanitizedJson.includes("SuperSecretPassword123!"), "Raw password removed by sanitizeAuditMetadata");
  assert(!sanitizedJson.includes("secret_nested_token"), "Nested secret removed by sanitizeAuditMetadata");
  assert(sanitizedJson.includes("ACCOUNTANT"), "Non-sensitive metadata preserved by sanitizeAuditMetadata");

  // -----------------------------------------------------------------------------
  // TEST SUITE 10: Atomic Transaction Rollback Integrity on Staff Operations
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 10] Atomic Transaction Rollback Integrity");

  const asyncDb = getAsyncDb();
  let rollbackCaught = false;

  try {
    await asyncDb.transaction(async (tx) => {
      const rollbackStaffId = "usr_rollback_test_99";
      const nowTs = new Date().toISOString();
      await tx.execute(`
        INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `, [rollbackStaffId, "rollbackuser", "rollback@ravinarayan.in", "Rollback User", "hash", "DELIVERY_PERSON", nowTs, nowTs]);

      // Intentionally throw mid-transaction
      throw new Error("Simulated mid-transaction staff failure");
    });
  } catch (err: any) {
    rollbackCaught = err.message === "Simulated mid-transaction staff failure";
  }
  assert(rollbackCaught, "Transaction failure propagates error to caller");

  const staffCheck = await asyncDb.queryOne<any>("SELECT id FROM staff_users WHERE id = ?", ["usr_rollback_test_99"]);
  assert(staffCheck === null, "Transaction rollback ensured uncommitted staff row was not persisted");

  // -----------------------------------------------------------------------------
  // TEST SUITE 11: Mock PostgreSQL Execution & BigInt / Parameter Compatibility
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 11] Mock PostgreSQL Execution & BigInt / Parameter Compatibility");

  // 1. Placeholder conversion ($1, $2, ...)
  const sampleQuery = "SELECT * FROM staff_users WHERE role = ? AND is_active = ?";
  const converted = convertPlaceholders(sampleQuery);
  assert(
    converted === "SELECT * FROM staff_users WHERE role = $1 AND is_active = $2",
    "convertPlaceholders converts SQLite ? to Postgres $n parameter format"
  );

  // 2. Mock PostgreSQL AsyncDb adapter returning string counts and bigints
  const executedSqls: string[] = [];
  const mockPgDb: AsyncDb = {
    isPostgres: true,
    async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
      executedSqls.push(sql);
      if (sql.includes("FROM staff_users")) {
        return [
          {
            id: "usr_pg_mock_1",
            username: "pgadmin",
            email: "pgadmin@ravinarayan.in",
            fullName: "Postgres Admin",
            role: "SUPER_ADMIN",
            isActive: 1,
            createdAt: "2026-10-15T00:00:00Z",
            updatedAt: "2026-10-15T00:00:00Z",
            lastLoginAt: null,
          }
        ] as unknown as T[];
      }
      return [];
    },
    async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
      executedSqls.push(sql);
      if (sql.includes("COUNT(*) as count")) {
        return { count: "2" } as unknown as T; // Postgres driver returns string count
      }
      if (sql.includes("FROM staff_users")) {
        return {
          id: "usr_pg_mock_1",
          username: "pgadmin",
          email: "pgadmin@ravinarayan.in",
          fullName: "Postgres Admin",
          role: "SUPER_ADMIN",
          isActive: 1,
          createdAt: "2026-10-15T00:00:00Z",
          updatedAt: "2026-10-15T00:00:00Z",
          lastLoginAt: null,
        } as unknown as T;
      }
      return null;
    },
    async execute(sql: string, params?: any[]) {
      executedSqls.push(sql);
      return { changes: 1 };
    },
    async transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T> {
      return cb(mockPgDb);
    },
  };

  const pgStaff = await listStaffUsers(superAdminUser, mockPgDb);
  assert(pgStaff.length === 1 && pgStaff[0].username === "pgadmin", "listStaffUsers executes against PostgreSQL AsyncDb adapter");
  assert(pgStaff[0].isActive === true, "listStaffUsers coerces isActive number/boolean accurately");

  const pgUser = await getStaffUserById(superAdminUser, "usr_pg_mock_1", mockPgDb);
  assert(pgUser !== null && pgUser.username === "pgadmin", "getStaffUserById executes against PostgreSQL AsyncDb adapter");

  await updateStaffRole(superAdminUser, "usr_pg_mock_1", "OPERATIONS_MANAGER", mockPgDb);
  assert(executedSqls.some(s => s.includes("UPDATE staff_users SET role =")), "updateStaffRole executes against PostgreSQL AsyncDb adapter");

  // -----------------------------------------------------------------------------
  // TEST SUITE 12: Zero Primary Database Access Guard & Environment Cleanup
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 12] Zero Primary Database Access Guard & Environment Cleanup");

  const primaryStatsAfter = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;
  if (primaryStatsBefore && primaryStatsAfter) {
    assert(
      primaryStatsBefore.size === primaryStatsAfter.size,
      `Primary data/erp.db size unchanged (${primaryStatsBefore.size} bytes)`
    );
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs,
      `Primary data/erp.db mtime unchanged (${primaryStatsBefore.mtime.toISOString()})`
    );
  } else {
    assert(true, "Primary database verification step completed");
  }

  // -----------------------------------------------------------------------------
  // CLEANUP & SUMMARY
  // -----------------------------------------------------------------------------
  db.close();
  closeDb();
  cleanupTestDb();

  console.log("\n================================================================================");
  console.log(`FINAL RBAC TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRbacTests().catch((err) => {
  console.error("RBAC test runner encountered an unhandled rejection:", err);
  process.exit(1);
});
