"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PanelLeftClose, LogOut } from "lucide-react";
import type { AuthenticatedUser } from "@/types";
import { ROLE_LABELS } from "@/types";
import type { NavGroup } from "./nav";

/**
 * Floating glass sidebar: dark panel with circled icons and a white active pill that slides to
 * the current item; collapsible to an icon rail with a capsule silhouette.
 *
 * Layout rule that keeps items still when collapsing: the header and every group label slot have
 * the same height in both states (the label text fades out and a hairline takes its place), so
 * the navigation starts at the same position and each icon keeps its exact vertical offset.
 * Colours come from the section theme (--rn-side-*, --rn-accent), so Orders/Delivery turn it orange.
 */
export function AppSidebar({
  user,
  groups,
  active,
  collapsed,
  onToggle,
  onNavigate,
  onLogout,
  isLoggingOut,
  pathname,
}: {
  user: AuthenticatedUser;
  groups: NavGroup[];
  active: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, href: string, key: string) => void;
  onLogout: () => void;
  isLoggingOut: boolean;
  pathname: string;
}) {
  const navRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  // Measure the active item so the pill can slide to it (also after collapsing/expanding).
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const el = active ? nav.querySelector<HTMLElement>(`[data-nav-key="${active}"]`) : null;
      setIndicator(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
    };
    measure();
    // Re-measure whenever the list's layout settles or changes (fonts, width transition, resize).
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(nav);
    nav.querySelectorAll("[data-nav-key]").forEach((el) => ro?.observe(el));
    const late = window.setTimeout(measure, 260);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.clearTimeout(late);
      window.removeEventListener("resize", measure);
    };
  }, [active, collapsed, groups]);

  // Every section is prefetched in full once the browser is idle, not only the links scrolled into
  // view (Staff, Activity and Settings sit below the fold on laptops and opened cold). Hovering a
  // link refreshes its prefetch again before the click. No effect in `next dev`.
  // router.refresh() (after a save that changes server-rendered pages) empties the prefetch cache,
  // so the shell announces it and the sections are prefetched again, once per burst of saves.
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href)).concat("/account").join("|");
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    let idle = 0;
    let timer = 0;
    // One section per idle slot, so the responses are not all parsed at once while someone types.
    const next = (queue: string[]) => {
      const href = queue.shift();
      if (!href) return;
      router.prefetch(href);
      if (w.requestIdleCallback) idle = w.requestIdleCallback(() => next(queue), { timeout: 3000 });
      else timer = window.setTimeout(() => next(queue), 200);
    };
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      if (idle) w.cancelIdleCallback?.(idle);
      timer = window.setTimeout(() => {
        const queue = hrefs.split("|");
        if (w.requestIdleCallback) idle = w.requestIdleCallback(() => next(queue), { timeout: 3000 });
        else next(queue);
      }, delay);
    };
    schedule(0);
    const onRefreshed = () => schedule(1500);
    window.addEventListener("erp:router-refreshed", onRefreshed);
    return () => {
      window.clearTimeout(timer);
      if (idle) w.cancelIdleCallback?.(idle);
      window.removeEventListener("erp:router-refreshed", onRefreshed);
    };
  }, [hrefs, router]);

  // Collapsed rail: one fixed-position label next to the hovered/focused icon (a pseudo-element
  // tooltip would be clipped by the panel's rounded overflow).
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);
  const showTip = (e: React.SyntheticEvent<HTMLElement>, label: string) => {
    if (!collapsed) return;
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 12 });
  };
  const hideTip = () => setTip(null);
  useEffect(() => setTip(null), [collapsed, active]);

  const initial = (user.fullName.replace(/^(dr|mr|mrs|ms|shri|smt|prof)\.?\s+/i, "").trim()[0] || "?").toUpperCase();

  return (
    <aside
      aria-label="Main navigation"
      data-collapsed={collapsed ? "true" : "false"}
      className={`rn-sidebar hidden lg:flex flex-col fixed z-30 top-4 bottom-4 left-4 text-white overflow-hidden ${collapsed ? "w-[84px] rn-sidebar-rail" : "w-[256px]"}`}
    >
      {/* Brand: same height in both states */}
      <div className={`h-[76px] shrink-0 flex items-center ${collapsed ? "justify-center px-0" : "pl-6 pr-3 gap-2"}`}>
        {collapsed ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Expand navigation"
            aria-expanded={false}
            onMouseEnter={(e) => showTip(e, "Expand")}
            onMouseLeave={hideTip}
            onFocus={(e) => showTip(e, "Expand")}
            onBlur={hideTip}
            className="rn-brand-initial"
          >
            <span className="rn-brandmark-name" style={{ fontSize: 22 }} aria-hidden data-initial>R</span>
          </button>
        ) : (
          <>
            <Link href="/dashboard" prefetch={false} onClick={(e) => onNavigate(e, "/dashboard", "dashboard")} className="rn-brandmark min-w-0 flex-1" aria-label="Ravinarayan — Dashboard">
              <span className="rn-brandmark-name">Ravinarayan</span>
              <span className="rn-brandmark-sub">PG &amp; Tiffin</span>
            </Link>
            <button
              type="button"
              onClick={onToggle}
              aria-label="Collapse navigation"
              aria-expanded
              className="rn-side-toggle grid place-items-center w-9 h-9 rounded-full shrink-0"
            >
              <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      <div ref={navRef} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {indicator && (
          <span
            aria-hidden
            className="rn-nav-indicator absolute left-3 right-3 rounded-full bg-white/95 shadow-[0_10px_24px_-14px_rgba(0,0,0,0.55)]"
            style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height, top: 0 }}
          />
        )}
        {groups.map((g, gi) => (
          <div key={g.label}>
            {/* Group slot: 28px in both states (label expanded, a separator line collapsed) */}
            <div className={`h-7 flex items-end ${gi === 0 ? "" : "mt-2"} ${collapsed ? "justify-center pb-3" : "px-3 pb-1.5"}`} aria-hidden={collapsed}>
              {collapsed ? (
                <span className="block h-px w-8 bg-white/20" />
              ) : (
                <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-white/40 select-none">{g.label}</span>
              )}
            </div>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const isActive = active === item.key;
                const Icon = item.icon;
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      data-nav-key={item.key}
                      aria-label={collapsed ? item.label : undefined}
                      onMouseEnter={(e) => showTip(e, item.label)}
                      onMouseLeave={hideTip}
                      onFocus={(e) => showTip(e, item.label)}
                      onBlur={hideTip}
                      aria-current={isActive ? "page" : undefined}
                      prefetch
                      onClick={(e) => onNavigate(e, item.href, item.key)}
                      className={`rn-nav-item relative z-10 flex items-center h-12 rounded-full ${collapsed ? "justify-center px-0" : "gap-3 pl-1.5 pr-3"} ${
                        isActive ? "is-active font-semibold" : "text-white/72 hover:text-white"
                      }`}
                    >
                      <span className="rn-nav-icon grid place-items-center w-9 h-9 rounded-full shrink-0">
                        <Icon className="w-[17px] h-[17px]" strokeWidth={1.8} />
                      </span>
                      {!collapsed && <span className="text-[13.5px] truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Footer: part of the panel (never over the navigation) */}
      <div className={`shrink-0 border-t border-white/10 flex items-center ${collapsed ? "flex-col gap-2 py-3" : "gap-3 px-4 py-3.5"}`}>
        <Link
          href="/account"
          prefetch={false}
          onClick={(e) => onNavigate(e, "/account", "account")}
          aria-current={pathname === "/account" ? "page" : undefined}
          aria-label={collapsed ? "My account" : undefined}
          onMouseEnter={(e) => showTip(e, "My account")}
          onMouseLeave={hideTip}
          onFocus={(e) => showTip(e, "My account")}
          onBlur={hideTip}
          className={`flex items-center gap-3 min-w-0 rounded-full ${collapsed ? "" : "flex-1 -ml-1 pl-1 pr-2 py-1 hover:bg-white/[0.06]"}`}
        >
          <span className="rn-side-avatar grid place-items-center w-9 h-9 rounded-full shrink-0 text-[13px] font-semibold" aria-hidden>{initial}</span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold truncate">{user.fullName}</span>
              <span className="block text-[11px] text-white/50 truncate">{ROLE_LABELS[user.role] || user.role}</span>
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={onLogout}
          disabled={isLoggingOut}
          aria-label="Sign out"
          title={collapsed ? undefined : "Sign out"}
          onMouseEnter={(e) => showTip(e, "Sign out")}
          onMouseLeave={hideTip}
          onFocus={(e) => showTip(e, "Sign out")}
          onBlur={hideTip}
          className="rn-side-toggle grid place-items-center w-9 h-9 rounded-full shrink-0 disabled:opacity-50"
        >
          <LogOut className="w-4 h-4" strokeWidth={1.8} />
        </button>
      </div>
      {collapsed && tip && (
        <span role="tooltip" className="rn-sidetip" style={{ top: tip.top, left: tip.left }}>
          {tip.label}
        </span>
      )}
    </aside>
  );
}
