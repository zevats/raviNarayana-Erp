/**
 * Orders for subscription customers: the plan's thalis for the meal are free, extra thalis and other
 * items are charged at the menu price; the plan's own delivery for that meal is skipped (the order
 * brings the food). A meal the plan does not cover is charged in full. Friendly duplicate message.
 * Disposable verification database only (RN_PG_VERIFY_URL; names contain "verify" and "test").
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createTiffinCustomer, createTiffinProduct, createTiffinSubscription } from "../apps/erp/src/server/tiffin/tiffinService";
import { createUnifiedOrder, getCustomerMonthlyActivity } from "../apps/erp/src/server/orders/orderService";
import { businessToday } from "../apps/erp/src/lib/businessDate";
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
  console.log("SUBSCRIPTION ORDERS (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Plan Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Plan Manager");
  await insertStaff(db, "DELIVERY_PERSON", "Plan Driver");
  const day = uniqueBusinessDate(91);
  const thali: any = await createTiffinProduct(owner, { code: `PT_${rnd()}`.toUpperCase(), name: "Plan Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 90 } as any, undefined, db);
  const lassi: any = await createTiffinProduct(owner, { code: `PL_${rnd()}`.toUpperCase(), name: "Plan Lassi", category: "BEVERAGE", billingUnit: "PER_PIECE", price: 40 } as any, undefined, db);
  const plan2: any = await createTiffinProduct(owner, { code: `PM2_${rnd()}`.toUpperCase(), name: "Monthly Lunch & Dinner", category: "SUBSCRIPTION_PACKAGE", billingUnit: "PER_MONTH", price: 3500 } as any, undefined, db);
  const plan1: any = await createTiffinProduct(owner, { code: `PM1_${rnd()}`.toUpperCase(), name: "Monthly Single Meal", category: "SUBSCRIPTION_PACKAGE", billingUnit: "PER_MONTH", price: 2000 } as any, undefined, db);
  const cust = async () => (await createTiffinCustomer(manager, { fullName: `Plan Customer ${rnd()}`, phone: phone(), deliveryAddress: "Plan Lane 1" } as any, IP, db)) as any;

  const c1 = await cust();
  const s1: any = await createTiffinSubscription(manager, { customerId: c1.id, productId: plan2.id, startDate: day, mealTypes: "BOTH", quantityPerMeal: 1, deliveryAddress: "Plan Lane 1" } as any, IP, db);
  const order = (c: any, s: any, meal: string, lines: Array<[any, number]>) =>
    createUnifiedOrder(manager, {
      orderType: "DELIVERY", customerId: c.id, customerName: c.fullName, customerPhone: c.phone, deliveryAddress: "Plan Lane 1", serviceDate: day, mealType: meal,
      subscriptionId: s.id, items: lines.map(([p, q]) => ({ productId: p.id, productName: p.name, quantity: q, unitPrice: p.price })), idempotencyKey: `so_${rnd()}`,
    } as any, IP, db) as any;

  console.log("\n--- 1. The plan's thalis are free, the rest is charged ---");
  const o1 = await order(c1, s1, "LUNCH", [[thali, 3], [lassi, 1]]);
  const lines = await db.query<any>("SELECT product_name, quantity, unit_price, line_total FROM order_items WHERE order_id = ? ORDER BY line_no", [o1.orderId]);
  const free = lines.filter((l) => Number(l.unit_price) === 0).reduce((s, l) => s + Number(l.quantity), 0);
  const paid = lines.filter((l) => Number(l.unit_price) > 0).reduce((s, l) => s + Number(l.line_total), 0);
  assert(free === 1 && paid === 220 && o1.totalAmount === 220, `3 thalis + 1 lassi at lunch on a lunch-and-dinner plan (1 thali a meal): 1 free, ₹${paid} charged (2 thalis ₹180 + lassi ₹40); order total ₹${o1.totalAmount}`);
  const skip = await num(db, "SELECT COUNT(*)::int AS n FROM subscription_day_overrides WHERE subscription_id = ? AND service_date = ? AND meal_type = 'LUNCH' AND action = 'SKIP'", [s1.id, day]);
  assert(skip === 1, "The plan's own lunch delivery for that day is skipped (the order brings the thalis)");

  console.log("\n--- 2. A meal the plan does not cover is charged in full ---");
  const c2 = await cust();
  const s2: any = await createTiffinSubscription(manager, { customerId: c2.id, productId: plan1.id, startDate: day, mealTypes: "LUNCH", quantityPerMeal: 1, deliveryAddress: "Plan Lane 1" } as any, IP, db);
  const o2 = await order(c2, s2, "DINNER", [[thali, 2]]);
  assert(o2.totalAmount === 180, `Lunch-only plan, dinner order: both thalis charged (₹${o2.totalAmount})`);
  const noSkip = await num(db, "SELECT COUNT(*)::int AS n FROM subscription_day_overrides WHERE subscription_id = ?", [s2.id]);
  assert(noSkip === 0, "Nothing of the plan is skipped when the order is not covered by it");

  console.log("\n--- 3. Someone else's plan is refused ---");
  const c3 = await cust();
  assert(/another customer/i.test((await refused(() => order(c3, s1, "DINNER", [[thali, 1]]))) || ""), "A plan of another customer cannot be used");

  console.log("\n--- 4. Dine in for a plan customer ---");
  const c4 = await cust();
  const s4: any = await createTiffinSubscription(manager, { customerId: c4.id, productId: plan2.id, startDate: day, mealTypes: "BOTH", quantityPerMeal: 1, deliveryAddress: "Plan Lane 1" } as any, IP, db);
  const dine = (meal: string, lines: Array<[any, number]>, payment = "CASH") =>
    createUnifiedOrder(manager, {
      orderType: "DINE_IN", customerId: c4.id, customerName: c4.fullName, customerPhone: c4.phone, serviceDate: day, mealType: meal, paymentMethod: payment,
      subscriptionId: s4.id, items: lines.map(([p, q]) => ({ productId: p.id, productName: p.name, quantity: q, unitPrice: p.price })), idempotencyKey: `sd_${rnd()}`,
    } as any, IP, db) as any;
  const free1 = await dine("LUNCH", [[thali, 1]]);
  const freeRow = await db.queryOne<any>("SELECT total_amount, financial_transaction_id, customer_id, payment_choice FROM orders WHERE id = ?", [free1.orderId]);
  assert(Number(freeRow.total_amount) === 0 && freeRow.financial_transaction_id === null && freeRow.customer_id === c4.id && freeRow.payment_choice === null, "Plan thali eaten at the counter: ₹0, no cashbook entry, on the customer, not Pay Later");
  const skip4 = await num(db, "SELECT COUNT(*)::int AS n FROM subscription_day_overrides WHERE subscription_id = ? AND service_date = ? AND meal_type = 'LUNCH' AND action = 'SKIP'", [s4.id, day]);
  assert(skip4 === 1, "The plan lunch delivery is skipped (the customer ate at the counter)");
  const extra = await dine("DINNER", [[thali, 2]], "UPI");
  const extraRow = await db.queryOne<any>("SELECT o.total_amount, f.amount, f.payment_method FROM orders o JOIN financial_transactions f ON f.id = o.financial_transaction_id WHERE o.id = ?", [extra.orderId]);
  assert(Number(extraRow?.total_amount) === 90 && Number(extraRow?.amount) === 90 && extraRow?.payment_method === "UPI", `Dinner at the counter, 2 thalis: 1 free, ₹${extraRow?.total_amount} paid by UPI into the cashbook`);
  const owed = await num(db, "SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = ? AND payment_choice = 'PAY_LATER'", [c4.id]);
  assert(owed === 0, "Nothing is put on the customer account");

  console.log("\n--- 4b. One-thali plan: any meal, once a day ---");
  const c6 = await cust();
  const s6: any = await createTiffinSubscription(manager, { customerId: c6.id, productId: plan1.id, startDate: day, mealTypes: "ANY", quantityPerMeal: 1, deliveryAddress: "Plan Lane 1" } as any, IP, db);
  assert(s6.mealTypes === "ANY", "A one-thali plan is saved as any meal");
  const anyOrder = (date: string, meal: string, qty: number) =>
    createUnifiedOrder(manager, {
      orderType: "DELIVERY", customerId: c6.id, customerName: c6.fullName, customerPhone: c6.phone, deliveryAddress: "Plan Lane 1", serviceDate: date, mealType: meal,
      subscriptionId: s6.id, items: [{ productId: thali.id, productName: thali.name, quantity: qty, unitPrice: thali.price }], idempotencyKey: `any_${rnd()}`,
    } as any, IP, db) as any;
  const a1 = await anyOrder(day, "DINNER", 1);
  assert(a1.totalAmount === 0, `Dinner thali on the plan: free (₹${a1.totalAmount})`);
  const a2 = await anyOrder(day, "LUNCH", 1);
  assert(a2.totalAmount === 90, `A second thali the same day (lunch) is charged (₹${a2.totalAmount})`);
  const next = new Date(`${day}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  const a3 = await anyOrder(next.toISOString().slice(0, 10), "LUNCH", 1);
  assert(a3.totalAmount === 0, `Next day, the plan thali is free again (₹${a3.totalAmount})`);

  console.log("\n--- 5. Customer details: orders and payments, last 3 months ---");
  const c5 = await cust();
  const today = businessToday();
  const unpaid = await createUnifiedOrder(manager, {
    orderType: "DELIVERY", customerId: c5.id, customerName: c5.fullName, customerPhone: c5.phone, deliveryAddress: "Plan Lane 1", serviceDate: today, mealType: "LUNCH",
    items: [{ productId: thali.id, productName: thali.name, quantity: 2, unitPrice: thali.price }], idempotencyKey: `act_${rnd()}`,
  } as any, IP, db) as any;
  const paidDine = await createUnifiedOrder(manager, {
    orderType: "DINE_IN", customerId: c5.id, customerName: c5.fullName, customerPhone: c5.phone, serviceDate: today, mealType: "DINNER", paymentMethod: "CASH",
    items: [{ productId: lassi.id, productName: lassi.name, quantity: 1, unitPrice: lassi.price }], idempotencyKey: `act_${rnd()}`,
  } as any, IP, db) as any;
  const act = await getCustomerMonthlyActivity(manager, c5.id, 3, db);
  const cur = act[0];
  const kinds = Object.fromEntries(cur.orders.map((o) => [o.orderId, o.payment]));
  assert(act.length === 3 && cur.month === today.slice(0, 7), `Three months, newest first (${act.map((m) => m.month).join(", ")})`);
  assert(cur.totals.orders === 2 && cur.totals.amount === 220 && cur.totals.paid === 40 && cur.totals.due === 180,
    `This month: ${cur.totals.orders} orders, ₹${cur.totals.amount}, paid ₹${cur.totals.paid}, due ₹${cur.totals.due}`);
  assert(kinds[unpaid.orderId] === "UNPAID" && kinds[paidDine.orderId] === "PAID", `Payment shown per order: ${JSON.stringify(kinds)}`);

  console.log("\n--- 6. Duplicate customer: a plain message ---");
  const dup = await refused(() => createTiffinCustomer(manager, { fullName: "Second Person", phone: c1.phone, deliveryAddress: "Plan Lane 2" } as any, IP, db));
  assert(Boolean(dup) && dup!.includes(c1.fullName) && !/ID:|cust_|confirmDuplicate/.test(dup!), `Same phone: "${dup}"`);

  console.log("\n================================================================================");
  console.log(`SUBSCRIPTION ORDERS RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
