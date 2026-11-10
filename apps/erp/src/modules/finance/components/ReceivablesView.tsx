"use client";

import { friendlyError } from "@/lib/friendlyError";
import { useTimedMessage } from "@/lib/useTimedMessage";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, AlertTriangle } from "lucide-react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { formatMoney } from "@/lib/format";
import { Segmented, Badge, SearchField } from "@/components/ui/kit";
import { Dialog } from "@/components/ui/Dialog";
import { LoadError, NoMatches, EmptyData } from "@/components/ui/states";
import { ReceivePaymentDialog } from "./ReceivePaymentDialog";
import { useHasPermission } from "@/components/auth/CurrentUserContext";

type Source = "ALL" | "PG" | "TIFFIN" | "DELIVERY";
type Bucket = "ALL" | "0_7" | "8_30" | "31_60" | "61_PLUS";

export interface ReceivableLine {
  source: "PG" | "TIFFIN" | "DELIVERY";
  accountKey: string;
  kind: "CHARGE" | "INVOICE" | "ORDER" | "UNALLOCATED" | "ADVANCE";
  refId: string;
  reference: string;
  description: string;
  date: string;
  dueDate: string | null;
  amount: number;
  paid: number;
  outstanding: number;
  status: "UNPAID" | "PARTIALLY_PAID" | "CREDIT";
  ageDays: number;
  paymentChoice: string | null;
  review: string | null;
  link: string;
}

interface Account {
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
  partiallyPaid: boolean;
  openItems: number;
  reviews: number;
  payLaterEnabled: boolean | null;
}

interface ListResponse {
  asOf: string;
  summary: {
    total: number;
    bySource: { PG: number; TIFFIN: number; DELIVERY: number };
    ageing: Record<Exclude<Bucket, "ALL">, number>;
    unallocatedCredit: number;
    accountsOwing: number;
    reviews: number;
  };
  accounts: Account[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE = 25;
const SOURCE_LABEL = { PG: "PG rent", TIFFIN: "Tiffin", DELIVERY: "Delivery" } as const;
const BUCKET_LABEL: Record<Exclude<Bucket, "ALL">, string> = { "0_7": "0–7 days", "8_30": "8–30 days", "31_60": "31–60 days", "61_PLUS": "Over 60 days" };
const CHOICE_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", PAY_LATER: "Pay Later" };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load.");
  return data as T;
}

const days = (n: number | null) => (n === null ? "" : `${n} day${n === 1 ? "" : "s"}`);

/**
 * Finance → Receivables: who owes what across PG rent, tiffin invoices and delivered orders. Read
 * from the source records on each request (server-side aggregation and paging); nothing here keeps
 * its own balance. Open an account for its balances, statement and "Receive payment".
 */
export function ReceivablesView({ initialReviewOnly = false }: { initialReviewOnly?: boolean }) {
  const [source, setSource] = useState<Source>("ALL");
  const [status, setStatus] = useState<"ALL" | "UNPAID" | "PARTIALLY_PAID">("ALL");
  const [bucket, setBucket] = useState<Bucket>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reviewOnly, setReviewOnly] = useState(initialReviewOnly);
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => setPage(0), [source, status, bucket, from, to, reviewOnly, q]);

  const url = useMemo(() => {
    const p = new URLSearchParams({ source, status, bucket, limit: String(PAGE), offset: String(page * PAGE) });
    if (q) p.set("q", q);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (reviewOnly) p.set("review", "1");
    return `/api/finance/receivables?${p.toString()}`;
  }, [source, status, bucket, from, to, reviewOnly, q, page]);

  const list = useErpQuery<ListResponse>(url, () => getJson<ListResponse>(url), { tags: ["finance", "receivables", "delivery", "tiffin"], ttl: 15000 });
  const data = list.data;
  const filtersOn = source !== "ALL" || status !== "ALL" || bucket !== "ALL" || Boolean(from) || Boolean(to) || reviewOnly || Boolean(q);
  const clear = () => {
    setSource("ALL");
    setStatus("ALL");
    setBucket("ALL");
    setFrom("");
    setTo("");
    setReviewOnly(false);
    setSearch("");
  };

  const s = data?.summary;
  const first = data ? data.offset + 1 : 0;
  const last = data ? Math.min(data.offset + data.accounts.length, data.total) : 0;

  return (
    <div className="space-y-5 min-w-0">
      {/* Summary: total, by source, ageing */}
      <section aria-label="Outstanding summary" className="rn-card p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total outstanding", value: s?.total, strong: true },
            { label: SOURCE_LABEL.PG, value: s?.bySource.PG },
            { label: SOURCE_LABEL.TIFFIN, value: s?.bySource.TIFFIN },
            { label: SOURCE_LABEL.DELIVERY, value: s?.bySource.DELIVERY },
          ].map((c) => (
            <div key={c.label} className="min-w-0">
              <p className="rn-t-label truncate">{c.label}</p>
              {s ? (
                <p className={`tabular-nums font-semibold break-words leading-tight ${c.strong ? "text-[clamp(1.15rem,4.5vw,1.6rem)] text-[var(--rn-ink)]" : "text-[clamp(1rem,3.8vw,1.25rem)] text-[var(--rn-ink)]"}`}>
                  {formatMoney(c.value ?? 0)}
                </p>
              ) : (
                <span className="rn-skel block h-6 w-24 rounded mt-1" />
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-[var(--rn-line)] pt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(Object.keys(BUCKET_LABEL) as Array<Exclude<Bucket, "ALL">>).map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={bucket === b}
              onClick={() => setBucket(bucket === b ? "ALL" : b)}
              className={`min-w-0 text-left rounded-xl px-3 py-2 border transition-colors ${bucket === b ? "border-[#1A2E20] bg-[#1A2E20]/[0.06]" : "border-[var(--rn-line)] hover:bg-black/[0.02]"}`}
            >
              <span className="block rn-t-meta truncate">{BUCKET_LABEL[b]}</span>
              <span className={`block tabular-nums font-semibold break-words ${b === "61_PLUS" && (s?.ageing[b] ?? 0) > 0 ? "text-[#9A3423]" : "text-[var(--rn-ink)]"}`}>
                {s ? formatMoney(s.ageing[b]) : "—"}
              </span>
            </button>
          ))}
        </div>
        {s && (s.unallocatedCredit !== 0 || s.reviews > 0) && (
          <div className="flex flex-wrap gap-2 text-[12.5px]">
            {s.unallocatedCredit !== 0 && (
              <span className="rn-t-meta">Advance paid: {formatMoney(s.unallocatedCredit)}</span>
            )}
            {s.reviews > 0 && (
              <button type="button" onClick={() => setReviewOnly(true)} className="inline-flex items-center gap-1.5 text-[#9A3423] font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" /> {s.reviews} unpaid deliver{s.reviews === 1 ? "y" : "ies"} to review
              </button>
            )}
          </div>
        )}
      </section>

      {/* Filters */}
      <section aria-label="Filters" className="rn-card p-4 sm:p-5 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <Segmented
            label="Source"
            value={source}
            onChange={setSource}
            options={[
              { value: "ALL", label: "All" },
              { value: "PG", label: "PG" },
              { value: "TIFFIN", label: "Tiffin" },
              { value: "DELIVERY", label: "Delivery" },
            ]}
          />
          <SearchField value={search} onChange={setSearch} placeholder="Search name, phone or room" label="Search accounts" className="lg:flex-1 min-w-0" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 rn-filter-row">
          <label className="min-w-0">
            <span className="rn-t-label block mb-1">Payment status</span>
            <AppSelect value={status} onChange={(e) => setStatus(e.target.value as any)} className="rn-input w-full">
              <option value="ALL">All</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIALLY_PAID">Partly paid</option>
            </AppSelect>
          </label>
          <label className="min-w-0">
            <span className="rn-t-label block mb-1">Ageing</span>
            <AppSelect value={bucket} onChange={(e) => setBucket(e.target.value as Bucket)} className="rn-input w-full">
              <option value="ALL">All ages</option>
              {(Object.keys(BUCKET_LABEL) as Array<Exclude<Bucket, "ALL">>).map((b) => (
                <option key={b} value={b}>{BUCKET_LABEL[b]}</option>
              ))}
            </AppSelect>
          </label>
          <label className="min-w-0">
            <span className="rn-t-label block mb-1">Outstanding since</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="rn-input w-full" aria-label="Outstanding since, from" />
          </label>
          <label className="min-w-0">
            <span className="rn-t-label block mb-1">Until</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="rn-input w-full" aria-label="Outstanding since, until" />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-[13px] text-[var(--rn-ink-2)]">
            <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} className="w-4 h-4" />
            Only unpaid deliveries to review
          </label>
          {filtersOn && (
            <button type="button" onClick={clear} className="rn-btn rn-btn-sm">
              Clear filters
            </button>
          )}
        </div>
      </section>

      {/* Accounts */}
      <section aria-label="Accounts" className="rn-card overflow-hidden">
        {list.error && !data ? (
          <div className="p-5">
            <LoadError message={list.error.message} onRetry={() => list.refetch()} title="Receivables could not be loaded" />
          </div>
        ) : !data ? (
          <div aria-busy="true" className="divide-y divide-[var(--rn-line)]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 sm:px-5 py-4 flex items-center gap-4">
                <span className="rn-skel block h-4 w-1/3 rounded" />
                <span className="rn-skel block h-4 w-16 rounded ml-auto" />
              </div>
            ))}
          </div>
        ) : data.accounts.length === 0 ? (
          <div className="p-5">{filtersOn ? <NoMatches onClear={clear} /> : <EmptyData title="Nothing outstanding" />}</div>
        ) : (
          <>
            {/* Phones: cards */}
            <ul className="md:hidden divide-y divide-[var(--rn-line)]">
              {data.accounts.map((a) => (
                <li key={a.accountKey}>
                  <button type="button" onClick={() => setOpen(a.accountKey)} className="w-full text-left px-4 py-3.5 space-y-1.5 min-w-0">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <span className="min-w-0">
                        <span className="block font-semibold text-[var(--rn-ink)] truncate" title={a.name}>{a.name}</span>
                        <span className="block rn-t-meta truncate">{[a.place, a.phone].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className={`shrink-0 tabular-nums font-semibold ${a.total > 0 ? "text-[var(--rn-ink)]" : "text-[#2F6B24]"}`}>{formatMoney(a.total)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[12px]">
                      {a.pg !== 0 && <Badge>PG {formatMoney(a.pg)}</Badge>}
                      {a.tiffin !== 0 && <Badge>Tiffin {formatMoney(a.tiffin)}</Badge>}
                      {a.delivery !== 0 && <Badge>Delivery {formatMoney(a.delivery)}</Badge>}
                      {a.oldestDate && <Badge tone={(a.ageDays ?? 0) > 60 ? "bad" : (a.ageDays ?? 0) > 30 ? "warn" : "neutral"}>{days(a.ageDays)}</Badge>}
                      {a.reviews > 0 && <Badge tone="bad">To review</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {/* Tablets and desktops: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="rn-table w-full table-fixed text-left">
                <colgroup>
                  <col className="w-[30%]" />
                  <col className="w-[13%]" />
                  <col className="w-[13%]" />
                  <col className="w-[13%]" />
                  <col className="w-[14%]" />
                  <col className="w-[17%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="text-right">PG</th>
                    <th className="text-right">Tiffin</th>
                    <th className="text-right">Delivery</th>
                    <th className="text-right">Total</th>
                    <th>Outstanding since</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.accountKey} onClick={() => setOpen(a.accountKey)} className="cursor-pointer hover:bg-black/[0.02]">
                      <td className="min-w-0">
                        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(a.accountKey); }} className="block w-full text-left min-w-0">
                          <span className="block font-semibold text-[var(--rn-ink)] truncate" title={a.name}>{a.name}</span>
                          <span className="block rn-t-meta truncate">
                            {a.kind === "RESIDENT" ? "Resident" : a.kind === "CUSTOMER" ? "Customer" : "Order without customer record"}
                            {a.place ? ` · ${a.place}` : ""}
                            {a.phone ? ` · ${a.phone}` : ""}
                          </span>
                          {(a.reviews > 0 || a.partiallyPaid || a.payLaterEnabled) && (
                            <span className="flex flex-wrap gap-1 mt-1">
                              {a.reviews > 0 && <Badge tone="bad">To review</Badge>}
                              {a.partiallyPaid && <Badge tone="warn">Partly paid</Badge>}
                              {a.payLaterEnabled && <Badge tone="info">Pay Later</Badge>}
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="text-right tabular-nums truncate">{a.pg ? formatMoney(a.pg) : "—"}</td>
                      <td className="text-right tabular-nums truncate">{a.tiffin ? formatMoney(a.tiffin) : "—"}</td>
                      <td className="text-right tabular-nums truncate">{a.delivery ? formatMoney(a.delivery) : "—"}</td>
                      <td className="text-right tabular-nums font-semibold truncate">{formatMoney(a.total)}</td>
                      <td className="truncate">
                        {a.oldestDate ? (
                          <span className={(a.ageDays ?? 0) > 60 ? "text-[#9A3423]" : ""}>
                            {a.oldestDate} <span className="rn-t-meta">· {days(a.ageDays)}</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-[var(--rn-line)]">
              <span className="rn-t-meta">
                {first}–{last} / {data.total}
                {list.isRevalidating ? " · updating…" : ""}
              </span>
              <div className="flex gap-2">
                <button type="button" className="rn-btn rn-btn-sm rn-btn-icon" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  <ChevronLeft />
                </button>
                <button type="button" className="rn-btn rn-btn-sm rn-btn-icon" aria-label="Next page" disabled={last >= data.total} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <AccountSheet accountKey={open} onClose={() => setOpen(null)} />
    </div>
  );
}

interface AccountResponse {
  account: { accountKey: string; kind: "RESIDENT" | "CUSTOMER" | "ORDER"; id: string; name: string; phone: string | null; place: string | null };
  asOf: string;
  totals: { PG: number; TIFFIN: number; DELIVERY: number; total: number };
  lines: ReceivableLine[];
}

interface StatementEntry {
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
  details?: Array<{ date: string; meal: string; boxes: number }>;
}

interface StatementResponse {
  statement: {
    from: string | null;
    to: string | null;
    opening: number;
    closing: number;
    totals: { charges: number; payments: number; adjustments: number };
    entries: StatementEntry[];
  };
}

/** One account: open balances, Pay Later (customers), statement, receive payment. */
export function AccountSheet({ accountKey, onClose }: { accountKey: string | null; onClose: () => void }) {
  const canRecord = useHasPermission("finance.record");
  const canManageDelivery = useHasPermission("delivery.manage");
  const [tab, setTab] = useState<"balances" | "statement">("balances");
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useTimedMessage<string>();
  useEffect(() => {
    setTab("balances");
    setNotice(null);
  }, [accountKey]);
  const key = accountKey ? `/api/finance/receivables/account?key=${encodeURIComponent(accountKey)}` : null;
  const acc = useErpQuery<AccountResponse>(key, () => getJson<AccountResponse>(key!), { tags: ["finance", "receivables", "delivery", "tiffin"], ttl: 5000 });
  const a = acc.data;
  const payable = (a?.lines ?? []).filter((l) => l.outstanding > 0);

  return (
    <Dialog open={Boolean(accountKey)} onClose={onClose} title={a?.account.name ?? "Account"} description={a ? [a.account.kind === "RESIDENT" ? "Resident" : a.account.kind === "CUSTOMER" ? "Customer" : "Order without customer record", a.account.place, a.account.phone].filter(Boolean).join(" · ") : undefined} size="lg">
      {!a ? (
        acc.error ? (
          <LoadError message={acc.error.message} onRetry={() => acc.refetch()} />
        ) : (
          <div className="space-y-3" aria-busy="true">
            <span className="rn-skel block h-6 w-1/2 rounded" />
            <span className="rn-skel block h-24 w-full rounded-xl" />
          </div>
        )
      ) : (
        <div className="space-y-4 min-w-0">
          {notice && <p role="status" className="rounded-xl bg-[#E6F1E3] text-[#2F6B24] text-[13px] px-3 py-2">{notice}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
            {/* Only the parts that apply: rent for a resident, plan bills and orders for a customer. */}
            {[
              { l: "Total", v: a.totals.total, show: true },
              { l: "PG rent", v: a.totals.PG, show: a.account.kind === "RESIDENT" || a.totals.PG !== 0 },
              { l: "Tiffin", v: a.totals.TIFFIN, show: a.account.kind !== "RESIDENT" || a.totals.TIFFIN !== 0 },
              { l: "Delivery", v: a.totals.DELIVERY, show: a.account.kind !== "RESIDENT" || a.totals.DELIVERY !== 0 },
            ].filter((c) => c.show).map((c) => (
              <div key={c.l} className="min-w-0 rounded-xl border border-[var(--rn-line)] px-3 py-2">
                <span className="block rn-t-meta">{c.l}</span>
                <span className="block tabular-nums font-semibold break-words">{formatMoney(c.v)}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented
              label="Account view"
              value={tab}
              onChange={setTab}
              size="sm"
              options={[
                { value: "balances", label: "Open balances" },
                { value: "statement", label: "Statement" },
              ]}
            />
            {canRecord && payable.length > 0 && (
              <button type="button" className="rn-btn rn-btn-primary rn-btn-sm" onClick={() => setPaying(true)}>
                Receive payment
              </button>
            )}
          </div>

          {tab === "balances" ? (
            <>
              {a.lines.length === 0 ? (
                <EmptyData title="Nothing outstanding" />
              ) : (
                <ul className="divide-y divide-[var(--rn-line)] rounded-xl border border-[var(--rn-line)]">
                  {a.lines.map((l) => (
                    <BalanceRow key={`${l.source}:${l.refId}`} line={l} canReview={canManageDelivery} onReviewed={(m) => { setNotice(m); invalidateErpCache(["receivables"]); acc.refetch(); }} />
                  ))}
                </ul>
              )}
            </>
          ) : (
            <Statement accountKey={a.account.accountKey} />
          )}
        </div>
      )}
      {a && (
        <ReceivePaymentDialog
          open={paying}
          onClose={() => setPaying(false)}
          accountKey={a.account.accountKey}
          accountName={a.account.name}
          lines={payable}
          onDone={(msg) => {
            setPaying(false);
            setNotice(msg);
            invalidateErpCache(["finance", "receivables", "delivery", "tiffin", "custody", "dashboard"]);
            acc.refetch();
          }}
        />
      )}
    </Dialog>
  );
}

function BalanceRow({ line: l, canReview, onReviewed }: { line: ReceivableLine; canReview: boolean; onReviewed: (msg: string) => void }) {
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const close = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(l.refId)}/payment-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not close the review.");
      onReviewed("Review closed. The balance stays outstanding until it is paid.");
    } catch (e: any) {
      setError(friendlyError(e.message));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <li className="px-3 py-3 space-y-1.5 min-w-0">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-[var(--rn-ink)] truncate" title={l.reference}>
            {l.source === "PG" ? "Rent" : l.source === "TIFFIN" ? (l.kind === "UNALLOCATED" ? "Unallocated payment" : `Invoice ${l.reference}`) : l.kind === "ADVANCE" ? `Advance paid · ${l.date}` : `Order · ${l.reference}`}
          </p>
          <p className="rn-t-meta truncate" title={l.description}>
            {l.date}
            {l.dueDate ? ` · due ${l.dueDate}` : ""}
            {l.kind !== "UNALLOCATED" && l.kind !== "ADVANCE" ? ` · ${l.ageDays} day${l.ageDays === 1 ? "" : "s"}` : ""}
            {l.paymentChoice ? ` · ${CHOICE_LABEL[l.paymentChoice] ?? l.paymentChoice}` : ""}
            {l.source === "PG" && l.reference !== "Rent charge" ? ` · ${l.reference}` : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className={`tabular-nums font-semibold ${l.outstanding < 0 ? "text-[#2F6B24]" : "text-[var(--rn-ink)]"}`}>{formatMoney(l.outstanding)}</p>
          {l.paid > 0 && <p className="rn-t-meta tabular-nums">of {formatMoney(l.amount)}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {l.status === "PARTIALLY_PAID" && <Badge tone="warn">Partly paid</Badge>}
        {l.review && <Badge tone="bad">Pay Later not approved</Badge>}
        <Link href={l.link} className="inline-flex items-center gap-1 text-[12px] text-[var(--rn-ink-2)] hover:underline">
          Open source <ExternalLink className="w-3 h-3" />
        </Link>
        {l.review && canReview && !reviewing && (
          <button type="button" className="rn-btn rn-btn-sm" onClick={() => setReviewing(true)}>
            Mark reviewed
          </button>
        )}
      </div>
      {reviewing && (
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was decided (e.g. customer will pay Friday)" className="rn-input" aria-label="Review note" />
          <button type="button" className="rn-btn rn-btn-primary rn-btn-sm" disabled={busy || note.trim().length < 3} onClick={close}>
            {busy ? "Saving…" : "Close review"}
          </button>
          {error && <p role="alert" className="col-span-2 text-[12px] text-[#9A3423]">{error}</p>}
        </div>
      )}
    </li>
  );
}

function Statement({ accountKey }: { accountKey: string }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openDetails, setOpenDetails] = useState<number | null>(null);
  const url = `/api/finance/receivables/statement?${new URLSearchParams({ key: accountKey, ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString()}`;
  const st = useErpQuery<StatementResponse>(url, () => getJson<StatementResponse>(url), { tags: ["finance", "receivables", "delivery", "tiffin"], ttl: 5000 });
  const s = st.data?.statement;
  return (
    <div className="space-y-3 min-w-0">
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0">
          <span className="rn-t-label block mb-1">From</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="rn-input w-full" aria-label="Statement from" />
        </label>
        <label className="min-w-0">
          <span className="rn-t-label block mb-1">To</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="rn-input w-full" aria-label="Statement to" />
        </label>
      </div>
      {!s ? (
        st.error ? (
          <LoadError message={st.error.message} onRetry={() => st.refetch()} />
        ) : (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => <span key={i} className="rn-skel block h-10 w-full rounded-lg" />)}
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <div className="rounded-xl border border-[var(--rn-line)] px-3 py-2 min-w-0">
              <span className="block rn-t-meta">Opening balance{s.from ? ` (${s.from})` : ""}</span>
              <span className="block tabular-nums font-semibold">{formatMoney(s.opening)}</span>
            </div>
            <div className="rounded-xl border border-[var(--rn-line)] px-3 py-2 min-w-0">
              <span className="block rn-t-meta">Closing balance{s.to ? ` (${s.to})` : ""}</span>
              <span className="block tabular-nums font-semibold">{formatMoney(s.closing)}</span>
            </div>
          </div>
          {s.entries.length === 0 ? (
            <EmptyData title="No entries in this period" />
          ) : (
            <ol className="divide-y divide-[var(--rn-line)] rounded-xl border border-[var(--rn-line)]" aria-label="Statement entries">
              {s.entries.map((e, i) => {
                const amount = e.charge - e.payment + e.adjustment;
                return (
                  <li key={i} className="px-3 py-2.5 min-w-0">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-[var(--rn-ink)] truncate">
                          {e.type}
                          {e.reversedLater && <span className="ml-1.5 text-[11px] font-medium text-[#8F6710]">(reversed later)</span>}
                        </p>
                        <p className="rn-t-meta truncate" title={e.description}>
                          {e.date} · {e.source === "PG" ? "PG" : e.source === "TIFFIN" ? "Tiffin" : "Delivery"}
                          {e.reference ? ` · ${e.reference}` : ""}
                          {e.method ? ` · ${e.method}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`tabular-nums text-[13px] font-semibold ${amount < 0 ? "text-[#2F6B24]" : "text-[var(--rn-ink)]"}`}>{formatMoney(amount, { signed: true })}</p>
                        <p className="rn-t-meta tabular-nums">bal. {formatMoney(e.balance)}</p>
                      </div>
                    </div>
                    {e.details && e.details.length > 0 && (
                      <div className="mt-1.5">
                        <button type="button" className="text-[12px] text-[var(--rn-ink-2)] underline" onClick={() => setOpenDetails(openDetails === i ? null : i)} aria-expanded={openDetails === i}>
                          {openDetails === i ? "Hide" : "Show"} {e.details.length} delivered meal{e.details.length === 1 ? "" : "s"}
                        </button>
                        {openDetails === i && (
                          <ul className="mt-1.5 grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-0.5 text-[12px] text-[var(--rn-ink-2)]">
                            {e.details.map((d, j) => (
                              <li key={j} className="tabular-nums">
                                {d.date} · {d.meal.charAt(0)}{d.meal.slice(1).toLowerCase()} · {d.boxes}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          <p className="rn-t-meta">
            Charges {formatMoney(s.totals.charges)} · payments {formatMoney(s.totals.payments)}
            {s.totals.adjustments !== 0 ? ` · reversals ${formatMoney(s.totals.adjustments, { signed: true })}` : ""}
          </p>
        </>
      )}
    </div>
  );
}
