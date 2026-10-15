import crypto from "crypto";
import { getDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { recordAuditEvent } from "../audit/audit";
import {
  AuthenticatedUser,
  MealType,
  DeliveryStatus,
  DeliveryExceptionType,
  DeliveryEventType,
  DeliveryTask,
  DeliveryTaskEvent,
  DeliveryBatchGenerationResult,
  DeliveryDashboardSummary,
  DeliveryOrderType,
  CreateExternalDeliveryTaskInput,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_MEAL_TYPES: readonly MealType[] = ["BREAKFAST", "LUNCH", "DINNER"];

const VALID_EXCEPTION_TYPES: readonly DeliveryExceptionType[] = [
  "RESIDENT_UNAVAILABLE",
  "RESIDENT_DECLINED",
  "LOCATION_UNCLEAR",
  "MEAL_DAMAGED_OR_MISSING",
  "OTHER",
];

export interface GenerateDeliveryTasksInput {
  serviceDate: string; // YYYY-MM-DD
  mealType: MealType;
}

export interface AssignDeliveryTaskInput {
  assignedToStaffId: string;
}

export interface CompleteDeliveryTaskInput {
  recipientName?: string;
  notes?: string;
}

export interface ReportDeliveryExceptionInput {
  exceptionType: DeliveryExceptionType;
  reason: string;
}

export interface RetryDeliveryTaskInput {
  reassignToStaffId?: string;
  notes?: string;
}

export interface ListDeliveryTasksOptions {
  serviceDate?: string;
  mealType?: MealType;
  status?: DeliveryStatus;
  assignedTo?: string;
  orderType?: DeliveryOrderType;
  limit?: number;
  offset?: number;
}

function mapRowToDeliveryTask(row: any): DeliveryTask {
  return {
    id: row.id,
    orderType: (row.order_type as any) || "RESIDENT",
    mealRecordId: row.meal_record_id || null,
    planId: row.plan_id,
    serviceDate: row.service_date,
    mealType: row.meal_type as MealType,
    residentId: row.resident_id || null,
    residentName: row.resident_name || row.customer_name || null,
    roomNumber: row.room_number || null,
    floor: row.floor !== null && row.floor !== undefined ? Number(row.floor) : null,
    stayId: row.stay_id || null,
    customerName: row.customer_name || row.resident_name || null,
    customerPhone: row.customer_phone || null,
    deliveryAddress: row.delivery_address || (row.room_number ? `Room ${row.room_number}, Floor ${row.floor}` : null),
    status: row.status as DeliveryStatus,
    assignedTo: row.assigned_to || null,
    assignedToName: row.assigned_to_name || null,
    assignedBy: row.assigned_by || null,
    assignedAt: row.assigned_at || null,
    dispatchedAt: row.dispatched_at || null,
    dispatchedBy: row.dispatched_by || null,
    deliveredAt: row.delivered_at || null,
    deliveredBy: row.delivered_by || null,
    deliveryNotes: row.delivery_notes || null,
    recipientName: row.recipient_name || null,
    exceptionType: row.exception_type ? (row.exception_type as DeliveryExceptionType) : null,
    exceptionReason: row.exception_reason || null,
    exceptionAt: row.exception_at || null,
    exceptionBy: row.exception_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToDeliveryEvent(row: any): DeliveryTaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type as DeliveryEventType,
    fromStatus: row.from_status ? (row.from_status as DeliveryStatus) : null,
    toStatus: row.to_status as DeliveryStatus,
    actorId: row.actor_id,
    actorName: row.actor_name,
    notes: row.notes || null,
    createdAt: row.created_at,
  };
}

/**
 * Generates delivery tasks from eligible, confirmed resident meal records for a confirmed kitchen plan.
 * Business rules enforced:
 * 1. Plan must exist and be in CONFIRMED or COMPLETED status.
 * 2. Opted-out residents are strictly excluded.
 * 3. Idempotent: Duplicate generation requests skip already existing tasks.
 * 4. Captures resident name and room number snapshots so future room updates/checkouts never rewrite past deliveries.
 * 5. Requires delivery.manage permission.
 */
export function generateDeliveryTasks(
  actor: AuthenticatedUser,
  input: GenerateDeliveryTasksInput,
  clientIp?: string
): DeliveryBatchGenerationResult {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.tasks_generated" });

  const serviceDate = input.serviceDate?.trim();
  const mealType = input.mealType;

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }
  if (!VALID_MEAL_TYPES.includes(mealType)) {
    throw new Error(`Invalid meal type '${mealType}'. Must be BREAKFAST, LUNCH, or DINNER.`);
  }

  const db = getDb();

  // 1. Verify kitchen meal plan exists and is confirmed
  const plan = db.prepare(`
    SELECT id, status, planned_resident_count
    FROM daily_meal_plans
    WHERE service_date = ? AND meal_type = ?
  `).get(serviceDate, mealType) as any;

  if (!plan) {
    throw new Error(
      `No daily meal plan found for ${mealType} on ${serviceDate}. A kitchen meal plan must be created and confirmed before generating delivery tasks.`
    );
  }

  if (plan.status === "DRAFT") {
    throw new Error(
      `Meal plan for ${mealType} on ${serviceDate} is currently in DRAFT status. Only CONFIRMED or COMPLETED meal plans can generate delivery tasks.`
    );
  }

  // 2. Fetch all resident meal records for this plan, joining current resident and room snapshots
  const mealRecords = db.prepare(`
    SELECT
      rmr.id as meal_record_id,
      rmr.resident_id,
      rmr.stay_id,
      rmr.status as meal_status,
      r.full_name as resident_name,
      rm.room_number,
      rm.floor
    FROM resident_meal_records rmr
    JOIN residents r ON r.id = rmr.resident_id
    JOIN resident_stays s ON s.id = rmr.stay_id
    JOIN rooms rm ON rm.id = s.room_id
    WHERE rmr.plan_id = ?
    ORDER BY rm.floor ASC, rm.room_number ASC
  `).all(plan.id) as any[];

  let createdCount = 0;
  let skippedCount = 0;
  let alreadyExistedCount = 0;

  const now = new Date().toISOString();

  const insertTask = db.prepare(`
    INSERT INTO delivery_tasks (
      id, meal_record_id, plan_id, service_date, meal_type,
      resident_id, resident_name, room_number, floor, stay_id,
      status, assigned_to, assigned_to_name, assigned_by, assigned_at,
      dispatched_at, dispatched_by, delivered_at, delivered_by,
      delivery_notes, recipient_name, exception_type, exception_reason,
      exception_at, exception_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      'PENDING', NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, ?, ?
    )
  `);

  const insertEvent = db.prepare(`
    INSERT INTO delivery_task_events (
      id, task_id, event_type, from_status, to_status,
      actor_id, actor_name, notes, created_at
    ) VALUES (?, ?, 'CREATED', NULL, 'PENDING', ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const rec of mealRecords) {
      if (rec.meal_status === "OPTED_OUT") {
        skippedCount++;
        continue;
      }

      // Check if task already exists for this meal record
      const existing = db.prepare(`
        SELECT id FROM delivery_tasks WHERE meal_record_id = ?
      `).get(rec.meal_record_id);

      if (existing) {
        alreadyExistedCount++;
        continue;
      }

      const taskId = `del_${crypto.randomUUID()}`;
      const eventId = `devt_${crypto.randomUUID()}`;

      insertTask.run(
        taskId,
        rec.meal_record_id,
        plan.id,
        serviceDate,
        mealType,
        rec.resident_id,
        rec.resident_name,
        rec.room_number,
        rec.floor,
        rec.stay_id,
        now,
        now
      );

      insertEvent.run(
        eventId,
        taskId,
        actor.id,
        actor.fullName,
        "Delivery task generated from confirmed kitchen meal plan",
        now
      );

      createdCount++;
    }

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.tasks_generated",
      targetType: "meal_plan",
      targetId: plan.id,
      metadata: {
        serviceDate,
        mealType,
        createdCount,
        skippedCount,
        alreadyExistedCount,
        totalEligible: mealRecords.length,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  const generatedTasks = listDeliveryTasks(actor, {
    serviceDate,
    mealType,
  });

  return {
    planId: plan.id,
    serviceDate,
    mealType,
    createdCount,
    skippedCount,
    alreadyExistedCount,
    totalEligible: mealRecords.length,
    tasks: generatedTasks,
  };
}

/**
 * Creates an external city customer delivery order.
 * Tiffin delivery is not restricted to residents or rooms within the PG.
 * Captures customer identity, contact details, and delivery address.
 * Requires delivery.manage permission.
 */
export function createExternalDeliveryTask(
  actor: AuthenticatedUser,
  input: CreateExternalDeliveryTaskInput,
  clientIp?: string
): DeliveryTask {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.external_order_created" });

  const serviceDate = input.serviceDate?.trim();
  const mealType = input.mealType;
  const customerName = input.customerName?.trim();
  const customerPhone = input.customerPhone?.trim();
  const deliveryAddress = input.deliveryAddress?.trim();
  const notes = input.notes?.trim() || null;

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }
  if (!VALID_MEAL_TYPES.includes(mealType)) {
    throw new Error(`Invalid meal type '${mealType}'. Must be BREAKFAST, LUNCH, or DINNER.`);
  }
  if (!customerName || customerName.length < 2) {
    throw new Error("Customer name must be at least 2 characters.");
  }
  if (!customerPhone || customerPhone.length < 7) {
    throw new Error("Valid customer contact number is required.");
  }
  if (!deliveryAddress || deliveryAddress.length < 5) {
    throw new Error("Valid delivery address in the city is required (min 5 characters).");
  }

  const db = getDb();

  // Find or attach to meal plan for that date and meal
  let planRow = db.prepare(`
    SELECT id, status FROM daily_meal_plans WHERE service_date = ? AND meal_type = ?
  `).get(serviceDate, mealType) as { id: string; status: string } | undefined;

  let planId: string;
  if (planRow) {
    planId = planRow.id;
  } else {
    planId = `dmp_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO daily_meal_plans (
        id, service_date, meal_type, planned_resident_count, guest_count,
        final_preparation_count, actual_cooked_count, status, notes,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 0, 1, 1, 1, 'CONFIRMED', 'Auto-created for external city delivery', ?, ?, ?)
    `).run(planId, serviceDate, mealType, actor.id, now, now);
  }

  const taskId = `del_ext_${crypto.randomUUID()}`;
  const eventId = `devt_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO delivery_tasks (
        id, order_type, meal_record_id, plan_id, service_date, meal_type,
        resident_id, resident_name, room_number, floor, stay_id,
        customer_name, customer_phone, delivery_address, delivery_notes,
        status, created_at, updated_at
      ) VALUES (
        ?, 'EXTERNAL', NULL, ?, ?, ?,
        NULL, ?, NULL, NULL, NULL,
        ?, ?, ?, ?,
        'PENDING', ?, ?
      )
    `).run(
      taskId, planId, serviceDate, mealType,
      customerName,
      customerName, customerPhone, deliveryAddress, notes,
      now, now
    );

    db.prepare(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'CREATED', NULL, 'PENDING', ?, ?, ?, ?)
    `).run(eventId, taskId, actor.id, actor.fullName, notes, now);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.external_order_created",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        orderType: "EXTERNAL",
        serviceDate,
        mealType,
        customerName,
        customerPhone,
        deliveryAddress,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  const createdRow = db.prepare(`SELECT * FROM delivery_tasks WHERE id = ?`).get(taskId);
  return mapRowToDeliveryTask(createdRow);
}

/**
 * Assigns or reassigns a delivery task to an active delivery staff member.
 * Requires delivery.manage permission.
 */
export function assignDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input: AssignDeliveryTaskInput,
  clientIp?: string
): DeliveryTask {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.task_assigned" });

  const assignedToStaffId = input.assignedToStaffId?.trim();
  if (!assignedToStaffId) {
    throw new Error("Target delivery person staff ID is required.");
  }

  const db = getDb();

  // Validate target staff user exists, is active, and holds DELIVERY_PERSON role
  const staff = db.prepare(`
    SELECT id, full_name as fullName, role, is_active as isActive
    FROM staff_users
    WHERE id = ?
  `).get(assignedToStaffId) as any;

  if (!staff) {
    throw new Error(`Staff member '${assignedToStaffId}' not found.`);
  }
  if (!staff.isActive) {
    throw new Error(`Staff member '${staff.fullName}' is currently inactive and cannot receive delivery assignments.`);
  }
  if (staff.role !== "DELIVERY_PERSON") {
    throw new Error(
      `Staff member '${staff.fullName}' holds role '${staff.role}'. Only active DELIVERY_PERSON staff can be assigned delivery tasks.`
    );
  }

  // Fetch target delivery task
  const taskRow = db.prepare(`SELECT * FROM delivery_tasks WHERE id = ?`).get(taskId) as any;
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);
  if (currentTask.status === "DELIVERED") {
    throw new Error("Delivered tasks cannot be reassigned.");
  }

  const isReassignment = !!currentTask.assignedTo;
  const eventType: DeliveryEventType = isReassignment ? "REASSIGNED" : "ASSIGNED";
  const fromStatus = currentTask.status;
  const toStatus: DeliveryStatus = "ASSIGNED";
  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE delivery_tasks
      SET
        status = 'ASSIGNED',
        assigned_to = ?,
        assigned_to_name = ?,
        assigned_by = ?,
        assigned_at = ?,
        exception_type = NULL,
        exception_reason = NULL,
        exception_at = NULL,
        exception_by = NULL,
        updated_at = ?
      WHERE id = ?
    `).run(
      staff.id,
      staff.fullName,
      actor.id,
      now,
      now,
      taskId
    );

    db.prepare(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      taskId,
      eventType,
      fromStatus,
      toStatus,
      actor.id,
      actor.fullName,
      isReassignment
        ? `Reassigned from ${currentTask.assignedToName || "prior staff"} to ${staff.fullName}`
        : `Assigned to ${staff.fullName}`,
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: isReassignment ? "delivery.task_reassigned" : "delivery.task_assigned",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        assignedToStaffId: staff.id,
        assignedToStaffName: staff.fullName,
        previousAssignedTo: currentTask.assignedTo,
        fromStatus,
        toStatus,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getDeliveryTaskById(actor, taskId)!.task;
}

/**
 * Marks a task as OUT_FOR_DELIVERY (dispatched).
 * Delivery staff can only dispatch tasks assigned to themselves.
 * Requires delivery.update permission.
 */
export function dispatchDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  clientIp?: string
): DeliveryTask {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.task_dispatched" });

  const db = getDb();
  const taskRow = db.prepare(`SELECT * FROM delivery_tasks WHERE id = ?`).get(taskId) as any;
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);

  // Ownership check: delivery persons can only update tasks assigned to them
  if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You are not assigned to this delivery task.");
  }

  if (!currentTask.assignedTo) {
    throw new Error("Task must be assigned to a delivery person before it can be dispatched.");
  }

  if (currentTask.status === "DELIVERED") {
    throw new Error("Task has already been delivered.");
  }

  // Idempotent dispatch
  if (currentTask.status === "OUT_FOR_DELIVERY") {
    return currentTask;
  }

  if (currentTask.status !== "ASSIGNED") {
    throw new Error(`Cannot dispatch task in status '${currentTask.status}'. Task must be in ASSIGNED status.`);
  }

  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE delivery_tasks
      SET
        status = 'OUT_FOR_DELIVERY',
        dispatched_at = ?,
        dispatched_by = ?,
        updated_at = ?
      WHERE id = ?
    `).run(now, actor.id, now, taskId);

    db.prepare(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'DISPATCHED', 'ASSIGNED', 'OUT_FOR_DELIVERY', ?, ?, ?, ?)
    `).run(
      eventId,
      taskId,
      actor.id,
      actor.fullName,
      "Tiffin dispatched from kitchen and out for delivery",
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.task_dispatched",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        roomNumber: currentTask.roomNumber,
        serviceDate: currentTask.serviceDate,
        mealType: currentTask.mealType,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getDeliveryTaskById(actor, taskId)!.task;
}

/**
 * Marks a task as DELIVERED upon successful handover to the resident.
 * Records delivery timestamp, actor attribution, and optional recipient verification.
 * Requires delivery.update permission.
 */
export function completeDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input?: CompleteDeliveryTaskInput,
  clientIp?: string
): DeliveryTask {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.task_delivered" });

  const db = getDb();
  const taskRow = db.prepare(`SELECT * FROM delivery_tasks WHERE id = ?`).get(taskId) as any;
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);

  // Ownership check: delivery persons can only complete tasks assigned to them
  if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You are not assigned to this delivery task.");
  }

  if (!currentTask.assignedTo) {
    throw new Error("Task must be assigned to a delivery person before it can be marked as delivered.");
  }

  // Idempotent delivery
  if (currentTask.status === "DELIVERED") {
    return currentTask;
  }

  if (currentTask.status === "EXCEPTION") {
    throw new Error("Task is currently in EXCEPTION status. It must be retried or reassigned before delivery.");
  }

  const recipientName = input?.recipientName?.trim() || null;
  const deliveryNotes = input?.notes?.trim() || null;
  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE delivery_tasks
      SET
        status = 'DELIVERED',
        delivered_at = ?,
        delivered_by = ?,
        recipient_name = ?,
        delivery_notes = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      now,
      actor.id,
      recipientName,
      deliveryNotes,
      now,
      taskId
    );

    db.prepare(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'DELIVERED', ?, 'DELIVERED', ?, ?, ?, ?)
    `).run(
      eventId,
      taskId,
      currentTask.status,
      actor.id,
      actor.fullName,
      recipientName ? `Handed over to ${recipientName}` : "Handed over to resident",
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.task_delivered",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        roomNumber: currentTask.roomNumber,
        serviceDate: currentTask.serviceDate,
        mealType: currentTask.mealType,
        recipientName,
        deliveredAt: now,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getDeliveryTaskById(actor, taskId)!.task;
}

/**
 * Reports a delivery exception using controlled categories and mandatory reason.
 * Does NOT delete the task; records exception state and detailed history for review/retry.
 * Requires delivery.update permission.
 */
export function reportDeliveryException(
  actor: AuthenticatedUser,
  taskId: string,
  input: ReportDeliveryExceptionInput,
  clientIp?: string
): DeliveryTask {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.task_exception" });

  const exceptionType = input.exceptionType;
  const reason = input.reason?.trim();

  if (!VALID_EXCEPTION_TYPES.includes(exceptionType)) {
    throw new Error(
      `Invalid exception type '${exceptionType}'. Must be RESIDENT_UNAVAILABLE, RESIDENT_DECLINED, LOCATION_UNCLEAR, MEAL_DAMAGED_OR_MISSING, or OTHER.`
    );
  }
  if (!reason || reason.length < 5) {
    throw new Error("A clear exception reason of at least 5 characters is required.");
  }

  const db = getDb();
  const taskRow = db.prepare(`SELECT * FROM delivery_tasks WHERE id = ?`).get(taskId) as any;
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);

  // Ownership check: delivery persons can only report exceptions on tasks assigned to them
  if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You are not assigned to this delivery task.");
  }

  if (currentTask.status === "DELIVERED") {
    throw new Error("Delivered tasks cannot be marked as exceptions without an authorized correction workflow.");
  }

  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE delivery_tasks
      SET
        status = 'EXCEPTION',
        exception_type = ?,
        exception_reason = ?,
        exception_at = ?,
        exception_by = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      exceptionType,
      reason,
      now,
      actor.id,
      now,
      taskId
    );

    db.prepare(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'EXCEPTION', ?, 'EXCEPTION', ?, ?, ?, ?)
    `).run(
      eventId,
      taskId,
      currentTask.status,
      actor.id,
      actor.fullName,
      `Exception [${exceptionType}]: ${reason}`,
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.task_exception",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        exceptionType,
        reason,
        roomNumber: currentTask.roomNumber,
        serviceDate: currentTask.serviceDate,
        mealType: currentTask.mealType,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getDeliveryTaskById(actor, taskId)!.task;
}

/**
 * Retries an exception task, resetting it to ASSIGNED status for redelivery.
 * Optionally reassigns to another delivery staff member.
 * Requires delivery.manage permission.
 */
export function retryDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input?: RetryDeliveryTaskInput,
  clientIp?: string
): DeliveryTask {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.task_retried" });

  const db = getDb();
  const taskRow = db.prepare(`SELECT * FROM delivery_tasks WHERE id = ?`).get(taskId) as any;
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);
  if (currentTask.status !== "EXCEPTION") {
    throw new Error(`Task '${taskId}' is in status '${currentTask.status}'. Only tasks in EXCEPTION status can be retried.`);
  }

  let targetStaffId = currentTask.assignedTo;
  let targetStaffName = currentTask.assignedToName;

  if (input?.reassignToStaffId) {
    const staff = db.prepare(`
      SELECT id, full_name as fullName, role, is_active as isActive
      FROM staff_users
      WHERE id = ?
    `).get(input.reassignToStaffId.trim()) as any;

    if (!staff || !staff.isActive || staff.role !== "DELIVERY_PERSON") {
      throw new Error(`Staff member '${input.reassignToStaffId}' is not an active delivery person.`);
    }

    targetStaffId = staff.id;
    targetStaffName = staff.fullName;
  }

  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;
  const notes = input?.notes?.trim() || `Retried by management${input?.reassignToStaffId ? ` and reassigned to ${targetStaffName}` : ""}`;

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE delivery_tasks
      SET
        status = 'ASSIGNED',
        assigned_to = ?,
        assigned_to_name = ?,
        assigned_by = ?,
        assigned_at = ?,
        exception_type = NULL,
        exception_reason = NULL,
        exception_at = NULL,
        exception_by = NULL,
        dispatched_at = NULL,
        dispatched_by = NULL,
        updated_at = ?
      WHERE id = ?
    `).run(
      targetStaffId,
      targetStaffName,
      actor.id,
      now,
      now,
      taskId
    );

    db.prepare(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'RETRIED', 'EXCEPTION', 'ASSIGNED', ?, ?, ?, ?)
    `).run(
      eventId,
      taskId,
      actor.id,
      actor.fullName,
      notes,
      now
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.task_retried",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        reassignedToStaffId: targetStaffId,
        reassignedToStaffName: targetStaffName,
        notes,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getDeliveryTaskById(actor, taskId)!.task;
}

/**
 * Lists delivery tasks with optional date, meal, and status filters.
 * Delivery personnel are strictly restricted to tasks assigned to themselves.
 * Requires delivery.read permission.
 */
export function listDeliveryTasks(
  actor: AuthenticatedUser,
  options?: ListDeliveryTasksOptions
): DeliveryTask[] {
  requirePermission(actor, "delivery.read");

  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  // Strict ownership isolation: Delivery Person can ONLY view their assigned tasks
  if (actor.role === "DELIVERY_PERSON") {
    conditions.push("assigned_to = ?");
    params.push(actor.id);
  } else if (options?.assignedTo) {
    conditions.push("assigned_to = ?");
    params.push(options.assignedTo);
  }

  if (options?.serviceDate) {
    conditions.push("service_date = ?");
    params.push(options.serviceDate);
  }
  if (options?.mealType) {
    conditions.push("meal_type = ?");
    params.push(options.mealType);
  }
  if (options?.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options?.orderType) {
    conditions.push("order_type = ?");
    params.push(options.orderType);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, Number(options?.limit) || 200));
  const offset = Math.max(0, Number(options?.offset) || 0);

  const rows = db.prepare(`
    SELECT *
    FROM delivery_tasks
    ${whereClause}
    ORDER BY service_date DESC, floor ASC, room_number ASC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return rows.map(mapRowToDeliveryTask);
}

/**
 * Retrieves a single delivery task along with its full event timeline.
 * Enforces ownership restrictions for delivery personnel.
 * Requires delivery.read permission.
 */
export function getDeliveryTaskById(
  actor: AuthenticatedUser,
  taskId: string
): { task: DeliveryTask; events: DeliveryTaskEvent[] } | null {
  requirePermission(actor, "delivery.read");

  const db = getDb();
  const row = db.prepare(`SELECT * FROM delivery_tasks WHERE id = ?`).get(taskId);
  if (!row) return null;

  const task = mapRowToDeliveryTask(row);

  // Ownership isolation: Delivery Person cannot view tasks assigned to others
  if (actor.role === "DELIVERY_PERSON" && task.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You do not have permission to view this delivery task.");
  }

  const eventRows = db.prepare(`
    SELECT *
    FROM delivery_task_events
    WHERE task_id = ?
    ORDER BY created_at ASC
  `).all(taskId);

  return {
    task,
    events: eventRows.map(mapRowToDeliveryEvent),
  };
}

/**
 * Calculates delivery dashboard metrics and staff workload breakdown.
 * Requires delivery.read permission.
 */
export function getDeliveryDashboardSummary(
  actor: AuthenticatedUser,
  serviceDate: string,
  mealType?: MealType | "ALL"
): DeliveryDashboardSummary {
  requirePermission(actor, "delivery.read");

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }

  const db = getDb();
  const conditions = ["service_date = ?"];
  const params: any[] = [serviceDate];

  if (mealType && mealType !== "ALL" && VALID_MEAL_TYPES.includes(mealType)) {
    conditions.push("meal_type = ?");
    params.push(mealType);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countsRow = db.prepare(`
    SELECT
      COUNT(*) as totalTasks,
      COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) as pendingCount,
      COALESCE(SUM(CASE WHEN status = 'ASSIGNED' THEN 1 ELSE 0 END), 0) as assignedCount,
      COALESCE(SUM(CASE WHEN status = 'OUT_FOR_DELIVERY' THEN 1 ELSE 0 END), 0) as outForDeliveryCount,
      COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as deliveredCount,
      COALESCE(SUM(CASE WHEN status = 'EXCEPTION' THEN 1 ELSE 0 END), 0) as exceptionCount,
      COALESCE(SUM(CASE WHEN assigned_to IS NULL THEN 1 ELSE 0 END), 0) as unassignedCount
    FROM delivery_tasks
    ${whereClause}
  `).get(...params) as any;

  // Active delivery personnel workload
  const staffRows = db.prepare(`
    SELECT
      u.id as staffId,
      u.full_name as staffName,
      COUNT(t.id) as assignedCount,
      COALESCE(SUM(CASE WHEN t.status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as deliveredCount,
      COALESCE(SUM(CASE WHEN t.status IN ('ASSIGNED', 'OUT_FOR_DELIVERY') THEN 1 ELSE 0 END), 0) as pendingCount,
      COALESCE(SUM(CASE WHEN t.status = 'EXCEPTION' THEN 1 ELSE 0 END), 0) as exceptionCount
    FROM staff_users u
    LEFT JOIN delivery_tasks t ON t.assigned_to = u.id AND t.service_date = ?
    WHERE u.role = 'DELIVERY_PERSON' AND u.is_active = 1
    GROUP BY u.id, u.full_name
    ORDER BY u.full_name ASC
  `).all(serviceDate) as any[];

  return {
    serviceDate,
    mealType: mealType || "ALL",
    totalTasks: countsRow?.totalTasks || 0,
    pendingCount: countsRow?.pendingCount || 0,
    assignedCount: countsRow?.assignedCount || 0,
    outForDeliveryCount: countsRow?.outForDeliveryCount || 0,
    deliveredCount: countsRow?.deliveredCount || 0,
    exceptionCount: countsRow?.exceptionCount || 0,
    unassignedCount: countsRow?.unassignedCount || 0,
    staffWorkload: staffRows.map((r) => ({
      staffId: r.staffId,
      staffName: r.staffName,
      assignedCount: Number(r.assignedCount) || 0,
      deliveredCount: Number(r.deliveredCount) || 0,
      pendingCount: Number(r.pendingCount) || 0,
      exceptionCount: Number(r.exceptionCount) || 0,
    })),
  };
}

/**
 * Lists all active delivery personnel available for assignment.
 * Requires delivery.read permission.
 */
export function listActiveDeliveryStaff(actor: AuthenticatedUser): Array<{
  id: string;
  fullName: string;
  username: string;
}> {
  requirePermission(actor, "delivery.read");

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, full_name as fullName, username
    FROM staff_users
    WHERE role = 'DELIVERY_PERSON' AND is_active = 1
    ORDER BY full_name ASC
  `).all() as any[];

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    username: r.username,
  }));
}
