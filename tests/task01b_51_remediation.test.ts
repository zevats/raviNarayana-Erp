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
  listTransactions,
} from "../apps/erp/src/server/finance/financeService";
import {
  generateTiffinInvoices,
  recordTiffinPayment,
  getPrepaidBillingExceptions,
  reconcilePrepaidException,
} from "../apps/erp/src/server/tiffin/tiffinBillingService";
import {
  AuthenticatedUser,
  normalizePaymentMethod,
  tryNormalizePaymentMethod,
  formatPaymentMethodLabel,
  CANONICAL_PAYMENT_METHODS,
  PaymentMethod,
} from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test database
const TEST_REMED51_DB_PATH = path.resolve(__dirname, "test_task51_remediation.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_REMED51_DB_PATH)) fs.unlinkSync(TEST_REMED51_DB_PATH);
  const wal = `${TEST_REMED51_DB_PATH}-wal`;
  const shm = `${TEST_REMED51_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_REMED51_DB_PATH;

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
console.log("TASK 01B.51 REGRESSION TEST SUITE: BILLING RECONCILIATION & PAYMENT CONSISTENCY");
console.log("================================================================================\n");

async function runTests() {
  // 1. Initialize schema in isolated DB
  console.log("--- 1. Initializing isolated database with schema migrations ---");
  const rawDb = new Database(TEST_REMED51_DB_PATH);
  runMigrations(rawDb);
  rawDb.close();

  const db = getAsyncDb();

  // Test Actors
  const adminActor: AuthenticatedUser = {
    id: "usr_admin_51",
    username: "superadmin_51",
    email: "admin51@ravinarayana.com",
    fullName: "Super Admin 51",
    role: "SUPER_ADMIN",
  };

  const accountantActor: AuthenticatedUser = {
    id: "usr_acct_51",
    username: "accountant_51",
    email: "acct51@ravinarayana.com",
    fullName: "Chief Accountant 51",
    role: "ACCOUNTANT",
  };

  const deliveryActor: AuthenticatedUser = {
    id: "usr_del_51",
    username: "delivery_51",
    email: "delivery51@ravinarayana.com",
    fullName: "Rider 51",
    role: "DELIVERY_PERSON",
  };

  const now = new Date().toISOString();

  // Seed staff users
  for (const u of [adminActor, accountantActor, deliveryActor]) {
    await db.execute(`
      INSERT INTO staff_users (id, username, email, full_name, role, password_hash, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'hash', 1, ?, ?)
    `, [u.id, u.username, u.email, u.fullName, u.role, now, now]);
  }

  // Seed room and resident
  await db.execute(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES ('rm_51', '501', 5, 'SINGLE', 1, 10000, 1, ?, ?)
  `, [now, now]);

  await db.execute(`
    INSERT INTO residents (id, full_name, phone, email, status, created_at, updated_at)
    VALUES ('res_51', 'Ramesh Sharma', '+919876500051', 'ramesh51@example.com', 'ACTIVE', ?, ?)
  `, [now, now]);

  await db.execute(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, status, monthly_rent, security_deposit, created_at, updated_at)
    VALUES ('stay_51', 'res_51', 'rm_51', '2026-10-01', 'ACTIVE', 10000, 20000, ?, ?)
  `, [now, now]);

  // ============================================================================
  // SECTION 1: PAYMENT METHOD CONSISTENCY & NORMALIZATION TESTS (AUDIT-DEFECT-04)
  // ============================================================================
  console.log("\n--- SECTION 1: PAYMENT METHOD NORMALIZATION & CONSISTENCY (AUDIT-DEFECT-04) ---");

  // 1.1 Canonical methods
  assert(CANONICAL_PAYMENT_METHODS.length === 5, "Canonical payment methods count is 5");
  assert(
    CANONICAL_PAYMENT_METHODS.includes("CASH") &&
    CANONICAL_PAYMENT_METHODS.includes("UPI") &&
    CANONICAL_PAYMENT_METHODS.includes("BANK_TRANSFER") &&
    CANONICAL_PAYMENT_METHODS.includes("CHEQUE") &&
    CANONICAL_PAYMENT_METHODS.includes("OTHER"),
    "All 5 canonical methods match DB check constraint"
  );

  // 1.2 Exact uppercase values
  for (const m of CANONICAL_PAYMENT_METHODS) {
    assert(normalizePaymentMethod(m) === m, `normalizePaymentMethod('${m}') returns exact canonical enum`);
  }

  // 1.3 Casing variants
  assert(normalizePaymentMethod("cash") === "CASH", "normalizePaymentMethod('cash') -> 'CASH'");
  assert(normalizePaymentMethod("Cash") === "CASH", "normalizePaymentMethod('Cash') -> 'CASH'");
  assert(normalizePaymentMethod("upi") === "UPI", "normalizePaymentMethod('upi') -> 'UPI'");
  assert(normalizePaymentMethod("Upi") === "UPI", "normalizePaymentMethod('Upi') -> 'UPI'");
  assert(normalizePaymentMethod("bank_transfer") === "BANK_TRANSFER", "normalizePaymentMethod('bank_transfer') -> 'BANK_TRANSFER'");
  assert(normalizePaymentMethod("Bank Transfer") === "BANK_TRANSFER", "normalizePaymentMethod('Bank Transfer') -> 'BANK_TRANSFER'");
  assert(normalizePaymentMethod("cheque") === "CHEQUE", "normalizePaymentMethod('cheque') -> 'CHEQUE'");
  assert(normalizePaymentMethod("Cheque") === "CHEQUE", "normalizePaymentMethod('Cheque') -> 'CHEQUE'");
  assert(normalizePaymentMethod("other") === "OTHER", "normalizePaymentMethod('other') -> 'OTHER'");
  assert(normalizePaymentMethod("Other") === "OTHER", "normalizePaymentMethod('Other') -> 'OTHER'");

  // 1.4 Aliases & common UI inputs
  assert(normalizePaymentMethod("online") === "UPI", "normalizePaymentMethod('online') maps to 'UPI'");
  assert(normalizePaymentMethod("Online") === "UPI", "normalizePaymentMethod('Online') maps to 'UPI'");
  assert(normalizePaymentMethod("qr") === "UPI", "normalizePaymentMethod('qr') maps to 'UPI'");
  assert(normalizePaymentMethod("gpay") === "UPI", "normalizePaymentMethod('gpay') maps to 'UPI'");
  assert(normalizePaymentMethod("phonepe") === "UPI", "normalizePaymentMethod('phonepe') maps to 'UPI'");
  assert(normalizePaymentMethod("card") === "OTHER", "normalizePaymentMethod('card') maps to 'OTHER'");
  assert(normalizePaymentMethod("Card") === "OTHER", "normalizePaymentMethod('Card') maps to 'OTHER'");
  assert(normalizePaymentMethod("pos") === "OTHER", "normalizePaymentMethod('pos') maps to 'OTHER'");
  assert(normalizePaymentMethod("check") === "CHEQUE", "normalizePaymentMethod('check') maps to 'CHEQUE'");
  assert(normalizePaymentMethod("netbanking") === "BANK_TRANSFER", "normalizePaymentMethod('netbanking') maps to 'BANK_TRANSFER'");
  assert(normalizePaymentMethod("neft") === "BANK_TRANSFER", "normalizePaymentMethod('neft') maps to 'BANK_TRANSFER'");
  assert(normalizePaymentMethod("imps") === "BANK_TRANSFER", "normalizePaymentMethod('imps') maps to 'BANK_TRANSFER'");

  // 1.5 Validation error on unsupported values
  let caughtInvalid = false;
  try {
    normalizePaymentMethod("BITCOIN");
  } catch (err: any) {
    caughtInvalid = true;
    assert(err.message.includes("Invalid payment method"), "Invalid payment method 'BITCOIN' produces descriptive error");
  }
  assert(caughtInvalid, "normalizePaymentMethod strictly rejects 'BITCOIN'");

  let caughtEmpty = false;
  try {
    normalizePaymentMethod("");
  } catch (err: any) {
    caughtEmpty = true;
  }
  assert(caughtEmpty, "normalizePaymentMethod rejects empty string");

  // 1.6 Safe helper & display labels
  assert(tryNormalizePaymentMethod("cash") === "CASH", "tryNormalizePaymentMethod('cash') returns 'CASH'");
  assert(tryNormalizePaymentMethod("invalid_crypto") === null, "tryNormalizePaymentMethod('invalid_crypto') returns null safely");
  assert(formatPaymentMethodLabel("CASH") === "Cash", "formatPaymentMethodLabel('CASH') -> 'Cash'");
  assert(formatPaymentMethodLabel("UPI") === "UPI / QR", "formatPaymentMethodLabel('UPI') -> 'UPI / QR'");
  assert(formatPaymentMethodLabel("BANK_TRANSFER") === "Bank Transfer", "formatPaymentMethodLabel('BANK_TRANSFER') -> 'Bank Transfer'");
  assert(formatPaymentMethodLabel("CHEQUE") === "Cheque", "formatPaymentMethodLabel('CHEQUE') -> 'Cheque'");
  assert(formatPaymentMethodLabel("OTHER") === "Card / Other", "formatPaymentMethodLabel('OTHER') -> 'Card / Other'");
  assert(formatPaymentMethodLabel(null) === "—", "formatPaymentMethodLabel(null) -> '—'");

  // 1.7 Service layer normalization on recording
  await recordRentCharge(accountantActor, {
    residentId: "res_51",
    stayId: "stay_51",
    amount: 10000,
    transactionDate: "2026-10-01",
    billingPeriod: "2026-10",
    description: "October 2026 rent charge",
  });

  const rentTx = await recordRentPayment(accountantActor, {
    residentId: "res_51",
    stayId: "stay_51",
    amount: 10000,
    transactionDate: "2026-10-05",
    paymentMethod: "cash", // lowercase variant
    referenceNumber: "RCPT-001",
    description: "October 2026 rent payment",
  });
  assert(rentTx.paymentMethod === "CASH", "recordRentPayment with 'cash' persists canonical 'CASH'");

  const depositTx = await recordSecurityDeposit(accountantActor, {
    residentId: "res_51",
    stayId: "stay_51",
    amount: 20000,
    transactionDate: "2026-10-01",
    paymentMethod: "bank_transfer", // lowercase variant
    referenceNumber: "NEFT-12345",
    description: "Security deposit",
  });
  assert(depositTx.paymentMethod === "BANK_TRANSFER", "recordSecurityDeposit with 'bank_transfer' persists canonical 'BANK_TRANSFER'");

  const expenseTx = await recordExpense(accountantActor, {
    category: "GROCERY",
    amount: 4500,
    transactionDate: "2026-10-06",
    paymentMethod: "card", // alias variant
    payeeVendor: "Metro Cash & Carry",
    description: "Weekly kitchen vegetables and staples",
  });
  assert(expenseTx.paymentMethod === "OTHER", "recordExpense with 'card' persists canonical 'OTHER'");

  // Seed Tiffin Customer & Product for Tiffin payment
  await db.execute(`
    INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, status, created_by, created_at, updated_at)
    VALUES ('cust_51', 'Arjun Kapoor', '+919988770051', 'Flat 402, Brigade Gateway, Bengaluru', 'ACTIVE', 'usr_admin_51', ?, ?)
  `, [now, now]);

  const tiffinTx = await recordTiffinPayment(accountantActor, {
    customerId: "cust_51",
    amount: 3500,
    transactionDate: "2026-10-07",
    paymentMethod: "online", // alias variant
    referenceNumber: "UPI-PAY-51",
    notes: "Advance subscription payment",
  });
  assert(tiffinTx.transaction.paymentMethod === "UPI", "recordTiffinPayment with 'online' persists canonical 'UPI'");

  // 1.8 Reversal preserves canonical payment method
  const reversedRent = await reverseTransaction(accountantActor, rentTx.id, "Payment deposited to wrong account by mistake");
  assert(reversedRent.transactionType === "REVERSAL", "reverseTransaction creates REVERSAL record");
  assert(reversedRent.paymentMethod === "CASH", "reverseTransaction preserves canonical 'CASH' payment method on reversal");

  // 1.9 listTransactions filtering by payment method (case-insensitive & alias-aware)
  const cashList = await listTransactions(accountantActor, { paymentMethod: "cash" });
  assert(cashList.some((t) => t.id === rentTx.id), "listTransactions({ paymentMethod: 'cash' }) finds canonical CASH transactions");

  const upiList = await listTransactions(accountantActor, { paymentMethod: "online" });
  assert(upiList.some((t) => t.id === tiffinTx.transaction.id), "listTransactions({ paymentMethod: 'online' }) finds canonical UPI transactions");

  // ============================================================================
  // SECTION 2: PREPAID EXCEPTION RECONCILIATION TESTS (AUDIT-DEFECT-03)
  // ============================================================================
  console.log("\n--- SECTION 2: PREPAID BILLING EXCEPTION RECONCILIATION (AUDIT-DEFECT-03) ---");

  // 2.1 Seed Monthly Prepaid Product & Per-Meal Product
  await db.execute(`
    INSERT INTO tiffin_products (id, code, name, category, billing_unit, price, currency, status, created_by, created_at, updated_at)
    VALUES
      ('prod_prepaid_51', 'PREPAID-MONTHLY-51', 'Executive Monthly Tiffin Package', 'SUBSCRIPTION_PACKAGE', 'PER_MONTH', 3500, 'INR', 'ACTIVE', 'usr_admin_51', ?, ?),
      ('prod_permeal_51', 'PER-MEAL-51', 'Daily Tiffin Standard', 'STANDARD_MEAL', 'PER_MEAL', 150, 'INR', 'ACTIVE', 'usr_admin_51', ?, ?)
  `, [now, now, now, now]);

  // 2.2 Seed Subscriptions
  await db.execute(`
    INSERT INTO tiffin_subscriptions (
      id, customer_id, product_id, status, start_date, price, currency,
      meal_types, service_days, quantity_per_meal, delivery_address, created_by, created_at, updated_at
    ) VALUES
      ('sub_monthly_51', 'cust_51', 'prod_prepaid_51', 'ACTIVE', '2026-10-01', 3500, 'INR', 'BOTH', 'ALL_DAYS', 1, 'Flat 402, Brigade Gateway', 'usr_admin_51', ?, ?),
      ('sub_permeal_51', 'cust_51', 'prod_permeal_51', 'ACTIVE', '2026-10-01', 150, 'INR', 'LUNCH', 'ALL_DAYS', 1, 'Flat 402, Brigade Gateway', 'usr_admin_51', ?, ?)
  `, [now, now, now, now]);

  // 2.3 Generate monthly invoice covering 2026-10 and allocate payment
  const genResult = await generateTiffinInvoices(adminActor, {
    billingPeriod: "2026-10",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    dueDate: "2026-10-15",
    customerIds: ["cust_51"],
    autoIssue: true,
  });
  assert(genResult.invoices.length === 1, "Generated 1 monthly tiffin invoice for cust_51");
  const monthlyInvoice = genResult.invoices[0];
  assert(monthlyInvoice.totalAmount === 3500, "Monthly invoice total amount is ₹3,500");

  // Record payment for this invoice
  await recordTiffinPayment(accountantActor, {
    customerId: "cust_51",
    amount: 3500,
    transactionDate: "2026-10-08",
    paymentMethod: "UPI",
    invoiceId: monthlyInvoice.id,
    notes: "Full payment for October 2026 monthly package",
  });

  // 2.4 Seed Meal Plan and Delivery Tasks
  await db.execute(`
    INSERT INTO daily_meal_plans (id, service_date, meal_type, planned_resident_count, planned_tiffin_count, guest_count, final_preparation_count, status, created_by, created_at, updated_at)
    VALUES ('plan_51_lunch', '2026-10-10', 'LUNCH', 20, 5, 0, 25, 'CONFIRMED', 'usr_admin_51', ?, ?)
  `, [now, now]);

  // Task 1: External delivery task for monthly subscription - STATUS: EXCEPTION (failed delivery)
  await db.execute(`
    INSERT INTO delivery_tasks (
      id, order_type, subscription_id, plan_id, service_date, meal_type,
      customer_name, customer_phone, delivery_address, status,
      exception_type, exception_reason, exception_at, exception_by,
      created_at, updated_at
    ) VALUES (
      'dt_exc_monthly_01', 'EXTERNAL', 'sub_monthly_51', 'plan_51_lunch', '2026-10-10', 'LUNCH',
      'Arjun Kapoor', '+919988770051', 'Flat 402, Brigade Gateway', 'EXCEPTION',
      'RESIDENT_UNAVAILABLE', 'Customer door locked and phone unreachable', ?, 'usr_del_51',
      ?, ?
    )
  `, [now, now, now]);

  // Task 2: External delivery task for monthly subscription - STATUS: DELIVERED (fulfilled)
  await db.execute(`
    INSERT INTO delivery_tasks (
      id, order_type, subscription_id, plan_id, service_date, meal_type,
      customer_name, customer_phone, delivery_address, status,
      delivered_at, delivered_by,
      created_at, updated_at
    ) VALUES (
      'dt_del_monthly_02', 'EXTERNAL', 'sub_monthly_51', 'plan_51_lunch', '2026-10-11', 'LUNCH',
      'Arjun Kapoor', '+919988770051', 'Flat 402, Brigade Gateway', 'DELIVERED',
      ?, 'usr_del_51',
      ?, ?
    )
  `, [now, now, now]);

  // Task 3: External delivery task for PER-MEAL subscription - STATUS: EXCEPTION
  await db.execute(`
    INSERT INTO delivery_tasks (
      id, order_type, subscription_id, plan_id, service_date, meal_type,
      customer_name, customer_phone, delivery_address, status,
      exception_type, exception_reason, exception_at, exception_by,
      created_at, updated_at
    ) VALUES (
      'dt_exc_permeal_03', 'EXTERNAL', 'sub_permeal_51', 'plan_51_lunch', '2026-10-10', 'LUNCH',
      'Arjun Kapoor', '+919988770051', 'Flat 402, Brigade Gateway', 'EXCEPTION',
      'LOCATION_UNCLEAR', 'Wrong floor indicated', ?, 'usr_del_51',
      ?, ?
    )
  `, [now, now, now]);

  // Task 4: Resident meal delivery task - STATUS: EXCEPTION
  await db.execute(`
    INSERT INTO delivery_tasks (
      id, order_type, resident_id, plan_id, service_date, meal_type,
      resident_name, room_number, status,
      exception_type, exception_reason, exception_at, exception_by,
      created_at, updated_at
    ) VALUES (
      'dt_exc_resident_04', 'RESIDENT', 'res_51', 'plan_51_lunch', '2026-10-10', 'LUNCH',
      'Ramesh Sharma', '501', 'EXCEPTION',
      'RESIDENT_DECLINED', 'Resident declined meal', ?, 'usr_del_51',
      ?, ?
    )
  `, [now, now, now]);

  // 2.5 Query exceptions via getPrepaidBillingExceptions
  const excSummary = await getPrepaidBillingExceptions(accountantActor, {
    billingPeriod: "2026-10",
  });

  assert(excSummary.totalExceptionsCount === 1, "getPrepaidBillingExceptions returns exactly 1 exception (dt_exc_monthly_01)");
  assert(excSummary.pendingReviewCount === 1, "Pending review count is 1");
  assert(excSummary.reconciledCount === 0, "Reconciled count is initially 0");
  assert(excSummary.coveredByPaidInvoiceCount === 1, "Covered by paid invoice count is 1");

  const excItem = excSummary.exceptions[0];
  assert(excItem.taskId === "dt_exc_monthly_01", "Exception task ID is 'dt_exc_monthly_01'");
  assert(excItem.orderType === "EXTERNAL", "Exception is external commercial order");
  assert(excItem.billingUnit === "PER_MONTH", "Exception belongs to monthly package");
  assert(excItem.invoiceId === monthlyInvoice.id, "Exception correctly links to October monthly invoice ID");
  assert(excItem.isCoveredByPaidInvoice === true, "Exception is flagged as covered by a paid prepaid invoice");
  assert(excItem.reconciliationStatus === "PENDING_REVIEW", "Reconciliation status is PENDING_REVIEW");

  // Verify non-monthly task was excluded
  assert(
    !excSummary.exceptions.some((e) => e.taskId === "dt_exc_permeal_03"),
    "Per-meal exception task dt_exc_permeal_03 is excluded from prepaid exceptions"
  );

  // Verify resident task was strictly excluded
  assert(
    !excSummary.exceptions.some((e) => e.taskId === "dt_exc_resident_04"),
    "Resident meal exception task dt_exc_resident_04 is strictly excluded from commercial exceptions"
  );

  // Verify delivered task was excluded
  assert(
    !excSummary.exceptions.some((e) => e.taskId === "dt_del_monthly_02"),
    "Delivered task dt_del_monthly_02 is excluded"
  );

  // 2.6 Record reconciliation disposition
  const reconcileResult = await reconcilePrepaidException(accountantActor, {
    taskId: "dt_exc_monthly_01",
    resolution: "CREDIT_PENDING_POLICY",
    notes: "Resident confirmed phone unreachable during festival. Customer requested rollover meal.",
  });

  assert(reconcileResult.taskId === "dt_exc_monthly_01", "reconcilePrepaidException returns task ID");
  assert(reconcileResult.resolution === "CREDIT_PENDING_POLICY", "reconcilePrepaidException records CREDIT_PENDING_POLICY");
  assert(reconcileResult.reconciledByName === "accountant_51", "reconciledByName is accountant_51");
  assert(
    reconcileResult.policyStatement.includes("deferred pending management policy determination"),
    "Clear policy statement returned documenting pending credit policy"
  );

  // Verify delivery_tasks delivery_notes was updated
  const updatedTask = await db.queryOne<any>("SELECT status, delivery_notes FROM delivery_tasks WHERE id = 'dt_exc_monthly_01'");
  assert(updatedTask.status === "EXCEPTION", "Task status remains EXCEPTION (historical state preserved)");
  assert(
    updatedTask.delivery_notes.includes("[RECONCILED") &&
    updatedTask.delivery_notes.includes("CREDIT_PENDING_POLICY"),
    "delivery_notes contains audit stamp and disposition"
  );

  // Verify invoice and transaction non-duplication
  const invoiceAfter = await db.queryOne<any>("SELECT total_amount, amount_paid, status FROM invoices WHERE id = ?", [monthlyInvoice.id]);
  assert(Number(invoiceAfter.total_amount) === 3500, "Historical invoice total amount remains ₹3,500 (unaltered)");
  assert(Number(invoiceAfter.amount_paid) === 3500, "Historical invoice amount paid remains ₹3,500 (unaltered)");
  assert(invoiceAfter.status === "PAID", "Historical invoice status remains 'PAID' (unaltered by exception reconciliation)");

  const unauthCreditTx = await db.queryOne<any>(
    "SELECT * FROM financial_transactions WHERE resident_id IS NULL AND customer_id = 'cust_51' AND amount < 0"
  );
  assert(!unauthCreditTx, "Zero negative financial transactions created (accounting integrity preserved)");

  // 2.7 Query again: reconciliation status is now RECONCILED
  const excSummaryAfter = await getPrepaidBillingExceptions(accountantActor, {
    billingPeriod: "2026-10",
  });
  assert(excSummaryAfter.pendingReviewCount === 0, "Pending review count is now 0");
  assert(excSummaryAfter.reconciledCount === 1, "Reconciled count is now 1");
  assert(excSummaryAfter.exceptions[0].reconciliationStatus === "RECONCILED", "Exception status is now RECONCILED");
  assert(excSummaryAfter.exceptions[0].reconciliationResolution === "CREDIT_PENDING_POLICY", "Resolution is CREDIT_PENDING_POLICY");

  // Status filter check
  const pendingOnly = await getPrepaidBillingExceptions(accountantActor, {
    billingPeriod: "2026-10",
    status: "PENDING_REVIEW",
  });
  assert(pendingOnly.exceptions.length === 0, "Filter status='PENDING_REVIEW' returns 0 records after reconciliation");

  const reconciledOnly = await getPrepaidBillingExceptions(accountantActor, {
    billingPeriod: "2026-10",
    status: "RECONCILED",
  });
  assert(reconciledOnly.exceptions.length === 1, "Filter status='RECONCILED' returns exactly 1 record");

  // 2.8 Duplicate reconciliation prevention
  let caughtDuplicate = false;
  try {
    await reconcilePrepaidException(accountantActor, {
      taskId: "dt_exc_monthly_01",
      resolution: "REVIEWED_NO_ACTION",
      notes: "Attempting duplicate reconciliation",
    });
  } catch (err: any) {
    caughtDuplicate = true;
    assert(
      err.message.includes("already been reconciled") && err.message.includes("Duplicate reconciliation is rejected"),
      "Duplicate reconciliation throws explicit error with previous reconciler details"
    );
  }
  assert(caughtDuplicate, "Duplicate reconciliation is strictly rejected");

  // 2.9 Strict guards on invalid tasks
  let caughtResident = false;
  try {
    await reconcilePrepaidException(accountantActor, {
      taskId: "dt_exc_resident_04",
      resolution: "REVIEWED_NO_ACTION",
    });
  } catch (err: any) {
    caughtResident = true;
    assert(err.message.includes("Resident delivery tasks are strictly excluded"), "Resident task reconciliation rejected with clear error");
  }
  assert(caughtResident, "Resident task cannot be reconciled under commercial flow");

  let caughtDelivered = false;
  try {
    await reconcilePrepaidException(accountantActor, {
      taskId: "dt_del_monthly_02",
      resolution: "REVIEWED_NO_ACTION",
    });
  } catch (err: any) {
    caughtDelivered = true;
    assert(err.message.includes("Only tasks in EXCEPTION status can be reconciled"), "Delivered task reconciliation rejected");
  }
  assert(caughtDelivered, "Non-exception task cannot be reconciled");

  let caughtPerMeal = false;
  try {
    await reconcilePrepaidException(accountantActor, {
      taskId: "dt_exc_permeal_03",
      resolution: "REVIEWED_NO_ACTION",
    });
  } catch (err: any) {
    caughtPerMeal = true;
    assert(err.message.includes("Prepaid exception reconciliation applies only to fixed monthly packages"), "Per-meal task reconciliation rejected");
  }
  assert(caughtPerMeal, "Per-meal task cannot be reconciled under prepaid exception flow");

  // ============================================================================
  // SECTION 3: IMMUTABILITY & ISOLATION GUARDS
  // ============================================================================
  console.log("\n--- SECTION 3: DATABASE IMMUTABILITY & SAFETY GUARDS ---");
  if (primaryStatsBefore) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs &&
      primaryStatsBefore.size === primaryStatsAfter.size,
      "Protected primary database data/erp.db was 100% UNTOUCHED (timestamps & size identical)"
    );
  } else {
    assert(!fs.existsSync(primaryDbPath), "Primary data/erp.db did not exist and was not created");
  }

  // Cleanup test database
  cleanupTestDb();

  console.log("\n================================================================================");
  console.log(`TASK 01B.51 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  cleanupTestDb();
  process.exit(1);
});
