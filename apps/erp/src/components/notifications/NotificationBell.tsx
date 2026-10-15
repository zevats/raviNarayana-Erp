"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  CheckCheck,
  AlertTriangle,
  Info,
  DollarSign,
  Truck,
  Utensils,
  ExternalLink,
} from "lucide-react";
import { NotificationItem, NotificationDomain } from "@/types";

export function NotificationBell() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications?limit=15");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setNotifications(data.notifications || []);
          setUnreadCount(data.unreadCount || 0);
        }
      }
    } catch (err) {
      console.error("Failed to fetch notifications:", err);
    }
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const markAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_read", notificationId: id }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Failed to mark notification as read:", err);
    }
  };

  const markAllAsRead = async () => {
    try {
      setIsLoading(true);
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_all_read" }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error("Failed to mark all as read:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNotificationClick = (item: NotificationItem) => {
    if (!item.isRead) {
      markAsRead(item.id);
    }
    setIsOpen(false);
    if (item.link) {
      router.push(item.link);
    }
  };

  const getDomainIcon = (domain: NotificationDomain, type: string) => {
    switch (domain) {
      case "FINANCE":
        return <DollarSign className="w-4 h-4 text-[#B58A57]" />;
      case "DELIVERY":
        return <Truck className="w-4 h-4 text-[#263B2D]" />;
      case "KITCHEN":
        return <Utensils className="w-4 h-4 text-[#5A6C5E]" />;
      default:
        return type === "ALERT" ? (
          <AlertTriangle className="w-4 h-4 text-rose-500" />
        ) : (
          <Info className="w-4 h-4 text-[#1A2E20]" />
        );
    }
  };

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Notifications (${unreadCount} unread)`}
        className="relative p-2 rounded-lg text-[#5A6C5E] hover:text-[#1A2E20] hover:bg-[#FAF8F5] transition-colors focus:outline-hidden"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-[#B58A57] text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs border-2 border-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-[#8E9F89]/25 rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="px-4 py-3 bg-[#FAF8F5] border-b border-[#8E9F89]/20 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#1A2E20]">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="text-[10px] bg-[#1A2E20] text-white font-semibold px-2 py-0.5 rounded-full">
                  {unreadCount} unread
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                disabled={isLoading}
                className="text-[11px] font-medium text-[#B58A57] hover:text-[#654735] flex items-center gap-1 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {/* List of Notifications */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-[#8E9F89]/10">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#5A6C5E]">
                No notifications right now.
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleNotificationClick(item)}
                  className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors hover:bg-[#FAF8F5]/80 ${
                    item.isRead ? "opacity-75" : "bg-[#FAF8F5]/30 font-medium"
                  }`}
                >
                  {/* Domain Icon Badge */}
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                      item.type === "ALERT"
                        ? "bg-rose-50 border-rose-200"
                        : item.type === "WARNING"
                        ? "bg-amber-50 border-amber-200"
                        : item.type === "SUCCESS"
                        ? "bg-emerald-50 border-emerald-200"
                        : "bg-white border-[#8E9F89]/20"
                    }`}
                  >
                    {getDomainIcon(item.domain, item.type)}
                  </div>

                  {/* Text Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-semibold text-[#1A2E20] truncate">
                        {item.title}
                      </p>
                      <span className="text-[10px] text-[#5A6C5E]/70 shrink-0">
                        {formatTime(item.timestamp)}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#5A6C5E] mt-0.5 line-clamp-2">
                      {item.description}
                    </p>
                  </div>

                  {/* Actions / Read Indicator */}
                  <div className="shrink-0 flex items-center self-center pl-1">
                    {!item.isRead ? (
                      <button
                        type="button"
                        onClick={(e) => markAsRead(item.id, e)}
                        title="Mark as read"
                        className="p-1 rounded-full text-[#8E9F89] hover:text-[#1A2E20] hover:bg-[#8E9F89]/10"
                      >
                        <span className="w-2 h-2 rounded-full bg-[#B58A57] block" />
                      </button>
                    ) : (
                      <Check className="w-3.5 h-3.5 text-[#8E9F89]/60" />
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-2.5 bg-[#FAF8F5] border-t border-[#8E9F89]/20 text-center">
            <Link
              href="/dashboard#notifications"
              onClick={() => setIsOpen(false)}
              className="text-[11px] font-semibold text-[#1A2E20] hover:text-[#B58A57] transition-colors"
            >
              Open Notification Center &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
