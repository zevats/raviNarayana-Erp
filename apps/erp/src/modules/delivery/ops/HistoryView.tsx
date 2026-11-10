"use client";

import React, { useState } from "react";
import type { MealType } from "@/types";
import { addBusinessDays, businessToday } from "@/lib/businessDate";
import { DISPOSITION_LABEL } from "@/lib/delivery/outcome";
import { useCloseout, useHistory } from "./data";
import { rupees, dayLabel } from "./ui";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { Segmented, StatStrip, Badge } from "@/components/ui/kit";
import { LoadError, StateMessage } from "@/components/ui/states";
import { formatDateTime } from "@/lib/format";

const shortDay = (iso: string, today: string) => {
  if (iso === today) return "Today";
  const d = new Date(`${iso}T00:00:00+05:30`);
  return formatDateTime(d, "en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};
const mealName = (m: string) => (m === "LUNCH" ? "Lunch" : m === "DINNER" ? "Dinner" : "Breakfast");
const quiet = (n: number) => (n ? n : <span className="text-[var(--rn-ink-3)]">0</span>);

/**
 * Day close-out for the Owner and Manager, then the last two weeks:
 * 1. the day in three figures (stops, items, doorstep money),
 * 2. item lines and shortfalls (what was not delivered and where it went),
 * 3. money: who collected what, and the handovers accepted that day,
 * 4. cancellations, 5. history.
 */
export function HistoryView({ date, meal, onDate, onOpen }: { date: string; meal: MealType; onDate: (d: string) => void; onOpen: (taskId: string) => void }) {
  const [scope, setScope] = useState<MealType | "ALL">(meal);
  const today = businessToday();
  const close = useCloseout(date, scope);
  const hist = useHistory(addBusinessDays(today, -13), today);
  const c = close.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="rn-t-section">Close-out · {dayLabel(date, today)}</h2>
        <Segmented
          size="sm"
          label="Meal"
          value={scope}
          onChange={setScope}
          options={[{ value: "LUNCH", label: "Lunch" }, { value: "DINNER", label: "Dinner" }, { value: "ALL", label: "Whole day" }]}
        />
      </div>

      {!c ? (
        close.error ? <div className="rn-card"><LoadError message={close.error.message} onRetry={() => close.refetch()} title="Close-out could not be loaded" /></div> : <BikeLoader size="sm" label="Loading close-out…" className="py-10" />
      ) : (
        <>
          <StatStrip
            items={[
              {
                label: "Stops",
                value: c.summary.total,
                note: `${c.summary.delivered} delivered · ${c.summary.partial} partial · ${c.summary.notDelivered} not delivered · ${c.summary.waiting + c.summary.out} open${c.summary.cancelled ? ` · ${c.summary.cancelled} cancelled` : ""}`,
              },
              {
                label: "Items delivered",
                value: `${c.summary.items.delivered} / ${c.summary.items.ordered}`,
                note: c.summary.items.undelivered ? `${c.summary.items.undelivered} not delivered` : "everything delivered",
                tone: c.summary.items.undelivered ? "warn" : "default",
              },
              {
                label: "Collected",
                value: `${rupees(c.summary.money.collected)} of ${rupees(c.summary.money.due)}`,
                note: c.summary.money.outstanding ? `${rupees(c.summary.money.outstanding)} still to collect` : "all collected",
              },
            ]}
          />

          <section className="rn-card">
            <div className="px-5 sm:px-6 pt-5 pb-3">
              <h3 className="rn-t-card">Items ordered and delivered</h3>
            </div>
            {c.items.length === 0 ? (
              <StateMessage compact title="No items for this meal" />
            ) : (
              <table className="rn-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Ordered</th>
                    <th className="text-right">Delivered</th>
                    <th className="text-right">Not delivered</th>
                    <th>Where it went</th>
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((i) => {
                    const where = [
                      i.returned ? `${i.returned} returned` : "",
                      i.withStaff ? `${i.withStaff} with staff` : "",
                      i.discarded ? `${i.discarded} discarded` : "",
                      i.unrecorded ? `${i.unrecorded} not recorded` : "",
                    ].filter(Boolean).join(" · ");
                    return (
                      <tr key={i.productName}>
                        <td className="text-[var(--rn-ink)]">{i.productName}</td>
                        <td className="num">{i.ordered}</td>
                        <td className="num">{i.delivered}</td>
                        <td className={`num ${i.undelivered ? "font-semibold text-[#8F6710]" : ""}`}>{quiet(i.undelivered)}</td>
                        <td className="rn-t-meta">{where || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {c.shortfalls.length > 0 && (
              <div className="border-t border-[var(--rn-line)] px-5 sm:px-6 py-4">
                <h4 className="rn-t-label mb-2">Shortfalls</h4>
                <ul className="rn-rows">
                  {c.shortfalls.map((s, k) => (
                    <li key={`${s.taskId}-${k}`}>
                      <button type="button" onClick={() => onOpen(s.taskId)} className="w-full text-left py-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 hover:bg-white/50 rounded-xl">
                        <span className="text-[13.5px] text-[var(--rn-ink)]">
                          <span className="font-medium">{s.customerName}</span> · {s.undelivered} of {s.ordered} {s.productName} — {s.reason || "no reason given"}
                        </span>
                        <span className="rn-t-meta">
                          {s.disposition ? DISPOSITION_LABEL[s.disposition] : "where it went not recorded"} · {s.staffName || "Unassigned"}
                          {s.resolved ? " · resolved" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rn-card">
              <div className="px-5 sm:px-6 pt-5 pb-3">
                <h3 className="rn-t-card">Money collected, by person</h3>
              </div>
              {c.collections.length === 0 ? (
                <StateMessage compact title="No money collected for these deliveries" />
              ) : (
                <table className="rn-table">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th className="text-right">Collected</th>
                      <th className="text-right">Handed over</th>
                      <th className="text-right">Still held</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.collections.map((p) => (
                      <tr key={p.staffId}>
                        <td className="text-[var(--rn-ink)]">{p.staffName}</td>
                        <td className="num">
                          {rupees(p.cash + p.upi)}
                          {p.upi > 0 && <span className="block rn-t-meta">{rupees(p.cash)} cash · {rupees(p.upi)} UPI</span>}
                        </td>
                        <td className="num">{rupees(p.handedOver)}</td>
                        <td className={`num ${p.undeclared + p.awaitingAcceptance ? "font-semibold text-[var(--rn-ink)]" : ""}`}>{rupees(p.undeclared + p.awaitingAcceptance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="rn-card">
              <div className="px-5 sm:px-6 pt-5 pb-3">
                <h3 className="rn-t-card">Handovers accepted this day</h3>
              </div>
              {c.handovers.length === 0 ? (
                <StateMessage compact title="No handovers accepted this day">The cashbook records a handover on the day it is accepted.</StateMessage>
              ) : (
                <ul className="rn-rows px-5 sm:px-6 pb-4">
                  {c.handovers.map((h) => (
                    <li key={h.id} className="py-2.5">
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-[var(--rn-ink)]">{h.staffName}</span>
                        <span className="rn-num text-[13.5px]">{rupees(h.acceptedCash + h.acceptedUpi)} received</span>
                      </span>
                      <span className="block rn-t-meta">
                        Declared {rupees(h.declaredCash + h.declaredUpi)}{h.acceptedByName ? ` · verified by ${h.acceptedByName}` : ""}
                      </span>
                      {h.status === "DISCREPANCY_FLAGGED" && <span className="mt-1 inline-flex"><Badge tone="bad">Discrepancy: {h.varianceReason}</Badge></span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {c.cancelled.length > 0 && (
            <section className="rn-card">
              <div className="px-5 sm:px-6 pt-5 pb-2">
                <h3 className="rn-t-card">Cancelled</h3>
              </div>
              <ul className="rn-rows px-5 sm:px-6 pb-4">
                {c.cancelled.map((x) => (
                  <li key={x.taskId} className="py-2">
                    <button type="button" onClick={() => onOpen(x.taskId)} className="text-left text-[13.5px] hover:underline">
                      <span className="font-medium text-[var(--rn-ink)]">{x.customerName}</span> — {x.reason}
                      {x.cutoffOverride && <span className="rn-t-meta"> · after the cutoff (Manager override)</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="rn-card">
        <div className="px-5 sm:px-6 pt-5 pb-3">
          <h3 className="rn-t-card">Last two weeks</h3>
        </div>
        {hist.error && !hist.data ? (
          <LoadError message={hist.error.message} onRetry={() => hist.refetch()} title="History could not be loaded" />
        ) : !hist.data ? (
          <BikeLoader size="sm" label="Loading…" className="py-6" />
        ) : hist.data.length === 0 ? (
          <StateMessage compact title="No deliveries in the last two weeks" />
        ) : (
          <table className="rn-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Meal</th>
                <th className="text-right">Stops</th>
                <th className="text-right">Delivered</th>
                <th className="text-right">Partial</th>
                <th className="text-right">Not delivered</th>
                <th className="text-right">Open</th>
                <th className="text-right">Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {hist.data.map((h) => (
                <tr key={`${h.serviceDate}-${h.mealType}`} onClick={() => onDate(h.serviceDate)} className={`cursor-pointer ${h.serviceDate === date ? "bg-[var(--rn-accent-tint)]" : ""}`}>
                  <td className="text-[var(--rn-ink)] whitespace-nowrap">{shortDay(h.serviceDate, today)}</td>
                  <td className="rn-t-meta">{mealName(h.mealType)}</td>
                  <td className="num">{h.total}</td>
                  <td className="num">{quiet(h.delivered)}</td>
                  <td className={`num ${h.partial ? "text-[#8F6710] font-medium" : ""}`}>{quiet(h.partial)}</td>
                  <td className={`num ${h.notDelivered ? "text-[#9A3423] font-medium" : ""}`}>{quiet(h.notDelivered)}</td>
                  <td className="num">{quiet(h.open)}</td>
                  <td className="num">{quiet(h.cancelled)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
