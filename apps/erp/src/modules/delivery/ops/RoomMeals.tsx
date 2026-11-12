"use client";

import React, { useState } from "react";
import type { MealType } from "@/types";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { useTimedMessage } from "@/lib/useTimedMessage";
import { businessToday } from "@/lib/businessDate";
import { useResidentDay, residentDayQuery, postJson } from "./data";
import { Card } from "@/components/ui/kit";
import { SkeletonRows } from "@/components/ui/states";
import { usePrefetchChoices } from "@/lib/pageQueries";

/**
 * Delivery → Room meals: which residents have their lunch or dinner taken to the room (a standing
 * choice per resident), and skipping today's room delivery for one meal.
 */
export function RoomMeals({ canChange, date, meal }: { canChange: boolean; date: string; meal: MealType }) {
  const today = date;
  const q = useResidentDay(date, meal);
  usePrefetchChoices(
    (["BREAKFAST", "LUNCH", "DINNER"] as MealType[]).filter((m) => m !== meal).map((m) => residentDayQuery(date, m)),
    Boolean(q.data) && !q.isSwitching
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useTimedMessage<{ tone: "ok" | "error"; text: string }>();

  const run = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await postJson("/api/delivery/residents-day", body);
      invalidateErpCache(["residents", "delivery"]);
      setMsg({ tone: "ok", text: done });
    } catch (e: any) {
      setMsg({ tone: "error", text: e?.message || "Could not save." });
    } finally {
      setBusy(null);
    }
  };
  const rows = q.data?.rows ?? [];
  const editable = canChange && Boolean(q.data?.schemaReady) && date >= businessToday();

  return (
    <Card flush>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5 border-b border-[var(--rn-line)]">
        <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">Room meals · {meal === "DINNER" ? "dinner" : "lunch"}</h2>
      </div>
      {msg && <p role="status" className={`mx-4 sm:mx-5 mt-4 rounded-2xl px-4 py-3 text-[14px] ${msg.tone === "ok" ? "bg-[#E4F2E0] text-[#1D4E16]" : "bg-[#FDECE8] text-[#A3311D]"}`}>{msg.text}</p>}
      {!q.data ? (
        q.error ? <p role="alert" className="p-5 text-[14px] text-[#A3311D]">{q.error.message}</p> : <div className="p-4 sm:p-5"><SkeletonRows rows={4} /></div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-[15px] text-[var(--rn-ink-2)]">No residents staying on this day.</p>
      ) : (
        <ul className="divide-y divide-[var(--rn-line)]" aria-label="Residents">
          {rows.map((r) => (
            <li key={r.residentId} className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[var(--rn-ink)]">{r.residentName}</p>
                <p className="text-[13px] text-[var(--rn-ink-2)]">
                  Room {r.roomNumber ?? "—"} · {r.today === "ROOM_DELIVERY" ? "to the room" : r.today === "SKIPPED" ? "skipped today" : r.today === "NOT_EATING" ? "not eating" : "eats at the PG"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(["lunch", "dinner"] as const).map((m) => {
                  const on = m === "lunch" ? r.lunchRoomDelivery : r.dinnerRoomDelivery;
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={on}
                      disabled={!editable || Boolean(busy)}
                      onClick={() => run(`${r.residentId}:${m}`, { residentId: r.residentId, [m]: !on }, `${r.residentName}: ${m} ${on ? "at the PG" : "to the room"} from now on.`)}
                      className={`rn-btn rn-btn-sm ${on ? "rn-btn-primary" : ""}`}
                    >
                      {m === "lunch" ? "Lunch" : "Dinner"} to room
                    </button>
                  );
                })}
                {editable && r.today === "ROOM_DELIVERY" && !(r.task && (r.task.status === "DELIVERED" || r.task.status === "EXCEPTION")) && (
                  <button type="button" disabled={Boolean(busy)} onClick={() => run(`${r.residentId}:skip`, { residentId: r.residentId, serviceDate: today, mealType: meal, action: "SKIP" }, `${r.residentName}: skipped this ${meal === "LUNCH" ? "lunch" : "dinner"}.`)} className="rn-btn rn-btn-sm">
                    Skip today
                  </button>
                )}
                {editable && r.today === "SKIPPED" && (
                  <button type="button" disabled={Boolean(busy)} onClick={() => run(`${r.residentId}:undo`, { residentId: r.residentId, serviceDate: today, mealType: meal, action: "CLEAR" }, `${r.residentName}: skip removed.`)} className="rn-btn rn-btn-sm">
                    Undo skip
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
