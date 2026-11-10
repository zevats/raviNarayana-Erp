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
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
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

  console.log("\n--- 4. Duplicate customer: a plain message ---");
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
