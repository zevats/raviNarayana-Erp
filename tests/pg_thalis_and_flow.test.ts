/**
 * Owner decisions of 2026-11-12, against a live disposable PostgreSQL database:
 *   1. No waiting phase: a delivery is out for delivery the moment it has someone to take it.
 *   2. Cash the owner collects needs no handover: it is with the owner already (cashbook at once).
 *   3. Thalis at the door: more than ordered is charged on the order; fewer are brought back or
 *      damaged; what staff carry is handed in to the PG and checked; spare thalis are given out again.
 *   4. Corporate customers: company, contact person and phone, default thali.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createTiffinCustomer, createTiffinProduct, updateTiffinCustomer } from "../apps/erp/src/server/tiffin/tiffinService";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import { completeDeliveryTask, assignDeliveryTask, batchAssignDeliveryTasks, getStaffCustodyDetail } from "../apps/erp/src/server/delivery/deliveryService";
import { getReceivableAccount } from "../apps/erp/src/server/finance/receivablesService";
import { getThaliSummary, declareThaliReturn, verifyThaliReturn, reportThaliDamage, issueSpareThalis, staffHolding } from "../apps/erp/src/server/delivery/thaliService";
import { getBusinessDateString } from "../apps/erp/src/server/finance/financeService";
import { AuthenticatedUser } from "../apps/erp/src/types";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff } from "./helpers/pgVerifyTarget";

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
  console.log("THALIS, NO WAITING, OWNER CASH, CORPORATE CUSTOMERS (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "T8 Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "T8 Manager");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "T8 Driver");
  const driver2 = await insertStaff(db, "DELIVERY_PERSON", "T8 Driver Two");
  const today = getBusinessDateString(new Date());
  const thali = await createTiffinProduct(owner, { code: `T8T_${rnd()}`.toUpperCase(), name: "T8 Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 120 } as any, undefined, db);
  const roti = await createTiffinProduct(owner, { code: `T8R_${rnd()}`.toUpperCase(), name: "T8 Roti", category: "ADD_ON", billingUnit: "PER_ITEM", price: 10 } as any, undefined, db).catch(() => null);
  const customer = async (name: string) => (await createTiffinCustomer(manager, { fullName: `${name} ${rnd()}`, phone: phone(), deliveryAddress: "T8 Lane, Sector 8" } as any, IP, db)) as any;
  const order = async (by: AuthenticatedUser, cust: any, qty: number, assignTo?: string) =>
    (await createUnifiedOrder(by, {
      orderType: "DELIVERY", customerId: cust.id, customerName: cust.fullName, customerPhone: cust.phone, deliveryAddress: "T8 Lane, Sector 8",
      serviceDate: today, mealType: "DINNER", items: [{ productId: thali.id, productName: "T8 Thali", quantity: qty, unitPrice: 120 }], idempotencyKey: `t8o_${rnd()}`,
      ...(assignTo ? { assignToStaffId: assignTo } : {}),
    } as any, IP, db)) as any;
  const status = async (taskId: string) => (await db.queryOne<any>("SELECT status FROM delivery_tasks WHERE id = ?", [taskId])).status as string;
  const item = async (orderId: string) => db.queryOne<any>("SELECT id, quantity, line_total, delivered_quantity FROM order_items WHERE order_id = ?", [orderId]);
  const deliver = async (who: AuthenticatedUser, o: any, delivered: number, extra: Record<string, any> = {}, pay: Record<string, any> = { paymentChoice: "PAY_LATER" }) => {
    const it = await item(o.orderId);
    return completeDeliveryTask(who, o.deliveryTaskId, { recipientName: "Customer", lines: [{ orderItemId: it.id, deliveredQuantity: delivered, ...extra }], idempotencyKey: `t8d_${rnd()}`, ...pay } as any, IP, db);
  };

  // ---------------------------------------------------------------------------
  console.log("\n--- 1. No waiting phase ---");
  const c1 = await customer("T8 Out");
  const o1 = await order(manager, c1, 1, driver.id);
  assert((await status(o1.deliveryTaskId)) === "OUT_FOR_DELIVERY", "An order taken and given to a delivery person is out for delivery at once");
  await assignDeliveryTask(manager, o1.deliveryTaskId, { assignedToStaffId: driver2.id }, IP, db);
  assert((await status(o1.deliveryTaskId)) === "OUT_FOR_DELIVERY", "Giving it to someone else keeps it out for delivery (no waiting again)");
  const o1b = await order(manager, c1, 1, driver.id);
  await batchAssignDeliveryTasks(manager, { taskIds: [o1b.deliveryTaskId], assignedToStaffId: driver2.id }, IP, db);
  assert((await status(o1b.deliveryTaskId)) === "OUT_FOR_DELIVERY", "Assigning several at once also sends them out at once");
  const events = await num(db, "SELECT COUNT(*) AS n FROM delivery_task_events WHERE task_id = ? AND event_type = 'DISPATCHED'", [o1.deliveryTaskId]);
  assert(events >= 1, "The timeline records that it went out");

  // ---------------------------------------------------------------------------
  console.log("\n--- 2. The owner's own cash needs no handover ---");
  const c2 = await customer("T8 Owner Cash");
  const o2 = await order(manager, c2, 2, owner.id);
  const cashBefore = await num(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM financial_transactions WHERE category = 'TIFFIN_DELIVERY_COLLECTION' AND status = 'POSTED'");
  await deliver(owner, o2, 2, {}, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 240 });
  const ownerDetail = await getStaffCustodyDetail(owner, owner.id, db);
  const declared = ownerDetail.handovers.filter((h: any) => h.status === "DECLARED").length;
  const cashAfter = await num(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM financial_transactions WHERE category = 'TIFFIN_DELIVERY_COLLECTION' AND status = 'POSTED'");
  assert(declared === 0 && ownerDetail.custody.cashUndeclared === 0, "Nothing waits for approval and nothing is left to hand over");
  assert(cashAfter - cashBefore === 240, `The ₹240 the owner collected is in the cashbook at once (₹${cashAfter - cashBefore})`);
  assert((await getReceivableAccount(owner, `C:${c2.id}`, db)).totals.total === 0, "The customer owes nothing");
  const c2b = await customer("T8 Driver Cash");
  const o2b = await order(manager, c2b, 1, driver.id);
  await deliver(driver, o2b, 1, {}, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 120 });
  assert((await getStaffCustodyDetail(manager, driver.id, db)).custody.cashUndeclared === 120, "A delivery person's cash still waits to be handed over as before");

  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Thalis at the door ---");
  const c3 = await customer("T8 Extra");
  const o3 = await order(manager, c3, 2, driver.id);
  await deliver(driver, o3, 3, {}, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 360 });
  const it3 = await item(o3.orderId);
  const ord3 = await db.queryOne<any>("SELECT total_amount, total_quantity FROM orders WHERE id = ?", [o3.orderId]);
  assert(Number(it3.quantity) === 3 && Number(it3.delivered_quantity) === 3 && Number(it3.line_total) === 360, "One more than ordered: the order line becomes 3 thalis, ₹360");
  assert(Number(ord3.total_amount) === 360 && Number(ord3.total_quantity) === 3, "The order total includes the extra (₹360)");
  assert((await getReceivableAccount(owner, `C:${c3.id}`, db)).totals.total === 0, "₹360 collected at the door settles it exactly");
  assert((await num(db, "SELECT COUNT(*) AS n FROM thali_moves WHERE kind = 'EXTRA' AND order_id = ? AND quantity = 1", [o3.orderId])) === 1, "The extra thali is recorded");
  const c3b = await customer("T8 Extra Later");
  const o3b = await order(manager, c3b, 1, driver.id);
  await deliver(driver, o3b, 2);
  assert((await getReceivableAccount(owner, `C:${c3b.id}`, db)).totals.total === 240, "An extra on Pay Later is owed too (₹240 for 2)");
  const o3c = await order(manager, c3b, 1, driver.id);
  assert((await refused(() => deliver(driver, o3c, 30)))?.includes("at most 21") === true, "No more than 20 extra on one item");

  const c4 = await customer("T8 Short");
  const o4 = await order(manager, c4, 3, driver2.id);
  const before2 = await staffHolding(db, driver2.id);
  await deliver(driver2, o4, 1, { undeliveredQuantity: 2, reason: "Took fewer", disposition: "WITH_STAFF" });
  assert((await staffHolding(db, driver2.id)) - before2 === 2, "Two not delivered and brought back: the delivery person holds 2 thalis");
  assert((await getReceivableAccount(owner, `C:${c4.id}`, db)).totals.total === 120, "The customer owes only for the 1 delivered (₹120)");
  const c5 = await customer("T8 Damaged");
  const o5 = await order(manager, c5, 2, driver2.id);
  await deliver(driver2, o5, 1, { undeliveredQuantity: 1, reason: "Damaged in transit", disposition: "DISCARDED" });
  assert((await staffHolding(db, driver2.id)) - before2 === 2, "A damaged thali is a loss, not something the delivery person holds");
  assert((await num(db, "SELECT COUNT(*) AS n FROM thali_moves WHERE kind = 'DAMAGED' AND order_id = ?", [o5.orderId])) === 1, "The damaged thali is recorded");
  const c6 = await customer("T8 Reuse");
  const o6 = await order(manager, c6, 1, driver2.id);
  await deliver(driver2, o6, 2, {}, { paymentChoice: "CASH", paymentMethod: "CASH", collectedAmount: 240 });
  assert((await staffHolding(db, driver2.id)) - before2 === 1, "An extra delivered comes out of the thalis carried (2 → 1)");

  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Handing thalis in to the PG ---");
  const held = await staffHolding(db, driver2.id);
  assert((await refused(() => declareThaliReturn(driver2, { quantity: held + 5 }, IP, db)))?.includes("Only") === true, "Cannot hand in more than carried");
  const ret = await declareThaliReturn(driver2, { quantity: held, note: "End of shift" }, IP, db);
  assert(ret.status === "PENDING" && (await staffHolding(db, driver2.id)) === 0, "Handed in: waiting to be checked, nothing left with the delivery person");
  assert((await refused(() => verifyThaliReturn(driver2, ret.id, { receivedQuantity: held }, IP, db))) !== null, "Delivery staff cannot check their own return");
  const stockBefore = (await getThaliSummary(manager, db)).stock;
  if (held >= 2) {
    assert((await refused(() => verifyThaliReturn(manager, ret.id, { receivedQuantity: held - 1 }, IP, db)))?.includes("missing") === true, "Receiving fewer needs a reason");
    await verifyThaliReturn(manager, ret.id, { receivedQuantity: held - 1, note: "One missing" }, IP, db);
    assert((await staffHolding(db, driver2.id)) === 1, "The thali not received stays with the delivery person");
    assert((await getThaliSummary(manager, db)).stock - stockBefore === held - 1, "What was received joins the PG's spare stock");
  } else {
    await verifyThaliReturn(manager, ret.id, { receivedQuantity: held }, IP, db);
    assert((await getThaliSummary(manager, db)).stock - stockBefore === held, "What was received joins the PG's spare stock");
  }
  assert((await refused(() => verifyThaliReturn(manager, ret.id, { receivedQuantity: 0 }, IP, db)))?.includes("already") === true, "A return is checked once");
  const mine = await getThaliSummary(driver2, db);
  assert(mine.staff.length <= 1 && mine.stock === 0 && mine.recent.every((m) => m.staffId === driver2.id), "A delivery person sees only their own thalis");

  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Spare thalis used again, damage, the owner's own ---");
  const stock = (await getThaliSummary(manager, db)).stock;
  assert((await refused(() => issueSpareThalis(manager, { staffId: driver.id, quantity: stock + 1 }, IP, db)))?.includes("spare") === true, "Cannot give more spare thalis than the PG has");
  if (stock > 0) {
    const h0 = await staffHolding(db, driver.id);
    await issueSpareThalis(manager, { staffId: driver.id, quantity: 1 }, IP, db);
    assert((await staffHolding(db, driver.id)) === h0 + 1 && (await getThaliSummary(manager, db)).stock === stock - 1, "A spare thali given out: the PG has one less, the delivery person one more");
    assert((await refused(() => reportThaliDamage(driver, { quantity: 1, note: "" }, IP, db)))?.includes("what happened") === true, "Damage needs a note");
    await reportThaliDamage(driver, { quantity: 1, note: "Dropped" }, IP, db);
    assert((await staffHolding(db, driver.id)) === h0, "A damaged thali leaves what is carried");
  }
  assert((await refused(() => issueSpareThalis(driver, { staffId: driver.id, quantity: 1 }, IP, db))) !== null, "Delivery staff cannot give out spare thalis");
  const c7 = await customer("T8 Owner Short");
  const o7 = await order(manager, c7, 2, owner.id);
  await deliver(owner, o7, 1, { undeliveredQuantity: 1, reason: "Took fewer", disposition: "WITH_STAFF" });
  const ownRet = await declareThaliReturn(owner, { quantity: 1 }, IP, db);
  assert(ownRet.status === "VERIFIED" && ownRet.verifiedQuantity === 1, "The owner's own thali is accepted into stock at once");

  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Corporate customers ---");
  assert(
    (await refused(() => createTiffinCustomer(manager, { fullName: `T8 Corp ${rnd()}`, phone: phone(), deliveryAddress: "Plot 8, Industrial Area", customerType: "CORPORATE", contactPerson: "S" } as any, IP, db)))?.includes("contact person") === true,
    "A contact person's name needs at least 2 letters"
  );
  const corp: any = await createTiffinCustomer(manager, { fullName: `T8 Industries ${rnd()}`, phone: phone(), deliveryAddress: "Plot 8, Industrial Area", customerType: "CORPORATE", contactPerson: "Suresh (canteen)", defaultProductId: thali.id } as any, IP, db);
  assert(corp.customerType === "CORPORATE" && corp.contactPerson === "Suresh (canteen)" && corp.defaultProductId === thali.id, "Company, contact person and default thali are saved");
  assert((await refused(() => updateTiffinCustomer(manager, corp.id, { defaultProductId: "prod_missing" } as any, IP, db)))?.includes("not on the menu") === true, "A default thali must be on the menu");
  const changed: any = await updateTiffinCustomer(manager, corp.id, { contactPerson: "Ramesh" } as any, IP, db);
  assert(changed.contactPerson === "Ramesh" && changed.defaultProductId === thali.id, "The contact person can be changed; the default thali stays");
  const ind: any = await createTiffinCustomer(manager, { fullName: `T8 Person ${rnd()}`, phone: phone(), deliveryAddress: "T8 Lane, Sector 8", contactPerson: "ignored" } as any, IP, db);
  assert(ind.contactPerson === null, "An individual has no contact person");
  const o8: any = await createUnifiedOrder(manager, {
    orderType: "DELIVERY", customerId: corp.id, customerName: corp.fullName, customerPhone: corp.phone, deliveryAddress: "Plot 8, Industrial Area",
    serviceDate: today, mealType: "LUNCH", items: [{ productId: thali.id, productName: "T8 Thali", quantity: 4, unitPrice: 120 }], idempotencyKey: `t8c_${rnd()}`,
  } as any, IP, db);
  assert(Number((await db.queryOne<any>("SELECT total_amount FROM orders WHERE id = ?", [o8.orderId])).total_amount) === 480, "Ordering for the company is priced from the menu as usual (4 × ₹120)");
  void roti;

  console.log("\n================================================================================");
  console.log(`THALIS AND FLOW RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
