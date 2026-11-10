"use client";

import React from "react";

/**
 * Recorded data (audit details, event metadata) as readable rows instead of raw JSON: labels in
 * words, money as ₹, dates as dates, item lists as "2× Thali", record ids shortened, and internal
 * fields (keys, hashes, tokens) left out.
 */
const HIDDEN = /idempotency|hash|token|secret|password|otp|cookie|session|userAgent|user_agent|^ip$|ipAddress/i;
const MONEY = /amount|price|total|paid|due|balance|cash|upi|rent|deposit|fee|charge|value|variance|outstanding/i;
const LABELS: Record<string, string> = {
  orderId: "Order",
  taskId: "Delivery",
  customerId: "Customer",
  residentId: "Resident",
  roomId: "Room",
  staffId: "Staff",
  driverId: "Delivery person",
  subscriptionId: "Subscription",
  invoiceId: "Invoice",
  serviceDate: "Date",
  mealType: "Meal",
  paymentMethod: "Paid by",
  paymentChoice: "Payment",
};

function label(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bid\b/i, "")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const isId = (v: string) => /^[a-z]{2,6}_[A-Za-z0-9-]{6,}$/.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v);
const shortId = (v: string) => `#${v.replace(/^[a-z]{2,6}_/, "").replace(/-/g, "").slice(0, 6).toUpperCase()}`;
const words = (v: string) => (/^[A-Z][A-Z_]+$/.test(v) ? v.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : v);

function show(key: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return MONEY.test(key) ? `₹${v.toLocaleString("en-IN")}` : v.toLocaleString("en-IN");
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      const d = new Date(v);
      return isNaN(d.getTime()) ? v : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(d);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${v}T00:00:00Z`));
    if (isId(v)) return shortId(v);
    return words(v);
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    if (v.every((x) => x && typeof x === "object" && ("productName" in x || "name" in x))) {
      return v.map((x: any) => `${x.quantity ? `${x.quantity}× ` : ""}${x.productName || x.name}`).join(", ");
    }
    return v.map((x) => show(key, x)).filter(Boolean).join(", ");
  }
  if (typeof v === "object") {
    const parts = Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !HIDDEN.test(k))
      .map(([k, x]) => {
        const s = show(k, x);
        return s ? `${label(k)}: ${s}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  return String(v);
}

export function DetailsList({ data, className = "" }: { data: unknown; className?: string }) {
  if (!data || typeof data !== "object") return null;
  const rows = Object.entries(data as Record<string, unknown>)
    .filter(([k]) => !HIDDEN.test(k))
    .map(([k, v]) => [label(k), show(k, v)] as const)
    .filter(([, v]) => v);
  if (rows.length === 0) return null;
  return (
    <dl className={`grid grid-cols-[minmax(96px,34%)_1fr] gap-x-3 gap-y-2 rounded-2xl bg-[#F6F3EC] px-4 py-3 text-[13px] ${className}`}>
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-[#4A504B]">{k}</dt>
          <dd className="text-[#1E2320] font-medium break-words">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
