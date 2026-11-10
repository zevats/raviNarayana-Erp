import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { acquireLedgerKeyLock } from "../finance/financeService";
import {
  AuthenticatedUser,
  MealType,
  DeliveryTask,
  DeliveryManifestStatus,
  DeliveryManifestRunResult,
  DayOverrideAction,
  SubscriptionDayRow,
  ResidentMealDeliveryRow,
  DeliveryDayListing,
  DeliveryCloseout,
  DeliveryShortfallRow,
  DeliveryHistoryDay,
  DriverHandoverStatus,
} from "@/types";
import {
  mealSchedule,
  refreshMealSchedule,
  isPastCutoff,
  isPreparationDue,
  hasDeliveryOpsSchema,
  requireDeliveryOpsSchema,
  subscriptionDayEligibility,
  businessClock,
  activeCollectionSql,
} from "./deliveryRules";
import { getSettings } from "../settings/settingsService";
import { getEligibleTiffinSubscriptionsForDate, listDeliveryTasks, getDeliveryTaskById } from "./deliveryService";
import { summarizeDeliveries, needsFollowUp, deliveryOutcome } from "@/lib/delivery/outcome";
import { notifyStopCancelled } from "../notifications/pushService";

/**
 * Delivery operations (round 11, migration 0014):
 * - delivery lists for lunch (08:00) and dinner (15:30): prepared automatically when a delivery
 *   screen is first opened after that time, or by a Manager with "Prepare list"; idempotent and
 *   serialised per date and meal, with one delivery per subscription / resident meal enforced by
 *   the database;
 * - skip today / extra today per subscription, skip today and standing room delivery per resident;
 * - cancellation (kept as CANCELLED with its reason; after the meal cutoff only as a Manager
 *   override with a reason) and resolution of partial / undelivered deliveries;
 * - the day close-out for the Owner and Manager.
 * Residents who eat at the PG are never delivery stops: only room-delivery meals become tasks.
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MEALS: readonly MealType[] = ["BREAKFAST", "LUNCH", "DINNER"];

export interface OpsClock {
  /** Test seam: the moment used for the cutoff and preparation-time rules. */
  now?: Date;
}

function checkDateMeal(serviceDate: string | undefined, mealType: MealType | undefined): { serviceDate: string; mealType: MealType } {
  const d = serviceDate?.trim() || "";
  if (!DATE_REGEX.test(d)) throw new Error("Valid service date in YYYY-MM-DD format is required.");
  if (!mealType || !MEALS.includes(mealType)) throw new Error("Meal must be LUNCH, DINNER or BREAKFAST.");
  return { serviceDate: d, mealType };
}

const mealLabel = (m: MealType) => m.charAt(0) + m.slice(1).toLowerCase();

function cutoffText(mealType: MealType): string {
  const c = mealSchedule()[mealType]?.cutoffAt;
  return c ? `the ${c} ${mealLabel(mealType).toLowerCase()} cutoff` : "the end of the service day";
}

async function insertEvent(tx: AsyncDb, taskId: string, type: string, from: string | null, to: string, actor: AuthenticatedUser, notes: string, at: string) {
  await tx.execute(
    `INSERT INTO delivery_task_events (id, task_id, event_type, from_status, to_status, actor_id, actor_name, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`devt_${crypto.randomUUID()}`, taskId, type, from, to, actor.id, actor.fullName, notes, at]
  );
}

async function ensurePlan(tx: AsyncDb, serviceDate: string, mealType: MealType, actor: AuthenticatedUser, at: string): Promise<{ id: string; status: string; manifest_prepared_at: string | null }> {
  await tx.execute(
    `INSERT INTO daily_meal_plans (id, service_date, meal_type, planned_resident_count, guest_count, final_preparation_count,
       actual_cooked_count, status, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, 0, 0, 'CONFIRMED', 'Created for the delivery list', ?, ?, ?)
     ON CONFLICT (service_date, meal_type) DO NOTHING`,
    [`dmp_${crypto.randomUUID()}`, serviceDate, mealType, actor.id, at, at]
  );
  const plan = await tx.queryOne<any>("SELECT id, status, manifest_prepared_at FROM daily_meal_plans WHERE service_date = ? AND meal_type = ?", [serviceDate, mealType]);
  return plan;
}

// ---------------------------------------------------------------------------
// Delivery list (manifest)
// ---------------------------------------------------------------------------

export async function getManifestStatus(
  actor: AuthenticatedUser,
  serviceDateIn: string,
  mealTypeIn: MealType,
  asyncDb?: AsyncDb,
  clock?: OpsClock
): Promise<DeliveryManifestStatus> {
  requirePermission(actor, "delivery.read");
  const { serviceDate, mealType } = checkDateMeal(serviceDateIn, mealTypeIn);
  const db = asyncDb || getAsyncDb();
  await refreshMealSchedule(db);
  const now = clock?.now ?? new Date();
  const schemaReady = await hasDeliveryOpsSchema(db);
  const plan = schemaReady
    ? await db.queryOne<any>(
        `SELECT p.id, p.status, p.manifest_prepared_at, p.manifest_trigger, p.manifest_last_run_at,
                pb.full_name AS prepared_by_name, lb.full_name AS last_run_by_name
         FROM daily_meal_plans p
         LEFT JOIN staff_users pb ON pb.id = p.manifest_prepared_by
         LEFT JOIN staff_users lb ON lb.id = p.manifest_last_run_by
         WHERE p.service_date = ? AND p.meal_type = ?`,
        [serviceDate, mealType]
      )
    : null;
  const counts = await db.queryOne<any>(
    `SELECT COALESCE(SUM(CASE WHEN status <> 'CANCELLED' THEN 1 ELSE 0 END), 0) AS task_count,
            COALESCE(SUM(CASE WHEN assigned_to IS NULL AND status IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY') THEN 1 ELSE 0 END), 0) AS unassigned
     FROM delivery_tasks WHERE service_date = ? AND meal_type = ?${actor.role === "DELIVERY_PERSON" ? " AND assigned_to = ?" : ""}`,
    actor.role === "DELIVERY_PERSON" ? [serviceDate, mealType, actor.id] : [serviceDate, mealType]
  );
  const prepared = Boolean(plan?.manifest_prepared_at);
  return {
    schemaReady,
    serviceDate,
    mealType,
    prepareAt: mealSchedule()[mealType].prepareAt,
    cutoffAt: mealSchedule()[mealType].cutoffAt,
    pastCutoff: isPastCutoff(serviceDate, mealType, now),
    due: schemaReady && !prepared && isPreparationDue(serviceDate, mealType, now),
    prepared,
    preparedAt: plan?.manifest_prepared_at ?? null,
    preparedByName: plan?.prepared_by_name ?? null,
    trigger: plan?.manifest_trigger ?? null,
    lastRunAt: plan?.manifest_last_run_at ?? null,
    lastRunByName: plan?.last_run_by_name ?? null,
    taskCount: Number(counts?.task_count || 0),
    unassignedCount: Number(counts?.unassigned || 0),
  };
}

/**
 * Prepares (or tops up) the delivery list for one date and meal.
 * - MANUAL: a Manager or the Owner (delivery.manage), any time; re-running adds only what is new
 *   (for example a subscription created since) and never duplicates.
 * - AUTO: any signed-in delivery user opening a delivery screen on the day after the meal's
 *   preparation time; runs once (the first opener prepares it, everyone else sees it prepared).
 * Every new delivery is assigned to the person who delivered the same subscription / resident
 * last time when they are still active delivery staff, else to the only delivery person when
 * there is just one, else left in the Unassigned group for the Manager.
 */
export async function prepareDeliveryManifest(
  actor: AuthenticatedUser,
  input: { serviceDate: string; mealType: MealType; trigger?: "AUTO" | "MANUAL" },
  clientIp?: string,
  asyncDb?: AsyncDb,
  clock?: OpsClock
): Promise<DeliveryManifestRunResult> {
  const trigger = input.trigger === "AUTO" ? "AUTO" : "MANUAL";
  if (trigger === "MANUAL") {
    requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.manifest_prepared" });
  } else {
    requirePermission(actor, "delivery.read");
  }
  const { serviceDate, mealType } = checkDateMeal(input.serviceDate, input.mealType);
  const db = asyncDb || getAsyncDb();
  await refreshMealSchedule(db);
  await requireDeliveryOpsSchema(db, "Preparing the delivery list");
  const now = clock?.now ?? new Date();
  const result = { ran: true, created: 0, alreadyExisted: 0, skipped: 0, autoAssigned: 0, unassigned: 0 } as Omit<DeliveryManifestRunResult, "status">;

  if (trigger === "AUTO") {
    if (!isPreparationDue(serviceDate, mealType, now)) {
      return { ...result, ran: false, reason: "NOT_DUE", status: await getManifestStatus(actor, serviceDate, mealType, db, clock) };
    }
    const existing = await db.queryOne<any>("SELECT manifest_prepared_at FROM daily_meal_plans WHERE service_date = ? AND meal_type = ?", [serviceDate, mealType]);
    if (existing?.manifest_prepared_at) {
      return { ...result, ran: false, reason: "ALREADY_PREPARED", status: await getManifestStatus(actor, serviceDate, mealType, db, clock) };
    }
  }

  const at = now.toISOString();
  await db.transaction(async (tx) => {
    // One preparation at a time per date and meal; a concurrent run waits here and then finds
    // everything already created (the unique indexes back this up).
    await acquireLedgerKeyLock(tx, `delivery-manifest:${serviceDate}:${mealType}`);
    const plan = await ensurePlan(tx, serviceDate, mealType, actor, at);
    if (trigger === "AUTO" && plan.manifest_prepared_at) {
      result.ran = false;
      result.reason = "ALREADY_PREPARED";
      return;
    }
    if (plan.status === "DRAFT") {
      throw new Error(`The ${mealLabel(mealType).toLowerCase()} plan for ${serviceDate} is still a draft and cannot produce a delivery list.`);
    }

    const staff = await tx.query<{ id: string; full_name: string }>(
      "SELECT id, full_name FROM staff_users WHERE role = 'DELIVERY_PERSON' AND is_active = 1 ORDER BY full_name ASC"
    );
    const byId = new Map(staff.map((s) => [s.id, s]));
    const only = staff.length === 1 ? staff[0] : null;
    // The delivery partner chosen in Settings (only an explicit, active choice; never a guess).
    const chosenId = (await getSettings(tx)).delivery.defaultDriverId;
    const chosen = chosenId ? byId.get(chosenId) : undefined;
    const usualFor = async (column: "subscription_id" | "resident_id", value: string) => {
      const prev = await tx.queryOne<{ assigned_to: string }>(
        `SELECT assigned_to FROM delivery_tasks
         WHERE ${column} = ? AND assigned_to IS NOT NULL AND status <> 'CANCELLED' AND service_date < ?
         ORDER BY service_date DESC, created_at DESC LIMIT 1`,
        [value, serviceDate]
      );
      const usual = prev ? byId.get(prev.assigned_to) : undefined;
      if (usual) return { staff: usual, why: "usual delivery person" };
      if (chosen) return { staff: chosen, why: "default delivery partner" };
      return only ? { staff: only, why: "only delivery person" } : null;
    };

    const createTask = async (
      t: {
        kind: "RESIDENT" | "EXTERNAL";
        mealRecordId?: string | null;
        subscriptionId?: string | null;
        residentId?: string | null;
        residentName?: string | null;
        roomNumber?: string | null;
        floor?: number | null;
        stayId?: string | null;
        customerName: string;
        customerPhone?: string | null;
        address?: string | null;
        notes?: string | null;
      },
      line: { productId: string | null; productName: string; quantity: number },
      assignee: { staff: { id: string; full_name: string }; why: string } | null,
      createdNote: string
    ) => {
      const taskId = `del_${t.kind === "RESIDENT" ? "res" : "sub"}_${crypto.randomUUID()}`;
      await tx.execute(
        `INSERT INTO delivery_tasks (
           id, order_type, meal_record_id, plan_id, subscription_id, service_date, meal_type,
           resident_id, resident_name, room_number, floor, stay_id,
           customer_name, customer_phone, delivery_address, delivery_notes,
           status, assigned_to, assigned_to_name, assigned_by, assigned_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          taskId, t.kind, t.mealRecordId ?? null, plan.id, t.subscriptionId ?? null, serviceDate, mealType,
          t.residentId ?? null, t.residentName ?? t.customerName, t.roomNumber ?? null, t.floor ?? null, t.stayId ?? null,
          t.customerName, t.customerPhone ?? null, t.address ?? null, t.notes ?? null,
          assignee ? "ASSIGNED" : "PENDING", assignee?.staff.id ?? null, assignee?.staff.full_name ?? null,
          assignee ? actor.id : null, assignee ? at : null, at, at,
        ]
      );
      await tx.execute(
        `INSERT INTO delivery_task_items (id, task_id, line_no, product_id, product_name, quantity, created_at, updated_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
        [`dti_${crypto.randomUUID()}`, taskId, line.productId, line.productName, line.quantity, at, at]
      );
      await insertEvent(tx, taskId, "CREATED", null, "PENDING", actor, createdNote, at);
      if (assignee) {
        await insertEvent(tx, taskId, "ASSIGNED", "PENDING", "ASSIGNED", actor, `Assigned to ${assignee.staff.full_name} (${assignee.why})`, at);
        result.autoAssigned++;
      } else {
        result.unassigned++;
      }
      result.created++;
    };

    // Residents: only meals delivered to the room (standing room-delivery preference for this meal).
    if (mealType === "LUNCH" || mealType === "DINNER") {
      const col = mealType === "LUNCH" ? "lunch" : "dinner";
      const roomResidents = await tx.query<any>(
        `SELECT DISTINCT r.id AS resident_id, s.id AS stay_id
         FROM resident_stays s
         JOIN residents r ON r.id = s.resident_id
         JOIN resident_meal_preferences p ON p.resident_id = r.id
         WHERE s.check_in_date <= ?
           AND ((s.status = 'ACTIVE' AND (s.check_out_date IS NULL OR s.check_out_date >= ?))
             OR (s.status = 'COMPLETED' AND s.check_out_date >= ?))
           AND p.${col}_room_delivery = 1 AND p.${col}_opt_in = 1`,
        [serviceDate, serviceDate, serviceDate]
      );
      for (const r of roomResidents) {
        const rec = await tx.queryOne<any>(
          "SELECT id, status, room_delivery FROM resident_meal_records WHERE resident_id = ? AND service_date = ? AND meal_type = ?",
          [r.resident_id, serviceDate, mealType]
        );
        if (!rec) {
          await tx.execute(
            `INSERT INTO resident_meal_records (id, plan_id, resident_id, stay_id, service_date, meal_type, status, notes, created_by, created_at, updated_at, room_delivery)
             VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', 'Room delivery', ?, ?, ?, 1)
             ON CONFLICT (resident_id, service_date, meal_type) DO NOTHING`,
            [`rmr_${crypto.randomUUID()}`, plan.id, r.resident_id, r.stay_id, serviceDate, mealType, actor.id, at, at]
          );
        } else if (rec.status === "CONFIRMED" && Number(rec.room_delivery) !== 1) {
          await tx.execute("UPDATE resident_meal_records SET room_delivery = 1, updated_at = ? WHERE id = ?", [at, rec.id]);
        }
      }
    }
    const mealRecords = await tx.query<any>(
      `SELECT rmr.id AS meal_record_id, rmr.status, rmr.resident_id, rmr.stay_id, r.full_name, r.phone, rm.room_number, rm.floor
       FROM resident_meal_records rmr
       JOIN residents r ON r.id = rmr.resident_id
       JOIN resident_stays s ON s.id = rmr.stay_id
       JOIN rooms rm ON rm.id = s.room_id
       WHERE rmr.service_date = ? AND rmr.meal_type = ? AND rmr.room_delivery = 1
       ORDER BY rm.floor ASC, rm.room_number ASC`,
      [serviceDate, mealType]
    );
    for (const rec of mealRecords) {
      if (rec.status === "OPTED_OUT") {
        result.skipped++;
        continue;
      }
      if (await tx.queryOne("SELECT id FROM delivery_tasks WHERE meal_record_id = ?", [rec.meal_record_id])) {
        result.alreadyExisted++;
        continue;
      }
      await createTask(
        {
          kind: "RESIDENT",
          mealRecordId: rec.meal_record_id,
          residentId: rec.resident_id,
          residentName: rec.full_name,
          roomNumber: rec.room_number,
          floor: rec.floor,
          stayId: rec.stay_id,
          customerName: rec.full_name,
          customerPhone: rec.phone,
          address: rec.room_number ? `Room ${rec.room_number}${rec.floor !== null && rec.floor !== undefined ? `, Floor ${rec.floor}` : ""}` : null,
        },
        { productId: null, productName: `${mealLabel(mealType)} (room delivery)`, quantity: 1 },
        await usualFor("resident_id", rec.resident_id),
        "Room delivery from the resident's meal preference"
      );
    }

    // Subscriptions, with today's skip / extra.
    const overrides = new Map<string, { action: string; quantity: number | null }>();
    for (const o of await tx.query<any>("SELECT subscription_id, action, quantity FROM subscription_day_overrides WHERE service_date = ? AND meal_type = ?", [serviceDate, mealType])) {
      overrides.set(o.subscription_id, { action: o.action, quantity: o.quantity === null ? null : Number(o.quantity) });
    }
    const subs = await getEligibleTiffinSubscriptionsForDate(actor, serviceDate, mealType, tx);
    for (const sub of subs) {
      const o = overrides.get(sub.subscriptionId);
      if (o?.action === "SKIP") {
        result.skipped++;
        continue;
      }
      if (await tx.queryOne("SELECT id FROM delivery_tasks WHERE plan_id = ? AND subscription_id = ?", [plan.id, sub.subscriptionId])) {
        result.alreadyExisted++;
        continue;
      }
      const quantity = sub.quantityPerMeal + (o?.action === "EXTRA" ? o.quantity || 0 : 0);
      await createTask(
        {
          kind: "EXTERNAL",
          subscriptionId: sub.subscriptionId,
          customerName: sub.customerName,
          customerPhone: sub.customerPhone,
          address: sub.deliveryAddress,
        },
        { productId: sub.productId, productName: sub.productName, quantity },
        await usualFor("subscription_id", sub.subscriptionId),
        `Subscription delivery (${sub.productName} × ${quantity}${o?.action === "EXTRA" ? `, includes ${o.quantity} extra today` : ""}); billed monthly`
      );
    }

    await tx.execute(
      `UPDATE daily_meal_plans
       SET manifest_prepared_at = COALESCE(manifest_prepared_at, ?), manifest_prepared_by = COALESCE(manifest_prepared_by, ?),
           manifest_trigger = COALESCE(manifest_trigger, ?), manifest_last_run_at = ?, manifest_last_run_by = ?, updated_at = ?
       WHERE id = ?`,
      [at, actor.id, trigger, at, actor.id, at, plan.id]
    );
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "delivery.manifest_prepared",
        targetType: "meal_plan",
        targetId: plan.id,
        metadata: { serviceDate, mealType, trigger, ...result },
        ipAddress: clientIp,
      },
      tx
    );
  });

  return { ...result, status: await getManifestStatus(actor, serviceDate, mealType, db, clock) };
}

// ---------------------------------------------------------------------------
// Cancellation and resolution
// ---------------------------------------------------------------------------

/** Cancels one delivery inside the caller's transaction (row already locked and validated). */
async function cancelTaskInTx(tx: AsyncDb, actor: AuthenticatedUser, row: any, reason: string, cutoffOverride: boolean, at: string, clientIp?: string) {
  const collected = await tx.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM delivery_collections WHERE delivery_task_id = ?", [row.id]);
  if (Number(collected?.n || 0) > 0) {
    throw new Error("Money has been collected for this delivery, so it cannot be cancelled.");
  }
  if (row.invoice_id) throw new Error("This delivery is already on an invoice and cannot be cancelled.");
  const applied = await tx.execute(
    `UPDATE delivery_tasks SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, cutoff_override = ?, updated_at = ?
     WHERE id = ? AND status IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'EXCEPTION')`,
    [at, actor.id, reason, cutoffOverride ? 1 : 0, at, row.id]
  );
  if (applied.changes === 0) throw new Error("This delivery was completed or cancelled meanwhile. Reload the list.");
  // The order behind it is cancelled too, so the order and its delivery never disagree.
  if (await tx.queryOne("SELECT id FROM orders WHERE delivery_task_id = ?", [row.id])) {
    await tx.execute("UPDATE orders SET status = 'CANCELLED', updated_at = ? WHERE delivery_task_id = ? AND status = 'CONFIRMED'", [at, row.id]);
  }
  await insertEvent(tx, row.id, "CANCELLED", row.status, "CANCELLED", actor, `Cancelled${cutoffOverride ? " after the cutoff (Manager override)" : ""}: ${reason}`, at);
  await recordAuditEventAsync(
    {
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.task_cancelled",
      targetType: "delivery_task",
      targetId: row.id,
      metadata: { reason, cutoffOverride, fromStatus: row.status, serviceDate: row.service_date, mealType: row.meal_type },
      ipAddress: clientIp,
    },
    tx
  );
}

async function lockTask(tx: AsyncDb, taskId: string): Promise<any> {
  const row = await tx.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [taskId]);
  if (!row) throw new Error(`Delivery task '${taskId}' not found.`);
  return row;
}

/**
 * Cancels a delivery that has not been completed. A reason is always required; after the meal's
 * cutoff (lunch 07:30, dinner 15:00) the caller must also confirm the override explicitly. The
 * row, its events and the order stay; a delivery with money collected cannot be cancelled.
 */
export async function cancelDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input: { reason?: string; overrideCutoff?: boolean },
  clientIp?: string,
  asyncDb?: AsyncDb,
  clock?: OpsClock
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.task_cancelled" });
  const db = asyncDb || getAsyncDb();
  await refreshMealSchedule(db);
  await requireDeliveryOpsSchema(db, "Cancelling a delivery");
  const reason = input.reason?.trim() || "";
  if (reason.length < 3) throw new Error("Give a reason for cancelling this delivery.");
  const now = clock?.now ?? new Date();
  const at = now.toISOString();
  let holder: string | null = null;
  await db.transaction(async (tx) => {
    const row = await lockTask(tx, taskId);
    if (row.status === "CANCELLED") return;
    if (row.status === "DELIVERED") throw new Error("A delivered delivery cannot be cancelled.");
    holder = row.assigned_to || null;
    const past = isPastCutoff(row.service_date, row.meal_type, now);
    if (past && !input.overrideCutoff) {
      throw new Error(`This is after ${cutoffText(row.meal_type)}. Confirm the Manager override to cancel it.`);
    }
    await cancelTaskInTx(tx, actor, row, reason, past, at, clientIp);
  });
  notifyStopCancelled(taskId, holder);
  return (await getDeliveryTaskById(actor, taskId, db))!.task;
}

/** Closes the follow-up on a partial or undelivered delivery with a note; its status is unchanged. */
export async function resolveDeliveryProblem(
  actor: AuthenticatedUser,
  taskId: string,
  input: { note?: string },
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.task_resolved" });
  const db = asyncDb || getAsyncDb();
  await requireDeliveryOpsSchema(db, "Resolving a delivery problem");
  const note = input.note?.trim() || "";
  if (note.length < 3) throw new Error("Write how this was resolved.");
  const detail = await getDeliveryTaskById(actor, taskId, db);
  if (!detail) throw new Error(`Delivery task '${taskId}' not found.`);
  if (!needsFollowUp(detail.task)) throw new Error("Only partial or undelivered deliveries that are still open can be resolved.");
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    const row = await lockTask(tx, taskId);
    const applied = await tx.execute(
      "UPDATE delivery_tasks SET resolved_at = ?, resolved_by = ?, resolution_note = ?, updated_at = ? WHERE id = ? AND resolved_at IS NULL AND status IN ('DELIVERED', 'EXCEPTION')",
      [at, actor.id, note, at, taskId]
    );
    if (applied.changes === 0) throw new Error("This delivery changed meanwhile. Reload the list.");
    await insertEvent(tx, taskId, "RESOLVED", row.status, row.status, actor, `Resolved: ${note}`, at);
    await recordAuditEventAsync(
      { actorId: actor.id, actorUsername: actor.username, action: "delivery.task_resolved", targetType: "delivery_task", targetId: taskId, metadata: { note, status: row.status }, ipAddress: clientIp },
      tx
    );
  });
  return (await getDeliveryTaskById(actor, taskId, db))!.task;
}

/**
 * After a subscription is paused or cancelled: deliveries already on a list inside the affected
 * dates are cancelled when their meal is still before its cutoff; later ones are kept (the
 * Manager decides, with a reason, from the Delivery page) and reported back.
 */
export async function cancelSubscriptionDeliveriesForChange(
  tx: AsyncDb,
  actor: AuthenticatedUser,
  subscriptionId: string,
  fromDate: string,
  untilExclusive: string | null,
  reason: string,
  clientIp?: string,
  clock?: OpsClock
): Promise<{ cancelled: number; keptPastCutoff: number }> {
  if (!(await hasDeliveryOpsSchema(tx))) return { cancelled: 0, keptPastCutoff: 0 };
  await refreshMealSchedule(tx);
  const now = clock?.now ?? new Date();
  const rows = await tx.query<any>(
    `SELECT * FROM delivery_tasks WHERE subscription_id = ? AND service_date >= ?${untilExclusive ? " AND service_date < ?" : ""}
       AND status IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY')${tx.isPostgres ? " FOR UPDATE" : ""}`,
    untilExclusive ? [subscriptionId, fromDate, untilExclusive] : [subscriptionId, fromDate]
  );
  let cancelled = 0;
  let keptPastCutoff = 0;
  for (const row of rows) {
    if (isPastCutoff(row.service_date, row.meal_type, now)) {
      keptPastCutoff++;
      continue;
    }
    await cancelTaskInTx(tx, actor, row, reason, false, now.toISOString(), clientIp);
    cancelled++;
  }
  return { cancelled, keptPastCutoff };
}

/**
 * After a subscription is edited, brings its deliveries already on a list (today onward, not yet
 * attempted) in line with the new terms, using the same eligibility rule as list preparation:
 * a delivery the subscription no longer makes is cancelled with the reason; one it still makes
 * gets the new quantity (keeping any extra for that day) and address. Meals past their cutoff are
 * left for the Manager, as for a pause.
 */
export async function syncSubscriptionDeliveriesAfterEdit(
  tx: AsyncDb,
  actor: AuthenticatedUser,
  subscriptionId: string,
  clientIp?: string,
  clock?: OpsClock
): Promise<{ cancelled: number; updated: number; keptPastCutoff: number }> {
  const result = { cancelled: 0, updated: 0, keptPastCutoff: 0 };
  if (!(await hasDeliveryOpsSchema(tx))) return result;
  await refreshMealSchedule(tx);
  const now = clock?.now ?? new Date();
  const sub = await tx.queryOne<any>(
    `SELECT s.*, c.status AS customer_status, p.status AS product_status
     FROM tiffin_subscriptions s
     JOIN tiffin_customers c ON c.id = s.customer_id
     JOIN tiffin_products p ON p.id = s.product_id
     WHERE s.id = ?`,
    [subscriptionId]
  );
  if (!sub) return result;
  const rows = await tx.query<any>(
    `SELECT * FROM delivery_tasks WHERE subscription_id = ? AND service_date >= ?
       AND status IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY')${tx.isPostgres ? " FOR UPDATE" : ""}`,
    [subscriptionId, businessClock(now).date]
  );
  const at = now.toISOString();
  for (const row of rows) {
    if (isPastCutoff(row.service_date, row.meal_type, now)) {
      result.keptPastCutoff++;
      continue;
    }
    const verdict = subscriptionDayEligibility(
      {
        status: sub.status, customerStatus: sub.customer_status, productStatus: sub.product_status,
        mealTypes: sub.meal_types, serviceDays: sub.service_days, startDate: sub.start_date, endDate: sub.end_date,
        pauseStartDate: sub.pause_start_date, pauseResumeDate: sub.pause_resume_date,
      },
      row.service_date,
      row.meal_type
    );
    if (!verdict.eligible) {
      await cancelTaskInTx(tx, actor, row, `Subscription changed: ${verdict.reason}`, false, at, clientIp);
      result.cancelled++;
      continue;
    }
    const override = await tx.queryOne<any>(
      "SELECT action, quantity FROM subscription_day_overrides WHERE subscription_id = ? AND service_date = ? AND meal_type = ?",
      [subscriptionId, row.service_date, row.meal_type]
    );
    const quantity = Number(sub.quantity_per_meal || 1) + (override?.action === "EXTRA" ? Number(override.quantity || 0) : 0);
    const line = await tx.queryOne<any>("SELECT quantity FROM delivery_task_items WHERE task_id = ? AND line_no = 1", [row.id]);
    const changes: string[] = [];
    if (line && Number(line.quantity) !== quantity) {
      await tx.execute("UPDATE delivery_task_items SET quantity = ?, updated_at = ? WHERE task_id = ? AND line_no = 1", [quantity, at, row.id]);
      changes.push(`${quantity} thali${quantity === 1 ? "" : "s"}`);
    }
    if ((row.delivery_address || "") !== (sub.delivery_address || "")) {
      await tx.execute("UPDATE delivery_tasks SET delivery_address = ?, updated_at = ? WHERE id = ?", [sub.delivery_address, at, row.id]);
      changes.push("new address");
    }
    if (changes.length > 0) {
      await insertEvent(tx, row.id, "UPDATED", row.status, row.status, actor, `Subscription changed: ${changes.join(", ")}.`, at);
      result.updated++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Subscriptions: today's status, skip today, extra today
// ---------------------------------------------------------------------------

export async function listSubscriptionDay(
  actor: AuthenticatedUser,
  serviceDateIn: string,
  mealTypeIn: MealType,
  asyncDb?: AsyncDb,
  clock?: OpsClock
): Promise<DeliveryDayListing<SubscriptionDayRow>> {
  requirePermission(actor, "delivery.read");
  if (actor.role === "DELIVERY_PERSON") throw new AuthorizationError(403, "Delivery staff cannot view subscriptions.");
  const { serviceDate, mealType } = checkDateMeal(serviceDateIn, mealTypeIn);
  const db = asyncDb || getAsyncDb();
  await refreshMealSchedule(db);
  const schemaReady = await hasDeliveryOpsSchema(db);
  const subs = await db.query<any>(
    `SELECT s.id, s.status, s.meal_types, s.service_days, s.quantity_per_meal, s.start_date, s.end_date,
            s.pause_start_date, s.pause_resume_date, s.customer_id, c.full_name, c.phone, c.delivery_address AS customer_address, c.status AS customer_status,
            p.name AS product_name, p.status AS product_status
     FROM tiffin_subscriptions s
     JOIN tiffin_customers c ON c.id = s.customer_id
     JOIN tiffin_products p ON p.id = s.product_id
     WHERE s.status IN ('ACTIVE', 'PAUSED')
     ORDER BY c.full_name ASC`
  );
  const overrides = new Map<string, any>();
  if (schemaReady) {
    for (const o of await db.query<any>("SELECT * FROM subscription_day_overrides WHERE service_date = ? AND meal_type = ?", [serviceDate, mealType])) {
      overrides.set(o.subscription_id, o);
    }
  }
  const tasks = new Map<string, any>();
  for (const t of await db.query<any>(
    `SELECT t.id, t.subscription_id, t.status, t.assigned_to_name${schemaReady ? ", (SELECT SUM(quantity) FROM delivery_task_items i WHERE i.task_id = t.id) AS quantity" : ", NULL AS quantity"}
     FROM delivery_tasks t WHERE t.subscription_id IS NOT NULL AND t.service_date = ? AND t.meal_type = ?
     ORDER BY CASE WHEN t.status = 'CANCELLED' THEN 1 ELSE 0 END, t.created_at DESC`,
    [serviceDate, mealType]
  )) {
    if (!tasks.has(t.subscription_id)) tasks.set(t.subscription_id, t);
  }
  const rows: SubscriptionDayRow[] = subs.map((s) => {
    const verdict = subscriptionDayEligibility(
      {
        status: s.status,
        customerStatus: s.customer_status,
        productStatus: s.product_status,
        mealTypes: s.meal_types,
        serviceDays: s.service_days,
        startDate: s.start_date,
        endDate: s.end_date,
        pauseStartDate: s.pause_start_date,
        pauseResumeDate: s.pause_resume_date,
      },
      serviceDate,
      mealType
    );
    const o = overrides.get(s.id);
    const base = Number(s.quantity_per_meal || 1);
    const t = tasks.get(s.id);
    return {
      subscriptionId: s.id,
      customerId: s.customer_id,
      customerName: s.full_name,
      customerPhone: s.phone || null,
      customerAddress: s.customer_address || null,
      productName: s.product_name,
      subscriptionStatus: s.status,
      quantityPerMeal: base,
      eligible: verdict.eligible,
      ineligibleReason: verdict.reason,
      override: o ? { action: o.action, quantity: o.quantity === null ? null : Number(o.quantity), reason: o.reason || null, afterCutoff: Number(o.after_cutoff) === 1 } : null,
      effectiveQuantity: !verdict.eligible || o?.action === "SKIP" ? 0 : base + (o?.action === "EXTRA" ? Number(o.quantity || 0) : 0),
      task: t ? { id: t.id, status: t.status, assignedToName: t.assigned_to_name || null, quantity: t.quantity === null || t.quantity === undefined ? null : Number(t.quantity) } : null,
    };
  });
  return { serviceDate, mealType, schemaReady, pastCutoff: isPastCutoff(serviceDate, mealType, clock?.now ?? new Date()), cutoffAt: mealSchedule()[mealType].cutoffAt, rows };
}

/**
 * Skip today / extra today for one subscription and meal (or clear it). Before the cutoff a reason
 * is optional; after it the change is a Manager override and needs a reason. A delivery already on
 * the list follows the change: SKIP cancels it, EXTRA / CLEAR adjust its quantity. Nothing can be
 * changed once that delivery has been completed.
 */
export async function setSubscriptionDayOverride(
  actor: AuthenticatedUser,
  input: { subscriptionId: string; serviceDate: string; mealType: MealType; action: DayOverrideAction; quantity?: number; reason?: string },
  clientIp?: string,
  asyncDb?: AsyncDb,
  clock?: OpsClock
): Promise<SubscriptionDayRow> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.subscription_day_changed" });
  const { serviceDate, mealType } = checkDateMeal(input.serviceDate, input.mealType);
  const db = asyncDb || getAsyncDb();
  await refreshMealSchedule(db);
  await requireDeliveryOpsSchema(db, "Skip today / extra today");
  const now = clock?.now ?? new Date();
  if (serviceDate < businessClock(now).date) throw new Error("Past days cannot be changed.");
  const action = input.action;
  if (action !== "SKIP" && action !== "EXTRA" && action !== "CLEAR") throw new Error("Choose skip, extra or clear.");
  const extra = Number(input.quantity);
  if (action === "EXTRA" && (!Number.isInteger(extra) || extra < 1 || extra > 20)) throw new Error("Extra thalis must be a whole number from 1 to 20.");
  const past = isPastCutoff(serviceDate, mealType, now);
  const reason = input.reason?.trim() || null;
  if (past && (!reason || reason.length < 3)) {
    throw new Error(`This is after ${cutoffText(mealType)}. A Manager override needs a reason.`);
  }
  const at = now.toISOString();
  await db.transaction(async (tx) => {
    await acquireLedgerKeyLock(tx, `sub-day:${input.subscriptionId}:${serviceDate}:${mealType}`);
    const sub = await tx.queryOne<any>("SELECT id, quantity_per_meal FROM tiffin_subscriptions WHERE id = ?", [input.subscriptionId]);
    if (!sub) throw new Error("Subscription not found.");
    const base = Number(sub.quantity_per_meal || 1);
    const existing = await tx.queryOne<any>("SELECT * FROM subscription_day_overrides WHERE subscription_id = ? AND service_date = ? AND meal_type = ?", [sub.id, serviceDate, mealType]);
    const task = await tx.queryOne<any>(
      `SELECT * FROM delivery_tasks WHERE subscription_id = ? AND service_date = ? AND meal_type = ? AND status <> 'CANCELLED'${tx.isPostgres ? " FOR UPDATE" : ""}`,
      [sub.id, serviceDate, mealType]
    );
    if (task && (task.status === "DELIVERED" || task.status === "EXCEPTION")) {
      throw new Error("Today's delivery for this subscription has already been attempted; it can no longer be changed.");
    }
    const setQuantity = async (qty: number, note: string) => {
      if (!task) return;
      await tx.execute("UPDATE delivery_task_items SET quantity = ?, updated_at = ? WHERE task_id = ? AND line_no = 1", [qty, at, task.id]);
      await insertEvent(tx, task.id, "UPDATED", task.status, task.status, actor, note, at);
    };
    if (action === "CLEAR") {
      if (!existing) return;
      if (existing.action === "SKIP" && !task) {
        const cancelledTask = await tx.queryOne("SELECT id FROM delivery_tasks WHERE subscription_id = ? AND service_date = ? AND meal_type = ? AND status = 'CANCELLED'", [sub.id, serviceDate, mealType]);
        if (cancelledTask) throw new Error("Today's delivery was already cancelled for the skip. Place a one-off order if the customer now wants this meal.");
      }
      await tx.execute("DELETE FROM subscription_day_overrides WHERE id = ?", [existing.id]);
      if (existing.action === "EXTRA") await setQuantity(base, `Extra for today removed: back to ${base}.${reason ? ` ${reason}` : ""}`);
    } else {
      if (existing) await tx.execute("DELETE FROM subscription_day_overrides WHERE id = ?", [existing.id]);
      await tx.execute(
        `INSERT INTO subscription_day_overrides (id, subscription_id, service_date, meal_type, action, quantity, reason, after_cutoff, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`sdo_${crypto.randomUUID()}`, sub.id, serviceDate, mealType, action, action === "EXTRA" ? extra : null, reason, past ? 1 : 0, actor.id, at]
      );
      if (action === "SKIP" && task) {
        await cancelTaskInTx(tx, actor, task, `Skipped for today${reason ? `: ${reason}` : ""}`, past, at, clientIp);
      }
      if (action === "EXTRA") await setQuantity(base + extra, `${extra} extra for today: ${base + extra} in total.${reason ? ` ${reason}` : ""}`);
    }
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "delivery.subscription_day_changed",
        targetType: "tiffin_subscription",
        targetId: sub.id,
        metadata: { serviceDate, mealType, action, quantity: action === "EXTRA" ? extra : null, reason, afterCutoff: past, taskId: task?.id ?? null },
        ipAddress: clientIp,
      },
      tx
    );
  });
  const listing = await listSubscriptionDay(actor, serviceDate, mealType, db, clock);
  return listing.rows.find((r) => r.subscriptionId === input.subscriptionId) as SubscriptionDayRow;
}

// ---------------------------------------------------------------------------
// Residents: room delivery and skip today
// ---------------------------------------------------------------------------

export async function listResidentMealDelivery(
  actor: AuthenticatedUser,
  serviceDateIn: string,
  mealTypeIn: MealType,
  asyncDb?: AsyncDb,
  clock?: OpsClock
): Promise<DeliveryDayListing<ResidentMealDeliveryRow>> {
  requirePermission(actor, "delivery.read");
  if (actor.role === "DELIVERY_PERSON") throw new AuthorizationError(403, "Delivery staff cannot view resident meal settings.");
  const { serviceDate, mealType } = checkDateMeal(serviceDateIn, mealTypeIn);
  const db = asyncDb || getAsyncDb();
  await refreshMealSchedule(db);
  const schemaReady = await hasDeliveryOpsSchema(db);
  const optCol = mealType === "LUNCH" ? "lunch_opt_in" : mealType === "DINNER" ? "dinner_opt_in" : "breakfast_opt_in";
  const rows = await db.query<any>(
    `SELECT DISTINCT r.id AS resident_id, r.full_name, rm.room_number, rm.floor,
            p.${optCol} AS opted_in,
            ${schemaReady ? "p.lunch_room_delivery, p.dinner_room_delivery, rec.room_delivery AS rec_room_delivery," : "0 AS lunch_room_delivery, 0 AS dinner_room_delivery, 0 AS rec_room_delivery,"}
            rec.status AS rec_status, t.id AS task_id, t.status AS task_status
     FROM resident_stays s
     JOIN residents r ON r.id = s.resident_id
     JOIN rooms rm ON rm.id = s.room_id
     LEFT JOIN resident_meal_preferences p ON p.resident_id = r.id
     LEFT JOIN resident_meal_records rec ON rec.resident_id = r.id AND rec.service_date = ? AND rec.meal_type = ?
     LEFT JOIN delivery_tasks t ON t.meal_record_id = rec.id
     WHERE s.check_in_date <= ?
       AND ((s.status = 'ACTIVE' AND (s.check_out_date IS NULL OR s.check_out_date >= ?))
         OR (s.status = 'COMPLETED' AND s.check_out_date >= ?))
     ORDER BY rm.floor ASC, rm.room_number ASC, r.full_name ASC`,
    [serviceDate, mealType, serviceDate, serviceDate, serviceDate]
  );
  const mapped: ResidentMealDeliveryRow[] = rows.map((r) => {
    const optedIn = r.opted_in === null || r.opted_in === undefined ? true : Number(r.opted_in) === 1;
    const standingRoom = mealType === "LUNCH" ? Number(r.lunch_room_delivery) === 1 : mealType === "DINNER" ? Number(r.dinner_room_delivery) === 1 : false;
    const today: ResidentMealDeliveryRow["today"] =
      r.rec_status === "OPTED_OUT" ? "SKIPPED" : !optedIn ? "NOT_EATING" : (r.rec_status ? Number(r.rec_room_delivery) === 1 : standingRoom) ? "ROOM_DELIVERY" : "AT_PG";
    return {
      residentId: r.resident_id,
      residentName: r.full_name,
      roomNumber: r.room_number ?? null,
      floor: r.floor === null || r.floor === undefined ? null : Number(r.floor),
      lunchRoomDelivery: Number(r.lunch_room_delivery) === 1,
      dinnerRoomDelivery: Number(r.dinner_room_delivery) === 1,
      optedIn,
      today,
      task: r.task_id ? { id: r.task_id, status: r.task_status } : null,
    };
  });
  return { serviceDate, mealType, schemaReady, pastCutoff: isPastCutoff(serviceDate, mealType, clock?.now ?? new Date()), cutoffAt: mealSchedule()[mealType].cutoffAt, rows: mapped };
}

/** Standing room-delivery preference for lunch and dinner (residents otherwise eat at the PG). */
export async function setResidentRoomDelivery(
  actor: AuthenticatedUser,
  input: { residentId: string; lunch?: boolean; dinner?: boolean },
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<void> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.resident_room_delivery" });
  const db = asyncDb || getAsyncDb();
  await requireDeliveryOpsSchema(db, "Room delivery for residents");
  const resident = await db.queryOne<any>("SELECT id FROM residents WHERE id = ?", [input.residentId]);
  if (!resident) throw new Error("Resident not found.");
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO resident_meal_preferences (resident_id, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT (resident_id) DO NOTHING`,
      [input.residentId, at, at]
    );
    if (typeof input.lunch === "boolean") {
      await tx.execute("UPDATE resident_meal_preferences SET lunch_room_delivery = ?, updated_at = ? WHERE resident_id = ?", [input.lunch ? 1 : 0, at, input.residentId]);
    }
    if (typeof input.dinner === "boolean") {
      await tx.execute("UPDATE resident_meal_preferences SET dinner_room_delivery = ?, updated_at = ? WHERE resident_id = ?", [input.dinner ? 1 : 0, at, input.residentId]);
    }
    await recordAuditEventAsync(
      { actorId: actor.id, actorUsername: actor.username, action: "delivery.resident_room_delivery", targetType: "resident", targetId: input.residentId, metadata: { lunch: input.lunch ?? null, dinner: input.dinner ?? null }, ipAddress: clientIp },
      tx
    );
  });
}

/** Skip today's room-delivered meal for a resident (or undo the skip), with the cutoff rule. */
export async function setResidentDaySkip(
  actor: AuthenticatedUser,
  input: { residentId: string; serviceDate: string; mealType: MealType; action: "SKIP" | "CLEAR"; reason?: string },
  clientIp?: string,
  asyncDb?: AsyncDb,
  clock?: OpsClock
): Promise<void> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.resident_day_changed" });
  const { serviceDate, mealType } = checkDateMeal(input.serviceDate, input.mealType);
  const db = asyncDb || getAsyncDb();
  await refreshMealSchedule(db);
  await requireDeliveryOpsSchema(db, "Skip today for residents");
  const now = clock?.now ?? new Date();
  if (serviceDate < businessClock(now).date) throw new Error("Past days cannot be changed.");
  const past = isPastCutoff(serviceDate, mealType, now);
  const reason = input.reason?.trim() || null;
  if (past && (!reason || reason.length < 3)) throw new Error(`This is after ${cutoffText(mealType)}. A Manager override needs a reason.`);
  const at = now.toISOString();
  await db.transaction(async (tx) => {
    const stay = await tx.queryOne<any>(
      `SELECT s.id FROM resident_stays s WHERE s.resident_id = ? AND s.check_in_date <= ?
         AND ((s.status = 'ACTIVE' AND (s.check_out_date IS NULL OR s.check_out_date >= ?)) OR (s.status = 'COMPLETED' AND s.check_out_date >= ?))
       ORDER BY s.check_in_date DESC LIMIT 1`,
      [input.residentId, serviceDate, serviceDate, serviceDate]
    );
    if (!stay) throw new Error("This resident is not staying on that date.");
    const plan = await ensurePlan(tx, serviceDate, mealType, actor, at);
    const rec = await tx.queryOne<any>("SELECT * FROM resident_meal_records WHERE resident_id = ? AND service_date = ? AND meal_type = ?", [input.residentId, serviceDate, mealType]);
    if (input.action === "SKIP") {
      if (!rec) {
        // The record keeps whether this meal would have been a room delivery, so the delivery
        // list reports it as skipped rather than silently missing.
        const pref = mealType === "LUNCH" || mealType === "DINNER"
          ? await tx.queryOne<any>(`SELECT ${mealType === "LUNCH" ? "lunch" : "dinner"}_room_delivery AS rd FROM resident_meal_preferences WHERE resident_id = ?`, [input.residentId])
          : null;
        await tx.execute(
          `INSERT INTO resident_meal_records (id, plan_id, resident_id, stay_id, service_date, meal_type, status, notes, created_by, created_at, updated_at, room_delivery)
           VALUES (?, ?, ?, ?, ?, ?, 'OPTED_OUT', ?, ?, ?, ?, ?)`,
          [`rmr_${crypto.randomUUID()}`, plan.id, input.residentId, stay.id, serviceDate, mealType, reason || "Skipped for today", actor.id, at, at, Number(pref?.rd) === 1 ? 1 : 0]
        );
      } else {
        await tx.execute("UPDATE resident_meal_records SET status = 'OPTED_OUT', notes = ?, updated_at = ? WHERE id = ?", [reason || "Skipped for today", at, rec.id]);
        const task = await tx.queryOne<any>(`SELECT * FROM delivery_tasks WHERE meal_record_id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [rec.id]);
        if (task && (task.status === "DELIVERED" || task.status === "EXCEPTION")) throw new Error("Today's meal has already been delivered or attempted.");
        if (task && task.status !== "CANCELLED") await cancelTaskInTx(tx, actor, task, `Skipped for today${reason ? `: ${reason}` : ""}`, past, at, clientIp);
      }
    } else if (rec && rec.status === "OPTED_OUT") {
      const cancelledTask = await tx.queryOne("SELECT id FROM delivery_tasks WHERE meal_record_id = ? AND status = 'CANCELLED'", [rec.id]);
      if (cancelledTask) throw new Error("Today's room delivery was already cancelled for the skip and cannot be restored.");
      await tx.execute("UPDATE resident_meal_records SET status = 'CONFIRMED', updated_at = ? WHERE id = ?", [at, rec.id]);
    }
    await recordAuditEventAsync(
      { actorId: actor.id, actorUsername: actor.username, action: "delivery.resident_day_changed", targetType: "resident", targetId: input.residentId, metadata: { serviceDate, mealType, action: input.action, reason, afterCutoff: past }, ipAddress: clientIp },
      tx
    );
  });
}

// ---------------------------------------------------------------------------
// Day close-out and history (Owner and Manager)
// ---------------------------------------------------------------------------

function requireOversight(actor: AuthenticatedUser) {
  requirePermission(actor, "delivery.read");
  if (actor.role === "DELIVERY_PERSON") throw new AuthorizationError(403, "The close-out is for the Manager and Owner.");
}

export async function getDeliveryCloseout(
  actor: AuthenticatedUser,
  serviceDateIn: string,
  mealTypeIn: MealType | "ALL",
  asyncDb?: AsyncDb
): Promise<DeliveryCloseout> {
  requireOversight(actor);
  const serviceDate = serviceDateIn?.trim() || "";
  if (!DATE_REGEX.test(serviceDate)) throw new Error("Valid service date in YYYY-MM-DD format is required.");
  const mealType = mealTypeIn === "ALL" ? "ALL" : checkDateMeal(serviceDate, mealTypeIn).mealType;
  const db = asyncDb || getAsyncDb();
  await refreshMealSchedule(db);
  const tasks = await listDeliveryTasks(actor, { serviceDate, mealType: mealType === "ALL" ? undefined : mealType, limit: 500 }, db);
  const summary = summarizeDeliveries(tasks);

  const items = new Map<string, DeliveryCloseout["items"][number]>();
  const shortfalls: DeliveryShortfallRow[] = [];
  for (const t of tasks) {
    const o = deliveryOutcome(t);
    if (o === "CANCELLED") continue;
    const done = o === "DELIVERED" || o === "PARTIAL" || o === "NOT_DELIVERED";
    for (const l of t.lines ?? []) {
      const row = items.get(l.productName) ?? { productName: l.productName, ordered: 0, delivered: 0, undelivered: 0, returned: 0, withStaff: 0, discarded: 0, unrecorded: 0 };
      row.ordered += l.quantity;
      if (done && l.deliveredQuantity !== null) {
        row.delivered += l.deliveredQuantity;
        const short = l.quantity - l.deliveredQuantity;
        if (short > 0) {
          row.undelivered += short;
          if (l.disposition === "RETURNED") row.returned += short;
          else if (l.disposition === "WITH_STAFF") row.withStaff += short;
          else if (l.disposition === "DISCARDED") row.discarded += short;
          else row.unrecorded += short;
          shortfalls.push({
            taskId: t.id,
            customerName: t.customerName || t.residentName || "Customer",
            roomNumber: t.roomNumber ?? null,
            productName: l.productName,
            ordered: l.quantity,
            delivered: l.deliveredQuantity,
            undelivered: short,
            reason: l.undeliveredReason,
            disposition: l.disposition,
            staffName: t.assignedToName,
            resolved: Boolean(t.resolvedAt),
          });
        }
      }
      items.set(l.productName, row);
    }
  }

  const mealCond = mealType === "ALL" ? "" : " AND t.meal_type = ?";
  const params = mealType === "ALL" ? [serviceDate] : [serviceDate, mealType];
  // A collection whose cashbook entry was reversed is no longer money received (cash is unaffected).
  const activeCond = (await hasDeliveryOpsSchema(db)) ? ` AND ${activeCollectionSql("dc")}` : "";
  const collections = await db.query<any>(
    `SELECT dc.collected_by AS staff_id, u.full_name AS staff_name,
            SUM(CASE WHEN dc.payment_method = 'CASH' THEN dc.amount ELSE 0 END) AS cash,
            SUM(CASE WHEN dc.payment_method <> 'CASH' THEN dc.amount ELSE 0 END) AS upi,
            SUM(CASE WHEN dc.handover_id IS NULL THEN dc.amount ELSE 0 END) AS undeclared,
            SUM(CASE WHEN h.status = 'DECLARED' THEN dc.amount ELSE 0 END) AS awaiting,
            SUM(CASE WHEN h.status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED') THEN dc.amount ELSE 0 END) AS handed_over
     FROM delivery_collections dc
     JOIN delivery_tasks t ON t.id = dc.delivery_task_id
     JOIN staff_users u ON u.id = dc.collected_by
     LEFT JOIN driver_cash_handovers h ON h.id = dc.handover_id
     WHERE t.service_date = ?${mealCond}${activeCond}
     GROUP BY dc.collected_by, u.full_name
     ORDER BY u.full_name`,
    params
  );
  const handovers = await db.query<any>(
    `SELECT h.id, u.full_name AS staff_name, h.declared_cash, h.declared_upi, h.accepted_cash, h.accepted_upi, h.status,
            h.variance_reason, a.full_name AS accepted_by_name, h.accepted_at
     FROM driver_cash_handovers h
     JOIN staff_users u ON u.id = h.driver_id
     LEFT JOIN staff_users a ON a.id = h.accepted_by
     WHERE h.accepted_at IS NOT NULL
     ORDER BY h.accepted_at DESC
     LIMIT 200`
  );
  const n = (v: any) => Number(v || 0);
  return {
    serviceDate,
    mealType,
    summary,
    items: Array.from(items.values()).sort((a, b) => a.productName.localeCompare(b.productName)),
    shortfalls,
    cancelled: tasks
      .filter((t) => t.status === "CANCELLED")
      .map((t) => ({ taskId: t.id, customerName: t.customerName || t.residentName || "Customer", reason: t.cancelReason ?? null, cutoffOverride: Boolean(t.cutoffOverride), cancelledAt: t.cancelledAt ?? null })),
    collections: collections.map((c) => ({
      staffId: c.staff_id,
      staffName: c.staff_name,
      cash: n(c.cash),
      upi: n(c.upi),
      undeclared: n(c.undeclared),
      awaitingAcceptance: n(c.awaiting),
      handedOver: n(c.handed_over),
    })),
    // Accepted on this date in business time (the cashbook date).
    handovers: handovers
      .filter((h) => businessClock(new Date(h.accepted_at)).date === serviceDate)
      .map((h) => ({
        id: h.id,
        staffName: h.staff_name,
        declaredCash: n(h.declared_cash),
        declaredUpi: n(h.declared_upi),
        acceptedCash: n(h.accepted_cash),
        acceptedUpi: n(h.accepted_upi),
        status: h.status as DriverHandoverStatus,
        varianceReason: h.variance_reason || null,
        acceptedByName: h.accepted_by_name || null,
      })),
  };
}

/** One row per date and meal over a date range (at most 62 days), newest first. */
export async function getDeliveryHistory(
  actor: AuthenticatedUser,
  fromDate: string,
  toDate: string,
  asyncDb?: AsyncDb
): Promise<DeliveryHistoryDay[]> {
  requireOversight(actor);
  if (!DATE_REGEX.test(fromDate || "") || !DATE_REGEX.test(toDate || "") || fromDate > toDate) throw new Error("Choose a valid date range.");
  const span = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000;
  if (span > 62) throw new Error("Choose at most two months.");
  const db = asyncDb || getAsyncDb();
  const schemaReady = await hasDeliveryOpsSchema(db);
  const orderTables = await db.queryOne<{ t: string | null }>(
    db.isPostgres ? "SELECT to_regclass('public.order_items')::text AS t" : "SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name = 'order_items'"
  );
  const shortExpr = [
    orderTables?.t ? "(SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.delivery_task_id = t.id AND oi.delivered_quantity < oi.quantity)" : "0",
    schemaReady ? "(SELECT COUNT(*) FROM delivery_task_items i WHERE i.task_id = t.id AND i.delivered_quantity < i.quantity)" : "0",
  ].join(" + ");
  const rows = await db.query<any>(
    `SELECT t.service_date, t.meal_type, t.status, ${shortExpr} AS short_lines
     FROM delivery_tasks t WHERE t.service_date >= ? AND t.service_date <= ?`,
    [fromDate, toDate]
  );
  const byKey = new Map<string, DeliveryHistoryDay>();
  for (const r of rows) {
    const key = `${r.service_date}|${r.meal_type}`;
    const day = byKey.get(key) ?? { serviceDate: r.service_date, mealType: r.meal_type, total: 0, delivered: 0, partial: 0, notDelivered: 0, open: 0, cancelled: 0 };
    if (r.status === "CANCELLED") day.cancelled++;
    else {
      day.total++;
      if (r.status === "DELIVERED") Number(r.short_lines) > 0 ? day.partial++ : day.delivered++;
      else if (r.status === "EXCEPTION") day.notDelivered++;
      else day.open++;
    }
    byKey.set(key, day);
  }
  const order: Record<string, number> = { BREAKFAST: 0, LUNCH: 1, DINNER: 2 };
  return Array.from(byKey.values()).sort((a, b) => (a.serviceDate === b.serviceDate ? order[b.mealType] - order[a.mealType] : a.serviceDate < b.serviceDate ? 1 : -1));
}

