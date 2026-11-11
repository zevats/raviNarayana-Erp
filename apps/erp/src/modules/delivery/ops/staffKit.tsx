"use client";

import { greetingName } from "@/lib/names";
import React from "react";
import { WifiOff } from "lucide-react";
import type { DeliveryTask, MealType } from "@/types";
import { BikeLoader, BikeGraphic } from "@/components/feedback/BikeLoader";
import { FullPageLoader, useFillHeight } from "@/components/feedback/FullPageLoader";

/*
 * Visual kit for the delivery partner's app (My Stops, My Cash, History), following the
 * approved Stitch designs (orange accent):
 *   accent (active tab, primary button)  → #C9501C (hover #A9400F)
 *   accent text / eyebrows               → #B4440F on tint #FCE9DD
 *   success → #2F6B24 on #DDF1D6 · danger → #9A3423 on #FBE3DD
 */
export const K = {
  card: "bg-white rounded-2xl border border-[#ECE6DB] shadow-[0_1px_2px_rgba(26,26,26,0.04)]",
  soft: "bg-[#F4F0E8] rounded-xl",
  eyebrow: "text-[11px] font-bold uppercase tracking-[0.08em] text-[#5A6C5E]",
  primaryBtn:
    "rn-press inline-flex items-center justify-center gap-2 rounded-full bg-[#C9501C] text-white font-semibold hover:bg-[#A9400F] disabled:opacity-50 transition-colors",
  greyBtn:
    "rn-press inline-flex items-center justify-center gap-2 rounded-full bg-[#EFEAE1] text-[#1F2320] font-semibold hover:bg-[#E6E0D4] disabled:opacity-50 transition-colors",
};

export const PILL = {
  success: "bg-[#DDF1D6] text-[#2F6B24]",
  accent: "bg-[#FCE9DD] text-[#B4440F]",
  danger: "bg-[#FBE3DD] text-[#9A3423]",
  grey: "bg-[#EFEAE1] text-[#3E4540]",
  info: "bg-[#E6EEF3] text-[#1E587A]",
};

export function Pill({ tone, children, className = "", mono = false }: { tone: keyof typeof PILL; children: React.ReactNode; className?: string; mono?: boolean }) {
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${mono ? "font-mono tracking-wide" : ""} ${PILL[tone]} ${className}`}>{children}</span>;
}

/** Short reference of a record (last characters of its id), as the token chip in the designs. */
export const token = (id: string) => `#${id.replace(/[^a-zA-Z0-9]/g, "").slice(-3).toUpperCase()}`;

/**
 * Stop numbers: each stop's place in the day's run for that meal (floor, room, then name), over the
 * whole list — never the position in a filtered view, so a number does not change with filters.
 */
export function stopNumbers(tasks: DeliveryTask[]): Map<string, number> {
  const name = (t: DeliveryTask) => (t.orderType === "RESIDENT" ? t.residentName : t.customerName) || "";
  const sorted = tasks
    .filter((t) => t.status !== "CANCELLED")
    .sort((a, b) => (a.floor ?? 99) - (b.floor ?? 99) || String(a.roomNumber ?? "~").localeCompare(String(b.roomNumber ?? "~")) || name(a).localeCompare(name(b)) || a.createdAt.localeCompare(b.createdAt));
  return new Map(sorted.map((t, i) => [t.id, i + 1]));
}

export const two = (n: number | undefined) => (n === undefined ? "—" : String(n).padStart(2, "0"));

/**
 * Lunch / Dinner switch used on every delivery-partner screen: a full-width two-part switch on
 * phones, a pill switch with stop counts on wider screens. A count shows only once it has loaded.
 */
export function MealToggle({ value, onChange, counts, compact = false, stretch = false }: { value: MealType; onChange: (m: MealType) => void; counts?: Partial<Record<MealType, number | undefined>>; compact?: boolean; stretch?: boolean }) {
  const meals: MealType[] = ["BREAKFAST", "LUNCH", "DINNER"];
  const label = (m: MealType) => (m === "BREAKFAST" ? "Breakfast" : m === "LUNCH" ? "Lunch" : "Dinner");
  if (compact) {
    // Same look as the full switch, sized to share one row with other controls.
    return (
      <div role="radiogroup" aria-label="Meal" className={`${stretch ? "grid grid-cols-3 w-full sm:inline-flex sm:w-auto" : "inline-flex"} items-center p-1 rounded-full bg-[#EFEAE1]/80 shrink-0`}>
        {meals.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={value === m} onClick={() => onChange(m)} className={`rn-press h-9 px-3 sm:px-4 rounded-full flex items-center justify-center text-[13px] font-semibold transition-colors ${value === m ? "bg-[#C9501C] text-white shadow-sm" : "text-[#3E4540]"}`}>
            {label(m)}
            {counts?.[m] !== undefined && <span className={`hidden sm:inline ml-1.5 text-[11px] ${value === m ? "text-white/80" : "text-[#6E7F70]"}`}>{counts[m]}</span>}
          </button>
        ))}
      </div>
    );
  }
  return (
    <>
      {/* Phones: full-width pill track, chosen meal in solid orange, stop count as a round badge. */}
      <div role="radiogroup" aria-label="Meal" className="md:hidden grid grid-cols-3 w-full p-1 rounded-full bg-[#EFEAE1]">
        {meals.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={value === m} onClick={() => onChange(m)} className={`rn-press h-11 min-w-0 px-1 rounded-full text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${value === m ? "bg-[#C9501C] text-white shadow-[0_2px_8px_rgba(201,80,28,0.28)]" : "text-[#3E4540]"}`}>
            {label(m)}
            {counts && <CountBadge on={value === m} n={counts[m]} />}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Meal" className="hidden md:inline-flex items-center p-1 rounded-full bg-[#EFEAE1]/80">
        {meals.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={value === m} onClick={() => onChange(m)} className={`rn-press flex items-center gap-2 h-11 px-5 rounded-full text-sm font-semibold transition-colors ${value === m ? "bg-[#C9501C] text-white shadow-sm" : "text-[#3E4540] hover:text-[#1F2320]"}`}>
            {label(m)}
            {counts && <CountBadge on={value === m} n={counts[m]} />}
          </button>
        ))}
      </div>
    </>
  );
}

/** Stop count inside a meal switch: white-on-orange when chosen, grey-on-white otherwise. */
function CountBadge({ on, n }: { on: boolean; n: number | undefined }) {
  // Until the count has loaded, the badge keeps its place (no jump when the number arrives).
  if (n === undefined) return <span aria-hidden="true" className={`w-[22px] h-[22px] rounded-full animate-pulse ${on ? "bg-white/25" : "bg-white/70"}`} />;
  return <span className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-[12px] font-bold tabular-nums flex items-center justify-center ${on ? "bg-white/25 text-white" : "bg-white text-[#5A6C5E]"}`}>{n}</span>;
}

/** Filter chips: they wrap onto a second line instead of scrolling sideways. */
export function FilterChips<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ key: T; label: string; dot?: boolean }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => {
        const on = value === it.key;
        return (
          <button key={it.key} type="button" onClick={() => onChange(it.key)} aria-pressed={on} className={`rn-press inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-[13px] font-semibold transition-colors ${on ? "bg-[#1F2320] text-white" : "bg-[#EFEAE1] text-[#3E4540] hover:bg-[#E6E0D4]"}`}>
            {it.label}
            {it.dot && <span className="w-1.5 h-1.5 rounded-full bg-[#C9501C]" />}
          </button>
        );
      })}
    </div>
  );
}

/** Loading stage for a delivery screen: the riding scooter, never half-loaded figures. */
export function PageLoader({ label }: { label: string }) {
  // Fills the visible area down to the tab bar, so the scooter sits in its middle.
  return <FullPageLoader label={label} tone="orange" size="md" />;
}

/** Nothing to show: a small parked scooter, a short title and (optionally) what it refers to. */
export function EmptyState({ title, detail, compact = false }: { title: string; detail?: string; compact?: boolean }) {
  if (compact) {
    // Secondary sections: one short row, so a page of empty sections stays light.
    return (
      <div className={`${K.card} px-4 py-3.5 flex items-center gap-3`}>
        <span className="rn-bike-still opacity-70 shrink-0">
          <BikeGraphic tone="orange" width={40} />
        </span>
        <p className="text-[14px] font-semibold text-[#5A6C5E]">{title}</p>
      </div>
    );
  }
  return (
    <div className={`${K.card} px-4 py-9 flex flex-col items-center text-center gap-2`}>
      <span className="rn-bike-still opacity-80">
        <BikeGraphic tone="orange" width={72} />
      </span>
      <p className="mt-1 text-[15px] font-bold text-[#1F2320]">{title}</p>
      {detail && <p className="text-[13px] text-[#6E7F70]">{detail}</p>}
    </div>
  );
}

/** Could not load: says so plainly and offers a retry (it also retries by itself). */
export function LoadError({ text, onRetry }: { text: string; onRetry: () => unknown }) {
  const [busy, setBusy] = React.useState(false);
  const fill = useFillHeight<HTMLDivElement>();
  return (
    <div ref={fill.ref} style={fill.style} role="alert" className="mx-auto max-w-md min-h-[50vh] flex flex-col items-center justify-center text-center gap-3 px-4">
      <span className="w-14 h-14 rounded-2xl bg-[#FBE3DD] text-[#9A3423] flex items-center justify-center">
        <WifiOff className="w-6 h-6" />
      </span>
      <p className="text-[16px] font-bold text-[#1F2320]">{text}</p>
      <p className="text-[13px] text-[#5A6C5E]">Check your internet and try again.</p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onRetry();
          } finally {
            setBusy(false);
          }
        }}
        className={`${K.primaryBtn} h-11 px-6 text-[14px]`}
      >
        {busy ? "Trying again…" : "Try again"}
      </button>
    </div>
  );
}

export const initials = (n: string) =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "—";

/** The name to greet by: titles (Dr., Mr., Shri…) and initials are skipped. */
export const firstName = (n: string) => greetingName(n) || n.split(/\s+/)[0] || n;

export const fullDate = (d: string) => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
export const dayMonth = (d: string) => new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
export const shortDay = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
export const clock = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(iso)).toUpperCase() : "—");
