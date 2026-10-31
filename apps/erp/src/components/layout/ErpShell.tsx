"use client";

import React, { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  BedDouble,
  CreditCard,
  UtensilsCrossed,
  Truck,
  ShoppingBag,
  UserCog,
  LogOut,
  Menu,
  X,
  ExternalLink,
  Calendar,
  Wifi,
  WifiOff,
} from "lucide-react";
import { AuthenticatedUser, StaffRole, ROLE_LABELS, ROLE_BADGE_STYLES } from "@/types";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { clearErpCache, setCacheOwner, onErpCacheInvalidated, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { processOfflineQueue } from "@/modules/delivery/offlineQueue";
import { CurrentUserProvider } from "@/components/auth/CurrentUserContext";
import { DeliveryStaffShell } from "./DeliveryStaffShell";
import { UserAvatar } from "@/components/brand/BrandMark";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { forgetPushToken } from "@/lib/native";
import { rememberBrand } from "@/lib/brand";

interface ErpShellProps {
  user: AuthenticatedUser;
  children: React.ReactNode;
  isDemo?: boolean;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  requiredRoles?: StaffRole[];
}

const navItems: NavItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    requiredRoles: ["SUPER_ADMIN", "OPERATIONS_MANAGER"],
  },
  {
    name: "Rooms & Inventory",
    href: "/rooms",
    icon: BedDouble,
    requiredRoles: ["SUPER_ADMIN", "OPERATIONS_MANAGER"],
  },
  {
    name: "Residents & Stays",
    href: "/residents",
    icon: Users,
    requiredRoles: ["SUPER_ADMIN", "OPERATIONS_MANAGER"],
  },
  {
    name: "Finance & Cashbook",
    href: "/finance",
    icon: CreditCard,
    requiredRoles: ["SUPER_ADMIN", "OPERATIONS_MANAGER"],
  },
  {
    name: "Orders",
    href: "/orders",
    icon: ShoppingBag,
    requiredRoles: ["SUPER_ADMIN", "OPERATIONS_MANAGER"],
  },
  {
    name: "Delivery",
    href: "/delivery",
    icon: Truck,
    requiredRoles: ["SUPER_ADMIN", "OPERATIONS_MANAGER", "DELIVERY_PERSON"],
  },
  {
    name: "Staff Administration",
    href: "/staff",
    icon: UserCog,
    requiredRoles: ["SUPER_ADMIN"],
  },
];

export function ErpShell({ user, children, isDemo = false }: ErpShellProps) {
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
      timer = setTimeout(() => router.refresh(), 150);
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
        const { tags } = JSON.parse((ev as MessageEvent).data) as { tags: string[] };
        // A view this tab refreshed itself moments ago may only be hearing the echo of its own save,
        // but someone else may have written too: refresh it once more just after the echo window
        // instead of dropping the signal (dropping it hid a new order for up to one poll).
        const now = Date.now();
        const fresh = tags.filter((t) => now - (lastLocal.get(t) || 0) > 2000);
        const recent = tags.filter((t) => !fresh.includes(t));
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
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const activeHref = pendingHref ?? pathname;
  const [isOnline, setIsOnline] = useState(true);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);

  const visibleNavItems = navItems.filter(
    (item) => !item.requiredRoles || item.requiredRoles.includes(user.role)
  );

  // Role-optimized bottom navigation items for mobile devices
  const mobileBarItems = useMemo(() => {
    if (user.role === "DELIVERY_PERSON") {
      return visibleNavItems.filter((i) => i.href === "/delivery");
    }
    if (user.role === "OPERATIONS_MANAGER") {
      const preferred = ["/dashboard", "/residents", "/orders", "/delivery"];
      const matched = preferred
        .map((href) => visibleNavItems.find((i) => i.href === href))
        .filter(Boolean) as NavItem[];
      return matched.length === 4 ? matched : visibleNavItems.slice(0, 4);
    }
    if (user.role === "SUPER_ADMIN") {
      const preferred = ["/dashboard", "/residents", "/orders", "/delivery"];
      const matched = preferred
        .map((href) => visibleNavItems.find((i) => i.href === href))
        .filter(Boolean) as NavItem[];
      return matched.length === 4 ? matched : visibleNavItems.slice(0, 4);
    }
    return visibleNavItems.slice(0, 4);
  }, [user.role, visibleNavItems]);

  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const roleStyle = ROLE_BADGE_STYLES[user.role] || {
    bg: "bg-[#1A2E20]/10",
    text: "text-[#1A2E20]",
    border: "border-[#1A2E20]/25",
  };

  useEffect(() => {
    setIsMobileMenuOpen(false);
    setPendingHref(null);
  }, [pathname]);

  // Safety net: if a navigation is abandoned (e.g. a redirect back to the same page), stop the bar.
  useEffect(() => {
    if (!pendingHref) return;
    const timer = setTimeout(() => setPendingHref(null), 15000);
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

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    // Preserve standard browser behaviors for modified clicks (e.g. open in new tab)
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.button !== 0) {
      return;
    }

    // Ignore clicks to the currently active page
    if (pathname === href) {
      e.preventDefault();
      setPendingHref(null);
      return;
    }

    setPendingHref(href);

    // Allow Next.js native <Link> routing to execute immediately on the fast path
    // without startTransition holding the current view or redundant manual router.push
  };

  const currentDateStr = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date());

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
    <div className="min-h-screen bg-[#FAF8F5] flex flex-col lg:flex-row font-sans">
      {pendingHref && <div className="erp-nav-progress" role="progressbar" aria-label="Opening page" />}
      
      {/* Immediate Logout Revocation Feedback Modal */}
      {isLoggingOut && (
        <div className="fixed inset-0 z-50 bg-[#1A2E20]/60 backdrop-blur-xs flex items-center justify-center transition-all animate-fadeIn">
          <div className="bg-white rounded-2xl p-6 shadow-2xl border border-[#8E9F89]/30 flex items-center gap-4 max-w-sm mx-4">
            <BikeLoader inline tone="forest" label="Signing out" className="shrink-0" />
            <div>
              <p className="text-sm font-semibold text-[#1A2E20]">Signing out safely…</p>
              <p className="text-xs text-[#5E7060]">Revoking active session credentials</p>
            </div>
          </div>
        </div>
      )}
      
      {/* ============================================================== */}
      {/* DESKTOP SIDEBAR (Botanical Deep Evergreen Luxury)              */}
      {/* ============================================================== */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 xl:w-72 bg-[#1A2E20] text-white border-r border-[#263B2D] fixed inset-y-0 left-0 z-30 overflow-hidden select-none">
        
        {/* Brand Area */}
        <div className="p-5 border-b border-white/10 flex items-center gap-3.5">
          <div className="overflow-hidden">
            <h1 className="text-sm font-semibold tracking-wide text-white leading-tight">
              Ravinarayan
            </h1>
            <p className="text-[11px] font-medium text-[#C89F6B] tracking-wide mt-0.5">
              Management ERP
            </p>
          </div>
        </div>

        {/* Navigation Group: OPERATIONS */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-hidden" aria-label="Operations Navigation">
          <div className="px-3 mb-2 text-[11px] uppercase tracking-wider text-[#A8B9A1] font-semibold">
            OPERATIONS
          </div>

          {visibleNavItems.map((item) => {
            const isActive = activeHref === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                prefetch={true}
                onClick={(e) => handleNavClick(e, item.href)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? "bg-[#263B2D] text-white shadow-xs border-l-4 border-[#B58A57] pl-3"
                    : "text-white/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      isActive ? "text-[#C89F6B]" : "text-white/60"
                    }`}
                  />
                  <span className="truncate">{item.name}</span>
                </div>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#C89F6B] shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Account Area */}
        <div className="p-4 border-t border-white/10 bg-[#16221A]">
          <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined} onClick={(e) => handleNavClick(e, "/account")} title="My account" className={`flex items-center gap-3 mb-3 overflow-hidden rounded-xl -m-1 p-1 hover:bg-white/5${pathname === "/account" ? " pointer-events-none" : ""}`}>
            <UserAvatar size={36} tone="dark" />
            <div className="overflow-hidden min-w-0">
              <p className="text-xs font-semibold text-white truncate">
                {user.fullName}
              </p>
              <p className="text-[11px] text-[#A8B9A1] font-medium truncate mt-0.5">
                {roleLabel}{pathname === "/account" ? "" : " · My account"}
              </p>
            </div>
          </Link>

          <div className="pt-2.5 border-t border-white/10 flex items-center justify-between">
            <a
              href="http://localhost:3000"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-white/60 hover:text-white transition-colors"
              title="Open public website"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Public Site</span>
            </a>

            <button
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="inline-flex items-center gap-1.5 text-[11px] text-[#C89F6B] hover:text-white transition-colors font-medium"
            >
              <LogOut className="w-3 h-3" />
              <span>{isLoggingOut ? "Signing Out..." : "Sign Out"}</span>
            </button>
          </div>
        </div>

      </aside>

      {/* ============================================================== */}
      {/* MOBILE TOP BAR (Safe Area & Touch Ready)                       */}
      {/* ============================================================== */}
      <header className="lg:hidden bg-[#1A2E20] text-white border-b border-[#263B2D] px-4 py-3 flex items-center justify-between sticky top-0 z-40 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-sm font-semibold tracking-wide text-white leading-none">
              Ravinarayan
            </h1>
            <span className="text-[10px] text-[#C89F6B] font-medium">
              {roleLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Connection & Queue Badge */}
          {(!isOnline || offlineQueueCount > 0) && <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium ${
              isOnline
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
            }`}
          >
            {isOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
            <span>{isOnline ? "To send" : "Offline"}</span>
            {offlineQueueCount > 0 && (
              <span className="bg-amber-400 text-[#1A2E20] font-bold px-1 rounded-full text-[9px]">
                {offlineQueueCount}
              </span>
            )}
          </span>}

          <NotificationBell />

          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle navigation menu"
            className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors min-w-[36px] min-h-[36px] flex items-center justify-center"
          >
            {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Drawer */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end">
          <div className="bg-[#1A2E20] text-white border-t border-[#263B2D] p-6 max-h-[85dvh] overflow-y-auto rounded-t-3xl shadow-2xl space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-3">
                <UserAvatar size={36} tone="dark" />
                <div>
                  <h3 className="text-sm font-semibold text-white">{user.fullName}</h3>
                  <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined} onClick={(e) => { setIsMobileMenuOpen(false); handleNavClick(e, "/account"); }} className={`text-xs text-[#C89F6B] underline-offset-2 hover:underline${pathname === "/account" ? " pointer-events-none" : ""}`}>
                    {roleLabel}{pathname === "/account" ? "" : " · My account"}
                  </Link>
                </div>
              </div>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1.5 text-white/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="space-y-1">
              {visibleNavItems.map((item) => {
                const isActive = activeHref === item.href;
                const Icon = item.icon;

                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    prefetch={true}
                    onClick={(e) => handleNavClick(e, item.href)}
                    className={`flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-medium ${
                      isActive
                        ? "bg-[#263B2D] text-white border-l-4 border-[#B58A57] pl-3"
                        : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon
                        className={`w-4 h-4 shrink-0 transition-colors ${
                          isActive ? "text-[#C89F6B]" : "text-white/60"
                        }`}
                      />
                      <span>{item.name}</span>
                    </div>
                  </Link>
                );
              })}
            </nav>

            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              <a
                href="http://localhost:3000"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-white/70 hover:text-white flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Public Site</span>
              </a>

              <button
                onClick={handleLogout}
                className="text-xs text-[#C89F6B] hover:text-white flex items-center gap-1.5 font-medium"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MAIN CONTENT AREA                                              */}
      {/* ============================================================== */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-64 xl:pl-72">
        
        {/* Desktop Top Header Bar */}
        <header className="hidden lg:flex items-center justify-between px-4 sm:px-6 lg:px-8 py-3.5 bg-white border-b border-[#8E9F89]/20 sticky top-0 z-20 shadow-2xs min-w-0 flex-wrap gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#1A2E20] truncate">
              Ravinarayan Management
            </h2>
          </div>

          <div className="flex items-center gap-3 sm:gap-5 flex-wrap min-w-0">
            <div className="flex items-center gap-2 text-xs text-[#5A6C5E] whitespace-nowrap">
              <Calendar className="w-3.5 h-3.5 text-[#B58A57] shrink-0" />
              <span>{currentDateStr}</span>
            </div>

                        <NotificationBell />

            <div className="h-4 w-[1px] bg-[#8E9F89]/25 shrink-0" />

            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium border shrink-0 ${roleStyle.bg} ${roleStyle.text} ${roleStyle.border}`}
              >
                {roleLabel}
              </span>
              <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined} onClick={(e) => handleNavClick(e, "/account")} className={`text-xs text-[#1A2E20] font-medium truncate hover:underline${pathname === "/account" ? " pointer-events-none" : ""}`} title="My account">
                {user.fullName}
              </Link>
            </div>
          </div>
        </header>

        {/* Content Container */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto min-w-0 pb-24 lg:pb-8">
          <CurrentUserProvider user={user}>{children}</CurrentUserProvider>
        </main>

        {/* Footer */}
        <footer className="hidden lg:flex px-6 py-4 bg-white border-t border-[#8E9F89]/20 text-xs text-[#5A6C5E] items-center justify-between gap-2">
          <p>
            &copy; {new Date().getFullYear()} Ravinarayan PG Guesthouse. Internal Management ERP.
          </p>
          <p className="text-[11px] text-[#8E9F89]">
            Operational Management Portal
          </p>
        </footer>

        {/* ============================================================== */}
        {/* MOBILE BOTTOM NAVIGATION BAR (Role-Aware & Touch-Optimized)     */}
        {/* ============================================================== */}
        <nav
          data-bottom-bar
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#8E9F89]/20 shadow-lg pb-safe"
          aria-label="Mobile Navigation"
        >
          {(
            /* Management Staff Mobile Bottom Bar (Role-Aware) */
            <div className="grid grid-cols-5 h-16 max-w-lg mx-auto items-stretch">
              {mobileBarItems.map((item) => {
                const isActive = activeHref === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    prefetch={true}
                    onClick={(e) => handleNavClick(e, item.href)}
                    className={`flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                      isActive
                        ? "text-[#1A2E20] font-semibold"
                        : "text-[#5E7060] hover:text-[#1A2E20]"
                    }`}
                  >
                    <div className={`p-1 rounded-lg ${isActive ? "bg-[#1A2E20]/10 text-[#1A2E20]" : ""}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="truncate max-w-[56px] text-center">{item.name}</span>
                  </Link>
                );
              })}

              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                aria-expanded={isMobileMenuOpen}
                aria-haspopup="dialog"
                className="flex flex-col items-center justify-center gap-1 text-[10px] font-medium text-[#5E7060] hover:text-[#1A2E20] transition-colors"
              >
                <div className="p-1 rounded-lg">
                  <Menu className="w-4 h-4" />
                </div>
                <span>More</span>
              </button>
            </div>
          )}
        </nav>

      </div>
    </div>
  );
}
