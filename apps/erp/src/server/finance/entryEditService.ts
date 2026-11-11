import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { recordAuditEventAsync } from "../audit/audit";
import { assertClosingDateNotFinalized, getBusinessDateString } from "./financeService";
import { AuthenticatedUser, normalizePaymentMethod } from "@/types";
import { OTHER_RECEIPT_CATEGORY } from "./otherReceiptService";

/**
 * Editing a cashbook entry (money received or spent).
 *
 *   - Details (the note, who it was paid to / received from, the reference, an expense's category)
 *     are changed on the entry itself. Owner and Manager.
 *   - The amount, date or payment method of an expense or an Other receipt is corrected the way
 *     books are corrected: the entry is reversed and a corrected entry is recorded, in one step, so
 *     every total stays exact and the history shows what changed. Owner only (as reversals).
 *   - Dues payments (rent, tiffin, deliveries) settle what people owe; their amount is not edited
 *     here (reverse the payment and receive it again), only their details.
 *   - Nothing on a day whose cashbook is closed can change.
 */

const KITCHEN = new Set(["GROCERY", "KITCHEN_SUPPLIES", "LPG"]);
const EXPENSE_CATEGORIES = new Set(["GROCERY", "UTILITIES", "MAINTENANCE", "STAFF_SALARY", "KITCHEN_SUPPLIES", "LPG", "INTERNET", "MARKETING", "OTHER"]);
const EDITABLE = new Set(["EXPENSE", "RENT_PAYMENT", "SECURITY_DEPOSIT", "TIFFIN_PAYMENT"]);

export interface EditEntryInput {
  description?: string;
  payeeVendor?: string;
  referenceNumber?: string;
  category?: string;
  amount?: number;
  transactionDate?: string;
  paymentMethod?: string;
  reason?: string;
}

const divisionOf = (row: any): "PG" | "TIFFIN" =>
  row.transaction_type === "TIFFIN_PAYMENT" || row.transaction_type === "TIFFIN_CHARGE" || (row.transaction_type === "EXPENSE" && KITCHEN.has(row.category)) ? "TIFFIN" : "PG";

export async function editTransaction(actor: AuthenticatedUser, id: string, input: EditEntryInput, clientIp?: string, asyncDb?: AsyncDb) {
  requirePermission(actor, "finance.record", { ip: clientIp, action: "finance.transaction_edited" });
  const db = asyncDb ?? getAsyncDb();
  const row = await db.queryOne<any>("SELECT * FROM financial_transactions WHERE id = ?", [id]);
  if (!row) throw new Error("Entry not found.");
  if (!EDITABLE.has(row.transaction_type)) throw new Error("This entry cannot be edited.");
  if (row.status !== "POSTED") throw new Error("This entry was reversed, so it can no longer be edited.");
  if (row.transaction_type === "TIFFIN_PAYMENT" && row.category === "TIFFIN_DELIVERY_COLLECTION") {
    throw new Error("This entry is a delivery staff handover. Correct it where the handover was accepted.");
  }

  const isOther = row.transaction_type === "TIFFIN_PAYMENT" && row.category === OTHER_RECEIPT_CATEGORY;
  const isExpense = row.transaction_type === "EXPENSE";
  const clean = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);

  const next = {
    description: clean(input.description) ?? row.description,
    payee_vendor: isExpense || isOther ? clean(input.payeeVendor) ?? row.payee_vendor : row.payee_vendor,
    reference_number: input.referenceNumber === undefined ? row.reference_number : clean(input.referenceNumber) || null,
    category: isExpense && input.category ? String(input.category) : row.category,
    amount: input.amount === undefined ? Number(row.amount) : Number(input.amount),
    transaction_date: clean(input.transactionDate) || row.transaction_date,
    payment_method: input.paymentMethod ? normalizePaymentMethod(input.paymentMethod as any) : row.payment_method,
  };
  if (isExpense && !EXPENSE_CATEGORIES.has(next.category)) throw new Error("Choose a valid category.");
  if (isExpense && !String(next.description || "").trim()) throw new Error("Enter what the expense was for.");
  if (isOther && String(next.payee_vendor || "").trim().length < 2) throw new Error("Enter who paid.");
  if (!Number.isInteger(next.amount) || next.amount <= 0) throw new Error("The amount must be a whole number of rupees above ₹0.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.transaction_date) || next.transaction_date > getBusinessDateString(new Date())) throw new Error("Choose a valid date, not in the future.");

  const money = next.amount !== Number(row.amount) || next.transaction_date !== row.transaction_date || next.payment_method !== row.payment_method;
  const details = next.description !== row.description || next.payee_vendor !== row.payee_vendor || next.reference_number !== row.reference_number || next.category !== row.category;
  if (!money && !details) return { id, changed: false, corrected: false };

  if (money && !(isExpense || isOther)) {
    throw new Error("The amount, date or method of a dues payment is not changed here. Reverse the payment and receive it again.");
  }
  if (money && !hasPermission(actor.role, "finance.manage")) {
    throw new AuthorizationError(403, "Only the owner can change the amount, date or method of an entry.");
  }
  const reason = clean(input.reason) || "Corrected from the cashbook";
  const now = new Date().toISOString();
  const before = { amount: Number(row.amount), date: row.transaction_date, method: row.payment_method, description: row.description, payee: row.payee_vendor, reference: row.reference_number, category: row.category };
  const after = { amount: next.amount, date: next.transaction_date, method: next.payment_method, description: next.description, payee: next.payee_vendor, reference: next.reference_number, category: next.category };
  const oldDivision = divisionOf(row);
  const newDivision = divisionOf({ ...row, category: next.category });

  let resultId = id;
  await db.transaction(async (tx) => {
    const locked = await tx.queryOne<any>(`SELECT status FROM financial_transactions WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [id]);
    if (locked?.status !== "POSTED") throw new Error("This entry was changed by someone else just now. Reload and try again.");
    await assertClosingDateNotFinalized(tx, row.transaction_date, oldDivision);
    if (newDivision !== oldDivision) await assertClosingDateNotFinalized(tx, row.transaction_date, newDivision);

    if (!money) {
      await tx.execute(
        "UPDATE financial_transactions SET description = ?, payee_vendor = ?, reference_number = ?, category = ?, updated_at = ? WHERE id = ?",
        [next.description, next.payee_vendor, next.reference_number, next.category, now, id]
      );
    } else {
      // Reverse the original and record the corrected entry.
      const today = getBusinessDateString(new Date());
      await assertClosingDateNotFinalized(tx, today, oldDivision);
      await assertClosingDateNotFinalized(tx, next.transaction_date, newDivision);
      const reversalId = `txn_${crypto.randomUUID()}`;
      await tx.execute("UPDATE financial_transactions SET status = 'REVERSED', updated_at = ? WHERE id = ?", [now, id]);
      await tx.execute(
        `INSERT INTO financial_transactions (
           id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, customer_id, stay_id, category,
           description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id, created_by, created_at, updated_at
         ) VALUES (?, 'REVERSAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, 'POSTED', ?, ?, ?, ?)`,
        [reversalId, Number(row.amount), today, row.payment_method, row.reference_number, row.resident_id, row.customer_id, row.stay_id, row.category, `Reversal: corrected (${reason})`, row.payee_vendor, id, actor.id, now, now]
      );
      resultId = `txn_${crypto.randomUUID()}`;
      await tx.execute(
        `INSERT INTO financial_transactions (
           id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, customer_id, stay_id, category,
           description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'POSTED', NULL, ?, ?, ?)`,
        [
          resultId, row.transaction_type, next.amount, next.transaction_date, next.payment_method, next.reference_number, row.resident_id, row.customer_id, row.stay_id,
          next.category, next.description, row.billing_period, next.payee_vendor, actor.id, now, now,
        ]
      );
    }
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: money ? "finance.transaction_corrected" : "finance.transaction_edited",
        targetType: "transaction",
        targetId: id,
        metadata: { before, after, reason: money ? reason : null, correctedEntryId: money ? resultId : null },
        ipAddress: clientIp,
      },
      tx
    );
  });
  return { id: resultId, changed: true, corrected: money };
}
