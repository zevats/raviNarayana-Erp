"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, ArrowRight } from "lucide-react";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { businessToday, businessMonthStart } from "@/lib/businessDate";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { Segmented, SearchField, EmptyState } from "@/components/ui/kit";
import { formatNumberIN } from "@/lib/format";

interface ReportInfo { key: string; title: string; description: string; divisions: boolean }
interface Column { key: string; label: string; type: "text" | "date" | "money" | "number" | "percent" }
interface Report {
  key: string;
  title: string;
  description: string;
  from: string;
  to: string;
  columns: Column[];
  rows: Array<Record<string, string | number | null> & { _link?: string | null }>;
  totals: Record<string, number>;
  total: number;
}

const PAGE = 50;
const fmt = (v: unknown, type: Column["type"]) => {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "money") return `₹${formatNumberIN(Number(v))}`;
  if (type === "percent") return `${v}%`;
  if (type === "number") return formatNumberIN(Number(v));
  return String(v);
};

export function ReportsView() {
  const list = useErpQuery<{ reports: ReportInfo[] }>("/api/reports", async () => (await fetch("/api/reports", { cache: "no-store" })).json(), { ttl: 300000 });
  const reports = list.data?.reports ?? [];
  const [key, setKey] = useState<string>("");
  const [from, setFrom] = useState(businessMonthStart());
  const [to, setTo] = useState(businessToday());
  const [division, setDivision] = useState("COMBINED");
  const [search, setSearch] = useState("");
  // One request once typing pauses, not one per keystroke.
  const searchTerm = useDebouncedValue(search.trim());
  const [page, setPage] = useState(0);

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("report");
    if (k) setKey(k);
  }, []);
  useEffect(() => {
    if (!key && reports.length > 0) setKey(reports[0].key);
  }, [key, reports]);

  const info = reports.find((r) => r.key === key);
  const params = useMemo(() => {
    const p = new URLSearchParams({ key, from, to, limit: String(PAGE), offset: String(page * PAGE) });
    if (info?.divisions) p.set("division", division);
    if (searchTerm) p.set("search", searchTerm);
    return p;
  }, [key, from, to, division, searchTerm, page, info?.divisions]);
  const url = key ? `/api/reports?${params.toString()}` : null;
  const q = useErpQuery<{ report: Report }>(
    url,
    async () => {
      const res = await fetch(url as string, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not run the report.");
      return body;
    },
    { ttl: 15000, tags: ["finance", "delivery", "rooms", "residents"] }
  );
  const r = q.data?.report;
  const csvUrl = useMemo(() => {
    const p = new URLSearchParams(params);
    p.delete("limit");
    p.delete("offset");
    p.set("format", "csv");
    return `/api/reports?${p.toString()}`;
  }, [params]);
  const reset = () => setPage(0);

  if (list.isLoading && !list.data) return <div className="py-16 flex justify-center"><BikeLoader label="Loading reports" /></div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Reports" className="rn-card p-2 h-fit grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-0.5">
        {reports.map((rep) => (
          <button
            key={rep.key}
            type="button"
            onClick={() => { setKey(rep.key); reset(); }}
            aria-current={rep.key === key ? "page" : undefined}
            className={`w-full text-left px-3.5 py-2.5 rounded-full text-[13.5px] transition-colors ${rep.key === key ? "bg-[var(--rn-accent)] text-white font-semibold" : "text-[var(--rn-ink-2)] hover:bg-white/70"}`}
          >
            {rep.title}
          </button>
        ))}
      </nav>

      <section className="space-y-3 min-w-0">
        <div className="rn-card">
        <div className="p-4 sm:p-5 border-b border-[var(--rn-line)] space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[12.5px] text-[var(--rn-ink-3)] flex items-center gap-1.5">From <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); reset(); }} className="rn-input px-3 text-[12.5px]" /></label>
            <label className="text-[12.5px] text-[var(--rn-ink-3)] flex items-center gap-1.5">To <input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); reset(); }} className="rn-input px-3 text-[12.5px]" /></label>
            {info?.divisions && (
              <Segmented
                size="sm"
                label="Division"
                value={division}
                onChange={(d) => { setDivision(d); reset(); }}
                options={[{ value: "COMBINED", label: "All" }, { value: "PG", label: "PG" }, { value: "TIFFIN", label: "Tiffin" }]}
              />
            )}
            <SearchField value={search} onChange={(v) => { setSearch(v); reset(); }} label="Search report" className="flex-1" />
            <a href={csvUrl} className={`rn-btn ${!r || r.total === 0 ? "pointer-events-none opacity-40" : ""}`}>
              <Download /> Export CSV
            </a>
          </div>
        </div>

        {q.error && !q.data ? (
          <div role="alert" className="p-5 text-sm text-rose-900">{q.error.message}</div>
        ) : q.isLoading && !q.data ? (
          <div className="py-16 flex justify-center"><BikeLoader label="Running report" /></div>
        ) : r && r.total === 0 ? (
          <EmptyState
            title="Nothing for this period"
            action={
              <button
                type="button"
                className="rn-btn rn-btn-sm"
                onClick={() => {
                  const d = new Date(`${to}T00:00:00Z`);
                  d.setUTCDate(d.getUTCDate() - 90);
                  setFrom(d.toISOString().slice(0, 10));
                  reset();
                }}
              >
                Show the last 3 months
              </button>
            }
          />
        ) : r ? (
          <div>
            <table className="rn-table">
              <thead>
                <tr>
                  {r.columns.map((c) => (
                    <th key={c.key} className={c.type === "money" || c.type === "number" || c.type === "percent" ? "text-right" : ""}>{c.label}</th>
                  ))}
                  <th><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i} className="tabular-nums">
                    {r.columns.map((c) => (
                      <td key={c.key} className={c.type === "money" || c.type === "number" || c.type === "percent" ? "num" : ""}>
                        {fmt(row[c.key], c.type)}
                      </td>
                    ))}
                    <td className="text-right">
                      {row._link && (
                        <Link href={row._link} aria-label="Open the records" className="rn-btn rn-btn-sm rn-btn-icon"><ArrowRight className="w-4 h-4" /></Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {Object.keys(r.totals).length > 0 && (
                <tfoot>
                  <tr className="font-semibold tabular-nums">
                    {r.columns.map((c, i) => (
                      <td key={c.key} className={c.type === "money" || c.type === "number" ? "num" : ""}>
                        {i === 0 ? `Total (${r.total})` : c.key in r.totals ? fmt(r.totals[c.key], c.type) : ""}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ) : null}
        </div>

        {r && r.total > PAGE && (
          <div className="flex items-center justify-between text-xs text-[#5A6C5E]">
            <span>{page * PAGE + 1}–{Math.min(r.total, (page + 1) * PAGE)} / {r.total}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page === 0} onClick={() => setPage((x) => x - 1)} className="rn-btn rn-btn-sm">Previous</button>
              <button type="button" disabled={(page + 1) * PAGE >= r.total} onClick={() => setPage((x) => x + 1)} className="rn-btn rn-btn-sm">Next</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
