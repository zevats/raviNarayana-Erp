/**
 * Live PostgreSQL verification of first-class order storage (migration 0012, ISSUE-008 / ISSUE-024).
 * Disposable local database only (RN_PG_VERIFY_URL, see helpers/pgVerifyTarget); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createUnifiedOrder, listUnifiedOrders, getCustomerOrderHistory, backfillLegacyOrders } from "../apps/erp/src/server/orders/orderService";
import { createExternalDeliveryTask, completeDeliveryTask } from "../apps/erp/src/server/delivery/deliveryService";
import { createTiffinProduct } from "../apps/erp/src/server/tiffin/tiffinService";
import {
  useVerifyDatabase,
  migrateVerifyDatabase,
  createAsserter,
  insertStaff,
  uniqueBusinessDate,
} from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;

async function count(db: AsyncDb, sql: string, params: any[] = []): Promise<number> {
  const row = await db.queryOne<any>(sql, params);
  return Number(row?.n ?? 0);
}

function failingOn(db: AsyncDb, pattern: RegExp): AsyncDb {
  return {
    ...db,
    isPostgres: db.isPostgres,
    query: db.query.bind(db),
    queryOne: db.queryOne.bind(db),
    execute: db.execute.bind(db),
    transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T> {
      return db.transaction((tx) => {
        const wrapped: AsyncDb = {
          isPostgres: tx.isPostgres,
          query: tx.query.bind(tx),
          queryOne: tx.queryOne.bind(tx),
          async execute(sql: string, params?: any[]) {
            if (pattern.test(sql)) throw new Error("simulated failure");
            return tx.execute(sql, params);
          },
          transaction: (nested) => nested(wrapped),
        };
        return cb(wrapped);
      });
    },
  };
}

async function main() {
  console.log("================================================================================");
  console.log("PG ORDERS VERIFICATION (live local PostgreSQL)");
  console.log("================================================================================");

  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Orders Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Orders Manager");
  await insertStaff(db, "DELIVERY_PERSON", "Orders Driver");
  const day = uniqueBusinessDate(40);

  console.log("\n--- 1. Migration 0012 ---");
  const tables = await db.query<any>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('orders', 'order_items')"
  );
  assert(tables.length === 2, "orders and order_items exist");
  const migrations = await count(db, "SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations");
  assert(migrations === 15, `15 migrations recorded (got ${migrations})`);
  let badTotal: any = null;
  try {
    await db.transaction(async (tx) => {
      const taskless = `ord_bad_${rnd()}`;
      await tx.execute(
        `INSERT INTO orders (id, order_type, status, service_date, meal_type, customer_name, total_quantity, total_amount, source, created_at, updated_at)
         VALUES (?, 'DELIVERY', 'CONFIRMED', ?, 'LUNCH', 'X', 1, 10, 'APP', ?, ?)`,
        [taskless, day, day, day]
      );
    });
  } catch (e) {
    badTotal = e;
  }
  assert(badTotal !== null, "CHECK constraint rejects a DELIVERY order without a delivery task");

  const product = await createTiffinProduct(owner, {
    code: `VERIFY_${rnd()}`.toUpperCase(),
    name: "Verification Thali",
    category: "STANDARD_MEAL",
    billingUnit: "PER_MEAL",
    price: 90,
  } as any, undefined, db);
  const roti = await createTiffinProduct(owner, {
    code: `VERIFY_ROTI_${rnd()}`.toUpperCase(),
    name: "Extra Roti",
    category: "EXTRA",
    billingUnit: "PER_PIECE",
    price: 8,
  } as any, undefined, db);

  console.log("\n--- 2. Delivery order: idempotent, atomic ---");
  const key = `ord_${rnd()}`;
  const input = {
    orderType: "DELIVERY" as const,
    customerName: "Order Verify Customer",
    customerPhone: phone(),
    deliveryAddress: "Plot 11, Verification Sector",
    serviceDate: day,
    mealType: "LUNCH" as const,
    items: [
      { productId: product.id, productName: "Verification Thali", quantity: 2, unitPrice: 90 },
      { productId: roti.id, productName: "Extra Roti", quantity: 3, unitPrice: 8 },
    ],
    notes: "Ring twice",
    idempotencyKey: key,
  };
  const results = await Promise.allSettled([1, 2, 3].map(() => createUnifiedOrder(manager, input as any, IP, db)));
  const ok = results.filter((r) => r.status === "fulfilled").map((r: any) => r.value);
  const errs = results.filter((r) => r.status === "rejected").map((r: any) => r.reason?.message);
  assert(ok.length === 3, `Three concurrent submissions all return the order (errors: ${errs.join(" | ") || "none"})`);
  assert(new Set(ok.map((o: any) => o.orderId)).size === 1, "All three return the same order id");
  assert((await count(db, "SELECT COUNT(*)::int AS n FROM orders WHERE idempotency_key = ?", [key])) === 1, "Exactly one order row");
  assert(
    (await count(db, "SELECT COUNT(*)::int AS n FROM delivery_tasks WHERE customer_phone = ?", [input.customerPhone])) === 1,
    "Exactly one delivery task"
  );
  assert((await count(db, "SELECT COUNT(*)::int AS n FROM tiffin_customers WHERE phone = ?", [input.customerPhone])) === 1, "Exactly one customer");
  const order = ok[0];
  assert(order.totalAmount === 204 && order.totalQuantity === 5 && order.items.length === 2, `Totals from stored lines (₹${order.totalAmount}, ${order.totalQuantity} portions)`);
  assert(order.orderStatus === "CONFIRMED" && order.deliveryStatus === "OUT_FOR_DELIVERY" && Boolean(order.assignedTo), `Confirmed, auto-assigned and dispatched (${order.orderStatus}/${order.deliveryStatus})`);

  let mismatch: any = null;
  try {
    await createUnifiedOrder(manager, { ...input, items: [{ productId: roti.id, productName: "Extra Roti", quantity: 1, unitPrice: 8 }] } as any, IP, db);
  } catch (e) {
    mismatch = e;
  }
  assert(mismatch !== null && /different order/.test(mismatch.message), "Reusing the key for a different order is rejected");

  const atomicPhone = phone();
  let atomicErr: any = null;
  try {
    await createUnifiedOrder(manager, { ...input, idempotencyKey: `ord_${rnd()}`, customerPhone: atomicPhone } as any, IP, failingOn(db, /INSERT INTO order_items/i));
  } catch (e) {
    atomicErr = e;
  }
  assert(atomicErr !== null, "Failure while writing order lines surfaces to the caller");
  assert(
    (await count(db, "SELECT COUNT(*)::int AS n FROM tiffin_customers WHERE phone = ?", [atomicPhone])) === 0 &&
      (await count(db, "SELECT COUNT(*)::int AS n FROM delivery_tasks WHERE customer_phone = ?", [atomicPhone])) === 0,
    "Nothing persists when order creation fails midway (customer, task and order roll back together)"
  );

  console.log("\n--- 3. Validation ---");
  const rejects = async (label: string, patch: any) => {
    let e: any = null;
    try {
      await createUnifiedOrder(manager, { ...input, idempotencyKey: undefined, customerPhone: phone(), ...patch } as any, IP, db);
    } catch (err) {
      e = err;
    }
    assert(e !== null, `${label} is rejected${e ? ` (${e.message})` : ""}`);
  };
  await rejects("Unknown product id", { items: [{ productId: "prod_missing", productName: "Ghost", quantity: 1, unitPrice: 50 }] });
  await rejects("Zero quantity", { items: [{ productId: product.id, productName: "Thali", quantity: 0, unitPrice: 90 }] });
  await rejects("A line that is not a menu item", { items: [{ productName: "Thali", quantity: 1, unitPrice: 50 }] });
  const monthly = await createTiffinProduct(owner, {
    code: `VERIFY_MONTH_${rnd()}`.toUpperCase(),
    name: "Verification Monthly Package",
    category: "SUBSCRIPTION_PACKAGE",
    billingUnit: "PER_MONTH",
    price: 3500,
  } as any, undefined, db);
  await rejects("A monthly package as an order line", { items: [{ productId: monthly.id, productName: "Monthly", quantity: 1, unitPrice: 3500 }] });
  const retired = await createTiffinProduct(owner, {
    code: `VERIFY_OLD_${rnd()}`.toUpperCase(),
    name: "Retired Dish",
    category: "EXTRA",
    billingUnit: "PER_PORTION",
    price: 30,
  } as any, undefined, db);
  await db.execute("UPDATE tiffin_products SET status = 'INACTIVE' WHERE id = ?", [retired.id]);
  await rejects("An inactive menu item", { items: [{ productId: retired.id, productName: "Retired Dish", quantity: 1, unitPrice: 30 }] });
  const priced = await createUnifiedOrder(manager, {
    ...input,
    idempotencyKey: undefined,
    customerPhone: phone(),
    items: [{ productId: product.id, productName: "Cheap Thali", quantity: 2, unitPrice: 1 }],
  } as any, IP, db);
  assert(
    priced.totalAmount === 180 && priced.items[0].unitPrice === 90 && priced.items[0].productName === "Verification Thali",
    `Price and name come from the menu, not the request (₹${priced.totalAmount}, ${priced.items[0].productName} @ ₹${priced.items[0].unitPrice})`
  );
  await db.execute("UPDATE tiffin_products SET price = 95 WHERE id = ?", [product.id]);
  const afterPriceChange = (await listUnifiedOrders(manager, { serviceDate: day }, db)).orders.find((o) => o.orderId === priced.orderId);
  assert(afterPriceChange?.totalAmount === 180 && afterPriceChange.items[0].unitPrice === 90, "A later menu price change does not alter the placed order");
  await db.execute("UPDATE tiffin_products SET price = 90 WHERE id = ?", [product.id]);
  await rejects("Empty order", { items: [] });

  console.log("\n--- 4. Dine-in order ---");
  const dineKey = `dine_${rnd()}`;
  const dineInput = {
    orderType: "DINE_IN" as const,
    customerName: "Counter Guest",
    serviceDate: day,
    mealType: "DINNER" as const,
    items: [{ productId: product.id, productName: "Verification Thali", quantity: 1, unitPrice: 90 }],
    paymentMethod: "UPI" as const,
    idempotencyKey: dineKey,
  };
  const dine = await Promise.all([createUnifiedOrder(manager, dineInput as any, IP, db), createUnifiedOrder(manager, dineInput as any, IP, db)]);
  assert(dine[0].orderId === dine[1].orderId, "Concurrent dine-in duplicates return one order");
  const dineRow = await db.queryOne<any>("SELECT financial_transaction_id FROM orders WHERE idempotency_key = ?", [dineKey]);
  assert(
    (await count(db, "SELECT COUNT(*)::int AS n FROM financial_transactions WHERE id = ? AND category = 'TIFFIN_WALKIN_SALE' AND amount = 90", [dineRow.financial_transaction_id])) === 1,
    "One ₹90 counter sale on the ledger, linked from the order"
  );

  console.log("\n--- 5. Per-line delivery recording (ISSUE-024) ---");
  const driverId = order.assignedTo as string;
  const driverUser = { id: driverId, username: "drv", email: "drv@example.invalid", fullName: "Driver", role: "DELIVERY_PERSON" as const };
  const orderItemRows = await db.query<any>("SELECT id, product_name, quantity FROM order_items WHERE order_id = ? ORDER BY line_no", [order.orderId]);
  await completeDeliveryTask(driverUser, order.deliveryTaskId, {
    undeliveredReason: "One roti short",
    collectedAmount: 196,
    paymentMethod: "CASH",
    idempotencyKey: `col_${rnd()}`,
    lines: [
      { orderItemId: orderItemRows[0].id, deliveredQuantity: 2, undeliveredQuantity: 0 },
      { orderItemId: orderItemRows[1].id, deliveredQuantity: 2, undeliveredQuantity: 1, disposition: "RETURNED" },
    ],
    recipientName: "Front desk",
  }, IP, db);
  const lines = await db.query<any>(
    "SELECT product_name, delivered_quantity, undelivered_reason FROM order_items WHERE order_id = ? ORDER BY line_no",
    [order.orderId]
  );
  assert(Number(lines[0].delivered_quantity) === 2 && lines[0].undelivered_reason === null, "Line 1 fully delivered");
  assert(Number(lines[1].delivered_quantity) === 2 && lines[1].undelivered_reason === "One roti short", "Line 2 shortfall stored as structured data");
  const listed = await listUnifiedOrders(manager, { serviceDate: day }, db);
  const listedOrder = listed.orders.find((o) => o.orderId === order.orderId);
  assert(listedOrder?.orderStatus === "DELIVERED" && listedOrder?.collectedAmount === 196, "List view reads delivery progress from the task");

  console.log("\n--- 6. Legacy backfill ---");
  const legacyDay = uniqueBusinessDate(41);
  const legacyPhone = phone();
  const goodTask = await createExternalDeliveryTask(owner, {
    serviceDate: legacyDay,
    mealType: "LUNCH",
    customerName: "Legacy Customer",
    customerPhone: legacyPhone,
    deliveryAddress: "Old Lane 1",
    notes: `[ORDER_JSON:{"orderType":"DELIVERY","items":[{"productName":"Daily Standard Tiffin","quantity":2,"unitPrice":80,"lineTotal":160}],"totalAmount":160,"totalQuantity":2,"userNotes":"Gate 2"}] Gate 2`,
  }, IP, db);
  const brokenTask = await createExternalDeliveryTask(owner, {
    serviceDate: legacyDay,
    mealType: "DINNER",
    customerName: "Legacy Broken",
    customerPhone: phone(),
    deliveryAddress: "Old Lane 2",
    notes: `[ORDER_JSON:{"items":[{"productName":"Bad","quantity":-1}],"totalAmount":75 truncated`,
  }, IP, db);
  const saleId = `ftx_legacy_${rnd()}`;
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO financial_transactions (id, transaction_type, amount, transaction_date, payment_method, category, description, status, created_by, created_at, updated_at)
     VALUES (?, 'TIFFIN_PAYMENT', 140, ?, 'CASH', 'TIFFIN_WALKIN_SALE', ?, 'POSTED', ?, ?, ?)`,
    [saleId, legacyDay, `Dine-in Sale: 1x Thali - Guest [ORDER_JSON:{"orderType":"DINE_IN","items":[{"productName":"Thali","quantity":1,"unitPrice":140,"lineTotal":140}],"totalAmount":140,"customerName":"Legacy Guest"}]`, owner.id, now, now]
  );
  const before = await db.query<any>("SELECT id, delivery_notes FROM delivery_tasks WHERE id IN (?, ?) ORDER BY id", [goodTask.id, brokenTask.id]);
  const beforeSale = await db.queryOne<any>("SELECT description, amount FROM financial_transactions WHERE id = ?", [saleId]);

  const listedLegacy = await listUnifiedOrders(manager, { serviceDate: legacyDay }, db);
  assert(listedLegacy.orders.length === 3, `Before backfill, legacy rows are listed read-only (${listedLegacy.orders.length})`);

  const [runA, runB] = await Promise.all([backfillLegacyOrders(db), backfillLegacyOrders(db)]);
  const created = runA.deliveryOrdersCreated + runB.deliveryOrdersCreated + runA.dineInOrdersCreated + runB.dineInOrdersCreated;
  assert(
    (await count(db, "SELECT COUNT(*)::int AS n FROM orders WHERE delivery_task_id IN (?, ?) OR financial_transaction_id = ?", [goodTask.id, brokenTask.id, saleId])) === 3,
    `Two concurrent backfill runs convert each legacy row exactly once (created ${created})`
  );
  assert(runA.failures.length + runB.failures.length === 0, `Concurrent runs report no failures (${[...runA.failures, ...runB.failures].map((f) => f.error).slice(0, 2).join(" | ") || "none"})`);
  const rerun = await backfillLegacyOrders(db);
  assert(rerun.deliveryOrdersCreated === 0 && rerun.dineInOrdersCreated === 0 && rerun.failures.length === 0, "A third run is a no-op");

  const goodOrder = await db.queryOne<any>("SELECT * FROM orders WHERE delivery_task_id = ?", [goodTask.id]);
  const goodLines = await db.query<any>("SELECT product_name, quantity, unit_price FROM order_items WHERE order_id = ?", [goodOrder.id]);
  assert(
    goodOrder.source === "LEGACY_BACKFILL" && Number(goodOrder.total_amount) === 160 && goodLines.length === 1 && Number(goodLines[0].quantity) === 2,
    "Recoverable legacy delivery order converted with its items and total"
  );
  assert(goodOrder.notes === "Gate 2", "Customer note recovered without the JSON marker");
  const brokenOrder = await db.queryOne<any>("SELECT * FROM orders WHERE delivery_task_id = ?", [brokenTask.id]);
  const brokenLines = await db.query<any>("SELECT product_name FROM order_items WHERE order_id = ?", [brokenOrder.id]);
  assert(brokenLines.length === 1 && /not recorded/.test(brokenLines[0].product_name), "Malformed legacy JSON becomes a single placeholder line");
  const saleOrder = await db.queryOne<any>("SELECT * FROM orders WHERE financial_transaction_id = ?", [saleId]);
  assert(saleOrder.order_type === "DINE_IN" && Number(saleOrder.total_amount) === 140 && saleOrder.customer_name === "Legacy Guest", "Legacy counter sale converted, ledger amount preserved");

  const after = await db.query<any>("SELECT id, delivery_notes FROM delivery_tasks WHERE id IN (?, ?) ORDER BY id", [goodTask.id, brokenTask.id]);
  const afterSale = await db.queryOne<any>("SELECT description, amount FROM financial_transactions WHERE id = ?", [saleId]);
  assert(JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(beforeSale) === JSON.stringify(afterSale), "Backfill never modifies source rows");

  const listedAfter = await listUnifiedOrders(manager, { serviceDate: legacyDay }, db);
  assert(listedAfter.orders.length === 3 && listedAfter.orders.every((o) => Boolean(o.orderId)), "After backfill the same three orders are served from the orders table (no duplicates)");
  const history = await getCustomerOrderHistory(manager, { phone: legacyPhone }, db);
  assert(history.length === 1 && history[0].totalAmount === 160, "Customer history reads converted orders");

  let fkErr: any = null;
  try {
    await db.execute("DELETE FROM delivery_tasks WHERE id = ?", [goodTask.id]);
  } catch (e) {
    fkErr = e;
  }
  assert(fkErr !== null, "A delivery task referenced by an order cannot be deleted (FK RESTRICT)");

  console.log("\n================================================================================");
  console.log(`PG ORDERS RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
