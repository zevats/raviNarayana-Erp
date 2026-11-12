"use client";

import { DetailsList } from "@/components/ui/DetailsList";
import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { SelectMenu } from "@/components/forms/SelectMenu";
import { SearchField, EmptyState, Badge } from "@/components/ui/kit";
import { FullPageLoader } from "@/components/feedback/FullPageLoader";
import { formatDateTime } from "@/lib/format";
import { CheckCircle2, Ban, SlidersHorizontal } from "lucide-react";
import { MButton, MChips, MEmpty, MGroup, MRow, MSearch, MSection, MSheet, MSkeletonRows, MStack, PhoneOrDesktop, groupByDay, useIsPhone } from "@/components/app/m";

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
  { value: "rooms", label: "Rooms" },
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const phone = useIsPhone();

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

  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const filterCount = [area, actorId, from || to].filter(Boolean).length;
  const mobile = (
    <MStack>
      <MSearch value={search} onChange={(v) => { setSearch(v); reset(); }} placeholder="Search action, record or person" onFilter={() => setFiltersOpen(true)} filterCount={filterCount} />
      {q.error && !q.data ? (
        <MEmpty title="Could not load the activity log" />
      ) : q.isLoading && !q.data ? (
        <MSkeletonRows rows={6} />
      ) : entries.length === 0 ? (
        <MEmpty title="No activity matches" />
      ) : (
        groupByDay(entries, (e) => dayOf(e.at)).map((d) => (
          <MSection key={d.day} title={<span className="m-day">{d.label}</span>}>
            <MGroup>
              {d.items.map((e) => (
                <MRow
                  key={e.id}
                  icon={e.outcome === "REFUSED" ? Ban : CheckCircle2}
                  tone={e.outcome === "REFUSED" ? "red" : "green"}
                  title={<span className="first-letter:uppercase inline-block">{readable(e.action)}</span>}
                  sub={[e.actorName, recordLabel(e.targetType, e.targetId)].join(" · ")}
                  rightSub={new Date(e.at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
                  onClick={() => setOpen(e)}
                  chevron={false}
                />
              ))}
            </MGroup>
          </MSection>
        ))
      )}
      {total > PAGE && (
        <div className="m-btn-row">
          <MButton kind="soft" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</MButton>
          <MButton kind="soft" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Older</MButton>
        </div>
      )}
      <MSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        tall
        footer={
          <>
            <MButton kind="soft" onClick={() => { setArea(""); setActorId(""); setFrom(""); setTo(""); reset(); }}>Clear</MButton>
            <MButton kind="primary" onClick={() => setFiltersOpen(false)}>Done</MButton>
          </>
        }
      >
        <p className="m-sheet-label">Area</p>
        <MChips label="Area" value={area} onChange={(v) => { setArea(v); reset(); }} options={AREAS.map((x) => ({ value: x.value, label: x.value ? x.label : "All" }))} />
        <p className="m-sheet-label">Person</p>
        <MChips label="Person" value={actorId} onChange={(v) => { setActorId(v); reset(); }} options={[{ value: "", label: "Everyone" }, ...(options.data?.people ?? []).map((p) => ({ value: p.id, label: p.fullName }))]} />
        <p className="m-sheet-label">Dates</p>
        <div className="grid grid-cols-2 gap-2.5">
          <input type="date" className="m-input" aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} />
          <input type="date" className="m-input" aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} />
        </div>
      </MSheet>
    </MStack>
  );

  return (
    <div className="space-y-4">
      <PhoneOrDesktop
        phone={phone}
        mobile={mobile}
        desktop={
          <div className="space-y-4">
      <div className="rn-card rn-mflat">
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
        <FullPageLoader label="Loading activity" size="md" />
      ) : entries.length === 0 ? (
        <EmptyState title="No activity matches these filters" />
      ) : (
          <table className="rn-table rn-mcards">
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
                  <td data-m="line" className="tabular-nums text-[var(--rn-ink-3)]">{when(e.at)}</td>
                  <td data-m="line" className="text-[var(--rn-ink)]">{e.actorName}</td>
                  <td data-m="title"><span className="hidden lg:inline text-[11px] uppercase tracking-wide text-[var(--rn-ink-3)] mr-1.5">{e.area}</span><span className="inline-block first-letter:uppercase">{readable(e.action)}</span></td>
                  <td data-m="line" className="text-[12px] text-[var(--rn-ink-3)]">{recordLabel(e.targetType, e.targetId)}</td>
                  <td data-m="badge">
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

          </div>
        }
      />
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
