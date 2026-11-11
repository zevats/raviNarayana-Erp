"use client";

import { friendlyError } from "@/lib/friendlyError";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { announceNavigation } from "@/lib/navStart";
import { CheckCheck } from "lucide-react";
import type { NotificationItem } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { PageHeader, Card, Segmented } from "@/components/ui/kit";
import { StateMessage, LoadError, RefreshButton } from "@/components/ui/states";
import { FullPageLoader } from "@/components/feedback/FullPageLoader";
import { NotificationRows, markNotificationRead, markAllNotificationsRead, type NotificationFeed } from "@/components/notifications/NotificationBell";

/** Notification centre: every notification for this role, newest first, with read state. */
export default function NotificationsPage() {
  const router = useRouter();
  const [show, setShow] = useState<"all" | "unread">("all");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const key = `/api/notifications?limit=100${show === "unread" ? "&unreadOnly=true" : ""}`;
  const feed = useErpQuery<NotificationFeed>(
    key,
    async () => {
      const res = await fetch(key, { cache: "no-store" });
      if (!res.ok) throw new Error("Notifications could not be loaded.");
      const data = await res.json();
      return { notifications: data.notifications || [], unreadCount: data.unreadCount || 0 };
    },
    { ttl: 15000, tags: ["notifications"] }
  );
  const items = feed.data?.notifications ?? [];
  const unread = feed.data?.unreadCount ?? 0;

  const markOne = async (n: NotificationItem) => {
    setActionError(null);
    try {
      await markNotificationRead(n.id);
      invalidateErpCache(["notifications"]);
    } catch (e: any) {
      setActionError(friendlyError(e.message));
    }
  };
  const open = (n: NotificationItem) => {
    if (!n.isRead) void markOne(n);
    if (n.link) {
      announceNavigation(n.link);
      router.push(n.link);
    }
  };
  const markAll = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await markAllNotificationsRead();
      invalidateErpCache(["notifications"]);
    } catch (e: any) {
      setActionError(friendlyError(e.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 min-w-0">
      <PageHeader
        title="Notifications"
        actions={
          <>
            <Segmented label="Show" value={show} onChange={setShow} options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread", count: unread || undefined }]} />
            <RefreshButton onRefresh={() => feed.refetch()} busy={feed.isRevalidating} />
            <button type="button" className="rn-btn" onClick={markAll} disabled={busy || unread === 0}>
              <CheckCheck /> Mark all read
            </button>
          </>
        }
      />
      {actionError && <p role="alert" className="rn-notice rn-notice-bad">{actionError}</p>}
      <Card flush className="max-w-3xl">
        {feed.error && !feed.data ? (
          <LoadError message={feed.error.message} onRetry={() => feed.refetch()} title="Notifications could not be loaded" />
        ) : feed.isLoading && !feed.data ? (
          <FullPageLoader label="Loading notifications" size="md" />
        ) : items.length === 0 ? (
          show === "unread" ? (
            <StateMessage kind="empty" title="No unread notifications" action={<button type="button" className="rn-btn rn-btn-sm" onClick={() => setShow("all")}>Show all</button>} />
          ) : (
            <StateMessage kind="empty" title="No notifications" />
          )
        ) : (
          <div className="p-2">
            <NotificationRows items={items} onOpen={open} onMarkRead={markOne} />
          </div>
        )}
      </Card>
    </div>
  );
}
