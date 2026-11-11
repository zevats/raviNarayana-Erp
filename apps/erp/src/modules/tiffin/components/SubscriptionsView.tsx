"use client";

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Plus, ShoppingBag, Eye, Pencil, PlayCircle, XCircle, Wallet } from "lucide-react";
import type { TiffinSubscription } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { Card, StatStrip, SearchField, Badge } from "@/components/ui/kit";
import { FilterMenu } from "@/components/ui/FilterMenu";
import { LoadError, SkeletonRows } from "@/components/ui/states";
import { RowMenu } from "@/components/ui/RowMenu";
import { toast } from "@/components/ui/toast";
import { businessToday } from "@/lib/businessDate";
import { planMealsLabel } from "@/lib/planMeals";
import { useDues } from "@/modules/billing/DuesList";
import { AccountSheet } from "@/modules/billing/AccountSheet";
import { send } from "@/modules/billing/api";
import { SubscriptionForm } from "./SubscriptionForm";

const SubscriptionDetailModal = dynamic(() => import("./modals/SubscriptionDetailModal").then((m) => m.SubscriptionDetailModal), { ssr: false });
const CancelSubscriptionModal = dynamic(() => import("./modals/CancelSubscriptionModal").then((m) => m.CancelSubscriptionModal), { ssr: false });

type Filter = "ACTIVE" | "ENDED" | "ALL";
type Sub = TiffinSubscription & { productBillingUnit?: string | null };
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const day = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
const running = (s: Sub) => s.status === "ACTIVE" || s.status === "PAUSED";
const monthly = (s: Sub) => s.productBillingUnit === "PER_MONTH" || (!s.productBillingUnit && s.productCategory === "SUBSCRIPTION_PACKAGE");
const endedOn = (s: Sub) => (s.cancelledAt || s.endDate || s.updatedAt || "").slice(0, 10);

/** Ended plans stay on this page for two months, then drop off the list (the record is kept). */
function twoMonthsAgo(): string {
  const [y, m, d] = businessToday().split("-").map(Number);
  return new Date(Date.UTC(y, m - 3, d)).toISOString().slice(0, 10);
}

/**
 * Subscriptions (Tiffin customers → Subscriptions): who is on which monthly plan and what they owe
 * on it. A plan owes its monthly price from the day each month starts; nothing is billed by hand
 * and no delivery is made unless an order is taken (Take order).
 */
export function SubscriptionsView() {
  const router = useRouter();
  const canManage = useHasPermission("tiffin.manage");
  const canSeeMoney = useHasPermission("finance.read");
  const [filter, setFilter] = useState<Filter>("ACTIVE");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ open: boolean; sub: TiffinSubscription | null }>({ open: false, sub: null });
  const [detail, setDetail] = useState<TiffinSubscription | null>(null);
  const [ending, setEnding] = useState<TiffinSubscription | null>(null);
  const [account, setAccount] = useState<{ key: string; name: string; total: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useErpQuery<Sub[]>(
    "subs-view:/api/tiffin/subscriptions",
    async () => {
      const r = await fetch("/api/tiffin/subscriptions?limit=200", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not load subscriptions.");
      return Array.isArray(d.subscriptions) ? d.subscriptions : [];
    },
    { ttl: 20000, tags: ["tiffin_subscriptions", "subscriptions"] }
  );
  // What each plan customer owes on the plan (Owner and Manager).
  const dues = useDues("CUSTOMER", canSeeMoney);
  const dueOf = useMemo(() => {
    const m = new Map<string, { plan: number; total: number }>();
    for (const a of dues.data?.accounts ?? []) m.set(a.accountKey, { plan: a.tiffin, total: a.total });
    return m;
  }, [dues.data]);

  const cutoff = twoMonthsAgo();
  const all = useMemo(() => (q.data ?? []).filter((s) => running(s) || endedOn(s) >= cutoff), [q.data, cutoff]);
  const counts = useMemo(
    () => ({ ACTIVE: all.filter(running).length, ENDED: all.filter((s) => !running(s)).length, ALL: all.length }),
    [all]
  );
  const monthlyValue = all.filter((s) => running(s) && monthly(s)).reduce((a, s) => a + (s.price || 0), 0);
  const planDue = all.filter(running).reduce((a, s) => a + Math.max(0, dueOf.get(`C:${s.customerId}`)?.plan ?? 0), 0);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all
      .filter((x) => filter === "ALL" || (filter === "ENDED" ? !running(x) : running(x)))
      .filter((x) => !s || (x.customerName || "").toLowerCase().includes(s) || (x.customerPhone || "").includes(s) || (x.productName || "").toLowerCase().includes(s))
      .sort((a, b) => Number(running(b)) - Number(running(a)) || (a.customerName || "").localeCompare(b.customerName || ""));
  }, [all, filter, search]);

  const resume = async (s: TiffinSubscription) => {
    setBusy(s.id);
    try {
      await send(`/api/tiffin/subscriptions/${s.id}/resume`, {});
      invalidateErpCache(["tiffin_subscriptions", "subscriptions"]);
      toast.ok(`${s.customerName}'s plan is running again.`);
    } catch (e: any) {
      toast.error(e?.message || "Could not resume.");
    } finally {
      setBusy(null);
    }
  };
  const saved = (text: string) => {
    setForm({ open: false, sub: null });
    toast.ok(text);
  };

  return (
    <div className="space-y-5 min-w-0">
      <div className="flex flex-col lg:flex-row lg:items-stretch gap-3 min-w-0">
        <StatStrip
          className="flex-1 min-w-0"
          items={[
            { label: "Active plans", value: counts.ACTIVE, tone: "good" },
            ...(canSeeMoney
              ? [
                  { label: "Monthly value", value: rupees(monthlyValue) },
                  { label: "Due on plans", value: rupees(planDue), tone: (planDue ? "bad" : "good") as "bad" | "good" },
                ]
              : []),
          ]}
        />
        {canManage && (
          <button type="button" onClick={() => setForm({ open: true, sub: null })} className="rn-btn rn-btn-primary h-12 lg:h-auto lg:px-7 shrink-0">
            <Plus /> New subscription
          </button>
        )}
      </div>

      <Card flush>
        <div className="flex items-center gap-2.5 p-4 sm:p-5 border-b border-[var(--rn-line)]">
          <SearchField value={search} onChange={setSearch} placeholder="Search customer, phone or plan" className="flex-1 min-w-0" />
          <FilterMenu
            label="Show"
            value={filter}
            onChange={setFilter}
            defaultValue="ACTIVE"
            options={[
              { value: "ACTIVE", label: "Active", count: counts.ACTIVE },
              { value: "ENDED", label: "Ended", count: counts.ENDED },
              { value: "ALL", label: "All", count: counts.ALL },
            ]}
          />
        </div>

        {q.isLoading && !q.data ? (
          <div className="p-4 sm:p-5"><SkeletonRows rows={5} /></div>
        ) : q.error && !q.data ? (
          <div className="p-4 sm:p-5"><LoadError message={q.error.message} onRetry={() => q.refetch()} /></div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center px-5 py-14 text-center" data-testid="subs-empty">
            <p className="text-[15px] text-[var(--rn-ink-2)]">
              {search.trim() ? "No subscription matches." : filter === "ACTIVE" ? "No active subscriptions." : filter === "ENDED" ? "No plan ended in the last two months." : "No subscriptions yet."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--rn-line)]" aria-label="Subscriptions">
            {rows.map((s) => {
              const live = running(s);
              const key = `C:${s.customerId}`;
              const due = dueOf.get(key);
              const planOwed = Math.max(0, due?.plan ?? 0);
              return (
                <li key={s.id} data-sub-id={s.id} className="flex items-center gap-3 px-4 sm:px-5 py-3.5 min-w-0">
                  <div className="min-w-0 flex-1 lg:flex lg:items-center lg:gap-4">
                    <div className="min-w-0 lg:w-[30%]">
                      <p className="text-[15.5px] font-semibold text-[var(--rn-ink)] truncate">{s.customerName}</p>
                      <p className="text-[13px] text-[var(--rn-ink-2)] tabular-nums truncate">{s.customerPhone}</p>
                    </div>
                    <div className="min-w-0 lg:flex-1 max-lg:mt-1">
                      <p className="text-[14px] text-[var(--rn-ink)] truncate">
                        <span className="font-medium">{s.productName}</span>
                        {canSeeMoney && <span className="text-[var(--rn-ink-2)]"> · {rupees(s.price)} {monthly(s) ? "a month" : "a thali"}</span>}
                      </p>
                      <p className="text-[13px] text-[var(--rn-ink-2)] truncate">
                        {planMealsLabel(s.mealTypes)} · {live ? `since ${day(s.startDate)}` : `ended ${day(endedOn(s) || s.startDate)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 max-lg:mt-2 lg:justify-end">
                      {s.status === "PAUSED" ? <Badge tone="warn">Paused</Badge> : live ? <Badge tone="good">Active</Badge> : <Badge>Ended</Badge>}
                      {canSeeMoney && dues.data && ((live && monthly(s)) || planOwed > 0) && (
                        planOwed > 0 ? (
                          <button type="button" onClick={() => setAccount({ key, name: s.customerName || "", total: due?.total ?? planOwed })} className="rn-press" aria-label={`${s.customerName} owes ${rupees(planOwed)} on the plan`}>
                            <Badge tone="bad">Due {rupees(planOwed)}</Badge>
                          </button>
                        ) : (
                          <Badge tone="good">Paid</Badge>
                        )
                      )}
                      {live && canManage && (
                        <button type="button" onClick={() => router.push(`/orders?take=${encodeURIComponent(s.id)}`)} className="rn-btn rn-btn-sm" aria-label={`Take an order for ${s.customerName}`}>
                          <ShoppingBag /> Take order
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 self-center">
                    <RowMenu
                      label={`More for ${s.customerName}`}
                      items={[
                        { key: "details", label: "Details", icon: <Eye />, onSelect: () => setDetail(s) },
                        { key: "dues", label: "Dues, bill and payment", icon: <Wallet />, onSelect: () => setAccount({ key, name: s.customerName || "", total: due?.total ?? 0 }), hidden: !canSeeMoney },
                        { key: "edit", label: "Edit", icon: <Pencil />, onSelect: () => setForm({ open: true, sub: s }), hidden: !canManage || !live },
                        { key: "resume", label: busy === s.id ? "Resuming…" : "Resume", icon: <PlayCircle />, onSelect: () => resume(s), hidden: !canManage || s.status !== "PAUSED" },
                        { key: "end", label: "End subscription", icon: <XCircle />, onSelect: () => setEnding(s), danger: true, hidden: !canManage || !live },
                      ]}
                    />
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
      {ending && (
        <CancelSubscriptionModal
          isOpen
          subscription={ending}
          onClose={() => setEnding(null)}
          onSuccess={(_s: unknown, msg: string) => {
            setEnding(null);
            invalidateErpCache(["tiffin_subscriptions", "subscriptions"]);
            toast.ok(msg);
          }}
        />
      )}
      <AccountSheet accountKey={account?.key ?? null} preview={account ? { name: account.name, total: account.total } : null} onClose={() => setAccount(null)} />
    </div>
  );
}
