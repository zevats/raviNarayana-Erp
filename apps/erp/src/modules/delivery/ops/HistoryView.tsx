"use client";

import React, { useState } from "react";
import type { MealType } from "@/types";
import { addBusinessDays, businessToday } from "@/lib/businessDate";
import { DISPOSITION_LABEL } from "@/lib/delivery/outcome";
import { useCloseout, useHistory } from "./data";
import { rupees, dayLabel } from "./ui";
import { BikeLoader } from "@/components/feedback/BikeLoader";

const th = "text-left align-bottom font-normal text-[10px] sm:text-[11px] uppercase tracking-wide text-text-muted pb-2 pr-2 break-words";
const td = "py-2 pr-2 border-t border-surface-subtle tabular-nums break-words";

/**
 * Day close-out for the Owner and Manager: what was ordered, delivered and left undelivered (and
 * where it went), the doorstep money and who holds it, handovers accepted that day with any
 * discrepancy, and cancellations — then the last two weeks at a glance.
 */
export function HistoryView({ date, meal, onDate, onOpen }: { date: string; meal: MealType; onDate: (d: string) => void; onOpen: (taskId: string) => void }) {
  const [scope, setScope] = useState<MealType | "ALL">(meal);
  const today = businessToday();
  const close = useCloseout(date, scope);
  const hist = useHistory(addBusinessDays(today, -13), today);
  const c = close.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl text-text-primary">Close-out · {dayLabel(date, today)}</h2>
        <div className="inline-flex p-1 rounded-2xl bg-white border border-surface-subtle">
          {(["LUNCH", "DINNER", "ALL"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s} className={`rn-press px-3 min-h-[36px] rounded-xl text-xs ${scope === s ? "bg-forest-deepest text-text-light" : "text-forest"}`}>
              {s === "ALL" ? "Whole day" : s === "LUNCH" ? "Lunch" : "Dinner"}
            </button>
          ))}
        </div>
      </div>

      {!c ? (
        close.error ? <p role="alert" className="text-sm text-status-danger-text">{close.error.message}</p> : <BikeLoader size="sm" label="Loading close-out…" className="py-10" />
      ) : (
        <>
          <section className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-3xl bg-white border border-surface-subtle p-4">
              <p className="text-[11px] uppercase tracking-wide text-text-muted">Stops</p>
              <p className="font-serif text-3xl text-text-primary">{c.summary.total}</p>
              <p className="text-xs text-text-secondary mt-1">
                {c.summary.delivered} delivered · {c.summary.partial} partial · {c.summary.notDelivered} not delivered · {c.summary.waiting + c.summary.out} still open
                {c.summary.cancelled ? ` · ${c.summary.cancelled} cancelled` : ""}
              </p>
            </div>
            <div className="rounded-3xl bg-white border border-surface-subtle p-4">
              <p className="text-[11px] uppercase tracking-wide text-text-muted">Items</p>
              <p className="font-serif text-3xl text-text-primary">
                {c.summary.items.delivered}
                <span className="text-lg text-text-muted"> / {c.summary.items.ordered}</span>
              </p>
              <p className="text-xs text-text-secondary mt-1">
                {c.summary.items.undelivered} undelivered: {c.summary.items.byDisposition.RETURNED} returned · {c.summary.items.byDisposition.WITH_STAFF} with staff · {c.summary.items.byDisposition.DISCARDED} discarded
                {c.summary.items.byDisposition.UNRECORDED ? ` · ${c.summary.items.byDisposition.UNRECORDED} not recorded` : ""}
              </p>
            </div>
            <div className="rounded-3xl bg-forest-deepest text-text-light p-4">
              <p className="text-[11px] uppercase tracking-wide text-sage-pale">Doorstep money (one-off orders)</p>
              <p className="font-serif text-3xl">{rupees(c.summary.money.collected)}<span className="text-lg text-sage-light"> of {rupees(c.summary.money.due)}</span></p>
              <p className="text-xs text-sage-pale mt-1">{rupees(c.summary.money.outstanding)} outstanding · subscriptions are billed monthly</p>
            </div>
          </section>

          <section className="rounded-3xl bg-white border border-surface-subtle p-4">
            <h3 className="font-serif text-lg text-text-primary mb-2">Items ordered and delivered</h3>
            {c.items.length === 0 ? (
              <p className="text-sm text-text-muted">No item lines for this day.</p>
            ) : (
              <table className="w-full table-fixed text-[12px] sm:text-sm">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Ordered</th>
                    <th className={th}>Delivered</th>
                    <th className={th}>Undelivered</th>
                    <th className={th}>Returned</th>
                    <th className={th}>With staff</th>
                    <th className={th}>Discarded</th>
                    <th className={th}>Not recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((i) => (
                    <tr key={i.productName}>
                      <td className={`${td} text-text-primary`}>{i.productName}</td>
                      <td className={td}>{i.ordered}</td>
                      <td className={td}>{i.delivered}</td>
                      <td className={`${td} ${i.undelivered ? "text-status-warning-text font-medium" : ""}`}>{i.undelivered}</td>
                      <td className={td}>{i.returned}</td>
                      <td className={`${td} ${i.withStaff ? "text-status-warning-text" : ""}`}>{i.withStaff}</td>
                      <td className={td}>{i.discarded}</td>
                      <td className={td}>{i.unrecorded}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {c.shortfalls.length > 0 && (
            <section className="rounded-3xl bg-white border border-surface-subtle p-4">
              <h3 className="font-serif text-lg text-text-primary mb-2">Shortfalls</h3>
              <ul className="divide-y divide-surface-subtle">
                {c.shortfalls.map((s, k) => (
                  <li key={`${s.taskId}-${k}`}>
                    <button type="button" onClick={() => onOpen(s.taskId)} className="rn-press w-full text-left py-2 flex flex-wrap items-baseline justify-between gap-2 hover:bg-surface-canvas">
                      <span className="text-sm text-text-primary">
                        <span className="font-medium">{s.customerName}</span> · {s.undelivered} of {s.ordered} {s.productName} not delivered — {s.reason || "no reason"}
                      </span>
                      <span className="text-xs text-text-muted">
                        {s.disposition ? DISPOSITION_LABEL[s.disposition] : "where it went not recorded"} · {s.staffName || "Unassigned"}
                        {s.resolved ? " · resolved" : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="grid lg:grid-cols-2 gap-4">
            <div className="rounded-3xl bg-white border border-surface-subtle p-4">
              <h3 className="font-serif text-lg text-text-primary mb-2">Money collected, by person</h3>
              {c.collections.length === 0 ? (
                <p className="text-sm text-text-muted">No money was collected for these deliveries.</p>
              ) : (
                <table className="w-full table-fixed text-[12px] sm:text-sm">
                  <thead>
                    <tr>
                      <th className={th}>Person</th>
                      <th className={th}>Cash</th>
                      <th className={th}>UPI</th>
                      <th className={th}>Not declared</th>
                      <th className={th}>Awaiting</th>
                      <th className={th}>Handed over</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.collections.map((p) => (
                      <tr key={p.staffId}>
                        <td className={`${td} text-text-primary`}>{p.staffName}</td>
                        <td className={td}>{rupees(p.cash)}</td>
                        <td className={td}>{rupees(p.upi)}</td>
                        <td className={`${td} ${p.undeclared ? "text-status-warning-text" : ""}`}>{rupees(p.undeclared)}</td>
                        <td className={td}>{rupees(p.awaitingAcceptance)}</td>
                        <td className={td}>{rupees(p.handedOver)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rounded-3xl bg-white border border-surface-subtle p-4">
              <h3 className="font-serif text-lg text-text-primary mb-2">Handovers accepted this day</h3>
              {c.handovers.length === 0 ? (
                <p className="text-sm text-text-muted">None. The cashbook records handovers on the day they are accepted.</p>
              ) : (
                <ul className="space-y-2">
                  {c.handovers.map((h) => (
                    <li key={h.id} className={`rounded-2xl border px-3 py-2 text-sm ${h.status === "DISCREPANCY_FLAGGED" ? "border-status-danger-border bg-status-danger-bg" : "border-surface-subtle"}`}>
                      <span className="font-medium text-text-primary">{h.staffName}</span>: declared {rupees(h.declaredCash)} cash + {rupees(h.declaredUpi)} UPI, received {rupees(h.acceptedCash)} + {rupees(h.acceptedUpi)}
                      {h.acceptedByName ? ` · verified by ${h.acceptedByName}` : ""}
                      {h.status === "DISCREPANCY_FLAGGED" && <span className="block text-status-danger-text">Discrepancy: {h.varianceReason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {c.cancelled.length > 0 && (
            <section className="rounded-3xl bg-white border border-surface-subtle p-4">
              <h3 className="font-serif text-lg text-text-primary mb-2">Cancelled</h3>
              <ul className="space-y-1 text-sm">
                {c.cancelled.map((x) => (
                  <li key={x.taskId}>
                    <button type="button" onClick={() => onOpen(x.taskId)} className="text-left hover:underline">
                      <span className="font-medium">{x.customerName}</span> — {x.reason}
                      {x.cutoffOverride && <span className="text-status-warning-text"> · after cutoff (override)</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="rounded-3xl bg-white border border-surface-subtle p-4">
        <h3 className="font-serif text-lg text-text-primary mb-2">Last two weeks</h3>
        {!hist.data ? (
          <BikeLoader size="sm" label="Loading…" className="py-6" />
        ) : hist.data.length === 0 ? (
          <p className="text-sm text-text-muted">No deliveries in the last two weeks.</p>
        ) : (
          <table className="w-full table-fixed text-[12px] sm:text-sm">
            <thead>
              <tr>
                <th className={th}>Day</th>
                <th className={th}>Meal</th>
                <th className={th}>Stops</th>
                <th className={th}>Delivered</th>
                <th className={th}>Partial</th>
                <th className={th}>Not delivered</th>
                <th className={th}>Open</th>
                <th className={th}>Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {hist.data.map((h) => (
                <tr key={`${h.serviceDate}-${h.mealType}`} onClick={() => onDate(h.serviceDate)} className={`cursor-pointer hover:bg-surface-canvas ${h.serviceDate === date ? "bg-surface-cream" : ""}`}>
                  <td className={`${td} text-text-primary`}>{dayLabel(h.serviceDate, today)}</td>
                  <td className={td}>{h.mealType === "LUNCH" ? "Lunch" : h.mealType === "DINNER" ? "Dinner" : "Breakfast"}</td>
                  <td className={td}>{h.total}</td>
                  <td className={td}>{h.delivered}</td>
                  <td className={`${td} ${h.partial ? "text-status-warning-text" : ""}`}>{h.partial}</td>
                  <td className={`${td} ${h.notDelivered ? "text-status-danger-text" : ""}`}>{h.notDelivered}</td>
                  <td className={td}>{h.open}</td>
                  <td className={td}>{h.cancelled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
