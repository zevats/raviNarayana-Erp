"use client";

import React, { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { DeliveryTask, MealType } from "@/types";
import { addBusinessDays } from "@/lib/businessDate";
import { MSegment } from "@/components/app/m";
import { DeliveryOutcome, OUTCOME_LABEL, deliveryOutcome } from "@/lib/delivery/outcome";

/* Brand tokens only (tailwind theme from @ravinarayan/brand): forest, sage, brass, surface, status. */

export const rupees = (n: number | null | undefined) => `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

export function timeOf(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function dayLabel(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addBusinessDays(today, -1)) return "Yesterday";
  if (date === addBusinessDays(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

export function displayName(t: DeliveryTask): string {
  return t.orderType === "RESIDENT" ? t.residentName || `Room ${t.roomNumber}` : t.customerName || t.residentName || "Customer";
}

export function placeLine(t: DeliveryTask): string {
  if (t.orderType === "RESIDENT") return t.roomNumber ? `Room ${t.roomNumber}${t.floor !== null && t.floor !== undefined ? ` · Floor ${t.floor}` : ""}` : "Resident";
  return t.deliveryAddress || "Address not given";
}

export function itemSummary(t: DeliveryTask): string {
  const lines = t.lines ?? [];
  if (lines.length === 0) return "Meal";
  return lines.map((l) => `${l.quantity} ${l.productName}`).join(" · ");
}

const OUTCOME_TONE: Record<DeliveryOutcome, string> = {
  WAITING: "bg-surface-cream text-text-secondary border-surface-subtle",
  OUT: "bg-status-info-bg text-status-info-text border-status-info-border",
  DELIVERED: "bg-status-success-bg text-status-success-text border-status-success-border",
  PARTIAL: "bg-status-warning-bg text-status-warning-text border-status-warning-border",
  NOT_DELIVERED: "bg-status-danger-bg text-status-danger-text border-status-danger-border",
  CANCELLED: "bg-white text-text-subdued border-surface-subtle line-through decoration-1",
};

export function OutcomeBadge({ task, outcome }: { task?: DeliveryTask; outcome?: DeliveryOutcome }) {
  const o = outcome ?? deliveryOutcome(task!);
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${OUTCOME_TONE[o]}`}>{OUTCOME_LABEL[o]}</span>;
}

/** Meal switch (Owner/Manager delivery page): the app's pill switch, round inside and out. */
export function MealSwitch({ value, onChange, meals = ["LUNCH", "DINNER"] }: { value: MealType; onChange: (m: MealType) => void; meals?: MealType[] }) {
  return (
    <div className="min-w-0" style={{ width: `${meals.length * 92 + 8}px`, maxWidth: "100%" }}>
      <MSegment label="Meal" value={value} onChange={onChange} options={meals.map((m) => ({ value: m, label: m === "BREAKFAST" ? "Breakfast" : m === "LUNCH" ? "Lunch" : "Dinner" }))} />
    </div>
  );
}

export function DateStepper({ value, today, onChange }: { value: string; today: string; onChange: (d: string) => void }) {
  return (
    <div className="inline-flex items-center h-[46px] p-1 rounded-full bg-white border border-[#E5E0D5]">
      <button type="button" aria-label="Previous day" onClick={() => onChange(addBusinessDays(value, -1))} className="rn-press w-9 h-9 flex items-center justify-center text-forest rounded-full hover:bg-surface-canvas">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <label className="relative px-1 min-w-[92px] text-center text-sm font-medium text-text-primary cursor-pointer">
        {dayLabel(value, today)}
        <input type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Choose date" />
      </label>
      <button type="button" aria-label="Next day" onClick={() => onChange(addBusinessDays(value, 1))} className="rn-press w-9 h-9 flex items-center justify-center text-forest rounded-full hover:bg-surface-canvas">
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

/** A number that ticks when it changes (count feedback). */
export function Count({ value, className = "" }: { value: number | string; className?: string }) {
  return (
    <span key={String(value)} className={`rn-tick tabular-nums ${className}`}>
      {value}
    </span>
  );
}

/**
 * Focused panel: a bottom sheet on phones, a right-hand drawer from the md breakpoint.
 * Escape and the scrim close it; focus moves into it when it opens.
 */
export function Sheet({ open, onClose, title, subtitle, children, footer, wide = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end">
      <div className="rn-scrim absolute inset-0 bg-forest-night/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`rn-sheet rn-ops-sheet relative w-full ${wide ? "md:max-w-xl" : "md:max-w-md"} max-h-[94dvh] md:max-h-none md:h-full bg-surface-ivory rounded-t-[28px] md:rounded-none md:rounded-l-[28px] flex flex-col outline-none rn-lift`}
      >
        <div className="md:hidden mx-auto mt-2 h-1.5 w-10 rounded-full bg-sage-light" aria-hidden="true" />
        <header className="px-5 pt-3 pb-3 md:pt-5 flex items-start justify-between gap-3 border-b border-surface-subtle">
          <div className="min-w-0">
            <h2 className="font-serif text-xl text-text-primary leading-tight truncate">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-text-muted">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rn-press w-11 h-11 -mr-2 flex items-center justify-center rounded-full text-text-muted hover:bg-surface-cream">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t border-surface-subtle bg-surface-ivory">{footer}</div>}
      </div>
    </div>
  );
}

export function Notice({ tone, children }: { tone: "ok" | "warn" | "error" | "info"; children: React.ReactNode }) {
  const cls = {
    ok: "bg-status-success-bg text-status-success-text border-status-success-border",
    warn: "bg-status-warning-bg text-status-warning-text border-status-warning-border",
    error: "bg-status-danger-bg text-status-danger-text border-status-danger-border",
    info: "bg-status-info-bg text-status-info-text border-status-info-border",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rn-enter px-3 py-2 rounded-xl border text-sm ${cls}`}>
      {children}
    </div>
  );
}

export const btn = {
  primary: "rn-press inline-flex items-center justify-center gap-2 min-h-[48px] px-5 rounded-2xl bg-forest-deepest text-text-light font-medium hover:bg-forest-dark disabled:opacity-50",
  brass: "rn-press inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-2xl bg-brass-light text-forest-deepest font-medium hover:bg-brass disabled:opacity-50",
  quiet: "rn-press inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-2xl bg-white border border-surface-subtle text-text-primary hover:bg-surface-canvas disabled:opacity-50",
  danger: "rn-press inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-2xl bg-white border border-status-danger-border text-status-danger-text hover:bg-status-danger-bg disabled:opacity-50",
};

/** The day on the delivery card (phones): ‹ Today › in the card's corner; tap the day to pick a date. */
export function HeroDayStepper({ value, today, onChange }: { value: string; today: string; onChange: (d: string) => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 p-1">
      <button type="button" aria-label="Previous day" onClick={() => onChange(addBusinessDays(value, -1))} className="m-press grid place-items-center w-8 h-8 rounded-full text-white">
        <ChevronLeft className="w-4 h-4" />
      </button>
      <label className="relative px-1 min-w-[70px] text-center text-[13px] font-semibold text-white cursor-pointer">
        {dayLabel(value, today)}
        <input type="date" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Choose date" />
      </label>
      <button type="button" aria-label="Next day" onClick={() => onChange(addBusinessDays(value, 1))} className="m-press grid place-items-center w-8 h-8 rounded-full text-white">
        <ChevronRight className="w-4 h-4" />
      </button>
    </span>
  );
}
