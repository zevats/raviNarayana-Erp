"use client";

import type { DailyClosingRecord, FinancialTransaction } from "@/types";
import type { BillSummary } from "@/lib/bills";
import type { DueAccount } from "@/modules/billing/api";
import { Cell, csvDate, csvDateTime, csvMoney, downloadCsv } from "@/lib/csvFile";

/**
 * The finance pages as CSV files: Cashbook, Dues, Bills and Daily closing. Each file starts with a
 * short heading block (what it is, the period, when it was downloaded, the totals), then one table
 * with plain column names. Amounts are whole rupees as plain numbers, so they can be added up.
 */

const BUSINESS = "Ravinarayan PG & Tiffin";

const ENTRY: Record<string, string> = {
  RENT_PAYMENT: "Rent received",
  RENT_CHARGE: "Rent charged",
  SECURITY_DEPOSIT: "Deposit received",
  DEPOSIT_REFUND: "Deposit refunded",
  TIFFIN_PAYMENT: "Tiffin payment received",
  TIFFIN_CHARGE: "Tiffin billed",
  EXPENSE: "Expense",
  REVERSAL: "Reversal",
};
const CATEGORY: Record<string, string> = {
  GROCERY: "Grocery",
  KITCHEN_SUPPLIES: "Kitchen supplies",
  LPG: "LPG (cooking gas)",
  UTILITIES: "Electricity & water",
  MAINTENANCE: "Repairs & maintenance",
  STAFF_SALARY: "Staff salary",
  INTERNET: "Internet & phone",
  MARKETING: "Marketing",
  OTHER: "Other",
  OTHER_RECEIPT: "Other money received",
  TIFFIN_DELIVERY_COLLECTION: "Delivery cash handed over",
  TIFFIN_WALKIN_SALE: "Counter sale",
  DEPOSIT_APPLICATION: "Deposit used for rent",
};
const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque", OTHER: "Other" };
const MONEY_IN = new Set(["RENT_PAYMENT", "SECURITY_DEPOSIT", "TIFFIN_PAYMENT"]);
const MONEY_OUT = new Set(["EXPENSE", "DEPOSIT_REFUND"]);
const CHARGES = new Set(["RENT_CHARGE", "TIFFIN_CHARGE"]);
const KITCHEN = new Set(["GROCERY", "KITCHEN_SUPPLIES", "LPG"]);

const words = (s: string | null | undefined) => {
  const t = String(s || "").replace(/_/g, " ").toLowerCase().trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
};
const method = (m: string | null | undefined) => (m ? METHOD[m] || words(m) : "");
const entryOf = (t: FinancialTransaction) => (t.transactionType === "TIFFIN_PAYMENT" && t.category === "OTHER_RECEIPT" ? "Other money received" : ENTRY[t.transactionType] || words(t.transactionType));
const partOf = (t: FinancialTransaction) =>
  t.residentId || ["RENT_PAYMENT", "SECURITY_DEPOSIT", "DEPOSIT_REFUND", "RENT_CHARGE"].includes(t.transactionType) || (t.transactionType === "EXPENSE" && !KITCHEN.has(t.category))
    ? "PG"
    : "Tiffin";
const stamp = () => `${csvDateTime(new Date().toISOString())} (India time)`;
const periodText = (from?: string, to?: string) => (from || to ? `${csvDate(from) || "start"} to ${csvDate(to) || "today"}` : "All dates");
const day = (iso?: string) => (iso || new Date().toISOString().slice(0, 10)).slice(0, 10);

/** Cashbook: every entry in the period, with money in and money out in their own columns. */
export function exportCashbookCsv(transactions: FinancialTransaction[], opts: { startDate?: string; endDate?: string }) {
  const rows = [...transactions].sort((a, b) => (a.transactionDate === b.transactionDate ? a.createdAt.localeCompare(b.createdAt) : a.transactionDate.localeCompare(b.transactionDate)));
  const live = rows.filter((t) => t.status === "POSTED" && t.transactionType !== "REVERSAL");
  const moneyIn = live.filter((t) => MONEY_IN.has(t.transactionType)).reduce((s, t) => s + Number(t.amount), 0);
  const moneyOut = live.filter((t) => MONEY_OUT.has(t.transactionType)).reduce((s, t) => s + Number(t.amount), 0);
  const charged = live.filter((t) => CHARGES.has(t.transactionType)).reduce((s, t) => s + Number(t.amount), 0);
  const out: Cell[][] = [
    [`${BUSINESS} — Cashbook`],
    ["Period", periodText(opts.startDate, opts.endDate)],
    ["Downloaded", stamp()],
    ["Entries", rows.length],
    ["Money received (₹)", csvMoney(moneyIn)],
    ["Money paid out (₹)", csvMoney(moneyOut)],
    ["Net cash (₹)", csvMoney(moneyIn - moneyOut)],
    ["Charged to accounts, not cash (₹)", csvMoney(charged)],
    ["Note", "Reversed entries and reversals are listed but not counted in the totals."],
    [],
    ["Date", "Entry", "Part of business", "Name (from / paid to)", "Room", "Category", "Details", "Payment method", "Reference / UTR", "Money in (₹)", "Money out (₹)", "Charged (₹)", "Reversal (₹)", "Status", "Recorded by", "Recorded at", "Entry ID"],
    ...rows.map((t) => {
      const amt = csvMoney(Number(t.amount));
      const kind = t.transactionType;
      return [
        csvDate(t.transactionDate),
        entryOf(t),
        partOf(t),
        t.residentName || t.customerName || t.payeeVendor || "",
        t.roomNumber || "",
        kind === "EXPENSE" || CATEGORY[t.category] ? CATEGORY[t.category] || words(t.category) : "",
        [t.billingPeriod, t.description].filter(Boolean).join(" · "),
        method(t.paymentMethod),
        t.referenceNumber && !/^[a-z]+_[0-9a-f-]{6,}/i.test(t.referenceNumber) ? t.referenceNumber : "",
        MONEY_IN.has(kind) ? amt : "",
        MONEY_OUT.has(kind) ? amt : "",
        CHARGES.has(kind) ? amt : "",
        kind === "REVERSAL" ? amt : "",
        t.status === "REVERSED" ? "Reversed" : kind === "REVERSAL" ? "Reversal" : "Recorded",
        t.createdByName || "",
        csvDateTime(t.createdAt),
        t.id,
      ];
    }),
  ];
  return downloadCsv(`Cashbook-${day(opts.startDate)}-to-${day(opts.endDate)}`, out);
}

const whoKind = (a: DueAccount) => (a.kind === "RESIDENT" ? "PG resident" : a.kind === "ORDER" ? "One-time order" : a.customerType === "CORPORATE" ? "Corporate customer" : "Tiffin customer");

/** Dues: who owes what, split into rent, tiffin and delivery orders, oldest first. */
export function exportDuesCsv(accounts: DueAccount[], label: string) {
  const list = accounts.filter((a) => a.total > 0).sort((a, b) => b.total - a.total);
  const sum = (k: "pg" | "tiffin" | "delivery" | "total") => list.reduce((s, a) => s + Number(a[k] || 0), 0);
  const out: Cell[][] = [
    [`${BUSINESS} — Dues`],
    ["List", label],
    ["As on", stamp()],
    ["People who owe", list.length],
    ["Rent due (₹)", csvMoney(sum("pg"))],
    ["Tiffin due (₹)", csvMoney(sum("tiffin"))],
    ["Delivery orders due (₹)", csvMoney(sum("delivery"))],
    ["Total due (₹)", csvMoney(sum("total"))],
    [],
    ["Name", "Kind", "Phone", "Room / place", "Rent due (₹)", "Tiffin due (₹)", "Delivery orders due (₹)", "Total due (₹)", "Due since", "Days pending", "Unpaid items"],
    ...list.map((a) => [a.name, whoKind(a), a.phone || "", a.place || "", csvMoney(a.pg), csvMoney(a.tiffin), csvMoney(a.delivery), csvMoney(a.total), csvDate(a.oldestDate), a.ageDays ?? "", a.openItems]),
  ];
  return downloadCsv(`Dues-${label}-${day()}`, out);
}

/** Bills: every bill made, with GST split and what was received against it. */
export function exportBillsCsv(bills: BillSummary[], label: string) {
  const list = [...bills].sort((a, b) => (a.issueDate === b.issueDate ? a.billNumber.localeCompare(b.billNumber) : a.issueDate.localeCompare(b.issueDate)));
  const total = list.reduce((s, b) => s + Number(b.total), 0);
  const received = list.reduce((s, b) => s + Number(b.receivedTotal || 0), 0);
  const out: Cell[][] = [
    [`${BUSINESS} — Bills`],
    ["List", label],
    ["Downloaded", stamp()],
    ["Bills", list.length],
    ["Billed (₹)", csvMoney(total)],
    ["Received against these bills (₹)", csvMoney(received)],
    ["Note", "A bill is a copy of the dues on its date; dues are settled by payments, not by the bill."],
    [],
    ["Bill no.", "Date", "Name", "Phone", "Kind", "Bill type", "GST rate (%)", "Taxable value (₹)", "CGST (₹)", "SGST (₹)", "Bill total (₹)", "Received against bill (₹)", "Made by", "Made at"],
    ...list.map((b) => [
      b.billNumber,
      csvDate(b.issueDate),
      b.accountName,
      b.accountPhone || "",
      b.accountKind === "RESIDENT" ? "PG resident" : b.accountKind === "ORDER" ? "One-time order" : "Tiffin customer",
      b.type === "GST" ? "GST" : "Non-GST",
      b.type === "GST" ? b.gstRate : "",
      b.type === "GST" ? csvMoney(b.taxable) : "",
      b.type === "GST" ? csvMoney(b.cgst) : "",
      b.type === "GST" ? csvMoney(b.sgst) : "",
      csvMoney(b.total),
      csvMoney(b.receivedTotal || 0),
      b.createdByName || "",
      csvDateTime(b.createdAt),
    ]),
  ];
  return downloadCsv(`Bills-${label}-${day()}`, out);
}

/** Daily closing: each day's opening, money in and out by method, expected and counted cash. */
export function exportClosingsCsv(closings: DailyClosingRecord[]) {
  const list = [...closings].sort((a, b) => (a.closingDate === b.closingDate ? String(a.division).localeCompare(String(b.division)) : a.closingDate.localeCompare(b.closingDate)));
  const out: Cell[][] = [
    [`${BUSINESS} — Daily closing`],
    ["Downloaded", stamp()],
    ["Days", list.length],
    [],
    [
      "Date", "Part of business", "Status", "Opening balance (₹)", "Opening cash (₹)",
      "Cash in (₹)", "UPI in (₹)", "Bank in (₹)", "Cheque in (₹)", "Other in (₹)", "Total in (₹)",
      "Cash out (₹)", "UPI out (₹)", "Bank out (₹)", "Cheque out (₹)", "Other out (₹)", "Total out (₹)",
      "Expected closing balance (₹)", "Expected cash (₹)", "Cash counted (₹)", "Bank checked (₹)", "Cash difference (₹)", "Total difference (₹)",
      "Reason for difference", "Notes", "Prepared by", "Finalised by", "Finalised at", "Reopened by", "Reopen reason",
    ],
    ...list.map((c) => [
      csvDate(c.closingDate),
      c.division === "PG" ? "PG" : c.division === "TIFFIN" ? "Tiffin" : words(String(c.division)),
      words(c.status),
      csvMoney(c.openingBalance), csvMoney(c.openingCashBalance),
      csvMoney(c.cashInflow), csvMoney(c.upiInflow), csvMoney(c.bankTransferInflow), csvMoney(c.chequeInflow), csvMoney(c.otherInflow), csvMoney(c.totalInflow),
      csvMoney(c.cashOutflow), csvMoney(c.upiOutflow), csvMoney(c.bankTransferOutflow), csvMoney(c.chequeOutflow), csvMoney(c.otherOutflow), csvMoney(c.totalOutflow),
      csvMoney(c.expectedClosingBalance), csvMoney(c.expectedCashBalance),
      c.actualCashCounted === null ? "" : csvMoney(c.actualCashCounted),
      c.actualBankVerified === null ? "" : csvMoney(c.actualBankVerified),
      csvMoney(c.cashDiscrepancy), csvMoney(c.totalDiscrepancy),
      c.discrepancyReason || "", c.notes || "",
      c.preparedByName || "", c.finalizedByName || "", csvDateTime(c.finalizedAt), c.reopenedByName || "", c.reopenReason || "",
    ]),
  ];
  return downloadCsv(`Daily-closing-${day()}`, out);
}
