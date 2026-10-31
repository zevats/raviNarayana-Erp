import { AsyncDb } from "../database/db";
import { MealType } from "@/types";

/**
 * Delivery operations rules shared by the delivery services (no imports from them, so both the
 * delivery service and the manifest/override service can use it without a cycle).
 */

/** Owner decisions (round 11): list preparation time and cancellation cutoff per meal, IST. */
export const MEAL_SCHEDULE: Record<MealType, { prepareAt: string | null; cutoffAt: string | null }> = {
  BREAKFAST: { prepareAt: null, cutoffAt: null },
  LUNCH: { prepareAt: "08:00", cutoffAt: "07:30" },
  DINNER: { prepareAt: "15:30", cutoffAt: "15:00" },
};

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Business date (YYYY-MM-DD) and minutes since midnight in Asia/Kolkata. */
export function businessClock(now: Date = new Date()): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * Whether changes to this meal now need a Manager override: the service date is past, or it is
 * today and the meal's cutoff time has been reached. A meal without a cutoff locks at day end.
 */
export function isPastCutoff(serviceDate: string, mealType: MealType, now: Date = new Date()): boolean {
  const clock = businessClock(now);
  if (serviceDate < clock.date) return true;
  if (serviceDate > clock.date) return false;
  const cutoff = MEAL_SCHEDULE[mealType]?.cutoffAt;
  return cutoff ? clock.minutes >= toMinutes(cutoff) : false;
}

/** Whether the delivery list for this meal is due for automatic preparation (today, after its time). */
export function isPreparationDue(serviceDate: string, mealType: MealType, now: Date = new Date()): boolean {
  const prepareAt = MEAL_SCHEDULE[mealType]?.prepareAt;
  if (!prepareAt) return false;
  const clock = businessClock(now);
  return serviceDate === clock.date && clock.minutes >= toMinutes(prepareAt);
}

export const DISPOSITIONS = ["RETURNED", "WITH_STAFF", "DISCARDED"] as const;

let opsSchemaPresent = false;
let opsSchemaCheckedAt = 0;

/**
 * Whether migration 0014 (delivery operations) is installed. Until it is, the features that need
 * it (list preparation, cancellation, overrides, item dispositions, room delivery) are refused
 * and everything else keeps its previous behaviour. Checked with a catalog lookup (a failed
 * statement would abort a PostgreSQL transaction); a negative answer is re-checked after a
 * minute so applying the migration is picked up without restarting the server.
 */
export async function hasDeliveryOpsSchema(db: AsyncDb): Promise<boolean> {
  if (opsSchemaPresent) return true;
  if (Date.now() - opsSchemaCheckedAt < 60_000) return false;
  const row = db.isPostgres
    ? await db.queryOne<{ t: string | null }>("SELECT to_regclass('public.delivery_task_items')::text AS t")
    : await db.queryOne<{ t: string | null }>("SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name = 'delivery_task_items'");
  opsSchemaPresent = Boolean(row?.t);
  opsSchemaCheckedAt = Date.now();
  return opsSchemaPresent;
}

/** Thrown when a feature needs migration 0014 and it is not installed (mapped to HTTP 409). */
export class DeliveryOpsUnavailableError extends Error {
  readonly statusCode = 409;
  readonly code = "MIGRATION_0014_REQUIRED";
  constructor(feature: string) {
    super(`${feature} is switched off until the delivery operations update (migration 0014) is approved and installed.`);
    this.name = "DeliveryOpsUnavailableError";
  }
}

export async function requireDeliveryOpsSchema(db: AsyncDb, feature: string): Promise<void> {
  if (!(await hasDeliveryOpsSchema(db))) throw new DeliveryOpsUnavailableError(feature);
}

export interface SubscriptionDayFacts {
  status: string;
  customerStatus?: string | null;
  productStatus?: string | null;
  mealTypes: string;
  serviceDays: string;
  startDate: string;
  endDate: string | null;
  pauseStartDate: string | null;
  pauseResumeDate: string | null;
}

/**
 * Whether a subscription delivers on this date and meal, and if not, why. The single source of
 * the eligibility rules (list preparation and the Subscriptions screen both use it).
 * A PAUSED subscription delivers outside its pause window: pausing from a later date must not
 * stop today's meals. A PAUSED subscription without a pause start is treated as paused.
 */
export function subscriptionDayEligibility(f: SubscriptionDayFacts, serviceDate: string, mealType: MealType): { eligible: boolean; reason: string | null } {
  if (f.status !== "ACTIVE" && f.status !== "PAUSED") return { eligible: false, reason: f.status === "CANCELLED" ? "Cancelled" : "Not active" };
  if (f.customerStatus && f.customerStatus !== "ACTIVE") return { eligible: false, reason: "Customer inactive" };
  if (f.productStatus && f.productStatus !== "ACTIVE") return { eligible: false, reason: "Meal plan item inactive" };
  if (f.startDate > serviceDate) return { eligible: false, reason: `Starts ${f.startDate}` };
  if (f.endDate && f.endDate < serviceDate) return { eligible: false, reason: `Ended ${f.endDate}` };
  if (f.status === "PAUSED" && !f.pauseStartDate) return { eligible: false, reason: "Paused" };
  if (f.pauseStartDate && serviceDate >= f.pauseStartDate && (!f.pauseResumeDate || serviceDate < f.pauseResumeDate)) {
    return { eligible: false, reason: f.pauseResumeDate ? `Paused until ${f.pauseResumeDate}` : "Paused" };
  }
  const day = new Date(`${serviceDate}T12:00:00Z`).getUTCDay();
  if (f.serviceDays === "MON_SAT" && day === 0) return { eligible: false, reason: "No delivery on Sunday" };
  if (f.serviceDays === "MON_FRI" && (day === 0 || day === 6)) return { eligible: false, reason: "No delivery at weekends" };
  const m = f.mealTypes;
  const mealOk = mealType === "BREAKFAST" ? m === "BREAKFAST" : m === mealType || m === "BOTH";
  if (!mealOk) return { eligible: false, reason: `${m === "BOTH" ? "Lunch and dinner" : m.charAt(0) + m.slice(1).toLowerCase()} only` };
  return { eligible: true, reason: null };
}
