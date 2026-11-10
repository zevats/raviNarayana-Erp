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
} from "../apps/erp/src/server/tiffin/tiffinService";
import {
  createMealPlan,
  confirmMealPlan,
} from "../apps/erp/src/server/kitchen/kitchenService";
import {
  createExternalDeliveryTask,
  getCanonicalSureshDeliveryStaff,
  getFleetCustodySummary,
  getDriverCustodySummary,
  completeDeliveryTask,
  createCashHandoverDeclaration,
  acceptCashHandover,
  listDeliveryTasks,
} from "../apps/erp/src/server/delivery/deliveryService";
import {
  createUnifiedOrder,
  listUnifiedOrders,
  getCustomerOrderHistory,
} from "../apps/erp/src/server/orders/orderService";
import {
  getCashbookSummary,
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

// Isolated disposable test DB for Task 01B.70
const TEST_DB_PATH = path.resolve(ROOT, "tests", "test_task70_two_page_workflow.db");

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
  console.log("TASK 01B.70 — TIFFIN OPERATIONS REDESIGN & TWO-PAGE WORKFLOW TEST SUITE");
  console.log("================================================================================\n");

  // 1. Initialize isolated SQLite DB
  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma("foreign_keys = ON");
  runMigrations(sqlite);
  sqlite.close();

  const db = getAsyncDb();

  // Test Actors (3 Canonical Roles)
  const ownerUser: AuthenticatedUser = {
    id: "usr_owner_70",
    username: "owner_ramesh",
    email: "ramesh@ravinarayan.in",
    fullName: "Ramesh Narayana (Owner)",
    role: "SUPER_ADMIN",
  };

  const managerUser: AuthenticatedUser = {
    id: "usr_mgr_70",
    username: "mgr_deepak",
    email: "deepak@ravinarayan.in",
    fullName: "Deepak Verma (Manager)",
    role: "OPERATIONS_MANAGER",
  };

  const sureshDeliveryUser: AuthenticatedUser = {
    id: "usr_suresh_70",
    username: "suresh_del",
    email: "suresh.del@ravinarayan.in",
    fullName: "Suresh Singh",
    role: "DELIVERY_PERSON",
  };

  // Seed staff users in isolated test DB
  const now = new Date().toISOString();
  for (const u of [ownerUser, managerUser, sureshDeliveryUser]) {
    await db.execute(`
      INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'dummy_hash', ?, 1, ?, ?)
    `, [u.id, u.username, u.email, u.fullName, u.role, now, now]);
  }

  // Seed Menu Catalog Product
  const thaliProduct = await createTiffinProduct(ownerUser, {
    code: "PUNJABI_THALI_01",
    name: "Special Punjabi Thali",
    category: "STANDARD_MEAL",
    billingUnit: "PER_MEAL",
    price: 150,
    description: "4 Rotis, Paneer Sabzi, Dal Makhani, Jeera Rice, Salad, Sweet",
  }, undefined, db);

  const lassiProduct = await createTiffinProduct(ownerUser, {
    code: "MANGO_LASSI_01",
    name: "Sweet Mango Lassi",
    category: "BEVERAGE",
    billingUnit: "PER_MEAL",
    price: 50,
    description: "Chilled fresh mango yogurt beverage",
  }, undefined, db);

  // --------------------------------------------------------------------------
  // SECTION 1: Automatic Identification of Suresh (Canonical Delivery Boy)
  // --------------------------------------------------------------------------
  console.log("--- Section 1: Default Delivery Person Resolution (configured, no name matching) ---");
  // ISSUE-009: the default driver comes from ERP_DEFAULT_DELIVERY_USERNAME, not from matching
  // a personal name. A newer driver whose name contains "Suresh" must not be preferred.
  const decoyDriverId = "usr_decoy_suresh_70";
  const later = new Date(Date.now() + 60_000).toISOString();
  await db.execute(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, 'driver_two_70', 'driver.two70@example.invalid', 'Suresh Kumar (Second Driver)', 'dummy_hash', 'DELIVERY_PERSON', 1, ?, ?)
  `, [decoyDriverId, later, later]);

  const originalDefaultDriver = process.env.ERP_DEFAULT_DELIVERY_USERNAME;
  process.env.ERP_DEFAULT_DELIVERY_USERNAME = "driver_two_70";
  const configuredDriver = await getCanonicalSureshDeliveryStaff(db);
  assert(configuredDriver?.id === decoyDriverId, "ERP_DEFAULT_DELIVERY_USERNAME selects the configured delivery person");

  process.env.ERP_DEFAULT_DELIVERY_USERNAME = "suresh_del";
  const canonicalSuresh = await getCanonicalSureshDeliveryStaff(db);
  assert(canonicalSuresh !== null, "Default delivery person resolved from database");
  assert(canonicalSuresh?.id === sureshDeliveryUser.id, `Resolved configured driver ID: ${canonicalSuresh?.id}`);
  assert(canonicalSuresh?.fullName === "Suresh Singh", "Resolved configured driver's full name correctly");
  assert(canonicalSuresh?.username === "suresh_del", "Matched configured username 'suresh_del'");
  // Remove the decoy from the active fleet so later sections see the original single-driver fixture.
  await db.execute(`UPDATE staff_users SET is_active = 0 WHERE id = ?`, [decoyDriverId]);
  // Keep the configured default for the rest of this suite; restore at the end of the run.
  process.on("exit", () => {
    if (originalDefaultDriver === undefined) delete process.env.ERP_DEFAULT_DELIVERY_USERNAME;
    else process.env.ERP_DEFAULT_DELIVERY_USERNAME = originalDefaultDriver;
  });

  // --------------------------------------------------------------------------
  // SECTION 2: Order Creation (Page A — Delivery Flow & Auto-Assignment)
  // --------------------------------------------------------------------------
  console.log("\n--- Section 2: Order Creation (Page A — Delivery Flow) ---");
  const testDate = "2026-10-24";

  // Create Delivery Order for a new customer
  const deliveryOrder1 = await createUnifiedOrder(
    managerUser,
    {
      orderType: "DELIVERY",
      customerName: "Vikas Sharma",
      customerPhone: "9876543210",
      deliveryAddress: "Flat 402, Block B, Krishna Residency, Jhajjar",
      serviceDate: testDate,
      mealType: "LUNCH",
      items: [
        {
          productId: thaliProduct.id,
          productName: thaliProduct.name,
          quantity: 2,
          unitPrice: thaliProduct.price,
        },
        {
          productId: lassiProduct.id,
          productName: lassiProduct.name,
          quantity: 1,
          unitPrice: lassiProduct.price,
        },
      ],
      paymentMethod: "CASH",
      notes: "Please deliver before 1:15 PM, ring door bell",
    },
    undefined,
    db
  );

  assert(deliveryOrder1.orderType === "DELIVERY", "Order created with orderType = 'DELIVERY'");
  assert(deliveryOrder1.totalQuantity === 3, "Total portions ordered is 3 (2 Thali + 1 Lassi)");
  assert(deliveryOrder1.totalAmount === 350, `Total order amount is ₹350 (got ₹${deliveryOrder1.totalAmount})`);
  assert(deliveryOrder1.orderStatus === "CONFIRMED", "Order status initialized to CONFIRMED");
  assert(deliveryOrder1.paymentStatus === "PENDING", "Payment status initialized to PENDING");
  assert(deliveryOrder1.deliveryTaskId !== null, "Delivery task ID created and linked");
  assert(deliveryOrder1.assignedTo === sureshDeliveryUser.id, "Delivery order automatically assigned to Suresh");
  assert(deliveryOrder1.assignedToName === "Suresh Singh", "Delivery order stamped with Suresh's name");

  // Verify Customer was auto-provisioned into tiffin_customers
  const customerRow = await db.queryOne<any>(`
    SELECT * FROM tiffin_customers WHERE phone = '9876543210'
  `);
  assert(customerRow !== null, "Customer automatically saved in tiffin_customers for future reuse");
  assert(customerRow.full_name === "Vikas Sharma", "Customer name matches in customer directory");
  assert(customerRow.delivery_address.includes("Krishna Residency"), "Delivery address saved in directory");

  // --------------------------------------------------------------------------
  // SECTION 3: Repeat Customer History & Order Reuse
  // --------------------------------------------------------------------------
  console.log("\n--- Section 3: Repeat Customer Order History & Reuse ---");
  const orderHistory = await getCustomerOrderHistory(managerUser, { phone: "9876543210" }, db);
  assert(orderHistory.length >= 1, `Found ${orderHistory.length} previous order(s) for repeat customer`);
  assert(orderHistory[0].totalAmount === 350, "Past order retains historical total ₹350");
  assert(orderHistory[0].items.length === 2, "Past order contains 2 items (Thali + Lassi)");

  // Reusing previous order pattern with adjusted quantities (1 Thali instead of 2)
  const repeatDeliveryOrder = await createUnifiedOrder(
    managerUser,
    {
      orderType: "DELIVERY",
      customerId: customerRow.id,
      customerName: customerRow.full_name,
      customerPhone: customerRow.phone,
      deliveryAddress: customerRow.delivery_address,
      serviceDate: testDate,
      mealType: "DINNER",
      items: [
        {
          productId: thaliProduct.id,
          productName: thaliProduct.name,
          quantity: 1, // Adjusted from 2 to 1
          unitPrice: thaliProduct.price,
        },
      ],
      paymentMethod: "CASH",
      notes: "Repeat order for dinner",
    },
    undefined,
    db
  );

  assert(repeatDeliveryOrder.totalQuantity === 1, "Repeat order created with adjusted quantity: 1 Thali");
  assert(repeatDeliveryOrder.totalAmount === 150, "Repeat order total is ₹150");
  assert(repeatDeliveryOrder.assignedTo === sureshDeliveryUser.id, "Repeat order automatically assigned to Suresh");

  // --------------------------------------------------------------------------
  // SECTION 4: Order Creation (Page A — Dine-In Counter Flow)
  // --------------------------------------------------------------------------
  console.log("\n--- Section 4: Order Creation (Page A — Dine-In Flow) ---");
  const dineInOrder = await createUnifiedOrder(
    managerUser,
    {
      orderType: "DINE_IN",
      customerName: "Walk-in Guest Amit",
      customerPhone: "9811122233",
      serviceDate: testDate,
      mealType: "LUNCH",
      items: [
        {
          productId: thaliProduct.id,
          productName: thaliProduct.name,
          quantity: 2,
          unitPrice: thaliProduct.price,
        },
      ],
      paymentMethod: "UPI",
      notes: "Mess table 4 counter sale",
    },
    undefined,
    db
  );

  assert(dineInOrder.orderType === "DINE_IN", "Dine-in order created with orderType = 'DINE_IN'");
  assert(dineInOrder.totalAmount === 300, "Dine-in order amount is ₹300");
  assert(dineInOrder.orderStatus === "COMPLETED", "Dine-in order instantly completed");
  assert(dineInOrder.paymentStatus === "PAID", "Dine-in order marked PAID");
  assert(dineInOrder.deliveryTaskId === null, "No delivery task created for dine-in order");

  // Verify financial transaction created under category TIFFIN_WALKIN_SALE
  const dineInTx = await db.queryOne<any>(`
    SELECT * FROM financial_transactions WHERE id = ?
  `, [dineInOrder.id]);
  assert(dineInTx !== null, "Dine-in sale posted directly to financial_transactions");
  assert(dineInTx.category === "TIFFIN_WALKIN_SALE", "Transaction category is 'TIFFIN_WALKIN_SALE'");
  assert(dineInTx.amount === 300, "Transaction amount is ₹300");
  assert(dineInTx.payment_method === "UPI", "Payment method is 'UPI'");

  // --------------------------------------------------------------------------
  // SECTION 5: Orders Page Listing & Real Counts
  // --------------------------------------------------------------------------
  console.log("\n--- Section 5: Orders Page Listing & Real Counts ---");
  const ordersListResult = await listUnifiedOrders(managerUser, { serviceDate: testDate }, db);
  assert(ordersListResult.orders.length === 3, `Found 3 total orders for date (got ${ordersListResult.orders.length})`);
  assert(ordersListResult.counts.today === 3, "Real counts: today = 3");
  assert(ordersListResult.counts.active === 2, "Real counts: active delivery orders = 2");
  assert(ordersListResult.counts.completed === 1, "Real counts: completed dine-in orders = 1");

  // --------------------------------------------------------------------------
  // SECTION 6: Page B — Delivery Completion (Complementary Quantities & Reconciliation)
  // --------------------------------------------------------------------------
  console.log("\n--- Section 6: Delivery Completion & Single-Screen Numeric Form ---");
  const taskIdToDeliver = deliveryOrder1.deliveryTaskId!;

  // Case A: Partial Delivery with Shortfall Reason
  // Total ordered was 3. Customer takes 2 portions, 1 portion returned/canceled.
  // Entering delivered = 2 automatically computes undelivered = 1.
  const deliveredPortions = 2;
  const undeliveredPortions = 1; // 3 - 2
  const shortfallReason = "Customer requested only 2 portions at door, 1 lassi canceled";

  // Reconciled amount expected: 2 portions delivered * ₹150 = ₹300 (or item level calculation)
  const itemReconciliation = [
    {
      productName: thaliProduct.name,
      orderedQuantity: 2,
      deliveredQuantity: 2,
      undeliveredQuantity: 0,
      unitPrice: thaliProduct.price,
    },
    {
      productName: lassiProduct.name,
      orderedQuantity: 1,
      deliveredQuantity: 0,
      undeliveredQuantity: 1,
      undeliveredReason: shortfallReason,
      unitPrice: lassiProduct.price,
    },
  ];
  const expectedAmount = 2 * 150 + 0 * 50; // ₹300
  // Order-backed deliveries record one outcome per order line (structured order_items).
  const orderLines = await db.query<{ id: string; product_name: string; quantity: number }>(
    `SELECT oi.id, oi.product_name, oi.quantity FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.delivery_task_id = ? ORDER BY oi.line_no`,
    [taskIdToDeliver]
  );
  const lineOutcomes = orderLines.map((l) => {
    const delivered = l.product_name === lassiProduct.name ? 0 : Number(l.quantity);
    return { orderItemId: l.id, deliveredQuantity: delivered, undeliveredQuantity: Number(l.quantity) - delivered };
  });

  // 1. Validation test: Shortfall without reason is rejected
  let shortfallWithoutReasonBlocked = false;
  try {
    await completeDeliveryTask(
      sureshDeliveryUser,
      taskIdToDeliver,
      {
        lines: lineOutcomes,
        undeliveredReason: "", // Empty reason should fail
      },
      undefined,
      db
    );
  } catch (err: any) {
    shortfallWithoutReasonBlocked = err.message.includes("A reason is required");
  }
  assert(shortfallWithoutReasonBlocked, "Validation Guard: Undelivered portions require mandatory shortfall reason");

  // 2. Legitimate partial delivery completion with doorstep collection
  const completedDelivery = await completeDeliveryTask(
    sureshDeliveryUser,
    taskIdToDeliver,
    {
      recipientName: "Vikas Sharma (Self)",
      deliveredQuantity: deliveredPortions,
      undeliveredQuantity: undeliveredPortions,
      undeliveredReason: shortfallReason,
      itemsReconciliation: itemReconciliation,
      lines: lineOutcomes,
      collectedAmount: expectedAmount, // Collected ₹300 in cash
      paymentMethod: "CASH",
      notes: "Handed over at door, ₹300 collected in cash",
    },
    undefined,
    db
  );

  assert(completedDelivery.status === "DELIVERED", "Delivery task status transitioned to DELIVERED");
  assert(completedDelivery.deliveredBy === sureshDeliveryUser.id, "Delivery stamped with Suresh's ID");
  assert(completedDelivery.recipientName === "Vikas Sharma (Self)", "Handover recipient recorded");
  assert(completedDelivery.collectedAmount === 300, "Collected amount saved as ₹300");
  assert(completedDelivery.collectedPaymentMethod === "CASH", "Payment method saved as CASH");
  assert(completedDelivery.collectionStatus === "COLLECTED", "Collection status updated to 'COLLECTED'");
  const recordedLines = await db.query<{ product_name: string; delivered_quantity: number; undelivered_reason: string | null }>(
    `SELECT oi.product_name, oi.delivered_quantity, oi.undelivered_reason FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.delivery_task_id = ? ORDER BY oi.line_no`,
    [taskIdToDeliver]
  );
  const lassiLine = recordedLines.find((l) => l.product_name === lassiProduct.name);
  assert(
    Boolean(lassiLine) && Number(lassiLine!.delivered_quantity) === 0 && lassiLine!.undelivered_reason === shortfallReason,
    "Per-line outcome stored: undelivered item has delivered 0 and the shortfall reason"
  );
  assert(completedDelivery.expectedAmount === 300 && completedDelivery.balanceDue === 0, "Amount due from delivered lines is ₹300, balance ₹0");

  // --------------------------------------------------------------------------
  // SECTION 7: Driver Cash Custody & Fleet Handover Summary (Fixing HTTP 400)
  // --------------------------------------------------------------------------
  console.log("\n--- Section 7: Cash Custody, Fleet Summary & Handover HTTP 400 Fix ---");

  // 1. Suresh checks his own custody summary
  const sureshCustody = await getDriverCustodySummary(sureshDeliveryUser, sureshDeliveryUser.id, testDate, db);
  assert(sureshCustody.cashInCustody === 300, `Suresh cash custody is ₹300 (got ₹${sureshCustody.cashInCustody})`);
  assert(sureshCustody.totalCashCollected === 300, "Total cash collected is ₹300");
  assert(sureshCustody.totalAcceptedHandover === 0, "No handovers accepted yet (₹0)");

  // 2. Owner requests FLEET AGGREGATE summary (No driverId passed -> HTTP 200, no 400 error!)
  const fleetSummary = await getFleetCustodySummary(ownerUser, testDate, db);
  assert(fleetSummary.driverId === "FLEET_AGGREGATE", "Fleet summary returns 'FLEET_AGGREGATE'");
  assert(fleetSummary.cashInCustody === 300, "Fleet summary shows ₹300 total pending custody");
  assert(fleetSummary.activeDriverCount === 1, "Fleet summary reports 1 active delivery driver");

  // 3. Suresh declares cash handover of ₹300 to manager
  const declaration = await createCashHandoverDeclaration(
    sureshDeliveryUser,
    {
      shiftDate: testDate,
      declaredCash: 300,
      notes: "Lunch shift complete collections",
    },
    undefined,
    db
  );
  assert(declaration.status === "DECLARED", "Handover declaration status is 'DECLARED'");
  assert(declaration.declaredCash === 300, "Declared cash is ₹300");

  // 4. Manager physically counts cash and accepts handover
  const acceptedHandover = await acceptCashHandover(
    managerUser,
    declaration.id,
    {
      acceptedCash: 300,
      notes: "Cash physically counted and verified by manager",
    },
    undefined,
    db
  );
  assert(acceptedHandover.status === "ACCEPTED", "Handover status transitioned to 'ACCEPTED'");
  assert(acceptedHandover.acceptedCash === 300, "Accepted cash is ₹300");

  // 5. Custody resets to ₹0 after acceptance
  const sureshCustodyAfter = await getDriverCustodySummary(sureshDeliveryUser, sureshDeliveryUser.id, testDate, db);
  assert(sureshCustodyAfter.cashInCustody === 0, "Suresh cash in custody is now ₹0 after acceptance");
  assert(sureshCustodyAfter.totalAcceptedHandover === 300, "Total accepted handovers updated to ₹300");

  // --------------------------------------------------------------------------
  // SECTION 8: Manifest and Mobile Metadata Verification
  // --------------------------------------------------------------------------
  console.log("\n--- Section 8: PWA Manifest & Mobile Web App Capable Metadata ---");
  const manifestPath = path.resolve(ROOT, "apps", "erp", "public", "manifest.webmanifest");
  assert(fs.existsSync(manifestPath), "public/manifest.webmanifest exists on filesystem");

  const manifestContent = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert(manifestContent.name.includes("Ravinarayan"), "Manifest contains valid name");
  assert(manifestContent.display === "standalone", "Manifest display mode is 'standalone'");
  assert(manifestContent.icons && manifestContent.icons.length >= 2, "Manifest includes required app icons");

  const layoutPath = path.resolve(ROOT, "apps", "erp", "src", "app", "layout.tsx");
  const layoutContent = fs.readFileSync(layoutPath, "utf-8");
  assert(
    layoutContent.includes('"mobile-web-app-capable": "yes"') || layoutContent.includes("mobile-web-app-capable"),
    "layout.tsx includes recommended 'mobile-web-app-capable' metadata"
  );

  // --------------------------------------------------------------------------
  // SECTION 9: Navigation & Route Consolidation (Exact Two Pages)
  // --------------------------------------------------------------------------
  console.log("\n--- Section 9: Navigation & Route Consolidation ---");
  const erpShellPath = path.resolve(ROOT, "apps", "erp", "src", "components", "layout", "ErpShell.tsx");
  // The manager links live in shell/nav.ts since the 2026-11 redesign.
  const erpShellContent = fs.readFileSync(erpShellPath, "utf-8") + fs.readFileSync(path.join(path.dirname(erpShellPath), "shell", "nav.ts"), "utf-8");

  assert(erpShellContent.includes('href: "/orders"'), "Navigation includes Orders ('/orders')");
  assert(erpShellContent.includes('href: "/delivery"'), "Navigation includes Delivery ('/delivery')");
  assert(!erpShellContent.includes('href: "/kitchen"'), "Separate Kitchen page removed from operational navigation");
  // Tiffin management was restored as its own section (2026-11-01 scope decision); Kitchen stays retired.
  assert(erpShellContent.includes('href: "/tiffin"'), "Navigation includes Tiffin management ('/tiffin')");

  // Verify redirects on old routes
  const kitchenPagePath = path.resolve(ROOT, "apps", "erp", "src", "app", "(management)", "kitchen", "page.tsx");
  const kitchenPageContent = fs.readFileSync(kitchenPagePath, "utf-8");
  // Server-side redirect since the performance round (no intermediate client render).
  assert(kitchenPageContent.includes('redirect("/orders")'), "/kitchen redirects cleanly to /orders");

  const tiffinPagePath = path.resolve(ROOT, "apps", "erp", "src", "app", "(management)", "tiffin", "page.tsx");
  const tiffinPageContent = fs.readFileSync(tiffinPagePath, "utf-8");
  assert(!tiffinPageContent.includes('redirect(') && tiffinPageContent.includes("SubscriptionsView"), "/tiffin is the Tiffin management page (customers, subscriptions, billing)");

  // --------------------------------------------------------------------------
  // SECTION 10: Primary Database Immutability Guard
  // --------------------------------------------------------------------------
  console.log("\n--- Section 10: Primary Database Immutability Guard ---");
  if (primaryStatsBefore) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(
      primaryStatsBefore.size === primaryStatsAfter.size,
      `Primary DB size unchanged: ${primaryStatsBefore.size} bytes`
    );
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs,
      "Primary DB modification timestamp completely unmodified"
    );
  } else {
    assert(true, "Primary DB was not present; untouched.");
  }

  // Final Results
  console.log("\n================================================================================");
  console.log(`TEST SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  cleanupTestDb();

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  cleanupTestDb();
  process.exit(1);
});
