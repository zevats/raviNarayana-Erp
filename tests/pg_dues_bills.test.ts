/**
 * Dues, bills and payments, as one flow (owner decisions of 2026-11-11):
 *   - a monthly plan owes its full price for every month it runs, with no thali taken and nobody
 *     "billing" it;
 *   - a bill is a copy of the dues: making one (or several) changes nothing that is owed;
 *   - a payment settles the oldest dues first, can name the bill it was paid against, and can
 *     never be more than what is owed;
 *   - the same flow serves tiffin customers and PG residents.
 * Every step checks the amounts against the ledger. Disposable local database only.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createRoom } from "../apps/erp/src/server/rooms/roomService";
import { registerResident, assignResidentToRoom } from "../apps/erp/src/server/residents/residentService";
import { recordRentCharge, getResidentRentBalance, getBusinessDateString } from "../apps/erp/src/server/finance/financeService";
import { createTiffinCustomer, createTiffinProduct, createTiffinSubscription, cancelTiffinSubscription } from "../apps/erp/src/server/tiffin/tiffinService";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import { completeDeliveryTask } from "../apps/erp/src/server/delivery/deliveryService";
import { prepareDeliveryManifest, setResidentRoomDelivery } from "../apps/erp/src/server/delivery/deliveryOps";
import { recordOtherReceipt } from "../apps/erp/src/server/finance/otherReceiptService";
import { editTransaction } from "../apps/erp/src/server/finance/entryEditService";
import { recordExpense, getCashbookSummary } from "../apps/erp/src/server/finance/financeService";
import { assignDeliveryTask } from "../apps/erp/src/server/delivery/deliveryService";
import { listReceivables, getReceivableAccount, getAccountStatement, receiveAccountPayment, spreadOldestFirst } from "../apps/erp/src/server/finance/receivablesService";
import { ensurePlanCharges, planMonthStart, planMonthEnd } from "../apps/erp/src/server/tiffin/planCharges";
import { createBill, listBills, getBill, getBillByToken, BUSINESS_GSTIN } from "../apps/erp/src/server/finance/billService";
import { loadCustomerBalancesById } from "../apps/erp/src/server/tiffin/customerBalance";
import { rupeesInWords, splitInclusiveGst, financialYear } from "../apps/erp/src/lib/bills";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
// Plan months are charged from this day on (production default 2026-11-01).
process.env.ERP_PLAN_CHARGES_FROM = "2000-01-01";
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
async function refused(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e: any) {
    return String(e?.message ?? e);
  }
}
async function num(db: AsyncDb, sql: string, params: any[] = []) {
  const r = await db.queryOne<any>(sql, params);
  return Number(r?.n ?? 0);
}

async function main() {
  console.log("================================================================================");
  console.log("DUES, BILLS, PAYMENTS: ONE FLOW (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  assert(db.isPostgres === true, "Service layer is running on PostgreSQL");
  const owner = await insertStaff(db, "SUPER_ADMIN", "D4 Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "D4 Manager");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "D4 Driver");
  const today = getBusinessDateString(new Date());
  const plan2 = await createTiffinProduct(owner, { code: `D4P2_${rnd()}`.toUpperCase(), name: "Monthly plan · Lunch + Dinner", category: "SUBSCRIPTION_PACKAGE", billingUnit: "PER_MONTH", price: 3500 } as any, undefined, db);
  const plan1 = await createTiffinProduct(owner, { code: `D4P1_${rnd()}`.toUpperCase(), name: "Monthly plan · 1 thali", category: "SUBSCRIPTION_PACKAGE", billingUnit: "PER_MONTH", price: 2000 } as any, undefined, db);
  const thali = await createTiffinProduct(owner, { code: `D4T_${rnd()}`.toUpperCase(), name: "D4 Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 100 } as any, undefined, db);
  const customer = async (name: string, extra: Record<string, any> = {}) =>
    (await createTiffinCustomer(manager, { fullName: `${name} ${rnd()}`, phone: phone(), deliveryAddress: "D4 Lane, Sector 4", ...extra } as any, IP, db)) as any;
  const total = async (key: string) => (await getReceivableAccount(owner, key, db)).totals.total;
  const ledger = async (customerId: string) =>
    num(db, "SELECT COALESCE(SUM(CASE WHEN transaction_type = 'TIFFIN_CHARGE' THEN amount ELSE -amount END), 0) AS n FROM financial_transactions WHERE customer_id = ? AND status = 'POSTED' AND transaction_type IN ('TIFFIN_CHARGE', 'TIFFIN_PAYMENT')", [customerId]);

  // ---------------------------------------------------------------------------
  console.log("\n--- 1. Plan months ---");
  assert(planMonthStart("2026-11-15", 0) === "2026-11-15" && planMonthStart("2026-11-15", 1) === "2026-12-15" && planMonthEnd("2026-11-15", 0) === "2026-12-14", "A plan started on 15 Nov runs 15 Nov – 14 Dec, then from 15 Dec");
  assert(planMonthStart("2026-01-31", 1) === "2026-02-28" && planMonthStart("2026-01-31", 2) === "2026-03-31" && planMonthEnd("2026-01-31", 0) === "2026-02-27", "A start on the 31st uses the last day of a shorter month");
  assert(planMonthStart("2026-12-05", 1) === "2027-01-05", "Months roll over the year");
  process.env.ERP_PLAN_CHARGES_FROM = addDays(today, 1);
  const f0 = await customer("D4 Plan Before Floor");
  await createTiffinSubscription(manager, { customerId: f0.id, productId: plan2.id, startDate: today, mealTypes: "BOTH", serviceDays: "ALL_DAYS", quantityPerMeal: 1, deliveryAddress: "D4 Lane, Sector 4" } as any, IP, db);
  assert((await total(`C:${f0.id}`)) === 0, "A plan month that started before the go-live day is not charged by itself");
  process.env.ERP_PLAN_CHARGES_FROM = "2000-01-01";
  const late = await ensurePlanCharges(db, owner, { subscriptionId: (await db.queryOne<any>("SELECT id FROM tiffin_subscriptions WHERE customer_id = ?", [f0.id])).id });
  assert(late === 1 && (await total(`C:${f0.id}`)) === 3500, "Once the day is reached the month is charged once");

  // ---------------------------------------------------------------------------
  console.log("\n--- 2. A plan owes its monthly price with no thali taken ---");
  const a = await customer("D4 Plan Today");
  const A = `C:${a.id}`;
  const subA: any = await createTiffinSubscription(manager, { customerId: a.id, productId: plan2.id, startDate: today, mealTypes: "BOTH", serviceDays: "ALL_DAYS", quantityPerMeal: 1, deliveryAddress: "D4 Lane, Sector 4" } as any, IP, db);
  assert((await total(A)) === 3500, `Plan started today: ₹3,500 is due at once, nothing delivered (₹${await total(A)})`);
  delete process.env.ERP_PLAN_AUTO_DELIVERY;
  await prepareDeliveryManifest(owner, { serviceDate: today, mealType: "LUNCH", trigger: "MANUAL" }, IP, db).catch(() => null);
  await prepareDeliveryManifest(owner, { serviceDate: today, mealType: "DINNER", trigger: "MANUAL" }, IP, db).catch(() => null);
  assert((await num(db, "SELECT COUNT(*) AS n FROM delivery_tasks WHERE subscription_id = ?", [subA.id])) === 0, "Preparing today's lunch and dinner lists adds no stop for the plan (plan thalis go out as orders)");
  assert((await ensurePlanCharges(db, owner)) === 0 || (await total(A)) === 3500, "Checking again adds nothing for this plan");
  assert((await total(A)) === 3500 && (await ledger(a.id)) === 3500, "Dues equal the tiffin ledger (₹3,500)");

  const b = await customer("D4 Plan Backdated");
  const B = `C:${b.id}`;
  const startB = addDays(today, -40);
  const subB: any = await createTiffinSubscription(manager, { customerId: b.id, productId: plan1.id, startDate: startB, mealTypes: "ANY", serviceDays: "ALL_DAYS", quantityPerMeal: 1, deliveryAddress: "D4 Lane, Sector 4" } as any, IP, db);
  const monthsB = planMonthStart(startB, 1) <= today ? 2 : 1;
  assert((await total(B)) === 2000 * monthsB, `Plan started 40 days ago: ${monthsB} months are due (₹${await total(B)})`);
  const accB = await getReceivableAccount(owner, B, db);
  assert(accB.lines.every((l) => l.source === "TIFFIN" && l.description.startsWith("Monthly plan")) && accB.lines[0].date === startB, "Each month is its own due, dated the day that month started");
  const again = await Promise.all([ensurePlanCharges(db, owner, { subscriptionId: subB.id }), ensurePlanCharges(db, manager, { subscriptionId: subB.id }), ensurePlanCharges(db, owner, { subscriptionId: subB.id })]);
  assert(again.every((x) => x === 0) && (await total(B)) === 2000 * monthsB, "Three checks at once add nothing: a month is charged once");
  const nextMonth = planMonthStart(startB, monthsB);
  const addedLater = await ensurePlanCharges(db, owner, { subscriptionId: subB.id, today: nextMonth });
  assert(addedLater === 1 && (await total(B)) === 2000 * (monthsB + 1), `On the day the next month starts (${nextMonth}) one more month is due`);

  const c = await customer("D4 Plan Future");
  await createTiffinSubscription(manager, { customerId: c.id, productId: plan2.id, startDate: addDays(today, 5), mealTypes: "BOTH", serviceDays: "ALL_DAYS", quantityPerMeal: 1, deliveryAddress: "D4 Lane, Sector 4" } as any, IP, db);
  assert((await total(`C:${c.id}`)) === 0, "A plan that starts in 5 days owes nothing yet");

  const e = await customer("D4 Plan Ended");
  const subE: any = await createTiffinSubscription(manager, { customerId: e.id, productId: plan2.id, startDate: today, mealTypes: "BOTH", serviceDays: "ALL_DAYS", quantityPerMeal: 1, deliveryAddress: "D4 Lane, Sector 4" } as any, IP, db);
  await cancelTiffinSubscription(manager, subE.id, { cancellationReason: "D4 test: customer left" } as any, IP, db);
  const afterEnd = await ensurePlanCharges(db, owner, { subscriptionId: subE.id, today: planMonthStart(today, 2) });
  assert(afterEnd === 0 && (await total(`C:${e.id}`)) === 3500, "An ended plan keeps what it owes (₹3,500) and is never charged again");

  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Bills are copies: dues stay until money is received ---");
  const bill1 = await createBill(manager, { accountKey: B, type: "NON_GST" }, IP, db);
  const dueB = 2000 * (monthsB + 1);
  assert(bill1.total === dueB && bill1.snapshot.lines.reduce((s, l) => s + l.due, 0) === dueB, `Bill ${bill1.billNumber}: total ₹${bill1.total} is exactly the dues, line by line`);
  assert((await total(B)) === dueB, "After billing the dues are unchanged");
  assert(bill1.billNumber.startsWith(`RNB/${financialYear(today)}/`) && bill1.snapshot.company.gstin === null && bill1.cgst === 0 && bill1.taxable === dueB, "A non-GST bill has its own number series, no GSTIN and no tax");
  assert(bill1.snapshot.lines[0].label === "Monthly plan · 1 thali" && bill1.snapshot.lines[0].detail.includes("–"), `Lines name the plan and its period (${bill1.snapshot.lines[0].label}: ${bill1.snapshot.lines[0].detail})`);
  assert(bill1.snapshot.amountInWords === rupeesInWords(dueB) && bill1.snapshot.recipient.name === b.fullName, "The bill carries the customer and the amount in words");
  const bill2 = await createBill(owner, { accountKey: B, type: "GST", gstRate: 5 }, IP, db);
  assert(bill2.total === dueB && (await total(B)) === dueB, "A second bill for the same dues is allowed and changes nothing");
  assert(Math.round((bill2.taxable + bill2.cgst + bill2.sgst) * 100) === dueB * 100 && bill2.cgst > 0 && Math.abs(bill2.cgst - bill2.sgst) < 0.011, `GST bill: taxable ₹${bill2.taxable} + CGST ₹${bill2.cgst} + SGST ₹${bill2.sgst} = ₹${dueB} exactly`);
  assert(bill2.billNumber.startsWith(`RN/${financialYear(today)}/`) && bill2.snapshot.company.gstin === BUSINESS_GSTIN, `GST bill ${bill2.billNumber} carries GSTIN ${bill2.snapshot.company.gstin}`);
  const bill3 = await createBill(owner, { accountKey: B, type: "GST", gstRate: 5 }, IP, db);
  const seq = (s: string) => Number(s.split("/").pop());
  assert(seq(bill3.billNumber) === seq(bill2.billNumber) + 1, "GST bill numbers run without a gap");
  const parallel = await Promise.all([createBill(owner, { accountKey: A, type: "NON_GST" }, IP, db), createBill(manager, { accountKey: A, type: "NON_GST" }, IP, db), createBill(owner, { accountKey: A, type: "NON_GST" }, IP, db)]);
  assert(new Set(parallel.map((x) => x.billNumber)).size === 3, "Three bills made at the same moment get three different numbers");
  assert((await refused(() => createBill(owner, { accountKey: `C:${c.id}`, type: "NON_GST" }, IP, db)))?.includes("owes nothing") === true, "An account that owes nothing cannot be billed");
  assert((await refused(() => createBill(driver, { accountKey: B, type: "NON_GST" }, IP, db))) !== null, "Delivery staff cannot make bills");
  const viaLink = await getBillByToken(bill1.token, db);
  assert(viaLink?.billNumber === bill1.billNumber && viaLink.total === dueB && (await getBillByToken("not-a-real-token-000000000", db)) === null, "The share link opens exactly that bill; a wrong link opens nothing");
  const kept = await listBills(owner, { accountKey: B }, db);
  assert(kept.total === 3 && kept.bills[0].billNumber === bill3.billNumber && kept.amount === dueB * 3, "Every bill is kept on record, newest first");
  for (const [amt, r] of [[3500, 5], [2000, 5], [100, 18], [999, 12], [1, 5]] as const) {
    const s = splitInclusiveGst(amt, r);
    assert(Math.round((s.taxable + s.cgst + s.sgst) * 100) === amt * 100, `GST inside ₹${amt} at ${r}% adds back to ₹${amt} exactly`);
  }
  assert(rupeesInWords(3500) === "Rupees Three Thousand Five Hundred Only" && rupeesInWords(125000) === "Rupees One Lakh Twenty Five Thousand Only" && rupeesInWords(19) === "Rupees Nineteen Only", "Amounts in words");

  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Payments settle the oldest dues first ---");
  const key1 = `d4_${crypto.randomUUID()}`;
  const pay1 = await receiveAccountPayment(manager, { accountKey: B, paymentMethod: "CASH", amountReceived: 2500, idempotencyKey: key1, billNumber: bill1.billNumber } as any, IP, db);
  const afterPay1 = await getReceivableAccount(owner, B, db);
  assert(pay1.amountReceived === 2500 && afterPay1.totals.total === dueB - 2500, `₹2,500 received: dues fall from ₹${dueB} to ₹${afterPay1.totals.total}`);
  assert(afterPay1.lines[0].outstanding === 1500 && afterPay1.lines[0].paid === 500 && afterPay1.lines[0].date === planMonthStart(startB, 1), "The oldest month is paid in full first, the rest goes to the next month");
  assert((await ledger(b.id)) === dueB - 2500, "Dues equal the tiffin ledger after the payment");
  const st = await getAccountStatement(owner, B, {}, db);
  assert(st.closing === dueB - 2500 && st.totals.payments === 2500, `Statement closes at ₹${st.closing}`);
  const again1 = await receiveAccountPayment(manager, { accountKey: B, paymentMethod: "CASH", amountReceived: 2500, idempotencyKey: key1, billNumber: bill1.billNumber } as any, IP, db);
  assert(again1.amountReceived === 2500 && (await total(B)) === dueB - 2500, "The same payment sent twice is recorded once");
  assert((await refused(() => receiveAccountPayment(manager, { accountKey: B, paymentMethod: "UPI", amountReceived: 2500, idempotencyKey: key1 } as any, IP, db)))?.includes("already recorded") === true, "The same reference with a different method is refused");
  const withBill = await getBill(owner, bill1.billNumber, db);
  assert(withBill.received.length === 1 && withBill.received[0].amount === 2500 && withBill.total === dueB, "The bill shows the payment recorded against it and still reads as issued");
  const over = await refused(() => receiveAccountPayment(manager, { accountKey: B, paymentMethod: "CASH", amountReceived: dueB, idempotencyKey: `d4_${crypto.randomUUID()}` } as any, IP, db));
  assert(over?.includes("owes") === true && (await total(B)) === dueB - 2500, `More than the dues is refused and nothing is recorded (${over})`);
  const wrongBill = await refused(() => receiveAccountPayment(manager, { accountKey: B, paymentMethod: "CASH", amountReceived: 100, idempotencyKey: `d4_${crypto.randomUUID()}`, billNumber: parallel[0].billNumber } as any, IP, db));
  assert(wrongBill?.includes("not one of this account") === true && (await total(B)) === dueB - 2500, "Another customer's bill number is refused and nothing is recorded");
  await receiveAccountPayment(owner, { accountKey: B, paymentMethod: "UPI", amountReceived: dueB - 2500, idempotencyKey: `d4_${crypto.randomUUID()}`, referenceNumber: "UPI123" } as any, IP, db);
  assert((await total(B)) === 0 && (await ledger(b.id)) === 0, "Paying the rest brings the dues to ₹0");
  assert((await num(db, "SELECT COUNT(*) AS n FROM invoices WHERE customer_id = ? AND status <> 'PAID'", [b.id])) === 0, "Every plan month is marked paid");
  assert((await refused(() => createBill(owner, { accountKey: B, type: "NON_GST" }, IP, db)))?.includes("owes nothing") === true, "Nothing left to bill once paid");
  assert((await getBill(owner, bill1.billNumber, db)).total === dueB, "The earlier bill is still on record exactly as issued");

  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Plan dues and orders in one account ---");
  const o: any = await createUnifiedOrder(manager, {
    orderType: "DELIVERY", customerId: a.id, customerName: a.fullName, customerPhone: a.phone, deliveryAddress: "D4 Lane, Sector 4",
    serviceDate: today, mealType: "LUNCH", items: [{ productId: thali.id, productName: "D4 Thali", quantity: 3, unitPrice: 100 }], idempotencyKey: `d4o_${rnd()}`,
  } as any, IP, db);
  await db.execute("UPDATE delivery_tasks SET assigned_to = ?, assigned_to_name = ? WHERE id = ?", [driver.id, driver.fullName, o.deliveryTaskId]);
  const item = await db.queryOne<any>("SELECT id, quantity FROM order_items WHERE order_id = ?", [o.orderId]);
  await completeDeliveryTask(driver, o.deliveryTaskId, { recipientName: "Customer", lines: [{ orderItemId: item.id, deliveredQuantity: 3, undeliveredQuantity: 0 }], idempotencyKey: `d4d_${rnd()}`, paymentChoice: "PAY_LATER" } as any, IP, db);
  const accA = await getReceivableAccount(owner, A, db);
  assert(accA.totals.total === 3800 && accA.totals.TIFFIN === 3500 && accA.totals.DELIVERY === 300, `Plan ₹${accA.totals.TIFFIN} + order ₹${accA.totals.DELIVERY} = ₹${accA.totals.total}`);
  assert(accA.lines.every((l) => l.review === null), "No Pay Later review is raised");
  const dir = (await loadCustomerBalancesById(db, [a.id])).get(a.id)!;
  assert(dir.due === 3800, `The customer list shows the same dues (₹${dir.due})`);
  const billA = await createBill(manager, { accountKey: A, type: "GST", gstRate: 5 }, IP, db);
  assert(billA.total === 3800 && billA.snapshot.lines.length === 2 && billA.snapshot.lines.some((l) => l.detail === "3 × D4 Thali"), "One bill lists the plan month and the order with its items");
  await receiveAccountPayment(manager, { accountKey: A, paymentMethod: "CASH", amountReceived: 3600, idempotencyKey: `d4_${crypto.randomUUID()}` } as any, IP, db);
  const accA2 = await getReceivableAccount(owner, A, db);
  assert(accA2.totals.total === 200 && accA2.lines.length === 1 && accA2.lines[0].outstanding === 200 && accA2.lines[0].paid === accA2.lines[0].amount - 200, "₹3,600 of ₹3,800: one due is paid in full and ₹200 is left on the other (both are dated today)");
  assert((await loadCustomerBalancesById(db, [a.id])).get(a.id)!.due === 200, "The customer list agrees (₹200)");
  const stA = await getAccountStatement(owner, A, {}, db);
  assert(stA.closing === 200, `Statement closes at ₹${stA.closing}`);
  const split = spreadOldestFirst(
    [
      { source: "DELIVERY", refId: "dine", outstanding: 500, date: "2026-01-01", description: "Dine-in order, Pay Later" },
      { source: "DELIVERY", refId: "ord", outstanding: 300, date: "2026-01-02", description: "Delivered order" },
    ],
    "x",
    400
  );
  assert(split.items.length === 1 && split.items[0].refId === "ord" && split.left === 100 && split.skippedDineIn[0] === 500, "A dine-in order is never part-paid: the money goes to the next due and the rest is refused");

  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Residents use the same flow ---");
  const room: any = await createRoom(owner, { roomNumber: `D4${rnd()}`.toUpperCase(), floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 6000 } as any, IP, db);
  const res: any = await registerResident(owner, { fullName: `D4 Resident ${rnd()}`, phone: phone() } as any, IP, db);
  const stay: any = await assignResidentToRoom(owner, { residentId: res.id, roomId: room.id, checkInDate: addDays(today, -35), monthlyRent: 6000 }, IP, db);
  await recordRentCharge(owner, { residentId: res.id, stayId: stay.id, amount: 6000, transactionDate: addDays(today, -35), billingPeriod: "D4 month one" }, IP, db);
  await recordRentCharge(owner, { residentId: res.id, stayId: stay.id, amount: 6000, transactionDate: addDays(today, -5), billingPeriod: "D4 month two" }, IP, db);
  const R = `R:${res.id}`;
  assert((await total(R)) === 12000 && (await getResidentRentBalance(res.id, db)) === 12000, "Two rent charges: ₹12,000 due, equal to the rent ledger");
  delete process.env.ERP_RESIDENT_AUTO_DELIVERY;
  await setResidentRoomDelivery(manager, { residentId: res.id, lunch: true, dinner: true } as any, IP, db);
  await prepareDeliveryManifest(owner, { serviceDate: today, mealType: "DINNER", trigger: "MANUAL" }, IP, db).catch(() => null);
  await prepareDeliveryManifest(owner, { serviceDate: today, mealType: "LUNCH", trigger: "MANUAL" }, IP, db).catch(() => null);
  assert((await num(db, "SELECT COUNT(*) AS n FROM delivery_tasks WHERE resident_id = ?", [res.id])) === 0, "A resident's saved room-delivery preference orders nothing by itself (no automatic dinner stop)");
  // Leave no standing room-delivery preference behind for other suites sharing this database.
  await setResidentRoomDelivery(manager, { residentId: res.id, lunch: false, dinner: false } as any, IP, db);
  const billR = await createBill(manager, { accountKey: R, type: "NON_GST" }, IP, db);
  assert(billR.total === 12000 && billR.snapshot.lines.length === 2 && billR.snapshot.lines[0].label === "Room rent" && billR.snapshot.recipient.place === `Room ${room.roomNumber}`, `Resident bill ${billR.billNumber}: ₹12,000, two rent lines, room on the bill`);
  assert((await total(R)) === 12000, "Billing a resident changes nothing that is owed");
  await receiveAccountPayment(manager, { accountKey: R, paymentMethod: "CASH", amountReceived: 7500, idempotencyKey: `d4_${crypto.randomUUID()}`, billNumber: billR.billNumber } as any, IP, db);
  const accR = await getReceivableAccount(owner, R, db);
  assert(accR.totals.total === 4500 && (await getResidentRentBalance(res.id, db)) === 4500 && accR.lines.length === 1 && accR.lines[0].outstanding === 4500 && accR.lines[0].reference === "D4 month two", "₹7,500 pays the first month and ₹1,500 of the second: ₹4,500 is left on the second");
  assert((await refused(() => receiveAccountPayment(manager, { accountKey: R, paymentMethod: "CASH", amountReceived: 4501, idempotencyKey: `d4_${crypto.randomUUID()}` } as any, IP, db)))?.includes("owes ₹4,500") === true, "₹1 more than the dues is refused");
  assert((await getBill(owner, billR.id, db)).received[0]?.amount === 7500, "The resident's bill shows the payment made against it");

  // ---------------------------------------------------------------------------
  console.log("\n--- 7. Lists: residents and customers apart, individual and corporate ---");
  const corp = await customer("D4 Corporate", { customerType: "CORPORATE" });
  await createTiffinSubscription(manager, { customerId: corp.id, productId: plan2.id, startDate: today, mealTypes: "BOTH", serviceDays: "ALL_DAYS", quantityPerMeal: 1, deliveryAddress: "D4 Lane, Sector 4" } as any, IP, db);
  const customers = await listReceivables(owner, { kind: "CUSTOMER", limit: 500 }, db);
  const residents = await listReceivables(owner, { kind: "RESIDENT", limit: 500 }, db);
  const everyone = await listReceivables(owner, { limit: 500 }, db);
  assert(customers.accounts.every((x) => x.kind !== "RESIDENT") && residents.accounts.every((x) => x.kind === "RESIDENT"), "Customer dues and resident dues are separate lists");
  assert(customers.summary.total + residents.summary.total === everyone.summary.total, `The two lists add up to all dues (₹${customers.summary.total} + ₹${residents.summary.total} = ₹${everyone.summary.total})`);
  const oneR = await listReceivables(owner, { kind: "RESIDENT", q: res.fullName }, db);
  const oneA = await listReceivables(owner, { kind: "CUSTOMER", q: a.fullName }, db);
  assert(oneR.accounts.find((x) => x.accountKey === R)?.total === 4500 && oneA.accounts.find((x) => x.accountKey === A)?.total === 200, "Each list shows the same amount as the account");
  const corporate = await listReceivables(owner, { kind: "CUSTOMER", customerType: "CORPORATE", limit: 500 }, db);
  const individual = await listReceivables(owner, { kind: "CUSTOMER", customerType: "INDIVIDUAL", limit: 500 }, db);
  const oneCorp = await listReceivables(owner, { kind: "CUSTOMER", customerType: "CORPORATE", q: corp.fullName }, db);
  assert(oneCorp.accounts.some((x) => x.accountKey === `C:${corp.id}` && x.total === 3500) && corporate.accounts.every((x) => x.customerType === "CORPORATE"), "Corporate filter shows corporate customers only");
  assert(individual.accounts.every((x) => x.customerType !== "CORPORATE") && corporate.summary.total + individual.summary.total === customers.summary.total, "Individual + corporate add up to all customer dues");
  assert(everyone.accounts.every((x) => x.reviews === 0), "No account is flagged for a Pay Later review");

  // ---------------------------------------------------------------------------
  console.log("\n--- 8. Cashbook: Other receipts, LPG, Assign to ---");
  const tiffinBefore = await getCashbookSummary(owner, { startDate: today, endDate: today, division: "TIFFIN" }, db);
  const duesBefore8 = (await listReceivables(owner, { kind: "ALL", limit: 500 }, db)).summary.total;
  const rkey = `d4r_${crypto.randomUUID()}`;
  const other = await recordOtherReceipt(manager, { amount: 750, paymentMethod: "CASH", payerName: "Walk-in guest", note: "Party order advance", idempotencyKey: rkey }, IP, db);
  const again2 = await recordOtherReceipt(manager, { amount: 750, paymentMethod: "CASH", payerName: "Walk-in guest", idempotencyKey: rkey }, IP, db);
  assert(again2.id === other.id && again2.replayed === true, "The same Other receipt sent twice is recorded once");
  assert((await refused(() => recordOtherReceipt(manager, { amount: 700, paymentMethod: "CASH", payerName: "Walk-in guest", idempotencyKey: rkey }, IP, db)))?.includes("already recorded") === true, "The same reference with another amount is refused");
  assert((await refused(() => recordOtherReceipt(driver, { amount: 10, paymentMethod: "CASH", payerName: "X Y", idempotencyKey: `d4r_${rnd()}` }, IP, db))) !== null, "Delivery staff cannot record Other receipts");
  assert(
    (await refused(() => recordOtherReceipt(manager, { amount: 0, paymentMethod: "CASH", payerName: "X Y", idempotencyKey: `d4r_${rnd()}` }, IP, db))) !== null &&
      (await refused(() => recordOtherReceipt(manager, { amount: 10, paymentMethod: "CASH", payerName: "", idempotencyKey: `d4r_${rnd()}` }, IP, db))) !== null,
    "Amount and who paid are required"
  );
  await recordExpense(owner, { category: "LPG", amount: 1200, transactionDate: today, paymentMethod: "CASH", payeeVendor: "Gas agency", description: "LPG cylinder" } as any, IP, db);
  const tiffinAfter = await getCashbookSummary(owner, { startDate: today, endDate: today, division: "TIFFIN" }, db);
  const tb: any = tiffinBefore.breakdown;
  const ta: any = tiffinAfter.breakdown;
  assert(ta.tiffinReceipts - tb.tiffinReceipts === 750, `Other receipt counts as money in on the tiffin side (₹${ta.tiffinReceipts - tb.tiffinReceipts})`);
  assert(ta.expensesPaid - tb.expensesPaid === 1200, `LPG counts as a tiffin (kitchen) expense (₹${ta.expensesPaid - tb.expensesPaid})`);
  assert(Number(tiffinAfter.netCashMovementExact ?? 0) - Number(tiffinBefore.netCashMovementExact ?? 0) === 750 - 1200, "Tiffin net cash moves by +₹750 − ₹1,200");
  assert((await listReceivables(owner, { kind: "ALL", limit: 500 }, db)).summary.total === duesBefore8, "An Other receipt changes nobody's dues");
  const g = await customer("D4 Assign");
  const orderFor = async (who: string) =>
    (await createUnifiedOrder(manager, {
      orderType: "DELIVERY", customerId: g.id, customerName: g.fullName, customerPhone: g.phone, deliveryAddress: "D4 Lane, Sector 4",
      serviceDate: today, mealType: "DINNER", items: [{ productId: thali.id, productName: "D4 Thali", quantity: 1, unitPrice: 100 }], idempotencyKey: `d4o_${rnd()}`, assignToStaffId: who,
    } as any, IP, db)) as any;
  const mine = await orderFor(manager.id);
  const at = await db.queryOne<any>("SELECT assigned_to FROM delivery_tasks WHERE id = ?", [mine.deliveryTaskId]);
  assert(at?.assigned_to === manager.id, "Assign to chosen while taking the order: the Manager taking it gets the delivery");
  const toOwner = await orderFor(owner.id);
  const at2 = await db.queryOne<any>("SELECT assigned_to FROM delivery_tasks WHERE id = ?", [toOwner.deliveryTaskId]);
  assert(at2?.assigned_to === owner.id, "Assign to another staff member (the Owner) while taking the order");
  const re = await assignDeliveryTask(manager, toOwner.deliveryTaskId, { assignedToStaffId: driver.id }, IP, db);
  assert(re.assignedTo === driver.id, "A taken order can be reassigned to someone else");

  // ---------------------------------------------------------------------------
  console.log("\n--- 9. Editing cashbook entries ---");
  const pgBefore9 = await getCashbookSummary(owner, { startDate: today, endDate: today, division: "PG" }, db);
  const exp: any = await recordExpense(manager, { category: "MAINTENANCE", amount: 900, transactionDate: today, paymentMethod: "CASH", payeeVendor: "Plumber", description: "Tap repair" } as any, IP, db);
  const d1 = await editTransaction(manager, exp.id, { description: "Bathroom tap repair", payeeVendor: "Raju plumber", referenceNumber: "BILL-77" }, IP, db);
  const e1 = await db.queryOne<any>("SELECT description, payee_vendor, reference_number, amount, status FROM financial_transactions WHERE id = ?", [exp.id]);
  assert(d1.changed && !d1.corrected && e1.description === "Bathroom tap repair" && e1.payee_vendor === "Raju plumber" && e1.reference_number === "BILL-77" && Number(e1.amount) === 900 && e1.status === "POSTED", "Manager edits an expense's details in place");
  assert((await refused(() => editTransaction(manager, exp.id, { amount: 950 }, IP, db)))?.includes("Only the owner") === true, "A Manager cannot change the amount");
  assert((await refused(() => editTransaction(driver, exp.id, { description: "x" }, IP, db))) !== null, "Delivery staff cannot edit entries");
  const c1 = await editTransaction(owner, exp.id, { amount: 950, reason: "Bill was ₹950" }, IP, db);
  const oldRow = await db.queryOne<any>("SELECT status FROM financial_transactions WHERE id = ?", [exp.id]);
  const rev = await db.queryOne<any>("SELECT amount FROM financial_transactions WHERE reversal_of_id = ? AND transaction_type = 'REVERSAL'", [exp.id]);
  const fresh = await db.queryOne<any>("SELECT amount, description, payee_vendor, category, status FROM financial_transactions WHERE id = ?", [c1.id]);
  assert(c1.corrected && oldRow.status === "REVERSED" && Number(rev?.amount) === 900 && Number(fresh.amount) === 950 && fresh.description === "Bathroom tap repair" && fresh.category === "MAINTENANCE" && fresh.status === "POSTED", "Owner corrects the amount: the old entry is reversed and a corrected one recorded");
  const pgAfter9 = await getCashbookSummary(owner, { startDate: today, endDate: today, division: "PG" }, db);
  assert((pgAfter9.netCashMovementExact ?? 0) - (pgBefore9.netCashMovementExact ?? 0) === -950, `Net cash moves by exactly −₹950 after the correction (₹${(pgAfter9.netCashMovementExact ?? 0) - (pgBefore9.netCashMovementExact ?? 0)})`);
  assert((await refused(() => editTransaction(owner, exp.id, { description: "again" }, IP, db)))?.includes("reversed") === true, "A reversed entry cannot be edited");
  const lpg: any = await recordExpense(owner, { category: "GROCERY", amount: 300, transactionDate: today, paymentMethod: "CASH", description: "Gas" } as any, IP, db);
  await editTransaction(manager, lpg.id, { category: "LPG" }, IP, db);
  assert((await db.queryOne<any>("SELECT category FROM financial_transactions WHERE id = ?", [lpg.id])).category === "LPG", "An expense's category can be corrected");
  const otherEdit = await editTransaction(owner, other.id, { payeeVendor: "Party guest", amount: 800 }, IP, db);
  const otherNew = await db.queryOne<any>("SELECT amount, payee_vendor, category, transaction_type FROM financial_transactions WHERE id = ?", [otherEdit.id]);
  assert(otherEdit.corrected && Number(otherNew.amount) === 800 && otherNew.payee_vendor === "Party guest" && otherNew.category === "OTHER_RECEIPT" && otherNew.transaction_type === "TIFFIN_PAYMENT", "An Other receipt can be corrected (amount and who paid)");
  const rentPay = await db.queryOne<any>("SELECT id FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' LIMIT 1", [res.id]);
  assert((await refused(() => editTransaction(owner, rentPay.id, { amount: 1 }, IP, db)))?.includes("dues payment") === true, "A dues payment's amount is not edited here (reverse and receive again)");
  const rentNote = await editTransaction(manager, rentPay.id, { description: "Paid at the office", referenceNumber: "R-1" }, IP, db);
  assert(rentNote.changed && !rentNote.corrected && (await getResidentRentBalance(res.id, db)) === 4500, "A dues payment's note can be edited; the resident still owes exactly ₹4,500");

  console.log("\n================================================================================");
  console.log(`DUES & BILLS RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
