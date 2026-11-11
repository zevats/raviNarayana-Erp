/** Receipts (migration 0028): shared by the server, the receipt screen and the public receipt page. */

export interface ReceiptSnapshot {
  company: { name: string; address: string; phone: string; email: string; gstin: string | null };
  payer: { name: string; phone: string | null; place: string | null };
  /** What the money was for: "Room rent", "Tiffin", "Security deposit", "Other". */
  purpose: string;
  /** The note or period ("November 2026", "Party order advance"). */
  detail: string | null;
  method: string | null;
  reference: string | null;
  receivedBy: string | null;
  amountInWords: string;
  /** What the person still owes after this payment (residents and tiffin customers). */
  dueAfter: number | null;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  token: string;
  transactionId: string;
  accountName: string;
  accountPhone: string | null;
  amount: number;
  receiptDate: string;
  snapshot: ReceiptSnapshot;
  createdAt: string;
}

export function receiptShareText(r: Pick<Receipt, "accountName" | "receiptNumber" | "amount" | "receiptDate">, company: string, link: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(r.receiptDate)
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${r.receiptDate}T00:00:00Z`))
    : r.receiptDate;
  return `Namaste ${r.accountName},\n\nWe received ₹${Math.round(r.amount).toLocaleString("en-IN")} on ${day}. Receipt ${r.receiptNumber} from ${company}:\n${link}\n\nThank you.`;
}
