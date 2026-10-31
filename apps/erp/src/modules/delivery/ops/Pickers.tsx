"use client";

import React, { useEffect, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { addBusinessDays } from "@/lib/businessDate";

/*
 * Custom pickers for the delivery partner's app (no browser-default dropdowns): a day picker with a
 * small month calendar and an option menu. On phones the panel spans the control row (its nearest
 * positioned parent); from `sm` up it opens under its own button.
 */

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away);
    window.addEventListener("touchstart", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("touchstart", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const PANEL = "rn-enter absolute z-30 top-full mt-2 left-0 right-0 sm:right-auto rounded-2xl bg-white border border-[#ECE6DB] shadow-[0_12px_32px_rgba(31,35,32,0.14)] p-2";
const TRIGGER =
  "rn-press h-11 rounded-full bg-white border border-[#E2DBCE] inline-flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[14px] font-semibold whitespace-nowrap text-[#1F2320] outline-none focus-visible:ring-4 focus-visible:ring-[#C9501C]/20";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const monthLabel = (y: number, m: number) => new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m, 1)));
const shortLabel = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/** Day picker: Today / Yesterday shortcuts and a month calendar; future days and days older than `maxBack` are off. */
export function DayPicker({ value, today, onChange, maxBack = 90 }: { value: string; today: string; onChange: (d: string) => void; maxBack?: number }) {
  const { open, setOpen, ref } = usePopover();
  const min = addBusinessDays(today, -maxBack);
  const yesterday = addBusinessDays(today, -1);
  const [view, setView] = useState(() => ({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 }));
  useEffect(() => {
    if (open) setView({ y: Number(value.slice(0, 4)), m: Number(value.slice(5, 7)) - 1 });
  }, [open, value]);
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => ymd(new Date(Date.UTC(view.y, view.m, i + 1))))];
  const canPrev = ymd(new Date(Date.UTC(view.y, view.m, 0))) >= min;
  const canNext = ymd(new Date(Date.UTC(view.y, view.m + 1, 1))) <= today;
  const pick = (d: string) => {
    onChange(d);
    setOpen(false);
  };
  const label = value === today ? "Today" : value === yesterday ? "Yesterday" : shortLabel(value);

  return (
    <div ref={ref} className="sm:relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open} aria-label={`Day: ${label}`} className={`${TRIGGER} px-3 sm:pl-3.5`}>
        <CalendarDays className="w-4 h-4 text-[#C9501C] shrink-0" />
        {label}
        <ChevronDown className={`hidden sm:block w-3.5 h-3.5 text-[#6E7F70] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a day" className={`${PANEL} sm:w-[320px] p-3`}>
          <div className="flex gap-2 mb-3">
            {[
              { d: today, l: "Today" },
              { d: yesterday, l: "Yesterday" },
            ].map((x) => (
              <button key={x.l} type="button" onClick={() => pick(x.d)} className={`rn-press h-9 px-4 rounded-full text-[13px] font-semibold ${value === x.d ? "bg-[#C9501C] text-white" : "bg-[#EFEAE1] text-[#3E4540]"}`}>
                {x.l}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between mb-2">
            <button type="button" disabled={!canPrev} onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))} aria-label="Previous month" className="rn-press w-9 h-9 rounded-full flex items-center justify-center hover:bg-[#F4F0E8] disabled:opacity-30">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[14px] font-bold text-[#1F2320]">{monthLabel(view.y, view.m)}</span>
            <button type="button" disabled={!canNext} onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))} aria-label="Next month" className="rn-press w-9 h-9 rounded-full flex items-center justify-center hover:bg-[#F4F0E8] disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {["M", "T", "W", "T", "F", "S", "S"].map((w, i) => (
              <span key={i} className="text-[11px] font-semibold text-[#9AA59B] h-6 leading-6">
                {w}
              </span>
            ))}
            {cells.map((d, i) =>
              d ? (
                <button
                  key={d}
                  type="button"
                  disabled={d > today || d < min}
                  onClick={() => pick(d)}
                  aria-label={shortLabel(d)}
                  aria-pressed={d === value}
                  className={`rn-press h-9 rounded-full text-[13px] font-semibold disabled:text-[#CFC8BB] disabled:pointer-events-none ${
                    d === value ? "bg-[#C9501C] text-white" : d === today ? "text-[#C9501C] ring-1 ring-[#C9501C]/40" : "text-[#1F2320] hover:bg-[#F4F0E8]"
                  }`}
                >
                  {Number(d.slice(8))}
                </button>
              ) : (
                <span key={`e${i}`} />
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Option menu: a pill button that opens a list; the chosen option is ticked. */
export function OptionMenu<T extends string>({
  value,
  options,
  onChange,
  icon,
  label,
}: {
  value: T;
  options: Array<{ key: T; label: string; short?: string; count?: number }>;
  onChange: (v: T) => void;
  icon?: React.ReactNode;
  label: string;
}) {
  const { open, setOpen, ref } = usePopover();
  const current = options.find((o) => o.key === value) ?? options[0];
  return (
    <div ref={ref} className="relative shrink-0 ml-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        className={`${TRIGGER} ${value === options[0].key ? "w-11 justify-center sm:w-auto sm:px-3" : "px-3"} ${value !== options[0].key ? "border-[#C9501C]/50 bg-[#FCE9DD]/60" : ""}`}
      >
        {icon}
        {/* Nothing chosen: just the icon on phones; a choice shows its name and count. */}
        <span className={value === options[0].key ? "hidden sm:inline" : ""}>{current.short ?? current.label}</span>
        {value !== options[0].key && current.count !== undefined && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-[#EFEAE1] text-[11px] font-bold text-[#3E4540] flex items-center justify-center">{current.count}</span>}
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="rn-enter absolute z-30 right-0 top-full mt-1.5 w-48 rounded-2xl bg-white border border-[#ECE6DB] shadow-[0_12px_32px_rgba(31,35,32,0.14)] p-1">
          {options.map((o) => {
            const on = o.key === value;
            return (
              <li key={o.key} role="option" aria-selected={on}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.key);
                    setOpen(false);
                  }}
                  className={`w-full h-9 px-2.5 rounded-xl flex items-center gap-2 text-[13px] text-left ${on ? "bg-[#FCE9DD] text-[#B4440F] font-semibold" : "text-[#1F2320] hover:bg-[#F4F0E8]"}`}
                >
                  <span className="w-4 shrink-0">{on && <Check className="w-3.5 h-3.5" />}</span>
                  <span className="flex-1">{o.label}</span>
                  {o.count !== undefined && <span className={`text-[12px] tabular-nums ${on ? "text-[#B4440F]" : "text-[#6E7F70]"}`}>{o.count}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
