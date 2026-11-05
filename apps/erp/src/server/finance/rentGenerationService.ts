import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { assertClosingDateNotFinalized, acquireLedgerKeyLock } from "./financeService";
import { getSettings } from "../settings/settingsService";
import { canonicalBillingMonth } from "./billingPeriod";
import { businessToday, addBusinessDays, businessMonthKey } from "@/lib/businessDate";
import { AuthenticatedUser } from "@/types";

/**
 * Automatic monthly rent (Owner decision 2026-11-01: partial months are prorated by days).
 *
 * For a month M every stay that overlaps M is charged
 *     monthly rent × nights in M ÷ days in M   (rounded to the rupee; the full rent for a whole month)
 * where the nights of a stay run from its check-in (or the 1st) to its check-out (exclusive) or to
 * the end of the month. One charge per stay and month (idempotency key rent_auto:<stay>:<YYYY-MM>),
 * so running again — another screen, a retry, two servers at once — never charges twice; a stay that
 * starts later in the month (a new resident, or the new room after a transfer) is charged on the
 * next run for its own nights. A month in which a stay already has a rent charge entered by hand is
 * left alone and listed. When a stay ends before the end of a month it was already charged for (a
 * check-out or transfer), its automatic charge is replaced by the charge for the nights actually
 * stayed (reversal + new charge, in the same transaction as the check-out or transfer).
 *
 * Runs: automatically when the Owner or Manager opens the dashboard on or after the rent due day
 * (Settings → Monthly rent; off when no day is set), or by hand from Finance (current or previous
 * month). Each charge is dated the day it is generated (a finalized day is never written to).
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const autoKey = (stayId: string, month: string) => `rent_auto:${stayId}:${month}`;

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${month}-${String(days).padStart(2, "0")}`;
  return { start, end, days, nextStart: addBusinessDays(end, 1) };
}

const nightsBetween = (from: string, toExclusive: string) =>
  Math.max(0, Math.round((Date.UTC(+toExclusive.slice(0, 4), +toExclusive.slice(5, 7) - 1, +toExclusive.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000));

/** The charge for one stay in one month (0 when the stay has no nights in it). */
export function proratedRent(monthlyRent: number, month: string, checkIn: string, checkOut: string | null): { nights: number; days: number; amount: number; from: string; toExclusive: string } {
  const b = monthBounds(month);
  const from = checkIn > b.start ? checkIn : b.start;
  const toExclusive = checkOut && checkOut < b.nextStart ? checkOut : b.nextStart;
  const nights = nightsBetween(from, toExclusive);
  const amount = nights >= b.days ? monthlyRent : Math.round((monthlyRent * nights) / b.days);
  return { nights, days: b.days, amount, from, toExclusive };
}

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));

export interface RentRunLine {
  stayId: string;
  residentId: string;
  residentName: string;
  roomNumber: string;
  monthlyRent: number;
  nights: number;
  days: number;
  amount: number;
  status: "TO_CHARGE" | "CHARGED" | "ALREADY_CHARGED" | "MANUAL_CHARGE_EXISTS" | "NOTHING_DUE";
}

async function planLines(db: AsyncDb, month: string): Promise<RentRunLine[]> {
  const b = monthBounds(month);
  const stays = await db.query<any>(
    `SELECT s.id, s.resident_id, s.check_in_date, s.check_out_date, s.monthly_rent, s.status,
            res.full_name, rm.room_number
     FROM resident_stays s
     JOIN residents res ON res.id = s.resident_id
     JOIN rooms rm ON rm.id = s.room_id
     WHERE s.check_in_date <= ? AND (s.check_out_date IS NULL OR s.check_out_date > ?)
       AND s.status IN ('ACTIVE', 'COMPLETED')
     ORDER BY rm.room_number, res.full_name`,
    [b.end, b.start]
  );
  if (stays.length === 0) return [];
  const ids = stays.map((s) => s.id);
  // Automatic charges are found by their key (a transfer moves ledger rows to the new stay, so
  // stay_id alone would lose them); hand-entered charges by stay and month.
  const keys = ids.map((id) => autoKey(id, month));
  const autoRows = await db.query<any>(
    `SELECT idempotency_key FROM financial_transactions WHERE idempotency_key IN (${keys.map(() => "?").join(", ")})`,
    keys
  );
  const autoDone = new Set(autoRows.map((r) => String(r.idempotency_key)));
  // A hand-entered charge belongs to the month when it is dated in it or its period names it in any
  // spelling ("November 2026", "Nov 2026", "2026-11"…), so the same month is never charged twice.
  const manualRows = await db.query<any>(
    `SELECT stay_id, transaction_date, billing_period FROM financial_transactions
     WHERE transaction_type = 'RENT_CHARGE' AND status = 'POSTED' AND stay_id IN (${ids.map(() => "?").join(", ")})
       AND (idempotency_key IS NULL OR idempotency_key NOT LIKE 'rent_auto:%')
       AND ((transaction_date >= ? AND transaction_date <= ?) OR billing_period IS NOT NULL)`,
    [...ids, b.start, b.end]
  );
  const manualStays = new Set(
    manualRows
      .filter((r) => (r.transaction_date >= b.start && r.transaction_date <= b.end) || canonicalBillingMonth(r.billing_period) === month)
      .map((r) => r.stay_id)
  );
  return stays.map((s) => {
    const p = proratedRent(Number(s.monthly_rent), month, s.check_in_date, s.check_out_date);
    const auto = autoDone.has(autoKey(s.id, month));
    const manual = manualStays.has(s.id);
    const status: RentRunLine["status"] = auto ? "ALREADY_CHARGED" : manual ? "MANUAL_CHARGE_EXISTS" : p.amount <= 0 ? "NOTHING_DUE" : "TO_CHARGE";
    return {
      stayId: s.id, residentId: s.resident_id, residentName: s.full_name, roomNumber: s.room_number,
      monthlyRent: Number(s.monthly_rent), nights: p.nights, days: p.days, amount: p.amount, status,
    };
  });
}

function checkMonth(month: string | undefined): string {
  const m = (month || businessMonthKey(0)).trim();
  if (!MONTH.test(m)) throw new Error("Month must be YYYY-MM.");
  if (m !== businessMonthKey(0) && m !== businessMonthKey(-1)) throw new Error("Rent can be generated for this month or last month only.");
  return m;
}

/** Dry run: what would be charged for the month, and why each stay is or is not charged. */
export async function previewMonthlyRent(actor: AuthenticatedUser, month?: string, asyncDb?: AsyncDb) {
  requirePermission(actor, "finance.record");
  const db = asyncDb ?? getAsyncDb();
  const m = checkMonth(month);
  const lines = await planLines(db, m);
  return { month: m, label: monthLabel(m), lines, total: lines.filter((l) => l.status === "TO_CHARGE").reduce((a, l) => a + l.amount, 0) };
}

/** Posts the charges marked TO_CHARGE. Safe to run any number of times. */
export async function generateMonthlyRent(
  actor: AuthenticatedUser,
  input: { month?: string; trigger?: "AUTO" | "MANUAL" } = {},
  clientIp?: string,
  asyncDb?: AsyncDb
) {
  requirePermission(actor, "finance.record", { ip: clientIp, action: "finance.rent_generated" });
  const db = asyncDb ?? getAsyncDb();
  const month = checkMonth(input.month);
  const today = businessToday();
  const created: RentRunLine[] = [];
  await db.transaction(async (tx) => {
    // One run per month at a time; a concurrent run waits here and then finds nothing left to do.
    await acquireLedgerKeyLock(tx, `rent-run:${month}`);
    await assertClosingDateNotFinalized(tx, today, "PG");
    const lines = (await planLines(tx, month)).filter((l) => l.status === "TO_CHARGE");
    const at = new Date().toISOString();
    for (const l of lines) {
      const ins = await tx.execute(
        `INSERT INTO financial_transactions (
           id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, stay_id,
           category, description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id, created_by, created_at, updated_at
         ) VALUES (?, 'RENT_CHARGE', ?, ?, NULL, NULL, ?, ?, 'RENT', ?, ?, NULL, ?, 'POSTED', NULL, ?, ?, ?)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          `txn_${crypto.randomUUID()}`, l.amount, today, l.residentId, l.stayId,
          l.nights >= l.days
            ? `Monthly rent ${monthLabel(month)} (automatic)`
            : `Monthly rent ${monthLabel(month)} (automatic): ${l.nights} of ${l.days} nights × ₹${l.monthlyRent.toLocaleString("en-IN")}`,
          monthLabel(month), autoKey(l.stayId, month), actor.id, at, at,
        ]
      );
      if (ins.changes > 0) created.push({ ...l, status: "CHARGED" });
    }
    await recordAuditEventAsync({
      actorId: actor.id, actorUsername: actor.username, action: "finance.rent_generated", targetType: "rent_run", targetId: month,
      metadata: { month, trigger: input.trigger || "MANUAL", charged: created.length, total: created.reduce((a, l) => a + l.amount, 0), stays: created.map((l) => ({ stayId: l.stayId, amount: l.amount, nights: l.nights })) },
      ipAddress: clientIp,
    }, tx);
  });
  return { month, charged: created.length, total: created.reduce((a, l) => a + l.amount, 0), lines: created };
}

/**
 * Called when the dashboard is opened: generates this month's rent once the due day has passed.
 * Never throws (a problem is logged and retried on the next open); does nothing when automatic
 * rent is off, before the due day, or when nothing is left to charge.
 */
export async function runAutomaticRentIfDue(actor: AuthenticatedUser, asyncDb?: AsyncDb): Promise<void> {
  if (actor.role !== "SUPER_ADMIN" && actor.role !== "OPERATIONS_MANAGER") return;
  try {
    const db = asyncDb ?? getAsyncDb();
    const dueDay = (await getSettings(db)).finance.rentDueDay;
    if (!dueDay) return;
    const today = businessToday();
    if (Number(today.slice(8, 10)) < dueDay) return;
    const preview = await previewMonthlyRent(actor, businessMonthKey(0), db);
    if (!preview.lines.some((l) => l.status === "TO_CHARGE")) return;
    await generateMonthlyRent(actor, { month: preview.month, trigger: "AUTO" }, undefined, db);
  } catch (err) {
    console.error("[Rent] Automatic monthly rent did not run:", (err as Error).message);
  }
}

/**
 * When a stay ends (check-out or transfer) before the end of a month it was automatically charged
 * for, replaces that charge with the charge for the nights actually stayed. Runs inside the
 * caller's transaction. Returns the amount taken off (0 when nothing changed).
 */
export async function settleAutomaticRentOnStayEnd(tx: AsyncDb, actor: AuthenticatedUser, stayId: string, endDate: string, clientIp?: string): Promise<number> {
  const month = endDate.slice(0, 7);
  const charge = await tx.queryOne<any>(
    `SELECT * FROM financial_transactions WHERE idempotency_key = ? AND status = 'POSTED'${tx.isPostgres ? " FOR UPDATE" : ""}`,
    [autoKey(stayId, month)]
  );
  if (!charge) return 0;
  const stay = await tx.queryOne<any>("SELECT check_in_date, monthly_rent FROM resident_stays WHERE id = ?", [stayId]);
  if (!stay) return 0;
  const fair = proratedRent(Number(stay.monthly_rent), month, stay.check_in_date, endDate);
  const reduction = Number(charge.amount) - fair.amount;
  if (reduction <= 0) return 0;
  const today = businessToday();
  await assertClosingDateNotFinalized(tx, today, "PG");
  const at = new Date().toISOString();
  await tx.execute("UPDATE financial_transactions SET status = 'REVERSED', updated_at = ? WHERE id = ? AND status = 'POSTED'", [at, charge.id]);
  await tx.execute(
    `INSERT INTO financial_transactions (
       id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, customer_id, stay_id,
       category, description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id, created_by, created_at, updated_at
     ) VALUES (?, 'REVERSAL', ?, ?, NULL, NULL, ?, NULL, ?, 'RENT', ?, NULL, NULL, NULL, 'POSTED', ?, ?, ?, ?)`,
    [`txn_${crypto.randomUUID()}`, charge.amount, today, charge.resident_id, stayId, `Automatic rent for ${monthLabel(month)} replaced: stay ended ${endDate}`, charge.id, actor.id, at, at]
  );
  if (fair.amount > 0) {
    await tx.execute(
      `INSERT INTO financial_transactions (
         id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, stay_id,
         category, description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id, created_by, created_at, updated_at
       ) VALUES (?, 'RENT_CHARGE', ?, ?, NULL, NULL, ?, ?, 'RENT', ?, ?, NULL, ?, 'POSTED', NULL, ?, ?, ?)`,
      [
        `txn_${crypto.randomUUID()}`, fair.amount, today, charge.resident_id, stayId,
        `Monthly rent ${monthLabel(month)} (automatic): ${fair.nights} of ${fair.days} nights, stay ended ${endDate}`,
        monthLabel(month), `${autoKey(stayId, month)}:final`, actor.id, at, at,
      ]
    );
  }
  await recordAuditEventAsync({
    actorId: actor.id, actorUsername: actor.username, action: "finance.rent_prorated_on_stay_end", targetType: "resident_stay", targetId: stayId,
    metadata: { month, endDate, originalChargeId: charge.id, originalAmount: Number(charge.amount), proratedAmount: fair.amount, nights: fair.nights },
    ipAddress: clientIp,
  }, tx);
  return reduction;
}

/** The reduction settleAutomaticRentOnStayEnd would make (read-only; for previews). */
export async function pendingRentReductionOnStayEnd(db: AsyncDb, stayId: string, endDate: string): Promise<number> {
  const month = endDate.slice(0, 7);
  const charge = await db.queryOne<any>("SELECT amount FROM financial_transactions WHERE idempotency_key = ? AND status = 'POSTED'", [autoKey(stayId, month)]);
  if (!charge) return 0;
  const stay = await db.queryOne<any>("SELECT check_in_date, monthly_rent FROM resident_stays WHERE id = ?", [stayId]);
  if (!stay) return 0;
  return Math.max(0, Number(charge.amount) - proratedRent(Number(stay.monthly_rent), month, stay.check_in_date, endDate).amount);
}
