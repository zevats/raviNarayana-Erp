"use client";

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Plus, ShoppingBag, Eye, Pencil, PauseCircle, PlayCircle, XCircle } from "lucide-react";
import type { TiffinSubscription } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { Card, StatStrip, Segmented, SearchField, Badge } from "@/components/ui/kit";
import { LoadError, SkeletonRows } from "@/components/ui/states";
import { RowMenu } from "@/components/ui/RowMenu";
import { useTimedMessage } from "@/lib/useTimedMessage";
import { businessToday } from "@/lib/businessDate";
import { planMealsLabel } from "@/lib/planMeals";
import { SubscriptionForm } from "./SubscriptionForm";

const SubscriptionDetailModal = dynamic(() => import("./modals/SubscriptionDetailModal").then((m) => m.SubscriptionDetailModal), { ssr: false });
const PauseSubscriptionModal = dynamic(() => import("./modals/PauseSubscriptionModal").then((m) => m.PauseSubscriptionModal), { ssr: false });
const CancelSubscriptionModal = dynamic(() => import("./modals/CancelSubscriptionModal").then((m) => m.CancelSubscriptionModal), { ssr: false });

type Filter = "ACTIVE" | "PAUSED" | "ENDED" | "ALL";
type BillState = { status: "NOT_BILLED" | "UNPAID" | "PART_PAID" | "PAID"; amount: number };
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const day = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/**
 * The one subscriptions page (Tiffin customers → Subscriptions): who is on which monthly plan, its
 * state and this month's bill. One main action per row (Take order); the rest is in the ⋯ menu.
 */
export function SubscriptionsView() {
  const router = useRouter();
  const canManage = useHasPermission("tiffin.manage");
  const canSeeMoney = useHasPermission("finance.read");
  const month = businessToday().slice(0, 7);
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ open: boolean; sub: TiffinSubscription | null }>({ open: false, sub: null });
  const [detail, setDetail] = useState<TiffinSubscription | null>(null);
  const [pausing, setPausing] = useState<TiffinSubscription | null>(null);
  const [ending, setEnding] = useState<TiffinSubscription | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useTimedMessage<{ tone: "ok" | "error"; text: string }>();

  const q = useErpQuery<TiffinSubscription[]>(
    "subs-view:/api/tiffin/subscriptions",
    async () => {
      const r = await fetch("/api/tiffin/subscriptions?limit=200", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not load subscriptions.");
      return Array.isArray(d.subscriptions) ? d.subscriptions : [];
    },
    { ttl: 20000, tags: ["tiffin_subscriptions", "subscriptions"] }
  );
  // This month's bill per subscription (owners and managers who see money).
  const billsQ = useErpQuery<Record<string, BillState>>(
    canSeeMoney ? `subs-view:bills:${month}` : null,
    async () => {
      const r = await fetch(`/api/tiffin/billing/preview?billingPeriod=${month}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      const out: Record<string, BillState> = {};
      for (const c of d.preview?.customers ?? d.customers ?? []) {
        const st = c.existingInvoiceStatus;
        out[c.subscriptionId] = {
          status: !c.alreadyBilled ? "NOT_BILLED" : st === "PAID" ? "PAID" : st === "PARTIALLY_PAID" ? "PART_PAID" : "UNPAID",
          amount: Number(c.totalAmount) || 0,
        };
      }
      return out;
    },
    { ttl: 30000, tags: ["finance", "tiffin_subscriptions", "invoices"] }
  );

  const all = q.data ?? [];
  const counts = useMemo(() => ({
    ACTIVE: all.filter((s) => s.status === "ACTIVE").length,
    PAUSED: all.filter((s) => s.status === "PAUSED").length,
    ENDED: all.filter((s) => s.status === "CANCELLED" || s.status === "COMPLETED").length,
    ALL: all.length,
  }), [all]);
  const monthly = all.filter((s) => s.status === "ACTIVE").reduce((a, s) => a + (s.price || 0), 0);
  const bills = billsQ.data ?? {};
  const billed = Object.values(bills).filter((b) => b.status !== "NOT_BILLED").length;
  const unbilled = Object.values(bills).filter((b) => b.status === "NOT_BILLED").length;

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all
      .filter((x) => filter === "ALL" || (filter === "ENDED" ? x.status === "CANCELLED" || x.status === "COMPLETED" : x.status === filter))
      .filter((x) => !s || (x.customerName || "").toLowerCase().includes(s) || (x.customerPhone || "").includes(s) || (x.productName || "").toLowerCase().includes(s))
      .sort((a, b) => (a.customerName || "").localeCompare(b.customerName || ""));
  }, [all, filter, search]);

  const resume = async (s: TiffinSubscription) => {
    setBusy(s.id);
    try {
      const r = await fetch(`/api/tiffin/subscriptions/${s.id}/resume`, { method: "POST", headers: { "Content-Type": "application/json" } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not resume.");
      invalidateErpCache(["tiffin_subscriptions", "subscriptions"]);
      setNotice({ tone: "ok", text: `${s.customerName}'s plan is running again.` });
    } catch (e: any) {
      setNotice({ tone: "error", text: e?.message || "Could not resume." });
    } finally {
      setBusy(null);
    }
  };
  const saved = (text: string) => {
    setForm({ open: false, sub: null });
    setNotice({ tone: "ok", text });
  };

  return (
    <div className="space-y-5 min-w-0">
      <StatStrip
        items={[
          { label: "Active plans", value: counts.ACTIVE, tone: "good" },
          { label: "Paused", value: counts.PAUSED, tone: counts.PAUSED ? "warn" : "default" },
          ...(canSeeMoney
            ? [
                { label: "Monthly value", value: rupees(monthly) },
                { label: "Billed this month", value: billed, tone: "good" as const },
                { label: "To bill", value: unbilled, tone: (unbilled ? "warn" : "default") as "warn" | "default" },
              ]
            : []),
        ]}
      />

      <Card flush>
        <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5 border-b border-[var(--rn-line)]">
          <SearchField value={search} onChange={setSearch} placeholder="Search customer, phone or plan" className="flex-1 min-w-[200px]" />
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "ACTIVE", label: "Active", count: counts.ACTIVE },
              { value: "PAUSED", label: "Paused", count: counts.PAUSED },
              { value: "ENDED", label: "Ended", count: counts.ENDED },
              { value: "ALL", label: "All" },
            ]}
          />
          {canManage && (
            <button type="button" onClick={() => setForm({ open: true, sub: null })} className="rn-btn rn-btn-primary">
              <Plus /> New subscription
            </button>
          )}
        </div>

        {notice && (
          <p role="status" className={`mx-4 sm:mx-5 mt-4 rounded-2xl px-4 py-3 text-[14px] ${notice.tone === "ok" ? "bg-[#E4F2E0] text-[#1D4E16]" : "bg-[#FDECE8] text-[#A3311D]"}`}>{notice.text}</p>
        )}

        {q.isLoading && !q.data ? (
          <div className="p-4 sm:p-5"><SkeletonRows rows={5} /></div>
        ) : q.error && !q.data ? (
          <div className="p-4 sm:p-5"><LoadError message={q.error.message} onRetry={() => q.refetch()} /></div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-12 text-center text-[15px] text-[var(--rn-ink-2)]">
            {search.trim() ? "No subscription matches." : filter === "ACTIVE" ? "No active subscriptions yet." : "Nothing here."}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--rn-line)]" aria-label="Subscriptions">
            {rows.map((s) => {
              const bill = bills[s.id];
              const active = s.status === "ACTIVE";
              return (
                <li key={s.id} data-sub-id={s.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-4">
                  <div className="min-w-0 sm:w-[28%]">
                    <p className="text-[15px] font-semibold text-[var(--rn-ink)] truncate">{s.customerName}</p>
                    <p className="text-[13px] text-[var(--rn-ink-2)] tabular-nums">{s.customerPhone}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] text-[var(--rn-ink)] truncate">
                      <span className="font-medium">{s.productName}</span>
                      {canSeeMoney && <span className="text-[var(--rn-ink-2)]"> · {rupees(s.price)} a month</span>}
                    </p>
                    <p className="text-[13px] text-[var(--rn-ink-2)]">
                      {planMealsLabel(s.mealTypes)} · since {day(s.startDate)}
                      {s.status === "PAUSED" && s.pauseResumeDate ? ` · back ${day(s.pauseResumeDate)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:w-[30%]">
                    {s.status === "PAUSED" ? <Badge tone="warn">Paused</Badge> : s.status === "ACTIVE" ? <Badge tone="good">Active</Badge> : <Badge>Ended</Badge>}
                    {canSeeMoney && active && bill && (
                      bill.status === "NOT_BILLED" ? <Badge>Not billed</Badge>
                      : bill.status === "PAID" ? <Badge tone="good">Paid {rupees(bill.amount)}</Badge>
                      : bill.status === "PART_PAID" ? <Badge tone="warn">Part paid</Badge>
                      : <Badge tone="bad">Unpaid {rupees(bill.amount)}</Badge>
                    )}
                    <span className="flex items-center gap-1.5 ml-auto sm:ml-2">
                      {active && canManage && (
                        <button type="button" onClick={() => router.push(`/orders?take=${encodeURIComponent(s.id)}`)} className="rn-btn rn-btn-sm" aria-label={`Take an order for ${s.customerName}`}>
                          <ShoppingBag /> Take order
                        </button>
                      )}
                      <RowMenu
                        label={`More for ${s.customerName}`}
                        items={[
                          { key: "details", label: "Details", icon: <Eye />, onSelect: () => setDetail(s) },
                          { key: "edit", label: "Edit", icon: <Pencil />, onSelect: () => setForm({ open: true, sub: s }), hidden: !canManage || (s.status !== "ACTIVE" && s.status !== "PAUSED") },
                          { key: "pause", label: "Pause", icon: <PauseCircle />, onSelect: () => setPausing(s), hidden: !canManage || s.status !== "ACTIVE" },
                          { key: "resume", label: busy === s.id ? "Resuming…" : "Resume", icon: <PlayCircle />, onSelect: () => resume(s), hidden: !canManage || s.status !== "PAUSED" },
                          { key: "end", label: "End subscription", icon: <XCircle />, onSelect: () => setEnding(s), danger: true, hidden: !canManage || (s.status !== "ACTIVE" && s.status !== "PAUSED") },
                        ]}
                      />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <SubscriptionForm open={form.open} subscription={form.sub} onClose={() => setForm({ open: false, sub: null })} onSaved={saved} />
      {detail && (
        <SubscriptionDetailModal
          isOpen
          subscription={detail}
          onClose={() => setDetail(null)}
          onEdit={(sub: TiffinSubscription) => {
            setDetail(null);
            setForm({ open: true, sub });
          }}
        />
      )}
      {pausing && (
        <PauseSubscriptionModal
          isOpen
          subscription={pausing}
          onClose={() => setPausing(null)}
          onSuccess={(_s: unknown, msg: string) => {
            setPausing(null);
            invalidateErpCache(["tiffin_subscriptions", "subscriptions"]);
            setNotice({ tone: "ok", text: msg });
          }}
        />
      )}
      {ending && (
        <CancelSubscriptionModal
          isOpen
          subscription={ending}
          onClose={() => setEnding(null)}
          onSuccess={(_s: unknown, msg: string) => {
            setEnding(null);
            invalidateErpCache(["tiffin_subscriptions", "subscriptions"]);
            setNotice({ tone: "ok", text: msg });
          }}
        />
      )}
    </div>
  );
}
