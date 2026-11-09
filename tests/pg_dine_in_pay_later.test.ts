/**
 * Dine-in Pay Later (migration 0024), no time cutoff, meal by time of day, and repeat-last-order.
 * Dine-in on Pay Later: no cashbook entry at the counter; the order is unpaid on the guest's
 * account (Receivables, statement, customer Due) until it is paid in full from Receivables, which
 * then writes the cashbook entry once (a retry with the same reference records nothing more).
 * Disposable verification database only (RN_PG_VERIFY_URL; names contain "verify" and "test").
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createTiffinCustomer, createTiffinProduct, listTiffinCustomers } from "../apps/erp/src/server/tiffin/tiffinService";
import { createUnifiedOrder, getCustomerOrderHistory } from "../apps/erp/src/server/orders/orderService";
import { getReceivableAccount, getAccountStatement, receiveAccountPayment } from "../apps/erp/src/server/finance/receivablesService";
import { isPastCutoff } from "../apps/erp/src/server/delivery/deliveryRules";
import { businessMeal } from "../apps/erp/src/lib/businessDate";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff, uniqueBusinessDate } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;

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
  console.log("DINE-IN PAY LATER, NO CUTOFF, MEAL BY TIME, LAST ORDER (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Dine Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Dine Manager");
  const day = uniqueBusinessDate(83);
  const product: any = await createTiffinProduct(owner, { code: `DN_${rnd()}`.toUpperCase(), name: "Dine Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 120 } as any, undefined, db);
  const dineIn = (extra: Record<string, any>) =>
    createUnifiedOrder(manager, { orderType: "DINE_IN", serviceDate: day, mealType: "LUNCH", items: [{ productId: product.id, productName: "Dine Thali", quantity: 2, unitPrice: 120 }], idempotencyKey: `dn_${rnd()}`, ...extra } as any, IP, db);

  console.log("\n--- 1. Dine-in paid at the counter (unchanged) ---");
  const paid: any = await dineIn({ customerName: "Counter Guest", paymentMethod: "CASH" });
  const paidRow = await db.queryOne<any>("SELECT financial_transaction_id, payment_choice FROM orders WHERE id = ?", [paid.orderId]);
  assert(Boolean(paidRow.financial_transaction_id) && paid.paymentStatus === "PAID", "Cash at the counter: cashbook entry written, order paid");

  console.log("\n--- 2. Dine-in on Pay Later ---");
  assert(/guest phone/i.test((await refused(() => dineIn({ customerName: "No Phone", payLater: true }))) || ""), "Pay Later without a phone is refused");
  assert(/guest name/i.test((await refused(() => dineIn({ customerPhone: phone(), payLater: true }))) || ""), "Pay Later without a name is refused");
  const ledgerBefore = await num(db, "SELECT COUNT(*)::int AS n FROM financial_transactions");
  const guestPhone = phone();
  const later: any = await dineIn({ customerName: "Later Guest", customerPhone: guestPhone, payLater: true });
  const laterRow = await db.queryOne<any>("SELECT financial_transaction_id, payment_choice, customer_id FROM orders WHERE id = ?", [later.orderId]);
  assert(!laterRow.financial_transaction_id && laterRow.payment_choice === "PAY_LATER" && (await num(db, "SELECT COUNT(*)::int AS n FROM financial_transactions")) === ledgerBefore,
    "Pay Later: no cashbook entry, choice PAY_LATER");
  assert(later.paymentStatus === "PENDING" && later.remainingAmount === 240, `The order shows unpaid ₹${later.remainingAmount}`);
  const accO = await getReceivableAccount(owner, `O:${later.orderId}`, db);
  assert(accO.totals.total === 240 && accO.lines.some((l: any) => l.refId === later.orderId && l.outstanding === 240 && /Dine in/.test(l.reference)), `Receivables: ₹${accO.totals.total} owed on the guest's account`);

  console.log("\n--- 3. A guest who is a customer (same phone) owes on that customer's account ---");
  const cust: any = await createTiffinCustomer(manager, { fullName: `Dine Customer ${rnd()}`, phone: phone(), deliveryAddress: "Dine Lane 1" } as any, IP, db);
  const linked: any = await dineIn({ customerName: cust.fullName, customerPhone: cust.phone, payLater: true });
  const linkedRow = await db.queryOne<any>("SELECT customer_id FROM orders WHERE id = ?", [linked.orderId]);
  const accC = await getReceivableAccount(owner, `C:${cust.id}`, db);
  const listed = (await listTiffinCustomers(manager, { search: cust.phone }, db)).customers.find((c: any) => c.id === cust.id) as any;
  const st = await getAccountStatement(owner, `C:${cust.id}`, {}, db);
  assert(linkedRow.customer_id === cust.id && accC.totals.total === 240 && listed?.balance?.due === 240 && listed?.balance?.unpaidOrders === 1 && st.closing === 240,
    `Linked to the customer: Receivables ₹${accC.totals.total}, customer list Due ₹${listed?.balance?.due}, statement ₹${st.closing}`);

  console.log("\n--- 4. Paid later from Receivables, in full, once ---");
  const key = `dnpay_${rnd()}`;
  assert(/paid in full/i.test((await refused(() => receiveAccountPayment(owner, { accountKey: `C:${cust.id}`, paymentMethod: "UPI" as any, amountReceived: 100, idempotencyKey: `dnpart_${rnd()}`, items: [{ source: "DELIVERY", refId: linked.orderId, amount: 100 }] }, IP, db))) || ""),
    "A part payment of a dine-in order is refused (paid in full)");
  const pay = () => receiveAccountPayment(owner, { accountKey: `C:${cust.id}`, paymentMethod: "UPI" as any, amountReceived: 240, idempotencyKey: key, items: [{ source: "DELIVERY", refId: linked.orderId, amount: 240 }] }, IP, db);
  await pay();
  await pay(); // same reference again: nothing new
  const after = await db.queryOne<any>("SELECT o.financial_transaction_id, f.amount, f.status, f.payment_method FROM orders o JOIN financial_transactions f ON f.id = o.financial_transaction_id WHERE o.id = ?", [linked.orderId]);
  const entries = await num(db, "SELECT COUNT(*)::int AS n FROM financial_transactions WHERE idempotency_key LIKE ?", [`${key}:%`]);
  const accAfter = await getReceivableAccount(owner, `C:${cust.id}`, db);
  const stAfter = await getAccountStatement(owner, `C:${cust.id}`, {}, db);
  assert(Number(after.amount) === 240 && after.status === "POSTED" && after.payment_method === "UPI" && entries === 1 && accAfter.totals.total === 0 && stAfter.closing === 0,
    `Paid: one cashbook entry ₹${after.amount} by UPI (${entries} entry for the reference), account settled, statement ₹${stAfter.closing}`);
  assert(/already paid/i.test((await refused(() => receiveAccountPayment(owner, { accountKey: `C:${cust.id}`, paymentMethod: "CASH" as any, amountReceived: 240, idempotencyKey: `dnagain_${rnd()}`, items: [{ source: "DELIVERY", refId: linked.orderId, amount: 240 }] }, IP, db))) || ""),
    "Paying it again with another reference is refused");

  console.log("\n--- 5. No time cutoff; a past day still needs a reason ---");
  const at = (h: number) => new Date(`2041-06-10T${String(h - 6).padStart(2, "0")}:30:00Z`); // h:00 India time (UTC + 5:30)
  assert(isPastCutoff("2041-06-10", "LUNCH", at(14)) === false && isPastCutoff("2041-06-10", "DINNER", at(21)) === false, "Today after the old cutoff times: changes need no reason");
  assert(isPastCutoff("2041-06-09", "LUNCH", at(9)) === true, "A day that has passed still needs a Manager override");

  console.log("\n--- 6. Meal by time of day ---");
  assert(businessMeal(at(11)) === "LUNCH" && businessMeal(at(15)) === "LUNCH" && businessMeal(at(16)) === "DINNER" && businessMeal(at(20)) === "DINNER", "Lunch until 4 pm, dinner from 4 pm (India time)");

  console.log("\n--- 7. Repeat: only the most recent order ---");
  const rc: any = await createTiffinCustomer(manager, { fullName: `Repeat ${rnd()}`, phone: phone(), deliveryAddress: "Repeat Lane 1" } as any, IP, db);
  const deliv = (qty: number) => createUnifiedOrder(manager, { orderType: "DELIVERY", customerId: rc.id, customerName: rc.fullName, customerPhone: rc.phone, deliveryAddress: "Repeat Lane 1", serviceDate: day, mealType: "LUNCH", items: [{ productId: product.id, productName: "Dine Thali", quantity: qty, unitPrice: 120 }], idempotencyKey: `rp_${rnd()}` } as any, IP, db);
  await deliv(1);
  await new Promise((r) => setTimeout(r, 20));
  const last: any = await deliv(3);
  const history = await getCustomerOrderHistory(manager, { customerId: rc.id, phone: rc.phone }, db);
  assert(history.length === 1 && history[0].orderId === last.orderId && history[0].items[0].quantity === 3, `History returns only the last order (${history.length})`);
  assert(/not found/i.test((await refused(() => createUnifiedOrder(manager, { orderType: "DELIVERY", customerId: "cust_missing", customerName: "Ghost", customerPhone: phone(), deliveryAddress: "Nowhere Lane", serviceDate: day, mealType: "LUNCH", items: [{ productId: product.id, productName: "Dine Thali", quantity: 1, unitPrice: 120 }], idempotencyKey: `gh_${rnd()}` } as any, IP, db))) || ""),
    "An unknown customer is still refused (one-statement check)");

  console.log("\n================================================================================");
  console.log(`DINE-IN PAY LATER RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
