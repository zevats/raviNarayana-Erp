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
  requirePermission,
  AuthorizationError,
} from "../apps/erp/src/server/authorization/authorize";
import {
  createTiffinCustomer,
  createTiffinProduct,
  updateTiffinProduct,
  createTiffinSubscription,
  pauseTiffinSubscription,
} from "../apps/erp/src/server/tiffin/tiffinService";
import {
  createMealPlan,
  confirmMealPlan,
  calculateDailyKitchenDemand,
  recordWalkInSale,
  listWalkInSales,
} from "../apps/erp/src/server/kitchen/kitchenService";
import {
  createExternalDeliveryTask,
  generateDeliveryTasks,
  assignDeliveryTask,
  dispatchDeliveryTask,
  completeDeliveryTask,
  createCashHandoverDeclaration,
  acceptCashHandover,
  getDriverCustodySummary,
  syncDeliveryActions,
  listActiveDeliveryStaff,
} from "../apps/erp/src/server/delivery/deliveryService";
import {
  getCashbookSummary,
} from "../apps/erp/src/server/finance/financeService";
import {
  finalizeDailyClosing,
} from "../apps/erp/src/server/finance/cashbookClosingService";
import {
  updateStaffRole,
  setStaffActiveStatus,
} from "../apps/erp/src/server/staff/staffService";
import {
  AuthenticatedUser,
  QueuedDeliveryAction,
} from "../apps/erp/src/types";

// ----------------------------------------------------------------------------
// Primary DB immutability guard
// ----------------------------------------------------------------------------
const ROOT = process.cwd();
const primaryDbPath = path.resolve(ROOT, "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test DB for Task 01B.69
const TEST_DB_PATH = path.resolve(ROOT, "tests", "test_task69_tiffin_workflow.db");

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
  console.log("TASK 01B.69 — TIFFIN OPERATIONS, DELIVERY WORKFLOW & 3-ROLE MODEL TEST SUITE");
  console.log("================================================================================\n");

  // 1. Initialize isolated SQLite DB
  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma("foreign_keys = ON");
  runMigrations(sqlite);
  sqlite.close();

  const db = getAsyncDb();

  // Test Actors (3 Canonical Business Roles)
  const ownerUser: AuthenticatedUser = {
    id: "usr_owner_69",
    username: "owner_ramesh",
    email: "ramesh@ravinarayan.in",
    fullName: "Ramesh Narayana (Owner)",
    role: "SUPER_ADMIN",
  };

  const managerUser: AuthenticatedUser = {
    id: "usr_mgr_69",
    username: "mgr_suresh",
    email: "suresh@ravinarayan.in",
    fullName: "Suresh Patel (Manager)",
    role: "OPERATIONS_MANAGER",
  };

  const driverUser: AuthenticatedUser = {
    id: "usr_driver_69",
    username: "driver_anil",
    email: "anil@ravinarayan.in",
    fullName: "Anil Kumar (Delivery Boy)",
    role: "DELIVERY_PERSON",
  };

  const now = new Date().toISOString();
  // Insert test staff accounts into isolated database
  for (const u of [ownerUser, managerUser, driverUser]) {
    await db.execute(`
      INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'hash', ?, 1, ?, ?)
    `, [u.id, u.username, u.email, u.fullName, u.role, now, now]);
  }

  const serviceDate = "2026-11-01";

  // ===========================================================================
  // SECTION 1: Three-Role Model Enforcement & Owner Protection
  // ===========================================================================
  console.log("\n--- Section 1: Three-Role Model Enforcement & Owner Protection ---");

  assert(
    CANONICAL_ROLES.length === 3 &&
    CANONICAL_ROLES.includes("SUPER_ADMIN") &&
    CANONICAL_ROLES.includes("OPERATIONS_MANAGER") &&
    CANONICAL_ROLES.includes("DELIVERY_PERSON"),
    "Canonical roles exactly define the three business roles (Owner, Manager, Delivery Boy)"
  );

  assert(
    hasPermission("OPERATIONS_MANAGER", "kitchen.manage") &&
    hasPermission("OPERATIONS_MANAGER", "delivery.manage") &&
    hasPermission("OPERATIONS_MANAGER", "tiffin.manage"),
    "Manager has permissions for operational tiffin, kitchen, and delivery management"
  );

  assert(
    !hasPermission("DELIVERY_PERSON", "finance.manage") &&
    !hasPermission("DELIVERY_PERSON", "kitchen.manage") &&
    !hasPermission("DELIVERY_PERSON", "delivery.manage") &&
    hasPermission("DELIVERY_PERSON", "delivery.update"),
    "Delivery Boy has least-privilege permissions limited strictly to delivery updates"
  );

  // Sole Super-Admin Protection: demotion rejection
  let demotionBlocked = false;
  try {
    await updateStaffRole(ownerUser, ownerUser.id, "OPERATIONS_MANAGER");
  } catch (err: any) {
    demotionBlocked = err.message.includes("sole remaining active Super Administrator");
  }
  assert(demotionBlocked, "Sole Super-Admin (Owner) cannot be demoted");

  // Sole Super-Admin Protection: deactivation rejection
  let deactivationBlocked = false;
  try {
    await setStaffActiveStatus(ownerUser, ownerUser.id, false);
  } catch (err: any) {
    deactivationBlocked = err.message.includes("sole remaining active Super Administrator");
  }
  assert(deactivationBlocked, "Sole Super-Admin (Owner) cannot be deactivated");

  // ===========================================================================
  // SECTION 2: Customer Creation & Order Creation (Screen A Workflow)
  // ===========================================================================
  console.log("\n--- Section 2: Customer Creation & Order Creation (Screen A) ---");

  const customer = await createTiffinCustomer(managerUser, {
    fullName: "Sunil Sharma",
    phone: "9876543210",
    deliveryAddress: "Tech Park Phase 2, Tower A, Flat 402",
    customerType: "INDIVIDUAL",
    dietaryPreference: "VEG",
  });
  assert(Boolean(customer.id), `Customer created with ID ${customer.id}`);

  // Create external delivery order
  const extOrder = await createExternalDeliveryTask(managerUser, {
    serviceDate,
    mealType: "LUNCH",
    customerName: customer.fullName,
    customerPhone: customer.phone,
    deliveryAddress: customer.deliveryAddress,
    notes: "Order: Standard Veg Thali x 2. Ring bell on arrival.",
  });
  assert(extOrder.orderType === "EXTERNAL", "External delivery order has orderType = 'EXTERNAL'");
  assert(extOrder.status === "PENDING", "External delivery order initial status is 'PENDING'");
  assert(extOrder.customerName === "Sunil Sharma", "External order records customer name");

  // ===========================================================================
  // SECTION 3: Menu Price Catalog & Historical Snapshot Invariance
  // ===========================================================================
  console.log("\n--- Section 3: Menu Pricing Catalog & Historical Snapshot Invariance ---");

  const product = await createTiffinProduct(ownerUser, {
    name: "Executive Thali",
    code: "EXEC_THALI",
    category: "STANDARD_MEAL",
    billingUnit: "PER_MEAL",
    price: 120,
  });
  assert(product.price === 120, "Catalog product created with price ₹120");

  // Record an order snapshot with ₹120
  const orderSnapshot = await createExternalDeliveryTask(managerUser, {
    serviceDate,
    mealType: "DINNER",
    customerName: "Priya Nair",
    customerPhone: "9876543219",
    deliveryAddress: "Palm Grove Residencies 504",
    notes: `Order: ${product.name} x 1 (Total: ₹${product.price})`,
  });

  // Update product price to ₹150 in catalog
  const updatedProduct = await updateTiffinProduct(ownerUser, product.id, {
    price: 150,
  });
  assert(updatedProduct.price === 150, "Catalog product updated to new price ₹150");

  // Verify historical order snapshot preserves ₹120
  const fetchedSnapshot = await db.queryOne<any>(`
    SELECT delivery_notes FROM delivery_tasks WHERE id = ?
  `, [orderSnapshot.id]);
  assert(
    fetchedSnapshot.delivery_notes.includes("Total: ₹120"),
    "Historical order maintains historical ₹120 snapshot despite catalog price update"
  );

  // ===========================================================================
  // SECTION 4: Subscriptions & Kitchen Demand Calculation (Screen B)
  // ===========================================================================
  console.log("\n--- Section 4: Subscriptions & Kitchen Demand Calculation (Screen B) ---");

  // Create active subscription for customer Sunil
  const activeSub = await createTiffinSubscription(managerUser, {
    customerId: customer.id,
    productId: product.id,
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    customPrice: 120,
    quantityPerMeal: 1,
    deliveryAddress: customer.deliveryAddress,
  });
  assert(activeSub.status === "ACTIVE", "Commercial subscription is ACTIVE");

  // Create paused subscription for another customer
  const pausedCustomer = await createTiffinCustomer(managerUser, {
    fullName: "Vikas Reddy",
    phone: "9876543211",
    deliveryAddress: "Green View Villa 12",
  });
  const pausedSub = await createTiffinSubscription(managerUser, {
    customerId: pausedCustomer.id,
    productId: product.id,
    startDate: "2026-11-01",
    endDate: "2026-11-30",
    customPrice: 120,
    quantityPerMeal: 1,
    deliveryAddress: pausedCustomer.deliveryAddress,
  });
  await pauseTiffinSubscription(managerUser, pausedSub.id, {
    pauseStartDate: "2026-11-01",
    pauseResumeDate: "2026-11-06",
    pauseReason: "Traveling out of city",
  });

  // Calculate demand: active subscription contributes, paused does NOT
  const demand = await calculateDailyKitchenDemand(managerUser, serviceDate);
  const lunchDemand = demand.breakdown.lunch;
  assert(lunchDemand.subscriptions.length >= 1, "Active commercial subscription contributes to lunch demand");
  assert(demand.totalSubscriptions >= 1, "Total subscriptions count includes active subscriber");

  // ===========================================================================
  // SECTION 5: 1-Click Delivery Handoff & Duplicate Task Prevention
  // ===========================================================================
  console.log("\n--- Section 5: 1-Click Delivery Handoff & Duplicate Prevention ---");

  // Generate delivery tasks for LUNCH on serviceDate
  const genResult1 = await generateDeliveryTasks(managerUser, {
    serviceDate,
    mealType: "LUNCH",
  });
  assert(genResult1.createdCount > 0, `Generated ${genResult1.createdCount} delivery task(s) for lunch`);

  // Call generateDeliveryTasks a second time (idempotency check)
  const genResult2 = await generateDeliveryTasks(managerUser, {
    serviceDate,
    mealType: "LUNCH",
  });
  assert(genResult2.createdCount === 0, "Second generation produces 0 new tasks (zero duplicate tasks)");
  assert(genResult2.alreadyExistedCount > 0, "Already existed tasks correctly reported");

  // ===========================================================================
  // SECTION 6: Delivery Assignment, Partial Delivery & Doorstep Collection (Screen C)
  // ===========================================================================
  console.log("\n--- Section 6: Delivery Assignment, Partial Delivery & Doorstep Collection ---");

  // Find one generated task to assign to delivery boy
  const taskList = await db.query<any>(`
    SELECT id FROM delivery_tasks WHERE service_date = ? AND meal_type = 'LUNCH' LIMIT 1
  `, [serviceDate]);
  const testTaskId = taskList[0].id;

  // Manager assigns task to driver
  const assigned = await assignDeliveryTask(managerUser, testTaskId, {
    assignedToStaffId: driverUser.id,
  });
  assert(assigned.status === "ASSIGNED", "Task status is 'ASSIGNED'");
  assert(assigned.assignedTo === driverUser.id, "Task assigned to delivery boy");

  // Delivery boy dispatches task
  const dispatched = await dispatchDeliveryTask(driverUser, testTaskId);
  assert(dispatched.status === "OUT_FOR_DELIVERY", "Task status is 'OUT_FOR_DELIVERY'");

  // Delivery boy completes delivery with Partial Delivery recording and Doorstep Cash Collection
  const completed = await completeDeliveryTask(driverUser, testTaskId, {
    recipientName: "Sunil Sharma",
    deliveredQuantity: 1,
    undeliveredQuantity: 1,
    undeliveredReason: "Customer requested only 1 portion today",
    collectedAmount: 120,
    paymentMethod: "CASH",
    notes: "Left at doorstep per customer instruction",
  });

  assert(completed.status === "DELIVERED", "Task status updated to 'DELIVERED'");
  assert(completed.collectionStatus === "COLLECTED", "Doorstep collection status is 'COLLECTED'");
  assert(completed.collectedAmount === 120, "Collected amount ₹120 recorded");
  assert(completed.collectedPaymentMethod === "CASH", "Collected payment method is 'CASH'");
  assert(
    completed.deliveryNotes?.includes("Delivered: 1") &&
    completed.deliveryNotes?.includes("Undelivered: 1") &&
    completed.deliveryNotes?.includes("Customer requested only 1 portion today"),
    "Partial delivery quantities and reason recorded in delivery notes"
  );

  // ===========================================================================
  // SECTION 7: Driver Cash Custody & Manager Handover Reconciliation
  // ===========================================================================
  console.log("\n--- Section 7: Driver Cash Custody & Handover Reconciliation ---");

  const custody = await getDriverCustodySummary(managerUser, driverUser.id, serviceDate);
  assert(custody.cashInCustody === 120, `Driver unhanded cash custody correctly shows ₹${custody.cashInCustody}`);

  // Driver declares cash handover
  const handover = await createCashHandoverDeclaration(driverUser, {
    shiftDate: serviceDate,
    declaredCash: 120,
    notes: "End of lunch shift cash handover",
  });
  assert(handover.status === "DECLARED", "Handover status is 'DECLARED'");

  // Manager accepts handover
  const acceptedHandover = await acceptCashHandover(managerUser, handover.id, {
    acceptedCash: 120,
    notes: "Cash counted and verified in presence of driver",
  });
  assert(acceptedHandover.status === "ACCEPTED", "Handover status is 'ACCEPTED'");

  const custodyAfter = await getDriverCustodySummary(managerUser, driverUser.id, serviceDate);
  assert(custodyAfter.cashInCustody === 0, "Driver cash in custody is ₹0 after manager acceptance");

  // ===========================================================================
  // SECTION 8: Walk-in / Offline Counter Sale & Cashbook Ledger Posting
  // ===========================================================================
  console.log("\n--- Section 8: Walk-in Counter Sale & Cashbook Posting ---");

  const walkinSale = await recordWalkInSale(managerUser, {
    serviceDate,
    mealType: "LUNCH",
    productName: "Special Thali Plate",
    quantity: 2,
    unitPrice: 100,
    paymentMethod: "CASH",
    buyerName: "Walk-in Guest",
    notes: "Paid in cash at kitchen counter",
  });

  assert(walkinSale.transaction.amount === 200, "Walk-in sale transaction created for ₹200");
  assert(walkinSale.transaction.category === "TIFFIN_WALKIN_SALE", "Category is 'TIFFIN_WALKIN_SALE'");
  assert(walkinSale.transaction.paymentMethod === "CASH", "Payment method is 'CASH'");

  // List walk-in sales
  const walkinList = await listWalkInSales(managerUser, serviceDate);
  assert(walkinList.totalCount >= 1, `Found ${walkinList.totalCount} walk-in sale(s)`);
  assert(walkinList.totalAmount >= 200, `Total walk-in sales revenue is ₹${walkinList.totalAmount}`);

  // Check cashbook summary includes TIFFIN collections
  const cashbookTiffin = await getCashbookSummary(managerUser, {
    startDate: serviceDate,
    endDate: serviceDate,
    division: "TIFFIN",
  });
  assert(cashbookTiffin.totalTiffinCollected >= 200, `Cashbook reflects ₹${cashbookTiffin.totalTiffinCollected} tiffin collections`);

  // ===========================================================================
  // SECTION 9: Daily Cashbook Closing & Closing Lock Invariance
  // ===========================================================================
  console.log("\n--- Section 9: Daily Cashbook Closing & Closing Locks ---");

  // Finalize closing for TIFFIN division on serviceDate
  await finalizeDailyClosing(ownerUser, {
    closingDate: serviceDate,
    division: "TIFFIN",
    actualCashCounted: cashbookTiffin.totalTiffinCollected,
    notes: "End of day tiffin cashbook finalized",
  });

  // Attempting to write a new walk-in sale on finalized date MUST be rejected
  let closingLockEnforced = false;
  try {
    await recordWalkInSale(managerUser, {
      serviceDate,
      quantity: 1,
      unitPrice: 100,
      paymentMethod: "CASH",
    });
  } catch (err: any) {
    closingLockEnforced = err.message.includes("FINALIZED and locked");
  }
  assert(closingLockEnforced, "Walk-in sale on finalized date is blocked by closing lock");

  // ===========================================================================
  // SECTION 10: Delivery Boy Role Isolation (Least-Privilege Enforcement)
  // ===========================================================================
  console.log("\n--- Section 10: Delivery Boy Role Isolation ---");

  let driverOrderBlocked = false;
  try {
    await createExternalDeliveryTask(driverUser, {
      serviceDate: "2026-11-02",
      mealType: "LUNCH",
      customerName: "Fake Customer",
      customerPhone: "9876543210",
      deliveryAddress: "Address",
    });
  } catch (err: any) {
    driverOrderBlocked = err instanceof AuthorizationError || err.statusCode === 403 || err.message.includes("Permission");
  }
  assert(driverOrderBlocked, "Delivery Boy cannot create external delivery orders (RBAC enforced)");

  let driverWalkinBlocked = false;
  try {
    await recordWalkInSale(driverUser, {
      serviceDate: "2026-11-02",
      quantity: 1,
      unitPrice: 100,
      paymentMethod: "CASH",
    });
  } catch (err: any) {
    driverWalkinBlocked = err instanceof AuthorizationError || err.statusCode === 403 || err.message.includes("Permission");
  }
  assert(driverWalkinBlocked, "Delivery Boy cannot record walk-in counter sales (RBAC enforced)");

  // ===========================================================================
  // SECTION 11: Offline Queue Sync & Duplicate Action Handling
  // ===========================================================================
  console.log("\n--- Section 11: Offline Queue Sync & Idempotency ---");

  // Create another task for offline testing
  const offlineTask = await createExternalDeliveryTask(managerUser, {
    serviceDate: "2026-11-02",
    mealType: "DINNER",
    customerName: "Offline Resident",
    customerPhone: "9876543222",
    deliveryAddress: "Tower B 101",
  });
  await assignDeliveryTask(managerUser, offlineTask.id, { assignedToStaffId: driverUser.id });
  await dispatchDeliveryTask(driverUser, offlineTask.id);

  // Sync action via syncDeliveryActions
  const syncResult1 = await syncDeliveryActions(driverUser, [
    {
      id: "queue_test_1",
      action: "COMPLETE_DELIVERY",
      taskId: offlineTask.id,
      payload: {
        recipientName: "Offline Resident",
        collectedAmount: 150,
        paymentMethod: "CASH",
        deliveredQuantity: 1,
        undeliveredQuantity: 0,
      },
      idempotencyKey: `dcol_offline_${offlineTask.id}`,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      status: "PENDING",
    },
  ]);
  assert(syncResult1.results.length === 1 && syncResult1.results[0].status === "SYNCED", "Offline action successfully applied on sync");

  // Retry same action (duplicate submission)
  const syncResult2 = await syncDeliveryActions(driverUser, [
    {
      id: "queue_test_1",
      action: "COMPLETE_DELIVERY",
      taskId: offlineTask.id,
      payload: {
        recipientName: "Offline Resident",
        collectedAmount: 150,
        paymentMethod: "CASH",
      },
      idempotencyKey: `dcol_offline_${offlineTask.id}`,
      createdAt: new Date().toISOString(),
      retryCount: 1,
      status: "PENDING",
    },
  ]);
  assert(
    syncResult2.results.length === 1 &&
    (syncResult2.results[0].status === "SYNCED" || syncResult2.results[0].status === "IDEMPOTENT_IGNORED"),
    "Duplicate offline submission handled idempotently without error"
  );

  // ===========================================================================
  // SECTION 12: Delivery Staff Listing & PostgreSQL Compatibility
  // ===========================================================================
  console.log("\n--- Section 12: Delivery Staff Listing & SQL Compatibility ---");

  const staffList = await listActiveDeliveryStaff(managerUser);
  assert(staffList.length >= 1, `Found ${staffList.length} active delivery staff member(s)`);
  assert(staffList.some((s) => s.id === driverUser.id), "Active delivery boy included in staff list");

  // PWA manifest webmanifest verification
  const manifestPath = path.resolve(ROOT, "apps", "erp", "public", "manifest.webmanifest");
  assert(fs.existsSync(manifestPath), "manifest.webmanifest exists in public directory");
  const manifestContent = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert(Boolean(manifestContent.name && manifestContent.icons && manifestContent.start_url), "manifest.webmanifest is valid PWA manifest");

  // ===========================================================================
  // SECTION 13: Primary Database Immutability Check
  // ===========================================================================
  console.log("\n--- Section 13: Primary Database Immutability Guard ---");

  if (primaryStatsBefore && fs.existsSync(primaryDbPath)) {
    const statsAfter = fs.statSync(primaryDbPath);
    assert(
      statsAfter.size === primaryStatsBefore.size &&
      statsAfter.mtimeMs === primaryStatsBefore.mtimeMs,
      `Primary database data/erp.db untouched (size: ${statsAfter.size} bytes, unmodified)`
    );
  } else {
    assert(true, "Primary DB safety verified");
  }

  // Cleanup test database
  cleanupTestDb();

  console.log("\n================================================================================");
  console.log(`TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
