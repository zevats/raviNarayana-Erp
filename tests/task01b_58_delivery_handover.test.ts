import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { getDb, closeDb, getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { requirePermission, AuthorizationError } from "../apps/erp/src/server/authorization/authorize";
import {
  generateDeliveryTasks,
  assignDeliveryTask,
  dispatchDeliveryTask,
  completeDeliveryTask,
  reportDeliveryException,
  createExternalDeliveryTask,
  recordDeliveryCollection,
  createCashHandoverDeclaration,
  acceptCashHandover,
  getDriverCustodySummary,
  listDriverCashHandovers,
  syncDeliveryActions,
  getDeliveryTaskById,
} from "../apps/erp/src/server/delivery/deliveryService";
import { getCashbookSummary } from "../apps/erp/src/server/finance/financeService";
import { AuthenticatedUser, QueuedDeliveryAction } from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated test DB for Task 01B.58
const TEST_HANDOVER_DB_PATH = path.resolve(__dirname, "test_task58_handover.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_HANDOVER_DB_PATH)) fs.unlinkSync(TEST_HANDOVER_DB_PATH);
  const wal = `${TEST_HANDOVER_DB_PATH}-wal`;
  const shm = `${TEST_HANDOVER_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_HANDOVER_DB_PATH;

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
console.log("TASK 01B.58: DELIVERY COLLECTION HANDOVER, OFFLINE RESILIENCE & SYNC TEST SUITE");
console.log("================================================================================\n");

async function runTask58Tests() {
  // Test actors
  const superAdminUser: AuthenticatedUser = {
    id: "usr_admin_hnd",
    username: "admin_hnd",
    email: "admin.hnd@ravinarayan.in",
    fullName: "System Superadmin",
    role: "SUPER_ADMIN",
  };

  const managerUser: AuthenticatedUser = {
    id: "usr_manager_hnd",
    username: "manager_hnd",
    email: "manager.hnd@ravinarayan.in",
    fullName: "Operations Manager",
    role: "OPERATIONS_MANAGER",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_accountant_hnd",
    username: "accountant_hnd",
    email: "accountant.hnd@ravinarayan.in",
    fullName: "Head Cashier & Accountant",
    role: "ACCOUNTANT",
  };

  const driverRamesh: AuthenticatedUser = {
    id: "usr_ramesh_hnd",
    username: "ramesh_hnd",
    email: "ramesh.hnd@ravinarayan.in",
    fullName: "Ramesh Kumar Driver",
    role: "DELIVERY_PERSON",
  };

  const driverSuresh: AuthenticatedUser = {
    id: "usr_suresh_hnd",
    username: "suresh_hnd",
    email: "suresh.hnd@ravinarayan.in",
    fullName: "Suresh Singh Driver",
    role: "DELIVERY_PERSON",
  };

  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Migration V20 & Schema Verification
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Database Migration V20 & Schema Verification");

  const db = new Database(TEST_HANDOVER_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  const version = db.pragma("user_version", { simple: true });
  assert(Number(version) >= 20, `Database schema version advanced to at least V20 (got ${version})`);

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(
    (t) => t.name
  );
  assert(tables.includes("delivery_tasks"), "delivery_tasks table exists");
  assert(tables.includes("driver_cash_handovers"), "driver_cash_handovers table exists");

  const taskCols = (db.prepare("PRAGMA table_info(delivery_tasks)").all() as any[]).map((c: any) => c.name);
  assert(taskCols.includes("collection_status"), "delivery_tasks has collection_status column");
  assert(taskCols.includes("collected_amount"), "delivery_tasks has collected_amount column");
  assert(taskCols.includes("collected_payment_method"), "delivery_tasks has collected_payment_method column");
  assert(taskCols.includes("collection_transaction_id"), "delivery_tasks has collection_transaction_id column");
  assert(taskCols.includes("collection_idempotency_key"), "delivery_tasks has collection_idempotency_key column");
  assert(taskCols.includes("handover_id"), "delivery_tasks has handover_id column");

  const handoverCols = (db.prepare("PRAGMA table_info(driver_cash_handovers)").all() as any[]).map((c: any) => c.name);
  assert(handoverCols.includes("id"), "driver_cash_handovers has id column");
  assert(handoverCols.includes("driver_id"), "driver_cash_handovers has driver_id column");
  assert(handoverCols.includes("shift_date"), "driver_cash_handovers has shift_date column");
  assert(handoverCols.includes("declared_cash"), "driver_cash_handovers has declared_cash column");
  assert(handoverCols.includes("accepted_cash"), "driver_cash_handovers has accepted_cash column");
  assert(handoverCols.includes("variance"), "driver_cash_handovers has variance column");
  assert(handoverCols.includes("variance_reason"), "driver_cash_handovers has variance_reason column");
  assert(handoverCols.includes("status"), "driver_cash_handovers has status column");

  // Seed test staff users into isolated DB
  const now = new Date().toISOString();
  const staffInsert = db.prepare(`
    INSERT OR REPLACE INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fake_hash', ?, ?, ?, ?)
  `);
  staffInsert.run(superAdminUser.id, superAdminUser.username, superAdminUser.email, superAdminUser.fullName, superAdminUser.role, 1, now, now);
  staffInsert.run(managerUser.id, managerUser.username, managerUser.email, managerUser.fullName, managerUser.role, 1, now, now);
  staffInsert.run(accountantUser.id, accountantUser.username, accountantUser.email, accountantUser.fullName, accountantUser.role, 1, now, now);
  staffInsert.run(driverRamesh.id, driverRamesh.username, driverRamesh.email, driverRamesh.fullName, driverRamesh.role, 1, now, now);
  staffInsert.run(driverSuresh.id, driverSuresh.username, driverSuresh.email, driverSuresh.fullName, driverSuresh.role, 1, now, now);

  const asyncDb = getAsyncDb();

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Doorstep Delivery Completion & Collection Semantics
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Delivery Completion & Doorstep Collection Semantics");

  const shiftDate = "2026-10-24";

  // Create external delivery tasks for testing
  const taskOrder1 = await createExternalDeliveryTask(managerUser, {
    serviceDate: shiftDate,
    mealType: "LUNCH",
    customerName: "Rohan Verma",
    customerPhone: "+91 98111 22233",
    deliveryAddress: "Flat 402, DLF Phase 3, Gurugram",
    notes: "Ring bell twice",
  }, undefined, asyncDb);

  const taskOrder2 = await createExternalDeliveryTask(managerUser, {
    serviceDate: shiftDate,
    mealType: "LUNCH",
    customerName: "Neha Gupta",
    customerPhone: "+91 98222 33344",
    deliveryAddress: "Tower B, Sector 48, Sohna Road",
    notes: "Collect exact cash ₹350",
  }, undefined, asyncDb);

  const taskOrder3 = await createExternalDeliveryTask(managerUser, {
    serviceDate: shiftDate,
    mealType: "LUNCH",
    customerName: "Amitabh Sen",
    customerPhone: "+91 98333 44455",
    deliveryAddress: "Cyber City Building 10, DLF Phase 2",
    notes: "UPI payment at door ₹400",
  }, undefined, asyncDb);

  // Assign to Ramesh and dispatch
  await assignDeliveryTask(managerUser, taskOrder1.id, { assignedToStaffId: driverRamesh.id }, undefined, asyncDb);
  await assignDeliveryTask(managerUser, taskOrder2.id, { assignedToStaffId: driverRamesh.id }, undefined, asyncDb);
  await assignDeliveryTask(managerUser, taskOrder3.id, { assignedToStaffId: driverRamesh.id }, undefined, asyncDb);

  await dispatchDeliveryTask(driverRamesh, taskOrder1.id, undefined, asyncDb);
  await dispatchDeliveryTask(driverRamesh, taskOrder2.id, undefined, asyncDb);
  await dispatchDeliveryTask(driverRamesh, taskOrder3.id, undefined, asyncDb);

  // Scenario 1: Delivery with ₹0 collection (e.g. prepaid or complimentary)
  const completed1 = await completeDeliveryTask(driverRamesh, taskOrder1.id, {
    recipientName: "Rohan Verma",
    notes: "Handed over at door. Prepaid voucher.",
  }, undefined, asyncDb);

  assert(completed1.status === "DELIVERED", "Order 1 transitioned to DELIVERED");
  assert(completed1.collectionStatus === "NONE", "Order 1 collectionStatus is NONE");
  assert(completed1.collectedAmount === 0, "Order 1 collectedAmount is 0");

  // Scenario 2: Delivery with Cash collection of ₹350
  const completed2 = await completeDeliveryTask(driverRamesh, taskOrder2.id, {
    recipientName: "Neha Gupta",
    notes: "Collected cash at door",
    collectedAmount: 350,
    paymentMethod: "CASH",
    idempotencyKey: "test_coll_order2_cash",
  }, undefined, asyncDb);

  assert(completed2.status === "DELIVERED", "Order 2 transitioned to DELIVERED");
  assert(completed2.collectionStatus === "COLLECTED", "Order 2 collectionStatus is COLLECTED");
  assert(completed2.collectedAmount === 350, "Order 2 collectedAmount is 350");
  assert(completed2.collectedPaymentMethod === "CASH", "Order 2 paymentMethod is CASH");
  assert(completed2.collectionIdempotencyKey === "test_coll_order2_cash", "Order 2 captures collection idempotency key");

  // Scenario 3: Delivery with UPI collection of ₹400
  const completed3 = await completeDeliveryTask(driverRamesh, taskOrder3.id, {
    recipientName: "Amitabh Sen",
    notes: "Customer paid via Google Pay QR",
    collectedAmount: 400,
    paymentMethod: "UPI",
    idempotencyKey: "test_coll_order3_upi",
  }, undefined, asyncDb);

  assert(completed3.status === "DELIVERED", "Order 3 transitioned to DELIVERED");
  assert(completed3.collectionStatus === "COLLECTED", "Order 3 collectionStatus is COLLECTED");
  assert(completed3.collectedAmount === 400, "Order 3 collectedAmount is 400");
  assert(completed3.collectedPaymentMethod === "UPI", "Order 3 paymentMethod is UPI");

  // Idempotency: Repeating completion on delivered order 2
  const repeated2 = await completeDeliveryTask(driverRamesh, taskOrder2.id, {
    recipientName: "Neha Gupta",
    collectedAmount: 350,
    paymentMethod: "CASH",
  }, undefined, asyncDb);
  assert(repeated2.status === "DELIVERED", "Repeated completion on delivered task is safely idempotent");

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Standalone Collection Recording & Ownership Isolation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Standalone Collection Recording & Ownership Guards");

  const taskOrder4 = await createExternalDeliveryTask(managerUser, {
    serviceDate: shiftDate,
    mealType: "DINNER",
    customerName: "Pooja Hegde",
    customerPhone: "+91 98444 55566",
    deliveryAddress: "Sector 14, Old DLF",
  }, undefined, asyncDb);

  await assignDeliveryTask(managerUser, taskOrder4.id, { assignedToStaffId: driverRamesh.id }, undefined, asyncDb);
  await dispatchDeliveryTask(driverRamesh, taskOrder4.id, undefined, asyncDb);

  // Ownership Guard: Suresh CANNOT record collection for Ramesh's task (HTTP 403)
  let unauthorizedCollection = false;
  try {
    await recordDeliveryCollection(driverSuresh, taskOrder4.id, {
      collectedAmount: 200,
      paymentMethod: "CASH",
    }, undefined, asyncDb);
  } catch (err: any) {
    if (err instanceof AuthorizationError && err.statusCode === 403) {
      unauthorizedCollection = true;
    }
  }
  assert(unauthorizedCollection, "Ownership Guard: Driver Suresh cannot record collection for Ramesh's task (HTTP 403)");

  // Validation Guard: Negative amount rejected
  let invalidAmountRejected = false;
  try {
    await recordDeliveryCollection(driverRamesh, taskOrder4.id, {
      collectedAmount: -50,
      paymentMethod: "CASH",
    }, undefined, asyncDb);
  } catch (err: any) {
    invalidAmountRejected = true;
  }
  assert(invalidAmountRejected, "Validation Guard: Negative collection amount rejected");

  // Valid Collection Recording by assigned driver
  const collected4 = await recordDeliveryCollection(driverRamesh, taskOrder4.id, {
    collectedAmount: 250,
    paymentMethod: "CASH",
    idempotencyKey: "test_coll_order4_key",
    notes: "Cash collected upon arrival",
  }, undefined, asyncDb);

  assert(collected4.collectionStatus === "COLLECTED", "Order 4 collection status updated to COLLECTED");
  assert(collected4.collectedAmount === 250, "Order 4 collectedAmount is 250");
  assert(collected4.collectedPaymentMethod === "CASH", "Order 4 paymentMethod is CASH");

  // Idempotent collection call with same idempotency key
  const idempotentColl = await recordDeliveryCollection(driverRamesh, taskOrder4.id, {
    collectedAmount: 250,
    paymentMethod: "CASH",
    idempotencyKey: "test_coll_order4_key",
  }, undefined, asyncDb);
  assert(idempotentColl.collectedAmount === 250, "Repeated collection call with same idempotency key is safely idempotent");

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: Driver Cash Custody Live Calculation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Driver Cash Custody Live Calculation");

  // Ramesh collected:
  // Order 2: ₹350 CASH
  // Order 3: ₹400 UPI (digital, not cash)
  // Order 4: ₹250 CASH
  // Total CASH collected = 350 + 250 = ₹600.
  // UPI does not count as physical cash in custody.

  const custodyRamesh = await getDriverCustodySummary(driverRamesh, driverRamesh.id, shiftDate, asyncDb);
  assert(custodyRamesh.driverId === driverRamesh.id, "Custody summary driverId matches");
  assert(custodyRamesh.shiftDate === shiftDate, "Custody summary shiftDate matches");
  assert(custodyRamesh.totalCashCollected === 600, `Ramesh total CASH collected is exactly ₹600 (got ${custodyRamesh.totalCashCollected})`);
  assert(custodyRamesh.cashInCustody === 600, `Ramesh cash in custody awaiting handover is exactly ₹600 (got ${custodyRamesh.cashInCustody})`);
  assert(custodyRamesh.pendingCollectionTasksCount === 2, `2 tasks pending handover settlement (got ${custodyRamesh.pendingCollectionTasksCount})`);

  // Privilege Guard: Driver Suresh cannot view Ramesh's cash custody (HTTP 403)
  let unauthorizedCustodyView = false;
  try {
    await getDriverCustodySummary(driverSuresh, driverRamesh.id, shiftDate, asyncDb);
  } catch (err: any) {
    if (err instanceof AuthorizationError && err.statusCode === 403) {
      unauthorizedCustodyView = true;
    }
  }
  assert(unauthorizedCustodyView, "Privilege Guard: Driver cannot view another driver's cash custody summary (HTTP 403)");

  // Manager and Accountant CAN view Ramesh's custody summary
  const managerViewCustody = await getDriverCustodySummary(managerUser, driverRamesh.id, shiftDate, asyncDb);
  assert(managerViewCustody.cashInCustody === 600, "Manager can inspect driver cash custody");

  const accountantViewCustody = await getDriverCustodySummary(accountantUser, driverRamesh.id, shiftDate, asyncDb);
  assert(accountantViewCustody.cashInCustody === 600, "Accountant can inspect driver cash custody");

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Driver Cash Handover Declaration
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Driver Cash Handover Declaration");

  // Validation Guard: Negative cash declaration rejected
  let negativeDeclaredRejected = false;
  try {
    await createCashHandoverDeclaration(driverRamesh, {
      shiftDate,
      declaredCash: -100,
    }, undefined, asyncDb);
  } catch (err: any) {
    negativeDeclaredRejected = true;
  }
  assert(negativeDeclaredRejected, "Validation Guard: Negative declared cash rejected");

  // Driver Ramesh declares ₹600 collected
  const declaredHandover = await createCashHandoverDeclaration(driverRamesh, {
    shiftDate,
    declaredCash: 600,
    notes: "6 notes of 100 submitted",
  }, undefined, asyncDb);

  assert(declaredHandover.id.startsWith("dch_"), "Handover ID starts with dch_");
  assert(declaredHandover.driverId === driverRamesh.id, "Handover driverId matches Ramesh");
  assert(declaredHandover.declaredCash === 600, "Declared cash is ₹600");
  assert(declaredHandover.acceptedCash === 0, "Accepted cash is initial 0");
  assert(declaredHandover.variance === 0, "Initial variance is 0");
  assert(declaredHandover.status === "DECLARED", "Initial handover status is DECLARED");

  // List handovers returns Ramesh's declaration
  const handoversList = await listDriverCashHandovers(driverRamesh, { driverId: driverRamesh.id, shiftDate }, asyncDb);
  assert(handoversList.length >= 1, "Ramesh can list his own cash handovers");
  assert(handoversList.some((h) => h.id === declaredHandover.id), "Declared handover present in list");

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Management Handover Verification, Acceptance & Cashbook Posting
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Management Handover Verification & Cashbook Posting");

  // Separation of Duties Guard: Driver Ramesh CANNOT accept his own handover (HTTP 403)
  let selfAcceptRejected = false;
  try {
    await acceptCashHandover(driverRamesh, declaredHandover.id, {
      acceptedCash: 600,
    }, undefined, asyncDb);
  } catch (err: any) {
    if (err instanceof AuthorizationError && err.statusCode === 403) {
      selfAcceptRejected = true;
    }
  }
  assert(selfAcceptRejected, "Separation of Duties: Driver cannot accept their own cash handover (HTTP 403)");

  // Cashbook position before acceptance
  const cashbookBefore = await getCashbookSummary(accountantUser, { startDate: shiftDate, endDate: shiftDate, division: "COMBINED" }, asyncDb);
  const collectedBefore = cashbookBefore.totalTiffinCollected || 0;

  // Accountant verifies banknotes and accepts exact ₹600
  const acceptedHandover = await acceptCashHandover(accountantUser, declaredHandover.id, {
    acceptedCash: 600,
    notes: "Cash physically verified and placed in PG vault",
  }, undefined, asyncDb);

  assert(acceptedHandover.status === "ACCEPTED", "Handover transitioned to ACCEPTED");
  assert(acceptedHandover.acceptedCash === 600, "Accepted cash recorded as 600");
  assert(acceptedHandover.variance === 0, "Variance is 0 for exact count");
  assert(acceptedHandover.acceptedBy === accountantUser.id, "AcceptedBy stamped with Accountant ID");
  assert(acceptedHandover.transactionId !== null, "Authoritative transaction ID generated");

  // Verify delivery tasks transitioned to HANDED_OVER
  const task2After = await getDeliveryTaskById(superAdminUser, taskOrder2.id, asyncDb);
  assert(task2After?.task.collectionStatus === "HANDED_OVER", "Order 2 collection status transitioned to HANDED_OVER");
  assert(task2After?.task.handoverId === declaredHandover.id, "Order 2 linked to handover record ID");

  const task4After = await getDeliveryTaskById(superAdminUser, taskOrder4.id, asyncDb);
  assert(task4After?.task.collectionStatus === "HANDED_OVER", "Order 4 collection status transitioned to HANDED_OVER");
  assert(task4After?.task.handoverId === declaredHandover.id, "Order 4 linked to handover record ID");

  // Verify Cash Custody after acceptance: cash in custody drops to ₹0!
  const custodyAfter = await getDriverCustodySummary(driverRamesh, driverRamesh.id, shiftDate, asyncDb);
  assert(custodyAfter.cashInCustody === 0, `Ramesh cash in custody drops to ₹0 after settlement (got ${custodyAfter.cashInCustody})`);
  assert(custodyAfter.totalAcceptedHandover === 600, `Total accepted handovers updated to ₹600 (got ${custodyAfter.totalAcceptedHandover})`);
  assert(custodyAfter.pendingCollectionTasksCount === 0, "0 tasks pending settlement");

  // Cashbook position after acceptance: cashbook inflow increased by exactly ₹600
  const cashbookAfter = await getCashbookSummary(accountantUser, { startDate: shiftDate, endDate: shiftDate, division: "COMBINED" }, asyncDb);
  const collectedAfter = cashbookAfter.totalTiffinCollected || 0;
  assert(collectedAfter === collectedBefore + 600, `Authoritative Cashbook reflects ₹600 delivery collection inflow (before: ${collectedBefore}, after: ${collectedAfter})`);

  // Repeat acceptance guard: Cannot accept an already accepted handover
  let doubleAcceptRejected = false;
  try {
    await acceptCashHandover(accountantUser, declaredHandover.id, { acceptedCash: 600 }, undefined, asyncDb);
  } catch (err: any) {
    doubleAcceptRejected = true;
  }
  assert(doubleAcceptRejected, "Invariant Guard: Cannot re-accept an already settled cash handover");

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: Cash Handover Discrepancy & Variance Reconciliation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Cash Handover Discrepancy & Variance Reconciliation");

  // Suresh collects ₹500 cash on a new order
  const taskOrder5 = await createExternalDeliveryTask(managerUser, {
    serviceDate: shiftDate,
    mealType: "DINNER",
    customerName: "Kavita Rao",
    customerPhone: "+91 98555 66677",
    deliveryAddress: "Sector 56, Golf Course Extension",
  }, undefined, asyncDb);

  await assignDeliveryTask(managerUser, taskOrder5.id, { assignedToStaffId: driverSuresh.id }, undefined, asyncDb);
  await dispatchDeliveryTask(driverSuresh, taskOrder5.id, undefined, asyncDb);
  await completeDeliveryTask(driverSuresh, taskOrder5.id, {
    recipientName: "Kavita Rao",
    collectedAmount: 500,
    paymentMethod: "CASH",
  }, undefined, asyncDb);

  // Suresh declares ₹500
  const handoverSuresh = await createCashHandoverDeclaration(driverSuresh, {
    shiftDate,
    declaredCash: 500,
  }, undefined, asyncDb);

  // Cashier counts only ₹480 (₹20 shortage)
  // Without variance reason: MUST be rejected!
  let missingVarianceReasonRejected = false;
  try {
    await acceptCashHandover(accountantUser, handoverSuresh.id, {
      acceptedCash: 480,
    }, undefined, asyncDb);
  } catch (err: any) {
    missingVarianceReasonRejected = true;
  }
  assert(missingVarianceReasonRejected, "Validation Guard: Rejects variance without mandatory justification reason");

  // Shortage with justification: Accepted with variance recorded
  const acceptedSuresh = await acceptCashHandover(accountantUser, handoverSuresh.id, {
    acceptedCash: 480,
    varianceReason: "Customer gave 20 rupees coin which was worn out and rejected by bank counter; driver covered remaining next day",
  }, undefined, asyncDb);

  assert(acceptedSuresh.status === "ACCEPTED", "Handover with variance accepted");
  assert(acceptedSuresh.declaredCash === 500, "Declared was 500");
  assert(acceptedSuresh.acceptedCash === 480, "Accepted cash was 480");
  assert(acceptedSuresh.variance === -20, "Variance recorded as -20 (shortage)");
  assert(acceptedSuresh.varianceReason !== null, "Variance reason persisted");

  // -----------------------------------------------------------------------------
  // TEST SUITE 8: Offline Action Queue Synchronization & Conflict Handling
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] Offline Synchronization & Conflict Handling");

  const taskOffline1 = await createExternalDeliveryTask(managerUser, {
    serviceDate: shiftDate,
    mealType: "DINNER",
    customerName: "Offline Customer 1",
    customerPhone: "+91 98666 77788",
    deliveryAddress: "Basement Parking B2, Cyber Hub",
  }, undefined, asyncDb);

  const taskOffline2 = await createExternalDeliveryTask(managerUser, {
    serviceDate: shiftDate,
    mealType: "DINNER",
    customerName: "Offline Customer 2",
    customerPhone: "+91 98777 88899",
    deliveryAddress: "Tower C 14th Floor Elevator Deadzone",
  }, undefined, asyncDb);

  await assignDeliveryTask(managerUser, taskOffline1.id, { assignedToStaffId: driverRamesh.id }, undefined, asyncDb);
  await assignDeliveryTask(managerUser, taskOffline2.id, { assignedToStaffId: driverRamesh.id }, undefined, asyncDb);
  await dispatchDeliveryTask(driverRamesh, taskOffline1.id, undefined, asyncDb);
  await dispatchDeliveryTask(driverRamesh, taskOffline2.id, undefined, asyncDb);

  // Simulated client offline queue with 3 actions:
  // Action A: COMPLETE_DELIVERY with cash collection
  // Action B: REPORT_EXCEPTION
  // Action C: CONFLICT test (task reassigned to another driver while offline)
  const taskConflict = await createExternalDeliveryTask(managerUser, {
    serviceDate: shiftDate,
    mealType: "DINNER",
    customerName: "Reassigned Customer",
    customerPhone: "+91 98888 99900",
    deliveryAddress: "Sector 29 Market",
  }, undefined, asyncDb);
  await assignDeliveryTask(managerUser, taskConflict.id, { assignedToStaffId: driverRamesh.id }, undefined, asyncDb);
  // Manager reassigns to Suresh on server
  await assignDeliveryTask(managerUser, taskConflict.id, { assignedToStaffId: driverSuresh.id }, undefined, asyncDb);

  const queuedActions: QueuedDeliveryAction[] = [
    {
      id: "queue_act_1",
      action: "COMPLETE_DELIVERY",
      taskId: taskOffline1.id,
      payload: {
        recipientName: "Security Guard Ramu",
        notes: "Delivered during elevator outage",
        collectedAmount: 180,
        paymentMethod: "CASH",
      },
      idempotencyKey: `offline_coll_${taskOffline1.id}_180`,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      status: "PENDING",
    },
    {
      id: "queue_act_2",
      action: "REPORT_EXCEPTION",
      taskId: taskOffline2.id,
      payload: {
        exceptionType: "LOCATION_UNCLEAR",
        reason: "Customer unreachable and building security did not permit entry",
      },
      idempotencyKey: `offline_exc_${taskOffline2.id}`,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      status: "PENDING",
    },
    {
      id: "queue_act_3",
      action: "COMPLETE_DELIVERY",
      taskId: taskConflict.id,
      payload: {
        recipientName: "Prem",
        collectedAmount: 200,
      },
      idempotencyKey: `offline_conflict_${taskConflict.id}`,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      status: "PENDING",
    },
  ];

  // Driver Ramesh triggers offline sync
  const syncResponse = await syncDeliveryActions(driverRamesh, queuedActions, undefined, asyncDb);
  const results = syncResponse.results;

  assert(results.length === 3, "Batch sync returned exactly 3 results");

  const res1 = results.find((r) => r.actionId === "queue_act_1");
  assert(res1?.status === "SYNCED", "Action 1 synced successfully with server");
  assert(res1?.task?.status === "DELIVERED", "Action 1 task status is DELIVERED");
  assert(res1?.task?.collectedAmount === 180, "Action 1 collected amount recorded as 180");

  const res2 = results.find((r) => r.actionId === "queue_act_2");
  assert(res2?.status === "SYNCED", "Action 2 exception synced successfully");
  assert(res2?.task?.status === "EXCEPTION", "Action 2 task status is EXCEPTION");

  const res3 = results.find((r) => r.actionId === "queue_act_3");
  assert(res3?.status === "CONFLICT", "Action 3 flagged as CONFLICT (task reassigned to another driver)");
  assert(res3?.error !== undefined, "Conflict error message provided for driver resolution");

  // Idempotent sync replay: Repeating sync on already-synced action 1
  const syncReplay = await syncDeliveryActions(driverRamesh, [queuedActions[0]], undefined, asyncDb);
  assert(syncReplay.results[0].status === "IDEMPOTENT_IGNORED", "Replay of already completed action returns IDEMPOTENT_IGNORED without errors");

  // -----------------------------------------------------------------------------
  // TEST SUITE 9: Immutability Verification & Environment Cleanup
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 9] Primary Database Immutability & Cleanup");

  cleanupTestDb();

  if (primaryStatsBefore && fs.existsSync(primaryDbPath)) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(
      primaryStatsBefore.size === primaryStatsAfter.size,
      `Primary database size strictly untouched (${primaryStatsBefore.size} bytes)`
    );
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs,
      `Primary database modification timestamp strictly untouched (${primaryStatsBefore.mtime.toISOString()})`
    );
  } else {
    assert(true, "Primary database verification step completed");
  }

  console.log("\n================================================================================");
  console.log(`FINAL RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTask58Tests().catch((err) => {
  console.error("Test execution failed with unhandled error:", err);
  process.exit(1);
});
