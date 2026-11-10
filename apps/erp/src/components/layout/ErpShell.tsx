"use client";

import { HandoverAlert } from "@/components/notifications/HandoverAlert";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";

import { AuthenticatedUser } from "@/types";
import { clearErpCache, setCacheOwner, onErpCacheInvalidated, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { processOfflineQueue } from "@/modules/delivery/offlineQueue";
import { CurrentUserProvider } from "@/components/auth/CurrentUserContext";
import { DeliveryStaffShell } from "./DeliveryStaffShell";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { forgetPushToken } from "@/lib/native";
import { rememberBrand } from "@/lib/brand";
import { visibleGroups, allLinks, activeKey, sectionAccent, pageTitle, trailFor } from "./shell/nav";
import { AppSidebar } from "./shell/AppSidebar";
import { TopBar } from "./shell/TopBar";
import { NavSkeleton } from "./shell/NavSkeleton";
import { MobileTopBar, MobileBottomBar, MobileMoreSheet } from "./shell/MobileNav";
import { useStackedTables } from "./shell/useStackedTables";
import { useInlineDialogs } from "./shell/useInlineDialogs";

interface ErpShellProps {
  user: AuthenticatedUser;
  children: React.ReactNode;
  isDemo?: boolean;
  /** Public website address from Settings; the "Public Site" link is hidden when none is set. */
  websiteUrl?: string | null;
}

export function ErpShell({ user, children, isDemo = false, websiteUrl = null }: ErpShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  // Client data cache belongs to this user; set synchronously before children read from it.
  setCacheOwner(user.id);

  // Remember which edition this phone shows (green ERP / orange Delivery) for the next launch's
  // splash and sign-in screen; taken from the signed-in account's role, never chosen by hand.
  useEffect(() => {
    rememberBrand(user.role === "DELIVERY_PERSON" ? "delivery" : "standard");
  }, [user.role]);

  // Server-rendered pages (dashboard, staff) are reused from the Next router cache between visits.
  // When a mutation invalidates their data, refresh so the next visit renders fresh numbers.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = onErpCacheInvalidated((tags) => {
      if (tags && !tags.some((t) => t === "dashboard" || t === "staff")) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        router.refresh();
        // The refresh also empties the prefetch cache; the sidebar prefetches the sections again.
        window.dispatchEvent(new Event("erp:router-refreshed"));
      }, 150);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [router]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [liveState, setLiveState] = useState<"connecting" | "live" | "reconnecting">("connecting");

  // Live updates: the server announces which data changed (orders, delivery, finance...) after
  // every committed write; this tab refetches those views. Polling stays as the fallback.
  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const lastLocal = new Map<string, number>();
    let applyingRemote = false;
    const offLocal = onErpCacheInvalidated((tags) => {
      if (applyingRemote || !tags) return;
      const now = Date.now();
      tags.forEach((t) => lastLocal.set(t, now));
    });
    const pendingRecheck = new Set<string>();
    let recheckTimer: ReturnType<typeof setTimeout> | null = null;
    let wasDisconnected = false;
    const source = new EventSource("/api/events");
    source.addEventListener("ready", () => {
      setLiveState("live");
      // Changes made while the stream was reconnecting were not announced: refresh the live views.
      if (wasDisconnected) {
        wasDisconnected = false;
        invalidateErpCache(["orders", "delivery", "custody", "handover"]);
      }
    });
    source.addEventListener("changed", (ev) => {
      try {
        const { tags, self } = JSON.parse((ev as MessageEvent).data) as { tags: string[]; self?: boolean };
        // A view this tab refreshed itself moments ago may only be hearing the echo of its own save.
        // When the server says every write in this message came from this browser's session, that
        // echo is dropped (the view already reloaded). Otherwise someone else may have written too:
        // refresh it once more just after the echo window (dropping it hid a new order for a poll).
        // Other tabs of this browser did not refresh themselves, so they still reload.
        const now = Date.now();
        const fresh = tags.filter((t) => now - (lastLocal.get(t) || 0) > 2000);
        const recent = self === true ? [] : tags.filter((t) => !fresh.includes(t));
        if (fresh.length) {
          applyingRemote = true;
          invalidateErpCache(fresh);
        }
        if (recent.length) {
          recent.forEach((t) => pendingRecheck.add(t));
          if (!recheckTimer) {
            recheckTimer = setTimeout(() => {
              recheckTimer = null;
              const due = Array.from(pendingRecheck);
              pendingRecheck.clear();
              applyingRemote = true;
              try {
                invalidateErpCache(due);
              } finally {
                applyingRemote = false;
              }
            }, 800);
          }
        }
      } catch {
        // Malformed message: the next poll refreshes anyway.
      } finally {
        applyingRemote = false;
      }
    });
    source.addEventListener("signed-out", () => {
      source.close();
      window.location.replace("/login");
    });
    source.onerror = () => {
      wasDisconnected = true;
      setLiveState("reconnecting");
    };
    source.onopen = () => setLiveState("live");
    return () => {
      offLocal();
      if (recheckTimer) clearTimeout(recheckTimer);
      source.close();
    };
  }, [user.id]);
  // Section the user just clicked, shown as active (with a progress bar) until the route renders,
  // so a click is acknowledged immediately even while the server is still responding.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const searchParams = useSearchParams();
  const tab = searchParams?.get("tab") ?? null;

  const groups = useMemo(() => visibleGroups(user.role), [user.role]);
  const links = useMemo(() => allLinks(user.role), [user.role]);
  const currentKey = activeKey(links, pathname, tab);
  // A navigation is pending only until its destination is the current address. Derived on every
  // render: the green/orange switch sets the pending state inside a View Transition callback, which
  // can run after a cached route has already arrived; a stored flag then stayed stuck.
  const currentHref = pathname + (tab ? `?tab=${tab}` : "");
  const arrivedAt = (href: string) => href === currentHref || (href.split("?")[0] === pathname && !href.includes("?"));
  const navPending = pendingHref !== null && !arrivedAt(pendingHref);
  const shownKey = navPending ? pendingKey ?? currentKey : currentKey;
  const accent = sectionAccent(navPending && pendingHref ? pendingHref.split("?")[0] : pathname);
  const title = pageTitle(links, currentKey, pathname, user.fullName);

  // Tables never scroll sideways: narrow layouts show each row as a card (styles/glass.css).
  const mainRef = useRef<HTMLElement>(null);
  useStackedTables(mainRef);
  // Every inline dialog gets focus handling, Escape and aria in one place.
  useInlineDialogs(mainRef);

  // Collapsed rail, remembered on this device.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("rn-sidebar-collapsed") === "1");
    } catch {}
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem("rn-sidebar-collapsed", c ? "0" : "1");
      } catch {}
      return !c;
    });

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setPendingHref(null);
    setPendingKey(null);
  }, [pathname, tab]);
  // Also clear a pending state that was set after its destination had already arrived.
  useEffect(() => {
    if (pendingHref && arrivedAt(pendingHref)) {
      setPendingHref(null);
      setPendingKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHref, pathname, tab]);

  // Safety net: if a navigation is abandoned (e.g. a redirect back to the same page), stop the bar.
  useEffect(() => {
    if (!pendingHref) return;
    const timer = setTimeout(() => {
      setPendingHref(null);
      setPendingKey(null);
    }, 30000);
    return () => clearTimeout(timer);
  }, [pendingHref]);

  // Track connectivity & offline queue depth for mobile bar
  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateStatus = () => {
      setIsOnline(navigator.onLine);
      try {
        const raw = localStorage.getItem("erp_delivery_offline_queue_v1");
        if (raw) {
          const q = JSON.parse(raw);
          setOfflineQueueCount(
            q.filter(
              (i: any) =>
                (!i.userId || i.userId === user.id) &&
                (i.status === "PENDING" || i.status === "FAILED")
            ).length
          );
        } else {
          setOfflineQueueCount(0);
        }
      } catch {
        setOfflineQueueCount(0);
      }
    };

    // Replay queued delivery actions as soon as connectivity returns, without requiring
    // the driver to open the Offline Sync page.
    let syncing = false;
    const syncQueuedActions = async () => {
      updateStatus();
      if (syncing || !navigator.onLine) return;
      syncing = true;
      try {
        await processOfflineQueue(user.id);
      } catch {
        // Items stay queued (FAILED with retry count) and remain visible on /offline.
      } finally {
        syncing = false;
        updateStatus();
      }
    };

    updateStatus();
    if (navigator.onLine) void syncQueuedActions();
    window.addEventListener("online", syncQueuedActions);
    window.addEventListener("offline", updateStatus);
    const interval = setInterval(updateStatus, 3000);

    return () => {
      window.removeEventListener("online", syncQueuedActions);
      window.removeEventListener("offline", updateStatus);
      clearInterval(interval);
    };
  }, [user.id]);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string, key?: string) => {
    // Preserve standard browser behaviors for modified clicks (e.g. open in new tab)
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.button !== 0) {
      return;
    }
    setIsMobileMenuOpen(false);
    const current = pathname + (tab ? `?tab=${tab}` : "");
    if (current === href || (pathname === href && !href.includes("?"))) {
      e.preventDefault();
      return;
    }
    // Green <-> orange: the new section colour flows out from where the person clicked
    // (View Transitions where supported; otherwise the registered colour tokens cross-fade).
    const nextAccent = sectionAccent(href.split("?")[0]);
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (nextAccent !== accent && doc.startViewTransition && !reduce) {
      const root = document.documentElement;
      root.style.setProperty("--rn-vt-x", `${e.clientX}px`);
      root.style.setProperty("--rn-vt-y", `${e.clientY}px`);
      root.dataset.rnThemeFlow = "1";
      const t = doc.startViewTransition(() => {
        flushSync(() => {
          setPendingHref(href);
          if (key) setPendingKey(key);
        });
      });
      t.finished.finally(() => { delete root.dataset.rnThemeFlow; });
      return;
    }
    setPendingHref(href);
    if (key) setPendingKey(key);
  };

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    // Drop this user's cached data first (in-flight responses are discarded), then revoke the
    // session on the server before leaving. A hung request cannot keep the user on this screen.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      await forgetPushToken();
      clearErpCache();
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "X-RN-CSRF": "1" },
        signal: controller.signal,
      });
    } catch (err) {
      console.error("Logout error:", err);
    } finally {
      clearTimeout(timer);
      // Full document load wipes all in-memory state; replace() keeps the signed-in page out of
      // the Back history.
      window.location.replace("/login");
    }
  };

  // Delivery staff get a focused shell (website-style navbar, My Stops / My Cash / History).
  if (user.role === "DELIVERY_PERSON") {
    return (
      <DeliveryStaffShell user={user} onLogout={handleLogout} isLoggingOut={isLoggingOut} queuedCount={offlineQueueCount}>
        <CurrentUserProvider user={user}>{children}</CurrentUserProvider>
      </DeliveryStaffShell>
    );
  }

  return (
    <div className="rn-app min-h-screen" data-accent={accent === "orange" ? "orange" : undefined} data-rail={collapsed ? "collapsed" : "expanded"}>
      <div className="rn-canvas" aria-hidden />
      {navPending && <div className="erp-nav-progress" role="progressbar" aria-label="Opening page" />}

      {isLoggingOut && (
        <div className="fixed inset-0 z-[70] bg-[rgba(18,28,22,0.35)] backdrop-blur-[6px] flex items-center justify-center rn-scrim">
          <div className="rn-dialog rounded-3xl p-6 flex items-center gap-4 max-w-sm mx-4">
            <BikeLoader inline tone="forest" label="Signing out" className="shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[var(--rn-ink)]">Signing out…</p>
              <p className="text-xs text-[var(--rn-ink-3)]">Ending this session</p>
            </div>
          </div>
        </div>
      )}

      <AppSidebar
        user={user}
        groups={groups}
        active={shownKey}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onNavigate={handleNavClick}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
        pathname={pathname}
      />

      <MobileTopBar title={title} queued={offlineQueueCount} online={isOnline} />

      <div className={`relative min-w-0 ${collapsed ? "lg:pl-[116px]" : "lg:pl-[288px]"}`}>
        <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:pr-8 lg:pl-2">
          <TopBar user={user} title={shownKey === "dashboard" ? pageTitle(links, "dashboard", "/dashboard", user.fullName) : null} trail={trailFor(groups, shownKey, navPending && pendingHref ? pendingHref.split("?")[0] : pathname)} links={links} websiteUrl={websiteUrl} onLogout={handleLogout} isLoggingOut={isLoggingOut} />
          {/* While a section opens, its frame replaces the previous page at once (kept mounted, hidden). */}
          <main ref={mainRef} className="rn-main min-w-0 pb-28 lg:pb-12" data-nav-pending={navPending ? "" : undefined}>
            {navPending && pendingHref && <NavSkeleton href={pendingHref} title={pageTitle(links, pendingKey, pendingHref.split("?")[0], user.fullName)} />}
            <CurrentUserProvider user={user}>{children}</CurrentUserProvider>
            {(user.role === "SUPER_ADMIN" || user.role === "OPERATIONS_MANAGER") && <HandoverAlert />}
          </main>
        </div>
      </div>

      <MobileBottomBar links={links} active={shownKey} moreOpen={isMobileMenuOpen} onMore={() => setIsMobileMenuOpen(true)} onNavigate={handleNavClick} />
      {isMobileMenuOpen && (
        <MobileMoreSheet
          user={user}
          groups={groups}
          active={shownKey}
          onClose={() => setIsMobileMenuOpen(false)}
          onNavigate={handleNavClick}
          onLogout={handleLogout}
          websiteUrl={websiteUrl}
        />
      )}
    </div>
  );
}
