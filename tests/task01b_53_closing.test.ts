import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { closeDb, getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import {
  recordRentCharge,
  recordRentPayment,
  recordSecurityDeposit,
  recordExpense,
  reverseTransaction,
  getCashbookSummary,
} from "../apps/erp/src/server/finance/financeService";
import {
  previewDailyClosing,
  saveDailyClosingDraft,
  finalizeDailyClosing,
  reopenDailyClosing,
  listDailyClosings,
  getDailyClosingById,
} from "../apps/erp/src/server/finance/cashbookClosingService";
import {
  previewResidentSettlement,
  finalizeResidentCheckoutSettlement,
} from "../apps/erp/src/server/residents/residentSettlementService";
import {
  AuthenticatedUser,
} from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test database
const TEST_CLOSING53_DB_PATH = path.resolve(__dirname, "test_task53_closing.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_CLOSING53_DB_PATH)) fs.unlinkSync(TEST_CLOSING53_DB_PATH);
  const wal = `${TEST_CLOSING53_DB_PATH}-wal`;
  const shm = `${TEST_CLOSING53_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_CLOSING53_DB_PATH;

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
console.log("TASK 01B.53 REGRESSION TEST SUITE: DAILY CASHBOOK CLOSING & RECONCILIATION");
console.log("================================================================================\n");

async function runTests() {
  // 1. Initialize schema in isolated DB
  console.log("--- 1. Initializing isolated database with schema migrations ---");
  const rawDb = new Database(TEST_CLOSING53_DB_PATH);
  runMigrations(rawDb);
  const userVersion = rawDb.pragma("user_version", { simple: true }) as number;
  assert(userVersion >= 18, `Database user_version successfully advanced to V18 (got ${userVersion})`);

  // Verify daily_cashbook_closings table exists
  const closingTable = rawDb.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='daily_cashbook_closings'").get() as { count: number };
  assert(closingTable.count === 1, "daily_cashbook_closings table exists in SQLite database");
  rawDb.close();

  const db = getAsyncDb();

  // Test Actors
  const adminActor: AuthenticatedUser = {
    id: "usr_admin_53",
    username: "superadmin_53",
    email: "admin53@ravinarayana.com",
    fullName: "Super Admin 53",
    role: "SUPER_ADMIN",
  };

  const opsActor: AuthenticatedUser = {
    id: "usr_ops_53",
    username: "opsmanager_53",
    email: "ops53@ravinarayana.com",
    fullName: "Operations Manager 53",
    role: "OPERATIONS_MANAGER",
  };

  const accountantActor: AuthenticatedUser = {
    id: "usr_acct_53",
    username: "accountant_53",
    email: "acct53@ravinarayana.com",
    fullName: "Chief Accountant 53",
    role: "ACCOUNTANT",
  };

  const deliveryActor: AuthenticatedUser = {
    id: "usr_del_53",
    username: "courier_53",
    email: "courier53@ravinarayana.com",
    fullName: "Courier Delivery Staff 53",
    role: "DELIVERY_PERSON",
  };

  // Seed staff users into database
  const now = new Date().toISOString();
  for (const actor of [adminActor, opsActor, accountantActor, deliveryActor]) {
    await db.execute(`
      INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'hash', ?, 1, ?, ?)
    `, [actor.id, actor.username, actor.email, actor.fullName, actor.role, now, now]);
  }

  // Seed room, resident, stay, tiffin customer, meal plan
  const roomId = "room_53_101";
  await db.execute(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES (?, '101', 1, 'DOUBLE', 2, 10000, 1, ?, ?)
  `, [roomId, now, now]);

  const residentId = "res_53_01";
  await db.execute(`
    INSERT INTO residents (id, full_name, phone, emergency_contact, status, created_at, updated_at)
    VALUES (?, 'Rohan Sharma', '+919876543210', 'Papa Sharma +919876543211', 'ACTIVE', ?, ?)
  `, [residentId, now, now]);

  const stayId = "stay_53_01";
  await db.execute(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, check_out_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES (?, ?, ?, '2026-10-01', NULL, 10000, 15000, 'ACTIVE', ?, ?)
  `, [stayId, residentId, roomId, now, now]);

  const customerId = "cust_53_01";
  await db.execute(`
    INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, status, created_by, created_at, updated_at)
    VALUES (?, 'Ananya Roy', '+919876543299', 'A-402 Green Meadows', 'ACTIVE', ?, ?, ?)
  `, [customerId, adminActor.id, now, now]);

  const planId = "plan_53_01";
  await db.execute(`
    INSERT INTO daily_meal_plans (id, service_date, meal_type, planned_resident_count, planned_tiffin_count, guest_count, final_preparation_count, status, created_by, created_at, updated_at)
    VALUES (?, '2026-10-23', 'LUNCH', 25, 0, 3, 28, 'CONFIRMED', ?, ?, ?)
  `, [planId, adminActor.id, now, now]);

  console.log("\n--- 2. Opening Balance from Initial Historical Ledger (No Prior Closings) ---");
  // Post rent charge of ₹50,000 so payments can be applied against billed rent
  await recordRentCharge(accountantActor, {
    residentId,
    stayId,
    amount: 50000,
    transactionDate: "2026-10-21",
    billingPeriod: "2026-10",
  }, db);

  // Post prior transactions on 2026-10-21 and 2026-10-22
  await recordRentPayment(accountantActor, {
    residentId,
    stayId,
    amount: 10000,
    transactionDate: "2026-10-21",
    paymentMethod: "CASH",
  }, db);

  await recordSecurityDeposit(accountantActor, {
    residentId,
    stayId,
    amount: 15000,
    transactionDate: "2026-10-21",
    paymentMethod: "BANK_TRANSFER",
  }, db);

  await recordExpense(accountantActor, {
    amount: 3000,
    transactionDate: "2026-10-22",
    category: "GROCERY",
    paymentMethod: "CASH",
    description: "Vegetables for PG Kitchen",
  }, db);

  // Opening balance preview for 2026-10-23 (COMBINED)
  const previewDay1 = await previewDailyClosing(accountantActor, "2026-10-23", "COMBINED", db);
  // Total prior inflows = 10000 (Cash) + 15000 (Bank) = 25000
  // Total prior outflows = 3000 (Cash Expense)
  // Net prior total = 22000
  // Net prior cash = 10000 - 3000 = 7000
  assert(previewDay1.openingBalance === 22000, `Day 1 opening balance correctly calculated as ₹22,000 (got ₹${previewDay1.openingBalance})`);
  assert(previewDay1.openingCashBalance === 7000, `Day 1 opening cash balance correctly calculated as ₹7,000 (got ₹${previewDay1.openingCashBalance})`);

  console.log("\n--- 3. Multi-Channel Movement Breakdown for Current Operating Day (2026-10-23) ---");
  // Post diverse channel transactions on 2026-10-23
  // A. Cash Rent Payment: ₹5,000
  await recordRentPayment(accountantActor, {
    residentId,
    stayId,
    amount: 5000,
    transactionDate: "2026-10-23",
    paymentMethod: "CASH",
  }, db);

  // B. UPI Tiffin Payment: ₹3,500
  await db.execute(`
    INSERT INTO financial_transactions (
      id, transaction_type, amount, transaction_date, payment_method, customer_id,
      category, description, idempotency_key, status, created_by, created_at, updated_at
    ) VALUES ('ft_tif_01', 'TIFFIN_PAYMENT', 3500, '2026-10-23', 'UPI', ?, 'TIFFIN_COLLECTION', 'Tiffin Lunch Sub', 'idemp_tif_01', 'POSTED', ?, ?, ?)
  `, [customerId, accountantActor.id, now, now]);

  // C. Cheque Rent Payment: ₹8,000
  await recordRentPayment(accountantActor, {
    residentId,
    stayId,
    amount: 8000,
    transactionDate: "2026-10-23",
    paymentMethod: "CHEQUE",
  }, db);

  // D. Cash Expense: ₹1,500
  await recordExpense(accountantActor, {
    amount: 1500,
    transactionDate: "2026-10-23",
    category: "MAINTENANCE",
    paymentMethod: "CASH",
    description: "Plumbing repair room 101",
  }, db);

  // E. Bank Transfer Outflow (Expense): ₹4,000
  await recordExpense(accountantActor, {
    amount: 4000,
    transactionDate: "2026-10-23",
    category: "UTILITIES",
    paymentMethod: "BANK_TRANSFER",
    description: "Internet Broadband",
  }, db);

  // F. Seed delivery tasks for operational context
  await db.execute(`
    INSERT INTO delivery_tasks (
      id, order_type, plan_id, service_date, meal_type, resident_id, resident_name, room_number,
      status, assigned_to, assigned_to_name, delivered_at, delivered_by, created_at, updated_at
    ) VALUES
    ('del_t1', 'RESIDENT', ?, '2026-10-23', 'LUNCH', ?, 'Rohan Sharma', '101', 'DELIVERED', ?, 'Courier 53', ?, ?, ?, ?),
    ('del_t2', 'EXTERNAL', ?, '2026-10-23', 'LUNCH', NULL, NULL, NULL, 'PENDING', ?, 'Courier 53', NULL, NULL, ?, ?)
  `, [planId, residentId, deliveryActor.id, now, deliveryActor.id, now, now, planId, deliveryActor.id, now, now]);

  const previewDay1Updated = await previewDailyClosing(accountantActor, "2026-10-23", "COMBINED", db);

  // Verify Channels:
  // CASH: Inflow = 5000, Outflow = 1500, Net = 3500
  assert(previewDay1Updated.channelBreakdown.CASH.inflow === 5000, "CASH inflow is ₹5,000");
  assert(previewDay1Updated.channelBreakdown.CASH.outflow === 1500, "CASH outflow is ₹1,500");
  assert(previewDay1Updated.channelBreakdown.CASH.net === 3500, "CASH net movement is ₹3,500");

  // UPI: Inflow = 3500, Outflow = 0
  assert(previewDay1Updated.channelBreakdown.UPI.inflow === 3500, "UPI inflow is ₹3,500");

  // CHEQUE: Inflow = 8000, Outflow = 0
  assert(previewDay1Updated.channelBreakdown.CHEQUE.inflow === 8000, "CHEQUE inflow is ₹8,000");

  // BANK_TRANSFER: Inflow = 0, Outflow = 4000
  assert(previewDay1Updated.channelBreakdown.BANK_TRANSFER.outflow === 4000, "BANK_TRANSFER outflow is ₹4,000");

  // Total Inflow = 5000 + 3500 + 8000 = 16500
  // Total Outflow = 1500 + 4000 = 5500
  // Net Movement = 16500 - 5500 = 11000
  assert(previewDay1Updated.totalInflow === 16500, `Total day inflow is ₹16,500 (got ₹${previewDay1Updated.totalInflow})`);
  assert(previewDay1Updated.totalOutflow === 5500, `Total day outflow is ₹5,500 (got ₹${previewDay1Updated.totalOutflow})`);
  assert(previewDay1Updated.netMovement === 11000, `Total net movement is ₹11,000 (got ₹${previewDay1Updated.netMovement})`);

  // Expected Balances:
  // Expected Cash = Opening Cash (7000) + Cash Net (3500) = 10500
  // Expected Total = Opening Total (22000) + Day Net (11000) = 33000
  assert(previewDay1Updated.expectedCashBalance === 10500, `Expected cash in hand is ₹10,500 (got ₹${previewDay1Updated.expectedCashBalance})`);
  assert(previewDay1Updated.expectedClosingBalance === 33000, `Expected total closing balance is ₹33,000 (got ₹${previewDay1Updated.expectedClosingBalance})`);

  // Delivery operational summary
  assert(previewDay1Updated.deliverySummary.totalTasks === 2, "Delivery total tasks is 2");
  assert(previewDay1Updated.deliverySummary.deliveredCount === 1, "Delivered tasks count is 1");
  assert(previewDay1Updated.deliverySummary.pendingCount === 1, "Pending tasks count is 1");

  console.log("\n--- 4. Task 01B.52 Integration: Non-Cash Deposit Application & DEPOSIT_REFUND ---");
  // Setup resident checkout settlement on 2026-10-23
  // Resident 2 checks out: deposit held = 10000, outstanding rent = 6000, deposit applied = 6000, refund = 4000 (Cash)
  const resident2Id = "res_53_02";
  await db.execute(`
    INSERT INTO residents (id, full_name, phone, emergency_contact, status, created_at, updated_at)
    VALUES (?, 'Pooja Iyer', '+919876543222', 'Appa Iyer +919876543223', 'ACTIVE', ?, ?)
  `, [resident2Id, now, now]);

  const stay2Id = "stay_53_02";
  await db.execute(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, check_out_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES (?, ?, ?, '2026-10-01', NULL, 10000, 10000, 'ACTIVE', ?, ?)
  `, [stay2Id, resident2Id, roomId, now, now]);

  // Record initial security deposit of ₹10,000 held for Resident 2
  await recordSecurityDeposit(accountantActor, {
    residentId: resident2Id,
    stayId: stay2Id,
    amount: 10000,
    transactionDate: "2026-10-21",
    paymentMethod: "BANK_TRANSFER",
  }, db);

  // Rent charge of ₹6,000 for Resident 2
  await recordRentCharge(accountantActor, {
    residentId: resident2Id,
    stayId: stay2Id,
    amount: 6000,
    transactionDate: "2026-10-23",
    billingPeriod: "2026-10",
  }, db);

  // Finalize settlement: deposit applied = 6000, refund = 4000 via CASH
  await finalizeResidentCheckoutSettlement(accountantActor, {
    residentId: resident2Id,
    checkOutDate: "2026-10-23",
    depositAppliedAmount: 6000,
    refundAmount: 4000,
    refundPaymentMethod: "CASH",
  }, undefined, db);

  const previewAfterSettlement = await previewDailyClosing(accountantActor, "2026-10-23", "COMBINED", db);

  // Invariant 1: Deposit Application (₹6,000) must NOT be counted as a new cash or bank inflow!
  // Invariant 2: Deposit Refund (₹4,000) MUST be counted as a real CASH outflow!
  // Previous CASH Inflow = 5000 (unchanged!)
  // Previous CASH Outflow = 1500 + 4000 (refund) = 5500
  // Previous Expected Cash was 10500 - 4000 = 6500
  assert(previewAfterSettlement.channelBreakdown.CASH.inflow === 5000, `CASH inflow remains ₹5,000 without non-cash deposit application inflation (got ₹${previewAfterSettlement.channelBreakdown.CASH.inflow})`);
  assert(previewAfterSettlement.channelBreakdown.CASH.outflow === 5500, `CASH outflow correctly increased by ₹4,000 refund to ₹5,500 (got ₹${previewAfterSettlement.channelBreakdown.CASH.outflow})`);
  assert(previewAfterSettlement.expectedCashBalance === 6500, `Expected cash in hand correctly accounts for deposit refund: ₹6,500 (got ₹${previewAfterSettlement.expectedCashBalance})`);

  console.log("\n--- 5. Cash Discrepancy & Mandatory Justification Enforcement ---");
  // Attempt finalization with variance and missing justification -> must reject!
  let failedValidation = false;
  try {
    await finalizeDailyClosing(accountantActor, {
      closingDate: "2026-10-23",
      division: "COMBINED",
      actualCashCounted: 6000, // Shortage of ₹500
      discrepancyReason: "", // Empty reason!
    }, undefined, db);
  } catch (err: any) {
    failedValidation = true;
    assert(err.message.includes("mandatory"), `Rejected finalization with missing discrepancy reason: '${err.message}'`);
  }
  assert(failedValidation, "Finalization failed as expected when discrepancy justification was missing");

  // Attempt finalization with too short justification (< 5 chars) -> must reject!
  let shortReasonFailed = false;
  try {
    await finalizeDailyClosing(accountantActor, {
      closingDate: "2026-10-23",
      division: "COMBINED",
      actualCashCounted: 6000, // Shortage of ₹500
      discrepancyReason: "bad", // 3 chars
    }, undefined, db);
  } catch (err: any) {
    shortReasonFailed = true;
    assert(err.message.includes("at least 5 characters"), `Rejected finalization with short reason: '${err.message}'`);
  }
  assert(shortReasonFailed, "Finalization failed as expected when reason was shorter than 5 chars");

  console.log("\n--- 6. Atomic Finalization & Locking ---");
  // Finalize closing with exact match (counted cash = 6500)
  const finalizedDay1 = await finalizeDailyClosing(accountantActor, {
    closingDate: "2026-10-23",
    division: "COMBINED",
    actualCashCounted: 6500,
    actualBankVerified: 32500,
    notes: "Day 1 closing verified by Head Accountant",
  }, undefined, db);

  assert(finalizedDay1.status === "FINALIZED", "Closing status is FINALIZED");
  assert(finalizedDay1.cashDiscrepancy === 0, "Cash discrepancy is ₹0 (Balanced)");
  assert(finalizedDay1.finalizedBy === accountantActor.id, "Attributed finalizedBy to accountantActor");
  assert(Boolean(finalizedDay1.snapshotData), "Snapshot data stored upon finalization");

  // Attempt to re-finalize day 1 -> must reject!
  let duplicateFinalizeFailed = false;
  try {
    await finalizeDailyClosing(accountantActor, {
      closingDate: "2026-10-23",
      division: "COMBINED",
      actualCashCounted: 6500,
    }, undefined, db);
  } catch (err: any) {
    duplicateFinalizeFailed = true;
    assert(err.message.includes("already FINALIZED"), `Prevented duplicate finalization: '${err.message}'`);
  }
  assert(duplicateFinalizeFailed, "Duplicate finalization prevented");

  // Attempt to save draft over finalized closing -> must reject!
  let draftOverFinalizeFailed = false;
  try {
    await saveDailyClosingDraft(accountantActor, {
      closingDate: "2026-10-23",
      division: "COMBINED",
      actualCashCounted: 6500,
    }, undefined, db);
  } catch (err: any) {
    draftOverFinalizeFailed = true;
    assert(err.message.includes("locked"), `Prevented draft overwrite on finalized closing: '${err.message}'`);
  }
  assert(draftOverFinalizeFailed, "Draft overwrite on finalized closing prevented");

  console.log("\n--- 7. Opening Balance Rollover to Next Day (2026-10-24) ---");
  // When previewing 2026-10-24, opening balances must match finalized 2026-10-23 closing figures!
  const previewDay2 = await previewDailyClosing(accountantActor, "2026-10-24", "COMBINED", db);
  assert(previewDay2.openingCashBalance === 6500, `Day 2 opening cash balance matches Day 1 finalized actual cash (₹6,500 vs got ₹${previewDay2.openingCashBalance})`);
  assert(previewDay2.openingBalance === 39000, `Day 2 opening total balance matches Day 1 finalized balance (got ₹${previewDay2.openingBalance})`);

  console.log("\n--- 8. Late-Entered Transactions Detection & Write Lock Enforcement ---");
  // While 2026-10-23 is FINALIZED, attempting to post a payment for 2026-10-23 must fail with closing lock!
  let postOnFinalizedFailed = false;
  try {
    await recordRentPayment(accountantActor, {
      residentId,
      stayId,
      amount: 2000,
      transactionDate: "2026-10-23",
      paymentMethod: "CASH",
    }, db);
  } catch (err: any) {
    postOnFinalizedFailed = true;
    assert(err.message.includes("FINALIZED and locked"), `Prevented payment on finalized day: '${err.message}'`);
  }
  assert(postOnFinalizedFailed, "Financial write path strictly rejects transactions on finalized closing date");

  // Simulate an out-of-band late transaction to verify preview snapshot discrepancy detection
  await db.execute(`
    INSERT INTO financial_transactions (
      id, transaction_type, amount, transaction_date, payment_method,
      resident_id, stay_id, category, description, idempotency_key,
      status, created_by, created_at, updated_at
    ) VALUES (
      'txn_late_test_01', 'RENT_PAYMENT', 2000, '2026-10-23', 'CASH',
      ?, ?, 'RENT', 'Out of band late payment', 'idemp_late_01',
      'POSTED', ?, ?, ?
    )
  `, [residentId, stayId, accountantActor.id, now, now]);

  // Preview Day 1: Must detect late transaction and flag discrepancy vs locked snapshot!
  const previewDay1Late = await previewDailyClosing(accountantActor, "2026-10-23", "COMBINED", db);
  assert(previewDay1Late.hasLateTransactions === true, "hasLateTransactions is flagged as true");
  assert(previewDay1Late.lateTransactionCount === 1, "lateTransactionCount is 1");
  assert(previewDay1Late.lateTransactionDelta === 2000, `lateTransactionDelta is ₹2,000 (got ₹${previewDay1Late.lateTransactionDelta})`);
  assert(previewDay1Late.existingClosing?.status === "FINALIZED", "Existing closing record remains locked in FINALIZED state");

  console.log("\n--- 9. Supervisor Reopening Workflow & RBAC Enforcement ---");
  // Delivery person attempting to reopen -> must fail 403
  let courierReopenFailed = false;
  try {
    await reopenDailyClosing(deliveryActor, {
      closingId: finalizedDay1.id,
      reason: "Attempting courier reopen",
    }, undefined, db);
  } catch (err: any) {
    courierReopenFailed = true;
    assert(err.message.includes("Access denied") || err.message.includes("permissions") || err.message.includes("SUPER_ADMIN"), "Courier denied reopening");
  }
  assert(courierReopenFailed, "Courier denied reopening permission");

  // Reopen with short reason -> must reject
  let shortReopenReasonFailed = false;
  try {
    await reopenDailyClosing(adminActor, {
      closingId: finalizedDay1.id,
      reason: "fix",
    }, undefined, db);
  } catch (err: any) {
    shortReopenReasonFailed = true;
    assert(err.message.includes("at least 5 characters"), "Rejected short reopen reason");
  }
  assert(shortReopenReasonFailed, "Reopen with short reason rejected");

  // Reopen by SUPER_ADMIN with valid reason
  const reopenedClosing = await reopenDailyClosing(adminActor, {
    closingId: finalizedDay1.id,
    reason: "Reopening to incorporate late ₹2,000 cash payment received from resident",
  }, undefined, db);

  assert(reopenedClosing.status === "REOPENED", "Status updated to REOPENED");
  assert(reopenedClosing.reopenedBy === adminActor.id, "Attributed reopenedBy to adminActor");
  assert(reopenedClosing.reopenReason?.includes("late ₹2,000"), "Reopen reason persisted");

  // Re-finalize Day 1 with new cash total (6500 + 2000 = 8500)
  const reFinalized = await finalizeDailyClosing(accountantActor, {
    closingDate: "2026-10-23",
    division: "COMBINED",
    actualCashCounted: 8500,
    actualBankVerified: 32500,
    notes: "Refinalized after late payment included",
  }, undefined, db);

  assert(reFinalized.status === "FINALIZED", "Refinalized successfully");
  assert(reFinalized.actualCashCounted === 8500, "Counted cash updated to ₹8,500");
  assert(reFinalized.cashDiscrepancy === 0, "Cash discrepancy resolved to ₹0");

  console.log("\n--- 10. Financial Reversals Handling (Same-Day vs Cross-Day) ---");
  // Day 3 (2026-10-25): Post a payment of ₹3,000 cash, then reverse it on the same day
  const txToReverse = await recordRentPayment(accountantActor, {
    residentId,
    stayId,
    amount: 3000,
    transactionDate: "2026-10-25",
    paymentMethod: "CASH",
  }, db);

  // Reverse transaction on same day
  const reversal = await reverseTransaction(accountantActor, txToReverse.id, "Entered incorrect resident stay account", undefined, db);
  // In testing synthetic future dates, set reversal transaction_date to match same-day 2026-10-25
  await db.execute(`UPDATE financial_transactions SET transaction_date = '2026-10-25' WHERE id = ?`, [reversal.id]);

  // Preview Day 3: Net movement for this transaction must be ₹0!
  const previewDay3 = await previewDailyClosing(accountantActor, "2026-10-25", "COMBINED", db);
  assert(previewDay3.channelBreakdown.CASH.net === 0, `Same-day reversal net CASH movement is ₹0 (got ₹${previewDay3.channelBreakdown.CASH.net})`);

  console.log("\n--- 11. Division Filtering (COMBINED vs PG vs TIFFIN) ---");
  // Post PG payment of ₹1,000 on 2026-10-26
  await recordRentPayment(accountantActor, {
    residentId,
    stayId,
    amount: 1000,
    transactionDate: "2026-10-26",
    paymentMethod: "CASH",
  }, db);

  // Post Tiffin payment of ₹2,000 on 2026-10-26
  await db.execute(`
    INSERT INTO financial_transactions (
      id, transaction_type, amount, transaction_date, payment_method, customer_id,
      category, description, idempotency_key, status, created_by, created_at, updated_at
    ) VALUES ('ft_tif_div_01', 'TIFFIN_PAYMENT', 2000, '2026-10-26', 'UPI', ?, 'TIFFIN_COLLECTION', 'Tiffin Div Test', 'idemp_div_01', 'POSTED', ?, ?, ?)
  `, [customerId, accountantActor.id, now, now]);

  const previewPG = await previewDailyClosing(accountantActor, "2026-10-26", "PG", db);
  const previewTiffin = await previewDailyClosing(accountantActor, "2026-10-26", "TIFFIN", db);
  const previewCombined = await previewDailyClosing(accountantActor, "2026-10-26", "COMBINED", db);

  assert(previewPG.totalInflow === 1000, `PG division isolated to ₹1,000 inflow (got ₹${previewPG.totalInflow})`);
  assert(previewTiffin.totalInflow === 2000, `TIFFIN division isolated to ₹2,000 inflow (got ₹${previewTiffin.totalInflow})`);
  assert(previewCombined.totalInflow === 3000, `COMBINED division sums to ₹3,000 inflow (got ₹${previewCombined.totalInflow})`);

  console.log("\n--- 12. History Listing and Queries ---");
  const listAll = await listDailyClosings(accountantActor, {}, db);
  assert(listAll.length >= 1, `Historical list returns closings (count: ${listAll.length})`);
  assert(listAll[0].closingDate === "2026-10-23", "Most recent closing listed first");

  console.log("\n--- 13. Audit Log Verification ---");
  const auditLogs = await db.query<any>(`
    SELECT * FROM audit_logs
    WHERE action IN ('finance.daily_closing_finalized', 'finance.daily_closing_reopened')
    ORDER BY created_at ASC
  `);
  assert(auditLogs.length >= 2, `Audit logs recorded for finalization and reopening (count: ${auditLogs.length})`);
  assert(auditLogs.some((l) => l.action === "finance.daily_closing_finalized"), "finance.daily_closing_finalized audit log exists");
  assert(auditLogs.some((l) => l.action === "finance.daily_closing_reopened"), "finance.daily_closing_reopened audit log exists");

  console.log("\n--- 14. Verification of Primary DB Immutability ---");
  if (primaryStatsBefore) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(primaryStatsBefore.size === primaryStatsAfter.size, `Primary database data/erp.db size untouched (${primaryStatsAfter.size} bytes)`);
    assert(primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs, "Primary database data/erp.db mtime untouched");
  } else {
    assert(!fs.existsSync(primaryDbPath), "Primary db does not exist in this environment");
  }

  // Cleanup
  cleanupTestDb();

  console.log("\n================================================================================");
  console.log(`TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution aborted with unhandled error:", err);
  cleanupTestDb();
  process.exit(1);
});
