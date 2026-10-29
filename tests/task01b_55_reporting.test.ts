import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { closeDb, getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import {
  createRoom,
  listRooms,
} from "../apps/erp/src/server/rooms/roomService";
import {
  registerResident,
  assignResidentToRoom,
} from "../apps/erp/src/server/residents/residentService";
import {
  recordRentCharge,
  recordRentPayment,
  recordSecurityDeposit,
  recordExpense,
  getCashbookSummary,
  listTransactions,
} from "../apps/erp/src/server/finance/financeService";
import {
  createInvoice,
  issueInvoice,
  allocatePaymentToInvoice,
} from "../apps/erp/src/server/finance/invoiceService";
import {
  getMultiDivisionFinancialReport,
  getInvoiceAgeingReport,
  getOperationalReconciliationReport,
  getPropertyCapacityAudit,
} from "../apps/erp/src/server/reports/businessReportingService";
import {
  getDashboardMetrics,
  invalidateDashboardCache,
} from "../apps/erp/src/server/dashboard/dashboardService";
import {
  createRawMaterial,
  recordStockReceipt,
  recordMaterialWaste,
} from "../apps/erp/src/server/kitchen/kitchenInventoryService";
import {
  createExternalDeliveryTask,
} from "../apps/erp/src/server/delivery/deliveryService";
import { AuthenticatedUser } from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test database
const TEST_REPORTING55_DB_PATH = path.resolve(__dirname, "test_task55_reporting.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_REPORTING55_DB_PATH)) fs.unlinkSync(TEST_REPORTING55_DB_PATH);
  const wal = `${TEST_REPORTING55_DB_PATH}-wal`;
  const shm = `${TEST_REPORTING55_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_REPORTING55_DB_PATH;

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

// Actor roles
const superAdminActor: AuthenticatedUser = {
  id: "staff_super_admin",
  username: "superadmin",
  email: "admin@ravinarayan.com",
  fullName: "Dr. Ravinder Gulia",
  role: "SUPER_ADMIN",
};

const managerActor: AuthenticatedUser = {
  id: "staff_manager_01",
  username: "manager1",
  email: "manager@ravinarayan.com",
  fullName: "Virender Singh",
  role: "OPERATIONS_MANAGER",
};

const accountantActor: AuthenticatedUser = {
  id: "staff_accountant_01",
  username: "accountant1",
  email: "accountant@ravinarayan.com",
  fullName: "Sunita Sharma",
  role: "ACCOUNTANT",
};

const kitchenActor: AuthenticatedUser = {
  id: "staff_kitchen_01",
  username: "kitchen1",
  email: "kitchen@ravinarayan.com",
  fullName: "Ramesh Cook",
  role: "KITCHEN_OPERATIONS",
};

const deliveryActor: AuthenticatedUser = {
  id: "staff_delivery_01",
  username: "delivery1",
  email: "delivery@ravinarayan.com",
  fullName: "Suresh Courier",
  role: "DELIVERY_PERSON",
};

async function runAllTests() {
  console.log("================================================================================");
  console.log("TASK 01B.55 REGRESSION TEST SUITE: BUSINESS VIEWS, REPORTING & RECONCILIATION");
  console.log("================================================================================\n");

  // Step 1: Initialize Database with complete migrations
  console.log("--- 1. Initializing isolated database with schema migrations ---");
  const rawDb = new Database(TEST_REPORTING55_DB_PATH);
  runMigrations(rawDb);
  rawDb.close();

  const db = getAsyncDb();
  const vRow = await db.queryOne<{ user_version: number }>("PRAGMA user_version");
  assert((vRow?.user_version ?? 0) >= 18, `Database user_version successfully advanced (got ${vRow?.user_version})`);

  // Seed Staff Users
  const staffSeed = [superAdminActor, managerActor, accountantActor, kitchenActor, deliveryActor];
  for (const s of staffSeed) {
    await db.execute(
      `INSERT INTO staff_users (id, username, email, password_hash, full_name, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'hash', ?, ?, 1, datetime('now'), datetime('now'))`,
      [s.id, s.username, s.email, s.fullName, s.role]
    );
  }
  assert(true, "Seeded staff users across all 5 roles");

  // ============================================================================
  // TEST SUITE 1: Authoritative Room & Bed Layout Property Capacity Audit
  // ============================================================================
  console.log("\n--- TEST SUITE 1: Property Capacity Audit & Authoritative Layout ---");

  // Provision authoritative 22-room layout
  // 5 Out-house rooms (Single, cap 1 = 5 beds)
  for (let i = 1; i <= 5; i++) {
    await createRoom(managerActor, {
      roomNumber: `OL${i}`,
      floor: 0,
      type: "SINGLE",
      capacity: 1,
      baseRentMonthly: 12000,
    }, undefined, db);
  }

  // 8 Ground Floor rooms (Double, cap 2 = 16 beds)
  for (let i = 1; i <= 8; i++) {
    await createRoom(managerActor, {
      roomNumber: `00${i}`,
      floor: 0,
      type: "DOUBLE_SHARING",
      capacity: 2,
      baseRentMonthly: 8500,
    }, undefined, db);
  }

  // 2 First Floor rooms (Triple, cap 3 = 6 beds)
  for (let i = 1; i <= 2; i++) {
    await createRoom(managerActor, {
      roomNumber: `10${i}`,
      floor: 1,
      type: "TRIPLE_SHARING",
      capacity: 3,
      baseRentMonthly: 7000,
    }, undefined, db);
  }

  // 6 First Floor rooms (Double, cap 2 = 12 beds)
  for (let i = 3; i <= 8; i++) {
    await createRoom(managerActor, {
      roomNumber: `10${i}`,
      floor: 1,
      type: "DOUBLE_SHARING",
      capacity: 2,
      baseRentMonthly: 9000,
    }, undefined, db);
  }

  // 1 Upper Floor Master Suite (M01, cap 2 = 2 beds provisioned in DB)
  await createRoom(managerActor, {
    roomNumber: "M01",
    floor: 2,
    type: "EXECUTIVE_SUITE",
    capacity: 2,
    baseRentMonthly: 18000,
  }, undefined, db);

  const capacityAudit = await getPropertyCapacityAudit(managerActor, db);
  assert(capacityAudit.totalRooms === 22, `Audit reports exactly 22 total rooms (got ${capacityAudit.totalRooms})`);
  assert(capacityAudit.activeRooms === 22, `All 22 rooms active (got ${capacityAudit.activeRooms})`);
  assert(capacityAudit.confirmedPhysicalBeds === 39, `Confirmed physical beds is 39 (got ${capacityAudit.confirmedPhysicalBeds})`);
  assert(capacityAudit.provisionedCapacity === 41, `Total provisioned capacity is 41 (got ${capacityAudit.provisionedCapacity})`);
  assert(capacityAudit.unconfirmedBeds === 2, `Unconfirmed beds in suite M01 is 2 (got ${capacityAudit.unconfirmedBeds})`);
  assert(capacityAudit.masterSuiteStatus.roomNumber === "M01", "Master suite room number is M01");
  assert(capacityAudit.masterSuiteStatus.status === "PENDING_OWNER_CONFIRMATION", "Master suite marked pending confirmation");
  assert(capacityAudit.totalOccupiedBeds === 0, "Initial occupied beds is 0");
  assert(capacityAudit.totalVacantBeds === 41, "Initial vacant beds is 41");

  // Check-in a resident into Room OL1
  const resident1 = await registerResident(managerActor, {
    fullName: "Amit Kumar",
    phone: "9876543210",
  }, undefined, db);

  const allRooms = await listRooms(managerActor, {}, db);
  const ol1 = allRooms.find((r) => r.roomNumber === "OL1")!;
  const stay = await assignResidentToRoom(managerActor, {
    residentId: resident1.id,
    roomId: ol1.id,
    checkInDate: "2026-10-01",
    monthlyRent: 12000,
    securityDeposit: 12000,
  }, undefined, db);

  const updatedAudit = await getPropertyCapacityAudit(managerActor, db);
  assert(updatedAudit.totalOccupiedBeds === 1, "Audit reports exactly 1 occupied bed after check-in");
  assert(updatedAudit.totalVacantBeds === 40, "Audit reports 40 vacant beds");
  const ol1Audit = updatedAudit.rooms.find((r) => r.roomNumber === "OL1")!;
  assert(ol1Audit.occupiedBeds === 1, "OL1 occupiedBeds is 1");
  assert(ol1Audit.availableBeds === 0, "OL1 availableBeds is 0");
  assert(ol1Audit.occupants.length === 1 && ol1Audit.occupants[0].residentName === "Amit Kumar", "Occupant accurately listed in audit");

  // ============================================================================
  // TEST SUITE 2: Multi-Division Financial Reporting Isolation
  // ============================================================================
  console.log("\n--- TEST SUITE 2: Multi-Division Financial Reporting (COMBINED vs PG vs TIFFIN) ---");

  const todayIso = "2026-10-15";
  // 1. Post PG Rent Charge: ₹12,000 on 2026-10-01
  await recordRentCharge(accountantActor, {
    residentId: resident1.id,
    stayId: stay.id,
    amount: 12000,
    billingPeriod: "October 2026",
    transactionDate: "2026-10-01",
    description: "October 2026 Room Rent",
  }, undefined, db);

  // 2. Post PG Rent Payment: ₹12,000 via UPI on 2026-10-05
  await recordRentPayment(accountantActor, {
    residentId: resident1.id,
    amount: 12000,
    paymentMethod: "UPI",
    transactionDate: "2026-10-05",
    description: "Rent Payment via UPI",
  }, undefined, db);

  // 3. Post PG Security Deposit: ₹12,000 via CASH on 2026-10-01
  await recordSecurityDeposit(accountantActor, {
    residentId: resident1.id,
    amount: 12000,
    paymentMethod: "CASH",
    transactionDate: "2026-10-01",
    description: "Security Deposit received in cash",
  }, undefined, db);

  // 4. Post PG Operating Expense: Maintenance ₹3,000 via BANK_TRANSFER on 2026-10-10
  await recordExpense(accountantActor, {
    category: "MAINTENANCE",
    amount: 3000,
    paymentMethod: "BANK_TRANSFER",
    transactionDate: "2026-10-10",
    payeeVendor: "Plumbing Services Ltd",
    description: "Plumbing repair on 1st floor",
  }, undefined, db);

  // 5. Seed Commercial Tiffin Customer & post Tiffin Payment: ₹5,000 via UPI on 2026-10-12
  const customerId = "cust_tiffin_01";
  await db.execute(
    `INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, status, created_by, created_at, updated_at)
     VALUES (?, 'Vikram Seth', '9123456780', 'Tech Park, Gurgaon', 'ACTIVE', ?, datetime('now'), datetime('now'))`,
    [customerId, accountantActor.id]
  );

  const tiffinTxId = `txn_tif_${Date.now()}`;
  await db.execute(
    `INSERT INTO financial_transactions (
       id, transaction_type, amount, transaction_date, payment_method,
       customer_id, category, description, status, created_by, created_at, updated_at
     ) VALUES (?, 'TIFFIN_PAYMENT', 5000, '2026-10-12', 'UPI', ?, 'TIFFIN_MEAL', 'Monthly Tiffin Subscription', 'POSTED', ?, datetime('now'), datetime('now'))`,
    [tiffinTxId, customerId, accountantActor.id]
  );

  // 6. Post Kitchen Operating Expense: Grocery ₹2,000 via CASH on 2026-10-14
  await recordExpense(accountantActor, {
    category: "GROCERY",
    amount: 2000,
    paymentMethod: "CASH",
    transactionDate: "2026-10-14",
    payeeVendor: "Local Sabzi Mandi",
    description: "Vegetables and rice purchase",
  }, undefined, db);

  // Generate Multi-Division Financial Report for October 2026
  const multiReport = await getMultiDivisionFinancialReport(
    accountantActor,
    { startDate: "2026-10-01", endDate: "2026-10-31" },
    db
  );

  assert(multiReport.startDate === "2026-10-01", "Report startDate matches requested range");
  assert(multiReport.endDate === "2026-10-31", "Report endDate matches requested range");

  // Verify PG Division Isolation
  assert(multiReport.pg.division === "PG", "PG division metrics present");
  assert(multiReport.pg.rentCollected === 12000, `PG rent collected is ₹12,000 (got ₹${multiReport.pg.rentCollected})`);
  assert(multiReport.pg.depositsCollected === 12000, `PG deposits collected is ₹12,000 (got ₹${multiReport.pg.depositsCollected})`);
  assert(multiReport.pg.tiffinCollected === 0, `PG tiffin collected is strictly 0 (got ₹${multiReport.pg.tiffinCollected})`);
  assert(multiReport.pg.expensesPaid === 3000, `PG operating expenses is ₹3,000 (got ₹${multiReport.pg.expensesPaid})`);
  assert(multiReport.pg.netCashMovement === 12000 + 12000 - 3000, `PG net cash movement is ₹21,000 (got ₹${multiReport.pg.netCashMovement})`);

  // Verify Tiffin Division Isolation
  assert(multiReport.tiffin.division === "TIFFIN", "Tiffin division metrics present");
  assert(multiReport.tiffin.rentCollected === 0, `Tiffin rent collected is strictly 0 (got ₹${multiReport.tiffin.rentCollected})`);
  assert(multiReport.tiffin.depositsCollected === 0, `Tiffin deposits collected is strictly 0 (got ₹${multiReport.tiffin.depositsCollected})`);
  assert(multiReport.tiffin.tiffinCollected === 5000, `Tiffin collected is ₹5,000 (got ₹${multiReport.tiffin.tiffinCollected})`);
  assert(multiReport.tiffin.expensesPaid === 2000, `Tiffin kitchen grocery expenses is ₹2,000 (got ₹${multiReport.tiffin.expensesPaid})`);
  assert(multiReport.tiffin.netCashMovement === 5000 - 2000, `Tiffin net cash movement is ₹3,000 (got ₹${multiReport.tiffin.netCashMovement})`);

  // Verify Combined Division Aggregation
  assert(multiReport.combined.division === "COMBINED", "Combined division metrics present");
  assert(multiReport.combined.rentCollected === 12000, `Combined rent collected is ₹12,000 (got ₹${multiReport.combined.rentCollected})`);
  assert(multiReport.combined.tiffinCollected === 5000, `Combined tiffin collected is ₹5,000 (got ₹${multiReport.combined.tiffinCollected})`);
  assert(multiReport.combined.totalRevenue === 17000, `Combined total revenue is ₹17,000 (got ₹${multiReport.combined.totalRevenue})`);
  assert(multiReport.combined.expensesPaid === 5000, `Combined total expenses is ₹5,000 (got ₹${multiReport.combined.expensesPaid})`);
  assert(multiReport.combined.netCashMovement === 21000 + 3000, `Combined net cash is ₹24,000 (got ₹${multiReport.combined.netCashMovement})`);

  // Verify Channel Breakdown
  assert(multiReport.channelBreakdown.UPI.inflow === 12000 + 5000, `UPI total inflow is ₹17,000 (got ₹${multiReport.channelBreakdown.UPI.inflow})`);
  assert(multiReport.channelBreakdown.CASH.inflow === 12000, `CASH deposit inflow is ₹12,000 (got ₹${multiReport.channelBreakdown.CASH.inflow})`);
  assert(multiReport.channelBreakdown.CASH.outflow === 2000, `CASH grocery expense outflow is ₹2,000 (got ₹${multiReport.channelBreakdown.CASH.outflow})`);
  assert(multiReport.channelBreakdown.BANK_TRANSFER.outflow === 3000, `BANK_TRANSFER maintenance expense is ₹3,000 (got ₹${multiReport.channelBreakdown.BANK_TRANSFER.outflow})`);

  // ============================================================================
  // TEST SUITE 3: Cashbook Summary & Transactions Division Filtering
  // ============================================================================
  console.log("\n--- TEST SUITE 3: Cashbook Summary & Transaction Listing Filters ---");

  // getCashbookSummary with division: "PG"
  const cashbookPG = await getCashbookSummary(
    accountantActor,
    { startDate: "2026-10-01", endDate: "2026-10-31", division: "PG" },
    db
  );
  assert(cashbookPG.division === "PG", "Cashbook summary division is PG");
  assert(cashbookPG.totalRentCollected === 12000, "PG cashbook rent collected is 12000");
  assert(cashbookPG.totalTiffinCollected === 0, "PG cashbook tiffin collected is 0");
  assert(cashbookPG.totalExpensesPaid === 3000, "PG cashbook expenses paid is 3000");

  // getCashbookSummary with division: "TIFFIN"
  const cashbookTiffin = await getCashbookSummary(
    accountantActor,
    { startDate: "2026-10-01", endDate: "2026-10-31", division: "TIFFIN" },
    db
  );
  assert(cashbookTiffin.division === "TIFFIN", "Cashbook summary division is TIFFIN");
  assert(cashbookTiffin.totalRentCollected === 0, "TIFFIN cashbook rent collected is 0");
  assert(cashbookTiffin.totalTiffinCollected === 5000, "TIFFIN cashbook tiffin collected is 5000");
  assert(cashbookTiffin.totalExpensesPaid === 2000, "TIFFIN cashbook expenses paid is 2000");

  // listTransactions with division: "PG"
  const txPG = await listTransactions(
    accountantActor,
    { division: "PG", startDate: "2026-10-01", endDate: "2026-10-31" },
    db
  );
  assert(txPG.length > 0, `PG transactions returned (count: ${txPG.length})`);
  const hasAnyTiffinTxInPg = txPG.some((t) => t.transactionType === "TIFFIN_PAYMENT" || t.category === "GROCERY");
  assert(!hasAnyTiffinTxInPg, "PG transaction listing strictly excludes commercial tiffin payments and grocery expenses");

  // listTransactions with division: "TIFFIN"
  const txTiffin = await listTransactions(
    accountantActor,
    { division: "TIFFIN", startDate: "2026-10-01", endDate: "2026-10-31" },
    db
  );
  assert(txTiffin.length > 0, `Tiffin transactions returned (count: ${txTiffin.length})`);
  const hasAnyRentTxInTiffin = txTiffin.some((t) => t.transactionType === "RENT_PAYMENT" || t.transactionType === "SECURITY_DEPOSIT");
  assert(!hasAnyRentTxInTiffin, "Tiffin transaction listing strictly excludes PG rent and deposit transactions");

  // ============================================================================
  // TEST SUITE 4: Accounts Receivable Invoice Ageing Schedule
  // ============================================================================
  console.log("\n--- TEST SUITE 4: Accounts Receivable Invoice Ageing Schedule ---");

  const asOfDate = "2026-10-20";

  // Invoice 1: CURRENT (Due on 2026-10-25, not yet due as of 2026-10-20)
  const inv1 = await createInvoice(accountantActor, {
    invoiceCategory: "RESIDENT",
    invoiceType: "REGULAR_BILL",
    residentId: resident1.id,
    billingPeriod: "2026-10",
    issueDate: "2026-10-15",
    dueDate: "2026-10-25",
    items: [{ description: "Advance Utilities", quantity: 1, unitPrice: 2000, taxRate: 0 }],
  }, undefined, db);
  await issueInvoice(accountantActor, inv1.id, undefined, undefined, db);

  // Invoice 2: 1-30 DAYS OVERDUE (Due on 2026-10-05 -> 15 days overdue)
  const inv2 = await createInvoice(accountantActor, {
    invoiceCategory: "RESIDENT",
    invoiceType: "REGULAR_BILL",
    residentId: resident1.id,
    billingPeriod: "2026-10",
    issueDate: "2026-09-25",
    dueDate: "2026-10-05",
    items: [{ description: "Maintenance Dues", quantity: 1, unitPrice: 3500, taxRate: 0 }],
  }, undefined, db);
  await issueInvoice(accountantActor, inv2.id, undefined, undefined, db);

  // Invoice 3: 31-60 DAYS OVERDUE (Due on 2026-09-05 -> 45 days overdue)
  const inv3 = await createInvoice(accountantActor, {
    invoiceCategory: "TIFFIN",
    invoiceType: "REGULAR_BILL",
    customerId,
    billingPeriod: "2026-09",
    issueDate: "2026-08-25",
    dueDate: "2026-09-05",
    items: [{ description: "Monthly Meal Plan August", quantity: 1, unitPrice: 4500, taxRate: 0 }],
  }, undefined, db);
  await issueInvoice(accountantActor, inv3.id, undefined, undefined, db);

  // Invoice 4: 90+ DAYS OVERDUE (Due on 2026-06-15 -> 127 days overdue)
  const inv4 = await createInvoice(accountantActor, {
    invoiceCategory: "RESIDENT",
    invoiceType: "REGULAR_BILL",
    residentId: resident1.id,
    billingPeriod: "2026-06",
    issueDate: "2026-06-01",
    dueDate: "2026-06-15",
    items: [{ description: "Damage Surcharge", quantity: 1, unitPrice: 1500, taxRate: 0 }],
  }, undefined, db);
  await issueInvoice(accountantActor, inv4.id, undefined, undefined, db);

  // Generate Ageing Report as of 2026-10-20
  const ageingReport = await getInvoiceAgeingReport(
    accountantActor,
    { asOfDate },
    db
  );

  assert(ageingReport.asOfDate === asOfDate, "Ageing report asOfDate is 2026-10-20");
  assert(ageingReport.buckets.current.amount === 2000, `Current bucket is ₹2,000 (got ₹${ageingReport.buckets.current.amount})`);
  assert(ageingReport.buckets.days1To30.amount === 3500, `1-30 days bucket is ₹3,500 (got ₹${ageingReport.buckets.days1To30.amount})`);
  assert(ageingReport.buckets.days31To60.amount === 4500, `31-60 days bucket is ₹4,500 (got ₹${ageingReport.buckets.days31To60.amount})`);
  assert(ageingReport.buckets.days61To90.amount === 0, `61-90 days bucket is ₹0 (got ₹${ageingReport.buckets.days61To90.amount})`);
  assert(ageingReport.buckets.days90Plus.amount === 1500, `90+ days bucket is ₹1,500 (got ₹${ageingReport.buckets.days90Plus.amount})`);
  assert(ageingReport.totalOutstanding === 2000 + 3500 + 4500 + 1500, `Total outstanding matches sum of buckets: ₹11,500 (got ₹${ageingReport.totalOutstanding})`);

  // Verify division-specific ageing
  const pgAgeing = await getInvoiceAgeingReport(accountantActor, { division: "PG", asOfDate }, db);
  assert(pgAgeing.totalOutstanding === 2000 + 3500 + 1500, `PG ageing total is ₹7,000 excluding tiffin (got ₹${pgAgeing.totalOutstanding})`);
  assert(pgAgeing.buckets.days31To60.amount === 0, "PG 31-60 days bucket is 0 (tiffin invoice excluded)");

  const tiffinAgeing = await getInvoiceAgeingReport(accountantActor, { division: "TIFFIN", asOfDate }, db);
  assert(tiffinAgeing.totalOutstanding === 4500, `Tiffin ageing total is ₹4,500 (got ₹${tiffinAgeing.totalOutstanding})`);
  assert(tiffinAgeing.buckets.days31To60.amount === 4500, "Tiffin 31-60 days bucket is ₹4,500");

  // ============================================================================
  // TEST SUITE 5: Operational Reconciliation (Kitchen, Inventory, Delivery)
  // ============================================================================
  console.log("\n--- TEST SUITE 5: Operational Reconciliation (Kitchen, Inventory & Delivery) ---");

  // 1. Create Daily Meal Plan for 2026-10-18
  const mealPlanId = "plan_test_1018";
  await db.execute(
    `INSERT INTO daily_meal_plans (
       id, service_date, meal_type, status,
       planned_resident_count, planned_tiffin_count, guest_count,
       final_preparation_count, actual_cooked_count, dispatched_count,
       leftover_count, waste_count, created_by, created_at, updated_at
     ) VALUES (?, '2026-10-18', 'LUNCH', 'COMPLETED', 20, 15, 0, 35, 35, 33, 2, 0, ?, datetime('now'), datetime('now'))`,
    [mealPlanId, kitchenActor.id]
  );

  // 2. Create Raw Material & Movements
  const riceMaterial = await createRawMaterial(kitchenActor, {
    code: "RICE01",
    name: "Basmati Rice",
    category: "GRAINS",
    baseUnit: "G",
    reorderThreshold: 10000,
    initialStock: 0,
  }, undefined, db);

  // Stock receipt: 50 kg (50,000 g)
  await recordStockReceipt(kitchenActor, {
    materialId: riceMaterial.id,
    quantity: 50,
    unit: "KG",
    reason: "Stock replenishment",
  }, undefined, db);

  // Material waste: 2 kg (2,000 g)
  await recordMaterialWaste(kitchenActor, {
    materialId: riceMaterial.id,
    quantity: 2,
    unit: "KG",
    reason: "SPOILAGE",
  }, undefined, db);

  // Backdate movements to match 2026-10-18 operational service date
  await db.execute(
    `UPDATE kitchen_stock_movements SET created_at = '2026-10-18T11:00:00.000Z' WHERE material_id = ?`,
    [riceMaterial.id]
  );

  // 3. Create Delivery Tasks for 2026-10-18
  await createExternalDeliveryTask(superAdminActor, {
    serviceDate: "2026-10-18",
    mealType: "LUNCH",
    customerName: "Vikram Seth",
    customerPhone: "9123456780",
    deliveryAddress: "Cyber City, DLF Phase 2",
  }, undefined, db);

  // Generate Operational Reconciliation Report for 2026-10-18
  const opReport = await getOperationalReconciliationReport(
    kitchenActor,
    { startDate: "2026-10-18", endDate: "2026-10-18" },
    db
  );

  assert(opReport.kitchen.totalPlannedPortions === 35, `Kitchen total planned is 35 (got ${opReport.kitchen.totalPlannedPortions})`);
  assert(opReport.kitchen.plannedResidentCount === 20, `Kitchen planned resident count is 20 (got ${opReport.kitchen.plannedResidentCount})`);
  assert(opReport.kitchen.plannedTiffinCount === 15, `Kitchen planned tiffin count is 15 (got ${opReport.kitchen.plannedTiffinCount})`);
  assert(opReport.kitchen.actualCookedCount === 35, `Kitchen actual cooked is 35 (got ${opReport.kitchen.actualCookedCount})`);
  assert(opReport.kitchen.leftoverCount === 2, `Kitchen leftover count is 2 (got ${opReport.kitchen.leftoverCount})`);

  assert(opReport.inventory.totalReceiptMovements === 1, "Inventory records 1 receipt movement");
  assert(opReport.inventory.totalWastageMovements === 1, "Inventory records 1 wastage movement");
  assert(opReport.inventory.topWastedMaterials.length === 1, "Top wasted materials tracks 1 item");

  assert(opReport.delivery.totalTasks >= 1, `Delivery tasks recorded (got ${opReport.delivery.totalTasks})`);
  assert(opReport.delivery.externalTasks >= 1, "External delivery task recorded");

  // ============================================================================
  // TEST SUITE 6: Dashboard Metrics Division Filtering & Tiffin Revenue Query Fix
  // ============================================================================
  console.log("\n--- TEST SUITE 6: Dashboard Metrics Division Filtering & Tiffin Query Fix ---");

  invalidateDashboardCache();

  // Test Combined Metrics
  const combinedMetrics = await getDashboardMetrics({ division: "COMBINED", startDate: "2026-10-01", endDate: "2026-10-31" }, db, true);
  assert(combinedMetrics.occupancy.totalCapacity === 41, `Combined dashboard shows 41 capacity (got ${combinedMetrics.occupancy.totalCapacity})`);
  assert(combinedMetrics.finance.tiffinRevenue === 5000, `Tiffin revenue includes commercial TIFFIN_PAYMENT: ₹5,000 (got ₹${combinedMetrics.finance.tiffinRevenue})`);
  assert(combinedMetrics.finance.kitchenCosts === 2000, `Kitchen costs reflects grocery purchase: ₹2,000 (got ₹${combinedMetrics.finance.kitchenCosts})`);
  assert(combinedMetrics.finance.tiffinNetResult === 3000, `Tiffin net operating result is ₹3,000 (got ₹${combinedMetrics.finance.tiffinNetResult})`);

  // Test PG Division Metrics
  const pgMetrics = await getDashboardMetrics({ division: "PG", startDate: "2026-10-01", endDate: "2026-10-31" }, db, true);
  assert(pgMetrics.occupancy.totalCapacity === 41, "PG dashboard shows 41 capacity");
  assert(pgMetrics.finance.tiffinRevenue === 0, "PG dashboard tiffin revenue is strictly 0");
  assert(pgMetrics.finance.kitchenCosts === 0, "PG dashboard kitchen costs is strictly 0");

  // Test Tiffin Division Metrics
  const tiffinMetrics = await getDashboardMetrics({ division: "TIFFIN", startDate: "2026-10-01", endDate: "2026-10-31" }, db, true);
  assert(tiffinMetrics.occupancy.totalCapacity === 0, "Tiffin dashboard rooms/occupancy is 0 (isolated from PG property)");
  assert(tiffinMetrics.finance.currentMonthRent === 0, "Tiffin dashboard rent is strictly 0");
  assert(tiffinMetrics.finance.tiffinRevenue === 5000, "Tiffin dashboard shows ₹5,000 revenue");
  assert(tiffinMetrics.finance.kitchenCosts === 2000, "Tiffin dashboard shows ₹2,000 kitchen costs");
  assert(tiffinMetrics.finance.tiffinNetResult === 3000, "Tiffin dashboard shows ₹3,000 net profit");

  // ============================================================================
  // TEST SUITE 7: Server-Side RBAC Permission Enforcement
  // ============================================================================
  console.log("\n--- TEST SUITE 7: Server-Side RBAC Permission Enforcement ---");

  // 1. Delivery Person actor rejected for financial reporting
  let deliveryPersonRejected = false;
  try {
    await getMultiDivisionFinancialReport(deliveryActor, {}, db);
  } catch (err: any) {
    deliveryPersonRejected = true;
    assert(err.message.includes("Access denied"), `Rejected DELIVERY_PERSON from financial report: '${err.message}'`);
  }
  assert(deliveryPersonRejected, "Delivery person actor correctly denied access to financial report");

  // 2. Delivery Person actor rejected for invoice ageing report
  let deliveryPersonAgeingRejected = false;
  try {
    await getInvoiceAgeingReport(deliveryActor, {}, db);
  } catch (err: any) {
    deliveryPersonAgeingRejected = true;
    assert(err.message.includes("Access denied"), `Rejected DELIVERY_PERSON from invoice ageing: '${err.message}'`);
  }
  assert(deliveryPersonAgeingRejected, "Delivery person actor correctly denied access to invoice ageing report");

  // 3. Kitchen Operations actor rejected for financial report
  let kitchenPersonRejected = false;
  try {
    await getMultiDivisionFinancialReport(kitchenActor, {}, db);
  } catch (err: any) {
    kitchenPersonRejected = true;
    assert(err.message.includes("Access denied"), `Rejected KITCHEN_OPERATIONS from financial report: '${err.message}'`);
  }
  assert(kitchenPersonRejected, "Kitchen operations actor correctly denied access to financial report");

  // 4. Accountant allowed to access financial & ageing reports
  const accountantFinReport = await getMultiDivisionFinancialReport(accountantActor, { startDate: "2026-10-01", endDate: "2026-10-31" }, db);
  assert(accountantFinReport.combined.totalRevenue > 0, "Accountant authorized to access multi-division financial report");

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
  console.log(`TASK 01B.55 REGRESSION TESTS COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("FATAL: Unhandled error in Task 01B.55 test runner:", err);
  process.exit(1);
});
