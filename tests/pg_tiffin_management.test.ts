/**
 * Live PostgreSQL verification of restored Tiffin management (Phase 1):
 *   customers (duplicate phone), products (price snapshots), subscription lifecycle and
 *   validation, daily list generation (meal types, cancelled, expired, shared address,
 *   idempotency), deliveries following a subscription edit, billing → payment → ledger
 *   reconciliation, and the previewed, Owner-only default-menu seed.
 * Disposable local database only (RN_PG_VERIFY_URL); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import {
  createTiffinCustomer,
  updateTiffinCustomer,
  createTiffinProduct,
  updateTiffinProduct,
  createTiffinSubscription,
  updateTiffinSubscription,
  pauseTiffinSubscription,
  resumeTiffinSubscription,
  cancelTiffinSubscription,
  getTiffinSubscriptionById,
  planDefaultCatalogSeed,
  seedMissingDefaultCatalog,
} from "../apps/erp/src/server/tiffin/tiffinService";
import { generateTiffinInvoices, recordTiffinPayment, getTiffinCustomerBalance } from "../apps/erp/src/server/tiffin/tiffinBillingService";
import { prepareDeliveryManifest } from "../apps/erp/src/server/delivery/deliveryOps";
import { listDeliveryTasks, getDeliveryTaskById, completeDeliveryTask } from "../apps/erp/src/server/delivery/deliveryService";
import { DeliveryTask } from "../apps/erp/src/types";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff, uniqueBusinessDate } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
// This suite checks the automatic plan stops, which are switched off by default since 2026-11-11
// (plan thalis go out as orders). The logic is still there behind ERP_PLAN_AUTO_DELIVERY=1.
process.env.ERP_PLAN_AUTO_DELIVERY = "1";
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
  console.log("PG TIFFIN MANAGEMENT (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Tiffin Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Tiffin Manager");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "Tiffin Driver");
  const DAY = uniqueBusinessDate(400);
  const LATER = uniqueBusinessDate(401);
  const PAST_END = uniqueBusinessDate(399);
  const tasksFor = async (meal: "LUNCH" | "DINNER", d = DAY) => listDeliveryTasks(manager, { serviceDate: d, mealType: meal }, db);
  const open = (tasks: DeliveryTask[], sid: string) => tasks.find((t) => t.subscriptionId === sid && t.status !== "CANCELLED");

  console.log("\n--- 1. Customers ---");
  const sharedAddress = `Flat ${rnd()}, Shared Block`;
  const mobile = phone();
  const custA = await createTiffinCustomer(manager, { fullName: `Lunch Lata ${rnd()}`, phone: mobile, deliveryAddress: sharedAddress, deliveryInstructions: "Leave at door", dietaryPreference: "VEG" } as any, IP, db);
  await rejects("Same phone number is not a second customer", () => createTiffinCustomer(manager, { fullName: "Copy", phone: mobile, deliveryAddress: "Elsewhere 12" } as any, IP, db), /already|duplicate|exists/i);
  const edited = await updateTiffinCustomer(manager, custA.id, { deliveryInstructions: "Ring the bell" } as any, IP, db);
  assert(edited.deliveryInstructions === "Ring the bell", "Customer details can be edited");
  const custB = await createTiffinCustomer(manager, { fullName: `Dinner Dev ${rnd()}`, phone: phone(), deliveryAddress: sharedAddress } as any, IP, db);
  const custC = await createTiffinCustomer(manager, { fullName: `Both Bina ${rnd()}`, phone: phone(), deliveryAddress: `House ${rnd()}, Lane 3` } as any, IP, db);

  console.log("\n--- 2. Products and price snapshots ---");
  const thali = await createTiffinProduct(manager, { code: `TM_${rnd()}`.toUpperCase(), name: "Mgmt Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 90 } as any, IP, db);
  await rejects("Negative price is refused", () => createTiffinProduct(manager, { code: `TN_${rnd()}`.toUpperCase(), name: "Bad", category: "EXTRA", billingUnit: "PER_PORTION", price: -5 } as any, IP, db), /price/i);

  console.log("\n--- 3. Subscription lifecycle and validation ---");
  await rejects("End before start is refused", () => createTiffinSubscription(manager, { customerId: custA.id, productId: thali.id, startDate: DAY, endDate: PAST_END, mealTypes: "LUNCH" } as any, IP, db), /end date|earlier|before/i);
  await rejects("Zero quantity is refused", () => createTiffinSubscription(manager, { customerId: custA.id, productId: thali.id, startDate: DAY, mealTypes: "LUNCH", quantityPerMeal: 0 } as any, IP, db), /quantity/i);
  const subA = await createTiffinSubscription(manager, { customerId: custA.id, productId: thali.id, startDate: PAST_END, mealTypes: "LUNCH", quantityPerMeal: 1 } as any, IP, db);
  const subB = await createTiffinSubscription(manager, { customerId: custB.id, productId: thali.id, startDate: PAST_END, mealTypes: "DINNER", quantityPerMeal: 2 } as any, IP, db);
  const subC = await createTiffinSubscription(manager, { customerId: custC.id, productId: thali.id, startDate: PAST_END, mealTypes: "BOTH", quantityPerMeal: 1 } as any, IP, db);
  assert(subA.price === 90 && subA.deliveryAddress === sharedAddress, "Subscription snapshots the price (₹90) and the customer's address");
  await updateTiffinProduct(manager, thali.id, { price: 120 } as any, IP, db);
  assert((await getTiffinSubscriptionById(manager, subA.id, db))!.price === 90, "Changing the menu price does not change an existing subscription's agreed price");
  // Cancelled and expired subscriptions for the same day.
  const subCancelled = await createTiffinSubscription(manager, { customerId: custC.id, productId: thali.id, startDate: PAST_END, mealTypes: "LUNCH" } as any, IP, db);
  await cancelTiffinSubscription(manager, subCancelled.id, { cancellationReason: "Moved away" }, IP, db);
  await rejects("A cancelled subscription cannot be resumed", () => resumeTiffinSubscription(manager, subCancelled.id, IP, db), /cancel|cannot|only paused/i);
  const subExpired = await createTiffinSubscription(manager, { customerId: custB.id, productId: thali.id, startDate: PAST_END, endDate: PAST_END, mealTypes: "LUNCH" } as any, IP, db);
  const subPaused = await createTiffinSubscription(manager, { customerId: custA.id, productId: thali.id, startDate: PAST_END, mealTypes: "DINNER" } as any, IP, db);
  await pauseTiffinSubscription(manager, subPaused.id, { pauseStartDate: DAY, pauseResumeDate: LATER, pauseReason: "Travelling" }, IP, db);
  const paused = await getTiffinSubscriptionById(manager, subPaused.id, db);
  assert(paused!.status === "PAUSED" && paused!.pauseReason === "Travelling", "Pause keeps its dates and reason");

  console.log("\n--- 4. Daily list generation ---");
  const lunchRun = await prepareDeliveryManifest(manager, { serviceDate: DAY, mealType: "LUNCH", trigger: "MANUAL" }, IP, db, at(DAY, "08:30"));
  const dinnerRun = await prepareDeliveryManifest(manager, { serviceDate: DAY, mealType: "DINNER", trigger: "MANUAL" }, IP, db, at(DAY, "15:45"));
  let lunch = await tasksFor("LUNCH");
  let dinner = await tasksFor("DINNER");
  assert(Boolean(open(lunch, subA.id)) && !open(dinner, subA.id), "Lunch-only subscription: a lunch stop and no dinner stop");
  assert(!open(lunch, subB.id) && open(dinner, subB.id)?.lines?.[0].quantity === 2, "Dinner-only subscription: a dinner stop with 2 boxes and no lunch stop");
  assert(Boolean(open(lunch, subC.id)) && Boolean(open(dinner, subC.id)), "Both-meals subscription: one lunch and one dinner stop");
  assert(!lunch.some((t) => t.subscriptionId === subCancelled.id), "Cancelled subscription is not listed");
  assert(!lunch.some((t) => t.subscriptionId === subExpired.id), "Subscription that ended the day before is not listed");
  assert(!dinner.some((t) => t.subscriptionId === subPaused.id), "Paused subscription is not listed inside its pause");
  assert(open(lunch, subA.id)!.deliveryAddress === sharedAddress && open(dinner, subB.id)!.deliveryAddress === sharedAddress, "Two customers at one address each get their own stop");
  const lunchAgain = await prepareDeliveryManifest(manager, { serviceDate: DAY, mealType: "LUNCH", trigger: "MANUAL" }, IP, db, at(DAY, "09:00"));
  assert(lunchAgain.created === 0 && (await tasksFor("LUNCH")).length === lunch.length, `Re-running the list adds no duplicates (first run created ${lunchRun.created}, dinner ${dinnerRun.created})`);

  console.log("\n--- 5. Listed deliveries follow a subscription edit ---");
  await updateTiffinSubscription(manager, subC.id, { mealTypes: "DINNER", quantityPerMeal: 3, deliveryAddress: `New house ${rnd()}, Lane 9` } as any, IP, db);
  lunch = await tasksFor("LUNCH");
  dinner = await tasksFor("DINNER");
  const cLunch = lunch.find((t) => t.subscriptionId === subC.id)!;
  assert(cLunch.status === "CANCELLED" && /Subscription changed/.test(cLunch.cancelReason || ""), "Lunch stop cancelled with the reason once the subscription is dinner-only");
  const cDinner = open(dinner, subC.id)!;
  assert(cDinner.lines?.[0].quantity === 3 && /New house/.test(cDinner.deliveryAddress || ""), "Dinner stop now carries 3 boxes and the new address");
  const cDinnerDetail = await getDeliveryTaskById(manager, cDinner.id, db);
  assert(Boolean(cDinnerDetail?.events.some((e) => e.eventType === "UPDATED" && /Subscription changed/.test(e.notes || ""))), "The change is in the stop's timeline");

  console.log("\n--- 6. Billing reconciles with payments and the ledger ---");
  const aStop = open(await tasksFor("LUNCH"), subA.id)!;
  await db.execute("UPDATE delivery_tasks SET assigned_to = ?, assigned_to_name = ?, status = 'ASSIGNED' WHERE id = ?", [driver.id, driver.fullName, aStop.id]);
  await completeDeliveryTask(driver, aStop.id, { lines: [{ lineId: aStop.lines![0].lineId, deliveredQuantity: 1 }], recipientName: "Lata" }, IP, db);
  const period = DAY.slice(0, 7);
  await rejects("Manager cannot generate tiffin invoices", () => generateTiffinInvoices(manager, { billingPeriod: period, startDate: DAY, endDate: DAY, dueDate: LATER, customerIds: [custA.id] }, IP, db), /permission|not allowed|forbidden/i);
  // Two runs started together (two people, or a retried request): the period lock must let only one bill.
  const runs = await Promise.all([1, 2].map(() => generateTiffinInvoices(owner, { billingPeriod: period, startDate: DAY, endDate: DAY, dueDate: LATER, customerIds: [custA.id], autoIssue: true }, IP, db)));
  const gen = runs.find((r) => r.generatedCount > 0) || runs[0];
  const invoice = gen.invoices.find((i) => i.customerId === custA.id) || gen.invoices[0];
  assert(runs[0].generatedCount + runs[1].generatedCount === 1 && Boolean(invoice), `Two simultaneous runs bill the delivered box once (generated ${runs[0].generatedCount} + ${runs[1].generatedCount})`);
  const periodInvoices = await db.query<{ id: string }>("SELECT id FROM invoices WHERE customer_id = ? AND billing_period = ? AND status <> 'CANCELLED'", [custA.id, period]);
  assert(periodInvoices.length === 1, `Exactly one invoice stored for the period (found ${periodInvoices.length})`);
  const again = await generateTiffinInvoices(owner, { billingPeriod: period, startDate: DAY, endDate: DAY, dueDate: LATER, customerIds: [custA.id], autoIssue: true }, IP, db);
  assert(again.generatedCount === 0, "Generating the same period again bills nothing twice");
  const billed = invoice.totalAmount;
  const before = await getTiffinCustomerBalance(owner, custA.id, db);
  assert(before.outstandingBalance === billed, `Balance before payment equals the invoice (₹${billed})`);
  const part = Math.max(1, Math.floor(billed / 2));
  await recordTiffinPayment(owner, { customerId: custA.id, amount: part, transactionDate: DAY, paymentMethod: "UPI", invoiceId: invoice.id, idempotencyKey: `tm_${rnd()}` }, IP, db);
  const mid = await getTiffinCustomerBalance(owner, custA.id, db);
  assert(mid.outstandingBalance === billed - part, `Part payment leaves ₹${billed - part} outstanding`);
  await recordTiffinPayment(owner, { customerId: custA.id, amount: billed - part, transactionDate: DAY, paymentMethod: "CASH", invoiceId: invoice.id, idempotencyKey: `tm_${rnd()}` }, IP, db);
  const after = await getTiffinCustomerBalance(owner, custA.id, db);
  assert(after.outstandingBalance === 0, "Paid in full: nothing outstanding");
  const ledger = await db.queryOne<any>(
    "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM financial_transactions WHERE customer_id = ? AND transaction_type = 'TIFFIN_PAYMENT' AND status = 'POSTED'",
    [custA.id]
  );
  assert(Number(ledger.n) === 2 && Number(ledger.total) === billed, "Ledger holds exactly the two payments, totalling the invoice");
  const doorstep = await db.queryOne<any>("SELECT COUNT(*) AS n FROM delivery_collections WHERE delivery_task_id = ?", [aStop.id]);
  assert(Number(doorstep.n) === 0, "A subscription stop has no doorstep collection, so the meal is not paid for twice");

  console.log("\n--- 7. Default menu: previewed, Owner only, never changes existing items ---");
  await rejects("Manager cannot preview the default-menu seed", () => planDefaultCatalogSeed(manager, db), /permission|not allowed|forbidden/i);
  await rejects("Manager cannot run the default-menu seed", () => seedMissingDefaultCatalog(manager, IP, db), /permission|not allowed|forbidden/i);
  const existingPickle = await db.queryOne<any>("SELECT price FROM tiffin_products WHERE code = 'EXT-PICKLE'");
  if (!existingPickle) {
    await createTiffinProduct(owner, { code: "EXT-PICKLE", name: "House Pickle", category: "EXTRA", billingUnit: "PER_PORTION", price: 19 } as any, IP, db);
  }
  const picklePrice = Number((await db.queryOne<any>("SELECT price FROM tiffin_products WHERE code = 'EXT-PICKLE'")).price);
  const productCount = async () => Number((await db.queryOne<any>("SELECT COUNT(*) AS n FROM tiffin_products")).n);
  const countBefore = await productCount();
  const plan = await planDefaultCatalogSeed(owner, db);
  assert((await productCount()) === countBefore, "Preview writes nothing");
  assert(plan.existing.some((e) => e.code === "EXT-PICKLE") && !plan.toAdd.some((i) => i.code === "EXT-PICKLE"), "Preview lists an existing default item as existing, not to add");
  const seeded = await seedMissingDefaultCatalog(owner, IP, db);
  assert(seeded.added.length === plan.toAdd.length && (await productCount()) === countBefore + plan.toAdd.length, `Adds only the ${plan.toAdd.length} missing item(s)`);
  assert(Number((await db.queryOne<any>("SELECT price FROM tiffin_products WHERE code = 'EXT-PICKLE'")).price) === picklePrice, `Existing item keeps its own price (₹${picklePrice})`);
  const rerun = await seedMissingDefaultCatalog(owner, IP, db);
  assert(rerun.added.length === 0 && (await productCount()) === countBefore + plan.toAdd.length, "Running it again adds nothing");

  console.log(`\nPG TIFFIN MANAGEMENT: ${state.passed} PASSED, ${state.failed} FAILED`);
  await closePg();
  process.exit(state.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await closePg().catch(() => {});
  process.exit(1);
});
