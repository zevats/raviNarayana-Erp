/**
 * Live PostgreSQL verification of delivery operations (round 11, migration 0014):
 * lunch/dinner delivery lists (automatic on open after 08:00 / 15:30, manual, repeated, concurrent,
 * database uniqueness), subscription eligibility and pauses, skip / extra today, resident room
 * delivery, assignment carry-over with several delivery staff, item lines with per-item reason and
 * disposition, recipient name, partial and failed outcomes, cancellation cutoff with Manager
 * override, retry and resolution, monthly billing without doorstep payment, order amount due,
 * collections, handover cashbook date, offline queue staff isolation, role restrictions,
 * fixed totals and order/delivery status consistency.
 * Disposable local database only (RN_PG_VERIFY_URL); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import {
  completeDeliveryTask,
  getDeliveryTaskById,
  listDeliveryTasks,
  batchAssignDeliveryTasks,
  assignDeliveryTask,
  retryDeliveryTask,
  recordDeliveryCollection,
  createCashHandoverDeclaration,
  acceptCashHandover,
  syncDeliveryActions,
  generateDeliveryTasks,
} from "../apps/erp/src/server/delivery/deliveryService";
import {
  getManifestStatus,
  prepareDeliveryManifest,
  cancelDeliveryTask,
  resolveDeliveryProblem,
  listSubscriptionDay,
  setSubscriptionDayOverride,
  listResidentMealDelivery,
  setResidentRoomDelivery,
  setResidentDaySkip,
  getDeliveryCloseout,
  getDeliveryHistory,
} from "../apps/erp/src/server/delivery/deliveryOps";
import { createTiffinProduct, pauseTiffinSubscription } from "../apps/erp/src/server/tiffin/tiffinService";
import { previewTiffinBilling } from "../apps/erp/src/server/tiffin/tiffinBillingService";
import { getBusinessDateString } from "../apps/erp/src/server/finance/financeService";
import { summarizeDeliveries, deliveryOutcome } from "../apps/erp/src/lib/delivery/outcome";
import { AuthenticatedUser, DeliveryTask, QueuedDeliveryAction } from "../apps/erp/src/types";
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
  console.log("PG DELIVERY OPERATIONS VERIFICATION (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const now = new Date().toISOString();
  // Earlier runs against this database leave delivery staff behind; keep only this run's active.
  await db.execute("UPDATE staff_users SET is_active = 0 WHERE role = 'DELIVERY_PERSON' AND id LIKE 'stf_verify_%'");
  const owner = await insertStaff(db, "SUPER_ADMIN", "Ops Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Ops Manager");
  const A = await insertStaff(db, "DELIVERY_PERSON", "Driver Asha");
  const B = await insertStaff(db, "DELIVERY_PERSON", "Driver Bilal");
  process.env.ERP_DEFAULT_DELIVERY_USERNAME = A.username;
  const DAY1 = uniqueBusinessDate(300);
  const DAY2 = uniqueBusinessDate(301);
  const DAY3 = uniqueBusinessDate(302);

  const thali = await createTiffinProduct(owner, { code: `OP_${rnd()}`.toUpperCase(), name: "Ops Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 100 } as any, undefined, db);

  // Rooms and residents: R1 has lunch delivered to the room, R2 eats at the PG.
  const roomId = (n: string) => `room_ops_${n}_${rnd()}`;
  const mkResident = async (name: string, roomNo: string) => {
    const rid = roomId(roomNo);
    await db.execute(
      "INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, created_at, updated_at) VALUES (?, ?, 1, 'SINGLE', 1, 9000, ?, ?)",
      [rid, `${roomNo}-${rnd()}`, now, now]
    );
    const resId = `res_ops_${crypto.randomUUID()}`;
    await db.execute("INSERT INTO residents (id, full_name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [resId, name, phone(), now, now]);
    await db.execute(
      "INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, status, created_at, updated_at) VALUES (?, ?, ?, '2030-01-01', 9000, 'ACTIVE', ?, ?)",
      [`stay_ops_${crypto.randomUUID()}`, resId, rid, now, now]
    );
    return resId;
  };
  const R1 = await mkResident("Room Riya", "101");
  const R2 = await mkResident("Pg Pranav", "102");
  // Residents left by earlier runs of this suite must not be room-delivery stops here.
  await db.execute("UPDATE resident_meal_preferences SET lunch_room_delivery = 0, dinner_room_delivery = 0 WHERE resident_id LIKE 'res_ops_%' AND resident_id NOT IN (?, ?)", [R1, R2]);

  // Subscription customers.
  const mkSub = async (name: string, mealTypes: string, qty: number, extra: Record<string, any> = {}) => {
    const cid = `tc_ops_${crypto.randomUUID()}`;
    await db.execute(
      "INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, landmark, delivery_instructions, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [cid, name, phone(), "12 Subscription Street", "Near the temple", "Ring twice", owner.id, now, now]
    );
    const sid = `ts_ops_${crypto.randomUUID()}`;
    await db.execute(
      `INSERT INTO tiffin_subscriptions (id, customer_id, product_id, meal_types, service_days, quantity_per_meal, start_date, price, delivery_address, status,
         pause_start_date, pause_resume_date, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ALL_DAYS', ?, '2030-01-01', 100, '12 Subscription Street', ?, ?, ?, ?, ?, ?)`,
      [sid, cid, thali.id, mealTypes, qty, extra.status || "ACTIVE", extra.pauseStart || null, extra.pauseResume || null, owner.id, now, now]
    );
    return sid;
  };
  // Earlier runs' subscriptions are retired so this run's list contains only its own.
  await db.execute("UPDATE tiffin_subscriptions SET status = 'CANCELLED' WHERE id LIKE 'ts_ops_%'");
  const S1 = await mkSub("Sub Lunch Two", "LUNCH", 2);
  const S2 = await mkSub("Sub Both One", "BOTH", 1);
  const S3 = await mkSub("Sub Paused", "LUNCH", 1, { status: "PAUSED", pauseStart: DAY1, pauseResume: DAY3 });
  // Paused from a later date: still delivers on DAY1 (pausing later must not stop today).
  const S4 = await mkSub("Sub Pausing Later", "LUNCH", 1, { status: "PAUSED", pauseStart: DAY3, pauseResume: null });

  console.log("\n[1] Room delivery setting, list timing and roles");
  await setResidentRoomDelivery(manager, { residentId: R1, lunch: true }, IP, db);
  await rejects("Delivery staff cannot change room delivery", () => setResidentRoomDelivery(A, { residentId: R2, lunch: true }, IP, db), /permission|not allowed|forbidden/i);
  let st = await getManifestStatus(A, DAY1, "LUNCH", db, at(DAY1, "07:55"));
  assert(st.schemaReady && !st.prepared && !st.due && st.prepareAt === "08:00" && st.cutoffAt === "07:30", `07:55: not prepared, not yet due (prepare 08:00, cutoff 07:30)`);
  const early = await prepareDeliveryManifest(A, { serviceDate: DAY1, mealType: "LUNCH", trigger: "AUTO" }, IP, db, at(DAY1, "07:55"));
  assert(!early.ran && early.reason === "NOT_DUE" && early.created === 0, "Automatic preparation before 08:00 does nothing");
  await rejects("Delivery staff cannot prepare a list manually", () => prepareDeliveryManifest(A, { serviceDate: DAY1, mealType: "LUNCH", trigger: "MANUAL" }, IP, db, at(DAY1, "08:01")), /permission|not allowed|forbidden/i);
  st = await getManifestStatus(manager, DAY1, "LUNCH", db, at(DAY1, "08:05"));
  assert(st.due && !st.prepared, "08:05: list is due");

  console.log("\n[2] Automatic preparation on first open (lunch)");
  const auto = await prepareDeliveryManifest(A, { serviceDate: DAY1, mealType: "LUNCH", trigger: "AUTO" }, IP, db, at(DAY1, "08:05"));
  assert(auto.ran && auto.created === 4, `First open after 08:00 prepares 4 stops: R1 room delivery, S1, S2, S4 (got ${auto.created})`);
  assert(auto.status.prepared && auto.status.trigger === "AUTO" && auto.status.preparedByName === "Driver Asha", "Prepared at, trigger AUTO and who opened it are recorded");
  assert(auto.unassigned === 4 && auto.autoAssigned === 0, "Two delivery staff and no history: every stop waits in Unassigned");
  const again = await prepareDeliveryManifest(B, { serviceDate: DAY1, mealType: "LUNCH", trigger: "AUTO" }, IP, db, at(DAY1, "08:06"));
  assert(!again.ran && again.reason === "ALREADY_PREPARED", "A second opener does not prepare again");
  const manualRerun = await prepareDeliveryManifest(manager, { serviceDate: DAY1, mealType: "LUNCH", trigger: "MANUAL" }, IP, db, at(DAY1, "09:00"));
  assert(manualRerun.ran && manualRerun.created === 0 && manualRerun.alreadyExisted === 4, "Manual re-run adds nothing and reports 4 existing");
  assert(manualRerun.status.trigger === "AUTO" && manualRerun.status.lastRunByName === "Ops Manager", "First preparation kept; last run by the Manager recorded");

  let day1 = await listDeliveryTasks(manager, { serviceDate: DAY1, mealType: "LUNCH" }, db);
  const bySub = (tasks: DeliveryTask[], sid: string) => tasks.find((t) => t.subscriptionId === sid && t.status !== "CANCELLED");
  const r1Task = day1.find((t) => t.residentId === R1);
  assert(Boolean(r1Task) && !day1.some((t) => t.residentId === R2), "Room-delivery resident is a stop; the resident eating at the PG is not");
  assert(!bySub(day1, S3), "Subscription paused on that day is not on the list");
  assert(Boolean(bySub(day1, S4)), "Subscription paused only from a later date still delivers");
  const t1 = bySub(day1, S1)!;
  assert(t1.lines?.length === 1 && t1.lines[0].quantity === 2 && t1.lines[0].productName === "Ops Thali" && t1.lines[0].unitPrice === null, "Subscription stop has a structured item line (Ops Thali × 2, no doorstep price)");
  assert(t1.paymentMode === "MONTHLY" && t1.expectedAmount === null, "Subscription stop is billed monthly: no amount due at the door");
  assert(t1.landmark === "Near the temple" && t1.deliveryInstructions === "Ring twice", "Landmark and delivery instructions come from the customer");
  assert(!(t1.deliveryNotes || "").includes("Qty:"), "Quantity is no longer written into the notes");

  console.log("\n[3] Concurrent preparation and database uniqueness (dinner)");
  const runs = await Promise.allSettled([0, 1, 2].map(() => prepareDeliveryManifest(manager, { serviceDate: DAY1, mealType: "DINNER", trigger: "MANUAL" }, IP, db, at(DAY1, "15:40"))));
  const dinner = await listDeliveryTasks(manager, { serviceDate: DAY1, mealType: "DINNER" }, db);
  assert(runs.every((r) => r.status === "fulfilled"), "Three simultaneous dinner preparations all complete");
  assert(dinner.length === 1 && dinner[0].subscriptionId === S2, `Exactly one dinner stop (S2) after concurrent runs (got ${dinner.length})`);
  const plan = await db.queryOne<any>("SELECT plan_id FROM delivery_tasks WHERE id = ?", [dinner[0].id]);
  await rejects(
    "Database refuses a second delivery for the same subscription and meal",
    () => db.execute("INSERT INTO delivery_tasks (id, order_type, plan_id, subscription_id, service_date, meal_type, status, created_at, updated_at) VALUES (?, 'EXTERNAL', ?, ?, ?, 'DINNER', 'PENDING', ?, ?)", [`del_dup_${rnd()}`, plan.plan_id, S2, DAY1, now, now]),
    /duplicate|unique/i
  );

  console.log("\n[4] Assignment: bulk, reassignment and carry-over to the next day");
  const bulk = await batchAssignDeliveryTasks(manager, { taskIds: day1.map((t) => t.id), assignedToStaffId: A.id }, IP, db);
  assert(bulk.assignedCount === 4, "Manager bulk-assigns the 4 lunch stops to Asha");
  await assignDeliveryTask(manager, bySub(day1, S2)!.id, { assignedToStaffId: B.id }, IP, db);
  day1 = await listDeliveryTasks(manager, { serviceDate: DAY1, mealType: "LUNCH" }, db);
  assert(bySub(day1, S2)!.assignedTo === B.id && bySub(day1, S2)!.status === "ASSIGNED", "S2 reassigned to Bilal by staff id");
  await rejects("Asha cannot record Bilal's stop", () => completeDeliveryTask(A, bySub(day1, S2)!.id, { lines: [] }, IP, db), /not assigned/i);
  const asA = await listDeliveryTasks(A, { serviceDate: DAY1, mealType: "LUNCH" }, db);
  assert(asA.length === 3 && asA.every((t) => t.assignedTo === A.id), "Asha sees only her 3 stops");

  console.log("\n[5] Skip today / extra today before and after the cutoff (DAY2)");
  await setSubscriptionDayOverride(manager, { subscriptionId: S2, serviceDate: DAY2, mealType: "LUNCH", action: "SKIP" }, IP, db, at(DAY2, "07:00"));
  const extraRow = await setSubscriptionDayOverride(manager, { subscriptionId: S1, serviceDate: DAY2, mealType: "LUNCH", action: "EXTRA", quantity: 1 }, IP, db, at(DAY2, "07:10"));
  assert(extraRow.override?.action === "EXTRA" && extraRow.effectiveQuantity === 3, "Extra today: S1 gets 3 boxes on DAY2");
  await setResidentDaySkip(manager, { residentId: R1, serviceDate: DAY2, mealType: "LUNCH", action: "SKIP" }, IP, db, at(DAY2, "07:15"));
  await rejects("Delivery staff cannot skip a subscription", () => setSubscriptionDayOverride(A, { subscriptionId: S1, serviceDate: DAY2, mealType: "LUNCH", action: "SKIP" }, IP, db, at(DAY2, "07:00")), /permission|not allowed|forbidden/i);
  const day2run = await prepareDeliveryManifest(B, { serviceDate: DAY2, mealType: "LUNCH", trigger: "AUTO" }, IP, db, at(DAY2, "08:02"));
  const day2 = await listDeliveryTasks(manager, { serviceDate: DAY2, mealType: "LUNCH" }, db);
  assert(!bySub(day2, S2) && !day2.some((t) => t.residentId === R1), "Skipped subscription and skipped resident are not on DAY2's list");
  assert(bySub(day2, S1)?.lines?.[0].quantity === 3, "S1 has 3 boxes on DAY2 (2 + 1 extra)");
  assert(day2run.skipped === 2, `Preparation reports 2 skipped (got ${day2run.skipped})`);
  assert(bySub(day2, S1)?.assignedTo === A.id && bySub(day2, S4)?.assignedTo === A.id, "Usual delivery person carried over: S1 and S4 go to Asha automatically");
  await rejects("After 07:30 a skip needs a reason", () => setSubscriptionDayOverride(manager, { subscriptionId: S4, serviceDate: DAY2, mealType: "LUNCH", action: "SKIP" }, IP, db, at(DAY2, "07:45")), /cutoff.*reason/i);
  await setSubscriptionDayOverride(manager, { subscriptionId: S4, serviceDate: DAY2, mealType: "LUNCH", action: "SKIP", reason: "Customer phoned late" }, IP, db, at(DAY2, "07:45"));
  const s4Day2 = (await getDeliveryTaskById(manager, bySub(day2, S4)!.id, db))!;
  assert(s4Day2.task.status === "CANCELLED" && s4Day2.task.cutoffOverride === true && /Customer phoned late/.test(s4Day2.task.cancelReason || ""), "Late skip cancels the listed delivery as a recorded cutoff override");
  assert(s4Day2.events.some((e) => e.eventType === "CANCELLED"), "Cancellation is in the delivery's timeline");
  await setSubscriptionDayOverride(manager, { subscriptionId: S1, serviceDate: DAY2, mealType: "LUNCH", action: "CLEAR", reason: "Extra no longer needed" }, IP, db, at(DAY2, "07:50"));
  const s1Day2 = (await getDeliveryTaskById(manager, bySub(day2, S1)!.id, db))!;
  assert(s1Day2.task.lines?.[0].quantity === 2 && s1Day2.events.some((e) => e.eventType === "UPDATED"), "Clearing the extra puts the listed quantity back to 2 (UPDATED event)");
  const subsDay = await listSubscriptionDay(manager, DAY2, "LUNCH", db, at(DAY2, "08:30"));
  const row2 = subsDay.rows.find((r) => r.subscriptionId === S2)!;
  assert(row2.override?.action === "SKIP" && row2.effectiveQuantity === 0 && subsDay.pastCutoff, "Subscriptions screen shows S2 skipped and the meal past its cutoff");
  assert(subsDay.rows.find((r) => r.subscriptionId === S3)?.eligible === false, "Subscriptions screen shows the paused subscription as not delivering");
  const resDay = await listResidentMealDelivery(manager, DAY2, "LUNCH", db);
  assert(resDay.rows.find((r) => r.residentId === R1)?.today === "SKIPPED" && resDay.rows.find((r) => r.residentId === R2)?.today === "AT_PG", "Residents screen: R1 skipped today, R2 eats at the PG");
  await rejects("Delivery staff cannot read the subscriptions screen", () => listSubscriptionDay(A, DAY2, "LUNCH", db), /cannot|permission|forbidden/i);

  console.log("\n[6] Subscription delivery: item outcome, disposition, recipient, no doorstep money");
  const s1 = bySub(day1, S1)!;
  const line = s1.lines![0];
  await rejects("A shortfall needs a disposition", () => completeDeliveryTask(A, s1.id, { lines: [{ lineId: line.lineId, deliveredQuantity: 1, reason: "Customer took one" }], recipientName: "Gate guard" }, IP, db), /what happened/i);
  await rejects("A shortfall needs a reason", () => completeDeliveryTask(A, s1.id, { lines: [{ lineId: line.lineId, deliveredQuantity: 1, disposition: "RETURNED" }], recipientName: "Gate guard" }, IP, db), /reason is required/i);
  await rejects("A delivery needs the recipient's name", () => completeDeliveryTask(A, s1.id, { lines: [{ lineId: line.lineId, deliveredQuantity: 2 }] }, IP, db), /name of the person/i);
  await rejects("No doorstep payment on a subscription", () => completeDeliveryTask(A, s1.id, { lines: [{ lineId: line.lineId, deliveredQuantity: 2 }], recipientName: "Ravi", collectedAmount: 100, paymentMethod: "CASH" }, IP, db), /billed monthly/i);
  const done1 = await completeDeliveryTask(A, s1.id, { lines: [{ lineId: line.lineId, deliveredQuantity: 1, reason: "Customer took one", disposition: "RETURNED" }], recipientName: "Gate guard" }, IP, db);
  assert(done1.status === "DELIVERED" && deliveryOutcome(done1) === "PARTIAL", "Partial subscription delivery is DELIVERED with a PARTIAL outcome");
  assert(done1.lines?.[0].deliveredQuantity === 1 && done1.lines?.[0].disposition === "RETURNED" && done1.lines?.[0].undeliveredReason === "Customer took one", "Item line keeps delivered 1, reason and RETURNED");
  assert(done1.recipientName === "Gate guard" && (done1.collectedAmount || 0) === 0, "Recipient recorded; nothing collected");
  const dup = await completeDeliveryTask(A, s1.id, { lines: [{ lineId: line.lineId, deliveredQuantity: 2 }], recipientName: "x" }, IP, db);
  assert(dup.lines?.[0].deliveredQuantity === 1, "A repeated completion changes nothing");
  await rejects("No balance can be collected on a subscription", () => recordDeliveryCollection(A, s1.id, { collectedAmount: 50, paymentMethod: "CASH" }, IP, db), /billed monthly/i);
  const r1 = day1.find((t) => t.residentId === R1)!;
  const r1Done = await completeDeliveryTask(A, r1.id, { lines: [{ lineId: r1.lines![0].lineId, deliveredQuantity: 1 }], recipientName: "Riya" }, IP, db);
  assert(r1Done.paymentMode === "NONE" && deliveryOutcome(r1Done) === "DELIVERED", "Resident room delivery completed, no charge");
  const s4 = bySub(day1, S4)!;
  const s4Done = await completeDeliveryTask(A, s4.id, { lines: [{ lineId: s4.lines![0].lineId, deliveredQuantity: 0, reason: "Nobody home", disposition: "WITH_STAFF" }] }, IP, db);
  assert(s4Done.status === "EXCEPTION" && deliveryOutcome(s4Done) === "NOT_DELIVERED" && !s4Done.recipientName, "Nothing delivered: NOT_DELIVERED, no recipient required");

  console.log("\n[7] One-off orders: amount due, collection, order status consistency");
  const mkOrder = async (qty: number) =>
    createUnifiedOrder(manager, {
      orderType: "DELIVERY", customerName: `Walk ${rnd()}`, customerPhone: phone(), deliveryAddress: "Order Road 5",
      serviceDate: DAY1, mealType: "LUNCH", items: [{ productId: thali.id, productName: "x", quantity: qty, unitPrice: 1 }], idempotencyKey: `op_${rnd()}`,
    } as any, IP, db);
  const o1 = await mkOrder(2);
  const o1OrderId = o1.orderId as string;
  const o1Task = (await getDeliveryTaskById(A, o1.deliveryTaskId!, db))!.task;
  assert(o1Task.status === "OUT_FOR_DELIVERY" && o1Task.paymentMode === "DOORSTEP" && o1Task.expectedAmount === 200, "Order is out for delivery with ₹200 due at the door");
  assert(!(o1Task.deliveryNotes || "").includes("ORDER_JSON"), "The order is no longer copied into the delivery notes");
  await rejects("Order shortfall needs a disposition", () => completeDeliveryTask(A, o1Task.id, { lines: [{ lineId: o1Task.lines![0].lineId, deliveredQuantity: 1, reason: "Took one" }], recipientName: "Mr K" }, IP, db), /what happened/i);
  const o1Done = await completeDeliveryTask(A, o1Task.id, { lines: [{ lineId: o1Task.lines![0].lineId, deliveredQuantity: 1, reason: "Took one", disposition: "WITH_STAFF" }], recipientName: "Mr K", collectedAmount: 60, paymentMethod: "CASH", idempotencyKey: `c_${rnd()}` }, IP, db);
  assert(o1Done.expectedAmount === 100 && o1Done.collectedAmount === 60 && o1Done.balanceDue === 40, "Due ₹100 for 1 delivered, ₹60 collected (from the collection records), ₹40 balance");
  const o1Bal = await recordDeliveryCollection(manager, o1Task.id, { collectedAmount: 40, paymentMethod: "UPI", idempotencyKey: `b_${rnd()}` }, IP, db);
  assert(o1Bal.collectedAmount === 100 && o1Bal.balanceDue === 0, "Balance collected separately later (delivery and payment are separate)");
  const upiRow = await db.queryOne<any>("SELECT transaction_id, handover_id FROM delivery_collections WHERE delivery_task_id = ? AND payment_method = 'UPI'", [o1Task.id]);
  const upiTx = upiRow?.transaction_id ? await db.queryOne<any>("SELECT amount, payment_method, status FROM financial_transactions WHERE id = ?", [upiRow.transaction_id]) : null;
  assert(Number(upiTx?.amount) === 40 && upiTx?.payment_method === "UPI" && upiTx?.status === "POSTED" && !upiRow.handover_id, "UPI balance is paid straight to the PG account: booked at once, part of no handover");
  const o2 = await mkOrder(1);
  const o2OrderId = o2.orderId as string;
  const o2Task = (await getDeliveryTaskById(A, o2.deliveryTaskId!, db))!.task;
  await completeDeliveryTask(A, o2Task.id, { lines: [{ lineId: o2Task.lines![0].lineId, deliveredQuantity: 0, reason: "Refused", disposition: "DISCARDED" }] }, IP, db);
  const orderStatus = async (id: string) => (await db.queryOne<any>("SELECT status FROM orders WHERE id = ?", [id])).status;
  assert((await orderStatus(o1OrderId)) === "COMPLETED" && (await orderStatus(o2OrderId)) === "CONFIRMED", "Delivered order is COMPLETED; the failed one stays open (CONFIRMED), never COMPLETED");

  console.log("\n[8] Problems: retry, resolve, cancel with cutoff override");
  await rejects("Delivery staff cannot cancel", () => cancelDeliveryTask(A, o2Task.id, { reason: "x y z" }, IP, db), /permission|not allowed|forbidden/i);
  await rejects("Delivery staff cannot resolve", () => resolveDeliveryProblem(A, o2Task.id, { note: "done" }, IP, db), /permission|not allowed|forbidden/i);
  const retried = await retryDeliveryTask(manager, o2Task.id, { reassignToStaffId: B.id, notes: "Customer asked for redelivery" }, IP, db);
  assert(retried.status === "ASSIGNED" && retried.assignedTo === B.id, "Retry puts the failed delivery back with Bilal");
  await rejects("Retrying a delivery that is not failed is refused", () => retryDeliveryTask(manager, o2Task.id, {}, IP, db), /EXCEPTION/);
  await rejects("Cancelling a delivery with money collected is refused", () => cancelDeliveryTask(manager, o1Task.id, { reason: "Wrong order" }, IP, db), /delivered|collected/i);
  await rejects("Cancel needs a reason", () => cancelDeliveryTask(manager, o2Task.id, { reason: "" }, IP, db), /reason/i);
  await rejects("After the lunch cutoff a cancel needs the override", () => cancelDeliveryTask(manager, o2Task.id, { reason: "Customer cancelled" }, IP, db, at(DAY1, "11:00")), /cutoff.*override/i);
  const cancelled = await cancelDeliveryTask(manager, o2Task.id, { reason: "Customer cancelled", overrideCutoff: true }, IP, db, at(DAY1, "11:00"));
  assert(cancelled.status === "CANCELLED" && cancelled.cutoffOverride === true && (await orderStatus(o2OrderId)) === "CANCELLED", "Cancelled after cutoff with override; its order is CANCELLED too");
  await rejects("A cancelled delivery cannot be recorded", () => completeDeliveryTask(B, o2Task.id, { lines: [] }, IP, db), /cancelled/i);
  const resolved = await resolveDeliveryProblem(manager, s1.id, { note: "Customer confirmed one box only" }, IP, db);
  assert(Boolean(resolved.resolvedAt) && resolved.status === "DELIVERED" && deliveryOutcome(resolved) === "PARTIAL", "Partial delivery resolved with a note; status and outcome unchanged");
  await rejects("Resolving twice is refused", () => resolveDeliveryProblem(manager, s1.id, { note: "again" }, IP, db), /still open/i);

  console.log("\n[9] Totals, close-out and history");
  const all = await listDeliveryTasks(manager, { serviceDate: DAY1, mealType: "LUNCH" }, db);
  const sum = summarizeDeliveries(all);
  const searched = await listDeliveryTasks(manager, { serviceDate: DAY1, mealType: "LUNCH", search: "Walk" }, db);
  assert(searched.length < all.length && summarizeDeliveries(all).total === sum.total, "Search narrows the list; totals come from the whole day");
  assert(sum.cancelled === 1 && sum.total === all.length - 1, "Cancelled delivery is counted apart, not as waiting or delivered");
  assert(sum.partial === 2 && sum.notDelivered === 1 && sum.delivered === 1 && sum.waiting === 1, `Outcomes: 2 partial, 1 not delivered, 1 delivered, 1 waiting (got ${JSON.stringify({ p: sum.partial, n: sum.notDelivered, d: sum.delivered, w: sum.waiting })})`);
  assert(sum.items.byDisposition.RETURNED === 1 && sum.items.byDisposition.WITH_STAFF === 2, "Undelivered by disposition: 1 returned, 2 with staff");
  assert(sum.money.due === 100 && sum.money.collected === 100 && sum.money.outstanding === 0, "Doorstep money: ₹100 due, ₹100 collected, nothing outstanding");
  const close = await getDeliveryCloseout(owner, DAY1, "LUNCH", db);
  assert(close.summary.total === sum.total && close.shortfalls.length === 3 && close.cancelled.length === 1 && close.cancelled[0].cutoffOverride, "Owner close-out: same totals, 3 shortfall lines, cancellation with override");
  const thaliRow = close.items.find((i) => i.productName === "Ops Thali")!;
  assert(thaliRow.ordered === 6 && thaliRow.delivered === 2 && thaliRow.returned === 1 && thaliRow.withStaff === 2, `Item reconciliation for Ops Thali (cancelled excluded): ordered 6, delivered 2, returned 1, with staff 2 (got ${JSON.stringify(thaliRow)})`);
  const aCol = close.collections.find((c) => c.staffId === A.id);
  const mCol = close.collections.find((c) => c.staffId === manager.id);
  assert(aCol?.cash === 60 && mCol?.upi === 40, "Collections per person: Asha ₹60 cash at the door, Manager ₹40 UPI later");
  await rejects("Delivery staff cannot read the close-out", () => getDeliveryCloseout(A, DAY1, "LUNCH", db), /Manager and Owner|forbidden|permission/i);
  const hist = await getDeliveryHistory(owner, DAY1, DAY2, db);
  const h1 = hist.find((h) => h.serviceDate === DAY1 && h.mealType === "LUNCH")!;
  assert(h1.partial === 2 && h1.cancelled === 1 && h1.notDelivered === 1, "History row for DAY1 lunch matches the close-out");

  console.log("\n[10] Monthly billing counts delivered boxes");
  const preview = await previewTiffinBilling(manager, { startDate: DAY1, endDate: DAY1, billingPeriod: DAY1.slice(0, 7) } as any, db);
  const s1Bill = preview.customers.find((c: any) => c.subscriptionId === S1) as any;
  assert(s1Bill?.billableQuantity === 1, `S1 bills 1 delivered box for DAY1, not 2 (got ${s1Bill?.billableQuantity})`);

  console.log("\n[11] Handover: cashbook on the handover date, service date kept on the payment");
  const decl = await createCashHandoverDeclaration(A, { shiftDate: DAY1 }, IP, db);
  assert((decl.declaredUpi || 0) === 0 && decl.declaredCash === 60, `Handover is cash only (₹${decl.declaredCash} cash, ₹${decl.declaredUpi || 0} UPI)`);
  await acceptCashHandover(manager, decl.id, { acceptedCash: decl.declaredCash, acceptedUpi: decl.declaredUpi }, IP, db);
  const ledger = await db.queryOne<any>("SELECT transaction_date FROM financial_transactions WHERE idempotency_key = ?", [`dch_tx_${decl.id}`]);
  assert(ledger?.transaction_date === getBusinessDateString(), `Cashbook entry dated the handover day ${getBusinessDateString()} (declared shift ${DAY1})`);
  const col = await db.queryOne<any>("SELECT service_date FROM delivery_collections WHERE delivery_task_id = ? AND collected_by = ?", [o1Task.id, A.id]);
  assert(col?.service_date === DAY1, "The collection keeps the delivery's service date");

  console.log("\n[12] Offline queue: actions replay only under the staff member who saved them");
  const s2Day1 = bySub(day1, S2)!;
  const q = (userId: string | undefined): QueuedDeliveryAction =>
    ({
      id: `queue_${rnd()}`, action: "COMPLETE_DELIVERY", taskId: s2Day1.id, userId,
      payload: { lines: [{ lineId: s2Day1.lines![0].lineId, deliveredQuantity: 1 }], recipientName: "Neighbour" },
      idempotencyKey: `offline_${rnd()}`, createdAt: now, retryCount: 0, status: "PENDING",
    } as any);
  const untagged = await syncDeliveryActions(B, [q(undefined)], IP, db);
  const foreign = await syncDeliveryActions(B, [q(A.id)], IP, db);
  const own = await syncDeliveryActions(B, [q(B.id)], IP, db);
  assert(untagged.results[0].status === "CONFLICT" && foreign.results[0].status === "CONFLICT", "Untagged and other-staff actions are refused");
  assert(own.results[0].status === "SYNCED", `Bilal's own queued delivery (with its item line) syncs (got ${own.results[0].status} ${(own.results[0] as any).error || ""})`);

  console.log("\n[13] Pausing a subscription cancels its listed deliveries before the cutoff");
  await prepareDeliveryManifest(manager, { serviceDate: DAY3, mealType: "DINNER", trigger: "MANUAL" }, IP, db, at(DAY3, "15:00"));
  const s2Day3 = bySub(await listDeliveryTasks(manager, { serviceDate: DAY3, mealType: "DINNER" }, db), S2)!;
  await pauseTiffinSubscription(owner, S2, { pauseStartDate: DAY3, pauseReason: "Travelling" } as any, IP, db);
  const s2After = (await getDeliveryTaskById(manager, s2Day3.id, db))!.task;
  assert(s2After.status === "CANCELLED" && /paused/i.test(s2After.cancelReason || ""), "DAY3 dinner delivery cancelled by the pause, with the reason");

  console.log("\n[14] Legacy entry point uses the same rules");
  const legacy = await generateDeliveryTasks(manager, { serviceDate: DAY1, mealType: "LUNCH" }, IP, db);
  assert(legacy.createdCount === 0 && legacy.alreadyExistedCount > 0, "generateDeliveryTasks now prepares the list idempotently (no new stops)");

  console.log("\n--------------------------------------------------------------------------------");
  console.log(`RESULT: ${state.passed} passed, ${state.failed} failed`);
  await closePg();
  process.exit(state.failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  try {
    await closePg();
  } catch {}
  process.exit(1);
});
