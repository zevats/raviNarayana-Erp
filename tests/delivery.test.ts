import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { getDb, closeDb, getAsyncDb, AsyncDb, convertPlaceholders } from "../apps/erp/src/server/database/db";
import { hasPermission } from "../apps/erp/src/server/authorization/permissions";
import {
  requirePermission,
  AuthorizationError,
} from "../apps/erp/src/server/authorization/authorize";
import { createRoom } from "../apps/erp/src/server/rooms/roomService";
import {
  registerResident,
  assignResidentToRoom,
  checkOutResident,
} from "../apps/erp/src/server/residents/residentService";
import {
  createMealPlan,
  confirmMealPlan,
} from "../apps/erp/src/server/kitchen/kitchenService";
import {
  generateDeliveryTasks,
  assignDeliveryTask,
  dispatchDeliveryTask,
  completeDeliveryTask,
  reportDeliveryException,
  retryDeliveryTask,
  listDeliveryTasks,
  getDeliveryTaskById,
  getDeliveryDashboardSummary,
  listActiveDeliveryStaff,
  createExternalDeliveryTask,
  batchAssignDeliveryTasks,
  batchDispatchDeliveryTasks,
} from "../apps/erp/src/server/delivery/deliveryService";
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "../apps/erp/src/server/notifications/notificationService";
import { getAuditLogs } from "../apps/erp/src/server/audit/audit";
import { AuthenticatedUser } from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated delivery test database path
const TEST_DELIVERY_DB_PATH = path.resolve(__dirname, "test_delivery.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_DELIVERY_DB_PATH)) fs.unlinkSync(TEST_DELIVERY_DB_PATH);
  const wal = `${TEST_DELIVERY_DB_PATH}-wal`;
  const shm = `${TEST_DELIVERY_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_DELIVERY_DB_PATH;

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
console.log("RAVINARAYAN ERP — PHASE 6 CORE: TIFFIN DELIVERY & HANDOVER TEST SUITE");
console.log("================================================================================\n");

async function runDeliveryTests() {
  // Test actors
  const superAdminUser: AuthenticatedUser = {
    id: "usr_admin_del",
    username: "admin_del",
    email: "admin.del@ravinarayan.in",
    fullName: "Ravinarayan Administrator",
    role: "SUPER_ADMIN",
  };

  const managerUser: AuthenticatedUser = {
    id: "usr_manager_del",
    username: "manager_del",
    email: "manager.del@ravinarayan.in",
    fullName: "Operations Manager",
    role: "OPERATIONS_MANAGER",
  };

  const rameshDeliveryUser: AuthenticatedUser = {
    id: "usr_ramesh_del",
    username: "ramesh_del",
    email: "ramesh.del@ravinarayan.in",
    fullName: "Ramesh Kumar",
    role: "DELIVERY_PERSON",
  };

  const sureshDeliveryUser: AuthenticatedUser = {
    id: "usr_suresh_del",
    username: "suresh_del",
    email: "suresh.del@ravinarayan.in",
    fullName: "Suresh Singh",
    role: "DELIVERY_PERSON",
  };

  const kitchenUser: AuthenticatedUser = {
    id: "usr_chef_del",
    username: "chef_del",
    email: "chef.del@ravinarayan.in",
    fullName: "Head Chef",
    role: "KITCHEN_OPERATIONS",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_accountant_del",
    username: "accountant_del",
    email: "accountant.del@ravinarayan.in",
    fullName: "Staff Accountant",
    role: "ACCOUNTANT",
  };

  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Database Migration V5 -> V6 & Schema Invariants
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Database Migration V5 -> V6 & Schema Verification");

  const db = new Database(TEST_DELIVERY_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  const version = db.pragma("user_version", { simple: true });
  assert(Number(version) >= 6, `Database schema version advanced to at least V6 (got ${version})`);

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(
    (t) => t.name
  );
  assert(tables.includes("delivery_tasks"), "delivery_tasks table created");
  assert(tables.includes("delivery_task_events"), "delivery_task_events table created");

  // Verify delivery_tasks schema
  const delCols = (db.prepare("PRAGMA table_info(delivery_tasks)").all() as any[]).map((c: any) => c.name);
  assert(
    delCols.includes("id") &&
      delCols.includes("meal_record_id") &&
      delCols.includes("plan_id") &&
      delCols.includes("service_date") &&
      delCols.includes("meal_type") &&
      delCols.includes("resident_id") &&
      delCols.includes("resident_name") &&
      delCols.includes("room_number") &&
      delCols.includes("floor") &&
      delCols.includes("stay_id") &&
      delCols.includes("status") &&
      delCols.includes("assigned_to") &&
      delCols.includes("assigned_to_name") &&
      delCols.includes("dispatched_at") &&
      delCols.includes("delivered_at") &&
      delCols.includes("exception_type") &&
      delCols.includes("exception_reason"),
    "delivery_tasks table has all required snapshot and lifecycle columns"
  );

  // Verify indexes
  const indices = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as any[]).map(
    (i) => i.name
  );
  assert(indices.includes("idx_del_tasks_date"), "Index idx_del_tasks_date verified");
  assert(indices.includes("idx_del_tasks_status"), "Index idx_del_tasks_status verified");
  assert(indices.includes("idx_del_tasks_assigned_to"), "Index idx_del_tasks_assigned_to verified");

  // Seed staff users in test DB
  const now = new Date().toISOString();
  const insertStaff = db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fake_hash', ?, ?, ?, ?)
  `);

  insertStaff.run(superAdminUser.id, superAdminUser.username, superAdminUser.email, superAdminUser.fullName, superAdminUser.role, 1, now, now);
  insertStaff.run(managerUser.id, managerUser.username, managerUser.email, managerUser.fullName, managerUser.role, 1, now, now);
  insertStaff.run(rameshDeliveryUser.id, rameshDeliveryUser.username, rameshDeliveryUser.email, rameshDeliveryUser.fullName, rameshDeliveryUser.role, 1, now, now);
  insertStaff.run(sureshDeliveryUser.id, sureshDeliveryUser.username, sureshDeliveryUser.email, sureshDeliveryUser.fullName, sureshDeliveryUser.role, 1, now, now);
  insertStaff.run(kitchenUser.id, kitchenUser.username, kitchenUser.email, kitchenUser.fullName, kitchenUser.role, 1, now, now);
  insertStaff.run(accountantUser.id, accountantUser.username, accountantUser.email, accountantUser.fullName, accountantUser.role, 1, now, now);

  // Inactive delivery user for validation tests
  insertStaff.run("usr_inactive_del", "inactive_del", "inactive@ravinarayan.in", "Inactive Staff", "DELIVERY_PERSON", 0, now, now);

  db.close();
  assert(true, "Staff users populated including active and inactive delivery personnel");

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Operational Pre-requisite Setup (Rooms, Residents, Kitchen Plan)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Operational Pre-requisite Setup");

  const room301 = await createRoom(managerUser, {
    roomNumber: "301",
    floor: 3,
    type: "DOUBLE_SHARING",
    capacity: 2,
    baseRentMonthly: 8500,
  });

  const room302 = await createRoom(managerUser, {
    roomNumber: "302",
    floor: 3,
    type: "SINGLE",
    capacity: 1,
    baseRentMonthly: 12000,
  });

  const resAarav = await registerResident(managerUser, {
    fullName: "Aarav Sharma",
    phone: "9876543201",
    emergencyContact: "+91 98765 00001",
  });

  const resPriya = await registerResident(managerUser, {
    fullName: "Priya Patel",
    phone: "9876543202",
    emergencyContact: "+91 98765 00002",
  });

  const resRohan = await registerResident(managerUser, {
    fullName: "Rohan Verma",
    phone: "9876543203",
    emergencyContact: "+91 98765 00003",
  });

  // Check-in residents on 2026-10-16
  await assignResidentToRoom(managerUser, {
    residentId: resAarav.id,
    roomId: room301.id,
    checkInDate: "2026-10-16",
    monthlyRent: 8500,
  });

  await assignResidentToRoom(managerUser, {
    residentId: resPriya.id,
    roomId: room301.id,
    checkInDate: "2026-10-16",
    monthlyRent: 8500,
  });

  await assignResidentToRoom(managerUser, {
    residentId: resRohan.id,
    roomId: room302.id,
    checkInDate: "2026-10-16",
    monthlyRent: 12000,
  });

  // Create Breakfast meal plan with Rohan opted out
  const draftPlan = await createMealPlan(kitchenUser, {
    serviceDate: "2026-10-16",
    mealType: "BREAKFAST",
    guestCount: 2,
    residentOptOuts: [resRohan.id],
    notes: "Special South Indian breakfast",
  });

  assert(draftPlan.status === "DRAFT", "Initial meal plan created in DRAFT status");
  assert(draftPlan.plannedResidentCount === 2, "2 residents planned for breakfast (Rohan opted out)");

  // Invariant Guard 1: Attempting to generate delivery tasks for a DRAFT plan is rejected
  let draftBlocked = false;
  try {
    await generateDeliveryTasks(managerUser, {
      serviceDate: "2026-10-16",
      mealType: "BREAKFAST",
    });
  } catch (err: any) {
    draftBlocked = err.message.includes("DRAFT status");
  }
  assert(draftBlocked, "Invariant Guard: Cannot generate delivery tasks from DRAFT kitchen plan");

  // Confirm meal plan
  const confirmedPlan = await confirmMealPlan(kitchenUser, draftPlan.id);
  assert(confirmedPlan.status === "CONFIRMED", "Meal plan transitioned to CONFIRMED");

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Task Generation & Opt-Out Exclusion
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Task Generation & Opt-Out Exclusion");

  const genResult = await generateDeliveryTasks(managerUser, {
    serviceDate: "2026-10-16",
    mealType: "BREAKFAST",
  });

  assert(genResult.createdCount === 2, `Created exactly 2 delivery tasks (got ${genResult.createdCount})`);
  assert(genResult.skippedCount === 1, `Skipped 1 opted-out resident (got ${genResult.skippedCount})`);
  assert(genResult.alreadyExistedCount === 0, `0 pre-existing tasks on first run (got ${genResult.alreadyExistedCount})`);
  assert(genResult.tasks.length === 2, "Returned batch contains 2 tasks");

  // Verify task properties & snapshots
  const aaravTask = genResult.tasks.find((t) => t.residentId === resAarav.id)!;
  const priyaTask = genResult.tasks.find((t) => t.residentId === resPriya.id)!;

  assert(aaravTask !== undefined, "Task created for Aarav Sharma");
  assert(priyaTask !== undefined, "Task created for Priya Patel");
  assert(aaravTask.roomNumber === "301", "Aarav task captures room number snapshot 301");
  assert(aaravTask.floor === 3, "Aarav task captures floor snapshot 3");
  assert(aaravTask.status === "PENDING", "Initial delivery task status is PENDING");
  assert(aaravTask.assignedTo === null, "Initial delivery task is unassigned");

  // Verify Rohan has NO delivery task generated
  const allTasks = await listDeliveryTasks(managerUser, { serviceDate: "2026-10-16", mealType: "BREAKFAST" });
  const rohanTask = allTasks.find((t) => t.residentId === resRohan.id);
  assert(rohanTask === undefined, "Opted-out resident (Rohan) has NO delivery task generated");

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: Idempotent Generation & Concurrency Collision Protection
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Idempotent Generation & Re-run Protection");

  // Re-run generation with identical serviceDate & mealType
  const secondGenResult = await generateDeliveryTasks(managerUser, {
    serviceDate: "2026-10-16",
    mealType: "BREAKFAST",
  });

  assert(secondGenResult.createdCount === 0, "Second generation run created 0 new tasks");
  assert(secondGenResult.alreadyExistedCount === 2, "Second generation run detected 2 already existed tasks");
  assert(secondGenResult.skippedCount === 1, "Second generation run skipped 1 opted-out resident");

  const checkDb = getDb();
  const taskCountRow = checkDb.prepare("SELECT count(*) as count FROM delivery_tasks").get() as { count: number };
  assert(taskCountRow.count === 2, "Database contains exactly 2 delivery task records (no duplicates)");

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Active Delivery Staff Validation & Assignment Workflow
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Active Delivery Staff Validation & Assignment Workflow");

  // 1. Attempt to assign to non-existent staff
  let nonExistentStaffBlocked = false;
  try {
    await assignDeliveryTask(managerUser, aaravTask.id, { assignedToStaffId: "usr_non_existent" });
  } catch (err: any) {
    nonExistentStaffBlocked = err.message.includes("not found");
  }
  assert(nonExistentStaffBlocked, "Validation Guard: Rejects assignment to non-existent staff");

  // 2. Attempt to assign to inactive delivery staff
  let inactiveStaffBlocked = false;
  try {
    await assignDeliveryTask(managerUser, aaravTask.id, { assignedToStaffId: "usr_inactive_del" });
  } catch (err: any) {
    inactiveStaffBlocked = err.message.includes("is currently inactive");
  }
  assert(inactiveStaffBlocked, "Validation Guard: Rejects assignment to inactive delivery personnel");

  // 3. Attempt to assign to non-delivery role (e.g. Accountant)
  let nonDeliveryRoleBlocked = false;
  try {
    await assignDeliveryTask(managerUser, aaravTask.id, { assignedToStaffId: accountantUser.id });
  } catch (err: any) {
    nonDeliveryRoleBlocked = true;
  }
  // Any active staff member can take a delivery (owner decision, 2026-11-11).
  assert(!nonDeliveryRoleBlocked, "Any active staff member (here an Accountant) can be assigned a delivery");

  // 4. Legitimate assignment to Ramesh Kumar
  const assignedTask = await assignDeliveryTask(managerUser, aaravTask.id, { assignedToStaffId: rameshDeliveryUser.id });
  assert(assignedTask.status === "ASSIGNED", "Task transitioned to ASSIGNED status");
  assert(assignedTask.assignedTo === rameshDeliveryUser.id, "Task assigned to Ramesh Kumar");
  assert(assignedTask.assignedToName === "Ramesh Kumar", "Task denormalized assigned staff name");
  assert(assignedTask.assignedBy === managerUser.id, "Task stamped with assigner ID");
  assert(assignedTask.assignedAt !== null, "Task stamped with assignment timestamp");

  // 5. Reassign Task to Suresh Singh
  const reassignedTask = await assignDeliveryTask(managerUser, aaravTask.id, { assignedToStaffId: sureshDeliveryUser.id });
  assert(reassignedTask.assignedTo === sureshDeliveryUser.id, "Task successfully reassigned to Suresh Singh");

  const taskDetails = (await getDeliveryTaskById(managerUser, aaravTask.id))!;
  const eventTypes = taskDetails.events.map((e) => e.eventType);
  assert(eventTypes.includes("CREATED"), "Event timeline includes CREATED");
  assert(eventTypes.includes("ASSIGNED"), "Event timeline includes initial ASSIGNED");
  assert(eventTypes.includes("REASSIGNED"), "Event timeline includes REASSIGNED");

  // Assign Priya's task to Ramesh Kumar
  await assignDeliveryTask(managerUser, priyaTask.id, { assignedToStaffId: rameshDeliveryUser.id });

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Strict Delivery Staff Ownership Isolation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Strict Delivery Staff Ownership Isolation");

  // Ramesh's task: Priya's task (priyaTask.id)
  // Suresh's task: Aarav's task (aaravTask.id)

  // 1. Ramesh tries to dispatch Suresh's task -> 403 Forbidden
  let rameshDispatchBlocked = false;
  try {
    await dispatchDeliveryTask(rameshDeliveryUser, aaravTask.id);
  } catch (err: any) {
    rameshDispatchBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(rameshDispatchBlocked, "Ownership Guard: Ramesh CANNOT dispatch Suresh's assigned task (HTTP 403)");

  // 2. Ramesh tries to complete Suresh's task -> 403 Forbidden
  let rameshCompleteBlocked = false;
  try {
    await completeDeliveryTask(rameshDeliveryUser, aaravTask.id, { recipientName: "Intruder" });
  } catch (err: any) {
    rameshCompleteBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(rameshCompleteBlocked, "Ownership Guard: Ramesh CANNOT complete Suresh's assigned task (HTTP 403)");

  // 3. Ramesh tries to report exception on Suresh's task -> 403 Forbidden
  let rameshExceptionBlocked = false;
  try {
    await reportDeliveryException(rameshDeliveryUser, aaravTask.id, {
      exceptionType: "RESIDENT_UNAVAILABLE",
      reason: "Attempt by wrong staff",
    });
  } catch (err: any) {
    rameshExceptionBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(rameshExceptionBlocked, "Ownership Guard: Ramesh CANNOT report exception on Suresh's task (HTTP 403)");

  // 4. Ramesh tries to view Suresh's task detail -> 403 Forbidden
  let rameshDetailBlocked = false;
  try {
    await getDeliveryTaskById(rameshDeliveryUser, aaravTask.id);
  } catch (err: any) {
    rameshDetailBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(rameshDetailBlocked, "Ownership Guard: Ramesh CANNOT inspect Suresh's task detail (HTTP 403)");

  // 5. Query Isolation: Ramesh listDeliveryTasks only returns his own assigned task
  const rameshTasks = await listDeliveryTasks(rameshDeliveryUser, { serviceDate: "2026-10-16" });
  assert(rameshTasks.length === 1, "Ramesh task list returns exactly 1 task");
  assert(rameshTasks[0].id === priyaTask.id, "Ramesh only sees Priya's task");

  // Suresh listDeliveryTasks only returns his own assigned task
  const sureshTasks = await listDeliveryTasks(sureshDeliveryUser, { serviceDate: "2026-10-16" });
  assert(sureshTasks.length === 1, "Suresh task list returns exactly 1 task");
  assert(sureshTasks[0].id === aaravTask.id, "Suresh only sees Aarav's task");

  // Manager sees all tasks
  const managerTasks = await listDeliveryTasks(managerUser, { serviceDate: "2026-10-16" });
  assert(managerTasks.length === 2, "Operations Manager sees all 2 tasks across all staff");

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: Valid State Transitions & Delivery Proof
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Valid State Transitions & Delivery Proof");

  // 1. Suresh dispatches Aarav's task (Room 301)
  const dispatchedTask = await dispatchDeliveryTask(sureshDeliveryUser, aaravTask.id);
  assert(dispatchedTask.status === "OUT_FOR_DELIVERY", "Task transitioned to OUT_FOR_DELIVERY");
  assert(dispatchedTask.dispatchedBy === sureshDeliveryUser.id, "Stamped with dispatcher ID");
  assert(dispatchedTask.dispatchedAt !== null, "Stamped with dispatch timestamp");

  // Dispatch is idempotent
  const dupDispatch = await dispatchDeliveryTask(sureshDeliveryUser, aaravTask.id);
  assert(dupDispatch.status === "OUT_FOR_DELIVERY", "Repeated dispatch is safely idempotent");

  // 2. Suresh completes delivery with handover verification
  const deliveredTask = await completeDeliveryTask(sureshDeliveryUser, aaravTask.id, {
    recipientName: "Aarav Sharma",
    notes: "Handed over at Room 301 doorstep",
  });

  assert(deliveredTask.status === "DELIVERED", "Task transitioned to DELIVERED");
  assert(deliveredTask.deliveredBy === sureshDeliveryUser.id, "Stamped with deliverer staff ID");
  assert(deliveredTask.deliveredAt !== null, "Stamped with delivery timestamp");
  assert(deliveredTask.recipientName === "Aarav Sharma", "Recorded recipient name");
  assert(deliveredTask.deliveryNotes === "Handed over at Room 301 doorstep", "Recorded delivery notes");

  // Completed delivery is idempotent
  const dupDeliver = await completeDeliveryTask(sureshDeliveryUser, aaravTask.id);
  assert(dupDeliver.status === "DELIVERED", "Repeated completion is safely idempotent");

  // -----------------------------------------------------------------------------
  // TEST SUITE 8: State Invariant Guards
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] State Invariant Guards");

  // 1. Delivered task cannot be marked as exception
  let deliveredToExceptionBlocked = false;
  try {
    await reportDeliveryException(managerUser, aaravTask.id, {
      exceptionType: "MEAL_DAMAGED_OR_MISSING",
      reason: "Attempt to mark delivered meal as exception",
    });
  } catch (err: any) {
    deliveredToExceptionBlocked = err.message.includes("Delivered tasks cannot be marked as exceptions");
  }
  assert(deliveredToExceptionBlocked, "Invariant Guard: Delivered task cannot be altered to EXCEPTION");

  // 2. Delivered task cannot be reassigned
  let deliveredReassignBlocked = false;
  try {
    await assignDeliveryTask(managerUser, aaravTask.id, { assignedToStaffId: rameshDeliveryUser.id });
  } catch (err: any) {
    deliveredReassignBlocked = err.message.includes("Delivered tasks cannot be reassigned");
  }
  assert(deliveredReassignBlocked, "Invariant Guard: Delivered task cannot be reassigned");

  // -----------------------------------------------------------------------------
  // TEST SUITE 9: Controlled Exception Workflow & Authorized Retries
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 9] Controlled Exception Workflow & Authorized Retries");

  // Ramesh dispatches Priya's task
  await dispatchDeliveryTask(rameshDeliveryUser, priyaTask.id);

  // Validation: Exception reason must be at least 5 characters
  let shortReasonBlocked = false;
  try {
    await reportDeliveryException(rameshDeliveryUser, priyaTask.id, {
      exceptionType: "RESIDENT_UNAVAILABLE",
      reason: "No",
    });
  } catch (err: any) {
    shortReasonBlocked = err.message.includes("at least 5 characters");
  }
  assert(shortReasonBlocked, "Validation Guard: Rejects exception reason with fewer than 5 characters");

  // Ramesh reports exception: Resident Unavailable
  const exceptionTask = await reportDeliveryException(rameshDeliveryUser, priyaTask.id, {
    exceptionType: "RESIDENT_UNAVAILABLE",
    reason: "Resident not in room, room locked, phone went to voicemail",
  });

  assert(exceptionTask.status === "EXCEPTION", "Task transitioned to EXCEPTION");
  assert(exceptionTask.exceptionType === "RESIDENT_UNAVAILABLE", "Exception type recorded");
  assert(exceptionTask.exceptionReason.includes("room locked"), "Exception reason recorded");
  assert(exceptionTask.exceptionBy === rameshDeliveryUser.id, "Stamped with reporting actor ID");
  assert(exceptionTask.exceptionAt !== null, "Stamped with exception timestamp");

  // Exception task is NOT deleted
  const taskInDb = checkDb.prepare("SELECT * FROM delivery_tasks WHERE id = ?").get(priyaTask.id) as any;
  assert(taskInDb !== undefined, "Exception task record preserved in database");

  // Non-manager cannot retry tasks (delivery persons lack delivery.manage)
  let deliveryStaffRetryBlocked = false;
  try {
    await retryDeliveryTask(rameshDeliveryUser, priyaTask.id, { notes: "Unauthorized retry" });
  } catch (err: any) {
    deliveryStaffRetryBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(deliveryStaffRetryBlocked, "Privilege Guard: DELIVERY_PERSON cannot call retryDeliveryTask (HTTP 403)");

  // Operations Manager retries task and reassigns to Suresh
  const retriedTask = await retryDeliveryTask(managerUser, priyaTask.id, {
    reassignToStaffId: sureshDeliveryUser.id,
    notes: "Resident called front desk, reattempting delivery with Suresh",
  });

  assert(retriedTask.status === "ASSIGNED", "Retried task reset to ASSIGNED status");
  assert(retriedTask.assignedTo === sureshDeliveryUser.id, "Retried task reassigned to Suresh");
  assert(retriedTask.exceptionType === null, "Exception type cleared on retry");
  assert(retriedTask.exceptionReason === null, "Exception reason cleared on retry");

  // Suresh delivers the retried task
  await dispatchDeliveryTask(sureshDeliveryUser, priyaTask.id);
  const finallyDelivered = await completeDeliveryTask(sureshDeliveryUser, priyaTask.id, {
    recipientName: "Priya Patel",
    notes: "Successfully handed over on redelivery attempt",
  });
  assert(finallyDelivered.status === "DELIVERED", "Retried task successfully delivered");

  // -----------------------------------------------------------------------------
  // TEST SUITE 10: Resident Checkout Preservation
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 10] Resident Checkout Preservation");

  // Check out Aarav Sharma
  await checkOutResident(managerUser, {
    residentId: resAarav.id,
    checkOutDate: "2026-10-18",
  });

  // Verify historical delivery task is PRESERVED intact
  const pastAaravTask = await getDeliveryTaskById(managerUser, aaravTask.id);
  assert(pastAaravTask !== null, "Aarav's historical delivery task preserved after checkout");
  assert(pastAaravTask!.task.roomNumber === "301", "Preserves historical room number 301");
  assert(pastAaravTask!.task.status === "DELIVERED", "Preserves historical status DELIVERED");
  assert(pastAaravTask!.events.length >= 3, "Preserves all historical audit events");

  // -----------------------------------------------------------------------------
  // TEST SUITE 11: Finance Ledger Non-Interference
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 11] Finance Ledger Non-Interference");

  const finTxCount = checkDb.prepare("SELECT count(*) as count FROM financial_transactions").get() as { count: number };
  assert(finTxCount.count === 0, "Delivery operations produced ZERO financial transactions (ledger non-interference verified)");

  // -----------------------------------------------------------------------------
  // TEST SUITE 12: Delivery Dashboard & Summary Metrics
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 12] Delivery Dashboard & Summary Metrics");

  const summary = await getDeliveryDashboardSummary(managerUser, "2026-10-16", "BREAKFAST");
  assert(summary.totalTasks === 2, "Summary shows 2 total tasks for Breakfast");
  assert(summary.deliveredCount === 2, "Summary shows 2 delivered tasks");
  assert(summary.pendingCount === 0, "Summary shows 0 pending tasks");
  assert(summary.exceptionCount === 0, "Summary shows 0 active exceptions after retry");

  // Suresh workload check
  const sureshWorkload = summary.staffWorkload.find((s) => s.staffId === sureshDeliveryUser.id);
  assert(sureshWorkload !== undefined, "Staff workload includes Suresh");
  assert(sureshWorkload!.deliveredCount === 2, "Suresh workload accurately shows 2 deliveries");

  // List active delivery staff
  const staffList = await listActiveDeliveryStaff(managerUser);
  assert(staffList.length === 2, "Active delivery staff list contains 2 active personnel");
  assert(!staffList.some((s) => s.id === "usr_inactive_del"), "Inactive staff excluded from active staff list");

  // -----------------------------------------------------------------------------
  // TEST SUITE 13: Server-Side RBAC Enforcement on Delivery Services
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 13] Server-Side RBAC Enforcement on Delivery Services");

  // 1. Unauthenticated caller throws 401
  let unauthCaught = false;
  try {
    await listDeliveryTasks(null as any);
  } catch (err: any) {
    unauthCaught = err instanceof AuthorizationError && err.statusCode === 401;
  }
  assert(unauthCaught, "Unauthenticated listDeliveryTasks throws HTTP 401 AuthorizationError");

  // 2. Role permission checks
  assert(hasPermission(superAdminUser.role, "delivery.manage"), "SUPER_ADMIN has delivery.manage");
  assert(hasPermission(superAdminUser.role, "delivery.read"), "SUPER_ADMIN has delivery.read");
  assert(hasPermission(superAdminUser.role, "delivery.update"), "SUPER_ADMIN has delivery.update");

  assert(hasPermission(managerUser.role, "delivery.manage"), "OPERATIONS_MANAGER has delivery.manage");
  assert(hasPermission(managerUser.role, "delivery.read"), "OPERATIONS_MANAGER has delivery.read");
  assert(hasPermission(managerUser.role, "delivery.update"), "OPERATIONS_MANAGER has delivery.update");

  assert(hasPermission(rameshDeliveryUser.role, "delivery.read"), "DELIVERY_PERSON has delivery.read");
  assert(hasPermission(rameshDeliveryUser.role, "delivery.update"), "DELIVERY_PERSON has delivery.update");
  assert(!hasPermission(rameshDeliveryUser.role, "delivery.manage"), "Least Privilege: DELIVERY_PERSON lacks delivery.manage");

  assert(!hasPermission(accountantUser.role, "delivery.read"), "Least Privilege: ACCOUNTANT lacks delivery.read");
  assert(!hasPermission(accountantUser.role, "delivery.manage"), "Least Privilege: ACCOUNTANT lacks delivery.manage");
  assert(!hasPermission(kitchenUser.role, "delivery.read"), "Least Privilege: KITCHEN_OPERATIONS lacks delivery.read");
  assert(!hasPermission(kitchenUser.role, "delivery.manage"), "Least Privilege: KITCHEN_OPERATIONS lacks delivery.manage");

  // 3. ACCOUNTANT blocked with HTTP 403
  let accountantBlocked = false;
  try {
    await listDeliveryTasks(accountantUser);
  } catch (err: any) {
    accountantBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(accountantBlocked, "Privilege Guard: ACCOUNTANT blocked from listDeliveryTasks with HTTP 403");

  // 4. KITCHEN_OPERATIONS blocked from generating delivery tasks with HTTP 403
  let kitchenBlocked = false;
  try {
    await generateDeliveryTasks(kitchenUser, { serviceDate: "2026-10-16", mealType: "BREAKFAST" });
  } catch (err: any) {
    kitchenBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(kitchenBlocked, "Privilege Guard: KITCHEN_OPERATIONS blocked from generateDeliveryTasks with HTTP 403");

  // -----------------------------------------------------------------------------
  // TEST SUITE 14: Immutable Audit Trail Completeness & Sanitization
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 14] Immutable Audit Trail Completeness & Sanitization");

  const allAuditLogs = getAuditLogs({ limit: 100 });
  const actions = allAuditLogs.map((l) => l.action);

  assert(actions.includes("delivery.tasks_generated"), "Audit trail captured delivery.tasks_generated");
  assert(actions.includes("delivery.task_assigned"), "Audit trail captured delivery.task_assigned");
  assert(actions.includes("delivery.task_reassigned"), "Audit trail captured delivery.task_reassigned");
  assert(actions.includes("delivery.task_dispatched"), "Audit trail captured delivery.task_dispatched");
  assert(actions.includes("delivery.task_delivered"), "Audit trail captured delivery.task_delivered");
  assert(actions.includes("delivery.task_exception"), "Audit trail captured delivery.task_exception");
  assert(actions.includes("delivery.task_retried"), "Audit trail captured delivery.task_retried");

  // Verify secret sanitization: no passwords or tokens in metadata
  let secretsFound = false;
  for (const log of allAuditLogs) {
    if (log.metadata) {
      const lower = log.metadata.toLowerCase();
      if (lower.includes("password") || lower.includes("token_hash") || lower.includes("sessiontoken")) {
        secretsFound = true;
        break;
      }
    }
  }
  assert(!secretsFound, "All delivery audit event metadata verified free of secrets and tokens");

  // -----------------------------------------------------------------------------
  // TEST SUITE 15: Citywide External Customer Orders Workflow
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 15] Citywide External Customer Orders Workflow");

  // 1. Least privilege: DELIVERY_PERSON cannot create external orders
  let deliveryPersonBlocked = false;
  try {
    await createExternalDeliveryTask(sureshDeliveryUser, {
      serviceDate: "2026-10-15",
      mealType: "LUNCH",
      customerName: "Rakesh Verma",
      customerPhone: "+91 98111 22334",
      deliveryAddress: "Shop 12, Main Bazaar, Jhajjar",
    });
  } catch (err: any) {
    deliveryPersonBlocked = (err instanceof AuthorizationError || err.statusCode === 403 || err.name === "AuthorizationError");
  }
  assert(deliveryPersonBlocked, "Privilege Guard: DELIVERY_PERSON cannot create external city orders (HTTP 403)");

  // 2. Manager creates external city order
  const extTask = await createExternalDeliveryTask(managerUser, {
    serviceDate: "2026-10-15",
    mealType: "LUNCH",
    customerName: "Vikas Yadav",
    customerPhone: "+91 98120 44556",
    deliveryAddress: "Plot 42, Sector 5, Met City, Jhajjar",
    notes: "Call upon arrival at security gate",
  });

  assert(extTask.orderType === "EXTERNAL", "External order explicitly tagged orderType === 'EXTERNAL'");
  assert(extTask.customerName === "Vikas Yadav", "External order accurately captures customer name");
  assert(extTask.customerPhone === "+91 98120 44556", "External order accurately captures customer phone");
  assert(extTask.deliveryAddress === "Plot 42, Sector 5, Met City, Jhajjar", "External order captures city delivery address");
  assert(extTask.residentId === null, "External order does NOT require resident ID (null)");
  assert(extTask.roomNumber === null, "External order does NOT require room number (null)");
  assert(extTask.floor === null, "External order does NOT require floor number (null)");
  assert(extTask.status === "PENDING", "Initial external task status is PENDING");

  // 3. Assign external order to Suresh
  const assignedExt = await assignDeliveryTask(managerUser, extTask.id, { assignedToStaffId: sureshDeliveryUser.id });
  assert(assignedExt.status === "ASSIGNED", "External task transitioned to ASSIGNED");
  assert(assignedExt.assignedTo === sureshDeliveryUser.id, "External task assigned to Suresh");

  // 4. Dispatch external order
  const dispatchedExt = await dispatchDeliveryTask(sureshDeliveryUser, extTask.id);
  assert(dispatchedExt.status === "OUT_FOR_DELIVERY", "External task dispatched to OUT_FOR_DELIVERY");

  // 5. Complete external order with proof of delivery
  const deliveredExt = await completeDeliveryTask(sureshDeliveryUser, extTask.id, {
    recipientName: "Vikas Yadav",
    notes: "Handed over at reception",
  });
  assert(deliveredExt.status === "DELIVERED", "External task successfully transitioned to DELIVERED");
  assert(deliveredExt.recipientName === "Vikas Yadav", "External task handover recipient recorded");

  // 6. Filter by orderType
  const allExternal = await listDeliveryTasks(managerUser, { serviceDate: "2026-10-15", orderType: "EXTERNAL" });
  assert(allExternal.length >= 1, "listDeliveryTasks with orderType === 'EXTERNAL' returns external tasks");
  assert(allExternal.every((t) => t.orderType === "EXTERNAL"), "All returned tasks in EXTERNAL filter have orderType === 'EXTERNAL'");

  const allResident = await listDeliveryTasks(managerUser, { serviceDate: "2026-10-15", orderType: "RESIDENT" });
  assert(allResident.every((t) => t.orderType === "RESIDENT"), "All returned tasks in RESIDENT filter have orderType === 'RESIDENT'");

  // -----------------------------------------------------------------------------
  // TEST SUITE 16: Operational Notifications & Read State Tracking
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 16] Operational Notifications & Read State Tracking");

  const notifSummary = await getNotifications(managerUser, { limit: 10 });
  assert(Array.isArray(notifSummary.notifications), "getNotifications returns notifications array");
  assert(typeof notifSummary.unreadCount === "number", "getNotifications returns numeric unreadCount");

  if (notifSummary.notifications.length > 0) {
    const firstNotif = notifSummary.notifications[0];
    assert(typeof firstNotif.id === "string", "Notification has unique id");
    assert(typeof firstNotif.title === "string", "Notification has title");
    assert(typeof firstNotif.description === "string", "Notification has description");
    assert(typeof firstNotif.domain === "string", "Notification has domain");
    assert(typeof firstNotif.type === "string", "Notification has type");
    assert(typeof firstNotif.isRead === "boolean", "Notification has isRead boolean flag");

    // Test marking single notification as read
    const initialUnread = notifSummary.unreadCount;
    await markNotificationAsRead(managerUser, firstNotif.id);
    const afterSingleRead = await getNotifications(managerUser, { limit: 10 });
    assert(afterSingleRead.unreadCount <= initialUnread, "Unread count decrements after marking notification as read");

    // Test mark all as read
    await markAllNotificationsAsRead(managerUser);
    const afterAllRead = await getNotifications(managerUser, { limit: 10 });
    assert(afterAllRead.unreadCount === 0, "markAllNotificationsAsRead marks all user notifications as read (unreadCount === 0)");
  }

  // -----------------------------------------------------------------------------
  // TEST SUITE 17: Delivery Service Async Transaction Rollback Integrity
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 17] Delivery Service Async Transaction Rollback Integrity");

  const asyncDb = getAsyncDb();
  let rollbackThrew = false;
  try {
    await asyncDb.transaction(async (tx) => {
      await createExternalDeliveryTask(managerUser, {
        serviceDate: "2026-10-16",
        mealType: "DINNER",
        customerName: "Rollback Test User",
        customerPhone: "+91 99999 88888",
        deliveryAddress: "Test Address For Rollback",
      }, undefined, tx);
      throw new Error("Simulated mid-operation transaction failure");
    });
  } catch (err: any) {
    rollbackThrew = err.message === "Simulated mid-operation transaction failure";
  }
  assert(rollbackThrew, "Transaction propagates error to caller");

  // Verify task was NOT inserted into database
  const rollbackTasks = await listDeliveryTasks(managerUser, { serviceDate: "2026-10-16", orderType: "EXTERNAL" });
  assert(!rollbackTasks.some((t) => t.customerName === "Rollback Test User"), "Transaction rollback ensured external task was not persisted");

  // Verify audit event was NOT committed to database
  const allAuditLogsAfterRollback = getAuditLogs({ limit: 100 });
  assert(!allAuditLogsAfterRollback.some((l) => l.metadata && l.metadata.includes("Rollback Test User")), "Transaction rollback atomically prevented audit log commitment");

  // -----------------------------------------------------------------------------
  // TEST SUITE 18: Mock PostgreSQL Execution & BigInt / Parameter Compatibility
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 18] Mock PostgreSQL Execution & BigInt / Parameter Compatibility");

  // 1. Placeholder conversion ($1, $2, ...)
  const sampleQuery = "SELECT * FROM delivery_tasks WHERE service_date = ? AND meal_type = ? AND status = ?";
  const converted = convertPlaceholders(sampleQuery);
  assert(converted === "SELECT * FROM delivery_tasks WHERE service_date = $1 AND meal_type = $2 AND status = $3", "convertPlaceholders converts SQLite ? to Postgres $n parameter format");

  // 2. Postgres mock with string-based bigint counts and boolean staff flags
  const mockPgDb: AsyncDb = {
    isPostgres: true,
    async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
      if (sql.includes("FROM staff_users") && sql.includes("COUNT(t.id)")) {
        return [
          {
            staffId: "usr_pg_1",
            staffName: "Postgres Delivery Staff",
            assignedCount: "12", // String bigint returned by PostgreSQL driver
            deliveredCount: "8",
            pendingCount: "3",
            exceptionCount: "1",
          }
        ] as unknown as T[];
      }
      if (sql.includes("FROM staff_users") && sql.includes("WHERE role = 'DELIVERY_PERSON'")) {
        return [
          {
            id: "usr_pg_1",
            fullName: "Postgres Delivery Staff",
            username: "pg_staff",
          }
        ] as unknown as T[];
      }
      return [];
    },
    async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
      if (sql.includes("FROM delivery_tasks")) {
        return {
          totalTasks: "25", // String bigint returned by PostgreSQL driver
          pendingCount: "5",
          assignedCount: "5",
          outForDeliveryCount: "5",
          deliveredCount: "8",
          exceptionCount: "2",
          unassignedCount: "0",
        } as unknown as T;
      }
      return null;
    },
    async execute() { return { changes: 1 }; },
    async transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T> { return cb(mockPgDb); },
  };

  const pgSummary = await getDeliveryDashboardSummary(managerUser, "2026-10-16", "ALL", mockPgDb);
  assert(typeof pgSummary.totalTasks === "number" && pgSummary.totalTasks === 25, "PostgreSQL string bigint '25' normalized to numeric totalTasks 25");
  assert(typeof pgSummary.deliveredCount === "number" && pgSummary.deliveredCount === 8, "PostgreSQL string bigint '8' normalized to numeric deliveredCount 8");
  assert(typeof pgSummary.staffWorkload[0].assignedCount === "number" && pgSummary.staffWorkload[0].assignedCount === 12, "PostgreSQL workload string bigint '12' normalized to numeric assignedCount 12");

  const pgStaff = await listActiveDeliveryStaff(managerUser, mockPgDb);
  assert(pgStaff.length === 1 && pgStaff[0].username === "pg_staff", "listActiveDeliveryStaff executes successfully on PostgreSQL AsyncDb adapter");

  // -----------------------------------------------------------------------------
  // TEST SUITE 19: Batch Assignment & Driver Run Assembly
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 19] Batch Assignment & Driver Run Assembly");

  // Create a batch of new delivery tasks for testing batch assignment
  const extTask1 = await createExternalDeliveryTask(managerUser, {
    serviceDate: "2026-10-22",
    mealType: "LUNCH",
    customerName: "Batch Customer Alpha",
    customerPhone: "+91 99999 11111",
    deliveryAddress: "Tower A, Tech Park, Sector 48",
  });

  const extTask2 = await createExternalDeliveryTask(managerUser, {
    serviceDate: "2026-10-22",
    mealType: "LUNCH",
    customerName: "Batch Customer Beta",
    customerPhone: "+91 99999 22222",
    deliveryAddress: "Tower B, Tech Park, Sector 48",
  });

  // 1. Rejects empty task IDs
  try {
    await batchAssignDeliveryTasks(managerUser, {
      taskIds: [],
      assignedToStaffId: rameshDeliveryUser.id,
    });
    assert(false, "batchAssignDeliveryTasks rejected empty taskIds");
  } catch (err: any) {
    assert(err.message.includes("At least one valid delivery task ID"), "Empty taskIds rejected with clear error message");
  }

  // 2. Rejects invalid staff ID
  try {
    await batchAssignDeliveryTasks(managerUser, {
      taskIds: [extTask1.id, extTask2.id],
      assignedToStaffId: "non_existent_staff",
    });
    assert(false, "batchAssignDeliveryTasks rejected non-existent staff member");
  } catch (err: any) {
    assert(err.message.includes("not found"), "Non-existent staff rejected with clear error");
  }

  // 3. Rejects non-delivery role staff member
  try {
    await batchAssignDeliveryTasks(managerUser, {
      taskIds: [extTask1.id, extTask2.id],
      assignedToStaffId: kitchenUser.id,
    });
    // Any active staff member can take deliveries (owner decision, 2026-11-11).
    assert(true, "batchAssignDeliveryTasks accepts any active staff member");
  } catch (err: any) {
    assert(false, `Any active staff member can take deliveries (${err.message})`);
  }

  // 4. Successfully batch assigns multiple tasks to Ramesh
  const batchAssignResult = await batchAssignDeliveryTasks(managerUser, {
    taskIds: [extTask1.id, extTask2.id],
    assignedToStaffId: rameshDeliveryUser.id,
  });
  assert(batchAssignResult.assignedCount === 2, "batchAssignDeliveryTasks assigned exactly 2 tasks");
  assert(batchAssignResult.assignedStaffId === rameshDeliveryUser.id, "Assigned staff ID matches Ramesh");
  assert(batchAssignResult.tasks.every((t) => t.status === "ASSIGNED" && t.assignedTo === rameshDeliveryUser.id), "All tasks transitioned to ASSIGNED with Ramesh allocated");

  // 5. Batch reassignment from Ramesh to Suresh
  const batchReassignResult = await batchAssignDeliveryTasks(managerUser, {
    taskIds: [extTask1.id, extTask2.id],
    assignedToStaffId: sureshDeliveryUser.id,
  });
  assert(batchReassignResult.assignedCount === 2, "batchAssignDeliveryTasks reassigned 2 tasks to Suresh");
  assert(batchReassignResult.tasks.every((t) => t.assignedTo === sureshDeliveryUser.id), "All tasks successfully updated to Suresh");

  // 6. Verify audit event was logged for batch assignment
  const batchAudit = (getDb().prepare(`
    SELECT * FROM audit_logs WHERE action = 'delivery.tasks_batch_assigned' ORDER BY created_at DESC LIMIT 1
  `).get()) as any;
  assert(!!batchAudit, "Audit event 'delivery.tasks_batch_assigned' recorded");
  assert(batchAudit.target_type === "delivery_task_batch", "Audit log target_type is 'delivery_task_batch'");

  // -----------------------------------------------------------------------------
  // TEST SUITE 20: Batch Dispatch & Out-for-Delivery Invariants
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 20] Batch Dispatch & Out-for-Delivery Invariants");

  // 1. Delivery person cannot dispatch tasks assigned to someone else
  try {
    await batchDispatchDeliveryTasks(rameshDeliveryUser, {
      taskIds: [extTask1.id, extTask2.id],
    });
    assert(false, "Ramesh should not be able to dispatch Suresh's assigned tasks");
  } catch (err: any) {
    assert(err instanceof AuthorizationError, "403 AuthorizationError thrown when driver attempts to dispatch another driver's tasks");
  }

  // 2. Assigned delivery person can dispatch their own run
  const dispatchResult = await batchDispatchDeliveryTasks(sureshDeliveryUser, {
    taskIds: [extTask1.id, extTask2.id],
  });
  assert(dispatchResult.dispatchedCount === 2, "Suresh successfully batch dispatched 2 assigned tasks");
  assert(dispatchResult.tasks.every((t) => t.status === "OUT_FOR_DELIVERY"), "All tasks transitioned to OUT_FOR_DELIVERY");

  // 3. Idempotent dispatch: calling again does not fail or duplicate side effects
  const idempotentDispatch = await batchDispatchDeliveryTasks(sureshDeliveryUser, {
    taskIds: [extTask1.id, extTask2.id],
  });
  assert(idempotentDispatch.dispatchedCount === 0, "Idempotent batch dispatch returns 0 newly dispatched tasks");

  // 4. Audit log recorded for batch dispatch
  const dispatchAudit = (getDb().prepare(`
    SELECT * FROM audit_logs WHERE action = 'delivery.tasks_batch_dispatched' ORDER BY created_at DESC LIMIT 1
  `).get()) as any;
  assert(!!dispatchAudit, "Audit event 'delivery.tasks_batch_dispatched' recorded");

  // -----------------------------------------------------------------------------
  // TEST SUITE 21: Commercial Billing Invariant Protection (Billed Delivery Immutability)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 21] Commercial Billing Invariant Protection (Billed Delivery Immutability)");

  // Complete extTask1
  await completeDeliveryTask(sureshDeliveryUser, extTask1.id, {
    recipientName: "Vikas Reception",
    notes: "Left at building entrance",
  });

  // Insert mock invoice record to satisfy foreign key constraint
  const invoiceNow = new Date().toISOString();
  getDb().prepare(`
    INSERT OR IGNORE INTO invoices (
      id, invoice_number, invoice_type, invoice_category, status,
      issue_date, due_date, billing_period, company_name, company_address,
      recipient_name, recipient_phone, created_by, created_at, updated_at
    ) VALUES (
      'inv_test_commercial_456', 'INV-2026-TEST', 'REGULAR_BILL', 'TIFFIN', 'ISSUED',
      '2026-10-22', '2026-10-22', '2026-10', 'Ravi Narayana', 'Jhajjar',
      'Batch Customer Alpha', '+91 99999 11111', ?, ?, ?
    )
  `).run(superAdminUser.id, invoiceNow, invoiceNow);

  // Simulate invoice issuance linking extTask1 to an official invoice
  getDb().prepare(`
    UPDATE delivery_tasks
    SET invoice_id = 'inv_test_commercial_456',
        billed_at = '2026-10-22T12:00:00.000Z'
    WHERE id = ?
  `).run(extTask1.id);

  // 1. Billed task mapped correctly with invoice fields
  const billedTaskDetail = await getDeliveryTaskById(managerUser, extTask1.id);
  assert(billedTaskDetail?.task.invoiceId === "inv_test_commercial_456", "getDeliveryTaskById returns invoiceId");
  assert(billedTaskDetail?.task.billedAt === "2026-10-22T12:00:00.000Z", "getDeliveryTaskById returns billedAt");

  // 2. Single reassignment on billed task is rejected
  try {
    await assignDeliveryTask(managerUser, extTask1.id, {
      assignedToStaffId: rameshDeliveryUser.id,
    });
    assert(false, "assignDeliveryTask should reject task linked to invoice");
  } catch (err: any) {
    assert(err.message.includes("linked to an invoice") || err.message.includes("Delivered"), "Reassignment rejected on billed task");
  }

  // 3. Batch reassignment on billed task is rejected
  try {
    await batchAssignDeliveryTasks(managerUser, {
      taskIds: [extTask1.id],
      assignedToStaffId: rameshDeliveryUser.id,
    });
    assert(false, "batchAssignDeliveryTasks should reject task linked to invoice");
  } catch (err: any) {
    assert(err.message.includes("linked to an invoice") || err.message.includes("already been delivered"), "Batch reassignment rejected on billed task");
  }

  // 4. Exception reporting on billed task is rejected
  try {
    await reportDeliveryException(managerUser, extTask1.id, {
      exceptionType: "OTHER",
      reason: "Customer claimed non-delivery post invoice",
    });
    assert(false, "reportDeliveryException should reject task linked to invoice");
  } catch (err: any) {
    assert(err.message.includes("Delivered") || err.message.includes("linked to an invoice"), "Exception reporting rejected on billed task");
  }

  // -----------------------------------------------------------------------------
  // TEST SUITE 22: Search and Filter Capabilities
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 22] Search and Filter Capabilities");

  // 1. Search by customer name
  const searchByName = await listDeliveryTasks(managerUser, {
    search: "Customer Beta",
  });
  assert(searchByName.some((t) => t.customerName === "Batch Customer Beta"), "listDeliveryTasks matches customerName in search query");

  // 2. Search by phone number
  const searchByPhone = await listDeliveryTasks(managerUser, {
    search: "22222",
  });
  assert(searchByPhone.some((t) => t.customerPhone === "+91 99999 22222"), "listDeliveryTasks matches customerPhone in search query");

  // 3. Search by address
  const searchByAddress = await listDeliveryTasks(managerUser, {
    search: "Tower B",
  });
  assert(searchByAddress.some((t) => (t.deliveryAddress || "").includes("Tower B")), "listDeliveryTasks matches deliveryAddress in search query");

  // 4. Filter by UNASSIGNED
  const unassignedTasks = await listDeliveryTasks(managerUser, {
    assignedTo: "UNASSIGNED",
  });
  assert(unassignedTasks.every((t) => !t.assignedTo), "listDeliveryTasks with assignedTo='UNASSIGNED' returns only unassigned tasks");

  // 5. Filter by specific staff ID
  const sureshFilteredTasks = await listDeliveryTasks(managerUser, {
    assignedTo: sureshDeliveryUser.id,
  });
  assert(sureshFilteredTasks.every((t) => t.assignedTo === sureshDeliveryUser.id), "listDeliveryTasks with specific assignedTo returns only Suresh's tasks");

  // -----------------------------------------------------------------------------
  // TEST SUITE 23: Zero Primary Database Access Guard & Environment Cleanup
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 23] Zero Primary Database Access Guard & Environment Cleanup");

  const primaryStatsAfter = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;
  if (primaryStatsBefore && primaryStatsAfter) {
    assert(
      primaryStatsBefore.size === primaryStatsAfter.size,
      `Primary data/erp.db size unchanged (${primaryStatsBefore.size} bytes)`
    );
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs,
      `Primary data/erp.db mtime unchanged (${primaryStatsBefore.mtime.toISOString()})`
    );
  } else {
    assert(true, "Primary database verification step completed");
  }

  // Final cleanup of test database
  cleanupTestDb();

  console.log("\n================================================================================");
  console.log(`FINAL DELIVERY TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runDeliveryTests().catch((err) => {
  console.error("Unhandled error during delivery test execution:", err);
  process.exit(1);
});
