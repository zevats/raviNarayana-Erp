/**
 * Live PostgreSQL verification of the canonical money definitions (Phase 0):
 *   - business-date helpers around midnight IST;
 *   - rent outstanding computed resident by resident (a credit never hides a debt);
 *   - deposits held = received − applied − refunded − deductions kept at checkout;
 *   - tiffin receipts counted once (no description text matching, no rent double count).
 * The verify database is shared by several suites, so every figure is checked as a delta.
 * Disposable local database only (RN_PG_VERIFY_URL); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createRoom } from "../apps/erp/src/server/rooms/roomService";
import { registerResident, assignResidentToRoom } from "../apps/erp/src/server/residents/residentService";
import { finalizeResidentCheckoutSettlement } from "../apps/erp/src/server/residents/residentSettlementService";
import { recordRentCharge, recordRentPayment, recordSecurityDeposit } from "../apps/erp/src/server/finance/financeService";
import { getOutstandingRent, getDepositsHeld } from "../apps/erp/src/server/finance/financialDefinitions";
import { getDashboardMetrics, invalidateDashboardCache } from "../apps/erp/src/server/dashboard/dashboardService";
import { createTiffinCustomer } from "../apps/erp/src/server/tiffin/tiffinService";
import { recordTiffinPayment } from "../apps/erp/src/server/tiffin/tiffinBillingService";
import { businessToday, businessMonthStart, businessMonthKey, addBusinessDays } from "../apps/erp/src/lib/businessDate";
import { AuthenticatedUser } from "../apps/erp/src/types";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff, uniqueBusinessDate } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;

async function residentWithStay(db: AsyncDb, owner: AuthenticatedUser, day: string) {
  const room = await createRoom(owner, { roomNumber: `F${rnd()}`.toUpperCase(), floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 6000 }, IP, db);
  const resident = await registerResident(owner, { fullName: `Definition Resident ${rnd()}`, phone: phone() }, IP, db);
  const stay = await assignResidentToRoom(owner, { residentId: resident.id, roomId: room.id, checkInDate: day, monthlyRent: 6000 }, IP, db);
  return { residentId: resident.id as string, stayId: stay.id as string };
}

async function main() {
  console.log("================================================================================");
  console.log("PG FINANCIAL DEFINITIONS (live local PostgreSQL)");
  console.log("================================================================================");

  console.log("\n--- 1. Business date around midnight IST ---");
  assert(businessToday(new Date("2026-11-01T18:29:00Z")) === "2026-11-01", "23:59 IST is still 1 Nov");
  assert(businessToday(new Date("2026-11-01T18:31:00Z")) === "2026-11-02", "00:01 IST is already 2 Nov (UTC still says 1 Nov)");
  assert(businessMonthStart(new Date("2026-10-31T19:00:00Z")) === "2026-11-01", "00:30 IST on 1 Nov starts November, not October");
  assert(businessMonthKey(-5, new Date("2026-03-15T06:00:00Z")) === "2025-10", "Six-month window crosses the year correctly");
  assert(addBusinessDays("2026-02-27", 2) === "2026-03-01", "Day arithmetic has no time-zone drift");

  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Definitions Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Definitions Manager");
  const day = uniqueBusinessDate(140);

  console.log("\n--- 2. Outstanding rent is per resident ---");
  const before = await getOutstandingRent(db);
  const A = await residentWithStay(db, owner, day);
  const B = await residentWithStay(db, owner, day);
  const C = await residentWithStay(db, owner, day);
  await recordRentCharge(manager, { residentId: A.residentId, stayId: A.stayId, amount: 5000, transactionDate: day, billingPeriod: "Def Month" }, IP, db);
  await recordRentCharge(manager, { residentId: B.residentId, stayId: B.stayId, amount: 3000, transactionDate: day, billingPeriod: "Def Month" }, IP, db);
  await recordRentCharge(manager, { residentId: C.residentId, stayId: C.stayId, amount: 6000, transactionDate: day, billingPeriod: "Def Month" }, IP, db);
  await recordRentPayment(manager, { residentId: C.residentId, stayId: C.stayId, amount: 6000, transactionDate: day, paymentMethod: "CASH" }, IP, db);
  // A resident in credit: a payment recorded directly (the service blocks overpayment, so the
  // credit is created the way older data could hold it).
  await db.execute(
    `INSERT INTO financial_transactions (id, transaction_type, amount, transaction_date, payment_method, resident_id, stay_id, category, status, created_by, created_at, updated_at)
     VALUES (?, 'RENT_PAYMENT', 2000, ?, 'CASH', ?, ?, 'RENT_PAYMENT', 'POSTED', ?, ?, ?)`,
    [`fin_def_${rnd()}`, day, C.residentId, C.stayId, owner.id, new Date().toISOString(), new Date().toISOString()]
  );
  const after = await getOutstandingRent(db);
  assert(after.total - before.total === 8000, `A ₹5,000 + B ₹3,000 owed; C's ₹2,000 credit does not reduce it (delta ₹${after.total - before.total})`);
  assert(after.residents - before.residents === 2, `Two more residents owe rent (delta ${after.residents - before.residents})`);

  console.log("\n--- 3. Deposits held ---");
  const d0 = await getDepositsHeld(db);
  const D = await residentWithStay(db, owner, day);
  await recordSecurityDeposit(manager, { residentId: D.residentId, stayId: D.stayId, amount: 10000, transactionDate: day, paymentMethod: "CASH" } as any, IP, db);
  assert((await getDepositsHeld(db)) - d0 === 10000, "Deposit received: held +₹10,000");
  await recordRentCharge(manager, { residentId: D.residentId, stayId: D.stayId, amount: 6000, transactionDate: day, billingPeriod: "Def Month" }, IP, db);
  await recordRentPayment(manager, { residentId: D.residentId, stayId: D.stayId, amount: 2000, transactionDate: day, paymentMethod: "CASH" }, IP, db);
  // Outstanding ₹4,000; deposit ₹10,000; deduction ₹500 kept → apply ₹4,000, refund ₹5,500, nothing left.
  await finalizeResidentCheckoutSettlement(owner, {
    residentId: D.residentId, checkOutDate: day, deductions: [{ reason: "Broken lock", amount: 500 }],
    depositAppliedAmount: 4000, refundAmount: 5500, refundPaymentMethod: "CASH",
  }, IP, db);
  assert((await getDepositsHeld(db)) - d0 === 0, `Fully settled checkout leaves nothing held — the kept ₹500 deduction is not "held" (delta ₹${(await getDepositsHeld(db)) - d0})`);

  const E = await residentWithStay(db, owner, day);
  await recordSecurityDeposit(manager, { residentId: E.residentId, stayId: E.stayId, amount: 3000, transactionDate: day, paymentMethod: "CASH" } as any, IP, db);
  await finalizeResidentCheckoutSettlement(owner, { residentId: E.residentId, checkOutDate: day, refundAmount: 1000, refundPaymentMethod: "CASH" }, IP, db);
  assert((await getDepositsHeld(db)) - d0 === 2000, "Part refund: the ₹2,000 not yet returned is still owed and still held");

  console.log("\n--- 4. Tiffin receipts counted once ---");
  invalidateDashboardCache();
  const m0 = (await getDashboardMetrics({ viewerRole: "SUPER_ADMIN", startDate: day, endDate: day }, db, true)).finance;
  const customer = await createTiffinCustomer(manager, { fullName: `Definition Tiffin ${rnd()}`, phone: phone(), deliveryAddress: "Def Block 1" } as any, IP, db);
  await recordTiffinPayment(owner, { customerId: customer.id, amount: 1200, transactionDate: day, paymentMethod: "UPI" } as any, IP, db);
  // A legacy rent-typed tiffin row, and a rent payment whose description merely mentions tiffin.
  await db.execute(
    `INSERT INTO financial_transactions (id, transaction_type, amount, transaction_date, payment_method, customer_id, category, status, created_by, created_at, updated_at)
     VALUES (?, 'RENT_PAYMENT', 300, ?, 'CASH', ?, 'TIFFIN', 'POSTED', ?, ?, ?)`,
    [`fin_def_${rnd()}`, day, customer.id, owner.id, new Date().toISOString(), new Date().toISOString()]
  );
  await recordRentCharge(manager, { residentId: B.residentId, stayId: B.stayId, amount: 700, transactionDate: day, billingPeriod: "Def Month" }, IP, db);
  await recordRentPayment(manager, { residentId: B.residentId, stayId: B.stayId, amount: 700, transactionDate: day, paymentMethod: "CASH", description: "Rent incl. tiffin" } as any, IP, db);
  invalidateDashboardCache();
  const m1 = (await getDashboardMetrics({ viewerRole: "SUPER_ADMIN", startDate: day, endDate: day }, db, true)).finance;
  assert(m1.tiffinRevenue - m0.tiffinRevenue === 1500, `Tiffin received in period: ₹1,200 + legacy ₹300 (delta ₹${m1.tiffinRevenue - m0.tiffinRevenue})`);
  assert(m1.currentMonthRent - m0.currentMonthRent === 700, `Rent received in period: ₹700 only — the word "tiffin" does not move it, and the legacy tiffin row is not rent (delta ₹${m1.currentMonthRent - m0.currentMonthRent})`);

  console.log("\n--- 5. Dashboard uses the same definitions ---");
  invalidateDashboardCache();
  const dash = (await getDashboardMetrics({ viewerRole: "SUPER_ADMIN" }, db, true)).finance;
  assert(dash.outstandingRent === (await getOutstandingRent(db)).total, "Dashboard outstanding = per-resident outstanding");
  assert(dash.overdueCount === (await getOutstandingRent(db)).residents, "Dashboard overdue count = residents who owe");
  assert(dash.totalDepositsHeld === (await getDepositsHeld(db)), "Dashboard deposits held = canonical deposits held");

  console.log(`\nPG FINANCIAL DEFINITIONS: ${state.passed} PASSED, ${state.failed} FAILED`);
  await closePg();
  process.exit(state.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await closePg().catch(() => {});
  process.exit(1);
});
