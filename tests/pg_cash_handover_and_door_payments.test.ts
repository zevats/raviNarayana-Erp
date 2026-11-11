/**
 * Cash handover shortfalls and door payments beyond the current order (migration 0022).
 * Handover: what was recorded, what was physically handed over, what the manager counted, and any
 * shortage stay separate; a shortage stays owed by the employee until handed over later or written
 * off by the Owner. Door payments: the extra settles earlier orders (oldest first), then becomes an
 * advance; every part is its own record and the whole amount is in the collector's custody.
 * Disposable verification database only (RN_PG_VERIFY_URL; names contain "verify" and "test").
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createTiffinCustomer, createTiffinProduct, listTiffinCustomers } from "../apps/erp/src/server/tiffin/tiffinService";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import {
  completeDeliveryTask,
  recordDeliveryCollection,
  createCashHandoverDeclaration,
  acceptCashHandover,
  listStaffCustody,
  getDeliveryTaskById,
  writeOffCashShortfall,
} from "../apps/erp/src/server/delivery/deliveryService";
import { getReceivableAccount, getAccountStatement, listReceivables, receiveAccountPayment } from "../apps/erp/src/server/finance/receivablesService";
import { AuthenticatedUser } from "../apps/erp/src/types";
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
  console.log("CASH HANDOVER SHORTFALLS AND DOOR PAYMENTS (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Cash Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Cash Manager");
  const day = uniqueBusinessDate(71);
  const product: any = await createTiffinProduct(owner, { code: `CH_${rnd()}`.toUpperCase(), name: "Cash Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 100 } as any, undefined, db);

  const customer = async () => (await createTiffinCustomer(manager, { fullName: `Cash Customer ${rnd()}`, phone: phone(), deliveryAddress: "Cash Lane 1" } as any, IP, db)) as any;
  const order = async (cust: any, driver: AuthenticatedUser, qty: number) => {
    const o: any = await createUnifiedOrder(manager, {
      orderType: "DELIVERY", customerId: cust.id, customerName: cust.fullName, customerPhone: cust.phone, deliveryAddress: "Cash Lane 1", serviceDate: day, mealType: "LUNCH",
      items: [{ productId: product.id, productName: "Cash Thali", quantity: qty, unitPrice: 100 }], idempotencyKey: `cho_${rnd()}`,
    } as any, IP, db);
    await db.execute("UPDATE delivery_tasks SET assigned_to = ?, assigned_to_name = ? WHERE id = ?", [driver.id, driver.fullName, o.deliveryTaskId]);
    const item = await db.queryOne<any>("SELECT id FROM order_items WHERE order_id = ?", [o.orderId]);
    return { orderId: o.orderId as string, taskId: o.deliveryTaskId as string, lines: [{ orderItemId: item.id, deliveredQuantity: qty, undeliveredQuantity: 0 }] };
  };
  const deliver = (o: any, driver: AuthenticatedUser, collected: number, method = "CASH", key = `chd_${rnd()}`) =>
    completeDeliveryTask(driver, o.taskId, { recipientName: "Customer", lines: o.lines, collectedAmount: collected, paymentMethod: method, paymentChoice: collected > 0 ? method : "PAY_LATER", idempotencyKey: key } as any, IP, db);
  const custodyAs = async (who: AuthenticatedUser, staffId: string) => (await listStaffCustody(who, db)).staff.find((s) => s.staffId === staffId)!;
  const handoverCash = async (handoverId: string) => num(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM financial_transactions WHERE reference_number = ? AND payment_method = 'CASH'", [handoverId]);
  const driverWith = async (amount: number) => {
    const d = await insertStaff(db, "DELIVERY_PERSON", `Cash Driver ${rnd()}`);
    if (amount > 0) await deliver(await order(await customer(), d, amount / 100), d, amount);
    return d;
  };

  // ---------------------------------------------------------------------------
  console.log("\n--- 1. Full handover: ₹300 collected, ₹300 handed over ---");
  const d1 = await driverWith(300);
  const h1 = await createCashHandoverDeclaration(d1, { shiftDate: day, declaredCash: 300 }, IP, db);
  let c = await custodyAs(manager, d1.id);
  assert(h1.declaredCash === 300 && h1.recordedCash === 300 && h1.shortfallCash === 0 && c.cashAwaitingAcceptance === 300 && c.cashShort === 0,
    `Declared: recorded ₹${h1.recordedCash}, handed ₹${h1.declaredCash}, awaiting ₹${c.cashAwaitingAcceptance}, short ₹${c.cashShort}`);
  await acceptCashHandover(owner, h1.id, { acceptedCash: 300 }, IP, db);
  c = await custodyAs(manager, d1.id);
  assert(c.cashHandedOver === 300 && c.cashShort === 0 && c.cashOwed === 0 && (await handoverCash(h1.id)) === 300, "Accepted: ₹300 handed over, nothing short or owed, cashbook +₹300");

  // ---------------------------------------------------------------------------
  console.log("\n--- 2. ₹300 collected, ₹100 handed over, ₹200 shortfall with a reason ---");
  const d2 = await driverWith(300);
  assert(/Explain the ₹200 difference/.test((await refused(() => createCashHandoverDeclaration(d2, { shiftDate: day, declaredCash: 100 }, IP, db))) || ""), "Without a reason the ₹100 handover is refused");
  const h2 = await createCashHandoverDeclaration(d2, { shiftDate: day, declaredCash: 100, notes: "Customer paid me later, cash at home" }, IP, db);
  const asDriver = await custodyAs(d2, d2.id);
  const asManager = await custodyAs(manager, d2.id);
  const asOwner = await custodyAs(owner, d2.id);
  assert(h2.recordedCash === 300 && h2.declaredCash === 100 && h2.shortfallCash === 200 && h2.shortfallReason === "Customer paid me later, cash at home",
    `Record: collected ₹${h2.recordedCash}, handed over ₹${h2.declaredCash}, shortfall ₹${h2.shortfallCash}, reason kept`);
  assert(asManager.cashCollected === 300 && asManager.cashAwaitingAcceptance === 100 && asManager.cashShort === 200 && asManager.cashOwed === 200,
    `Manager sees: collected ₹${asManager.cashCollected}, awaiting verification ₹${asManager.cashAwaitingAcceptance} (not ₹300), unresolved short ₹${asManager.cashShort}`);
  assert(JSON.stringify(asDriver) === JSON.stringify(asManager) && JSON.stringify(asOwner) === JSON.stringify(asManager), "Driver, Manager and Owner see the same figures");
  await acceptCashHandover(owner, h2.id, { acceptedCash: 100, expectedDeclaredCash: 100 }, IP, db);
  c = await custodyAs(owner, d2.id);
  assert(c.cashHandedOver === 100 && c.cashShort === 200 && c.cashOwed === 200 && (await handoverCash(h2.id)) === 100 && c.status === "DISCREPANCY",
    `Verified ₹100: cashbook +₹${await handoverCash(h2.id)} only; ₹${c.cashShort} still owed by the driver (status ${c.status})`);

  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Partial handover followed by another ---");
  await deliver(await order(await customer(), d2, 1), d2, 100); // ₹100 more collected
  assert(/at most ₹300/.test((await refused(() => createCashHandoverDeclaration(d2, { shiftDate: day, declaredCash: 350 }, IP, db))) || ""), "Handing over more than owed (₹100 new + ₹200 short) is refused");
  const h3 = await createCashHandoverDeclaration(d2, { shiftDate: day, declaredCash: 300 }, IP, db);
  assert(h3.recordedCash === 100 && h3.declaredCash === 300 && h3.shortfallCash === -200, "Second handover: ₹100 newly recorded + ₹200 earlier shortage handed over");
  await acceptCashHandover(owner, h3.id, { acceptedCash: 300 }, IP, db);
  c = await custodyAs(manager, d2.id);
  assert(c.cashCollected === 400 && c.cashHandedOver === 400 && c.cashShort === 0 && c.cashOwed === 0, `All settled: collected ₹${c.cashCollected} = handed over ₹${c.cashHandedOver}, short ₹0`);

  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Zero handed over with a reason ---");
  const d4 = await driverWith(300);
  const h4 = await createCashHandoverDeclaration(d4, { shiftDate: day, declaredCash: 0, notes: "Wallet lost on the way back" }, IP, db);
  await acceptCashHandover(owner, h4.id, { acceptedCash: 0 }, IP, db);
  c = await custodyAs(manager, d4.id);
  assert(h4.declaredCash === 0 && c.cashHandedOver === 0 && c.cashShort === 300 && (await handoverCash(h4.id)) === 0, "₹0 handed over: no cashbook entry, ₹300 stays owed");

  // ---------------------------------------------------------------------------
  console.log("\n--- 5. Manager counts less than handed over ---");
  const d5 = await driverWith(300);
  const h5 = await createCashHandoverDeclaration(d5, { shiftDate: day, declaredCash: 300 }, IP, db);
  assert(/variance explanation/.test((await refused(() => acceptCashHandover(owner, h5.id, { acceptedCash: 200 }, IP, db))) || ""), "A different count needs the manager's reason");
  const v5 = await acceptCashHandover(owner, h5.id, { acceptedCash: 200, varianceReason: "Counted ₹200 in the envelope" }, IP, db);
  c = await custodyAs(d5, d5.id);
  assert(v5.status === "DISCREPANCY_FLAGGED" && c.cashHandedOver === 200 && c.cashShort === 100 && c.cashOwed === 100 && (await handoverCash(h5.id)) === 200,
    `Counted ₹200 of ₹300: flagged, cashbook +₹200, the ₹${c.cashOwed} difference is back on the driver`);

  // ---------------------------------------------------------------------------
  console.log("\n--- 6. Duplicate submissions ---");
  const d6 = await driverWith(300);
  const two = await Promise.allSettled([1, 2].map(() => createCashHandoverDeclaration(d6, { shiftDate: day, declaredCash: 300 }, IP, db)));
  assert(two.filter((r) => r.status === "fulfilled").length === 1 && (await num(db, "SELECT COUNT(*) AS n FROM driver_cash_handovers WHERE driver_id = ?", [d6.id])) === 1, "Two declarations at once: one recorded");
  const h6 = (two.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>).value;
  const acc = await Promise.allSettled([1, 2, 3].map(() => acceptCashHandover(owner, h6.id, { acceptedCash: 300 }, IP, db)));
  assert(acc.filter((r) => r.status === "fulfilled").length === 1 && (await handoverCash(h6.id)) === 300, "Three acceptances at once: one, cashbook +₹300 once");

  // ---------------------------------------------------------------------------
  console.log("\n--- 7. Owner write-off ---");
  assert(/Only the Owner/.test((await refused(() => writeOffCashShortfall(manager, d5.id, { amount: 50, reason: "Manager try" }, IP, db))) || ""), "A Manager cannot write off a shortage");
  assert(/at most that/.test((await refused(() => writeOffCashShortfall(owner, d5.id, { amount: 150, reason: "Too much" }, IP, db))) || ""), "More than the shortage is refused");
  const w = await writeOffCashShortfall(owner, d5.id, { amount: 50, reason: "Half confirmed lost" }, IP, db);
  const audit = await num(db, "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'delivery.cash_shortfall_written_off' AND metadata LIKE ?", [`%${d5.id}%`]);
  assert(w.cashShort === 50 && w.cashWrittenOff === 50 && audit === 1, `Owner writes off ₹50: ₹${w.cashShort} still short, audited`);

  // ---------------------------------------------------------------------------
  console.log("\n--- 8. Door payments: previous dues, overpayment, advance ---");
  const dd = await insertStaff(db, "DELIVERY_PERSON", `Door Driver ${rnd()}`);
  const scenario = async (prevDue: number, current: number, collect: number) => {
    const cust = await customer();
    if (prevDue > 0) await deliver(await order(cust, dd, prevDue / 100), dd, 0);
    const now = await order(cust, dd, current / 100);
    const before = (await getDeliveryTaskById(dd, now.taskId, db))!.task as any;
    await deliver(now, dd, collect);
    const acc = await getReceivableAccount(owner, `C:${cust.id}`, db);
    const rows = await db.query<any>(
      "SELECT dc.allocation, dc.amount, dc.collected_at_task_id FROM delivery_collections dc JOIN orders o ON o.id = dc.order_id WHERE o.customer_id = ? ORDER BY dc.allocation",
      [cust.id]
    );
    const by = (a: string) => rows.filter((r) => r.allocation === a).reduce((s, r) => s + Number(r.amount), 0);
    return { cust, now, before, acc, order: by("ORDER"), prev: by("PREVIOUS_DUES"), advance: by("ADVANCE"), atStop: rows.every((r) => r.collected_at_task_id === now.taskId) };
  };
  const s1 = await scenario(500, 300, 800);
  assert(s1.before.customerBalance?.previous === 500 && s1.before.customerBalance?.earlierOrders === 500, `Driver sees the previous balance ₹${s1.before.customerBalance?.previous} before delivering`);
  assert(s1.order === 300 && s1.prev === 500 && s1.advance === 0 && s1.acc.totals.total === 0 && s1.atStop, "₹500 due + ₹300 order, ₹800 collected: ₹300 order, ₹500 earlier dues, nothing left");
  const s2 = await scenario(500, 300, 400);
  assert(s2.order === 300 && s2.prev === 100 && s2.acc.totals.total === 400, `₹400 collected: ₹300 order, ₹100 earlier dues, ₹${s2.acc.totals.total} still owed`);
  const s3 = await scenario(500, 300, 1000);
  const st3 = await getAccountStatement(owner, `C:${s3.cust.id}`, {}, db);
  assert(s3.order === 300 && s3.prev === 500 && s3.advance === 200 && s3.acc.totals.total === -200 && s3.acc.lines.some((l: any) => l.kind === "ADVANCE" && l.outstanding === -200) && st3.closing === -200,
    `₹1,000 collected: ₹300 order, ₹500 dues, ₹200 advance shown as credit (account ₹${s3.acc.totals.total}, statement ₹${st3.closing})`);
  const s4 = await scenario(0, 300, 400);
  assert(s4.order === 300 && s4.prev === 0 && s4.advance === 100 && s4.acc.totals.total === -100, "No previous dues, ₹400 collected: ₹300 order + ₹100 advance");
  const next = await order(s4.cust, dd, 3);
  const nb = (await getDeliveryTaskById(dd, next.taskId, db))!.task as any;
  assert(nb.customerBalance?.previous === -100 && nb.customerBalance?.credit === 100, "Next delivery shows the ₹100 advance as customer credit");
  const s5 = await scenario(0, 300, 100);
  await recordDeliveryCollection(dd, s5.now.taskId, { collectedAmount: 200, paymentMethod: "CASH", idempotencyKey: `chl_${rnd()}` }, IP, db);
  assert((await getReceivableAccount(owner, `C:${s5.cust.id}`, db)).totals.total === 0, "Part payment then another: settled");

  // ---------------------------------------------------------------------------
  console.log("\n--- 9. Advances and extra payments: one account from the door to the records ---");
  // Every view of a customer must agree: the delivery sheet, the stop record, the customer list,
  // Receivables (lines and total), the statement, and what the office may still collect.
  const views = async (cust: any, lastTaskId?: string) => {
    const acc = await getReceivableAccount(owner, `C:${cust.id}`, db);
    const st = await getAccountStatement(owner, `C:${cust.id}`, {}, db);
    const list = (await listTiffinCustomers(manager, { search: cust.phone }, db)).customers.find((x: any) => x.id === cust.id) as any;
    const rl = (await listReceivables(owner, { q: cust.phone }, db)).accounts.find((a: any) => a.accountKey === `C:${cust.id}`) ?? null;
    const task = lastTaskId ? ((await getDeliveryTaskById(manager, lastTaskId, db))!.task as any) : null;
    const orderLines = acc.lines.filter((l: any) => l.kind === "ORDER");
    const advance = acc.lines.filter((l: any) => l.kind === "ADVANCE").reduce((s: number, l: any) => s - l.outstanding, 0);
    return { acc, total: acc.totals.total, statement: st.closing, list: list?.balance, listTotal: rl ? rl.total : 0, task, orderLines, advance };
  };
  for (const method of ["CASH", "UPI"]) {
    // Monday: ₹300 order, customer pays ₹400 (₹100 advance).
    const cust = await customer();
    const mon = await order(cust, dd, 3);
    await deliver(mon, dd, 400, method);
    let v = await views(cust, mon.taskId);
    assert(v.total === -100 && v.statement === -100 && v.list?.due === -100 && v.listTotal === -100 && v.advance === 100 && v.orderLines.length === 0 && v.task.balanceDue === 0,
      `${method}: ₹400 for a ₹300 order: ₹100 credit everywhere (account ₹${v.total}, statement ₹${v.statement}, customer list ₹${v.list?.due}, Receivables ₹${v.listTotal})`);
    // Tuesday: ₹300 order; the sheet asks for ₹200 (credit ₹100 used); customer pays ₹200.
    const tue = await order(cust, dd, 3);
    const sheet = (await getDeliveryTaskById(dd, tue.taskId, db))!.task as any;
    assert(sheet.customerBalance?.previous === -100 && sheet.customerBalance?.earlierOrders === 0, `${method}: Tuesday's sheet shows ₹100 customer credit (previous ₹${sheet.customerBalance?.previous})`);
    await deliver(tue, dd, 200, method);
    v = await views(cust, tue.taskId);
    assert(v.total === 0 && v.statement === 0 && v.list?.due === 0 && v.list?.unpaidOrders === 0 && v.orderLines.length === 0 && v.advance === 0 && v.task.balanceDue === 0 && v.task.creditApplied === 100,
      `${method}: ₹200 paid + ₹100 credit: settled everywhere, no unpaid order and no left-over credit (stop: still due ₹${v.task.balanceDue}, from credit ₹${v.task.creditApplied})`);
    assert(/Nothing is outstanding/.test((await refused(() => recordDeliveryCollection(manager, tue.taskId, { collectedAmount: 100, paymentMethod: "CASH", idempotencyKey: `chx_${rnd()}` }, IP, db))) || ""),
      `${method}: the office cannot collect again for an order the credit already paid`);
    // Wednesday: ₹300 order, Pay Later. Thursday: ₹100 order, customer pays ₹600 (₹300 + ₹100 + ₹200 advance).
    const wed = await order(cust, dd, 3);
    await deliver(wed, dd, 0, method);
    v = await views(cust, wed.taskId);
    assert(v.total === 300 && v.list?.due === 300 && v.list?.unpaidOrders === 1 && v.orderLines.length === 1 && v.orderLines[0].outstanding === 300 && v.task.balanceDue === 300,
      `${method}: Pay Later ₹300: owed ₹${v.total} on one order everywhere`);
    const thu = await order(cust, dd, 1);
    await deliver(thu, dd, 600, method);
    v = await views(cust, thu.taskId);
    assert(v.total === -200 && v.statement === -200 && v.list?.due === -200 && v.listTotal === -200 && v.advance === 200 && v.orderLines.length === 0,
      `${method}: ₹600 for ₹100 + ₹300 earlier: Wednesday paid, ₹200 credit everywhere (account ₹${v.total}, statement ₹${v.statement})`);
    // Friday: ₹300 order, Pay Later: ₹200 credit used, ₹100 owed; the office collects ₹100 and it is settled.
    const fri = await order(cust, dd, 3);
    await deliver(fri, dd, 0, method);
    v = await views(cust, fri.taskId);
    assert(v.total === 100 && v.orderLines.length === 1 && v.orderLines[0].outstanding === 100 && v.orderLines[0].paid === 200 && v.task.balanceDue === 100 && v.task.creditApplied === 200 && v.list?.due === 100,
      `${method}: Pay Later ₹300 with ₹200 credit: ₹100 owed on that order everywhere (line ₹${v.orderLines[0]?.outstanding}, stop ₹${v.task.balanceDue})`);
    assert(/Only ₹100 is outstanding/.test((await refused(() => receiveAccountPayment(owner, { accountKey: `C:${cust.id}`, paymentMethod: "CASH" as any, amountReceived: 300, idempotencyKey: `chr_${rnd()}`, items: [{ source: "DELIVERY", refId: fri.orderId, amount: 300 }] }, IP, db))) || ""),
      `${method}: the office cannot take ₹300 for an order that owes ₹100`);
    await receiveAccountPayment(owner, { accountKey: `C:${cust.id}`, paymentMethod: "UPI" as any, amountReceived: 100, idempotencyKey: `chr_${rnd()}`, items: [{ source: "DELIVERY", refId: fri.orderId, amount: 100 }] }, IP, db);
    v = await views(cust, fri.taskId);
    assert(v.total === 0 && v.statement === 0 && v.list?.due === 0 && v.orderLines.length === 0 && v.advance === 0 && v.task.balanceDue === 0,
      `${method}: office payment of ₹100: settled everywhere`);
    // Total paid = total delivered: ₹400 + ₹200 + ₹0 + ₹600 + ₹0 + ₹100 office = ₹1,300 for ₹1,300 of food.
    const paid = await num(db, "SELECT COALESCE(SUM(dc.amount), 0) AS n FROM delivery_collections dc JOIN orders o ON o.id = dc.order_id WHERE o.customer_id = ?", [cust.id]);
    assert(paid === 1300, `${method}: every rupee is on the customer's records once (₹${paid} paid for ₹1,300 delivered)`);
  }

  // Duplicate completions with the same key: one set of records.
  const cust6 = await customer();
  await deliver(await order(cust6, dd, 5), dd, 0);
  const o6 = await order(cust6, dd, 3);
  const key = `chdup_${rnd()}`;
  await Promise.allSettled([1, 2, 3].map(() => deliver(o6, dd, 1000, "CASH", key)));
  const rows6 = await num(db, "SELECT COUNT(*) AS n FROM delivery_collections dc JOIN orders o ON o.id = dc.order_id WHERE o.customer_id = ?", [cust6.id]);
  const sum6 = await num(db, "SELECT COALESCE(SUM(dc.amount), 0) AS n FROM delivery_collections dc JOIN orders o ON o.id = dc.order_id WHERE o.customer_id = ?", [cust6.id]);
  assert(rows6 === 3 && sum6 === 1000, `Same completion sent three times at once: one allocation (3 records, ₹${sum6})`);

  // Reconciliation: the driver holds every rupee collected; handover and cashbook agree.
  const cd = await custodyAs(manager, dd.id);
  const collectedAll = await num(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM delivery_collections WHERE collected_by = ? AND payment_method = 'CASH'", [dd.id]);
  assert(cd.cashCollected === collectedAll && cd.cashOwed === collectedAll, `Driver custody ₹${cd.cashOwed} = all cash collected at the door ₹${collectedAll} (previous dues and advances included)`);
  const hd = await createCashHandoverDeclaration(dd, { shiftDate: day, declaredCash: collectedAll }, IP, db);
  await acceptCashHandover(owner, hd.id, { acceptedCash: collectedAll }, IP, db);
  const after = await custodyAs(owner, dd.id);
  assert(after.cashOwed === 0 && after.cashShort === 0 && (await handoverCash(hd.id)) === collectedAll, `Handover of ₹${collectedAll} accepted: cashbook +₹${collectedAll}, nothing owed`);

  console.log("\n================================================================================");
  console.log(`CASH HANDOVER & DOOR PAYMENTS RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
