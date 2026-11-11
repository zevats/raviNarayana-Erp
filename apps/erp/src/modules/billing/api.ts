import { friendlyError } from "@/lib/friendlyError";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import type { Bill, BillSummary, BillType } from "@/lib/bills";

/** What the dues screens read (Finance → receivables API). */
export interface DueLine {
  source: "PG" | "TIFFIN" | "DELIVERY";
  accountKey: string;
  kind: "CHARGE" | "INVOICE" | "ORDER" | "UNALLOCATED" | "ADVANCE";
  refId: string;
  reference: string;
  description: string;
  date: string;
  amount: number;
  paid: number;
  outstanding: number;
  status: "UNPAID" | "PARTIALLY_PAID" | "CREDIT";
  ageDays: number;
}

export interface DueAccount {
  accountKey: string;
  kind: "RESIDENT" | "CUSTOMER" | "ORDER";
  name: string;
  phone: string | null;
  place: string | null;
  pg: number;
  tiffin: number;
  delivery: number;
  total: number;
  oldestDate: string | null;
  ageDays: number | null;
  openItems: number;
  customerType: string | null;
}

export interface DuesList {
  summary: { total: number; bySource: { PG: number; TIFFIN: number; DELIVERY: number }; accountsOwing: number };
  accounts: DueAccount[];
  total: number;
}

export interface AccountDues {
  account: { accountKey: string; kind: "RESIDENT" | "CUSTOMER" | "ORDER"; id: string; name: string; phone: string | null; place: string | null; customerType: string | null };
  asOf: string;
  totals: { PG: number; TIFFIN: number; DELIVERY: number; total: number };
  lines: DueLine[];
}

export interface HistoryEntry {
  date: string;
  source: "PG" | "TIFFIN" | "DELIVERY";
  type: string;
  description: string;
  reference: string | null;
  charge: number;
  payment: number;
  adjustment: number;
  reversedLater: boolean;
  method: string | null;
  balance: number;
}

/** Everything the money screens refresh after a bill or a payment. */
export const MONEY_TAGS = ["finance", "receivables", "invoices", "bills", "delivery", "tiffin", "tiffin_customers", "tiffin_subscriptions", "residents", "custody", "dashboard", "orders"];
export const refreshMoney = () => invalidateErpCache(MONEY_TAGS);

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendlyError(data.error || "Could not load. Please try again."));
  return data as T;
}

/** A change sent to the server. The screen that calls it shows its own message (X-RN-Quiet). */
export async function send<T>(url: string, body: unknown, method = "POST"): Promise<{ data: T; status: number }> {
  let res: Response;
  try {
    res = await fetch(url, { method, headers: { "Content-Type": "application/json", "X-RN-Quiet": "1" }, body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error("No connection. Check the internet and try again."), { unsure: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(friendlyError(data.error || "That did not work. Please try again.")), { unsure: res.status >= 500 });
  return { data: data as T, status: res.status };
}

export const createBill = async (accountKey: string, type: BillType, gstRate: number, batchId?: string) =>
  (await send<{ bill: Bill }>("/api/finance/bills", { accountKey, type, gstRate, batchId })).data.bill;

export const listAccountBills = (accountKey: string) => getJson<{ bills: BillSummary[]; total: number }>(`/api/finance/bills?account=${encodeURIComponent(accountKey)}&limit=30`);

export const loadBill = async (idOrNumber: string) => (await getJson<{ bill: Bill }>(`/api/finance/bills/${encodeURIComponent(idOrNumber)}`)).bill;

export const billLink = (token: string) => `${window.location.origin}/bill/${token}`;

export const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
] as const;
export type Method = (typeof METHODS)[number]["value"];
export const methodLabel = (m: string | null | undefined) => METHODS.find((x) => x.value === m)?.label ?? (m || "");
