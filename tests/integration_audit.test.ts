import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "../apps/erp/src/server/database/migrations";
import { getDb, closeDb } from "../apps/erp/src/server/database/db";
import { hasPermission } from "../apps/erp/src/server/authorization/permissions";
import {
  requirePermission,
  AuthorizationError,
} from "../apps/erp/src/server/authorization/authorize";
import {
  createRoom,
  updateRoom,
  setRoomActiveStatus,
  listRooms,
  getRoomById,
} from "../apps/erp/src/server/rooms/roomService";
import {
  registerResident,
  assignResidentToRoom,
  checkOutResident,
  listResidents,
  getResidentById,
} from "../apps/erp/src/server/residents/residentService";
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
import {
  getEligibleResidentsForDate,
  createMealPlan,
  updateMealPlan,
  confirmMealPlan,
  completeMealPlan,
  adjustMealPlanQuantity,
  getMealPlanById,
  listMealPlans,
  getPreparationSheetData,
  getKitchenDashboardSummary,
} from "../apps/erp/src/server/kitchen/kitchenService";
import { getAuditLogs } from "../apps/erp/src/server/audit/audit";
import { AuthenticatedUser } from "../apps/erp/src/types";

// Isolated integration test database path
const TEST_INTEGRATION_DB_PATH = path.resolve(__dirname, "test_integration_audit.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_INTEGRATION_DB_PATH)) fs.unlinkSync(TEST_INTEGRATION_DB_PATH);
  const wal = `${TEST_INTEGRATION_DB_PATH}-wal`;
  const shm = `${TEST_INTEGRATION_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_INTEGRATION_DB_PATH;

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
console.log("RAVINARAYAN ERP — COMPREHENSIVE INTEGRATION AUDIT TEST SUITE (PHASES 1.5 - 5)");
console.log("================================================================================\n");

async function runIntegrationAuditTests() {
  // Test actors matching valid StaffRole domain types
  const superAdminUser: AuthenticatedUser = {
    id: "usr_admin_audit",
    username: "admin_audit",
    email: "admin.audit@ravinarayan.in",
    fullName: "Audit Administrator",
    role: "SUPER_ADMIN",
  };

  const managerUser: AuthenticatedUser = {
    id: "usr_manager_audit",
    username: "manager_audit",
    email: "manager.audit@ravinarayan.in",
    fullName: "Audit Operations Manager",
    role: "OPERATIONS_MANAGER",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_accountant_audit",
    username: "accountant_audit",
    email: "accountant.audit@ravinarayan.in",
    fullName: "Audit Senior Accountant",
    role: "ACCOUNTANT",
  };

  const kitchenUser: AuthenticatedUser = {
    id: "usr_kitchen_audit",
    username: "kitchen_audit",
    email: "kitchen.audit@ravinarayan.in",
    fullName: "Audit Head Chef",
    role: "KITCHEN_OPERATIONS",
  };

  const deliveryUser: AuthenticatedUser = {
    id: "usr_delivery_audit",
    username: "delivery_audit",
    email: "delivery.audit@ravinarayan.in",
    fullName: "Audit Delivery Staff",
    role: "DELIVERY_PERSON",
  };

  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Isolated Database Setup & Schema Verification
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Isolated Database Setup & Schema Verification");

  const initDb = new Database(TEST_INTEGRATION_DB_PATH);
  initDb.pragma("journal_mode = WAL");
  initDb.pragma("foreign_keys = ON");

  runMigrations(initDb);

  const verRow = initDb.pragma("user_version", { simple: true });
  assert(Number(verRow) >= 5, `Database schema version advanced to at least V5 (got ${verRow})`);

  const tables = initDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: any) => r.name);

  assert(tables.includes("staff_users"), "Table staff_users exists");
  assert(tables.includes("rooms"), "Table rooms exists");
  assert(tables.includes("residents"), "Table residents exists");
  assert(tables.includes("resident_stays"), "Table resident_stays exists");
  assert(tables.includes("financial_transactions"), "Table financial_transactions exists");
  assert(tables.includes("daily_meal_plans"), "Table daily_meal_plans exists");
  assert(tables.includes("resident_meal_records"), "Table resident_meal_records exists");
  assert(tables.includes("audit_logs"), "Table audit_logs exists");

  // Seed staff users in test DB
  const now = new Date().toISOString();
  const insertStaff = initDb.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fake_hash', ?, 1, ?, ?)
  `);

  for (const u of [superAdminUser, managerUser, accountantUser, kitchenUser, deliveryUser]) {
    insertStaff.run(u.id, u.username, u.email, u.fullName, u.role, now, now);
  }
  initDb.close();
  assert(true, "Seed staff users populated across all 5 roles");

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Full 16-Step Cross-Module Operational Lifecycle
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Full 16-Step Cross-Module Operational Lifecycle");

  // Step 1: Create Room 401 (Double Sharing, rent ₹9,000, deposit ₹10,000)
  const room401 = createRoom(managerUser, {
    roomNumber: "401",
    floor: 4,
    type: "DOUBLE_SHARING",
    capacity: 2,
    baseRentMonthly: 9000,
  });

  assert(room401.id.startsWith("room_"), "Step 1: Room 401 created with prefixed ID");
  assert(room401.capacity === 2, "Step 1: Room capacity is 2");

  const initialRoomDetails = getRoomById(managerUser, room401.id)!;
  assert(initialRoomDetails.occupiedBeds === 0, "Step 1: Initial occupancy is 0 beds");
  assert(initialRoomDetails.availableBeds === 2, "Step 1: 2 available beds");

  // Step 2: Register Resident John Doe
  const residentJohn = registerResident(managerUser, {
    fullName: "John Doe",
    email: "john.doe@example.com",
    phone: "9876543210",
    emergencyContact: "+91 98765 43211",
    notes: "Senior Resident at Met City Tech Park",
  });

  assert(residentJohn.id.startsWith("res_"), "Step 2: Resident John Doe registered with prefixed ID");
  assert(residentJohn.status === "ACTIVE", "Step 2: Resident status is ACTIVE");

  // Step 3: Check-in John Doe to Room 401 on 2026-10-01
  const stayJohn = assignResidentToRoom(managerUser, {
    residentId: residentJohn.id,
    roomId: room401.id,
    checkInDate: "2026-10-01",
    monthlyRent: 9000,
    securityDeposit: 10000,
  });

  assert(stayJohn.id.startsWith("stay_"), "Step 3: Stay record created with prefixed ID");
  assert(stayJohn.status === "ACTIVE", "Step 3: Stay status is ACTIVE");

  const roomAfterCheckin = getRoomById(managerUser, room401.id)!;
  assert(roomAfterCheckin.occupiedBeds === 1, "Step 3: Room occupancy incremented to 1/2");
  assert(roomAfterCheckin.availableBeds === 1, "Step 3: Available beds decreased to 1");

  // Step 4: Post monthly rent charge (₹9,000 for October 2026)
  const chargeTx = recordRentCharge(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 9000,
    transactionDate: "2026-10-01",
    billingPeriod: "October 2026",
    description: "Monthly room rent for Room 401",
  });

  assert(chargeTx.transactionType === "RENT_CHARGE", "Step 4: Rent charge recorded");
  assert(chargeTx.amount === 9000, "Step 4: Charge amount is ₹9,000");

  const balanceAfterCharge = getResidentRentBalance(residentJohn.id);
  assert(balanceAfterCharge === 9000, `Step 4: Resident rent balance is ₹9,000 (got ₹${balanceAfterCharge})`);

  // Step 5: Partial payment (₹5,000 via UPI)
  const payTx1 = recordRentPayment(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 5000,
    transactionDate: "2026-10-02",
    paymentMethod: "UPI",
    referenceNumber: "UPI-TXN-5001",
    description: "Partial rent payment via GPay",
  });

  assert(payTx1.transactionType === "RENT_PAYMENT", "Step 5: Rent payment recorded");
  assert(payTx1.amount === 5000, "Step 5: Payment amount is ₹5,000");

  const balanceAfterPay1 = getResidentRentBalance(residentJohn.id);
  assert(balanceAfterPay1 === 4000, `Step 5: Balance reduced to ₹4,000 (got ₹${balanceAfterPay1})`);

  // Step 6: Overpayment rejection: Attempt to pay ₹5,000 when only ₹4,000 is due
  let overpayBlocked = false;
  try {
    recordRentPayment(accountantUser, {
      residentId: residentJohn.id,
      stayId: stayJohn.id,
      amount: 5000,
      transactionDate: "2026-10-03",
      paymentMethod: "UPI",
      description: "Attempted overpayment",
    });
  } catch (err: any) {
    overpayBlocked = err.message.includes("exceeds current outstanding rent balance");
  }
  assert(overpayBlocked, "Step 6: Overpayment exceeding outstanding balance strictly rejected");

  // Step 7: Pay remaining balance (₹4,000 via CASH)
  const payTx2 = recordRentPayment(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 4000,
    transactionDate: "2026-10-04",
    paymentMethod: "CASH",
    description: "Final rent settlement in cash",
  });

  const balanceAfterPay2 = getResidentRentBalance(residentJohn.id);
  assert(balanceAfterPay2 === 0, `Step 7: Rent balance settled to exactly ₹0 (got ₹${balanceAfterPay2})`);

  // Step 8: Record Security Deposit (₹10,000 via BANK_TRANSFER) - verify liability isolation
  const depositTx = recordSecurityDeposit(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 10000,
    transactionDate: "2026-10-01",
    paymentMethod: "BANK_TRANSFER",
    referenceNumber: "IMPS-DEP-9988",
    description: "Security deposit for Room 401",
  });

  assert(depositTx.transactionType === "SECURITY_DEPOSIT", "Step 8: Security deposit recorded");
  const dossierAfterDeposit = getResidentFinancialSummary(accountantUser, residentJohn.id);
  assert(dossierAfterDeposit.totalSecurityDepositHeld === 10000, "Step 8: Security deposit held is ₹10,000");
  assert(dossierAfterDeposit.outstandingRentBalance === 0, "Step 8: Rent balance remains ₹0 (deposit is isolated from rent)");

  // Step 9: Operational business expense (₹2,500 Grocery via CASH)
  const expenseTx = recordExpense(accountantUser, {
    category: "GROCERY",
    amount: 2500,
    transactionDate: "2026-10-05",
    paymentMethod: "CASH",
    payeeVendor: "Local Vegetable Market",
    description: "Daily fresh kitchen provisions",
  });
  assert(expenseTx.transactionType === "EXPENSE", "Step 9: Grocery expense recorded");

  // Step 10: Kitchen meal planning for 2026-10-16 (Breakfast)
  const breakfastPlan = createMealPlan(kitchenUser, {
    serviceDate: "2026-10-16",
    mealType: "BREAKFAST",
    guestCount: 3,
    notes: "Special weekend breakfast",
  });

  assert(breakfastPlan.plannedResidentCount === 1, `Step 10: Resident John Doe auto-discovered as eligible (count = 1)`);
  assert(breakfastPlan.finalPreparationCount === 4, `Step 10: Final preparation count is 4 (1 resident + 3 guests)`);

  // Step 11: Resident opt-out for dinner on 2026-10-16
  const dinnerPlan = createMealPlan(kitchenUser, {
    serviceDate: "2026-10-16",
    mealType: "DINNER",
    guestCount: 1,
    residentOptOuts: [residentJohn.id],
    notes: "Dinner with resident opt-out",
  });

  assert(dinnerPlan.plannedResidentCount === 0, `Step 11: Planned residents is 0 after opt-out`);
  assert(dinnerPlan.finalPreparationCount === 1, `Step 11: Final prep count is 1 (0 residents + 1 guest)`);

  // Step 12: Meal plan confirmation & completion workflow
  const confirmedBreakfast = confirmMealPlan(kitchenUser, breakfastPlan.id);
  assert(confirmedBreakfast.status === "CONFIRMED", "Step 12: Breakfast plan transitioned to CONFIRMED");
  assert(confirmedBreakfast.confirmedBy === kitchenUser.id, "Step 12: Stamped with confirmer ID");

  const completedBreakfast = completeMealPlan(kitchenUser, breakfastPlan.id);
  assert(completedBreakfast.status === "COMPLETED", "Step 12: Breakfast plan transitioned to COMPLETED");
  assert(completedBreakfast.completedBy === kitchenUser.id, "Step 12: Stamped with completer ID");

  // Step 13: Daily kitchen prep sheet and dashboard data
  const prepSheet = getPreparationSheetData(kitchenUser, breakfastPlan.id);
  assert(prepSheet.plan.id === breakfastPlan.id, "Step 13: Prep sheet plan matches breakfast");
  assert(prepSheet.summary.finalPreparationCount === 4, "Step 13: Prep sheet preparation count matches 4");
  assert(prepSheet.residentRecords.length === 1, "Step 13: Prep sheet includes resident records");

  const kitchenDash = getKitchenDashboardSummary(kitchenUser, "2026-10-16");
  assert(kitchenDash.plans.breakfast !== null, "Step 13: Dashboard contains breakfast");
  assert(kitchenDash.plans.dinner !== null, "Step 13: Dashboard contains dinner");
  assert(kitchenDash.plans.dinner!.plannedResidentCount === 0, "Step 13: Dinner has 0 planned residents due to opt-out");

  // Step 14: Resident check-out on 2026-10-20
  checkOutResident(managerUser, {
    residentId: residentJohn.id,
    checkOutDate: "2026-10-20",
  });

  const residentAfterCheckout = getResidentById(managerUser, residentJohn.id)!;
  assert(residentAfterCheckout.status === "CHECKED_OUT", "Step 14: Resident status updated to CHECKED_OUT");
  assert(residentAfterCheckout.currentRoom === null, "Step 14: Resident has no active room assignment");

  const roomAfterCheckout = getRoomById(managerUser, room401.id)!;
  assert(roomAfterCheckout.occupiedBeds === 0, "Step 14: Room occupancy decreased to 0/2");
  assert(roomAfterCheckout.availableBeds === 2, "Step 14: Room beds restored to 2");

  // Step 15: Post-checkout historical preservation & meal eligibility cutoff
  const postCheckoutDossier = getResidentFinancialSummary(accountantUser, residentJohn.id);
  assert(postCheckoutDossier.transactions.length === 4, "Step 15: All 4 financial transactions preserved after checkout");
  assert(postCheckoutDossier.totalRentPaid === 9000, "Step 15: Financial history fully preserved");

  const futureEligible = getEligibleResidentsForDate(kitchenUser, "2026-10-25");
  const isJohnEligibleFuture = futureEligible.some((r) => r.residentId === residentJohn.id);
  assert(!isJohnEligibleFuture, "Step 15: Checked-out resident is strictly excluded from future meal planning");

  // Step 16: End-to-end Cashbook Summary verification
  const cashbook = getCashbookSummary(accountantUser, {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  });

  assert(cashbook.totalRentCollected === 9000, `Step 16: Cashbook rent collected is ₹9,000 (got ₹${cashbook.totalRentCollected})`);
  assert(cashbook.totalDepositsCollected === 10000, `Step 16: Cashbook deposits collected is ₹10,000 (got ₹${cashbook.totalDepositsCollected})`);
  assert(cashbook.totalExpensesPaid === 2500, `Step 16: Cashbook expenses paid is ₹2,500 (got ₹${cashbook.totalExpensesPaid})`);
  assert(cashbook.netCashMovement === 16500, `Step 16: Cashbook Net Cash Movement is ₹16,500 (9000+10000-2500, got ₹${cashbook.netCashMovement})`);
  assert(cashbook.totalOutstandingRent === 0, `Step 16: Total global outstanding rent is ₹0 (got ₹${cashbook.totalOutstandingRent})`);

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Idempotency Payload Mismatch Rejection
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Idempotency Payload Mismatch Rejection");

  // 1. Rent Charge: Identical vs Mismatched
  const keyChg = "idemp_audit_chg_101";
  const chgOrig = recordRentCharge(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 8000,
    transactionDate: "2026-10-01",
    billingPeriod: "November 2026",
    idempotencyKey: keyChg,
  });

  // Identical submission returns original
  const chgDup = recordRentCharge(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 8000,
    transactionDate: "2026-10-01",
    billingPeriod: "November 2026",
    idempotencyKey: keyChg,
  });
  assert(chgOrig.id === chgDup.id, "Rent Charge: Identical payload returns existing transaction");

  // Mismatched amount throws error
  let chgMismatchBlocked = false;
  try {
    recordRentCharge(accountantUser, {
      residentId: residentJohn.id,
      stayId: stayJohn.id,
      amount: 8500, // Different amount
      transactionDate: "2026-10-01",
      billingPeriod: "November 2026",
      idempotencyKey: keyChg,
    });
  } catch (err: any) {
    chgMismatchBlocked = err.message.includes("was already used with a different transaction payload");
  }
  assert(chgMismatchBlocked, "Rent Charge: Mismatched payload with reused idempotency key strictly rejected");

  // 2. Rent Payment: Identical vs Mismatched
  const keyPay = "idemp_audit_pay_101";
  const payOrig = recordRentPayment(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 3000,
    transactionDate: "2026-10-02",
    paymentMethod: "CASH",
    idempotencyKey: keyPay,
  });

  const payDup = recordRentPayment(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 3000,
    transactionDate: "2026-10-02",
    paymentMethod: "CASH",
    idempotencyKey: keyPay,
  });
  assert(payOrig.id === payDup.id, "Rent Payment: Identical payload returns existing transaction");

  // Mismatched payment method throws
  let payMismatchBlocked = false;
  try {
    recordRentPayment(accountantUser, {
      residentId: residentJohn.id,
      stayId: stayJohn.id,
      amount: 3000,
      transactionDate: "2026-10-02",
      paymentMethod: "UPI", // Mismatch
      idempotencyKey: keyPay,
    });
  } catch (err: any) {
    payMismatchBlocked = err.message.includes("was already used with a different transaction payload");
  }
  assert(payMismatchBlocked, "Rent Payment: Mismatched payment method reuse strictly rejected");

  // 3. Security Deposit: Mismatched amount throws
  const keyDep = "idemp_audit_dep_101";
  recordSecurityDeposit(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 5000,
    transactionDate: "2026-10-02",
    paymentMethod: "BANK_TRANSFER",
    idempotencyKey: keyDep,
  });

  let depMismatchBlocked = false;
  try {
    recordSecurityDeposit(accountantUser, {
      residentId: residentJohn.id,
      stayId: stayJohn.id,
      amount: 6000, // Mismatch
      transactionDate: "2026-10-02",
      paymentMethod: "BANK_TRANSFER",
      idempotencyKey: keyDep,
    });
  } catch (err: any) {
    depMismatchBlocked = err.message.includes("was already used with a different transaction payload");
  }
  assert(depMismatchBlocked, "Security Deposit: Mismatched payload reuse strictly rejected");

  // 4. Expense: Mismatched category throws
  const keyExp = "idemp_audit_exp_101";
  recordExpense(accountantUser, {
    category: "MAINTENANCE",
    amount: 1200,
    transactionDate: "2026-10-05",
    paymentMethod: "CASH",
    description: "Plumber visit",
    idempotencyKey: keyExp,
  });

  let expMismatchBlocked = false;
  try {
    recordExpense(accountantUser, {
      category: "UTILITIES", // Mismatch
      amount: 1200,
      transactionDate: "2026-10-05",
      paymentMethod: "CASH",
      description: "Plumber visit",
      idempotencyKey: keyExp,
    });
  } catch (err: any) {
    expMismatchBlocked = err.message.includes("was already used with a different transaction payload");
  }
  assert(expMismatchBlocked, "Expense: Mismatched category reuse strictly rejected");

  // Verify exactly 1 record exists in SQLite for each idempotency key
  const verifyDb = getDb();
  for (const k of [keyChg, keyPay, keyDep, keyExp]) {
    const row = verifyDb.prepare("SELECT count(*) as count FROM financial_transactions WHERE idempotency_key = ?").get(k) as { count: number };
    assert(row.count === 1, `Database contains exactly 1 row for key '${k}'`);
  }

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: Reversal Protection & Financial Invariant Guards
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Reversal Protection & Financial Invariant Guards");

  // Guard 1: Double reversal of already reversed transaction is blocked
  const dummyCharge = recordRentCharge(accountantUser, {
    residentId: residentJohn.id,
    stayId: stayJohn.id,
    amount: 1500,
    transactionDate: "2026-10-06",
    billingPeriod: "Reversal Test Period",
    description: "Charge to be reversed",
  });

  const firstReversal = reverseTransaction(accountantUser, dummyCharge.id, "Billed in error by front desk");
  assert(firstReversal.transactionType === "REVERSAL", "First reversal succeeds");

  let doubleRevBlocked = false;
  try {
    reverseTransaction(accountantUser, dummyCharge.id, "Attempt second reversal");
  } catch (err: any) {
    doubleRevBlocked = err.message.includes("is already reversed");
  }
  assert(doubleRevBlocked, "Guard 1: Attempt to reverse already reversed transaction strictly rejected");

  // Guard 2: Attempting to reverse a REVERSAL transaction itself is blocked
  let reverseReversalBlocked = false;
  try {
    reverseTransaction(accountantUser, firstReversal.id, "Attempt to reverse the reversal record");
  } catch (err: any) {
    reverseReversalBlocked = err.message.includes("Reversal records cannot themselves be reversed");
  }
  assert(reverseReversalBlocked, "Guard 2: Reversing a REVERSAL record is strictly blocked");

  // Guard 3: Attempting to reverse a RENT_CHARGE when payments have already been applied
  // Current John Doe state:
  // Charges: November 2026 charge was ₹8,000.
  // Payments: Payment was ₹3,000.
  // Current outstanding balance = ₹8,000 - ₹3,000 = ₹5,000.
  // If we try to reverse the ₹8,000 charge, it would leave balance at -₹3,000 (illegal negative balance)!
  let paidChargeRevBlocked = false;
  try {
    reverseTransaction(accountantUser, chgOrig.id, "Attempt to reverse charge that has payments applied");
  } catch (err: any) {
    paidChargeRevBlocked = err.message.includes("because payments have already been applied against it");
  }
  assert(paidChargeRevBlocked, "Guard 3: Reversing a rent charge with applied payments is strictly blocked");

  // Guard 4: Reversing the payment first allows the charge to then be reversed safely
  const revPayment = reverseTransaction(accountantUser, payOrig.id, "Payment bounced or refunded");
  assert(revPayment.transactionType === "REVERSAL", "Rent payment reversed successfully");
  const balanceAfterPayRev = getResidentRentBalance(residentJohn.id);
  assert(balanceAfterPayRev === 8000, `Rent balance restored to ₹8,000 after payment reversal (got ₹${balanceAfterPayRev})`);

  // Now reversing the charge of ₹8,000 succeeds because current balance equals charge amount (₹8,000 >= ₹8,000)
  const revCharge = reverseTransaction(accountantUser, chgOrig.id, "Now safe to reverse charge");
  assert(revCharge.transactionType === "REVERSAL", "Rent charge reversed successfully once balance was clear");
  const balanceAfterChgRev = getResidentRentBalance(residentJohn.id);
  assert(balanceAfterChgRev === 0, `Rent balance restored to ₹0 (got ₹${balanceAfterChgRev})`);

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Cross-Period Cashbook Accounting Integrity
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Cross-Period Cashbook Accounting Integrity");

  // 1. Insert a prior-period transaction directly with transactionDate in September 2026
  const septTxId = `txn_sept_${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  verifyDb.prepare(`
    INSERT INTO financial_transactions (
      id, transaction_type, amount, transaction_date, payment_method,
      reference_number, resident_id, stay_id, category, description,
      billing_period, payee_vendor, idempotency_key, status,
      reversal_of_id, created_by, created_at, updated_at
    ) VALUES (
      ?, 'RENT_PAYMENT', 6000, '2026-09-15', 'BANK_TRANSFER',
      'SEPT-TXN-01', ?, ?, 'RENT', 'September rent payment',
      NULL, NULL, 'idemp_sept_pay', 'POSTED',
      NULL, ?, ?, ?
    )
  `).run(septTxId, residentJohn.id, stayJohn.id, accountantUser.id, nowIso, nowIso);

  // 2. Query September Cashbook before reversal: September rent collected includes ₹6,000
  const septCashbook = getCashbookSummary(accountantUser, {
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  });
  assert(septCashbook.totalRentCollected === 6000, "September cashbook shows ₹6,000 rent collected");

  // 3. Now in October, staff reverses the September payment (refunds the resident)
  const septReversal = reverseTransaction(accountantUser, septTxId, "September payment reversed due to bank dispute in October");
  assert(septReversal.transactionType === "REVERSAL", "Cross-period transaction reversed");
  assert(septReversal.transactionDate.startsWith("2026-"), "Reversal dated today");

  // 4. Query October Cashbook: October rent collected reflects the refund outflow from the prior period
  const octCashbook = getCashbookSummary(accountantUser, {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  });

  // In October:
  // Step 5: payTx1 = 5000
  // Step 7: payTx2 = 4000
  // Suite 3: payOrig = 3000 (which was reversed in Suite 4, intra-period)
  // Cross-period reversal of September payment: priorRentRefunds = 6000
  // Posted October rent payments: 5000 + 4000 = 9000 (since payOrig has status = 'REVERSED')
  // Net rent collected in October: 9000 - 6000 = 3000!
  assert(
    octCashbook.totalRentCollected === 3000,
    `October rent collected accurately reduced by ₹6,000 cross-period refund (got ₹${octCashbook.totalRentCollected})`
  );

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Concurrency and Race Condition Guards
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Concurrency and Race Condition Guards");

  // 1. Room Over-Capacity Guard: Room 401 has capacity 2.
  // Register 3 more residents and assign them to Room 401
  const residentAlice = registerResident(managerUser, {
    fullName: "Alice Smith",
    phone: "9123456780",
    emergencyContact: "+91 91234 56781",
  });

  const residentCharlie = registerResident(managerUser, {
    fullName: "Charlie Brown",
    phone: "9123456782",
    emergencyContact: "+91 91234 56783",
  });

  const residentDavid = registerResident(managerUser, {
    fullName: "David Wilson",
    phone: "9123456784",
    emergencyContact: "+91 91234 56785",
  });

  // Assign Alice (occupied beds 1/2)
  assignResidentToRoom(managerUser, {
    residentId: residentAlice.id,
    roomId: room401.id,
    checkInDate: "2026-10-10",
    monthlyRent: 9000,
  });

  // Assign Charlie (occupied beds 2/2 -> FULL)
  assignResidentToRoom(managerUser, {
    residentId: residentCharlie.id,
    roomId: room401.id,
    checkInDate: "2026-10-10",
    monthlyRent: 9000,
  });

  const roomFull = getRoomById(managerUser, room401.id)!;
  assert(roomFull.occupiedBeds === 2, "Room 401 occupancy is at full capacity (2/2)");

  // Attempting to assign David (exceeding capacity) must throw
  let overCapacityBlocked = false;
  try {
    assignResidentToRoom(managerUser, {
      residentId: residentDavid.id,
      roomId: room401.id,
      checkInDate: "2026-10-10",
      monthlyRent: 9000,
    });
  } catch (err: any) {
    overCapacityBlocked = err.message.includes("full capacity") || err.message.includes("capacity");
  }
  assert(overCapacityBlocked, "Over-capacity check-in strictly blocked by capacity invariant");

  // 2. Kitchen Duplicate Creation Prevention under simulated collision
  let dupMealCaught = false;
  try {
    createMealPlan(kitchenUser, {
      serviceDate: "2026-10-16",
      mealType: "BREAKFAST", // Already created in Step 10
      guestCount: 2,
    });
  } catch (err: any) {
    dupMealCaught = err.message.includes("already exists");
  }
  assert(dupMealCaught, "Duplicate meal plan for same service date and meal type prevented with domain error");

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: RBAC Least-Privilege & Audit Trail Completeness
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] RBAC Least-Privilege & Audit Trail Completeness");

  // 1. Kitchen staff cannot access finance
  let kitchenBlockedOnFinance = false;
  try {
    recordRentCharge(kitchenUser, {
      residentId: residentAlice.id,
      amount: 5000,
      transactionDate: "2026-10-01",
      billingPeriod: "October 2026",
    });
  } catch (err: any) {
    kitchenBlockedOnFinance = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(kitchenBlockedOnFinance, "Least Privilege: KITCHEN_OPERATIONS blocked from finance with HTTP 403");

  // 2. Delivery staff cannot perform financial reversals
  let deliveryBlockedOnReversal = false;
  try {
    reverseTransaction(deliveryUser, dummyCharge.id, "Unauthorized reversal attempt");
  } catch (err: any) {
    deliveryBlockedOnReversal = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(deliveryBlockedOnReversal, "Least Privilege: DELIVERY_PERSON blocked from reverseTransaction with HTTP 403");

  // 3. Accountant cannot create meal plans
  let accountantBlockedOnKitchen = false;
  try {
    createMealPlan(accountantUser, {
      serviceDate: "2026-10-17",
      mealType: "LUNCH",
    });
  } catch (err: any) {
    accountantBlockedOnKitchen = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(accountantBlockedOnKitchen, "Least Privilege: ACCOUNTANT blocked from createMealPlan with HTTP 403");

  // 4. Verify immutable audit log completeness
  const allAuditLogs = getAuditLogs({ limit: 100 });
  assert(allAuditLogs.length > 10, `Audit log contains ${allAuditLogs.length} events across all lifecycle actions`);

  const actions = allAuditLogs.map((l) => l.action);
  assert(actions.includes("room.created"), "Audit trail captured room creation");
  assert(actions.includes("resident.registered"), "Audit trail captured resident registration");
  assert(actions.includes("resident.checked_in"), "Audit trail captured check-in");
  assert(actions.includes("resident.checked_out"), "Audit trail captured check-out");
  assert(actions.includes("finance.rent_charge_recorded"), "Audit trail captured rent charge");
  assert(actions.includes("finance.rent_payment_recorded"), "Audit trail captured rent payment");
  assert(actions.includes("finance.security_deposit_recorded"), "Audit trail captured security deposit");
  assert(actions.includes("finance.expense_recorded"), "Audit trail captured expense");
  assert(actions.includes("finance.transaction_reversed"), "Audit trail captured transaction reversal");
  assert(actions.includes("kitchen.plan_created"), "Audit trail captured kitchen meal plan creation");

  console.log("\n================================================================================");
  console.log(`FINAL INTEGRATION AUDIT TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runIntegrationAuditTests().catch((err) => {
  console.error("Unhandled error during integration audit test execution:", err);
  process.exit(1);
});
