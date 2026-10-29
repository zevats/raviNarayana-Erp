import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { recordAuditEventAsync } from "../audit/audit";
import { assertClosingDateNotFinalized, getTransactionById } from "../finance/financeService";
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
  ReconcileMealPlanInput,
  SubscriptionMealDemand,
  DailyKitchenDemandResult,
  FinancialTransaction,
  PaymentMethod,
  normalizePaymentMethod,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_MEAL_TYPES: readonly MealType[] = ["BREAKFAST", "LUNCH", "DINNER"];
const VALID_PLAN_STATUSES: readonly MealPlanStatus[] = ["DRAFT", "CONFIRMED", "COMPLETED"];

export interface CreateMealPlanInput {
  serviceDate: string;
  mealType: MealType;
  plannedTiffinCount?: number;
  guestCount?: number;
  notes?: string;
  residentOptOuts?: string[];
  status?: "DRAFT" | "CONFIRMED";
}

export interface UpdateMealPlanInput {
  plannedTiffinCount?: number;
  guestCount?: number;
  notes?: string;
  residentOptOuts?: string[];
}

export interface AdjustQuantityInput {
  newResidentCount?: number;
  newTiffinCount?: number;
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
    plannedResidentCount: Number(row.planned_resident_count || 0),
    plannedTiffinCount: Number(row.planned_tiffin_count || 0),
    guestCount: Number(row.guest_count || 0),
    finalPreparationCount: Number(row.final_preparation_count || 0),
    actualCookedCount: row.actual_cooked_count !== undefined && row.actual_cooked_count !== null
      ? Number(row.actual_cooked_count)
      : Number(row.final_preparation_count || 0),
    dispatchedCount: row.dispatched_count !== null && row.dispatched_count !== undefined
      ? Number(row.dispatched_count)
      : 0,
    leftoverCount: row.leftover_count !== null && row.leftover_count !== undefined
      ? Number(row.leftover_count)
      : 0,
    wasteCount: row.waste_count !== null && row.waste_count !== undefined
      ? Number(row.waste_count)
      : 0,
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
    reconciledBy: row.reconciled_by || null,
    reconciledByName: row.reconciled_by_name || null,
    reconciledAt: row.reconciled_at || null,
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
export async function getEligibleResidentsForDate(
  actor: AuthenticatedUser,
  serviceDate: string,
  asyncDb?: AsyncDb
): Promise<ResidentMealEligibility[]> {
  requirePermission(actor, "kitchen.read");

  const cleanDate = serviceDate?.trim();
  if (!cleanDate || !DATE_REGEX.test(cleanDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }

  const db = asyncDb || getAsyncDb();

  // A resident is eligible if they have a stay covering serviceDate:
  // 1. check_in_date <= serviceDate
  // 2. Either ACTIVE stay (check_out_date IS NULL OR check_out_date >= serviceDate)
  //    OR COMPLETED stay where check_out_date >= serviceDate (departing on or after serviceDate).
  // Residents with check_out_date < serviceDate are strictly excluded.
  const rows = await db.query<any>(`
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
  `, [cleanDate, cleanDate, cleanDate]);

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
 * Calculates active commercial Tiffin subscriptions eligible for a given date and optional meal type.
 * Enforces date effective range, pause dates, and day-of-week schedules.
 * Requires kitchen.read permission.
 */
export async function getEligibleTiffinSubscriptionsForDate(
  actor: AuthenticatedUser,
  serviceDate: string,
  mealType?: MealType,
  asyncDb?: AsyncDb
): Promise<SubscriptionMealDemand[]> {
  if (
    !hasPermission(actor.role, "kitchen.read") &&
    !hasPermission(actor.role, "delivery.manage") &&
    !hasPermission(actor.role, "tiffin.read")
  ) {
    requirePermission(actor, "kitchen.read");
  }

  const cleanDate = serviceDate?.trim();
  if (!cleanDate || !DATE_REGEX.test(cleanDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }

  const db = asyncDb || getAsyncDb();

  const [year, month, day] = cleanDate.split("-").map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeekIndex = dateObj.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat

  const rows = await db.query<any>(`
    SELECT
      s.id as subscription_id,
      s.customer_id,
      s.product_id,
      s.status,
      s.start_date,
      s.end_date,
      s.meal_types,
      s.service_days,
      s.quantity_per_meal,
      s.pause_start_date,
      s.pause_resume_date,
      s.cancelled_at,
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
  `, [cleanDate, cleanDate]);

  const eligible: SubscriptionMealDemand[] = [];

  for (const row of rows) {
    // 1. Pause check
    if (row.pause_start_date) {
      const isPaused = cleanDate >= row.pause_start_date &&
        (!row.pause_resume_date || cleanDate < row.pause_resume_date);
      if (isPaused) {
        continue;
      }
    }

    // 2. Service days schedule
    const serviceDays = row.service_days;
    if (serviceDays === "MON_SAT") {
      if (dayOfWeekIndex === 0) continue; // Sunday excluded
    } else if (serviceDays === "MON_FRI") {
      if (dayOfWeekIndex === 0 || dayOfWeekIndex === 6) continue; // Weekends excluded
    }
    // ALL_DAYS: all 7 days valid

    // 3. Meal type schedule
    const mealTypes = row.meal_types;
    if (mealType) {
      if (mealType === "BREAKFAST" && mealTypes !== "BREAKFAST") continue;
      if (mealType === "LUNCH" && mealTypes !== "LUNCH" && mealTypes !== "BOTH") continue;
      if (mealType === "DINNER" && mealTypes !== "DINNER" && mealTypes !== "BOTH") continue;
    }

    eligible.push({
      subscriptionId: row.subscription_id,
      customerId: row.customer_id,
      customerName: row.customer_name || "Unknown Customer",
      customerPhone: row.customer_phone || "",
      customerType: row.customer_type || "INDIVIDUAL",
      dietaryPreference: row.dietary_preference || "VEG",
      productId: row.product_id,
      productName: row.product_name || "Tiffin Meal",
      mealTypes: row.meal_types,
      serviceDays: row.service_days,
      quantityPerMeal: Math.max(1, Number(row.quantity_per_meal || 1)),
      deliveryAddress: row.delivery_address || "",
      deliveryInstructions: row.delivery_instructions || null,
    });
  }

  return eligible;
}

/**
 * Calculates authoritative daily kitchen demand for a selected business date.
 * Combines PG resident eligibility and commercial Tiffin subscriptions with full source attribution.
 * Requires kitchen.read permission.
 */
export async function calculateDailyKitchenDemand(
  actor: AuthenticatedUser,
  serviceDate: string,
  asyncDb?: AsyncDb
): Promise<DailyKitchenDemandResult> {
  requirePermission(actor, "kitchen.read");

  const cleanDate = serviceDate?.trim();
  if (!cleanDate || !DATE_REGEX.test(cleanDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }

  const db = asyncDb || getAsyncDb();

  const [year, month, day] = cleanDate.split("-").map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day));
  const dayNames = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const dayOfWeek = dayNames[dateObj.getUTCDay()];

  // 1. Get eligible residents
  const eligibleResidents = await getEligibleResidentsForDate(actor, cleanDate, db);

  // Get preferences
  const prefRows = await db.query<any>(`
    SELECT resident_id, breakfast_opt_in, lunch_opt_in, dinner_opt_in
    FROM resident_meal_preferences
  `);
  const prefMap = new Map<string, { breakfast: boolean; lunch: boolean; dinner: boolean }>();
  for (const pr of prefRows) {
    prefMap.set(pr.resident_id, {
      breakfast: pr.breakfast_opt_in !== 0 && pr.breakfast_opt_in !== false,
      lunch: pr.lunch_opt_in !== 0 && pr.lunch_opt_in !== false,
      dinner: pr.dinner_opt_in !== 0 && pr.dinner_opt_in !== false,
    });
  }

  // Check saved opt-outs if meal plans already exist
  const existingPlans = await db.query<any>(`
    SELECT id, meal_type FROM daily_meal_plans WHERE service_date = ?
  `, [cleanDate]);

  const savedOptOutsByMeal = new Map<MealType, Set<string>>();
  for (const ep of existingPlans) {
    const optOutRows = await db.query<any>(`
      SELECT resident_id FROM resident_meal_records WHERE plan_id = ? AND status = 'OPTED_OUT'
    `, [ep.id]);
    savedOptOutsByMeal.set(ep.meal_type as MealType, new Set(optOutRows.map((r: any) => r.resident_id)));
  }

  const calcResidentMealDemand = (mType: MealType): number => {
    let count = 0;
    const optOutSet = savedOptOutsByMeal.get(mType);

    for (const res of eligibleResidents) {
      if (optOutSet && optOutSet.has(res.residentId)) {
        continue;
      }
      const pref = prefMap.get(res.residentId);
      if (pref) {
        if (mType === "BREAKFAST" && !pref.breakfast) continue;
        if (mType === "LUNCH" && !pref.lunch) continue;
        if (mType === "DINNER" && !pref.dinner) continue;
      }
      count++;
    }
    return count;
  };

  const resBreakfast = calcResidentMealDemand("BREAKFAST");
  const resLunch = calcResidentMealDemand("LUNCH");
  const resDinner = calcResidentMealDemand("DINNER");

  // 2. Get eligible commercial tiffin subscriptions per meal
  const breakfastSubs = await getEligibleTiffinSubscriptionsForDate(actor, cleanDate, "BREAKFAST", db);
  const lunchSubs = await getEligibleTiffinSubscriptionsForDate(actor, cleanDate, "LUNCH", db);
  const dinnerSubs = await getEligibleTiffinSubscriptionsForDate(actor, cleanDate, "DINNER", db);

  const tiffinBreakfast = breakfastSubs.reduce((sum, s) => sum + s.quantityPerMeal, 0);
  const tiffinLunch = lunchSubs.reduce((sum, s) => sum + s.quantityPerMeal, 0);
  const tiffinDinner = dinnerSubs.reduce((sum, s) => sum + s.quantityPerMeal, 0);

  const allSubIds = new Set<string>([
    ...breakfastSubs.map((s) => s.subscriptionId),
    ...lunchSubs.map((s) => s.subscriptionId),
    ...dinnerSubs.map((s) => s.subscriptionId),
  ]);

  const totalPortions = (resBreakfast + tiffinBreakfast) + (resLunch + tiffinLunch) + (resDinner + tiffinDinner);

  return {
    serviceDate: cleanDate,
    dayOfWeek,
    breakdown: {
      breakfast: {
        mealType: "BREAKFAST",
        residentDemand: resBreakfast,
        tiffinDemand: tiffinBreakfast,
        totalRequired: resBreakfast + tiffinBreakfast,
        subscriptions: breakfastSubs,
        residentCount: eligibleResidents.length,
      },
      lunch: {
        mealType: "LUNCH",
        residentDemand: resLunch,
        tiffinDemand: tiffinLunch,
        totalRequired: resLunch + tiffinLunch,
        subscriptions: lunchSubs,
        residentCount: eligibleResidents.length,
      },
      dinner: {
        mealType: "DINNER",
        residentDemand: resDinner,
        tiffinDemand: tiffinDinner,
        totalRequired: resDinner + tiffinDinner,
        subscriptions: dinnerSubs,
        residentCount: eligibleResidents.length,
      },
    },
    totalResidents: eligibleResidents.length,
    totalSubscriptions: allSubIds.size,
    totalPortions,
  };
}

/**
 * Creates a daily meal plan with calculated resident attendance and commercial Tiffin demand.
 * Requires kitchen.manage permission.
 */
export async function createMealPlan(
  actor: AuthenticatedUser,
  input: CreateMealPlanInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DailyMealPlan> {
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

  const db = asyncDb || getAsyncDb();

  // Check duplicate plan for same service_date and meal_type
  const existingPlan = await db.queryOne<{ id: string; status: string }>(`
    SELECT id, status FROM daily_meal_plans WHERE service_date = ? AND meal_type = ?
  `, [serviceDate, mealType]);

  if (existingPlan) {
    throw new Error(
      `A meal plan for ${mealType} on ${serviceDate} already exists (ID: ${existingPlan.id}, Status: ${existingPlan.status}). Duplicate plans for the same date and meal are prevented.`
    );
  }

  // 1. Authoritatively compute eligible residents for serviceDate
  const eligibleResidents = await getEligibleResidentsForDate(actor, serviceDate, db);

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

  // 2. Authoritatively compute commercial Tiffin subscription demand
  let plannedTiffinCount = 0;
  if (input.plannedTiffinCount !== undefined) {
    plannedTiffinCount = Math.max(0, Number(input.plannedTiffinCount));
  } else {
    const tiffinSubs = await getEligibleTiffinSubscriptionsForDate(actor, serviceDate, mealType, db);
    plannedTiffinCount = tiffinSubs.reduce((sum, s) => sum + s.quantityPerMeal, 0);
  }

  const finalPreparationCount = plannedResidentCount + plannedTiffinCount + guestCount;
  const planId = `dmp_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const confirmedBy = initialStatus === "CONFIRMED" ? actor.id : null;
  const confirmedAt = initialStatus === "CONFIRMED" ? now : null;

  try {
    await db.transaction(async (tx) => {
      // 1. Insert meal plan
      await tx.execute(`
        INSERT INTO daily_meal_plans (
          id, service_date, meal_type, planned_resident_count, planned_tiffin_count, guest_count,
          final_preparation_count, status, notes, created_by, confirmed_by,
          confirmed_at, completed_by, completed_at, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, NULL, NULL, ?, ?
        )
      `, [
        planId,
        serviceDate,
        mealType,
        plannedResidentCount,
        plannedTiffinCount,
        guestCount,
        finalPreparationCount,
        initialStatus,
        notes,
        actor.id,
        confirmedBy,
        confirmedAt,
        now,
        now,
      ]);

      // 2. Insert individual resident attendance records
      for (const rec of residentRecordsToInsert) {
        await tx.execute(`
          INSERT INTO resident_meal_records (
            id, plan_id, resident_id, stay_id, service_date, meal_type,
            status, notes, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        `, [
          rec.id,
          planId,
          rec.residentId,
          rec.stayId,
          serviceDate,
          mealType,
          rec.status,
          actor.id,
          now,
          now,
        ]);
      }

      // 3. Audit log
      await recordAuditEventAsync({
        actorId: actor.id,
        actorUsername: actor.username,
        action: "kitchen.plan_created",
        targetType: "meal_plan",
        targetId: planId,
        metadata: {
          serviceDate,
          mealType,
          plannedResidentCount,
          plannedTiffinCount,
          guestCount,
          finalPreparationCount,
          status: initialStatus,
          eligibleCount: eligibleResidents.length,
        },
        ipAddress: clientIp,
      }, tx);

      if (initialStatus === "CONFIRMED") {
        await recordAuditEventAsync({
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
        }, tx);
      }
    });
  } catch (err: any) {
    if (
      err.message &&
      (err.message.includes("UNIQUE constraint failed") ||
        err.message.includes("duplicate key value") ||
        err.code === "23505")
    ) {
      throw new Error(
        `A meal plan for ${mealType} on ${serviceDate} already exists. Duplicate plans for the same date and meal are prevented.`
      );
    }
    throw err;
  }

  const createdDetail = await getMealPlanById(actor, planId, db);
  return createdDetail!.plan;
}

/**
 * Updates a draft meal plan's notes, guest counts, or resident opt-outs.
 * Completed plans cannot be modified directly without an explicit adjustment.
 * Requires kitchen.manage permission.
 */
export async function updateMealPlan(
  actor: AuthenticatedUser,
  planId: string,
  input: UpdateMealPlanInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DailyMealPlan> {
  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.plan_updated" });

  const db = asyncDb || getAsyncDb();
  const plan = await getMealPlanById(actor, planId, db);
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
  const plannedTiffinCount =
    input.plannedTiffinCount !== undefined
      ? Math.max(0, Number(input.plannedTiffinCount))
      : (plan.plan.plannedTiffinCount || 0);
  const notes = input.notes !== undefined ? input.notes?.trim() || null : plan.plan.notes;

  if (!Number.isInteger(guestCount) || guestCount < 0) {
    throw new Error("Guest count must be a non-negative integer.");
  }
  if (!Number.isInteger(plannedTiffinCount) || plannedTiffinCount < 0) {
    throw new Error("Tiffin count must be a non-negative integer.");
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    // If resident opt-outs are provided, update attendance records
    let plannedResidentCount = plan.plan.plannedResidentCount;

    if (input.residentOptOuts !== undefined) {
      const optOutSet = new Set(input.residentOptOuts);
      const records = plan.residentRecords;

      let confirmedCount = 0;
      for (const rec of records) {
        const newStatus: AttendanceStatus = optOutSet.has(rec.residentId) ? "OPTED_OUT" : "CONFIRMED";
        if (newStatus === "CONFIRMED") {
          confirmedCount++;
        }
        if (newStatus !== rec.status) {
          await tx.execute(`
            UPDATE resident_meal_records
            SET status = ?, updated_at = ?
            WHERE id = ?
          `, [newStatus, now, rec.id]);
        }
      }
      plannedResidentCount = confirmedCount;
    }

    const finalPreparationCount = plannedResidentCount + plannedTiffinCount + guestCount;

    await tx.execute(`
      UPDATE daily_meal_plans
      SET planned_resident_count = ?, planned_tiffin_count = ?, guest_count = ?, final_preparation_count = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `, [plannedResidentCount, plannedTiffinCount, guestCount, finalPreparationCount, notes, now, planId]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "kitchen.plan_updated",
      targetType: "meal_plan",
      targetId: planId,
      metadata: {
        serviceDate: plan.plan.serviceDate,
        mealType: plan.plan.mealType,
        plannedResidentCount,
        plannedTiffinCount,
        guestCount,
        finalPreparationCount,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedDetail = await getMealPlanById(actor, planId, db);
  return updatedDetail!.plan;
}

/**
 * Confirms a draft meal plan for preparation.
 * Requires kitchen.manage permission.
 */
export async function confirmMealPlan(
  actor: AuthenticatedUser,
  planId: string,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<DailyMealPlan> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.plan_confirmed" });

  const current = await getMealPlanById(actor, planId, db);
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

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE daily_meal_plans
      SET status = 'CONFIRMED', confirmed_by = ?, confirmed_at = ?, updated_at = ?
      WHERE id = ?
    `, [actor.id, now, now, planId]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  const updated = await getMealPlanById(actor, planId, db);
  return updated!.plan;
}

/**
 * Completes a meal plan after kitchen service is finished.
 * Requires kitchen.manage permission.
 */
export async function completeMealPlan(
  actor: AuthenticatedUser,
  planId: string,
  actualCookedCountOrIp?: number | string | AsyncDb,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<DailyMealPlan> {
  let actualCookedCount: number | undefined;
  let ip: string | undefined;
  let dbInstance = asyncDb;

  if (typeof actualCookedCountOrIp === "number") {
    actualCookedCount = actualCookedCountOrIp;
  } else if (typeof actualCookedCountOrIp === "string") {
    ip = actualCookedCountOrIp;
  } else if (actualCookedCountOrIp && typeof actualCookedCountOrIp === "object") {
    dbInstance = actualCookedCountOrIp;
  }

  if (typeof clientIpOrDb === "string") {
    ip = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }

  const db = dbInstance ?? getAsyncDb();
  requirePermission(actor, "kitchen.manage", { ip, action: "kitchen.plan_completed" });

  const current = await getMealPlanById(actor, planId, db);
  if (!current) {
    throw new Error(`Meal plan '${planId}' not found.`);
  }

  if (current.plan.status === "COMPLETED") {
    return current.plan; // Idempotent
  }

  const now = new Date().toISOString();
  const cookedCount = actualCookedCount !== undefined ? Math.max(0, actualCookedCount) : current.plan.finalPreparationCount;

  await db.transaction(async (tx) => {
    // If plan was in DRAFT, also stamp confirmation
    if (current.plan.status === "DRAFT") {
      await tx.execute(`
        UPDATE daily_meal_plans
        SET confirmed_by = ?, confirmed_at = ?
        WHERE id = ? AND confirmed_by IS NULL
      `, [actor.id, now, planId]);
    }

    await tx.execute(`
      UPDATE daily_meal_plans
      SET status = 'COMPLETED', completed_by = ?, completed_at = ?, updated_at = ?, actual_cooked_count = ?
      WHERE id = ?
    `, [actor.id, now, now, cookedCount, planId]);

    await recordAuditEventAsync({
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
    }, tx);
  });

  const updated = await getMealPlanById(actor, planId, db);
  return updated!.plan;
}

/**
 * Records a justified manual quantity adjustment on an existing plan.
 * Captures previous quantity, new quantity, actor, and mandatory explanation.
 * Requires kitchen.manage permission.
 */
export async function adjustMealPlanQuantity(
  actor: AuthenticatedUser,
  planId: string,
  input: AdjustQuantityInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<DailyMealPlan> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.quantity_adjusted" });

  const reason = input.reason?.trim();
  if (!reason || reason.length < 5) {
    throw new Error("A clear justification reason of at least 5 characters is required for quantity adjustments.");
  }

  const current = await getMealPlanById(actor, planId, db);
  if (!current) {
    throw new Error(`Meal plan '${planId}' not found.`);
  }

  const prevRes = current.plan.plannedResidentCount;
  const prevTiffin = current.plan.plannedTiffinCount || 0;
  const prevGuest = current.plan.guestCount;
  const prevTotal = current.plan.finalPreparationCount;

  const newRes = input.newResidentCount !== undefined ? Math.max(0, Number(input.newResidentCount)) : prevRes;
  const newTiffin = input.newTiffinCount !== undefined ? Math.max(0, Number(input.newTiffinCount)) : prevTiffin;
  const newGuest = input.newGuestCount !== undefined ? Math.max(0, Number(input.newGuestCount)) : prevGuest;

  if (!Number.isInteger(newRes) || newRes < 0) {
    throw new Error("Resident count must be a non-negative integer.");
  }
  if (!Number.isInteger(newTiffin) || newTiffin < 0) {
    throw new Error("Tiffin count must be a non-negative integer.");
  }
  if (!Number.isInteger(newGuest) || newGuest < 0) {
    throw new Error("Guest count must be a non-negative integer.");
  }

  const newTotal = newRes + newTiffin + newGuest;
  const adjId = `mpa_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    // 1. Record append-only adjustment history
    await tx.execute(`
      INSERT INTO meal_plan_adjustments (
        id, plan_id, previous_resident_count, new_resident_count,
        previous_guest_count, new_guest_count, previous_total,
        new_total, reason, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
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
    ]);

    // 2. Update plan preparation counts
    await tx.execute(`
      UPDATE daily_meal_plans
      SET planned_resident_count = ?, planned_tiffin_count = ?, guest_count = ?, final_preparation_count = ?, updated_at = ?
      WHERE id = ?
    `, [newRes, newTiffin, newGuest, newTotal, now, planId]);

    // 3. Emit audit event
    await recordAuditEventAsync({
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
    }, tx);
  });

  const updated = await getMealPlanById(actor, planId, db);
  return updated!.plan;
}

/**
 * Refreshes an active meal plan's resident and commercial Tiffin demand from authoritative live subscriptions and stays.
 * Preserves guestCount and existing resident attendance overrides.
 * Requires kitchen.manage permission.
 */
export async function refreshMealPlanDemand(
  actor: AuthenticatedUser,
  planId: string,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<DailyMealPlan> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.plan_refreshed" });

  const current = await getMealPlanById(actor, planId, db);
  if (!current) {
    throw new Error(`Meal plan '${planId}' not found.`);
  }

  if (current.plan.status === "COMPLETED") {
    throw new Error(
      "Completed meal plans cannot be refreshed. Use justified quantity adjustment to record auditable corrections."
    );
  }

  const { serviceDate, mealType } = current.plan;

  // 1. Authoritative resident demand
  const eligibleResidents = await getEligibleResidentsForDate(actor, serviceDate, db);
  const existingRecordMap = new Map<string, ResidentMealRecord>();
  for (const r of current.residentRecords) {
    existingRecordMap.set(r.residentId, r);
  }

  const now = new Date().toISOString();
  let plannedResidentCount = 0;
  const newResidentRecordsToInsert: Array<{
    id: string;
    residentId: string;
    stayId: string;
    status: AttendanceStatus;
  }> = [];

  for (const res of eligibleResidents) {
    const existing = existingRecordMap.get(res.residentId);
    if (existing) {
      if (existing.status === "CONFIRMED") {
        plannedResidentCount++;
      }
    } else {
      // Newly eligible resident: check preference
      const pref = await db.queryOne<any>(`
        SELECT breakfast_opt_in, lunch_opt_in, dinner_opt_in
        FROM resident_meal_preferences
        WHERE resident_id = ?
      `, [res.residentId]);

      let optIn = true;
      if (pref) {
        if (mealType === "BREAKFAST") optIn = pref.breakfast_opt_in !== 0 && pref.breakfast_opt_in !== false;
        if (mealType === "LUNCH") optIn = pref.lunch_opt_in !== 0 && pref.lunch_opt_in !== false;
        if (mealType === "DINNER") optIn = pref.dinner_opt_in !== 0 && pref.dinner_opt_in !== false;
      }

      const status: AttendanceStatus = optIn ? "CONFIRMED" : "OPTED_OUT";
      if (status === "CONFIRMED") {
        plannedResidentCount++;
      }
      newResidentRecordsToInsert.push({
        id: `rmr_${crypto.randomUUID()}`,
        residentId: res.residentId,
        stayId: res.stayId,
        status,
      });
    }
  }

  // 2. Authoritative commercial Tiffin demand
  const tiffinSubs = await getEligibleTiffinSubscriptionsForDate(actor, serviceDate, mealType, db);
  const plannedTiffinCount = tiffinSubs.reduce((sum, s) => sum + s.quantityPerMeal, 0);

  const guestCount = current.plan.guestCount;
  const finalPreparationCount = plannedResidentCount + plannedTiffinCount + guestCount;

  await db.transaction(async (tx) => {
    for (const rec of newResidentRecordsToInsert) {
      await tx.execute(`
        INSERT INTO resident_meal_records (
          id, plan_id, resident_id, stay_id, service_date, meal_type,
          status, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
      `, [
        rec.id,
        planId,
        rec.residentId,
        rec.stayId,
        serviceDate,
        mealType,
        rec.status,
        actor.id,
        now,
        now,
      ]);
    }

    await tx.execute(`
      UPDATE daily_meal_plans
      SET planned_resident_count = ?, planned_tiffin_count = ?, final_preparation_count = ?, updated_at = ?
      WHERE id = ?
    `, [plannedResidentCount, plannedTiffinCount, finalPreparationCount, now, planId]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "kitchen.plan_refreshed",
      targetType: "meal_plan",
      targetId: planId,
      metadata: {
        serviceDate,
        mealType,
        previousResidentCount: current.plan.plannedResidentCount,
        newResidentCount: plannedResidentCount,
        previousTiffinCount: current.plan.plannedTiffinCount || 0,
        newTiffinCount: plannedTiffinCount,
        guestCount,
        previousTotal: current.plan.finalPreparationCount,
        newTotal: finalPreparationCount,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedDetail = await getMealPlanById(actor, planId, db);
  return updatedDetail!.plan;
}

/**
 * Records kitchen production reconciliation metrics (cooked, dispatched, leftovers, waste).
 * Validates invariant: dispatched + leftover + waste <= actualCookedCount.
 * Automatically marks the plan as COMPLETED if not already completed.
 * Requires kitchen.manage permission.
 */
export async function reconcileMealPlanProduction(
  actor: AuthenticatedUser,
  planId: string,
  input: ReconcileMealPlanInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<DailyMealPlan> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.production_reconciled" });

  const current = await getMealPlanById(actor, planId, db);
  if (!current) {
    throw new Error(`Meal plan '${planId}' not found.`);
  }

  const actualCooked = Number(input.actualCookedCount);
  const dispatched = input.dispatchedCount !== undefined ? Number(input.dispatchedCount) : 0;
  const leftover = input.leftoverCount !== undefined ? Number(input.leftoverCount) : 0;
  const waste = input.wasteCount !== undefined ? Number(input.wasteCount) : 0;

  if (!Number.isInteger(actualCooked) || actualCooked < 0) {
    throw new Error("Actual cooked count must be a non-negative integer.");
  }
  if (!Number.isInteger(dispatched) || dispatched < 0) {
    throw new Error("Dispatched count must be a non-negative integer.");
  }
  if (!Number.isInteger(leftover) || leftover < 0) {
    throw new Error("Leftover count must be a non-negative integer.");
  }
  if (!Number.isInteger(waste) || waste < 0) {
    throw new Error("Waste count must be a non-negative integer.");
  }

  const totalAccounted = dispatched + leftover + waste;
  if (totalAccounted > actualCooked) {
    throw new Error(
      `Dispatched (${dispatched}), leftover (${leftover}), and waste (${waste}) portions cannot exceed actual cooked count (${actualCooked}). Total accounted: ${totalAccounted}.`
    );
  }

  const now = new Date().toISOString();
  const notes = input.notes?.trim() || current.plan.notes;

  await db.transaction(async (tx) => {
    // If plan was in DRAFT, also stamp confirmation
    if (current.plan.status === "DRAFT") {
      await tx.execute(`
        UPDATE daily_meal_plans
        SET confirmed_by = ?, confirmed_at = ?
        WHERE id = ? AND confirmed_by IS NULL
      `, [actor.id, now, planId]);
    }

    await tx.execute(`
      UPDATE daily_meal_plans
      SET
        status = 'COMPLETED',
        actual_cooked_count = ?,
        dispatched_count = ?,
        leftover_count = ?,
        waste_count = ?,
        reconciled_by = ?,
        reconciled_at = ?,
        completed_by = COALESCE(completed_by, ?),
        completed_at = COALESCE(completed_at, ?),
        notes = ?,
        updated_at = ?
      WHERE id = ?
    `, [
      actualCooked,
      dispatched,
      leftover,
      waste,
      actor.id,
      now,
      actor.id,
      now,
      notes,
      now,
      planId,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "kitchen.production_reconciled",
      targetType: "meal_plan",
      targetId: planId,
      metadata: {
        serviceDate: current.plan.serviceDate,
        mealType: current.plan.mealType,
        plannedTotal: current.plan.finalPreparationCount,
        actualCookedCount: actualCooked,
        dispatchedCount: dispatched,
        leftoverCount: leftover,
        wasteCount: waste,
        variance: actualCooked - current.plan.finalPreparationCount,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedDetail = await getMealPlanById(actor, planId, db);
  return updatedDetail!.plan;
}

/**
 * Retrieves a meal plan by ID with resident attendance and adjustments.
 * Requires kitchen.read permission.
 */
export async function getMealPlanById(
  actor: AuthenticatedUser,
  planId: string,
  asyncDb?: AsyncDb
): Promise<{ plan: DailyMealPlan; residentRecords: ResidentMealRecord[]; adjustments: MealPlanAdjustment[] } | null> {
  requirePermission(actor, "kitchen.read");

  const db = asyncDb ?? getAsyncDb();
  const planRow = await db.queryOne<any>(`
    SELECT
      p.*,
      u1.full_name as created_by_name,
      u2.full_name as confirmed_by_name,
      u3.full_name as completed_by_name,
      u4.full_name as reconciled_by_name
    FROM daily_meal_plans p
    LEFT JOIN staff_users u1 ON u1.id = p.created_by
    LEFT JOIN staff_users u2 ON u2.id = p.confirmed_by
    LEFT JOIN staff_users u3 ON u3.id = p.completed_by
    LEFT JOIN staff_users u4 ON u4.id = p.reconciled_by
    WHERE p.id = ?
  `, [planId]);

  if (!planRow) return null;

  const residentRows = await db.query<any>(`
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
  `, [planId]);

  const adjustmentRows = await db.query<any>(`
    SELECT
      a.*,
      u.full_name as created_by_name
    FROM meal_plan_adjustments a
    LEFT JOIN staff_users u ON u.id = a.created_by
    WHERE a.plan_id = ?
    ORDER BY a.created_at ASC
  `, [planId]);

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
export async function listMealPlans(
  actor: AuthenticatedUser,
  options?: ListMealPlansOptions,
  asyncDb?: AsyncDb
): Promise<DailyMealPlan[]> {
  requirePermission(actor, "kitchen.read");

  const db = asyncDb ?? getAsyncDb();
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

  const rows = await db.query<any>(`
    SELECT
      p.*,
      u1.full_name as created_by_name,
      u2.full_name as confirmed_by_name,
      u3.full_name as completed_by_name,
      u4.full_name as reconciled_by_name
    FROM daily_meal_plans p
    LEFT JOIN staff_users u1 ON u1.id = p.created_by
    LEFT JOIN staff_users u2 ON u2.id = p.confirmed_by
    LEFT JOIN staff_users u3 ON u3.id = p.completed_by
    LEFT JOIN staff_users u4 ON u4.id = p.reconciled_by
    ${whereClause}
    ORDER BY p.service_date DESC,
      CASE p.meal_type WHEN 'DINNER' THEN 1 WHEN 'LUNCH' THEN 2 WHEN 'BREAKFAST' THEN 3 END
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  return rows.map(mapRowToMealPlan);
}

/**
 * Retrieves preparation sheet data for a specific plan.
 * Requires kitchen.read permission.
 */
export async function getPreparationSheetData(
  actor: AuthenticatedUser,
  planId: string,
  asyncDb?: AsyncDb
): Promise<PreparationSheetData | null> {
  const detail = await getMealPlanById(actor, planId, asyncDb);
  if (!detail) return null;

  const { plan, residentRecords, adjustments } = detail;
  const db = asyncDb ?? getAsyncDb();

  const confirmedCount = residentRecords.filter((r) => r.status === "CONFIRMED").length;
  const optedOutCount = residentRecords.filter((r) => r.status === "OPTED_OUT").length;

  const tiffinSubscriptions = await getEligibleTiffinSubscriptionsForDate(
    actor,
    plan.serviceDate,
    plan.mealType,
    db
  );

  return {
    plan,
    residentRecords,
    adjustments,
    tiffinSubscriptions,
    summary: {
      serviceDate: plan.serviceDate,
      mealType: plan.mealType,
      eligibleResidentCount: residentRecords.length,
      confirmedResidentCount: confirmedCount,
      optedOutResidentCount: optedOutCount,
      tiffinSubscriberCount: tiffinSubscriptions.length,
      guestCount: plan.guestCount,
      finalPreparationCount: plan.finalPreparationCount,
      actualCookedCount: plan.actualCookedCount,
      dispatchedCount: plan.dispatchedCount,
      leftoverCount: plan.leftoverCount,
      wasteCount: plan.wasteCount,
      status: plan.status,
      lastUpdatedBy: plan.reconciledByName || plan.completedByName || plan.confirmedByName || plan.createdByName || null,
      lastUpdatedAt: plan.updatedAt,
    },
  };
}

/**
 * Retrieves the kitchen dashboard summary for a given date.
 * If serviceDate is not specified, defaults to current local date.
 * Requires kitchen.read permission.
 */
export async function getKitchenDashboardSummary(
  actor: AuthenticatedUser,
  serviceDate?: string,
  asyncDb?: AsyncDb
): Promise<KitchenDashboardSummary> {
  requirePermission(actor, "kitchen.read");

  const now = new Date();
  const date = serviceDate && DATE_REGEX.test(serviceDate) ? serviceDate : now.toISOString().slice(0, 10);

  const db = asyncDb ?? getAsyncDb();

  const plans = await listMealPlans(actor, { startDate: date, endDate: date }, db);

  const breakfast = plans.find((p) => p.mealType === "BREAKFAST") || null;
  const lunch = plans.find((p) => p.mealType === "LUNCH") || null;
  const dinner = plans.find((p) => p.mealType === "DINNER") || null;

  const eligible = await getEligibleResidentsForDate(actor, date, db);

  const bCount = breakfast?.finalPreparationCount || 0;
  const lCount = lunch?.finalPreparationCount || 0;
  const dCount = dinner?.finalPreparationCount || 0;

  const tiffinBreakfast = breakfast?.plannedTiffinCount || 0;
  const tiffinLunch = lunch?.plannedTiffinCount || 0;
  const tiffinDinner = dinner?.plannedTiffinCount || 0;
  const tiffinMealsCount = tiffinBreakfast + tiffinLunch + tiffinDinner;

  const demand = await calculateDailyKitchenDemand(actor, date, db);
  const tiffinSubscribersCount = demand.totalSubscriptions;

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
      tiffinSubscribersCount,
      tiffinMealsCount,
    },
  };
}

/**
 * Upserts default meal preferences for a resident.
 * Requires kitchen.manage permission.
 */
export async function updateResidentMealPreference(
  actor: AuthenticatedUser,
  residentId: string,
  input: {
    breakfastOptIn?: boolean;
    lunchOptIn?: boolean;
    dinnerOptIn?: boolean;
    dietaryPreference?: string;
    notes?: string;
  },
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<void> {
  let clientIp: string | undefined;
  let dbInstance = asyncDb;

  if (typeof clientIpOrDb === "string") {
    clientIp = clientIpOrDb;
  } else if (clientIpOrDb && typeof clientIpOrDb === "object") {
    dbInstance = clientIpOrDb;
  }
  const db = dbInstance ?? getAsyncDb();

  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.preference_updated" });

  const now = new Date().toISOString();

  const bOpt = input.breakfastOptIn !== false ? 1 : 0;
  const lOpt = input.lunchOptIn !== false ? 1 : 0;
  const dOpt = input.dinnerOptIn !== false ? 1 : 0;
  const diet = input.dietaryPreference?.trim() || "VEG";
  const notes = input.notes?.trim() || null;

  await db.transaction(async (tx) => {
    await tx.execute(`
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
    `, [residentId, bOpt, lOpt, dOpt, diet, notes, now, now]);

    await recordAuditEventAsync({
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
    }, tx);
  });
}

export interface RecordWalkInSaleInput {
  serviceDate: string;
  mealType?: MealType;
  productId?: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  paymentMethod: string;
  buyerName?: string;
  buyerPhone?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface WalkInSaleRecord {
  id: string;
  transactionId: string;
  amount: number;
  serviceDate: string;
  mealType: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  paymentMethod: PaymentMethod;
  buyerName: string | null;
  buyerPhone: string | null;
  description: string | null;
  createdByName: string | null;
  createdAt: string;
}

export async function recordWalkInSale(
  actor: AuthenticatedUser,
  input: RecordWalkInSaleInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<{ transaction: FinancialTransaction; sale: WalkInSaleRecord }> {
  requirePermission(actor, "kitchen.manage", { ip: clientIp, action: "kitchen.walkin_sale" });

  const serviceDate = input.serviceDate?.trim();
  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }

  const quantity = Math.floor(Number(input.quantity));
  if (isNaN(quantity) || quantity <= 0) {
    throw new Error("Quantity must be a positive integer.");
  }

  const unitPrice = Math.round(Number(input.unitPrice));
  if (isNaN(unitPrice) || unitPrice < 0) {
    throw new Error("Unit price must be a non-negative number.");
  }

  const totalAmount = quantity * unitPrice;
  if (totalAmount <= 0) {
    throw new Error("Total sale amount must be greater than zero.");
  }

  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  const productName = input.productName?.trim() || "Walk-in Tiffin Meal";
  const buyerName = input.buyerName?.trim() || null;
  const buyerPhone = input.buyerPhone?.trim() || null;
  const mealType = input.mealType || "LUNCH";
  const notes = input.notes?.trim() || null;
  const idempotencyKey = input.idempotencyKey?.trim() || `walkin_${crypto.randomUUID()}`;

  const db = asyncDb ?? getAsyncDb();

  // Check idempotency
  const existing = await db.queryOne<any>(
    "SELECT * FROM financial_transactions WHERE idempotency_key = ?",
    [idempotencyKey]
  );
  if (existing) {
    const txn = await getTransactionById(actor, existing.id, db);
    return {
      transaction: txn!,
      sale: {
        id: txn!.id,
        transactionId: txn!.id,
        amount: txn!.amount,
        serviceDate: txn!.transactionDate,
        mealType,
        productName,
        quantity,
        unitPrice,
        paymentMethod: txn!.paymentMethod || paymentMethod,
        buyerName,
        buyerPhone,
        description: txn!.description,
        createdByName: txn!.createdByName || actor.fullName,
        createdAt: txn!.createdAt,
      },
    };
  }

  const id = `txn_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const desc = `Walk-in counter sale: ${quantity}x ${productName} (₹${unitPrice}/meal)${buyerName ? ` - Buyer: ${buyerName}` : ""}${buyerPhone ? ` (${buyerPhone})` : ""}${notes ? `. Note: ${notes}` : ""}`;

  await db.transaction(async (tx) => {
    // Assert closing date not finalized for TIFFIN division
    await assertClosingDateNotFinalized(tx, serviceDate, "TIFFIN");

    await tx.execute(`
      INSERT INTO financial_transactions (
        id, transaction_type, amount, transaction_date, payment_method,
        reference_number, resident_id, customer_id, stay_id, category, description,
        billing_period, payee_vendor, idempotency_key, status,
        reversal_of_id, created_by, created_at, updated_at
      ) VALUES (
        ?, 'TIFFIN_PAYMENT', ?, ?, ?,
        NULL, NULL, NULL, NULL, 'TIFFIN_WALKIN_SALE', ?,
        NULL, NULL, ?, 'POSTED',
        NULL, ?, ?, ?
      )
    `, [
      id,
      totalAmount,
      serviceDate,
      paymentMethod,
      desc,
      idempotencyKey,
      actor.id,
      now,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "kitchen.walkin_sale_recorded",
      targetType: "financial_transaction",
      targetId: id,
      metadata: {
        serviceDate,
        mealType,
        productName,
        quantity,
        unitPrice,
        totalAmount,
        paymentMethod,
        buyerName,
        buyerPhone,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const txn = (await getTransactionById(actor, id, db))!;
  return {
    transaction: txn,
    sale: {
      id: txn.id,
      transactionId: txn.id,
      amount: txn.amount,
      serviceDate: txn.transactionDate,
      mealType,
      productName,
      quantity,
      unitPrice,
      paymentMethod: txn.paymentMethod || paymentMethod,
      buyerName,
      buyerPhone,
      description: txn.description,
      createdByName: txn.createdByName || actor.fullName,
      createdAt: txn.createdAt,
    },
  };
}

export async function listWalkInSales(
  actor: AuthenticatedUser,
  serviceDate: string,
  asyncDb?: AsyncDb
): Promise<{ sales: WalkInSaleRecord[]; totalAmount: number; totalCount: number }> {
  requirePermission(actor, "kitchen.read");

  const db = asyncDb ?? getAsyncDb();
  const rows = await db.query<any>(`
    SELECT
      t.*,
      u.full_name as created_by_name
    FROM financial_transactions t
    LEFT JOIN staff_users u ON u.id = t.created_by
    WHERE t.category = 'TIFFIN_WALKIN_SALE' AND t.transaction_date = ? AND t.status = 'POSTED'
    ORDER BY t.created_at DESC
  `, [serviceDate]);

  let totalAmount = 0;
  const sales: WalkInSaleRecord[] = rows.map((r) => {
    const amt = Number(r.amount || 0);
    totalAmount += amt;
    return {
      id: r.id,
      transactionId: r.id,
      amount: amt,
      serviceDate: r.transaction_date,
      mealType: "LUNCH",
      productName: r.description?.split(" - ")[0] || "Counter Sale",
      quantity: 1,
      unitPrice: amt,
      paymentMethod: r.payment_method as PaymentMethod,
      buyerName: null,
      buyerPhone: null,
      description: r.description,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
    };
  });

  return {
    sales,
    totalAmount,
    totalCount: sales.length,
  };
}
