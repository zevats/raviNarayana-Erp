/** Bills (migration 0027): the shapes shared by the server, the bill screen and the public bill page. */

export type BillType = "GST" | "NON_GST";

export interface BillLine {
  /** What is owed: "Room rent", "Two-meal plan", "Order · Lunch". */
  label: string;
  /** The period or the items: "15 Nov – 14 Dec 2026", "2 × Thali". */
  detail: string;
  date: string;
  amount: number;
  paid: number;
  due: number;
}

export interface BillPaymentLine {
  date: string;
  label: string;
  method: string | null;
  amount: number;
}

export interface BillSnapshot {
  company: {
    name: string;
    address: string;
    phone: string;
    email: string;
    gstin: string | null;
    stateCode: string;
    upiId: string;
    upiName: string;
  };
  recipient: {
    name: string;
    phone: string | null;
    place: string | null;
    kind: "RESIDENT" | "CUSTOMER" | "ORDER";
  };
  lines: BillLine[];
  /** The latest payments received on the account before this bill. */
  payments: BillPaymentLine[];
  amountInWords: string;
}

export interface Bill {
  id: string;
  billNumber: string;
  token: string;
  accountKey: string;
  accountKind: "RESIDENT" | "CUSTOMER" | "ORDER";
  accountName: string;
  accountPhone: string | null;
  type: BillType;
  gstRate: number;
  issueDate: string;
  total: number;
  taxable: number;
  cgst: number;
  sgst: number;
  snapshot: BillSnapshot;
  createdAt: string;
  createdByName: string | null;
  /** Payments recorded against this bill number. */
  received: Array<{ amount: number; method: string; date: string }>;
}

/** A bill as it appears in a list (no snapshot). */
export type BillSummary = Omit<Bill, "snapshot" | "received"> & { receivedTotal: number };

/** GST shown inside a total that already includes it: taxable + CGST + SGST is exactly the total. */
export function splitInclusiveGst(total: number, ratePercent: number): { taxable: number; cgst: number; sgst: number } {
  const paise = Math.round(total * 100);
  if (!(ratePercent > 0)) return { taxable: paise / 100, cgst: 0, sgst: 0 };
  const taxable = Math.round((paise * 100) / (100 + ratePercent));
  const tax = paise - taxable;
  const cgst = Math.round(tax / 2);
  return { taxable: taxable / 100, cgst: cgst / 100, sgst: (tax - cgst) / 100 };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const below1000 = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below100(n % 100)}` : ""}` : below100(n));

/** 3500 → "Rupees Three Thousand Five Hundred Only" (Indian grouping: lakh, crore). */
export function rupeesInWords(amount: number): string {
  let n = Math.round(Math.abs(amount));
  if (n === 0) return "Rupees Zero Only";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return `Rupees ${parts.join(" ")} Only`;
}

/** India's financial year of a date (April to March): 2026-11-11 → "26-27". */
export function financialYear(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const from = m >= 4 ? y : y - 1;
  return `${String(from % 100).padStart(2, "0")}-${String((from + 1) % 100).padStart(2, "0")}`;
}

const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** "2026-11-11" → "11 Nov 2026". Anything else is returned as it is. */
export function billDay(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return date || "";
  return DAY.format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

/** The message sent with a bill on WhatsApp. */
export function billShareText(bill: Pick<Bill, "accountName" | "billNumber" | "total" | "issueDate">, company: string, link: string): string {
  return `Namaste ${bill.accountName},\n\nYour bill ${bill.billNumber} from ${company} dated ${billDay(bill.issueDate)} is ₹${Math.round(bill.total).toLocaleString("en-IN")}.\n\nView or download the bill:\n${link}\n\nThank you.`;
}

/** wa.me link for a phone number (10-digit Indian numbers get 91). Empty when there is no usable number. */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  const number = digits.length === 10 ? `91${digits}` : digits.length === 11 && digits.startsWith("0") ? `91${digits.slice(1)}` : digits.length >= 11 ? digits : "";
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
}
