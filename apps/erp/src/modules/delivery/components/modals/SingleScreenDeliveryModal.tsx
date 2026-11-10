"use client";

import { friendlyError } from "@/lib/friendlyError";
import React, { useState, useEffect, useMemo } from "react";
import { X, CheckCircle2, AlertCircle, MapPin, Phone, Minus, Plus } from "lucide-react";
import { DeliveryTask, DeliveryOrderLine } from "@/types";
import { enqueueDeliveryAction } from "../../offlineQueue";

interface SingleScreenDeliveryModalProps {
  task: DeliveryTask | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentUserId?: string;
}

const SHORTFALL_REASONS = ["Customer took fewer", "Customer not available", "Cancelled at door", "Damaged in transit"];

/** Small − value + control with large touch targets. */
function Stepper({
  value,
  max,
  onChange,
  label,
  tone,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  tone: "ok" | "warn";
}) {
  const clamp = (v: number) => Math.max(0, Math.min(max, Number.isFinite(v) ? Math.trunc(v) : 0));
  const ring = tone === "ok" ? "border-emerald-300" : "border-amber-300";
  return (
    <div className="flex items-center gap-1" aria-label={label}>
      <button
        type="button"
        aria-label={`${label}: one less`}
        disabled={value <= 0}
        onClick={() => onChange(clamp(value - 1))}
        className="w-10 h-10 rounded-xl bg-white border border-[#DCD6CD] text-[#1A2E20] flex items-center justify-center disabled:opacity-30 active:bg-[#FAF8F5]"
      >
        <Minus className="w-4 h-4" />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(clamp(parseInt(e.target.value, 10)))}
        className={`w-12 h-10 text-center text-base font-mono font-bold bg-white border ${ring} rounded-xl text-[#1A2E20]`}
      />
      <button
        type="button"
        aria-label={`${label}: one more`}
        disabled={value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="w-10 h-10 rounded-xl bg-white border border-[#DCD6CD] text-[#1A2E20] flex items-center justify-center disabled:opacity-30 active:bg-[#FAF8F5]"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

export function SingleScreenDeliveryModal({ task, isOpen, onClose, onSuccess, currentUserId }: SingleScreenDeliveryModalProps) {
  const lines: DeliveryOrderLine[] = useMemo(() => task?.orderLines ?? [], [task]);
  const isOrder = lines.length > 0;

  // Per-line delivered quantities (order mode). Not delivered = ordered − delivered.
  const [delivered, setDelivered] = useState<Record<string, number>>({});
  // Subscription runs without itemised orders: one portion count.
  const [portions, setPortions] = useState(1);
  const [reason, setReason] = useState("");
  const [collectedInput, setCollectedInput] = useState("");
  const [collectedEdited, setCollectedEdited] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "UPI">("CASH");
  const [notes, setNotes] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fresh form for each opened task; one idempotency key per opened task so a retry or the
  // offline replay of this submission is recognised by the server as the same completion.
  useEffect(() => {
    if (!task) return;
    setDelivered(Object.fromEntries((task.orderLines ?? []).map((l) => [l.orderItemId, l.quantity])));
    setPortions(1);
    setReason("");
    setCollectedInput("");
    setCollectedEdited(false);
    setPaymentMethod("CASH");
    setNotes("");
    setErrorMessage(null);
    setQueuedOffline(false);
    setIdempotencyKey(`del_${task.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
  }, [task]);

  const orderedUnits = lines.reduce((s, l) => s + l.quantity, 0);
  const deliveredUnits = lines.reduce((s, l) => s + (delivered[l.orderItemId] ?? 0), 0);
  const hasShortfall = isOrder ? deliveredUnits < orderedUnits : false;
  const nothingDelivered = isOrder ? deliveredUnits === 0 : portions === 0;
  // Amount due from delivered quantities at the prices saved on the order.
  const amountDue = lines.reduce((s, l) => s + (delivered[l.orderItemId] ?? 0) * l.unitPrice, 0);
  // Collected follows the amount due until the user types their own figure.
  const collectedText = isOrder && !collectedEdited ? String(amountDue) : collectedInput;
  const collected = collectedText.trim() === "" ? 0 : Number(collectedText);
  const collectedValid = Number.isInteger(collected) && collected >= 0 && (!isOrder || collected <= amountDue);
  const remaining = Math.max(0, amountDue - (collectedValid ? collected : 0));

  const outcome = !isOrder
    ? null
    : nothingDelivered
      ? { text: "Not delivered — nothing to collect", tone: "warn" }
      : hasShortfall
        ? { text: `Partly delivered (${deliveredUnits} of ${orderedUnits}) · ${remaining > 0 ? `₹${remaining} pending` : "fully paid"}`, tone: "warn" }
        : remaining > 0
          ? { text: `Fully delivered · ₹${remaining} pending`, tone: "warn" }
          : { text: "Fully delivered · fully paid", tone: "ok" };

  const setLine = (line: DeliveryOrderLine, deliveredQty: number) =>
    setDelivered((prev) => ({ ...prev, [line.orderItemId]: Math.max(0, Math.min(line.quantity, deliveredQty)) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task || isSubmitting) return;
    setErrorMessage(null);

    if ((hasShortfall || (!isOrder && portions === 0)) && !reason.trim()) {
      setErrorMessage("Choose or type a reason for the items not delivered.");
      return;
    }
    if (!collectedValid) {
      setErrorMessage(
        isOrder && collected > amountDue
          ? `Amount collected cannot be more than ₹${amountDue} due for the delivered items.`
          : "Amount collected must be a whole number of rupees, 0 or more."
      );
      return;
    }
    if (nothingDelivered && collected > 0) {
      setErrorMessage("Nothing was delivered, so nothing can be collected.");
      return;
    }

    const payload = isOrder
      ? {
          lines: lines.map((l) => ({
            orderItemId: l.orderItemId,
            deliveredQuantity: delivered[l.orderItemId] ?? 0,
            undeliveredQuantity: l.quantity - (delivered[l.orderItemId] ?? 0),
          })),
          undeliveredReason: hasShortfall ? reason.trim() : undefined,
          collectedAmount: collected,
          paymentMethod: collected > 0 ? paymentMethod : undefined,
          notes: notes.trim() || undefined,
        }
      : {
          deliveredQuantity: portions,
          undeliveredQuantity: portions === 0 ? 1 : 0,
          undeliveredReason: portions === 0 ? reason.trim() : undefined,
          collectedAmount: collected,
          paymentMethod: collected > 0 ? paymentMethod : undefined,
          notes: notes.trim() || undefined,
        };

    setIsSubmitting(true);
    const queueForSync = () => {
      enqueueDeliveryAction("COMPLETE_DELIVERY", task.id, payload, currentUserId, idempotencyKey);
      setQueuedOffline(true);
    };
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        queueForSync();
        return;
      }
      let res: Response;
      try {
        res = await fetch(`/api/delivery/tasks/${task.id}/deliver`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, idempotencyKey }),
        });
      } catch {
        // No connection (dead zone): keep the completion on the phone; it syncs when back online.
        queueForSync();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the delivery. Please try again.");
      onSuccess();
      onClose();
    } catch (err: any) {
      // Entered quantities and amounts stay on screen so the user can correct and retry.
      setErrorMessage(friendlyError(err.message || "Could not save the delivery. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !task) return null;

  const customerName = task.orderType === "EXTERNAL" ? task.customerName || "Customer" : task.residentName || `Room ${task.roomNumber}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Record delivery"
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-[#DCD6CD] shadow-2xl flex flex-col max-h-[96dvh] overflow-hidden"
      >
        <div className="px-4 py-3 bg-[#FAF8F5] border-b border-[#E6E1DA] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-serif text-lg text-[#1A2E20] font-bold truncate">{customerName}</h3>
            <p className="text-[11px] font-mono text-[#8E9F89]">
              {task.mealType}
              {task.orderId ? ` · Order ${task.orderId.slice(-6).toUpperCase()}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 -m-1 text-[#8E9F89] hover:text-[#1A2E20] rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex-1 overflow-y-auto p-4 space-y-4">
          {errorMessage && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-800 text-sm rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>{errorMessage}</span>
            </div>
          )}
          {queuedOffline && (
            <div role="status" className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl">
              No connection. This delivery is saved on this phone and will sync automatically when you are back online.
            </div>
          )}

          {(task.deliveryAddress || task.customerPhone) && (
            <div className="text-sm space-y-1">
              {task.deliveryAddress && (
                <p className="flex items-start gap-1.5 text-[#1A2E20]">
                  <MapPin className="w-4 h-4 text-[#B58A57] shrink-0 mt-0.5" />
                  <span>{task.deliveryAddress}</span>
                </p>
              )}
              {task.customerPhone && (
                <a href={`tel:${task.customerPhone}`} className="inline-flex items-center gap-1.5 text-[#1A2E20] font-mono">
                  <Phone className="w-4 h-4 text-[#B58A57]" />
                  {task.customerPhone}
                </a>
              )}
            </div>
          )}

          {isOrder ? (
            <section className="space-y-2" aria-label="Items">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-serif font-bold text-[#1A2E20]">Items</h4>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDelivered(Object.fromEntries(lines.map((l) => [l.orderItemId, l.quantity])))}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-emerald-300 text-emerald-900 bg-emerald-50"
                  >
                    All delivered
                  </button>
                  <button
                    type="button"
                    onClick={() => setDelivered(Object.fromEntries(lines.map((l) => [l.orderItemId, 0])))}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-amber-300 text-amber-900 bg-amber-50"
                  >
                    Nothing delivered
                  </button>
                </div>
              </div>
              {lines.map((line) => {
                const d = delivered[line.orderItemId] ?? 0;
                return (
                  <div key={line.orderItemId} className="p-3 rounded-2xl border border-[#E6E1DA] space-y-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-[#1A2E20]">{line.productName}</span>
                      <span className="text-xs font-mono text-[#5D7656] whitespace-nowrap">
                        {line.quantity} × ₹{line.unitPrice}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="block text-[11px] text-emerald-900 mb-1">Delivered</span>
                        <Stepper value={d} max={line.quantity} tone="ok" label={`${line.productName} delivered`} onChange={(v) => setLine(line, v)} />
                      </div>
                      <div>
                        <span className="block text-[11px] text-amber-900 mb-1">Not delivered</span>
                        <Stepper
                          value={line.quantity - d}
                          max={line.quantity}
                          tone="warn"
                          label={`${line.productName} not delivered`}
                          onChange={(v) => setLine(line, line.quantity - v)}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          ) : (
            <section className="p-3 rounded-2xl border border-[#E6E1DA] flex items-center justify-between gap-3">
              <span className="text-sm text-[#1A2E20]">Delivered</span>
              <Stepper value={portions} max={1} tone="ok" label="Portions delivered" onChange={setPortions} />
            </section>
          )}

          {(hasShortfall || (!isOrder && portions === 0)) && (
            <section className="p-3 bg-amber-50 rounded-2xl border border-amber-200 space-y-2">
              <label htmlFor="shortfall-reason" className="block text-sm font-serif font-bold text-amber-900">
                Reason for items not delivered *
              </label>
              <div className="flex flex-wrap gap-1.5">
                {SHORTFALL_REASONS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setReason(chip)}
                    className={`px-2.5 py-1.5 text-xs rounded-lg border ${
                      reason === chip ? "bg-amber-800 text-white border-amber-800" : "bg-white text-amber-900 border-amber-300"
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <input
                id="shortfall-reason"
                type="text"
                placeholder="Or type the reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-amber-300 rounded-xl text-[#1A2E20]"
              />
            </section>
          )}

          {!nothingDelivered && (
            <section className="p-3 rounded-2xl border border-[#E6E1DA] space-y-3" aria-label="Payment">
              {isOrder && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <span className="block text-[11px] text-[#8E9F89]">Due</span>
                    <span className="text-base font-bold text-[#1A2E20]">₹{amountDue}</span>
                  </div>
                  <div>
                    <span className="block text-[11px] text-[#8E9F89]">Collected</span>
                    <span className="text-base font-bold text-emerald-800">₹{collectedValid ? collected : "—"}</span>
                  </div>
                  <div>
                    <span className="block text-[11px] text-[#8E9F89]">Remaining</span>
                    <span className={`text-base font-bold ${remaining > 0 ? "text-amber-800" : "text-[#5D7656]"}`}>₹{remaining}</span>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="collected" className="block text-[11px] text-[#1A2E20] mb-1">
                    Amount collected (₹)
                  </label>
                  <input
                    id="collected"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={isOrder ? amountDue : undefined}
                    step={1}
                    value={collectedText}
                    onChange={(e) => {
                      setCollectedEdited(true);
                      setCollectedInput(e.target.value);
                    }}
                    className={`w-full h-11 px-3 text-base font-mono font-bold bg-[#FAF8F5] border rounded-xl text-[#1A2E20] ${
                      collectedValid ? "border-[#DCD6CD]" : "border-red-400"
                    }`}
                  />
                </div>
                <div>
                  <span className="block text-[11px] text-[#1A2E20] mb-1">Paid by</span>
                  <div className="grid grid-cols-2 gap-1 h-11">
                    {(["CASH", "UPI"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPaymentMethod(m)}
                        aria-pressed={paymentMethod === m}
                        className={`rounded-xl text-sm border ${
                          paymentMethod === m ? "bg-[#1A2E20] text-white border-[#1A2E20]" : "bg-white text-[#1A2E20] border-[#DCD6CD]"
                        }`}
                      >
                        {m === "CASH" ? "Cash" : "UPI"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          <input
            type="text"
            placeholder="Note (optional), e.g. handed at security"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
          />

          {outcome && (
            <p
              role="status"
              className={`text-sm font-medium px-3 py-2 rounded-xl ${
                outcome.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"
              }`}
            >
              {outcome.text}
            </p>
          )}

          <div className="sticky bottom-0 bg-white pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
            {queuedOffline ? (
              <button type="button" onClick={onClose} className="w-full h-12 bg-[#1A2E20] text-white font-bold text-base rounded-2xl">
                Done
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-base rounded-2xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5" />
                {isSubmitting ? "Saving…" : nothingDelivered ? "Save as not delivered" : "Save delivery"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
