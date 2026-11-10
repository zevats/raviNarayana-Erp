"use client";

import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ReceiptText, Wallet } from "lucide-react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { Card, CardHeader, StatStrip, SearchField, Badge } from "@/components/ui/kit";
import { LoadError, SkeletonRows } from "@/components/ui/states";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { useTimedMessage } from "@/lib/useTimedMessage";
import { businessToday } from "@/lib/businessDate";
import { friendlyError } from "@/lib/friendlyError";
import { AccountSheet } from "@/modules/finance/components/ReceivablesView";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const monthLabel = (m: string) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
};

interface PlanBill {
  customerId: string;
  customerName: string;
  phone: string;
  subscriptionId: string;
  productName: string;
  totalAmount: number;
  alreadyBilled: boolean;
  existingInvoiceNumber?: string | null;
  existingInvoiceStatus?: string | null;
}
interface DueAccount {
  accountKey: string;
  kind: "RESIDENT" | "CUSTOMER" | "ORDER";
  name: string;
  phone: string | null;
  tiffin: number;
  delivery: number;
  total: number;
  ageDays: number | null;
}

/**
 * Tiffin billing, in one place: this month's plan bills (create the missing ones in one step, see
 * which are paid) and every customer who owes money (plan bills and unpaid orders), with Collect
 * opening the customer's account to take a payment. Payments use the same account and allocation
 * as Finance → Receivables.
 */
export function TiffinBillingView() {
  const thisMonth = businessToday().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<{ ids: string[]; total: number; one?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [notice, setNotice] = useTimedMessage<{ tone: "ok" | "error"; text: string }>();

  const billsQ = useErpQuery<PlanBill[]>(
    `billing:plans:${month}`,
    async () => {
      const r = await fetch(`/api/tiffin/billing/preview?billingPeriod=${month}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not load the plan bills.");
      return (d.preview?.customers ?? []) as PlanBill[];
    },
    { ttl: 20000, tags: ["finance", "invoices", "tiffin_subscriptions"] }
  );
  const duesQ = useErpQuery<DueAccount[]>(
    "billing:dues",
    async () => {
      const load = async (source: string) => {
        const r = await fetch(`/api/finance/receivables?source=${source}&limit=100`, { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Could not load customer dues.");
        return (d.accounts ?? []) as DueAccount[];
      };
      const [t, dl] = await Promise.all([load("TIFFIN"), load("DELIVERY")]);
      const by = new Map<string, DueAccount>();
      for (const a of [...t, ...dl]) {
        if (a.kind === "RESIDENT") continue;
        const prev = by.get(a.accountKey);
        by.set(a.accountKey, prev ? { ...a, tiffin: Math.max(prev.tiffin, a.tiffin), delivery: Math.max(prev.delivery, a.delivery), ageDays: Math.max(prev.ageDays ?? 0, a.ageDays ?? 0) } : a);
      }
      return [...by.values()].map((a) => ({ ...a, total: (a.tiffin || 0) + (a.delivery || 0) })).filter((a) => a.total > 0).sort((a, b) => b.total - a.total);
    },
    { ttl: 20000, tags: ["finance", "invoices", "orders", "receivables"] }
  );

  const bills = billsQ.data ?? [];
  const unbilled = bills.filter((b) => !b.alreadyBilled);
  const unbilledTotal = unbilled.reduce((a, b) => a + b.totalAmount, 0);
  const paidCount = bills.filter((b) => b.existingInvoiceStatus === "PAID").length;
  const dues = duesQ.data ?? [];
  const dueTotal = dues.reduce((a, d) => a + d.total, 0);
  const shownDues = useMemo(() => {
    const s = search.trim().toLowerCase();
    return dues.filter((d) => !s || d.name.toLowerCase().includes(s) || (d.phone || "").includes(s));
  }, [dues, search]);

  const createBills = async () => {
    if (!confirm) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/tiffin/billing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billingPeriod: month, customerIds: confirm.ids, autoIssue: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not create the bills.");
      const made = Number(d.result?.generatedCount ?? d.generatedCount ?? confirm.ids.length);
      invalidateErpCache(["finance", "invoices", "receivables", "tiffin_customers", "tiffin_subscriptions"]);
      setConfirm(null);
      setNotice({ tone: "ok", text: `${made} plan bill${made === 1 ? "" : "s"} created for ${monthLabel(month)}.` });
    } catch (e: any) {
      setError(friendlyError(e?.message || "Could not create the bills."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-full rn-glass p-1" role="group" aria-label="Month">
          <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" className="grid place-items-center w-10 h-10 rounded-full hover:bg-black/[0.05]">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-3 min-w-[150px] text-center text-[15px] font-semibold text-[var(--rn-ink)]">{monthLabel(month)}</span>
          <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month" className="grid place-items-center w-10 h-10 rounded-full hover:bg-black/[0.05] disabled:opacity-30">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <StatStrip
        items={[
          { label: "Billed", value: bills.length - unbilled.length, tone: "good" },
          { label: "To bill", value: rupees(unbilledTotal), tone: unbilledTotal ? "warn" : "default" },
          { label: "Paid", value: paidCount, tone: "good" },
          { label: "Due from customers", value: rupees(dueTotal), tone: dueTotal ? "bad" : "good" },
        ]}
      />

      {notice && (
        <p role="status" className={`rounded-2xl px-4 py-3 text-[14px] ${notice.tone === "ok" ? "bg-[#E4F2E0] text-[#1D4E16]" : "bg-[#FDECE8] text-[#A3311D]"}`}>{notice.text}</p>
      )}

      {/* Plan bills for the month */}
      <Card flush>
        <div className="p-4 sm:p-5 border-b border-[var(--rn-line)]">
          <CardHeader
            className="flex-wrap items-center"
            title={<span className="inline-flex items-center gap-2"><ReceiptText className="w-4 h-4 text-[var(--rn-accent-mid)]" /> Plan bills</span>}
            action={
              unbilled.length > 0 ? (
                <button type="button" onClick={() => setConfirm({ ids: [...new Set(unbilled.map((b) => b.customerId))], total: unbilledTotal })} className="rn-btn rn-btn-primary w-full sm:w-auto">
                  Bill {unbilled.length} plan{unbilled.length === 1 ? "" : "s"} · {rupees(unbilledTotal)}
                </button>
              ) : null
            }
          />
        </div>
        {billsQ.isLoading && !billsQ.data ? (
          <div className="p-4 sm:p-5"><SkeletonRows rows={4} /></div>
        ) : billsQ.error && !billsQ.data ? (
          <div className="p-4 sm:p-5"><LoadError message={billsQ.error.message} onRetry={() => billsQ.refetch()} /></div>
        ) : bills.length === 0 ? (
          <p className="px-5 py-10 text-center text-[15px] text-[var(--rn-ink-2)]">No plans ran in {monthLabel(month)}.</p>
        ) : (
          <ul className="divide-y divide-[var(--rn-line)]" aria-label="Plan bills">
            {bills.map((b) => {
              const st = b.existingInvoiceStatus;
              return (
                <li key={b.subscriptionId} className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold text-[var(--rn-ink)] truncate">{b.customerName}</p>
                    <p className="text-[13px] text-[var(--rn-ink-2)] truncate">{b.productName}{b.existingInvoiceNumber ? ` · ${b.existingInvoiceNumber}` : ""}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <span className="text-[15px] font-semibold tabular-nums text-[var(--rn-ink)]">{rupees(b.totalAmount)}</span>
                    {!b.alreadyBilled ? <Badge>Not billed</Badge> : st === "PAID" ? <Badge tone="good">Paid</Badge> : st === "PARTIALLY_PAID" ? <Badge tone="warn">Part paid</Badge> : <Badge tone="bad">Unpaid</Badge>}
                  </div>
                  {!b.alreadyBilled ? (
                    <button type="button" onClick={() => setConfirm({ ids: [b.customerId], total: b.totalAmount, one: b.customerName })} className="rn-btn rn-btn-sm">Bill</button>
                  ) : st !== "PAID" ? (
                    <button type="button" onClick={() => setAccount(`C:${b.customerId}`)} className="rn-btn rn-btn-sm"><Wallet /> Collect</button>
                  ) : (
                    <button type="button" onClick={() => setAccount(`C:${b.customerId}`)} className="rn-btn rn-btn-sm">Account</button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Customer dues: plan bills and unpaid orders */}
      <Card flush>
        <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5 border-b border-[var(--rn-line)]">
          <h2 className="flex-1 text-[17px] font-semibold text-[var(--rn-ink)]">Customer dues</h2>
          <SearchField value={search} onChange={setSearch} placeholder="Search customer or phone" className="w-full sm:w-72" />
        </div>
        {duesQ.isLoading && !duesQ.data ? (
          <div className="p-4 sm:p-5"><SkeletonRows rows={4} /></div>
        ) : duesQ.error && !duesQ.data ? (
          <div className="p-4 sm:p-5"><LoadError message={duesQ.error.message} onRetry={() => duesQ.refetch()} /></div>
        ) : shownDues.length === 0 ? (
          <p className="px-5 py-10 text-center text-[15px] text-[var(--rn-ink-2)]">{search.trim() ? "No customer matches." : "No customer owes anything."}</p>
        ) : (
          <ul className="divide-y divide-[var(--rn-line)]" aria-label="Customer dues">
            {shownDues.map((d) => (
              <li key={d.accountKey} className="flex items-center gap-3 px-4 sm:px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-[var(--rn-ink)] truncate">{d.name}</p>
                  <p className="text-[13px] text-[var(--rn-ink-2)]">
                    {[d.tiffin > 0 ? `Plan bills ${rupees(d.tiffin)}` : null, d.delivery > 0 ? `Orders ${rupees(d.delivery)}` : null].filter(Boolean).join(" · ")}
                    {d.ageDays ? ` · oldest ${d.ageDays} day${d.ageDays === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <span className="text-[16px] font-semibold tabular-nums text-[#A3311D]">{rupees(d.total)}</span>
                <button type="button" onClick={() => setAccount(d.accountKey)} className="rn-btn rn-btn-sm rn-btn-primary"><Wallet /> Collect</button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => !busy && setConfirm(null)}
        onConfirm={createBills}
        busy={busy}
        error={error}
        title={confirm?.one ? `Bill ${confirm.one}?` : `Bill ${confirm?.ids.length ?? 0} plans?`}
        confirmLabel={`Create bill${confirm && confirm.ids.length === 1 ? "" : "s"} · ${rupees(confirm?.total ?? 0)}`}
      >
        <p className="text-[14px] text-[var(--rn-ink-2)]">{monthLabel(month)}. Bills already created are not made again.</p>
      </ConfirmDialog>

      <AccountSheet
        accountKey={account}
        onClose={() => {
          setAccount(null);
          invalidateErpCache(["finance", "invoices", "receivables"]);
        }}
      />
    </div>
  );
}
