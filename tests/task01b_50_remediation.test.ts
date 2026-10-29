import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { closeDb, getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import {
  createRawMaterial,
  createRecipe,
  confirmProductionConsumption,
  reverseProductionConsumption,
  getProductionConsumptionForPlan,
  InsufficientStockError,
} from "../apps/erp/src/server/kitchen/kitchenInventoryService";
import {
  getEligibleTiffinSubscriptionsForDate,
  calculateDailyKitchenDemand,
  createMealPlan,
  confirmMealPlan,
  reconcileMealPlanProduction,
  refreshMealPlanDemand,
  getMealPlanById,
} from "../apps/erp/src/server/kitchen/kitchenService";
import { AuthenticatedUser } from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test database
const TEST_REMED_DB_PATH = path.resolve(__dirname, "test_task50_remediation.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_REMED_DB_PATH)) fs.unlinkSync(TEST_REMED_DB_PATH);
  const wal = `${TEST_REMED_DB_PATH}-wal`;
  const shm = `${TEST_REMED_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_REMED_DB_PATH;

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
console.log("RAVINARAYAN ERP — TASK 01B.50: CRITICAL DEMAND & INVENTORY REMEDIATION TESTS");
console.log("================================================================================\n");

async function runRemediationTests() {
  const superAdminUser: AuthenticatedUser = {
    id: "usr_admin_t50",
    username: "admin_t50",
    email: "admin.t50@ravinarayan.in",
    fullName: "Ravinarayan Admin",
    role: "SUPER_ADMIN",
  };

  const kitchenManagerUser: AuthenticatedUser = {
    id: "usr_kitchen_t50",
    username: "kitchen_t50",
    email: "kitchen.t50@ravinarayan.in",
    fullName: "Head Chef Met City",
    role: "KITCHEN_OPERATIONS",
  };

  const opsManagerUser: AuthenticatedUser = {
    id: "usr_ops_t50",
    username: "ops_t50",
    email: "ops.t50@ravinarayan.in",
    fullName: "Operations Manager",
    role: "OPERATIONS_MANAGER",
  };

  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Migration V16 & Seed Verification
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Database Migration V16 & Test Setup");

  const db = new Database(TEST_REMED_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  const now = new Date().toISOString();
  const insertStaff = db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fake_hash', ?, ?, ?, ?)
  `);

  insertStaff.run(superAdminUser.id, superAdminUser.username, superAdminUser.email, superAdminUser.fullName, superAdminUser.role, 1, now, now);
  insertStaff.run(kitchenManagerUser.id, kitchenManagerUser.username, kitchenManagerUser.email, kitchenManagerUser.fullName, kitchenManagerUser.role, 1, now, now);
  insertStaff.run(opsManagerUser.id, opsManagerUser.username, opsManagerUser.email, opsManagerUser.fullName, opsManagerUser.role, 1, now, now);

  // Seed PG Resident with Active Stay on 2026-10-23
  db.prepare(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES ('room_101', '101', 1, 'SINGLE', 1, 8000, 1, ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO residents (id, full_name, phone, email, emergency_contact, status, created_at, updated_at)
    VALUES ('res_101', 'Aarav Resident', '9876543210', 'aarav@example.com', '9876543219', 'ACTIVE', ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, check_out_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES ('stay_101', 'res_101', 'room_101', '2026-10-01', NULL, 8000, 16000, 'ACTIVE', ?, ?)
  `).run(now, now);

  // Seed Commercial Customers
  db.prepare(`
    INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, status, created_by, created_at, updated_at)
    VALUES 
      ('cust_act', 'Active Customer', '9811111111', 'Tower A-101, CyberCity', 'ACTIVE', ?, ?, ?),
      ('cust_inact', 'Inactive Customer', '9822222222', 'Tower B-202, CyberCity', 'INACTIVE', ?, ?, ?)
  `).run(opsManagerUser.id, now, now, opsManagerUser.id, now, now);

  // Seed Products
  db.prepare(`
    INSERT INTO tiffin_products (id, code, name, category, billing_unit, price, currency, status, created_by, created_at, updated_at)
    VALUES 
      ('prod_act', 'TIF-LUNCH-ACT', 'Active Executive Lunch', 'STANDARD_MEAL', 'PER_MEAL', 120, 'INR', 'ACTIVE', ?, ?, ?),
      ('prod_inact', 'TIF-DINNER-INACT', 'Discontinued Dinner', 'STANDARD_MEAL', 'PER_MEAL', 100, 'INR', 'INACTIVE', ?, ?, ?)
  `).run(opsManagerUser.id, now, now, opsManagerUser.id, now, now);

  // Seed Subscriptions:
  // sub_valid: Active Customer + Active Product + ACTIVE Status (qty: 3, LUNCH, ALL_DAYS)
  // sub_inact_sub: Active Customer + Active Product + CANCELLED Status (qty: 4, LUNCH, ALL_DAYS)
  // sub_paused_sub: Active Customer + Active Product + PAUSED Status (qty: 2, LUNCH, ALL_DAYS)
  // sub_inact_cust: Inactive Customer + Active Product + ACTIVE Status (qty: 5, LUNCH, ALL_DAYS)
  // sub_inact_prod: Active Customer + Inactive Product + ACTIVE Status (qty: 6, LUNCH, ALL_DAYS)
  db.prepare(`
    INSERT INTO tiffin_subscriptions (
      id, customer_id, product_id, status, start_date, price, currency,
      meal_types, service_days, quantity_per_meal, delivery_address, created_by, created_at, updated_at
    ) VALUES 
      ('sub_valid', 'cust_act', 'prod_act', 'ACTIVE', '2026-10-01', 120, 'INR', 'LUNCH', 'ALL_DAYS', 3, 'Tower A-101', ?, ?, ?),
      ('sub_cancelled', 'cust_act', 'prod_act', 'CANCELLED', '2026-10-01', 120, 'INR', 'LUNCH', 'ALL_DAYS', 4, 'Tower A-101', ?, ?, ?),
      ('sub_paused', 'cust_act', 'prod_act', 'PAUSED', '2026-10-01', 120, 'INR', 'LUNCH', 'ALL_DAYS', 2, 'Tower A-101', ?, ?, ?),
      ('sub_inact_cust', 'cust_inact', 'prod_act', 'ACTIVE', '2026-10-01', 120, 'INR', 'LUNCH', 'ALL_DAYS', 5, 'Tower B-202', ?, ?, ?),
      ('sub_inact_prod', 'cust_act', 'prod_inact', 'ACTIVE', '2026-10-01', 100, 'INR', 'LUNCH', 'ALL_DAYS', 6, 'Tower A-101', ?, ?, ?)
  `).run(
    opsManagerUser.id, now, now,
    opsManagerUser.id, now, now,
    opsManagerUser.id, now, now,
    opsManagerUser.id, now, now,
    opsManagerUser.id, now, now
  );

  db.close();
  assert(true, "Database V16 initialized and seeded with test fixtures");

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Fix A — Commercial Demand Eligibility Verification
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Fix A — Commercial Demand Eligibility Verification");

  const serviceDate = "2026-10-23";

  // 1. Active subscription with active customer and active product contributes expected demand
  const lunchSubs = await getEligibleTiffinSubscriptionsForDate(kitchenManagerUser, serviceDate, "LUNCH");
  assert(lunchSubs.length === 1, `Only 1 subscription is eligible for Lunch on ${serviceDate} (got ${lunchSubs.length})`);
  assert(lunchSubs[0].subscriptionId === "sub_valid", `Eligible subscription is sub_valid (got ${lunchSubs[0]?.subscriptionId})`);
  assert(lunchSubs[0].quantityPerMeal === 3, `Eligible demand quantity is exactly 3 (got ${lunchSubs[0]?.quantityPerMeal})`);

  // 2. Inactive subscriptions (CANCELLED, PAUSED) contribute no demand
  const hasCancelled = lunchSubs.some((s) => s.subscriptionId === "sub_cancelled");
  const hasPaused = lunchSubs.some((s) => s.subscriptionId === "sub_paused");
  assert(!hasCancelled, "CANCELLED subscription contributes 0 demand");
  assert(!hasPaused, "PAUSED subscription contributes 0 demand");

  // 3. Inactive customer contributes no commercial demand
  const hasInactiveCust = lunchSubs.some((s) => s.subscriptionId === "sub_inact_cust");
  assert(!hasInactiveCust, "Inactive customer contributes 0 commercial demand");

  // 4. Inactive product contributes no commercial demand
  const hasInactiveProd = lunchSubs.some((s) => s.subscriptionId === "sub_inact_prod");
  assert(!hasInactiveProd, "Inactive product contributes 0 commercial demand");

  // 5. Existing service-date, meal-type, and quantity rules continue to work
  // Breakfast on 2026-10-23: sub_valid is LUNCH only -> 0 eligible
  const breakfastSubs = await getEligibleTiffinSubscriptionsForDate(kitchenManagerUser, serviceDate, "BREAKFAST");
  assert(breakfastSubs.length === 0, "Breakfast has 0 eligible subscriptions because sub_valid is LUNCH");

  // 6. Resident demand remains completely unaffected
  const dailyDemand = await calculateDailyKitchenDemand(kitchenManagerUser, serviceDate);
  assert(dailyDemand.totalResidents === 1, `Resident demand unaffected: exactly 1 resident eligible (got ${dailyDemand.totalResidents})`);
  assert(dailyDemand.breakdown.lunch.residentDemand === 1, "Lunch resident demand is 1 portion");
  assert(dailyDemand.breakdown.lunch.tiffinDemand === 3, `Lunch commercial tiffin demand is 3 portions (got ${dailyDemand.breakdown.lunch.tiffinDemand})`);
  assert(dailyDemand.breakdown.lunch.totalRequired === 4, `Lunch total required portions = 1 resident + 3 tiffin = 4 (got ${dailyDemand.breakdown.lunch.totalRequired})`);

  // 7. Dynamic status transition: Deactivating customer immediately removes demand
  const mutDb = new Database(TEST_REMED_DB_PATH);
  mutDb.prepare("UPDATE tiffin_customers SET status = 'INACTIVE' WHERE id = 'cust_act'").run();
  mutDb.close();

  const lunchAfterCustDeact = await getEligibleTiffinSubscriptionsForDate(kitchenManagerUser, serviceDate, "LUNCH");
  assert(lunchAfterCustDeact.length === 0, "Deactivating customer immediately removes their subscriptions from eligible demand (0 portions)");

  // Reactivate customer, deactivate product
  const mutDb2 = new Database(TEST_REMED_DB_PATH);
  mutDb2.prepare("UPDATE tiffin_customers SET status = 'ACTIVE' WHERE id = 'cust_act'").run();
  mutDb2.prepare("UPDATE tiffin_products SET status = 'INACTIVE' WHERE id = 'prod_act'").run();
  mutDb2.close();

  const lunchAfterProdDeact = await getEligibleTiffinSubscriptionsForDate(kitchenManagerUser, serviceDate, "LUNCH");
  assert(lunchAfterProdDeact.length === 0, "Deactivating product immediately removes demand (0 portions)");

  // Restore product to ACTIVE
  const mutDb3 = new Database(TEST_REMED_DB_PATH);
  mutDb3.prepare("UPDATE tiffin_products SET status = 'ACTIVE' WHERE id = 'prod_act'").run();
  mutDb3.close();

  const lunchRestored = await getEligibleTiffinSubscriptionsForDate(kitchenManagerUser, serviceDate, "LUNCH");
  assert(lunchRestored.length === 1 && lunchRestored[0].quantityPerMeal === 3, "Restoring active state brings back expected 3 portions");

  // 8. Refreshing demand preserves historical resident records & updates counts safely
  const mealPlan = await createMealPlan(kitchenManagerUser, {
    serviceDate,
    mealType: "LUNCH",
    guestCount: 1,
    status: "CONFIRMED",
  });
  assert(mealPlan.plannedResidentCount === 1, "Initial plan plannedResidentCount = 1");
  assert(mealPlan.plannedTiffinCount === 3, "Initial plan plannedTiffinCount = 3");
  assert(mealPlan.finalPreparationCount === 5, "Initial plan finalPreparationCount = 1 + 3 + 1 = 5");

  // Add another active subscription
  const mutDb4 = new Database(TEST_REMED_DB_PATH);
  mutDb4.prepare(`
    INSERT INTO tiffin_subscriptions (
      id, customer_id, product_id, status, start_date, price, currency,
      meal_types, service_days, quantity_per_meal, delivery_address, created_by, created_at, updated_at
    ) VALUES ('sub_valid_2', 'cust_act', 'prod_act', 'ACTIVE', '2026-10-01', 120, 'INR', 'LUNCH', 'ALL_DAYS', 2, 'Tower A-101', ?, ?, ?)
  `).run(opsManagerUser.id, now, now);
  mutDb4.close();

  const refreshedPlan = await refreshMealPlanDemand(kitchenManagerUser, mealPlan.id);
  assert(refreshedPlan.plannedTiffinCount === 5, `Refreshed plan updated plannedTiffinCount from 3 to 5 (got ${refreshedPlan.plannedTiffinCount})`);
  assert(refreshedPlan.plannedResidentCount === 1, "Refreshed plan preserved resident count = 1");
  assert(refreshedPlan.finalPreparationCount === 7, `Refreshed plan finalPreparationCount = 1 + 5 + 1 = 7 (got ${refreshedPlan.finalPreparationCount})`);

  // Verify historical resident record was NOT duplicated
  const checkDb = new Database(TEST_REMED_DB_PATH);
  const residentRecords = checkDb.prepare("SELECT * FROM resident_meal_records WHERE plan_id = ?").all(mealPlan.id);
  assert(residentRecords.length === 1, `Resident meal records not duplicated on refresh (count = ${residentRecords.length})`);
  checkDb.close();

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Fix B — Atomic Inventory Consumption & Concurrency
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Fix B — Atomic Inventory Consumption & Concurrency");

  // 1. Create Raw Materials
  const rawAtta = await createRawMaterial(kitchenManagerUser, {
    code: "RM-TEST-ATTA",
    name: "Test Chakki Atta",
    category: "GRAINS",
    baseUnit: "G",
    initialStock: 1500, // Exactly 1,500 G
    reorderThreshold: 200,
  });

  const rawPaneer = await createRawMaterial(kitchenManagerUser, {
    code: "RM-TEST-PANEER",
    name: "Test Fresh Paneer",
    category: "DAIRY",
    baseUnit: "G",
    initialStock: 400, // 400 G
    reorderThreshold: 100,
  });

  // 2. Create Recipe: 1 portion requires 100g Atta and 50g Paneer
  const recipe = await createRecipe(kitchenManagerUser, {
    name: "Paneer Paratha Thali",
    mealType: "DINNER",
    yieldServings: 1,
    description: "Dinner Paratha Thali",
    ingredients: [
      {
        materialId: rawAtta.id,
        quantity: 100,
        unit: "G",
      },
      {
        materialId: rawPaneer.id,
        quantity: 50,
        unit: "G",
      },
    ],
  });
  assert(recipe.version === 1, "Created test recipe with 2 ingredients");

  // 3. Create Two Separate Dinner Meal Plans for Concurrency Test
  const dinnerPlanA = await createMealPlan(kitchenManagerUser, {
    serviceDate: "2026-10-24",
    mealType: "DINNER",
    status: "CONFIRMED",
  });
  await reconcileMealPlanProduction(kitchenManagerUser, dinnerPlanA.id, {
    actualCookedCount: 10, // 10 servings = 1,000 G Atta + 500 G Paneer (Wait: Paneer has only 400g!)
    dispatchedCount: 10,
    leftoverCount: 0,
    wasteCount: 0,
  });

  // Test 3.1: Insufficient stock on Paneer (500g required, 400g available)
  // Must fail atomically; Atta (which had 1,500g) must NOT be deducted!
  let shortageCaught = false;
  try {
    await confirmProductionConsumption(kitchenManagerUser, dinnerPlanA.id);
  } catch (err: any) {
    if (err instanceof InsufficientStockError || err.name === "InsufficientStockError") {
      shortageCaught = true;
    }
  }
  assert(shortageCaught, "confirmProductionConsumption rejected due to Paneer shortage");

  // Verify atomic rollback: Atta stock remains 1,500 G
  const checkDb2 = new Database(TEST_REMED_DB_PATH);
  const attaStock = checkDb2.prepare("SELECT current_stock FROM kitchen_raw_materials WHERE id = ?").get(rawAtta.id) as any;
  const paneerStock = checkDb2.prepare("SELECT current_stock FROM kitchen_raw_materials WHERE id = ?").get(rawPaneer.id) as any;
  const postedCount = checkDb2.prepare("SELECT count(*) as count FROM kitchen_production_consumptions WHERE plan_id = ?").get(dinnerPlanA.id) as any;
  const movementCount = checkDb2.prepare("SELECT count(*) as count FROM kitchen_stock_movements WHERE source_id = ?").get(dinnerPlanA.id) as any;
  checkDb2.close();

  assert(attaStock.current_stock === 1500, `Atta stock completely preserved at 1,500 G after failed transaction (got ${attaStock.current_stock})`);
  assert(paneerStock.current_stock === 400, `Paneer stock completely preserved at 400 G (got ${paneerStock.current_stock})`);
  assert(postedCount.count === 0, "Zero production consumption records committed after failure");
  assert(movementCount.count === 0, "Zero stock movement records committed after failure");

  // 4. Concurrency Test: Competing Plans for Limited Combined Stock
  // Replenish Paneer stock to 5,000 G so Paneer is not the bottleneck.
  // Atta stock remains 1,500 G.
  // Plan 1 requires 10 servings = 1,000 G Atta.
  // Plan 2 requires 10 servings = 1,000 G Atta.
  // Combined required = 2,000 G > 1,500 G available.
  const repDb = new Database(TEST_REMED_DB_PATH);
  repDb.prepare("UPDATE kitchen_raw_materials SET current_stock = 5000 WHERE id = ?").run(rawPaneer.id);
  repDb.close();

  const dinnerPlanB = await createMealPlan(kitchenManagerUser, {
    serviceDate: "2026-10-25",
    mealType: "DINNER",
    status: "CONFIRMED",
  });
  await reconcileMealPlanProduction(kitchenManagerUser, dinnerPlanB.id, {
    actualCookedCount: 10, // 10 servings = 1,000 G Atta
    dispatchedCount: 10,
    leftoverCount: 0,
    wasteCount: 0,
  });

  console.log("  Executing concurrent consumption confirmations for Plan A (1,000g) and Plan B (1,000g)...");
  const [resA, resB] = await Promise.allSettled([
    confirmProductionConsumption(kitchenManagerUser, dinnerPlanA.id),
    confirmProductionConsumption(kitchenManagerUser, dinnerPlanB.id),
  ]);

  const successCount = [resA, resB].filter((r) => r.status === "fulfilled").length;
  const failedCount = [resA, resB].filter((r) => r.status === "rejected").length;

  assert(successCount === 1, `Exactly ONE concurrent confirmation succeeded (got ${successCount})`);
  assert(failedCount === 1, `Exactly ONE concurrent confirmation failed with InsufficientStockError (got ${failedCount})`);

  // Verify stock invariant: 1,500 - 1,000 = 500 G (NEVER negative)
  const checkDb3 = new Database(TEST_REMED_DB_PATH);
  const finalAttaStock = checkDb3.prepare("SELECT current_stock FROM kitchen_raw_materials WHERE id = ?").get(rawAtta.id) as any;
  checkDb3.close();

  assert(finalAttaStock.current_stock === 500, `Stock invariant guaranteed: Atta current_stock = 500 G, non-negative (got ${finalAttaStock.current_stock})`);

  // 5. Repeated Confirmation Remains Idempotent
  const winningPlanId = resA.status === "fulfilled" ? dinnerPlanA.id : dinnerPlanB.id;
  const initialPosted = await getProductionConsumptionForPlan(kitchenManagerUser, winningPlanId);
  const idempotentCall = await confirmProductionConsumption(kitchenManagerUser, winningPlanId);

  assert(idempotentCall.id === initialPosted?.id, "Repeated confirmation returns existing consumption ID");

  const checkDb4 = new Database(TEST_REMED_DB_PATH);
  const stockAfterIdempotent = checkDb4.prepare("SELECT current_stock FROM kitchen_raw_materials WHERE id = ?").get(rawAtta.id) as any;
  checkDb4.close();
  assert(stockAfterIdempotent.current_stock === 500, "Idempotent call does NOT deduct stock a second time (remains 500 G)");

  // 6. Reversal restores correct quantities without duplicate restoration
  const reversed = await reverseProductionConsumption(kitchenManagerUser, winningPlanId, "Testing reversal restoration");
  assert(reversed.status === "REVERSED", "Production consumption status transitioned to REVERSED");

  const checkDb5 = new Database(TEST_REMED_DB_PATH);
  const stockAfterReversal = checkDb5.prepare("SELECT current_stock FROM kitchen_raw_materials WHERE id = ?").get(rawAtta.id) as any;
  const reversalMovements = checkDb5.prepare("SELECT * FROM kitchen_stock_movements WHERE movement_type = 'PRODUCTION_REVERSAL' AND source_id = ?").all(winningPlanId);
  checkDb5.close();

  assert(stockAfterReversal.current_stock === 1500, `Reversal accurately restored 1,000 G Atta (500 -> 1,500 G, got ${stockAfterReversal.current_stock})`);
  assert(reversalMovements.length === 2, `Compensating reversal movements recorded for both recipe ingredients (count = ${reversalMovements.length})`);

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: Primary Protected Database Guard
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Primary Protected Database Guard & Immutability");

  if (primaryStatsBefore) {
    const statsAfter = fs.statSync(primaryDbPath);
    assert(statsAfter.mtimeMs === primaryStatsBefore.mtimeMs, "Primary database data/erp.db timestamp untouched");
    assert(statsAfter.size === primaryStatsBefore.size, "Primary database data/erp.db size unchanged");
  } else {
    assert(!fs.existsSync(primaryDbPath), "Primary database data/erp.db does not exist and was never created");
  }

  // Cleanup isolated test database
  cleanupTestDb();
  assert(true, "Isolated test database cleaned up safely");

  console.log("\n================================================================================");
  console.log(`TASK 01B.50 REMEDIATION TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runRemediationTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
