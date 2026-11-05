/**
 * Receive payment (Finance → Receivables) under retries: one payment reference (idempotency key)
 * stands for exactly one payment. An identical retry returns the recorded payment; a retry with any
 * other balance, amount, method, date or reference is refused and the first payment stays as it was;
 * a new payment needs a new key. Also the driver's offline queue replaying a completion.
 * Disposable verification database only (RN_PG_VERIFY_URL; names contain "verify" and "test").
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createRoom } from "../apps/erp/src/server/rooms/roomService";
import { registerResident, assignResidentToRoom } from "../apps/erp/src/server/residents/residentService";
import { recordRentCharge, getResidentRentBalance } from "../apps/erp/src/server/finance/financeService";
import { createInvoice } from "../apps/erp/src/server/finance/invoiceService";
import { createTiffinCustomer, createTiffinProduct } from "../apps/erp/src/server/tiffin/tiffinService";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import { completeDeliveryTask, syncDeliveryActions, listStaffCustody } from "../apps/erp/src/server/delivery/deliveryService";
import { receiveAccountPayment, getReceivableAccount, PaymentKeyConflictError } from "../apps/erp/src/server/finance/receivablesService";
import { AuthenticatedUser } from "../apps/erp/src/types";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff, uniqueBusinessDate } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;
const rawDbError = (m: string) => /40P01|deadlock|current transaction is aborted|duplicate key|violates/i.test(m);

async function num(db: AsyncDb, sql: string, params: any[] = []) {
  const r = await db.queryOne<any>(sql, params);
  return Number(r?.n ?? 0);
}
async function attempt(fn: () => Promise<unknown>): Promise<{ ok: boolean; error: any }> {
  try {
    await fn();
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e };
  }
}

async function main() {
  console.log("================================================================================");
  console.log("RECEIVE PAYMENT RETRIES (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Retry Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Retry Manager");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "Retry Driver");
  const day = uniqueBusinessDate(67);
  const product: any = await createTiffinProduct(owner, { code: `RT_${rnd()}`.toUpperCase(), name: "Retry Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 100 } as any, undefined, db);
  const cust: any = await createTiffinCustomer(manager, { fullName: `Retry Customer ${rnd()}`, phone: phone(), deliveryAddress: "Retry Lane" } as any, IP, db);
  const C = `C:${cust.id}`;
  const order = async (collected: number) => {
    const o: any = await createUnifiedOrder(manager, {
      orderType: "DELIVERY", customerId: cust.id, customerName: cust.fullName, customerPhone: cust.phone, deliveryAddress: "Retry Lane", serviceDate: day, mealType: "LUNCH",
      items: [{ productId: product.id, productName: "Retry Thali", quantity: 3, unitPrice: 100 }], idempotencyKey: `rto_${rnd()}`,
    } as any, IP, db);
    await db.execute("UPDATE delivery_tasks SET assigned_to = ?, assigned_to_name = ? WHERE id = ?", [driver.id, driver.fullName, o.deliveryTaskId]);
    const item = await db.queryOne<any>("SELECT id FROM order_items WHERE order_id = ?", [o.orderId]);
    const lines = [{ orderItemId: item.id, deliveredQuantity: 3, undeliveredQuantity: 0 }];
    if (collected >= 0) {
      await completeDeliveryTask(driver, o.deliveryTaskId, { recipientName: "Customer", lines, collectedAmount: collected, paymentMethod: "CASH", idempotencyKey: `rtd_${rnd()}` } as any, IP, db);
    }
    return { orderId: o.orderId as string, taskId: o.deliveryTaskId as string, lines };
  };
  const o1 = await order(0);
  const o2 = await order(0);
  const inv: any = await createInvoice(owner, {
    invoiceCategory: "TIFFIN", customerId: cust.id, invoiceType: "REGULAR_BILL", issueDate: day, dueDate: day, billingPeriod: `Retry ${rnd()}`,
    items: [{ description: "Tiffin", unitPrice: 1000, quantity: 1 }], autoIssue: true,
  } as any, IP, db);
  const outstanding = async (refId: string) => (await getReceivableAccount(owner, C, db)).lines.find((l) => l.refId === refId)?.outstanding ?? 0;
  const underKey = async (key: string) => ({
    ledger: await num(db, "SELECT COUNT(*) AS n FROM financial_transactions WHERE idempotency_key LIKE ?", [`${key}:%`]),
    collections: await num(db, "SELECT COUNT(*) AS n FROM delivery_collections WHERE idempotency_key LIKE ?", [`${key}:%`]),
    audits: await num(db, "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'finance.account_payment_received' AND metadata LIKE ?", [`%${key}%`]),
  });
  const accountRows = async () => ({
    ledger: await num(db, "SELECT COUNT(*) AS n FROM financial_transactions WHERE customer_id = ?", [cust.id]),
    collections: await num(db, "SELECT COUNT(*) AS n FROM delivery_collections WHERE order_id IN (?, ?)", [o1.orderId, o2.orderId]),
  });

  // ---------------------------------------------------------------------------
  console.log("\n--- 1. Identical retries return the recorded payment ---");
  const k1 = `recv_${crypto.randomUUID()}`;
  const base = { accountKey: C, paymentMethod: "CASH" as any, transactionDate: day, referenceNumber: "R-1", amountReceived: 700, idempotencyKey: k1,
    items: [{ source: "TIFFIN" as const, refId: inv.id, amount: 400 }, { source: "DELIVERY" as const, refId: o1.orderId, amount: 300 }] };
  const first = await receiveAccountPayment(manager, base, IP, db);
  const again = await receiveAccountPayment(manager, base, IP, db);
  const sameIds = JSON.stringify(first.results.map((r) => r.recordId)) === JSON.stringify(again.results.map((r) => r.recordId));
  const k1rows = await underKey(k1);
  assert(sameIds && k1rows.ledger === 1 && k1rows.collections === 1 && k1rows.audits === 1,
    `Retry returns the same records (${sameIds}); under the key: ${k1rows.ledger} ledger payment, ${k1rows.collections} collection, ${k1rows.audits} audit entry`);
  assert((await outstanding(inv.id)) === 600 && (await outstanding(o1.orderId)) === 0, "Balances moved once: invoice ₹600 left, order paid");

  // ---------------------------------------------------------------------------
  console.log("\n--- 2. The same key with a different payment is refused; the first stays ---");
  const before = await accountRows();
  const variants: Array<[string, any]> = [
    ["an extra balance added", { ...base, amountReceived: 800, items: [...base.items, { source: "DELIVERY", refId: o2.orderId, amount: 100 }] }],
    ["a balance left out", { ...base, amountReceived: 400, items: [base.items[0]] }],
    ["the other balance left out", { ...base, amountReceived: 300, items: [base.items[1]] }],
    ["amounts moved between balances", { ...base, items: [{ ...base.items[0], amount: 500 }, { ...base.items[1], amount: 200 }] }],
    ["a different balance instead", { ...base, amountReceived: 700, items: [base.items[0], { source: "DELIVERY", refId: o2.orderId, amount: 300 }] }],
    ["the method changed", { ...base, paymentMethod: "UPI" }],
    ["the date changed", { ...base, transactionDate: uniqueBusinessDate(68) }],
    ["the reference changed", { ...base, referenceNumber: "R-2" }],
  ];
  for (const [what, body] of variants) {
    const r = await attempt(() => receiveAccountPayment(manager, body, IP, db));
    const msg = String(r.error?.message ?? "");
    assert(!r.ok && r.error instanceof PaymentKeyConflictError && r.error.statusCode === 409 && /already recorded with different/.test(msg),
      `${what}: refused with 409 (${msg.slice(0, 95)}…)`);
  }
  const after = await accountRows();
  assert(after.ledger === before.ledger && after.collections === before.collections, `Nothing new recorded by any refused retry (ledger ${before.ledger} → ${after.ledger}, collections ${before.collections} → ${after.collections})`);
  const k1after = await underKey(k1);
  assert(JSON.stringify(k1after) === JSON.stringify(k1rows) && (await outstanding(inv.id)) === 600 && (await outstanding(o2.orderId)) === 300,
    "The first payment is unchanged: same records, invoice ₹600 left, the other order still ₹300");

  // ---------------------------------------------------------------------------
  console.log("\n--- 3. A new payment uses a new key; part payments still work ---");
  await receiveAccountPayment(manager, { accountKey: C, paymentMethod: "UPI", transactionDate: day, amountReceived: 100, idempotencyKey: `recv_${crypto.randomUUID()}`, items: [{ source: "DELIVERY", refId: o2.orderId, amount: 100 }] }, IP, db);
  await receiveAccountPayment(manager, { accountKey: C, paymentMethod: "CASH", transactionDate: day, amountReceived: 200, idempotencyKey: `recv_${crypto.randomUUID()}`, items: [{ source: "DELIVERY", refId: o2.orderId, amount: 200 }] }, IP, db);
  assert((await outstanding(o2.orderId)) === 0, "Two part payments (₹100 UPI, then ₹200 cash) under new keys settle the order");
  const over = await attempt(() => receiveAccountPayment(manager, { accountKey: C, paymentMethod: "CASH", transactionDate: day, amountReceived: 700, idempotencyKey: `recv_${crypto.randomUUID()}`, items: [{ source: "TIFFIN", refId: inv.id, amount: 700 }] }, IP, db));
  assert(!over.ok && (await outstanding(inv.id)) === 600, "Paying more than the invoice's ₹600 is still refused under a new key");

  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Concurrent requests ---");
  const room = await createRoom(owner, { roomNumber: `RT${rnd()}`.toUpperCase(), floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 6000 }, IP, db);
  const res: any = await registerResident(owner, { fullName: `Retry Resident ${rnd()}`, phone: phone() }, IP, db);
  const stay: any = await assignResidentToRoom(owner, { residentId: res.id, roomId: room.id, checkInDate: day, monthlyRent: 6000 }, IP, db);
  await recordRentCharge(owner, { residentId: res.id, stayId: stay.id, amount: 6000, transactionDate: day, billingPeriod: `Retry rent ${rnd()}` }, IP, db);
  const R = `R:${res.id}`;
  const k4 = `recv_${crypto.randomUUID()}`;
  const rent = (amount: number, key: string) => ({ accountKey: R, paymentMethod: "CASH" as any, transactionDate: day, amountReceived: amount, idempotencyKey: key, items: [{ source: "PG" as const, refId: res.id, amount }] });
  const five = await Promise.all(Array.from({ length: 5 }, () => attempt(() => receiveAccountPayment(manager, rent(2000, k4), IP, db))));
  const k4rows = await underKey(k4);
  assert(five.every((r) => r.ok) && k4rows.ledger === 1 && k4rows.audits === 1 && (await getResidentRentBalance(res.id, db)) === 4000,
    `Five identical requests at once: all answered, 1 rent payment, 1 audit entry, balance ₹${await getResidentRentBalance(res.id, db)}`);
  const k5 = `recv_${crypto.randomUUID()}`;
  const mixed = await Promise.all([
    ...Array.from({ length: 3 }, () => attempt(() => receiveAccountPayment(manager, rent(1000, k5), IP, db)).then((r) => ({ ...r, amount: 1000 }))),
    ...Array.from({ length: 3 }, () => attempt(() => receiveAccountPayment(manager, rent(1500, k5), IP, db)).then((r) => ({ ...r, amount: 1500 }))),
  ]);
  const kept = await db.queryOne<any>("SELECT amount FROM financial_transactions WHERE idempotency_key LIKE ?", [`${k5}:%`]);
  const keptAmount = Number(kept?.amount);
  const k5rows = await underKey(k5);
  const winnersOk = mixed.filter((r) => r.amount === keptAmount).every((r) => r.ok);
  const losersRefused = mixed.filter((r) => r.amount !== keptAmount).every((r) => !r.ok && r.error instanceof PaymentKeyConflictError);
  const noRaw = mixed.every((r) => r.ok || !rawDbError(String(r.error?.message ?? "")));
  assert(k5rows.ledger === 1 && winnersOk && losersRefused && noRaw && (await getResidentRentBalance(res.id, db)) === 4000 - keptAmount,
    `Same key, two different payments at once: one recorded (₹${keptAmount}), every identical request answered, every different one refused, balance ₹${await getResidentRentBalance(res.id, db)}`);

  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Offline queue replays (driver) ---");
  const o3 = await order(-1);
  const queued = (id: string, key: string, collected: number) => ({
    id, action: "COMPLETE_DELIVERY", taskId: o3.taskId, userId: driver.id, idempotencyKey: key, createdAt: new Date().toISOString(), retryCount: 0, status: "PENDING",
    payload: { recipientName: "Customer", lines: o3.lines, collectedAmount: collected, paymentMethod: "CASH", paymentChoice: "CASH" },
  });
  const cash = async () => Number((await listStaffCustody(owner, db)).staff.find((s) => s.staffId === driver.id)?.cashCollected ?? 0);
  const cash0 = await cash();
  const item = queued(`a_${rnd()}`, `off_${rnd()}`, 100);
  const syncs = await Promise.all(Array.from({ length: 3 }, () => syncDeliveryActions(driver as AuthenticatedUser, [item as any], IP, db)));
  const statuses = syncs.map((s) => s.results[0].status);
  const coll = await num(db, "SELECT COUNT(*) AS n FROM delivery_collections WHERE delivery_task_id = ?", [o3.taskId]);
  assert(coll === 1 && statuses.filter((s) => s === "SYNCED").length >= 1 && statuses.every((s) => s === "SYNCED" || s === "IDEMPOTENT_IGNORED") && (await cash()) - cash0 === 100,
    `The same queued completion sent three times at once: 1 collection, cash +₹${(await cash()) - cash0} (${statuses.join(", ")})`);
  const later = await syncDeliveryActions(driver as AuthenticatedUser, [queued(`b_${rnd()}`, `off_${rnd()}`, 300) as any], IP, db);
  const coll2 = await db.query<any>("SELECT amount FROM delivery_collections WHERE delivery_task_id = ?", [o3.taskId]);
  assert(later.results[0].status === "IDEMPOTENT_IGNORED" && coll2.length === 1 && Number(coll2[0].amount) === 100 && (await cash()) - cash0 === 100,
    `A second, different completion of an already delivered stop records nothing (status ${later.results[0].status}; collection still ₹${coll2.map((c) => c.amount).join(", ")})`);

  console.log("\n================================================================================");
  console.log(`RECEIVE PAYMENT RETRIES RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
