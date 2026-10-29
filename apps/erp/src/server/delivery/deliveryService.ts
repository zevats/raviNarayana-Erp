import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { recordAuditEventAsync } from "../audit/audit";
import { assertClosingDateNotFinalized } from "../finance/financeService";
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
  DeliveryCollectionStatus,
  DriverHandoverStatus,
  DriverCashHandover,
  DeclareCashHandoverInput,
  AcceptCashHandoverInput,
  DriverCustodySummary,
  QueuedDeliveryAction,
  RecordDeliveryCollectionInput,
  CompleteDeliveryTaskInput,
  CreateExternalDeliveryTaskInput,
  BatchAssignDeliveryTasksInput,
  BatchAssignDeliveryTasksResult,
  BatchDispatchDeliveryTasksInput,
  BatchDispatchDeliveryTasksResult,
  OrderItem,
  PaymentMethod,
  normalizePaymentMethod,
  tryNormalizePaymentMethod,
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
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Safely strips internal system markers such as [ORDER_JSON:{...}] from notes,
 * returning only genuine human notes or null if empty.
 */
export function extractCleanUserNotes(notes: string | null | undefined): string | null {
  if (!notes || typeof notes !== "string") return null;
  const marker = "[ORDER_JSON:";
  const startIdx = notes.indexOf(marker);
  if (startIdx === -1) {
    const trimmed = notes.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const jsonStart = startIdx + marker.length;
  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < notes.length; i++) {
    const ch = notes[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0 && ch === "}") {
          if (i + 1 < notes.length && notes[i + 1] === "]") {
            endIdx = i + 2;
          } else {
            endIdx = i + 1;
          }
          break;
        }
      }
    }
  }

  let cleaned = notes;
  if (endIdx !== -1) {
    cleaned = notes.slice(0, startIdx) + notes.slice(endIdx);
  } else {
    const closeBracket = notes.indexOf("}]", jsonStart);
    if (closeBracket !== -1) {
      cleaned = notes.slice(0, startIdx) + notes.slice(closeBracket + 2);
    }
  }

  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extracts structured metadata JSON from bracketed string [ORDER_JSON:{...}]
 */
function extractOrderMetadataJson(notes: string | null | undefined): any | null {
  if (!notes || typeof notes !== "string" || !notes.includes("[ORDER_JSON:")) {
    return null;
  }
  const marker = "[ORDER_JSON:";
  const startIdx = notes.indexOf(marker);
  if (startIdx === -1) return null;
  const jsonStart = startIdx + marker.length;

  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < notes.length; i++) {
    const ch = notes[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0 && ch === "}") {
          endIdx = i + 1;
          break;
        }
      }
    }
  }

  if (endIdx === -1) return null;
  try {
    return JSON.parse(notes.slice(jsonStart, endIdx));
  } catch {
    return null;
  }
}

function mapRowToDeliveryTask(row: any): DeliveryTask {
  let parsedItems: OrderItem[] | undefined = undefined;
  if (row.delivery_notes && typeof row.delivery_notes === "string" && row.delivery_notes.includes("[ORDER_JSON:")) {
    const meta = extractOrderMetadataJson(row.delivery_notes);
    if (meta && Array.isArray(meta.items)) {
      parsedItems = meta.items;
    }
  }

  return {
    id: row.id,
    orderType: (row.order_type as any) || "RESIDENT",
    mealRecordId: row.meal_record_id || null,
    planId: row.plan_id,
    subscriptionId: row.subscription_id || null,
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
    invoiceId: row.invoice_id || null,
    invoiceItemId: row.invoice_item_id || null,
    billedAt: row.billed_at || null,
    collectionStatus: (row.collection_status as DeliveryCollectionStatus) || "NONE",
    collectedAmount: row.collected_amount !== null && row.collected_amount !== undefined ? Number(row.collected_amount) : 0,
    collectedPaymentMethod: row.collected_payment_method || null,
    collectionTransactionId: row.collection_transaction_id || null,
    collectionIdempotencyKey: row.collection_idempotency_key || null,
    handoverId: row.handover_id || null,
    status: row.status as DeliveryStatus,
    assignedTo: row.assigned_to || null,
    assignedToName: row.assigned_to_name || null,
    assignedBy: row.assigned_by || null,
    assignedAt: row.assigned_at || null,
    dispatchedAt: row.dispatched_at || null,
    dispatchedBy: row.dispatched_by || null,
    deliveredAt: row.delivered_at || null,
    deliveredBy: row.delivered_by || null,
    deliveryNotes: extractCleanUserNotes(row.delivery_notes),
    items: parsedItems,
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

function mapRowToDriverCashHandover(row: any): DriverCashHandover {
  return {
    id: row.id,
    driverId: row.driver_id,
    driverName: row.driver_name || null,
    shiftDate: row.shift_date,
    declaredCash: Number(row.declared_cash || 0),
    acceptedCash: Number(row.accepted_cash || 0),
    variance: Number(row.variance || 0),
    varianceReason: row.variance_reason || null,
    status: row.status as DriverHandoverStatus,
    transactionId: row.transaction_id || null,
    acceptedBy: row.accepted_by || null,
    acceptedByName: row.accepted_by_name || null,
    acceptedAt: row.accepted_at || null,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns eligible active commercial Tiffin subscriptions for a given service date and meal type.
 */
export async function getEligibleTiffinSubscriptionsForDate(
  actor: AuthenticatedUser,
  serviceDate: string,
  mealType: MealType,
  db: AsyncDb
): Promise<Array<{
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerType: string;
  dietaryPreference: string;
  productName: string;
  quantityPerMeal: number;
  deliveryAddress: string;
  deliveryInstructions: string | null;
}>> {
  const targetDate = new Date(`${serviceDate}T12:00:00Z`);
  const dayOfWeekIndex = targetDate.getUTCDay();

  const rows = await db.query<any>(`
    SELECT
      s.id as subscription_id,
      s.customer_id,
      s.product_id,
      s.meal_types,
      s.service_days,
      s.quantity_per_meal,
      s.start_date,
      s.end_date,
      s.pause_start_date,
      s.pause_resume_date,
      s.status as subscription_status,
      s.delivery_address,
      s.delivery_instructions,
      c.full_name as customer_name,
      c.phone as customer_phone,
      c.customer_type,
      c.dietary_preference,
      p.name as product_name
    FROM tiffin_subscriptions s
    JOIN tiffin_customers c ON s.customer_id = c.id
    JOIN tiffin_products p ON s.product_id = p.id
    WHERE s.status = 'ACTIVE'
      AND c.status = 'ACTIVE'
      AND p.status = 'ACTIVE'
      AND s.start_date <= ?
      AND (s.end_date IS NULL OR s.end_date >= ?)
    ORDER BY c.full_name ASC
  `, [serviceDate, serviceDate]);

  const eligible: any[] = [];
  for (const row of rows) {
    if (row.pause_start_date) {
      const isPaused = serviceDate >= row.pause_start_date &&
        (!row.pause_resume_date || serviceDate < row.pause_resume_date);
      if (isPaused) continue;
    }

    const serviceDays = row.service_days;
    if (serviceDays === "MON_SAT") {
      if (dayOfWeekIndex === 0) continue;
    } else if (serviceDays === "MON_FRI") {
      if (dayOfWeekIndex === 0 || dayOfWeekIndex === 6) continue;
    }

    const mealTypes = row.meal_types;
    if (mealType === "BREAKFAST" && mealTypes !== "BREAKFAST") continue;
    if (mealType === "LUNCH" && mealTypes !== "LUNCH" && mealTypes !== "BOTH") continue;
    if (mealType === "DINNER" && mealTypes !== "DINNER" && mealTypes !== "BOTH") continue;

    eligible.push({
      subscriptionId: row.subscription_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerType: row.customer_type,
      dietaryPreference: row.dietary_preference,
      productName: row.product_name,
      quantityPerMeal: row.quantity_per_meal || 1,
      deliveryAddress: row.delivery_address || "Address pending",
      deliveryInstructions: row.delivery_instructions,
    });
  }

  return eligible;
}

/**
 * Generates delivery tasks from eligible, confirmed resident meal records for a confirmed kitchen plan.
 * Business rules enforced:
 * 1. Plan must exist and be in CONFIRMED or COMPLETED status (auto-provisions confirmed plan if absent).
 * 2. Opted-out residents are strictly excluded.
 * 3. Idempotent: Duplicate generation requests skip already existing tasks.
 * 4. Captures resident name and room number snapshots so future room updates/checkouts never rewrite past deliveries.
 * 5. Requires delivery.manage permission.
 */
export async function generateDeliveryTasks(
  actor: AuthenticatedUser,
  input: GenerateDeliveryTasksInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryBatchGenerationResult> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.tasks_generated" });

  const serviceDate = input.serviceDate?.trim();
  const mealType = input.mealType;

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }
  if (!VALID_MEAL_TYPES.includes(mealType)) {
    throw new Error(`Invalid meal type '${mealType}'. Must be BREAKFAST, LUNCH, or DINNER.`);
  }

  const db = asyncDb || getAsyncDb();

  // 1. Verify or auto-provision kitchen meal plan
  let plan = await db.queryOne<any>(`
    SELECT id, status, planned_resident_count
    FROM daily_meal_plans
    WHERE service_date = ? AND meal_type = ?
  `, [serviceDate, mealType]);

  if (plan && plan.status === "DRAFT") {
    throw new Error(
      `Meal plan for ${mealType} on ${serviceDate} is currently in DRAFT status. Only CONFIRMED or COMPLETED meal plans can generate delivery tasks.`
    );
  }

  const now = new Date().toISOString();

  if (!plan) {
    const planId = `dmp_${crypto.randomUUID()}`;
    await db.execute(`
      INSERT INTO daily_meal_plans (
        id, service_date, meal_type, planned_resident_count, guest_count,
        final_preparation_count, actual_cooked_count, status, notes,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 0, 0, 0, 0, 'CONFIRMED', 'Auto-created for daily delivery generation', ?, ?, ?)
    `, [planId, serviceDate, mealType, actor.id, now, now]);
    plan = { id: planId, status: "CONFIRMED", planned_resident_count: 0 };
  }

  // 2. Fetch all resident meal records for this plan, joining current resident and room snapshots
  const mealRecords = await db.query<any>(`
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
  `, [plan.id]);

  let createdCount = 0;
  let skippedCount = 0;
  let alreadyExistedCount = 0;

  await db.transaction(async (tx) => {
    for (const rec of mealRecords) {
      if (rec.meal_status === "OPTED_OUT") {
        skippedCount++;
        continue;
      }

      // Check if task already exists for this meal record using scoped tx
      const existing = await tx.queryOne(`
        SELECT id FROM delivery_tasks WHERE meal_record_id = ?
      `, [rec.meal_record_id]);

      if (existing) {
        alreadyExistedCount++;
        continue;
      }

      const taskId = `del_${crypto.randomUUID()}`;
      const eventId = `devt_${crypto.randomUUID()}`;

      await tx.execute(`
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
      `, [
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
        now,
      ]);

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, 'CREATED', NULL, 'PENDING', ?, ?, ?, ?)
      `, [
        eventId,
        taskId,
        actor.id,
        actor.fullName,
        "Delivery task generated from confirmed kitchen meal plan",
        now,
      ]);

      createdCount++;
    }

    // 2. Fetch eligible commercial Tiffin subscriptions for serviceDate and mealType
    let tiffinSubsLength = 0;
    try {
      const tiffinSubs = await getEligibleTiffinSubscriptionsForDate(actor, serviceDate, mealType, tx as any);
      tiffinSubsLength = tiffinSubs.length;
      for (const sub of tiffinSubs) {
        const existingSubTask = await tx.queryOne(`
          SELECT id FROM delivery_tasks WHERE plan_id = ? AND subscription_id = ?
        `, [plan.id, sub.subscriptionId]);

        if (existingSubTask) {
          alreadyExistedCount++;
          continue;
        }

        const taskId = `del_sub_${crypto.randomUUID()}`;
        const eventId = `devt_${crypto.randomUUID()}`;
        const deliveryNotes = sub.deliveryInstructions
          ? (sub.quantityPerMeal > 1 ? `Qty: ${sub.quantityPerMeal} | ${sub.deliveryInstructions}` : sub.deliveryInstructions)
          : (sub.quantityPerMeal > 1 ? `Qty: ${sub.quantityPerMeal} meal box(es)` : null);

        await tx.execute(`
          INSERT INTO delivery_tasks (
            id, order_type, meal_record_id, plan_id, subscription_id, service_date, meal_type,
            resident_id, resident_name, room_number, floor, stay_id,
            customer_name, customer_phone, delivery_address, delivery_notes,
            status, created_at, updated_at
          ) VALUES (
            ?, 'EXTERNAL', NULL, ?, ?, ?, ?,
            NULL, ?, NULL, NULL, NULL,
            ?, ?, ?, ?,
            'PENDING', ?, ?
          )
        `, [
          taskId,
          plan.id,
          sub.subscriptionId,
          serviceDate,
          mealType,
          sub.customerName,
          sub.customerName,
          sub.customerPhone,
          sub.deliveryAddress,
          deliveryNotes,
          now,
          now,
        ]);

        await tx.execute(`
          INSERT INTO delivery_task_events (
            id, task_id, event_type, from_status, to_status,
            actor_id, actor_name, notes, created_at
          ) VALUES (?, ?, 'CREATED', NULL, 'PENDING', ?, ?, ?, ?)
        `, [
          eventId,
          taskId,
          actor.id,
          actor.fullName,
          `Delivery task generated for commercial Tiffin subscription (${sub.productName})`,
          now,
        ]);

        createdCount++;
      }
    } catch {
      // In isolated environments without tiffin tables, gracefully ignore
    }

    const totalEligible = mealRecords.length + tiffinSubsLength;

    await recordAuditEventAsync({
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
        totalEligible,
        residentEligible: mealRecords.length,
        tiffinEligible: tiffinSubsLength,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const generatedTasks = await listDeliveryTasks(actor, {
    serviceDate,
    mealType,
  }, db);

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
export async function createExternalDeliveryTask(
  actor: AuthenticatedUser,
  input: CreateExternalDeliveryTaskInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
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

  const db = asyncDb || getAsyncDb();

  const taskId = `del_ext_${crypto.randomUUID()}`;
  const eventId = `devt_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    // Find or attach to meal plan for that date and meal inside transaction
    const planRow = await tx.queryOne<{ id: string; status: string }>(`
      SELECT id, status FROM daily_meal_plans WHERE service_date = ? AND meal_type = ?
    `, [serviceDate, mealType]);

    let planId: string;
    if (planRow) {
      planId = planRow.id;
    } else {
      planId = `dmp_${crypto.randomUUID()}`;
      await tx.execute(`
        INSERT INTO daily_meal_plans (
          id, service_date, meal_type, planned_resident_count, guest_count,
          final_preparation_count, actual_cooked_count, status, notes,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, 0, 1, 1, 1, 'CONFIRMED', 'Auto-created for external city delivery', ?, ?, ?)
      `, [planId, serviceDate, mealType, actor.id, now, now]);
    }

    await tx.execute(`
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
    `, [
      taskId, planId, serviceDate, mealType,
      customerName,
      customerName, customerPhone, deliveryAddress, notes,
      now, now
    ]);

    await tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'CREATED', NULL, 'PENDING', ?, ?, ?, ?)
    `, [eventId, taskId, actor.id, actor.fullName, notes, now]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  const createdRow = await db.queryOne(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  return mapRowToDeliveryTask(createdRow);
}

/**
 * Assigns or reassigns a delivery task to an active delivery staff member.
 * Requires delivery.manage permission.
 */
export async function assignDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input: AssignDeliveryTaskInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.task_assigned" });

  const assignedToStaffId = input.assignedToStaffId?.trim();
  if (!assignedToStaffId) {
    throw new Error("Target delivery person staff ID is required.");
  }

  const db = asyncDb || getAsyncDb();

  // Validate target staff user exists, is active, and holds DELIVERY_PERSON role
  const staff = await db.queryOne<any>(`
    SELECT id, full_name as fullName, role, is_active as isActive
    FROM staff_users
    WHERE id = ?
  `, [assignedToStaffId]);

  if (!staff) {
    throw new Error(`Staff member '${assignedToStaffId}' not found.`);
  }
  if (!Boolean(staff.isActive)) {
    throw new Error(`Staff member '${staff.fullName}' is currently inactive and cannot receive delivery assignments.`);
  }
  if (staff.role !== "DELIVERY_PERSON") {
    throw new Error(
      `Staff member '${staff.fullName}' holds role '${staff.role}'. Only active DELIVERY_PERSON staff can be assigned delivery tasks.`
    );
  }

  // Fetch target delivery task
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);
  if (currentTask.status === "DELIVERED") {
    throw new Error("Delivered tasks cannot be reassigned.");
  }
  if (currentTask.invoiceId) {
    throw new Error("Task is linked to an invoice and cannot be reassigned.");
  }

  const isReassignment = !!currentTask.assignedTo;
  const eventType: DeliveryEventType = isReassignment ? "REASSIGNED" : "ASSIGNED";
  const fromStatus = currentTask.status;
  const toStatus: DeliveryStatus = "ASSIGNED";
  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    await tx.execute(`
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
    `, [
      staff.id,
      staff.fullName,
      actor.id,
      now,
      now,
      taskId,
    ]);

    await tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
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
      now,
    ]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

/**
 * Assigns multiple delivery tasks to an active delivery staff member in a single atomic transaction.
 * Requires delivery.manage permission.
 */
export async function batchAssignDeliveryTasks(
  actor: AuthenticatedUser,
  input: BatchAssignDeliveryTasksInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<BatchAssignDeliveryTasksResult> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.tasks_batch_assigned" });

  const assignedToStaffId = input.assignedToStaffId?.trim();
  if (!assignedToStaffId) {
    throw new Error("Target delivery person staff ID is required.");
  }

  const rawTaskIds = Array.isArray(input.taskIds) ? input.taskIds : [];
  const taskIds = Array.from(new Set(rawTaskIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)));

  if (taskIds.length === 0) {
    throw new Error("At least one valid delivery task ID must be provided for batch assignment.");
  }
  if (taskIds.length > 200) {
    throw new Error("Batch assignment limit is 200 tasks per operation.");
  }

  const db = asyncDb || getAsyncDb();

  // Validate target staff user exists, is active, and holds DELIVERY_PERSON role
  const staff = await db.queryOne<any>(`
    SELECT id, full_name as fullName, role, is_active as isActive
    FROM staff_users
    WHERE id = ?
  `, [assignedToStaffId]);

  if (!staff) {
    throw new Error(`Staff member '${assignedToStaffId}' not found.`);
  }
  if (!Boolean(staff.isActive)) {
    throw new Error(`Staff member '${staff.fullName}' is currently inactive and cannot receive delivery assignments.`);
  }
  if (staff.role !== "DELIVERY_PERSON") {
    throw new Error(
      `Staff member '${staff.fullName}' holds role '${staff.role}'. Only active DELIVERY_PERSON staff can be assigned delivery tasks.`
    );
  }

  // Fetch all requested tasks
  const inPlaceholders = taskIds.map(() => "?").join(", ");
  const taskRows = await db.query<any>(`
    SELECT * FROM delivery_tasks WHERE id IN (${inPlaceholders})
  `, taskIds);

  if (taskRows.length !== taskIds.length) {
    const foundIds = new Set(taskRows.map((r) => r.id));
    const missing = taskIds.filter((id) => !foundIds.has(id));
    throw new Error(`The following delivery task(s) were not found: ${missing.join(", ")}`);
  }

  // Safety checks across all selected tasks:
  for (const row of taskRows) {
    if (row.status === "DELIVERED") {
      throw new Error(`Task '${row.id}' (${row.customer_name || row.resident_name || "Room " + row.room_number}) has already been delivered and cannot be reassigned.`);
    }
    if (row.invoice_id) {
      throw new Error(`Task '${row.id}' is linked to an invoice (${row.invoice_id}) and cannot be reassigned.`);
    }
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const row of taskRows) {
      const currentTask = mapRowToDeliveryTask(row);
      const isReassignment = !!currentTask.assignedTo;
      const eventType: DeliveryEventType = isReassignment ? "REASSIGNED" : "ASSIGNED";
      const fromStatus = currentTask.status;
      const toStatus: DeliveryStatus = "ASSIGNED";
      const eventId = `devt_${crypto.randomUUID()}`;

      await tx.execute(`
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
      `, [
        staff.id,
        staff.fullName,
        actor.id,
        now,
        now,
        currentTask.id,
      ]);

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        eventId,
        currentTask.id,
        eventType,
        fromStatus,
        toStatus,
        actor.id,
        actor.fullName,
        isReassignment
          ? `Batch reassigned from ${currentTask.assignedToName || "prior staff"} to ${staff.fullName}`
          : `Batch assigned to ${staff.fullName}`,
        now,
      ]);
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.tasks_batch_assigned",
      targetType: "delivery_task_batch",
      targetId: staff.id,
      metadata: {
        assignedToStaffId: staff.id,
        assignedToStaffName: staff.fullName,
        taskCount: taskIds.length,
        taskIds,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedRows = await db.query<any>(`
    SELECT * FROM delivery_tasks WHERE id IN (${inPlaceholders})
  `, taskIds);

  return {
    assignedCount: updatedRows.length,
    assignedStaffId: staff.id,
    assignedStaffName: staff.fullName,
    tasks: updatedRows.map(mapRowToDeliveryTask),
  };
}

/**
 * Marks a task as OUT_FOR_DELIVERY (dispatched).
 * Delivery staff can only dispatch tasks assigned to themselves.
 * Requires delivery.update permission.
 */
export async function dispatchDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.task_dispatched" });

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
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

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE delivery_tasks
      SET
        status = 'OUT_FOR_DELIVERY',
        dispatched_at = ?,
        dispatched_by = ?,
        updated_at = ?
      WHERE id = ?
    `, [now, actor.id, now, taskId]);

    await tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'DISPATCHED', 'ASSIGNED', 'OUT_FOR_DELIVERY', ?, ?, ?, ?)
    `, [
      eventId,
      taskId,
      actor.id,
      actor.fullName,
      "Tiffin dispatched from kitchen and out for delivery",
      now,
    ]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

/**
 * Marks multiple delivery tasks as OUT_FOR_DELIVERY in a single atomic transaction.
 * Delivery personnel can only dispatch tasks assigned to themselves.
 * Requires delivery.update permission.
 */
export async function batchDispatchDeliveryTasks(
  actor: AuthenticatedUser,
  input: BatchDispatchDeliveryTasksInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<BatchDispatchDeliveryTasksResult> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.tasks_batch_dispatched" });

  const rawTaskIds = Array.isArray(input.taskIds) ? input.taskIds : [];
  const taskIds = Array.from(new Set(rawTaskIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)));

  if (taskIds.length === 0) {
    throw new Error("At least one valid delivery task ID must be provided for batch dispatch.");
  }
  if (taskIds.length > 200) {
    throw new Error("Batch dispatch limit is 200 tasks per operation.");
  }

  const db = asyncDb || getAsyncDb();

  const inPlaceholders = taskIds.map(() => "?").join(", ");
  const taskRows = await db.query<any>(`
    SELECT * FROM delivery_tasks WHERE id IN (${inPlaceholders})
  `, taskIds);

  if (taskRows.length !== taskIds.length) {
    const foundIds = new Set(taskRows.map((r) => r.id));
    const missing = taskIds.filter((id) => !foundIds.has(id));
    throw new Error(`The following delivery task(s) were not found: ${missing.join(", ")}`);
  }

  // Pre-validate all tasks
  for (const row of taskRows) {
    const task = mapRowToDeliveryTask(row);

    // Ownership check: delivery persons can only dispatch tasks assigned to them
    if (actor.role === "DELIVERY_PERSON" && task.assignedTo !== actor.id) {
      throw new AuthorizationError(403, `You are not assigned to delivery task '${task.id}'.`);
    }

    if (!task.assignedTo) {
      throw new Error(`Task '${task.id}' must be assigned to a delivery person before it can be dispatched.`);
    }

    if (task.status === "DELIVERED") {
      throw new Error(`Task '${task.id}' has already been delivered.`);
    }

    if (task.status !== "ASSIGNED" && task.status !== "OUT_FOR_DELIVERY") {
      throw new Error(`Cannot dispatch task '${task.id}' in status '${task.status}'. Task must be in ASSIGNED status.`);
    }
  }

  const now = new Date().toISOString();
  let dispatchedCount = 0;

  await db.transaction(async (tx) => {
    for (const row of taskRows) {
      const task = mapRowToDeliveryTask(row);

      // Idempotent dispatch: if already OUT_FOR_DELIVERY, leave as is
      if (task.status === "OUT_FOR_DELIVERY") {
        continue;
      }

      const eventId = `devt_${crypto.randomUUID()}`;

      await tx.execute(`
        UPDATE delivery_tasks
        SET
          status = 'OUT_FOR_DELIVERY',
          dispatched_at = ?,
          dispatched_by = ?,
          updated_at = ?
        WHERE id = ?
      `, [now, actor.id, now, task.id]);

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, 'DISPATCHED', 'ASSIGNED', 'OUT_FOR_DELIVERY', ?, ?, ?, ?)
      `, [
        eventId,
        task.id,
        actor.id,
        actor.fullName,
        "Batch dispatched from kitchen and out for delivery",
        now,
      ]);

      dispatchedCount++;
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.tasks_batch_dispatched",
      targetType: "delivery_task_batch",
      targetId: actor.id,
      metadata: {
        taskCount: taskIds.length,
        dispatchedCount,
        taskIds,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedRows = await db.query<any>(`
    SELECT * FROM delivery_tasks WHERE id IN (${inPlaceholders})
  `, taskIds);

  return {
    dispatchedCount,
    tasks: updatedRows.map(mapRowToDeliveryTask),
  };
}

/**
 * Marks a task as DELIVERED upon successful handover to the resident.
 * Records delivery timestamp, actor attribution, and optional recipient verification.
 * Requires delivery.update permission.
 */
export async function completeDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input?: CompleteDeliveryTaskInput,
  clientIpOrDb?: string | AsyncDb,
  maybeDb?: AsyncDb
): Promise<DeliveryTask> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const asyncDb = typeof clientIpOrDb === "object" ? clientIpOrDb : maybeDb;

  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.task_delivered" });

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);

  // Ownership check: delivery persons can only complete tasks assigned to them
  if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You are not assigned to this delivery task.");
  }

  if (!currentTask.assignedTo) {
    if (actor.role === "SUPER_ADMIN" || actor.role === "OPERATIONS_MANAGER") {
      const defaultDriver = await getDefaultDeliveryStaff(db);
      const targetStaffId = defaultDriver ? defaultDriver.id : actor.id;
      const targetStaffName = defaultDriver ? defaultDriver.fullName : actor.fullName;
      const assignNow = new Date().toISOString();
      await db.execute(`
        UPDATE delivery_tasks
        SET assigned_to = ?, assigned_to_name = ?, assigned_by = ?, assigned_at = ?, updated_at = ?
        WHERE id = ?
      `, [targetStaffId, targetStaffName, actor.id, assignNow, assignNow, taskId]);
      currentTask.assignedTo = targetStaffId;
      currentTask.assignedToName = targetStaffName;
    } else {
      throw new Error("Task must be assigned to a delivery person before it can be marked as delivered.");
    }
  }

  // Idempotent delivery
  if (currentTask.status === "DELIVERED") {
    return currentTask;
  }

  if (currentTask.status === "EXCEPTION") {
    throw new Error("Task is currently in EXCEPTION status. It must be retried or reassigned before delivery.");
  }

  const recipientName = input?.recipientName?.trim() || null;
  const rawNotes = input?.notes?.trim() || null;
  const deliveredQty = input?.deliveredQuantity !== undefined && !isNaN(Number(input.deliveredQuantity)) ? Number(input.deliveredQuantity) : undefined;
  const undeliveredQty = input?.undeliveredQuantity !== undefined && !isNaN(Number(input.undeliveredQuantity)) ? Number(input.undeliveredQuantity) : undefined;
  const undeliveredReason = input?.undeliveredReason?.trim() || undefined;

  // Validation: If any portion is undelivered, require reason
  if (undeliveredQty !== undefined && undeliveredQty > 0 && !undeliveredReason) {
    throw new Error("Reason is required when portions remain undelivered.");
  }

  let qtyInfo = "";
  if (input?.itemsReconciliation && input.itemsReconciliation.length > 0) {
    const lines = input.itemsReconciliation.map((r) =>
      `${r.productName}: ${r.deliveredQuantity}/${r.orderedQuantity} delivered (₹${r.unitPrice * r.deliveredQuantity})${r.undeliveredQuantity > 0 ? ` [Undelivered: ${r.undeliveredQuantity} portions undelivered - ${r.undeliveredReason || undeliveredReason || "Shortfall"}]` : ""}`
    );
    qtyInfo = `[Recon - ${lines.join("; ")}]`;
  } else if (deliveredQty !== undefined || undeliveredQty !== undefined) {
    const parts: string[] = [];
    if (deliveredQty !== undefined) parts.push(`Delivered: ${deliveredQty}`);
    if (undeliveredQty !== undefined) parts.push(`Undelivered: ${undeliveredQty} portions undelivered`);
    if (undeliveredReason) parts.push(`Reason: ${undeliveredReason}`);
    qtyInfo = `[Qty - ${parts.join(", ")}]`;
  }
  // Preserve any [ORDER_JSON:...] block if present in raw DB row
  const rawDbNotes = taskRow.delivery_notes || "";
  const jsonMatch = rawDbNotes.match(/\[ORDER_JSON:\{[\s\S]*?\}\]/);
  const jsonPrefix = jsonMatch ? jsonMatch[0] : "";
  const cleanPriorNotes = extractCleanUserNotes(rawDbNotes) || "";
  const newNotes = [rawNotes, qtyInfo].filter(Boolean).join(" ");
  const combinedHumanNotes = [cleanPriorNotes, newNotes].filter(Boolean).join(" ");
  const deliveryNotes = [jsonPrefix, combinedHumanNotes].filter(Boolean).join(" ") || null;

  const hasCollection = input?.collectedAmount !== undefined && input?.collectedAmount !== null && Number(input.collectedAmount) > 0;
  let collectedAmount = 0;
  let collectedPaymentMethod: PaymentMethod | null = null;
  let collectionStatus: DeliveryCollectionStatus = currentTask.collectionStatus || "NONE";
  let collectionIdempotencyKey: string | null = null;

  if (hasCollection) {
    collectedAmount = Math.round(Number(input!.collectedAmount));
    if (collectedAmount <= 0) {
      throw new Error("Collected amount must be a positive integer.");
    }
    collectedPaymentMethod = normalizePaymentMethod(input!.paymentMethod || "CASH");
    collectionStatus = "COLLECTED";
    collectionIdempotencyKey = input?.idempotencyKey?.trim() || `dcol_${crypto.randomUUID()}`;
  }

  const isZeroDelivered = deliveredQty === 0 && (undeliveredQty || 0) > 0;
  const finalStatus: DeliveryStatus = isZeroDelivered ? "EXCEPTION" : "DELIVERED";
  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  // Completion is applied at most once. The status guard in each UPDATE makes a concurrent
  // duplicate (online retry racing an offline replay, double tap) a no-op instead of a
  // second write with duplicate events/audit rows.
  await db.transaction(async (tx) => {
    if (isZeroDelivered) {
      const applied = await tx.execute(`
        UPDATE delivery_tasks
        SET
          status = 'EXCEPTION',
          exception_type = 'OTHER',
          exception_reason = ?,
          exception_at = ?,
          exception_by = ?,
          delivery_notes = ?,
          updated_at = ?
        WHERE id = ? AND status NOT IN ('DELIVERED', 'EXCEPTION')
      `, [
        undeliveredReason || "Zero delivered portions",
        now,
        actor.id,
        deliveryNotes,
        now,
        taskId,
      ]);
      if (applied.changes === 0) return;

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, 'EXCEPTION', ?, 'EXCEPTION', ?, ?, ?, ?)
      `, [
        eventId,
        taskId,
        currentTask.status,
        actor.id,
        actor.fullName,
        `Zero delivered: ${undeliveredReason || "Declined at door"}.${deliveryNotes ? ` Note: ${deliveryNotes}` : ""}`,
        now,
      ]);
    } else {
      const applied = await tx.execute(`
        UPDATE delivery_tasks
        SET
          status = 'DELIVERED',
          delivered_at = ?,
          delivered_by = ?,
          recipient_name = ?,
          delivery_notes = ?,
          collection_status = ?,
          collected_amount = ?,
          collected_payment_method = ?,
          collection_idempotency_key = COALESCE(?, collection_idempotency_key),
          updated_at = ?
        WHERE id = ? AND status NOT IN ('DELIVERED', 'EXCEPTION')
      `, [
        now,
        actor.id,
        recipientName,
        deliveryNotes,
        collectionStatus,
        collectedAmount,
        collectedPaymentMethod,
        collectionIdempotencyKey,
        now,
        taskId,
      ]);
      if (applied.changes === 0) return;

      const eventNotes = hasCollection
        ? `${recipientName ? `Handed over to ${recipientName}.` : "Handed over."} Collected ₹${collectedAmount} via ${collectedPaymentMethod}.${deliveryNotes ? ` Note: ${deliveryNotes}` : ""}`
        : (recipientName ? `Handed over to ${recipientName}` : "Handed over to resident");

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, 'DELIVERED', ?, 'DELIVERED', ?, ?, ?, ?)
      `, [
        eventId,
        taskId,
        currentTask.status,
        actor.id,
        actor.fullName,
        eventNotes,
        now,
      ]);
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: isZeroDelivered ? "delivery.task_exception" : "delivery.task_delivered",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        roomNumber: currentTask.roomNumber,
        serviceDate: currentTask.serviceDate,
        mealType: currentTask.mealType,
        recipientName,
        deliveredAt: now,
        hasCollection,
        collectedAmount,
        collectedPaymentMethod,
        collectionStatus,
        deliveredQuantity: deliveredQty,
        undeliveredQuantity: undeliveredQty !== undefined ? undeliveredQty : null,
        undeliveredReason,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

/**
 * Reports a delivery exception using controlled categories and mandatory reason.
 * Does NOT delete the task; records exception state and detailed history for review/retry.
 * Requires delivery.update permission.
 */
export async function reportDeliveryException(
  actor: AuthenticatedUser,
  taskId: string,
  input: ReportDeliveryExceptionInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
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

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
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
  if (currentTask.invoiceId) {
    throw new Error("Task is linked to an invoice and cannot be marked as an exception.");
  }

  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE delivery_tasks
      SET
        status = 'EXCEPTION',
        exception_type = ?,
        exception_reason = ?,
        exception_at = ?,
        exception_by = ?,
        updated_at = ?
      WHERE id = ?
    `, [
      exceptionType,
      reason,
      now,
      actor.id,
      now,
      taskId,
    ]);

    await tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'EXCEPTION', ?, 'EXCEPTION', ?, ?, ?, ?)
    `, [
      eventId,
      taskId,
      currentTask.status,
      actor.id,
      actor.fullName,
      `Exception [${exceptionType}]: ${reason}`,
      now,
    ]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

/**
 * Retries an exception task, resetting it to ASSIGNED status for redelivery.
 * Optionally reassigns to another delivery staff member.
 * Requires delivery.manage permission.
 */
export async function retryDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input?: RetryDeliveryTaskInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.task_retried" });

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
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
    const staff = await db.queryOne<any>(`
      SELECT id, full_name as fullName, role, is_active as isActive
      FROM staff_users
      WHERE id = ?
    `, [input.reassignToStaffId.trim()]);

    if (!staff || !Boolean(staff.isActive) || staff.role !== "DELIVERY_PERSON") {
      throw new Error(`Staff member '${input.reassignToStaffId}' is not an active delivery person.`);
    }

    targetStaffId = staff.id;
    targetStaffName = staff.fullName;
  }

  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;
  const notes = input?.notes?.trim() || `Retried by management${input?.reassignToStaffId ? ` and reassigned to ${targetStaffName}` : ""}`;

  await db.transaction(async (tx) => {
    await tx.execute(`
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
    `, [
      targetStaffId,
      targetStaffName,
      actor.id,
      now,
      now,
      taskId,
    ]);

    await tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'RETRIED', 'EXCEPTION', 'ASSIGNED', ?, ?, ?, ?)
    `, [
      eventId,
      taskId,
      actor.id,
      actor.fullName,
      notes,
      now,
    ]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

/**
 * Lists delivery tasks with optional date, meal, and status filters.
 * Delivery personnel are strictly restricted to tasks assigned to themselves.
 * Requires delivery.read permission.
 */
export async function listDeliveryTasks(
  actor: AuthenticatedUser,
  options?: ListDeliveryTasksOptions,
  asyncDb?: AsyncDb
): Promise<DeliveryTask[]> {
  requirePermission(actor, "delivery.read");

  const db = asyncDb || getAsyncDb();
  const conditions: string[] = [];
  const params: any[] = [];

  // Strict ownership isolation: Delivery Person can ONLY view their assigned tasks
  if (actor.role === "DELIVERY_PERSON") {
    conditions.push("assigned_to = ?");
    params.push(actor.id);
  } else if (options?.assignedTo) {
    if (options.assignedTo === "UNASSIGNED") {
      conditions.push("assigned_to IS NULL");
    } else {
      conditions.push("assigned_to = ?");
      params.push(options.assignedTo);
    }
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
  if (options?.search?.trim()) {
    const q = `%${options.search.trim().toLowerCase()}%`;
    conditions.push(`(
      LOWER(resident_name) LIKE ? OR
      LOWER(customer_name) LIKE ? OR
      LOWER(room_number) LIKE ? OR
      LOWER(delivery_address) LIKE ? OR
      LOWER(customer_phone) LIKE ?
    )`);
    params.push(q, q, q, q, q);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, Number(options?.limit) || 200));
  const offset = Math.max(0, Number(options?.offset) || 0);

  const rows = await db.query<any>(`
    SELECT *
    FROM delivery_tasks
    ${whereClause}
    ORDER BY service_date DESC, floor ASC, room_number ASC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  return rows.map(mapRowToDeliveryTask);
}

/**
 * Retrieves a single delivery task along with its full event timeline.
 * Enforces ownership restrictions for delivery personnel.
 * Requires delivery.read permission.
 */
export async function getDeliveryTaskById(
  actor: AuthenticatedUser,
  taskId: string,
  asyncDb?: AsyncDb
): Promise<{ task: DeliveryTask; events: DeliveryTaskEvent[] } | null> {
  requirePermission(actor, "delivery.read");

  const db = asyncDb || getAsyncDb();
  const row = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!row) return null;

  const task = mapRowToDeliveryTask(row);

  // Ownership isolation: Delivery Person cannot view tasks assigned to others
  if (actor.role === "DELIVERY_PERSON" && task.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You do not have permission to view this delivery task.");
  }

  const eventRows = await db.query<any>(`
    SELECT *
    FROM delivery_task_events
    WHERE task_id = ?
    ORDER BY created_at ASC
  `, [taskId]);

  return {
    task,
    events: eventRows.map(mapRowToDeliveryEvent),
  };
}

/**
 * Calculates delivery dashboard metrics and staff workload breakdown.
 * Requires delivery.read permission.
 */
export async function getDeliveryDashboardSummary(
  actor: AuthenticatedUser,
  serviceDate: string,
  mealType?: MealType | "ALL",
  asyncDb?: AsyncDb
): Promise<DeliveryDashboardSummary> {
  requirePermission(actor, "delivery.read");

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }

  const db = asyncDb || getAsyncDb();
  const conditions = ["service_date = ?"];
  const params: any[] = [serviceDate];

  if (mealType && mealType !== "ALL" && VALID_MEAL_TYPES.includes(mealType)) {
    conditions.push("meal_type = ?");
    params.push(mealType);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countsRow = await db.queryOne<any>(`
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
  `, params);

  // Active delivery personnel workload (using cross-engine compatible is_active = 1)
  const staffRows = await db.query<any>(`
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
  `, [serviceDate]);

  return {
    serviceDate,
    mealType: mealType || "ALL",
    totalTasks: Number(countsRow?.totalTasks) || 0,
    pendingCount: Number(countsRow?.pendingCount) || 0,
    assignedCount: Number(countsRow?.assignedCount) || 0,
    outForDeliveryCount: Number(countsRow?.outForDeliveryCount) || 0,
    deliveredCount: Number(countsRow?.deliveredCount) || 0,
    exceptionCount: Number(countsRow?.exceptionCount) || 0,
    unassignedCount: Number(countsRow?.unassignedCount) || 0,
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
export async function listActiveDeliveryStaff(
  actor: AuthenticatedUser,
  asyncDb?: AsyncDb
): Promise<Array<{
  id: string;
  fullName: string;
  username: string;
}>> {
  requirePermission(actor, "delivery.read");

  const db = asyncDb || getAsyncDb();
  const rows = await db.query<any>(`
    SELECT id, full_name as fullName, username
    FROM staff_users
    WHERE role = 'DELIVERY_PERSON' AND is_active = 1
    ORDER BY full_name ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    username: r.username,
  }));
}

/**
 * Resolves the default delivery person for auto-assigned orders.
 *
 * 1. ERP_DEFAULT_DELIVERY_USERNAME, when set and pointing at an active DELIVERY_PERSON.
 * 2. Otherwise the longest-serving active DELIVERY_PERSON (the single-driver setup).
 * Never matches on personal names and never returns a non-delivery role.
 */
export async function getDefaultDeliveryStaff(
  asyncDb?: AsyncDb
): Promise<{ id: string; fullName: string; username: string } | null> {
  const db = asyncDb || getAsyncDb();
  const configured = process.env.ERP_DEFAULT_DELIVERY_USERNAME?.trim().toLowerCase();
  if (configured) {
    const row = await db.queryOne<{ id: string; fullName: string; username: string }>(`
      SELECT id, full_name as fullName, username
      FROM staff_users
      WHERE role = 'DELIVERY_PERSON' AND is_active = 1 AND lower(username) = ?
    `, [configured]);
    if (row) return row;
  }
  const row = await db.queryOne<{ id: string; fullName: string; username: string }>(`
    SELECT id, full_name as fullName, username
    FROM staff_users
    WHERE role = 'DELIVERY_PERSON' AND is_active = 1
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `);
  return row || null;
}

/** @deprecated Use getDefaultDeliveryStaff. Kept for existing callers. */
export const getCanonicalSureshDeliveryStaff = getDefaultDeliveryStaff;

/**
 * Records a payment collection directly for a delivery task.
 * Requires delivery.update permission.
 */
export async function recordDeliveryCollection(
  actor: AuthenticatedUser,
  taskId: string,
  input: RecordDeliveryCollectionInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.collection_recorded" });

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);

  if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You are not assigned to this delivery task.");
  }

  if (currentTask.collectionStatus === "HANDED_OVER") {
    throw new Error("Cannot modify collection for a task whose cash has already been handed over to office.");
  }

  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey && currentTask.collectionIdempotencyKey === idempotencyKey) {
    return currentTask;
  }

  const collectedAmount = Math.round(Number(input.collectedAmount));
  if (collectedAmount <= 0) {
    throw new Error("Collected amount must be a positive integer.");
  }

  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  const notes = input.notes?.trim() || null;
  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE delivery_tasks
      SET
        collection_status = 'COLLECTED',
        collected_amount = ?,
        collected_payment_method = ?,
        collection_idempotency_key = COALESCE(?, collection_idempotency_key),
        updated_at = ?
      WHERE id = ?
    `, [
      collectedAmount,
      paymentMethod,
      idempotencyKey || `dcol_${crypto.randomUUID()}`,
      now,
      taskId,
    ]);

    await tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'DELIVERED', ?, ?, ?, ?, ?, ?)
    `, [
      eventId,
      taskId,
      currentTask.status,
      currentTask.status,
      actor.id,
      actor.fullName,
      `Doorstep collection recorded: ₹${collectedAmount} via ${paymentMethod}.${notes ? ` Note: ${notes}` : ""}`,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.collection_recorded",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        collectedAmount,
        paymentMethod,
        collectionStatus: "COLLECTED",
        serviceDate: currentTask.serviceDate,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedDetail = await getDeliveryTaskById(actor, taskId, db);
  return updatedDetail!.task;
}

/**
 * Creates a driver cash handover declaration.
 * A driver declares the physical cash collected for a shift before verification.
 * Requires delivery.update permission.
 */
export async function createCashHandoverDeclaration(
  actor: AuthenticatedUser,
  input: DeclareCashHandoverInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DriverCashHandover> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.cash_handover_declared" });

  const targetDriverId =
    actor.role === "DELIVERY_PERSON" ? actor.id : input.driverId?.trim() || actor.id;

  const shiftDate = input.shiftDate?.trim();
  if (!shiftDate || !DATE_REGEX.test(shiftDate)) {
    throw new Error("Valid shift date in YYYY-MM-DD format is required.");
  }

  const declaredCash = Math.round(Number(input.declaredCash));
  if (isNaN(declaredCash) || declaredCash < 0) {
    throw new Error("Declared cash amount cannot be negative.");
  }

  const db = asyncDb || getAsyncDb();

  const driver = await db.queryOne<any>(`
    SELECT id, full_name as fullName, role, is_active as isActive
    FROM staff_users
    WHERE id = ?
  `, [targetDriverId]);

  if (!driver) {
    throw new Error(`Staff member '${targetDriverId}' not found.`);
  }
  if (!Boolean(driver.isActive)) {
    throw new Error(`Staff member '${driver.fullName}' is currently inactive.`);
  }

  const handoverId = `dch_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const notes = input.notes?.trim() || null;

  await db.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO driver_cash_handovers (
        id, driver_id, shift_date, declared_cash, accepted_cash,
        variance, variance_reason, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, NULL, 'DECLARED', ?, ?, ?)
    `, [
      handoverId,
      driver.id,
      shiftDate,
      declaredCash,
      notes,
      now,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.cash_handover_declared",
      targetType: "driver_cash_handover",
      targetId: handoverId,
      metadata: {
        driverId: driver.id,
        driverName: driver.fullName,
        shiftDate,
        declaredCash,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const row = await db.queryOne<any>(`
    SELECT h.*, u.full_name as driver_name
    FROM driver_cash_handovers h
    JOIN staff_users u ON u.id = h.driver_id
    WHERE h.id = ?
  `, [handoverId]);

  return mapRowToDriverCashHandover(row);
}

/**
 * Accepts and settles a driver cash handover.
 * Verifies physical cash, notes variances, links delivery tasks, and posts to authoritative Cashbook.
 * Requires delivery.manage or finance.manage permission.
 */
export async function acceptCashHandover(
  actor: AuthenticatedUser,
  handoverId: string,
  input: AcceptCashHandoverInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DriverCashHandover> {
  // Check permission
  const hasDelivery = actor.role === "SUPER_ADMIN" || actor.role === "OPERATIONS_MANAGER" || actor.role === "ACCOUNTANT";
  if (!hasDelivery) {
    throw new AuthorizationError(403, "You do not have permission to verify and accept driver cash handovers.");
  }

  const db = asyncDb || getAsyncDb();

  const handoverRow = await db.queryOne<any>(`
    SELECT h.*, u.full_name as driver_name
    FROM driver_cash_handovers h
    JOIN staff_users u ON u.id = h.driver_id
    WHERE h.id = ?
  `, [handoverId]);

  if (!handoverRow) {
    throw new Error(`Cash handover '${handoverId}' not found.`);
  }

  // Separation of duties: driver cannot accept their own handover unless super admin
  if (actor.id === handoverRow.driver_id && actor.role !== "SUPER_ADMIN") {
    throw new AuthorizationError(403, "Delivery personnel cannot accept their own cash handover. An accountant or manager must verify and accept cash.");
  }

  if (handoverRow.status === "ACCEPTED") {
    throw new Error("This cash handover has already been accepted and settled.");
  }

  const acceptedCash = Math.round(Number(input.acceptedCash));
  if (isNaN(acceptedCash) || acceptedCash < 0) {
    throw new Error("Accepted cash amount cannot be negative.");
  }

  const declaredCash = Number(handoverRow.declared_cash || 0);
  const variance = acceptedCash - declaredCash;
  const varianceReason = input.varianceReason?.trim() || null;

  if (variance !== 0 && (!varianceReason || varianceReason.length < 5)) {
    throw new Error(
      `Accepted cash (₹${acceptedCash}) differs from declared cash (₹${declaredCash}) by ₹${variance}. A variance explanation of at least 5 characters is mandatory.`
    );
  }

  const now = new Date().toISOString();
  let transactionId: string | null = null;

  await db.transaction(async (tx) => {
    // Enforce closing lock: if shift date is already finalized for TIFFIN or COMBINED, reject acceptance
    await assertClosingDateNotFinalized(tx, handoverRow.shift_date, "TIFFIN");

    // 1. Post to authoritative cashbook ledger if cash received > 0
    if (acceptedCash > 0) {
      transactionId = `tx_dch_${crypto.randomUUID()}`;
      const desc = `Driver cash handover for ${handoverRow.driver_name} (${handoverRow.shift_date}). Declared: ₹${declaredCash}, Accepted: ₹${acceptedCash}${variance !== 0 ? ` (Variance: ₹${variance})` : ""}`;

      await tx.execute(`
        INSERT INTO financial_transactions (
          id, transaction_type, amount, transaction_date, payment_method,
          reference_number, resident_id, customer_id, stay_id, category,
          description, billing_period, payee_vendor, idempotency_key,
          status, reversal_of_id, invoice_id, created_by, created_at, updated_at
        ) VALUES (
          ?, 'TIFFIN_PAYMENT', ?, ?, 'CASH',
          ?, NULL, NULL, NULL, 'TIFFIN_DELIVERY_COLLECTION',
          ?, ?, NULL, ?,
          'POSTED', NULL, NULL, ?, ?, ?
        )
      `, [
        transactionId,
        acceptedCash,
        handoverRow.shift_date,
        handoverId,
        desc,
        handoverRow.shift_date,
        `dch_tx_${handoverId}`,
        actor.id,
        now,
        now,
      ]);
    }

    // 2. Mark collected cash delivery tasks as HANDED_OVER
    await tx.execute(`
      UPDATE delivery_tasks
      SET
        collection_status = 'HANDED_OVER',
        handover_id = ?,
        updated_at = ?
      WHERE assigned_to = ?
        AND service_date = ?
        AND collection_status = 'COLLECTED'
        AND collected_payment_method = 'CASH'
    `, [
      handoverId,
      now,
      handoverRow.driver_id,
      handoverRow.shift_date,
    ]);

    // 3. Update driver cash handover record with optimistic status concurrency check
    const updateRes = await tx.execute(`
      UPDATE driver_cash_handovers
      SET
        accepted_cash = ?,
        variance = ?,
        variance_reason = ?,
        status = 'ACCEPTED',
        transaction_id = ?,
        accepted_by = ?,
        accepted_at = ?,
        notes = COALESCE(?, notes),
        updated_at = ?
      WHERE id = ? AND status = 'DECLARED'
    `, [
      acceptedCash,
      variance,
      varianceReason,
      transactionId,
      actor.id,
      now,
      input.notes?.trim() || null,
      now,
      handoverId,
    ]);

    if (updateRes.changes === 0) {
      throw new Error(`Cash handover '${handoverId}' is not in DECLARED status or has already been accepted.`);
    }

    // 4. Audit trail
    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.cash_handover_accepted",
      targetType: "driver_cash_handover",
      targetId: handoverId,
      metadata: {
        driverId: handoverRow.driver_id,
        shiftDate: handoverRow.shift_date,
        declaredCash,
        acceptedCash,
        variance,
        varianceReason,
        transactionId,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedRow = await db.queryOne<any>(`
    SELECT h.*, u.full_name as driver_name, a.full_name as accepted_by_name
    FROM driver_cash_handovers h
    JOIN staff_users u ON u.id = h.driver_id
    LEFT JOIN staff_users a ON a.id = h.accepted_by
    WHERE h.id = ?
  `, [handoverId]);

  return mapRowToDriverCashHandover(updatedRow);
}

/**
 * Returns a live custody summary of physical cash held by a driver.
 * Requires delivery.read permission.
 */
export async function getDriverCustodySummary(
  actor: AuthenticatedUser,
  driverId: string,
  shiftDate: string,
  asyncDb?: AsyncDb
): Promise<DriverCustodySummary> {
  if (!hasPermission(actor.role, "delivery.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }

  if (actor.role === "DELIVERY_PERSON" && actor.id !== driverId) {
    throw new AuthorizationError(403, "You can only view your own cash custody summary.");
  }

  const db = asyncDb || getAsyncDb();

  const driver = await db.queryOne<any>(`
    SELECT id, full_name as fullName FROM staff_users WHERE id = ?
  `, [driverId]);

  if (!driver) {
    throw new Error(`Staff member '${driverId}' not found.`);
  }

  // 1. Total cash collected on tasks for this shift
  const collectedRow = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(collected_amount), 0) as total_collected
    FROM delivery_tasks
    WHERE assigned_to = ?
      AND service_date = ?
      AND collected_payment_method = 'CASH'
      AND collection_status IN ('COLLECTED', 'HANDED_OVER')
  `, [driverId, shiftDate]);

  // 2. Pending cash collected but not yet handed over
  const pendingRow = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(collected_amount), 0) as cash_in_custody,
      COUNT(*) as pending_count
    FROM delivery_tasks
    WHERE assigned_to = ?
      AND service_date = ?
      AND collected_payment_method = 'CASH'
      AND collection_status = 'COLLECTED'
  `, [driverId, shiftDate]);

  // 3. Total accepted cash handovers for this shift
  const acceptedRow = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(accepted_cash), 0) as total_accepted
    FROM driver_cash_handovers
    WHERE driver_id = ?
      AND shift_date = ?
      AND status = 'ACCEPTED'
  `, [driverId, shiftDate]);

  return {
    driverId: driver.id,
    driverName: driver.fullName,
    shiftDate,
    totalCashCollected: Number(collectedRow?.total_collected || 0),
    totalAcceptedHandover: Number(acceptedRow?.total_accepted || 0),
    cashInCustody: Number(pendingRow?.cash_in_custody || 0),
    pendingCollectionTasksCount: Number(pendingRow?.pending_count || 0),
  };
}

/**
 * Returns an aggregate custody summary across all active delivery personnel for a shift date.
 * Requires delivery.read or finance.read permission.
 */
export async function getFleetCustodySummary(
  actor: AuthenticatedUser,
  shiftDate: string,
  asyncDb?: AsyncDb
): Promise<DriverCustodySummary & { activeDriverCount: number }> {
  if (!hasPermission(actor.role, "delivery.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }

  const db = asyncDb || getAsyncDb();

  const collectedRow = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(collected_amount), 0) as total_collected
    FROM delivery_tasks
    WHERE service_date = ?
      AND collected_payment_method = 'CASH'
      AND collection_status IN ('COLLECTED', 'HANDED_OVER')
  `, [shiftDate]);

  const pendingRow = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(collected_amount), 0) as cash_in_custody,
      COUNT(*) as pending_count
    FROM delivery_tasks
    WHERE service_date = ?
      AND collected_payment_method = 'CASH'
      AND collection_status = 'COLLECTED'
  `, [shiftDate]);

  const acceptedRow = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(accepted_cash), 0) as total_accepted
    FROM driver_cash_handovers
    WHERE shift_date = ?
      AND status = 'ACCEPTED'
  `, [shiftDate]);

  const driversRow = await db.queryOne<any>(`
    SELECT COUNT(*) as count FROM staff_users WHERE role = 'DELIVERY_PERSON' AND is_active = 1
  `);

  return {
    driverId: "FLEET_AGGREGATE",
    driverName: "All Delivery Drivers",
    shiftDate,
    totalCashCollected: Number(collectedRow?.total_collected || 0),
    totalAcceptedHandover: Number(acceptedRow?.total_accepted || 0),
    cashInCustody: Number(pendingRow?.cash_in_custody || 0),
    pendingCollectionTasksCount: Number(pendingRow?.pending_count || 0),
    activeDriverCount: Number(driversRow?.count || 0),
  };
}

/**
 * Lists cash handover declarations.
 * Requires delivery.read permission.
 */
export async function listDriverCashHandovers(
  actor: AuthenticatedUser,
  filters?: { driverId?: string; shiftDate?: string; status?: DriverHandoverStatus },
  asyncDb?: AsyncDb
): Promise<DriverCashHandover[]> {
  if (!hasPermission(actor.role, "delivery.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }

  const db = asyncDb || getAsyncDb();

  const conditions: string[] = [];
  const params: any[] = [];

  const targetDriver =
    actor.role === "DELIVERY_PERSON" ? actor.id : filters?.driverId?.trim();

  if (targetDriver) {
    conditions.push("h.driver_id = ?");
    params.push(targetDriver);
  }

  if (filters?.shiftDate?.trim()) {
    conditions.push("h.shift_date = ?");
    params.push(filters.shiftDate.trim());
  }

  if (filters?.status?.trim()) {
    conditions.push("h.status = ?");
    params.push(filters.status.trim());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await db.query<any>(`
    SELECT
      h.*,
      u.full_name as driver_name,
      a.full_name as accepted_by_name
    FROM driver_cash_handovers h
    JOIN staff_users u ON u.id = h.driver_id
    LEFT JOIN staff_users a ON a.id = h.accepted_by
    ${whereClause}
    ORDER BY h.created_at DESC
  `, params);

  return rows.map(mapRowToDriverCashHandover);
}

/**
 * Synchronizes offline-queued delivery actions in batch with conflict detection.
 * Returns per-item sync statuses: SYNCED, IDEMPOTENT_IGNORED, CONFLICT, or ERROR.
 */
export async function syncDeliveryActions(
  actor: AuthenticatedUser,
  actions: QueuedDeliveryAction[],
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<{
  results: Array<{
    actionId: string;
    success: boolean;
    taskId?: string;
    status: "SYNCED" | "IDEMPOTENT_IGNORED" | "CONFLICT" | "ERROR";
    error?: string;
    task?: DeliveryTask;
  }>;
}> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.offline_sync" });

  const db = asyncDb || getAsyncDb();
  const results: Array<{
    actionId: string;
    success: boolean;
    taskId?: string;
    status: "SYNCED" | "IDEMPOTENT_IGNORED" | "CONFLICT" | "ERROR";
    error?: string;
    task?: DeliveryTask;
  }> = [];

  for (const item of actions) {
    try {
      if (!item.taskId) {
        results.push({
          actionId: item.id,
          success: false,
          status: "ERROR",
          error: "Missing taskId in queued action.",
        });
        continue;
      }

      // Security Invariant: Account context isolation
      if (item.userId && item.userId !== actor.id) {
        results.push({
          actionId: item.id,
          success: false,
          taskId: item.taskId,
          status: "CONFLICT",
          error: "Security violation: Action was queued by a different authenticated account and cannot be synchronized under this session.",
        });
        continue;
      }

      const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [item.taskId]);
      if (!taskRow) {
        results.push({
          actionId: item.id,
          success: false,
          taskId: item.taskId,
          status: "ERROR",
          error: `Task '${item.taskId}' was not found on server.`,
        });
        continue;
      }

      const currentTask = mapRowToDeliveryTask(taskRow);

      if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
        results.push({
          actionId: item.id,
          success: false,
          taskId: item.taskId,
          status: "CONFLICT",
          error: "Task has been reassigned to another delivery person.",
          task: currentTask,
        });
        continue;
      }

      if (item.action === "COMPLETE_DELIVERY") {
        if (currentTask.status === "DELIVERED") {
          // Idempotent: already delivered by this driver
          results.push({
            actionId: item.id,
            success: true,
            taskId: item.taskId,
            status: "IDEMPOTENT_IGNORED",
            task: currentTask,
          });
          continue;
        }

        if (currentTask.status === "EXCEPTION") {
          results.push({
            actionId: item.id,
            success: false,
            taskId: item.taskId,
            status: "CONFLICT",
            error: "Task is in EXCEPTION state on server. Must be retried before delivery.",
            task: currentTask,
          });
          continue;
        }

        const completed = await completeDeliveryTask(
          actor,
          item.taskId,
          {
            recipientName: item.payload?.recipientName,
            notes: item.payload?.notes,
            collectedAmount: item.payload?.collectedAmount,
            paymentMethod: item.payload?.paymentMethod,
            idempotencyKey: item.idempotencyKey,
            // Partial-delivery fields must survive the offline path exactly as the online route passes them.
            deliveredQuantity:
              item.payload?.deliveredQuantity !== undefined ? Number(item.payload.deliveredQuantity) : undefined,
            undeliveredQuantity:
              item.payload?.undeliveredQuantity !== undefined ? Number(item.payload.undeliveredQuantity) : undefined,
            undeliveredReason: item.payload?.undeliveredReason,
            itemsReconciliation: Array.isArray(item.payload?.itemsReconciliation)
              ? item.payload.itemsReconciliation
              : undefined,
          },
          clientIp,
          db
        );

        results.push({
          actionId: item.id,
          success: true,
          taskId: item.taskId,
          status: "SYNCED",
          task: completed,
        });
      } else if (item.action === "REPORT_EXCEPTION") {
        if (currentTask.status === "EXCEPTION") {
          results.push({
            actionId: item.id,
            success: true,
            taskId: item.taskId,
            status: "IDEMPOTENT_IGNORED",
            task: currentTask,
          });
          continue;
        }

        if (currentTask.status === "DELIVERED") {
          results.push({
            actionId: item.id,
            success: false,
            taskId: item.taskId,
            status: "CONFLICT",
            error: "Task has already been delivered on server; cannot record exception.",
            task: currentTask,
          });
          continue;
        }

        const excepted = await reportDeliveryException(
          actor,
          item.taskId,
          {
            exceptionType: item.payload?.exceptionType,
            reason: item.payload?.reason,
          },
          clientIp,
          db
        );

        results.push({
          actionId: item.id,
          success: true,
          taskId: item.taskId,
          status: "SYNCED",
          task: excepted,
        });
      } else if (item.action === "RECORD_COLLECTION") {
        if (
          item.idempotencyKey &&
          currentTask.collectionIdempotencyKey === item.idempotencyKey
        ) {
          results.push({
            actionId: item.id,
            success: true,
            taskId: item.taskId,
            status: "IDEMPOTENT_IGNORED",
            task: currentTask,
          });
          continue;
        }

        const updated = await recordDeliveryCollection(
          actor,
          item.taskId,
          {
            collectedAmount: item.payload?.collectedAmount,
            paymentMethod: item.payload?.paymentMethod,
            idempotencyKey: item.idempotencyKey,
            notes: item.payload?.notes,
          },
          clientIp,
          db
        );

        results.push({
          actionId: item.id,
          success: true,
          taskId: item.taskId,
          status: "SYNCED",
          task: updated,
        });
      } else {
        results.push({
          actionId: item.id,
          success: false,
          taskId: item.taskId,
          status: "ERROR",
          error: `Unsupported offline queue action: '${item.action}'`,
        });
      }
    } catch (err: any) {
      results.push({
        actionId: item.id,
        success: false,
        taskId: item.taskId,
        status: "ERROR",
        error: err.message || "Unknown error processing offline item.",
      });
    }
  }

  return { results };
}

