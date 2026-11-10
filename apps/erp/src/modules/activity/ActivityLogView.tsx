"use client";

import { DetailsList } from "@/components/ui/DetailsList";
import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { SelectMenu } from "@/components/forms/SelectMenu";
import { SearchField, EmptyState, Badge } from "@/components/ui/kit";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { formatDateTime } from "@/lib/format";

interface Entry {
  id: string;
  at: string;
  actorName: string;
  action: string;
  area: string;
  targetType: string;
  targetId: string | null;
  outcome: "DONE" | "REFUSED";
  details: Record<string, unknown> | null;
  ipAddress: string | null;
}

const AREAS: Array<{ value: string; label: string }> = [
  { value: "", label: "All areas" },
  { value: "auth", label: "Sign-in & access" },
  { value: "account", label: "Own account" },
  { value: "staff", label: "Staff" },
  { value: "settings", label: "Settings" },
  { value: "resident", label: "Residents" },
  { value: "room", label: "Rooms" },
  { value: "rooms", label: "Beds & maintenance" },
  { value: "finance", label: "Finance" },
  { value: "orders", label: "Orders" },
  { value: "delivery", label: "Delivery" },
  { value: "tiffin", label: "Tiffin" },
  { value: "document", label: "Documents" },
];

const PAGE = 50;
const when = (iso: string) => formatDateTime(iso, "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
/** "tiffin_customer" + "cust_37ec…" → "Tiffin customer #37EC57". */
const recordLabel = (type?: string | null, id?: string | null) => {
  const kind = (type || "").replace(/[_.]/g, " ").trim();
  const name = kind ? kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase() : "";
  const short = id ? `#${String(id).replace(/^[a-z]{2,6}_/, "").replace(/-/g, "").slice(0, 6).toUpperCase()}` : "";
  return [name, short].filter(Boolean).join(" ") || "—";
};
const readable = (action: string) => action.split(".").slice(1).join(" ").replace(/_/g, " ") || action;

export function ActivityLogView() {
  const [area, setArea] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  // One request once typing pauses, not one per keystroke.
  const searchTerm = useDebouncedValue(search.trim());
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Entry | null>(null);

  const options = useErpQuery<{ people: Array<{ id: string; fullName: string }> }>(
    "/api/activity?options=1",
    async () => (await fetch("/api/activity?options=1", { cache: "no-store" })).json(),
    { ttl: 60000, tags: ["activity"] }
  );
  const key = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE) });
    if (area) p.set("area", area);
    if (actorId) p.set("actorId", actorId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (searchTerm) p.set("search", searchTerm);
    return `/api/activity?${p.toString()}`;
  }, [area, actorId, from, to, searchTerm, page]);
  const q = useErpQuery<{ entries: Entry[]; total: number }>(
    key,
    async () => {
      const res = await fetch(key, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load the activity log.");
      return body;
    },
    { ttl: 10000, tags: ["activity"] }
  );
  const reset = () => setPage(0);
  const entries = q.data?.entries ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="rn-card">
      <div className="p-4 sm:p-5 border-b border-[var(--rn-line)] grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <SearchField value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder="Search action, record or person" className="lg:col-span-2" />
        <div className="rn-filter-row sm:contents">
        <SelectMenu label="Area" tone="forest" value={area} onChange={(v) => { setArea(v); reset(); }} options={AREAS} triggerClassName="bg-white border border-[#8E9F89]/40 text-[#1A2E20]" />
        <SelectMenu
          label="Person"
          tone="forest"
          value={actorId}
          onChange={(v) => { setActorId(v); reset(); }}
          options={[{ value: "", label: "Everyone" }, ...(options.data?.people ?? []).map((p) => ({ value: p.id, label: p.fullName }))]}
          triggerClassName="bg-white border border-[#8E9F89]/40 text-[#1A2E20]"
        />
        <div className="grid grid-cols-2 gap-2">
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} aria-label="From" className="rn-input min-w-0 px-3 text-[12.5px]" />
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} aria-label="To" className="rn-input min-w-0 px-3 text-[12.5px]" />
        </div>
        </div>
      </div>

      {q.error && !q.data ? (
        <div role="alert" className="p-5 text-sm text-rose-900">{q.error.message}</div>
      ) : q.isLoading && !q.data ? (
        <div className="py-16 flex justify-center"><BikeLoader label="Loading activity" /></div>
      ) : entries.length === 0 ? (
        <EmptyState title="No activity matches these filters" />
      ) : (
          <table className="rn-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Record</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} onClick={() => setOpen(e)} className="cursor-pointer">
                  <td className="tabular-nums text-[var(--rn-ink-3)]">{when(e.at)}</td>
                  <td className="text-[var(--rn-ink)]">{e.actorName}</td>
                  <td><span className="text-[11px] uppercase tracking-wide text-[var(--rn-ink-3)] mr-1.5">{e.area}</span>{readable(e.action)}</td>
                  <td className="text-[12px] text-[var(--rn-ink-3)]">{recordLabel(e.targetType, e.targetId)}</td>
                  <td>
                    <Badge tone={e.outcome === "REFUSED" ? "bad" : "good"}>{e.outcome === "REFUSED" ? "Refused" : "Done"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      )}
      </div>

      {total > PAGE && (
        <div className="flex items-center justify-between text-xs text-[#5A6C5E]">
          <span>{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} / {total}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rn-btn rn-btn-sm">Newer</button>
            <button type="button" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)} className="rn-btn rn-btn-sm">Older</button>
          </div>
        </div>
      )}

      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="activity-detail" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 rn-modal-scrim">
          <div className="rn-modal bg-white rounded-2xl max-w-lg w-full p-5 space-y-3 max-h-[85dvh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <h2 id="activity-detail" className="text-base font-bold text-[#1A2E20]">{readable(open.action)}</h2>
              <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="p-1 rounded-lg text-[#5A6C5E] hover:bg-[#FAF8F5]"><X className="w-5 h-5" /></button>
            </div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
              <dt className="text-[#8E9F89]">When</dt><dd>{when(open.at)}</dd>
              <dt className="text-[#8E9F89]">Who</dt><dd>{open.actorName}</dd>
              <dt className="text-[#8E9F89]">Record</dt><dd className="break-all">{recordLabel(open.targetType, open.targetId)}</dd>
              {open.ipAddress && (<><dt className="text-[#8E9F89]">Address</dt><dd className="font-mono">{open.ipAddress}</dd></>)}
            </dl>
            {open.details && (
              <DetailsList data={open.details} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
