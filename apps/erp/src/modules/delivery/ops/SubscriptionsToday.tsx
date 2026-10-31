"use client";

import React, { useState } from "react";
import { SkipForward, Plus, Undo2, Home, UtensilsCrossed } from "lucide-react";
import type { MealType, SubscriptionDayRow, ResidentMealDeliveryRow } from "@/types";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessToday, businessMeal } from "@/lib/businessDate";
import { useSubscriptionDay, useResidentDay, postJson } from "./data";
import { MealSwitch, DateStepper, Notice, btn } from "./ui";
import { BikeLoader } from "@/components/feedback/BikeLoader";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "On the list",
  ASSIGNED: "Assigned",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  EXCEPTION: "Not delivered",
  CANCELLED: "Cancelled",
};

/**
 * Orders → Subscriptions: every active or paused subscription for the chosen day and meal, with
 * skip today / extra today, and residents' room delivery. Changes after the meal cutoff (lunch
 * 07:30, dinner 15:00) need a reason (Manager override); the server enforces the same rules.
 */
export function SubscriptionsToday({ canChange }: { canChange: boolean }) {
  const today = businessToday();
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<MealType>(() => businessMeal());
  const subs = useSubscriptionDay(date, meal);
  const residents = useResidentDay(date, meal);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [reasonFor, setReasonFor] = useState<{ key: string; run: (reason: string) => Promise<void> } | null>(null);
  const [reason, setReason] = useState("");
  const listing = subs.data;
  const pastCutoff = Boolean(listing?.pastCutoff);
  const editable = canChange && Boolean(listing?.schemaReady) && date >= today;

  const act = async (key: string, run: (reason?: string) => Promise<void>, done: string) => {
    if (pastCutoff) {
      setReason("");
      setReasonFor({ key, run: async (r) => run(r) });
      return;
    }
    setBusy(key);
    setMsg(null);
    try {
      await run();
      invalidateErpCache(["subscriptions", "residents", "delivery", "orders"]);
      setMsg({ tone: "ok", text: done });
    } catch (e: any) {
      setMsg({ tone: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };
  const confirmReason = async () => {
    if (!reasonFor) return;
    setBusy(reasonFor.key);
    try {
      await reasonFor.run(reason);
      invalidateErpCache(["subscriptions", "residents", "delivery", "orders"]);
      setMsg({ tone: "ok", text: "Saved as a Manager override with your reason." });
      setReasonFor(null);
    } catch (e: any) {
      setMsg({ tone: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const subAction = (r: SubscriptionDayRow, action: "SKIP" | "EXTRA" | "CLEAR", quantity?: number) =>
    act(
      `${r.subscriptionId}:${action}`,
      async (why?: string) => {
        await postJson("/api/delivery/subscriptions-day", { subscriptionId: r.subscriptionId, serviceDate: date, mealType: meal, action, quantity, reason: why || undefined });
      },
      action === "SKIP" ? `${r.customerName}: skipped for this meal.` : action === "EXTRA" ? `${r.customerName}: ${quantity} extra for this meal.` : `${r.customerName}: back to the usual.`
    );

  const residentAction = (r: ResidentMealDeliveryRow, body: Record<string, unknown>, done: string) =>
    act(
      `${r.residentId}:${JSON.stringify(body)}`,
      async (why?: string) => {
        await postJson("/api/delivery/residents-day", { residentId: r.residentId, ...body, reason: why || undefined });
      },
      done
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-text-primary">Subscriptions</h2>
          <p className="text-xs text-text-muted">
            {listing?.cutoffAt ? `Changes after ${listing.cutoffAt} need a reason.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <MealSwitch value={meal} onChange={setMeal} />
          <DateStepper value={date} today={today} onChange={setDate} />
        </div>
      </div>

      {listing && !listing.schemaReady && (
        <Notice tone="warn">Skip today, extra today and room delivery are switched off until the delivery update (migration 0014) is approved and installed. The list below is read-only.</Notice>
      )}
      {pastCutoff && listing?.schemaReady && date >= today && <Notice tone="warn">This meal is past its cutoff: each change is recorded as a Manager override and needs a reason.</Notice>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {reasonFor && (
        <div className="rn-enter rounded-2xl border border-status-warning-border bg-status-warning-bg p-3 flex flex-wrap gap-2 items-center">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change after the cutoff" className="flex-1 min-w-[220px] min-h-[44px] px-3 rounded-xl border border-surface-subtle bg-white text-sm" />
          <button type="button" disabled={reason.trim().length < 3 || Boolean(busy)} onClick={confirmReason} className={btn.primary}>Confirm override</button>
          <button type="button" onClick={() => setReasonFor(null)} className={btn.quiet}>Cancel</button>
        </div>
      )}

      <section className="rounded-3xl bg-white border border-surface-subtle overflow-hidden">
        <h3 className="px-4 pt-3 pb-2 font-serif text-lg text-text-primary flex items-center gap-2">
          <UtensilsCrossed className="w-4 h-4 text-brass-dark" /> Tiffin subscriptions
        </h3>
        {!listing ? (
          subs.error ? <p role="alert" className="px-4 pb-4 text-sm text-status-danger-text">{subs.error.message}</p> : <BikeLoader size="sm" label="Loading subscriptions…" className="py-8" />
        ) : listing.rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-text-muted">No active or paused subscriptions.</p>
        ) : (
          <ul className="divide-y divide-surface-subtle">
            {listing.rows.map((r) => {
              const done = r.task && (r.task.status === "DELIVERED" || r.task.status === "EXCEPTION");
              return (
                <li key={r.subscriptionId} className="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary">{r.customerName}</p>
                    <p className="text-xs text-text-muted">
                      {r.productName} × {r.quantityPerMeal}
                      {r.subscriptionStatus === "PAUSED" ? " · paused" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full border ${!r.eligible ? "bg-surface-cream border-surface-subtle text-text-muted" : r.override?.action === "SKIP" ? "bg-status-warning-bg border-status-warning-border text-status-warning-text" : "bg-status-success-bg border-status-success-border text-status-success-text"}`}>
                      {!r.eligible ? r.ineligibleReason : r.override?.action === "SKIP" ? "Skipped" : `${r.effectiveQuantity} box${r.effectiveQuantity === 1 ? "" : "es"}${r.override?.action === "EXTRA" ? ` (+${r.override.quantity})` : ""}`}
                      {r.override?.afterCutoff ? " · override" : ""}
                    </span>
                    {r.task && <span className="text-xs text-text-secondary">{STATUS_LABEL[r.task.status] || r.task.status}{r.task.assignedToName ? ` · ${r.task.assignedToName}` : ""}</span>}
                    {editable && r.eligible && !done && (
                      <>
                        {r.override ? (
                          <button type="button" disabled={Boolean(busy)} onClick={() => subAction(r, "CLEAR")} className={btn.quiet}>
                            <Undo2 className="w-4 h-4" /> Usual
                          </button>
                        ) : null}
                        {r.override?.action !== "SKIP" && (
                          <>
                            <button type="button" disabled={Boolean(busy)} onClick={() => subAction(r, "SKIP")} className={btn.quiet}>
                              <SkipForward className="w-4 h-4" /> Skip
                            </button>
                            <button type="button" disabled={Boolean(busy)} onClick={() => subAction(r, "EXTRA", (r.override?.action === "EXTRA" ? r.override.quantity || 0 : 0) + 1)} className={btn.quiet}>
                              <Plus className="w-4 h-4" /> Extra
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-3xl bg-white border border-surface-subtle overflow-hidden">
        <h3 className="px-4 pt-3 pb-1 font-serif text-lg text-text-primary flex items-center gap-2">
          <Home className="w-4 h-4 text-brass-dark" /> Residents
        </h3>
        {!residents.data ? (
          residents.error ? <p role="alert" className="px-4 pb-4 text-sm text-status-danger-text">{residents.error.message}</p> : <BikeLoader size="sm" label="Loading residents…" className="py-8" />
        ) : residents.data.rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-text-muted">No residents staying on this day.</p>
        ) : (
          <ul className="divide-y divide-surface-subtle">
            {residents.data.rows.map((r) => (
              <li key={r.residentId} className="px-4 py-3 flex flex-wrap items-center gap-3 justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-text-primary">{r.residentName}</p>
                  <p className="text-xs text-text-muted">
                    Room {r.roomNumber ?? "—"} · {r.today === "ROOM_DELIVERY" ? "room delivery" : r.today === "SKIPPED" ? "skipped" : r.today === "NOT_EATING" ? "not eating" : "eats at the PG"}
                    {r.task ? ` · ${STATUS_LABEL[r.task.status] || r.task.status}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(["lunch", "dinner"] as const).map((m) => {
                    const on = m === "lunch" ? r.lunchRoomDelivery : r.dinnerRoomDelivery;
                    return (
                      <button
                        key={m}
                        type="button"
                        disabled={!canChange || !residents.data?.schemaReady || Boolean(busy)}
                        aria-pressed={on}
                        onClick={() =>
                          act(`${r.residentId}:${m}`, async () => {
                            await postJson("/api/delivery/residents-day", { residentId: r.residentId, [m]: !on });
                          }, `${r.residentName}: ${m} ${on ? "at the PG" : "delivered to the room"} from now on.`)
                        }
                        className={`rn-press min-h-[40px] px-3 rounded-xl text-xs border ${on ? "bg-forest-deepest text-text-light border-forest-deepest" : "bg-white text-text-secondary border-surface-subtle"} disabled:opacity-60`}
                      >
                        {m === "lunch" ? "Lunch" : "Dinner"} to room
                      </button>
                    );
                  })}
                  {editable && r.today === "ROOM_DELIVERY" && !(r.task && (r.task.status === "DELIVERED" || r.task.status === "EXCEPTION")) && (
                    <button type="button" disabled={Boolean(busy)} onClick={() => residentAction(r, { serviceDate: date, mealType: meal, action: "SKIP" }, `${r.residentName}: skipped for this meal.`)} className={btn.quiet}>
                      <SkipForward className="w-4 h-4" /> Skip
                    </button>
                  )}
                  {editable && r.today === "SKIPPED" && (
                    <button type="button" disabled={Boolean(busy)} onClick={() => residentAction(r, { serviceDate: date, mealType: meal, action: "CLEAR" }, `${r.residentName}: skip removed.`)} className={btn.quiet}>
                      <Undo2 className="w-4 h-4" /> Undo skip
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
