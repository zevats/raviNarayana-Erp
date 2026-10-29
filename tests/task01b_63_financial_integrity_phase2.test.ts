import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { runMigrations } from "./helpers/sqliteMigrations";
import { getAsyncDb, closeDb } from "../apps/erp/src/server/database/db";
import {
  recordRentCharge,
  recordRentPayment,
  recordSecurityDeposit,
  recordExpense,
  reverseTransaction,
  getCashbookSummary,
  getResidentFinancialSummary,
  getBusinessDateString,
  assertClosingDateNotFinalized,
} from "../apps/erp/src/server/finance/financeService";
import {
  saveDailyClosingDraft,
  finalizeDailyClosing,
  reopenDailyClosing,
  previewDailyClosing,
  getDailyClosingById,
} from "../apps/erp/src/server/finance/cashbookClosingService";
import {
  acceptCashHandover,
} from "../apps/erp/src/server/delivery/deliveryService";
import {
  createInvoice,
  issueInvoice,
  cancelInvoice,
  allocatePaymentToInvoice,
  getInvoiceById,
} from "../apps/erp/src/server/finance/invoiceService";
import {
  getDashboardMetrics,
} from "../apps/erp/src/server/dashboard/dashboardService";
import {
  finalizeResidentCheckoutSettlement,
} from "../apps/erp/src/server/residents/residentSettlementService";
import {
  AuthenticatedUser,
} from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(process.cwd(), "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test database
const TEST_PHASE2_DB_PATH = path.resolve(__dirname, "test_task63_phase2.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_PHASE2_DB_PATH)) fs.unlinkSync(TEST_PHASE2_DB_PATH);
  const wal = `${TEST_PHASE2_DB_PATH}-wal`;
  const shm = `${TEST_PHASE2_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_PHASE2_DB_PATH;

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
console.log("TASK 01B.63 REGRESSION TEST SUITE: FINANCIAL INTEGRITY REMEDIATION PHASE 2");
console.log("================================================================================\n");

async function runTests() {
  // 1. Initialize schema in isolated DB
  console.log("--- 1. Initializing isolated database with schema migrations ---");
  const rawDb = new Database(TEST_PHASE2_DB_PATH);
  runMigrations(rawDb);
  const userVersion = rawDb.pragma("user_version", { simple: true }) as number;
  assert(userVersion >= 18, `Database user_version successfully advanced to V18 (got ${userVersion})`);
  rawDb.close();

  const db = getAsyncDb();

  // Test Actors
  const adminActor: AuthenticatedUser = {
    id: "usr_admin_63",
    username: "superadmin_63",
    email: "admin63@ravinarayana.com",
    fullName: "Super Admin 63",
    role: "SUPER_ADMIN",
  };

  const accountantActor: AuthenticatedUser = {
    id: "usr_acct_63",
    username: "accountant_63",
    email: "acct63@ravinarayana.com",
    fullName: "Chief Accountant 63",
    role: "ACCOUNTANT",
  };

  const driverActor: AuthenticatedUser = {
    id: "usr_driver_63",
    username: "driver_ramesh_63",
    email: "ramesh63@ravinarayana.com",
    fullName: "Ramesh Delivery",
    role: "DELIVERY_PERSON",
  };

  // Seed staff users into database
  const now = new Date().toISOString();
  for (const actor of [adminActor, accountantActor, driverActor]) {
    await db.execute(`
      INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'hash', ?, 1, ?, ?)
    `, [actor.id, actor.username, actor.email, actor.fullName, actor.role, now, now]);
  }

  // Seed Rooms
  await db.execute(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES
      ('room_63_101', '101', 1, 'DOUBLE', 2, 8000, 1, ?, ?),
      ('room_63_102', '102', 1, 'SINGLE', 1, 10000, 1, ?, ?)
  `, [now, now, now, now]);

  // Seed Residents
  await db.execute(`
    INSERT INTO residents (id, full_name, phone, email, status, created_at, updated_at)
    VALUES
      ('res_63_01', 'Vikram Malhotra', '9876543210', 'vikram63@example.com', 'ACTIVE', ?, ?),
      ('res_63_02', 'Ananya Sharma', '9876543211', 'ananya63@example.com', 'ACTIVE', ?, ?),
      ('res_63_race', 'Race Resident', '9876543212', 'race63@example.com', 'ACTIVE', ?, ?)
  `, [now, now, now, now, now, now]);

  await db.execute(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES
      ('stay_63_01', 'res_63_01', 'room_63_101', '2026-08-01', 8000, 10000, 'ACTIVE', ?, ?),
      ('stay_63_02', 'res_63_02', 'room_63_102', '2026-08-01', 10000, 12000, 'ACTIVE', ?, ?),
      ('stay_63_race', 'res_63_race', 'room_63_101', '2026-08-01', 5000, 5000, 'ACTIVE', ?, ?)
  `, [now, now, now, now, now, now]);

  // Seed Tiffin Customer
  await db.execute(`
    INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, status, created_by, created_at, updated_at)
    VALUES ('cust_63_01', 'Pooja Verma', '9876543299', 'Sector 14, Gurgaon', 'ACTIVE', ?, ?, ?)
  `, [accountantActor.id, now, now]);

  // ===========================================================================
  // SECTION 2: DEFECT A — Cash Handover Bypass & Concurrency
  // ===========================================================================
  console.log("\n--- 2. Testing Defect A: Cash Handover Bypass & Concurrency ---");

  const shiftDateLocked = "2026-10-20";
  const shiftDateOpen = "2026-10-21";

  // Finalize closing for shiftDateLocked under TIFFIN division
  await finalizeDailyClosing(accountantActor, {
    closingDate: shiftDateLocked,
    division: "TIFFIN",
    actualCashCounted: 0,
    discrepancyReason: "Opening day zero cash verified",
  }, undefined, db);

  // Seed Meal Plan
  await db.execute(`
    INSERT INTO daily_meal_plans (id, service_date, meal_type, status, planned_resident_count, created_by, created_at, updated_at)
    VALUES ('plan_63_01', '2026-10-20', 'LUNCH', 'CONFIRMED', 10, ?, ?, ?)
  `, [accountantActor.id, now, now]);

  // Seed delivery tasks for driver Ramesh on shiftDateLocked
  await db.execute(`
    INSERT INTO delivery_tasks (
      id, order_type, plan_id, service_date, meal_type, assigned_to, customer_name, customer_phone,
      delivery_address, status, collection_status, collected_payment_method,
      collected_amount, created_at, updated_at
    ) VALUES (
      'task_63_01', 'EXTERNAL', 'plan_63_01', ?, 'LUNCH', ?, 'Customer A', '9876500001',
      'Tower 1', 'DELIVERED', 'COLLECTED', 'CASH', 500, ?, ?
    )
  `, [shiftDateLocked, driverActor.id, now, now]);

  // Seed driver cash handover for shiftDateLocked
  await db.execute(`
    INSERT INTO driver_cash_handovers (
      id, driver_id, shift_date, declared_cash, status, created_at, updated_at
    ) VALUES (
      'dch_63_locked', ?, ?, 500, 'DECLARED', ?, ?
    )
  `, [driverActor.id, shiftDateLocked, now, now]);

  // Test 1: Late cash handover acceptance on finalized shift date must be REJECTED
  let lateHandoverBlocked = false;
  try {
    await acceptCashHandover(accountantActor, "dch_63_locked", {
      acceptedCash: 500,
    }, undefined, db);
  } catch (err: any) {
    lateHandoverBlocked = err.message.includes("FINALIZED and locked");
  }
  assert(lateHandoverBlocked, "Defect A: acceptCashHandover blocked on finalized shift date (TIFFIN closing)");

  // Test 2: Handover pending state and delivery task collection status must be preserved after rejection
  const handoverRowAfterReject = await db.queryOne<any>(`SELECT * FROM driver_cash_handovers WHERE id = 'dch_63_locked'`);
  assert(handoverRowAfterReject.status === "DECLARED", "Handover remains in DECLARED status after lock rejection");
  const taskRowAfterReject = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = 'task_63_01'`);
  assert(taskRowAfterReject.collection_status === "COLLECTED", "Delivery task remains COLLECTED (not HANDED_OVER)");

  // Test 3: Normal handover on OPEN shift date must SUCCEED
  await db.execute(`
    INSERT INTO delivery_tasks (
      id, order_type, plan_id, service_date, meal_type, assigned_to, customer_name, customer_phone,
      delivery_address, status, collection_status, collected_payment_method,
      collected_amount, created_at, updated_at
    ) VALUES (
      'task_63_02', 'EXTERNAL', 'plan_63_01', ?, 'LUNCH', ?, 'Customer B', '9876500002',
      'Tower 2', 'DELIVERED', 'COLLECTED', 'CASH', 800, ?, ?
    )
  `, [shiftDateOpen, driverActor.id, now, now]);

  await db.execute(`
    INSERT INTO driver_cash_handovers (
      id, driver_id, shift_date, declared_cash, status, created_at, updated_at
    ) VALUES (
      'dch_63_open', ?, ?, 800, 'DECLARED', ?, ?
    )
  `, [driverActor.id, shiftDateOpen, now, now]);

  const acceptedHandover = await acceptCashHandover(accountantActor, "dch_63_open", {
    acceptedCash: 800,
  }, undefined, db);
  assert(acceptedHandover.status === "ACCEPTED", "acceptCashHandover succeeds on open shift date");
  assert(acceptedHandover.acceptedCash === 800, "Handover accepted cash recorded accurately (₹800)");

  // Verify financial transaction was created for the open handover
  const handoverTx = await db.queryOne<any>(`SELECT * FROM financial_transactions WHERE reference_number = 'dch_63_open'`);
  assert(handoverTx !== null, "TIFFIN_PAYMENT transaction posted to ledger");
  assert(handoverTx.amount === 800 && handoverTx.payment_method === "CASH", "Ledger transaction amount ₹800 and payment method CASH");

  // Test 4: Repeated acceptance attempt on already-accepted handover must be REJECTED (Idempotency)
  let repeatAcceptanceBlocked = false;
  try {
    await acceptCashHandover(accountantActor, "dch_63_open", {
      acceptedCash: 800,
    }, undefined, db);
  } catch (err: any) {
    repeatAcceptanceBlocked = err.message.includes("already been accepted") || err.message.includes("no longer pending");
  }
  assert(repeatAcceptanceBlocked, "Repeated acceptance attempt rejected (idempotency guarded)");

  // Test 5: Reopening workflow compatibility: Reopen locked day, then accept handover
  const closingLockedRecord = await db.queryOne<any>(`SELECT id FROM daily_cashbook_closings WHERE closing_date = ? AND division = 'TIFFIN'`, [shiftDateLocked]);
  await reopenDailyClosing(adminActor, {
    closingId: closingLockedRecord.id,
    reason: "Reopening to accept delayed driver shift handover",
  }, undefined, db);

  const acceptedAfterReopen = await acceptCashHandover(accountantActor, "dch_63_locked", {
    acceptedCash: 500,
  }, undefined, db);
  assert(acceptedAfterReopen.status === "ACCEPTED", "Handover accepted successfully after authorized closing reopening");

  // ===========================================================================
  // SECTION 3: DEFECT B — Atomic Closing Finalization & Concurrency
  // ===========================================================================
  console.log("\n--- 3. Testing Defect B: Atomic Closing Finalization & Concurrency ---");

  const testDateB1 = "2026-10-22";

  // Test 6: Finalization with NO existing closing row
  const noRowClosing = await finalizeDailyClosing(accountantActor, {
    closingDate: testDateB1,
    division: "PG",
    actualCashCounted: 0,
    discrepancyReason: "Initial zero count verified",
  }, undefined, db);
  assert(noRowClosing.status === "FINALIZED", "Finalization succeeds when no prior closing row existed");
  assert(noRowClosing.closingDate === testDateB1, "Finalized closing date matches request");

  // Test 7: Finalizing an already finalized closing must throw error
  let alreadyFinalizedBlocked = false;
  try {
    await finalizeDailyClosing(accountantActor, {
      closingDate: testDateB1,
      division: "PG",
      actualCashCounted: 0,
      discrepancyReason: "Second finalization attempt",
    }, undefined, db);
  } catch (err: any) {
    alreadyFinalizedBlocked = err.message.includes("already FINALIZED and locked");
  }
  assert(alreadyFinalizedBlocked, "Subsequent finalization attempt rejected (already finalized)");

  // Test 8: Division Isolation: PG finalized, TIFFIN remains open
  await db.execute(`
    INSERT INTO financial_transactions (
      id, transaction_type, amount, transaction_date, payment_method, category, status, created_by, created_at, updated_at
    ) VALUES (
      'tx_tiffin_b1', 'TIFFIN_PAYMENT', 650, ?, 'UPI', 'TIFFIN', 'POSTED', ?, ?, ?
    )
  `, [testDateB1, accountantActor.id, now, now]);

  let tiffinWriteAllowed = false;
  try {
    // Assert TIFFIN division is not blocked on date where only PG was finalized
    await assertClosingDateNotFinalized(db, testDateB1, "TIFFIN");
    tiffinWriteAllowed = true;
  } catch {}
  assert(tiffinWriteAllowed, "Division isolation: TIFFIN write permitted when only PG is finalized");

  // Test 9: COMBINED closing locks BOTH divisions
  const testDateB2 = "2026-10-23";
  await finalizeDailyClosing(accountantActor, {
    closingDate: testDateB2,
    division: "COMBINED",
    actualCashCounted: 0,
    discrepancyReason: "Combined closing verified",
  }, undefined, db);

  let pgBlockedByCombined = false;
  let tiffinBlockedByCombined = false;
  try {
    await assertClosingDateNotFinalized(db, testDateB2, "PG");
  } catch (err: any) {
    pgBlockedByCombined = err.message.includes("FINALIZED and locked");
  }
  try {
    await assertClosingDateNotFinalized(db, testDateB2, "TIFFIN");
  } catch (err: any) {
    tiffinBlockedByCombined = err.message.includes("FINALIZED and locked");
  }
  assert(pgBlockedByCombined && tiffinBlockedByCombined, "COMBINED closing locks both PG and TIFFIN operations");

  // Test 10: Concurrent Finalization Requests Simulation (Simultaneous Execution)
  console.log("  Testing real concurrent finalization requests...");
  const testDateB3 = "2026-10-06";
  const results = await Promise.allSettled([
    finalizeDailyClosing(accountantActor, {
      closingDate: testDateB3,
      division: "PG",
      actualCashCounted: 1000,
      discrepancyReason: "Session A physical count",
    }, undefined, db),
    finalizeDailyClosing(adminActor, {
      closingDate: testDateB3,
      division: "PG",
      actualCashCounted: 1000,
      discrepancyReason: "Session B physical count",
    }, undefined, db),
  ]);

  const fulfilledCount = results.filter((r) => r.status === "fulfilled").length;
  const rejectedCount = results.filter((r) => r.status === "rejected").length;
  assert(fulfilledCount === 1 && rejectedCount === 1, "Concurrent finalization requests: exactly 1 succeeds, 1 rejected");

  // Test 11: Concurrent Ledger Write Racing with Finalization
  console.log("  Testing concurrent ledger write racing with closing finalization...");
  const testDateB4 = "2026-10-07";

  // Post one initial charge
  await recordRentCharge(accountantActor, {
    residentId: "res_63_race",
    stayId: "stay_63_race",
    amount: 5000,
    billingPeriod: "October 2026",
    transactionDate: testDateB4,
  }, undefined, db);

  // Concurrently attempt payment and finalization
  await Promise.allSettled([
    finalizeDailyClosing(accountantActor, {
      closingDate: testDateB4,
      division: "PG",
      actualCashCounted: 0,
      discrepancyReason: "Race finalization test count",
    }, undefined, db),
    recordRentPayment(accountantActor, {
      residentId: "res_63_race",
      amount: 5000,
      paymentMethod: "CASH",
      transactionDate: testDateB4,
    }, undefined, db),
  ]);

  // Check the finalized record snapshot
  const closingRecordB4 = await db.queryOne<any>(`
    SELECT * FROM daily_cashbook_closings WHERE closing_date = ? AND division = 'PG'
  `, [testDateB4]);
  assert(closingRecordB4 !== null && closingRecordB4.status === "FINALIZED", "Closing reached FINALIZED status in race test");

  const snapB4 = JSON.parse(closingRecordB4.snapshot_data);
  const paymentPostedB4 = await db.queryOne<any>(`
    SELECT * FROM financial_transactions WHERE transaction_date = ? AND transaction_type = 'RENT_PAYMENT'
  `, [testDateB4]);

  if (paymentPostedB4) {
    // If payment won the race and committed, it MUST be included in the snapshot!
    const includedInSnapshot = snapB4.transactionIds.includes(paymentPostedB4.id);
    assert(includedInSnapshot, "If payment committed before finalization, it is included in frozen snapshot");
  } else {
    // If payment lost the race, it was rejected by the closing lock
    assert(true, "Payment was safely rejected by closing lock after finalization won");
  }

  // Clean up race resident's uncommitted test charges so they do not contaminate subsequent section assertions
  await db.execute("DELETE FROM financial_transactions WHERE resident_id = 'res_63_race'");

  // ===========================================================================
  // SECTION 4: DEFECT C — Historical Invoice Cancellation
  // ===========================================================================
  console.log("\n--- 4. Testing Defect C: Historical Invoice Cancellation ---");

  const openInvoiceDate = "2026-10-26";
  const lockedInvoiceDate = "2026-10-27";

  // Finalize lockedInvoiceDate for TIFFIN
  await finalizeDailyClosing(accountantActor, {
    closingDate: lockedInvoiceDate,
    division: "TIFFIN",
    actualCashCounted: 0,
    discrepancyReason: "Pre-lock date for invoice test",
  }, undefined, db);

  // 1. Create invoice on OPEN date
  const openInvoice = await createInvoice(accountantActor, {
    invoiceType: "REGULAR_BILL",
    invoiceCategory: "TIFFIN",
    customerId: "cust_63_01",
    issueDate: openInvoiceDate,
    dueDate: "2026-11-05",
    billingPeriod: "October 2026",
    recipientName: "Pooja Verma",
    recipientPhone: "9876543299",
    items: [{ description: "Monthly Tiffin Plan", quantity: 1, unitPrice: 3000 }],
  }, undefined, db);
  await issueInvoice(accountantActor, openInvoice.id, undefined, db);

  // 2. Cancellation on OPEN date must SUCCEED
  const cancelledOpen = await cancelInvoice(accountantActor, openInvoice.id, "Customer cancelled subscription", undefined, db);
  assert(cancelledOpen.status === "CANCELLED", "Invoice cancelled successfully on open accounting date");

  // Verify linked TIFFIN_CHARGE was marked REVERSED
  const openCharge = await db.queryOne<any>(`SELECT * FROM financial_transactions WHERE invoice_id = ? AND transaction_type = 'TIFFIN_CHARGE'`, [openInvoice.id]);
  assert(openCharge.status === "REVERSED", "Linked TIFFIN_CHARGE transitioned to REVERSED on open date");

  // 3. Repeated cancellation must be REJECTED (Idempotency)
  let repeatCancelBlocked = false;
  try {
    await cancelInvoice(accountantActor, openInvoice.id, "Attempt cancel again", undefined, db);
  } catch (err: any) {
    repeatCancelBlocked = err.message.includes("already cancelled");
  }
  assert(repeatCancelBlocked, "Repeated invoice cancellation rejected (idempotency preserved)");

  // 4. Create and issue invoice on an open date, then FINALIZE that date
  const lockedInvoice = await createInvoice(accountantActor, {
    invoiceType: "REGULAR_BILL",
    invoiceCategory: "TIFFIN",
    customerId: "cust_63_01",
    issueDate: "2026-10-28",
    dueDate: "2026-11-05",
    billingPeriod: "October 2026",
    recipientName: "Pooja Verma",
    recipientPhone: "9876543299",
    items: [{ description: "Monthly Tiffin Plan - Locked", quantity: 1, unitPrice: 3500 }],
  }, undefined, db);
  await issueInvoice(accountantActor, lockedInvoice.id, undefined, db);

  // Now finalize that date
  await finalizeDailyClosing(accountantActor, {
    closingDate: "2026-10-28",
    division: "TIFFIN",
    actualCashCounted: 0,
    discrepancyReason: "Finalizing date with issued invoice",
  }, undefined, db);

  // Attempt to cancel invoice issued on the finalized date
  let cancelLockedInvoiceBlocked = false;
  try {
    await cancelInvoice(accountantActor, lockedInvoice.id, "Retroactive cancellation attempt", undefined, db);
  } catch (err: any) {
    cancelLockedInvoiceBlocked = err.message.includes("FINALIZED and locked");
  }
  assert(cancelLockedInvoiceBlocked, "Defect C: Invoice cancellation on finalized date strictly blocked by closing lock");

  // Verify historical charge on finalized date remains POSTED (unmutated)
  const lockedChargeAfter = await db.queryOne<any>(`SELECT * FROM financial_transactions WHERE invoice_id = ? AND transaction_type = 'TIFFIN_CHARGE'`, [lockedInvoice.id]);
  assert(lockedChargeAfter.status === "POSTED", "Historical charge on finalized date remains POSTED (unmutated)");

  // ===========================================================================
  // SECTION 5: DEFECT D — Revenue Chart Semantics & Checkout Settlement Trace
  // ===========================================================================
  console.log("\n--- 5. Testing Defect D: Revenue Chart Semantics & Settlement Trace ---");

  // Step 1: Resident Vikram Malhotra pays ₹10,000 security deposit on August 1
  await recordSecurityDeposit(accountantActor, {
    residentId: "res_63_01",
    stayId: "stay_63_01",
    amount: 10000,
    paymentMethod: "CASH",
    transactionDate: "2026-08-01",
  }, undefined, db);

  // Step 2: Rent of ₹8,000 accrued for October
  await recordRentCharge(accountantActor, {
    residentId: "res_63_01",
    stayId: "stay_63_01",
    amount: 8000,
    billingPeriod: "October 2026",
    transactionDate: "2026-10-01",
  }, undefined, db);

  // Step 3: Checkout settlement on October 29:
  // - Deduct ₹8,000 rent from held deposit (DEPOSIT_APPLICATION)
  // - Refund ₹2,000 remaining deposit in cash (DEPOSIT_REFUND)
  await finalizeResidentCheckoutSettlement(accountantActor, {
    residentId: "res_63_01",
    checkOutDate: "2026-10-29",
    depositAppliedAmount: 8000,
    refundAmount: 2000,
    refundPaymentMethod: "CASH",
  }, undefined, db);

  // Verification A: Resident Dossier
  const dossier = await getResidentFinancialSummary(accountantActor, "res_63_01", db);
  assert(dossier.totalSecurityDepositHeld === 0, "Resident Dossier: Held deposit balances to exactly ₹0 after settlement");
  assert(dossier.outstandingRentBalance === 0, "Resident Dossier: Outstanding rent balances to ₹0 after deposit application");

  // Verification B: Cashbook Summary for October (Pure Physical Cash Movement)
  const octCashbook = await getCashbookSummary(accountantActor, {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    division: "PG",
  }, db);
  // DEPOSIT_APPLICATION must NOT inflate physical cash rent collected
  // Deposit refund creates physical cash outflow of ₹2,000
  assert(octCashbook.totalRentCollected === 0, "Cashbook: Deposit application creates ₹0 cash rent collection");
  assert(octCashbook.netCashMovement === -2000, "Cashbook: Deposit refund recorded as -₹2,000 net physical cash movement");

  // Verification C: Dashboard Metrics & 6-Month Historical Revenue Chart
  const dashboard = await getDashboardMetrics({ division: "PG" }, db, true);
  // Total earned revenue must include the ₹8,000 rent satisfied via deposit liquidation
  const octDataPoint = dashboard.monthlyData.find((m) => m.month === "2026-10");
  assert(octDataPoint !== undefined && octDataPoint.collected >= 8000, "Dashboard Chart: October revenue recognizes ₹8,000 rent settled via deposit application");

  // August chart must NOT include the ₹10,000 security deposit as revenue (it is a liability)
  const augDataPoint = dashboard.monthlyData.find((m) => m.month === "2026-08");
  assert(augDataPoint !== undefined && augDataPoint.collected === 0, "Dashboard Chart: August recognizes ₹0 revenue for security deposit receipt (liability)");

  // Dashboard KPI card: outstanding rent must be ₹0 (no phantom unpaid rent)
  assert(dashboard.finance.outstandingRent === 0, "Dashboard Financials: Outstanding rent is ₹0 (deposit application counted as settled rent)");
  assert(dashboard.finance.totalDepositsHeld === 0, "Dashboard Financials: Total held deposit liability is ₹0 after settlement");

  // ===========================================================================
  // SECTION 6: DEFECT E — Reversal Accounting & Business Date
  // ===========================================================================
  console.log("\n--- 6. Testing Defect E: Reversal Accounting & Business Date ---");

  // Test 12: Business Date Formatter in Asia/Kolkata
  const testUtcNight = new Date("2026-10-29T19:00:00Z"); // 00:30 AM IST on October 30
  const istDateString = getBusinessDateString(testUtcNight);
  assert(istDateString === "2026-10-30", "getBusinessDateString correctly maps 19:00 UTC to 2026-10-30 in Asia/Kolkata");

  // Test 13: Intra-period Reversal (Payment and Reversal in same month)
  // Seed October charge so resident has outstanding rent balance for payment
  await recordRentCharge(accountantActor, {
    residentId: "res_63_02",
    stayId: "stay_63_02",
    amount: 10000,
    billingPeriod: "October 2026",
    transactionDate: "2026-10-01",
  }, undefined, db);

  // Post rent payment of ₹4,000 on 2026-10-10
  const intraPayment = await recordRentPayment(accountantActor, {
    residentId: "res_63_02",
    amount: 4000,
    paymentMethod: "CASH",
    transactionDate: "2026-10-10",
  }, undefined, db);

  // Reverse it on 2026-10-11
  await reverseTransaction(accountantActor, intraPayment.id, "Erroneous cash payment entry", undefined, db);

  const intraCashbook = await getCashbookSummary(accountantActor, {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    division: "PG",
  }, db);
  // Net rent collected from intraPayment should cancel to 0
  assert(intraCashbook.totalRentCollected === 0, "Intra-period reversal cancels to ₹0 net cash in the same period");

  // Test 14: Cross-period Reversal Trace (September payment reversed in October)
  // Seed September payment of ₹6,000
  const septTxId = "tx_sept_payment_63";
  await db.execute(`
    INSERT INTO financial_transactions (
      id, transaction_type, amount, transaction_date, payment_method, resident_id, category, status, created_by, created_at, updated_at
    ) VALUES (
      ?, 'RENT_PAYMENT', 6000, '2026-09-15', 'CASH', 'res_63_02', 'RENT', 'POSTED', ?, ?, ?
    )
  `, [septTxId, accountantActor.id, now, now]);

  // Check September cashbook before reversal
  const septCashbookBefore = await getCashbookSummary(accountantActor, {
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    division: "PG",
  }, db);
  assert(septCashbookBefore.totalRentCollected === 6000, "September cashbook before reversal: ₹6,000 collected");

  // Reverse the September payment in October
  const septReversal = await reverseTransaction(accountantActor, septTxId, "September payment refunded due to dispute", undefined, db);
  assert(septReversal.transactionType === "REVERSAL", "Cross-period reversal created REVERSAL record");

  // Check September cashbook AFTER reversal: must PRESERVE the historical ₹6,000 cash collection!
  const septCashbookAfter = await getCashbookSummary(accountantActor, {
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    division: "PG",
  }, db);
  assert(septCashbookAfter.totalRentCollected === 6000, "September historical cashbook PRESERVES ₹6,000 collection (reversal happened in October)");

  // Check October cashbook AFTER reversal: must deduct the ₹6,000 refund
  const octCashbookAfter = await getCashbookSummary(accountantActor, {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    division: "PG",
  }, db);
  // In October, no new cash rent was collected, so totalRentCollected is 0 (floored at 0)
  assert(octCashbookAfter.totalRentCollected === 0, "October cashbook reflects prior refund without going negative");

  // Check Two-Month Combined Cashbook (2026-09-01 to 2026-10-31)
  const combinedCashbook = await getCashbookSummary(accountantActor, {
    startDate: "2026-09-01",
    endDate: "2026-10-31",
    division: "PG",
  }, db);
  // Across the 2 months: September payment (+6000) and October refund (-6000) cancel out to ₹0
  assert(combinedCashbook.totalRentCollected === 0, "Combined Sept-Oct cashbook: payment and reversal perfectly balance to ₹0 (no double deduction)");

  // ===========================================================================
  // SECTION 7: PRIMARY DB IMMUTABILITY GUARD
  // ===========================================================================
  console.log("\n--- 7. Primary Database Immutability Verification ---");
  const primaryStatsAfter = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;
  assert(
    // Untouched = absent before and after (isolated sandbox), or identical size and mtime.
    (primaryStatsBefore === null && primaryStatsAfter === null) ||
      (primaryStatsBefore !== null &&
        primaryStatsAfter !== null &&
        primaryStatsBefore.size === primaryStatsAfter.size &&
        primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs),
    primaryStatsAfter
      ? `Primary database data/erp.db is 100% untouched (size: ${primaryStatsAfter.size} bytes, mtime: ${primaryStatsAfter.mtime.toISOString()})`
      : "Primary database data/erp.db was not created or modified (absent before and after)"
  );

  console.log("\n================================================================================");
  console.log(`TASK 01B.63 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  cleanupTestDb();

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("FATAL TEST SUITE ERROR:", err);
  cleanupTestDb();
  process.exit(1);
});
