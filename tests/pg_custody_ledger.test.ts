/**
 * Live PostgreSQL verification of the staff-wise custody ledger (round 9, migration 0013):
 * attribution per employee, declarations linked to collections, verification with cash/UPI kept
 * separate, discrepancies, duplicates and concurrency, role restrictions, Owner overview totals.
 * Disposable local database only (RN_PG_VERIFY_URL); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createUnifiedOrder } from "../apps/erp/src/server/orders/orderService";
import {
  completeDeliveryTask,
  recordDeliveryCollection,
  getDeliveryTaskById,
  createCashHandoverDeclaration,
  acceptCashHandover,
  listStaffCustody,
  getStaffCustodyDetail,
  listDriverCashHandovers,
} from "../apps/erp/src/server/delivery/deliveryService";
import { createTiffinProduct } from "../apps/erp/src/server/tiffin/tiffinService";
import { AuthenticatedUser } from "../apps/erp/src/types";
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

async function main() {
  console.log("================================================================================");
  console.log("PG STAFF-WISE CUSTODY LEDGER VERIFICATION (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Custody Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Custody Manager");
  const manager2 = await insertStaff(db, "OPERATIONS_MANAGER", "Second Manager");
  const A = await insertStaff(db, "DELIVERY_PERSON", "Driver Asha");
  const B = await insertStaff(db, "DELIVERY_PERSON", "Driver Bilal");
  const day = uniqueBusinessDate(80);
  const thali = await createTiffinProduct(owner, { code: `CU_${rnd()}`.toUpperCase(), name: "Custody Thali", category: "STANDARD_MEAL", billingUnit: "PER_MEAL", price: 100 } as any, undefined, db);

  // Delivers a one-line order for `driver`, collecting `amount` by `method`.
  const deliverFor = async (driver: AuthenticatedUser, qty: number, amount: number, method: "CASH" | "UPI") => {
    process.env.ERP_DEFAULT_DELIVERY_USERNAME = driver.username;
    const order = await createUnifiedOrder(manager, {
      orderType: "DELIVERY", customerName: `Custody ${rnd()}`, customerPhone: phone(), deliveryAddress: "Ledger Lane 4",
      serviceDate: day, mealType: "LUNCH", items: [{ productId: thali.id, productName: "x", quantity: qty, unitPrice: 1 }], idempotencyKey: `cu_${rnd()}`,
    } as any, IP, db);
    const lines = (await getDeliveryTaskById(owner, order.deliveryTaskId!, db))!.task.orderLines!;
    await completeDeliveryTask(driver, order.deliveryTaskId!, {
      lines: lines.map((l) => ({ orderItemId: l.orderItemId, deliveredQuantity: l.quantity, undeliveredQuantity: 0 })),
      recipientName: "Front desk",
      collectedAmount: amount, paymentMethod: method, idempotencyKey: `cu_del_${rnd()}`,
    }, IP, db);
    return order;
  };
  const rowOf = async (actor: AuthenticatedUser, id: string) => (await listStaffCustody(actor, db)).staff.find((r) => r.staffId === id);

  console.log("\n--- 1–4. Collections attributed to the collecting employee ---");
  const aCashOrder = await deliverFor(A, 2, 200, "CASH");
  await deliverFor(B, 3, 300, "CASH");
  const aUpiOrder = await deliverFor(A, 1, 100, "UPI");
  await deliverFor(B, 1, 100, "UPI");
  let a = await rowOf(owner, A.id);
  let b = await rowOf(owner, B.id);
  // UPI is paid straight into the PG account (round 13): booked at once, never held by staff.
  assert(a?.cashPending === 200 && a?.upiPending === 0 && a?.upiCollected === 100, `A holds ₹200 cash; her ₹100 UPI is not held (got ₹${a?.cashPending} / ₹${a?.upiPending})`);
  assert(b?.cashPending === 300 && b?.upiPending === 0, `B holds ₹300 cash and no UPI (got ₹${b?.cashPending} / ₹${b?.upiPending})`);
  const upiBooked = await db.query<any>(
    "SELECT amount FROM financial_transactions WHERE category = 'TIFFIN_DELIVERY_COLLECTION' AND payment_method = 'UPI' AND created_by IN (?, ?) AND idempotency_key LIKE 'dcol_upi_%'",
    [A.id, B.id]
  );
  assert(upiBooked.length === 2 && upiBooked.every((r) => Number(r.amount) === 100), `Each UPI payment is in the books at once (${upiBooked.length} entries)`);

  console.log("\n--- 5. Each employee sees only their own custody ---");
  const aOwn = await listStaffCustody(A, db);
  assert(aOwn.staff.length === 1 && aOwn.staff[0].staffId === A.id, "A's overview contains only A");
  await rejects("A cannot open B's custody", () => getStaffCustodyDetail(A, B.id, db), /only view your own/);
  const aHandoversView = await listDriverCashHandovers(A, { driverId: B.id }, db);
  assert(aHandoversView.every((h) => h.driverId === A.id), "A's handover list never includes B's");

  console.log("\n--- Manager collecting a balance is the Manager's custody, not the driver's ---");
  const partial = await (async () => {
    process.env.ERP_DEFAULT_DELIVERY_USERNAME = A.username;
    const o = await createUnifiedOrder(manager, { orderType: "DELIVERY", customerName: `Part ${rnd()}`, customerPhone: phone(), deliveryAddress: "Ledger Lane 5", serviceDate: day, mealType: "DINNER", items: [{ productId: thali.id, productName: "x", quantity: 1, unitPrice: 1 }], idempotencyKey: `cu_${rnd()}` } as any, IP, db);
    const l = (await getDeliveryTaskById(owner, o.deliveryTaskId!, db))!.task.orderLines!;
    await completeDeliveryTask(A, o.deliveryTaskId!, { lines: [{ orderItemId: l[0].orderItemId, deliveredQuantity: 1, undeliveredQuantity: 0 }], recipientName: "Front desk", collectedAmount: 60, paymentMethod: "CASH", idempotencyKey: `cu_del_${rnd()}` }, IP, db);
    return o;
  })();
  await recordDeliveryCollection(manager, partial.deliveryTaskId!, { collectedAmount: 40, paymentMethod: "CASH", idempotencyKey: `cu_bal_${rnd()}` }, IP, db);
  a = await rowOf(owner, A.id);
  const m = await rowOf(owner, manager.id);
  assert(a?.cashPending === 260 && m?.cashPending === 40, `Driver gets the ₹60 collected at the door, Manager the ₹40 received later (A ₹${a?.cashPending}, Manager ₹${m?.cashPending})`);

  console.log("\n--- 6–7, 16. A declares; B unchanged; duplicates and concurrency ---");
  await rejects("Stated cash different from the records is rejected", () => createCashHandoverDeclaration(A, { shiftDate: day, declaredCash: 999 }, IP, db), /at most ₹260/);
  const decl = await Promise.allSettled([1, 2].map(() => createCashHandoverDeclaration(A, { shiftDate: day, notes: "End of shift" }, IP, db)));
  const ok = decl.filter((r) => r.status === "fulfilled").map((r: any) => r.value);
  assert(ok.length === 1, `Two simultaneous declarations → exactly one accepted (${ok.length})`);
  const hA = ok[0];
  assert(hA.declaredCash === 260 && (hA.declaredUpi || 0) === 0 && hA.collectionCount === 2 && hA.declaredBy === A.id, `Declaration is cash only, computed from records: cash ₹${hA.declaredCash}, UPI ₹${hA.declaredUpi}, ${hA.collectionCount} collections`);
  await rejects("A second declaration while one awaits verification is rejected", () => createCashHandoverDeclaration(A, { shiftDate: day }, IP, db), /already awaiting/);
  b = await rowOf(owner, B.id);
  assert(b?.cashPending === 300 && b?.upiPending === 0 && b?.pendingHandovers === 0, "B's custody unchanged by A's declaration");
  a = await rowOf(owner, A.id);
  assert(a?.cashUndeclared === 0 && a?.cashAwaitingAcceptance === 260 && a?.cashPending === 260 && a?.status === "AWAITING_ACCEPTANCE", "A still holds ₹260 until verified (awaiting acceptance)");

  console.log("\n--- 8–11, 17–18. Verification ---");
  const pending = await listDriverCashHandovers(manager, { status: "DECLARED" }, db);
  assert(pending.some((h) => h.id === hA.id && h.driverName === "Driver Asha"), "Manager sees A's declaration with A's name");
  await rejects("A cannot verify her own handover (delivery staff cannot verify at all)", () => acceptCashHandover(A, hA.id, { acceptedCash: 260 }, IP, db), /owner|permission|cannot accept their own/);
  await rejects("Stale record (wrong employee on screen) rejected", () => acceptCashHandover(owner, hA.id, { acceptedCash: 260, expectedDriverId: B.id }, IP, db), /different employee/);
  await rejects("Stale amounts rejected", () => acceptCashHandover(owner, hA.id, { acceptedCash: 260, expectedDeclaredCash: 250 }, IP, db), /differ from what is on your screen/);
  await rejects("A UPI figure on a cash-only handover is rejected", () => acceptCashHandover(owner, hA.id, { acceptedCash: 260, acceptedUpi: 50 }, IP, db), /No UPI was declared/);
  assert((await listDriverCashHandovers(manager, { status: "DECLARED" }, db)).some((h) => h.id === hA.id), "Failed attempts left the declaration untouched");
  await rejects("A Manager cannot accept a handover (cash goes to the Owner only)", () => acceptCashHandover(manager, hA.id, { acceptedCash: 260 }, IP, db), /Only the owner/);
  const acc = await Promise.allSettled([owner, owner].map((v) => acceptCashHandover(v, hA.id, { acceptedCash: 260, expectedDriverId: A.id, expectedDeclaredCash: 260 }, IP, db)));
  assert(acc.filter((r) => r.status === "fulfilled").length === 1, "Accepting twice at once → exactly one succeeds");
  const ledgerRows = await db.query<any>("SELECT payment_method, amount FROM financial_transactions WHERE reference_number = ? ORDER BY payment_method", [hA.id]);
  assert(ledgerRows.length === 1 && ledgerRows[0].payment_method === "CASH" && Number(ledgerRows[0].amount) === 260, `Books get exactly one cash entry of ₹260 for the handover (${ledgerRows.map((r) => `${r.payment_method} ₹${r.amount}`).join(", ")})`);
  await rejects("Accepting again is rejected", () => acceptCashHandover(owner, hA.id, { acceptedCash: 260 }, IP, db), /already been accepted/);
  const aDetail = await getStaffCustodyDetail(A, A.id, db);
  assert(aDetail.handovers[0].status === "ACCEPTED" && aDetail.custody.cashPending === 0 && aDetail.custody.cashHandedOver === 260, "A sees the handover accepted; nothing pending");
  const aTask = (await getDeliveryTaskById(owner, aCashOrder.deliveryTaskId!, db))!.task;
  assert(aTask.collectionStatus === "HANDED_OVER" && aTask.handoverId === hA.id, "A's cash delivery is marked handed over and linked to the handover");
  const upiCol = await db.queryOne<any>("SELECT handover_id, transaction_id FROM delivery_collections WHERE delivery_task_id = ?", [aUpiOrder.deliveryTaskId]);
  assert(!upiCol.handover_id && Boolean(upiCol.transaction_id), "A's UPI delivery is in no handover; it is linked to its own cashbook entry");
  b = await rowOf(owner, B.id);
  assert(b?.cashPending === 300 && b?.cashHandedOver === 0, "B's custody unchanged by A's acceptance");

  console.log("\n--- 12–15. Discrepancy, Owner overview and totals ---");
  const hB = await createCashHandoverDeclaration(B, { shiftDate: day }, IP, db);
  await rejects("Short cash without a reason is rejected", () => acceptCashHandover(owner, hB.id, { acceptedCash: 250 }, IP, db), /explanation/);
  const flagged = await acceptCashHandover(owner, hB.id, { acceptedCash: 250, varianceReason: "₹50 short at counting; Bilal to explain", expectedDriverId: B.id }, IP, db);
  assert(flagged.status === "DISCREPANCY_FLAGGED" && flagged.declaredCash === 300 && flagged.acceptedCash === 250 && flagged.variance === -50, "Discrepancy recorded; original ₹300 declaration kept, ₹250 received");
  const overview = await listStaffCustody(owner, db);
  b = overview.staff.find((r) => r.staffId === B.id);
  a = overview.staff.find((r) => r.staffId === A.id);
  assert(Boolean(a) && Boolean(b) && a!.staffId !== b!.staffId, "Owner sees separate rows for A and B");
  assert(b?.status === "DISCREPANCY" && b?.cashShort === 50 && b?.cashPending === 0, `Owner sees B ₹50 short (got ₹${b?.cashShort}, ${b?.status})`);
  const sum = (k: keyof typeof overview.totals) => overview.staff.reduce((s, r) => s + (r[k] as number), 0);
  assert(["cashCollected", "upiCollected", "cashHandedOver", "upiReconciled", "cashPending", "upiPending", "cashShort"].every((k) => overview.totals[k as keyof typeof overview.totals] === sum(k as any)), "Aggregate totals equal the sum of the employee rows");

  console.log("\n--- Payment after a handover; Manager's own custody ---");
  // A part-paid order whose balance is paid after the earlier part was handed over.
  process.env.ERP_DEFAULT_DELIVERY_USERNAME = A.username;
  const later = await createUnifiedOrder(manager, { orderType: "DELIVERY", customerName: `Later ${rnd()}`, customerPhone: phone(), deliveryAddress: "Ledger Lane 6", serviceDate: day, mealType: "DINNER", items: [{ productId: thali.id, productName: "x", quantity: 1, unitPrice: 1 }], idempotencyKey: `cu_${rnd()}` } as any, IP, db);
  const ll = (await getDeliveryTaskById(owner, later.deliveryTaskId!, db))!.task.orderLines!;
  await completeDeliveryTask(A, later.deliveryTaskId!, { lines: [{ orderItemId: ll[0].orderItemId, deliveredQuantity: 1, undeliveredQuantity: 0 }], recipientName: "Front desk", collectedAmount: 70, paymentMethod: "CASH", idempotencyKey: `cu_del_${rnd()}` }, IP, db);
  const hA2 = await createCashHandoverDeclaration(A, { shiftDate: day }, IP, db);
  await acceptCashHandover(owner, hA2.id, { acceptedCash: 70, expectedDriverId: A.id }, IP, db);
  const paidLater = await recordDeliveryCollection(A, later.deliveryTaskId!, { collectedAmount: 30, paymentMethod: "UPI", idempotencyKey: `cu_late_${rnd()}` }, IP, db);
  a = await rowOf(owner, A.id);
  assert(paidLater.balanceDue === 0 && a?.upiUndeclared === 0 && a?.cashUndeclared === 0 && a?.cashPending === 0, `Balance paid by UPI after a handover goes straight to the books; A holds nothing (balance ₹${paidLater.balanceDue}, UPI held ₹${a?.upiUndeclared})`);
  const hM = await createCashHandoverDeclaration(manager, { shiftDate: day }, IP, db);
  assert(hM.declaredCash === 40 && hM.driverId === manager.id, "Manager declares the ₹40 they received");
  await rejects("Manager cannot accept their own declaration either", () => acceptCashHandover(manager, hM.id, { acceptedCash: 40 }, IP, db), /Only the owner/);
  const ownerAccepts = await acceptCashHandover(owner, hM.id, { acceptedCash: 40, expectedDriverId: manager.id }, IP, db);
  assert(ownerAccepts.status === "ACCEPTED" && ownerAccepts.acceptedBy === owner.id, "Owner verifies the Manager's custody");

  console.log("\n--- 20. History intact ---");
  const histA = await listDriverCashHandovers(owner, { driverId: A.id }, db);
  const firstA = histA.find((h) => h.id === hA.id)!;
  // Whichever of the two racing managers won is recorded as the verifier.
  assert(
    firstA.declaredCash === 260 && (firstA.declaredUpi || 0) === 0 && firstA.acceptedCash === 260 && (firstA.acceptedUpi || 0) === 0 &&
      firstA.acceptedBy === owner.id && firstA.acceptedByName === "Custody Owner",
    `Earlier handover keeps its declared/accepted figures and verifier (${firstA.acceptedByName})`
  );
  const audit = await db.query<any>("SELECT action FROM audit_logs WHERE target_id = ? ORDER BY created_at", [hB.id]);
  assert(audit.map((r) => r.action).join(",") === "delivery.cash_handover_declared,delivery.cash_handover_accepted", "Declaration and verification are both in the audit trail");

  console.log("\n--- 21. Handing over a different amount needs a reason; records stay exact ---");
  const C = await insertStaff(db, "DELIVERY_PERSON", "Driver Chitra");
  await deliverFor(C, 2, 200, "CASH");
  await rejects("Different amount without a reason is refused", () => createCashHandoverDeclaration(C, { shiftDate: day, declaredCash: 150 }, IP, db), /Explain the ₹50 difference/);
  const hC = await createCashHandoverDeclaration(C, { shiftDate: day, declaredCash: 150, notes: "Gave ₹50 change to a customer" }, IP, db);
  assert(hC.declaredCash === 150 && hC.recordedCash === 200 && hC.shortfallCash === 50 && hC.shortfallReason === "Gave ₹50 change to a customer",
    `Handed over ₹${hC.declaredCash} of ₹${hC.recordedCash} recorded; the ₹${hC.shortfallCash} shortfall and its reason are kept separately`);
  const cRow = await rowOf(owner, C.id);
  assert(cRow?.cashUndeclared === 0 && cRow?.cashAwaitingAcceptance === 150 && cRow?.cashShort === 50 && cRow?.cashOwed === 50,
    `Only the ₹150 handed over awaits the manager; the ₹50 stays owed by C (nothing disappears): awaiting ₹${cRow?.cashAwaitingAcceptance}, short ₹${cRow?.cashShort}`);

  console.log(`\nCUSTODY LEDGER RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
