/**
 * Live PostgreSQL verification of the order-to-delivery workflow (round 7):
 * menu pricing, dine-in vs delivery, automatic assignment, per-item delivery outcome,
 * amount due from delivered quantities, collection limits, balance collection,
 * duplicates/concurrency and role checks. Disposable local database only; synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createUnifiedOrder, listUnifiedOrders, getCustomerOrderHistory } from "../apps/erp/src/server/orders/orderService";
import {
  completeDeliveryTask,
  recordDeliveryCollection,
  getDeliveryTaskById,
  listDeliveryTasks,
  syncDeliveryActions,
} from "../apps/erp/src/server/delivery/deliveryService";
import { createTiffinProduct } from "../apps/erp/src/server/tiffin/tiffinService";
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
  assert(err !== null && pattern.test(err.message), `${label}${err ? ` (${err.message})` : " — NOT rejected"}`);
}

async function count(db: AsyncDb, sql: string, params: any[] = []) {
  return Number((await db.queryOne<any>(sql, params))?.n ?? 0);
}

async function main() {
  console.log("================================================================================");
  console.log("PG ORDER → DELIVERY WORKFLOW VERIFICATION (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Workflow Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Workflow Manager");
  const suresh = await insertStaff(db, "DELIVERY_PERSON", "Suresh");
  const otherDriver = await insertStaff(db, "DELIVERY_PERSON", "Other Driver");
  // The fixed delivery person is a real staff account, selected by configuration.
  process.env.ERP_DEFAULT_DELIVERY_USERNAME = suresh.username;
  const day = uniqueBusinessDate(60);

  const thali = await createTiffinProduct(owner, { code: `WF_THALI_${rnd()}`.toUpperCase(), name: "Daily Standard Tiffin", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 80 } as any, undefined, db);
  const roti = await createTiffinProduct(owner, { code: `WF_ROTI_${rnd()}`.toUpperCase(), name: "Extra Chapati / Tawa Roti", category: "EXTRA", billingUnit: "PER_PIECE", price: 8 } as any, undefined, db);
  const lassi = await createTiffinProduct(owner, { code: `WF_LASSI_${rnd()}`.toUpperCase(), name: "Sweet Punjabi Lassi", category: "BEVERAGE", billingUnit: "PER_PORTION", price: 50 } as any, undefined, db);

  const newOrder = (customerPhone: string, items: any[], extra: any = {}) =>
    createUnifiedOrder(
      manager,
      {
        orderType: "DELIVERY",
        customerName: "Workflow Customer",
        customerPhone,
        deliveryAddress: "House 5, Workflow Lane",
        serviceDate: day,
        mealType: "LUNCH",
        items,
        idempotencyKey: `wf_${rnd()}`,
        ...extra,
      } as any,
      IP,
      db
    );
  const linesOf = async (taskId: string) => (await getDeliveryTaskById(owner, taskId, db))!.task.orderLines!;

  console.log("\n--- 1. New customer, delivery order, automatic assignment ---");
  const p1 = phone();
  const o1 = await newOrder(p1, [
    { productId: thali.id, productName: "x", quantity: 2, unitPrice: 1 },
    { productId: roti.id, productName: "x", quantity: 5, unitPrice: 1 },
  ]);
  assert(o1.totalAmount === 2 * 80 + 5 * 8, `Order total from menu prices (₹${o1.totalAmount})`);
  assert(o1.assignedTo === suresh.id && o1.assignedToName === "Suresh", `Assigned automatically to Suresh (${o1.assignedToName})`);
  const custRow = await db.queryOne<any>("SELECT id FROM tiffin_customers WHERE phone = ?", [p1]);
  assert(Boolean(custRow), "New customer saved");
  const t1 = (await getDeliveryTaskById(suresh, o1.deliveryTaskId!, db))!.task;
  assert(
    t1.customerName === "Workflow Customer" && t1.customerPhone === p1 && Boolean(t1.deliveryAddress) && t1.orderLines!.length === 2 && t1.orderTotal === 200 && Boolean(t1.orderId),
    "Delivery person sees customer, phone, address, structured items, order total and order id"
  );
  const otherView = await listDeliveryTasks(otherDriver, { serviceDate: day }, db);
  assert(!otherView.some((t) => t.id === o1.deliveryTaskId), "Another delivery account does not see Suresh's delivery");

  console.log("\n--- 2. Existing customer, reuse a previous order with changed quantities ---");
  const history = await getCustomerOrderHistory(manager, { customerId: custRow.id, phone: p1 }, db);
  const past = history.find((h: any) => h.orderId === o1.orderId) as any;
  assert(Boolean(past) && past.items.length === 2, "Previous order appears in the customer's history");
  const reused = await newOrder(p1, past.items.map((it: any) => ({ productId: it.productId, productName: it.productName, quantity: it.quantity + 1, unitPrice: it.unitPrice })), { customerId: custRow.id });
  assert(reused.orderId !== o1.orderId && reused.totalAmount === 3 * 80 + 6 * 8, `Reuse creates a new order with the changed quantities (₹${reused.totalAmount})`);
  const o1After = (await listUnifiedOrders(manager, { serviceDate: day }, db)).orders.find((o) => o.orderId === o1.orderId)!;
  assert(o1After.totalAmount === 200 && o1After.items[0].quantity === 2, "The historical order is unchanged");
  assert((await count(db, "SELECT COUNT(*)::int AS n FROM orders WHERE customer_id = ? AND service_date = ?", [custRow.id, day])) === 2, "Same customer may have several orders on one day");

  console.log("\n--- 3. Dine-in never enters delivery ---");
  const dine = await createUnifiedOrder(manager, { orderType: "DINE_IN", customerName: "Counter", serviceDate: day, mealType: "DINNER", items: [{ productId: thali.id, productName: "x", quantity: 1, unitPrice: 1 }], paymentMethod: "CASH", idempotencyKey: `wf_${rnd()}` } as any, IP, db);
  assert(!dine.deliveryTaskId && dine.totalAmount === 80, "Dine-in has no delivery task (₹80 counter sale)");
  const allTasks = await listDeliveryTasks(owner, { serviceDate: day }, db);
  assert(!allTasks.some((t) => t.customerName === "Counter"), "Dine-in order is not in the delivery list");

  console.log("\n--- 4. Validation of delivery outcomes ---");
  const L1 = await linesOf(o1.deliveryTaskId!);
  const full1 = L1.map((l) => ({ orderItemId: l.orderItemId, deliveredQuantity: l.quantity, undeliveredQuantity: 0 }));
  await rejects("Missing lines rejected", () => completeDeliveryTask(suresh, o1.deliveryTaskId!, { collectedAmount: 0 }, IP, db), /every item/);
  await rejects("Missing a line rejected", () => completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: full1.slice(0, 1) }, IP, db), /every item/);
  await rejects("Negative delivered rejected", () => completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: [{ ...full1[0], deliveredQuantity: -1, undeliveredQuantity: undefined as any }, full1[1]] }, IP, db), /0 or more/);
  await rejects("Delivered above ordered rejected", () => completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: [{ ...full1[0], deliveredQuantity: 3, undeliveredQuantity: undefined as any }, full1[1]] }, IP, db), /cannot be more/);
  await rejects("Delivered + undelivered ≠ ordered rejected", () => completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: [{ ...full1[0], deliveredQuantity: 1, undeliveredQuantity: 0 }, full1[1]] }, IP, db), /add up/);
  await rejects("Shortfall without reason rejected", () => completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: [{ ...full1[0], deliveredQuantity: 1, undeliveredQuantity: 1 }, full1[1]] }, IP, db), /reason is required/);
  await rejects("Unknown line rejected", () => completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: [{ orderItemId: "oi_fake", deliveredQuantity: 1 }, full1[1]] }, IP, db), /do not match/);
  await rejects("Collected above due rejected", () => completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: full1, collectedAmount: 201, paymentMethod: "CASH" }, IP, db), /cannot be more than the amount due/);
  await rejects("Negative collection rejected", () => completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: full1, collectedAmount: -5 }, IP, db), /0 or more/);
  await rejects("Another driver cannot complete it", () => completeDeliveryTask(otherDriver, o1.deliveryTaskId!, { lines: full1 }, IP, db), /not assigned/);
  assert((await getDeliveryTaskById(owner, o1.deliveryTaskId!, db))!.task.status !== "DELIVERED", "Rejected attempts changed nothing");

  console.log("\n--- 5. Fully delivered, fully paid; duplicate and concurrent completion ---");
  const key1 = `del_${rnd()}`;
  const results = await Promise.allSettled([1, 2, 3].map(() => completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: full1, recipientName: "Front desk", collectedAmount: 200, paymentMethod: "CASH", idempotencyKey: key1 }, IP, db)));
  assert(results.every((r) => r.status === "fulfilled"), "Three concurrent submissions all succeed");
  assert((await count(db, "SELECT COUNT(*)::int AS n FROM delivery_task_events WHERE task_id = ? AND event_type = 'DELIVERED'", [o1.deliveryTaskId])) === 1, "Exactly one delivery event recorded");
  const d1 = (await getDeliveryTaskById(owner, o1.deliveryTaskId!, db))!.task;
  assert(d1.status === "DELIVERED" && d1.expectedAmount === 200 && d1.collectedAmount === 200 && d1.balanceDue === 0, `Fully delivered and fully paid (due ₹${d1.expectedAmount}, balance ₹${d1.balanceDue})`);
  const lo1 = (await listUnifiedOrders(manager, { serviceDate: day }, db)).orders.find((o) => o.orderId === o1.orderId)!;
  assert(lo1.deliveryOutcome === "FULL" && lo1.paymentStatus === "PAID" && lo1.remainingAmount === 0, "Orders list: delivered in full, paid");
  assert((await db.queryOne<any>("SELECT status FROM orders WHERE id = ?", [o1.orderId])).status === "COMPLETED", "Order lifecycle moved to COMPLETED");
  const again = await completeDeliveryTask(suresh, o1.deliveryTaskId!, { lines: full1, recipientName: "Front desk", collectedAmount: 200, paymentMethod: "CASH" }, IP, db);
  assert(again.collectedAmount === 200, "Repeat after completion is a no-op (no second collection)");

  console.log("\n--- 6. Partly delivered, part paid, then the balance ---");
  const o2 = await newOrder(phone(), [
    { productId: thali.id, productName: "x", quantity: 2, unitPrice: 1 },
    { productId: lassi.id, productName: "x", quantity: 2, unitPrice: 1 },
  ]);
  const L2 = await linesOf(o2.deliveryTaskId!);
  const partial = L2.map((l) => ({ orderItemId: l.orderItemId, deliveredQuantity: l.productName.includes("Lassi") ? 1 : 2, undeliveredQuantity: l.productName.includes("Lassi") ? 1 : 0, ...(l.productName.includes("Lassi") ? { disposition: "RETURNED" as const } : {}) }));
  const d2 = await completeDeliveryTask(suresh, o2.deliveryTaskId!, { lines: partial, undeliveredReason: "Customer took fewer", recipientName: "Front desk", collectedAmount: 150, paymentMethod: "CASH", idempotencyKey: `del_${rnd()}` }, IP, db);
  assert(d2.expectedAmount === 2 * 80 + 1 * 50, `Due from delivered quantities × saved prices (₹${d2.expectedAmount}, not the ₹260 ordered)`);
  assert(d2.collectedAmount === 150 && d2.balanceDue === 60, `Collected ₹150, balance ₹${d2.balanceDue}`);
  const stored2 = await db.query<any>("SELECT delivered_quantity, undelivered_reason FROM order_items WHERE order_id = ? ORDER BY line_no", [o2.orderId]);
  assert(stored2.map((r) => Number(r.delivered_quantity)).join(",") === "2,1" && stored2[1].undelivered_reason === "Customer took fewer" && stored2[0].undelivered_reason === null, "Per-item delivered quantities and reason stored");
  const lo2 = (await listUnifiedOrders(manager, { serviceDate: day }, db)).orders.find((o) => o.orderId === o2.orderId)!;
  assert(lo2.deliveryOutcome === "PARTIAL" && lo2.paymentStatus === "PARTIALLY_PAID" && lo2.remainingAmount === 60 && lo2.amountDue === 210, "Orders list: partly delivered, ₹60 pending");
  await rejects("Balance above outstanding rejected", () => recordDeliveryCollection(suresh, o2.deliveryTaskId!, { collectedAmount: 61, paymentMethod: "CASH" }, IP, db), /Only ₹60 is outstanding/);
  // Each payment is its own ledger entry, so the balance may be paid by a different method.
  const upiPart = await recordDeliveryCollection(suresh, o2.deliveryTaskId!, { collectedAmount: 10, paymentMethod: "UPI", idempotencyKey: `upi_${rnd()}` }, IP, db);
  assert(upiPart.collectedAmount === 160 && upiPart.balanceDue === 50, `A ₹10 UPI part-payment after ₹150 cash is accepted (collected ₹${upiPart.collectedAmount}, balance ₹${upiPart.balanceDue})`);
  const balKey = `bal_${rnd()}`;
  const balRuns = await Promise.allSettled([1, 2].map(() => recordDeliveryCollection(suresh, o2.deliveryTaskId!, { collectedAmount: 40, paymentMethod: "CASH", idempotencyKey: balKey }, IP, db)));
  const afterBal = (await getDeliveryTaskById(owner, o2.deliveryTaskId!, db))!.task;
  assert(balRuns.every((r) => r.status === "fulfilled") && afterBal.collectedAmount === 200 && afterBal.balanceDue === 10, `Duplicate balance payment counted once (collected ₹${afterBal.collectedAmount}, balance ₹${afterBal.balanceDue})`);
  const race = await Promise.allSettled([1, 2].map(() => recordDeliveryCollection(manager, o2.deliveryTaskId!, { collectedAmount: 10, paymentMethod: "CASH", idempotencyKey: `bal_${rnd()}` }, IP, db)));
  const finalBal = (await getDeliveryTaskById(owner, o2.deliveryTaskId!, db))!.task;
  assert(race.filter((r) => r.status === "fulfilled").length === 1 && finalBal.collectedAmount === 210 && finalBal.balanceDue === 0, `Two concurrent final payments: one accepted, never over-collected (₹${finalBal.collectedAmount})`);

  console.log("\n--- 7. Delivered, nothing collected yet: delivery ≠ payment ---");
  const o3 = await newOrder(phone(), [{ productId: thali.id, productName: "x", quantity: 1, unitPrice: 1 }]);
  const L3 = await linesOf(o3.deliveryTaskId!);
  const d3 = await completeDeliveryTask(suresh, o3.deliveryTaskId!, { lines: [{ orderItemId: L3[0].orderItemId, deliveredQuantity: 1, undeliveredQuantity: 0 }], recipientName: "Front desk", collectedAmount: 0 }, IP, db);
  const lo3 = (await listUnifiedOrders(manager, { serviceDate: day }, db)).orders.find((o) => o.orderId === o3.orderId)!;
  assert(d3.status === "DELIVERED" && d3.collectionStatus === "NONE" && d3.balanceDue === 80 && lo3.paymentStatus === "PENDING", "Delivered but unpaid shows ₹80 pending (not paid)");

  console.log("\n--- 8. Not delivered at all ---");
  const o4 = await newOrder(phone(), [{ productId: thali.id, productName: "x", quantity: 2, unitPrice: 1 }]);
  const L4 = await linesOf(o4.deliveryTaskId!);
  const none = [{ orderItemId: L4[0].orderItemId, deliveredQuantity: 0, undeliveredQuantity: 2, disposition: "RETURNED" as const }];
  await rejects("Nothing delivered without reason rejected", () => completeDeliveryTask(suresh, o4.deliveryTaskId!, { lines: none }, IP, db), /reason is required/);
  await rejects("Collection with nothing delivered rejected", () => completeDeliveryTask(suresh, o4.deliveryTaskId!, { lines: none, undeliveredReason: "Customer not available", collectedAmount: 10, paymentMethod: "CASH" }, IP, db), /cannot be more than the amount due/);
  const d4 = await completeDeliveryTask(suresh, o4.deliveryTaskId!, { lines: none, undeliveredReason: "Customer not available" }, IP, db);
  const lo4 = (await listUnifiedOrders(manager, { serviceDate: day }, db)).orders.find((o) => o.orderId === o4.orderId)!;
  assert(d4.status === "EXCEPTION" && d4.exceptionReason === "Customer not available" && d4.expectedAmount === 0 && lo4.deliveryOutcome === "NONE", "Recorded as not delivered with reason; nothing due");
  const dup4 = await completeDeliveryTask(suresh, o4.deliveryTaskId!, { lines: none, undeliveredReason: "Customer not available" }, IP, db);
  assert(dup4.status === "EXCEPTION", "Repeating the not-delivered submission is accepted as the same outcome");
  const replay = await syncDeliveryActions(suresh, [{ id: `q_${rnd()}`, action: "COMPLETE_DELIVERY", userId: suresh.id, taskId: o4.deliveryTaskId!, payload: { lines: none, undeliveredReason: "Customer not available" }, idempotencyKey: `q_${rnd()}`, createdAt: new Date().toISOString(), status: "PENDING", retryCount: 0 } as any], IP, db);
  assert(replay.results[0]?.success === true, "Offline replay of the same not-delivered outcome is not reported as a conflict");

  console.log("\n--- 9. Offline replay carries per-item quantities ---");
  const o5 = await newOrder(phone(), [{ productId: roti.id, productName: "x", quantity: 4, unitPrice: 1 }]);
  const L5 = await linesOf(o5.deliveryTaskId!);
  await syncDeliveryActions(suresh, [{ id: `q_${rnd()}`, action: "COMPLETE_DELIVERY", userId: suresh.id, taskId: o5.deliveryTaskId!, payload: { lines: [{ orderItemId: L5[0].orderItemId, deliveredQuantity: 3, undeliveredQuantity: 1, disposition: "DISCARDED" }], undeliveredReason: "Damaged in transit", recipientName: "Front desk", collectedAmount: 24, paymentMethod: "CASH" }, idempotencyKey: `q_${rnd()}`, createdAt: new Date().toISOString(), status: "PENDING", retryCount: 0 } as any], IP, db);
  const d5 = (await getDeliveryTaskById(owner, o5.deliveryTaskId!, db))!.task;
  assert(d5.status === "DELIVERED" && d5.orderLines![0].deliveredQuantity === 3 && d5.collectedAmount === 24 && d5.balanceDue === 0, "Synced completion stored 3 of 4 delivered and ₹24 collected");

  console.log("\n--- 10. Roles ---");
  await rejects("Delivery person cannot create orders", () => createUnifiedOrder(suresh, { orderType: "DELIVERY", customerName: "X", customerPhone: phone(), deliveryAddress: "Somewhere 1", serviceDate: day, mealType: "LUNCH", items: [{ productId: thali.id, productName: "x", quantity: 1, unitPrice: 80 }] } as any, IP, db), /denied|permission/i);
  const ownerOrder = await newOrder(phone(), [{ productId: thali.id, productName: "x", quantity: 1, unitPrice: 1 }]);
  assert(Boolean(ownerOrder.orderId), "Manager can create orders");
  const ownerMade = await createUnifiedOrder(owner, { orderType: "DELIVERY", customerName: "Owner Customer", customerPhone: phone(), deliveryAddress: "Owner Street 2", serviceDate: day, mealType: "DINNER", items: [{ productId: lassi.id, productName: "x", quantity: 1, unitPrice: 1 }], idempotencyKey: `wf_${rnd()}` } as any, IP, db);
  assert(ownerMade.assignedTo === suresh.id, "Owner can create orders; also assigned to Suresh");

  console.log(`\nORDER→DELIVERY WORKFLOW RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
  await closePg();
  process.exit(state.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  try {
    await closePg();
  } catch {}
  process.exit(1);
});
