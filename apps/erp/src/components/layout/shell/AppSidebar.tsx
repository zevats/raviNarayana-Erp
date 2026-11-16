"use client";

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  // My Deliveries is a phone screen (the delivery app inside the ERP): not listed on a laptop.
  const allGroups = groups;
  groups = useMemo(() => allGroups.map((g) => ({ ...g, items: g.items.filter((i) => i.key !== "mydeliveries") })).filter((g) => g.items.length > 0), [allGroups]);
  const navRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  // Measure the active item so the pill can slide to it (also after collapsing/expanding).
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const el = active ? nav.querySelector<HTMLElement>(`[data-nav-key="${active}"]`) : null;
      const next = el ? { top: el.offsetTop, height: el.offsetHeight } : null;
      setIndicator((cur) => (cur?.top === next?.top && cur?.height === next?.height ? cur : next));
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

  // The current page's item is always in view (the list scrolls on short screens).
  useEffect(() => {
    const el = active ? navRef.current?.querySelector<HTMLElement>(`[data-nav-key="${active}"]`) : null;
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Every section is prefetched in full once the browser is idle, not only the links scrolled into
  // view (Staff, Activity and Settings sit below the fold on laptops and opened cold). Hovering a
  // link refreshes its prefetch again before the click. No effect in `next dev`.
  // router.refresh() (after a save that changes server-rendered pages) empties the prefetch cache,
  // so the shell announces it and the sections are prefetched again, once per burst of saves.
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href)).concat("/account", "/notifications").join("|");
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
    // Keep them warm: a preload expires after a few minutes (next.config staleTimes), and a click on
    // an expired section waited for the server. Preloading again is a no-op while an entry is still
    // fresh, so this only re-fetches what has expired. Also on returning to the app.
    const warm = window.setInterval(() => {
      if (document.visibilityState === "visible") schedule(0);
    }, 60000);
    const onVisible = () => {
      if (document.visibilityState === "visible") schedule(0);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(warm);
      if (idle) w.cancelIdleCallback?.(idle);
      window.removeEventListener("erp:router-refreshed", onRefreshed);
      document.removeEventListener("visibilitychange", onVisible);
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
      className={`rn-sidebar hidden lg:flex flex-col fixed z-30 top-4 bottom-4 left-4 text-white overflow-hidden ${collapsed ? "rn-sidebar-rail" : ""}`}
    >
      {/* Brand: one layout for both states. The name is clipped by the panel as it narrows and the
          initial fades in over the icon column (nothing moves up, down or sideways). */}
      <div className="relative h-[76px] shrink-0">
        <Link
          href="/dashboard"
          prefetch={false}
          tabIndex={collapsed ? -1 : undefined}
          aria-hidden={collapsed}
          onClick={(e) => onNavigate(e, "/dashboard", "dashboard")}
          className="rn-brandmark rn-side-fade absolute left-6 top-1/2 -translate-y-1/2 whitespace-nowrap"
          aria-label="Ravinarayan — Dashboard"
        >
          <span className="rn-brandmark-name">Ravinarayan</span>
          <span className="rn-brandmark-sub">PG &amp; Tiffin</span>
        </Link>
        <button
          type="button"
          onClick={onToggle}
          tabIndex={collapsed ? -1 : undefined}
          aria-hidden={collapsed}
          aria-label="Collapse navigation"
          aria-expanded
          className="rn-side-toggle rn-side-fade absolute right-3 top-1/2 -translate-y-1/2 grid place-items-center w-9 h-9 rounded-full"
        >
          <PanelLeftClose className="w-[18px] h-[18px]" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          tabIndex={collapsed ? undefined : -1}
          aria-hidden={!collapsed}
          aria-label="Expand navigation"
          aria-expanded={false}
          onMouseEnter={(e) => showTip(e, "Expand")}
          onMouseLeave={hideTip}
          onFocus={(e) => showTip(e, "Expand")}
          onBlur={hideTip}
          className="rn-brand-initial rn-rail-fade absolute left-3 top-1/2 -translate-y-1/2"
        >
          R
        </button>
      </div>

      {/* Navigation: every item keeps its place; only the panel's width changes. */}
      <div ref={navRef} className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {indicator && (
          <span
            aria-hidden
            className="rn-nav-indicator absolute rounded-full bg-white/95 shadow-[0_10px_24px_-14px_rgba(0,0,0,0.55)]"
            // As wide as the panel allows: a full pill when open, a circle around the icon when collapsed.
            style={{ transform: `translateY(${indicator.top}px)`, height: indicator.height, width: "calc(100% - 24px)", left: 12, top: 0 }}
          />
        )}
        {groups.map((g, gi) => (
          <div key={g.label}>
            {/* Group slot: 28px in both states (label when open, a separator line when collapsed) */}
            <div className={`relative h-7 ${gi === 0 ? "" : "mt-2"}`} aria-hidden={collapsed}>
              <span className="rn-rail-fade absolute left-2 bottom-3 block h-px w-8 bg-white/20" />
              <span className="rn-side-fade absolute left-3 bottom-1.5 whitespace-nowrap text-[10.5px] font-medium uppercase tracking-[0.12em] text-white/40 select-none">{g.label}</span>
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
                      className={`rn-nav-item relative z-10 flex items-center h-12 rounded-full gap-3 pl-1.5 pr-3 overflow-hidden ${isActive ? "is-active font-semibold" : "text-white/72 hover:text-white"}`}
                    >
                      <span className="rn-nav-icon grid place-items-center w-9 h-9 rounded-full shrink-0">
                        <Icon className="w-[17px] h-[17px]" strokeWidth={1.8} />
                      </span>
                      <span className="rn-side-fade text-[13.5px] whitespace-nowrap" aria-hidden={collapsed}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Footer: part of the panel (never over the navigation). The avatar stays under the icons;
          Sign out sits at the right when open and slides under the avatar when collapsed. */}
      <div className="rn-side-foot relative shrink-0 border-t border-white/10">
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
          className="rn-side-account absolute left-[14px] top-[12px] flex items-center gap-3 rounded-full p-1 pr-2 overflow-hidden hover:bg-white/[0.06]"
        >
          <span className="rn-side-avatar grid place-items-center w-9 h-9 rounded-full shrink-0 text-[13px] font-semibold" aria-hidden>{initial}</span>
          <span className="rn-side-fade min-w-0" aria-hidden={collapsed}>
            <span className="block text-[13px] font-semibold truncate">{user.fullName}</span>
            <span className="block text-[11px] text-white/50 truncate">{ROLE_LABELS[user.role] || user.role}</span>
          </span>
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
          className="rn-side-toggle rn-side-logout absolute grid place-items-center w-9 h-9 rounded-full disabled:opacity-50"
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
