"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { NotificationItem } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { StateMessage } from "@/components/ui/states";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { formatDateTime } from "@/lib/format";

// The shell renders a bell in both the desktop and the mobile header. They share this cached
// query, so a single poll every 30s (while visible) serves both instead of two polling loops.
const NOTIFICATIONS_KEY = "/api/notifications?limit=15";
const NOTIFICATIONS_POLL_MS = 30000;

export type NotificationFeed = { notifications: NotificationItem[]; unreadCount: number };

export async function markNotificationRead(id: string) {
  const res = await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mark_read", notificationId: id }),
  });
  if (!res.ok) throw new Error("Could not mark it as read.");
}

export async function markAllNotificationsRead() {
  const res = await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mark_all_read" }),
  });
  if (!res.ok) throw new Error("Could not mark them as read.");
}

export function formatNotificationTime(ts: string) {
  try {
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? formatDateTime(d, "en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
      : formatDateTime(d, "en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  } catch {
    return "";
  }
}

function TypeIcon({ type }: { type: NotificationItem["type"] }) {
  const cls =
    type === "ALERT" ? "bg-[#FBEDE8] text-[#9A3423]" : type === "WARNING" ? "bg-[#FBF4E6] text-[#8F6710]" : type === "SUCCESS" ? "bg-[#E6F1E4] text-[#2F6B24]" : "bg-[var(--rn-accent-tint)] text-[var(--rn-accent-mid)]";
  const Icon = type === "ALERT" || type === "WARNING" ? AlertTriangle : type === "SUCCESS" ? CheckCircle2 : Info;
  return (
    <span className={`grid place-items-center w-9 h-9 rounded-full shrink-0 ${cls}`} aria-hidden>
      <Icon className="w-4 h-4" />
    </span>
  );
}

/** One list of notifications, used by the header panel and the notification centre page. */
export function NotificationRows({ items, onOpen, onMarkRead }: { items: NotificationItem[]; onOpen: (n: NotificationItem) => void; onMarkRead: (n: NotificationItem) => void }) {
  return (
    <ul className="rn-rows">
      {items.map((n) => (
        <li key={n.id} className="flex items-start gap-3 px-3 py-3">
          <TypeIcon type={n.type} />
          <button type="button" onClick={() => onOpen(n)} className="flex-1 min-w-0 text-left rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--rn-accent-mid)]">
            <span className="flex items-baseline justify-between gap-2">
              <span className={`text-[13.5px] truncate ${n.isRead ? "text-[var(--rn-ink-2)]" : "text-[var(--rn-ink)] font-semibold"}`}>{n.title}</span>
              <span className="rn-t-meta shrink-0 tabular-nums">{formatNotificationTime(n.timestamp)}</span>
            </span>
            <span className="block rn-t-meta mt-0.5 line-clamp-2">{n.description}</span>
          </button>
          {!n.isRead && (
            <button type="button" onClick={() => onMarkRead(n)} aria-label={`Mark "${n.title}" as read`} title="Mark as read" className="mt-1 grid place-items-center w-7 h-7 rounded-full hover:bg-[var(--rn-accent-tint)] shrink-0">
              <span className="w-2 h-2 rounded-full bg-[var(--rn-accent)]" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function NotificationBell() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const feed = useErpQuery<NotificationFeed>(
    NOTIFICATIONS_KEY,
    async () => {
      const res = await fetch(NOTIFICATIONS_KEY);
      if (!res.ok) throw new Error("Notifications could not be loaded.");
      const data = await res.json();
      return { notifications: data.notifications || [], unreadCount: data.unreadCount || 0 };
    },
    { ttl: NOTIFICATIONS_POLL_MS, tags: ["notifications"], pollIntervalMs: NOTIFICATIONS_POLL_MS }
  );
  const notifications = feed.data?.notifications ?? [];
  const unreadCount = feed.data?.unreadCount ?? 0;
  const updateFeed = (fn: (current: NotificationFeed) => NotificationFeed) =>
    feed.mutate((current) => fn(current ?? { notifications: [], unreadCount: 0 }), false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close on outside click or Escape (focus goes back to the bell).
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (event: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setIsOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    // Keyboard users land inside the panel.
    dropdownRef.current?.querySelector<HTMLElement>("[role=dialog] button, [role=dialog] a")?.focus({ preventScroll: true });
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("keydown", onKey); };
  }, [isOpen]);

  const markOne = async (n: NotificationItem) => {
    setActionError(null);
    updateFeed((cur) => ({ notifications: cur.notifications.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)), unreadCount: Math.max(0, cur.unreadCount - (n.isRead ? 0 : 1)) }));
    try {
      await markNotificationRead(n.id);
      invalidateErpCache(["notifications"]);
    } catch (e: any) {
      setActionError(e.message);
      feed.refetch();
    }
  };

  const markAll = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await markAllNotificationsRead();
      updateFeed((cur) => ({ notifications: cur.notifications.map((n) => ({ ...n, isRead: true })), unreadCount: 0 }));
      invalidateErpCache(["notifications"]);
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const open = (n: NotificationItem) => {
    if (!n.isRead) void markOne(n);
    setIsOpen(false);
    if (n.link) router.push(n.link);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="relative grid place-items-center w-10 h-10 rounded-full text-[var(--rn-ink-2)] hover:text-[var(--rn-ink)] transition-colors"
      >
        <Bell className="w-[18px] h-[18px]" strokeWidth={1.8} />
        {unreadCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 bg-[var(--rn-accent)] text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white tabular-nums">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div role="dialog" aria-label="Notifications" className="rn-pop rn-menu absolute right-0 mt-3 w-[min(380px,calc(100vw-1.5rem))] rounded-3xl z-50 overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--rn-line)] flex items-center justify-between gap-3">
            <p className="rn-t-card">Notifications{unreadCount > 0 && <span className="rn-t-meta font-normal"> · {unreadCount} unread</span>}</p>
            {unreadCount > 0 && (
              <button type="button" onClick={markAll} disabled={busy} className="rn-btn rn-btn-sm">
                <CheckCheck /> Mark all read
              </button>
            )}
          </div>
          {actionError && <p role="alert" className="rn-notice rn-notice-bad m-3">{actionError}</p>}
          <div className="max-h-[min(420px,60dvh)] overflow-y-auto px-2 py-1">
            {feed.error && !feed.data ? (
              <StateMessage kind="error" title="Notifications could not be loaded" compact action={<button type="button" className="rn-btn rn-btn-sm" onClick={() => feed.refetch()}>Try again</button>} />
            ) : feed.isLoading && !feed.data ? (
              <BikeLoader label="Loading notifications" size="sm" className="py-8" />
            ) : notifications.length === 0 ? (
              <StateMessage kind="empty" title="No notifications" compact>You are all caught up.</StateMessage>
            ) : (
              <NotificationRows items={notifications} onOpen={open} onMarkRead={markOne} />
            )}
          </div>
          <div className="p-2 border-t border-[var(--rn-line)]">
            <Link href="/notifications" onClick={() => setIsOpen(false)} className="rn-menu-item justify-center">
              All notifications
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
