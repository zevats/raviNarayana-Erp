"use client";

import React from "react";
import Link from "next/link";
import { LayoutGrid, X, LogOut, ExternalLink } from "lucide-react";
import type { AuthenticatedUser } from "@/types";
import { ROLE_LABELS } from "@/types";
import { RnLogo } from "@/components/brand/RnLogo";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import type { NavGroup, NavLink } from "./nav";

const BAR_KEYS = ["dashboard", "orders", "delivery", "residents"];

/** Phone and tablet: glass top bar, floating bottom bar (Dashboard, Orders, Delivery, Residents, More), More sheet. */
export function MobileTopBar({ title, queued, online }: { title: string; queued: number; online: boolean }) {
  return (
    <header className="lg:hidden sticky top-0 z-40 px-3 pt-[max(0.6rem,env(safe-area-inset-top))] pb-2">
      <div className="rn-glass rn-blur rounded-full h-14 pl-2 pr-2 flex items-center gap-3">
        <RnLogo size={42} title="Ravinarayan" />
        <p className="flex-1 min-w-0 text-[15px] font-semibold tracking-tight text-[var(--rn-ink)] truncate">{title}</p>
        {(!online || queued > 0) && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">{online ? `${queued} to send` : "Offline"}</span>
        )}
        <span className="grid place-items-center w-10 h-10 rounded-full bg-white/70">
          <NotificationBell />
        </span>
      </div>
    </header>
  );
}

export function MobileBottomBar({
  links,
  active,
  moreOpen,
  onMore,
  onNavigate,
}: {
  links: NavLink[];
  active: string | null;
  moreOpen: boolean;
  onMore: () => void;
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, href: string, key: string) => void;
}) {
  const items = BAR_KEYS.map((k) => links.find((l) => l.key === k)).filter(Boolean) as NavLink[];
  const inBar = items.some((i) => i.key === active);
  return (
    <nav data-bottom-bar aria-label="Main navigation" className="lg:hidden fixed z-40 left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="rn-glass rn-blur rounded-full h-16 px-2 grid grid-cols-5 items-center max-w-lg mx-auto">
        {items.map((item) => {
          const isActive = active === item.key;
          const Icon = item.icon;
          return (
            <Link
              key={item.key}
              href={item.href}
              prefetch
              aria-current={isActive ? "page" : undefined}
              onClick={(e) => onNavigate(e, item.href, item.key)}
              className="flex flex-col items-center justify-center gap-0.5"
            >
              <span
                className={`grid place-items-center w-10 h-10 rounded-full transition-colors duration-200 ${isActive ? "text-white" : "text-[var(--rn-ink-3)]"}`}
                style={{ background: isActive ? "var(--rn-accent)" : "transparent" }}
              >
                <Icon className="w-[19px] h-[19px]" strokeWidth={1.8} />
              </span>
              <span className={`text-[10px] leading-none ${isActive ? "font-semibold text-[var(--rn-ink)]" : "text-[var(--rn-ink-3)]"}`}>{item.label}</span>
            </Link>
          );
        })}
        <button type="button" onClick={onMore} aria-expanded={moreOpen} aria-haspopup="dialog" className="flex flex-col items-center justify-center gap-0.5">
          <span className={`grid place-items-center w-10 h-10 rounded-full ${!inBar && active ? "bg-[var(--rn-accent)] text-white" : "text-[var(--rn-ink-3)]"}`}>
            <LayoutGrid className="w-[19px] h-[19px]" strokeWidth={1.8} />
          </span>
          <span className="text-[10px] leading-none text-[var(--rn-ink-3)]">More</span>
        </button>
      </div>
    </nav>
  );
}

export function MobileMoreSheet({
  user,
  groups,
  active,
  onClose,
  onNavigate,
  onLogout,
  websiteUrl,
}: {
  user: AuthenticatedUser;
  groups: NavGroup[];
  active: string | null;
  onClose: () => void;
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, href: string, key: string) => void;
  onLogout: () => void;
  websiteUrl: string | null;
}) {
  return (
    <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="All sections">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[rgba(18,28,22,0.35)] backdrop-blur-[6px] rn-scrim" />
      <div className="relative rn-dialog rn-sheet rounded-t-[30px] max-h-[86dvh] overflow-y-auto px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-black/10" aria-hidden />
        <div className="flex items-center gap-3 pb-4 border-b border-[var(--rn-line)]">
          <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--rn-accent)] text-white text-[15px] font-semibold shrink-0" aria-hidden>{(user.fullName.replace(/^(dr|mr|mrs|ms|shri|smt|prof)\.?\s+/i, "").trim()[0] || "?").toUpperCase()}</span>
          <Link href="/account" onClick={(e) => onNavigate(e, "/account", "account")} className="flex-1 min-w-0">
            <span className="block text-[15px] font-semibold text-[var(--rn-ink)] truncate">{user.fullName}</span>
            <span className="block text-[12px] text-[var(--rn-ink-3)]">{ROLE_LABELS[user.role] || user.role} · My account</span>
          </Link>
          <button type="button" onClick={onClose} aria-label="Close" className="grid place-items-center w-10 h-10 rounded-full bg-black/5">
            <X className="w-5 h-5" />
          </button>
        </div>
        {groups.map((g) => (
          <div key={g.label} className="pt-4">
            <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--rn-ink-3)]">{g.label}</p>
            <div className="grid grid-cols-2 gap-2">
              {g.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.key === active;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={(e) => onNavigate(e, item.href, item.key)}
                    className={`flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-[13px] border ${isActive ? "bg-[var(--rn-accent)] text-white border-transparent" : "bg-white/70 border-[var(--rn-line)] text-[var(--rn-ink)]"}`}
                  >
                    <span className={`grid place-items-center w-8 h-8 rounded-full ${isActive ? "bg-white/15" : "bg-[var(--rn-accent-tint)]"}`}>
                      <Icon className="w-4 h-4" strokeWidth={1.8} />
                    </span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
        <div className="pt-5 mt-4 border-t border-[var(--rn-line)] flex items-center gap-2">
          {websiteUrl && (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full bg-black/5 text-[13px] text-[var(--rn-ink)]">
              <ExternalLink className="w-4 h-4" /> Website
            </a>
          )}
          <button type="button" onClick={onLogout} className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-full bg-[var(--rn-accent)] text-white text-[13px] font-semibold">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
