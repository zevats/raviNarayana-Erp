import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "../apps/erp/src/server/database/migrations";
import { closeDb } from "../apps/erp/src/server/database/db";
import { hasPermission } from "../apps/erp/src/server/authorization/permissions";
import {
  requirePermission,
  AuthorizationError,
} from "../apps/erp/src/server/authorization/authorize";
import {
  getEligibleResidentsForDate,
  createMealPlan,
  updateMealPlan,
  confirmMealPlan,
  completeMealPlan,
  adjustMealPlanQuantity,
  getMealPlanById,
  listMealPlans,
  getPreparationSheetData,
  getKitchenDashboardSummary,
  updateResidentMealPreference,
} from "../apps/erp/src/server/kitchen/kitchenService";
import { getAuditLogs } from "../apps/erp/src/server/audit/audit";
import { AuthenticatedUser } from "../apps/erp/src/types";

// Isolated test database path
const TEST_KITCHEN_DB_PATH = path.resolve(__dirname, "test_kitchen.db");

function cleanupTestDb() {
  if (fs.existsSync(TEST_KITCHEN_DB_PATH)) fs.unlinkSync(TEST_KITCHEN_DB_PATH);
  const wal = `${TEST_KITCHEN_DB_PATH}-wal`;
  const shm = `${TEST_KITCHEN_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_KITCHEN_DB_PATH;

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
console.log("RAVINARAYAN ERP — PHASE 5 CORE: DAILY TIFFIN & KITCHEN OPERATIONS TEST SUITE");
console.log("================================================================================\n");

async function runKitchenTests() {
  // Test actors
  const superAdminUser: AuthenticatedUser = {
    id: "usr_super_admin_kt",
    username: "admin",
    email: "admin@ravinarayan.in",
    fullName: "Ravinarayan Super Admin",
    role: "SUPER_ADMIN",
  };

  const opsManagerUser: AuthenticatedUser = {
    id: "usr_ops_manager_kt",
    username: "opsmanager",
    email: "ops@ravinarayan.in",
    fullName: "Operations Lead",
    role: "OPERATIONS_MANAGER",
  };

  const kitchenUser: AuthenticatedUser = {
    id: "usr_kitchen_kt",
    username: "kitchenhead",
    email: "kitchen@ravinarayan.in",
    fullName: "Head Chef Met City",
    role: "KITCHEN_OPERATIONS",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_accountant_kt",
    username: "accountant",
    email: "accountant@ravinarayan.in",
    fullName: "Staff Accountant",
    role: "ACCOUNTANT",
  };

  const deliveryUser: AuthenticatedUser = {
    id: "usr_delivery_kt",
    username: "deliveryperson",
    email: "delivery@ravinarayan.in",
    fullName: "Delivery Staff",
    role: "DELIVERY_PERSON",
  };

  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Database Migration V4 -> V5 & Schema Invariants
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Database Migration V4 -> V5 & Schema Verification");

  const db = new Database(TEST_KITCHEN_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Simulate existing V4 schema
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

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_username TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      room_number TEXT UNIQUE NOT NULL,
      floor INTEGER NOT NULL,
      room_type TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      monthly_rent INTEGER NOT NULL CHECK (monthly_rent >= 0),
      security_deposit INTEGER NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE residents (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      emergency_contact TEXT,
      id_proof_type TEXT,
      id_proof_number TEXT,
      employer_institute TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE resident_stays (
      id TEXT PRIMARY KEY,
      resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
      check_in_date TEXT NOT NULL,
      check_out_date TEXT,
      monthly_rent INTEGER NOT NULL CHECK (monthly_rent >= 0),
      security_deposit INTEGER NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE financial_transactions (
      id TEXT PRIMARY KEY,
      transaction_type TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount > 0),
      transaction_date TEXT NOT NULL,
      payment_method TEXT,
      reference_number TEXT,
      resident_id TEXT REFERENCES residents(id) ON DELETE RESTRICT,
      stay_id TEXT REFERENCES resident_stays(id) ON DELETE RESTRICT,
      category TEXT NOT NULL,
      description TEXT,
      billing_period TEXT,
      payee_vendor TEXT,
      idempotency_key TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'POSTED',
      reversal_of_id TEXT,
      created_by TEXT NOT NULL REFERENCES staff_users(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.pragma("user_version = 4");

  // Populate test staff users
  const now = new Date().toISOString();
  const insertStaff = db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  insertStaff.run(superAdminUser.id, superAdminUser.username, superAdminUser.email, superAdminUser.fullName, "hash", superAdminUser.role, now, now);
  insertStaff.run(opsManagerUser.id, opsManagerUser.username, opsManagerUser.email, opsManagerUser.fullName, "hash", opsManagerUser.role, now, now);
  insertStaff.run(kitchenUser.id, kitchenUser.username, kitchenUser.email, kitchenUser.fullName, "hash", kitchenUser.role, now, now);
  insertStaff.run(accountantUser.id, accountantUser.username, accountantUser.email, accountantUser.fullName, "hash", accountantUser.role, now, now);
  insertStaff.run(deliveryUser.id, deliveryUser.username, deliveryUser.email, deliveryUser.fullName, "hash", deliveryUser.role, now, now);

  // Populate test rooms
  db.prepare(`
    INSERT INTO rooms (id, room_number, floor, room_type, capacity, monthly_rent, security_deposit, status, is_active, created_at, updated_at)
    VALUES 
      ('rm_101', '101', 1, 'SINGLE', 1, 12000, 10000, 'OCCUPIED', 1, ?, ?),
      ('rm_102', '102', 1, 'SINGLE', 1, 12000, 10000, 'OCCUPIED', 1, ?, ?),
      ('rm_103', '103', 1, 'SINGLE', 1, 12000, 10000, 'AVAILABLE', 1, ?, ?),
      ('rm_104', '104', 1, 'SINGLE', 1, 12000, 10000, 'AVAILABLE', 1, ?, ?)
  `).run(now, now, now, now, now, now, now, now);

  // Populate test residents:
  // 1. Aarav: Checked in 2026-10-01 (ACTIVE)
  // 2. Priya: Checked in 2026-10-05 (ACTIVE)
  // 3. Rohan: Checked in 2026-10-08, Checked out 2026-10-12 (COMPLETED)
  // 4. Sneha: Check-in 2026-10-20 (ACTIVE future check-in)
  db.prepare(`
    INSERT INTO residents (id, full_name, phone, email, emergency_contact, status, created_at, updated_at)
    VALUES 
      ('res_aarav', 'Aarav Sharma', '9876543210', 'aarav@example.com', '9876500001', 'ACTIVE', ?, ?),
      ('res_priya', 'Priya Patel', '9876543211', 'priya@example.com', '9876500002', 'ACTIVE', ?, ?),
      ('res_rohan', 'Rohan Verma', '9876543212', 'rohan@example.com', '9876500003', 'CHECKED_OUT', ?, ?),
      ('res_sneha', 'Sneha Reddy', '9876543213', 'sneha@example.com', '9876500004', 'ACTIVE', ?, ?)
  `).run(now, now, now, now, now, now, now, now);

  db.prepare(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, check_out_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES 
      ('stay_aarav', 'res_aarav', 'rm_101', '2026-10-01', NULL, 12000, 10000, 'ACTIVE', ?, ?),
      ('stay_priya', 'res_priya', 'rm_102', '2026-10-05', NULL, 12000, 10000, 'ACTIVE', ?, ?),
      ('stay_rohan', 'res_rohan', 'rm_103', '2026-10-08', '2026-10-12', 12000, 10000, 'COMPLETED', ?, ?),
      ('stay_sneha', 'res_sneha', 'rm_104', '2026-10-20', NULL, 12000, 10000, 'ACTIVE', ?, ?)
  `).run(now, now, now, now, now, now, now, now);

  // Run migrations to advance to V5
  runMigrations(db);

  const version = db.pragma("user_version", { simple: true }) as number;
  assert(version >= 5, `Database schema version advanced to at least 5 (got ${version})`);

  // Verify created tables
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(t => t.name);
  assert(tables.includes("resident_meal_preferences"), "resident_meal_preferences table created");
  assert(tables.includes("daily_meal_plans"), "daily_meal_plans table created");
  assert(tables.includes("resident_meal_records"), "resident_meal_records table created");
  assert(tables.includes("meal_plan_adjustments"), "meal_plan_adjustments table created");

  // Verify daily_meal_plans columns
  const planCols = (db.prepare("PRAGMA table_info(daily_meal_plans)").all() as any[]).map(c => c.name);
  const requiredPlanCols = [
    "id", "service_date", "meal_type", "planned_resident_count", "guest_count",
    "final_preparation_count", "status", "notes", "created_by", "confirmed_by",
    "confirmed_at", "completed_by", "completed_at", "created_at", "updated_at"
  ];
  assert(requiredPlanCols.every(c => planCols.includes(c)), "All required daily_meal_plans columns present");

  // Verify unique indexes
  const planIndexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='daily_meal_plans'").all() as any[]).map(i => i.name);
  assert(planIndexes.includes("idx_meal_plans_date_meal"), "idx_meal_plans_date_meal index verified");

  db.close();

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Active Stay Meal Eligibility Calculation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Resident Stay Meal Eligibility Calculation");

  // Test 1: Service date 2026-10-10 (during Rohan's stay, before Sneha's check-in)
  // Eligible: Aarav, Priya, Rohan (3 total)
  const eligOct10 = getEligibleResidentsForDate(kitchenUser, "2026-10-10");
  const namesOct10 = eligOct10.map(r => r.fullName);
  assert(eligOct10.length === 3, `Service date 2026-10-10 has exactly 3 eligible residents (got ${eligOct10.length})`);
  assert(namesOct10.includes("Aarav Sharma"), "Aarav Sharma is eligible on 2026-10-10");
  assert(namesOct10.includes("Priya Patel"), "Priya Patel is eligible on 2026-10-10");
  assert(namesOct10.includes("Rohan Verma"), "Rohan Verma is eligible during his active stay (2026-10-10)");
  assert(!namesOct10.includes("Sneha Reddy"), "Sneha Reddy is NOT eligible on 2026-10-10 (future check-in)");

  // Test 2: Service date 2026-10-15 (after Rohan checked out on 2026-10-12)
  // Eligible: Aarav, Priya (2 total)
  const eligOct15 = getEligibleResidentsForDate(kitchenUser, "2026-10-15");
  const namesOct15 = eligOct15.map(r => r.fullName);
  assert(eligOct15.length === 2, `Service date 2026-10-15 has exactly 2 eligible residents (got ${eligOct15.length})`);
  assert(namesOct15.includes("Aarav Sharma"), "Aarav Sharma is eligible on 2026-10-15");
  assert(namesOct15.includes("Priya Patel"), "Priya Patel is eligible on 2026-10-15");
  assert(!namesOct15.includes("Rohan Verma"), "Checked-out resident (Rohan) is strictly excluded from future date (2026-10-15)");

  // Test 3: Service date 2026-10-25 (after Sneha checked in)
  // Eligible: Aarav, Priya, Sneha (3 total)
  const eligOct25 = getEligibleResidentsForDate(kitchenUser, "2026-10-25");
  const namesOct25 = eligOct25.map(r => r.fullName);
  assert(eligOct25.length === 3, `Service date 2026-10-25 includes newly checked-in resident Sneha (got ${eligOct25.length})`);
  assert(namesOct25.includes("Sneha Reddy"), "Sneha Reddy is eligible on 2026-10-25");

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Meal Plan Creation, Formula Invariants & Attendance Records
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Meal Plan Creation, Formula Invariants & Attendance Records");

  // Create Breakfast Plan for 2026-10-15 with 2 guest meals
  const bPlan = createMealPlan(kitchenUser, {
    serviceDate: "2026-10-15",
    mealType: "BREAKFAST",
    guestCount: 2,
    notes: "Poha, boiled eggs, and masala tea",
    status: "DRAFT",
  });

  assert(bPlan.id.startsWith("dmp_"), "Meal plan created with prefixed id");
  assert(bPlan.serviceDate === "2026-10-15", "Service date matches 2026-10-15");
  assert(bPlan.mealType === "BREAKFAST", "Meal type is BREAKFAST");
  assert(bPlan.status === "DRAFT", "Initial status defaults to DRAFT");
  assert(bPlan.plannedResidentCount === 2, `Planned resident count is 2 (got ${bPlan.plannedResidentCount})`);
  assert(bPlan.guestCount === 2, `Guest count is 2 (got ${bPlan.guestCount})`);
  assert(bPlan.finalPreparationCount === 4, `Final Preparation Count equals 4 (2 residents + 2 guests, got ${bPlan.finalPreparationCount})`);

  // Verify individual resident attendance records were generated
  const planDetail = getMealPlanById(kitchenUser, bPlan.id)!;
  assert(planDetail.residentRecords.length === 2, `Attendance records generated for all 2 eligible residents (got ${planDetail.residentRecords.length})`);
  assert(planDetail.residentRecords.every(r => r.status === "CONFIRMED"), "Eligible residents initially confirmed for meal");
  assert(planDetail.residentRecords.some(r => r.residentName === "Aarav Sharma" && r.roomNumber === "101"), "Aarav Sharma linked to Room 101");
  assert(planDetail.residentRecords.some(r => r.residentName === "Priya Patel" && r.roomNumber === "102"), "Priya Patel linked to Room 102");

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: Opt-Outs, Preferences & Recalculation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Opt-Outs, Preferences & Preparation Recalculation");

  // Aarav opts out of breakfast on 2026-10-15
  const updatedBPlan = updateMealPlan(kitchenUser, bPlan.id, {
    guestCount: 3, // change guest count to 3
    notes: "Updated menu: Idli Sambar + Poha",
    residentOptOuts: ["res_aarav"], // Aarav opts out
  });

  assert(updatedBPlan.plannedResidentCount === 1, `Resident count reduced to 1 after opt-out (got ${updatedBPlan.plannedResidentCount})`);
  assert(updatedBPlan.guestCount === 3, `Guest count updated to 3 (got ${updatedBPlan.guestCount})`);
  assert(updatedBPlan.finalPreparationCount === 4, `Final Preparation Count recalculated to 4 (1 resident + 3 guests, got ${updatedBPlan.finalPreparationCount})`);

  const updatedDetail = getMealPlanById(kitchenUser, bPlan.id)!;
  const aaravRecord = updatedDetail.residentRecords.find(r => r.residentId === "res_aarav")!;
  const priyaRecord = updatedDetail.residentRecords.find(r => r.residentId === "res_priya")!;
  assert(aaravRecord.status === "OPTED_OUT", "Aarav's status marked OPTED_OUT");
  assert(priyaRecord.status === "CONFIRMED", "Priya's status remains CONFIRMED");

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Plan Lifecycle: Confirmation & Completion
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Plan Lifecycle: Confirmation & Completion");

  // Confirm plan
  const confirmedPlan = confirmMealPlan(kitchenUser, bPlan.id);
  assert(confirmedPlan.status === "CONFIRMED", "Plan transitioned to CONFIRMED status");
  assert(confirmedPlan.confirmedBy === kitchenUser.id, "Plan stamped with confirmer ID");
  assert(confirmedPlan.confirmedAt !== null, "Plan stamped with confirmation timestamp");

  // Complete plan
  const completedPlan = completeMealPlan(kitchenUser, bPlan.id);
  assert(completedPlan.status === "COMPLETED", "Plan transitioned to COMPLETED status");
  assert(completedPlan.completedBy === kitchenUser.id, "Plan stamped with completer ID");
  assert(completedPlan.completedAt !== null, "Plan stamped with completion timestamp");

  // Completed plan guardrail: direct edit must fail
  let directEditBlocked = false;
  try {
    updateMealPlan(kitchenUser, bPlan.id, { notes: "Attempted unlogged edit" });
  } catch (err: any) {
    directEditBlocked = err.message.includes("Completed meal plans cannot be directly edited");
  }
  assert(directEditBlocked, "Direct editing of completed meal plans is strictly blocked");

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Duplicate Prevention & Unique Constraints
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Duplicate Prevention & Engine-Level Unique Constraints");

  // Attempt duplicate plan creation for BREAKFAST on 2026-10-15
  let duplicatePlanBlocked = false;
  try {
    createMealPlan(kitchenUser, {
      serviceDate: "2026-10-15",
      mealType: "BREAKFAST",
      guestCount: 0,
    });
  } catch (err: any) {
    duplicatePlanBlocked = err.message.includes("already exists");
  }
  assert(duplicatePlanBlocked, "Engine Guard: Duplicate meal plan for same date and meal type is prevented");

  // Different meal type on same date is allowed (e.g. LUNCH on 2026-10-15)
  const lunchPlan = createMealPlan(kitchenUser, {
    serviceDate: "2026-10-15",
    mealType: "LUNCH",
    guestCount: 1,
    notes: "Rajma Chawal, Roti, Salad",
    status: "CONFIRMED",
  });
  assert(lunchPlan.mealType === "LUNCH", "Distinct meal type (LUNCH) allowed on same service date");

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: Justified Quantity Adjustments & Audit Trail
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Justified Quantity Adjustments & Audit Trail");

  // Short/Empty reason rejected
  let shortReasonBlocked = false;
  try {
    adjustMealPlanQuantity(kitchenUser, bPlan.id, {
      newGuestCount: 5,
      reason: "bad", // < 5 chars
    });
  } catch (err: any) {
    shortReasonBlocked = err.message.includes("at least 5 characters");
  }
  assert(shortReasonBlocked, "Validation rejects adjustment reason with fewer than 5 characters");

  // Record justified adjustment
  const adjustedPlan = adjustMealPlanQuantity(kitchenUser, bPlan.id, {
    newResidentCount: 2,
    newGuestCount: 4,
    reason: "2 late arrivals from site shift plus 1 visitor extra tiffin pack requested",
  });

  assert(adjustedPlan.plannedResidentCount === 2, "Adjusted resident count is 2");
  assert(adjustedPlan.guestCount === 4, "Adjusted guest count is 4");
  assert(adjustedPlan.finalPreparationCount === 6, `Final preparation count updated to 6 (got ${adjustedPlan.finalPreparationCount})`);

  // Verify adjustment recorded in meal_plan_adjustments table
  const finalDetail = getMealPlanById(kitchenUser, bPlan.id)!;
  assert(finalDetail.adjustments.length === 1, "Adjustment record created in meal_plan_adjustments table");
  assert(finalDetail.adjustments[0].previousTotal === 4, "Previous total accurately recorded as 4");
  assert(finalDetail.adjustments[0].newTotal === 6, "New total accurately recorded as 6");
  assert(finalDetail.adjustments[0].createdBy === kitchenUser.id, "Adjustment attributed to kitchen actor");

  // -----------------------------------------------------------------------------
  // TEST SUITE 8: Historical Records Preserved After Resident Check-out
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] Historical Records Preserved After Resident Check-out");

  // Simulate Priya checking out on 2026-10-16
  const modDb = new Database(TEST_KITCHEN_DB_PATH);
  modDb.prepare(`
    UPDATE resident_stays
    SET status = 'COMPLETED', check_out_date = '2026-10-16'
    WHERE id = 'stay_priya'
  `).run();
  modDb.prepare(`
    UPDATE residents
    SET status = 'CHECKED_OUT'
    WHERE id = 'res_priya'
  `).run();
  modDb.close();

  // 1. Priya's historical attendance on 2026-10-15 must remain intact
  const pastPlanDetail = getMealPlanById(kitchenUser, bPlan.id)!;
  const priyaPastRecord = pastPlanDetail.residentRecords.find(r => r.residentId === "res_priya");
  assert(priyaPastRecord !== undefined, "Priya's historical meal record on 2026-10-15 is PRESERVED after checkout");
  assert(priyaPastRecord?.status === "CONFIRMED", "Priya's past attendance status remains CONFIRMED");

  // 2. Priya must NOT appear as eligible on 2026-10-17 (future relative to checkout 2026-10-16)
  const eligPostCheckout = getEligibleResidentsForDate(kitchenUser, "2026-10-17");
  const namesPostCheckout = eligPostCheckout.map(r => r.fullName);
  assert(!namesPostCheckout.includes("Priya Patel"), "Checked-out resident (Priya) is excluded from eligibility on 2026-10-17");

  // -----------------------------------------------------------------------------
  // TEST SUITE 9: Preparation Sheet & Dashboard Summary
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 9] Preparation Sheet & Dashboard Summary");

  // Prep sheet data check
  const prepSheet = getPreparationSheetData(kitchenUser, bPlan.id)!;
  assert(prepSheet !== null, "Preparation sheet retrieved successfully");
  assert(prepSheet.summary.mealType === "BREAKFAST", "Prep sheet meal type is BREAKFAST");
  assert(prepSheet.summary.finalPreparationCount === 6, "Prep sheet preparation count is 6");
  assert(prepSheet.residentRecords.length === 2, "Prep sheet includes all resident records");
  assert(prepSheet.adjustments.length === 1, "Prep sheet includes adjustments list");

  // Dashboard summary check for 2026-10-15
  const dashboardData = getKitchenDashboardSummary(kitchenUser, "2026-10-15");
  assert(dashboardData.plans.breakfast !== null, "Dashboard contains breakfast plan");
  assert(dashboardData.plans.lunch !== null, "Dashboard contains lunch plan");
  assert(dashboardData.plans.dinner === null, "Dashboard shows dinner unplanned");
  assert(dashboardData.metrics.breakfastCount === 6, "Dashboard breakfast count matches 6");
  assert(dashboardData.metrics.totalMealsPreparedToday > 0, "Dashboard computes total meals prepared");

  // -----------------------------------------------------------------------------
  // TEST SUITE 10: Server-Side RBAC Enforcement on Kitchen Services
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 10] Server-Side RBAC Enforcement on Kitchen Services");

  // 1. Unauthenticated throws 401
  let unauthCaught = false;
  try {
    listMealPlans(null as any);
  } catch (err: any) {
    unauthCaught = err instanceof AuthorizationError && err.statusCode === 401;
  }
  assert(unauthCaught, "Unauthenticated listMealPlans throws HTTP 401 AuthorizationError");

  // 2. Role permission checks
  assert(hasPermission(superAdminUser.role, "kitchen.manage"), "SUPER_ADMIN has kitchen.manage");
  assert(hasPermission(superAdminUser.role, "kitchen.read"), "SUPER_ADMIN has kitchen.read");
  assert(hasPermission(opsManagerUser.role, "kitchen.manage"), "OPERATIONS_MANAGER has kitchen.manage");
  assert(hasPermission(opsManagerUser.role, "kitchen.read"), "OPERATIONS_MANAGER has kitchen.read");
  assert(hasPermission(kitchenUser.role, "kitchen.manage"), "KITCHEN_OPERATIONS has kitchen.manage");
  assert(hasPermission(kitchenUser.role, "kitchen.read"), "KITCHEN_OPERATIONS has kitchen.read");
  assert(!hasPermission(accountantUser.role, "kitchen.read"), "Least Privilege: ACCOUNTANT lacks kitchen.read");
  assert(!hasPermission(deliveryUser.role, "kitchen.read"), "Least Privilege: DELIVERY_PERSON lacks kitchen.read");

  // 3. ACCOUNTANT blocked from kitchen (HTTP 403)
  let accountantBlockedOnList = false;
  try {
    listMealPlans(accountantUser);
  } catch (err: any) {
    accountantBlockedOnList = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(accountantBlockedOnList, "Privilege Guard: ACCOUNTANT blocked from listMealPlans with HTTP 403");

  let accountantBlockedOnCreate = false;
  try {
    createMealPlan(accountantUser, {
      serviceDate: "2026-10-15",
      mealType: "DINNER",
      guestCount: 0,
    });
  } catch (err: any) {
    accountantBlockedOnCreate = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(accountantBlockedOnCreate, "Privilege Guard: ACCOUNTANT blocked from createMealPlan with HTTP 403");

  // 4. DELIVERY_PERSON blocked from kitchen (HTTP 403)
  let deliveryBlockedOnRead = false;
  try {
    getKitchenDashboardSummary(deliveryUser, "2026-10-15");
  } catch (err: any) {
    deliveryBlockedOnRead = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(deliveryBlockedOnRead, "Privilege Guard: DELIVERY_PERSON blocked from getKitchenDashboardSummary with HTTP 403");

  // -----------------------------------------------------------------------------
  // TEST SUITE 11: Immutable Audit Trail Verification
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 11] Immutable Audit Trail Verification");

  const auditEvents = getAuditLogs({ limit: 50 });
  const actionList = auditEvents.map(a => a.action);

  assert(actionList.includes("kitchen.plan_created"), "Audit trail captured kitchen.plan_created");
  assert(actionList.includes("kitchen.plan_confirmed"), "Audit trail captured kitchen.plan_confirmed");
  assert(actionList.includes("kitchen.plan_completed"), "Audit trail captured kitchen.plan_completed");
  assert(actionList.includes("kitchen.quantity_adjusted"), "Audit trail captured kitchen.quantity_adjusted");

  // Verify secret redaction
  let sensitiveFieldFound = false;
  for (const log of auditEvents) {
    if (log.metadata) {
      const json = JSON.stringify(log.metadata);
      if (
        json.includes("password") ||
        json.includes("secret") ||
        json.includes("token") ||
        json.includes("salt") ||
        json.includes("hash")
      ) {
        sensitiveFieldFound = true;
        break;
      }
    }
  }
  assert(!sensitiveFieldFound, "All kitchen audit event metadata verified free of secrets and tokens");

  // Clean up
  closeDb();
  cleanupTestDb();

  console.log("\n================================================================================");
  console.log(`FINAL KITCHEN TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runKitchenTests().catch((err) => {
  console.error("FATAL ERROR IN KITCHEN TEST SUITE:", err);
  process.exit(1);
});
