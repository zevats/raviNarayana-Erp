"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatNumberIN, formatMoney } from "@/lib/format";

/**
 * Dashboard charts (reference composition: soft bar chart with one hatched highlight and a tooltip
 * pill; donut "breakdown" with the total in the centre). Real figures only; every chart has a
 * table view. Colours validated with the dataviz palette validator (light surface):
 *   single series #238A4E; categorical #238A4E #D08A1B #2F78C9 #D45A82 #7A63CF (+ grey "Other").
 */

const MARK = "#238A4E";
const PALE = "#CFE0D0";
const CATS = ["#238A4E", "#D08A1B", "#2F78C9", "#D45A82", "#7A63CF"];
const OTHER = "#9AA39A";
const rupees = (v: number) => formatMoney(v);
const compact = (v: number) => (v >= 100000 ? `₹${(v / 100000).toFixed(v >= 1000000 ? 0 : 1)}L` : v >= 1000 ? `₹${Math.round(v / 1000)}K` : `₹${v}`);

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex p-1 rounded-full bg-black/[0.04] text-[12px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`px-3.5 h-8 rounded-full transition-all duration-200 ${value === o.value ? "bg-white text-[var(--rn-ink)] font-semibold shadow-[0_4px_12px_-6px_rgba(0,0,0,0.25)]" : "text-[var(--rn-ink-3)] hover:text-[var(--rn-ink)]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CollectionsChart({
  daily,
  monthly,
}: {
  daily: Array<{ date: string; value: number }>;
  monthly: Array<{ month: string; label: string; collected: number }>;
}) {
  const [range, setRange] = useState<"30d" | "6m">("30d");
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const day = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const weekday = (d: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const data = useMemo(
    () =>
      range === "30d"
        ? daily.map((d, i) => ({ key: d.date, label: weekday(d.date), tick: i % 5 === 0 || i === daily.length - 1 ? day(d.date) : "", value: d.value }))
        : monthly.map((m) => ({ key: m.month, label: m.label, tick: m.label, value: m.collected })),
    [range, daily, monthly]
  );
  const max = Math.max(0, ...data.map((d) => d.value));
  const step = max <= 0 ? 1000 : Math.pow(10, Math.floor(Math.log10(max)));
  const top = max <= 0 ? 1000 : Math.ceil(max / step) * step;
  const peak = data.reduce((b, d, i) => (d.value > (data[b]?.value ?? -1) ? i : b), 0);
  const focus = hover ?? (max > 0 ? peak : null);
  const total = data.reduce((a, d) => a + d.value, 0);
  // The chart is drawn at the box's real size (it fills the card, however tall the card is) so
  // labels keep their size on phones and no empty band is left under the bars.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 688, h: 230 });
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width);
      const h = Math.round(e.contentRect.height);
      if (w > 0 && h > 0) setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = Math.max(120, size.h - 26);
  const W = Math.max(160, size.w - 48);
  const gap = W / Math.max(1, data.length);
  const bar = Math.min(24, Math.max(6, gap - 6));

  return (
    <section className="rn-glass rounded-[28px] p-5 sm:p-6 rn-rise rn-rise-2 min-w-0 h-full flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">Money received</h2>
          <p className="text-[12.5px] text-[var(--rn-ink-3)] mt-0.5">
            <span className="tabular-nums text-[var(--rn-ink-2)]">{rupees(total)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented value={range} onChange={(v) => { setRange(v); setHover(null); }} options={[{ value: "30d", label: "30 days" }, { value: "6m", label: "6 months" }]} />
          <button type="button" onClick={() => setTable((t) => !t)} className="h-8 px-3 rounded-full text-[12px] text-[var(--rn-ink-3)] hover:text-[var(--rn-ink)] hover:bg-black/[0.04]">
            {table ? "Chart" : "Table"}
          </button>
        </div>
      </div>

      <div ref={box} className="mt-4 flex-1 min-h-[220px] relative">
      <div className="absolute inset-0">
      {max <= 0 ? (
        <p className="h-full grid place-items-center text-[13px] text-[var(--rn-ink-3)]">No money received in this period yet.</p>
      ) : table ? (
        <div className="h-full overflow-y-auto overscroll-contain -mx-1 px-1">
          <table className="w-full text-[13px] border-separate border-spacing-0">
            <thead className="sticky top-0 bg-[var(--rn-glass-5)]">
              <tr>
                <th scope="col" className="text-left font-medium text-[11px] uppercase tracking-[0.06em] text-[var(--rn-ink-3)] pb-2 border-b border-[var(--rn-line)]">{range === "30d" ? "Day" : "Month"}</th>
                <th scope="col" className="text-right font-medium text-[11px] uppercase tracking-[0.06em] text-[var(--rn-ink-3)] pb-2 border-b border-[var(--rn-line)]">Received</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key}>
                  <td className="py-2 border-b border-[var(--rn-line)] text-[var(--rn-ink-2)]">{d.label}</td>
                  <td className={`py-2 border-b border-[var(--rn-line)] text-right tabular-nums ${d.value > 0 ? "text-[var(--rn-ink)]" : "text-[var(--rn-ink-3)]"}`}>{d.value > 0 ? rupees(d.value) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-[var(--rn-glass-5)]">
              <tr>
                <td className="pt-2.5 font-semibold text-[var(--rn-ink)]">Total</td>
                <td className="pt-2.5 text-right font-semibold tabular-nums text-[var(--rn-ink)]">{rupees(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="relative h-full">
          <svg viewBox={`0 0 ${W + 48} ${H + 26}`} width={W + 48} height={H + 26} className="block w-full h-full" role="img" aria-label={`Money received; highest ${data[peak].label}: ${rupees(data[peak].value)}`}>
            <defs>
              <pattern id="rn-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={MARK} />
                <line x1="0" y1="0" x2="0" y2="6" stroke="rgba(255,255,255,0.28)" strokeWidth="2" />
              </pattern>
            </defs>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={48} x2={W + 48} y1={H - f * (H - 16)} y2={H - f * (H - 16)} stroke="rgba(26,46,32,0.10)" strokeDasharray={f === 0 ? undefined : "3 5"} />
                <text x={40} y={H - f * (H - 16) + 4} textAnchor="end" fontSize={11} fill="#6E7F70">{compact(Math.round(top * f))}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const h = d.value > 0 ? Math.max(3, (d.value / top) * (H - 16)) : 0;
              const x = 48 + i * gap + (gap - bar) / 2;
              const y = H - h;
              const r = Math.min(8, bar / 2, h);
              const isFocus = i === focus;
              return (
                <g key={d.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.label}: ${rupees(d.value)}`} className="outline-none cursor-default">
                  <rect x={48 + i * gap} y={0} width={gap} height={H + 20} fill="transparent" />
                  {h > 0 && (
                    <path
                      d={`M${x},${H} V${y + r} Q${x},${y} ${x + r},${y} H${x + bar - r} Q${x + bar},${y} ${x + bar},${y + r} V${H} Z`}
                      fill={isFocus ? "url(#rn-hatch)" : PALE}
                      style={{ transition: "fill 160ms linear" }}
                    />
                  )}
                  {d.tick && <text x={48 + i * gap + gap / 2} y={H + 18} textAnchor="middle" fontSize={11} fill="#6E7F70">{d.tick}</text>}
                </g>
              );
            })}
          </svg>
          {focus !== null && data[focus] && (
            <div
              className="rn-tooltip absolute -top-1 px-3 py-2 rounded-2xl text-[12px] pointer-events-none whitespace-nowrap"
              // Centred on its bar, but kept inside the card for the first and last bars (on a phone a
              // centred label on the last month stuck out past the screen edge).
              style={{ left: `${((48 + focus * gap + gap / 2) / (W + 48)) * 100}%`, transform: `translateX(${focus >= data.length - 1 ? "-100%" : focus === 0 ? "-12%" : "-50%"})` }}
              role="status"
            >
              <span className="flex items-center gap-1.5 font-semibold tabular-nums text-[var(--rn-ink)]">
                <span className="w-2 h-2 rounded-full" style={{ background: MARK }} />
                {rupees(data[focus].value)}
              </span>
              <span className="block text-[11px] text-[var(--rn-ink-3)]">{data[focus].label}</span>
            </div>
          )}
        </div>
      )}
      </div>
      </div>
    </section>
  );
}

export function ExpenseDonut({ items, total }: { items: Array<{ category: string; value: number }>; total: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const slices = useMemo(() => {
    const top = items.slice(0, 5).map((c, i) => ({ ...c, color: CATS[i] }));
    const rest = items.slice(5).reduce((a, c) => a + c.value, 0);
    return rest > 0 ? [...top, { category: "other", value: rest, color: OTHER }] : top;
  }, [items]);
  const R = 76;
  const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <section className="rn-glass rounded-[28px] p-5 sm:p-6 rn-rise rn-rise-3 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">Spending</h2>
        </div>
        {slices.length > 0 && (
          <button type="button" onClick={() => setTable((t) => !t)} className="h-8 px-3 rounded-full text-[12px] text-[var(--rn-ink-3)] hover:text-[var(--rn-ink)] hover:bg-black/[0.04]">
            {table ? "Chart" : "Table"}
          </button>
        )}
      </div>
      <div className="mt-4 min-h-[200px]">
      {slices.length === 0 ? (
        <p className="h-[200px] grid place-items-center text-[13px] text-[var(--rn-ink-3)]">No expenses recorded this month.</p>
      ) : table ? (
        <table className="w-full text-[13px]">
          <tbody>
            {slices.map((s) => (
              <tr key={s.category}>
                <td className="py-1.5 capitalize text-[var(--rn-ink-3)]">{s.category}</td>
                <td className="py-1.5 text-right tabular-nums">{rupees(s.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="grid grid-cols-[minmax(0,190px)_1fr] items-center gap-5">
          <svg viewBox="0 0 200 200" className="w-full max-w-[190px]" role="img" aria-label={`Expenses this month ${rupees(total)}`}>
            <g transform="rotate(-90 100 100)">
              {slices.map((s, i) => {
                const len = total > 0 ? (s.value / total) * C : 0;
                const dash = Math.max(0, len - 3);
                const el = (
                  <circle
                    key={s.category}
                    cx="100"
                    cy="100"
                    r={R}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={hover === i ? 32 : 28}
                    strokeDasharray={`${dash} ${C - dash}`}
                    strokeDashoffset={-acc}
                    style={{ transition: "stroke-width 160ms ease-out, opacity 160ms linear" }}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                );
                acc += len;
                return el;
              })}
            </g>
            <text x="100" y="96" textAnchor="middle" fontSize="20" fontWeight="600" fill="#1A2E20">{hover !== null ? rupees(slices[hover].value) : rupees(total)}</text>
            <text x="100" y="116" textAnchor="middle" fontSize="11" fill="#6E7F70">{hover !== null ? slices[hover].category : "in total"}</text>
          </svg>
          <ul className="space-y-2 min-w-0">
            {slices.map((s, i) => (
              <li key={s.category} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                <span className="capitalize text-[var(--rn-ink-2)] truncate flex-1">{s.category}</span>
                <span className="tabular-nums text-[var(--rn-ink)]">{rupees(s.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </section>
  );
}

/**
 * Delivery completion over the last 14 days as a line (share of scheduled stops delivered, 0-100%).
 * Days with no scheduled stops are gaps in the line, not 0%: nothing was due, so nothing failed.
 * Crosshair + tooltip on hover/focus; table view; one series, so no legend (the title names it).
 */
/** Smooth monotone cubic path through points sorted by x (no overshoot between points). */
function smoothPath(p: Array<{ x: number; y: number }>): string {
  if (p.length === 0) return "";
  if (p.length === 1) return `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}`;
  const n = p.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(p[i + 1].x - p[i].x);
    slope.push((p[i + 1].y - p[i].y) / (p[i + 1].x - p[i].x || 1));
  }
  const t: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) t.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  t.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) { const r = 3 / Math.sqrt(h); t[i] = r * a * slope[i]; t[i + 1] = r * b * slope[i]; }
  }
  let d = `M${p[0].x.toFixed(1)},${p[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = p[i].x + dx[i] / 3, c1y = p[i].y + (t[i] * dx[i]) / 3;
    const c2x = p[i + 1].x - dx[i] / 3, c2y = p[i + 1].y - (t[i + 1] * dx[i]) / 3;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p[i + 1].x.toFixed(1)},${p[i + 1].y.toFixed(1)}`;
  }
  return d;
}

export function CompletionTrend({ days }: { days: Array<{ date: string; value: number; delivered: number; total: number }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  // Text and markers keep their real pixel size however wide the card is (the SVG scales).
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setK(640 / Math.max(240, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const W = 640;
  const H = 150;
  const L = 34 + 18 * k;
  const T = 10;
  const label = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const longLabel = (d: string) => new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const step = (W - L - 8) / Math.max(1, days.length - 1);
  const x = (i: number) => L + i * step;
  const y = (pct: number) => T + (1 - pct / 100) * (H - T);
  const withStops = days.filter((d) => d.total > 0);
  const avg = withStops.length ? Math.round((withStops.reduce((a, d) => a + d.delivered, 0) / Math.max(1, withStops.reduce((a, d) => a + d.total, 0))) * 100) : null;
  // One continuous line through every day that had stops (days without stops are bridged), drawn
  // as a smooth monotone curve: it bends gently but never overshoots above 100% or below 0%.
  const pts = days.map((d, i) => (d.total > 0 ? { x: x(i), y: y(d.value) } : null)).filter((p): p is { x: number; y: number } => p !== null);
  const line = smoothPath(pts);
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z` : "";
  const h = hover !== null ? days[hover] : null;

  return (
    <section className="rn-glass rounded-[28px] p-5 sm:p-6 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">Deliveries completed</h2>
          <p className="text-[12.5px] text-[var(--rn-ink-3)] mt-0.5">
            Share of stops delivered, last 14 days{avg !== null && <> · <span className="tabular-nums text-[var(--rn-ink-2)]">{avg}% overall</span></>}
          </p>
        </div>
        {withStops.length > 0 && (
          <button type="button" onClick={() => setTable((t) => !t)} className="h-8 px-3 rounded-full text-[12px] text-[var(--rn-ink-3)] hover:text-[var(--rn-ink)] hover:bg-black/[0.04]">
            {table ? "Chart" : "Table"}
          </button>
        )}
      </div>
      <div className="mt-4 h-[190px]">
        {withStops.length === 0 ? (
          <p className="h-full grid place-items-center text-[13px] text-[var(--rn-ink-3)]">No deliveries scheduled in the last 14 days.</p>
        ) : table ? (
          <div className="h-full overflow-y-auto overscroll-contain">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-[var(--rn-glass-5)]">
                <tr>
                  <th className="text-left font-medium text-[11px] uppercase tracking-[0.06em] text-[var(--rn-ink-3)] pb-2 border-b border-[var(--rn-line)]">Day</th>
                  <th className="text-right font-medium text-[11px] uppercase tracking-[0.06em] text-[var(--rn-ink-3)] pb-2 border-b border-[var(--rn-line)]">Delivered</th>
                  <th className="text-right font-medium text-[11px] uppercase tracking-[0.06em] text-[var(--rn-ink-3)] pb-2 border-b border-[var(--rn-line)]">Completion</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.date}>
                    <td className="py-1.5 border-b border-[var(--rn-line)] text-[var(--rn-ink-2)]">{longLabel(d.date)}</td>
                    <td className="py-1.5 border-b border-[var(--rn-line)] text-right tabular-nums">{d.total > 0 ? `${d.delivered}/${d.total}` : "—"}</td>
                    <td className="py-1.5 border-b border-[var(--rn-line)] text-right tabular-nums">{d.total > 0 ? `${d.value}%` : <span className="text-[var(--rn-ink-3)]">no stops</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div ref={box} className="relative h-full" onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H + 24 * k}`} className="w-full h-full" role="img" aria-label={`Delivery completion over 14 days${avg !== null ? `, ${avg}% overall` : ""}`}>
              {[0, 50, 100].map((p) => (
                <g key={p}>
                  <line x1={L} x2={W - 4} y1={y(p)} y2={y(p)} stroke="rgba(26,46,32,0.10)" strokeDasharray={p === 0 ? undefined : "3 5"} />
                  <text x={L - 8} y={y(p) + 4} textAnchor="end" fontSize={11 * k} fill="#6E7F70">{p}%</text>
                </g>
              ))}
              {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={H} stroke="rgba(26,46,32,0.22)" />}
              <defs>
                <linearGradient id="rn-done-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={MARK} stopOpacity="0.16" />
                  <stop offset="100%" stopColor={MARK} stopOpacity="0" />
                </linearGradient>
              </defs>
              {area && <path d={area} fill="url(#rn-done-fill)" stroke="none" />}
              {pts.length > 1 && <path d={line} fill="none" stroke={MARK} strokeWidth={2.25 * k} strokeLinejoin="round" strokeLinecap="round" />}
              {days.map((d, i) =>
                d.total > 0 ? (
                  <circle key={d.date} cx={x(i)} cy={y(d.value)} r={(hover === i ? 5 : 3.5) * k} fill={MARK} stroke="#fff" strokeWidth={2 * k} />
                ) : null
              )}
              {days.map((d, i) => {
                // Every 3rd (6th when narrow) day and the last one, without crowding the last label.
                const every = k > 1.6 ? 6 : 3;
                const last = days.length - 1;
                const show = i === last || (i % every === 0 && last - i >= Math.ceil(every / 1.5));
                return show && (
                <text key={`t-${d.date}`} x={x(i)} y={H + 18 * k} textAnchor={i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"} fontSize={11 * k} fill="#6E7F70">{label(d.date)}</text>
                );
              })}
              {days.map((d, i) => (
                <rect
                  key={`h-${d.date}`}
                  x={x(i) - step / 2}
                  y={0}
                  width={step}
                  height={H + 24 * k}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${longLabel(d.date)}: ${d.total > 0 ? `${d.delivered} of ${d.total} stops delivered, ${d.value}%` : "no stops"}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                />
              ))}
            </svg>
            {h && hover !== null && (
              <div
                className="rn-tooltip absolute top-0 px-3 py-2 rounded-2xl text-[12px] pointer-events-none whitespace-nowrap"
                style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > days.length - 4 ? "-100%" : hover < 3 ? "0" : "-50%"})` }}
                role="status"
              >
                <span className="block font-semibold tabular-nums text-[var(--rn-ink)]">{h.total > 0 ? `${h.value}%` : "No stops"}</span>
                <span className="block text-[11px] text-[var(--rn-ink-3)]">{longLabel(h.date)}{h.total > 0 ? ` · ${h.delivered}/${h.total} delivered` : ""}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
