/**
 * Live PostgreSQL verification of money-moving workflows (ISSUE-007).
 *
 * Runs only against a disposable local database (RN_PG_VERIFY_URL, see helpers/pgVerifyTarget),
 * with synthetic data. Every section exercises the real service layer on PostgreSQL and checks
 * duplicate submissions, concurrency, invalid transitions and rollback:
 *   A. Rent payments: idempotency under concurrent retries, mismatched-key reuse, overpayment race
 *   B. Reversals: concurrent double reversal, reversal of a reversal
 *   C. Checkout settlement: deposit application (no cash) + refund (cash out), concurrent double settle
 *   D. Driver cash handover: concurrent double acceptance, re-acceptance, closed-date acceptance
 *   E. Tiffin payments: concurrent idempotent retries, closed-date rejection
 *   F. Invoices: concurrent issuance numbering, over-allocation race, cancel rules
 *   G. Rollback: a failure inside the ledger transaction leaves no partial rows
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createRoom } from "../apps/erp/src/server/rooms/roomService";
import { registerResident, assignResidentToRoom } from "../apps/erp/src/server/residents/residentService";
import { finalizeResidentCheckoutSettlement } from "../apps/erp/src/server/residents/residentSettlementService";
import { proposeResidentSettlement, approveSettlementProposal } from "../apps/erp/src/server/residents/settlementApprovalService";
import {
  recordRentCharge,
  recordRentPayment,
  recordSecurityDeposit,
  recordExpense,
  reverseTransaction,
} from "../apps/erp/src/server/finance/financeService";
import { finalizeDailyClosing, saveDailyClosingDraft, reopenDailyClosing, previewDailyClosing } from "../apps/erp/src/server/finance/cashbookClosingService";
import { getBusinessDateString } from "../apps/erp/src/server/finance/financeService";
import { uploadDocument, archiveDocument } from "../apps/erp/src/server/documents/documentService";
import { generateTiffinInvoices } from "../apps/erp/src/server/tiffin/tiffinBillingService";
import { createInvoice, issueInvoice, allocatePaymentToInvoice, cancelInvoice } from "../apps/erp/src/server/finance/invoiceService";
import { createTiffinCustomer } from "../apps/erp/src/server/tiffin/tiffinService";
import { recordTiffinPayment } from "../apps/erp/src/server/tiffin/tiffinBillingService";
import {
  createExternalDeliveryTask,
  assignDeliveryTask,
  dispatchDeliveryTask,
  completeDeliveryTask,
  createCashHandoverDeclaration,
  acceptCashHandover,
} from "../apps/erp/src/server/delivery/deliveryService";
import { AuthenticatedUser } from "../apps/erp/src/types";
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
const settled = (rs: PromiseSettledResult<any>[]) => ({
  ok: rs.filter((r) => r.status === "fulfilled").map((r: any) => r.value),
  errors: rs.filter((r) => r.status === "rejected").map((r: any) => String(r.reason?.message ?? r.reason)),
});
const isDbFailure = (msg: string) => /40P01|deadlock|current transaction is aborted|duplicate key|violates/i.test(msg);

async function count(db: AsyncDb, sql: string, params: any[]): Promise<number> {
  const row = await db.queryOne<any>(sql, params);
  return Number(row?.n ?? 0);
}

async function residentWithStay(db: AsyncDb, owner: AuthenticatedUser, checkInDate: string, rent = 6000) {
  const room = await createRoom(owner, {
    roomNumber: `V${rnd()}`.toUpperCase(),
    floor: 1,
    type: "DOUBLE_SHARING",
    capacity: 2,
    baseRentMonthly: rent,
  }, IP, db);
  const resident = await registerResident(owner, { fullName: `Verify Resident ${rnd()}`, phone: phone() }, IP, db);
  const stay = await assignResidentToRoom(owner, {
    residentId: resident.id,
    roomId: room.id,
    checkInDate,
    monthlyRent: rent,
  }, IP, db);
  return { residentId: resident.id as string, stayId: stay.id as string };
}

async function main() {
  console.log("================================================================================");
  console.log("PG MONEY FLOWS VERIFICATION (live local PostgreSQL)");
  console.log("================================================================================");

  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  assert(db.isPostgres === true, "Service layer is running on PostgreSQL");

  const owner = await insertStaff(db, "SUPER_ADMIN", "Money Flow Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Money Flow Manager");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "Money Flow Driver");
  const day = uniqueBusinessDate(20);

  // ---------------------------------------------------------------------------
  console.log("\n--- A. Rent payments ---");
  {
    const { residentId, stayId } = await residentWithStay(db, owner, day);
    await recordRentCharge(owner, { residentId, stayId, amount: 6000, transactionDate: day, billingPeriod: "Verify Month" }, IP, db);

    const key = `pay_${rnd()}`;
    const retries = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        recordRentPayment(manager, { residentId, stayId, amount: 2000, transactionDate: day, paymentMethod: "CASH", idempotencyKey: key }, IP, db)
      )
    );
    const r = settled(retries);
    assert(r.errors.filter(isDbFailure).length === 0, `Concurrent retries raise no raw DB errors (${r.errors.join(" | ") || "none"})`);
    assert(
      (await count(db, "SELECT COUNT(*)::int AS n FROM financial_transactions WHERE idempotency_key = ?", [key])) === 1,
      "Five concurrent submissions with one idempotency key create exactly one payment"
    );

    let mismatch: any = null;
    try {
      await recordRentPayment(manager, { residentId, stayId, amount: 2500, transactionDate: day, paymentMethod: "CASH", idempotencyKey: key }, IP, db);
    } catch (e) {
      mismatch = e;
    }
    assert(mismatch !== null, "Reusing an idempotency key with a different amount is rejected");

    // Remaining due is 4000. Two concurrent 3000 payments must not both succeed (overpayment).
    const race = settled(
      await Promise.allSettled([
        recordRentPayment(owner, { residentId, stayId, amount: 3000, transactionDate: day, paymentMethod: "UPI" }, IP, db),
        recordRentPayment(manager, { residentId, stayId, amount: 3000, transactionDate: day, paymentMethod: "CASH" }, IP, db),
      ])
    );
    const paid = await count(
      db,
      "SELECT COALESCE(SUM(amount),0)::int AS n FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'RENT_PAYMENT' AND status = 'POSTED'",
      [residentId]
    );
    assert(paid <= 6000, `Concurrent payments cannot exceed rent charged (paid ₹${paid} of ₹6000; ${race.ok.length} succeeded)`);
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- B. Reversals ---");
  {
    const { residentId, stayId } = await residentWithStay(db, owner, day);
    const charge = await recordRentCharge(owner, { residentId, stayId, amount: 5000, transactionDate: day, billingPeriod: "Verify Month" }, IP, db);
    const rev = settled(
      await Promise.allSettled([
        reverseTransaction(owner, charge.id, "Billed in error (verify A)", IP, db),
        reverseTransaction(owner, charge.id, "Billed in error (verify B)", IP, db),
      ])
    );
    const reversals = await count(db, "SELECT COUNT(*)::int AS n FROM financial_transactions WHERE reversal_of_id = ?", [charge.id]);
    assert(reversals === 1, `Concurrent double reversal produces exactly one reversal row (got ${reversals}; ${rev.errors.join(" | ")})`);
    const original = await db.queryOne<any>("SELECT status FROM financial_transactions WHERE id = ?", [charge.id]);
    assert(original.status === "REVERSED", "Original transaction marked REVERSED");

    const reversalRow = await db.queryOne<any>("SELECT id FROM financial_transactions WHERE reversal_of_id = ?", [charge.id]);
    let revOfRev: any = null;
    try {
      await reverseTransaction(owner, reversalRow.id, "Reverse the reversal", IP, db);
    } catch (e) {
      revOfRev = e;
    }
    assert(revOfRev !== null, "A reversal entry cannot itself be reversed");

    let mgrRev: any = null;
    const charge2 = await recordRentCharge(manager, { residentId, stayId, amount: 100, transactionDate: day, billingPeriod: "Verify Month" }, IP, db);
    try {
      await reverseTransaction(manager, charge2.id, "Manager reversal attempt", IP, db);
    } catch (e) {
      mgrRev = e;
    }
    assert(mgrRev?.statusCode === 403, "Manager cannot reverse transactions (403)");

    // Reversals are dated today. Reversing a charge moves no money, so today's closing must not
    // show it as an outflow; reversing a cash payment must (it is money handed back).
    const today = getBusinessDateString(new Date());
    const before = await previewDailyClosing(owner, today, "COMBINED", db);
    const charge3 = await recordRentCharge(owner, { residentId, stayId, amount: 700, transactionDate: day, billingPeriod: "Verify Month" }, IP, db);
    await reverseTransaction(owner, charge3.id, "Charge raised in error (closing check)", IP, db);
    const afterCharge = await previewDailyClosing(owner, today, "COMBINED", db);
    assert(
      afterCharge.totalOutflow === before.totalOutflow && afterCharge.expectedCashBalance === before.expectedCashBalance,
      `Reversing a rent charge is not a cash outflow in the daily closing (outflow ${before.totalOutflow} -> ${afterCharge.totalOutflow})`
    );
    const payment = await recordRentPayment(owner, { residentId, stayId, amount: 100, transactionDate: day, paymentMethod: "CASH" }, IP, db);
    await reverseTransaction(owner, payment.id, "Payment recorded in error (closing check)", IP, db);
    const afterPayment = await previewDailyClosing(owner, today, "COMBINED", db);
    assert(
      afterPayment.channelBreakdown.CASH.outflow === afterCharge.channelBreakdown.CASH.outflow + 100,
      "Reversing a cash payment shows as a cash outflow in the daily closing"
    );
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- C. Checkout settlement ---");
  {
    const { residentId, stayId } = await residentWithStay(db, owner, day);
    await recordSecurityDeposit(manager, { residentId, stayId, amount: 10000, transactionDate: day, paymentMethod: "CASH" }, IP, db);
    await recordRentCharge(manager, { residentId, stayId, amount: 6000, transactionDate: day, billingPeriod: "Verify Month" }, IP, db);
    await recordRentPayment(manager, { residentId, stayId, amount: 2000, transactionDate: day, paymentMethod: "CASH" }, IP, db);
    // Outstanding 4000; deposit 10000; deduction 500 → apply 4000, refund 5500.
    const input = {
      residentId,
      checkOutDate: day,
      deductions: [{ reason: "Broken chair", amount: 500 }],
      depositAppliedAmount: 4000,
      refundAmount: 5500,
      refundPaymentMethod: "CASH" as const,
    };
    // Existing rule (residents.manage OR finance.manage): the Manager performs check-outs, including
    // the deposit refund. Recorded as an open owner question in ISSUE_REGISTER (ISSUE-026).
    const other = await residentWithStay(db, owner, day);
    await recordSecurityDeposit(manager, { residentId: other.residentId, stayId: other.stayId, amount: 3000, transactionDate: day, paymentMethod: "CASH" }, IP, db);
    // Decision 2026-11-01 (closes ISSUE-026): the Manager prepares, the Owner approves refunds.
    let mgrDenied: any = null;
    try {
      await finalizeResidentCheckoutSettlement(manager, {
        residentId: other.residentId, checkOutDate: day, refundAmount: 3000, refundPaymentMethod: "CASH",
      } as any, IP, db);
    } catch (e) {
      mgrDenied = e;
    }
    assert(mgrDenied?.statusCode === 403 && /Owner's approval/.test(mgrDenied.message), "Manager cannot finalize a deposit refund (needs the Owner's approval)");
    const proposal = await proposeResidentSettlement(manager, { residentId: other.residentId, checkOutDate: day, refundAmount: 3000, refundPaymentMethod: "CASH" } as any, IP, db);
    const stillIn = await db.queryOne<any>("SELECT status FROM resident_stays WHERE id = ?", [other.stayId]);
    assert(proposal.status === "PENDING" && stillIn?.status === "ACTIVE", "Manager's settlement waits for approval; the stay stays open and nothing is posted");
    const mgrSettlement = await approveSettlementProposal(owner, proposal.id, "Checked the room", IP, db);
    const decided = await db.queryOne<any>("SELECT status, settlement_id FROM settlement_proposals WHERE id = ?", [proposal.id]);
    assert(Boolean(mgrSettlement?.id) && decided?.status === "APPROVED" && decided?.settlement_id === mgrSettlement.id, "Owner approves: settlement finalized and the proposal marked approved with it");

    const both = settled(
      await Promise.allSettled([
        finalizeResidentCheckoutSettlement(owner, input as any, IP, db),
        finalizeResidentCheckoutSettlement(owner, input as any, IP, db),
      ])
    );
    const settlements = await count(db, "SELECT COUNT(*)::int AS n FROM resident_settlements WHERE stay_id = ?", [stayId]);
    assert(settlements === 1, `Concurrent double settlement creates exactly one settlement (got ${settlements}; ok=${both.ok.length}; ${both.errors.join(" | ")})`);
    const refunds = await count(
      db,
      "SELECT COALESCE(SUM(amount),0)::int AS n FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'DEPOSIT_REFUND' AND status = 'POSTED'",
      [residentId]
    );
    assert(refunds === 5500, `Deposit refunded exactly once (₹${refunds})`);
    const stay = await db.queryOne<any>("SELECT status FROM resident_stays WHERE id = ?", [stayId]);
    assert(stay.status === "COMPLETED", "Stay COMPLETED after settlement");
    const applications = await db.query<any>(
      "SELECT transaction_type, payment_method, amount FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'RENT_PAYMENT' AND category = 'DEPOSIT_APPLICATION'",
      [residentId]
    );
    assert(
      applications.length === 1 && Number(applications[0].amount) === 4000,
      `Deposit application recorded once for ₹4000 (rows=${applications.length})`
    );
    assert(applications[0]?.payment_method === "OTHER", "Deposit application is a non-cash entry (method OTHER)");
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- D. Driver cash handover ---");
  {
    const shiftDate = uniqueBusinessDate(21);
    let collected = 0;
    for (const amount of [150, 230]) {
      const task = await createExternalDeliveryTask(owner, {
        serviceDate: shiftDate,
        mealType: "DINNER",
        customerName: "Handover Customer",
        customerPhone: phone(),
        deliveryAddress: "House 4, Verification Lane",
      }, IP, db);
      await assignDeliveryTask(owner, task.id, { assignedToStaffId: driver.id }, IP, db);
      const st = await db.queryOne<any>("SELECT status FROM delivery_tasks WHERE id = ?", [task.id]);
      if (st.status !== "OUT_FOR_DELIVERY") await dispatchDeliveryTask(owner, task.id, IP, db);
      await completeDeliveryTask(driver, task.id, { collectedAmount: amount, paymentMethod: "CASH", idempotencyKey: `col_${rnd()}` }, IP, db);
      collected += amount;
    }
    const handover = await createCashHandoverDeclaration(driver, { shiftDate, declaredCash: collected }, IP, db);
    assert(handover.status === "DECLARED", `Driver declared ₹${collected} for the shift`);

    const accepts = settled(
      await Promise.allSettled([
        acceptCashHandover(owner, handover.id, { acceptedCash: collected }, IP, db),
        acceptCashHandover(owner, handover.id, { acceptedCash: collected }, IP, db),
      ])
    );
    const ledger = await db.query<any>(
      "SELECT amount, transaction_date FROM financial_transactions WHERE idempotency_key = ? AND status = 'POSTED'",
      [`dch_tx_${handover.id}`]
    );
    const posted = ledger.reduce((s: number, r: any) => s + Number(r.amount), 0);
    assert(ledger.length === 1 && ledger[0].transaction_date === getBusinessDateString(), `Cashbook entry dated the handover day ${getBusinessDateString()}, not the shift ${shiftDate}`);
    assert(accepts.ok.length === 1, `Exactly one concurrent acceptance succeeds (ok=${accepts.ok.length}; ${accepts.errors.join(" | ")})`);
    assert(posted === collected, `Accepted cash posted to the ledger exactly once (₹${posted} of ₹${collected})`);
    assert(accepts.errors.filter(isDbFailure).length === 0, "Losing acceptance fails with a business error, not a raw DB error");

    let again: any = null;
    try {
      await acceptCashHandover(owner, handover.id, { acceptedCash: collected }, IP, db);
    } catch (e) {
      again = e;
    }
    assert(again !== null, "An ACCEPTED handover cannot be accepted again");

    // Acceptance on a day whose TIFFIN closing is finalized must be refused (the cashbook date is
    // the handover day). Today's closing is finalized for the check and reopened afterwards.
    const closedShift = uniqueBusinessDate(22);
    const t = await createExternalDeliveryTask(owner, {
      serviceDate: closedShift,
      mealType: "LUNCH",
      customerName: "Closed Day Customer",
      customerPhone: phone(),
      deliveryAddress: "House 9, Verification Lane",
    }, IP, db);
    await assignDeliveryTask(owner, t.id, { assignedToStaffId: driver.id }, IP, db);
    const st2 = await db.queryOne<any>("SELECT status FROM delivery_tasks WHERE id = ?", [t.id]);
    if (st2.status !== "OUT_FOR_DELIVERY") await dispatchDeliveryTask(owner, t.id, IP, db);
    await completeDeliveryTask(driver, t.id, { collectedAmount: 90, paymentMethod: "CASH", idempotencyKey: `col_${rnd()}` }, IP, db);
    const lateHandover = await createCashHandoverDeclaration(driver, { shiftDate: closedShift, declaredCash: 90 }, IP, db);
    const todayClosing = await finalizeDailyClosing(owner, { closingDate: getBusinessDateString(), division: "TIFFIN", actualCashCounted: 0, discrepancyReason: "verification close" }, IP, db);
    let closedErr: any = null;
    try {
      await acceptCashHandover(owner, lateHandover.id, { acceptedCash: 90 }, IP, db);
    } catch (e) {
      closedErr = e;
    }
    await reopenDailyClosing(owner, { closingId: (todayClosing as any).id, reason: "Reopened after the verification check" }, IP, db);
    assert(closedErr !== null && /FINALIZED/.test(closedErr.message), "Handover for a finalized TIFFIN date is refused");
    assert(
      (await count(db, "SELECT COUNT(*)::int AS n FROM financial_transactions WHERE idempotency_key = ?", [`dch_tx_${lateHandover.id}`])) === 0,
      "Refused handover left no ledger row"
    );
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- E. Tiffin payments ---");
  {
    const customer = await createTiffinCustomer(manager, {
      fullName: `Verify Tiffin ${rnd()}`,
      phone: phone(),
      deliveryAddress: "Flat 2, Verification Block",
    }, IP, db);
    const payDay = uniqueBusinessDate(23);
    const key = `tif_${rnd()}`;
    const r = settled(
      await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          recordTiffinPayment(owner, { customerId: customer.id, amount: 1800, transactionDate: payDay, paymentMethod: "UPI", idempotencyKey: key }, IP, db)
        )
      )
    );
    assert(
      (await count(db, "SELECT COUNT(*)::int AS n FROM financial_transactions WHERE idempotency_key = ?", [key])) === 1,
      `Four concurrent tiffin payments with one key create exactly one row (errors: ${r.errors.join(" | ") || "none"})`
    );
    assert(r.errors.filter(isDbFailure).length === 0, "Duplicate tiffin submissions raise no raw DB errors");

    let mgrPay: any = null;
    try {
      await recordTiffinPayment(manager, { customerId: customer.id, amount: 100, transactionDate: payDay, paymentMethod: "CASH" }, IP, db);
    } catch (e) {
      mgrPay = e;
    }
    assert(mgrPay?.statusCode === 403, "Tiffin customer payments stay Owner-only (unchanged by ISSUE-010)");

    const closedDay = uniqueBusinessDate(24);
    await finalizeDailyClosing(owner, { closingDate: closedDay, division: "TIFFIN", actualCashCounted: 0, discrepancyReason: "verification close" }, IP, db);
    let closedErr: any = null;
    try {
      await recordTiffinPayment(owner, { customerId: customer.id, amount: 500, transactionDate: closedDay, paymentMethod: "CASH" }, IP, db);
    } catch (e) {
      closedErr = e;
    }
    assert(closedErr !== null && /FINALIZED/.test(closedErr.message), "Tiffin payment on a finalized date is refused");
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- F. Invoices ---");
  {
    const { residentId, stayId } = await residentWithStay(db, owner, day);
    const issueDay = uniqueBusinessDate(25);
    const drafts = [];
    for (let i = 0; i < 5; i++) {
      drafts.push(
        await createInvoice(owner, {
          residentId,
          stayId,
          invoiceType: "REGULAR_BILL",
          issueDate: issueDay,
          dueDate: issueDay,
          billingPeriod: `Verify Period ${i}`,
          items: [{ description: `Rent part ${i}`, unitPrice: 1000 + i, quantity: 1 }],
        } as any, IP, db)
      );
    }
    const issued = settled(await Promise.allSettled(drafts.map((d: any) => issueInvoice(owner, d.id, undefined, IP, db))));
    const numbers = issued.ok.map((inv: any) => inv.invoiceNumber);
    assert(issued.ok.length === 5, `All five concurrent issuances succeed (${issued.errors.join(" | ") || "no errors"})`);
    assert(new Set(numbers).size === numbers.length, `Concurrent issuance assigns unique invoice numbers (${numbers.join(", ")})`);

    const target: any = issued.ok[0];
    const payment = await recordRentPayment(owner, { residentId, stayId, amount: target.totalAmount, transactionDate: issueDay, paymentMethod: "CASH" }, IP, db).catch(() => null);
    const payTxn = payment ?? (await recordRentCharge(owner, { residentId, stayId, amount: 50000, transactionDate: issueDay, billingPeriod: "Verify cover" }, IP, db)
      .then(() => recordRentPayment(owner, { residentId, stayId, amount: target.totalAmount, transactionDate: issueDay, paymentMethod: "CASH" }, IP, db)));
    const alloc = settled(
      await Promise.allSettled([
        allocatePaymentToInvoice(owner, { invoiceId: target.id, paymentTransactionId: payTxn.id, amount: target.totalAmount }, IP, db),
        allocatePaymentToInvoice(owner, { invoiceId: target.id, paymentTransactionId: payTxn.id, amount: target.totalAmount }, IP, db),
      ])
    );
    const inv = await db.queryOne<any>("SELECT amount_paid, total_amount, status FROM invoices WHERE id = ?", [target.id]);
    assert(
      Number(inv.amount_paid) <= Number(inv.total_amount),
      `Concurrent allocations cannot over-pay an invoice (paid ₹${inv.amount_paid} of ₹${inv.total_amount}; ok=${alloc.ok.length})`
    );

    let cancelPaid: any = null;
    try {
      await cancelInvoice(owner, target.id, "Attempt to cancel a paid invoice", IP, db);
    } catch (e) {
      cancelPaid = e;
    }
    assert(cancelPaid !== null, "An invoice with allocated payments cannot be cancelled");

    const unpaid: any = issued.ok[1];
    let mgrCancel: any = null;
    try {
      await cancelInvoice(manager, unpaid.id, "Manager cancellation attempt", IP, db);
    } catch (e) {
      mgrCancel = e;
    }
    assert(mgrCancel?.statusCode === 403, "Manager cannot cancel invoices (403)");
    const cancelled = await cancelInvoice(owner, unpaid.id, "Duplicate bill (verification)", IP, db);
    assert(cancelled.status === "CANCELLED", "Owner cancels an unpaid invoice");
    let reissue: any = null;
    try {
      await issueInvoice(owner, unpaid.id, undefined, IP, db);
    } catch (e) {
      reissue = e;
    }
    assert(reissue !== null, "A cancelled invoice cannot be issued again");
  }

  // ---------------------------------------------------------------------------
  console.log("\n--- G. Rollback on failure inside the ledger transaction ---");
  {
    const { residentId, stayId } = await residentWithStay(db, owner, day);
    const failing: AsyncDb = {
      ...db,
      isPostgres: true,
      query: db.query.bind(db),
      queryOne: db.queryOne.bind(db),
      execute: db.execute.bind(db),
      transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T> {
        return db.transaction((tx) => {
          const wrapped: AsyncDb = {
            isPostgres: true,
            query: tx.query.bind(tx),
            queryOne: tx.queryOne.bind(tx),
            async execute(sql: string, params?: any[]) {
              if (/INSERT INTO audit_logs/i.test(sql)) throw new Error("simulated audit write failure");
              return tx.execute(sql, params);
            },
            transaction: (nested) => nested(wrapped),
          };
          return cb(wrapped);
        });
      },
    };
    let err: any = null;
    try {
      await recordSecurityDeposit(owner, { residentId, stayId, amount: 7000, transactionDate: day, paymentMethod: "CASH", description: "rollback probe" }, IP, failing);
    } catch (e) {
      err = e;
    }
    assert(err !== null && /simulated audit write failure/.test(err.message), "Failure inside the transaction surfaces to the caller");
    assert(
      (await count(db, "SELECT COUNT(*)::int AS n FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'SECURITY_DEPOSIT'", [residentId])) === 0,
      "No ledger row survives the failed transaction (atomic rollback)"
    );
  }


  // ---------------------------------------------------------------------------
  console.log("\n--- H. Financial permission matrix (ISSUE-010 option b) ---");
  {
    // Minimal valid PNG (magic bytes checked server-side).
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
        "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
      "hex"
    );
    const { residentId, stayId } = await residentWithStay(db, owner, day);
    const hDay = uniqueBusinessDate(26);

    const expectAllowed = async (label: string, fn: () => Promise<any>) => {
      try {
        await fn();
        assert(true, `ALLOWED  ${label}`);
      } catch (e: any) {
        assert(false, `ALLOWED  ${label} (rejected: ${e?.message})`);
      }
    };
    const expectDenied = async (label: string, fn: () => Promise<any>) => {
      try {
        await fn();
        assert(false, `DENIED   ${label} (unexpectedly succeeded)`);
      } catch (e: any) {
        assert(e?.statusCode === 403, `DENIED   ${label} (403${e?.statusCode === 403 ? "" : `, got: ${e?.message}`})`);
      }
    };

    // Manager: entry recording is allowed.
    await expectAllowed("Manager records rent charge", () =>
      recordRentCharge(manager, { residentId, stayId, amount: 4000, transactionDate: hDay, billingPeriod: "Perm" }, IP, db));
    const mgrPayment = await recordRentPayment(manager, { residentId, stayId, amount: 1000, transactionDate: hDay, paymentMethod: "UPI" }, IP, db);
    assert(Boolean(mgrPayment?.id), "ALLOWED  Manager records rent payment");
    await expectAllowed("Manager records security deposit", () =>
      recordSecurityDeposit(manager, { residentId, stayId, amount: 2000, transactionDate: hDay, paymentMethod: "CASH" }, IP, db));
    const mgrExpense = await recordExpense(manager, { category: "MAINTENANCE", amount: 300, transactionDate: hDay, paymentMethod: "CASH", description: "Tap washer" }, IP, db);
    assert(Boolean(mgrExpense?.id), "ALLOWED  Manager records expense");
    const receipt = await uploadDocument(manager, {
      category: "EXPENSE_RECEIPT", transactionId: mgrExpense.id, originalFilename: "receipt.png", fileBuffer: png, clientMimeType: "image/png",
    } as any, IP, db).catch((e: any) => e);
    assert(Boolean(receipt?.id), `ALLOWED  Manager uploads an expense receipt${receipt?.id ? "" : ` (rejected: ${receipt?.message})`}`);

    // Manager: Owner-level finance is denied.
    await expectDenied("Manager reverses a transaction", () => reverseTransaction(manager, mgrPayment.id, "Manager reversal attempt", IP, db));
    await expectDenied("Manager saves a closing draft", () =>
      saveDailyClosingDraft(manager, { closingDate: hDay, division: "PG", actualCashCounted: 0 } as any, IP, db));
    await expectDenied("Manager finalizes a closing", () =>
      finalizeDailyClosing(manager, { closingDate: hDay, division: "PG", actualCashCounted: 0, discrepancyReason: "perm check" }, IP, db));
    await expectDenied("Manager creates an invoice", () =>
      createInvoice(manager, {
        residentId, stayId, invoiceType: "REGULAR_BILL", issueDate: hDay, dueDate: hDay, billingPeriod: "Perm",
        items: [{ description: "Rent", unitPrice: 1000, quantity: 1 }],
      } as any, IP, db));
    const draft = await createInvoice(owner, {
      residentId, stayId, invoiceType: "REGULAR_BILL", issueDate: hDay, dueDate: hDay, billingPeriod: "Perm",
      items: [{ description: "Rent", unitPrice: 1000, quantity: 1 }],
    } as any, IP, db);
    await expectDenied("Manager issues an invoice", () => issueInvoice(manager, draft.id, undefined, IP, db));
    const issued = await issueInvoice(owner, draft.id, undefined, IP, db);
    await expectDenied("Manager allocates a payment to an invoice", () =>
      allocatePaymentToInvoice(manager, { invoiceId: issued.id, paymentTransactionId: mgrPayment.id, amount: 500 }, IP, db));
    await expectDenied("Manager cancels an invoice", () => cancelInvoice(manager, issued.id, "Manager cancel attempt", IP, db));
    await expectDenied("Manager generates tiffin invoices", () =>
      generateTiffinInvoices(manager, { periodStart: hDay, periodEnd: hDay } as any, IP, db));
    await expectDenied("Manager uploads a checkout settlement receipt", () =>
      uploadDocument(manager, { category: "CHECKOUT_SETTLEMENT_RECEIPT", residentId, originalFilename: "s.png", fileBuffer: png, clientMimeType: "image/png" } as any, IP, db));
    if (receipt?.id) {
      await expectDenied("Manager archives a financial document", () => archiveDocument(manager, receipt.id, "Manager archive attempt", IP, db));
    }

    // Owner: Owner-level finance is allowed (closing reopen requires an existing closing).
    const closing = await finalizeDailyClosing(owner, { closingDate: hDay, division: "PG", actualCashCounted: 0, discrepancyReason: "perm check" }, IP, db);
    await expectDenied("Manager reopens a closing", () => reopenDailyClosing(manager, { closingId: closing.id, reason: "Manager reopen attempt" }, IP, db));
    await expectAllowed("Owner reopens a closing", () => reopenDailyClosing(owner, { closingId: closing.id, reason: "Owner verification reopen" }, IP, db));

    // Delivery staff: no finance entry at all.
    await expectDenied("Driver records rent payment", () =>
      recordRentPayment(driver, { residentId, stayId, amount: 100, transactionDate: hDay, paymentMethod: "CASH" }, IP, db));
    await expectDenied("Driver records expense", () =>
      recordExpense(driver, { category: "OTHER", amount: 50, transactionDate: hDay, paymentMethod: "CASH", description: "Fuel" }, IP, db));
    await expectDenied("Driver records security deposit", () =>
      recordSecurityDeposit(driver, { residentId, stayId, amount: 100, transactionDate: hDay, paymentMethod: "CASH" }, IP, db));
  }

  console.log("\n================================================================================");
  console.log(`PG MONEY FLOWS RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
