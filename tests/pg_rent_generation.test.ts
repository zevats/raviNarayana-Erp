/**
 * Live PostgreSQL verification of automatic monthly rent (Phase 3; Owner decision: partial months
 * are prorated by days): whole and partial months, idempotent and concurrent runs, months already
 * charged by hand, transfers and check-outs after the month was charged, the dashboard trigger
 * and the due-day setting, and permissions.
 * Uses the current business month (rent can only be generated for this month or last month).
 * Disposable local database only (RN_PG_VERIFY_URL); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createRoom } from "../apps/erp/src/server/rooms/roomService";
import { registerResident, assignResidentToRoom, transferResidentRoom } from "../apps/erp/src/server/residents/residentService";
import { previewResidentSettlement, finalizeResidentCheckoutSettlement } from "../apps/erp/src/server/residents/residentSettlementService";
import { recordRentCharge } from "../apps/erp/src/server/finance/financeService";
import { previewMonthlyRent, generateMonthlyRent, runAutomaticRentIfDue, proratedRent } from "../apps/erp/src/server/finance/rentGenerationService";
import { updateSettingsSection, clearSettingsCache } from "../apps/erp/src/server/settings/settingsService";
import { businessMonthKey, addBusinessDays } from "../apps/erp/src/lib/businessDate";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;

async function rejects(label: string, fn: () => Promise<unknown>, pattern: RegExp) {
  let err: any = null;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert(err !== null && pattern.test(String(err.message)), `${label}${err ? ` (${err.message})` : " — NOT rejected"}`);
}

async function main() {
  console.log("================================================================================");
  console.log("PG AUTOMATIC MONTHLY RENT (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  await db.execute("DELETE FROM business_settings WHERE key = 'finance.rentDueDay'");
  clearSettingsCache();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Rent Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Rent Manager");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "Rent Driver");
  const month = businessMonthKey(0);
  const start = `${month}-01`;
  const days = Number(proratedRent(3000, month, start, null).days);
  const day = (n: number) => addBusinessDays(start, n - 1);
  const RENT = 9000;
  const sum = async (stayIds: string[]) =>
    Number((await db.queryOne<any>(`SELECT COALESCE(SUM(amount), 0) AS s FROM financial_transactions WHERE transaction_type = 'RENT_CHARGE' AND status = 'POSTED' AND stay_id IN (${stayIds.map(() => "?").join(",")})`, stayIds)).s);
  const resident = async (room: any, checkIn: string) => {
    const r = await registerResident(manager, { fullName: `Rent Resident ${rnd()}`, phone: phone() }, IP, db);
    const st = await assignResidentToRoom(manager, { residentId: r.id, roomId: room.id, checkInDate: checkIn, monthlyRent: RENT }, IP, db);
    return { residentId: r.id as string, stayId: st.id as string };
  };
  const room = () => createRoom(manager, { roomNumber: `RG${rnd()}`.toUpperCase(), floor: 2, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: RENT } as any, IP, db);

  try {
    console.log("\n--- 1. Whole and partial months ---");
    const roomA = await room();
    const whole = await resident(roomA, addBusinessDays(start, -10));
    const partial = await resident(roomA, day(11));
    const expectedPartial = Math.round((RENT * (days - 10)) / days);
    await rejects("Delivery staff cannot preview rent", () => previewMonthlyRent(driver, month, db), /permission|denied|forbidden/i);
    await rejects("Only this month or last month", () => previewMonthlyRent(manager, "2030-01", db), /this month or last month/);
    const pv = await previewMonthlyRent(manager, month, db);
    const lw = pv.lines.find((l) => l.stayId === whole.stayId)!;
    const lp = pv.lines.find((l) => l.stayId === partial.stayId)!;
    assert(lw?.status === "TO_CHARGE" && lw.amount === RENT && lw.nights === days, `In since last month: full ₹${RENT} (${lw?.nights}/${days} nights)`);
    assert(lp?.status === "TO_CHARGE" && lp.amount === expectedPartial && lp.nights === days - 10, `Joined on the 11th: ₹${RENT} × ${days - 10}/${days} = ₹${expectedPartial} (got ₹${lp?.amount})`);
    assert((await sum([whole.stayId, partial.stayId])) === 0, "Preview charges nothing");

    console.log("\n--- 2. Charged once, even when run twice at the same time ---");
    const runs = await Promise.allSettled([generateMonthlyRent(manager, { month }, IP, db), generateMonthlyRent(owner, { month }, IP, db)]);
    assert(runs.every((r) => r.status === "fulfilled"), "Both concurrent runs finish without an error");
    assert((await sum([whole.stayId])) === RENT && (await sum([partial.stayId])) === expectedPartial, "Each stay is charged exactly once");
    const again = await generateMonthlyRent(manager, { month }, IP, db);
    assert(!again.lines.some((l) => l.stayId === whole.stayId || l.stayId === partial.stayId), "Running again charges them nothing more");
    const audit = await db.queryOne<any>("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'finance.rent_generated' AND target_id = ?", [month]);
    assert(Number(audit.n) >= 1, "Each run is in the audit log");

    console.log("\n--- 3. A month already charged by hand is left alone ---");
    const roomB = await room();
    const handled = await resident(roomB, addBusinessDays(start, -40));
    await recordRentCharge(manager, { residentId: handled.residentId, stayId: handled.stayId, amount: 8500, transactionDate: day(1), billingPeriod: "Hand entry" }, IP, db);
    const pv2 = await previewMonthlyRent(manager, month, db);
    assert(pv2.lines.find((l) => l.stayId === handled.stayId)?.status === "MANUAL_CHARGE_EXISTS", "Stay with a hand-entered rent charge this month is listed, not charged");
    await generateMonthlyRent(manager, { month }, IP, db);
    assert((await sum([handled.stayId])) === 8500, "Only the hand-entered ₹8,500 stands");

    console.log("\n--- 4. Transfer after the month was charged ---");
    const roomC = await room();
    const moving = await resident(roomC, addBusinessDays(start, -5));
    await generateMonthlyRent(manager, { month }, IP, db);
    assert((await sum([moving.stayId])) === RENT, "Charged the full month in the first room");
    const roomD = await room();
    const tr = await transferResidentRoom(manager, { residentId: moving.residentId, targetRoomId: roomD.id, transferDate: day(16), reason: "Moving upstairs" }, IP, db);
    const newStay = (tr as any).newStayId || (await db.queryOne<any>("SELECT id FROM resident_stays WHERE resident_id = ? AND status = 'ACTIVE'", [moving.residentId])).id;
    const firstPart = Math.round((RENT * 15) / days);
    const oldCharges = await db.query<any>("SELECT amount, status, idempotency_key FROM financial_transactions WHERE transaction_type IN ('RENT_CHARGE') AND idempotency_key LIKE ?", [`rent_auto:${moving.stayId}:%`]);
    assert(oldCharges.some((c) => c.status === "REVERSED" && Number(c.amount) === RENT) && oldCharges.some((c) => c.status === "POSTED" && Number(c.amount) === firstPart), `First room's charge replaced by 15 nights: ₹${firstPart}`);
    await generateMonthlyRent(manager, { month }, IP, db);
    const secondPart = Math.round((RENT * (days - 15)) / days);
    const residentTotal = Number((await db.queryOne<any>("SELECT COALESCE(SUM(amount),0) AS s FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'RENT_CHARGE' AND status = 'POSTED'", [moving.residentId])).s);
    assert(residentTotal === firstPart + secondPart, `New room charged from the transfer: ₹${firstPart} + ₹${secondPart} = ₹${residentTotal} for the month, nothing doubled (stay ${String(newStay).slice(0, 8)}…)`);

    console.log("\n--- 5. Check-out after the month was charged ---");
    const roomE = await room();
    const leaving = await resident(roomE, addBusinessDays(start, -20));
    await generateMonthlyRent(manager, { month }, IP, db);
    const outDate = day(21);
    const prev = await previewResidentSettlement(owner, leaving.residentId, outDate, db);
    const fair = Math.round((RENT * 20) / days);
    assert(prev.outstandingRentDue === fair, `Settlement preview shows rent for 20 nights only: ₹${fair} (got ₹${prev.outstandingRentDue})`);
    await finalizeResidentCheckoutSettlement(owner, { residentId: leaving.residentId, checkOutDate: outDate, remainingPayableAmount: fair, paymentMethod: "CASH" } as any, IP, db);
    const due = Number((await db.queryOne<any>(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' THEN amount ELSE 0 END),0) - COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' THEN amount ELSE 0 END),0) AS d
       FROM financial_transactions WHERE resident_id = ? AND status = 'POSTED'`, [leaving.residentId])).d);
    assert(due === 0, `After check-out and paying ₹${fair} nothing is owed (balance ₹${due})`);

    console.log("\n--- 6. Dashboard trigger and the due day ---");
    const roomF = await room();
    const fresh = await resident(roomF, addBusinessDays(start, -3));
    await runAutomaticRentIfDue(manager, db);
    assert((await sum([fresh.stayId])) === 0, "Automatic rent off (no due day): opening the dashboard charges nothing");
    await rejects("Due day must be 1–28", () => updateSettingsSection(owner, "finance", { rentDueDay: 31 }, IP, db), /1 to 28/);
    await updateSettingsSection(owner, "finance", { rentDueDay: 1 }, IP, db);
    await runAutomaticRentIfDue(driver, db);
    assert((await sum([fresh.stayId])) === 0, "A delivery account opening a page never triggers rent");
    await runAutomaticRentIfDue(manager, db);
    assert((await sum([fresh.stayId])) === RENT, "Due day reached: the Manager's dashboard visit charges this month's rent");
    await runAutomaticRentIfDue(owner, db);
    assert((await sum([fresh.stayId])) === RENT, "A second visit charges nothing more");
  } finally {
    await db.execute("DELETE FROM business_settings WHERE key = 'finance.rentDueDay'");
    clearSettingsCache();
  }

  console.log(`\nPG RENT GENERATION: ${state.passed} PASSED, ${state.failed} FAILED`);
  await closePg();
  process.exit(state.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await closePg().catch(() => {});
  process.exit(1);
});
