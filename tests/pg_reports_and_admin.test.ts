/**
 * Live PostgreSQL verification of Reports (Phase 8), the Activity log (Phase 6), notifications
 * (Phase 7) and the dashboard operations blocks (Phase 9): real figures with the canonical
 * definitions, per-resident running balance, division filters, CSV formula-injection safety,
 * role limits, read-only log with redaction, notification role filtering and settings toggles,
 * stable notification ids (no duplicates).
 * Disposable local database only (RN_PG_VERIFY_URL); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createRoom } from "../apps/erp/src/server/rooms/roomService";
import { registerResident, assignResidentToRoom } from "../apps/erp/src/server/residents/residentService";
import { recordRentCharge, recordRentPayment, recordSecurityDeposit, recordExpense } from "../apps/erp/src/server/finance/financeService";
import { runReport, reportToCsv, runReportForExport } from "../apps/erp/src/server/reports/reportsService";
import { listActivity } from "../apps/erp/src/server/audit/activityLogService";
import { getNotifications, invalidateNotificationCache, markNotificationAsRead } from "../apps/erp/src/server/notifications/notificationService";
import { proposeResidentSettlement } from "../apps/erp/src/server/residents/settlementApprovalService";
import { updateSettingsSection, clearSettingsCache } from "../apps/erp/src/server/settings/settingsService";
import { createTiffinCustomer, createTiffinProduct, createTiffinSubscription } from "../apps/erp/src/server/tiffin/tiffinService";
import { getDashboardOps } from "../apps/erp/src/server/dashboard/dashboardOpsService";
import { deleteStaffUser } from "../apps/erp/src/server/staff/staffService";
import { businessToday, addBusinessDays } from "../apps/erp/src/lib/businessDate";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff, uniqueBusinessDate } from "./helpers/pgVerifyTarget";

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
  console.log("PG REPORTS, ACTIVITY LOG, NOTIFICATIONS, DASHBOARD (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  await db.execute("DELETE FROM business_settings WHERE key LIKE 'notifications.%'");
  clearSettingsCache();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Reports Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Reports Manager");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "Reports Driver");
  const day = uniqueBusinessDate(800);

  console.log("\n--- 1. Reports use real records ---");
  const room = await createRoom(manager, { roomNumber: `RP${rnd()}`.toUpperCase(), floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 7000 } as any, IP, db);
  const evil = `=HYPERLINK("http://x")${rnd()}`;
  const res = await registerResident(manager, { fullName: evil, phone: phone() }, IP, db);
  const stay = await assignResidentToRoom(manager, { residentId: res.id, roomId: room.id, checkInDate: day, monthlyRent: 7000 }, IP, db);
  await recordSecurityDeposit(manager, { residentId: res.id, stayId: stay.id, amount: 5000, transactionDate: day, paymentMethod: "CASH" } as any, IP, db);
  await recordRentCharge(manager, { residentId: res.id, stayId: stay.id, amount: 7000, transactionDate: day, billingPeriod: "Report Month" }, IP, db);
  await recordRentPayment(manager, { residentId: res.id, stayId: stay.id, amount: 3000, transactionDate: day, paymentMethod: "UPI" }, IP, db);
  await recordExpense(manager, { category: "MAINTENANCE", amount: 450, transactionDate: day, paymentMethod: "CASH", description: "Fan repair", payeeVendor: "Electrician" } as any, IP, db);
  await recordExpense(manager, { category: "GROCERY", amount: 900, transactionDate: day, paymentMethod: "CASH", description: "Rice" } as any, IP, db);

  await rejects("Delivery staff cannot open money reports", () => runReport(driver, "rent-collection", { from: day, to: day }, db), /permission|denied|forbidden/i);
  const rc = await runReport(manager, "rent-collection", { from: day, to: day, search: evil }, db);
  const row = rc.rows.find((r) => r.resident === evil)!;
  assert(row?.billed === 7000 && row?.paid === 3000 && row?.outstanding === 4000, `Rent collection: ₹7,000 charged, ₹3,000 paid, ₹4,000 owed (got ${row?.billed}/${row?.paid}/${row?.outstanding})`);
  const ledger = await runReport(manager, "resident-ledger", { from: day, to: day, residentId: res.id }, db);
  assert(ledger.rows.length === 3 && ledger.rows[ledger.rows.length - 1].balance === 4000 && ledger.totals.deposit === 5000, "Resident ledger: deposit, charge and payment with a running rent balance of ₹4,000");
  const expAll = await runReport(manager, "expenses", { from: day, to: day }, db);
  const expPg = await runReport(manager, "expenses", { from: day, to: day, division: "PG" }, db);
  const expTiffin = await runReport(manager, "expenses", { from: day, to: day, division: "TIFFIN" }, db);
  assert(expAll.totals.amount === 1350 && expPg.totals.amount === 450 && expTiffin.totals.amount === 900, "Expenses: ₹1,350 in all, split ₹450 PG / ₹900 tiffin");
  const occ = await runReport(manager, "occupancy", { from: day, to: day, search: room.roomNumber }, db);
  assert(occ.rows[0]?.capacity === 2 && occ.rows[0]?.occupied === 1 && occ.rows[0]?.vacant === 1 && occ.rows[0]?.occupancy === 50, "Occupancy: 1 of 2 beds on that day (50%)");
  const before = await runReport(manager, "occupancy", { from: addBusinessDays(day, -1), to: addBusinessDays(day, -1), search: room.roomNumber }, db);
  assert(before.rows[0]?.occupied === 0, "Occupancy the day before check-in is 0 (history from stay dates, not today's state)");
  const out = await runReport(manager, "outstanding", { from: day, to: day, division: "PG", search: evil }, db);
  assert(out.rows.length === 1 && out.rows[0].due === 4000, "Outstanding balances: the resident owes ₹4,000");
  await rejects("End before start is refused", () => runReport(manager, "expenses", { from: day, to: addBusinessDays(day, -3) }, db), /start date/);
  const csv = reportToCsv(await runReportForExport(manager, "rent-collection", { from: day, to: day, search: evil }, db));
  assert(csv.includes(`'=HYPERLINK`) && !/(^|,)=HYPERLINK/m.test(csv), "CSV export neutralises a name starting with = (formula injection)");
  const page1 = await runReport(manager, "expenses", { from: day, to: day, limit: 1 }, db);
  assert(page1.rows.length === 1 && page1.total === 2 && page1.totals.amount === 1350, "Paging shows one row while totals cover every matching row");

  console.log("\n--- 2. Activity log ---");
  await rejects("The Manager cannot open the activity log", () => listActivity(manager, {}, db), /permission|denied|forbidden/i);
  const act = await listActivity(owner, { actorId: manager.id, area: "finance" }, db);
  const actions = act.entries.map((e) => e.action);
  assert(["finance.rent_charge_recorded", "finance.rent_payment_recorded", "finance.expense_recorded"].every((a) => actions.includes(a)), "Owner sees the Manager's finance actions");
  assert(act.entries.every((e) => e.actorName === "Reports Manager" && e.area === "finance"), "Filters by person and area");
  await db.execute(
    "INSERT INTO audit_logs (id, actor_id, actor_username, action, target_type, target_id, metadata, created_at) VALUES (?, ?, 'x', 'account.test_event', 'staff', ?, ?, ?)",
    [`aud_${crypto.randomUUID()}`, owner.id, owner.id, JSON.stringify({ password: "hunter2", newOtp: "123456", note: "ok" }), new Date().toISOString()]
  );
  const sens = await listActivity(owner, { action: "account.test_event" }, db);
  assert(sens.entries[0]?.details?.password === "[REDACTED]" && sens.entries[0]?.details?.note === "ok", "A password in metadata is never shown");
  const forbidden = await listActivity(owner, { action: "auth.forbidden" }, db);
  assert(forbidden.entries.length === 0 || forbidden.entries[0].outcome === "REFUSED", "Refused attempts are marked as refused");

  console.log("\n--- 3. Notifications ---");
  const product = await createTiffinProduct(owner, { code: `RN_${rnd()}`.toUpperCase(), name: "Report Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 90 } as any, undefined, db);
  const cust = await createTiffinCustomer(manager, { fullName: `Ending Soon ${rnd()}`, phone: phone(), deliveryAddress: "Report Lane 4" } as any, IP, db);
  const sub = await createTiffinSubscription(manager, { customerId: cust.id, productId: product.id, startDate: addBusinessDays(businessToday(), -10), endDate: addBusinessDays(businessToday(), 3), mealTypes: "LUNCH" } as any, IP, db);
  await proposeResidentSettlement(manager, { residentId: res.id, checkOutDate: day, refundAmount: 1000, refundPaymentMethod: "CASH" } as any, IP, db);
  invalidateNotificationCache();
  const ownerFeed = (await getNotifications(owner, { limit: 200 })).notifications;
  const subNote = ownerFeed.find((n) => n.id === `notif_sub_exp_${sub.id}_${sub.endDate}`);
  assert(Boolean(subNote) && subNote!.link === "/tiffin?tab=subscriptions", "Subscription ending in 3 days is announced, linking to the subscriptions");
  assert(ownerFeed.some((n) => n.id.startsWith("notif_settle_") && /waiting for your approval/.test(n.description)), "The Owner is told a checkout waits for approval");
  assert(!ownerFeed.some((n) => n.link === "/kitchen"), "No kitchen notifications (out of scope)");
  const managerFeed = (await getNotifications(manager, { limit: 200 })).notifications;
  assert(!managerFeed.some((n) => n.id.startsWith("notif_settle_")), "The Manager does not get the Owner's approval items");
  const driverFeed = (await getNotifications(driver, { limit: 200 })).notifications;
  assert(!driverFeed.some((n) => n.domain === "FINANCE") && !driverFeed.some((n) => n.id.startsWith("notif_del_pending_")), "Delivery staff see no money or management items");
  await markNotificationAsRead(owner, subNote!.id);
  const again = (await getNotifications(owner, { limit: 200 })).notifications.filter((n) => n.id === subNote!.id);
  assert(again.length === 1 && again[0].isRead, "Read state sticks and the item is not duplicated");
  await updateSettingsSection(owner, "notifications", { subscriptionExpiry: false, pendingHandover: true, closingReminder: true }, IP, db);
  invalidateNotificationCache();
  assert(!(await getNotifications(owner, { limit: 200 })).notifications.some((n) => n.id.startsWith("notif_sub_exp_")), "Turning the alert off in Settings removes it");
  await db.execute("DELETE FROM business_settings WHERE key LIKE 'notifications.%'");
  clearSettingsCache();

  console.log("\n--- 4. Dashboard operations ---");
  const ops = await getDashboardOps("COMBINED", db);
  assert(ops.failed.length === 0 && ops.today !== null && ops.money !== null && ops.charts !== null, `Every dashboard block loads (failed: ${ops.failed.join(", ") || "none"})`);
  assert(ops.charts!.dailyCollections.length === 30 && ops.charts!.deliveryCompletion.length === 14 && ops.charts!.occupancyHistory.length === 6, "Charts cover 30 days, 14 days and 6 months");
  assert(ops.money!.netCollected === ops.money!.collectedThisMonth - ops.money!.expensesThisMonth, "Net is collected minus expenses");

  console.log("\n--- 5. Deleting staff accounts (history is never lost) ---");
  {
    const fresh = await insertStaff(db, "DELIVERY_PERSON", "Created By Mistake");
    await deleteStaffUser(owner, fresh.id, IP, db);
    const gone = await db.queryOne<any>("SELECT id FROM staff_users WHERE id = ?", [fresh.id]);
    const logged = await db.queryOne<any>("SELECT id FROM audit_logs WHERE action = 'staff.deleted' AND target_id = ?", [fresh.id]);
    assert(!gone && !!logged, "An account with no history is deleted, and the deletion is in the activity log");

    const worked = await insertStaff(db, "DELIVERY_PERSON", "Has History");
    await db.execute(
      "INSERT INTO audit_logs (id, actor_id, actor_username, action, target_type, target_id, metadata, ip_address, created_at) VALUES (?, ?, ?, 'auth.login', 'staff_user', ?, '{}', ?, ?)",
      [`aud_${crypto.randomUUID()}`, worked.id, worked.username, worked.id, IP, new Date().toISOString()]
    );
    let refused: any = null;
    try { await deleteStaffUser(owner, worked.id, IP, db); } catch (e) { refused = e; }
    const kept = await db.queryOne<any>("SELECT id FROM staff_users WHERE id = ?", [worked.id]);
    assert(refused !== null && /has history/.test(refused.message) && !!kept, "An account with recorded activity is refused and kept");

    const otherOwner = await insertStaff(db, "SUPER_ADMIN", "Second Owner");
    let ownerRefused: any = null;
    try { await deleteStaffUser(owner, otherOwner.id, IP, db); } catch (e) { ownerRefused = e; }
    assert(ownerRefused !== null && /Owner accounts cannot be deleted/.test(ownerRefused.message), "Owner accounts cannot be deleted");

    let selfRefused: any = null;
    try { await deleteStaffUser(owner, owner.id, IP, db); } catch (e) { selfRefused = e; }
    assert(selfRefused !== null, "Nobody can delete their own account");

    const target = await insertStaff(db, "DELIVERY_PERSON", "Manager Target");
    let mgrRefused: any = null;
    try { await deleteStaffUser(manager, target.id, IP, db); } catch (e) { mgrRefused = e; }
    assert(mgrRefused?.statusCode === 403, "A Manager cannot delete staff accounts (403)");
  }

  console.log(`\nPG REPORTS AND ADMIN: ${state.passed} PASSED, ${state.failed} FAILED`);
  await closePg();
  process.exit(state.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await closePg().catch(() => {});
  process.exit(1);
});
