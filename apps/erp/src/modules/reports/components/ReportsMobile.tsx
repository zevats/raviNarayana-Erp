"use client";

/**
 * Reports on the phone app: pick a report, see its period and totals at a glance, search its rows,
 * open a row. The period (and PG / Tiffin) sit behind the calendar button on the card.
 */

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, Download, FileBarChart } from "lucide-react";
import { MButton, MChips, MEmpty, MField, MGroup, MHero, MRow, MSearch, MSheet, MSkeletonRows, MStack, dayLabel } from "@/components/app/m";
import { businessMonthStart, businessToday } from "@/lib/businessDate";

interface ReportInfo { key: string; title: string; description: string; divisions: boolean }
interface Column { key: string; label: string; type: "text" | "date" | "money" | "number" | "percent" }
interface Report {
  key: string;
  title: string;
  from: string;
  to: string;
  columns: Column[];
  rows: Array<Record<string, string | number | null> & { _link?: string | null }>;
  totals: Record<string, number>;
  total: number;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ReportsMobile({
  reports,
  current,
  onPick,
  report,
  loading,
  error,
  from,
  to,
  setRange,
  division,
  setDivision,
  search,
  setSearch,
  csvUrl,
  page,
  pageSize,
  setPage,
  fmt,
}: {
  reports: ReportInfo[];
  current: ReportInfo | undefined;
  onPick: (key: string) => void;
  report: Report | undefined;
  loading: boolean;
  error: string | null;
  from: string;
  to: string;
  setRange: (from: string, to: string) => void;
  division: string;
  setDivision: (d: string) => void;
  search: string;
  setSearch: (v: string) => void;
  csvUrl: string;
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  fmt: (v: unknown, type: Column["type"]) => string;
}) {
  const router = useRouter();
  const [pickOpen, setPickOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [rowOpen, setRowOpen] = useState<number | null>(null);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const today = businessToday();
  const monthStart = businessMonthStart();
  const lastMonth = (() => {
    const d = new Date(`${monthStart}T00:00:00`);
    const end = new Date(d);
    end.setDate(0);
    const start = new Date(end.getFullYear(), end.getMonth(), 1);
    return [iso(start), iso(end)] as const;
  })();
  const thirty = (() => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - 29);
    return iso(d);
  })();
  const period = from === monthStart && to === today ? "MONTH" : from === lastMonth[0] && to === lastMonth[1] ? "LAST" : from === thirty && to === today ? "30" : "CUSTOM";
  const periodText = period === "MONTH" ? "This month" : period === "LAST" ? "Last month" : period === "30" ? "Last 30 days" : `${dayLabel(from)} – ${dayLabel(to)}`;

  const money = report?.columns.filter((c) => c.type === "money" && c.key in (report?.totals ?? {})) ?? [];
  const firstMoney = report?.columns.find((c) => c.type === "money");
  const cols = report?.columns ?? [];
  const sub = (row: Record<string, unknown>) =>
    cols
      .slice(1)
      .filter((c) => c !== firstMoney)
      .slice(0, 2)
      .map((c) => fmt(row[c.key], c.type))
      .filter((x) => x && x !== "—")
      .join(" · ");
  const open = rowOpen !== null && report ? report.rows[rowOpen] : null;

  return (
    <MStack>
      <button type="button" onClick={() => setPickOpen(true)} className="m-card m-press flex items-center gap-3 text-left w-full">
        <span className="m-ico m-tone-accent" aria-hidden>
          <FileBarChart className="w-[18px] h-[18px]" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block m-row-sub">Report</span>
          <span className="block m-row-title">{current?.title ?? "Choose a report"}</span>
        </span>
        <ChevronDown className="w-5 h-5 text-[#8A968D]" />
      </button>

      <MHero
        label={<>{periodText}{current?.divisions && division !== "COMBINED" ? ` · ${division === "PG" ? "PG" : "Tiffin"}` : ""}</>}
        value={loading && !report ? "—" : report ? (money[0] ? fmt(report.totals[money[0].key], "money") : `${report.total} ${report.total === 1 ? "entry" : "entries"}`) : "—"}
        note={report && money[0] ? `${money[0].label} · ${report.total} ${report.total === 1 ? "entry" : "entries"}` : undefined}
        action={
          <button
            type="button"
            aria-label="Choose the period"
            className="m-hero-icon m-press"
            onClick={() => {
              setF(from);
              setT(to);
              setPeriodOpen(true);
            }}
          >
            <CalendarDays className="w-[18px] h-[18px]" />
          </button>
        }
        items={money.slice(1, 5).map((c) => ({ label: c.label, value: fmt(report!.totals[c.key], "money") }))}
      />

      <MSearch value={search} onChange={setSearch} placeholder="Search this report" />

      {error && !report ? (
        <MEmpty title="Could not run the report" />
      ) : loading && !report ? (
        <MSkeletonRows rows={6} />
      ) : !report || report.total === 0 ? (
        <MEmpty icon={FileBarChart} title="Nothing for this period">
          <MButton kind="soft" onClick={() => setRange(thirty, today)}>
            Show the last 30 days
          </MButton>
        </MEmpty>
      ) : (
        <>
          <MGroup>
            {report.rows.map((row, i) => (
              <MRow
                key={i}
                title={fmt(row[cols[0]?.key], cols[0]?.type ?? "text")}
                sub={sub(row)}
                right={firstMoney ? fmt(row[firstMoney.key], "money") : undefined}
                onClick={() => (row._link ? router.push(row._link) : setRowOpen(i))}
                chevron={Boolean(row._link)}
              />
            ))}
          </MGroup>
          {report.total > pageSize && (
            <div className="m-btn-row">
              <MButton kind="soft" disabled={page === 0} onClick={() => setPage(page - 1)}>
                Previous
              </MButton>
              <MButton kind="soft" disabled={(page + 1) * pageSize >= report.total} onClick={() => setPage(page + 1)}>
                Next
              </MButton>
            </div>
          )}
          <MButton kind="soft" icon={Download} href={csvUrl} className="w-full">
            Download (CSV)
          </MButton>
        </>
      )}

      <MSheet open={pickOpen} onClose={() => setPickOpen(false)} title="Reports" tall>
        <MGroup>
          {reports.map((r) => (
            <MRow
              key={r.key}
              icon={FileBarChart}
              tone={r.key === current?.key ? "accent" : "neutral"}
              title={r.title}
              rightSub={r.key === current?.key ? "Showing" : undefined}
              chevron={false}
              onClick={() => {
                setPickOpen(false);
                onPick(r.key);
              }}
            />
          ))}
        </MGroup>
      </MSheet>

      <MSheet
        open={periodOpen}
        onClose={() => setPeriodOpen(false)}
        title="Period"
        footer={
          <MButton
            kind="primary"
            disabled={!f || !t || f > t}
            onClick={() => {
              setRange(f, t);
              setPeriodOpen(false);
            }}
          >
            Show
          </MButton>
        }
      >
        <MChips
          label="Period"
          value={period}
          onChange={(p) => {
            const [a, b] = p === "MONTH" ? [monthStart, today] : p === "LAST" ? [lastMonth[0], lastMonth[1]] : p === "30" ? [thirty, today] : [f, t];
            setF(a);
            setT(b);
            if (p !== "CUSTOM") {
              setRange(a, b);
              setPeriodOpen(false);
            }
          }}
          options={[
            { value: "MONTH", label: "This month" },
            { value: "LAST", label: "Last month" },
            { value: "30", label: "Last 30 days" },
            { value: "CUSTOM", label: "Dates" },
          ]}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <input type="date" className="m-input" aria-label="From" value={f} max={t || undefined} onChange={(e) => setF(e.target.value)} />
          <input type="date" className="m-input" aria-label="To" value={t} min={f || undefined} onChange={(e) => setT(e.target.value)} />
        </div>
        {current?.divisions && (
          <>
            <p className="m-sheet-label">Part of the business</p>
            <MChips label="Part of the business" value={division} onChange={setDivision} options={[{ value: "COMBINED", label: "All" }, { value: "PG", label: "PG" }, { value: "TIFFIN", label: "Tiffin" }]} />
          </>
        )}
      </MSheet>

      <MSheet open={Boolean(open)} onClose={() => setRowOpen(null)} title={open ? fmt(open[cols[0]?.key], cols[0]?.type ?? "text") : ""}>
        {open && (
          <div className="m-card py-1">
            {cols.slice(1).map((c) => (
              <MField key={c.key} label={c.label}>
                {fmt(open[c.key], c.type)}
              </MField>
            ))}
          </div>
        )}
      </MSheet>
    </MStack>
  );
}
