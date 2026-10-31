"use client";

import React from "react";
import { UtensilsCrossed, Landmark, X } from "lucide-react";
import type { DeliveryTask } from "@/types";
import { deliveryOutcome, undeliveredOf, DISPOSITION_LABEL } from "@/lib/delivery/outcome";
import { rupees, displayName, placeLine } from "./ui";
import { useSheetDrag } from "@/components/feedback/useSheetDrag";
import { K, Pill, two, clock } from "./staffKit";

const stamp = (iso: string | null | undefined) =>
  iso ? `${new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso))} · ${clock(iso)}` : "—";

/** How completely a recorded stop was delivered, as the design's status chip. */
export function outcomeChip(t: DeliveryTask): { text: string; tone: "success" | "accent" | "danger" } {
  const lines = t.lines ?? [];
  const ordered = lines.reduce((n, l) => n + l.quantity, 0);
  const delivered = lines.reduce((n, l) => n + (l.deliveredQuantity ?? 0), 0);
  const o = deliveryOutcome(t);
  if (o === "NOT_DELIVERED") return { text: "Not Delivered", tone: "danger" };
  if (o === "PARTIAL") return { text: `Partial (${ordered ? Math.round((delivered / ordered) * 100) : 0}%)`, tone: "accent" };
  return { text: "Delivered (100%)", tone: "success" };
}

/** Payment and ledger sentence for a recorded stop. */
export function ledgerText(t: DeliveryTask): string {
  if (t.paymentMode === "MONTHLY") return "Monthly plan. Nothing to collect at the door.";
  if (t.paymentMode === "NONE") return "Room delivery for a resident. Nothing to collect.";
  const due = t.expectedAmount ?? 0;
  const got = t.collectedAmount ?? 0;
  return `${rupees(due)} to pay · ${rupees(got)} collected${(t.balanceDue || 0) > 0 ? ` · ${rupees(t.balanceDue)} still due` : " · fully paid"}.`;
}

/** A recorded stop in detail (History panel, and the My Stops panel for a completed stop). */
export function RecordDetail({ task, stopNo, onClose }: { task: DeliveryTask; stopNo?: number; onClose?: () => void }) {
  const chip = outcomeChip(task);
  const at = task.deliveredAt || task.exceptionAt;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-[22px] leading-tight font-extrabold tracking-[-0.02em]">{displayName(task)}</h2>
          <p className="mt-0.5 text-[13px] text-[#5A6C5E]">
            {placeLine(task)}
            {task.landmark ? `, ${task.landmark}` : ""}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {stopNo !== undefined && <Pill tone="grey">Stop {two(stopNo)}</Pill>}
            <Pill tone={chip.tone}>{chip.text}</Pill>
          </div>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="rn-press w-10 h-10 -mr-1 rounded-full bg-[#EFEAE1] text-[#1F2320] flex items-center justify-center shrink-0 hover:bg-[#E6E0D4]">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
      <div className={`${K.soft} grid grid-cols-2 gap-4 p-4`}>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#5A6C5E]">Given to</p>
          <p className="mt-1 text-[14px] font-bold truncate">{task.recipientName || (task.status === "EXCEPTION" ? "Not delivered" : "—")}</p>
          {task.status === "EXCEPTION" && task.exceptionReason && <p className="text-[12px] text-[#9A3423]">{task.exceptionReason}</p>}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#5A6C5E]">{task.status === "EXCEPTION" ? "Recorded at" : "Delivered at"}</p>
          <p className="mt-1 text-[14px] font-bold">{stamp(at)}</p>
        </div>
      </div>
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-[15px] font-extrabold">Items</h3>
          <span className="text-[12px] text-[#5A6C5E]">Delivered / ordered</span>
        </div>
        <ul className="space-y-2">
          {(task.lines ?? []).map((l) => {
            const short = undeliveredOf(l);
            return (
              <li key={l.lineId} className={`${K.soft} flex items-center gap-3 px-4 py-3`}>
                <UtensilsCrossed className="w-4 h-4 text-[#B4440F] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold truncate">{l.productName}</p>
                  {short > 0 && <p className="text-[12px] text-[#9A3423] truncate">{`${l.undeliveredReason || "No reason"} · ${l.disposition ? DISPOSITION_LABEL[l.disposition] : "not recorded"}`}</p>}
                </div>
                <p className={`text-[14px] font-extrabold tabular-nums shrink-0 ${short > 0 ? "text-[#9A3423]" : "text-[#2F6B24]"}`}>
                  {l.deliveredQuantity ?? 0} / {l.quantity}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
      <PaymentCard task={task} />
    </div>
  );
}

/** Money for the stop: what was to be paid, what was collected (and how), and where it stands. */
function PaymentCard({ task }: { task: DeliveryTask }) {
  const head = (
    <p className="flex items-center gap-2 text-[15px] font-extrabold">
      <Landmark className="w-4 h-4 text-[#B4440F]" /> Payment
    </p>
  );
  if (task.paymentMode === "MONTHLY" || task.paymentMode === "NONE") {
    return (
      <div className="rounded-2xl border border-[#ECE6DB] bg-white p-4 flex flex-wrap items-center justify-between gap-2">
        {head}
        <Pill tone="success">{task.paymentMode === "MONTHLY" ? "Monthly plan · nothing to collect" : "Room delivery · nothing to collect"}</Pill>
      </div>
    );
  }
  const due = task.expectedAmount ?? 0;
  const got = task.collectedAmount ?? 0;
  const left = task.balanceDue ?? Math.max(0, due - got);
  const method = task.collectedPaymentMethod === "UPI" ? "UPI" : task.collectedPaymentMethod === "CASH" ? "Cash" : null;
  return (
    <div className="rounded-2xl border border-[#ECE6DB] bg-white overflow-hidden">
      <div className="px-4 pt-4 pb-3">{head}</div>
      <dl className="px-4 pb-3 space-y-2 text-[14px]">
        <div className="flex items-center justify-between">
          <dt className="text-[#5A6C5E]">To pay</dt>
          <dd className="font-bold tabular-nums">{rupees(due)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[#5A6C5E]">Collected{method ? ` · ${method}` : ""}</dt>
          <dd className="font-bold tabular-nums">{rupees(got)}</dd>
        </div>
      </dl>
      <div className={`px-4 py-3 flex items-center justify-between ${left > 0 ? "bg-[#FBE3DD] text-[#9A3423]" : "bg-[#DDF1D6] text-[#2F6B24]"}`}>
        <span className="text-[13px] font-bold">{left > 0 ? "Still due" : "Status"}</span>
        <span className="text-[15px] font-extrabold tabular-nums">{left > 0 ? rupees(left) : "Fully paid"}</span>
      </div>
    </div>
  );
}



/**
 * Phone: a finished stop opens read-only in a bottom sheet (what was given, to whom, money).
 * Closes with a tap outside, pulling it down, or Escape (no close button).
 */
export function RecordSheet({ task, stopNo, onClose }: { task: DeliveryTask | null; stopNo?: number; onClose: () => void }) {
  const drag = useSheetDrag(onClose, Boolean(task));
  React.useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, onClose]);
  if (!task) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center overscroll-contain">
      <div className="rn-scrim absolute inset-0 bg-[#16221A]/45" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delivery record: ${displayName(task)}`}
        {...drag.bind}
        style={drag.style}
        className="rn-sheet relative w-full md:max-w-lg max-h-[88dvh] overflow-y-auto overscroll-contain bg-[#FBF9F3] rounded-t-[28px] md:rounded-[28px] shadow-2xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <div className="md:hidden mx-auto mt-2.5 mb-3 h-1.5 w-12 rounded-full bg-[#DAD3C6]" aria-hidden="true" />
        <div className="md:pt-6">
          <RecordDetail task={task} stopNo={stopNo} />
        </div>
      </div>
    </div>
  );
}
