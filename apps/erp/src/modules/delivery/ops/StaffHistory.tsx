"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MapPin, CheckCircle2, AlertTriangle, XCircle, ChevronRight, Clock, UserRound, ListFilter } from "lucide-react";
import type { AuthenticatedUser, DeliveryTask, MealType } from "@/types";
import { businessToday, businessMeal } from "@/lib/businessDate";
import { deliveryOutcome, undeliveredOf } from "@/lib/delivery/outcome";
import { useDeliveryTasks } from "./data";
import { rupees, displayName, placeLine } from "./ui";
import { K, Pill, MealToggle, PageLoader, LoadError, stopNumbers, two, clock } from "./staffKit";
import { RecordDetail, outcomeChip } from "./staffParts";
import { DayPicker, OptionMenu } from "./Pickers";

type Filter = "ALL" | "FULL" | "PARTIAL" | "NOT_DELIVERED";


function statusLine(t: DeliveryTask): { text: string; tone: string; Icon: typeof CheckCircle2 } {
  const o = deliveryOutcome(t);
  const short = (t.lines ?? []).reduce((n, l) => n + undeliveredOf(l), 0);
  if (o === "NOT_DELIVERED") return { text: "Not delivered", tone: "text-[#9A3423]", Icon: XCircle };
  if (o === "PARTIAL") return { text: `Partial · ${short} short`, tone: "text-[#9A3423]", Icon: AlertTriangle };
  return { text: "Delivered", tone: "text-[#2F6B24]", Icon: CheckCircle2 };
}

function payText(t: DeliveryTask): { text: string; tone: string } {
  if (t.paymentMode === "MONTHLY") return { text: "Monthly plan", tone: "text-[#2F6B24]" };
  if (t.paymentMode === "NONE") return { text: "Room delivery", tone: "text-[#5A6C5E]" };
  if ((t.balanceDue || 0) > 0) return { text: `${rupees(t.balanceDue)} still due`, tone: "text-[#9A3423]" };
  return { text: `${rupees(t.collectedAmount)} collected`, tone: "text-[#B4440F]" };
}

/** History: this delivery partner's recorded stops for a day and meal (own records only). */
export function StaffHistory({ user: _user }: { user: AuthenticatedUser }) {
  const today = businessToday();
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<MealType>(() => businessMeal());
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const other: MealType = meal === "LUNCH" ? "DINNER" : "LUNCH";
  const q = useDeliveryTasks(date, meal);
  const otherQ = useDeliveryTasks(date, other, q.data !== undefined);
  const all = useMemo(() => (q.data ?? []).filter((t) => t.status !== "CANCELLED"), [q.data]);
  const numbers = useMemo(() => stopNumbers(all), [all]);
  const isRecorded = (t: DeliveryTask) => ["DELIVERED", "PARTIAL", "NOT_DELIVERED"].includes(deliveryOutcome(t));
  const recorded = useMemo(() => all.filter(isRecorded).sort((a, b) => ((a.deliveredAt || a.exceptionAt || "") < (b.deliveredAt || b.exceptionAt || "") ? 1 : -1)), [all]);
  const countOf = (data: DeliveryTask[] | undefined) => (data ? data.filter((t) => t.status !== "CANCELLED" && isRecorded(t)).length : undefined);
  useEffect(() => setSelectedId(null), [date, meal]);

  const by = (o: string) => recorded.filter((t) => deliveryOutcome(t) === o);
  const visible = filter === "ALL" ? recorded : filter === "FULL" ? by("DELIVERED") : filter === "PARTIAL" ? by("PARTIAL") : by("NOT_DELIVERED");
  const selected = recorded.find((t) => t.id === selectedId) ?? visible[0] ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] md:text-[30px] font-extrabold tracking-[-0.02em]">Delivery History</h1>
      </div>

      {/* One row: meal first, then the day (custom calendar), then what to show (custom menu). */}
      <div className="relative flex items-center gap-2">
        <MealToggle compact value={meal} onChange={setMeal} counts={{ [meal]: countOf(q.data), [other]: countOf(otherQ.data) }} />
        <DayPicker value={date} today={today} onChange={setDate} />
        <OptionMenu
          label="Show"
          value={filter}
          onChange={setFilter}
          icon={<ListFilter className="w-4 h-4 text-[#C9501C] shrink-0" />}
          options={[
            { key: "ALL", label: "All", short: "Filter", count: q.data ? recorded.length : undefined },
            { key: "FULL", label: "Delivered", count: q.data ? by("DELIVERED").length : undefined },
            { key: "PARTIAL", label: "Partial", count: q.data ? by("PARTIAL").length : undefined },
            { key: "NOT_DELIVERED", label: "Not delivered", short: "Missed", count: q.data ? by("NOT_DELIVERED").length : undefined },
          ]}
        />
      </div>

      {q.data === undefined ? (
        q.error ? (
          <LoadError text="Could not load your history." onRetry={() => q.refetch()} />
        ) : (
          <PageLoader label="Getting your history…" />
        )
      ) : (
        <>
          <p className="text-[13px] text-[#5A6C5E]">
            {recorded.length === 0
              ? "Nothing recorded yet."
              : `${by("DELIVERED").length} delivered${by("PARTIAL").length ? ` · ${by("PARTIAL").length} partial` : ""}${by("NOT_DELIVERED").length ? ` · ${by("NOT_DELIVERED").length} not delivered` : ""} · ${rupees(recorded.reduce((n, t) => n + (t.collectedAmount || 0), 0))} collected`}
          </p>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5 lg:gap-6 items-start">
            <section className="space-y-3 min-w-0">
              {visible.length === 0 ? (
                <div className={`${K.card} p-8 text-center text-[14px] text-[#5A6C5E]`}>No deliveries recorded here.</div>
              ) : (
                <ul className="space-y-3">
                  {visible.map((t) => (
                    <li key={t.id}>
                      <PhoneCard task={t} stopNo={numbers.get(t.id)} />
                      <DesktopRow task={t} stopNo={numbers.get(t.id)} selected={selected?.id === t.id} onOpen={() => setSelectedId(t.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <aside className={`hidden lg:block sticky top-24 ${K.card} p-6`}>
              {selected ? <RecordDetail task={selected} stopNo={numbers.get(selected.id)} /> : <p className="text-sm text-[#6E7F70] text-center py-10">Choose a delivery to see it in full.</p>}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

/** Phone record card (screenshot 4, simplified). */
function PhoneCard({ task, stopNo }: { task: DeliveryTask; stopNo?: number }) {
  const chip = outcomeChip(task);
  const lines = task.lines ?? [];
  const ordered = lines.reduce((n, l) => n + l.quantity, 0);
  const delivered = lines.reduce((n, l) => n + (l.deliveredQuantity ?? 0), 0);
  const pay = payText(task);
  return (
    <article className={`md:hidden ${K.card} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 min-w-0">
            <span className="text-[16px] font-extrabold truncate">{displayName(task)}</span>
            {stopNo !== undefined && <Pill tone="grey">Stop #{stopNo}</Pill>}
          </p>
          <p className="text-[13px] text-[#5A6C5E] truncate">{placeLine(task)}</p>
        </div>
        <Pill tone={chip.tone}>{chip.tone === "success" ? "Delivered" : chip.tone === "danger" ? "Not delivered" : "Partial"}</Pill>
      </div>
      {lines.length > 0 && (
        <div className={`${K.soft} px-3.5 py-3 space-y-1.5`}>
          <div className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="min-w-0 break-words">{lines.map((l) => `${l.productName} (${l.quantity})`).join(", ")}</span>
            <span className="shrink-0 text-[#3E4540]">
              {delivered}/{ordered}
            </span>
          </div>
          {task.recipientName && (
            <p className="flex items-center gap-1.5 text-[12px] text-[#5A6C5E]">
              <UserRound className="w-3.5 h-3.5" /> Given to {task.recipientName}
            </p>
          )}
          {lines
            .filter((l) => undeliveredOf(l) > 0)
            .map((l) => (
              <p key={l.lineId} className="text-[12px] text-[#9A3423]">
                {undeliveredOf(l)} {l.productName} not delivered — {l.undeliveredReason || "no reason"}
              </p>
            ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="flex items-center gap-1.5 text-[#5A6C5E]">
          <Clock className="w-4 h-4" /> {clock(task.deliveredAt || task.exceptionAt)}
        </span>
        <span className={`font-bold ${pay.tone}`}>{pay.text}</span>
      </div>
    </article>
  );
}

/** Wide-screen record row (screenshot 5, simplified). */
function DesktopRow({ task, stopNo, selected, onOpen }: { task: DeliveryTask; stopNo?: number; selected: boolean; onOpen: () => void }) {
  const s = statusLine(task);
  const o = deliveryOutcome(task);
  const pay = payText(task);
  const lines = task.lines ?? [];
  const tile = selected ? "bg-[#C9501C] text-white" : o === "DELIVERED" ? "bg-[#EFEAE1] text-[#1F2320]" : "bg-[#FBE3DD] text-[#9A3423]";
  return (
    <button type="button" onClick={onOpen} className={`hidden md:block rn-press w-full text-left ${K.card} p-4 transition-colors ${selected ? "ring-1 ring-[#C9501C]/30" : "hover:border-[#D9D1C2]"}`}>
      <div className="flex items-start gap-3.5">
        <span className={`w-11 h-11 rounded-xl shrink-0 flex items-center justify-center text-[16px] font-extrabold ${tile}`}>{two(stopNo)}</span>
        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-2 min-w-0">
            <span className="text-[16px] font-extrabold truncate">{displayName(task)}</span>
          </p>
          <p className="flex items-center gap-1 text-[13px] text-[#5A6C5E] truncate">
            <MapPin className="w-3.5 h-3.5 shrink-0" /> {placeLine(task)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[14px] font-extrabold">{clock(task.deliveredAt || task.exceptionAt)}</p>
          <p className={`flex items-center justify-end gap-1 text-[12px] font-semibold ${s.tone}`}>
            <s.Icon className="w-3.5 h-3.5" /> {s.text}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 flex flex-wrap gap-1.5 min-w-0">
          {lines.map((l) => (
            <span key={l.lineId} className="px-2.5 py-1 rounded-md bg-[#EFEAE1] text-[12px] font-semibold text-[#3E4540]">
              {l.productName} × {l.deliveredQuantity ?? l.quantity}
            </span>
          ))}
        </div>
        <span className={`text-[12px] font-bold ${pay.tone}`}>{pay.text}</span>
        <ChevronRight className="w-4 h-4 text-[#8E9F89] shrink-0" />
      </div>
    </button>
  );
}
