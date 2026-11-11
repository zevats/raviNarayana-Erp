"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid, X, LogOut, ExternalLink, ChevronRight } from "lucide-react";
import type { AuthenticatedUser } from "@/types";
import { ROLE_LABELS } from "@/types";
import { RnLogo } from "@/components/brand/RnLogo";
import { UserAvatar } from "@/components/brand/BrandMark";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import type { NavGroup, NavLink } from "./nav";

const BAR_KEYS = ["dashboard", "orders", "delivery", "residents"];
/** Short names for the bottom bar (the active tab shows its name next to the icon). */
const BAR_LABEL: Record<string, string> = { dashboard: "Home", orders: "Orders", delivery: "Delivery", residents: "Residents" };

/**
 * Phone and tablet app for the Owner and Manager, in the delivery app's design: a flat bar with the
 * logo and name that becomes a floating pill once the page scrolls, a floating pill tab bar at the
 * bottom (Home, Orders, Delivery, Residents, More) and a full list of sections behind More.
 */
export function MobileTopBar({ title, queued, online, onAccount, onHome }: { title: string; queued: number; online: boolean; onAccount?: (e: React.MouseEvent<HTMLAnchorElement>) => void; onHome?: (e: React.MouseEvent<HTMLAnchorElement>) => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <>
      {/* The bar floats above the page; this keeps the page's place under it. */}
      <div aria-hidden className="lg:hidden h-[calc(64px+env(safe-area-inset-top))]" />
      <header className="lg:hidden rn-topbar-wrap rn-topbar-phone" aria-label={title} data-scrolled={scrolled ? "" : undefined}>
        <div className="rn-topbar">
          <Link href="/dashboard" prefetch={false} onClick={onHome} aria-label="Dashboard" className="rn-press flex-1 min-w-0 flex items-center gap-3">
            <span className="rn-topbar-logo"><RnLogo size={40} title="" /></span>
            <span className="rn-topbar-name min-w-0 truncate">Ravinarayan</span>
          </Link>
          {(!online || queued > 0) && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#F6E3B8] text-[#5E3F04] whitespace-nowrap">{online ? `${queued} to send` : "Offline"}</span>}
          <span className="grid place-items-center w-10 h-10 rounded-full bg-[#EFEAE1]">
            <NotificationBell />
          </span>
          <Link href="/account" prefetch={false} onClick={onAccount} aria-label="My account" className="rn-press shrink-0">
            <UserAvatar size={40} tone="forest" className="ring-2 ring-white shadow-sm" />
          </Link>
        </div>
      </header>
    </>
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
  const moreActive = moreOpen || (!inBar && Boolean(active));
  // The chosen tab is marked by one pill that slides from tab to tab.
  const index = moreActive ? items.length : items.findIndex((i) => i.key === active);
  const count = items.length + 1;
  const tab = (on: boolean) => `rn-press relative z-[1] h-[52px] rounded-full flex flex-col items-center justify-center gap-[3px] transition-colors duration-300 ${on ? "text-white" : "text-[#3E4E42]"}`;
  return (
    <nav aria-label="Main navigation" className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
      <div data-bottom-bar className="rn-m-tabs pointer-events-auto relative w-full max-w-md grid p-1 rounded-full" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
        <span aria-hidden className="rn-tab-pill" style={{ width: `calc((100% - 8px) / ${count})`, transform: `translateX(${Math.max(0, index) * 100}%)`, opacity: index < 0 ? 0 : 1 }} />
        {items.map((item) => {
          const isActive = active === item.key && !moreActive;
          const Icon = item.icon;
          return (
            <Link key={item.key} href={item.href} prefetch aria-current={isActive ? "page" : undefined} onClick={(e) => onNavigate(e, item.href, item.key)} className={tab(isActive)}>
              <Icon className="w-[19px] h-[19px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="text-[10.5px] font-semibold leading-none">{BAR_LABEL[item.key] ?? item.label}</span>
            </Link>
          );
        })}
        <button type="button" onClick={onMore} aria-expanded={moreOpen} aria-haspopup="dialog" className={tab(moreActive)}>
          <LayoutGrid className="w-[19px] h-[19px] shrink-0" strokeWidth={moreActive ? 2.2 : 1.8} />
          <span className="text-[10.5px] font-semibold leading-none">More</span>
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
  // The four sections of the bottom bar are not repeated here.
  const rest = groups.map((g) => ({ ...g, items: g.items.filter((i) => !BAR_KEYS.includes(i.key)) })).filter((g) => g.items.length > 0);
  return (
    <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="All sections">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-[rgba(18,28,22,0.38)] rn-scrim" />
      <div className="relative rn-sheet rn-m-sheet rounded-t-[28px] max-h-[88dvh] overflow-y-auto px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#DDD6C8]" aria-hidden />
        <div className="flex items-center justify-between gap-3 pb-3">
          <h2 className="text-[24px] font-extrabold tracking-[-0.02em] text-[#1F2320]">More</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rn-press grid place-items-center w-10 h-10 rounded-full bg-[#EFEAE1] text-[#1F2320]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <Link href="/account" onClick={(e) => onNavigate(e, "/account", "account")} className="rn-m-card rn-press flex items-center gap-3.5 p-4">
          <UserAvatar size={52} tone="forest" />
          <span className="flex-1 min-w-0">
            <span className="block text-[17px] font-bold text-[#1F2320] truncate">{user.fullName}</span>
            <span className="block text-[13px] text-[#5A6C5E]">{ROLE_LABELS[user.role] || user.role}</span>
          </span>
          <ChevronRight className="w-5 h-5 text-[#8A968D]" />
        </Link>

        {rest.map((g) => (
          <section key={g.label} className="pt-5">
            <h3 className="px-1 pb-2 text-[16px] font-bold text-[#1F2320]">{g.label}</h3>
            <div className="rn-m-card overflow-hidden divide-y divide-[#ECE6DB]">
              {g.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.key === active;
                return (
                  <Link key={item.key} href={item.href} aria-current={isActive ? "page" : undefined} onClick={(e) => onNavigate(e, item.href, item.key)} className="rn-press flex items-center gap-3.5 px-4 min-h-[60px]">
                    <span className={`grid place-items-center w-10 h-10 rounded-xl shrink-0 ${isActive ? "bg-[#1E3A2B] text-white" : "bg-[#F4F0E8] text-[#3E4E42]"}`}>
                      <Icon className="w-[19px] h-[19px]" strokeWidth={1.8} />
                    </span>
                    <span className={`flex-1 min-w-0 truncate text-[15px] ${isActive ? "font-bold text-[#1F2320]" : "font-semibold text-[#1F2320]"}`}>{item.label}</span>
                    <ChevronRight className="w-5 h-5 text-[#8A968D] shrink-0" />
                  </Link>
                );
              })}
            </div>
          </section>
        ))}

        <div className="pt-5 space-y-2.5">
          {websiteUrl && (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="rn-press flex items-center justify-center gap-2 h-12 rounded-full bg-[#EFEAE1] text-[15px] font-semibold text-[#1F2320]">
              <ExternalLink className="w-[18px] h-[18px]" /> Website
            </a>
          )}
          <button type="button" onClick={onLogout} className="rn-press w-full flex items-center justify-center gap-2 h-12 rounded-full bg-[#FBE3DD] text-[15px] font-bold text-[#9A3423]">
            <LogOut className="w-[18px] h-[18px]" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
