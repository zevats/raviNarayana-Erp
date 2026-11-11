"use client";

import React, { useMemo, useState } from "react";
import { CalendarDays, ChevronRight, ReceiptText, X } from "lucide-react";
import { billDay } from "@/lib/bills";
import type { BillSummary } from "@/lib/bills";
import { SearchField } from "@/components/ui/kit";
import { LoadError } from "@/components/ui/states";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { DueAccount, DuesList as DuesData, getJson, money } from "./api";
import { AccountSheet } from "./AccountSheet";
import { BillAllDialog, BillRow } from "./BillDialogs";
import { BillViewer } from "./BillViewer";

export type DuesScope = "ALL" | "CUSTOMER" | "RESIDENT";
type Who = "ALL" | "RESIDENT" | "CUSTOMER" | "INDIVIDUAL" | "CORPORATE";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** The dues of a scope, loaded once and shared by every screen that shows them. */
export function useDues(scope: DuesScope, enabled = true) {
  const url = `/api/finance/receivables?kind=${scope}&limit=500&sort=total`;
  return useErpQuery<DuesData>(enabled ? url : null, () => getJson<DuesData>(url), { tags: ["finance", "receivables", "delivery", "tiffin", "residents"], ttl: 15000 });
}

function Chips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; count?: number }>; label: string }) {
  return (
    <div className="rn-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} className="rn-chip">
          {o.label}
          {o.count !== undefined && <span className="rn-chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * Dues: everyone who owes, how much, and the total. Tap a person for their dues, a bill or a
 * payment. The same list serves tiffin customers (Individual / Corporate), PG residents and the
 * Finance section (everyone). "Bill all" makes one bill for each person shown.
 */
export function DuesList({ scope }: { scope: DuesScope }) {
  const canRecord = useHasPermission("finance.record");
  const list = useDues(scope);
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim().toLowerCase(), 120);
  const [who, setWho] = useState<Who>("ALL");
  const [open, setOpen] = useState<DueAccount | null>(null);
  const [billAll, setBillAll] = useState(false);

  const owing = useMemo(() => (list.data?.accounts ?? []).filter((a) => a.total > 0), [list.data]);
  const isCorporate = (a: DueAccount) => a.customerType === "CORPORATE";
  const byWho = (a: DueAccount, w: Who) =>
    w === "ALL" || (w === "RESIDENT" && a.kind === "RESIDENT") || (w === "CUSTOMER" && a.kind !== "RESIDENT") || (w === "CORPORATE" && a.kind !== "RESIDENT" && isCorporate(a)) || (w === "INDIVIDUAL" && a.kind !== "RESIDENT" && !isCorporate(a));
  const shown = useMemo(
    () =>
      owing
        .filter((a) => byWho(a, who))
        .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.phone || "").includes(q.replace(/\s+/g, "")) || (a.place || "").toLowerCase().includes(q)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [owing, who, q]
  );
  const total = shown.reduce((s, a) => s + a.total, 0);
  const count = (w: Who) => owing.filter((a) => byWho(a, w)).length;
  const chips: Array<{ value: Who; label: string; count?: number }> =
    scope === "CUSTOMER"
      ? [
          { value: "ALL", label: "All", count: count("ALL") },
          { value: "INDIVIDUAL", label: "Individual", count: count("INDIVIDUAL") },
          { value: "CORPORATE", label: "Corporate", count: count("CORPORATE") },
        ]
      : scope === "ALL"
        ? [
            { value: "ALL", label: "All", count: count("ALL") },
            { value: "RESIDENT", label: "Residents", count: count("RESIDENT") },
            { value: "CUSTOMER", label: "Tiffin customers", count: count("CUSTOMER") },
          ]
        : [];
  const label = scope === "RESIDENT" || who === "RESIDENT" ? "Residents" : who === "CORPORATE" ? "Corporate customers" : who === "INDIVIDUAL" ? "Individual customers" : scope === "CUSTOMER" || who === "CUSTOMER" ? "Tiffin customers" : "Everyone with dues";

  return (
    <div className="space-y-4 min-w-0">
      <div className="rn-dues-head">
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium uppercase tracking-[0.08em] text-white/75">Total due</p>
          <p className="mt-0.5 text-[30px] font-bold leading-none tabular-nums" data-testid="dues-total">{list.data ? money(total) : "—"}</p>
          <p className="mt-1.5 text-[13.5px] text-white/85">{list.data ? `${shown.length} ${shown.length === 1 ? "person" : "people"}` : " "}</p>
        </div>
        {canRecord && (
          <button type="button" className="rn-dues-billall" disabled={shown.length === 0} onClick={() => setBillAll(true)}>
            <ReceiptText /> Bill all
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        <SearchField value={search} onChange={setSearch} placeholder="Search name, phone or room" className="w-full" />
        {chips.length > 0 && <Chips label="Show" value={who} onChange={setWho} options={chips} />}
      </div>

      {!list.data ? (
        list.error ? (
          <LoadError title="Dues could not be loaded" message={list.error.message} onRetry={() => list.refetch()} />
        ) : (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="rn-skel block h-[68px] w-full rounded-2xl" />
            ))}
          </div>
        )
      ) : shown.length === 0 ? (
        <div className="rn-card px-5 py-12 text-center space-y-3" data-testid="dues-empty">
          <p className="text-[15px] text-[var(--rn-ink-2)]">{q || who !== "ALL" ? "No one matches." : "No one owes anything."}</p>
          {(q || who !== "ALL") && (
            <button
              type="button"
              className="rn-btn rn-btn-sm"
              onClick={() => {
                setSearch("");
                setWho("ALL");
              }}
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <ul className="rn-due-list" aria-label="Dues">
          {shown.map((a) => {
            const parts = [a.pg > 0 ? `Rent ${money(a.pg)}` : "", a.tiffin > 0 ? `Plan ${money(a.tiffin)}` : "", a.delivery > 0 ? `Orders ${money(a.delivery)}` : ""].filter(Boolean);
            return (
              <li key={a.accountKey}>
                <button type="button" className="rn-due-row" onClick={() => setOpen(a)} aria-label={`${a.name}, due ${money(a.total)}`}>
                  <span className="rn-due-avatar" aria-hidden>{initials(a.name)}</span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-[15px] font-semibold text-[var(--rn-ink)] truncate">{a.name}</span>
                    <span className="block text-[12.5px] text-[var(--rn-ink-2)] truncate">
                      {[a.kind === "RESIDENT" ? (a.place ? `Room ${a.place}` : "Resident") : a.phone, parts.length > 1 ? parts.join(" · ") : "", a.ageDays ? `${a.ageDays} day${a.ageDays === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-[16px] font-bold tabular-nums text-[#A3311D]">{money(a.total)}</span>
                  <ChevronRight className="shrink-0 w-4 h-4 text-[var(--rn-ink-3)]" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AccountSheet accountKey={open?.accountKey ?? null} preview={open ? { name: open.name, total: open.total } : null} onClose={() => setOpen(null)} />
      <BillAllDialog open={billAll} onClose={() => setBillAll(false)} accounts={shown} label={`${label} · ${shown.length}`} />
    </div>
  );
}

/** Finance → Bills: every bill kept on record, newest first. Tap one to see, save or share it. */
export function BillsList() {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 250);
  const [type, setType] = useState<"ALL" | "GST" | "NON_GST">("ALL");
  const [date, setDate] = useState("");
  const [limit, setLimit] = useState(40);
  const [open, setOpen] = useState<string | null>(null);
  const url = `/api/finance/bills?limit=${limit}${q ? `&q=${encodeURIComponent(q)}` : ""}${type !== "ALL" ? `&type=${type}` : ""}${date ? `&date=${date}` : ""}`;
  const list = useErpQuery<{ bills: BillSummary[]; total: number; amount: number }>(url, () => getJson(url), { tags: ["bills"], ttl: 15000 });
  const bills = list.data?.bills ?? [];
  return (
    <div className="space-y-4 min-w-0">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <SearchField value={search} onChange={setSearch} placeholder="Search name or bill no." className="flex-1 min-w-0" />
          <label className={`rn-date-chip ${date ? "is-set" : ""}`} title="Bill date">
            <CalendarDays aria-hidden />
            <span>{date ? billDay(date).replace(/ \d{4}$/, "") : "Date"}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Bill date" />
          </label>
          {date && (
            <button type="button" className="rn-btn rn-btn-icon rn-btn-sm shrink-0" onClick={() => setDate("")} aria-label="Any date">
              <X />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Chips
            label="Bill type"
            value={type}
            onChange={setType}
            options={[
              { value: "ALL", label: "All" },
              { value: "GST", label: "GST" },
              { value: "NON_GST", label: "Non-GST" },
            ]}
          />
          <span className="shrink-0 text-[13px] tabular-nums text-[var(--rn-ink-2)]" data-testid="bills-count">
            {list.data ? `${list.data.total} bill${list.data.total === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      </div>
      {!list.data ? (
        list.error ? (
          <LoadError message={list.error.message} onRetry={() => list.refetch()} />
        ) : (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="rn-skel block h-[62px] w-full rounded-2xl" />
            ))}
          </div>
        )
      ) : bills.length === 0 ? (
        <p className="rn-card px-5 py-12 text-center text-[15px] text-[var(--rn-ink-2)]">{q || date || type !== "ALL" ? "No bill matches." : "No bills yet."}</p>
      ) : (
        <>
          <ul className="rn-due-list" aria-label="Bills">
            {bills.map((b) => (
              <li key={b.id}>
                <BillRow bill={b} onOpen={() => setOpen(b.id)} />
              </li>
            ))}
          </ul>
          {list.data.total > bills.length && (
            <button type="button" className="rn-btn w-full" onClick={() => setLimit((l) => l + 40)}>
              Show more ({list.data.total - bills.length})
            </button>
          )}
        </>
      )}
      <BillViewer billId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
