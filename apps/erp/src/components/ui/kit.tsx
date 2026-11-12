import React from "react";
import Link from "next/link";
import { StateMessage } from "./states";
import { useInstantChoice } from "@/lib/useInstantChoice";

/**
 * Shared building blocks of the manager ERP, taken from the dashboard (the approved reference):
 * one glass card, one heading scale, one segmented control, one stat strip, one badge set.
 * Colours come from the section theme (--rn-* variables), so Orders and Delivery turn orange
 * without any change here.
 */

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/** Page title row. The mobile top bar already names the section, so the title shows from lg up. */
export function PageHeader({ title, description, actions, className }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="hidden lg:block text-[26px] leading-tight font-semibold tracking-[-0.02em] text-[var(--rn-ink)]">{title}</h1>
        {description && <p className="text-[13.5px] text-[var(--rn-ink-3)] lg:mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/** The one card surface. `flush` drops the padding for tables that run edge to edge. */
export function Card({ as: Tag = "section", flush, className, children, ...rest }: { as?: React.ElementType; flush?: boolean; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cx("rn-card", flush ? "" : "p-5 sm:p-6", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, sub, action, className }: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">{title}</h2>
        {sub && <p className="text-[12.5px] text-[var(--rn-ink-3)] mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export interface StatItem {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  href?: string;
}

const TONE_TEXT: Record<NonNullable<StatItem["tone"]>, string> = {
  default: "text-[var(--rn-ink)]",
  good: "text-[#2F6B24]",
  warn: "text-[#8F6710]",
  bad: "text-[#9A3423]",
};

/** Key figures in one card (instead of a separate card per number). Two columns on phones. */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  const cols = items.length >= 5 ? "lg:grid-cols-5" : items.length === 4 ? "lg:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <div className={cx("rn-card rn-stats grid grid-cols-2", cols, className)}>
      {items.map((s) => {
        const body = (
          <>
            <span className="block text-[12px] text-[var(--rn-ink-3)] truncate">{s.label}</span>
            <span className={cx("block mt-1 text-[22px] leading-tight font-semibold tracking-[-0.01em] tabular-nums", TONE_TEXT[s.tone ?? "default"])}>{s.value}</span>
            {s.note && <span className="block mt-0.5 text-[12px] text-[var(--rn-ink-3)] truncate">{s.note}</span>}
          </>
        );
        return s.href ? (
          <Link key={s.label} href={s.href} prefetch={false} className="rn-stat hover:bg-white/50 transition-colors">{body}</Link>
        ) : (
          <div key={s.label} className="rn-stat">{body}</div>
        );
      })}
    </div>
  );
}

/** The dashboard's pill switch, for tabs and filters. */
export function Segmented<T extends string>({ value: given, onChange: commit, options, label, className, size = "md" }: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: React.ReactNode; count?: number }>;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const [value, onChange] = useInstantChoice(given, commit);
  return (
    <div role="group" aria-label={label} className={cx("rn-seg", size === "sm" && "rn-seg-sm", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
          {typeof o.count === "number" && <span className="rn-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export type BadgeTone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";
export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return <span className={cx("rn-badge", `rn-badge-${tone}`, className)}>{children}</span>;
}

/** Empty / filtered / error states: see components/ui/states.tsx (this keeps older call sites working). */
export function EmptyState({ title, children, action, className, kind = "empty" }: { title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string; kind?: "empty" | "filtered" | "error" }) {
  return <StateMessage kind={kind} title={title} action={action} className={className}>{children}</StateMessage>;
}

/** Search box with the shared input look. */
export function SearchField({ value, onChange, placeholder = "Search", label, className }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string; className?: string }) {
  return (
    <label className={cx("relative block min-w-[180px]", className)}>
      <svg aria-hidden viewBox="0 0 24 24" className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rn-ink-3)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label ?? placeholder} className="rn-input rn-input-search w-full" />
    </label>
  );
}
