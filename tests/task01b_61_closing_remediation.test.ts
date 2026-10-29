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
  getResidentRentBalance,
  assertClosingDateNotFinalized,
} from "../apps/erp/src/server/finance/financeService";
import {
  saveDailyClosingDraft,
  finalizeDailyClosing,
  reopenDailyClosing,
  previewDailyClosing,
} from "../apps/erp/src/server/finance/cashbookClosingService";
import {
  previewResidentSettlement,
  finalizeResidentCheckoutSettlement,
} from "../apps/erp/src/server/residents/residentSettlementService";
import {
  recordTiffinPayment,
} from "../apps/erp/src/server/tiffin/tiffinBillingService";
import {
  AuthenticatedUser,
} from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test database
const TEST_CLOSING61_DB_PATH = path.resolve(__dirname, "test_task61_closing.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_CLOSING61_DB_PATH)) fs.unlinkSync(TEST_CLOSING61_DB_PATH);
  const wal = `${TEST_CLOSING61_DB_PATH}-wal`;
  const shm = `${TEST_CLOSING61_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_CLOSING61_DB_PATH;

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
console.log("TASK 01B.61 REGRESSION TEST SUITE: CLOSING LOCKS & CASHBOOK ACCURACY");
console.log("================================================================================\n");

async function runTests() {
  // 1. Initialize schema in isolated DB
  console.log("--- 1. Initializing isolated database with schema migrations ---");
  const rawDb = new Database(TEST_CLOSING61_DB_PATH);
  runMigrations(rawDb);
  const userVersion = rawDb.pragma("user_version", { simple: true }) as number;
  assert(userVersion >= 18, `Database user_version successfully advanced to V18 (got ${userVersion})`);
  rawDb.close();

  const db = getAsyncDb();

  // Test Actors
  const adminActor: AuthenticatedUser = {
    id: "usr_admin_61",
    username: "superadmin_61",
    email: "admin61@ravinarayana.com",
    fullName: "Super Admin 61",
    role: "SUPER_ADMIN",
  };

  const accountantActor: AuthenticatedUser = {
    id: "usr_acct_61",
    username: "accountant_61",
    email: "acct61@ravinarayana.com",
    fullName: "Chief Accountant 61",
    role: "ACCOUNTANT",
  };

  const opsActor: AuthenticatedUser = {
    id: "usr_ops_61",
    username: "opsmanager_61",
    email: "ops61@ravinarayana.com",
    fullName: "Operations Manager 61",
    role: "OPERATIONS_MANAGER",
  };

  // Seed staff users into database
  const now = new Date().toISOString();
  for (const actor of [adminActor, accountantActor, opsActor]) {
    await db.execute(`
      INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'hash', ?, 1, ?, ?)
    `, [actor.id, actor.username, actor.email, actor.fullName, actor.role, now, now]);
  }

  // Seed Rooms
  await db.execute(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES
      ('room_61_101', '101', 1, 'DOUBLE', 2, 8000, 1, ?, ?),
      ('room_61_102', '102', 1, 'SINGLE', 1, 12000, 1, ?, ?)
  `, [now, now, now, now]);

  // Seed Residents and Stays
  const residentId1 = "res_61_01";
  await db.execute(`
    INSERT INTO residents (id, full_name, phone, emergency_contact, status, created_at, updated_at)
    VALUES (?, 'Kavita Sharma', '9876543210', 'Papa 9876543211', 'ACTIVE', ?, ?)
  `, [residentId1, now, now]);

  const stayId1 = "stay_61_01";
  await db.execute(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, check_out_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES (?, ?, 'room_61_101', '2026-10-01', NULL, 8000, 10000, 'ACTIVE', ?, ?)
  `, [stayId1, residentId1, now, now]);

  // Seed Tiffin Customer
  const customerId1 = "cust_61_01";
  await db.execute(`
    INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, status, created_by, created_at, updated_at)
    VALUES (?, 'Sunil Verma', '9123456780', 'Flat 402, Sunrise Apt', 'ACTIVE', ?, ?, ?)
  `, [customerId1, adminActor.id, now, now]);

  console.log("\n--- 2. Write Lock Enforcement on Finalized PG Closing (2026-10-10) ---");
  // Finalize a daily closing for 2026-10-10 with division = 'PG'
  await finalizeDailyClosing(accountantActor, {
    closingDate: "2026-10-10",
    division: "PG",
    actualCashCounted: 0,
    actualBankVerified: 0,
    notes: "Day 2026-10-10 PG closing finalized",
  }, undefined, db);

  // Attempting RENT_PAYMENT on 2026-10-10 must fail
  let rentPaymentBlocked = false;
  try {
    // First bill resident so balance check passes
    await recordRentCharge(accountantActor, {
      residentId: residentId1,
      stayId: stayId1,
      amount: 8000,
      transactionDate: "2026-10-05", // open date
      billingPeriod: "October 2026",
    }, undefined, db);

    await recordRentPayment(accountantActor, {
      residentId: residentId1,
      stayId: stayId1,
      amount: 4000,
      transactionDate: "2026-10-10", // locked date!
      paymentMethod: "CASH",
    }, undefined, db);
  } catch (err: any) {
    rentPaymentBlocked = true;
    assert(err.message.includes("FINALIZED and locked"), `recordRentPayment blocked: '${err.message}'`);
  }
  assert(rentPaymentBlocked, "recordRentPayment on finalized PG day was strictly blocked");

  // Attempting RENT_CHARGE on 2026-10-10 must fail
  let rentChargeBlocked = false;
  try {
    await recordRentCharge(accountantActor, {
      residentId: residentId1,
      stayId: stayId1,
      amount: 8000,
      transactionDate: "2026-10-10", // locked date!
      billingPeriod: "October 2026",
    }, undefined, db);
  } catch (err: any) {
    rentChargeBlocked = true;
    assert(err.message.includes("FINALIZED and locked"), `recordRentCharge blocked: '${err.message}'`);
  }
  assert(rentChargeBlocked, "recordRentCharge on finalized PG day was strictly blocked");

  // Attempting SECURITY_DEPOSIT on 2026-10-10 must fail
  let depositBlocked = false;
  try {
    await recordSecurityDeposit(accountantActor, {
      residentId: residentId1,
      stayId: stayId1,
      amount: 10000,
      transactionDate: "2026-10-10", // locked date!
      paymentMethod: "UPI",
    }, undefined, db);
  } catch (err: any) {
    depositBlocked = true;
    assert(err.message.includes("FINALIZED and locked"), `recordSecurityDeposit blocked: '${err.message}'`);
  }
  assert(depositBlocked, "recordSecurityDeposit on finalized PG day was strictly blocked");

  // Attempting PG EXPENSE (MAINTENANCE) on 2026-10-10 must fail
  let pgExpenseBlocked = false;
  try {
    await recordExpense(accountantActor, {
      category: "MAINTENANCE",
      amount: 1200,
      transactionDate: "2026-10-10", // locked date!
      paymentMethod: "CASH",
      description: "Fan replacement",
    }, undefined, db);
  } catch (err: any) {
    pgExpenseBlocked = true;
    assert(err.message.includes("FINALIZED and locked"), `recordExpense (MAINTENANCE) blocked: '${err.message}'`);
  }
  assert(pgExpenseBlocked, "recordExpense (MAINTENANCE) on finalized PG day was strictly blocked");

  console.log("\n--- 3. Division Isolation: PG Closing Does NOT Block TIFFIN Transactions ---");
  // TIFFIN division on 2026-10-10 is NOT finalized yet
  // Attempting TIFFIN EXPENSE (GROCERY) on 2026-10-10 must SUCCEED!
  const groceryExp = await recordExpense(accountantActor, {
    category: "GROCERY",
    amount: 2500,
    transactionDate: "2026-10-10",
    paymentMethod: "CASH",
    description: "Vegetables for tiffin",
  }, undefined, db);
  assert(groceryExp.id.startsWith("txn_"), `Grocery expense recorded on open TIFFIN division: ${groceryExp.id}`);

  // Attempting TIFFIN_PAYMENT on 2026-10-10 must SUCCEED!
  const tiffinPay = await recordTiffinPayment(accountantActor, {
    customerId: customerId1,
    amount: 1800,
    transactionDate: "2026-10-10",
    paymentMethod: "UPI",
  }, undefined, db);
  assert(tiffinPay.transaction.id.startsWith("txn_"), `Tiffin payment recorded on open TIFFIN division: ${tiffinPay.transaction.id}`);

  // Now finalize TIFFIN division for 2026-10-10
  await finalizeDailyClosing(accountantActor, {
    closingDate: "2026-10-10",
    division: "TIFFIN",
    actualCashCounted: 0,
    actualBankVerified: 1800,
    discrepancyReason: "Cash spent on groceries",
    notes: "Day 2026-10-10 TIFFIN closing finalized",
  }, undefined, db);

  // Now attempting GROCERY expense on 2026-10-10 must fail!
  let groceryExpBlocked = false;
  try {
    await recordExpense(accountantActor, {
      category: "GROCERY",
      amount: 500,
      transactionDate: "2026-10-10",
      paymentMethod: "CASH",
      description: "Spices for tiffin",
    }, undefined, db);
  } catch (err: any) {
    groceryExpBlocked = true;
    assert(err.message.includes("FINALIZED and locked"), `Grocery expense blocked after TIFFIN closing: '${err.message}'`);
  }
  assert(groceryExpBlocked, "Grocery expense on finalized TIFFIN day was strictly blocked");

  // Now attempting TIFFIN_PAYMENT on 2026-10-10 must fail!
  let tiffinPayBlocked = false;
  try {
    await recordTiffinPayment(accountantActor, {
      customerId: customerId1,
      amount: 1200,
      transactionDate: "2026-10-10",
      paymentMethod: "UPI",
    }, undefined, db);
  } catch (err: any) {
    tiffinPayBlocked = true;
    assert(err.message.includes("FINALIZED and locked"), `Tiffin payment blocked after TIFFIN closing: '${err.message}'`);
  }
  assert(tiffinPayBlocked, "Tiffin payment on finalized TIFFIN day was strictly blocked");

  console.log("\n--- 4. COMBINED Division Closing Locks BOTH PG and TIFFIN Transactions ---");
  // Finalize 2026-10-12 with division = 'COMBINED'
  await finalizeDailyClosing(accountantActor, {
    closingDate: "2026-10-12",
    division: "COMBINED",
    actualCashCounted: 0,
    actualBankVerified: 0,
    discrepancyReason: "Cash drawer balance adjustment for petty cash",
    notes: "Day 2026-10-12 COMBINED closing finalized",
  }, undefined, db);

  // PG transaction blocked by COMBINED closing
  let combinedBlocksPg = false;
  try {
    await recordRentPayment(accountantActor, {
      residentId: residentId1,
      stayId: stayId1,
      amount: 1000,
      transactionDate: "2026-10-12",
      paymentMethod: "CASH",
    }, undefined, db);
  } catch (err: any) {
    combinedBlocksPg = true;
    assert(err.message.includes("COMBINED"), `COMBINED closing blocks PG: '${err.message}'`);
  }
  assert(combinedBlocksPg, "COMBINED closing blocked PG rent payment");

  // TIFFIN transaction blocked by COMBINED closing
  let combinedBlocksTiffin = false;
  try {
    await recordTiffinPayment(accountantActor, {
      customerId: customerId1,
      amount: 1000,
      transactionDate: "2026-10-12",
      paymentMethod: "UPI",
    }, undefined, db);
  } catch (err: any) {
    combinedBlocksTiffin = true;
    assert(err.message.includes("COMBINED"), `COMBINED closing blocks TIFFIN: '${err.message}'`);
  }
  assert(combinedBlocksTiffin, "COMBINED closing blocked TIFFIN payment");

  console.log("\n--- 5. Resident Checkout Settlement Closing Lock & Reopen Workflow ---");
  // Seed second resident for checkout settlement test
  const residentId2 = "res_61_02";
  await db.execute(`
    INSERT INTO residents (id, full_name, phone, emergency_contact, status, created_at, updated_at)
    VALUES (?, 'Rohan Gupta', '9988776655', 'Bhaiya 9988776656', 'ACTIVE', ?, ?)
  `, [residentId2, now, now]);

  const stayId2 = "stay_61_02";
  await db.execute(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, check_out_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES (?, ?, 'room_61_102', '2026-10-01', NULL, 12000, 10000, 'ACTIVE', ?, ?)
  `, [stayId2, residentId2, now, now]);

  // Post initial security deposit and rent charge on open dates
  await recordSecurityDeposit(accountantActor, {
    residentId: residentId2,
    stayId: stayId2,
    amount: 10000,
    transactionDate: "2026-10-01",
    paymentMethod: "BANK_TRANSFER",
  }, undefined, db);

  await recordRentCharge(accountantActor, {
    residentId: residentId2,
    stayId: stayId2,
    amount: 12000,
    transactionDate: "2026-10-01",
    billingPeriod: "October 2026",
  }, undefined, db);

  // Resident pays partial rent of ₹4,000 on open date
  await recordRentPayment(accountantActor, {
    residentId: residentId2,
    stayId: stayId2,
    amount: 4000,
    transactionDate: "2026-10-02",
    paymentMethod: "UPI",
  }, undefined, db);

  // Attempt checkout settlement on 2026-10-12 (which is locked by COMBINED closing) -> must fail!
  let checkoutOnLockedDayBlocked = false;
  try {
    await finalizeResidentCheckoutSettlement(accountantActor, {
      residentId: residentId2,
      checkOutDate: "2026-10-12", // locked date!
      deductions: [],
      depositAppliedAmount: 8000,
      refundAmount: 2000,
      refundPaymentMethod: "BANK_TRANSFER",
    }, undefined, db);
  } catch (err: any) {
    checkoutOnLockedDayBlocked = true;
    assert(err.message.includes("FINALIZED and locked"), `Checkout settlement blocked on locked date: '${err.message}'`);
  }
  assert(checkoutOnLockedDayBlocked, "Checkout settlement on locked closing date was strictly blocked");

  // Reopen 2026-10-12 closing
  const closing12 = await db.queryOne<{ id: string }>(`
    SELECT id FROM daily_cashbook_closings WHERE closing_date = '2026-10-12' AND division = 'COMBINED'
  `);
  assert(Boolean(closing12?.id), "Found closing record for 2026-10-12");

  await reopenDailyClosing(adminActor, {
    closingId: closing12!.id,
    reason: "Reopening to allow checkout settlement for Rohan Gupta",
  }, undefined, db);

  // Now execute checkout settlement on 2026-10-12 -> MUST SUCCEED!
  const settlement = await finalizeResidentCheckoutSettlement(accountantActor, {
    residentId: residentId2,
    checkOutDate: "2026-10-12",
    deductions: [],
    depositAppliedAmount: 8000,
    refundAmount: 2000,
    refundPaymentMethod: "BANK_TRANSFER",
  }, undefined, db);

  assert(settlement.settlementStatus === "SETTLED", `Settlement completed successfully with status: ${settlement.settlementStatus}`);
  assert(settlement.depositAppliedAmount === 8000, "Deposit applied: ₹8,000");
  assert(settlement.refundAmount === 2000, "Deposit refund: ₹2,000");

  console.log("\n--- 6. Cashbook Accuracy: Deposit Application Exclusion from Cash Collected ---");
  // Verify getCashbookSummary for the period covering checkout (2026-10-01 to 2026-10-15)
  const cashbookPg = await getCashbookSummary(accountantActor, {
    startDate: "2026-10-01",
    endDate: "2026-10-15",
    division: "PG",
  }, db);

  // Rent collected must ONLY be the ₹4,000 cash/UPI payment; NOT ₹4,000 + ₹8,000 = ₹12,000!
  // The ₹8,000 was a non-cash deposit application offset.
  assert(
    cashbookPg.totalRentCollected === 4000,
    `totalRentCollected strictly excludes DEPOSIT_APPLICATION: got ₹${cashbookPg.totalRentCollected} (expected ₹4,000)`
  );

  // Deposits collected in period = ₹10,000 deposit - ₹2,000 refund = ₹8,000
  assert(
    cashbookPg.totalDepositsCollected === 8000,
    `totalDepositsCollected accounts for refund: got ₹${cashbookPg.totalDepositsCollected} (expected ₹8,000)`
  );

  // Net Cash Movement = Rent Inflow (₹4,000) + Net Deposit (₹8,000) - Expenses (₹0) = ₹12,000
  // Which matches physical cash received: ₹10,000 deposit + ₹4,000 rent - ₹2,000 refund = ₹12,000!
  assert(
    cashbookPg.netCashMovement === 12000,
    `netCashMovement is ₹12,000: got ₹${cashbookPg.netCashMovement}`
  );

  // Outstanding Rent Balance for residentId2 must be ₹0 (since ₹4,000 cash + ₹8,000 deposit offset satisfied the ₹12,000 charge)
  const residentRentBal = await getResidentRentBalance(residentId2, db);
  assert(residentRentBal === 0, `Resident outstanding rent balance is ₹0: got ₹${residentRentBal}`);

  // Resident Financial Summary:
  // Must reflect ₹0 security deposit held (₹10,000 - ₹2,000 refund - ₹8,000 applied = ₹0)
  const residentDossier = await getResidentFinancialSummary(accountantActor, residentId2, db);
  assert(
    residentDossier.totalSecurityDepositHeld === 0,
    `totalSecurityDepositHeld is ₹0 after checkout settlement: got ₹${residentDossier.totalSecurityDepositHeld}`
  );
  assert(
    residentDossier.totalRentPaid === 12000,
    `totalRentPaid is ₹12,000 (includes deposit application clearing debt): got ₹${residentDossier.totalRentPaid}`
  );
  assert(
    residentDossier.outstandingRentBalance === 0,
    `outstandingRentBalance is ₹0: got ₹${residentDossier.outstandingRentBalance}`
  );

  console.log("\n--- 7. Reversal Guard on Finalized Closing Date ---");
  // Post an expense on open date 2026-10-18
  const expToReverse = await recordExpense(accountantActor, {
    category: "INTERNET",
    amount: 1500,
    transactionDate: "2026-10-18",
    paymentMethod: "UPI",
    description: "Office Wifi Recharge",
  }, undefined, db);

  // Today is the date reverseTransaction records on.
  // If today is finalized, reversal must be blocked.
  const todayStr = new Date().toISOString().slice(0, 10);
  const previewToday = await previewDailyClosing(accountantActor, todayStr, "PG", db);
  const actualCashToday = Math.max(0, previewToday.expectedCashBalance);
  await finalizeDailyClosing(accountantActor, {
    closingDate: todayStr,
    division: "PG",
    actualCashCounted: actualCashToday,
    actualBankVerified: 0,
    discrepancyReason: actualCashToday !== previewToday.expectedCashBalance ? "Petty cash float covering negative balance" : undefined,
    notes: "Locking today PG closing",
  }, undefined, db);

  let reversalBlockedOnLockedDay = false;
  try {
    await reverseTransaction(accountantActor, expToReverse.id, "Incorrect office wifi recharge amount", undefined, db);
  } catch (err: any) {
    reversalBlockedOnLockedDay = true;
    assert(err.message.includes("FINALIZED and locked"), `Reversal blocked on finalized date: '${err.message}'`);
  }
  assert(reversalBlockedOnLockedDay, "reverseTransaction blocked when current date has a finalized closing");

  // Reopen today's closing
  const todayClosing = await db.queryOne<{ id: string }>(`
    SELECT id FROM daily_cashbook_closings WHERE closing_date = ? AND division = 'PG'
  `, [todayStr]);
  assert(Boolean(todayClosing?.id), "Found today closing record");

  await reopenDailyClosing(adminActor, {
    closingId: todayClosing!.id,
    reason: "Reopening today to allow correcting accidental expense recharge entry",
  }, undefined, db);

  // Now reversal must succeed!
  const reversalTx = await reverseTransaction(accountantActor, expToReverse.id, "Incorrect office wifi recharge amount", undefined, db);
  assert(reversalTx.transactionType === "REVERSAL", `Reversal posted successfully: ${reversalTx.id}`);

  console.log("\n--- 8. Verification of Primary DB Immutability ---");
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
