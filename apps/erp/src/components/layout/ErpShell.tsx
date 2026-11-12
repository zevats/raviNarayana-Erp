"use client";

import { SignOutScreen } from "./shell/SignOutScreen";
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
import { Toaster } from "@/components/ui/toast";
import { BusyBar } from "@/components/feedback/BusyBar";
import { useSwitching } from "@/lib/busy";
import { DataPrefetch } from "@/components/layout/DataPrefetch";
import { Prewarm } from "@/components/feedback/Prewarm";
import { installActionFeedback } from "@/lib/actionFeedback";
import { resetScrollLock, installOverlayScrollLock } from "@/lib/scrollLock";

interface ErpShellProps {
  user: AuthenticatedUser;
  children: React.ReactNode;
  isDemo?: boolean;
  /** Public website address from Settings; the "Public Site" link is hidden when none is set. */
  websiteUrl?: string | null;
}

const ARRIVAL_SCRIPT =
  "try{var d=document.documentElement,t=+sessionStorage.getItem('rn-arrive');if(t&&Date.now()-t<30000&&!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)){sessionStorage.removeItem('rn-arrive');d.setAttribute('data-rn-arrive','');setTimeout(function(){d.removeAttribute('data-rn-arrive')},900)}else if(t){sessionStorage.removeItem('rn-arrive')}}catch(e){}";

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

  // Owner and Manager screens: every action answers with a message, and a date field with no date
  // says so instead of showing an empty box (phones draw nothing for an empty date).
  useEffect(() => {
    if (user.role === "DELIVERY_PERSON") return;
    const uninstall = installActionFeedback();
    let frame = 0;
    const mark = () => {
      frame = 0;
      document.querySelectorAll<HTMLInputElement>("input[type=date], input[type=month], input[type=time]").forEach((el) => {
        if (el.value) el.removeAttribute("data-empty");
        else el.setAttribute("data-empty", el.getAttribute("aria-label") || el.getAttribute("placeholder") || "Choose date");
      });
    };
    const queue = () => {
      if (!frame) frame = window.requestAnimationFrame(mark);
    };
    const observer = new MutationObserver(queue);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("input", queue, true);
    document.addEventListener("change", queue, true);
    document.addEventListener("click", queue, true);
    queue();
    return () => {
      uninstall();
      observer.disconnect();
      document.removeEventListener("input", queue, true);
      document.removeEventListener("change", queue, true);
      document.removeEventListener("click", queue, true);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [user.role]);

  // The page does not scroll behind any open pop-up (one cheap check per frame of changes).
  useEffect(() => installOverlayScrollLock(), []);

  // A page change never leaves the page locked by a pop-up that the navigation closed.
  useEffect(() => {
    const t = window.setTimeout(resetScrollLock, 400);
    return () => window.clearTimeout(t);
  }, [pathname]);

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
  const linksRef = useRef(links);
  linksRef.current = links;
  const currentKey = activeKey(links, pathname, tab);
  // A navigation is pending only until its destination is the current address. Derived on every
  // render: the green/orange switch sets the pending state inside a View Transition callback, which
  // can run after a cached route has already arrived; a stored flag then stayed stuck.
  const currentHref = pathname + (tab ? `?tab=${tab}` : "");
  const arrivedAt = (href: string) => href === currentHref || (href.split("?")[0] === pathname && !href.includes("?"));
  const navPending = pendingHref !== null && !arrivedAt(pendingHref);
  // New rows for a filter, date or tab on their way: the page's lists dim until they arrive.
  const switching = useSwitching();
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
    setPendingHref(null);
    setPendingKey(null);
    // A new page always opens at its top, never at the previous page's scroll position.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname, tab]);
  // Also clear a pending state that was set after its destination had already arrived.
  useEffect(() => {
    if (pendingHref && arrivedAt(pendingHref)) {
      setPendingHref(null);
      setPendingKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHref, pathname, tab]);

  // Any in-app link (dashboard tiles, list rows, notifications) shows the destination's frame at
  // once, like the menu links do; navigations made in code announce themselves (lib/navStart).
  useEffect(() => {
    const begin = (href: string) => {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const target = url.pathname + url.search;
      const here = window.location.pathname + window.location.search;
      if (url.pathname === window.location.pathname || target === here) return;
      setPendingHref(target);
      setPendingKey(activeKey(linksRef.current, url.pathname, url.searchParams.get("tab")));
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) return;
      begin(href);
    };
    const onAnnounce = (e: Event) => begin(String((e as CustomEvent).detail || ""));
    document.addEventListener("click", onClick);
    window.addEventListener("erp:nav-start", onAnnounce);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("erp:nav-start", onAnnounce);
    };
  }, []);

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
    const current = pathname + (tab ? `?tab=${tab}` : "");
    if (current === href || (pathname === href && !href.includes("?"))) {
      e.preventDefault();
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
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
      {/* First paint after signing in: plays the arrival (glass.css "Sign-in blend"). Runs while the
          page is parsed, before anything is drawn, so nothing shows first and then animates. */}
      <script dangerouslySetInnerHTML={{ __html: ARRIVAL_SCRIPT }} />
      <style>{"@view-transition { navigation: auto; }"}</style>
      <div className="rn-canvas" aria-hidden />
      <Toaster />
      <BusyBar />
      <DataPrefetch role={user.role} />
      {navPending && <div className="erp-nav-progress" role="progressbar" aria-label="Opening page" />}

      {isLoggingOut && <SignOutScreen />}

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

      <MobileTopBar title={title} queued={offlineQueueCount} online={isOnline} onAccount={(e) => handleNavClick(e, "/account", "account")} onHome={(e) => handleNavClick(e, "/dashboard", "dashboard")} />

      <div className={`relative min-w-0 transition-[padding] duration-200 ease-out ${collapsed ? "lg:pl-[116px]" : "lg:pl-[288px]"}`}>
        <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:pr-8 lg:pl-2">
          <TopBar user={user} title={shownKey === "dashboard" ? pageTitle(links, "dashboard", "/dashboard", user.fullName) : null} trail={trailFor(groups, shownKey, navPending && pendingHref ? pendingHref.split("?")[0] : pathname)} links={links} websiteUrl={websiteUrl} onLogout={handleLogout} isLoggingOut={isLoggingOut} />
          {/* While a section opens, its frame replaces the previous page at once (kept mounted, hidden). */}
          <main ref={mainRef} className="rn-main min-w-0 pt-4 lg:pt-0 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-12" data-nav-pending={navPending ? "" : undefined} data-switching={switching ? "" : undefined}>
            {/* Phones: every page opens with its name, large (the dashboard greets instead). */}
            {shownKey !== "dashboard" && (
              <h1 className="lg:hidden rn-m-title">{navPending && pendingHref ? pageTitle(links, pendingKey, pendingHref.split("?")[0], user.fullName) : title}</h1>
            )}
            {navPending && pendingHref && <NavSkeleton href={pendingHref} title={pageTitle(links, pendingKey, pendingHref.split("?")[0], user.fullName)} />}
            <CurrentUserProvider user={user}>{children}</CurrentUserProvider>
            {user.role === "SUPER_ADMIN" && <HandoverAlert />}
          </main>
        </div>
      </div>

      <MobileNavArea
        links={links}
        active={shownKey}
        pathname={pathname}
        user={user}
        groups={groups}
        onNavigate={handleNavClick}
        onLogout={handleLogout}
        websiteUrl={websiteUrl}
      />
    </div>
  );
}

/**
 * The phone's bottom bar and its More sheet. The sheet's open state lives here, so opening it
 * redraws only the bar and the sheet (not the whole app around the page).
 */
function MobileNavArea({
  links,
  active,
  pathname,
  user,
  groups,
  onNavigate,
  onLogout,
  websiteUrl,
}: {
  links: React.ComponentProps<typeof MobileBottomBar>["links"];
  active: React.ComponentProps<typeof MobileBottomBar>["active"];
  pathname: string;
  user: React.ComponentProps<typeof MobileMoreSheet>["user"];
  groups: React.ComponentProps<typeof MobileMoreSheet>["groups"];
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, href: string, key?: string) => void;
  onLogout: React.ComponentProps<typeof MobileMoreSheet>["onLogout"];
  websiteUrl: React.ComponentProps<typeof MobileMoreSheet>["websiteUrl"];
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  // The bar and its sheet are drawn on phones only.
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(!window.matchMedia("(min-width: 1024px)").matches), []);
  const navigate = (e: React.MouseEvent<HTMLAnchorElement>, href: string, key?: string) => {
    if (!(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.button !== 0)) setOpen(false);
    onNavigate(e, href, key);
  };
  return (
    <>
      <MobileBottomBar links={links} active={active} moreOpen={open} onMore={() => setOpen(true)} onNavigate={navigate} />
      {open && <MobileMoreSheet user={user} groups={groups} active={active} onClose={() => setOpen(false)} onNavigate={navigate} onLogout={onLogout} websiteUrl={websiteUrl} />}
      <Prewarm when={phone && !open}>{() => <MobileMoreSheet user={user} groups={groups} active={active} onClose={noop} onNavigate={noop} onLogout={noop} websiteUrl={websiteUrl} />}</Prewarm>
    </>
  );
}

const noop = () => {};
