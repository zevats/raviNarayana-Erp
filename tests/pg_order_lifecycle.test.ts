/**
 * Live PostgreSQL verification of order editing and cancellation (Phase 4, migration 0019):
 * edits before the delivery is attempted (agreed prices kept, new items priced by the server,
 * revisions kept, the driver's stop updated), refusal after delivery / payment / for dine-in,
 * the cutoff override, and cancellation (paid orders cannot be cancelled — Owner decision).
 * Disposable local database only (RN_PG_VERIFY_URL); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import { updateDeliveryOrder, cancelOrder, listOrderRevisions } from "../apps/erp/src/server/orders/orderLifecycleService";
import { getDeliveryTaskById, completeDeliveryTask } from "../apps/erp/src/server/delivery/deliveryService";
import { createTiffinProduct, updateTiffinProduct } from "../apps/erp/src/server/tiffin/tiffinService";
import { AuthenticatedUser } from "../apps/erp/src/types";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff, uniqueBusinessDate } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;
const at = (date: string, hhmm: string) => ({ now: new Date(`${date}T${hhmm}:00+05:30`) });

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
  console.log("PG ORDER EDIT AND CANCEL (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  await db.execute("UPDATE staff_users SET is_active = 0 WHERE role = 'DELIVERY_PERSON' AND id LIKE 'stf_verify_%'");
  const owner = await insertStaff(db, "SUPER_ADMIN", "Lifecycle Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Lifecycle Manager");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "Lifecycle Driver");
  process.env.ERP_DEFAULT_DELIVERY_USERNAME = driver.username;
  const day = uniqueBusinessDate(700);
  const thali = await createTiffinProduct(owner, { code: `OL_${rnd()}`.toUpperCase(), name: "Lifecycle Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 100 } as any, undefined, db);
  const roti = await createTiffinProduct(owner, { code: `OR_${rnd()}`.toUpperCase(), name: "Lifecycle Roti", category: "EXTRA", billingUnit: "PER_PIECE", price: 10 } as any, undefined, db);
  const order = async (actor: AuthenticatedUser = manager, type: "DELIVERY" | "DINE_IN" = "DELIVERY") =>
    createUnifiedOrder(actor, {
      orderType: type, customerName: `Lifecycle ${rnd()}`, customerPhone: phone(), deliveryAddress: type === "DELIVERY" ? "Old Lane 1" : undefined,
      serviceDate: day, mealType: "LUNCH", items: [{ productId: thali.id, productName: "x", quantity: 2, unitPrice: 1 }], idempotencyKey: `ol_${rnd()}`, paymentMethod: "CASH",
    } as any, IP, db);

  console.log("\n--- 1. Change an order before it is delivered ---");
  const o1 = await order();
  await updateTiffinProduct(owner, thali.id, { price: 130 } as any, IP, db);
  await rejects("Delivery staff cannot change orders", () => updateDeliveryOrder(driver, o1.orderId!, { notes: "x" }, IP, db), /permission|denied|forbidden/i);
  const res = await updateDeliveryOrder(manager, o1.orderId!, { items: [{ productId: thali.id, quantity: 3 }, { productId: roti.id, quantity: 4 }], deliveryAddress: "New Lane 22", reason: "Customer called" }, IP, db);
  assert(res.changed && res.changes.some((c) => /items/.test(c)) && res.changes.includes("address"), "Items and address changed");
  const after = await db.queryOne<any>("SELECT total_amount, total_quantity, delivery_address, revision FROM orders WHERE id = ?", [o1.orderId!]);
  assert(Number(after.total_amount) === 3 * 100 + 4 * 10 && Number(after.total_quantity) === 7, `Thali keeps its agreed ₹100 (menu now ₹130); new roti priced ₹10 from the menu: total ₹${after.total_amount}`);
  assert(after.delivery_address === "New Lane 22" && Number(after.revision) === 1, "Order shows the new address and revision 1");
  const revs = await listOrderRevisions(manager, o1.orderId!, db);
  assert(revs.length === 1 && revs[0].snapshot.totalAmount === 200 && revs[0].snapshot.items[0].quantity === 2 && revs[0].reason === "Customer called", "The previous version (2 thalis, ₹200) and the reason are kept");
  const t1 = (await getDeliveryTaskById(owner, o1.deliveryTaskId!, db))!;
  assert(t1.task.deliveryAddress === "New Lane 22" && t1.task.orderLines?.length === 2 && t1.task.expectedAmount === 340, "The driver's stop has the new lines, address and ₹340 due");
  assert(t1.events.some((e) => e.eventType === "UPDATED" && /Order changed/.test(e.notes || "")), "The change is in the stop's timeline");
  const unchanged = await updateDeliveryOrder(manager, o1.orderId!, { deliveryAddress: "New Lane 22" }, IP, db);
  assert(!unchanged.changed && (await listOrderRevisions(manager, o1.orderId!, db)).length === 1, "Saving the same values adds no revision");

  console.log("\n--- 2. Stale lines, delivery and payment end editing ---");
  const oldLineId = `${o1.orderId}_l1`;
  await rejects("A completion sent for the old lines is refused", () => completeDeliveryTask(driver, o1.deliveryTaskId!, { lines: [{ lineId: oldLineId, deliveredQuantity: 2 }], recipientName: "Gate", collectedAmount: 0, idempotencyKey: `ol_stale_${rnd()}` } as any, IP, db), /line|item|match|not part/i);
  await completeDeliveryTask(driver, o1.deliveryTaskId!, {
    lines: t1.task.orderLines!.map((l) => ({ orderItemId: l.orderItemId, deliveredQuantity: l.quantity, undeliveredQuantity: 0 })),
    recipientName: "Gate", collectedAmount: 340, paymentMethod: "CASH", idempotencyKey: `ol_done_${rnd()}`,
  } as any, IP, db);
  await rejects("A delivered and paid order cannot be changed", () => updateDeliveryOrder(manager, o1.orderId!, { notes: "late" }, IP, db), /attempted|collected|complete/i);
  await rejects("A paid order cannot be cancelled", () => cancelOrder(manager, o1.orderId!, { reason: "Changed mind" }, IP, db), /collected|delivered/i);
  const dine = await order(manager, "DINE_IN");
  await rejects("A dine-in order (paid at the counter) cannot be changed", () => updateDeliveryOrder(manager, dine.orderId!, { notes: "x" }, IP, db), /dine-in/i);
  await rejects("A dine-in order cannot be cancelled", () => cancelOrder(manager, dine.orderId!, { reason: "Wrong table" }, IP, db), /dine-in/i);

  console.log("\n--- 3. Cutoff ---");
  const o2 = await order();
  await rejects("After the lunch cutoff a change needs the override", () => updateDeliveryOrder(manager, o2.orderId!, { notes: "Extra spicy" }, IP, db, at(day, "09:00")), /cutoff/);
  const late = await updateDeliveryOrder(manager, o2.orderId!, { notes: "Extra spicy", overrideCutoff: true, reason: "Owner agreed" }, IP, db, at(day, "09:00"));
  assert(late.changed, "With the Manager override and a reason the change is saved");

  console.log("\n--- 4. Cancel ---");
  await rejects("Cancelling needs a reason", () => cancelOrder(manager, o2.orderId!, { reason: "" }, IP, db), /reason/i);
  await rejects("After the cutoff cancelling needs the override", () => cancelOrder(manager, o2.orderId!, { reason: "Customer away" }, IP, db, at(day, "09:00")), /cutoff|override/i);
  await cancelOrder(manager, o2.orderId!, { reason: "Customer away" }, IP, db);
  const c = await db.queryOne<any>("SELECT o.status, o.cancel_reason, o.cancelled_by, t.status AS task_status FROM orders o JOIN delivery_tasks t ON t.id = o.delivery_task_id WHERE o.id = ?", [o2.orderId!]);
  assert(c.status === "CANCELLED" && c.task_status === "CANCELLED" && c.cancel_reason === "Customer away" && c.cancelled_by === manager.id, "Order and delivery cancelled; who and why are on the order");
  const again = await cancelOrder(manager, o2.orderId!, { reason: "again" }, IP, db);
  assert(again.alreadyCancelled === true, "Cancelling twice is harmless");
  await rejects("A cancelled order cannot be changed", () => updateDeliveryOrder(manager, o2.orderId!, { notes: "x" }, IP, db), /cancelled/i);
  const kept = await db.queryOne<any>("SELECT COUNT(*) AS n FROM orders WHERE id = ?", [o2.orderId!]);
  assert(Number(kept.n) === 1, "The cancelled order is kept, not deleted");

  console.log(`\nPG ORDER LIFECYCLE: ${state.passed} PASSED, ${state.failed} FAILED`);
  await closePg();
  process.exit(state.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await closePg().catch(() => {});
  process.exit(1);
});
