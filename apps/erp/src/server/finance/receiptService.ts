import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { hasReceiptsSchema } from "../database/schemaFeatures";
import { getSettings, getInvoiceCompanyConfig } from "../settings/settingsService";
import { getReceivableAccount } from "./receivablesService";
import { financialYear, rupeesInWords } from "@/lib/bills";
import type { Receipt, ReceiptSnapshot } from "@/lib/receipts";
import { AuthenticatedUser } from "@/types";
import { OTHER_RECEIPT_CATEGORY } from "./otherReceiptService";

/**
 * Receipts for money received (rent, tiffin, a deposit, other). The first time a payment's receipt
 * is opened it gets a number (RCPT/26-27/0001) and a share link, and is kept on record; opened
 * again, the same receipt comes back with its copy refreshed (so an edited payment shows its
 * current details). Expenses have no receipt.
 */

const RECEIVED = new Set(["RENT_PAYMENT", "SECURITY_DEPOSIT", "TIFFIN_PAYMENT"]);
const n = (v: unknown) => Number(v || 0);

function purposeOf(t: any): string {
  if (t.transaction_type === "SECURITY_DEPOSIT") return "Security deposit";
  if (t.transaction_type === "RENT_PAYMENT") return t.category === "DEPOSIT_APPLICATION" ? "Rent (from deposit)" : "Room rent";
  if (t.category === OTHER_RECEIPT_CATEGORY) return "Other";
  if (t.category === "TIFFIN_WALKIN_SALE") return "Meal at the counter";
  if (t.category === "TIFFIN_DELIVERY_COLLECTION") return "Tiffin deliveries";
  return "Tiffin";
}

function mapReceipt(r: any): Receipt {
  let snapshot: ReceiptSnapshot;
  try {
    snapshot = JSON.parse(r.snapshot);
  } catch {
    snapshot = { company: { name: "", address: "", phone: "", email: "", gstin: null }, payer: { name: r.account_name, phone: r.account_phone, place: null }, purpose: "", detail: null, method: null, reference: null, receivedBy: null, amountInWords: "", dueAfter: null };
  }
  return {
    id: r.id,
    receiptNumber: r.receipt_number,
    token: r.share_token,
    transactionId: r.transaction_id,
    accountName: r.account_name,
    accountPhone: r.account_phone || null,
    amount: n(r.amount),
    receiptDate: r.receipt_date,
    snapshot,
    createdAt: r.created_at,
  };
}

/** The receipt of one payment: made on first open, refreshed after that. */
export async function getOrCreateReceipt(actor: AuthenticatedUser, transactionId: string, asyncDb?: AsyncDb): Promise<Receipt> {
  requirePermission(actor, "finance.read");
  const db = asyncDb ?? getAsyncDb();
  if (!(await hasReceiptsSchema(db))) throw Object.assign(new Error("Receipts are being set up on this server. Try again in a minute."), { statusCode: 409 });
  const t = await db.queryOne<any>(
    `SELECT t.*, r.full_name AS resident_name, r.phone AS resident_phone, c.full_name AS customer_name, c.phone AS customer_phone, rm.room_number, u.full_name AS created_by_name
     FROM financial_transactions t
     LEFT JOIN residents r ON r.id = t.resident_id
     LEFT JOIN tiffin_customers c ON c.id = t.customer_id
     LEFT JOIN resident_stays s ON s.id = t.stay_id
     LEFT JOIN rooms rm ON rm.id = s.room_id
     LEFT JOIN staff_users u ON u.id = t.created_by
     WHERE t.id = ?`,
    [transactionId]
  );
  if (!t) throw new Error("Payment not found.");
  if (!RECEIVED.has(t.transaction_type)) throw new Error("Receipts are made for money received only.");
  if (t.status !== "POSTED") throw new Error("This payment was reversed, so it has no receipt.");

  const [settings, company] = await Promise.all([getSettings(db), getInvoiceCompanyConfig(db)]);
  const name = t.resident_name || t.customer_name || t.payee_vendor || "Customer";
  const phone = t.resident_phone || t.customer_phone || null;
  let dueAfter: number | null = null;
  const accountKey = t.resident_id ? `R:${t.resident_id}` : t.customer_id ? `C:${t.customer_id}` : null;
  if (accountKey && t.transaction_type !== "SECURITY_DEPOSIT") {
    try {
      dueAfter = (await getReceivableAccount(actor, accountKey, db)).totals.total;
    } catch {
      dueAfter = null;
    }
  }
  const snapshot: ReceiptSnapshot = {
    company: { name: company.companyName, address: company.companyAddress, phone: settings.business.phone || "", email: settings.business.email || "", gstin: company.companyGstin || null },
    payer: { name, phone, place: t.room_number ? `Room ${t.room_number}` : null },
    purpose: purposeOf(t),
    detail: t.billing_period || (t.description && !/^(Rent payment|Tiffin payment from|Received from)/i.test(t.description) ? t.description : null),
    method: t.payment_method || null,
    reference: t.reference_number && !/^[a-z]+_[0-9a-f-]{6,}/i.test(t.reference_number) ? t.reference_number : null,
    receivedBy: t.created_by_name || null,
    amountInWords: rupeesInWords(n(t.amount)),
    dueAfter,
  };
  const now = new Date().toISOString();
  const existing = await db.queryOne<any>("SELECT * FROM receipts WHERE transaction_id = ?", [transactionId]);
  if (existing) {
    // "Still due" is what was owed right after this payment, not today: keep it, moved only by an
    // edit of this payment's amount.
    try {
      const old = typeof existing.snapshot === "string" ? JSON.parse(existing.snapshot) : existing.snapshot;
      if (old && typeof old.dueAfter === "number") snapshot.dueAfter = Math.max(0, old.dueAfter - (n(t.amount) - n(existing.amount)));
    } catch {}
    await db.execute("UPDATE receipts SET account_name = ?, account_phone = ?, amount = ?, receipt_date = ?, snapshot = ?, updated_at = ? WHERE id = ?", [name, phone, n(t.amount), t.transaction_date, JSON.stringify(snapshot), now, existing.id]);
    return mapReceipt({ ...existing, account_name: name, account_phone: phone, amount: n(t.amount), receipt_date: t.transaction_date, snapshot: JSON.stringify(snapshot) });
  }
  const id = `rcpt_${crypto.randomUUID()}`;
  const token = crypto.randomBytes(18).toString("base64url");
  let number = "";
  await db.transaction(async (tx) => {
    // Two people opening the same receipt at once get the same one.
    const again = await tx.queryOne<any>(`SELECT id FROM receipts WHERE transaction_id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [transactionId]);
    if (again) return;
    const series = `RCPT/${financialYear(t.transaction_date)}`;
    await tx.execute("INSERT INTO bill_counters (series, last_number, updated_at) VALUES (?, 0, ?) ON CONFLICT (series) DO NOTHING", [series, now]);
    const row = await tx.queryOne<any>(tx.isPostgres ? "SELECT last_number FROM bill_counters WHERE series = ? FOR UPDATE" : "SELECT last_number FROM bill_counters WHERE series = ?", [series]);
    const next = n(row?.last_number) + 1;
    await tx.execute("UPDATE bill_counters SET last_number = ?, updated_at = ? WHERE series = ?", [next, now, series]);
    number = `${series}/${String(next).padStart(4, "0")}`;
    await tx.execute(
      `INSERT INTO receipts (id, receipt_number, share_token, transaction_id, account_name, account_phone, amount, receipt_date, snapshot, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (transaction_id) DO NOTHING`,
      [id, number, token, transactionId, name, phone, n(t.amount), t.transaction_date, JSON.stringify(snapshot), actor.id, now, now]
    );
  });
  const saved = await db.queryOne<any>("SELECT * FROM receipts WHERE transaction_id = ?", [transactionId]);
  return mapReceipt(saved);
}

/** The receipt behind a share link (no sign-in; the long random token is the key). */
export async function getReceiptByToken(token: string, asyncDb?: AsyncDb): Promise<Receipt | null> {
  const clean = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(clean)) return null;
  const db = asyncDb ?? getAsyncDb();
  if (!(await hasReceiptsSchema(db))) return null;
  const r = await db.queryOne<any>("SELECT * FROM receipts WHERE share_token = ?", [clean]);
  return r ? mapReceipt(r) : null;
}
