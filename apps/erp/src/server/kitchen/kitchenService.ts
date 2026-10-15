import crypto from "crypto";
import { getDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEvent } from "../audit/audit";
import {
  AuthenticatedUser,
  MealType,
  MealPlanStatus,
  AttendanceStatus,
  DailyMealPlan,
  ResidentMealRecord,
  MealPlanAdjustment,
  ResidentMealEligibility,
  PreparationSheetData,
  KitchenDashboardSummary,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_MEAL_TYPES: readonly MealType[] = ["BREAKFAST", "LUNCH", "DINNER"];
const VALID_PLAN_STATUSES: readonly MealPlanStatus[] = ["DRAFT", "CONFIRMED", "COMPLETED"];

export interface CreateMealPlanInput {
  serviceDate: string;
  mealType: MealType;
  guestCount?: number;
  notes?: string;
  residentOptOuts?: string[];
  status?: "DRAFT" | "CONFIRMED";
}

export interface UpdateMealPlanInput {
  guestCount?: number;
  notes?: string;
  residentOptOuts?: string[];
}

export interface AdjustQuantityInput {
  newResidentCount?: number;
  newGuestCount?: number;
  reason: string;
}

export interface ListMealPlansOptions {
  startDate?: string;
  endDate?: string;
  mealType?: MealType;
  status?: MealPlanStatus;
  limit?: number;
  offset?: number;
}

function mapRowToMealPlan(row: any): DailyMealPlan {
  return {
    id: row.id,
    serviceDate: row.service_date,
    mealType: row.meal_type as MealType,
    plannedResidentCount: Number(row.planned_resident_count),
    guestCount: Number(row.guest_count),
    finalPreparationCount: Number(row.final_preparation_count),
    actualCookedCount: row.actual_cooked_count !== undefined && row.actual_cooked_count !== null ? Number(row.actual_cooked_count) : Number(row.final_preparation_count),
    status: row.status as MealPlanStatus,
    notes: row.notes || null,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    confirmedBy: row.confirmed_by || null,
    confirmedByName: row.confirmed_by_name || null,
    confirmedAt: row.confirmed_at || null,
    completedBy: row.completed_by || null,
    completedByName: row.completed_by_name || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToMealRecord(row: any): ResidentMealRecord {
  return {
    id: row.id,
    planId: row.plan_id,
    residentId: row.resident_id,
    residentName: row.resident_name || "Unknown Resident",
    roomNumber: row.room_number || null,
    stayId: row.stay_id,
    serviceDate: row.service_date,
    mealType: row.meal_type as MealType,
    status: row.status as AttendanceStatus,
    notes: row.notes || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToAdjustment(row: any): MealPlanAdjustment {
  return {
    id: row.id,
    planId: row.plan_id,
    previousResidentCount: Number(row.previous_resident_count),
    newResidentCount: Number(row.new_resident_count),
    previousGuestCount: Number(row.previous_guest_count),
    newGuestCount: Number(row.new_guest_count),
    previousTotal: Number(row.previous_total),
    newTotal: Number(row.new_total),
    reason: row.reason,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
  };
}

/**
 * Calculates resident meal eligibility based on authoritative active stays for a given service date.
 * Does NOT infer eligibility from room inventory alone.
 * Requires kitchen.read permission.
 */
export function getEligibleResidentsForDate(
  actor: AuthenticatedUser,
  serviceDate: string
): ResidentMealEligibility[] {
  requirePermission(actor, "kitchen.read");

  const cleanDate = serviceDate?.trim();
  if (!cleanDate || !DATE_REGEX.test(cleanDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }

  const db = getDb();

  // A resident is eligible if they have a stay covering serviceDate:
  // 1. check_in_date <= serviceDate
  // 2. Either ACTIVE stay (check_out_date IS NULL OR check_out_date >= serviceDate)
  //    OR COMPLETED stay where check_out_date >= serviceDate (departing on or after serviceDate).
  // Residents with check_out_date < serviceDate are strictly excluded.
  const rows = db.prepare(`
    SELECT DISTINCT
      r.id as resident_id,
      r.full_name,
      r.phone,
      s.id as stay_id,
      s.room_id,
      rm.room_number,
      rm.floor,
      s.check_in_date,
      p.breakfast_opt_in,
      p.lunch_opt_in,
      p.dinner_opt_in
    FROM resident_stays s
    JOIN residents r ON r.id = s.resident_id
    JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN resident_meal_preferences p ON p.resident_id = r.id
    WHERE s.check_in_date <= ?
      AND (
        (s.status = 'ACTIVE' AND (s.check_out_date IS NULL OR s.check_out_date >= ?))
        OR (s.status = 'COMPLETED' AND s.check_out_date >= ?)
      )
    ORDER BY rm.floor ASC, rm.room_number ASC, r.full_name ASC
  `).all(cleanDate, cleanDate, cleanDate) as any[];

  return rows.map((r) => ({
    residentId: r.resident_id,
    fullName: r.full_name,
    phone: r.phone,
    stayId: r.stay_id,
    roomId: r.room_id,
    roomNumber: r.room_number,
    floor: r.floor,
    checkInDate: r.check_in_date,
    isEligible: true,
    defaultOptIn: true, // Baseline default
  }));
}

/**
 * Creates a daily meal plan with calculated resident attendance.
 * Requires kitchen.manage permission.
 */
export function createMealPlan(
  actor: AuthenticatedUser,
  input: CreateMealPlanInput,
  clientIp?: string
): DailyMealPlan {
  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.plan_created" });

  const serviceDate = input.serviceDate?.trim();
  const mealType = input.mealType;
  const guestCount = Math.max(0, Number(input.guestCount) || 0);
  const notes = input.notes?.trim() || null;
  const residentOptOuts = new Set(input.residentOptOuts || []);
  const initialStatus: MealPlanStatus = input.status === "CONFIRMED" ? "CONFIRMED" : "DRAFT";

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }
  if (!VALID_MEAL_TYPES.includes(mealType)) {
    throw new Error(`Invalid meal type '${mealType}'. Must be BREAKFAST, LUNCH, or DINNER.`);
  }
  if (!Number.isInteger(guestCount) || guestCount < 0) {
    throw new Error("Guest count must be a non-negative integer.");
  }
  if (guestCount > 1000) {
    throw new Error("Guest count cannot exceed 1,000.");
  }

  const db = getDb();

  // Check duplicate plan for same service_date and meal_type
  const existingPlan = db.prepare(`
    SELECT id, status FROM daily_meal_plans WHERE service_date = ? AND meal_type = ?
  `).get(serviceDate, mealType) as any;

  if (existingPlan) {
    throw new Error(
      `A meal plan for ${mealType} on ${serviceDate} already exists (ID: ${existingPlan.id}, Status: ${existingPlan.status}). Duplicate plans for the same date and meal are prevented.`
    );
  }

  // Authoritatively compute eligible residents for serviceDate
  const eligibleResidents = getEligibleResidentsForDate(actor, serviceDate);

  let plannedResidentCount = 0;
  const residentRecordsToInsert: Array<{
    id: string;
    residentId: string;
    stayId: string;
    status: AttendanceStatus;
  }> = [];

  for (const res of eligibleResidents) {
    const isOptedOut = residentOptOuts.has(res.residentId);
    const status: AttendanceStatus = isOptedOut ? "OPTED_OUT" : "CONFIRMED";
    if (status === "CONFIRMED") {
      plannedResidentCount++;
    }
    residentRecordsToInsert.push({
      id: `rmr_${crypto.randomUUID()}`,
      residentId: res.residentId,
      stayId: res.stayId,
      status,
    });
  }

  const finalPreparationCount = plannedResidentCount + guestCount;
  const planId = `dmp_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const confirmedBy = initialStatus === "CONFIRMED" ? actor.id : null;
  const confirmedAt = initialStatus === "CONFIRMED" ? now : null;

  const tx = db.transaction(() => {
    // 1. Insert meal plan
    db.prepare(`
      INSERT INTO daily_meal_plans (
        id, service_date, meal_type, planned_resident_count, guest_count,
        final_preparation_count, status, notes, created_by, confirmed_by,
        confirmed_at, completed_by, completed_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, NULL, NULL, ?, ?
      )
    `).run(
      planId,
      serviceDate,
      mealType,
      plannedResidentCount,
      guestCount,
      finalPreparationCount,
      initialStatus,
      notes,
      actor.id,
      confirmedBy,
      confirmedAt,
      now,
      now
    );

    // 2. Insert individual resident attendance records
    const insertRecord = db.prepare(`
      INSERT INTO resident_meal_records (
        id, plan_id, resident_id, stay_id, service_date, meal_type,
        status, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
    `);

    for (const rec of residentRecordsToInsert) {
      insertRecord.run(
        rec.id,
        planId,
        rec.residentId,
        rec.stayId,
        serviceDate,
        mealType,
        rec.status,
        actor.id,
        now,
        now
      );
    }

    // 3. Audit log
    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "kitchen.plan_created",
      targetType: "meal_plan",
      targetId: planId,
      metadata: {
        serviceDate,
        mealType,
        plannedResidentCount,
        guestCount,
        finalPreparationCount,
        status: initialStatus,
        eligibleCount: eligibleResidents.length,
      },
      ipAddress: clientIp,
    });

    if (initialStatus === "CONFIRMED") {
      recordAuditEvent({
        actorId: actor.id,
        actorUsername: actor.username,
        action: "kitchen.plan_confirmed",
        targetType: "meal_plan",
        targetId: planId,
        metadata: {
          serviceDate,
          mealType,
          finalPreparationCount,
        },
        ipAddress: clientIp,
      });
    }
  });

  try {
    tx();
  } catch (err: any) {
    if (err.message && err.message.includes("UNIQUE constraint failed")) {
      throw new Error(
        `A meal plan for ${mealType} on ${serviceDate} already exists. Duplicate plans for the same date and meal are prevented.`
      );
    }
    throw err;
  }

  return getMealPlanById(actor, planId)!.plan;
}

/**
 * Updates a draft meal plan's notes, guest counts, or resident opt-outs.
 * Completed plans cannot be modified directly without an explicit adjustment.
 * Requires kitchen.manage permission.
 */
export function updateMealPlan(
  actor: AuthenticatedUser,
  planId: string,
  input: UpdateMealPlanInput,
  clientIp?: string
): DailyMealPlan {
  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.plan_updated" });

  const db = getDb();
  const plan = getMealPlanById(actor, planId);
  if (!plan) {
    throw new Error(`Meal plan '${planId}' not found.`);
  }

  if (plan.plan.status === "COMPLETED") {
    throw new Error(
      "Completed meal plans cannot be directly edited. Use justified quantity adjustment to record auditable corrections."
    );
  }

  const guestCount =
    input.guestCount !== undefined ? Math.max(0, Number(input.guestCount)) : plan.plan.guestCount;
  const notes = input.notes !== undefined ? input.notes?.trim() || null : plan.plan.notes;

  if (!Number.isInteger(guestCount) || guestCount < 0) {
    throw new Error("Guest count must be a non-negative integer.");
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // If resident opt-outs are provided, update attendance records
    let plannedResidentCount = plan.plan.plannedResidentCount;

    if (input.residentOptOuts !== undefined) {
      const optOutSet = new Set(input.residentOptOuts);
      const records = plan.residentRecords;

      let confirmedCount = 0;
      const updateRecordStatus = db.prepare(`
        UPDATE resident_meal_records
        SET status = ?, updated_at = ?
        WHERE id = ?
      `);

      for (const rec of records) {
        const newStatus: AttendanceStatus = optOutSet.has(rec.residentId) ? "OPTED_OUT" : "CONFIRMED";
        if (newStatus === "CONFIRMED") {
          confirmedCount++;
        }
        if (newStatus !== rec.status) {
          updateRecordStatus.run(newStatus, now, rec.id);
        }
      }
      plannedResidentCount = confirmedCount;
    }

    const finalPreparationCount = plannedResidentCount + guestCount;

    db.prepare(`
      UPDATE daily_meal_plans
      SET planned_resident_count = ?, guest_count = ?, final_preparation_count = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(plannedResidentCount, guestCount, finalPreparationCount, notes, now, planId);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "kitchen.plan_updated",
      targetType: "meal_plan",
      targetId: planId,
      metadata: {
        serviceDate: plan.plan.serviceDate,
        mealType: plan.plan.mealType,
        plannedResidentCount,
        guestCount,
        finalPreparationCount,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getMealPlanById(actor, planId)!.plan;
}

/**
 * Confirms a draft meal plan for preparation.
 * Requires kitchen.manage permission.
 */
export function confirmMealPlan(
  actor: AuthenticatedUser,
  planId: string,
  clientIp?: string
): DailyMealPlan {
  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.plan_confirmed" });

  const db = getDb();
  const current = getMealPlanById(actor, planId);
  if (!current) {
    throw new Error(`Meal plan '${planId}' not found.`);
  }

  if (current.plan.status === "CONFIRMED") {
    return current.plan; // Idempotent
  }

  if (current.plan.status === "COMPLETED") {
    throw new Error("Meal plan is already completed.");
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE daily_meal_plans
      SET status = 'CONFIRMED', confirmed_by = ?, confirmed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(actor.id, now, now, planId);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "kitchen.plan_confirmed",
      targetType: "meal_plan",
      targetId: planId,
      metadata: {
        serviceDate: current.plan.serviceDate,
        mealType: current.plan.mealType,
        finalPreparationCount: current.plan.finalPreparationCount,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getMealPlanById(actor, planId)!.plan;
}

/**
 * Completes a meal plan after kitchen service is finished.
 * Requires kitchen.manage permission.
 */
export function completeMealPlan(
  actor: AuthenticatedUser,
  planId: string,
  actualCookedCountOrIp?: number | string,
  clientIp?: string
): DailyMealPlan {
  let actualCookedCount: number | undefined;
  let ip = clientIp;
  if (typeof actualCookedCountOrIp === "number") {
    actualCookedCount = actualCookedCountOrIp;
  } else if (typeof actualCookedCountOrIp === "string") {
    ip = actualCookedCountOrIp;
  }

  requirePermission(actor, "kitchen.manage", { ip, action: "kitchen.plan_completed" });

  const db = getDb();
  const current = getMealPlanById(actor, planId);
  if (!current) {
    throw new Error(`Meal plan '${planId}' not found.`);
  }

  if (current.plan.status === "COMPLETED") {
    return current.plan; // Idempotent
  }

  const now = new Date().toISOString();
  const cookedCount = actualCookedCount !== undefined ? Math.max(0, actualCookedCount) : current.plan.finalPreparationCount;

  const tx = db.transaction(() => {
    // If plan was in DRAFT, also stamp confirmation
    if (current.plan.status === "DRAFT") {
      db.prepare(`
        UPDATE daily_meal_plans
        SET confirmed_by = ?, confirmed_at = ?
        WHERE id = ? AND confirmed_by IS NULL
      `).run(actor.id, now, planId);
    }

    db.prepare(`
      UPDATE daily_meal_plans
      SET status = 'COMPLETED', completed_by = ?, completed_at = ?, updated_at = ?, actual_cooked_count = ?
      WHERE id = ?
    `).run(actor.id, now, now, cookedCount, planId);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "kitchen.plan_completed",
      targetType: "meal_plan",
      targetId: planId,
      metadata: {
        serviceDate: current.plan.serviceDate,
        mealType: current.plan.mealType,
        finalPreparationCount: current.plan.finalPreparationCount,
        actualCookedCount: cookedCount,
      },
      ipAddress: ip,
    });
  });

  tx();

  return getMealPlanById(actor, planId)!.plan;
}

/**
 * Records a justified manual quantity adjustment on an existing plan.
 * Captures previous quantity, new quantity, actor, and mandatory explanation.
 * Requires kitchen.manage permission.
 */
export function adjustMealPlanQuantity(
  actor: AuthenticatedUser,
  planId: string,
  input: AdjustQuantityInput,
  clientIp?: string
): DailyMealPlan {
  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.quantity_adjusted" });

  const reason = input.reason?.trim();
  if (!reason || reason.length < 5) {
    throw new Error("A clear justification reason of at least 5 characters is required for quantity adjustments.");
  }

  const db = getDb();
  const current = getMealPlanById(actor, planId);
  if (!current) {
    throw new Error(`Meal plan '${planId}' not found.`);
  }

  const prevRes = current.plan.plannedResidentCount;
  const prevGuest = current.plan.guestCount;
  const prevTotal = current.plan.finalPreparationCount;

  const newRes = input.newResidentCount !== undefined ? Math.max(0, Number(input.newResidentCount)) : prevRes;
  const newGuest = input.newGuestCount !== undefined ? Math.max(0, Number(input.newGuestCount)) : prevGuest;

  if (!Number.isInteger(newRes) || newRes < 0) {
    throw new Error("Resident count must be a non-negative integer.");
  }
  if (!Number.isInteger(newGuest) || newGuest < 0) {
    throw new Error("Guest count must be a non-negative integer.");
  }

  const newTotal = newRes + newGuest;
  const adjId = `mpa_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    // 1. Record append-only adjustment history
    db.prepare(`
      INSERT INTO meal_plan_adjustments (
        id, plan_id, previous_resident_count, new_resident_count,
        previous_guest_count, new_guest_count, previous_total,
        new_total, reason, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      adjId,
      planId,
      prevRes,
      newRes,
      prevGuest,
      newGuest,
      prevTotal,
      newTotal,
      reason,
      actor.id,
      now
    );

    // 2. Update plan preparation counts
    db.prepare(`
      UPDATE daily_meal_plans
      SET planned_resident_count = ?, guest_count = ?, final_preparation_count = ?, updated_at = ?
      WHERE id = ?
    `).run(newRes, newGuest, newTotal, now, planId);

    // 3. Emit audit event
    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "kitchen.quantity_adjusted",
      targetType: "meal_plan",
      targetId: planId,
      metadata: {
        adjustmentId: adjId,
        serviceDate: current.plan.serviceDate,
        mealType: current.plan.mealType,
        previousTotal: prevTotal,
        newTotal: newTotal,
        reason,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return getMealPlanById(actor, planId)!.plan;
}

/**
 * Retrieves a meal plan by ID with resident attendance and adjustments.
 * Requires kitchen.read permission.
 */
export function getMealPlanById(
  actor: AuthenticatedUser,
  planId: string
): { plan: DailyMealPlan; residentRecords: ResidentMealRecord[]; adjustments: MealPlanAdjustment[] } | null {
  requirePermission(actor, "kitchen.read");

  const db = getDb();
  const planRow = db.prepare(`
    SELECT
      p.*,
      u1.full_name as created_by_name,
      u2.full_name as confirmed_by_name,
      u3.full_name as completed_by_name
    FROM daily_meal_plans p
    LEFT JOIN staff_users u1 ON u1.id = p.created_by
    LEFT JOIN staff_users u2 ON u2.id = p.confirmed_by
    LEFT JOIN staff_users u3 ON u3.id = p.completed_by
    WHERE p.id = ?
  `).get(planId);

  if (!planRow) return null;

  const residentRows = db.prepare(`
    SELECT
      m.*,
      r.full_name as resident_name,
      rm.room_number
    FROM resident_meal_records m
    JOIN residents r ON r.id = m.resident_id
    JOIN resident_stays s ON s.id = m.stay_id
    JOIN rooms rm ON rm.id = s.room_id
    WHERE m.plan_id = ?
    ORDER BY rm.floor ASC, rm.room_number ASC, r.full_name ASC
  `).all(planId);

  const adjustmentRows = db.prepare(`
    SELECT
      a.*,
      u.full_name as created_by_name
    FROM meal_plan_adjustments a
    LEFT JOIN staff_users u ON u.id = a.created_by
    WHERE a.plan_id = ?
    ORDER BY a.created_at ASC
  `).all(planId);

  return {
    plan: mapRowToMealPlan(planRow),
    residentRecords: residentRows.map(mapRowToMealRecord),
    adjustments: adjustmentRows.map(mapRowToAdjustment),
  };
}

/**
 * Lists meal plans filtered by date range, meal type, or status.
 * Requires kitchen.read permission.
 */
export function listMealPlans(
  actor: AuthenticatedUser,
  options?: ListMealPlansOptions
): DailyMealPlan[] {
  requirePermission(actor, "kitchen.read");

  const db = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.startDate) {
    conditions.push("p.service_date >= ?");
    params.push(options.startDate);
  }
  if (options?.endDate) {
    conditions.push("p.service_date <= ?");
    params.push(options.endDate);
  }
  if (options?.mealType) {
    conditions.push("p.meal_type = ?");
    params.push(options.mealType);
  }
  if (options?.status) {
    conditions.push("p.status = ?");
    params.push(options.status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, Number(options?.limit) || 100));
  const offset = Math.max(0, Number(options?.offset) || 0);

  const rows = db.prepare(`
    SELECT
      p.*,
      u1.full_name as created_by_name,
      u2.full_name as confirmed_by_name,
      u3.full_name as completed_by_name
    FROM daily_meal_plans p
    LEFT JOIN staff_users u1 ON u1.id = p.created_by
    LEFT JOIN staff_users u2 ON u2.id = p.confirmed_by
    LEFT JOIN staff_users u3 ON u3.id = p.completed_by
    ${whereClause}
    ORDER BY p.service_date DESC,
      CASE p.meal_type WHEN 'DINNER' THEN 1 WHEN 'LUNCH' THEN 2 WHEN 'BREAKFAST' THEN 3 END
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  return rows.map(mapRowToMealPlan);
}

/**
 * Retrieves preparation sheet data for a specific plan.
 * Requires kitchen.read permission.
 */
export function getPreparationSheetData(
  actor: AuthenticatedUser,
  planId: string
): PreparationSheetData | null {
  const detail = getMealPlanById(actor, planId);
  if (!detail) return null;

  const { plan, residentRecords, adjustments } = detail;

  const confirmedCount = residentRecords.filter((r) => r.status === "CONFIRMED").length;
  const optedOutCount = residentRecords.filter((r) => r.status === "OPTED_OUT").length;

  return {
    plan,
    residentRecords,
    adjustments,
    summary: {
      serviceDate: plan.serviceDate,
      mealType: plan.mealType,
      eligibleResidentCount: residentRecords.length,
      confirmedResidentCount: confirmedCount,
      optedOutResidentCount: optedOutCount,
      guestCount: plan.guestCount,
      finalPreparationCount: plan.finalPreparationCount,
      status: plan.status,
      lastUpdatedBy: plan.completedByName || plan.confirmedByName || plan.createdByName || null,
      lastUpdatedAt: plan.updatedAt,
    },
  };
}

/**
 * Retrieves the kitchen dashboard summary for a given date.
 * If serviceDate is not specified, defaults to current local date.
 * Requires kitchen.read permission.
 */
export function getKitchenDashboardSummary(
  actor: AuthenticatedUser,
  serviceDate?: string
): KitchenDashboardSummary {
  requirePermission(actor, "kitchen.read");

  const now = new Date();
  const date = serviceDate && DATE_REGEX.test(serviceDate) ? serviceDate : now.toISOString().slice(0, 10);

  const db = getDb();

  const plans = listMealPlans(actor, { startDate: date, endDate: date });

  const breakfast = plans.find((p) => p.mealType === "BREAKFAST") || null;
  const lunch = plans.find((p) => p.mealType === "LUNCH") || null;
  const dinner = plans.find((p) => p.mealType === "DINNER") || null;

  const eligible = getEligibleResidentsForDate(actor, date);

  const bCount = breakfast?.finalPreparationCount || 0;
  const lCount = lunch?.finalPreparationCount || 0;
  const dCount = dinner?.finalPreparationCount || 0;

  return {
    serviceDate: date,
    plans: {
      breakfast,
      lunch,
      dinner,
    },
    metrics: {
      totalMealsPreparedToday: bCount + lCount + dCount,
      breakfastCount: bCount,
      lunchCount: lCount,
      dinnerCount: dCount,
      eligibleResidentsCount: eligible.length,
    },
  };
}

/**
 * Upserts default meal preferences for a resident.
 * Requires kitchen.manage permission.
 */
export function updateResidentMealPreference(
  actor: AuthenticatedUser,
  residentId: string,
  input: {
    breakfastOptIn?: boolean;
    lunchOptIn?: boolean;
    dinnerOptIn?: boolean;
    dietaryPreference?: string;
    notes?: string;
  },
  clientIp?: string
): void {
  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.preference_updated" });

  const db = getDb();
  const now = new Date().toISOString();

  const bOpt = input.breakfastOptIn !== false ? 1 : 0;
  const lOpt = input.lunchOptIn !== false ? 1 : 0;
  const dOpt = input.dinnerOptIn !== false ? 1 : 0;
  const diet = input.dietaryPreference?.trim() || "VEG";
  const notes = input.notes?.trim() || null;

  db.prepare(`
    INSERT INTO resident_meal_preferences (
      resident_id, breakfast_opt_in, lunch_opt_in, dinner_opt_in,
      dietary_preference, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(resident_id) DO UPDATE SET
      breakfast_opt_in = excluded.breakfast_opt_in,
      lunch_opt_in = excluded.lunch_opt_in,
      dinner_opt_in = excluded.dinner_opt_in,
      dietary_preference = excluded.dietary_preference,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run(residentId, bOpt, lOpt, dOpt, diet, notes, now, now);

  recordAuditEvent({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "kitchen.preference_updated",
    targetType: "resident",
    targetId: residentId,
    metadata: {
      breakfastOptIn: bOpt === 1,
      lunchOptIn: lOpt === 1,
      dinnerOptIn: dOpt === 1,
      dietaryPreference: diet,
    },
    ipAddress: clientIp,
  });
}
