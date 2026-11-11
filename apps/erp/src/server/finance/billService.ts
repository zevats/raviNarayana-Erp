import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { hasBillsSchema } from "../database/schemaFeatures";
import { getSettings, getInvoiceCompanyConfig } from "../settings/settingsService";
import { recordAuditEventAsync } from "../audit/audit";
import { getBusinessDateString } from "./financeService";
import { isValidGstin } from "./gstinValidator";
import { getReceivableAccount, getAccountStatement, ReceivableLine } from "./receivablesService";
import { AuthenticatedUser } from "@/types";
import { Bill, BillLine, BillPaymentLine, BillSnapshot, BillSummary, BillType, billDay, financialYear, rupeesInWords, splitInclusiveGst } from "@/lib/bills";
import { UPI_ID, UPI_NAME } from "@/lib/upi";

/**
 * Bills (migration 0027). A bill is a numbered copy of what an account owes on the day it is made:
 * every open due, the latest payments, the business and the customer, as a GST or a non-GST bill.
 *
 *   - A bill changes nothing that is owed. Dues stay until money is received, and another bill can
 *     be made for the same dues at any time.
 *   - The total is exactly the account's dues at that moment. A GST bill shows the tax inside that
 *     total (taxable value + CGST + SGST = total); it never adds to what is owed.
 *   - Every bill is kept (the snapshot is stored), so the copy shown later is the bill as it was
 *     issued, whatever has been paid since.
 *   - Numbers run per financial year: RN/26-27/0001 for GST bills, RNB/26-27/0001 for others (GST
 *     bills keep their own unbroken series).
 */

/** The business GSTIN (owner, 2026-11-11). ERP_COMPANY_GSTIN overrides it when set. */
export const BUSINESS_GSTIN = "06AAEFZ6389H1ZL";
export const GST_RATES = [5, 12, 18] as const;

export class BillsNotReadyError extends Error {
  statusCode = 409;
}

const n = (v: unknown) => Number(v || 0);

async function requireBills(db: AsyncDb) {
  if (!(await hasBillsSchema(db))) throw new BillsNotReadyError("Bills are being set up on this server. Try again in a minute.");
}

async function nextBillNumber(tx: AsyncDb, type: BillType, issueDate: string): Promise<string> {
  const series = `${type === "GST" ? "RN" : "RNB"}/${financialYear(issueDate)}`;
  const now = new Date().toISOString();
  await tx.execute("INSERT INTO bill_counters (series, last_number, updated_at) VALUES (?, 0, ?) ON CONFLICT (series) DO NOTHING", [series, now]);
  const row = await tx.queryOne<{ last_number: number | string }>(
    tx.isPostgres ? "SELECT last_number FROM bill_counters WHERE series = ? FOR UPDATE" : "SELECT last_number FROM bill_counters WHERE series = ?",
    [series]
  );
  const next = n(row?.last_number) + 1;
  await tx.execute("UPDATE bill_counters SET last_number = ?, updated_at = ? WHERE series = ?", [next, now, series]);
  return `${series}/${String(next).padStart(4, "0")}`;
}

/** The open dues of an account as bill lines, with the plan period or the order's items spelled out. */
async function billLines(db: AsyncDb, lines: ReceivableLine[]): Promise<BillLine[]> {
  const invoiceIds = lines.filter((l) => l.source === "TIFFIN" && l.kind === "INVOICE").map((l) => l.refId);
  const orderIds = lines.filter((l) => l.source === "DELIVERY" && l.kind === "ORDER").map((l) => l.refId);
  const marks = (ids: string[]) => ids.map(() => "?").join(", ");
  const plans = new Map<string, { name: string | null; from: string | null; to: string | null; number: string | null; isPlan: boolean; description: string | null }>();
  if (invoiceIds.length) {
    const rows = await db.query<any>(
      `SELECT i.id, i.invoice_number, i.subscription_id, p.name AS product_name,
              (SELECT ii.service_start_date FROM invoice_items ii WHERE ii.invoice_id = i.id ORDER BY ii.created_at LIMIT 1) AS from_date,
              (SELECT ii.service_end_date FROM invoice_items ii WHERE ii.invoice_id = i.id ORDER BY ii.created_at LIMIT 1) AS to_date,
              (SELECT ii.description FROM invoice_items ii WHERE ii.invoice_id = i.id ORDER BY ii.created_at LIMIT 1) AS item_description
       FROM invoices i
       LEFT JOIN tiffin_subscriptions s ON s.id = i.subscription_id
       LEFT JOIN tiffin_products p ON p.id = s.product_id
       WHERE i.id IN (${marks(invoiceIds)})`,
      invoiceIds
    );
    for (const r of rows) plans.set(r.id, { name: r.product_name || null, from: r.from_date || null, to: r.to_date || null, number: r.invoice_number || null, isPlan: Boolean(r.subscription_id), description: r.item_description || null });
  }
  const items = new Map<string, string[]>();
  if (orderIds.length) {
    const rows = await db.query<any>(
      `SELECT order_id, product_name, COALESCE(delivered_quantity, quantity) AS q FROM order_items WHERE order_id IN (${marks(orderIds)}) ORDER BY order_id, line_no`,
      orderIds
    );
    for (const r of rows) {
      if (n(r.q) <= 0) continue;
      const list = items.get(r.order_id) ?? [];
      list.push(`${n(r.q)} × ${r.product_name}`);
      items.set(r.order_id, list);
    }
  }
  return lines.map((l) => {
    let label = l.reference;
    let detail = l.description;
    if (l.source === "PG") {
      label = "Room rent";
      detail = l.reference && l.reference !== "Rent charge" ? l.reference : l.description || "";
    } else if (l.source === "TIFFIN" && l.kind === "INVOICE") {
      const p = plans.get(l.refId);
      if (p?.isPlan) {
        label = p.name || "Monthly plan";
        detail = p.from && p.to ? `${billDay(p.from)} – ${billDay(p.to)}` : "Monthly plan";
      } else {
        label = p?.description || "Tiffin";
        detail = p?.number ? `Invoice ${p.number}` : "";
      }
    } else if (l.source === "TIFFIN") {
      label = "Paid ahead";
      detail = "Adjusted in this bill";
    } else if (l.kind === "ADVANCE") {
      label = "Advance paid";
      detail = "Adjusted in this bill";
    } else {
      const dineIn = l.reference.startsWith("Dine in");
      const meal = l.reference.replace(/^Dine in · /, "").split(" · ")[0];
      label = `${dineIn ? "Dine in" : "Order"} · ${meal}`;
      detail = (items.get(l.refId) ?? []).join(", ");
    }
    return { label, detail, date: l.date, amount: l.amount, paid: l.paid, due: l.outstanding };
  });
}

function mapBill(r: any): Bill {
  let snapshot: BillSnapshot;
  try {
    snapshot = JSON.parse(r.snapshot);
  } catch {
    snapshot = { company: { name: "", address: "", phone: "", email: "", gstin: null, stateCode: "", upiId: "", upiName: "" }, recipient: { name: r.account_name, phone: r.account_phone, place: null, kind: r.account_kind }, lines: [], payments: [], amountInWords: "" };
  }
  return {
    id: r.id,
    billNumber: r.bill_number,
    token: r.share_token,
    accountKey: r.account_key,
    accountKind: r.account_kind,
    accountName: r.account_name,
    accountPhone: r.account_phone || null,
    type: r.bill_type,
    gstRate: n(r.gst_rate),
    issueDate: r.issue_date,
    total: n(r.total_amount),
    taxable: n(r.taxable_amount),
    cgst: n(r.cgst_amount),
    sgst: n(r.sgst_amount),
    snapshot,
    createdAt: r.created_at,
    createdByName: r.created_by_name || null,
    received: [],
  };
}

async function withReceived(db: AsyncDb, bill: Bill): Promise<Bill> {
  const rows = await db.query<any>("SELECT amount, payment_method, payment_date FROM bill_payments WHERE bill_id = ? ORDER BY payment_date, created_at", [bill.id]);
  return { ...bill, received: rows.map((p) => ({ amount: n(p.amount), method: p.payment_method, date: p.payment_date })) };
}

export interface CreateBillInput {
  accountKey: string;
  type: BillType;
  /** GST bills: the rate shown inside the total (5, 12 or 18). */
  gstRate?: number;
  /** One id for all the bills of a "bill everyone" run. */
  batchId?: string;
}

/** Makes a bill for everything an account owes right now. Owner and Manager. */
export async function createBill(actor: AuthenticatedUser, input: CreateBillInput, clientIp?: string, asyncDb?: AsyncDb): Promise<Bill> {
  requirePermission(actor, "finance.record", { ip: clientIp, action: "finance.bill_created" });
  const db = asyncDb ?? getAsyncDb();
  await requireBills(db);
  const accountKey = String(input.accountKey || "").trim();
  if (!/^[RCO]:.+/.test(accountKey)) throw new Error("Choose whose bill to make.");
  const type: BillType = input.type === "GST" ? "GST" : "NON_GST";
  const rate = type === "GST" ? Number(input.gstRate ?? GST_RATES[0]) : 0;
  if (type === "GST" && !GST_RATES.includes(rate as (typeof GST_RATES)[number])) throw new Error("Choose a GST rate of 5%, 12% or 18%.");

  const [account, statement, settings, company] = await Promise.all([
    getReceivableAccount(actor, accountKey, db),
    getAccountStatement(actor, accountKey, {}, db),
    getSettings(db),
    getInvoiceCompanyConfig(db),
  ]);
  const total = account.totals.total;
  if (!(total > 0)) throw new Error(`${account.account.name} owes nothing, so there is nothing to bill.`);
  const gstin = type === "GST" ? (company.companyGstin && isValidGstin(company.companyGstin) ? company.companyGstin : BUSINESS_GSTIN) : null;
  const lines = await billLines(db, account.lines);
  const payments: BillPaymentLine[] = statement.entries
    .filter((e) => e.payment > 0 && !e.reversedLater)
    .slice(-5)
    .reverse()
    .map((e) => ({ date: e.date, label: e.type, method: e.method, amount: e.payment }));
  const issueDate = getBusinessDateString(new Date());
  const split = splitInclusiveGst(total, rate);
  const snapshot: BillSnapshot = {
    company: {
      name: company.companyName,
      address: company.companyAddress,
      phone: settings.business.phone || "",
      email: settings.business.email || "",
      gstin,
      stateCode: company.companyStateCode,
      upiId: UPI_ID,
      upiName: UPI_NAME,
    },
    recipient: { name: account.account.name, phone: account.account.phone || null, place: account.account.place || null, kind: account.account.kind },
    lines,
    payments,
    amountInWords: rupeesInWords(total),
  };

  const id = `bill_${crypto.randomUUID()}`;
  const token = crypto.randomBytes(18).toString("base64url");
  const now = new Date().toISOString();
  let number = "";
  await db.transaction(async (tx) => {
    number = await nextBillNumber(tx, type, issueDate);
    await tx.execute(
      `INSERT INTO bills (id, bill_number, share_token, account_key, account_kind, account_name, account_phone, bill_type, gst_rate, issue_date,
                          total_amount, taxable_amount, cgst_amount, sgst_amount, snapshot, batch_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, number, token, accountKey, account.account.kind, account.account.name, account.account.phone || null, type, rate, issueDate,
        total, split.taxable, split.cgst, split.sgst, JSON.stringify(snapshot), input.batchId?.trim() || null, actor.id, now,
      ]
    );
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "finance.bill_created",
        targetType: "bill",
        targetId: id,
        metadata: { billNumber: number, accountKey, accountName: account.account.name, type, gstRate: rate, total, lines: lines.length, batchId: input.batchId || null },
        ipAddress: clientIp,
      },
      tx
    );
  });
  return {
    id, billNumber: number, token, accountKey, accountKind: account.account.kind, accountName: account.account.name, accountPhone: account.account.phone || null,
    type, gstRate: rate, issueDate, total, taxable: split.taxable, cgst: split.cgst, sgst: split.sgst, snapshot, createdAt: now, createdByName: actor.fullName || actor.username || null, received: [],
  };
}

/** Bills kept on record, newest first: all of them, or one account's. */
export async function listBills(
  actor: AuthenticatedUser,
  query: { accountKey?: string; q?: string; kind?: "RESIDENT" | "CUSTOMER" | "ALL"; type?: BillType | "ALL"; date?: string; limit?: number; offset?: number } = {},
  asyncDb?: AsyncDb
): Promise<{ bills: BillSummary[]; total: number; amount: number; limit: number; offset: number }> {
  requirePermission(actor, "finance.read");
  const db = asyncDb ?? getAsyncDb();
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 30));
  const offset = Math.max(0, Number(query.offset) || 0);
  if (!(await hasBillsSchema(db))) return { bills: [], total: 0, amount: 0, limit, offset };
  const where: string[] = [];
  const params: any[] = [];
  if (query.accountKey) {
    where.push("b.account_key = ?");
    params.push(query.accountKey);
  }
  if (query.kind === "RESIDENT") where.push("b.account_kind = 'RESIDENT'");
  if (query.kind === "CUSTOMER") where.push("b.account_kind <> 'RESIDENT'");
  if (query.type === "GST" || query.type === "NON_GST") {
    where.push("b.bill_type = ?");
    params.push(query.type);
  }
  if (query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
    where.push("b.issue_date = ?");
    params.push(query.date);
  }
  const q = (query.q || "").trim().toLowerCase();
  if (q) {
    where.push("(LOWER(b.account_name) LIKE ? OR LOWER(b.bill_number) LIKE ? OR COALESCE(b.account_phone, '') LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q.replace(/\s+/g, "")}%`);
  }
  const cond = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const head = await db.queryOne<any>(`SELECT COUNT(*) AS c, COALESCE(SUM(b.total_amount), 0) AS amount FROM bills b ${cond}`, params);
  const rows = await db.query<any>(
    `SELECT b.id, b.bill_number, b.share_token, b.account_key, b.account_kind, b.account_name, b.account_phone, b.bill_type, b.gst_rate, b.issue_date,
            b.total_amount, b.taxable_amount, b.cgst_amount, b.sgst_amount, b.created_at, u.full_name AS created_by_name,
            COALESCE((SELECT SUM(p.amount) FROM bill_payments p WHERE p.bill_id = b.id), 0) AS received_total
     FROM bills b LEFT JOIN staff_users u ON u.id = b.created_by
     ${cond}
     ORDER BY b.created_at DESC, b.bill_number DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return {
    bills: rows.map((r) => {
      const { snapshot: _s, received: _r, ...rest } = mapBill({ ...r, snapshot: "{}" });
      return { ...rest, receivedTotal: n(r.received_total) };
    }),
    total: n(head?.c),
    amount: n(head?.amount),
    limit,
    offset,
  };
}

/** One bill, as it was issued, with the payments recorded against its number. */
export async function getBill(actor: AuthenticatedUser, idOrNumber: string, asyncDb?: AsyncDb): Promise<Bill> {
  requirePermission(actor, "finance.read");
  const db = asyncDb ?? getAsyncDb();
  await requireBills(db);
  const r = await db.queryOne<any>(
    "SELECT b.*, u.full_name AS created_by_name FROM bills b LEFT JOIN staff_users u ON u.id = b.created_by WHERE b.id = ? OR UPPER(b.bill_number) = UPPER(?)",
    [idOrNumber, idOrNumber]
  );
  if (!r) throw new Error("Bill not found.");
  return withReceived(db, mapBill(r));
}

/**
 * The bill behind a share link (the page a customer opens from WhatsApp). No sign-in: the link's
 * token is the key, it is long and random, and it shows only that one bill.
 */
export async function getBillByToken(token: string, asyncDb?: AsyncDb): Promise<Bill | null> {
  const clean = String(token || "").trim();
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(clean)) return null;
  const db = asyncDb ?? getAsyncDb();
  if (!(await hasBillsSchema(db))) return null;
  const r = await db.queryOne<any>("SELECT b.*, NULL AS created_by_name FROM bills b WHERE b.share_token = ?", [clean]);
  return r ? mapBill(r) : null;
}
