"use client";

import { useEffect, useRef } from "react";
import { executeErpFetch, getCacheAgeMs } from "@/lib/cache/erpDataCache";
import { businessToday, businessMeal } from "@/lib/businessDate";
import { getLocalFirstDayOfMonth, toLocalDateString } from "@/modules/finance/utils/dateUtils";
import type { UnifiedOrder, DeliveryTask, DeliveryManifestStatus, ResidentListItem, RoomWithOccupancy, TiffinCustomer, CashbookSummary, FinancialTransaction, DailyClosingPreview } from "@/types";

/**
 * The main data of each page, defined once: the page reads it with these keys and fetchers, and
 * the same definitions load it ahead of time (after sign-in, and when a finger touches a menu
 * link), so a page opens with its data already there instead of a placeholder.
 */
export interface PageQuery<T> {
  key: string;
  fetcher: () => Promise<T>;
  ttl: number;
  tags: string[];
}

async function json(url: string, fallback: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || fallback);
  return data;
}

export const ORDERS_POLL_MS = 20000;
export function ordersQuery(serviceDate: string, orderType: "ALL" | "DELIVERY" | "DINE_IN"): PageQuery<{ orders: UnifiedOrder[]; counts: { today: number; active: number; completed: number } }> {
  const key = `/api/orders?${new URLSearchParams({ serviceDate, orderType }).toString()}`;
  return {
    key,
    fetcher: async () => {
      const data = await json(key, "Failed to load orders");
      return { orders: data.orders || [], counts: data.counts || { today: 0, active: 0, completed: 0 } };
    },
    ttl: ORDERS_POLL_MS,
    tags: ["orders"],
  };
}

export const DELIVERY_LIVE_MS = 20000;
export function deliveryTasksQuery(serviceDate: string, mealType: string, assignedTo?: string): PageQuery<DeliveryTask[]> {
  const key = `/api/delivery/tasks?serviceDate=${serviceDate}&mealType=${mealType}&limit=500${assignedTo ? `&assignedTo=${encodeURIComponent(assignedTo)}` : ""}`;
  return {
    key,
    fetcher: async () => {
      const data = await json(key, "Could not load the deliveries.");
      return Array.isArray(data.tasks) ? data.tasks : [];
    },
    ttl: DELIVERY_LIVE_MS,
    tags: ["delivery"],
  };
}

export function manifestQuery(serviceDate: string, mealType: string): PageQuery<DeliveryManifestStatus> {
  const key = `/api/delivery/manifest?serviceDate=${serviceDate}&mealType=${mealType}`;
  return { key, fetcher: () => json(key, "Could not load the delivery list."), ttl: DELIVERY_LIVE_MS, tags: ["delivery"] };
}

export function residentsAndRoomsQuery(): PageQuery<{ residents: ResidentListItem[]; rooms: RoomWithOccupancy[] }> {
  return {
    key: "/api/residents-and-rooms",
    fetcher: async () => {
      const [r, m] = await Promise.all([json("/api/residents", "Failed to load residents"), json("/api/rooms", "Failed to load rooms")]);
      return { residents: r.residents || [], rooms: m.rooms || [] };
    },
    // Reference data: reused across visits for 5 min; resident/room mutations invalidate it at once.
    ttl: 300000,
    tags: ["residents", "rooms"],
  };
}

export function roomsQuery(): PageQuery<RoomWithOccupancy[]> {
  return { key: "/api/rooms", fetcher: async () => (await json("/api/rooms", "Failed to load rooms")).rooms || [], ttl: 300000, tags: ["rooms"] };
}

export function tiffinCustomersQuery(): PageQuery<{ customers: TiffinCustomer[] }> {
  return { key: "/api/tiffin/customers", fetcher: () => json("/api/tiffin/customers", "Failed to load tiffin customers"), ttl: 15000, tags: ["tiffin_customers", "customers"] };
}

export function financeBundleQuery(startDate: string, endDate: string): PageQuery<{ cashbook: CashbookSummary | null; transactions: FinancialTransaction[]; residents: ResidentListItem[] }> {
  const key = `/api/finance/bundle?startDate=${startDate}&endDate=${endDate}`;
  return {
    key,
    fetcher: async () => {
      const [s, t, r] = await Promise.all([
        json(`/api/finance/cashbook?startDate=${startDate}&endDate=${endDate}`, "Failed to load cashbook."),
        json(`/api/finance/transactions?startDate=${startDate}&endDate=${endDate}&limit=500`, "Failed to load transactions."),
        fetch("/api/residents", { cache: "no-store" }).then((x) => x.json()).catch(() => ({})),
      ]);
      return { cashbook: s.summary || null, transactions: t.transactions || [], residents: r.residents || [] };
    },
    // Balances can change through other staff (handovers, orders): reuse for 60s, never longer.
    ttl: 60000,
    tags: ["finance"],
  };
}

export function duesQuery(scope: string): PageQuery<any> {
  const key = `/api/finance/receivables?kind=${scope}&limit=500&sort=total`;
  return { key, fetcher: () => json(key, "Could not load. Please try again."), ttl: 15000, tags: ["finance", "receivables", "delivery", "tiffin", "residents"] };
}

/** Finance → Bills as it first opens (newest 40, no filters): the same key the Bills list reads. */
export function billsQuery(): PageQuery<any> {
  const key = "/api/finance/bills?limit=40";
  return { key, fetcher: () => json(key, "Could not load. Please try again."), ttl: 15000, tags: ["bills"] };
}

/** Daily closing for one day and one part of the business (All, PG or Tiffin). */
export function closingPreviewQuery(closingDate: string, division: string): PageQuery<DailyClosingPreview> {
  const key = `/api/finance/closing/preview?closingDate=${closingDate}&division=${division}`;
  return {
    key,
    fetcher: async () => (await json(key, "Failed to load closing preview.")).preview,
    ttl: 20000,
    tags: ["finance", "closing"],
  };
}

/** Loads a query ahead of time when it is missing or stale (quietly: no loading bar). */
export function prefetchQuery(q: PageQuery<any>): Promise<void> {
  const age = getCacheAgeMs(q.key);
  if (age !== null && age < q.ttl) return Promise.resolve();
  return executeErpFetch(q.key, q.fetcher, { ttl: q.ttl, tags: q.tags }).then(
    () => {},
    () => {}
  );
}

/**
 * Once the data on screen has loaded, loads the other choices of the same filter (the other
 * meals, divisions, periods...) quietly, one after another, so switching to any of them shows
 * its data at once. Choices already loaded and still fresh are skipped.
 */
export function usePrefetchChoices(queries: Array<PageQuery<any> | null | false | undefined>, ready: boolean): void {
  const keys = queries.map((q) => (q ? q.key : "")).join("|");
  const latest = useRef(queries);
  latest.current = queries;
  useEffect(() => {
    if (!ready || !keys) return;
    let stopped = false;
    const timer = window.setTimeout(async () => {
      for (const q of latest.current) {
        if (stopped) return;
        if (q) await prefetchQuery(q);
      }
    }, 400);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [keys, ready]);
}

/** What each section shows first, for loading it ahead of time. */
export function queriesForRoute(href: string, role: string): PageQuery<any>[] {
  const path = href.split("?")[0];
  const tab = new URLSearchParams(href.split("?")[1] || "").get("tab");
  const today = businessToday();
  const canFinance = role === "SUPER_ADMIN" || role === "OPERATIONS_MANAGER" || role === "ACCOUNTANT";
  switch (path) {
    case "/orders":
      return [ordersQuery(today, "ALL")];
    case "/delivery":
    case "/my-deliveries":
      return [deliveryTasksQuery(today, businessMeal()), manifestQuery(today, businessMeal())];
    case "/residents":
      return [residentsAndRoomsQuery()];
    case "/rooms":
      return [roomsQuery()];
    case "/tiffin":
      return [tiffinCustomersQuery()];
    case "/finance":
      if (!canFinance) return [];
      if (tab === "receivables") return [duesQuery("ALL")];
      if (tab === "invoices") return [billsQuery()];
      return [financeBundleQuery(getLocalFirstDayOfMonth(), toLocalDateString())];
    default:
      return [];
  }
}
