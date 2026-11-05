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
  reverseTransaction,
  getCashbookSummary,
  getResidentFinancialSummary,
} from "../apps/erp/src/server/finance/financeService";
import {
  previewResidentSettlement,
  finalizeResidentCheckoutSettlement,
  getResidentSettlementByStayId,
  listResidentSettlements,
} from "../apps/erp/src/server/residents/residentSettlementService";
import {
  checkOutResident,
  listResidents,
} from "../apps/erp/src/server/residents/residentService";
import {
  createInvoice,
} from "../apps/erp/src/server/finance/invoiceService";
import {
  AuthenticatedUser,
  PaymentMethod,
  normalizePaymentMethod,
} from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test database
const TEST_SETTLE52_DB_PATH = path.resolve(__dirname, "test_task52_settlement.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_SETTLE52_DB_PATH)) fs.unlinkSync(TEST_SETTLE52_DB_PATH);
  const wal = `${TEST_SETTLE52_DB_PATH}-wal`;
  const shm = `${TEST_SETTLE52_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_SETTLE52_DB_PATH;

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
console.log("TASK 01B.52 REGRESSION TEST SUITE: RESIDENT CHECKOUT & FINAL SETTLEMENT");
console.log("================================================================================\n");

async function runTests() {
  // 1. Initialize schema in isolated DB
  console.log("--- 1. Initializing isolated database with schema migrations ---");
  const rawDb = new Database(TEST_SETTLE52_DB_PATH);
  runMigrations(rawDb);
  const userVersion = rawDb.pragma("user_version", { simple: true }) as number;
  assert(userVersion >= 17, `Database user_version successfully advanced to V17 (got ${userVersion})`);
  
  // Verify resident_settlements table exists
  const settlementTable = rawDb.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='resident_settlements'").get() as { count: number };
  assert(settlementTable.count === 1, "resident_settlements table exists in SQLite database");
  rawDb.close();

  const db = getAsyncDb();

  // Test Actors
  const adminActor: AuthenticatedUser = {
    id: "usr_admin_52",
    username: "superadmin_52",
    email: "admin52@ravinarayana.com",
    fullName: "Super Admin 52",
    role: "SUPER_ADMIN",
  };

  const opsActor: AuthenticatedUser = {
    id: "usr_ops_52",
    username: "opsmanager_52",
    email: "ops52@ravinarayana.com",
    fullName: "Operations Manager 52",
    role: "OPERATIONS_MANAGER",
  };

  // Decision 2026-11-01: a settlement that moves deposit money is finalized by the Owner; the
  // Manager prepares it and sends it for approval. The settlement arithmetic below therefore runs
  // as the Owner, and Scenario 0 checks the Manager is refused.
  const ownerActor: AuthenticatedUser = {
    id: "usr_owner_52",
    username: "owner_52",
    email: "owner52@ravinarayana.com",
    fullName: "Owner 52",
    role: "SUPER_ADMIN",
  };

  const accountantActor: AuthenticatedUser = {
    id: "usr_acct_52",
    username: "accountant_52",
    email: "acct52@ravinarayana.com",
    fullName: "Chief Accountant 52",
    role: "ACCOUNTANT",
  };

  const kitchenActor: AuthenticatedUser = {
    id: "usr_kitchen_52",
    username: "kitchen_52",
    email: "kitchen52@ravinarayana.com",
    fullName: "Kitchen Staff 52",
    role: "KITCHEN_OPERATIONS",
  };

  const deliveryActor: AuthenticatedUser = {
    id: "usr_del_52",
    username: "delivery_52",
    email: "delivery52@ravinarayana.com",
    fullName: "Delivery Staff 52",
    role: "DELIVERY_PERSON",
  };

  const now = new Date().toISOString();

  // Seed staff users
  for (const u of [adminActor, ownerActor, opsActor, accountantActor, kitchenActor, deliveryActor]) {
    await db.execute(`
      INSERT INTO staff_users (id, username, email, full_name, role, password_hash, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'hash', 1, ?, ?)
    `, [u.id, u.username, u.email, u.fullName, u.role, now, now]);
  }

  // Seed rooms
  await db.execute(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES
      ('rm_101', '101', 1, 'DOUBLE', 2, 8000, 1, ?, ?),
      ('rm_102', '102', 1, 'SINGLE', 1, 12000, 1, ?, ?),
      ('rm_103', '103', 1, 'DOUBLE', 2, 9000, 1, ?, ?),
      ('rm_104', '104', 1, 'TRIPLE', 3, 7000, 1, ?, ?),
      ('rm_105', '105', 1, 'SINGLE', 1, 10000, 1, ?, ?)
  `, [now, now, now, now, now, now, now, now, now, now]);

  console.log("\n--- SECTION 1: SETTLEMENT CALCULATION SCENARIOS (1-12) ---");

  // Helper to create resident and stay
  async function createResidentWithStay(opts: {
    id: string;
    name: string;
    phone: string;
    roomId: string;
    checkInDate: string;
    monthlyRent: number;
    securityDeposit: number;
  }) {
    await db.execute(`
      INSERT INTO residents (id, full_name, phone, status, created_at, updated_at)
      VALUES (?, ?, ?, 'ACTIVE', ?, ?)
    `, [opts.id, opts.name, opts.phone, now, now]);

    const stayId = `stay_${opts.id}`;
    await db.execute(`
      INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `, [stayId, opts.id, opts.roomId, opts.checkInDate, opts.monthlyRent, opts.securityDeposit, now, now]);

    return { residentId: opts.id, stayId, roomId: opts.roomId };
  }

  // SCENARIO 1: Resident with fully paid rent and a refundable deposit
  console.log("\n[Scenario 1] Fully paid rent and refundable deposit");
  const s1 = await createResidentWithStay({
    id: "res_01",
    name: "Aakash Patel",
    phone: "+919000000001",
    roomId: "rm_101",
    checkInDate: "2026-09-01",
    monthlyRent: 8000,
    securityDeposit: 16000,
  });

  // Post deposit and rent charge/payment
  await recordSecurityDeposit(accountantActor, {
    residentId: s1.residentId,
    stayId: s1.stayId,
    amount: 16000,
    paymentMethod: "BANK_TRANSFER",
    transactionDate: "2026-09-01",
  }, db);

  await recordRentCharge(accountantActor, {
    residentId: s1.residentId,
    stayId: s1.stayId,
    amount: 8000,
    billingPeriod: "2026-09",
    transactionDate: "2026-09-01",
  }, db);

  await recordRentPayment(accountantActor, {
    residentId: s1.residentId,
    stayId: s1.stayId,
    amount: 8000,
    paymentMethod: "UPI",
    transactionDate: "2026-09-02",
  }, db);

  const prev1 = await previewResidentSettlement(opsActor, s1.residentId, "2026-09-30", db);
  assert(prev1.totalRentCharged === 8000, "Scenario 1: Billed rent charge is ₹8,000");
  assert(prev1.totalRentPaid === 8000, "Scenario 1: Total rent paid is ₹8,000");
  assert(prev1.outstandingRentDue === 0, "Scenario 1: Outstanding rent due is ₹0");
  assert(prev1.totalDepositHeld === 16000, "Scenario 1: Security deposit held is ₹16,000");
  assert(prev1.suggestedDepositApplied === 0, "Scenario 1: Suggested deposit applied is ₹0");
  assert(prev1.suggestedRefund === 16000, "Scenario 1: Suggested deposit refund is full ₹16,000");
  assert(prev1.suggestedRemainingPayable === 0, "Scenario 1: Suggested remaining payable is ₹0");

  let managerRefundBlocked = false;
  try {
    await finalizeResidentCheckoutSettlement(opsActor, {
      residentId: s1.residentId, checkOutDate: "2026-09-30", refundAmount: 16000, refundPaymentMethod: "UPI",
    }, undefined, db);
  } catch (err: any) {
    managerRefundBlocked = err.statusCode === 403 && /Owner's approval/.test(err.message);
  }
  assert(managerRefundBlocked, "Scenario 0: the Manager cannot finalize a deposit refund (Owner approval required)");

  const stl1 = await finalizeResidentCheckoutSettlement(ownerActor, {
    residentId: s1.residentId,
    checkOutDate: "2026-09-30",
    refundAmount: 16000,
    refundPaymentMethod: "UPI",
    refundReference: "UPI-REF-001",
  }, undefined, db);

  assert(stl1.settlementStatus === "SETTLED", "Scenario 1: Settlement status is SETTLED");
  assert(stl1.refundAmount === 16000, "Scenario 1: Final refund recorded is ₹16,000");
  assert(stl1.refundPaymentMethod === "UPI", "Scenario 1: Refund payment method is UPI");
  assert(stl1.depositAppliedAmount === 0, "Scenario 1: Deposit applied is ₹0");

  // Verify stay and resident status
  const stay1After = await db.queryOne<any>("SELECT status, check_out_date FROM resident_stays WHERE id = ?", [s1.stayId]);
  assert(stay1After.status === "COMPLETED", "Scenario 1: Stay status transitioned to COMPLETED");
  assert(stay1After.check_out_date === "2026-09-30", "Scenario 1: Check-out date persisted on stay");

  const res1After = await db.queryOne<any>("SELECT status FROM residents WHERE id = ?", [s1.residentId]);
  assert(res1After.status === "CHECKED_OUT", "Scenario 1: Resident status transitioned to CHECKED_OUT");

  // SCENARIO 2: Resident with outstanding rent and deposit sufficient to cover it
  console.log("\n[Scenario 2] Outstanding rent covered by deposit");
  const s2 = await createResidentWithStay({
    id: "res_02",
    name: "Bhavna Jain",
    phone: "+919000000002",
    roomId: "rm_102",
    checkInDate: "2026-09-01",
    monthlyRent: 12000,
    securityDeposit: 15000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s2.residentId,
    stayId: s2.stayId,
    amount: 15000,
    paymentMethod: "CASH",
    transactionDate: "2026-09-01",
  }, db);

  await recordRentCharge(accountantActor, {
    residentId: s2.residentId,
    stayId: s2.stayId,
    amount: 12000,
    billingPeriod: "2026-09",
    transactionDate: "2026-09-01",
  }, db);

  // Unpaid rent = 12000, deposit = 15000
  const prev2 = await previewResidentSettlement(opsActor, s2.residentId, "2026-09-30", db);
  assert(prev2.outstandingRentDue === 12000, "Scenario 2: Outstanding rent due is ₹12,000");
  assert(prev2.totalDepositHeld === 15000, "Scenario 2: Deposit held is ₹15,000");
  assert(prev2.suggestedDepositApplied === 12000, "Scenario 2: Deposit application suggested for full ₹12,000");
  assert(prev2.suggestedRefund === 3000, "Scenario 2: Remaining refund suggested as ₹3,000 (15000 - 12000)");

  const stl2 = await finalizeResidentCheckoutSettlement(accountantActor, {
    residentId: s2.residentId,
    checkOutDate: "2026-09-30",
    depositAppliedAmount: 12000,
    refundAmount: 3000,
    refundPaymentMethod: "BANK_TRANSFER",
    refundReference: "NEFT-REF-002",
  }, undefined, db);

  assert(stl2.depositAppliedAmount === 12000, "Scenario 2: Deposit applied recorded is ₹12,000");
  assert(stl2.refundAmount === 3000, "Scenario 2: Refund recorded is ₹3,000");
  assert(stl2.remainingPayableAmount === 0, "Scenario 2: Remaining payable is ₹0");
  assert(stl2.settlementStatus === "SETTLED", "Scenario 2: Status is SETTLED");

  // Verify deposit application transaction exists as RENT_PAYMENT
  const depAppTx = await db.queryOne<any>("SELECT * FROM financial_transactions WHERE resident_id = ? AND category = 'DEPOSIT_APPLICATION'", [s2.residentId]);
  assert(Boolean(depAppTx), "Scenario 2: DEPOSIT_APPLICATION transaction created in ledger");
  assert(depAppTx.transaction_type === "RENT_PAYMENT", "Scenario 2: Deposit application recorded as RENT_PAYMENT");
  assert(depAppTx.amount === 12000, "Scenario 2: Deposit application amount is ₹12,000");

  // SCENARIO 3: Resident with outstanding rent exceeding eligible deposit application
  console.log("\n[Scenario 3] Outstanding rent exceeds deposit");
  const s3 = await createResidentWithStay({
    id: "res_03",
    name: "Chetan Kumar",
    phone: "+919000000003",
    roomId: "rm_103",
    checkInDate: "2026-08-01",
    monthlyRent: 9000,
    securityDeposit: 5000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s3.residentId,
    stayId: s3.stayId,
    amount: 5000,
    paymentMethod: "UPI",
    transactionDate: "2026-08-01",
  }, db);

  await recordRentCharge(accountantActor, {
    residentId: s3.residentId,
    stayId: s3.stayId,
    amount: 9000,
    billingPeriod: "2026-08",
    transactionDate: "2026-08-01",
  }, db);

  await recordRentCharge(accountantActor, {
    residentId: s3.residentId,
    stayId: s3.stayId,
    amount: 9000,
    billingPeriod: "2026-09",
    transactionDate: "2026-09-01",
  }, db);

  // Total charged = 18000, paid = 0, deposit = 5000
  const prev3 = await previewResidentSettlement(opsActor, s3.residentId, "2026-09-30", db);
  assert(prev3.outstandingRentDue === 18000, "Scenario 3: Outstanding rent is ₹18,000");
  assert(prev3.totalDepositHeld === 5000, "Scenario 3: Deposit held is ₹5,000");
  assert(prev3.suggestedDepositApplied === 5000, "Scenario 3: Suggested applied is ₹5,000");
  assert(prev3.suggestedRefund === 0, "Scenario 3: Suggested refund is ₹0");
  assert(prev3.suggestedRemainingPayable === 13000, "Scenario 3: Suggested remaining payable is ₹13,000");

  // Finalize with remaining balance pending payment
  const stl3 = await finalizeResidentCheckoutSettlement(ownerActor, {
    residentId: s3.residentId,
    checkOutDate: "2026-09-30",
    depositAppliedAmount: 5000,
    refundAmount: 0,
    remainingPayableAmount: 13000,
  }, undefined, db);

  assert(stl3.settlementStatus === "PENDING_PAYMENT", "Scenario 3: Status is PENDING_PAYMENT when balance remains");
  assert(stl3.remainingPayableAmount === 13000, "Scenario 3: Remaining payable balance is ₹13,000");

  // SCENARIO 4: Resident with no deposit
  console.log("\n[Scenario 4] Resident with zero security deposit");
  const s4 = await createResidentWithStay({
    id: "res_04",
    name: "Deepa Verma",
    phone: "+919000000004",
    roomId: "rm_104",
    checkInDate: "2026-09-01",
    monthlyRent: 7000,
    securityDeposit: 0,
  });

  await recordRentCharge(accountantActor, {
    residentId: s4.residentId,
    stayId: s4.stayId,
    amount: 7000,
    billingPeriod: "2026-09",
    transactionDate: "2026-09-01",
  }, db);

  await recordRentPayment(accountantActor, {
    residentId: s4.residentId,
    stayId: s4.stayId,
    amount: 4000,
    paymentMethod: "CASH",
    transactionDate: "2026-09-05",
  }, db);

  const prev4 = await previewResidentSettlement(opsActor, s4.residentId, "2026-09-30", db);
  assert(prev4.totalDepositHeld === 0, "Scenario 4: Deposit held is ₹0");
  assert(prev4.outstandingRentDue === 3000, "Scenario 4: Outstanding rent is ₹3,000 (7000 - 4000)");
  assert(prev4.suggestedDepositApplied === 0, "Scenario 4: Suggested applied is ₹0");
  assert(prev4.suggestedRemainingPayable === 3000, "Scenario 4: Remaining payable is ₹3,000");

  // Resident pays remaining ₹3,000 at checkout
  const stl4 = await finalizeResidentCheckoutSettlement(ownerActor, {
    residentId: s4.residentId,
    checkOutDate: "2026-09-30",
    depositAppliedAmount: 0,
    refundAmount: 0,
    remainingPayableAmount: 3000,
    paymentMethod: "CASH",
    paymentReference: "FINAL-CASH-004",
  }, undefined, db);

  assert(stl4.settlementStatus === "SETTLED", "Scenario 4: Settled in full after checkout payment");
  assert(stl4.remainingPayableAmount === 0, "Scenario 4: Remaining payable is ₹0 after payment");
  assert(Boolean(stl4.paymentTransactionId), "Scenario 4: Payment transaction ID recorded");

  // SCENARIO 5: Resident with partial rent payments
  console.log("\n[Scenario 5] Multiple partial rent payments");
  const s5 = await createResidentWithStay({
    id: "res_05",
    name: "Esha Rao",
    phone: "+919000000005",
    roomId: "rm_105",
    checkInDate: "2026-08-01",
    monthlyRent: 10000,
    securityDeposit: 10000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s5.residentId,
    stayId: s5.stayId,
    amount: 10000,
    paymentMethod: "UPI",
    transactionDate: "2026-08-01",
  }, db);

  await recordRentCharge(accountantActor, {
    residentId: s5.residentId,
    stayId: s5.stayId,
    amount: 10000,
    billingPeriod: "2026-08",
    transactionDate: "2026-08-01",
  }, db);

  // Partial payments
  await recordRentPayment(accountantActor, {
    residentId: s5.residentId,
    stayId: s5.stayId,
    amount: 4000,
    paymentMethod: "UPI",
    transactionDate: "2026-08-05",
  }, db);

  await recordRentPayment(accountantActor, {
    residentId: s5.residentId,
    stayId: s5.stayId,
    amount: 3000,
    paymentMethod: "CASH",
    transactionDate: "2026-08-15",
  }, db);

  const prev5 = await previewResidentSettlement(opsActor, s5.residentId, "2026-08-31", db);
  assert(prev5.totalRentPaid === 7000, "Scenario 5: Total rent paid accurately sums ₹7,000");
  assert(prev5.outstandingRentDue === 3000, "Scenario 5: Outstanding rent is ₹3,000 (10000 - 7000)");

  // SCENARIO 6: Resident with a partially refunded deposit
  console.log("\n[Scenario 6] Deposit with prior partial refund");
  const s6 = await createResidentWithStay({
    id: "res_06",
    name: "Farhan Ali",
    phone: "+919000000006",
    roomId: "rm_101",
    checkInDate: "2026-09-01",
    monthlyRent: 8000,
    securityDeposit: 10000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s6.residentId,
    stayId: s6.stayId,
    amount: 10000,
    paymentMethod: "BANK_TRANSFER",
    transactionDate: "2026-09-01",
  }, db);

  // Prior partial deposit refund recorded earlier
  await db.execute(`
    INSERT INTO financial_transactions (
      id, transaction_type, amount, transaction_date, payment_method,
      reference_number, resident_id, stay_id, category, description,
      status, created_by, created_at, updated_at
    ) VALUES (
      'fin_prior_ref_06', 'DEPOSIT_REFUND', 3000, '2026-09-15', 'UPI',
      'REF-PRIOR', ?, ?, 'SECURITY_DEPOSIT_REFUND', 'Early partial deposit refund',
      'POSTED', ?, ?, ?
    )
  `, [s6.residentId, s6.stayId, accountantActor.id, now, now]);

  const prev6 = await previewResidentSettlement(opsActor, s6.residentId, "2026-09-30", db);
  assert(prev6.priorRefunds === 3000, "Scenario 6: Prior refunds recognized as ₹3,000");
  assert(prev6.totalDepositHeld === 7000, "Scenario 6: Net deposit held is ₹7,000 (10000 - 3000)");

  // SCENARIO 7: Resident with authorized deductions
  console.log("\n[Scenario 7] Authorized deductions with itemized breakdown");
  const s7 = await createResidentWithStay({
    id: "res_07",
    name: "Gita Das",
    phone: "+919000000007",
    roomId: "rm_102",
    checkInDate: "2026-09-01",
    monthlyRent: 12000,
    securityDeposit: 15000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s7.residentId,
    stayId: s7.stayId,
    amount: 15000,
    paymentMethod: "UPI",
    transactionDate: "2026-09-01",
  }, db);

  const deductions7 = [
    { reason: "Deep cleaning & sanitization", amount: 1500 },
    { reason: "Key replacement", amount: 500 },
    { reason: "Wall patch repair", amount: 1000 },
  ];

  const stl7 = await finalizeResidentCheckoutSettlement(ownerActor, {
    residentId: s7.residentId,
    checkOutDate: "2026-09-30",
    deductions: deductions7,
    depositAppliedAmount: 0,
    refundAmount: 12000, // 15000 - 3000 deductions
    refundPaymentMethod: "UPI",
    refundReference: "UPI-DED-007",
  }, undefined, db);

  assert(stl7.deductionsAmount === 3000, "Scenario 7: Total deductions amount is ₹3,000");
  assert(Array.isArray(stl7.deductionsBreakdown), "Scenario 7: Deductions breakdown is array");
  assert(stl7.deductionsBreakdown?.length === 3, "Scenario 7: Deductions array contains exactly 3 items");
  assert(stl7.refundAmount === 12000, "Scenario 7: Net refund after deductions is ₹12,000");

  // Verify retrieval
  const retrievedStl7 = await getResidentSettlementByStayId(opsActor, s7.stayId, db);
  assert(retrievedStl7 !== null, "Scenario 7: Settlement retrieved by stay ID");
  assert(retrievedStl7?.deductionsBreakdown?.[0].reason === "Deep cleaning & sanitization", "Scenario 7: First deduction reason preserved");

  // SCENARIO 8: Resident with an already reversed payment
  console.log("\n[Scenario 8] Reversed payment is excluded from calculation");
  const s8 = await createResidentWithStay({
    id: "res_08",
    name: "Hari Prasad",
    phone: "+919000000008",
    roomId: "rm_103",
    checkInDate: "2026-09-01",
    monthlyRent: 9000,
    securityDeposit: 9000,
  });

  await recordRentCharge(accountantActor, {
    residentId: s8.residentId,
    stayId: s8.stayId,
    amount: 9000,
    billingPeriod: "2026-09",
    transactionDate: "2026-09-01",
  }, db);

  const paymentToReverse = await recordRentPayment(accountantActor, {
    residentId: s8.residentId,
    stayId: s8.stayId,
    amount: 5000,
    paymentMethod: "CASH",
    transactionDate: "2026-09-05",
  }, db);

  // Reverse payment
  await reverseTransaction(accountantActor, paymentToReverse.id, "Payment cancelled by resident", undefined, db);

  const prev8 = await previewResidentSettlement(opsActor, s8.residentId, "2026-09-30", db);
  assert(prev8.totalRentPaid === 0, "Scenario 8: Reversed payment is excluded from totalRentPaid (got ₹0)");
  assert(prev8.outstandingRentDue === 9000, "Scenario 8: Outstanding rent remains full ₹9,000");

  // SCENARIO 9: Resident with invoice and underlying rent charge (Zero Double-Counting)
  console.log("\n[Scenario 9] Invoicing does not double-count liability");
  const s9 = await createResidentWithStay({
    id: "res_09",
    name: "Indira Gandhi",
    phone: "+919000000009",
    roomId: "rm_104",
    checkInDate: "2026-09-01",
    monthlyRent: 7000,
    securityDeposit: 7000,
  });

  const rentCharge9 = await recordRentCharge(accountantActor, {
    residentId: s9.residentId,
    stayId: s9.stayId,
    amount: 7000,
    billingPeriod: "2026-09",
    transactionDate: "2026-09-01",
  }, db);

  // Generate official invoice linking to this rent charge
  const inv9 = await createInvoice(accountantActor, {
    invoiceCategory: "RESIDENT",
    invoiceType: "REGULAR_BILL",
    residentId: s9.residentId,
    stayId: s9.stayId,
    issueDate: "2026-09-01",
    dueDate: "2026-09-10",
    billingPeriod: "2026-09",
    items: [
      { description: "Monthly Room Rent - September 2026", quantity: 1, unitPrice: 7000 }
    ],
  }, undefined, db);

  // Update rent charge with invoiceId to link them
  await db.execute("UPDATE financial_transactions SET invoice_id = ? WHERE id = ?", [inv9.id, rentCharge9.id]);

  const prev9 = await previewResidentSettlement(opsActor, s9.residentId, "2026-09-30", db);
  assert(prev9.totalRentCharged === 7000, `Scenario 9: Total rent charged is strictly ₹7,000, NOT double-counted with invoice (got ₹${prev9.totalRentCharged})`);
  assert(prev9.outstandingRentDue === 7000, "Scenario 9: Outstanding rent due is ₹7,000");

  // SCENARIO 10: Checkout at billing period boundaries
  console.log("\n[Scenario 10] Checkout at billing boundary");
  const s10 = await createResidentWithStay({
    id: "res_10",
    name: "Jayant Sinha",
    phone: "+919000000010",
    roomId: "rm_105",
    checkInDate: "2026-10-01",
    monthlyRent: 10000,
    securityDeposit: 10000,
  });

  const prev10 = await previewResidentSettlement(opsActor, s10.residentId, "2026-10-31", db);
  assert(prev10.checkOutDate === "2026-10-31", "Scenario 10: Boundary check-out date accepted");

  // SCENARIO 11: Invalid or unsupported checkout dates
  console.log("\n[Scenario 11] Invalid or unsupported checkout dates");
  let checkoutEarlierError = false;
  try {
    await previewResidentSettlement(opsActor, s10.residentId, "2026-09-15", db);
  } catch (err: any) {
    checkoutEarlierError = true;
    assert(err.message.includes("cannot be earlier than check-in date"), "Scenario 11: Error thrown when checkout date precedes check-in date");
  }
  assert(checkoutEarlierError, "Scenario 11: Early checkout date correctly rejected");

  let malformedDateError = false;
  try {
    await finalizeResidentCheckoutSettlement(ownerActor, {
      residentId: s10.residentId,
      checkOutDate: "31-10-2026", // Invalid format
    }, undefined, db);
  } catch (err: any) {
    malformedDateError = true;
    assert(err.message.includes("YYYY-MM-DD"), "Scenario 11: Error thrown for non-standard date format");
  }
  assert(malformedDateError, "Scenario 11: Malformed date rejected");

  // SCENARIO 12: Missing, inactive, or already checked-out stay
  console.log("\n[Scenario 12] Missing or already checked out stay");
  // s1 was already checked out in Scenario 1
  let duplicateCheckoutError = false;
  try {
    await finalizeResidentCheckoutSettlement(ownerActor, {
      residentId: s1.residentId,
      checkOutDate: "2026-10-01",
    }, undefined, db);
  } catch (err: any) {
    duplicateCheckoutError = true;
    assert(err.message.includes("no active room assignment"), "Scenario 12: Error thrown when resident has no active stay");
  }
  assert(duplicateCheckoutError, "Scenario 12: Already checked out resident rejected");

  console.log("\n--- SECTION 2: FINANCIAL INTEGRITY & LEDGER INVARIANTS (13-20) ---");

  // SCENARIO 13: Deposit application does not create revenue
  console.log("\n[Scenario 13] Deposit application creates non-revenue settlement payment");
  const s13 = await createResidentWithStay({
    id: "res_13",
    name: "Kavita Roy",
    phone: "+919000000013",
    roomId: "rm_101",
    checkInDate: "2026-10-01",
    monthlyRent: 8000,
    securityDeposit: 8000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s13.residentId,
    stayId: s13.stayId,
    amount: 8000,
    paymentMethod: "UPI",
    transactionDate: "2026-10-01",
  }, db);

  await recordRentCharge(accountantActor, {
    residentId: s13.residentId,
    stayId: s13.stayId,
    amount: 8000,
    billingPeriod: "2026-10",
    transactionDate: "2026-10-01",
  }, db);

  await finalizeResidentCheckoutSettlement(accountantActor, {
    residentId: s13.residentId,
    checkOutDate: "2026-10-31",
    depositAppliedAmount: 8000,
    refundAmount: 0,
  }, undefined, db);

  // Check financial transaction
  const appTx13 = await db.queryOne<any>("SELECT * FROM financial_transactions WHERE resident_id = ? AND category = 'DEPOSIT_APPLICATION'", [s13.residentId]);
  assert(Boolean(appTx13), "Scenario 13: Deposit application transaction recorded");
  assert(appTx13.payment_method === "OTHER", "Scenario 13: Non-cash settlement uses canonical 'OTHER' payment method");
  assert(appTx13.category === "DEPOSIT_APPLICATION", "Scenario 13: Category clearly distinguished as DEPOSIT_APPLICATION");

  // SCENARIO 14: Deposit refund cannot exceed the refundable balance
  console.log("\n[Scenario 14] Deposit refund cannot exceed refundable balance");
  const s14 = await createResidentWithStay({
    id: "res_14",
    name: "Lalit Modi",
    phone: "+919000000014",
    roomId: "rm_102",
    checkInDate: "2026-10-01",
    monthlyRent: 12000,
    securityDeposit: 10000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s14.residentId,
    stayId: s14.stayId,
    amount: 10000,
    paymentMethod: "UPI",
    transactionDate: "2026-10-01",
  }, db);

  let excessiveRefundError = false;
  try {
    await finalizeResidentCheckoutSettlement(accountantActor, {
      residentId: s14.residentId,
      checkOutDate: "2026-10-15",
      refundAmount: 15000, // Exceeds 10000
      refundPaymentMethod: "UPI",
    }, undefined, db);
  } catch (err: any) {
    excessiveRefundError = true;
    assert(err.message.includes("cannot exceed"), "Scenario 14: Excessive refund rejected with clear message");
  }
  assert(excessiveRefundError, "Scenario 14: Excessive refund rejected");

  // SCENARIO 15: Duplicate refund requests prevented
  console.log("\n[Scenario 15] Duplicate refund prevented");
  const stl14 = await finalizeResidentCheckoutSettlement(accountantActor, {
    residentId: s14.residentId,
    checkOutDate: "2026-10-15",
    refundAmount: 10000,
    refundPaymentMethod: "UPI",
    refundReference: "REF-14",
  }, undefined, db);

  assert(stl14.refundAmount === 10000, "Scenario 14/15: Initial refund succeeded");

  // Attempting second refund on same stay
  let duplicateRefundError = false;
  try {
    await finalizeResidentCheckoutSettlement(accountantActor, {
      residentId: s14.residentId,
      checkOutDate: "2026-10-15",
      refundAmount: 10000,
      refundPaymentMethod: "UPI",
    }, undefined, db);
  } catch (err: any) {
    duplicateRefundError = true;
  }
  assert(duplicateRefundError, "Scenario 15: Duplicate checkout/refund rejected");

  // SCENARIO 16: Duplicate settlement confirmation does not duplicate deductions or charges
  console.log("\n[Scenario 16] Deductions and settlements cannot be duplicated");
  const settlementsForStay14 = await db.query<any>("SELECT * FROM resident_settlements WHERE stay_id = ?", [s14.stayId]);
  assert(settlementsForStay14.length === 1, "Scenario 16: Exactly one settlement record exists in database");

  // SCENARIO 17: Payment-method validation uses canonical values
  console.log("\n[Scenario 17] Canonical payment methods enforced");
  const s17 = await createResidentWithStay({
    id: "res_17",
    name: "Meera Nair",
    phone: "+919000000017",
    roomId: "rm_103",
    checkInDate: "2026-10-01",
    monthlyRent: 9000,
    securityDeposit: 9000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s17.residentId,
    stayId: s17.stayId,
    amount: 9000,
    paymentMethod: "UPI",
    transactionDate: "2026-10-01",
  }, db);

  let invalidMethodError = false;
  try {
    await finalizeResidentCheckoutSettlement(ownerActor, {
      residentId: s17.residentId,
      checkOutDate: "2026-10-20",
      refundAmount: 9000,
      refundPaymentMethod: "BITCOIN" as any,
    }, undefined, db);
  } catch (err: any) {
    invalidMethodError = true;
    assert(err.message.includes("Invalid payment method"), "Scenario 17: Non-canonical payment method rejected");
  }
  assert(invalidMethodError, "Scenario 17: Invalid refund payment method rejected");

  // Valid canonical payment method succeeds
  const stl17 = await finalizeResidentCheckoutSettlement(ownerActor, {
    residentId: s17.residentId,
    checkOutDate: "2026-10-20",
    refundAmount: 9000,
    refundPaymentMethod: "CASH",
  }, undefined, db);
  assert(stl17.refundPaymentMethod === "CASH", "Scenario 17: Canonical CASH payment method accepted");

  // SCENARIO 18: Failed payment/refund recording leaves no inconsistent partial state
  console.log("\n[Scenario 18] Transaction atomicity rollback on error");
  const s18 = await createResidentWithStay({
    id: "res_18",
    name: "Naveen Reddy",
    phone: "+919000000018",
    roomId: "rm_104",
    checkInDate: "2026-10-01",
    monthlyRent: 7000,
    securityDeposit: 7000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s18.residentId,
    stayId: s18.stayId,
    amount: 7000,
    paymentMethod: "UPI",
    transactionDate: "2026-10-01",
  }, db);

  // Intentionally pass an invalid deduction with 0 amount to trigger mid-transaction failure
  let atomicRollbackTriggered = false;
  try {
    await finalizeResidentCheckoutSettlement(ownerActor, {
      residentId: s18.residentId,
      checkOutDate: "2026-10-20",
      deductions: [{ reason: "Bad entry", amount: 0 }],
      refundAmount: 7000,
      refundPaymentMethod: "UPI",
    }, undefined, db);
  } catch (err: any) {
    atomicRollbackTriggered = true;
  }
  assert(atomicRollbackTriggered, "Scenario 18: Invalid input triggered error");

  // Verify stay remains ACTIVE and zero settlement rows created
  const stay18 = await db.queryOne<any>("SELECT status FROM resident_stays WHERE id = ?", [s18.stayId]);
  assert(stay18.status === "ACTIVE", "Scenario 18: Stay status remains ACTIVE (rolled back)");

  const stl18Rows = await db.query<any>("SELECT * FROM resident_settlements WHERE stay_id = ?", [s18.stayId]);
  assert(stl18Rows.length === 0, "Scenario 18: Zero partial settlement records created");

  // SCENARIO 19: Cashbook totals change only when valid financial transactions are recorded
  console.log("\n[Scenario 19] Cashbook summary tracks deposit refunds");
  const cashbookBefore = await getCashbookSummary(accountantActor, {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  }, db);

  // Finalize s18 with a refund of ₹7,000
  await finalizeResidentCheckoutSettlement(ownerActor, {
    residentId: s18.residentId,
    checkOutDate: "2026-10-20",
    refundAmount: 7000,
    refundPaymentMethod: "UPI",
  }, undefined, db);

  const cashbookAfter = await getCashbookSummary(accountantActor, {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  }, db);

  assert(
    cashbookAfter.totalDepositsCollected === cashbookBefore.totalDepositsCollected - 7000,
    `Scenario 19: Net deposits collected in cashbook reduced by ₹7,000 refund (${cashbookBefore.totalDepositsCollected} -> ${cashbookAfter.totalDepositsCollected})`
  );

  // SCENARIO 20: Reversal or correction preserves original financial history
  console.log("\n[Scenario 20] Historical audit integrity preserved");
  const refundTx18 = await db.queryOne<any>("SELECT * FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'DEPOSIT_REFUND'", [s18.residentId]);
  assert(Boolean(refundTx18), "Scenario 20: DEPOSIT_REFUND transaction is present in history");
  assert(refundTx18.status === "POSTED", "Scenario 20: DEPOSIT_REFUND is posted");

  console.log("\n--- SECTION 3: CONCURRENCY, AUTHORIZATION & ACCESS CONTROL (21-25) ---");

  // SCENARIO 21 & 22: Concurrency Guards
  console.log("\n[Scenario 21 & 22] Concurrency Protection");
  const s21 = await createResidentWithStay({
    id: "res_21",
    name: "Omkar Joshi",
    phone: "+919000000021",
    roomId: "rm_105",
    checkInDate: "2026-10-01",
    monthlyRent: 10000,
    securityDeposit: 10000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s21.residentId,
    stayId: s21.stayId,
    amount: 10000,
    paymentMethod: "UPI",
    transactionDate: "2026-10-01",
  }, db);

  // Fire two settlement attempts concurrently
  const [resA, resB] = await Promise.allSettled([
    finalizeResidentCheckoutSettlement(ownerActor, {
      residentId: s21.residentId,
      checkOutDate: "2026-10-25",
      refundAmount: 10000,
      refundPaymentMethod: "UPI",
    }, undefined, db),
    finalizeResidentCheckoutSettlement(ownerActor, {
      residentId: s21.residentId,
      checkOutDate: "2026-10-25",
      refundAmount: 10000,
      refundPaymentMethod: "UPI",
    }, undefined, db),
  ]);

  const fulfilledCount = [resA, resB].filter((r) => r.status === "fulfilled").length;
  const rejectedCount = [resA, resB].filter((r) => r.status === "rejected").length;

  assert(fulfilledCount === 1, `Scenario 21: Exactly ONE concurrent checkout settlement succeeded (got ${fulfilledCount})`);
  assert(rejectedCount === 1, `Scenario 21: Exactly ONE concurrent checkout settlement was rejected (got ${rejectedCount})`);

  const s21Refunds = await db.query<any>("SELECT * FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'DEPOSIT_REFUND'", [s21.residentId]);
  assert(s21Refunds.length === 1, "Scenario 22: Exactly ONE refund transaction recorded in database (no double refund)");

  // SCENARIO 23: Unauthorized users cannot finalize checkout or authorize refunds
  console.log("\n[Scenario 23] Least-privilege RBAC: unauthorized roles blocked");
  const s23 = await createResidentWithStay({
    id: "res_23",
    name: "Pooja Hegde",
    phone: "+919000000023",
    roomId: "rm_101",
    checkInDate: "2026-10-01",
    monthlyRent: 8000,
    securityDeposit: 8000,
  });

  await recordSecurityDeposit(accountantActor, {
    residentId: s23.residentId,
    stayId: s23.stayId,
    amount: 8000,
    paymentMethod: "UPI",
    transactionDate: "2026-10-01",
  }, db);

  let kitchenBlocked = false;
  try {
    await finalizeResidentCheckoutSettlement(kitchenActor, {
      residentId: s23.residentId,
      checkOutDate: "2026-10-25",
      refundAmount: 8000,
      refundPaymentMethod: "UPI",
    }, undefined, db);
  } catch (err: any) {
    kitchenBlocked = true;
    assert(err.name === "AuthorizationError" || err.message.includes("lacks permission"), "Scenario 23: KITCHEN_OPERATIONS blocked with AuthorizationError");
  }
  assert(kitchenBlocked, "Scenario 23: KITCHEN_OPERATIONS denied checkout mutation");

  let deliveryBlocked = false;
  try {
    await finalizeResidentCheckoutSettlement(deliveryActor, {
      residentId: s23.residentId,
      checkOutDate: "2026-10-25",
      refundAmount: 8000,
      refundPaymentMethod: "UPI",
    }, undefined, db);
  } catch (err: any) {
    deliveryBlocked = true;
    assert(err.name === "AuthorizationError" || err.message.includes("lacks permission"), "Scenario 23: DELIVERY_PERSON blocked with AuthorizationError");
  }
  assert(deliveryBlocked, "Scenario 23: DELIVERY_PERSON denied checkout mutation");

  // SCENARIO 24: Direct API requests cannot bypass financial RBAC
  console.log("\n[Scenario 24] Preview permission verification");
  let kitchenPreviewBlocked = false;
  try {
    await previewResidentSettlement(kitchenActor, s23.residentId, "2026-10-25", db);
  } catch (err: any) {
    kitchenPreviewBlocked = true;
  }
  assert(kitchenPreviewBlocked, "Scenario 24: KITCHEN_OPERATIONS denied preview access");

  // Authorized roles (OPERATIONS_MANAGER & ACCOUNTANT) succeed
  const previewOps = await previewResidentSettlement(opsActor, s23.residentId, "2026-10-25", db);
  assert(previewOps.residentId === s23.residentId, "Scenario 24: OPERATIONS_MANAGER successfully previews settlement");

  const previewAcct = await previewResidentSettlement(accountantActor, s23.residentId, "2026-10-25", db);
  assert(previewAcct.residentId === s23.residentId, "Scenario 24: ACCOUNTANT successfully previews settlement");

  // SCENARIO 25: Room/bed availability updated only after checkout finalization
  console.log("\n[Scenario 25] Capacity release verified upon settlement");
  // Before checkout: Room 101 has capacity 2, assigned to s23
  const activeResidentsBefore = await db.queryOne<any>("SELECT count(*) as count FROM resident_stays WHERE room_id = 'rm_101' AND status = 'ACTIVE'");
  const occupancyBefore = Number(activeResidentsBefore.count);

  await finalizeResidentCheckoutSettlement(ownerActor, {
    residentId: s23.residentId,
    checkOutDate: "2026-10-25",
    refundAmount: 8000,
    refundPaymentMethod: "UPI",
  }, undefined, db);

  const activeResidentsAfter = await db.queryOne<any>("SELECT count(*) as count FROM resident_stays WHERE room_id = 'rm_101' AND status = 'ACTIVE'");
  const occupancyAfter = Number(activeResidentsAfter.count);

  assert(occupancyAfter === occupancyBefore - 1, `Scenario 25: Bed occupancy immediately dropped by 1 after checkout (${occupancyBefore} -> ${occupancyAfter})`);

  console.log("\n--- SECTION 4: BACKWARD COMPATIBILITY REGRESSION (26) ---");

  // SCENARIO 26: checkOutResident compatibility
  console.log("\n[Scenario 26] checkOutResident backwards compatibility preserved");
  const s26 = await createResidentWithStay({
    id: "res_26",
    name: "Rishi Kapoor",
    phone: "+919000000026",
    roomId: "rm_102",
    checkInDate: "2026-10-01",
    monthlyRent: 12000,
    securityDeposit: 0,
  });

  // Call legacy checkOutResident without settlement details
  await checkOutResident(opsActor, {
    residentId: s26.residentId,
    checkOutDate: "2026-10-26",
  }, undefined, db);

  const stay26 = await db.queryOne<any>("SELECT status FROM resident_stays WHERE id = ?", [s26.stayId]);
  assert(stay26.status === "COMPLETED", "Scenario 26: Legacy checkOutResident marks stay COMPLETED");

  const res26 = await db.queryOne<any>("SELECT status FROM residents WHERE id = ?", [s26.residentId]);
  assert(res26.status === "CHECKED_OUT", "Scenario 26: Legacy checkOutResident marks resident CHECKED_OUT");

  // List settlements for resident
  const list26 = await listResidentSettlements(opsActor, s1.residentId, db);
  assert(list26.length === 1, "Scenario 26: listResidentSettlements returns historical settlement for res_01");

  console.log("\n--- SECTION 5: PRIMARY DATABASE SAFETY & IMMUTABILITY GUARD ---");
  const primaryStatsAfter = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;
  if (primaryStatsBefore && primaryStatsAfter) {
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs &&
      primaryStatsBefore.size === primaryStatsAfter.size,
      `Primary database ${primaryDbPath} was NEVER modified during tests`
    );
  } else if (!primaryStatsBefore) {
    assert(!fs.existsSync(primaryDbPath), "Primary database did not exist and was not created");
  }

  // Cleanup isolated test database
  cleanupTestDb();
  console.log("\n================================================================================");
  console.log(`TASK 01B.52 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  cleanupTestDb();
  process.exit(1);
});
