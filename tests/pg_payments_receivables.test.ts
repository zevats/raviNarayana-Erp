/**
 * Delivery payments (Cash / UPI / Pay Later), Pay Later approval, invoice idempotency (0020 in the
 * application), Receivables, account statements, account-level payments and the Cashbook refund
 * breakdown. Disposable local database only (RN_PG_VERIFY_URL; helpers/pgVerifyTarget). Concurrency
 * cases send real parallel requests through the service layer on the PostgreSQL pool.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createRoom } from "../apps/erp/src/server/rooms/roomService";
import { registerResident, assignResidentToRoom } from "../apps/erp/src/server/residents/residentService";
import { recordRentCharge, recordRentPayment, reverseTransaction, getResidentRentBalance, getCashbookSummary } from "../apps/erp/src/server/finance/financeService";
import { createInvoice, allocatePaymentToInvoice } from "../apps/erp/src/server/finance/invoiceService";
import { createTiffinCustomer, createTiffinProduct, createTiffinSubscription } from "../apps/erp/src/server/tiffin/tiffinService";
import { recordTiffinPayment, generateTiffinInvoices } from "../apps/erp/src/server/tiffin/tiffinBillingService";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import { completeDeliveryTask, recordDeliveryCollection, syncDeliveryActions, listStaffCustody } from "../apps/erp/src/server/delivery/deliveryService";
import { setPayLater, getPayLaterStatus, closePaymentReview } from "../apps/erp/src/server/tiffin/payLaterService";
import { listReceivables, getReceivableAccount, getAccountStatement, receiveAccountPayment } from "../apps/erp/src/server/finance/receivablesService";
import { getNotifications, invalidateNotificationCache } from "../apps/erp/src/server/notifications/notificationService";
import { AuthenticatedUser } from "../apps/erp/src/types";
import { pinClock } from "./helpers/fixedClock";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff, uniqueBusinessDate } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;
const settled = (rs: PromiseSettledResult<any>[]) => ({
  ok: rs.filter((r) => r.status === "fulfilled").map((r: any) => r.value),
  errors: rs.filter((r) => r.status === "rejected").map((r: any) => String(r.reason?.message ?? r.reason)),
});
const rawDbError = (m: string) => /40P01|deadlock|current transaction is aborted|duplicate key|violates/i.test(m);
async function num(db: AsyncDb, sql: string, params: any[] = []) {
  const r = await db.queryOne<any>(sql, params);
  return Number(r?.n ?? 0);
}
async function refused(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}

async function main() {
  console.log("================================================================================");
  console.log("PAYMENTS, PAY LATER, RECEIVABLES (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  assert(db.isPostgres === true, "Service layer is running on PostgreSQL");
  const owner = await insertStaff(db, "SUPER_ADMIN", "P2 Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "P2 Manager");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "P2 Driver");
  const driver2 = await insertStaff(db, "DELIVERY_PERSON", "P2 Other Driver");
  const day = uniqueBusinessDate(61);
  const product = await createTiffinProduct(owner, { code: `P2_${rnd()}`.toUpperCase(), name: "P2 Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 100 } as any, undefined, db);
  const customer = async (name: string, ph = phone()) =>
    (await createTiffinCustomer(manager, { fullName: `${name} ${rnd()}`, phone: ph, deliveryAddress: "P2 Lane" } as any, IP, db)) as any;

  /** A delivery order of `qty` × ₹100 for a customer, assigned to `who`, not yet delivered. */
  const placeOrder = async (cust: any, qty = 3, who: AuthenticatedUser = driver) => {
    const o: any = await createUnifiedOrder(manager, {
      orderType: "DELIVERY", customerId: cust.id, customerName: cust.fullName, customerPhone: cust.phone, deliveryAddress: "P2 Lane",
      serviceDate: day, mealType: "LUNCH", items: [{ productId: product.id, productName: "P2 Thali", quantity: qty, unitPrice: 100 }], idempotencyKey: `p2o_${rnd()}`,
    } as any, IP, db);
    await db.execute("UPDATE delivery_tasks SET assigned_to = ?, assigned_to_name = ? WHERE id = ?", [who.id, who.fullName, o.deliveryTaskId]);
    const item = await db.queryOne<any>("SELECT id, quantity FROM order_items WHERE order_id = ?", [o.orderId]);
    return { orderId: o.orderId as string, taskId: o.deliveryTaskId as string, lines: [{ orderItemId: item.id, deliveredQuantity: Number(item.quantity), undeliveredQuantity: 0 }] };
  };
  const deliver = (o: { taskId: string; lines: any[] }, extra: Record<string, any>, who: AuthenticatedUser = driver) =>
    completeDeliveryTask(who, o.taskId, { recipientName: "Customer", lines: o.lines, idempotencyKey: `p2d_${rnd()}`, ...extra } as any, IP, db);
  const orderOutstanding = async (accountKey: string, orderId: string) => {
    const acc = await getReceivableAccount(owner, accountKey, db);
    const line = acc.lines.find((l) => l.refId === orderId);
    return line ? { outstanding: line.outstanding, status: line.status, choice: line.paymentChoice, review: line.review } : { outstanding: 0, status: "PAID", choice: null, review: null };
  };
  const custody = async (staffId: string) => {
    const r = (await listStaffCustody(owner, db)).staff.find((x) => x.staffId === staffId);
    return { cash: Number(r?.cashCollected ?? 0), upi: Number(r?.upiCollected ?? 0) };
  };

  // ---------------------------------------------------------------------------
  console.log("\n--- 1. Collections: cash, UPI, partial, mixed, reversal ---");
  const cx = await customer("P2 Collections");
  await setPayLater(manager, cx.id, true, IP, db);
  const C = `C:${cx.id}`;
  const before1 = await custody(driver.id);
  const cashFull = await placeOrder(cx);
  await deliver(cashFull, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 300 });
  assert((await orderOutstanding(C, cashFull.orderId)).status === "PAID", "Cash ₹300 of ₹300: order fully paid, not in receivables");
  const upiFull = await placeOrder(cx);
  await deliver(upiFull, { paymentChoice: "UPI", paymentMethod: "UPI", collectedAmount: 300 });
  assert((await orderOutstanding(C, upiFull.orderId)).status === "PAID", "UPI ₹300 of ₹300: order fully paid");
  const cashPart = await placeOrder(cx);
  await deliver(cashPart, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 100 });
  const cp = await orderOutstanding(C, cashPart.orderId);
  assert(cp.outstanding === 200 && cp.status === "PARTIALLY_PAID" && cp.choice === "CASH" && cp.review === null, `Partial cash ₹100: ₹${cp.outstanding} outstanding, ${cp.status}, choice ${cp.choice}`);
  const upiPart = await placeOrder(cx);
  await deliver(upiPart, { paymentChoice: "UPI", paymentMethod: "UPI", collectedAmount: 100 });
  assert((await orderOutstanding(C, upiPart.orderId)).outstanding === 200, "Partial UPI ₹100: ₹200 outstanding");
  const after1 = await custody(driver.id);
  assert(after1.cash - before1.cash === 400, `Driver's cash rises by the cash actually taken only (₹${after1.cash - before1.cash}; expected ₹400)`);
  const mixed = await placeOrder(cx);
  await deliver(mixed, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 100 });
  await recordDeliveryCollection(manager, mixed.taskId, { collectedAmount: 50, paymentMethod: "UPI", idempotencyKey: `p2m_${rnd()}` }, IP, db);
  assert((await orderOutstanding(C, mixed.orderId)).outstanding === 150, "Mixed: ₹100 cash + ₹50 UPI → ₹150 outstanding");
  const upiEntry = await db.queryOne<any>(
    "SELECT f.id FROM delivery_collections dc JOIN financial_transactions f ON f.id = dc.transaction_id WHERE dc.delivery_task_id = ? AND dc.payment_method = 'UPI'",
    [mixed.taskId]
  );
  await reverseTransaction(owner, upiEntry.id, "P2 test: UPI not received", IP, db);
  const mx = await orderOutstanding(C, mixed.orderId);
  assert(mx.outstanding === 200 && mx.status === "PARTIALLY_PAID", `UPI ₹50 reversed, cash ₹100 still counts: ₹${mx.outstanding} outstanding (expected ₹200)`);
  assert((await refused(() => reverseTransaction(owner, upiEntry.id, "P2 test: again", IP, db))) !== null && (await orderOutstanding(C, mixed.orderId)).outstanding === 200,
    "Repeated reversal refused; balance unchanged");

  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Pay Later approval ---");
  const pl = await customer("P2 Approval");
  const st0 = await getPayLaterStatus(manager, pl.id, db);
  assert(st0.enabled === false && st0.updatedAt === null, "A customer starts without Pay Later");
  const driverTry = await refused(() => setPayLater(driver, pl.id, true, IP, db));
  assert(driverTry !== null && /denied|permission/i.test(driverTry), `Delivery staff cannot approve Pay Later (${driverTry})`);
  const st1 = await setPayLater(manager, pl.id, true, IP, db);
  assert(st1.enabled === true && st1.updatedBy === "P2 Manager" && Boolean(st1.updatedAt), "Manager allows Pay Later; who and when are kept");
  await setPayLater(manager, pl.id, true, IP, db);
  const st2 = await setPayLater(owner, pl.id, false, IP, db);
  const audits = await db.query<any>("SELECT metadata FROM audit_logs WHERE action = 'tiffin.customer_pay_later_changed' AND target_id = ? ORDER BY created_at", [pl.id]);
  const meta = audits.map((a) => JSON.parse(a.metadata));
  assert(st2.enabled === false && audits.length === 2 && meta[0].previous === false && meta[0].next === true && meta[1].previous === true && meta[1].next === false,
    `Every change is audited with previous and new state; an unchanged repeat adds nothing (${audits.length} entries)`);

  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Pay Later at the door ---");
  const yes = await customer("P2 Approved");
  await setPayLater(owner, yes.id, true, IP, db);
  const custodyBefore = await custody(driver.id);
  const later = await placeOrder(yes);
  const ledgerBefore = await num(db, "SELECT COUNT(*)::int AS n FROM financial_transactions");
  await deliver(later, { paymentChoice: "PAY_LATER", payLaterAllowedAtSelection: true });
  const lt = await orderOutstanding(`C:${yes.id}`, later.orderId);
  const task = await db.queryOne<any>("SELECT status FROM delivery_tasks WHERE id = ?", [later.taskId]);
  assert(task.status === "DELIVERED" && lt.outstanding === 300 && lt.status === "UNPAID" && lt.choice === "PAY_LATER" && lt.review === null,
    `Pay Later: delivered, ₹${lt.outstanding} unpaid, choice ${lt.choice}, no review flag`);
  assert((await num(db, "SELECT COUNT(*)::int AS n FROM delivery_collections WHERE delivery_task_id = ?", [later.taskId])) === 0 &&
    (await num(db, "SELECT COUNT(*)::int AS n FROM financial_transactions")) === ledgerBefore,
    "Pay Later creates no collection and no cashbook entry");
  const custodyAfter = await custody(driver.id);
  assert(custodyAfter.cash === custodyBefore.cash && custodyAfter.upi === custodyBefore.upi, "Pay Later adds nothing to the driver's cash or UPI");
  const both = await placeOrder(yes);
  assert((await refused(() => deliver(both, { paymentChoice: "PAY_LATER", collectedAmount: 100, paymentMethod: "CASH" }))) !== null, "Pay Later with money collected is refused");
  await deliver(both, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 100, payLaterAllowedAtSelection: true });
  const bp = await orderOutstanding(`C:${yes.id}`, both.orderId);
  assert(bp.outstanding === 200 && bp.review === null, "Approved customer, part payment: ₹200 stays on the account, no flag");

  const no = await customer("P2 Not Approved");
  const noLater = await placeOrder(no);
  await deliver(noLater, { paymentChoice: "PAY_LATER", payLaterAllowedAtSelection: false });
  const nl = await orderOutstanding(`C:${no.id}`, noLater.orderId);
  // Pay Later is open to every customer (owner decision 2026-11-07): no approval, no review flag.
  assert(nl.outstanding === 300 && nl.review === null, `Pay Later for a customer never approved: delivered, ₹${nl.outstanding} on the account, no review flag`);
  const noPart = await placeOrder(no);
  await deliver(noPart, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 100 });
  const np = await orderOutstanding(`C:${no.id}`, noPart.orderId);
  assert(np.outstanding === 200 && np.review === null, "Part payment by a customer never approved: ₹200 left on the account, no flag");
  // Deliveries flagged before Pay Later was opened to everyone still exist: mark one so the review
  // filter below stays covered.
  await db.execute("UPDATE orders SET payment_review = 'PAY_LATER_NOT_APPROVED', payment_reviewed_at = NULL WHERE id = ?", [noLater.orderId]);
  const noFull = await placeOrder(no);
  await deliver(noFull, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 300 });
  assert((await db.queryOne<any>("SELECT payment_review FROM orders WHERE id = ?", [noFull.orderId])).payment_review === null, "Not approved, paid in full: no flag");
  const over = await placeOrder(no);
  // Since migration 0022 an amount above the order is accepted and allocated in the open: the order
  // first, then earlier dues, then an advance. Nothing is kept as hidden credit.
  await deliver(over, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 301, idempotencyKey: `p2over_${rnd()}` });
  const overRows = await db.query<any>("SELECT allocation, amount FROM delivery_collections WHERE collected_at_task_id = ? ORDER BY allocation", [over.taskId]);
  const overSplit = overRows.map((r: any) => `${r.allocation}:${r.amount}`).join(",");
  assert(overRows.reduce((s: number, r: any) => s + Number(r.amount), 0) === 301 && overRows.some((r: any) => r.allocation === "ORDER" && Number(r.amount) === 300) && overRows.every((r: any) => ["ORDER", "PREVIOUS_DUES", "ADVANCE"].includes(r.allocation)),
    `Collecting ₹301 for a ₹300 order: ₹300 to the order, ₹1 to earlier dues or an advance, every rupee recorded (${overSplit})`);
  const mine = await placeOrder(no, 1, driver);
  assert(/not assigned/i.test((await refused(() => deliver(mine, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 100 }, driver2))) || ""),
    "A driver cannot complete another driver's stop");
  await deliver(mine, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 50 });
  assert(/not assigned/i.test((await refused(() => recordDeliveryCollection(driver2, mine.taskId, { collectedAmount: 50, paymentMethod: "CASH", idempotencyKey: `x_${rnd()}` }, IP, db))) || ""),
    "A driver cannot record a payment on another driver's stop");

  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Offline delivery synced after the approval was withdrawn ---");
  const w = await customer("P2 Withdrawn");
  await setPayLater(owner, w.id, true, IP, db);
  const wo = await placeOrder(w);
  // On the phone, offline: Pay Later chosen while approved. Before the phone syncs, approval ends.
  await setPayLater(manager, w.id, false, IP, db);
  const action = {
    id: `act_${rnd()}`, action: "COMPLETE_DELIVERY", taskId: wo.taskId, userId: driver.id, idempotencyKey: `off_${rnd()}`, createdAt: new Date().toISOString(), retryCount: 0, status: "PENDING",
    payload: { recipientName: "Customer", lines: wo.lines, paymentChoice: "PAY_LATER", payLaterAllowedAtSelection: true },
  } as any;
  const syncs = settled(await Promise.allSettled([syncDeliveryActions(driver, [action], IP, db), syncDeliveryActions(driver, [action], IP, db)]));
  const statuses = syncs.ok.flatMap((r: any) => r.results.map((x: any) => x.status));
  const woRow = await db.queryOne<any>("SELECT payment_choice, payment_review, payment_review_detail FROM orders WHERE id = ?", [wo.orderId]);
  const woDetail = JSON.parse(woRow.payment_review_detail || "{}");
  const delivered = await num(db, "SELECT COUNT(*)::int AS n FROM delivery_task_events WHERE task_id = ? AND event_type = 'DELIVERED'", [wo.taskId]);
  assert(syncs.ok.length === 2 && statuses.every((s: string) => s === "SYNCED" || s === "IDEMPOTENT_IGNORED") && delivered === 1,
    `Two simultaneous syncs of one offline completion: applied once (${statuses.join(", ")}; ${delivered} delivery event)`);
  assert(woRow.payment_choice === "PAY_LATER" && woRow.payment_review === null && Object.keys(woDetail).length === 0,
    "Offline Pay Later synced after the approval was withdrawn: accepted, choice kept, no review flag");
  assert((await orderOutstanding(`C:${w.id}`, wo.orderId)).outstanding === 300, "The order stays outstanding (not erased, not paid)");
  // An older flagged delivery (from before Pay Later was opened to everyone): reviews still work.
  await db.execute("UPDATE orders SET payment_review = 'PAY_LATER_NOT_APPROVED', payment_reviewed_at = NULL WHERE id = ?", [wo.orderId]);
  invalidateNotificationCache();
  const feed = (await getNotifications(manager, { limit: 200 } as any)).notifications;
  assert(feed.some((n: any) => n.id === `notif_pay_review_${wo.orderId}`), "Managers are notified of an older flagged order to review");
  const cashOff = await placeOrder(w);
  const cashAction = { ...action, id: `act_${rnd()}`, taskId: cashOff.taskId, idempotencyKey: `off_${rnd()}`, payload: { recipientName: "Customer", lines: cashOff.lines, paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 300, payLaterAllowedAtSelection: false } };
  await Promise.allSettled([syncDeliveryActions(driver, [cashAction], IP, db), syncDeliveryActions(driver, [cashAction], IP, db), syncDeliveryActions(driver, [cashAction], IP, db)]);
  assert((await num(db, "SELECT COUNT(*)::int AS n FROM delivery_collections WHERE delivery_task_id = ?", [cashOff.taskId])) === 1, "An offline cash completion synced three times at once records one collection");
  assert((await refused(() => closePaymentReview(driver, wo.orderId, "driver tries", IP, db))) !== null, "Delivery staff cannot close a review");
  await closePaymentReview(manager, wo.orderId, "Customer will pay on Friday", IP, db);
  await closePaymentReview(manager, wo.orderId, "Second close", IP, db);
  const closedAudits = await num(db, "SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'orders.payment_review_closed' AND target_id = ?", [wo.orderId]);
  const after4 = await orderOutstanding(`C:${w.id}`, wo.orderId);
  assert(after4.review === null && after4.outstanding === 300 && closedAudits === 1, "Manager closes the review once (audited); the balance stays until paid");

  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Invoice idempotency (migration 0020) ---");
  const t = await customer("P2 Invoices");
  const tiffinInvoice = (key: string | undefined, amount: number, extra: Record<string, any> = {}) =>
    createInvoice(owner, {
      invoiceCategory: "TIFFIN", customerId: t.id, invoiceType: "REGULAR_BILL", issueDate: day, dueDate: day, billingPeriod: "2041-12",
      items: [{ description: "Tiffin", unitPrice: amount, quantity: 1 }], autoIssue: true, idempotencyKey: key, ...extra,
    } as any, IP, db) as Promise<any>;
  const K = `inv_${rnd()}`;
  const five = settled(await Promise.allSettled(Array.from({ length: 5 }, () => tiffinInvoice(K, 500))));
  const ids = new Set(five.ok.map((i: any) => i.id));
  assert(five.ok.length === 5 && ids.size === 1 && (await num(db, "SELECT COUNT(*)::int AS n FROM invoices WHERE idempotency_key = ?", [K])) === 1,
    `Five simultaneous identical requests (one key): one invoice, all answered with it (${five.errors.join(" | ") || "no errors"})`);
  const retry = await tiffinInvoice(K, 500);
  assert(retry.id === [...ids][0], "A retry after a lost response returns the same invoice");
  assert((await refused(() => tiffinInvoice(K, 900))) !== null, "The same key for a different invoice is refused");
  const second = await tiffinInvoice(`inv_${rnd()}`, 200);
  assert(second.id !== retry.id, "A new request (new key) creates its own invoice: separate manual invoices stay possible");
  const monthly = await createTiffinProduct(owner, { code: `P2M_${rnd()}`.toUpperCase(), name: "P2 Monthly", category: "SUBSCRIPTION_PACKAGE", billingUnit: "PER_MONTH", price: 3000 } as any, undefined, db);
  const s1: any = await createTiffinSubscription(manager, { customerId: t.id, productId: monthly.id, startDate: "2041-12-01", mealTypes: "LUNCH" } as any, IP, db);
  const s2: any = await createTiffinSubscription(manager, { customerId: t.id, productId: monthly.id, startDate: "2041-12-01", mealTypes: "DINNER" } as any, IP, db);
  const subRace = settled(await Promise.allSettled([
    tiffinInvoice(`inv_${rnd()}`, 3000, { subscriptionId: s1.id, billingPeriod: "2041-12" }),
    tiffinInvoice(`inv_${rnd()}`, 3000, { subscriptionId: s1.id, billingPeriod: "Dec 2041" }),
  ]));
  assert(subRace.ok.length === 1 && subRace.errors.length === 1 && /already has an active invoice/.test(subRace.errors[0]),
    `Same subscription and month written two ways, at once: one invoice, the other refused clearly (${subRace.errors.join(" | ")})`);
  await tiffinInvoice(`inv_${rnd()}`, 3000, { subscriptionId: s2.id, billingPeriod: "December 2041" });
  assert((await num(db, "SELECT COUNT(*)::int AS n FROM invoices WHERE customer_id = ? AND billing_month = '2041-12' AND subscription_id IS NOT NULL AND status <> 'CANCELLED'", [t.id])) === 2,
    "A different subscription in the same month is invoiced");
  const run = await generateTiffinInvoices(owner, { billingPeriod: "Dec 2041", startDate: "2041-12-01", endDate: "2041-12-31", dueDate: "2042-01-07", autoIssue: true, customerIds: [t.id] } as any, IP, db);
  assert(run.generatedCount === 0 && run.skippedCount === 2, `Monthly billing for "Dec 2041" sees both subscriptions as already billed (generated ${run.generatedCount}, skipped ${run.skippedCount})`);

  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Receivables and statements ---");
  const room = await createRoom(owner, { roomNumber: `P2${rnd()}`.toUpperCase(), floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 6000 }, IP, db);
  const sharedPhone = phone();
  const res: any = await registerResident(owner, { fullName: `P2 Resident ${rnd()}`, phone: sharedPhone }, IP, db);
  const stay: any = await assignResidentToRoom(owner, { residentId: res.id, roomId: room.id, checkInDate: day, monthlyRent: 6000 }, IP, db);
  const R = `R:${res.id}`;
  await recordRentCharge(owner, { residentId: res.id, stayId: stay.id, amount: 6000, transactionDate: day, billingPeriod: "P2 month 1" }, IP, db);
  await recordRentCharge(owner, { residentId: res.id, stayId: stay.id, amount: 6000, transactionDate: day, billingPeriod: "P2 month 2" }, IP, db);
  const rp = await recordRentPayment(manager, { residentId: res.id, amount: 4000, transactionDate: day, paymentMethod: "CASH" } as any, IP, db);
  const rp2 = await recordRentPayment(manager, { residentId: res.id, amount: 1000, transactionDate: day, paymentMethod: "UPI" } as any, IP, db);
  await reverseTransaction(owner, rp2.id, "P2 test: bounced", IP, db);
  const racc = await getReceivableAccount(owner, R, db);
  const rbal = await getResidentRentBalance(res.id, db);
  assert(racc.totals.PG === rbal && rbal === 8000, `PG account = rent ledger balance (₹${racc.totals.PG} / ₹${rbal}; expected ₹8,000)`);
  assert(racc.lines.length === 2 && racc.lines[0].outstanding === 2000 && racc.lines[0].status === "PARTIALLY_PAID" && racc.lines[1].outstanding === 6000,
    `Payments settle the oldest charge first (₹${racc.lines.map((l) => l.outstanding).join(" + ₹")})`);
  const rst = await getAccountStatement(owner, R, {}, db);
  assert(rst.closing === racc.totals.total, `Resident statement closes at the account balance (₹${rst.closing})`);
  assert(rst.entries.some((e) => e.reversedLater && e.payment === 1000) && rst.entries.some((e) => e.type === "Payment reversed" && e.adjustment === 1000),
    "The reversed payment stays visible, and its reversal is its own entry");
  void rp;

  const tacc = await getReceivableAccount(owner, `C:${t.id}`, db);
  const ledger = await db.queryOne<any>(
    `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'TIFFIN_CHARGE' THEN amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN transaction_type = 'TIFFIN_PAYMENT' THEN amount ELSE 0 END), 0) AS n
     FROM financial_transactions WHERE customer_id = ? AND status = 'POSTED'`,
    [t.id]
  );
  assert(tacc.totals.TIFFIN === Number(ledger.n), `Tiffin account = tiffin ledger balance (₹${tacc.totals.TIFFIN} / ₹${ledger.n})`);
  const unalloc = await recordTiffinPayment(owner, { customerId: t.id, amount: 150, transactionDate: day, paymentMethod: "CASH" } as any, IP, db);
  assert((await refused(() => recordTiffinPayment(manager, { customerId: t.id, amount: 10, transactionDate: day, paymentMethod: "CASH" } as any, IP, db))) !== null,
    "A Manager still cannot record a tiffin payment directly (Owner-only; Managers collect through Receive payment)");
  const tacc2 = await getReceivableAccount(owner, `C:${t.id}`, db);
  assert(tacc2.totals.TIFFIN === tacc.totals.TIFFIN - 150 && tacc2.lines.some((l) => l.kind === "UNALLOCATED" && l.outstanding === -150),
    "An unallocated tiffin payment shows as a credit line and lowers the account (no hidden credit)");
  void unalloc;

  for (const key of [`C:${yes.id}`, `C:${no.id}`, `C:${w.id}`, `C:${cx.id}`, `C:${t.id}`]) {
    const a = await getReceivableAccount(owner, key, db);
    const s = await getAccountStatement(owner, key, {}, db);
    assert(s.closing === a.totals.total, `${key.slice(0, 10)}…: statement closing ₹${s.closing} = receivables ₹${a.totals.total}`);
  }
  const ranged = await getAccountStatement(owner, `C:${cx.id}`, { from: "2400-01-01" }, db);
  const full = await getAccountStatement(owner, `C:${cx.id}`, {}, db);
  assert(ranged.opening === full.closing && ranged.entries.length === 0 && ranged.closing === full.closing, "A statement from a later date opens with everything before it (no lost or doubled balance)");
  const cxs = full.entries;
  assert(cxs.some((e) => e.type === "Payment reversed" && e.source === "DELIVERY") && cxs.filter((e) => e.type === "Delivered order").length === 5,
    "Customer statement lists delivered orders, their payments and the reversed UPI collection");

  const twin: any = await customer("P2 Same Phone", sharedPhone);
  await setPayLater(owner, twin.id, true, IP, db);
  await deliver(await placeOrder(twin, 1), { paymentChoice: "PAY_LATER", payLaterAllowedAtSelection: true });
  const byPhone = await listReceivables(owner, { q: sharedPhone, limit: 50 }, db);
  const keys = byPhone.accounts.map((a) => a.accountKey).sort();
  assert(keys.length === 2 && keys.includes(R) && keys.includes(`C:${twin.id}`), `A resident and a customer with the same phone stay two accounts (${keys.join(", ")})`);

  const all = await listReceivables(owner, { limit: 100 }, db);
  const ageSum = Object.values(all.summary.ageing).reduce((a, b) => a + b, 0);
  assert(ageSum + all.summary.unallocatedCredit === all.summary.total, `Ageing buckets + unallocated credit = total outstanding (₹${ageSum} + ₹${all.summary.unallocatedCredit} = ₹${all.summary.total})`);
  const bySourceSum = all.summary.bySource.PG + all.summary.bySource.TIFFIN + all.summary.bySource.DELIVERY;
  assert(bySourceSum === all.summary.total, "PG + Tiffin + Delivery = total (nothing counted twice)");
  const p1 = await listReceivables(owner, { limit: 2, offset: 0, sort: "name" }, db);
  const p2 = await listReceivables(owner, { limit: 2, offset: 2, sort: "name" }, db);
  assert(p1.accounts.length === 2 && p2.accounts.length >= 1 && !p1.accounts.some((a) => p2.accounts.some((b) => b.accountKey === a.accountKey)) && p1.total === all.total,
    "Pages do not overlap and share one total");
  const onlyDelivery = await listReceivables(owner, { source: "DELIVERY", limit: 100 }, db);
  assert(onlyDelivery.accounts.every((a) => a.pg === 0 && a.tiffin === 0 && a.delivery !== 0), "Source filter shows only delivery balances");
  const reviewOnly = await listReceivables(owner, { reviewOnly: true, limit: 100 }, db);
  assert(reviewOnly.accounts.some((a) => a.accountKey === `C:${no.id}`) && reviewOnly.accounts.every((a) => a.reviews > 0), "Review filter lists only accounts with flagged deliveries");

  // ---------------------------------------------------------------------------
  console.log("\n--- 7. Receive payment for an account ---");
  const inv = await getReceivableAccount(owner, `C:${t.id}`, db);
  const invoiceLine = inv.lines.find((l) => l.kind === "INVOICE" && l.outstanding === 500)!;
  const pay = await customer("P2 Pays");
  await setPayLater(owner, pay.id, true, IP, db);
  const payOrder = await placeOrder(pay, 2);
  await deliver(payOrder, { paymentChoice: "PAY_LATER", payLaterAllowedAtSelection: true });
  const payInv: any = await createInvoice(owner, {
    invoiceCategory: "TIFFIN", customerId: pay.id, invoiceType: "REGULAR_BILL", issueDate: day, dueDate: day, billingPeriod: "2041-11",
    items: [{ description: "Tiffin", unitPrice: 500, quantity: 1 }], autoIssue: true,
  } as any, IP, db);
  const PK = `recv_${rnd()}`;
  const body = {
    accountKey: `C:${pay.id}`, paymentMethod: "UPI" as const, transactionDate: day, amountReceived: 700, idempotencyKey: PK,
    items: [{ source: "TIFFIN" as const, refId: payInv.id, amount: 500 }, { source: "DELIVERY" as const, refId: payOrder.orderId, amount: 200 }],
  };
  const beforePay = (await getReceivableAccount(owner, `C:${pay.id}`, db)).totals.total;
  const runs = settled(await Promise.allSettled(Array.from({ length: 5 }, () => receiveAccountPayment(manager, body, IP, db))));
  const afterPay = (await getReceivableAccount(owner, `C:${pay.id}`, db)).totals.total;
  const audit = await num(db, "SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'finance.account_payment_received' AND target_id = ?", [`C:${pay.id}`]);
  const invNow = await db.queryOne<any>("SELECT status, balance_due FROM invoices WHERE id = ?", [payInv.id]);
  assert(runs.ok.length === 5 && beforePay - afterPay === 700 && audit === 1 && invNow.status === "PAID" && runs.errors.every((e) => !rawDbError(e)),
    `Manager receives ₹700 (invoice ₹500 + order ₹200), five times at once: recorded once (₹${beforePay} → ₹${afterPay}; ${audit} audit entry; invoice ${invNow.status})`);
  assert((await num(db, "SELECT COUNT(*)::int AS n FROM financial_transactions WHERE idempotency_key LIKE ?", [`${PK}%`])) === 1 &&
    (await num(db, "SELECT COUNT(*)::int AS n FROM delivery_collections WHERE idempotency_key LIKE ?", [`${PK}%`])) === 1,
    "One tiffin payment and one order collection exist for that payment");
  const partKey = `recv_${rnd()}`;
  await receiveAccountPayment(owner, { accountKey: `C:${t.id}`, paymentMethod: "CASH", transactionDate: day, amountReceived: 200, idempotencyKey: partKey, items: [{ source: "TIFFIN", refId: invoiceLine.refId, amount: 200 }] }, IP, db);
  const partial = await db.queryOne<any>("SELECT status, balance_due FROM invoices WHERE id = ?", [invoiceLine.refId]);
  assert(partial.status === "PARTIALLY_PAID" && Number(partial.balance_due) === 300, "A part payment leaves the rest open (₹300, partly paid)");
  const ordBefore = (await orderOutstanding(`C:${cx.id}`, cashPart.orderId)).outstanding;
  const atomic = await refused(() =>
    receiveAccountPayment(owner, {
      accountKey: `C:${t.id}`, paymentMethod: "CASH", transactionDate: day, amountReceived: 450, idempotencyKey: `recv_${rnd()}`,
      items: [{ source: "TIFFIN", refId: invoiceLine.refId, amount: 400 }, { source: "TIFFIN", refId: second.id, amount: 50 }],
    }, IP, db)
  );
  const secondNow = await db.queryOne<any>("SELECT balance_due FROM invoices WHERE id = ?", [second.id]);
  assert(atomic !== null && Number(secondNow.balance_due) === 200, `More than an invoice's open amount is refused and nothing else is recorded (${atomic})`);
  assert((await refused(() => receiveAccountPayment(owner, { accountKey: `C:${t.id}`, paymentMethod: "CASH", amountReceived: 100, idempotencyKey: `recv_${rnd()}`, items: [{ source: "TIFFIN", refId: second.id, amount: 50 }] }, IP, db))) !== null,
    "Amount received must equal the amounts applied");
  assert((await refused(() => receiveAccountPayment(owner, { accountKey: `C:${t.id}`, paymentMethod: "CASH", amountReceived: 100, idempotencyKey: `recv_${rnd()}`, items: [{ source: "DELIVERY", refId: cashPart.orderId, amount: 100 }] }, IP, db))) !== null &&
    (await orderOutstanding(`C:${cx.id}`, cashPart.orderId)).outstanding === ordBefore,
    "A balance of another account is refused");
  assert((await refused(() => receiveAccountPayment(driver, { accountKey: R, paymentMethod: "CASH", amountReceived: 100, idempotencyKey: `recv_${rnd()}`, items: [{ source: "PG", refId: res.id, amount: 100 }] }, IP, db))) !== null,
    "Delivery staff cannot receive account payments");
  assert((await refused(() => receiveAccountPayment(manager, { accountKey: R, paymentMethod: "CASH", transactionDate: day, amountReceived: 9000, idempotencyKey: `recv_${rnd()}`, items: [{ source: "PG", refId: res.id, amount: 9000 }] }, IP, db))) !== null,
    "Rent above the balance is refused (no credit)");
  await receiveAccountPayment(manager, { accountKey: R, paymentMethod: "BANK_TRANSFER", transactionDate: day, referenceNumber: "NEFT-P2", amountReceived: 3000, idempotencyKey: `recv_${rnd()}`, items: [{ source: "PG", refId: res.id, amount: 3000 }] }, IP, db);
  assert((await getResidentRentBalance(res.id, db)) === 5000 && (await getReceivableAccount(owner, R, db)).totals.PG === 5000, "Rent payment through Receivables lowers the rent ledger (₹5,000 left)");
  const extra = await recordTiffinPayment(owner, { customerId: t.id, amount: 10, transactionDate: day, paymentMethod: "CASH" } as any, IP, db);
  const mgrAlloc = await refused(() => allocatePaymentToInvoice(manager, { invoiceId: second.id, paymentTransactionId: extra.transaction.id, amount: 10 }, IP, db));
  assert(mgrAlloc !== null && /denied|permission/i.test(mgrAlloc), "Re-allocating existing payments stays Owner-only");

  // ---------------------------------------------------------------------------
  console.log("\n--- 8. Cashbook: refunds shown separately (decision D9) ---");
  // A random year in the 1900s (no other suite writes there), and every figure is compared with a
  // snapshot taken first, so earlier runs against the same disposable database cannot interfere.
  const Y = 1900 + crypto.randomInt(0, 100);
  const range = (a: string, b: string) => getCashbookSummary(owner, { startDate: `${Y}-${a}`, endDate: `${Y}-${b}`, division: "PG" }, db);
  const [june0, july0, both0, aug0] = await Promise.all([range("06-01", "06-30"), range("07-01", "07-31"), range("06-01", "07-31"), range("08-01", "08-31")]);
  pinClock(`${Y}-07-10T12:00:00+05:30`);
  const q = await registerResident(owner, { fullName: `P2 Cashbook ${rnd()}`, phone: phone() }, IP, db);
  const qRoom = await createRoom(owner, { roomNumber: `P2C${rnd()}`.toUpperCase(), floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 6000 }, IP, db);
  const qStay: any = await assignResidentToRoom(owner, { residentId: q.id, roomId: qRoom.id, checkInDate: `${Y}-06-01`, monthlyRent: 6000 }, IP, db);
  await recordRentCharge(owner, { residentId: q.id, stayId: qStay.id, amount: 6000, transactionDate: `${Y}-06-01`, billingPeriod: `June ${Y}` }, IP, db);
  const qPay = await recordRentPayment(owner, { residentId: q.id, amount: 6000, transactionDate: `${Y}-06-15`, paymentMethod: "CASH" } as any, IP, db);
  await reverseTransaction(owner, qPay.id, "P2 test: refund in July", IP, db);
  const [june, july, both2, aug] = await Promise.all([range("06-01", "06-30"), range("07-01", "07-31"), range("06-01", "07-31"), range("08-01", "08-31")]);
  const d = (a: any, b: any, f: (s: any) => number) => f(a) - f(b);
  const fresh = july0.netCashMovementExact === 0 && july0.breakdown!.rentReceipts === 0 && july0.breakdown!.rentRefunds === 0;
  assert(d(june, june0, (s) => s.breakdown.rentReceipts) === 6000 && d(june, june0, (s) => s.netCashMovementExact) === 6000,
    `June ${Y}: the ₹6,000 received counts in June (refunded later)`);
  assert(d(july, july0, (s) => s.breakdown.rentRefunds) === 6000 && d(july, july0, (s) => s.breakdown.rentReceipts) === 0 && d(july, july0, (s) => s.netCashMovementExact) === -6000,
    `July ${Y}: the refund shows on its own line and the net falls by ₹6,000`);
  assert(!fresh || (july.netCashMovementExact === -6000 && july.totalRentCollected === 0),
    `July ${Y} on its own: net −₹6,000 shown (₹${july.netCashMovementExact}); the old floored figure stays ₹${july.totalRentCollected}`);
  assert(d(both2, both0, (s) => s.netCashMovementExact) === 0 &&
    (june.netCashMovementExact ?? 0) + (july.netCashMovementExact ?? 0) - ((june0.netCashMovementExact ?? 0) + (july0.netCashMovementExact ?? 0)) === d(both2, both0, (s) => s.netCashMovementExact),
    "Months add up to the range: +₹6,000 in June and −₹6,000 in July make ₹0 for June–July");
  assert(d(aug, aug0, (s) => s.netCashMovementExact) === 0, "A month with no movement is unchanged");
  const mid = await getAccountStatement(owner, `R:${q.id}`, { from: `${Y}-06-10` }, db);
  const qBal = await getResidentRentBalance(q.id, db);
  assert(mid.opening === 6000 && mid.entries.length === 2 && mid.entries[0].reversedLater && mid.entries[1].type === "Payment reversed" && mid.closing === qBal && qBal === 6000,
    `Statement from 10 June: opening ₹${mid.opening} carried forward, payment and its reversal listed, closing ₹${mid.closing} = rent ledger ₹${qBal}`);
  const juneOnly = await getAccountStatement(owner, `R:${q.id}`, { from: `${Y}-06-01`, to: `${Y}-06-30` }, db);
  assert(juneOnly.opening === 0 && juneOnly.closing === 0 && juneOnly.entries.length === 2, `Statement for June alone: ₹0 → charge and payment → ₹${juneOnly.closing}`);

  console.log("\n================================================================================");
  console.log(`PAYMENTS & RECEIVABLES RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
  console.log("================================================================================");
}

main()
  .catch((err) => {
    state.failed++;
    console.error("Test runner error:", err?.stack ?? err?.message ?? err);
  })
  .finally(async () => {
    try {
      await closePg();
    } catch {}
    process.exit(state.failed > 0 ? 1 : 0);
  });
