"use client";

import { useEffect, useRef, useState } from "react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { requestJson, postJsonRequest } from "@/lib/http/requestJson";
import type {
  DeliveryTask,
  DeliveryTaskEvent,
  DeliveryManifestStatus,
  DeliveryManifestRunResult,
  DeliveryCloseout,
  DeliveryHistoryDay,
  MealType,
  SubscriptionDayRow,
  ResidentMealDeliveryRow,
  DeliveryDayListing,
} from "@/types";

/** Delivery data changes while staff work; 20 s polling is the fallback behind live updates. */
export const LIVE_MS = 20000;

export async function getJson<T>(url: string): Promise<T> {
  return requestJson<T>(url);
}

/** POST helper: throws the server's message (including the 409 "migration not installed"). */
export async function postJson<T = any>(url: string, body: unknown): Promise<T> {
  return postJsonRequest<T>(url, body);
}

/** Every delivery of the date and meal, unfiltered (totals are computed from this, never from a search). */
export function useDeliveryTasks(serviceDate: string, mealType: MealType, enabled = true) {
  const key = enabled ? `/api/delivery/tasks?serviceDate=${serviceDate}&mealType=${mealType}&limit=500` : null;
  return useErpQuery<DeliveryTask[]>(
    key,
    async () => {
      const data = await getJson<{ tasks: DeliveryTask[] }>(key as string);
      return Array.isArray(data.tasks) ? data.tasks : [];
    },
    { ttl: LIVE_MS, tags: ["delivery"], pollIntervalMs: LIVE_MS }
  );
}

/**
 * Delivery list status, and the automatic preparation on open: when the meal's time has come
 * (lunch 08:00, dinner 15:30) and the list is not prepared, the first person to open a delivery
 * screen prepares it. Asked once per date and meal per screen; the server decides and is idempotent.
 */
export function useManifest(serviceDate: string, mealType: MealType, enabled = true) {
  const key = enabled ? `/api/delivery/manifest?serviceDate=${serviceDate}&mealType=${mealType}` : null;
  const q = useErpQuery<DeliveryManifestStatus>(key, () => getJson<DeliveryManifestStatus>(key as string), {
    ttl: LIVE_MS,
    tags: ["delivery"],
    pollIntervalMs: LIVE_MS,
  });
  const asked = useRef<Set<string>>(new Set());
  const [autoRun, setAutoRun] = useState<DeliveryManifestRunResult | null>(null);
  useEffect(() => {
    const s = q.data;
    const k = `${serviceDate}|${mealType}`;
    if (!s || !s.due || asked.current.has(k)) return;
    asked.current.add(k);
    postJson<DeliveryManifestRunResult>("/api/delivery/manifest", { serviceDate, mealType, trigger: "AUTO" })
      .then((r) => {
        setAutoRun(r);
        invalidateErpCache(["delivery"]);
      })
      .catch(() => {
        // Not fatal: the Manager can still prepare it by hand; the status shows it as not prepared.
      });
  }, [q.data, serviceDate, mealType]);
  return { ...q, autoRun };
}

export function useTaskDetail(taskId: string | null) {
  const key = taskId ? `/api/delivery/tasks/${taskId}` : null;
  return useErpQuery<{ task: DeliveryTask; events: DeliveryTaskEvent[] }>(key, () => getJson(key as string), { ttl: LIVE_MS, tags: ["delivery"] });
}

export interface StaffOption {
  id: string;
  fullName: string;
}

export function useDeliveryStaff(enabled: boolean) {
  const key = enabled ? "/api/delivery/staff" : null;
  return useErpQuery<StaffOption[]>(
    key,
    async () => {
      const data = await getJson<any>("/api/delivery/staff");
      const list = Array.isArray(data) ? data : data.staff || data.deliveryStaff || [];
      return list.map((s: any) => ({ id: s.id, fullName: s.fullName || s.full_name }));
    },
    { ttl: 60000, tags: ["staff"] }
  );
}

export function useCloseout(serviceDate: string, mealType: MealType | "ALL", enabled = true) {
  const key = enabled ? `/api/delivery/closeout?serviceDate=${serviceDate}&mealType=${mealType}` : null;
  return useErpQuery<DeliveryCloseout>(key, () => getJson<DeliveryCloseout>(key as string), {
    ttl: LIVE_MS,
    tags: ["delivery", "custody", "handover"],
    pollIntervalMs: LIVE_MS,
  });
}

export function useHistory(from: string, to: string, enabled = true) {
  const key = enabled ? `/api/delivery/history?from=${from}&to=${to}` : null;
  return useErpQuery<DeliveryHistoryDay[]>(
    key,
    async () => (await getJson<{ days: DeliveryHistoryDay[] }>(key as string)).days,
    { ttl: 60000, tags: ["delivery"] }
  );
}

export function useSubscriptionDay(serviceDate: string, mealType: MealType, enabled = true) {
  const key = enabled ? `/api/delivery/subscriptions-day?serviceDate=${serviceDate}&mealType=${mealType}` : null;
  return useErpQuery<DeliveryDayListing<SubscriptionDayRow>>(key, () => getJson(key as string), {
    ttl: LIVE_MS,
    tags: ["subscriptions", "delivery"],
    pollIntervalMs: LIVE_MS,
  });
}

export function useResidentDay(serviceDate: string, mealType: MealType, enabled = true) {
  const key = enabled ? `/api/delivery/residents-day?serviceDate=${serviceDate}&mealType=${mealType}` : null;
  return useErpQuery<DeliveryDayListing<ResidentMealDeliveryRow>>(key, () => getJson(key as string), {
    ttl: LIVE_MS,
    tags: ["residents", "delivery"],
    pollIntervalMs: LIVE_MS,
  });
}
