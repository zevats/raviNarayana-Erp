import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { hasBillsSchema } from "../database/schemaFeatures";
import { acquireLedgerKeyLock, assertClosingDateNotFinalized, getBusinessDateString } from "./financeService";
import { AuthenticatedUser, normalizePaymentMethod } from "@/types";
import { OTHER_RECEIPT_CATEGORY } from "./otherReceiptService";

/**
 * Editing a cashbook entry: money received or spent is corrected in place, every detail that was
 * recorded (amount, date, how it was paid, who, what for, reference, category). Owner and Manager.
 *
 * Every figure that depends on the entry follows it at once, because they are all read from the
 * entries themselves: dues, rent balances, deposits held, the cashbook. Two things are kept in step
 * here:
 *   - a tiffin payment that paid bills: if its amount goes below what it paid, the most recent
 *     bill payments are taken back (those bills show as due again); a higher amount becomes credit;
 *   - the bill a payment was made against keeps the new amount.
 * Entries tied to other records are corrected where they come from: a delivery staff handover
 * (accepted on the Cash screen), a dine-in order paid at the counter, a deposit used for rent.
 * Nothing on a day whose cashbook is closed can change, and every change is in the activity log
 * with the values before and after.
 */

const KITCHEN = new Set(["GROCERY", "KITCHEN_SUPPLIES", "LPG"]);
const EXPENSE_CATEGORIES = new Set(["GROCERY", "UTILITIES", "MAINTENANCE", "STAFF_SALARY", "KITCHEN_SUPPLIES", "LPG", "INTERNET", "MARKETING", "OTHER"]);
const EDITABLE = new Set(["EXPENSE", "RENT_PAYMENT", "SECURITY_DEPOSIT", "TIFFIN_PAYMENT"]);
/** Entries whose amount, date and method belong to another record. */
const LINKED = new Set(["TIFFIN_DELIVERY_COLLECTION", "TIFFIN_WALKIN_SALE", "DEPOSIT_APPLICATION"]);

export interface EditEntryInput {
  description?: string;
  payeeVendor?: string;
  referenceNumber?: string;
  category?: string;
  amount?: number;
  transactionDate?: string;
  paymentMethod?: string;
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

  const isExpense = row.transaction_type === "EXPENSE";
  const isOther = row.transaction_type === "TIFFIN_PAYMENT" && row.category === OTHER_RECEIPT_CATEGORY;
  const linked = LINKED.has(String(row.category || ""));
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

  const amountChanged = next.amount !== Number(row.amount);
  const moneyChanged = amountChanged || next.transaction_date !== row.transaction_date || next.payment_method !== row.payment_method;
  const detailsChanged = next.description !== row.description || next.payee_vendor !== row.payee_vendor || next.reference_number !== row.reference_number || next.category !== row.category;
  if (!moneyChanged && !detailsChanged) return { id, changed: false };
  if (moneyChanged && linked) {
    throw new Error(
      row.category === "TIFFIN_DELIVERY_COLLECTION"
        ? "This is a delivery staff handover. Its amount is corrected on the Cash screen where it was accepted."
        : row.category === "TIFFIN_WALKIN_SALE"
          ? "This is a counter sale tied to its order. Change the order instead."
          : "This is a deposit used for rent. Correct it from the resident's check-out."
    );
  }

  const now = new Date().toISOString();
  const before = { amount: Number(row.amount), date: row.transaction_date, method: row.payment_method, description: row.description, payee: row.payee_vendor, reference: row.reference_number, category: row.category };
  const after = { amount: next.amount, date: next.transaction_date, method: next.payment_method, description: next.description, payee: next.payee_vendor, reference: next.reference_number, category: next.category };
  const oldDivision = divisionOf(row);
  const newDivision = divisionOf({ ...row, category: next.category });
  let billsReopened = 0;

  await db.transaction(async (tx) => {
    if (row.resident_id) await acquireLedgerKeyLock(tx, `resident:${row.resident_id}`);
    if (row.customer_id) await acquireLedgerKeyLock(tx, `customer:${row.customer_id}`);
    const locked = await tx.queryOne<any>(`SELECT status, amount FROM financial_transactions WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [id]);
    if (locked?.status !== "POSTED" || Number(locked.amount) !== Number(row.amount)) throw new Error("This entry was changed by someone else just now. Reload and try again.");
    await assertClosingDateNotFinalized(tx, row.transaction_date, oldDivision);
    if (newDivision !== oldDivision || next.transaction_date !== row.transaction_date) await assertClosingDateNotFinalized(tx, next.transaction_date, newDivision);

    // A deposit cannot drop below what was already refunded or used for rent.
    if (row.transaction_type === "SECURITY_DEPOSIT" && next.amount < Number(row.amount)) {
      const held = await tx.queryOne<{ n: number | string }>(
        `SELECT COALESCE(SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' THEN amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN transaction_type = 'DEPOSIT_REFUND' THEN amount ELSE 0 END), 0)
              - COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND COALESCE(category, '') = 'DEPOSIT_APPLICATION' THEN amount ELSE 0 END), 0) AS n
         FROM financial_transactions WHERE resident_id = ? AND status = 'POSTED'`,
        [row.resident_id]
      );
      if (Number(held?.n ?? 0) - (Number(row.amount) - next.amount) < 0) {
        throw new Error("Part of this deposit was already refunded or used for rent, so it cannot be lowered that far.");
      }
    }

    // A payment that paid invoices: take back the most recent bill payments it no longer covers.
    if ((row.transaction_type === "TIFFIN_PAYMENT" || row.transaction_type === "RENT_PAYMENT") && amountChanged && next.amount < Number(row.amount)) {
      const allocs = await tx.query<any>("SELECT id, invoice_id, amount FROM invoice_payment_allocations WHERE payment_transaction_id = ? ORDER BY allocated_at DESC, created_at DESC", [id]);
      let over = allocs.reduce((s, a) => s + Number(a.amount), 0) - next.amount;
      for (const a of allocs) {
        if (over <= 0) break;
        const back = Math.min(over, Number(a.amount));
        const inv = await tx.queryOne<any>(`SELECT id, amount_paid, balance_due FROM invoices WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [a.invoice_id]);
        if (back === Number(a.amount)) await tx.execute("DELETE FROM invoice_payment_allocations WHERE id = ?", [a.id]);
        else await tx.execute("UPDATE invoice_payment_allocations SET amount = ? WHERE id = ?", [Number(a.amount) - back, a.id]);
        const paid = Number(inv.amount_paid) - back;
        await tx.execute("UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ?, updated_at = ? WHERE id = ?", [paid, Number(inv.balance_due) + back, paid > 0 ? "PARTIALLY_PAID" : "ISSUED", now, inv.id]);
        billsReopened++;
        over -= back;
      }
    }

    await tx.execute(
      `UPDATE financial_transactions SET amount = ?, transaction_date = ?, payment_method = ?, description = ?, payee_vendor = ?, reference_number = ?, category = ?, updated_at = ? WHERE id = ?`,
      [next.amount, next.transaction_date, next.payment_method, next.description, next.payee_vendor, next.reference_number, next.category, now, id]
    );

    // The bill this payment was made against keeps the corrected amount.
    if (amountChanged && row.idempotency_key && (await hasBillsSchema(tx))) {
      await tx.execute(
        "UPDATE bill_payments SET amount = amount + ? WHERE ? LIKE payment_key || ':%' AND amount + ? > 0",
        [next.amount - Number(row.amount), row.idempotency_key, next.amount - Number(row.amount)]
      );
    }

    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "finance.transaction_edited",
        targetType: "transaction",
        targetId: id,
        metadata: { before, after, billsReopened },
        ipAddress: clientIp,
      },
      tx
    );
  });
  return { id, changed: true, billsReopened };
}
