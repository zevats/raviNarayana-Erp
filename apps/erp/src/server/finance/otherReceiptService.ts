import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { acquireLedgerKeyLock, assertClosingDateNotFinalized, getBusinessDateString } from "./financeService";
import { AuthenticatedUser, normalizePaymentMethod } from "@/types";

/**
 * Cashbook → Receive → Other: money received that is not anyone's dues (a guest paying at the
 * counter, a one-off sale). It goes in the cashbook as money in (tiffin side, the way counter
 * sales are kept), with who paid and what for. Rent and tiffin dues are received through the
 * person's dues instead, so they settle what is owed.
 */
export const OTHER_RECEIPT_CATEGORY = "OTHER_RECEIPT";

export interface OtherReceiptInput {
  amount: number;
  paymentMethod: string;
  transactionDate?: string;
  payerName: string;
  note?: string;
  referenceNumber?: string;
  idempotencyKey: string;
}

export async function recordOtherReceipt(actor: AuthenticatedUser, input: OtherReceiptInput, clientIp?: string, asyncDb?: AsyncDb) {
  requirePermission(actor, "finance.record", { ip: clientIp, action: "finance.other_receipt_recorded" });
  const db = asyncDb ?? getAsyncDb();
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Enter the amount received in whole rupees.");
  if (amount > 10_000_000) throw new Error("That amount is too large. Check it and try again.");
  const payer = String(input.payerName || "").trim();
  if (payer.length < 2) throw new Error("Enter who paid.");
  const note = String(input.note || "").trim();
  const method = normalizePaymentMethod(input.paymentMethod as any);
  const today = getBusinessDateString(new Date());
  const date = input.transactionDate && /^\d{4}-\d{2}-\d{2}$/.test(input.transactionDate) ? input.transactionDate : today;
  if (date > today) throw new Error("The date cannot be in the future.");
  const key = String(input.idempotencyKey || "").trim();
  if (!key) throw new Error("A payment reference key is required.");

  let id = "";
  let replayed = false;
  await db.transaction(async (tx) => {
    await acquireLedgerKeyLock(tx, `idempotency:${key}`);
    const prior = await tx.queryOne<any>("SELECT id, amount, payment_method FROM financial_transactions WHERE idempotency_key = ?", [key]);
    if (prior) {
      if (Number(prior.amount) !== amount || prior.payment_method !== method) {
        throw new Error("This payment was already recorded with a different amount or method. Nothing new was recorded.");
      }
      id = prior.id;
      replayed = true;
      return;
    }
    await assertClosingDateNotFinalized(tx, date, "TIFFIN");
    id = `txn_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await tx.execute(
      `INSERT INTO financial_transactions (
         id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, customer_id, stay_id, category,
         description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id, created_by, created_at, updated_at
       ) VALUES (?, 'TIFFIN_PAYMENT', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?, 'POSTED', NULL, ?, ?, ?)`,
      [id, amount, date, method, input.referenceNumber?.trim() || null, OTHER_RECEIPT_CATEGORY, note || `Received from ${payer}`, payer, key, actor.id, now, now]
    );
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "finance.other_receipt_recorded",
        targetType: "transaction",
        targetId: id,
        metadata: { amount, paymentMethod: method, transactionDate: date, payerName: payer, note: note || null },
        ipAddress: clientIp,
      },
      tx
    );
  });
  return { id, amount, paymentMethod: method, transactionDate: date, payerName: payer, replayed };
}
