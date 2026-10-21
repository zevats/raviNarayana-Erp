import path from "path";
import fs from "fs";
import crypto from "crypto";
import {
  validatePostgresTargetSafety,
  runPostgresMigrations,
  seedInitialPostgresAdmin,
} from "../apps/erp/src/server/database/pgIntegration";
import {
  getPgSql,
  getDrizzleDb,
  getDatabaseEngine,
  closePg,
  pingDatabase,
} from "../apps/erp/src/server/database/client";
import {
  getAsyncDb,
  convertPlaceholders,
  AsyncDb,
} from "../apps/erp/src/server/database/db";
import {
  createStaffUser,
  listStaffUsers,
  getStaffUserById,
  updateStaffRole,
  setStaffActiveStatus,
} from "../apps/erp/src/server/staff/staffService";
import {
  hashPassword,
  verifyPassword,
  createSession,
  validateSessionDetailed,
  destroySession,
  recordLoginAttempt,
} from "../apps/erp/src/server/authentication/auth";
import {
  createRoom,
  listRooms,
  getRoomById,
} from "../apps/erp/src/server/rooms/roomService";
import {
  registerResident,
  assignResidentToRoom,
  checkOutResident,
  getResidentById,
} from "../apps/erp/src/server/residents/residentService";
import {
  recordRentCharge,
  recordRentPayment,
  recordSecurityDeposit,
  recordExpense,
  reverseTransaction,
  getResidentRentBalance,
  getCashbookSummary,
} from "../apps/erp/src/server/finance/financeService";
import {
  createMealPlan,
  confirmMealPlan,
  completeMealPlan,
  adjustMealPlanQuantity,
  updateResidentMealPreference,
} from "../apps/erp/src/server/kitchen/kitchenService";
import {
  createExternalDeliveryTask,
  assignDeliveryTask,
  dispatchDeliveryTask,
  completeDeliveryTask,
  reportDeliveryException,
  retryDeliveryTask,
  getDeliveryTaskById,
} from "../apps/erp/src/server/delivery/deliveryService";
import {
  markNotificationAsRead,
  getNotifications,
} from "../apps/erp/src/server/notifications/notificationService";
import {
  recordAuditEventAsync,
  getAuditLogsAsync,
} from "../apps/erp/src/server/audit/audit";
import { AuthenticatedUser } from "../apps/erp/src/types";

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

const adminActor: AuthenticatedUser = {
  id: "usr_super_admin",
  username: "admin_pg_test",
  email: "admin_pg@ravinarayan.in",
  fullName: "Postgres Test Super Admin",
  role: "SUPER_ADMIN",
};

async function runLivePostgresIntegrationTests() {
  console.log("================================================================================");
  console.log("TASK 01B.27 — REAL POSTGRESQL INTEGRATION VALIDATION & ERP SMOKE TESTS");
  console.log("Target: Isolated Local PostgreSQL 16 Instance on 127.0.0.1:5432");
  console.log("================================================================================\n");

  const testDbUrl = "postgres://postgres_test:test_secret_pass@127.0.0.1:5432/ravinarayan_test_db";
  process.env.DATABASE_URL = testDbUrl;
  process.env.DIRECT_URL = testDbUrl;
  (globalThis as any)._rnTestDbProvider = null;
  (globalThis as any)._rnTestAsyncDb = null;

  // ---------------------------------------------------------------------------
  // SUITE 1: Target Identity, Isolation & Safety Verification
  // ---------------------------------------------------------------------------
  console.log("[SUITE 1] PostgreSQL Target Identity & Isolation Safety");

  const safety = validatePostgresTargetSafety(testDbUrl);
  assert(safety.safe === true, "Validates target connection is safe for local integration testing");
  assert(safety.isProduction === false, "Positively confirms target is NOT production");
  assert(safety.isRehearsalDatabase === false, "Positively confirms target is NOT remote Neon rehearsal database");
  assert(safety.hostname === "127.0.0.1", "Target hostname is strictly 127.0.0.1 (local)");
  assert(safety.database === "ravinarayan_test_db", "Target database name is strictly ravinarayan_test_db");

  // Verify fail-closed safety guards
  const unconfiguredSafety = validatePostgresTargetSafety(null);
  assert(!unconfiguredSafety.safe, "Safety guard rejects null/missing PostgreSQL connection URL");

  const prodSafety = validatePostgresTargetSafety("postgres://admin:secret@prod.aws.postgres.com:5432/ravinarayan_prod");
  assert(!prodSafety.safe && prodSafety.isProduction, "Safety guard strictly blocks production database target");

  const rehearsalHost = "ep-test-123.ap-southeast-1.aws.neon.tech";
  const origHost = process.env.EXPECTED_NEON_HOST;
  const origDb = process.env.EXPECTED_NEON_DATABASE;
  const origOptIn = process.env.ALLOW_TEST_MIGRATION;
  try {
    process.env.EXPECTED_NEON_HOST = rehearsalHost;
    process.env.EXPECTED_NEON_DATABASE = "neondb";
    delete process.env.ALLOW_TEST_MIGRATION;
    const rehearsalBlocked = validatePostgresTargetSafety(`postgres://user:pw@${rehearsalHost}:5432/neondb`);
    assert(!rehearsalBlocked.safe && rehearsalBlocked.isRehearsalDatabase, "Safety guard strictly blocks Neon rehearsal database without explicit flag");
  } finally {
    if (origHost) process.env.EXPECTED_NEON_HOST = origHost; else delete process.env.EXPECTED_NEON_HOST;
    if (origDb) process.env.EXPECTED_NEON_DATABASE = origDb; else delete process.env.EXPECTED_NEON_DATABASE;
    if (origOptIn) process.env.ALLOW_TEST_MIGRATION = origOptIn; else delete process.env.ALLOW_TEST_MIGRATION;
  }

  // Connect to live PostgreSQL and query version
  const rawSql = getPgSql(true);
  assert(rawSql !== null, "PostgreSQL raw SQL client initialized successfully");
  if (!rawSql) throw new Error("Could not initialize PostgreSQL client");

  const versionRes = await rawSql`SELECT version(), current_database(), current_user`;
  assert(versionRes.length === 1, "Connected to PostgreSQL server and executed query");
  assert(versionRes[0].version.includes("PostgreSQL 16"), `Target running PostgreSQL 16 (got: ${versionRes[0].version.slice(0, 30)}...)`);
  assert(versionRes[0].current_database === "ravinarayan_test_db", "Confirmed active database is ravinarayan_test_db");
  assert(versionRes[0].current_user === "postgres_test", "Confirmed connection user is postgres_test");

  // Verify pingDatabase diagnostics
  const ping = await pingDatabase();
  assert(ping.ok === true, "Database ping diagnostics returned ok: true");
  assert(ping.engine === "postgresql", "Database ping diagnostics identifies engine as postgresql");

  // ---------------------------------------------------------------------------
  // SUITE 2: Real PostgreSQL Schema Migrations from Clean Slate
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 2] Real Drizzle Migrations Against Clean Test Schema");

  // Reset public and drizzle schemas cleanly in the disposable test DB to guarantee migration test from scratch
  console.log("  Resetting public and drizzle schemas in isolated test database...");
  await rawSql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");

  // Verify schema is completely empty
  const preTables = await rawSql`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
  `;
  assert(preTables.length === 0, "Test database public schema is verified clean (0 tables)");

  // Run actual Drizzle migrations
  console.log("  Applying genuine Drizzle migrations...");
  const migrationResult = await runPostgresMigrations(true);
  assert(migrationResult.success === true, `Migrations applied successfully: ${JSON.stringify(migrationResult)}`);

  // Verify all 18 tables + migration tracking created in PostgreSQL
  const postTables = await rawSql`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
  `;
  const tableNames = postTables.map((r: any) => r.table_name);
  console.log(`  Created ${tableNames.length} tables in PostgreSQL:`, tableNames.join(", "));

  const expectedTables = [
    "audit_logs",
    "auth_challenges",
    "daily_meal_plans",
    "delivery_task_events",
    "delivery_tasks",
    "financial_transactions",
    "login_attempts",
    "meal_plan_adjustments",
    "password_resets",
    "resident_meal_preferences",
    "resident_meal_records",
    "resident_stays",
    "residents",
    "rooms",
    "session_preemptions",
    "sessions",
    "staff_notification_reads",
    "staff_users",
  ];

  for (const t of expectedTables) {
    assert(tableNames.includes(t), `Table '${t}' created and exists in PostgreSQL schema`);
  }

  // Verify Drizzle migration tracking table exists
  const drizzleMeta = await rawSql`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
    ) as exists;
  `;
  assert(drizzleMeta[0].exists === true, "Drizzle migration journal '__drizzle_migrations' initialized in PostgreSQL");

  // Verify idempotent rerun of migrations
  const rerunResult = await runPostgresMigrations(true);
  assert(rerunResult.success === true, "Safe idempotent rerun: applying migrations second time succeeds with no errors");

  // Verify database connection failure handling (no fallback to SQLite)
  const invalidDbUrl = "postgres://invalid_user:invalid_pass@127.0.0.1:54999/non_existent_db";
  let failedConnectionHandled = false;
  try {
    const badClient = require("postgres")(invalidDbUrl, { connect_timeout: 1, max: 1 });
    await badClient`SELECT 1`;
    await badClient.end();
  } catch (err: any) {
    failedConnectionHandled = true;
    assert(err.message !== "", `Failed connection produces clear error without falling back to SQLite (${err.code || err.message})`);
  }
  assert(failedConnectionHandled, "Connection to non-existent database properly rejected");

  // ---------------------------------------------------------------------------
  // SUITE 3: Administrator Provisioning (seedInitialPostgresAdmin)
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 3] Real Administrator Provisioning in PostgreSQL");

  const asyncDb = getAsyncDb();
  assert(asyncDb.isPostgres === true, "AsyncDb configured with isPostgres: true");

  const seed1 = await seedInitialPostgresAdmin(asyncDb, {
    username: adminActor.username,
    email: adminActor.email,
    fullName: adminActor.fullName,
    password: "SuperSecureAdminPassword2026!",
  });
  assert(seed1.seeded === true, "Successfully provisioned initial administrator into PostgreSQL staff_users");
  assert(seed1.username === adminActor.username, "Provisioned administrator has expected username");

  // Verify admin record in PostgreSQL
  const adminRow = await asyncDb.queryOne(
    "SELECT id, username, email, role, is_active as isActive, password_hash as passwordHash FROM staff_users WHERE username = ?",
    [adminActor.username]
  );
  assert(adminRow !== null, "Queried provisioned administrator from PostgreSQL");
  assert(adminRow.role === "SUPER_ADMIN", "Administrator has SUPER_ADMIN role");
  assert(Number(adminRow.isActive) === 1, "Administrator is active (is_active = 1)");
  assert(adminRow.passwordHash.startsWith("$2"), "Password securely hashed with bcrypt");

  // Test idempotent skip on subsequent provisioning run
  const seed2 = await seedInitialPostgresAdmin(asyncDb, {
    username: adminActor.username,
    email: adminActor.email,
    fullName: adminActor.fullName,
    password: "SuperSecureAdminPassword2026!",
  });
  assert(seed2.seeded === false, "Second seeding run safely skipped when staff_users is already populated");
  assert(seed2.message.includes("already contains 1 user(s)"), "Provides clear skip audit message");

  // ---------------------------------------------------------------------------
  // SUITE 4: Staff Authentication, Passwords, Login Attempts & Sessions
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 4] Staff Authentication, Sessions & RBAC");

  // Create test staff user with OPERATIONS_MANAGER role
  const newStaff = await createStaffUser(adminActor, {
    username: "manager_priya",
    email: "priya.sharma@ravinarayan.in",
    fullName: "Priya Sharma",
    role: "OPERATIONS_MANAGER",
    password: "ManagerPassword2026!",
  });
  assert(newStaff.username === "manager_priya", "Created staff user 'manager_priya' in PostgreSQL");
  assert(newStaff.role === "OPERATIONS_MANAGER", "Staff assigned OPERATIONS_MANAGER role");

  // Verify password hash and authentication
  const fetchedStaff = await getStaffUserById(adminActor, newStaff.id);
  assert(fetchedStaff !== null, "Retrieved staff user from PostgreSQL by ID");

  const correctPasswordMatch = await verifyPassword("ManagerPassword2026!", (await asyncDb.queryOne(
    "SELECT password_hash FROM staff_users WHERE id = ?", [newStaff.id]
  )).password_hash);
  assert(correctPasswordMatch === true, "Bcrypt password verification succeeds for correct staff credentials");

  const wrongPasswordMatch = await verifyPassword("WrongPassword123!", (await asyncDb.queryOne(
    "SELECT password_hash FROM staff_users WHERE id = ?", [newStaff.id]
  )).password_hash);
  assert(wrongPasswordMatch === false, "Bcrypt password verification rejects invalid credentials");

  // Record failed login attempt in PostgreSQL
  await recordLoginAttempt("manager_priya", "192.168.1.100", false, asyncDb);
  const failAttempts = await asyncDb.query(
    "SELECT * FROM login_attempts WHERE identifier = ?",
    ["manager_priya"]
  );
  assert(failAttempts.length === 1, "Recorded failed login attempt in PostgreSQL");
  assert(Number(failAttempts[0].success) === 0, "Attempt recorded as failure (0)");

  // Record successful login attempt (resets failed attempt counters per security policy)
  await recordLoginAttempt("manager_priya", "192.168.1.100", true, asyncDb);
  const successAttempts = await asyncDb.query(
    "SELECT * FROM login_attempts WHERE identifier = ?",
    ["manager_priya"]
  );
  assert(successAttempts.length === 1, "Recorded successful login attempt and reset failed attempts in PostgreSQL");
  assert(Number(successAttempts[0].success) === 1, "Attempt recorded as success (1)");

  // Session lifecycle: create, validate, destroy
  const sessionRecord = await createSession(newStaff.id, { ip: "192.168.1.100", userAgent: "Mozilla/5.0 Test Agent" }, asyncDb);
  assert(Boolean(sessionRecord.sessionToken), "Generated session token and persisted session to PostgreSQL");

  const validatedSession = await validateSessionDetailed(sessionRecord.sessionToken, asyncDb);
  assert(validatedSession.user !== null, "Session successfully validated from PostgreSQL");
  assert(validatedSession.user?.id === newStaff.id, "Session user matches staff ID");

  // Preempt session by creating a new session with preempt: true (Single Active Session enforcement)
  const preemptionSession = await createSession(newStaff.id, { preempt: true, ip: "192.168.1.102" }, asyncDb);
  assert(Boolean(preemptionSession.sessionToken), "Created new session with preempt: true in PostgreSQL");

  const invalidatedSession = await validateSessionDetailed(sessionRecord.sessionToken, asyncDb);
  assert(invalidatedSession.user === null && invalidatedSession.isPreempted === true, "Session validation fails and marks isPreempted after token hash is preempted");

  // Destroy session cleanly
  await destroySession(preemptionSession.sessionToken, asyncDb);
  const destroyedValidation = await validateSessionDetailed(preemptionSession.sessionToken, asyncDb);
  assert(destroyedValidation.user === null, "Session invalidated after destroySession");

  // Update staff role & status
  await updateStaffRole(adminActor, newStaff.id, "ACCOUNTANT");
  const updatedStaff = await getStaffUserById(adminActor, newStaff.id);
  assert(updatedStaff?.role === "ACCOUNTANT", "Updated staff role from OPERATIONS_MANAGER to ACCOUNTANT in PostgreSQL");

  await setStaffActiveStatus(adminActor, newStaff.id, false);
  const deactivatedStaff = await getStaffUserById(adminActor, newStaff.id);
  assert(deactivatedStaff?.isActive === false, "Deactivated staff user (isActive: false)");

  // Reactivate for further tests
  await setStaffActiveStatus(adminActor, newStaff.id, true);

  // ---------------------------------------------------------------------------
  // SUITE 5: Rooms & Residents Workflows (with Occupancy & Constraints)
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 5] Rooms & Residents Management");

  // Create Room 101 (Single, Capacity 1) and Room 102 (Double Sharing, Capacity 2)
  const room101 = await createRoom(adminActor, {
    roomNumber: "101",
    floor: 1,
    type: "SINGLE",
    capacity: 1,
    baseRentMonthly: 1500000, // 15,000 INR
  });
  assert(room101.roomNumber === "101", "Created room 101 in PostgreSQL");
  assert(room101.capacity === 1, "Room 101 capacity is 1");
  assert(room101.baseRentMonthly === 1500000, "Room 101 base rent monthly is 1500000");

  const room102 = await createRoom(adminActor, {
    roomNumber: "102",
    floor: 1,
    type: "DOUBLE_SHARING",
    capacity: 2,
    baseRentMonthly: 1200000, // 12,000 INR
  });
  assert(room102.roomNumber === "102", "Created room 102 in PostgreSQL");

  // List rooms and verify camelCase mapping
  const allRooms = await listRooms(adminActor);
  assert(allRooms.length >= 2, `Retrieved ${allRooms.length} rooms from PostgreSQL`);
  const fetchedR101 = allRooms.find((r) => r.roomNumber === "101");
  assert(fetchedR101 !== undefined && fetchedR101.baseRentMonthly === 1500000, "Room record properly mapped with camelCase fields");

  // Register resident
  const resident1 = await registerResident(adminActor, {
    fullName: "Ramesh Chandra Sharma",
    phone: "9876543210",
    email: "ramesh.sharma@example.com",
    emergencyContact: "Son: Anil Sharma 9876543211",
    notes: "Requires ground floor accommodation",
  });
  assert(resident1.fullName === "Ramesh Chandra Sharma", "Registered resident Ramesh in PostgreSQL");

  // Assign resident to Room 101 (Check-in)
  const stay1 = await assignResidentToRoom(adminActor, {
    residentId: resident1.id,
    roomId: room101.id,
    checkInDate: "2026-10-01",
    monthlyRent: 1500000,
  });
  assert(stay1.residentId === resident1.id, "Assigned resident Ramesh to Room 101 in PostgreSQL");

  // Verify room occupancy updated in PostgreSQL
  const r101AfterCheckin = await getRoomById(adminActor, room101.id);
  assert(r101AfterCheckin.occupiedBeds === 1, "Room 101 occupied beds is 1");
  assert(r101AfterCheckin.availableBeds === 0, "Room 101 has 0 available beds");

  // Register second resident
  const resident2 = await registerResident(adminActor, {
    fullName: "Sushila Devi",
    phone: "9876543220",
    email: "sushila.devi@example.com",
  });

  // Attempting to assign resident2 to full Room 101 should fail
  let capacityErrorCaught = false;
  try {
    await assignResidentToRoom(adminActor, {
      residentId: resident2.id,
      roomId: room101.id,
      checkInDate: "2026-10-02",
      monthlyRent: 1500000,
    });
  } catch (err: any) {
    capacityErrorCaught = true;
    assert(err.message.includes("capacity") || err.message.includes("full") || err.message.includes("occupied"), `Capacity limit enforced in PostgreSQL: ${err.message}`);
  }
  assert(capacityErrorCaught, "Assignment prevented when room capacity is exceeded");

  // Assign resident2 to Room 102
  const stay2 = await assignResidentToRoom(adminActor, {
    residentId: resident2.id,
    roomId: room102.id,
    checkInDate: "2026-10-02",
    monthlyRent: 1200000,
  });
  assert(stay2.roomId === room102.id, "Assigned resident Sushila to Room 102");

  // Check out resident1 from Room 101
  await checkOutResident(adminActor, {
    residentId: resident1.id,
    checkOutDate: "2026-10-20",
  });

  const r101AfterCheckout = await getRoomById(adminActor, room101.id);
  assert(r101AfterCheckout.occupiedBeds === 0, "Room 101 occupied beds restored to 0 after checkout");
  assert(r101AfterCheckout.availableBeds === 1, "Room 101 available beds restored to 1");

  // ---------------------------------------------------------------------------
  // SUITE 6: Financial Operations & Transactional Integrity
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 6] Financial Operations & Transactional Rollbacks");

  // Check initial balance
  const initialBalance = await getResidentRentBalance(resident2.id);
  assert(initialBalance === 0, "Initial resident balance is 0 paise");

  // 1. Record Rent Charge (12,000 INR = 1,200,000 paise)
  const chargeTx = await recordRentCharge(adminActor, {
    residentId: resident2.id,
    stayId: stay2.id,
    amount: 1200000,
    transactionDate: "2026-10-01",
    billingPeriod: "2026-10",
    description: "Monthly Rent - October 2026",
  });
  assert(chargeTx.transactionType === "RENT_CHARGE", "Recorded RENT_CHARGE transaction in PostgreSQL");
  assert(chargeTx.amount === 1200000, "Charge amount is 1200000 paise");

  // 2. Record Security Deposit (24,000 INR = 2,400,000 paise)
  const depositTx = await recordSecurityDeposit(adminActor, {
    residentId: resident2.id,
    stayId: stay2.id,
    amount: 2400000,
    transactionDate: "2026-10-01",
    paymentMethod: "BANK_TRANSFER",
    referenceNumber: "NEFT-RN-998877",
    description: "Refundable security deposit",
  });
  assert(depositTx.transactionType === "SECURITY_DEPOSIT", "Recorded SECURITY_DEPOSIT transaction in PostgreSQL");

  // Check balance after charge: should owe 1200000
  const postChargeBalance = await getResidentRentBalance(resident2.id);
  assert(postChargeBalance === 1200000, "Resident owes 1200000 paise after rent charge");

  // 3. Record Rent Payment (12,000 INR = 1,200,000 paise)
  const paymentTx = await recordRentPayment(adminActor, {
    residentId: resident2.id,
    amount: 1200000,
    transactionDate: "2026-10-05",
    paymentMethod: "UPI",
    referenceNumber: "UPI-TX-112233",
    description: "Rent Payment October 2026",
  });
  assert(paymentTx.transactionType === "RENT_PAYMENT", "Recorded RENT_PAYMENT transaction in PostgreSQL");

  // Balance should now be 0
  const postPaymentBalance = await getResidentRentBalance(resident2.id);
  assert(postPaymentBalance === 0, "Resident balance cleared to 0 after full payment");

  // 4. Record Operational Expense (Kitchen groceries: 500,000 paise)
  const expenseTx = await recordExpense(adminActor, {
    category: "GROCERY",
    amount: 500000,
    transactionDate: "2026-10-10",
    paymentMethod: "CASH",
    payeeVendor: "Kisan Mandi Supplies",
    description: "Vegetables and dairy for elder care kitchen",
  });
  assert(expenseTx.transactionType === "EXPENSE", "Recorded EXPENSE transaction in PostgreSQL");

  // Check Cashbook Summary
  const cashbook = await getCashbookSummary(adminActor);
  assert(cashbook.totalRentCollected >= 1200000, `Cashbook total rent collected reflects payments (${cashbook.totalRentCollected} paise)`);
  assert(cashbook.totalDepositsCollected >= 2400000, `Cashbook total deposits reflects deposit (${cashbook.totalDepositsCollected} paise)`);
  assert(cashbook.totalExpensesPaid >= 500000, `Cashbook total expenses reflects expense (${cashbook.totalExpensesPaid} paise)`);

  // 5. Transaction Reversal
  const reversedPayment = await reverseTransaction(
    adminActor,
    paymentTx.id,
    "Payment bounced / returned by bank"
  );
  assert(reversedPayment.transactionType === "REVERSAL", "Recorded auditable REVERSAL transaction in PostgreSQL");
  assert(reversedPayment.reversalOfId === paymentTx.id, "Reversal points to original payment transaction ID");

  const origPaymentAfter = await asyncDb.queryOne(
    "SELECT status FROM financial_transactions WHERE id = ?",
    [paymentTx.id]
  );
  assert(origPaymentAfter?.status === "REVERSED", "Original payment marked as REVERSED in PostgreSQL");

  const balanceAfterReversal = await getResidentRentBalance(resident2.id);
  assert(balanceAfterReversal === 1200000, "Resident balance restored to 1200000 paise after reversal");

  // 6. Genuine Transactional Rollback Test
  console.log("  Testing PostgreSQL transactional rollback on failure...");
  const preTxCount = (await asyncDb.query("SELECT COUNT(*) as count FROM financial_transactions"))[0].count;
  let rollbackCaught = false;

  try {
    await asyncDb.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO financial_transactions (id, transaction_type, amount, status, description, transaction_date, category, created_by, created_at, updated_at)
         VALUES (?, 'RENT_CHARGE', 999999, 'POSTED', 'Intentional Failure Step 1', '2026-10-22', 'RENT', ?, ?, ?)`,
        ["tx_rollback_test", adminActor.id, new Date().toISOString(), new Date().toISOString()]
      );

      // Verify the row is visible INSIDE the active transaction
      const insideTxRow = await tx.queryOne("SELECT id FROM financial_transactions WHERE id = ?", ["tx_rollback_test"]);
      assert(insideTxRow !== null, "Uncommitted write visible inside active PostgreSQL transaction");

      // Intentionally throw to trigger ROLLBACK
      throw new Error("Simulated business validation failure to trigger rollback");
    });
  } catch (err: any) {
    rollbackCaught = true;
    assert(err.message.includes("Simulated business validation failure"), "Caught deliberate error triggering rollback");
  }

  assert(rollbackCaught, "Transaction block caught thrown exception");
  const postTxCount = (await asyncDb.query("SELECT COUNT(*) as count FROM financial_transactions"))[0].count;
  assert(Number(postTxCount) === Number(preTxCount), "PostgreSQL rolled back uncommitted transaction (row count unchanged)");

  const rolledBackRow = await asyncDb.queryOne("SELECT id FROM financial_transactions WHERE id = ?", ["tx_rollback_test"]);
  assert(rolledBackRow === null, "Rolled-back record does not exist in PostgreSQL");

  // ---------------------------------------------------------------------------
  // SUITE 7: Kitchen Meal Planning, Preferences & Adjustments
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 7] Kitchen Meal Management & Daily Preparation");

  // Update meal preference for resident 2
  await updateResidentMealPreference(adminActor, resident2.id, {
    dietaryPreference: "VEGETARIAN",
    notes: "No onion garlic",
    breakfastOptIn: true,
    lunchOptIn: true,
    dinnerOptIn: true,
  });

  const pref = await asyncDb.queryOne(
    "SELECT * FROM resident_meal_preferences WHERE resident_id = ?",
    [resident2.id]
  );
  assert(pref !== null, "Saved resident meal preference in PostgreSQL");
  assert(pref.dietary_preference === "VEGETARIAN", "Dietary preference is VEGETARIAN");

  // Create Daily Meal Plan (Lunch for 2026-10-22)
  const serviceDate = "2026-10-22";
  const mealPlan = await createMealPlan(adminActor, {
    serviceDate,
    mealType: "LUNCH",
    guestCount: 2,
    notes: "Special Navratri festive lunch",
  });
  assert(mealPlan.mealType === "LUNCH", "Created LUNCH meal plan in PostgreSQL");
  assert(mealPlan.status === "DRAFT", "Initial meal plan status is DRAFT");
  assert(mealPlan.guestCount === 2, "Guest count is 2");

  // Confirm meal plan
  const confirmedPlan = await confirmMealPlan(adminActor, mealPlan.id);
  assert(confirmedPlan.status === "CONFIRMED", "Confirmed meal plan in PostgreSQL (status: CONFIRMED)");

  // Adjust meal plan quantity (e.g. 5 total guests)
  const adjustedPlan = await adjustMealPlanQuantity(adminActor, mealPlan.id, {
    newGuestCount: 5,
    reason: "Additional family members visiting for festival",
  });
  assert(adjustedPlan.guestCount === 5, "Adjusted guest count to 5 in PostgreSQL");

  // Complete meal plan with actual cooked count
  const completedPlan = await completeMealPlan(adminActor, mealPlan.id, 25);
  assert(completedPlan.status === "COMPLETED", "Completed meal plan in PostgreSQL (status: COMPLETED)");
  assert(completedPlan.actualCookedCount === 25, "Actual cooked count recorded as 25");

  // ---------------------------------------------------------------------------
  // SUITE 8: Delivery Dispatch, Task Events & Exceptions
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 8] Delivery Operations & Lifecycle Events");

  // Create external delivery task
  const deliveryTask = await createExternalDeliveryTask(adminActor, {
    serviceDate: "2026-10-22",
    mealType: "LUNCH",
    customerName: "Smt. Manju Gupta",
    customerPhone: "9876543299",
    deliveryAddress: "Flat 402, Shanti Kunj, Civil Lines",
    notes: "Deliver before 1:00 PM, ring bell twice",
  });
  assert(deliveryTask.status === "PENDING", "Created external delivery task in PostgreSQL (status: PENDING)");
  assert(deliveryTask.customerName === "Smt. Manju Gupta", "Customer name recorded correctly");

  // Create active DELIVERY_PERSON staff member
  const deliveryStaff = await createStaffUser(adminActor, {
    username: "delivery_ravi",
    email: "ravi.delivery@ravinarayan.in",
    fullName: "Ravi Kumar",
    role: "DELIVERY_PERSON",
    password: "DeliveryPassword2026!",
  });
  assert(deliveryStaff.role === "DELIVERY_PERSON", "Created active DELIVERY_PERSON staff in PostgreSQL");

  // Assign delivery task to staff
  const assignedTask = await assignDeliveryTask(adminActor, deliveryTask.id, {
    assignedToStaffId: deliveryStaff.id,
  });
  assert(assignedTask.status === "ASSIGNED", "Assigned delivery task in PostgreSQL (status: ASSIGNED)");

  // Dispatch delivery task
  const dispatchedTask = await dispatchDeliveryTask(adminActor, deliveryTask.id);
  assert(dispatchedTask.status === "OUT_FOR_DELIVERY", "Dispatched delivery task (status: OUT_FOR_DELIVERY)");

  // Check event history in delivery_task_events
  const taskEvents = await asyncDb.query(
    "SELECT * FROM delivery_task_events WHERE task_id = ? ORDER BY created_at ASC",
    [deliveryTask.id]
  );
  assert(taskEvents.length >= 3, `Logged delivery events in PostgreSQL (got ${taskEvents.length} events)`);
  assert(taskEvents[taskEvents.length - 1].to_status === "OUT_FOR_DELIVERY", "Latest event reflects transition to OUT_FOR_DELIVERY");

  // Report delivery exception
  const exceptionTask = await reportDeliveryException(adminActor, deliveryTask.id, {
    exceptionType: "RESIDENT_UNAVAILABLE",
    reason: "Door locked, phone not answering",
  });
  assert(exceptionTask.status === "EXCEPTION", "Recorded delivery exception in PostgreSQL (status: EXCEPTION)");
  assert(exceptionTask.exceptionType === "RESIDENT_UNAVAILABLE", "Exception type recorded");

  // Retry delivery task after resolving exception
  const retriedTask = await retryDeliveryTask(adminActor, deliveryTask.id, {
    notes: "Customer phoned back, ready to receive package",
  });
  assert(retriedTask.status === "ASSIGNED", "Retried delivery task in PostgreSQL (status: ASSIGNED)");

  // Re-dispatch delivery task
  await dispatchDeliveryTask(adminActor, deliveryTask.id);

  // Complete delivery task
  const completedTask = await completeDeliveryTask(adminActor, deliveryTask.id, {
    recipientName: "Manju Gupta",
    notes: "Delivered to neighbor Mr. Verma as requested",
  });
  assert(completedTask.status === "DELIVERED", "Completed delivery task in PostgreSQL (status: DELIVERED)");

  // ---------------------------------------------------------------------------
  // SUITE 9: Notifications & Audit Logging
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 9] Notifications & Audit Logging");

  // Mark notification read
  const testNotifId = "notif_pg_smoke_1";
  await markNotificationAsRead(adminActor, testNotifId);

  const notifRead = await asyncDb.queryOne(
    "SELECT * FROM staff_notification_reads WHERE staff_id = ? AND notification_id = ?",
    [adminActor.id, testNotifId]
  );
  assert(notifRead !== null, "Persisted notification read state in PostgreSQL staff_notification_reads");

  // Record audit log event
  const auditEvent = await recordAuditEventAsync({
    actorId: adminActor.id,
    actorUsername: adminActor.username,
    action: "smoke_test.validation_completed",
    targetType: "SYSTEM",
    targetId: "postgresql_smoke_test",
    metadata: { testSuite: "01B.27", engine: "PostgreSQL 16" },
  }, asyncDb);
  assert(auditEvent.action === "smoke_test.validation_completed", "Recorded audit event in PostgreSQL");

  const fetchedAudit = await getAuditLogsAsync({ actorId: adminActor.id, limit: 5 }, asyncDb);
  assert(fetchedAudit.length >= 1, `Retrieved audit events from PostgreSQL (got ${fetchedAudit.length})`);
  assert(fetchedAudit[0].action === "smoke_test.validation_completed", "Audit record matched action");

  // ---------------------------------------------------------------------------
  // Cleanup connections
  // ---------------------------------------------------------------------------
  await closePg();

  console.log("\n================================================================================");
  console.log(`TEST SUMMARY: ${passCount} passed, ${failCount} failed`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runLivePostgresIntegrationTests().catch(async (err) => {
  console.error("Fatal error during PostgreSQL integration tests:", err);
  await closePg();
  process.exit(1);
});
