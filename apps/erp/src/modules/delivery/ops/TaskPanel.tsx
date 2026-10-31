"use client";

import React, { useState } from "react";
import { Phone, RotateCcw, UserRoundCog, Ban, CheckCheck, IndianRupee, ClipboardCheck } from "lucide-react";
import type { DeliveryTask, DeliveryTaskEvent } from "@/types";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { deliveryOutcome, needsFollowUp, DISPOSITION_LABEL, undeliveredOf } from "@/lib/delivery/outcome";
import { useTaskDetail, postJson, StaffOption } from "./data";
import { Sheet, Notice, OutcomeBadge, btn, rupees, timeOf, displayName, placeLine } from "./ui";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { CallLink } from "./DeliverySheet";
import { SelectMenu } from "@/components/forms/SelectMenu";

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Added to the list",
  ASSIGNED: "Assigned",
  REASSIGNED: "Reassigned",
  DISPATCHED: "Out for delivery",
  DELIVERED: "Delivered / payment",
  EXCEPTION: "Not delivered",
  RETRIED: "Sent again",
  CANCELLED: "Cancelled",
  RESOLVED: "Resolved",
  UPDATED: "Quantity changed",
};

function Timeline({ events }: { events: DeliveryTaskEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-text-muted">No history yet.</p>;
  return (
    <ol className="relative border-l border-surface-subtle ml-1.5 space-y-3">
      {events.map((e) => (
        <li key={e.id} className="pl-4 relative">
          <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ${e.eventType === "EXCEPTION" || e.eventType === "CANCELLED" ? "bg-status-danger-text" : e.eventType === "DELIVERED" ? "bg-forest" : "bg-brass"}`} />
          <p className="text-sm text-text-primary">
            <span className="font-medium">{EVENT_LABEL[e.eventType] || e.eventType}</span>
            <span className="text-text-muted"> · {timeOf(e.createdAt)} · {e.actorName}</span>
          </p>
          {e.notes && <p className="text-xs text-text-secondary mt-0.5">{e.notes}</p>}
        </li>
      ))}
    </ol>
  );
}

type Action = null | "assign" | "retry" | "cancel" | "resolve" | "collect";

/**
 * One delivery in focus: who and where, each item's ordered / delivered / undelivered with reason
 * and disposition, the money (one-off orders), the timeline, and the Manager's actions.
 * Read-only for the Owner's default view.
 */
export function TaskPanel({ taskId, onClose, readOnly, staff, pastCutoff, onRecord }: {
  taskId: string | null;
  onClose: () => void;
  readOnly: boolean;
  staff: StaffOption[];
  pastCutoff: boolean;
  onRecord: (t: DeliveryTask) => void;
}) {
  const q = useTaskDetail(taskId);
  const [action, setAction] = useState<Action>(null);
  const [staffId, setStaffId] = useState("");
  const [text, setText] = useState("");
  const [override, setOverride] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "UPI">("CASH");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  if (!taskId) return null;
  const t = q.data?.task;
  const events = q.data?.events ?? [];
  const o = t ? deliveryOutcome(t) : null;
  const open = o === "WAITING" || o === "OUT";
  const start = (a: Action) => {
    setAction(a);
    setText("");
    setOverride(false);
    setStaffId(t?.assignedTo || "");
    setAmount(t?.balanceDue ? String(t.balanceDue) : "");
    setMsg(null);
  };
  const run = async (url: string, body: unknown, done: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await postJson(url, body);
      invalidateErpCache(["delivery", "orders", "custody", "handover", "dashboard"]);
      setMsg({ tone: "ok", text: done });
      setAction(null);
      q.refetch();
    } catch (e: any) {
      setMsg({ tone: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} wide title={t ? displayName(t) : "Delivery"} subtitle={t ? <span className="flex items-center gap-2">{placeLine(t)} {o && <OutcomeBadge outcome={o} />}</span> : undefined}>
      {!t ? (
        q.error ? <p role="alert" className="text-sm text-status-danger-text">{q.error.message}</p> : <BikeLoader size="sm" label="Loading…" className="py-12" />
      ) : (
        <div className="space-y-5">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

          <section className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-muted">Delivery person</p>
              <p className="text-text-primary">{t.assignedToName || "Unassigned"}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-muted">Payment</p>
              <p className="text-text-primary">{t.paymentMode === "DOORSTEP" ? "At the door" : t.paymentMode === "MONTHLY" ? "Monthly invoice" : "Included in stay"}</p>
            </div>
            {t.customerPhone && (
              <CallLink phone={t.customerPhone} wrapClassName="relative col-span-2 inline-flex" className="inline-flex items-center gap-2 text-text-primary">
                <Phone className="w-4 h-4 text-brass-dark" /> {t.customerPhone}
              </CallLink>
            )}
            {(t.landmark || t.deliveryInstructions) && (
              <p className="col-span-2 text-text-secondary">
                {t.landmark ? `Near ${t.landmark}. ` : ""}
                {t.deliveryInstructions || ""}
              </p>
            )}
          </section>

          <section aria-label="Items">
            <h3 className="font-serif text-lg text-text-primary mb-2">Items</h3>
            {(t.lines ?? []).length === 0 ? (
              <p className="text-sm text-text-muted">No item lines recorded for this delivery.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="text-left font-normal pb-1">Item</th>
                    <th className="text-right font-normal pb-1">Ordered</th>
                    <th className="text-right font-normal pb-1">Delivered</th>
                    <th className="text-right font-normal pb-1">Short</th>
                  </tr>
                </thead>
                <tbody>
                  {t.lines!.map((l) => {
                    const short = undeliveredOf(l);
                    return (
                      <React.Fragment key={l.lineId}>
                        <tr className="border-t border-surface-subtle">
                          <td className="py-1.5 text-text-primary">{l.productName}</td>
                          <td className="py-1.5 text-right tabular-nums">{l.quantity}</td>
                          <td className="py-1.5 text-right tabular-nums">{l.deliveredQuantity ?? "—"}</td>
                          <td className={`py-1.5 text-right tabular-nums ${short > 0 ? "text-status-warning-text font-medium" : "text-text-muted"}`}>{l.deliveredQuantity === null ? "—" : short}</td>
                        </tr>
                        {short > 0 && (
                          <tr>
                            <td colSpan={4} className="pb-2 text-xs text-text-secondary">
                              {l.undeliveredReason || "No reason recorded"} · {l.disposition ? DISPOSITION_LABEL[l.disposition] : "Where it went was not recorded"}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
            {t.recipientName && <p className="text-xs text-text-muted mt-2">Received by {t.recipientName}{t.deliveredAt ? ` at ${timeOf(t.deliveredAt)}` : ""}</p>}
            {t.status === "EXCEPTION" && t.exceptionReason && <p className="text-xs text-status-danger-text mt-2">Not delivered: {t.exceptionReason}</p>}
            {t.status === "CANCELLED" && (
              <p className="text-xs text-text-secondary mt-2">
                Cancelled{t.cutoffOverride ? " after the cutoff (Manager override)" : ""}: {t.cancelReason}
              </p>
            )}
            {t.resolvedAt && <p className="text-xs text-status-success-text mt-2">Resolved: {t.resolutionNote}</p>}
          </section>

          {t.paymentMode === "DOORSTEP" && (
            <section className="grid grid-cols-3 text-center rounded-2xl bg-white border border-surface-subtle py-2">
              <div>
                <p className="text-[11px] text-text-muted">{open ? "Order value" : "Due"}</p>
                <p className="font-serif text-lg">{rupees(open ? t.orderTotal : t.expectedAmount)}</p>
              </div>
              <div>
                <p className="text-[11px] text-text-muted">Collected</p>
                <p className="font-serif text-lg text-status-success-text">{rupees(t.collectedAmount)}</p>
              </div>
              <div>
                <p className="text-[11px] text-text-muted">Balance</p>
                <p className={`font-serif text-lg ${(t.balanceDue || 0) > 0 && !open ? "text-status-warning-text" : "text-text-muted"}`}>{open ? "—" : rupees(t.balanceDue)}</p>
              </div>
            </section>
          )}

          {!readOnly && o !== "CANCELLED" && (
            <section aria-label="Actions" className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {open && (
                  <button type="button" className={btn.brass} onClick={() => onRecord(t)}>
                    <ClipboardCheck className="w-4 h-4" /> Record delivery
                  </button>
                )}
                {(open || o === "NOT_DELIVERED") && (
                  <button type="button" className={btn.quiet} onClick={() => start("assign")}>
                    <UserRoundCog className="w-4 h-4" /> {t.assignedTo ? "Reassign" : "Assign"}
                  </button>
                )}
                {o === "NOT_DELIVERED" && (
                  <button type="button" className={btn.quiet} onClick={() => start("retry")}>
                    <RotateCcw className="w-4 h-4" /> Send again
                  </button>
                )}
                {needsFollowUp(t) && (
                  <button type="button" className={btn.quiet} onClick={() => start("resolve")}>
                    <CheckCheck className="w-4 h-4" /> Resolve
                  </button>
                )}
                {t.paymentMode === "DOORSTEP" && (o === "DELIVERED" || o === "PARTIAL") && (t.balanceDue || 0) > 0 && (
                  <button type="button" className={btn.quiet} onClick={() => start("collect")}>
                    <IndianRupee className="w-4 h-4" /> Collect balance
                  </button>
                )}
                {(open || o === "NOT_DELIVERED") && (
                  <button type="button" className={btn.danger} onClick={() => start("cancel")}>
                    <Ban className="w-4 h-4" /> Cancel
                  </button>
                )}
              </div>

              {action && (
                <div className="rn-enter rounded-2xl border border-surface-subtle bg-white p-3 space-y-2">
                  {(action === "assign" || action === "retry") && (
                    <SelectMenu
                      label="Delivery person"
                      tone="forest"
                      value={staffId}
                      onChange={setStaffId}
                      placeholder={action === "retry" ? "Same person" : "Choose delivery person"}
                      options={[{ value: "", label: action === "retry" ? "Same person" : "Choose delivery person" }, ...staff.map((s) => ({ value: s.id, label: s.fullName }))]}
                      triggerClassName="bg-surface-canvas border border-surface-subtle text-text-primary"
                    />
                  )}
                  {action === "collect" ? (
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <input type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount (₹)" className="min-h-[44px] px-3 rounded-xl border border-surface-subtle bg-surface-canvas" />
                      <div className="grid grid-cols-2 gap-1">
                        {(["CASH", "UPI"] as const).map((m) => (
                          <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} className={`rn-press min-h-[44px] px-3 rounded-xl border text-sm ${method === m ? "bg-forest-deepest text-text-light" : "bg-white"}`}>
                            {m === "CASH" ? "Cash" : "UPI"}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    action !== "assign" && (
                      <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={action === "cancel" ? "Reason for cancelling (required)" : action === "resolve" ? "How was it resolved? (required)" : "Note (optional)"}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-surface-subtle bg-surface-canvas text-sm"
                      />
                    )
                  )}
                  {action === "cancel" && pastCutoff && (
                    <label className="flex items-start gap-2 text-sm text-status-warning-text">
                      <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-1 w-4 h-4" />
                      This meal is past its cutoff. I confirm the Manager override (the reason is recorded).
                    </label>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy || (action === "assign" && !staffId)}
                      className={action === "cancel" ? btn.danger : btn.primary}
                      onClick={() => {
                        if (action === "assign") run(`/api/delivery/tasks/${t.id}/assign`, { assignedToStaffId: staffId }, "Assigned.");
                        else if (action === "retry") run(`/api/delivery/tasks/${t.id}/retry`, { reassignToStaffId: staffId || undefined, notes: text || undefined }, "Sent again.");
                        else if (action === "cancel") run(`/api/delivery/tasks/${t.id}/cancel`, { reason: text, overrideCutoff: override }, "Cancelled.");
                        else if (action === "resolve") run(`/api/delivery/tasks/${t.id}/resolve`, { note: text }, "Resolved.");
                        else if (action === "collect")
                          run(`/api/delivery/tasks/${t.id}/collect`, { collectedAmount: Number(amount), paymentMethod: method, idempotencyKey: `bal_${t.id}_${Date.now()}` }, "Payment recorded.");
                      }}
                    >
                      {busy ? "Saving…" : "Confirm"}
                    </button>
                    <button type="button" className={btn.quiet} onClick={() => setAction(null)}>
                      Back
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section aria-label="Timeline">
            <h3 className="font-serif text-lg text-text-primary mb-2">Timeline</h3>
            <Timeline events={events} />
          </section>
        </div>
      )}
    </Sheet>
  );
}
