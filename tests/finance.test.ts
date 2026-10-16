import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "../apps/erp/src/server/database/migrations";
import { closeDb } from "../apps/erp/src/server/database/db";
import { hasPermission } from "../apps/erp/src/server/authorization/permissions";
import {
  requirePermission,
  AuthorizationError,
} from "../apps/erp/src/server/authorization/authorize";
import {
  recordRentCharge,
  recordRentPayment,
  recordSecurityDeposit,
  recordExpense,
  reverseTransaction,
  getTransactionById,
  listTransactions,
  getResidentFinancialSummary,
  getCashbookSummary,
  getResidentRentBalance,
} from "../apps/erp/src/server/finance/financeService";
import { getAuditLogs, sanitizeAuditMetadata } from "../apps/erp/src/server/audit/audit";
import { AuthenticatedUser } from "../apps/erp/src/types";
import { sanitizeCsvCell } from "../apps/erp/src/modules/finance/utils/exportCsv";

// Isolated test database path
const TEST_FINANCE_DB_PATH = path.resolve(__dirname, "test_finance.db");

function cleanupTestDb() {
  if (fs.existsSync(TEST_FINANCE_DB_PATH)) fs.unlinkSync(TEST_FINANCE_DB_PATH);
  const wal = `${TEST_FINANCE_DB_PATH}-wal`;
  const shm = `${TEST_FINANCE_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_FINANCE_DB_PATH;

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
console.log("RAVINARAYAN ERP — PHASE 4 CORE: FINANCE, PAYMENTS & CASHBOOK TEST SUITE");
console.log("================================================================================\n");

async function runFinanceTests() {
  // Test actors
  const superAdminUser: AuthenticatedUser = {
    id: "usr_super_admin_fin",
    username: "admin",
    email: "admin@ravinarayan.in",
    fullName: "Ravinarayan Super Admin",
    role: "SUPER_ADMIN",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_accountant_fin",
    username: "accountant",
    email: "accountant@ravinarayan.in",
    fullName: "Lead Accountant",
    role: "ACCOUNTANT",
  };

  const opsManagerUser: AuthenticatedUser = {
    id: "usr_ops_manager_fin",
    username: "opsmanager",
    email: "ops@ravinarayan.in",
    fullName: "Operations Lead",
    role: "OPERATIONS_MANAGER",
  };

  const kitchenUser: AuthenticatedUser = {
    id: "usr_kitchen_fin",
    username: "kitchenhead",
    email: "kitchen@ravinarayan.in",
    fullName: "Kitchen Supervisor",
    role: "KITCHEN_OPERATIONS",
  };

  const deliveryUser: AuthenticatedUser = {
    id: "usr_delivery_fin",
    username: "deliveryperson",
    email: "delivery@ravinarayan.in",
    fullName: "Delivery Staff",
    role: "DELIVERY_PERSON",
  };

  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Database Migration V3 -> V4 & Schema Invariants
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Database Migration V3 -> V4 & Schema Verification");

  const db = new Database(TEST_FINANCE_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Simulate existing V3 schema
  db.exec(`
    CREATE TABLE staff_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      staff_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
    );

    CREATE TABLE login_attempts (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      success INTEGER NOT NULL
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_username TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE rooms (
      id TEXT PRIMARY KEY,
      room_number TEXT UNIQUE NOT NULL,
      floor INTEGER NOT NULL,
      room_type TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      monthly_rent INTEGER NOT NULL CHECK (monthly_rent >= 0),
      security_deposit INTEGER NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
      status TEXT NOT NULL DEFAULT 'AVAILABLE',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE residents (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      emergency_contact TEXT,
      id_proof_type TEXT,
      id_proof_number TEXT,
      employer_institute TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE resident_stays (
      id TEXT PRIMARY KEY,
      resident_id TEXT NOT NULL REFERENCES residents(id) ON DELETE RESTRICT,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE RESTRICT,
      check_in_date TEXT NOT NULL,
      check_out_date TEXT,
      monthly_rent INTEGER NOT NULL CHECK (monthly_rent >= 0),
      security_deposit INTEGER NOT NULL DEFAULT 0 CHECK (security_deposit >= 0),
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX idx_unique_active_resident_stay 
    ON resident_stays(resident_id) WHERE status = 'ACTIVE';
  `);
  db.pragma("user_version = 3");

  // Populate test staff users
  const now = new Date().toISOString();
  const insertStaff = db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  insertStaff.run(superAdminUser.id, superAdminUser.username, superAdminUser.email, superAdminUser.fullName, "hash", superAdminUser.role, now, now);
  insertStaff.run(accountantUser.id, accountantUser.username, accountantUser.email, accountantUser.fullName, "hash", accountantUser.role, now, now);
  insertStaff.run(opsManagerUser.id, opsManagerUser.username, opsManagerUser.email, opsManagerUser.fullName, "hash", opsManagerUser.role, now, now);
  insertStaff.run(kitchenUser.id, kitchenUser.username, kitchenUser.email, kitchenUser.fullName, "hash", kitchenUser.role, now, now);
  insertStaff.run(deliveryUser.id, deliveryUser.username, deliveryUser.email, deliveryUser.fullName, "hash", deliveryUser.role, now, now);

  // Populate test rooms and residents
  db.prepare(`
    INSERT INTO rooms (id, room_number, floor, room_type, capacity, monthly_rent, security_deposit, status, is_active, created_at, updated_at)
    VALUES 
      ('rm_201', '201', 2, 'SINGLE', 1, 12000, 10000, 'OCCUPIED', 1, ?, ?),
      ('rm_202', '202', 2, 'DOUBLE', 2, 8000, 5000, 'AVAILABLE', 1, ?, ?)
  `).run(now, now, now, now);

  db.prepare(`
    INSERT INTO residents (id, full_name, phone, email, emergency_contact, status, created_at, updated_at)
    VALUES 
      ('res_aarav', 'Aarav Sharma', '9876543210', 'aarav@example.com', '9876500001', 'ACTIVE', ?, ?),
      ('res_priya', 'Priya Patel', '9876543211', 'priya@example.com', '9876500002', 'ACTIVE', ?, ?)
  `).run(now, now, now, now);

  db.prepare(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES 
      ('stay_aarav', 'res_aarav', 'rm_201', '2026-10-01', 12000, 10000, 'ACTIVE', ?, ?),
      ('stay_priya', 'res_priya', 'rm_202', '2026-10-05', 8000, 5000, 'ACTIVE', ?, ?)
  `).run(now, now, now, now);

  // Run migrations to apply V4
  runMigrations(db);

  const version = db.pragma("user_version", { simple: true }) as number;
  assert(Number(version) >= 4, `Database schema version advanced to at least 4 (got ${version})`);

  // Verify financial_transactions table
  const finTable = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='financial_transactions'").get() as { count: number };
  assert(finTable.count === 1, "financial_transactions table created with all required constraints");

  const finColumns = db.prepare("PRAGMA table_info(financial_transactions)").all() as Array<{ name: string }>;
  const colNames = finColumns.map(c => c.name);
  const requiredCols = [
    "id", "transaction_type", "amount", "transaction_date", "payment_method",
    "reference_number", "resident_id", "stay_id", "category", "description",
    "billing_period", "payee_vendor", "idempotency_key", "status",
    "reversal_of_id", "created_by", "created_at", "updated_at"
  ];
  const allColsPresent = requiredCols.every(c => colNames.includes(c));
  assert(allColsPresent, `All required financial_transactions columns present (${requiredCols.length}/${colNames.length})`);

  // Verify indexes
  const finIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='financial_transactions'").all() as Array<{ name: string }>;
  const idxNames = finIndexes.map(i => i.name);
  assert(idxNames.includes("idx_fin_tx_type"), "Index idx_fin_tx_type verified");
  assert(idxNames.includes("idx_fin_tx_date"), "Index idx_fin_tx_date verified");
  assert(idxNames.includes("idx_fin_tx_resident"), "Index idx_fin_tx_resident verified");
  assert(idxNames.includes("idx_fin_tx_stay"), "Index idx_fin_tx_stay verified");
  assert(idxNames.includes("idx_fin_tx_idempotency"), "Index idx_fin_tx_idempotency verified");

  // Close db handle so financeService can open it via getDb()
  db.close();

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Rent Charge Creation, Validation & Balance Invariants
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Rent Charge Creation, Validation & Balance Invariants");

  // Initial balance should be 0
  const initialBalance = getResidentRentBalance("res_aarav");
  assert(initialBalance === 0, `Initial rent balance for Aarav is ₹0 (got ₹${initialBalance})`);

  // Post Rent Charge: ₹12,000 for October 2026
  const charge1 = recordRentCharge(accountantUser, {
    residentId: "res_aarav",
    stayId: "stay_aarav",
    amount: 12000,
    transactionDate: "2026-10-01",
    billingPeriod: "October 2026",
    description: "Monthly room rent for Room 201",
  });

  assert(charge1.id.startsWith("txn_"), "Rent charge created with prefixed id");
  assert(charge1.transactionType === "RENT_CHARGE", "Transaction type is RENT_CHARGE");
  assert(charge1.category === "RENT", "Category is RENT");
  assert(charge1.amount === 12000, "Rent charge amount is 12,000");
  assert(charge1.status === "POSTED", "Transaction status defaults to POSTED");
  assert(charge1.billingPeriod === "October 2026", "Billing period recorded accurately");

  // Balance after charge
  const balanceAfterCharge = getResidentRentBalance("res_aarav");
  assert(balanceAfterCharge === 12000, `Rent balance correctly reflects ₹12,000 charge (got ₹${balanceAfterCharge})`);

  // Validation: Negative/Zero amount rejected
  let invalidAmountCaught = false;
  try {
    recordRentCharge(accountantUser, {
      residentId: "res_aarav",
      amount: -500,
      transactionDate: "2026-10-01",
      billingPeriod: "October 2026",
    });
  } catch (err: any) {
    invalidAmountCaught = err.message.includes("positive integer");
  }
  assert(invalidAmountCaught, "Validation rejects negative rent charge amount");

  // Validation: Invalid date rejected
  let invalidDateCaught = false;
  try {
    recordRentCharge(accountantUser, {
      residentId: "res_aarav",
      amount: 5000,
      transactionDate: "01-10-2026", // Wrong format
      billingPeriod: "October 2026",
    });
  } catch (err: any) {
    invalidDateCaught = err.message.includes("YYYY-MM-DD");
  }
  assert(invalidDateCaught, "Validation rejects non-ISO transaction date");

  // Validation: Non-existent resident rejected
  let missingResidentCaught = false;
  try {
    recordRentCharge(accountantUser, {
      residentId: "res_nonexistent",
      amount: 5000,
      transactionDate: "2026-10-01",
      billingPeriod: "October 2026",
    });
  } catch (err: any) {
    missingResidentCaught = err.message.includes("not found");
  }
  assert(missingResidentCaught, "Validation rejects charge for non-existent resident");

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Rent Payment & Balance Tracking (Partial, Full, Anti-Overpayment)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Rent Payment & Balance Tracking");

  // Record Partial Payment: ₹5,000 via UPI
  const partialPayment = recordRentPayment(accountantUser, {
    residentId: "res_aarav",
    stayId: "stay_aarav",
    amount: 5000,
    transactionDate: "2026-10-03",
    paymentMethod: "UPI",
    referenceNumber: "UPI/RAV/987123",
    description: "Partial rent payment via UPI",
  });

  assert(partialPayment.id.startsWith("txn_"), "Rent payment recorded with prefixed id");
  assert(partialPayment.transactionType === "RENT_PAYMENT", "Transaction type is RENT_PAYMENT");
  assert(partialPayment.paymentMethod === "UPI", "Payment method is UPI");
  assert(partialPayment.referenceNumber === "UPI/RAV/987123", "Reference number recorded accurately");

  // Verify remaining balance: 12000 - 5000 = 7000
  const balanceAfterPartial = getResidentRentBalance("res_aarav");
  assert(balanceAfterPartial === 7000, `Remaining balance is ₹7,000 after partial payment (got ₹${balanceAfterPartial})`);

  // Anti-Overpayment Check: Attempt to pay ₹8,000 when balance is only ₹7,000
  let overpaymentCaught = false;
  try {
    recordRentPayment(accountantUser, {
      residentId: "res_aarav",
      amount: 8000,
      transactionDate: "2026-10-04",
      paymentMethod: "CASH",
    });
  } catch (err: any) {
    overpaymentCaught = err.message.includes("exceeds current outstanding rent balance");
  }
  assert(overpaymentCaught, "Anti-Overpayment Guard: Payment exceeding outstanding balance is strictly blocked");

  // Record Full Remaining Payment: ₹7,000 via CASH
  const finalPayment = recordRentPayment(accountantUser, {
    residentId: "res_aarav",
    stayId: "stay_aarav",
    amount: 7000,
    transactionDate: "2026-10-05",
    paymentMethod: "CASH",
    description: "Full balance settlement in cash",
  });

  assert(finalPayment.amount === 7000, "Second payment recorded for ₹7,000");

  // Verify balance reaches exactly 0
  const balanceAfterFull = getResidentRentBalance("res_aarav");
  assert(balanceAfterFull === 0, `Resident rent balance is exactly ₹0 after full payment (got ₹${balanceAfterFull})`);

  // Attempting another payment when balance is 0 should fail
  let zeroBalancePaymentBlocked = false;
  try {
    recordRentPayment(accountantUser, {
      residentId: "res_aarav",
      amount: 1000,
      transactionDate: "2026-10-06",
      paymentMethod: "UPI",
    });
  } catch (err: any) {
    zeroBalancePaymentBlocked = err.message.includes("exceeds current outstanding rent balance");
  }
  assert(zeroBalancePaymentBlocked, "Payment on zero-balance account is blocked from creating false credit");

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: Security Deposit Separation (Liability vs Rent Revenue)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Security Deposit Separation (Liability vs Rent Revenue)");

  // Record Security Deposit: ₹10,000 via BANK_TRANSFER
  const deposit = recordSecurityDeposit(accountantUser, {
    residentId: "res_aarav",
    stayId: "stay_aarav",
    amount: 10000,
    transactionDate: "2026-10-01",
    paymentMethod: "BANK_TRANSFER",
    referenceNumber: "NEFT/SBIN/556677",
    description: "Refundable security deposit for Room 201",
  });

  assert(deposit.transactionType === "SECURITY_DEPOSIT", "Transaction type is SECURITY_DEPOSIT");
  assert(deposit.category === "SECURITY_DEPOSIT", "Category is SECURITY_DEPOSIT");
  assert(deposit.amount === 10000, "Deposit amount recorded as ₹10,000");

  // Invariant: Security Deposit does NOT alter resident rent balance
  const rentBalanceAfterDeposit = getResidentRentBalance("res_aarav");
  assert(rentBalanceAfterDeposit === 0, `Rent balance remains ₹0 after recording deposit (got ₹${rentBalanceAfterDeposit})`);

  // Resident Financial Summary check
  const residentSummary = getResidentFinancialSummary(accountantUser, "res_aarav");
  assert(residentSummary.totalRentCharges === 12000, `Summary total rent charged is ₹12,000 (got ₹${residentSummary.totalRentCharges})`);
  assert(residentSummary.totalRentPaid === 12000, `Summary total rent paid is ₹12,000 (got ₹${residentSummary.totalRentPaid})`);
  assert(residentSummary.outstandingRentBalance === 0, `Summary outstanding balance is ₹0 (got ₹${residentSummary.outstandingRentBalance})`);
  assert(residentSummary.totalSecurityDepositHeld === 10000, `Summary total security deposit held is ₹10,000 (got ₹${residentSummary.totalSecurityDepositHeld})`);
  assert(residentSummary.transactions.length === 4, `Dossier contains exactly 4 transactions (got ${residentSummary.transactions.length})`);

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Operational Expenses & Cashflow Deductions
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Operational Expenses & Cashflow Deductions");

  // Record Grocery Expense
  const groceryExp = recordExpense(accountantUser, {
    category: "GROCERY",
    amount: 3500,
    transactionDate: "2026-10-06",
    paymentMethod: "CASH",
    payeeVendor: "Met City Fresh Mart",
    description: "Bulk vegetables, spices, and cooking oil for kitchen",
    referenceNumber: "INV-9901",
  });

  assert(groceryExp.id.startsWith("txn_"), "Expense recorded with prefixed id");
  assert(groceryExp.transactionType === "EXPENSE", "Transaction type is EXPENSE");
  assert(groceryExp.category === "GROCERY", "Category is GROCERY");
  assert(groceryExp.amount === 3500, "Expense amount is ₹3,500");
  assert(groceryExp.payeeVendor === "Met City Fresh Mart", "Payee vendor recorded accurately");

  // Record Utilities Expense
  const utilExp = recordExpense(accountantUser, {
    category: "UTILITIES",
    amount: 1800,
    transactionDate: "2026-10-07",
    paymentMethod: "UPI",
    payeeVendor: "DHBVN Electricity",
    description: "Sub-meter electricity bill payment",
    referenceNumber: "DHBVN-8822",
  });

  assert(utilExp.category === "UTILITIES", "Category is UTILITIES");
  assert(utilExp.amount === 1800, "Expense amount is ₹1,800");

  // Validation: Reject invalid expense category
  let invalidCategoryCaught = false;
  try {
    recordExpense(accountantUser, {
      category: "INVALID_CAT" as any,
      amount: 1000,
      transactionDate: "2026-10-08",
      paymentMethod: "CASH",
      description: "Invalid expense",
    });
  } catch (err: any) {
    invalidCategoryCaught = err.message.includes("Invalid expense category");
  }
  assert(invalidCategoryCaught, "Validation rejects invalid expense category");

  // Invariant: Expenses do NOT alter resident rent balances
  const rentBalanceAfterExpenses = getResidentRentBalance("res_aarav");
  assert(rentBalanceAfterExpenses === 0, "Expenses do not alter resident rent balance");

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Cashbook Summary, Net Cash Movement & Date Filtering
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Cashbook Summary, Net Cash Movement & Date Filtering");

  // Current financial state:
  // Rent Collected = 5000 + 7000 = 12000
  // Deposits Collected = 10000
  // Total Inflow = 22000
  // Expenses Paid = 3500 + 1800 = 5300
  // Net Cash Movement = 22000 - 5300 = 16700
  // Total Outstanding Rent = 0
  const cashbookCurrent = getCashbookSummary(accountantUser, {
    startDate: "2026-10-01",
    endDate: "2026-10-10",
  });

  assert(cashbookCurrent.totalRentCollected === 12000, `Total rent collected is ₹12,000 (got ₹${cashbookCurrent.totalRentCollected})`);
  assert(cashbookCurrent.totalDepositsCollected === 10000, `Total deposits collected is ₹10,000 (got ₹${cashbookCurrent.totalDepositsCollected})`);
  assert(cashbookCurrent.totalExpensesPaid === 5300, `Total expenses paid is ₹5,300 (got ₹${cashbookCurrent.totalExpensesPaid})`);
  assert(cashbookCurrent.netCashMovement === 16700, `Net Cash Movement is ₹16,700 (got ₹${cashbookCurrent.netCashMovement})`);
  assert(cashbookCurrent.totalOutstandingRent === 0, `Total global outstanding rent is ₹0 (got ₹${cashbookCurrent.totalOutstandingRent})`);

  // Now charge Resident B ₹8,000 rent for October
  const chargeB = recordRentCharge(accountantUser, {
    residentId: "res_priya",
    stayId: "stay_priya",
    amount: 8000,
    transactionDate: "2026-10-05",
    billingPeriod: "October 2026",
    description: "Monthly room rent for Room 202",
  });

  const cashbookWithOutstanding = getCashbookSummary(accountantUser, {
    startDate: "2026-10-01",
    endDate: "2026-10-10",
  });

  assert(cashbookWithOutstanding.totalOutstandingRent === 8000, `Global outstanding rent increased to ₹8,000 (got ₹${cashbookWithOutstanding.totalOutstandingRent})`);
  assert(cashbookWithOutstanding.netCashMovement === 16700, "Net Cash Movement unchanged since charge is non-cash receivable");

  // Date Filtering: Query range with no transactions
  const cashbookEmptyRange = getCashbookSummary(accountantUser, {
    startDate: "2025-01-01",
    endDate: "2025-01-31",
  });

  assert(cashbookEmptyRange.totalRentCollected === 0, "Rent collected is 0 for past date range");
  assert(cashbookEmptyRange.totalDepositsCollected === 0, "Deposits collected is 0 for past date range");
  assert(cashbookEmptyRange.totalExpensesPaid === 0, "Expenses paid is 0 for past date range");
  assert(cashbookEmptyRange.netCashMovement === 0, "Net cash movement is 0 for past date range");
  // Outstanding rent is global (as of current date)
  assert(cashbookEmptyRange.totalOutstandingRent === 8000, "Global outstanding rent remains accurately tracked across views");

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: Idempotency Protection
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Idempotency Protection");

  const idempotencyKey = "idemp_fin_key_9999";

  const exp1 = recordExpense(accountantUser, {
    category: "MAINTENANCE",
    amount: 1500,
    transactionDate: "2026-10-08",
    paymentMethod: "CASH",
    payeeVendor: "Met City Plumber",
    description: "Plumbing pipe repair",
    idempotencyKey,
  });

  // Duplicate submission with same key
  const exp2 = recordExpense(accountantUser, {
    category: "MAINTENANCE",
    amount: 1500,
    transactionDate: "2026-10-08",
    paymentMethod: "CASH",
    payeeVendor: "Met City Plumber",
    description: "Plumbing pipe repair",
    idempotencyKey,
  });

  assert(exp1.id === exp2.id, `Idempotent submission returned identical transaction ID (${exp1.id} === ${exp2.id})`);

  // Verify only 1 record exists in database for this idempotency key
  const txDb = new Database(TEST_FINANCE_DB_PATH);
  const countWithKey = txDb.prepare("SELECT count(*) as count FROM financial_transactions WHERE idempotency_key = ?").get(idempotencyKey) as { count: number };
  assert(countWithKey.count === 1, "Database contains exactly 1 row despite repeated submissions");
  txDb.close();

  // -----------------------------------------------------------------------------
  // TEST SUITE 8: Auditable Reversals
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] Auditable Reversals");

  // Record an erroneous rent charge of ₹1,000 on Resident B
  const erroneousCharge = recordRentCharge(accountantUser, {
    residentId: "res_priya",
    stayId: "stay_priya",
    amount: 1000,
    transactionDate: "2026-10-09",
    billingPeriod: "October 2026 - Erroneous",
    description: "Erroneous charge to be reversed",
  });

  const balanceBeforeReversal = getResidentRentBalance("res_priya");
  assert(balanceBeforeReversal === 9000, `Balance before reversal is ₹9,000 (8000 + 1000, got ₹${balanceBeforeReversal})`);

  // Reverse the transaction
  const reversalTx = reverseTransaction(accountantUser, erroneousCharge.id, "Billed in error by operator");

  assert(reversalTx.id.startsWith("txn_"), "Reversal transaction created with prefixed id");
  assert(reversalTx.transactionType === "REVERSAL", "Reversal transaction type is REVERSAL");
  assert(reversalTx.amount === 1000, "Reversal amount matches original transaction amount (₹1,000)");
  assert(reversalTx.reversalOfId === erroneousCharge.id, "Reversal references original transaction ID");

  // Verify original transaction status is updated to REVERSED
  const originalUpdated = getTransactionById(accountantUser, erroneousCharge.id)!;
  assert(originalUpdated.status === "REVERSED", "Original transaction status updated to REVERSED");

  // Verify original transaction was NOT deleted
  const checkDb = new Database(TEST_FINANCE_DB_PATH);
  const origRow = checkDb.prepare("SELECT * FROM financial_transactions WHERE id = ?").get(erroneousCharge.id) as any;
  assert(origRow !== undefined, "Original transaction record preserved in SQLite database (never deleted)");
  checkDb.close();

  // Balance after reversal should return to ₹8,000
  const balanceAfterReversal = getResidentRentBalance("res_priya");
  assert(balanceAfterReversal === 8000, `Rent balance correctly restored to ₹8,000 after reversal (got ₹${balanceAfterReversal})`);

  // Attempting to reverse an already-reversed transaction should throw
  let doubleReversalBlocked = false;
  try {
    reverseTransaction(accountantUser, erroneousCharge.id, "Attempt second reversal");
  } catch (err: any) {
    doubleReversalBlocked = err.message.includes("already reversed");
  }
  assert(doubleReversalBlocked, "Double-reversal of already reversed transaction is strictly prevented");

  // -----------------------------------------------------------------------------
  // TEST SUITE 9: Server-Side RBAC Enforcement on Finance Services
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 9] Server-Side RBAC Enforcement on Finance Services");

  // 1. Unauthenticated caller throws 401
  let unauthCaught = false;
  try {
    listTransactions(null as any, {});
  } catch (err: any) {
    unauthCaught = err instanceof AuthorizationError && err.statusCode === 401;
  }
  assert(unauthCaught, "Unauthenticated listTransactions throws HTTP 401 AuthorizationError");

  // 2. Role permission checks
  assert(hasPermission(superAdminUser.role, "finance.manage"), "SUPER_ADMIN has finance.manage");
  assert(hasPermission(superAdminUser.role, "finance.read"), "SUPER_ADMIN has finance.read");
  assert(hasPermission(accountantUser.role, "finance.manage"), "ACCOUNTANT has finance.manage");
  assert(hasPermission(accountantUser.role, "finance.read"), "ACCOUNTANT has finance.read");
  assert(hasPermission(opsManagerUser.role, "finance.read"), "OPERATIONS_MANAGER has finance.read");
  assert(!hasPermission(opsManagerUser.role, "finance.manage"), "Least Privilege: OPERATIONS_MANAGER lacks finance.manage");
  assert(!hasPermission(kitchenUser.role, "finance.read"), "Least Privilege: KITCHEN_OPERATIONS lacks finance.read");
  assert(!hasPermission(deliveryUser.role, "finance.read"), "Least Privilege: DELIVERY_PERSON lacks finance.read");

  // 3. OPERATIONS_MANAGER can read transactions
  const opsList = listTransactions(opsManagerUser, {});
  assert(Array.isArray(opsList), "OPERATIONS_MANAGER successfully reads transaction list");

  // 4. OPERATIONS_MANAGER blocked from mutating finance (HTTP 403)
  let opsBlockedOnCharge = false;
  try {
    recordRentCharge(opsManagerUser, {
      residentId: "res_priya",
      amount: 2000,
      transactionDate: "2026-10-10",
      billingPeriod: "October 2026",
    });
  } catch (err: any) {
    opsBlockedOnCharge = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(opsBlockedOnCharge, "Privilege Guard: OPERATIONS_MANAGER blocked from recordRentCharge with HTTP 403");

  let opsBlockedOnPayment = false;
  try {
    recordRentPayment(opsManagerUser, {
      residentId: "res_priya",
      amount: 2000,
      transactionDate: "2026-10-10",
      paymentMethod: "CASH",
    });
  } catch (err: any) {
    opsBlockedOnPayment = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(opsBlockedOnPayment, "Privilege Guard: OPERATIONS_MANAGER blocked from recordRentPayment with HTTP 403");

  let opsBlockedOnExpense = false;
  try {
    recordExpense(opsManagerUser, {
      category: "GROCERY",
      amount: 500,
      transactionDate: "2026-10-10",
      paymentMethod: "CASH",
      description: "Ops unauthorized expense",
    });
  } catch (err: any) {
    opsBlockedOnExpense = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(opsBlockedOnExpense, "Privilege Guard: OPERATIONS_MANAGER blocked from recordExpense with HTTP 403");

  // 5. KITCHEN_OPERATIONS and DELIVERY_PERSON blocked from reading (HTTP 403)
  let kitchenBlockedOnRead = false;
  try {
    getCashbookSummary(kitchenUser, {});
  } catch (err: any) {
    kitchenBlockedOnRead = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(kitchenBlockedOnRead, "Privilege Guard: KITCHEN_OPERATIONS blocked from getCashbookSummary with HTTP 403");

  let deliveryBlockedOnRead = false;
  try {
    getResidentFinancialSummary(deliveryUser, "res_priya");
  } catch (err: any) {
    deliveryBlockedOnRead = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(deliveryBlockedOnRead, "Privilege Guard: DELIVERY_PERSON blocked from getResidentFinancialSummary with HTTP 403");

  // -----------------------------------------------------------------------------
  // TEST SUITE 10: Immutable Audit Logging & Secret Redaction
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 10] Immutable Audit Logging & Secret Redaction");

  const auditEvents = getAuditLogs({ limit: 50 });
  const actionList = auditEvents.map(a => a.action);

  assert(actionList.includes("finance.rent_charge_recorded"), "Audit trail captured finance.rent_charge_recorded");
  assert(actionList.includes("finance.rent_payment_recorded"), "Audit trail captured finance.rent_payment_recorded");
  assert(actionList.includes("finance.security_deposit_recorded"), "Audit trail captured finance.security_deposit_recorded");
  assert(actionList.includes("finance.expense_recorded"), "Audit trail captured finance.expense_recorded");
  assert(actionList.includes("finance.transaction_reversed"), "Audit trail captured finance.transaction_reversed");

  // Verify secret redaction
  let sensitiveFieldFound = false;
  for (const log of auditEvents) {
    if (log.metadata) {
      const json = JSON.stringify(log.metadata);
      if (
        json.includes("password") ||
        json.includes("secret") ||
        json.includes("token") ||
        json.includes("salt") ||
        json.includes("hash")
      ) {
        sensitiveFieldFound = true;
        break;
      }
    }
  }
  assert(!sensitiveFieldFound, "All finance audit event metadata verified free of secrets, passwords, or tokens");

  // -----------------------------------------------------------------------------
  // TEST SUITE 11: Timezone-Safe Period Boundaries & CSV Injection Defense
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 11] Timezone-Safe Period Boundaries & CSV Injection Defense");

  // 1. Timezone-safe default period dates in getCashbookSummary
  const currentDate = new Date();
  const expYear = currentDate.getFullYear();
  const expMonth = String(currentDate.getMonth() + 1).padStart(2, "0");
  const expDay = String(currentDate.getDate()).padStart(2, "0");
  const expectedDefaultStart = `${expYear}-${expMonth}-01`;
  const expectedDefaultEnd = `${expYear}-${expMonth}-${expDay}`;

  const defaultSummary = getCashbookSummary(superAdminUser, {});
  assert(
    defaultSummary.startDate === expectedDefaultStart,
    `getCashbookSummary default startDate correctly uses local calendar month start (${expectedDefaultStart})`
  );
  assert(
    defaultSummary.endDate === expectedDefaultEnd,
    `getCashbookSummary default endDate correctly uses local calendar current day (${expectedDefaultEnd})`
  );

  // 2. CSV formula injection prevention
  assert(sanitizeCsvCell("=1+1") === "'=1+1", "sanitizeCsvCell neutralizes '=' formula injection prefix");
  assert(sanitizeCsvCell("+cmd|' /C calc'!A0") === "'+cmd|' /C calc'!A0", "sanitizeCsvCell neutralizes '+' formula injection prefix");
  assert(sanitizeCsvCell('+cmd "calc"') === "\"'+cmd \"\"calc\"\"\"", "sanitizeCsvCell escapes internal quotes and quotes string");
  assert(sanitizeCsvCell("@SUM(A1:A10)") === "'@SUM(A1:A10)", "sanitizeCsvCell neutralizes '@' formula injection prefix");
  assert(sanitizeCsvCell("\tTAB_INJECTION") === "'\tTAB_INJECTION", "sanitizeCsvCell neutralizes tab trigger prefix");
  assert(sanitizeCsvCell(null) === "", "sanitizeCsvCell gracefully converts null to empty string");
  assert(sanitizeCsvCell(undefined) === "", "sanitizeCsvCell gracefully converts undefined to empty string");
  assert(sanitizeCsvCell(12500) === "12500", "sanitizeCsvCell leaves numeric values intact");
  assert(sanitizeCsvCell('Rent "October" Receipt') === "\"Rent \"\"October\"\" Receipt\"", "sanitizeCsvCell escapes internal double quotes");
  assert(sanitizeCsvCell("Sharma, Rahul") === "\"Sharma, Rahul\"", "sanitizeCsvCell encloses comma-separated strings");

  // Clean up
  closeDb();
  cleanupTestDb();

  console.log("\n================================================================================");
  console.log(`FINAL FINANCE TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runFinanceTests().catch((err) => {
  console.error("FATAL ERROR IN FINANCE TEST SUITE:", err);
  process.exit(1);
});
