import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { runMigrations } from "./helpers/sqliteMigrations";
import { getAsyncDb, closeDb } from "../apps/erp/src/server/database/db";
import {
  CANONICAL_ROLES,
  ROLE_PERMISSIONS,
  hasPermission,
} from "../apps/erp/src/server/authorization/permissions";
import {
  createTiffinCustomer,
  createTiffinProduct,
  normalizePhoneNumber,
} from "../apps/erp/src/server/tiffin/tiffinService";
import {
  getCanonicalSureshDeliveryStaff,
  getFleetCustodySummary,
  getDriverCustodySummary,
  completeDeliveryTask,
  getDeliveryTaskById,
  listDeliveryTasks,
  extractCleanUserNotes,
} from "../apps/erp/src/server/delivery/deliveryService";
import {
  createUnifiedOrder,
  listUnifiedOrders,
} from "../apps/erp/src/server/orders/orderService";
import {
  getCashbookSummary,
  assertClosingDateNotFinalized,
} from "../apps/erp/src/server/finance/financeService";
import {
  AuthenticatedUser,
} from "../apps/erp/src/types";

// ----------------------------------------------------------------------------
// Primary DB immutability guard
// ----------------------------------------------------------------------------
const ROOT = process.cwd();
const primaryDbPath = path.resolve(ROOT, "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test DB for Task 01B.71
const TEST_DB_PATH = path.resolve(ROOT, "tests", "test_task71_runtime_fixes.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const wal = `${TEST_DB_PATH}-wal`;
  const shm = `${TEST_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_DB_PATH;

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

async function runTestSuite() {
  console.log("================================================================================");
  console.log("TASK 01B.71 — TIFFIN RUNTIME ERROR FIXES & UX REFINEMENT TEST SUITE");
  console.log("================================================================================\n");

  // 1. Initialize isolated SQLite DB
  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma("foreign_keys = ON");
  runMigrations(sqlite);

  const now = new Date().toISOString();
  const testDate = "2026-10-24";

  // Seed Canonical Staff
  sqlite.prepare(`
    INSERT INTO staff_users (id, username, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("usr_owner", "owner_ravi", "ravi@ravinarayana.in", "hash", "Ravi Narayana", "SUPER_ADMIN", 1, now, now);

  sqlite.prepare(`
    INSERT INTO staff_users (id, username, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("usr_mgr", "mgr_sharma", "sharma@ravinarayana.in", "hash", "Sharma Ji", "OPERATIONS_MANAGER", 1, now, now);

  sqlite.prepare(`
    INSERT INTO staff_users (id, username, email, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("usr_suresh", "suresh_delivery", "suresh@ravinarayana.in", "hash", "Suresh Kumar", "DELIVERY_PERSON", 1, now, now);

  // Seed standard meal plan
  sqlite.prepare(`
    INSERT INTO daily_meal_plans (
      id, service_date, meal_type, planned_resident_count, planned_tiffin_count,
      guest_count, final_preparation_count, actual_cooked_count, status, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?)
  `).run("plan_lunch_24", testDate, "LUNCH", 30, 10, 0, 40, 40, "usr_owner", now, now);

  sqlite.close();

  const ownerActor: AuthenticatedUser = {
    id: "usr_owner",
    username: "owner_ravi",
    email: "ravi@ravinarayana.in",
    fullName: "Ravi Narayana",
    role: "SUPER_ADMIN",
  };

  const managerActor: AuthenticatedUser = {
    id: "usr_mgr",
    username: "mgr_sharma",
    email: "sharma@ravinarayana.in",
    fullName: "Sharma Ji",
    role: "OPERATIONS_MANAGER",
  };

  const sureshActor: AuthenticatedUser = {
    id: "usr_suresh",
    username: "suresh_delivery",
    email: "suresh@ravinarayana.in",
    fullName: "Suresh Kumar",
    role: "DELIVERY_PERSON",
  };

  // Seed menu products
  const productThali = await createTiffinProduct(ownerActor, {
    name: "Deluxe Thali",
    code: "THALI_DELUXE",
    category: "STANDARD_MEAL",
    price: 150,
    billingUnit: "PER_MEAL",
  });

  const productStandard = await createTiffinProduct(ownerActor, {
    name: "Standard Tiffin",
    code: "TIFFIN_STD",
    category: "STANDARD_MEAL",
    price: 100,
    billingUnit: "PER_MEAL",
  });

  console.log("--- 1. Verification of Schema Integrity (Error A & B Prevention) ---");
  {
    const db = getAsyncDb();
    const cashbookTable = await db.queryOne<{ name: string }>(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='daily_cashbook_closings'
    `);
    assert(Boolean(cashbookTable), "daily_cashbook_closings table exists in isolated database");

    const deliveryTableColumns = await db.query<any>(`
      PRAGMA table_info(delivery_tasks)
    `);
    const hasColIdempotency = deliveryTableColumns.some((c: any) => c.name === "collection_idempotency_key");
    const hasColStatus = deliveryTableColumns.some((c: any) => c.name === "collection_status");
    const hasColAmount = deliveryTableColumns.some((c: any) => c.name === "collected_amount");

    assert(hasColIdempotency, "delivery_tasks has collection_idempotency_key column");
    assert(hasColStatus, "delivery_tasks has collection_status column");
    assert(hasColAmount, "delivery_tasks has collected_amount column");
  }

  console.log("\n--- 2. Automatic Assignment AND Automatic Dispatch (OUT_FOR_DELIVERY) ---");
  let deliveryOrderId = "";
  let deliveryTaskId = "";
  {
    const order = await createUnifiedOrder(managerActor, {
      orderType: "DELIVERY",
      customerName: "Aakash Patel",
      customerPhone: "9876500001",
      deliveryAddress: "Flat 402, Sunshine Heights, Koramangala",
      serviceDate: testDate,
      mealType: "LUNCH",
      items: [
        { productId: productThali.id, productName: productThali.name, quantity: 2, unitPrice: productThali.price },
      ],
      notes: "Please call when reaching gate",
      idempotencyKey: "ord_test_auto_dispatch_1",
    });

    deliveryOrderId = order.id;
    deliveryTaskId = order.deliveryTaskId!;

    assert(order.orderType === "DELIVERY", "Order type is DELIVERY");
    assert(order.assignedTo === "usr_suresh", "Order automatically assigned to Suresh");
    assert(order.deliveryStatus === "OUT_FOR_DELIVERY", "Task automatically transitioned to OUT_FOR_DELIVERY (no Start Transit needed)");
    assert(order.orderStatus === "CONFIRMED", "Unified order status is CONFIRMED");
    assert(order.paymentStatus === "PENDING", "Delivery order payment status is PENDING (collected at door)");
    assert(order.totalAmount === 300, "Order total calculated correctly (2 * 150 = 300)");
  }

  console.log("\n--- 3. Sanitation of [ORDER_JSON:...] & Clean Notes Handling ---");
  {
    // Test helper directly
    const rawNoteWithJson = `[ORDER_JSON:{"orderType":"DELIVERY","items":[{"productName":"Deluxe Thali","quantity":2,"unitPrice":150}],"totalAmount":300,"totalQuantity":2}] Please call when reaching gate`;
    const cleanNote = extractCleanUserNotes(rawNoteWithJson);
    assert(cleanNote === "Please call when reaching gate", "extractCleanUserNotes strips [ORDER_JSON:...] and preserves human note");

    const jsonOnlyNote = `[ORDER_JSON:{"orderType":"DELIVERY","items":[]}]`;
    const emptyClean = extractCleanUserNotes(jsonOnlyNote);
    assert(emptyClean === null, "extractCleanUserNotes returns null when only JSON marker was present");

    // Test task retrieval through deliveryService
    const tasks = await listDeliveryTasks(managerActor, { serviceDate: testDate, mealType: "LUNCH" });
    const targetTask = tasks.find((t) => t.id === deliveryTaskId);

    assert(Boolean(targetTask), "Delivery task found in list");
    assert(!targetTask?.deliveryNotes?.includes("[ORDER_JSON:"), "task.deliveryNotes does not contain [ORDER_JSON:] marker");
    assert(targetTask?.deliveryNotes === "Please call when reaching gate", "task.deliveryNotes returns clean human note");
    assert(Array.isArray(targetTask?.items) && targetTask.items.length === 1, "task.items is parsed and attached to DeliveryTask");
    assert(targetTask?.items?.[0].productName === "Deluxe Thali", "task.items[0].productName matches Deluxe Thali");
    assert(targetTask?.items?.[0].quantity === 2, "task.items[0].quantity matches 2");
  }

  console.log("\n--- 4. Single-Screen Delivery Completion with Auto Undelivered & Collection ---");
  {
    // Order-backed: one outcome per order line (this order has one line of 2 thalis).
    const taskDetail = await getDeliveryTaskById(sureshActor, deliveryTaskId);
    const thaliLine = taskDetail!.task.orderLines![0];
    const oneOfTwo = [{ orderItemId: thaliLine.orderItemId, deliveredQuantity: 1, undeliveredQuantity: 1 }];

    // A: Test that undelivered without reason fails
    let failedWithoutReason = false;
    try {
      await completeDeliveryTask(sureshActor, deliveryTaskId, {
        lines: oneOfTwo,
        undeliveredReason: undefined, // Missing reason
      });
    } catch (err: any) {
      failedWithoutReason = true;
      assert(err.message.includes("A reason is required"), "Delivery completion rejects shortfall without reason");
    }
    assert(failedWithoutReason, "Shortfall without reason successfully blocked");

    // B: Complete delivery with 1 delivered, 1 undelivered (shortfall reason provided) + cash collection
    const completedTask = await completeDeliveryTask(sureshActor, deliveryTaskId, {
      lines: oneOfTwo,
      undeliveredReason: "Customer took fewer portions",
      collectedAmount: 150,
      paymentMethod: "CASH",
      recipientName: "Aakash P.",
      idempotencyKey: "col_idem_key_001",
    });

    assert(completedTask.status === "DELIVERED", "Task status transitioned to DELIVERED");
    assert(completedTask.collectionStatus === "COLLECTED", "Task collectionStatus transitioned to COLLECTED");
    assert(completedTask.collectedAmount === 150, "Task collectedAmount matches 150");
    assert(completedTask.collectedPaymentMethod === "CASH", "Task collectedPaymentMethod matches CASH");
    assert(completedTask.collectionIdempotencyKey === "col_idem_key_001", "Task collectionIdempotencyKey stored");

    // C: Idempotent repeat delivery
    const idempotentRepeat = await completeDeliveryTask(sureshActor, deliveryTaskId, {
      collectedAmount: 150,
      paymentMethod: "CASH",
    });
    assert(idempotentRepeat.status === "DELIVERED", "Idempotent repeat delivery returns DELIVERED");
    assert(idempotentRepeat.collectedAmount === 150, "Collected amount preserved without duplicate addition");
  }

  console.log("\n--- 5. Duplicate Customer Phone Detection & Enforcement ---");
  {
    // Customer "Aakash Patel" already exists with phone "9876500001"
    let duplicateRejected = false;
    try {
      await createUnifiedOrder(managerActor, {
        orderType: "DELIVERY",
        customerName: "Duplicate Aakash",
        customerPhone: "9876500001", // Duplicate phone without customerId
        deliveryAddress: "Flat 101, Another building",
        serviceDate: testDate,
        mealType: "DINNER",
        items: [{ productId: productStandard.id, productName: productStandard.name, quantity: 1, unitPrice: productStandard.price }],
      });
    } catch (err: any) {
      duplicateRejected = true;
      assert(err.message.includes("already exists"), `Duplicate customer phone creation rejected: ${err.message}`);
    }
    assert(duplicateRejected, "createUnifiedOrder strictly prevents creating duplicate customers with identical phone");

    // Phone normalization check
    const normalized = normalizePhoneNumber("+91 98765-00001");
    assert(normalized === "9876500001", "normalizePhoneNumber correctly normalizes '+91 98765-00001' to '9876500001'");
  }

  console.log("\n--- 6. Dine-in Counter Order & Cashbook Closing Lock Verification ---");
  {
    // A: Create Dine-in counter sale
    const dineInOrder = await createUnifiedOrder(managerActor, {
      orderType: "DINE_IN",
      customerName: "Walk-in Guest 1",
      serviceDate: testDate,
      mealType: "LUNCH",
      items: [
        { productId: productStandard.id, productName: productStandard.name, quantity: 2, unitPrice: productStandard.price },
      ],
      paymentMethod: "UPI",
    });

    assert(dineInOrder.orderType === "DINE_IN", "Order type is DINE_IN");
    assert(dineInOrder.orderStatus === "COMPLETED", "Dine-in order status is COMPLETED");
    assert(dineInOrder.paymentStatus === "PAID", "Dine-in order payment status is PAID");
    assert(dineInOrder.collectedAmount === 200, "Collected amount is 200");
    assert(dineInOrder.deliveryTaskId === null, "Dine-in order has no delivery task");

    // B: Verify assertClosingDateNotFinalized passes when date is open
    const db = getAsyncDb();
    let lockPassed = true;
    try {
      await assertClosingDateNotFinalized(db, testDate, "TIFFIN");
    } catch {
      lockPassed = false;
    }
    assert(lockPassed, "assertClosingDateNotFinalized passes without missing-table error on open date");

    // C: Finalize closing for testDate
    await db.execute(`
      INSERT INTO daily_cashbook_closings (
        id, closing_date, division, status, prepared_by, finalized_by,
        finalized_at, notes, created_at, updated_at
      ) VALUES (?, ?, 'TIFFIN', 'FINALIZED', 'usr_owner', 'usr_owner', ?, 'Closed', ?, ?)
    `, [`close_${testDate}_tiffin`, testDate, now, now, now]);

    // D: Verify subsequent Dine-in sale on closed date is rejected
    let closedDateBlocked = false;
    try {
      await createUnifiedOrder(managerActor, {
        orderType: "DINE_IN",
        customerName: "Late Guest",
        serviceDate: testDate,
        mealType: "DINNER",
        items: [{ productId: productStandard.id, productName: productStandard.name, quantity: 1, unitPrice: productStandard.price }],
      });
    } catch (err: any) {
      closedDateBlocked = true;
      assert(err.message.toLowerCase().includes("finalized"), `Dine-in sale on finalized date blocked: ${err.message}`);
    }
    assert(closedDateBlocked, "Finalized cashbook closing locks subsequent financial transactions");
  }

  console.log("\n--- 7. Delivery Handover Fleet Summary & PWA Webmanifest ---");
  {
    // A: Fleet summary
    const fleetSummary = await getFleetCustodySummary(ownerActor, testDate);
    assert(fleetSummary !== null && typeof fleetSummary.totalCashCollected === "number", "getFleetCustodySummary returns valid summary object");

    // B: Webmanifest validity
    const manifestPath = path.resolve(ROOT, "apps", "erp", "public", "manifest.webmanifest");
    assert(fs.existsSync(manifestPath), "apps/erp/public/manifest.webmanifest exists");
    const manifestRaw = fs.readFileSync(manifestPath, "utf8");
    let manifestJson: any = null;
    try {
      manifestJson = JSON.parse(manifestRaw);
    } catch (err) {
      // parse fail
    }
    assert(Boolean(manifestJson), "manifest.webmanifest is valid JSON");
    assert(manifestJson?.name === "Ravi Narayana ERP & Delivery", "manifest.webmanifest has valid name");
    assert(manifestJson?.display === "standalone", "manifest.webmanifest has display 'standalone'");
    assert(Array.isArray(manifestJson?.icons) && manifestJson.icons.length > 0, "manifest.webmanifest has icons array");
  }

  console.log("\n--- 8. Primary Database Immutability Check ---");
  {
    if (primaryStatsBefore) {
      const primaryStatsAfter = fs.statSync(primaryDbPath);
      assert(primaryStatsAfter.size === primaryStatsBefore.size, `Primary DB size unchanged: ${primaryStatsAfter.size} bytes`);
      assert(primaryStatsAfter.mtimeMs === primaryStatsBefore.mtimeMs, "Primary DB mtimeMs strictly unchanged");
    } else {
      console.log("  ℹ Notice: data/erp.db did not exist before test; skipping immutability check");
    }
  }

  cleanupTestDb();

  console.log("\n================================================================================");
  console.log(`TASK 01B.71 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  cleanupTestDb();
  process.exit(1);
});
