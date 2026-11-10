"use client";

import { friendlyError } from "@/lib/friendlyError";
import { UpiQr } from "./UpiQr";
import React, { useEffect, useMemo, useState } from "react";
import { Minus, Plus, X, Check, CheckCircle2, CircleCheck, Flag, Phone, Home, CircleSlash } from "lucide-react";
import type { DeliveryDisposition, DeliveryLine, DeliveryTask } from "@/types";
import { enqueueDeliveryAction } from "../offlineQueue";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";

/**
 * Sends a recorded delivery after the sheet has already closed (the screen updates at once). A lost
 * connection keeps it on the phone (offline queue, sent automatically); a refusal from the server is
 * announced with "erp:delivery-save-failed" so the screen can say why and show the stop again.
 */
function sendDeliveryInBackground(taskId: string, customer: string, payload: Record<string, any>, key: string, currentUserId?: string) {
  const queue = () => {
    try {
      enqueueDeliveryAction("COMPLETE_DELIVERY", taskId, payload, currentUserId, key);
      window.dispatchEvent(new CustomEvent("erp:delivery-queued", { detail: { taskId } }));
    } catch (e: any) {
      window.dispatchEvent(new CustomEvent("erp:delivery-save-failed", { detail: { taskId, text: `${customer}: ${e?.message || "could not be saved"}` } }));
    }
  };
  fetch(`/api/delivery/tasks/${taskId}/deliver`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: key }) })
    .then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        window.dispatchEvent(new CustomEvent("erp:delivery-saved", { detail: { taskId, task: data.task } }));
        invalidateErpCache(["delivery", "orders", "custody", "handover", "dashboard"]);
        return;
      }
      // A server error that may pass on a later try is kept and resent; a refusal is reported.
      if (res.status >= 500) return queue();
      window.dispatchEvent(new CustomEvent("erp:delivery-save-failed", { detail: { taskId, text: `${customer} was not saved: ${data.error || "the server refused it"}. The stop is back in your list.` } }));
      invalidateErpCache(["delivery"]);
    })
    .catch(() => queue());
}
import { DISPOSITION_LABEL } from "@/lib/delivery/outcome";
import { rupees, displayName, placeLine } from "./ui";
import { K, Pill, firstName } from "./staffKit";
import { useSheetDrag } from "@/components/feedback/useSheetDrag";
import { SelectMenu } from "@/components/forms/SelectMenu";

const REASONS = ["Customer not available", "Took fewer", "Cancelled at door", "Damaged in transit", "Wrong address"];
const DISPOSITIONS: DeliveryDisposition[] = ["RETURNED", "WITH_STAFF", "DISCARDED"];

interface LineState {
  delivered: number;
  reason: string;
  disposition: DeliveryDisposition | null;
}

/**
 * Dialer link for the stop's phone: digits only, Indian 10-digit numbers get +91, so the phone's
 * dialer opens with a number it can call (spaces, dashes or a leading 0 would otherwise break it).
 */
export function telHref(phone: string | null | undefined): string | null {
  const raw = String(phone || "").trim();
  if (!raw) return null;
  const plus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!plus && digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length < 6) return null;
  if (!plus && digits.length === 10) return `tel:+91${digits}`;
  return `tel:${plus ? "+" : ""}${digits}`;
}

/**
 * Call link for a stop. Phones open the dialer (tel:). A computer usually has no dialer, so there
 * the tap shows the number and copies it instead of doing nothing.
 */
export function CallLink({ phone, className, wrapClassName = "relative inline-flex", label, children }: { phone: string | null | undefined; className: string; wrapClassName?: string; label?: string; children: React.ReactNode }) {
  const href = telHref(phone);
  const [shown, setShown] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), 2600);
    return () => clearTimeout(t);
  }, [shown]);
  if (!href) return null;
  const pretty = href.replace("tel:", "").replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");
  return (
    <span className={wrapClassName}>
      <a
        href={href}
        aria-label={label}
        onClick={(e) => {
          const canDial = window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
          if (canDial) return;
          e.preventDefault();
          navigator.clipboard?.writeText(pretty).catch(() => {});
          setShown(pretty);
        }}
        className={className}
      >
        {children}
      </a>
      {shown && (
        <span role="status" className="rn-enter absolute z-20 bottom-full mb-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-xl bg-[#1F2320] text-white text-[12px] font-semibold px-3 py-2 shadow-lg">
          {shown} · copied
        </span>
      )}
    </span>
  );
}

export function mapsHref(task: DeliveryTask): string | null {
  if (task.orderType === "RESIDENT") return null;
  const q = [task.deliveryAddress, task.landmark].filter(Boolean).join(", ");
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/** How a stop is paid, as the designs label it. */
export function paymentLabel(t: DeliveryTask): { text: string; tone: "success" | "accent" | "info" } {
  if (t.paymentMode === "MONTHLY") return { text: "Monthly Plan", tone: "success" };
  if (t.paymentMode === "NONE") return { text: "Room Delivery", tone: "info" };
  return { text: `Collect ${rupees(t.orderTotal)}`, tone: "accent" };
}

function Stepper({ value, max, onChange, label, variant }: { value: number; max: number; onChange: (v: number) => void; label: string; variant: "panel" | "sheet" }) {
  const set = (v: number) => onChange(Math.max(0, Math.min(max, v)));
  const b = `rn-press w-10 h-10 rounded-full flex items-center justify-center text-[#1A2E20] disabled:opacity-30 ${variant === "panel" ? "bg-white shadow-[0_1px_2px_rgba(26,46,32,0.08)]" : "bg-[#F1ECE3]"}`;
  return (
    <div className="flex items-center gap-2 shrink-0" role="group" aria-label={label}>
      <button type="button" aria-label={`${label}: one less`} disabled={value <= 0} onClick={() => set(value - 1)} className={b}>
        <Minus className="w-4 h-4" />
      </button>
      <span key={value} className="rn-tick w-8 text-center text-lg font-bold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" aria-label={`${label}: one more`} disabled={value >= max} onClick={() => set(value + 1)} className={b}>
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

/**
 * The delivery confirmation (approved design): per item expected vs delivered, the reason and
 * destination of anything not delivered, who received it, the doorstep payment for one-off
 * orders only, and the confirm button. "panel" is the tablet/desktop side panel; "sheet" the
 * phone's handoff sheet. Delivery and payment stay separate: a balance can be collected later.
 */
export function DeliveryForm({
  task,
  stopNo,
  onSaved,
  onClose,
  currentUserId,
  variant,
}: {
  task: DeliveryTask;
  stopNo?: number;
  /** Called with the saved stop as the server now has it, so the list can show it at once. */
  onSaved: (msg: string, saved?: DeliveryTask) => void;
  onClose?: () => void;
  currentUserId?: string;
  variant: "panel" | "sheet";
}) {
  const lines: DeliveryLine[] = useMemo(() => task.lines ?? [], [task]);
  const customer = displayName(task);
  const choices = useMemo(
    () => [
      { key: "customer", label: `Customer directly (${firstName(customer)})`, value: customer },
      { key: "family", label: task.orderType === "RESIDENT" ? "Roommate" : "Family member", value: task.orderType === "RESIDENT" ? "Roommate" : "Family member" },
      { key: "security", label: "Security / reception desk", value: "Security / reception desk" },
      { key: "other", label: "Someone else (type the name)", value: "" },
    ],
    [customer, task.orderType]
  );
  const [state, setState] = useState<Record<string, LineState>>({});
  const [legacyDelivered, setLegacyDelivered] = useState(true);
  const [legacyReason, setLegacyReason] = useState("");
  const [choice, setChoice] = useState("customer");
  const [otherName, setOtherName] = useState("");
  const [collectedText, setCollectedText] = useState<string | null>(null);
  // Cash, UPI or Pay Later (migration 0021). Pay Later is offered only when the server says the
  // customer is approved; without migration 0021 the form keeps its Cash / UPI behaviour.
  const [method, setMethod] = useState<"CASH" | "UPI" | "PAY_LATER">("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [key, setKey] = useState("");

  // A fresh form and one idempotency key per opened stop, so a retry or the offline replay of this
  // submission is recognised by the server as the same completion.
  useEffect(() => {
    setState(Object.fromEntries((task.lines ?? []).map((l) => [l.lineId, { delivered: l.quantity, reason: "", disposition: null }])));
    setLegacyDelivered(true);
    setLegacyReason("");
    setChoice("customer");
    setOtherName("");
    setCollectedText(null);
    setMethod("CASH");
    setError(null);
    setQueued(false);
    setKey(`del_${task.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const recipient = choice === "other" ? otherName.trim() : choices.find((c) => c.key === choice)?.value || "";
  const doorstep = task.paymentMode === "DOORSTEP" && lines.some((l) => l.unitPrice !== null);
  const deliveredUnits = lines.reduce((s, l) => s + (state[l.lineId]?.delivered ?? 0), 0);
  const orderedUnits = lines.reduce((s, l) => s + l.quantity, 0);
  const nothing = lines.length > 0 ? deliveredUnits === 0 : !legacyDelivered;
  const shortLines = lines.filter((l) => (state[l.lineId]?.delivered ?? l.quantity) < l.quantity);
  const amountDue = lines.reduce((s, l) => s + (state[l.lineId]?.delivered ?? 0) * (l.unitPrice ?? 0), 0);
  const payLaterKnown = typeof task.payLaterAllowed === "boolean";
  const payLaterAllowed = task.payLaterAllowed === true;
  const payLater = method === "PAY_LATER";
  // The customer's balance from before this order (Receivables rule). More than this order can be
  // collected: the extra settles earlier orders, then becomes an advance (the server allocates).
  // Credit from an earlier advance pays this order first, so only the rest is asked for.
  const prev = task.customerBalance ?? null;
  const previous = prev?.previous ?? 0;
  const totalDue = Math.max(0, amountDue + previous);
  const creditAvail = previous < 0 ? -previous : 0;
  const suggested = creditAvail > 0 ? totalDue : amountDue;
  const collected = payLater ? 0 : collectedText === null ? suggested : collectedText.trim() === "" ? 0 : Number(collectedText);
  const collectedOk = Number.isInteger(collected) && collected >= 0 && collected <= 9999999;
  const fromCredit = Math.min(creditAvail, Math.max(0, amountDue - (collectedOk ? collected : 0)));
  const balance = Math.max(0, amountDue - (collectedOk ? collected : 0) - fromCredit);
  const toOrder = Math.min(collectedOk ? collected : 0, amountDue);
  const extra = Math.max(0, (collectedOk ? collected : 0) - amountDue);
  const toEarlier = Math.min(extra, prev ? prev.earlierOrders : 0);
  const advance = extra - toEarlier;
  // Pay Later is offered for every customer. Without the office's approval the balance is still
  // recorded and the order is flagged for a Manager to review (the server records both).
  const needsReview = doorstep && payLaterKnown && !payLaterAllowed && balance > 0;
  const setLine = (id: string, patch: Partial<LineState>) => setState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const setAll = (all: boolean) => setState((prev) => Object.fromEntries(lines.map((l) => [l.lineId, { ...(prev[l.lineId] || { reason: "", disposition: null }), delivered: all ? l.quantity : 0 }])));

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (lines.length > 0) {
      for (const l of shortLines) {
        const st = state[l.lineId];
        if (!st?.reason.trim()) return setError(`Choose why ${l.quantity - (st?.delivered ?? 0)} ${l.productName} were not delivered.`);
        if (!st.disposition) return setError(`Choose where the undelivered ${l.productName} went.`);
      }
    } else if (!legacyDelivered && !legacyReason.trim()) {
      return setError("Choose why it was not delivered.");
    }
    if (!nothing && !recipient) return setError("Enter the name of the person who received it.");
    if (doorstep && !nothing && !collectedOk) return setError("Amount collected must be a whole number of rupees, 0 or more.");

    const payload: Record<string, any> =
      lines.length > 0
        ? {
            lines: lines.map((l) => {
              const st = state[l.lineId];
              const short = l.quantity - st.delivered;
              return {
                lineId: l.lineId,
                ...(l.source === "ORDER" ? { orderItemId: l.lineId } : {}),
                deliveredQuantity: st.delivered,
                undeliveredQuantity: short,
                ...(short > 0 ? { reason: st.reason.trim(), disposition: st.disposition } : {}),
              };
            }),
            undeliveredReason: shortLines.length > 0 ? state[shortLines[0].lineId]?.reason.trim() : undefined,
          }
        : { deliveredQuantity: legacyDelivered ? 1 : 0, undeliveredQuantity: legacyDelivered ? 0 : 1, undeliveredReason: legacyDelivered ? undefined : legacyReason.trim() };
    if (!nothing) payload.recipientName = recipient;
    if (doorstep && !nothing && collected > 0 && !payLater) {
      payload.collectedAmount = collected;
      payload.paymentMethod = method;
    }
    if (doorstep && !nothing && payLaterKnown) {
      payload.paymentChoice = method;
      payload.payLaterAllowedAtSelection = payLaterAllowed;
    }

    // Instant: the stop is shown as done now and the sheet closes; the save goes on in the background
    // (same key: the server records it once, also if it is resent from the offline queue).
    const savedText = nothing ? `${customer}: recorded as not delivered` : shortLines.length > 0 ? `${customer}: partly delivered` : `${customer}: delivered`;
    if (typeof navigator === "undefined" || navigator.onLine !== false) {
      const optimistic: DeliveryTask = {
        ...task,
        status: nothing ? "EXCEPTION" : "DELIVERED",
        deliveredAt: nothing ? task.deliveredAt : new Date().toISOString(),
        collectedAmount: (task.collectedAmount || 0) + (typeof payload.collectedAmount === "number" ? payload.collectedAmount : 0),
        collectedPaymentMethod: payload.paymentMethod ?? task.collectedPaymentMethod,
        recipientName: nothing ? task.recipientName : recipient,
      } as DeliveryTask;
      sendDeliveryInBackground(task.id, customer, payload, key, currentUserId);
      onSaved(savedText, optimistic);
      onClose?.();
      return;
    }

    setBusy(true);
    const queue = () => {
      try {
        enqueueDeliveryAction("COMPLETE_DELIVERY", task.id, payload, currentUserId, key);
        setQueued(true);
      } catch (e: any) {
        setError(friendlyError(e.message));
      }
    };
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return queue();
      let res: Response;
      try {
        res = await fetch(`/api/delivery/tasks/${task.id}/deliver`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, idempotencyKey: key }) });
      } catch {
        return queue(); // dead zone: kept on the phone and sent when back online
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the delivery. Try again.");
      onSaved(nothing ? `${customer}: recorded as not delivered` : shortLines.length > 0 ? `${customer}: partly delivered` : `${customer}: delivered`, data.task as DeliveryTask | undefined);
      onClose?.();
    } catch (e: any) {
      setError(friendlyError(e.message || "Could not save the delivery. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const pay = paymentLabel(task);
  const panel = variant === "panel";
  const itemsTitle = "Items to deliver";

  return (
    <div className={panel ? "space-y-5" : "space-y-5 px-5 pb-5"}>
      {panel ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 text-[19px] font-extrabold tracking-[-0.01em]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#C9501C]" /> Delivery Confirmation
            </h2>
            {stopNo !== undefined && (
              <Pill tone="danger" mono>
                STOP #{stopNo}
              </Pill>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 -mt-2">
            <Pill tone={pay.tone}>{pay.text}</Pill>
          </div>
          <div className={`${K.soft} p-4 space-y-1`}>
            <p className="text-[15px] font-bold">{customer}</p>
            <p className="text-[13px] text-[#5A6C5E]">
              {placeLine(task)}
              {task.landmark ? `, near ${task.landmark}` : ""}
            </p>
            {task.deliveryInstructions && (
              <p className="mt-2 flex items-start gap-2 rounded-lg bg-white px-3 py-2.5 text-[13px] text-[#1A2E20]">
                <Home className="w-4 h-4 text-[#B4440F] shrink-0 mt-0.5" /> {task.deliveryInstructions}
              </p>
            )}
          </div>
        </>
      ) : null}

      {error && <p role="alert" className="rounded-xl bg-[#FBE3DD] text-[#9A3423] text-sm px-4 py-3">{error}</p>}
      {queued && <p role="status" className="rounded-xl bg-[#FCE9DD] text-[#B4440F] text-sm px-4 py-3">No connection. Saved on this phone; it is sent automatically when you are back online.</p>}

      {lines.length > 0 ? (
        <section aria-label="Items" className="space-y-2.5">
          <div className="flex items-baseline justify-between">
            <p className={K.eyebrow}>{itemsTitle}</p>
            <p className={`text-[12px] ${panel ? "font-semibold text-[#2F6B24]" : "text-[#6E7F70]"}`}>{panel ? `${deliveredUnits}/${orderedUnits} delivered` : "Expected / Delivered"}</p>
          </div>
          {lines.map((l) => {
            const st = state[l.lineId] || { delivered: l.quantity, reason: "", disposition: null };
            const short = l.quantity - st.delivered;
            return (
              <div key={l.lineId} className={panel ? `rounded-xl px-4 py-3 ${short > 0 ? "bg-[#FBF3E6]" : "bg-[#F4F0E8]"}` : `rounded-2xl border bg-white px-4 py-3 ${short > 0 ? "border-[#ECD8AB]" : "border-[#ECE6DB]"}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold truncate">{l.productName}</p>
                    <p className="text-[12px] text-[#6E7F70]">
                      Expected: {l.quantity} · Delivered: <span className="font-bold text-[#1A2E20]">{st.delivered}</span>
                      {short > 0 && <span className="text-[#8F6710]"> · {short} short</span>}
                    </p>
                  </div>
                  <Stepper value={st.delivered} max={l.quantity} label={`${l.productName} delivered`} onChange={(v) => setLine(l.lineId, { delivered: v })} variant={variant} />
                </div>
                {short > 0 && (
                  <div className="rn-enter mt-3 pt-3 border-t border-[#E6DFD2] space-y-2.5">
                    <div className="flex flex-wrap gap-1.5" aria-label="Reason">
                      {REASONS.map((r) => (
                        <button key={r} type="button" onClick={() => setLine(l.lineId, { reason: r })} className={`rn-press h-8 px-3 rounded-full text-[12px] font-semibold ${st.reason === r ? "bg-[#C9501C] text-white" : "bg-white text-[#3E4E42] border border-[#E2DBCE]"}`}>
                          {r}
                        </button>
                      ))}
                    </div>
                    <input value={st.reason} onChange={(e) => setLine(l.lineId, { reason: e.target.value })} placeholder="Or type the reason" aria-label={`Reason for ${l.productName}`} className="w-full h-11 px-3 rounded-lg border border-[#E2DBCE] bg-white text-sm" />
                    <p className="text-[12px] font-semibold text-[#5A6C5E]">Where are the {short} undelivered?</p>
                    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`Where the undelivered ${l.productName} went`}>
                      {DISPOSITIONS.map((d) => (
                        <button key={d} type="button" role="radio" aria-checked={st.disposition === d} onClick={() => setLine(l.lineId, { disposition: d })} className={`rn-press h-11 rounded-full text-[12px] font-semibold ${st.disposition === d ? "bg-[#C9501C] text-white" : "bg-white text-[#3E4E42] border border-[#E2DBCE]"}`}>
                          {d === "WITH_STAFF" ? "With me" : DISPOSITION_LABEL[d]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ) : (
        <section className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setLegacyDelivered(true)} className={`rn-press h-12 rounded-full font-semibold ${legacyDelivered ? "bg-[#C9501C] text-white" : "bg-[#EFEAE1]"}`}>
            Delivered
          </button>
          <button type="button" onClick={() => setLegacyDelivered(false)} className={`rn-press h-12 rounded-full font-semibold ${!legacyDelivered ? "bg-[#9A3423] text-white" : "bg-[#EFEAE1]"}`}>
            Not delivered
          </button>
          {!legacyDelivered && <input value={legacyReason} onChange={(e) => setLegacyReason(e.target.value)} placeholder="Reason" className="col-span-2 h-11 px-3 rounded-lg border border-[#E2DBCE] bg-white text-sm" />}
        </section>
      )}

      {!nothing && (
        <section aria-label="Handed over to" className="space-y-2">
          <p className={K.eyebrow}>Handed over to</p>
          <SelectMenu
            label="Handed over to"
            value={choice}
            onChange={setChoice}
            options={choices.map((c) => ({ value: c.key, label: c.label }))}
            triggerClassName={panel ? "bg-[#F4F0E8] text-[#1A2E20]" : "bg-white border border-[#ECE6DB] text-[#1A2E20]"}
          />
          {choice === "other" && <input value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="Name of the person who took it" autoComplete="off" className="w-full h-12 px-4 rounded-xl border border-[#ECE6DB] bg-white text-[14px]" />}
        </section>
      )}

      {doorstep && !nothing ? (
        <section aria-label="Payment" className={`${K.soft} p-4 space-y-3`}>
          {prev && previous !== 0 && (
            // A small statement: this order, what was owed (or paid ahead) before it, and the total.
            <dl className="rounded-xl bg-white border border-[#ECE6DB] overflow-hidden text-[14px]" aria-label="Customer balance">
              <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-[#3E4E42]">This order</dt>
                <dd className="font-bold tabular-nums text-[#1F2320]">{rupees(amountDue)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 border-t border-[#F1ECE3]">
                <dt className="min-w-0 text-[#3E4E42]">
                  {previous > 0 ? "Earlier due" : "Customer credit"}
                  <span className="block text-[11.5px] text-[#6E7F70] leading-snug">
                    {[prev.earlierOrders > 0 && `earlier orders ${rupees(prev.earlierOrders)}`, prev.bills > 0 && `tiffin bills ${rupees(prev.bills)}`, prev.credit > 0 && `paid ahead ${rupees(prev.credit)}`].filter(Boolean).join(" · ")}
                  </span>
                </dt>
                <dd className={`font-bold tabular-nums ${previous > 0 ? "text-[#B4440F]" : "text-[#2F6B24]"}`}>
                  {previous > 0 ? "+ " : "− "}
                  {rupees(Math.abs(previous))}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3.5 py-3 border-t-2 border-[#E5DCCD] bg-[#FBF6EE]">
                <dt className="font-bold text-[#1F2320]">Total due</dt>
                <dd className="text-[17px] font-extrabold tabular-nums text-[#1F2320]">{rupees(totalDue)}</dd>
              </div>
            </dl>
          )}
          {/* Amounts shrink to fit their column so a large order never runs into the next figure. */}
          <div className="grid grid-cols-3 gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6E7F70]">Due</p>
              <p className="text-[clamp(0.85rem,4.4vw,1.125rem)] font-extrabold tabular-nums break-all"><span key={amountDue} className="rn-tick">{rupees(amountDue)}</span></p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6E7F70]">Collecting</p>
              <p className="text-[clamp(0.85rem,4.4vw,1.125rem)] font-extrabold tabular-nums break-all text-[#2F6B24]">{collectedOk ? rupees(collected) : "—"}</p>
            </div>
            <div className="min-w-0 text-right">
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6E7F70]">{payLaterKnown ? "Left to pay" : "Balance"}</p>
              <p className={`text-[clamp(0.85rem,4.4vw,1.125rem)] font-extrabold tabular-nums break-all ${balance > 0 ? "text-[#B4440F]" : "text-[#6E7F70]"}`}>{rupees(balance)}</p>
            </div>
          </div>
          {payLaterKnown ? (
            <>
              <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Payment">
                {(["CASH", "UPI", "PAY_LATER"] as const).map((m) => {
                  const review = m === "PAY_LATER" && !payLaterAllowed;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={method === m}
                      onClick={() => setMethod(m)}
                      className={`rn-press min-h-12 px-2 rounded-xl text-[14px] font-semibold leading-tight ${method === m ? "bg-[#C9501C] text-white" : "bg-white text-[#3E4E42] border border-[#E2DBCE]"}`}
                    >
                      {m === "CASH" ? "Cash" : m === "UPI" ? "UPI" : "Pay Later"}
                      {review && <span className={`block text-[10px] font-medium ${method === m ? "text-white/85" : "text-[#8F6710]"}`}>Office review</span>}
                    </button>
                  );
                })}
              </div>
              {payLater ? (
                <p className="text-[13px] text-[#3E4E42]">
                  Nothing collected now.
                  {fromCredit > 0 ? ` ${rupees(fromCredit)} is paid from the customer's credit.` : ""}
                  {balance > 0 ? ` ${rupees(balance)} goes on the customer's account.` : ""}
                  {!payLaterAllowed && <span className="block mt-1 text-[#8F6710] font-semibold">Not yet approved for Pay Later: the office will review this order.</span>}
                </p>
              ) : (
                <>
                  <input type="number" inputMode="numeric" min={0} step={1} value={collectedText ?? String(suggested)} onChange={(e) => setCollectedText(e.target.value)} aria-label="Amount collected (₹)" className={`w-full h-12 px-3 rounded-lg bg-white text-lg font-bold border ${collectedOk ? "border-transparent" : "border-[#9A3423]"}`} />
                  {prev && previous > 0 && collectedOk && collected < totalDue && (
                    <button type="button" className="text-[13px] font-semibold text-[#C9501C] underline underline-offset-2" onClick={() => setCollectedText(String(totalDue))}>
                      Collect the total due {rupees(totalDue)}
                    </button>
                  )}
                  {fromCredit > 0 && collectedOk && (
                    <p className="text-[13px] text-[#2F6B24]" aria-label="Credit used">
                      {rupees(fromCredit)} is paid from the customer&apos;s credit.
                    </p>
                  )}
                  {balance > 0 && collectedOk && (
                    <p className={`text-[13px] ${needsReview ? "text-[#8F6710] font-semibold" : "text-[#3E4E42]"}`}>
                      {rupees(balance)} goes on the customer&apos;s account{needsReview ? " (not yet approved for Pay Later: the office will review)" : ""}.
                    </p>
                  )}
                  {extra > 0 && collectedOk && (
                    <p className="text-[13px] text-[#2F6B24]" aria-label="Allocation">
                      {rupees(toOrder)} for this order{toEarlier > 0 ? ` · ${rupees(toEarlier)} for earlier orders` : ""}{advance > 0 ? ` · ${rupees(advance)} kept as advance` : ""}.
                    </p>
                  )}
                  {method === "UPI" && collectedOk && <UpiQr amount={collected} note={task.customerName ? `Order ${task.customerName}` : undefined} />}
                </>
              )}
            </>
          ) : (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input type="number" inputMode="numeric" min={0} max={amountDue} step={1} value={collectedText ?? String(suggested)} onChange={(e) => setCollectedText(e.target.value)} aria-label="Amount collected (₹)" className={`h-12 px-3 rounded-lg bg-white text-lg font-bold border ${collectedOk ? "border-transparent" : "border-[#9A3423]"}`} />
              <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-white" role="radiogroup" aria-label="Paid by">
                {(["CASH", "UPI"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={method === m} onClick={() => setMethod(m)} className={`rn-press h-10 px-4 rounded-full text-sm font-semibold ${method === m ? "bg-[#C9501C] text-white" : "text-[#3E4E42]"}`}>
                    {m === "CASH" ? "Cash" : "UPI"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : (
        !nothing &&
        panel && (
          <p className={`${K.soft} flex items-center gap-2.5 px-4 py-3 text-[13px] text-[#3E4E42]`}>
            <CircleCheck className="w-4 h-4 text-[#2F6B24] shrink-0" />
            {task.paymentMode === "MONTHLY" ? "Monthly plan · nothing to collect" : "Resident meal · nothing to collect"}
          </p>
        )
      )}

      <div className={panel ? "space-y-3" : "sticky bottom-0 -mx-5 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-[#FBF9F3] space-y-2"}>
        {queued ? (
          <button type="button" onClick={onClose} className={`${K.primaryBtn} w-full h-14 text-[15px]`}>
            Done
          </button>
        ) : (
          <button type="button" onClick={submit} disabled={busy} className={`${K.primaryBtn} w-full h-14 text-[15px] ${nothing ? "!bg-[#9A3423]" : ""}`}>
            {nothing ? <CircleSlash className="w-5 h-5" /> : panel ? <CheckCircle2 className="w-5 h-5" /> : <Check className="w-5 h-5" />}
            {busy
              ? "Saving…"
              : nothing
                ? "Save as Not Delivered"
                : shortLines.length > 0
                  ? `Confirm partial delivery (${deliveredUnits}/${orderedUnits})`
                  : doorstep && payLater
                    ? "Mark as delivered · Pay Later"
                    : `Confirm Delivery${panel && stopNo !== undefined ? ` (Stop #${stopNo})` : ""}`}
          </button>
        )}
        {!queued && (
          <div className="flex items-center justify-center gap-4 text-[13px] font-semibold">
            {lines.length > 0 &&
              (nothing ? (
                <button type="button" onClick={() => setAll(true)} className="text-[#C9501C] hover:underline h-9">
                  Back to full delivery
                </button>
              ) : (
                <button type="button" onClick={() => setAll(false)} className="flex items-center gap-1.5 text-[#9A3423] hover:underline h-9">
                  <Flag className="w-4 h-4" /> Report Issue
                </button>
              ))}
            {task.customerPhone && (
              <>
                <span className="w-px h-4 bg-[#E2DBCE]" />
                <CallLink phone={task.customerPhone} className="flex items-center gap-1.5 text-[#3E4E42] hover:underline h-9">
                  <Phone className="w-4 h-4" /> Call Customer
                </CallLink>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The phone's "Handoff confirmation" sheet (also used by the Manager to record on behalf). */
export function DeliverySheet({ task, stopNo, onClose, onSaved, currentUserId }: { task: DeliveryTask | null; stopNo?: number; onClose: () => void; onSaved: (msg: string, saved?: DeliveryTask) => void; currentUserId?: string }) {
  const drag = useSheetDrag(onClose, Boolean(task));
  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, onClose]);
  if (!task) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center">
      <div className="rn-scrim absolute inset-0 bg-[#16221A]/45" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label={`Deliver to ${displayName(task)}`} {...drag.bind} style={drag.style} className="rn-sheet relative w-full md:max-w-lg max-h-[92dvh] overflow-y-auto bg-[#FBF9F3] rounded-t-[28px] md:rounded-[28px] shadow-2xl">
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[#DAD3C6]" aria-hidden="true" />
        <header className="px-5 pt-4 pb-4 flex items-start justify-between gap-3 border-b border-[#ECE6DB] mb-5">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#B4440F]">Handoff confirmation</p>
            <h2 className="mt-1 text-[22px] font-extrabold tracking-[-0.02em] truncate">Deliver to {displayName(task)}</h2>
            <p className="text-[13px] text-[#6E7F70] truncate">{placeLine(task)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rn-press w-10 h-10 rounded-full bg-[#EFEAE1] text-[#3E4E42] flex items-center justify-center shrink-0">
            <X className="w-5 h-5" />
          </button>
        </header>
        <DeliveryForm task={task} stopNo={stopNo} variant="sheet" onSaved={onSaved} onClose={onClose} currentUserId={currentUserId} />
      </div>
    </div>
  );
}
