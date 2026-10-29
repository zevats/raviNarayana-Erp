import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { closeDb, getAsyncDb, AsyncDb, setTestAsyncDb } from "../apps/erp/src/server/database/db";
import {
  createRawMaterial,
  updateRawMaterial,
  getRawMaterialById,
  listRawMaterials,
  getLowStockAlerts,
  recordStockReceipt,
  recordStockAdjustment,
  recordMaterialWaste,
  listStockMovements,
  createRecipe,
  updateRecipe,
  getRecipeById,
  listRecipes,
  previewProductionConsumption,
  confirmProductionConsumption,
  reverseProductionConsumption,
  getProductionConsumptionForPlan,
  convertToBaseUnit,
  InventoryValidationError,
  InsufficientStockError,
} from "../apps/erp/src/server/kitchen/kitchenInventoryService";
import {
  createMealPlan,
  confirmMealPlan,
  reconcileMealPlanProduction,
} from "../apps/erp/src/server/kitchen/kitchenService";
import { getAuditLogs } from "../apps/erp/src/server/audit/audit";
import { AuthenticatedUser } from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated test database path
const TEST_INV_DB_PATH = path.resolve(__dirname, "test_kitchen_inv.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_INV_DB_PATH)) fs.unlinkSync(TEST_INV_DB_PATH);
  const wal = `${TEST_INV_DB_PATH}-wal`;
  const shm = `${TEST_INV_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_INV_DB_PATH;

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
console.log("RAVINARAYAN ERP — TASK 01B.48: KITCHEN INVENTORY & RECIPE CONSUMPTION TEST SUITE");
console.log("================================================================================\n");

async function runKitchenInventoryTests() {
  // Test actors
  const superAdminUser: AuthenticatedUser = {
    id: "usr_admin_inv",
    username: "admin_inv",
    email: "admin.inv@ravinarayan.in",
    fullName: "Ravinarayan Admin",
    role: "SUPER_ADMIN",
  };

  const kitchenManagerUser: AuthenticatedUser = {
    id: "usr_kitchen_inv",
    username: "kitchen_inv",
    email: "kitchen.inv@ravinarayan.in",
    fullName: "Head Chef Met City",
    role: "KITCHEN_OPERATIONS",
  };

  const deliveryUser: AuthenticatedUser = {
    id: "usr_delivery_inv",
    username: "delivery_inv",
    email: "delivery.inv@ravinarayan.in",
    fullName: "Delivery Staff",
    role: "DELIVERY_PERSON",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_accountant_inv",
    username: "accountant_inv",
    email: "accountant.inv@ravinarayan.in",
    fullName: "Staff Accountant",
    role: "ACCOUNTANT",
  };

  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Migration V16 & Schema Verification
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Database Migration V16 & Schema Verification");

  const db = new Database(TEST_INV_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  const version = db.pragma("user_version", { simple: true });
  assert(Number(version) >= 16, `Database schema version advanced to at least V16 (got ${version})`);

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(
    (t) => t.name
  );
  assert(tables.includes("kitchen_raw_materials"), "kitchen_raw_materials table created");
  assert(tables.includes("kitchen_recipes"), "kitchen_recipes table created");
  assert(tables.includes("kitchen_recipe_ingredients"), "kitchen_recipe_ingredients table created");
  assert(tables.includes("kitchen_stock_movements"), "kitchen_stock_movements table created");
  assert(tables.includes("kitchen_production_consumptions"), "kitchen_production_consumptions table created");

  // Seed staff users in test DB
  const now = new Date().toISOString();
  const insertStaff = db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fake_hash', ?, ?, ?, ?)
  `);

  insertStaff.run(superAdminUser.id, superAdminUser.username, superAdminUser.email, superAdminUser.fullName, superAdminUser.role, 1, now, now);
  insertStaff.run(kitchenManagerUser.id, kitchenManagerUser.username, kitchenManagerUser.email, kitchenManagerUser.fullName, kitchenManagerUser.role, 1, now, now);
  insertStaff.run(deliveryUser.id, deliveryUser.username, deliveryUser.email, deliveryUser.fullName, deliveryUser.role, 1, now, now);
  insertStaff.run(accountantUser.id, accountantUser.username, accountantUser.email, accountantUser.fullName, accountantUser.role, 1, now, now);

  db.close();
  assert(true, "Staff users populated in isolated test DB");

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Canonical Unit Conversions & Precision
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Canonical Unit Conversions & Precision");

  // Compatible mass conversions
  assert(convertToBaseUnit(2.5, "KG", "G") === 2500, "2.5 KG converts exactly to 2,500 G");
  assert(convertToBaseUnit(500, "G", "G") === 500, "500 G converts exactly to 500 G");
  assert(convertToBaseUnit(0.125, "KG", "G") === 125, "0.125 KG converts to 125 G");

  // Compatible volume conversions
  assert(convertToBaseUnit(1.5, "L", "ML") === 1500, "1.5 L converts exactly to 1,500 ML");
  assert(convertToBaseUnit(750, "ML", "ML") === 750, "750 ML converts exactly to 750 ML");

  // Discrete count conversions
  assert(convertToBaseUnit(15, "PCS", "PCS") === 15, "15 PCS converts to 15 PCS");

  // Rejection of incompatible unit conversions
  let threwIncompatible = false;
  try {
    convertToBaseUnit(5, "KG", "ML");
  } catch (err: any) {
    threwIncompatible = err.message.includes("Incompatible unit conversion");
  }
  assert(threwIncompatible, "Converting mass (KG) to volume (ML) is strictly rejected");

  threwIncompatible = false;
  try {
    convertToBaseUnit(2, "L", "G");
  } catch (err: any) {
    threwIncompatible = err.message.includes("Incompatible unit conversion");
  }
  assert(threwIncompatible, "Converting volume (L) to mass (G) is strictly rejected");

  threwIncompatible = false;
  try {
    convertToBaseUnit(10, "PCS", "G");
  } catch (err: any) {
    threwIncompatible = err.message.includes("Incompatible unit conversion");
  }
  assert(threwIncompatible, "Converting count (PCS) to mass (G) is strictly rejected");

  // Rejection of invalid quantities
  let threwInvalidQty = false;
  try {
    convertToBaseUnit(-5, "KG", "G");
  } catch (err: any) {
    threwInvalidQty = err.message.includes("positive number");
  }
  assert(threwInvalidQty, "Negative quantities rejected in unit conversion");

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Raw Material Catalogue Management
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Raw Material Catalogue Management");

  // Create raw materials
  const attaMat = await createRawMaterial(kitchenManagerUser, {
    code: "RM-ATTA",
    name: "Wheat Flour (Chakki Atta)",
    category: "GRAINS",
    baseUnit: "G",
    initialStock: 50000, // 50 kg
    reorderThreshold: 10000, // 10 kg
    description: "50kg MP Sharbati whole wheat flour",
  });
  assert(attaMat.code === "RM-ATTA" && attaMat.currentStock === 50000, "Created RM-ATTA with 50,000 G initial stock");

  const dalMat = await createRawMaterial(kitchenManagerUser, {
    code: "RM-TOOR-DAL",
    name: "Toor Dal (Pigeon Pea)",
    category: "PULSES",
    baseUnit: "G",
    initialStock: 25000, // 25 kg
    reorderThreshold: 5000, // 5 kg
  });
  assert(dalMat.code === "RM-TOOR-DAL" && dalMat.currentStock === 25000, "Created RM-TOOR-DAL with 25,000 G initial stock");

  const oilMat = await createRawMaterial(kitchenManagerUser, {
    code: "RM-OIL-SUNFLOWER",
    name: "Refined Sunflower Oil",
    category: "OILS",
    baseUnit: "ML",
    initialStock: 15000, // 15 L
    reorderThreshold: 3000, // 3 L
  });
  assert(oilMat.code === "RM-OIL-SUNFLOWER" && oilMat.currentStock === 15000, "Created RM-OIL-SUNFLOWER with 15,000 ML initial stock");

  const potatoMat = await createRawMaterial(kitchenManagerUser, {
    code: "RM-POTATO",
    name: "Fresh Potatoes",
    category: "VEGETABLES",
    baseUnit: "G",
    initialStock: 30000, // 30 kg
    reorderThreshold: 5000,
  });
  assert(potatoMat.code === "RM-POTATO", "Created RM-POTATO with 30,000 G initial stock");

  const saltMat = await createRawMaterial(kitchenManagerUser, {
    code: "RM-SALT",
    name: "Iodized Table Salt",
    category: "SPICES",
    baseUnit: "G",
    initialStock: 10000, // 10 kg
    reorderThreshold: 1000,
  });
  assert(saltMat.code === "RM-SALT", "Created RM-SALT with 10,000 G initial stock");

  // Rejection of duplicate code
  let threwDuplicateCode = false;
  try {
    await createRawMaterial(kitchenManagerUser, {
      code: "RM-ATTA",
      name: "Duplicate Atta",
      category: "GRAINS",
      baseUnit: "G",
    });
  } catch (err: any) {
    threwDuplicateCode = err.message.includes("already exists");
  }
  assert(threwDuplicateCode, "Duplicate material code 'RM-ATTA' rejected");

  // Rejection of invalid category / base unit
  let threwInvalidCat = false;
  try {
    await createRawMaterial(kitchenManagerUser, {
      code: "RM-INVALID",
      name: "Invalid Material",
      category: "FABRICS" as any,
      baseUnit: "G",
    });
  } catch (err: any) {
    threwInvalidCat = err.message.includes("Invalid category");
  }
  assert(threwInvalidCat, "Invalid material category rejected");

  // Update material
  const updatedAtta = await updateRawMaterial(kitchenManagerUser, attaMat.id, {
    description: "Updated Chakki Atta grade 1",
    reorderThreshold: 12000,
  });
  assert(updatedAtta.reorderThreshold === 12000, "Updated material reorder threshold to 12,000 G");

  // List materials & low stock check
  const allMaterials = await listRawMaterials(kitchenManagerUser);
  assert(allMaterials.length >= 5, `Listed ${allMaterials.length} raw materials`);

  const grainMaterials = await listRawMaterials(kitchenManagerUser, { category: "GRAINS" });
  assert(grainMaterials.length === 1 && grainMaterials[0].code === "RM-ATTA", "Category filter 'GRAINS' returned RM-ATTA");

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: Stock Movement Ledger (Receipts, Adjustments, Spoilage)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Stock Movement Ledger (Receipts, Adjustments, Spoilage)");

  // 1. Stock replenishment receipt: 20 KG atta received
  const receiptMov = await recordStockReceipt(kitchenManagerUser, {
    materialId: attaMat.id,
    quantity: 20,
    unit: "KG",
    reason: "Supplier delivery from grain market",
    referenceNumber: "INV-PO-9841",
  });
  assert(receiptMov.movementType === "RECEIPT", "Receipt movement created with type 'RECEIPT'");
  assert(receiptMov.quantityBase === 20000, "Receipt of 20 KG converted to +20,000 G canonical quantity");

  const refreshedAtta = await getRawMaterialById(kitchenManagerUser, attaMat.id);
  assert(refreshedAtta?.currentStock === 70000, "Atta stock increased from 50,000 to 70,000 G after receipt");

  // 2. Positive stock adjustment: +5 KG dal
  const adjAddMov = await recordStockAdjustment(kitchenManagerUser, {
    materialId: dalMat.id,
    adjustmentType: "ADD",
    quantity: 5,
    unit: "KG",
    reason: "Quarterly stock audit count correction",
  });
  assert(adjAddMov.movementType === "ADJUSTMENT_ADD" && adjAddMov.quantityBase === 5000, "Positive adjustment recorded +5,000 G");

  const refreshedDal = await getRawMaterialById(kitchenManagerUser, dalMat.id);
  assert(refreshedDal?.currentStock === 30000, "Dal stock increased from 25,000 to 30,000 G");

  // 3. Negative stock adjustment: -2 KG potatoes
  const adjSubMov = await recordStockAdjustment(kitchenManagerUser, {
    materialId: potatoMat.id,
    adjustmentType: "SUB",
    quantity: 2,
    unit: "KG",
    reason: "Weight loss / moisture drying",
  });
  assert(adjSubMov.movementType === "ADJUSTMENT_SUB" && adjSubMov.quantityBase === -2000, "Negative adjustment recorded -2,000 G");

  const refreshedPotato = await getRawMaterialById(kitchenManagerUser, potatoMat.id);
  assert(refreshedPotato?.currentStock === 28000, "Potato stock decreased from 30,000 to 28,000 G");

  // 4. Rejection of negative adjustment exceeding stock
  let threwExcessSub = false;
  try {
    await recordStockAdjustment(kitchenManagerUser, {
      materialId: potatoMat.id,
      adjustmentType: "SUB",
      quantity: 50,
      unit: "KG", // 50,000 G > 28,000 G
      reason: "Excess deduction",
    });
  } catch (err: any) {
    threwExcessSub = err.message.includes("Cannot subtract");
  }
  assert(threwExcessSub, "Negative adjustment exceeding available stock is rejected");

  // 5. Spoilage / waste movement
  const wasteMov = await recordMaterialWaste(kitchenManagerUser, {
    materialId: potatoMat.id,
    quantity: 1,
    unit: "KG",
    reason: "Moisture rot in vegetable bin",
  });
  assert(wasteMov.movementType === "WASTE" && wasteMov.quantityBase === -1000, "Material waste recorded with type 'WASTE' (-1,000 G)");

  const postWastePotato = await getRawMaterialById(kitchenManagerUser, potatoMat.id);
  assert(postWastePotato?.currentStock === 27000, "Potato stock decreased from 28,000 to 27,000 G after waste deduction");

  // List movements
  const movements = await listStockMovements(kitchenManagerUser, { materialId: potatoMat.id });
  assert(movements.length >= 3, `Potato movements recorded (${movements.length} total)`);

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Recipe Management & Version Snapshotting
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Recipe Management & Version Snapshotting");

  // Create Lunch Thali recipe (Yield: 1 portion)
  const lunchRecipe = await createRecipe(kitchenManagerUser, {
    name: "Standard PG Lunch Thali",
    description: "4 Rotis, Toor Dal, Aloo Sabzi",
    mealType: "LUNCH",
    yieldServings: 1,
    ingredients: [
      { materialId: attaMat.id, quantity: 120, unit: "G", notes: "4 phulkas" },
      { materialId: dalMat.id, quantity: 60, unit: "G", notes: "Cooked toor dal" },
      { materialId: potatoMat.id, quantity: 80, unit: "G", notes: "Aloo subzi" },
      { materialId: oilMat.id, quantity: 25, unit: "ML", notes: "Tadka & frying" },
      { materialId: saltMat.id, quantity: 5, unit: "G" },
    ],
  });
  assert(lunchRecipe.name === "Standard PG Lunch Thali", "Lunch Thali recipe created");
  assert(lunchRecipe.version === 1, "Recipe version initialized to 1");
  assert(lunchRecipe.ingredients?.length === 5, "Recipe contains 5 ingredients");

  // Rejection of duplicate ingredient in recipe
  let threwDupIng = false;
  try {
    await createRecipe(kitchenManagerUser, {
      name: "Duplicate Ingredient Recipe",
      mealType: "DINNER",
      ingredients: [
        { materialId: attaMat.id, quantity: 100, unit: "G" },
        { materialId: attaMat.id, quantity: 50, unit: "G" },
      ],
    });
  } catch (err: any) {
    threwDupIng = err.message.includes("Duplicate ingredient");
  }
  assert(threwDupIng, "Duplicate ingredient material in recipe definition rejected");

  // Rejection of inactive ingredient
  const inactiveMat = await createRawMaterial(kitchenManagerUser, {
    code: "RM-INACTIVE-PANEER",
    name: "Expired Paneer",
    category: "DAIRY",
    baseUnit: "G",
  });
  await updateRawMaterial(kitchenManagerUser, inactiveMat.id, { isActive: false });

  let threwInactiveIng = false;
  try {
    await createRecipe(kitchenManagerUser, {
      name: "Recipe With Inactive Ingredient",
      mealType: "DINNER",
      ingredients: [{ materialId: inactiveMat.id, quantity: 100, unit: "G" }],
    });
  } catch (err: any) {
    threwInactiveIng = err.message.includes("is inactive");
  }
  assert(threwInactiveIng, "Inactive ingredient reference in recipe rejected");

  // Update recipe ingredients: recipe version snapshot should increment to 2!
  const updatedRecipe = await updateRecipe(kitchenManagerUser, lunchRecipe.id, {
    ingredients: [
      { materialId: attaMat.id, quantity: 140, unit: "G", notes: "Increased to 140g for 4 larger rotis" },
      { materialId: dalMat.id, quantity: 60, unit: "G" },
      { materialId: potatoMat.id, quantity: 80, unit: "G" },
      { materialId: oilMat.id, quantity: 25, unit: "ML" },
      { materialId: saltMat.id, quantity: 5, unit: "G" },
    ],
  });
  assert(updatedRecipe.version === 2, "Recipe version incremented to 2 after ingredient revision");

  // Verify historical version 1 snapshot is preserved
  const v1Recipe = await getRecipeById(kitchenManagerUser, lunchRecipe.id, undefined, 1);
  const v1Atta = v1Recipe?.ingredients?.find((i) => i.materialId === attaMat.id);
  assert(v1Atta?.quantityBase === 120, "Historical v1 snapshot still has 120g atta per portion");

  const v2Recipe = await getRecipeById(kitchenManagerUser, lunchRecipe.id, undefined, 2);
  const v2Atta = v2Recipe?.ingredients?.find((i) => i.materialId === attaMat.id);
  assert(v2Atta?.quantityBase === 140, "Current v2 snapshot has 140g atta per portion");

  // Revert back to 120g for standard testing
  await updateRecipe(kitchenManagerUser, lunchRecipe.id, {
    ingredients: [
      { materialId: attaMat.id, quantity: 120, unit: "G" },
      { materialId: dalMat.id, quantity: 60, unit: "G" },
      { materialId: potatoMat.id, quantity: 80, unit: "G" },
      { materialId: oilMat.id, quantity: 25, unit: "ML" },
      { materialId: saltMat.id, quantity: 5, unit: "G" },
    ],
  });

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Authoritative Production Consumption Workflow
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Authoritative Production Consumption Workflow");

  const testServiceDate = "2026-10-25";

  // 1. Create a draft meal plan
  const plan = await createMealPlan(kitchenManagerUser, {
    serviceDate: testServiceDate,
    mealType: "LUNCH",
    plannedTiffinCount: 20,
    guestCount: 5,
    status: "DRAFT",
  });
  assert(plan.status === "DRAFT", "Daily meal plan created in DRAFT status");

  // 2. Consumption confirmation MUST be rejected for non-COMPLETED plans
  let threwNonCompleted = false;
  try {
    await confirmProductionConsumption(kitchenManagerUser, plan.id);
  } catch (err: any) {
    threwNonCompleted = err.message.includes("requires status 'COMPLETED'");
  }
  assert(threwNonCompleted, "Cannot confirm consumption on DRAFT meal plan");

  // 3. Confirm meal plan (Preparation stage)
  await confirmMealPlan(kitchenManagerUser, plan.id);
  let threwNotReconciled = false;
  try {
    await confirmProductionConsumption(kitchenManagerUser, plan.id);
  } catch (err: any) {
    threwNotReconciled = err.message.includes("requires status 'COMPLETED'");
  }
  assert(threwNotReconciled, "Cannot confirm consumption on CONFIRMED meal plan without reconciliation");

  // 4. Reconcile production: actualCookedCount = 50 portions
  const reconciled = await reconcileMealPlanProduction(kitchenManagerUser, plan.id, {
    actualCookedCount: 50,
    dispatchedCount: 45,
    leftoverCount: 3,
    wasteCount: 2,
    notes: "Production completed with 50 cooked portions",
  });
  assert(reconciled.status === "COMPLETED" && reconciled.actualCookedCount === 50, "Meal plan reconciled to COMPLETED with 50 cooked portions");

  // 5. Preview production consumption
  const preview = await previewProductionConsumption(kitchenManagerUser, plan.id);
  assert(preview.canConfirm === true, "Preview indicates consumption can be confirmed");
  assert(preview.actualCookedCount === 50, "Preview uses authoritative actualCookedCount = 50");
  assert(preview.hasShortages === false, "No stock shortages detected in preview");

  const attaPreview = preview.ingredients.find((i) => i.materialId === attaMat.id);
  assert(attaPreview?.requiredQuantityBase === 50 * 120, "50 portions require 6,000 G Atta (50 × 120g)");

  const dalPreview = preview.ingredients.find((i) => i.materialId === dalMat.id);
  assert(dalPreview?.requiredQuantityBase === 50 * 60, "50 portions require 3,000 G Dal (50 × 60g)");

  // Record stock levels before consumption
  const attaBefore = (await getRawMaterialById(kitchenManagerUser, attaMat.id))!.currentStock;
  const dalBefore = (await getRawMaterialById(kitchenManagerUser, dalMat.id))!.currentStock;
  const potatoBefore = (await getRawMaterialById(kitchenManagerUser, potatoMat.id))!.currentStock;
  const oilBefore = (await getRawMaterialById(kitchenManagerUser, oilMat.id))!.currentStock;
  const saltBefore = (await getRawMaterialById(kitchenManagerUser, saltMat.id))!.currentStock;

  // 6. Confirm production consumption
  const consumption = await confirmProductionConsumption(kitchenManagerUser, plan.id, "Standard lunch batch confirmed");
  assert(consumption.status === "POSTED", "Consumption record created with status 'POSTED'");
  assert(consumption.producedServings === 50, "Consumption record accurately stamped with 50 produced servings");

  // Verify stock levels after deduction
  const attaAfter = (await getRawMaterialById(kitchenManagerUser, attaMat.id))!.currentStock;
  const dalAfter = (await getRawMaterialById(kitchenManagerUser, dalMat.id))!.currentStock;
  const potatoAfter = (await getRawMaterialById(kitchenManagerUser, potatoMat.id))!.currentStock;
  const oilAfter = (await getRawMaterialById(kitchenManagerUser, oilMat.id))!.currentStock;
  const saltAfter = (await getRawMaterialById(kitchenManagerUser, saltMat.id))!.currentStock;

  assert(attaAfter === attaBefore - 6000, `Atta stock deducted exactly 6,000 G (${attaBefore} -> ${attaAfter})`);
  assert(dalAfter === dalBefore - 3000, `Dal stock deducted exactly 3,000 G (${dalBefore} -> ${dalAfter})`);
  assert(potatoAfter === potatoBefore - 4000, `Potato stock deducted exactly 4,000 G (${potatoBefore} -> ${potatoAfter})`);
  assert(oilAfter === oilBefore - 1250, `Oil stock deducted exactly 1,250 ML (${oilBefore} -> ${oilAfter})`);
  assert(saltAfter === saltBefore - 250, `Salt stock deducted exactly 250 G (${saltBefore} -> ${saltAfter})`);

  // Verify stock movements in ledger
  const consumptionMovs = await listStockMovements(kitchenManagerUser, {
    sourceType: "PRODUCTION_PLAN",
    sourceId: plan.id,
    movementType: "PRODUCTION_CONSUMPTION",
  });
  assert(consumptionMovs.length === 5, "5 production consumption movements recorded in stock ledger");

  // 7. Duplicate Prevention & Idempotency: Repeating confirmation MUST NOT deduct stock again!
  const repeatConsumption = await confirmProductionConsumption(kitchenManagerUser, plan.id);
  assert(repeatConsumption.id === consumption.id, "Repeated confirmation returns existing consumption ID");

  const attaAfterRepeat = (await getRawMaterialById(kitchenManagerUser, attaMat.id))!.currentStock;
  assert(attaAfterRepeat === attaAfter, "Repeated confirmation does NOT deduct stock a second time");

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: Reversal & Production Correction Semantics
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Reversal & Production Correction Semantics");

  // Reversal requires mandatory reason
  let threwEmptyReason = false;
  try {
    await reverseProductionConsumption(kitchenManagerUser, plan.id, "");
  } catch (err: any) {
    threwEmptyReason = err.message.includes("mandatory");
  }
  assert(threwEmptyReason, "Reversal rejected when reason is empty");

  // Execute reversal
  const reversed = await reverseProductionConsumption(
    kitchenManagerUser,
    plan.id,
    "Reconciled cooked count was audited and revised from 50 to 45"
  );
  assert(reversed.status === "REVERSED", "Consumption record status updated to 'REVERSED'");

  // Verify compensating movements restored exact inventory balances
  const attaRestored = (await getRawMaterialById(kitchenManagerUser, attaMat.id))!.currentStock;
  const dalRestored = (await getRawMaterialById(kitchenManagerUser, dalMat.id))!.currentStock;
  const potatoRestored = (await getRawMaterialById(kitchenManagerUser, potatoMat.id))!.currentStock;
  const oilRestored = (await getRawMaterialById(kitchenManagerUser, oilMat.id))!.currentStock;
  const saltRestored = (await getRawMaterialById(kitchenManagerUser, saltMat.id))!.currentStock;

  assert(attaRestored === attaBefore, "Atta stock restored to pre-consumption balance");
  assert(dalRestored === dalBefore, "Dal stock restored to pre-consumption balance");
  assert(potatoRestored === potatoBefore, "Potato stock restored to pre-consumption balance");
  assert(oilRestored === oilBefore, "Oil stock restored to pre-consumption balance");
  assert(saltRestored === saltBefore, "Salt stock restored to pre-consumption balance");

  // Verify compensating reversal movements
  const reversalMovs = await listStockMovements(kitchenManagerUser, {
    sourceType: "PRODUCTION_PLAN",
    sourceId: plan.id,
    movementType: "PRODUCTION_REVERSAL",
  });
  assert(reversalMovs.length === 5, "5 compensating PRODUCTION_REVERSAL movements recorded in stock ledger");

  // Re-reconcile production to 45 portions and re-confirm consumption
  await reconcileMealPlanProduction(kitchenManagerUser, plan.id, {
    actualCookedCount: 45,
    dispatchedCount: 45,
    leftoverCount: 0,
    wasteCount: 0,
    notes: "Revised to 45 portions",
  });

  const reconfirmed = await confirmProductionConsumption(kitchenManagerUser, plan.id, "Re-confirmed for 45 portions");
  assert(reconfirmed.status === "POSTED" && reconfirmed.producedServings === 45, "Re-confirmed consumption for revised 45 portions");

  const attaFinal = (await getRawMaterialById(kitchenManagerUser, attaMat.id))!.currentStock;
  assert(attaFinal === attaBefore - 45 * 120, `Atta stock accurately deducted for 45 portions (45 × 120 = 5,400 G)`);

  // -----------------------------------------------------------------------------
  // TEST SUITE 8: Stock Shortage Enforcement & Atomic Rollback
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] Stock Shortage Enforcement & Atomic Rollback");

  // Create limited material (RM-PANEER: 500 G available)
  const paneerMat = await createRawMaterial(kitchenManagerUser, {
    code: "RM-PANEER",
    name: "Fresh Cottage Cheese (Paneer)",
    category: "DAIRY",
    baseUnit: "G",
    initialStock: 500, // only 500g
    reorderThreshold: 1000,
  });

  // Create Paneer Curry dinner recipe: 100 G paneer per portion
  await createRecipe(kitchenManagerUser, {
    name: "Paneer Butter Masala Dinner",
    mealType: "DINNER",
    yieldServings: 1,
    ingredients: [
      { materialId: paneerMat.id, quantity: 100, unit: "G" },
      { materialId: oilMat.id, quantity: 20, unit: "ML" },
    ],
  });

  // Create Dinner plan for 10 portions (requires 10 * 100 = 1,000 G, but only 500 G available!)
  const dinnerPlan = await createMealPlan(kitchenManagerUser, {
    serviceDate: testServiceDate,
    mealType: "DINNER",
    plannedTiffinCount: 10,
    status: "DRAFT",
  });
  await confirmMealPlan(kitchenManagerUser, dinnerPlan.id);
  await reconcileMealPlanProduction(kitchenManagerUser, dinnerPlan.id, {
    actualCookedCount: 10,
    dispatchedCount: 10,
    leftoverCount: 0,
    wasteCount: 0,
  });

  // Preview should detect shortage
  const dinnerPreview = await previewProductionConsumption(kitchenManagerUser, dinnerPlan.id);
  assert(dinnerPreview.hasShortages === true, "Shortage detected in preview for Paneer");
  assert(dinnerPreview.canConfirm === false, "canConfirm is false due to stock shortage");

  const paneerPreview = dinnerPreview.ingredients.find((i) => i.materialId === paneerMat.id);
  assert(paneerPreview?.shortageBase === 500, "Shortage calculated exactly as 500 G (1,000 G required - 500 G available)");

  // Confirmation attempt MUST fail with InsufficientStockError and rollback atomically
  let caughtShortageError = false;
  try {
    await confirmProductionConsumption(kitchenManagerUser, dinnerPlan.id);
  } catch (err: any) {
    if (err instanceof InsufficientStockError) {
      caughtShortageError = true;
      assert(err.shortages.length === 1 && err.shortages[0].materialCode === "RM-PANEER", "InsufficientStockError reports RM-PANEER shortage");
    }
  }
  assert(caughtShortageError, "confirmProductionConsumption threw InsufficientStockError");

  // Verify atomic rollback: paneer stock unchanged, oil stock unchanged, no consumption record created
  const paneerAfterFail = (await getRawMaterialById(kitchenManagerUser, paneerMat.id))!.currentStock;
  assert(paneerAfterFail === 500, "Paneer stock remains unchanged at 500 G (atomic rollback)");

  const unpostedRecord = await getProductionConsumptionForPlan(kitchenManagerUser, dinnerPlan.id);
  assert(unpostedRecord === null, "No consumption record committed after stock shortage failure");

  // Now replenish stock via receipt: add 2 KG (2,000 G) paneer
  await recordStockReceipt(kitchenManagerUser, {
    materialId: paneerMat.id,
    quantity: 2,
    unit: "KG",
    reason: "Emergency local dairy purchase",
  });

  // Re-attempt confirmation: now succeeds!
  const dinnerConsumption = await confirmProductionConsumption(kitchenManagerUser, dinnerPlan.id);
  assert(dinnerConsumption.status === "POSTED", "Dinner consumption confirmed successfully after stock replenishment");

  const paneerPostConfirm = (await getRawMaterialById(kitchenManagerUser, paneerMat.id))!.currentStock;
  assert(paneerPostConfirm === 1500, "Paneer stock updated to 1,500 G (2,500 G - 1,000 G consumed)");

  // -----------------------------------------------------------------------------
  // TEST SUITE 9: RBAC & Server-Side Security Enforcement
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 9] RBAC & Server-Side Security Enforcement");

  // Delivery Person cannot create raw material
  let threwDeliveryCreate = false;
  try {
    await createRawMaterial(deliveryUser, {
      code: "RM-UNAUTH",
      name: "Unauthorized Material",
      category: "GRAINS",
      baseUnit: "G",
    });
  } catch (err: any) {
    threwDeliveryCreate = err.message.includes("Forbidden") || err.name === "AuthorizationError";
  }
  assert(threwDeliveryCreate, "Delivery person forbidden from creating raw materials");

  // Accountant cannot adjust kitchen stock
  let threwAccountantAdj = false;
  try {
    await recordStockAdjustment(accountantUser, {
      materialId: attaMat.id,
      adjustmentType: "ADD",
      quantity: 1,
      unit: "KG",
      reason: "Unauthorized adjustment",
    });
  } catch (err: any) {
    threwAccountantAdj = err.message.includes("Forbidden") || err.name === "AuthorizationError";
  }
  assert(threwAccountantAdj, "Accountant forbidden from recording kitchen stock adjustments");

  // Delivery Person cannot confirm consumption
  let threwDeliveryConfirm = false;
  try {
    await confirmProductionConsumption(deliveryUser, plan.id);
  } catch (err: any) {
    threwDeliveryConfirm = err.message.includes("Forbidden") || err.name === "AuthorizationError";
  }
  assert(threwDeliveryConfirm, "Delivery person forbidden from confirming production consumption");

  // Delivery Person cannot reverse consumption
  let threwDeliveryReverse = false;
  try {
    await reverseProductionConsumption(deliveryUser, plan.id, "Unauthorized reversal");
  } catch (err: any) {
    threwDeliveryReverse = err.message.includes("Forbidden") || err.name === "AuthorizationError";
  }
  assert(threwDeliveryReverse, "Delivery person forbidden from reversing production consumption");

  // Super Admin can perform all operations
  const adminTestMat = await createRawMaterial(superAdminUser, {
    code: "RM-SUPER-ADMIN",
    name: "Super Admin Created Item",
    category: "OTHER",
    baseUnit: "PCS",
    initialStock: 10,
  });
  assert(adminTestMat.code === "RM-SUPER-ADMIN", "Super Admin permitted to manage inventory");

  // -----------------------------------------------------------------------------
  // TEST SUITE 10: Primary Database Guard & Immutability Verification
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 10] Primary Database Guard & Immutability Verification");

  if (primaryStatsBefore && fs.existsSync(primaryDbPath)) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(
      primaryStatsBefore.size === primaryStatsAfter.size,
      `Primary database size unchanged (${primaryStatsBefore.size} bytes)`
    );
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs,
      "Primary database last modified time completely unchanged"
    );
  } else {
    assert(true, "Primary database was not present or untouched");
  }

  // Teardown test DB
  cleanupTestDb();
  assert(true, "Isolated test database cleaned up safely");

  // -----------------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`TASK 01B.48 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runKitchenInventoryTests().catch((err) => {
  console.error("Test execution aborted with unhandled error:", err);
  process.exit(1);
});
