"use client";

/**
 * The Owner and Manager phone app kit (below 1024px). Pages built for the phone use these pieces,
 * so every screen reads the same way: a headline card, quick actions, grouped lists of rows,
 * chips that wrap (nothing scrolls sideways) and bottom sheets for details and filters.
 * Styles: styles/mobile.css ("App kit").
 */

import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronRight, Search, SlidersHorizontal, X } from "lucide-react";

export type MTone = "green" | "red" | "amber" | "blue" | "orange" | "neutral" | "accent";

/* ------------------------------------------------------------------ viewport */

const PHONE_QUERY = "(max-width: 1023.98px)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/**
 * True on phones and tablets, false on wide screens, null while the page is first drawn on the
 * server (a client-side page change knows at once). Pages render only one layout, not both.
 */
export function useIsPhone(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => null
  );
}

/**
 * One layout per screen size. While the page is first drawn on the server (size unknown) both are
 * drawn and CSS shows the right one, so a phone never flashes the desktop layout; after that only
 * the matching one is kept.
 */
export function PhoneOrDesktop({ phone, mobile, desktop }: { phone: boolean | null; mobile: React.ReactNode; desktop: React.ReactNode }) {
  if (phone === true) return <>{mobile}</>;
  if (phone === false) return <>{desktop}</>;
  return (
    <>
      <div className="lg:hidden">{mobile}</div>
      <div className="hidden lg:block">{desktop}</div>
    </>
  );
}

/* ------------------------------------------------------------------ layout */

export function MStack({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`m-stack ${className}`}>{children}</div>;
}

/** A titled block: the title (and an optional action) above its content. */
export function MSection({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`m-section ${className}`}>
      {(title || action) && (
        <div className="m-section-head">
          {title && <h2 className="m-section-title">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** White card holding rows, with hairlines between them. */
export function MGroup({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`m-group ${className}`}>{children}</div>;
}

export function MCard({ children, className = "", onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) {
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={`m-card m-press text-left w-full ${className}`}>
        {children}
      </button>
    );
  return <div className={`m-card ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ rows */

export interface MRowProps {
  icon?: React.ElementType;
  /** Initials or a short text shown in the circle instead of an icon. */
  avatar?: string;
  tone?: MTone;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  rightSub?: React.ReactNode;
  rightTone?: MTone;
  strike?: boolean;
  href?: string;
  onClick?: () => void;
  chevron?: boolean;
  /** Extra content under the row (buttons, a note). */
  children?: React.ReactNode;
  className?: string;
}

export function MRow({ icon: Icon, avatar, tone = "neutral", title, sub, right, rightSub, rightTone, strike, href, onClick, chevron, children, className = "" }: MRowProps) {
  const body = (
    <>
      {(Icon || avatar) && (
        <span className={`m-ico m-tone-${tone}`} aria-hidden>
          {Icon ? <Icon className="w-[18px] h-[18px]" strokeWidth={1.9} /> : <span className="m-ico-text">{avatar}</span>}
        </span>
      )}
      <span className="m-row-main">
        <span className={`m-row-title ${strike ? "line-through opacity-60" : ""}`}>{title}</span>
        {sub && <span className="m-row-sub">{sub}</span>}
      </span>
      {(right !== undefined || rightSub) && (
        <span className="m-row-side">
          {right !== undefined && <span className={`m-row-right ${rightTone ? `m-text-${rightTone}` : ""} ${strike ? "line-through opacity-50" : ""}`}>{right}</span>}
          {rightSub && <span className="m-row-sub text-right">{rightSub}</span>}
        </span>
      )}
      {(chevron ?? Boolean(href || onClick)) && <ChevronRight className="m-row-chev" aria-hidden />}
    </>
  );
  const cls = `m-row ${href || onClick ? "m-press" : ""} ${className}`;
  return (
    <div className="m-row-wrap">
      {href ? (
        <Link href={href} prefetch={false} className={cls}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={`${cls} w-full text-left`}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
      {children && <div className="m-row-extra">{children}</div>}
    </div>
  );
}

/** "Label ...... value" line, for detail sheets. */
export function MField({ label, children, tone }: { label: React.ReactNode; children: React.ReactNode; tone?: MTone }) {
  return (
    <div className="m-field">
      <span className="m-field-label">{label}</span>
      <span className={`m-field-value ${tone ? `m-text-${tone}` : ""}`}>{children}</span>
    </div>
  );
}

export function MPill({ tone = "neutral", children }: { tone?: MTone; children: React.ReactNode }) {
  return <span className={`m-pill m-tone-${tone}`}>{children}</span>;
}

/* ------------------------------------------------------------------ figures */

/** The page's main figure on a deep green (or orange) card, with up to four smaller figures. */
export function MHero({
  label,
  value,
  note,
  items,
  tone = "green",
  action,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  note?: React.ReactNode;
  items?: Array<{ label: React.ReactNode; value: React.ReactNode; onClick?: () => void; href?: string }>;
  tone?: "green" | "orange";
  action?: React.ReactNode;
}) {
  return (
    <section className={`m-hero m-hero-${tone}`}>
      <span className="m-hero-glow" aria-hidden />
      <div className="m-hero-top">
        <span className="m-hero-label">{label}</span>
        {action}
      </div>
      <p className="m-hero-value">{value}</p>
      {note && <p className="m-hero-note">{note}</p>}
      {items && items.length > 0 && (
        <div className={`m-hero-grid ${items.length === 3 ? "m-hero-grid-3" : ""}`}>
          {items.map((it, i) => {
            const inner = (
              <>
                <span className="m-hero-cell-label">{it.label}</span>
                <span className="m-hero-cell-value">{it.value}</span>
              </>
            );
            return it.href ? (
              <Link key={i} href={it.href} prefetch={false} className="m-hero-cell m-press">
                {inner}
              </Link>
            ) : it.onClick ? (
              <button key={i} type="button" onClick={it.onClick} className="m-hero-cell m-press text-left">
                {inner}
              </button>
            ) : (
              <div key={i} className="m-hero-cell">
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Small figure tiles, two (or three) to a row. */
export function MStats({ items, cols = 2 }: { items: Array<{ label: React.ReactNode; value: React.ReactNode; tone?: MTone; onClick?: () => void; href?: string; icon?: React.ElementType }>; cols?: 2 | 3 }) {
  return (
    <div className={`m-stats m-stats-${cols}`}>
      {items.map((it, i) => {
        const Icon = it.icon;
        const inner = (
          <>
            {Icon && (
              <span className={`m-ico m-ico-sm m-tone-${it.tone ?? "accent"}`} aria-hidden>
                <Icon className="w-4 h-4" strokeWidth={2} />
              </span>
            )}
            <span className={`m-stat-value ${it.tone && it.tone !== "accent" && it.tone !== "neutral" ? `m-text-${it.tone}` : ""}`}>{it.value}</span>
            <span className="m-stat-label">{it.label}</span>
          </>
        );
        return it.href ? (
          <Link key={i} href={it.href} prefetch={false} className="m-stat m-press">
            {inner}
          </Link>
        ) : it.onClick ? (
          <button key={i} type="button" onClick={it.onClick} className="m-stat m-press text-left">
            {inner}
          </button>
        ) : (
          <div key={i} className="m-stat">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ actions */

export interface MQuickItem {
  label: string;
  icon: React.ElementType;
  onClick?: () => void;
  href?: string;
  tone?: MTone;
  disabled?: boolean;
}

/** One-tap actions: icon tiles, four to a row. */
export function MQuick({ items }: { items: MQuickItem[] }) {
  return (
    <nav className={`m-quick ${items.length === 3 ? "m-quick-3" : ""}`} aria-label="Quick actions">
      {items.map((it) => {
        const Icon = it.icon;
        const inner = (
          <>
            <span className={`m-quick-ico m-tone-${it.tone ?? "accent"}`}>
              <Icon className="w-5 h-5" strokeWidth={1.9} />
            </span>
            <span className="m-quick-label">{it.label}</span>
          </>
        );
        return it.href ? (
          <Link key={it.label} href={it.href} prefetch={false} className="m-quick-item m-press">
            {inner}
          </Link>
        ) : (
          <button key={it.label} type="button" onClick={it.onClick} disabled={it.disabled} className="m-quick-item m-press disabled:opacity-50">
            {inner}
          </button>
        );
      })}
    </nav>
  );
}

export function MButton({
  children,
  onClick,
  kind = "soft",
  icon: Icon,
  disabled,
  type = "button",
  className = "",
  href,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  kind?: "primary" | "soft" | "danger" | "ghost";
  icon?: React.ElementType;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  href?: string;
}) {
  const cls = `m-btn m-btn-${kind} m-press ${className}`;
  const inner = (
    <>
      {Icon && <Icon className="w-[18px] h-[18px]" strokeWidth={2} />}
      {children}
    </>
  );
  if (href)
    return (
      <Link href={href} prefetch={false} className={cls}>
        {inner}
      </Link>
    );
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={cls}>
      {inner}
    </button>
  );
}

/* ------------------------------------------------------------------ choosing */

/** Equal-width switch for two to four choices. */
export function MSegment<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: React.ReactNode; count?: number }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="m-seg" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className="m-seg-btn">
          <span className="truncate">{o.label}</span>
          {o.count !== undefined && <span className="m-seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Chips that wrap onto the next line (never a sideways strip). */
export function MChips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: React.ReactNode; count?: number }>; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="m-chips">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className="m-chip m-press">
          {o.label}
          {o.count !== undefined && <span className="m-chip-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Search box with an optional Filter button (showing how many filters are on). */
export function MSearch({ value, onChange, placeholder = "Search", onFilter, filterCount = 0 }: { value: string; onChange: (v: string) => void; placeholder?: string; onFilter?: () => void; filterCount?: number }) {
  return (
    <div className="m-search-row">
      <label className="m-search">
        <Search className="w-[18px] h-[18px] shrink-0 text-[#7C877F]" aria-hidden />
        <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
        {value && (
          <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="m-search-clear">
            <X className="w-4 h-4" />
          </button>
        )}
      </label>
      {onFilter && (
        <button type="button" onClick={onFilter} aria-label={filterCount ? `Filters (${filterCount} on)` : "Filters"} className={`m-filter-btn m-press ${filterCount ? "is-on" : ""}`}>
          <SlidersHorizontal className="w-[18px] h-[18px]" />
          {filterCount > 0 && <span className="m-filter-count">{filterCount}</span>}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function MEmpty({ icon: Icon, title, children }: { icon?: React.ElementType; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="m-empty">
      {Icon && (
        <span className="m-empty-ico" aria-hidden>
          <Icon className="w-6 h-6" strokeWidth={1.7} />
        </span>
      )}
      <p className="m-empty-title">{title}</p>
      {children}
    </div>
  );
}

/** Placeholder rows while a list loads. */
export function MSkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="m-group" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="m-row">
          <span className="m-ico rn-skel" />
          <span className="m-row-main gap-2">
            <span className="rn-skel block h-3.5 w-2/5 rounded" />
            <span className="rn-skel block h-3 w-3/5 rounded" />
          </span>
          <span className="rn-skel block h-4 w-14 rounded" />
        </div>
      ))}
    </div>
  );
}

export function MMore({ shown, total, onMore, step = 30 }: { shown: number; total: number; onMore: () => void; step?: number }) {
  if (shown >= total) return null;
  return (
    <button type="button" onClick={onMore} className="m-more m-press">
      Show {Math.min(step, total - shown)} more
    </button>
  );
}

/** A short confirmation line that fades on its own. */
export function MNotice({ tone = "green", children, onClose }: { tone?: "green" | "red"; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`m-notice m-notice-${tone}`}>
      <span className="flex-1 min-w-0">{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="m-notice-x">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ sheet */

/**
 * Bottom sheet: details, filters and short forms. Tap outside, the close button or Back (Escape)
 * closes it. The page underneath does not scroll while it is open.
 */
export function MSheet({ open, onClose, title, children, footer, tall }: { open: boolean; onClose: () => void; title?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; tall?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const labelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  const shown = open || leaving;
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      setLeaving(true);
      const t = setTimeout(() => setLeaving(false), 220);
      wasOpen.current = open;
      return () => clearTimeout(t);
    }
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const focusT = setTimeout(() => panel.current?.focus({ preventScroll: true }), 30);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      clearTimeout(focusT);
    };
  }, [open, onClose]);
  if (!mounted || !shown) return null;
  return createPortal(
    <div className={`m-sheet-root ${leaving && !open ? "is-leaving" : ""}`} role="dialog" aria-modal="true" aria-labelledby={title ? labelId : undefined}>
      <button type="button" aria-label="Close" className="m-sheet-scrim" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className={`m-sheet ${tall ? "m-sheet-tall" : ""}`}>
        <span className="m-sheet-grip" aria-hidden />
        {title && (
          <div className="m-sheet-head">
            <h2 id={labelId} className="m-sheet-title">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="m-sheet-x m-press">
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="m-sheet-body">{children}</div>
        {footer && <div className="m-sheet-foot">{footer}</div>}
      </div>
    </div>,
    // Inside the app shell (its colours and type), outside the page content.
    document.querySelector(".rn-app") ?? document.body
  );
}

/* ------------------------------------------------------------------ dates */

const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const dayFmtYear = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function localIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** "Today", "Yesterday", "8 Nov" (or "8 Nov 2025" for another year) for a YYYY-MM-DD day. */
export function dayLabel(iso: string): string {
  const day = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return iso;
  const now = new Date();
  const today = localIso(now);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (day === today) return "Today";
  if (day === localIso(y)) return "Yesterday";
  const d = new Date(`${day}T00:00:00Z`);
  return day.slice(0, 4) === today.slice(0, 4) ? dayFmt.format(d) : dayFmtYear.format(d);
}

/** Groups items by day, keeping their order. */
export function groupByDay<T>(items: T[], dayOf: (it: T) => string): Array<{ day: string; label: string; items: T[] }> {
  const out: Array<{ day: string; label: string; items: T[] }> = [];
  for (const it of items) {
    const day = String(dayOf(it) || "").slice(0, 10);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, label: dayLabel(day), items: [it] });
  }
  return out;
}

export function initials(name: string | null | undefined): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] || "" : "")).toUpperCase();
}
