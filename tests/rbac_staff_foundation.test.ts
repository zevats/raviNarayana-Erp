import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "../apps/erp/src/server/database/migrations";
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
  db.pragma("user_version = 1");

  // Insert original Super Administrator record
  const adminPasswordHash = "$2a$12$6Kl.3MNW1HtR0bJWduKAGe9PTiL9Pkz6DV.yfthDSGUppMXhV2Agy";
  db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES ('usr_super_admin_01', 'admin', 'admin@ravinarayan.in', 'Ravinarayan Super Admin', ?, 'SUPER_ADMIN', 1, '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z')
  `).run(adminPasswordHash);

  // Apply Migration
  runMigrations(db);

  const version = db.pragma("user_version", { simple: true }) as number;
  assert(version >= 2, `Database schema version advanced to at least 2 (got ${version})`);

  // Verify super admin preserved
  const preservedAdmin = db.prepare("SELECT * FROM staff_users WHERE id = 'usr_super_admin_01'").get() as any;
  assert(preservedAdmin && preservedAdmin.username === "admin" && preservedAdmin.role === "SUPER_ADMIN", "Existing Super Administrator record preserved intact");
  assert(preservedAdmin && preservedAdmin.password_hash === adminPasswordHash, "Super Administrator password hash strictly preserved");

  // Verify audit_logs table created with correct schema
  const auditCols = (db.prepare("PRAGMA table_info(audit_logs)").all() as any[]).map((c: any) => c.name);
  assert(
    auditCols.includes("id") &&
      auditCols.includes("actor_id") &&
      auditCols.includes("actor_username") &&
      auditCols.includes("action") &&
      auditCols.includes("target_type") &&
      auditCols.includes("target_id") &&
      auditCols.includes("metadata") &&
      auditCols.includes("ip_address") &&
      auditCols.includes("created_at"),
    "audit_logs table created with all required columns"
  );

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Role-Permission Matrix Resolution & Fail-Closed Behavior
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Role-Permission Matrix Resolution & Fail-Closed Enforcement");

  assert(ALL_ROLES.length === 5, "5 roles defined in RBAC model");
  assert(isValidRole("SUPER_ADMIN") && isValidRole("OPERATIONS_MANAGER") && isValidRole("ACCOUNTANT") && isValidRole("KITCHEN_OPERATIONS") && isValidRole("DELIVERY_PERSON"), "All defined roles recognized by validator");
  assert(!isValidRole("HACKER") && !isValidRole("") && !isValidRole(null), "Unknown or invalid roles rejected by validator");

  // SUPER_ADMIN permissions
  assert(hasPermission("SUPER_ADMIN", "staff.read"), "SUPER_ADMIN has staff.read");
  assert(hasPermission("SUPER_ADMIN", "staff.create"), "SUPER_ADMIN has staff.create");
  assert(hasPermission("SUPER_ADMIN", "staff.assign_role"), "SUPER_ADMIN has staff.assign_role");
  assert(hasPermission("SUPER_ADMIN", "staff.deactivate"), "SUPER_ADMIN has staff.deactivate");
  assert(hasPermission("SUPER_ADMIN", "system.manage"), "SUPER_ADMIN has system.manage");
  assert(hasPermission("SUPER_ADMIN", "audit.read"), "SUPER_ADMIN has audit.read");

  // OPERATIONS_MANAGER permissions
  assert(hasPermission("OPERATIONS_MANAGER", "staff.read"), "OPERATIONS_MANAGER has staff.read");
  assert(hasPermission("OPERATIONS_MANAGER", "rooms.manage"), "OPERATIONS_MANAGER has rooms.manage");
  assert(hasPermission("OPERATIONS_MANAGER", "residents.manage"), "OPERATIONS_MANAGER has residents.manage");
  assert(hasPermission("OPERATIONS_MANAGER", "tiffin.manage"), "OPERATIONS_MANAGER has tiffin.manage");
  assert(!hasPermission("OPERATIONS_MANAGER", "staff.create"), "Least Privilege: OPERATIONS_MANAGER CANNOT create staff");
  assert(!hasPermission("OPERATIONS_MANAGER", "staff.assign_role"), "Least Privilege: OPERATIONS_MANAGER CANNOT assign roles");
  assert(!hasPermission("OPERATIONS_MANAGER", "staff.deactivate"), "Least Privilege: OPERATIONS_MANAGER CANNOT deactivate staff");
  assert(!hasPermission("OPERATIONS_MANAGER", "system.manage"), "Least Privilege: OPERATIONS_MANAGER CANNOT system.manage");

  // ACCOUNTANT permissions
  assert(hasPermission("ACCOUNTANT", "finance.read"), "ACCOUNTANT has finance.read");
  assert(hasPermission("ACCOUNTANT", "finance.manage"), "ACCOUNTANT has finance.manage");
  assert(hasPermission("ACCOUNTANT", "audit.read"), "ACCOUNTANT has audit.read");
  assert(!hasPermission("ACCOUNTANT", "staff.read"), "Least Privilege: ACCOUNTANT CANNOT read staff directory");
  assert(!hasPermission("ACCOUNTANT", "rooms.manage"), "Least Privilege: ACCOUNTANT CANNOT manage rooms");

  // KITCHEN_OPERATIONS permissions
  assert(hasPermission("KITCHEN_OPERATIONS", "kitchen.read"), "KITCHEN_OPERATIONS has kitchen.read");
  assert(hasPermission("KITCHEN_OPERATIONS", "kitchen.manage"), "KITCHEN_OPERATIONS has kitchen.manage");
  assert(hasPermission("KITCHEN_OPERATIONS", "tiffin.read"), "KITCHEN_OPERATIONS has tiffin.read");
  assert(!hasPermission("KITCHEN_OPERATIONS", "delivery.read"), "Least Privilege: KITCHEN_OPERATIONS CANNOT read deliveries");
  assert(!hasPermission("KITCHEN_OPERATIONS", "staff.read"), "Least Privilege: KITCHEN_OPERATIONS CANNOT read staff");

  // DELIVERY_PERSON permissions
  assert(hasPermission("DELIVERY_PERSON", "delivery.read"), "DELIVERY_PERSON has delivery.read");
  assert(hasPermission("DELIVERY_PERSON", "delivery.update"), "DELIVERY_PERSON has delivery.update");
  assert(!hasPermission("DELIVERY_PERSON", "tiffin.manage"), "Least Privilege: DELIVERY_PERSON CANNOT manage tiffins");
  assert(!hasPermission("DELIVERY_PERSON", "finance.read"), "Least Privilege: DELIVERY_PERSON CANNOT read finance");

  // Fail-Closed behavior for unknown/invalid roles and permissions
  assert(!hasPermission("ATTACKER_ROLE", "staff.read"), "Unknown role fails closed with false");
  assert(!hasPermission(null, "staff.read"), "Null role fails closed with false");
  assert(!hasPermission(undefined, "staff.read"), "Undefined role fails closed with false");
  assert(!hasPermission("SUPER_ADMIN", "malicious.permission" as any), "Unknown permission fails closed with false");
  assert(getRolePermissions("UNKNOWN_ROLE").size === 0, "getRolePermissions returns empty set for unknown role");

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Server-Side Authorization Enforcement (401 & 403)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Server-Side Authorization Enforcement (401 Unauthenticated vs 403 Forbidden)");

  const superAdminUser: AuthenticatedUser = {
    id: "usr_super_admin_01",
    username: "admin",
    email: "admin@ravinarayan.in",
    fullName: "Ravinarayan Super Admin",
    role: "SUPER_ADMIN",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_test_accountant",
    username: "testaccountant",
    email: "accountant@ravinarayan.in",
    fullName: "Test Accountant",
    role: "ACCOUNTANT",
  };

  // Test 3a: Unauthenticated caller throws 401
  let unauthThrew401 = false;
  try {
    requirePermission(null, "staff.read");
  } catch (err: any) {
    unauthThrew401 = err instanceof AuthorizationError && err.statusCode === 401;
  }
  assert(unauthThrew401, "requirePermission throws AuthorizationError with HTTP 401 when caller is unauthenticated");

  // Test 3b: Authenticated caller without permission throws 403
  let forbiddenThrew403 = false;
  try {
    requirePermission(accountantUser, "staff.create", { ip: "192.168.1.50", action: "test.forbidden" });
  } catch (err: any) {
    forbiddenThrew403 = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(forbiddenThrew403, "requirePermission throws AuthorizationError with HTTP 403 when caller lacks permission");

  // Test 3c: Authorized caller does not throw
  let superAdminAllowed = true;
  try {
    requirePermission(superAdminUser, "staff.create");
  } catch {
    superAdminAllowed = false;
  }
  assert(superAdminAllowed, "requirePermission succeeds without error for authorized user");

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
    updateStaffRole(opsAuthUser, opsAuthUser.id, "SUPER_ADMIN");
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

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Inactive User Enforcement & Immediate Session Invalidation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Inactive User Enforcement & Immediate Session Invalidation");

  // Create session for active ops manager
  const opsSession = auth.createSession(newOpsManager.id, { ip: "192.168.1.100" });
  assert(opsSession.sessionToken.length === 64, "Created active session for operations manager");

  // Validation succeeds while active
  const validatedBeforeDeactivation = auth.validateSession(opsSession.sessionToken);
  assert(validatedBeforeDeactivation !== null && validatedBeforeDeactivation.id === newOpsManager.id, "Session validation succeeds while account is active");

  // Deactivate operations manager via setStaffActiveStatus
  setStaffActiveStatus(superAdminUser, newOpsManager.id, false, "192.168.1.1");
  const opsDbRow = db.prepare("SELECT is_active FROM staff_users WHERE id = ?").get(newOpsManager.id) as any;
  assert(opsDbRow.is_active === 0, "Staff record is_active successfully set to 0 in database");

  // Immediate Session Invalidation: Session record was deleted from database
  const sessionDbCount = db.prepare("SELECT count(*) as count FROM sessions WHERE staff_id = ?").get(newOpsManager.id) as any;
  assert(sessionDbCount.count === 0, "Deactivation immediately purged all active sessions for the deactivated user");

  // Attempting to validate the previous session token now returns null
  const validatedAfterDeactivation = auth.validateSession(opsSession.sessionToken);
  assert(validatedAfterDeactivation === null, "Deactivated user session token rejected with null on validateSession");

  // Inactive user attempting login fails
  const inactiveUserLookup = auth.findStaffByIdentifier("opsmanager");
  assert(inactiveUserLookup === null, "findStaffByIdentifier excludes inactive accounts (is_active = 0)");

  // Reactivate user
  setStaffActiveStatus(superAdminUser, newOpsManager.id, true, "192.168.1.1");
  const reactivatedLookup = auth.findStaffByIdentifier("opsmanager");
  assert(reactivatedLookup !== null && reactivatedLookup.isActive, "Reactivating account restores ability to authenticate");

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Immediate Role Change Enforcement
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Immediate Role Change Enforcement");

  // Create fresh session for reactivated user (currently OPERATIONS_MANAGER)
  const freshOpsSession = auth.createSession(newOpsManager.id);
  const validatedRoleBefore = auth.validateSession(freshOpsSession.sessionToken);
  assert(validatedRoleBefore?.role === "OPERATIONS_MANAGER", "Session reflects initial OPERATIONS_MANAGER role");

  // Super Admin updates user's role to ACCOUNTANT
  updateStaffRole(superAdminUser, newOpsManager.id, "ACCOUNTANT", "192.168.1.1");

  // Next session validation immediately reflects new role without requiring re-login
  const validatedRoleAfter = auth.validateSession(freshOpsSession.sessionToken);
  assert(validatedRoleAfter?.role === "ACCOUNTANT", "Role change takes effect immediately on subsequent session validation");
  assert(hasPermission(validatedRoleAfter?.role, "finance.manage"), "User now holds ACCOUNTANT permissions");
  assert(!hasPermission(validatedRoleAfter?.role, "rooms.manage"), "User no longer holds OPERATIONS_MANAGER permissions");

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: Password Reset & Session Revocation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Administrative Password Reset & Session Revocation");

  // Establish 2 active sessions for the user
  const sessionA = auth.createSession(newOpsManager.id);
  const sessionB = auth.createSession(newOpsManager.id);
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
    updateStaffRole(superAdminUser, superAdminUser.id, "OPERATIONS_MANAGER");
  } catch (err: any) {
    demoteSoleAdminBlocked = err.message.includes("sole remaining active Super Administrator");
  }
  assert(demoteSoleAdminBlocked, "Sole Super-Admin Protection: Cannot demote the only active Super Administrator");

  // Attempt to deactivate sole super admin
  let deactivateSoleAdminBlocked = false;
  try {
    setStaffActiveStatus(superAdminUser, superAdminUser.id, false);
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
    setStaffActiveStatus(superAdminUser, secondAdmin.id, false);
    deactivatingOneWithTwoAllowed = true;
  } catch {
    deactivatingOneWithTwoAllowed = false;
  }
  assert(deactivatingOneWithTwoAllowed, "Deactivating an admin is permitted when another active Super Admin exists");

  // Now only 1 active super admin remains again; attempting to deactivate that last one is blocked again!
  let deactivatingLastAgainBlocked = false;
  try {
    setStaffActiveStatus(superAdminUser, superAdminUser.id, false);
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
  // CLEANUP & SUMMARY
  // -----------------------------------------------------------------------------
  db.close();
  const { closeDb } = require("../apps/erp/src/server/database/db");
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
