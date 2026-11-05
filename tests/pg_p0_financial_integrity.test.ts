/**
 * P0 financial integrity: regression tests for the six defects in
 * docs/ERP_FEATURE_AND_UI_ANALYSIS_2026-11.md §2 (fixed in docs/P0_FINANCIAL_INTEGRITY_FIXES_2026-11.md).
 *
 * Disposable local database only (RN_PG_VERIFY_URL, see helpers/pgVerifyTarget); synthetic data.
 * Concurrency cases send real parallel requests through the service layer on the PostgreSQL pool
 * (Promise.allSettled), several rounds each, and check the stored rows afterwards.
 *
 * This suite deliberately imports only service functions that existed before the fixes, so the
 * same file can be run against the previous code to show the original failures.
 *
 *   1. Unallocated tiffin payments are not overstated (₹1,500 vs ₹500 reproduction)
 *   2. Concurrent allocations never exceed the payment or the invoice
 *   3. A resident's rent month is charged once, whatever the period spelling
 *   4. Reversing a delivery collection's cashbook entry brings the order's balance back
 *   5. "Collect balance": one key = one collection (retries, duplicates, concurrency)
 *   6. Reversing an allocated payment keeps the allocation history
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createRoom } from "../apps/erp/src/server/rooms/roomService";
import { registerResident, assignResidentToRoom } from "../apps/erp/src/server/residents/residentService";
import { recordRentCharge, reverseTransaction } from "../apps/erp/src/server/finance/financeService";
import { previewMonthlyRent } from "../apps/erp/src/server/finance/rentGenerationService";
import { createInvoice, issueInvoice, allocatePaymentToInvoice, getInvoiceById } from "../apps/erp/src/server/finance/invoiceService";
import { createTiffinCustomer, createTiffinProduct } from "../apps/erp/src/server/tiffin/tiffinService";
import { recordTiffinPayment, getTiffinCustomerBalance } from "../apps/erp/src/server/tiffin/tiffinBillingService";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import {
  completeDeliveryTask,
  recordDeliveryCollection,
  getDeliveryTaskById,
  createCashHandoverDeclaration,
  acceptCashHandover,
  listStaffCustody,
} from "../apps/erp/src/server/delivery/deliveryService";
import { AuthenticatedUser } from "../apps/erp/src/types";
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
const rawDbError = (msg: string) => /40P01|deadlock|current transaction is aborted|duplicate key|violates/i.test(msg);

async function num(db: AsyncDb, sql: string, params: any[] = []): Promise<number> {
  const row = await db.queryOne<any>(sql, params);
  return Number(row?.n ?? 0);
}

/** The pre-fix "unallocated" query, kept here only to show what it reported on the same rows. */
async function oldUnallocated(db: AsyncDb, customerId: string): Promise<number> {
  return num(db, `
    SELECT COALESCE(SUM(t.amount), 0) - COALESCE(SUM(a.amount), 0) AS n
    FROM financial_transactions t
    LEFT JOIN invoice_payment_allocations a ON a.payment_transaction_id = t.id
    WHERE t.customer_id = ? AND t.transaction_type = 'TIFFIN_PAYMENT' AND t.status = 'POSTED'`, [customerId]);
}

/**
 * Invariants 1, 2 and 4 for a set of invoices: the stored amount paid equals the allocations of
 * payments that are still POSTED; paid + due = total; no payment is allocated beyond its amount.
 */
async function invoiceInvariants(db: AsyncDb, invoiceIds: string[], label: string) {
  for (const id of invoiceIds) {
    const inv = await db.queryOne<any>("SELECT amount_paid, balance_due, total_amount FROM invoices WHERE id = ?", [id]);
    const active = await num(db, `
      SELECT COALESCE(SUM(a.amount), 0)::int AS n FROM invoice_payment_allocations a
      JOIN financial_transactions t ON t.id = a.payment_transaction_id
      WHERE a.invoice_id = ? AND t.status = 'POSTED'`, [id]);
    assert(
      Number(inv.amount_paid) === active && Number(inv.amount_paid) + Number(inv.balance_due) === Number(inv.total_amount),
      `${label}: invoice paid ₹${inv.amount_paid} = active allocations ₹${active}; paid + due = total ₹${inv.total_amount}`
    );
  }
  const over = await num(db, `
    SELECT COUNT(*)::int AS n FROM (
      SELECT t.id FROM financial_transactions t JOIN invoice_payment_allocations a ON a.payment_transaction_id = t.id
      WHERE a.invoice_id IN (${invoiceIds.map(() => "?").join(", ")})
      GROUP BY t.id, t.amount HAVING SUM(a.amount) > t.amount
    ) x`, invoiceIds);
  assert(over === 0, `${label}: no payment is allocated beyond its amount`);
}

async function residentWithStay(db: AsyncDb, owner: AuthenticatedUser, checkInDate: string, rent = 6000) {
  const room = await createRoom(owner, { roomNumber: `P0${rnd()}`.toUpperCase(), floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: rent }, IP, db);
  const resident = await registerResident(owner, { fullName: `P0 Resident ${rnd()}`, phone: phone() }, IP, db);
  const stay = await assignResidentToRoom(owner, { residentId: resident.id, roomId: room.id, checkInDate, monthlyRent: rent }, IP, db);
  return { residentId: resident.id as string, stayId: stay.id as string };
}

async function main() {
  console.log("================================================================================");
  console.log("P0 FINANCIAL INTEGRITY (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  assert(db.isPostgres === true, "Service layer is running on PostgreSQL");

  const owner = await insertStaff(db, "SUPER_ADMIN", "P0 Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "P0 Manager");
  const day = uniqueBusinessDate(31);

  const customer = async (name: string) =>
    (await createTiffinCustomer(manager, { fullName: `${name} ${rnd()}`, phone: phone(), deliveryAddress: "Flat 9, P0 Block" }, IP, db)) as any;
  const tiffinInvoice = async (customerId: string, amount: number) =>
    (await createInvoice(owner, {
      invoiceCategory: "TIFFIN",
      customerId,
      invoiceType: "REGULAR_BILL",
      issueDate: day,
      dueDate: day,
      billingPeriod: `P0 tiffin ${rnd()}`,
      items: [{ description: "Tiffin", unitPrice: amount, quantity: 1 }],
      autoIssue: true,
    } as any, IP, db)) as any;
  const tiffinPayment = async (customerId: string, amount: number) =>
    (await recordTiffinPayment(owner, { customerId, amount, transactionDate: day, paymentMethod: "CASH" }, IP, db)).transaction;
  const unallocated = async (customerId: string) => (await getTiffinCustomerBalance(owner, customerId, db)).unallocatedPaymentAmount;

  // ---------------------------------------------------------------------------
  console.log("\n--- 1. Unallocated tiffin payments ---");
  const custA = await customer("P0 One Payment Two Invoices");
  const a1 = await tiffinInvoice(custA.id, 300);
  const a2 = await tiffinInvoice(custA.id, 200);
  const payA = await tiffinPayment(custA.id, 1000);
  await allocatePaymentToInvoice(owner, { invoiceId: a1.id, paymentTransactionId: payA.id, amount: 300 }, IP, db);
  await allocatePaymentToInvoice(owner, { invoiceId: a2.id, paymentTransactionId: payA.id, amount: 200 }, IP, db);
  const oldA = await oldUnallocated(db, custA.id);
  const newA = await unallocated(custA.id);
  console.log(`  reproduction: ₹1,000 paid, ₹300 + ₹200 allocated → old query ₹${oldA}, service ₹${newA}`);
  assert(newA === 500, `One payment across two invoices: unallocated ₹${newA} (expected ₹500; the old query gives ₹${oldA})`);

  const custB = await customer("P0 Two Payments One Invoice");
  const b1 = await tiffinInvoice(custB.id, 1000);
  const payB1 = await tiffinPayment(custB.id, 400);
  const payB2 = await tiffinPayment(custB.id, 700);
  await allocatePaymentToInvoice(owner, { invoiceId: b1.id, paymentTransactionId: payB1.id, amount: 400 }, IP, db);
  await allocatePaymentToInvoice(owner, { invoiceId: b1.id, paymentTransactionId: payB2.id, amount: 600 }, IP, db);
  assert((await unallocated(custB.id)) === 100, `Two payments to one invoice: unallocated ₹${await unallocated(custB.id)} (expected ₹100)`);

  const custC = await customer("P0 Partial And Full");
  const c1 = await tiffinInvoice(custC.id, 250);
  const c2 = await tiffinInvoice(custC.id, 250);
  const payC1 = await tiffinPayment(custC.id, 1000);
  const payC2 = await tiffinPayment(custC.id, 250);
  await allocatePaymentToInvoice(owner, { invoiceId: c1.id, paymentTransactionId: payC1.id, amount: 250 }, IP, db);
  await allocatePaymentToInvoice(owner, { invoiceId: c2.id, paymentTransactionId: payC2.id, amount: 250 }, IP, db);
  assert((await unallocated(custC.id)) === 750, `Partially (₹750 left) plus fully allocated (₹0 left): unallocated ₹${await unallocated(custC.id)} (expected ₹750)`);
  const payC3 = await tiffinPayment(custC.id, 600);
  assert((await unallocated(custC.id)) === 1350, "Unallocated payment of ₹600 adds to the free money (₹1,350)");
  await reverseTransaction(owner, payC3.id, "P0 test: wrong customer", IP, db);
  assert((await unallocated(custC.id)) === 750, `Reversed payment no longer counts: unallocated ₹${await unallocated(custC.id)} (expected ₹750)`);
  assert((await unallocated(custA.id)) === 500 && (await unallocated(custB.id)) === 100, "Other customers' balances are independent and unchanged");
  await invoiceInvariants(db, [a1.id, a2.id, b1.id, c1.id, c2.id], "Section 1");

  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Concurrent allocations ---");
  const ROUNDS = 5;
  let paymentRaceOk = true;
  let invoiceRaceOk = true;
  let fillRaceOk = true;
  const raceInvoices: string[] = [];
  for (let round = 0; round < ROUNDS; round++) {
    // (a) One payment, two invoices, 600 + 600 > 1000: at most 1000 may be allocated.
    const cust = await customer("P0 Race Payment");
    const i1 = await tiffinInvoice(cust.id, 800);
    const i2 = await tiffinInvoice(cust.id, 800);
    const pay = await tiffinPayment(cust.id, 1000);
    const r = settled(await Promise.allSettled([
      allocatePaymentToInvoice(owner, { invoiceId: i1.id, paymentTransactionId: pay.id, amount: 600 }, IP, db),
      allocatePaymentToInvoice(owner, { invoiceId: i2.id, paymentTransactionId: pay.id, amount: 600 }, IP, db),
    ]));
    const allocated = await num(db, "SELECT COALESCE(SUM(amount),0)::int AS n FROM invoice_payment_allocations WHERE payment_transaction_id = ?", [pay.id]);
    if (!(allocated === 600 && r.ok.length === 1 && r.errors.every((e) => !rawDbError(e)))) {
      paymentRaceOk = false;
      console.log(`  round ${round + 1} (payment): allocated ₹${allocated} of ₹1,000; ok=${r.ok.length}; ${r.errors.join(" | ")}`);
    }
    // Retry after the failed request: the remaining ₹400 is allocated normally.
    const target = r.ok.length === 1 && (r.ok[0] as any).invoice.id === i1.id ? i2 : i1;
    await allocatePaymentToInvoice(owner, { invoiceId: target.id, paymentTransactionId: pay.id, amount: 400 }, IP, db);
    raceInvoices.push(i1.id, i2.id);

    // (b) One invoice of 1000, two payments of 700, explicit 700 + 700 > 1000: at most 1000.
    const cust2 = await customer("P0 Race Invoice");
    const inv = await tiffinInvoice(cust2.id, 1000);
    const p1 = await tiffinPayment(cust2.id, 700);
    const p2 = await tiffinPayment(cust2.id, 700);
    const r2 = settled(await Promise.allSettled([
      allocatePaymentToInvoice(owner, { invoiceId: inv.id, paymentTransactionId: p1.id, amount: 700 }, IP, db),
      allocatePaymentToInvoice(owner, { invoiceId: inv.id, paymentTransactionId: p2.id, amount: 700 }, IP, db),
    ]));
    const onInvoice = await num(db, "SELECT COALESCE(SUM(amount),0)::int AS n FROM invoice_payment_allocations WHERE invoice_id = ?", [inv.id]);
    if (!(onInvoice === 700 && r2.ok.length === 1 && r2.errors.every((e) => !rawDbError(e)))) {
      invoiceRaceOk = false;
      console.log(`  round ${round + 1} (invoice): allocated ₹${onInvoice} of ₹1,000; ok=${r2.ok.length}; ${r2.errors.join(" | ")}`);
    }
    raceInvoices.push(inv.id);

    // (c) Same invoice, no amount given: each takes what is left; together exactly 1000.
    const cust3 = await customer("P0 Race Fill");
    const inv3 = await tiffinInvoice(cust3.id, 1000);
    const q1 = await tiffinPayment(cust3.id, 700);
    const q2 = await tiffinPayment(cust3.id, 700);
    const r3 = settled(await Promise.allSettled([
      allocatePaymentToInvoice(owner, { invoiceId: inv3.id, paymentTransactionId: q1.id }, IP, db),
      allocatePaymentToInvoice(owner, { invoiceId: inv3.id, paymentTransactionId: q2.id }, IP, db),
    ]));
    const filled = await db.queryOne<any>("SELECT amount_paid, status FROM invoices WHERE id = ?", [inv3.id]);
    const rows3 = await num(db, "SELECT COALESCE(SUM(amount),0)::int AS n FROM invoice_payment_allocations WHERE invoice_id = ?", [inv3.id]);
    if (!(r3.ok.length === 2 && Number(filled.amount_paid) === 1000 && rows3 === 1000 && filled.status === "PAID")) {
      fillRaceOk = false;
      console.log(`  round ${round + 1} (fill): ok=${r3.ok.length}; paid ₹${filled.amount_paid}; rows ₹${rows3}; ${filled.status}; ${r3.errors.join(" | ")}`);
    }
    raceInvoices.push(inv3.id);
  }
  assert(paymentRaceOk, `${ROUNDS} rounds: two simultaneous ₹600 allocations of one ₹1,000 payment → exactly one succeeds, ₹600 allocated, retry of the rest succeeds`);
  assert(invoiceRaceOk, `${ROUNDS} rounds: two simultaneous ₹700 allocations to one ₹1,000 invoice → exactly one succeeds, ₹700 allocated`);
  assert(fillRaceOk, `${ROUNDS} rounds: two simultaneous open-amount allocations fill a ₹1,000 invoice to exactly ₹1,000 (PAID)`);
  await invoiceInvariants(db, raceInvoices, "Section 2");

  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Rent month charged once ---");
  const residentInvoice = async (residentId: string, stayId: string, billingPeriod: string, amount = 6000) =>
    (await createInvoice(owner, {
      residentId, stayId, invoiceType: "REGULAR_BILL", issueDate: day, dueDate: day, billingPeriod,
      items: [{ description: "Monthly rent", unitPrice: amount, quantity: 1 }],
    } as any, IP, db)) as any;
  const rentCharges = (residentId: string) =>
    num(db, "SELECT COUNT(*)::int AS n FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'RENT_CHARGE' AND status = 'POSTED'", [residentId]);
  const tryIssue = async (id: string) => {
    try {
      return { ok: true, inv: await issueInvoice(owner, id, undefined, IP, db), error: "" };
    } catch (e: any) {
      return { ok: false, inv: null, error: String(e.message) };
    }
  };

  const linkedTo = (residentId: string) =>
    db.query<any>("SELECT invoice_id FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'RENT_CHARGE' AND status = 'POSTED' ORDER BY created_at", [residentId]);

  // The month already charged (e.g. by the rent run as "November 2041"), invoiced as "Nov 2041".
  const r1 = await residentWithStay(db, owner, day);
  await recordRentCharge(owner, { residentId: r1.residentId, stayId: r1.stayId, amount: 6000, transactionDate: day, billingPeriod: "November 2041" }, IP, db);
  const shortName = await tryIssue((await residentInvoice(r1.residentId, r1.stayId, "Nov 2041")).id);
  const r1Links = await linkedTo(r1.residentId);
  assert(shortName.ok && r1Links.length === 1 && r1Links[0].invoice_id === shortName.inv!.id,
    `"Nov 2041" invoice links the existing "November 2041" charge: ${r1Links.length} rent charge(s) (expected 1) ${shortName.error}`);
  // Every other spelling of the same month links the existing charge too (one resident each).
  for (const spelling of ["  november   2041 ", "NOVEMBER-2041", "2041-11", "11/2041", "Nov. 2041"]) {
    const r = await residentWithStay(db, owner, day);
    await recordRentCharge(owner, { residentId: r.residentId, stayId: r.stayId, amount: 6000, transactionDate: day, billingPeriod: "November 2041" }, IP, db);
    const res = await tryIssue((await residentInvoice(r.residentId, r.stayId, spelling)).id);
    const links = await linkedTo(r.residentId);
    assert(res.ok && links.length === 1 && links[0].invoice_id === res.inv!.id, `"${spelling}" links the November charge instead of charging again (${links.length} charge)`);
  }
  const again = await tryIssue(shortName.inv!.id);
  assert(!again.ok && (await rentCharges(r1.residentId)) === 1, "Issuing the same invoice again is refused and adds no charge");

  // Same draft issued twice at the same moment: one issue, one charge, one number.
  const r2 = await residentWithStay(db, owner, day);
  const twice = await residentInvoice(r2.residentId, r2.stayId, "Dec 2041");
  const sameDraft = settled(await Promise.allSettled([issueInvoice(owner, twice.id, undefined, IP, db), issueInvoice(owner, twice.id, undefined, IP, db)]));
  assert(sameDraft.ok.length === 1 && (await rentCharges(r2.residentId)) === 1 && sameDraft.errors.every((e) => !rawDbError(e)),
    `Same draft issued twice at once: ${sameDraft.ok.length} issued, ${await rentCharges(r2.residentId)} charge (${sameDraft.errors.join(" | ")})`);

  // Two drafts for the same month issued at once, one unbilled charge: it is linked to one invoice only.
  const r3 = await residentWithStay(db, owner, day);
  await recordRentCharge(owner, { residentId: r3.residentId, stayId: r3.stayId, amount: 6000, transactionDate: day, billingPeriod: "January 2042" }, IP, db);
  const d1 = await residentInvoice(r3.residentId, r3.stayId, "Jan 2042");
  const d2 = await residentInvoice(r3.residentId, r3.stayId, "january 2042");
  const twoDrafts = settled(await Promise.allSettled([issueInvoice(owner, d1.id, undefined, IP, db), issueInvoice(owner, d2.id, undefined, IP, db)]));
  const original = (await db.queryOne<any>(
    "SELECT invoice_id FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'RENT_CHARGE' AND billing_period = 'January 2042'", [r3.residentId]));
  const linkedInvoices = await num(db, "SELECT COUNT(*)::int AS n FROM invoices WHERE id IN (?, ?) AND rent_charge_id = (SELECT id FROM financial_transactions WHERE resident_id = ? AND billing_period = 'January 2042')", [d1.id, d2.id, r3.residentId]);
  assert(twoDrafts.ok.length === 2 && [d1.id, d2.id].includes(original.invoice_id) && linkedInvoices === 1 && twoDrafts.errors.every((e) => !rawDbError(e)),
    `Two drafts for one month issued at once: the existing charge is linked to exactly one invoice (${linkedInvoices}); the other posts its own charge as before (${await rentCharges(r3.residentId)} charges)`);

  // Different residents, same month; same resident, different months; a different amount in a month.
  const r4 = await residentWithStay(db, owner, day);
  const r5 = await residentWithStay(db, owner, day);
  for (const r of [r4, r5]) await recordRentCharge(owner, { residentId: r.residentId, stayId: r.stayId, amount: 6000, transactionDate: day, billingPeriod: "February 2042" }, IP, db);
  await tryIssue((await residentInvoice(r4.residentId, r4.stayId, "Feb 2042")).id);
  await tryIssue((await residentInvoice(r5.residentId, r5.stayId, "2042-02")).id);
  assert((await rentCharges(r4.residentId)) === 1 && (await rentCharges(r5.residentId)) === 1, "Different residents, same month: each links its own charge (one charge each)");
  await tryIssue((await residentInvoice(r4.residentId, r4.stayId, "Mar 2042")).id);
  assert((await rentCharges(r4.residentId)) === 2, "Same resident, a different month: a new charge for that month");
  await tryIssue((await residentInvoice(r4.residentId, r4.stayId, "Feb 2042", 1500)).id);
  assert((await rentCharges(r4.residentId)) === 3, "A different amount in an already-charged month (e.g. maintenance) posts its own charge, as before");
  await tryIssue((await residentInvoice(r5.residentId, r5.stayId, "P0 deposit top-up")).id);
  assert((await rentCharges(r5.residentId)) === 2, "A non-month period is still charged as before");

  // The monthly rent run sees a hand-entered "Nov 2026" charge dated outside the month.
  const r6 = await residentWithStay(db, owner, "2026-10-01");
  await recordRentCharge(owner, { residentId: r6.residentId, stayId: r6.stayId, amount: 6000, transactionDate: "2026-10-30", billingPeriod: "Nov 2026" }, IP, db);
  const preview = await previewMonthlyRent(owner, "2026-11", db);
  const line = preview.lines.find((l) => l.stayId === r6.stayId);
  assert(line?.status === "MANUAL_CHARGE_EXISTS", `Rent run: a "Nov 2026" charge marks November as already charged (status ${line?.status})`);

  // ---------------------------------------------------------------------------
  console.log("\n--- 4 & 5. Delivery collections ---");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "P0 Driver");
  const product = await createTiffinProduct(owner, { code: `P0_${rnd()}`.toUpperCase(), name: "P0 Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 100 } as any, undefined, db);
  const deliveredOrder = async (collected: number, method: "CASH" | "UPI") => {
    const order: any = await createUnifiedOrder(manager, {
      orderType: "DELIVERY", customerName: `P0 Order ${rnd()}`, customerPhone: phone(), deliveryAddress: "P0 Lane",
      serviceDate: day, mealType: "LUNCH", items: [{ productId: product.id, productName: "P0 Thali", quantity: 3, unitPrice: 100 }],
      idempotencyKey: `p0ord_${rnd()}`,
    } as any, IP, db);
    await db.execute("UPDATE delivery_tasks SET assigned_to = ?, assigned_to_name = ? WHERE id = ?", [driver.id, driver.fullName, order.deliveryTaskId]);
    const item = await db.queryOne<any>("SELECT id FROM order_items WHERE order_id = ?", [order.orderId]);
    await completeDeliveryTask(driver, order.deliveryTaskId, {
      recipientName: "Customer", collectedAmount: collected, paymentMethod: method, idempotencyKey: `p0col_${rnd()}`,
      lines: [{ orderItemId: item.id, deliveredQuantity: 3, undeliveredQuantity: 0 }],
    }, IP, db);
    return order.deliveryTaskId as string;
  };
  const taskMoney = async (taskId: string) => {
    const t = (await getDeliveryTaskById(owner, taskId, db))!.task as any;
    const stored = await db.queryOne<any>("SELECT collected_amount, collection_status FROM delivery_tasks WHERE id = ?", [taskId]);
    return { collected: Number(t.collectedAmount), balance: Number(t.balanceDue), stored: Number(stored.collected_amount), status: stored.collection_status };
  };
  const upiEntry = (taskId: string, amount: number) =>
    db.queryOne<any>(
      `SELECT f.id FROM delivery_collections dc JOIN financial_transactions f ON f.id = dc.transaction_id
       WHERE dc.delivery_task_id = ? AND dc.amount = ? AND f.status = 'POSTED' ORDER BY dc.collected_at LIMIT 1`,
      [taskId, amount]
    );
  const custodyOf = async (staffId: string) => {
    const r = (await listStaffCustody(owner, db)).staff.find((x) => x.staffId === staffId);
    return { cashCollected: Number(r?.cashCollected ?? 0), cashPending: Number(r?.cashPending ?? 0), upiCollected: Number(r?.upiCollected ?? 0) };
  };

  // 4a. Full UPI payment at the door, then reversed.
  const fullTask = await deliveredOrder(300, "UPI");
  assert((await taskMoney(fullTask)).balance === 0, "Paid in full by UPI: balance ₹0");
  const custodyBefore = await custodyOf(driver.id);
  const fullEntry = await upiEntry(fullTask, 300);
  await reverseTransaction(owner, fullEntry.id, "P0 test: UPI did not arrive", IP, db);
  const afterFull = await taskMoney(fullTask);
  assert(afterFull.collected === 0 && afterFull.balance === 300 && afterFull.stored === 0 && afterFull.status === "NONE",
    `Full payment reversed: collected ₹${afterFull.collected}, balance ₹${afterFull.balance}, stored ₹${afterFull.stored}, ${afterFull.status} (expected 0 / 300 / 0 / NONE)`);
  let repeat: any = null;
  try { await reverseTransaction(owner, fullEntry.id, "P0 test: second attempt", IP, db); } catch (e) { repeat = e; }
  assert(repeat !== null && (await taskMoney(fullTask)).balance === 300, "Second reversal of the same entry is refused; balance unchanged");
  const custodyAfter = await custodyOf(driver.id);
  assert(custodyAfter.cashCollected === custodyBefore.cashCollected && custodyAfter.cashPending === custodyBefore.cashPending,
    `Cash custody unchanged by a UPI reversal (collected ₹${custodyAfter.cashCollected}, held ₹${custodyAfter.cashPending})`);
  assert(custodyAfter.upiCollected === custodyBefore.upiCollected - 300,
    `The reversed ₹300 no longer counts as UPI collected (₹${custodyBefore.upiCollected} → ₹${custodyAfter.upiCollected})`);

  // 4b. Partial at the door (₹100 UPI), later ₹50 UPI and ₹50 cash; reverse the later ₹50 UPI.
  const partTask = await deliveredOrder(100, "UPI");
  await recordDeliveryCollection(manager, partTask, { collectedAmount: 50, paymentMethod: "UPI", idempotencyKey: `p0b_${rnd()}` }, IP, db);
  await recordDeliveryCollection(manager, partTask, { collectedAmount: 50, paymentMethod: "CASH", idempotencyKey: `p0b_${rnd()}` }, IP, db);
  assert((await taskMoney(partTask)).balance === 100, "₹200 of ₹300 collected: balance ₹100");
  await reverseTransaction(owner, (await upiEntry(partTask, 50)).id, "P0 test: duplicate UPI", IP, db);
  const afterPart = await taskMoney(partTask);
  assert(afterPart.collected === 150 && afterPart.balance === 150 && afterPart.stored === 150 && afterPart.status === "COLLECTED",
    `One of three collections reversed: collected ₹${afterPart.collected}, balance ₹${afterPart.balance} (expected 150 / 150); others untouched`);
  await recordDeliveryCollection(manager, partTask, { collectedAmount: 150, paymentMethod: "UPI", idempotencyKey: `p0b_${rnd()}` }, IP, db);
  const settledPart = await taskMoney(partTask);
  assert(settledPart.balance === 0 && settledPart.collected === 300, "After the reversal the real remaining ₹150 can be collected; order fully paid");
  let overAfter: any = null;
  try { await recordDeliveryCollection(manager, partTask, { collectedAmount: 1, paymentMethod: "CASH", idempotencyKey: `p0b_${rnd()}` }, IP, db); } catch (e) { overAfter = e; }
  assert(overAfter !== null, "Nothing more can be collected once valid collections cover the order");

  // 4c. A cash handover entry (several collections) cannot be reversed from the cashbook.
  const handDriver = await insertStaff(db, "DELIVERY_PERSON", "P0 Handover Driver");
  const handOrder: any = await createUnifiedOrder(manager, {
    orderType: "DELIVERY", customerName: `P0 Handover ${rnd()}`, customerPhone: phone(), deliveryAddress: "P0 Lane",
    serviceDate: day, mealType: "DINNER", items: [{ productId: product.id, productName: "P0 Thali", quantity: 1, unitPrice: 100 }],
    idempotencyKey: `p0ord_${rnd()}`,
  } as any, IP, db);
  await db.execute("UPDATE delivery_tasks SET assigned_to = ?, assigned_to_name = ? WHERE id = ?", [handDriver.id, handDriver.fullName, handOrder.deliveryTaskId]);
  const handItem = await db.queryOne<any>("SELECT id FROM order_items WHERE order_id = ?", [handOrder.orderId]);
  await completeDeliveryTask(handDriver, handOrder.deliveryTaskId, {
    recipientName: "Customer", collectedAmount: 100, paymentMethod: "CASH", idempotencyKey: `p0col_${rnd()}`,
    lines: [{ orderItemId: handItem.id, deliveredQuantity: 1, undeliveredQuantity: 0 }],
  }, IP, db);
  const handover = await createCashHandoverDeclaration(handDriver, { shiftDate: day, declaredCash: 100 }, IP, db);
  await acceptCashHandover(owner, handover.id, { acceptedCash: 100 }, IP, db);
  const lump = await db.queryOne<any>("SELECT transaction_id FROM driver_cash_handovers WHERE id = ?", [handover.id]);
  let lumpError: any = null;
  try { await reverseTransaction(owner, lump.transaction_id, "P0 test: handover reversal", IP, db); } catch (e) { lumpError = e; }
  const lumpRow = await db.queryOne<any>("SELECT status FROM financial_transactions WHERE id = ?", [lump.transaction_id]);
  assert(lumpError !== null && lumpRow.status === "POSTED" && (await taskMoney(handOrder.deliveryTaskId)).balance === 0,
    `A cash handover entry is not reversed from the cashbook (status ${lumpRow.status}; ${lumpError?.message ?? "no error"})`);

  // 5. "Collect balance": one key = one collection.
  const keyTask = await deliveredOrder(0, "CASH");
  const collections = (taskId: string) => num(db, "SELECT COUNT(*)::int AS n FROM delivery_collections WHERE delivery_task_id = ?", [taskId]);
  const key = `bal_${rnd()}`;
  const dup = settled(await Promise.allSettled(
    Array.from({ length: 5 }, () => recordDeliveryCollection(manager, keyTask, { collectedAmount: 100, paymentMethod: "CASH", idempotencyKey: key }, IP, db))
  ));
  assert(dup.ok.length === 5 && (await collections(keyTask)) === 1 && dup.errors.every((e) => !rawDbError(e)),
    `Five simultaneous identical requests (one key): ${await collections(keyTask)} collection, ${dup.ok.length} answered (${dup.errors.join(" | ") || "no errors"})`);
  await recordDeliveryCollection(manager, keyTask, { collectedAmount: 100, paymentMethod: "CASH", idempotencyKey: key }, IP, db);
  await recordDeliveryCollection(manager, keyTask, { collectedAmount: 100, paymentMethod: "CASH", idempotencyKey: key }, IP, db);
  assert((await collections(keyTask)) === 1 && (await taskMoney(keyTask)).balance === 200, "Repeated identical requests and a retry after an interrupted response: still one collection, balance ₹200");
  let mismatch: any = null;
  try { await recordDeliveryCollection(manager, keyTask, { collectedAmount: 150, paymentMethod: "CASH", idempotencyKey: key }, IP, db); } catch (e) { mismatch = e; }
  assert(mismatch !== null && (await collections(keyTask)) === 1, "The same key with a different amount is refused, not recorded");
  await recordDeliveryCollection(manager, keyTask, { collectedAmount: 50, paymentMethod: "UPI", idempotencyKey: `bal_${rnd()}` }, IP, db);
  assert((await collections(keyTask)) === 2 && (await taskMoney(keyTask)).balance === 150, "A new collection with a new key after the first completed is recorded (balance ₹150)");
  const indep = settled(await Promise.allSettled([
    recordDeliveryCollection(manager, keyTask, { collectedAmount: 50, paymentMethod: "CASH", idempotencyKey: `bal_${rnd()}` }, IP, db),
    recordDeliveryCollection(owner, keyTask, { collectedAmount: 50, paymentMethod: "CASH", idempotencyKey: `bal_${rnd()}` }, IP, db),
  ]));
  assert(indep.ok.length === 2 && (await collections(keyTask)) === 4 && (await taskMoney(keyTask)).balance === 50, "Two independent collections at once (different keys) are both recorded (balance ₹50)");
  const overRace = settled(await Promise.allSettled([
    recordDeliveryCollection(manager, keyTask, { collectedAmount: 50, paymentMethod: "CASH", idempotencyKey: `bal_${rnd()}` }, IP, db),
    recordDeliveryCollection(owner, keyTask, { collectedAmount: 50, paymentMethod: "CASH", idempotencyKey: `bal_${rnd()}` }, IP, db),
  ]));
  assert(overRace.ok.length === 1 && (await taskMoney(keyTask)).balance === 0 && overRace.errors.every((e) => !rawDbError(e)),
    `Two simultaneous ₹50 collections against a ₹50 balance: ${overRace.ok.length} recorded, balance ₹${(await taskMoney(keyTask)).balance}`);

  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Reversing an allocated payment keeps its history ---");
  const custH = await customer("P0 History");
  const h1 = await tiffinInvoice(custH.id, 300);
  const h2 = await tiffinInvoice(custH.id, 200);
  const payH = await tiffinPayment(custH.id, 500);
  await allocatePaymentToInvoice(owner, { invoiceId: h1.id, paymentTransactionId: payH.id, amount: 300 }, IP, db);
  await allocatePaymentToInvoice(owner, { invoiceId: h2.id, paymentTransactionId: payH.id, amount: 200 }, IP, db);
  await reverseTransaction(owner, payH.id, "P0 test: cheque bounced", IP, db);
  const kept = await num(db, "SELECT COUNT(*)::int AS n FROM invoice_payment_allocations WHERE payment_transaction_id = ?", [payH.id]);
  assert(kept === 2, `Both allocation rows are kept after the reversal (${kept} of 2)`);
  const viewH1: any = await getInvoiceById(owner, h1.id, db);
  const viewH2: any = await getInvoiceById(owner, h2.id, db);
  assert(viewH1.amountPaid === 0 && viewH1.balanceDue === 300 && viewH1.status === "ISSUED" && viewH2.amountPaid === 0 && viewH2.status === "ISSUED",
    `Invoices are unpaid again (₹${viewH1.amountPaid}/₹${viewH1.balanceDue} ${viewH1.status}; ₹${viewH2.amountPaid} ${viewH2.status})`);
  assert(viewH1.allocations?.length === 1 && viewH1.allocations[0].paymentReversed === true,
    `The invoice still lists the allocation, marked as a reversed payment (${JSON.stringify(viewH1.allocations?.map((a: any) => a.paymentReversed))})`);
  let repeatH: any = null;
  try { await reverseTransaction(owner, payH.id, "P0 test: again", IP, db); } catch (e) { repeatH = e; }
  const afterRepeat: any = await getInvoiceById(owner, h1.id, db);
  assert(repeatH !== null && afterRepeat.balanceDue === 300 && afterRepeat.amountPaid === 0, "A repeated reversal is refused and changes no invoice");
  assert((await unallocated(custH.id)) === 0, "The reversed payment adds nothing to the customer's unallocated money");
  const payH2 = await tiffinPayment(custH.id, 300);
  await allocatePaymentToInvoice(owner, { invoiceId: h1.id, paymentTransactionId: payH2.id }, IP, db);
  const reallocated: any = await getInvoiceById(owner, h1.id, db);
  assert(reallocated.amountPaid === 300 && reallocated.status === "PAID" && reallocated.allocations.length === 2,
    `A new payment settles the invoice; history shows both allocations (₹${reallocated.amountPaid}, ${reallocated.status}, ${reallocated.allocations.length} rows)`);
  await invoiceInvariants(db, [h1.id, h2.id], "Section 6");

  console.log("\n================================================================================");
  console.log(`P0 FINANCIAL INTEGRITY RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
