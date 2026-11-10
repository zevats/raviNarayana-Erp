"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useState } from "react";
import dynamic from "next/dynamic";
import { SkipForward, Plus, Undo2, Home, UtensilsCrossed, ShoppingBag, UserPlus, Users, X } from "lucide-react";
import type { MealType, SubscriptionDayRow, ResidentMealDeliveryRow, TiffinCustomer, TiffinProduct } from "@/types";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessToday, businessMeal, addBusinessDays } from "@/lib/businessDate";
import { useSubscriptionDay, useResidentDay, postJson, getJson } from "./data";
import { MealSwitch, DateStepper, Notice, btn } from "./ui";
import { BikeLoader } from "@/components/feedback/BikeLoader";

const SubscriptionModal = dynamic(() => import("@/modules/tiffin/components/modals/SubscriptionModal").then((m) => m.SubscriptionModal), { ssr: false });

const STATUS_LABEL: Record<string, string> = {
  PENDING: "On the list",
  ASSIGNED: "Assigned",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  EXCEPTION: "Not delivered",
  CANCELLED: "Cancelled",
};

/**
 * Orders → Subscriptions: every active or paused subscription for the chosen day and meal (the meal
 * of the moment is chosen by the time of day), with skip today / extra today, Take order (an order
 * for that subscriber), New subscription (for an existing customer or a new outside customer), and
 * residents' room delivery. There is no time cutoff within the day; a past day needs a reason.
 */
export function SubscriptionsToday({ canChange, onTakeOrder }: { canChange: boolean; onTakeOrder?: (customer: TiffinCustomer) => void }) {
  const today = businessToday();
  const [date, setDate] = useState(today);
  const tomorrow = addBusinessDays(today, 1);
  const [meal, setMeal] = useState<MealType>(() => businessMeal());
  const subs = useSubscriptionDay(date, meal);
  const residents = useResidentDay(date, meal);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useTimedMessage<{ tone: "ok" | "error"; text: string }>();
  const [reasonFor, setReasonFor] = useState<{ key: string; run: (reason: string) => Promise<void> } | null>(null);
  const [reason, setReason] = useState("");
  const listing = subs.data;
  // New subscription: choose who (existing customer or a new outside customer), then the plan.
  const [newSub, setNewSub] = useState<null | { step: "who" | "customer" | "plan"; customerId?: string }>(null);
  const [lists, setLists] = useState<{ customers: TiffinCustomer[]; products: TiffinProduct[] } | null>(null);
  const [nc, setNc] = useState({ name: "", phone: "", address: "" });
  const [ncBusy, setNcBusy] = useState(false);
  const [ncError, setNcError] = useState<string | null>(null);
  const loadLists = async () => {
    const [c, p] = await Promise.all([
      getJson<{ customers: TiffinCustomer[] }>("/api/tiffin/customers?status=ACTIVE&limit=200"),
      getJson<{ products: TiffinProduct[] }>("/api/tiffin/products?status=ACTIVE"),
    ]);
    const next = { customers: c.customers || [], products: p.products || [] };
    setLists(next);
    return next;
  };
  const openNew = () => {
    setNewSub({ step: "who" });
    setNc({ name: "", phone: "", address: "" });
    setNcError(null);
    void loadLists().catch((e) => setMsg({ tone: "error", text: e.message }));
  };
  const createCustomer = async () => {
    if (nc.name.trim().length < 2 || nc.phone.trim().length < 7 || nc.address.trim().length < 5) {
      setNcError("Enter the name, a phone number and the delivery address.");
      return;
    }
    setNcBusy(true);
    setNcError(null);
    try {
      const res = await fetch("/api/tiffin/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: nc.name.trim(), phone: nc.phone.trim(), deliveryAddress: nc.address.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not add the customer.");
      invalidateErpCache(["tiffin_customers", "customers"]);
      const fresh = await loadLists();
      if (!fresh.customers.some((c) => c.id === data.customer.id)) fresh.customers.unshift(data.customer);
      setLists({ ...fresh });
      setNewSub({ step: "plan", customerId: data.customer.id });
    } catch (e: any) {
      setNcError(e.message);
    } finally {
      setNcBusy(false);
    }
  };
  const takeOrder = (r: SubscriptionDayRow) => {
    if (!onTakeOrder || !r.customerId) return;
    onTakeOrder({ id: r.customerId, fullName: r.customerName, phone: r.customerPhone || "", deliveryAddress: r.customerAddress || "", status: "ACTIVE" } as TiffinCustomer);
  };
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
          <h2 className="text-2xl font-bold text-[var(--rn-ink)]">Subscriptions</h2>
          <p className="text-[12.5px] text-[var(--rn-ink-2)]">Monthly tiffin plans: residents and outside customers.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MealSwitch value={meal} onChange={setMeal} />
          <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/70 border border-[var(--rn-line)]" role="group" aria-label="Day">
            {[
              { v: today, l: "Today" },
              { v: tomorrow, l: "Tomorrow" },
            ].map((o) => (
              <button
                key={o.l}
                type="button"
                aria-pressed={date === o.v}
                onClick={() => setDate(o.v)}
                className={`h-9 px-3.5 rounded-full text-[13px] font-semibold transition-colors ${date === o.v ? "bg-[var(--rn-accent)] text-white" : "text-[var(--rn-ink-2)] hover:bg-[var(--rn-accent-tint)]"}`}
              >
                {o.l}
              </button>
            ))}
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Pick a date"
              className="h-9 px-3 rounded-full bg-transparent text-[13px] font-semibold text-[var(--rn-ink)] border-0"
            />
          </div>
          {canChange && (
            <button type="button" onClick={openNew} className="rn-btn rn-btn-primary">
              <Plus /> New subscription
            </button>
          )}
        </div>
      </div>

      {listing && !listing.schemaReady && (
        <Notice tone="warn">Skip today, extra today and room delivery need the latest database update, which is not installed yet.</Notice>
      )}

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {reasonFor && (
        <div className="rn-enter rounded-2xl border border-status-warning-border bg-status-warning-bg p-3 flex flex-wrap gap-2 items-center">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for changing a past day" className="flex-1 min-w-[220px] min-h-[44px] px-3 rounded-xl border border-surface-subtle bg-white text-sm" />
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
                    <p className="text-[15px] font-semibold text-[var(--rn-ink)]">{r.customerName}</p>
                    <p className="text-[13px] text-[var(--rn-ink-2)]">
                      {r.productName} · {r.quantityPerMeal} thali{r.quantityPerMeal === 1 ? "" : "s"} a meal
                      {r.subscriptionStatus === "PAUSED" ? " · paused" : ""}
                    </p>
                    <p className="text-[12.5px] text-[var(--rn-ink-3)]">
                      {r.customerPhone && <a href={`tel:${r.customerPhone}`} className="tabular-nums hover:text-[var(--rn-accent)]">{r.customerPhone}</a>}
                      {r.customerPhone && r.customerAddress ? " · " : ""}
                      {r.customerAddress}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full border ${!r.eligible ? "bg-surface-cream border-surface-subtle text-text-muted" : r.override?.action === "SKIP" ? "bg-status-warning-bg border-status-warning-border text-status-warning-text" : "bg-status-success-bg border-status-success-border text-status-success-text"}`}>
                      {!r.eligible ? r.ineligibleReason : r.override?.action === "SKIP" ? "Skipped" : `${r.effectiveQuantity} thali${r.effectiveQuantity === 1 ? "" : "s"}${r.override?.action === "EXTRA" ? ` (+${r.override.quantity})` : ""}`}
                      {r.override?.afterCutoff ? " · override" : ""}
                    </span>
                    {r.task && <span className="text-xs text-text-secondary">{STATUS_LABEL[r.task.status] || r.task.status}{r.task.assignedToName ? ` · ${r.task.assignedToName}` : ""}</span>}
                    {onTakeOrder && r.customerId && date >= today && (
                      <button type="button" onClick={() => takeOrder(r)} className={btn.quiet} aria-label={`Take an order for ${r.customerName}`}>
                        <ShoppingBag className="w-4 h-4" /> Take order
                      </button>
                    )}
                    {editable && r.eligible && !done && (
                      <>
                        {r.override ? (
                          <button type="button" disabled={Boolean(busy)} onClick={() => subAction(r, "CLEAR")} className={btn.quiet}>
                            <Undo2 className="w-4 h-4" /> Usual
                          </button>
                        ) : null}
                        {r.override?.action !== "SKIP" && (
                          <button type="button" disabled={Boolean(busy)} onClick={() => subAction(r, "EXTRA", (r.override?.action === "EXTRA" ? r.override.quantity || 0 : 0) + 1)} className={btn.quiet}>
                            <Plus className="w-4 h-4" /> Extra thali
                          </button>
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

      {newSub?.step === "who" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(24,16,10,0.42)]" onMouseDown={(e) => e.target === e.currentTarget && setNewSub(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="new-sub-title" className="w-full max-w-[460px] rounded-[26px] bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 id="new-sub-title" className="text-[20px] font-bold text-[var(--rn-ink)]">New subscription for</h2>
              <button type="button" onClick={() => setNewSub(null)} aria-label="Close" className="w-10 h-10 -mr-2 -mt-1 rounded-full flex items-center justify-center hover:bg-[var(--rn-accent-tint)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <button type="button" disabled={!lists} onClick={() => setNewSub({ step: "plan" })} className="rounded-[18px] border border-[var(--rn-line)] p-4 text-left hover:border-[var(--rn-accent)] disabled:opacity-60">
                <Users className="w-5 h-5 text-[var(--rn-accent)]" />
                <span className="mt-2 block text-[15px] font-bold text-[var(--rn-ink)]">Existing customer</span>
                <span className="block text-[12.5px] text-[var(--rn-ink-2)]">{lists ? "Choose from your customers" : "Loading customers…"}</span>
              </button>
              <button type="button" onClick={() => setNewSub({ step: "customer" })} className="rounded-[18px] border border-[var(--rn-line)] p-4 text-left hover:border-[var(--rn-accent)]">
                <UserPlus className="w-5 h-5 text-[var(--rn-accent)]" />
                <span className="mt-2 block text-[15px] font-bold text-[var(--rn-ink)]">New outside customer</span>
                <span className="block text-[12.5px] text-[var(--rn-ink-2)]">Anyone can buy a plan</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {newSub?.step === "customer" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[rgba(24,16,10,0.42)]" onMouseDown={(e) => e.target === e.currentTarget && setNewSub(null)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-sub-cust-title"
            onSubmit={(e) => {
              e.preventDefault();
              void createCustomer();
            }}
            className="w-full max-w-[460px] rounded-[26px] bg-white p-5 shadow-2xl space-y-3"
          >
            <h2 id="new-sub-cust-title" className="text-[20px] font-bold text-[var(--rn-ink)]">New customer</h2>
            {ncError && <p role="alert" className="rounded-xl bg-[#FDECEA] px-3 py-2 text-[13px] text-[#8A1F12]">{ncError}</p>}
            {(
              [
                ["name", "Full name", "text", "Customer name"],
                ["phone", "Phone number", "tel", "e.g. 9812345678"],
                ["address", "Delivery address", "text", "Flat, building, landmark, area"],
              ] as const
            ).map(([k, label, type, ph]) => (
              <label key={k} className="block">
                <span className="block text-[13px] font-semibold text-[var(--rn-ink-2)] mb-1">{label}</span>
                <input type={type} value={nc[k]} placeholder={ph} onChange={(e) => setNc((v) => ({ ...v, [k]: e.target.value }))} className="w-full h-11 px-3.5 rounded-xl border border-[var(--rn-line)] text-[14px]" />
              </label>
            ))}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setNewSub({ step: "who" })} className="h-11 px-4 rounded-full text-[14px] font-semibold text-[var(--rn-ink-2)] hover:bg-[var(--rn-accent-tint)]">Back</button>
              <button type="submit" disabled={ncBusy} className="h-11 px-5 rounded-full bg-[var(--rn-accent)] text-white text-[14px] font-bold disabled:opacity-60">{ncBusy ? "Adding…" : "Continue to the plan"}</button>
            </div>
          </form>
        </div>
      )}
      {newSub?.step === "plan" && lists && (
        <SubscriptionModal
          isOpen
          onClose={() => setNewSub(null)}
          customers={lists.customers}
          products={lists.products}
          preselectedCustomerId={newSub.customerId}
          onSuccess={(_s, message) => {
            setNewSub(null);
            invalidateErpCache(["subscriptions", "tiffin_subscriptions", "delivery", "orders"]);
            setMsg({ tone: "ok", text: message });
          }}
        />
      )}
    </div>
  );
}
