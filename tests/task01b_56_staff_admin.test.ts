import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { getAsyncDb, closeDb, AsyncDb } from "../apps/erp/src/server/database/db";
import {
  listStaffUsers,
  getStaffUserById,
  createStaffUser,
  updateStaffRole,
  setStaffActiveStatus,
  resetStaffPassword,
  updateStaffProfile,
  initiateStaffPasswordRecovery,
  getStaffAuditHistory,
  getStaffStats,
} from "../apps/erp/src/server/staff/staffService";
import {
  validateSession,
  validateSessionDetailed,
  initiatePasswordReset,
  completePasswordReset,
} from "../apps/erp/src/server/authentication/auth";
import { AuthenticatedUser, StaffRole } from "../apps/erp/src/types";

// ============================================================================
// Database Safety Guards & Isolated Verification Database
// ============================================================================
const primaryDbPath = path.resolve(__dirname, "../data/erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

const TEST_DB_PATH = path.resolve(__dirname, "test_task56_staff.db");

function cleanupTestDb() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const wal = `${TEST_DB_PATH}-wal`;
  const shm = `${TEST_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

process.env.ERP_DATABASE_PATH = TEST_DB_PATH;
process.env.NODE_ENV = "test";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("================================================================================");
console.log("TASK 01B.56 REGRESSION TEST SUITE: STAFF ADMIN, ROLE MGMT & ACCOUNT RECOVERY");
console.log("================================================================================\n");

async function runAllTests() {
  console.log("--- 1. Initializing isolated database with schema migrations ---");
  const rawDb = new Database(TEST_DB_PATH);
  rawDb.pragma("journal_mode = WAL");
  rawDb.pragma("foreign_keys = ON");

  runMigrations(rawDb);
  const version = rawDb.pragma("user_version", { simple: true });
  assert(Number(version) >= 18, `Database user_version successfully advanced to at least V18 (got ${version})`);

  const db = getAsyncDb();

  // Seed primary Super Administrator
  const superAdminId = "usr_super_01";
  const superAdminActor: AuthenticatedUser = {
    id: superAdminId,
    username: "owner_super",
    email: "owner@ravinarayan.in",
    fullName: "Ravi Narayana Owner",
    role: "SUPER_ADMIN",
  };

  await db.execute(
    `INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'dummy_hash', 'SUPER_ADMIN', 1, datetime('now'), datetime('now'))`,
    [superAdminActor.id, superAdminActor.username, superAdminActor.email, superAdminActor.fullName]
  );

  // Seed Operations Manager
  const managerId = "usr_mgr_01";
  const managerActor: AuthenticatedUser = {
    id: managerId,
    username: "ops_manager",
    email: "manager@ravinarayan.in",
    fullName: "Amit Verma Manager",
    role: "OPERATIONS_MANAGER",
  };

  await db.execute(
    `INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'dummy_hash', 'OPERATIONS_MANAGER', 1, datetime('now'), datetime('now'))`,
    [managerActor.id, managerActor.username, managerActor.email, managerActor.fullName]
  );

  // Seed Delivery Person
  const deliveryId = "usr_del_01";
  const deliveryActor: AuthenticatedUser = {
    id: deliveryId,
    username: "courier_rahul",
    email: "rahul@ravinarayan.in",
    fullName: "Rahul Courier",
    role: "DELIVERY_PERSON",
  };

  await db.execute(
    `INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'dummy_hash', 'DELIVERY_PERSON', 1, datetime('now'), datetime('now'))`,
    [deliveryActor.id, deliveryActor.username, deliveryActor.email, deliveryActor.fullName]
  );

  assert(true, "Seeded initial staff accounts across roles");

  // ============================================================================
  // TEST SUITE 1: Staff Directory & Multi-Field Filtering
  // ============================================================================
  console.log("\n--- TEST SUITE 1: Staff Directory & Filtering ---");

  // 1. Unfiltered list
  const allStaff = await listStaffUsers(superAdminActor, undefined, db);
  assert(allStaff.length === 3, `Initial listStaffUsers returns 3 seeded staff (got ${allStaff.length})`);

  // 2. Filter by role
  const deliveryStaff = await listStaffUsers(superAdminActor, { role: "DELIVERY_PERSON" }, db);
  assert(deliveryStaff.length === 1, "Filter by role: DELIVERY_PERSON returns exactly 1");
  assert(deliveryStaff[0].username === "courier_rahul", "Delivery staff username matches");

  // 3. Filter by search (case-insensitive across name, username, email)
  const searchName = await listStaffUsers(superAdminActor, { search: "verma" }, db);
  assert(searchName.length === 1 && searchName[0].username === "ops_manager", "Search by partial name 'verma' matches manager");

  const searchEmail = await listStaffUsers(superAdminActor, { search: "owner@ravinarayan" }, db);
  assert(searchEmail.length === 1 && searchEmail[0].username === "owner_super", "Search by email matches super admin");

  const searchUsername = await listStaffUsers(superAdminActor, { search: "courier" }, db);
  assert(searchUsername.length === 1 && searchUsername[0].username === "courier_rahul", "Search by username matches courier");

  // 4. getStaffStats aggregate metrics
  const stats = await getStaffStats(superAdminActor, db);
  assert(stats.totalStaff === 3, `Stats totalStaff is 3 (got ${stats.totalStaff})`);
  assert(stats.activeStaff === 3, `Stats activeStaff is 3 (got ${stats.activeStaff})`);
  assert(stats.deactivatedStaff === 0, `Stats deactivatedStaff is 0 (got ${stats.deactivatedStaff})`);
  assert(stats.superAdmins === 1, `Stats superAdmins is 1 (got ${stats.superAdmins})`);

  // ============================================================================
  // TEST SUITE 2: Account Creation, Input Validation & Audit Trail
  // ============================================================================
  console.log("\n--- TEST SUITE 2: Account Creation & Input Validation ---");

  // 1. Password minimum length requirement
  let shortPasswordBlocked = false;
  try {
    await createStaffUser(superAdminActor, {
      fullName: "Neha Sharma",
      username: "neha_sharma",
      email: "neha@ravinarayan.in",
      role: "DELIVERY_PERSON",
      password: "short", // Only 5 chars
    }, undefined, db);
  } catch (err: any) {
    shortPasswordBlocked = true;
    assert(err.message.includes("at least 12 characters"), `Password < 12 characters rejected: '${err.message}'`);
  }
  assert(shortPasswordBlocked, "Short password (<12 chars) strictly rejected");

  // 2. Username format validation
  let invalidUsernameBlocked = false;
  try {
    await createStaffUser(superAdminActor, {
      fullName: "Neha Sharma",
      username: "neha sharma!", // Contains spaces and special char
      email: "neha@ravinarayan.in",
      role: "DELIVERY_PERSON",
      password: "StrongPassword@2026",
    }, undefined, db);
  } catch (err: any) {
    invalidUsernameBlocked = true;
    assert(err.message.includes("Username must be between 3 and 30"), `Invalid username format rejected: '${err.message}'`);
  }
  assert(invalidUsernameBlocked, "Invalid username format strictly rejected");

  // 3. Valid creation
  const createdAccountant = await createStaffUser(superAdminActor, {
    fullName: "Neha Sharma",
    username: "neha_sharma",
    email: "neha@ravinarayan.in",
    role: "DELIVERY_PERSON",
    password: "StrongPassword@2026",
  }, "127.0.0.1", db);

  assert(createdAccountant.id.startsWith("usr_"), "Created user has prefixed id");
  assert(createdAccountant.username === "neha_sharma", "Username stored normalized");
  assert(createdAccountant.email === "neha@ravinarayan.in", "Email stored normalized");
  assert(createdAccountant.role === "DELIVERY_PERSON", "Role is DELIVERY_PERSON");
  assert(createdAccountant.isActive === true, "Account is active by default");

  // Verify bcrypt hash at rest (starts with $2)
  const rawStaffRow = rawDb.prepare("SELECT password_hash FROM staff_users WHERE id = ?").get(createdAccountant.id) as any;
  assert(rawStaffRow.password_hash.startsWith("$2"), "Password stored as bcrypt hash at rest");

  // 4. Duplicate username rejection
  let duplicateUsernameBlocked = false;
  try {
    await createStaffUser(superAdminActor, {
      fullName: "Another Neha",
      username: "NEHA_SHARMA", // Duplicate case-insensitive
      email: "another_neha@ravinarayan.in",
      role: "DELIVERY_PERSON",
      password: "StrongPassword@2026",
    }, undefined, db);
  } catch (err: any) {
    duplicateUsernameBlocked = true;
    assert(err.message.includes("already in use"), `Duplicate username rejected: '${err.message}'`);
  }
  assert(duplicateUsernameBlocked, "Duplicate username strictly rejected");

  // 5. Duplicate email rejection
  let duplicateEmailBlocked = false;
  try {
    await createStaffUser(superAdminActor, {
      fullName: "Different User",
      username: "different_user",
      email: "neha@ravinarayan.in", // Duplicate email
      role: "DELIVERY_PERSON",
      password: "StrongPassword@2026",
    }, undefined, db);
  } catch (err: any) {
    duplicateEmailBlocked = true;
    assert(err.message.includes("already registered"), `Duplicate email rejected: '${err.message}'`);
  }
  assert(duplicateEmailBlocked, "Duplicate email strictly rejected");

  // 6. Audit trail verification
  const auditLogs = await getStaffAuditHistory(superAdminActor, createdAccountant.id, 10, db);
  assert(auditLogs.length >= 1, `Audit log recorded for created account (count: ${auditLogs.length})`);
  assert(auditLogs[0].action === "staff.created", "Action is staff.created");
  assert(auditLogs[0].actorUsername === "owner_super", "Actor is owner_super");

  // ============================================================================
  // TEST SUITE 3: Privilege Escalation Prevention in Role Assignment
  // ============================================================================
  console.log("\n--- TEST SUITE 3: Privilege Escalation Prevention ---");

  // 1. Non-super-admin attempting to create a SUPER_ADMIN account
  let nonAdminCreateSuperBlocked = false;
  try {
    await createStaffUser(managerActor, {
      fullName: "Rogue Admin",
      username: "rogue_admin",
      email: "rogue@ravinarayan.in",
      role: "SUPER_ADMIN",
      password: "StrongPassword@2026",
    }, undefined, db);
  } catch (err: any) {
    nonAdminCreateSuperBlocked = true;
    assert(err.message.includes("Privilege") || err.message.includes("Access denied"), `Non-admin cannot create SUPER_ADMIN: '${err.message}'`);
  }
  assert(nonAdminCreateSuperBlocked, "Privilege escalation: Non-super-admin blocked from creating SUPER_ADMIN account");

  // 2. Non-super-admin attempting to assign SUPER_ADMIN role to existing user
  let nonAdminAssignSuperBlocked = false;
  try {
    await updateStaffRole(managerActor, createdAccountant.id, "SUPER_ADMIN", undefined, db);
  } catch (err: any) {
    nonAdminAssignSuperBlocked = true;
    assert(err.message.includes("Privilege") || err.message.includes("Access denied"), `Non-admin cannot assign SUPER_ADMIN: '${err.message}'`);
  }
  assert(nonAdminAssignSuperBlocked, "Privilege escalation: Non-super-admin blocked from assigning SUPER_ADMIN role");

  // 3. Super Admin legitimately assigns new role
  await updateStaffRole(superAdminActor, createdAccountant.id, "OPERATIONS_MANAGER", "127.0.0.1", db);
  const updatedAccountant = await getStaffUserById(superAdminActor, createdAccountant.id, db);
  assert(updatedAccountant?.role === "OPERATIONS_MANAGER", "Super Admin successfully promoted delivery staff to OPERATIONS_MANAGER");

  // Verify role change audit log
  const roleAuditLogs = await getStaffAuditHistory(superAdminActor, createdAccountant.id, 10, db);
  const roleChangeLog = roleAuditLogs.find((l) => l.action === "staff.role_assigned");
  assert(roleChangeLog !== undefined, "Audit event staff.role_assigned recorded");
  assert(roleChangeLog?.metadata?.previousRole === "DELIVERY_PERSON", "Audit tracks previousRole: DELIVERY_PERSON");
  assert(roleChangeLog?.metadata?.newRole === "OPERATIONS_MANAGER", "Audit tracks newRole: OPERATIONS_MANAGER");

  // ISSUE-012: legacy roles (ACCOUNTANT, KITCHEN_OPERATIONS) can no longer be granted, but existing
  // legacy accounts keep their role and permissions until the Owner moves them to a canonical role.
  let legacyCreateBlocked = false;
  try {
    await createStaffUser(superAdminActor, {
      username: "legacy_acct_new",
      email: "legacy.acct.new@example.invalid",
      fullName: "Legacy Accountant New",
      password: "SecurePassword2026!",
      role: "ACCOUNTANT",
    }, "127.0.0.1", db);
  } catch (err: any) {
    legacyCreateBlocked = err.message.includes("retired");
  }
  assert(legacyCreateBlocked, "Creating a staff account with retired role ACCOUNTANT is rejected");

  let legacyAssignBlocked = false;
  try {
    await updateStaffRole(superAdminActor, createdAccountant.id, "KITCHEN_OPERATIONS", "127.0.0.1", db);
  } catch (err: any) {
    legacyAssignBlocked = err.message.includes("retired");
  }
  assert(legacyAssignBlocked, "Assigning retired role KITCHEN_OPERATIONS is rejected");

  const legacyId = "usr_legacy_accountant_56";
  const legacyNow = new Date().toISOString();
  await db.execute(
    `INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
     VALUES (?, 'legacy_accountant', 'legacy.accountant@example.invalid', 'Legacy Accountant', 'x', 'ACCOUNTANT', 1, ?, ?)`,
    [legacyId, legacyNow, legacyNow]
  );
  const legacyRow = await db.queryOne<any>("SELECT role FROM staff_users WHERE id = ?", [legacyId]);
  assert(legacyRow?.role === "ACCOUNTANT", "Existing legacy ACCOUNTANT account is left untouched");
  await updateStaffRole(superAdminActor, legacyId, "OPERATIONS_MANAGER", "127.0.0.1", db);
  const migratedRow = await db.queryOne<any>("SELECT role FROM staff_users WHERE id = ?", [legacyId]);
  assert(migratedRow?.role === "OPERATIONS_MANAGER", "Legacy account can be moved to a canonical role");

  // ============================================================================
  // TEST SUITE 4: Sole Super-Administrator Safety Protection
  // ============================================================================
  console.log("\n--- TEST SUITE 4: Sole Super-Administrator Protection ---");

  // 1. Attempt to demote the sole active Super Admin
  let soleDemoteBlocked = false;
  try {
    await updateStaffRole(superAdminActor, superAdminActor.id, "OPERATIONS_MANAGER", undefined, db);
  } catch (err: any) {
    soleDemoteBlocked = true;
    assert(err.message.includes("sole remaining active Super Administrator"), `Sole admin demotion blocked: '${err.message}'`);
  }
  assert(soleDemoteBlocked, "Sole Super-Administrator demotion strictly prevented");

  // 2. Attempt to deactivate the sole active Super Admin
  let soleDeactivateBlocked = false;
  try {
    await setStaffActiveStatus(superAdminActor, superAdminActor.id, false, undefined, db);
  } catch (err: any) {
    soleDeactivateBlocked = true;
    assert(err.message.includes("sole remaining active Super Administrator"), `Sole admin deactivation blocked: '${err.message}'`);
  }
  assert(soleDeactivateBlocked, "Sole Super-Administrator deactivation strictly prevented");

  // 3. Create a second Super Admin
  const secondAdmin = await createStaffUser(superAdminActor, {
    fullName: "Co-Owner Administrator",
    username: "co_owner",
    email: "co_owner@ravinarayan.in",
    role: "SUPER_ADMIN",
    password: "StrongPassword@2026",
  }, undefined, db);

  // Now demoting one of the two super admins should succeed
  await updateStaffRole(superAdminActor, secondAdmin.id, "OPERATIONS_MANAGER", undefined, db);
  const demotedCoOwner = await getStaffUserById(superAdminActor, secondAdmin.id, db);
  assert(demotedCoOwner?.role === "OPERATIONS_MANAGER", "Demoting super admin succeeds when another super admin exists");

  // ============================================================================
  // TEST SUITE 5: Account Deactivation & Immediate Session Invalidation
  // ============================================================================
  console.log("\n--- TEST SUITE 5: Account Deactivation & Session Invalidation ---");

  // 1. Simulate an active session for createdAccountant
  const rawSessionToken = crypto.randomBytes(32).toString("hex");
  const sessionTokenHash = crypto.createHash("sha256").update(rawSessionToken).digest("hex");
  const sessionId = `ses_${crypto.randomUUID()}`;
  const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.execute(
    `INSERT INTO sessions (id, token_hash, staff_id, expires_at, created_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, datetime('now'), '127.0.0.1', 'Mozilla/5.0 Test')`,
    [sessionId, sessionTokenHash, createdAccountant.id, futureExpiry]
  );

  // Verify session validates while account is active
  const validatedBefore = await validateSession(rawSessionToken, db);
  assert(validatedBefore !== null, "Session validates successfully while staff account is active");
  assert(validatedBefore?.id === createdAccountant.id, "Validated session returns correct staff id");

  // 2. Deactivate the staff account
  await setStaffActiveStatus(superAdminActor, createdAccountant.id, false, "127.0.0.1", db);

  // 3. Verify account marked inactive in database
  const deactivatedUser = await getStaffUserById(superAdminActor, createdAccountant.id, db);
  assert(deactivatedUser?.isActive === false, "Staff user isActive is false");

  // 4. Verify all sessions for that staff member are deleted from the sessions table
  const remainingSessions = await db.query<any>("SELECT * FROM sessions WHERE staff_id = ?", [createdAccountant.id]);
  assert(remainingSessions.length === 0, "All sessions for deactivated staff immediately purged from sessions table");

  // 5. Verify validateSessionDetailed strictly fails closed with null user
  const validatedAfter = await validateSessionDetailed(rawSessionToken, db);
  assert(validatedAfter.user === null, "Session validation strictly returns null user after account deactivation");

  // 6. Verify audit logging
  const deactAudit = await getStaffAuditHistory(superAdminActor, createdAccountant.id, 10, db);
  const deactLog = deactAudit.find((l) => l.action === "staff.deactivated");
  assert(deactLog !== undefined, "Audit log staff.deactivated recorded");

  // 7. Reactivate staff account
  await setStaffActiveStatus(superAdminActor, createdAccountant.id, true, "127.0.0.1", db);
  const reactivatedUser = await getStaffUserById(superAdminActor, createdAccountant.id, db);
  assert(reactivatedUser?.isActive === true, "Staff user isActive is restored to true");

  const reactLog = (await getStaffAuditHistory(superAdminActor, createdAccountant.id, 10, db)).find(
    (l) => l.action === "staff.activated"
  );
  assert(reactLog !== undefined, "Audit log staff.activated recorded upon reactivation");

  // ============================================================================
  // TEST SUITE 6: Administrator-Initiated Password Recovery vs Direct Reset
  // ============================================================================
  console.log("\n--- TEST SUITE 6: Administrator Recovery Link vs Direct Reset ---");

  // 1. Administrator initiates recovery link for staff member
  const recoveryResult = await initiateStaffPasswordRecovery(
    superAdminActor,
    createdAccountant.id,
    "http://localhost:3000",
    "127.0.0.1",
    db
  );

  assert(recoveryResult.success === true, "Recovery link successfully initiated by administrator");
  assert(recoveryResult.message.includes("successfully dispatched"), "Affirmative dispatch message returned");

  // Verify single-use token created in password_resets table
  const resetRow = await db.queryOne<any>(
    "SELECT * FROM password_resets WHERE staff_id = ? AND used_at IS NULL",
    [createdAccountant.id]
  );
  assert(resetRow !== null, "Password reset token record created in password_resets table");
  assert(resetRow.token_hash.length === 64, "Token stored as SHA-256 hash at rest");

  // Verify audit log for recovery initiation
  const recoveryAudit = (await getStaffAuditHistory(superAdminActor, createdAccountant.id, 10, db)).find(
    (l) => l.action === "staff.recovery_initiated"
  );
  assert(recoveryAudit !== undefined, "Audit log staff.recovery_initiated recorded");
  assert(recoveryAudit?.actorUsername === "owner_super", "Actor is owner_super");
  assert(recoveryAudit?.metadata?.targetUsername === "neha_sharma", "Metadata tracks target username");

  // 2. Cannot initiate recovery for deactivated staff account
  await setStaffActiveStatus(superAdminActor, createdAccountant.id, false, undefined, db);
  let recoveryOnDeactivatedBlocked = false;
  try {
    await initiateStaffPasswordRecovery(superAdminActor, createdAccountant.id, undefined, undefined, db);
  } catch (err: any) {
    recoveryOnDeactivatedBlocked = true;
    assert(err.message.includes("deactivated staff account"), `Recovery on deactivated account blocked: '${err.message}'`);
  }
  assert(recoveryOnDeactivatedBlocked, "Password recovery strictly blocked for deactivated staff accounts");

  // Reactivate for further tests
  await setStaffActiveStatus(superAdminActor, createdAccountant.id, true, undefined, db);

  // 3. Emergency Direct Reset by Super Admin
  await resetStaffPassword(superAdminActor, createdAccountant.id, "NewPassword@2026!", "127.0.0.1", db);

  // Verify password hash updated in staff_users
  const updatedStaffHash = (await rawDb.prepare("SELECT password_hash FROM staff_users WHERE id = ?").get(createdAccountant.id) as any).password_hash;
  assert(updatedStaffHash !== rawStaffRow.password_hash, "Direct reset updated password_hash");

  // Verify non-super-admin cannot perform direct reset
  let nonAdminDirectResetBlocked = false;
  try {
    await resetStaffPassword(managerActor, createdAccountant.id, "AttemptedPassword123!", undefined, db);
  } catch (err: any) {
    nonAdminDirectResetBlocked = true;
    assert(err.message.includes("Privilege restriction") || err.message.includes("Access denied"), `Non-admin direct reset blocked: '${err.message}'`);
  }
  assert(nonAdminDirectResetBlocked, "Non-super-admin strictly blocked from performing direct password reset");

  // ============================================================================
  // TEST SUITE 7: Self-Service Password Recovery Security Invariants
  // ============================================================================
  console.log("\n--- TEST SUITE 7: Self-Service Recovery Invariants ---");

  // 1. Timing-safe non-disclosure: Requesting recovery for non-existent account returns generic response
  const genericUnknown = await initiatePasswordReset("unknown_nonexistent@ravinarayan.in", undefined, db);
  assert(genericUnknown.success === true, "Unknown identifier returns success: true");
  assert(genericUnknown.message.includes("If an account matching"), "Returns generic non-disclosing message");

  // 2. Request recovery for legitimate account
  const validResetReq = await initiatePasswordReset("neha_sharma", undefined, db);
  assert(validResetReq.success === true, "Legitimate identifier returns success: true");
  assert(validResetReq.message === genericUnknown.message, "Legitimate and unknown accounts return identical responses (no enumeration leak)");

  // Retrieve raw token from test database (simulate user receiving email)
  const userResetRow = await db.queryOne<any>(
    "SELECT id, token_hash FROM password_resets WHERE staff_id = ? ORDER BY created_at DESC LIMIT 1",
    [createdAccountant.id]
  );
  assert(userResetRow !== null, "Reset record exists");

  // 3. Complete password reset with simulated valid raw token
  // Generate a dedicated known token to test completion
  const testRawToken = crypto.randomBytes(32).toString("hex");
  const testTokenHash = crypto.createHash("sha256").update(testRawToken).digest("hex");
  const testResetId = `pr_${crypto.randomUUID()}`;
  const testExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  await db.execute(
    `INSERT INTO password_resets (id, staff_id, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, datetime('now'))`,
    [testResetId, createdAccountant.id, testTokenHash, testExpiry]
  );

  const resetResult = await completePasswordReset(testRawToken, "CompletedResetPass@2026", "127.0.0.1", db);
  assert(resetResult.success === true, "Password reset completion succeeds with valid token");

  // 4. Single-use invariant: Attempting to reuse the same token must fail
  const reuseResult = await completePasswordReset(testRawToken, "AnotherNewPass@2026", "127.0.0.1", db);
  assert(reuseResult.success === false, "Reusing a used password reset token strictly fails");
  assert(reuseResult.error?.includes("Invalid or expired"), "Returns invalid/expired error on token reuse");

  // 5. Expired token invariant
  const expiredRawToken = crypto.randomBytes(32).toString("hex");
  const expiredTokenHash = crypto.createHash("sha256").update(expiredRawToken).digest("hex");
  const pastExpiry = new Date(Date.now() - 1000).toISOString();

  await db.execute(
    `INSERT INTO password_resets (id, staff_id, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, NULL, datetime('now'))`,
    [`pr_${crypto.randomUUID()}`, createdAccountant.id, expiredTokenHash, pastExpiry]
  );

  const expiredResult = await completePasswordReset(expiredRawToken, "ExpiredPassAttempt@2026", "127.0.0.1", db);
  assert(expiredResult.success === false, "Expired token strictly fails");

  // ============================================================================
  // TEST SUITE 8: Operational History Preservation
  // ============================================================================
  console.log("\n--- TEST SUITE 8: Operational History Preservation ---");

  // Staff member records financial transaction
  const txId = `txn_staff_test_${Date.now()}`;
  await db.execute(
    `INSERT INTO financial_transactions (
       id, transaction_type, amount, transaction_date, payment_method,
       category, description, status, created_by, created_at, updated_at
     ) VALUES (?, 'EXPENSE', 1500, '2026-10-23', 'CASH', 'OFFICE_SUPPLIES', 'Printer toner', 'POSTED', ?, datetime('now'), datetime('now'))`,
    [txId, createdAccountant.id]
  );

  // Deactivate the staff member who created the transaction
  await setStaffActiveStatus(superAdminActor, createdAccountant.id, false, undefined, db);

  // Verify the financial transaction row is completely preserved and still references the deactivated staff member
  const txRow = await db.queryOne<any>("SELECT * FROM financial_transactions WHERE id = ?", [txId]);
  assert(txRow !== null, "Financial transaction is preserved intact after staff member deactivation");
  assert(txRow.created_by === createdAccountant.id, "created_by foreign key preserves staff id reference");

  // ============================================================================
  // TEST SUITE 9: Server-Side RBAC Enforcement on Staff Operations
  // ============================================================================
  console.log("\n--- TEST SUITE 9: Server-Side RBAC Enforcement ---");

  // 1. Delivery person denied staff.read
  let delReadBlocked = false;
  try {
    await listStaffUsers(deliveryActor, undefined, db);
  } catch (err: any) {
    delReadBlocked = true;
    assert(err.message.includes("Access denied"), `DELIVERY_PERSON rejected from listStaffUsers: '${err.message}'`);
  }
  assert(delReadBlocked, "DELIVERY_PERSON denied staff.read");

  // 2. Delivery person denied staff.create
  let delCreateBlocked = false;
  try {
    await createStaffUser(deliveryActor, {
      fullName: "Test Staff",
      username: "test_staff",
      email: "test@ravinarayan.in",
      role: "ACCOUNTANT",
      password: "StrongPassword@2026",
    }, undefined, db);
  } catch (err: any) {
    delCreateBlocked = true;
    assert(err.message.includes("Access denied"), `DELIVERY_PERSON rejected from createStaffUser: '${err.message}'`);
  }
  assert(delCreateBlocked, "DELIVERY_PERSON denied staff.create");

  // 3. Operations Manager has staff.read but lacks staff.create
  const opsStaffList = await listStaffUsers(managerActor, undefined, db);
  assert(opsStaffList.length > 0, "OPERATIONS_MANAGER authorized to view staff list");

  let opsCreateBlocked = false;
  try {
    await createStaffUser(managerActor, {
      fullName: "Test Staff",
      username: "test_staff_2",
      email: "test2@ravinarayan.in",
      role: "ACCOUNTANT",
      password: "StrongPassword@2026",
    }, undefined, db);
  } catch (err: any) {
    opsCreateBlocked = true;
    assert(err.message.includes("Access denied"), `OPERATIONS_MANAGER rejected from createStaffUser: '${err.message}'`);
  }
  assert(opsCreateBlocked, "OPERATIONS_MANAGER denied staff.create");

  // 4. Operations Manager lacks staff.deactivate
  let opsDeactBlocked = false;
  try {
    await setStaffActiveStatus(managerActor, deliveryActor.id, false, undefined, db);
  } catch (err: any) {
    opsDeactBlocked = true;
    assert(err.message.includes("Access denied"), `OPERATIONS_MANAGER rejected from setStaffActiveStatus: '${err.message}'`);
  }
  assert(opsDeactBlocked, "OPERATIONS_MANAGER denied staff.deactivate");

  // ============================================================================
  // SAFETY CHECK: Ensure data/erp.db remains strictly untouched
  // ============================================================================
  console.log("\n--- Safety & DB Immutability Guard Verification ---");
  closeDb();
  cleanupTestDb();

  if (primaryStatsBefore) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(
      primaryStatsBefore.size === primaryStatsAfter.size &&
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs,
      "Protected primary database data/erp.db was strictly untouched (size and mtime preserved)"
    );
  }

  console.log("\n================================================================================");
  console.log(`TASK 01B.56 REGRESSION TESTS COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("FATAL: Unhandled error in Task 01B.56 test runner:", err);
  process.exit(1);
});
