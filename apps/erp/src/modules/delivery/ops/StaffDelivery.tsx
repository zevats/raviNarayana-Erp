"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Phone, Send, Info, ChevronRight, PlayCircle, PencilLine, Banknote, CloudOff } from "lucide-react";
import type { AuthenticatedUser, DeliveryTask, MealType } from "@/types";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessToday, businessMeal } from "@/lib/businessDate";
import { deliveryOutcome, undeliveredOf, DISPOSITION_LABEL, OUTCOME_LABEL } from "@/lib/delivery/outcome";
import { getOfflineQueue } from "../offlineQueue";
import { useDeliveryTasks, useManifest, postJson } from "./data";
import { rupees, displayName, placeLine } from "./ui";
import { DeliveryForm, DeliverySheet, mapsHref, paymentLabel, telHref, CallLink } from "./DeliverySheet";
import { K, Pill, MealToggle, FilterChips, PageLoader, LoadError, EmptyState, stopNumbers, two, firstName } from "./staffKit";
import { StaffCash } from "./StaffCash";
import { StaffHistory } from "./StaffHistory";
import { RecordDetail, RecordSheet } from "./staffParts";

export type StaffView = "stops" | "cash" | "history";
type Filter = "ALL" | "REMAINING" | "SUBSCRIPTION" | "COLLECT" | "COMPLETED";

/**
 * The delivery partner's screens: My Stops (this file), My Cash and History. The shell's navbar
 * switches the view; the URL (?view=) opens one directly.
 */
export function StaffDelivery({ user }: { user: AuthenticatedUser }) {
  const [view, setView] = useState<StaffView>("stops");
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("view");
    if (fromUrl === "cash" || fromUrl === "history") setView(fromUrl);
    const on = (e: Event) => setView((e as CustomEvent<StaffView>).detail);
    window.addEventListener("erp:delivery-view", on);
    return () => window.removeEventListener("erp:delivery-view", on);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("erp:delivery-view-changed", { detail: view }));
    const url = view === "stops" ? "/delivery" : `/delivery?view=${view}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [view]);

  return (
    <div key={view} className="rn-enter">
      {view === "stops" && <StopsView user={user} />}
      {view === "cash" && <StaffCash user={user} />}
      {view === "history" && <StaffHistory user={user} />}
    </div>
  );
}

function StopsView({ user }: { user: AuthenticatedUser }) {
  const today = businessToday();
  const [meal, setMeal] = useState<MealType>(() => businessMeal());
  const [arrival, setArrival] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetTask, setSheetTask] = useState<DeliveryTask | null>(null);
  const [recordTask, setRecordTask] = useState<DeliveryTask | null>(null);
  const [notice, setNotice] = useTimedMessage<{ tone: "ok" | "error"; text: string }>();
  const [starting, setStarting] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const [wide, setWide] = useState(false);

  // The selected meal loads first; the other meal's count is fetched once it is on screen.
  // One fixed list per meal (never "selected" vs "other"): switching meals only swaps which list is
  // shown, so the lists never mix and a stop is announced only when it really is new.
  const breakfastQ = useDeliveryTasks(today, "BREAKFAST");
  const lunchQ = useDeliveryTasks(today, "LUNCH");
  const dinnerQ = useDeliveryTasks(today, "DINNER");
  const byMeal = { BREAKFAST: breakfastQ, LUNCH: lunchQ, DINNER: dinnerQ } as const;
  const tasksQ = byMeal[meal];
  useManifest(today, meal); // opening the screen after 08:00 / 15:30 prepares that meal's list
  // Stops just recorded on this phone: shown as done until the server's list says so too, so a
  // refresh that arrives before the background save has landed cannot bring them back as open.
  const [held, setHeld] = useState<Record<string, DeliveryTask>>({});
  const stillOpen = (t: DeliveryTask) => t.status === "PENDING" || t.status === "ASSIGNED" || t.status === "OUT_FOR_DELIVERY";
  const tasks = useMemo(
    () =>
      (tasksQ.data ?? [])
        .map((t) => (held[t.id] && stillOpen(t) ? { ...t, ...held[t.id], lines: held[t.id].lines?.length ? held[t.id].lines : t.lines } : t))
        .filter((t) => t.status !== "CANCELLED"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasksQ.data, held]
  );
  useEffect(() => {
    const ids = Object.keys(held);
    if (ids.length === 0) return;
    const all = [...(breakfastQ.data ?? []), ...(lunchQ.data ?? []), ...(dinnerQ.data ?? [])];
    const settled = ids.filter((id) => {
      const t = all.find((x) => x.id === id);
      return t && !stillOpen(t);
    });
    if (settled.length) setHeld((h) => Object.fromEntries(Object.entries(h).filter(([id]) => !settled.includes(id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakfastQ.data, lunchQ.data, dinnerQ.data]);
  // Safety: nothing is held for more than two minutes (the offline queue keeps the save itself).
  useEffect(() => {
    if (Object.keys(held).length === 0) return;
    const t = setTimeout(() => setHeld({}), 120_000);
    return () => clearTimeout(t);
  }, [held]);
  const numbers = useMemo(() => stopNumbers(tasks), [tasks]);
  const countOf = (data: DeliveryTask[] | undefined) => (data ? data.filter((t) => t.status !== "CANCELLED").length : undefined);
  const mealCounts = { BREAKFAST: countOf(breakfastQ.data), LUNCH: countOf(lunchQ.data), DINNER: countOf(dinnerQ.data) } as Partial<Record<MealType, number | undefined>>;

  // A delivery assigned while the screen is open (for example an order placed by the Manager) is
  // announced at once: live updates refetch the list and the new stop is called out.
  const known = useRef<Map<MealType, Set<string>>>(new Map());
  useEffect(() => {
    for (const [m, data] of [["BREAKFAST", breakfastQ.data], ["LUNCH", lunchQ.data], ["DINNER", dinnerQ.data]] as Array<[MealType, DeliveryTask[] | undefined]>) {
      if (!data) continue;
      const ids = new Set(data.filter((t) => t.status !== "CANCELLED").map((t) => t.id));
      const before = known.current.get(m);
      if (before) {
        const added = data.filter((t) => ids.has(t.id) && !before.has(t.id) && ["WAITING", "OUT"].includes(deliveryOutcome(t)));
        if (added.length > 0) {
          setArrival(added.length === 1 ? `New ${m.toLowerCase()} delivery: ${displayName(added[0])}` : `${added.length} new ${m.toLowerCase()} deliveries added`);
          // Browsers only allow vibration after the person has interacted with the page.
          if ((navigator as any).userActivation?.hasBeenActive) {
            try {
              navigator.vibrate?.([120, 60, 120]);
            } catch {}
          }
        }
      }
      known.current.set(m, ids);
    }
  }, [lunchQ.data, dinnerQ.data]);
  useEffect(() => {
    if (!arrival) return;
    const t = setTimeout(() => setArrival(null), 8000);
    return () => clearTimeout(t);
  }, [arrival]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    const count = () => setQueued(getOfflineQueue(user.id).filter((i) => i.status === "PENDING" || i.status === "FAILED").length);
    count();
    const t = setInterval(count, 5000);
    return () => clearInterval(t);
  }, [user.id]);
  useEffect(() => setSelectedId(null), [meal]);

  const isOpen = (t: DeliveryTask) => ["WAITING", "OUT"].includes(deliveryOutcome(t));
  const byRun = (a: DeliveryTask, b: DeliveryTask) => (numbers.get(a.id) ?? 0) - (numbers.get(b.id) ?? 0);
  // A queue, first come first served: stops already out for delivery first, then the oldest order
  // first; a new order joins at the end.
  const open = tasks.filter(isOpen).sort((a, b) => (deliveryOutcome(a) === "OUT" ? 0 : 1) - (deliveryOutcome(b) === "OUT" ? 0 : 1) || a.createdAt.localeCompare(b.createdAt) || byRun(a, b));
  const done = tasks.filter((t) => !isOpen(t)).sort(byRun);
  const next = open[0] ?? null;
  const collectOpen = (t: DeliveryTask) => t.paymentMode === "DOORSTEP" && (isOpen(t) || (t.balanceDue || 0) > 0);
  const counts = { ALL: tasks.length, REMAINING: open.length, COLLECT: tasks.filter(collectOpen).length, COMPLETED: done.length };
  const matches = (t: DeliveryTask) =>
    filter === "ALL" ? true : filter === "REMAINING" ? isOpen(t) : filter === "SUBSCRIPTION" ? t.paymentMode === "MONTHLY" : filter === "COLLECT" ? collectOpen(t) : !isOpen(t);
  const rest = [...open.slice(1), ...done].filter(matches);
  const selected = tasks.find((t) => t.id === selectedId) ?? next;
  const completed = done.length;
  const pct = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const mealWord = meal === "BREAKFAST" ? "Breakfast" : meal === "LUNCH" ? "Lunch" : "Dinner";

  const start = async (t: DeliveryTask) => {
    if (starting) return;
    setStarting(t.id);
    try {
      await postJson(`/api/delivery/tasks/${t.id}/dispatch`, {});
      invalidateErpCache(["delivery", "orders"]);
    } catch (e: any) {
      setNotice({ tone: "error", text: e.message });
    } finally {
      setStarting(null);
    }
  };
  const deliver = (t: DeliveryTask) => (wide ? setSelectedId(t.id) : setSheetTask(t));
  // Opened from a notification (/delivery?task=…): show that stop once the lists are loaded.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || lunchQ.data === undefined || dinnerQ.data === undefined) return;
    const id = new URLSearchParams(window.location.search).get("task");
    if (!id) return;
    linked.current = true;
    const t = [...lunchQ.data, ...dinnerQ.data].find((x) => x.id === id);
    window.history.replaceState(window.history.state, "", "/delivery");
    if (!t) return;
    setMeal(t.mealType);
    if (isOpen(t)) deliver(t);
    else if (wide) setSelectedId(t.id);
    else setRecordTask(t);
  });

  // A delivery is shown as done the moment it is recorded and saved in the background. If the
  // server refuses it, say why and reload the stops so it is back in the list.
  useEffect(() => {
    const failed = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const text = detail.text || "A delivery could not be saved.";
      setNotice({ tone: "error", text });
      if (detail.taskId) setHeld((h) => Object.fromEntries(Object.entries(h).filter(([id]) => id !== detail.taskId)));
      void tasksQ.refetch();
    };
    window.addEventListener("erp:delivery-save-failed", failed);
    return () => window.removeEventListener("erp:delivery-save-failed", failed);
  }, [tasksQ.refetch]);

  const saved = (text: string, done?: DeliveryTask) => {
    // Put the saved stop into the list straight away (it moves to completed and the next stop comes
    // up), then refresh everything affected in the background.
    if (done) setHeld((h) => ({ ...h, [done.id]: done }));
    if (done && tasksQ.data) {
      void tasksQ.mutate(
        tasksQ.data.map((t) => (t.id === done.id ? { ...t, ...done, lines: done.lines?.length ? done.lines : t.lines } : t)),
        false
      );
    }
    // The lists are refreshed once the save is confirmed (the background sender does it); a
    // refresh now would only fetch the stop as it was before.
    setNotice({ tone: "ok", text });
    setSelectedId(null);
  };

  if (tasksQ.data === undefined) {
    return tasksQ.error ? <LoadError text="Could not load your stops." onRetry={() => tasksQ.refetch()} /> : <PageLoader label="Getting your stops…" />;
  }

  return (
    <div className="space-y-5 lg:space-y-6">
      {arrival && (
        <button type="button" onClick={() => setArrival(null)} className="rn-enter fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md rounded-2xl bg-[#1F2320] text-white px-4 py-3 shadow-xl flex items-center gap-3 text-left">
          <span className="w-2.5 h-2.5 rounded-full bg-[#C9501C] animate-pulse shrink-0" />
          <span className="text-[14px] font-semibold flex-1">{arrival}</span>
          <span className="text-[12px] text-white/70">OK</span>
        </button>
      )}
      {/* Phone header (screenshot 1) */}
      <section className="md:hidden space-y-4">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] leading-tight">Namaste, {firstName(user.fullName)}</h1>
        <MealToggle value={meal} onChange={setMeal} counts={mealCounts} />
        {tasks.length > 0 && <ProgressCard done={completed} total={tasks.length} remaining={open.length} pct={pct} />}
      </section>

      {/* Tablet / desktop hero (screenshot 2) */}
      <section className="hidden md:flex items-center gap-6 rounded-2xl bg-[#F4F0E8] px-6 lg:px-7 py-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-[28px] font-extrabold tracking-[-0.02em]">Namaste, {firstName(user.fullName)}</h1>
            <Pill tone="success">{open.length > 0 ? "Active Route" : tasks.length ? "Route Complete" : "No Route Yet"}</Pill>
          </div>
        </div>
        <MealToggle value={meal} onChange={setMeal} counts={mealCounts} />
        <div className="w-56 lg:w-64">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] font-bold">
              {completed}/{tasks.length} done
            </span>
            <Pill tone="grey">{open.length} Remaining</Pill>
          </div>
          <div className="mt-2.5 h-2 rounded-full bg-[#E6E0D4] overflow-hidden">
            <div className="h-full rounded-full bg-[#2F6B24] transition-[width] duration-700" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </section>

      {queued > 0 && (
        <Link href="/offline" className="flex items-center gap-2 rounded-xl bg-[#FCE9DD] text-[#B4440F] text-sm font-medium px-4 py-3">
          <CloudOff className="w-4 h-4" /> {queued} {queued === 1 ? "delivery is" : "deliveries are"} saved on this phone and will be sent when you are back online.
        </Link>
      )}
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rn-enter rounded-xl px-4 py-3 text-sm font-medium ${notice.tone === "ok" ? "bg-[#DDF1D6] text-[#2F6B24]" : "bg-[#FBE3DD] text-[#9A3423]"}`}>
          {notice.text}
        </p>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5 lg:gap-6 items-start">
        <div className="space-y-3 min-w-0">
          <div className="hidden md:block">
            <FilterChips<Filter>
              value={filter}
              onChange={setFilter}
              items={[
                { key: "ALL", label: `All (${counts.ALL})` },
                { key: "REMAINING", label: `Remaining (${counts.REMAINING})` },
                { key: "SUBSCRIPTION", label: "Monthly plan" },
                { key: "COLLECT", label: "Collect Cash/UPI", dot: counts.COLLECT > 0 },
                { key: "COMPLETED", label: `Completed (${counts.COMPLETED})` },
              ]}
            />
          </div>

          {tasks.length === 0 ? (
            <EmptyState title="No stops yet" detail={`${mealWord} · Today`} />
          ) : (
            <>
              {next && matches(next) && (
                <NextUp task={next} stopNo={numbers.get(next.id)} queueTotal={open.length} selected={wide && selected?.id === next.id} starting={starting === next.id} onStart={() => start(next)} onDeliver={() => deliver(next)} />
              )}
              {!next && (
                <EmptyState title="All stops done" detail={`${completed}/${tasks.length} ${mealWord.toLowerCase()} stops`} />
              )}
              <ul className="space-y-2.5">
                {rest.map((t) => {
                  const row = <StopRow task={t} stopNo={numbers.get(t.id)} selected={wide && selected?.id === t.id} onOpen={() => (isOpen(t) ? deliver(t) : wide ? setSelectedId(t.id) : setRecordTask(t))} />;
                  return (
                    <li key={t.id}>
                      {isOpen(t) ? (
                        <>
                          <div className="md:hidden space-y-2 pt-1">
                            <span className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#6E7F70]">{open.indexOf(t) + 1}/{open.length}</span>
                            <OpenStopCard task={t} label={`Stop ${open.indexOf(t) + 1}/${open.length}`} starting={starting === t.id} onStart={() => start(t)} onDeliver={() => deliver(t)} />
                          </div>
                          <div className="hidden md:block">{row}</div>
                        </>
                      ) : (
                        row
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <aside className="hidden lg:block sticky top-24">
          <div className={`${K.card} p-6 shadow-[0_8px_30px_-12px_rgba(26,46,32,0.18)]`}>
            {selected && isOpen(selected) ? (
              <DeliveryForm key={selected.id} task={selected} stopNo={numbers.get(selected.id)} variant="panel" currentUserId={user.id} onSaved={saved} />
            ) : selected ? (
              <RecordDetail task={selected} stopNo={numbers.get(selected.id)} />
            ) : (
              <p className="text-sm text-[#6E7F70] text-center py-10">Choose a stop to confirm its delivery.</p>
            )}
          </div>
        </aside>
      </div>

      <RecordSheet task={recordTask} stopNo={recordTask ? numbers.get(recordTask.id) : undefined} onClose={() => setRecordTask(null)} />
      <DeliverySheet task={sheetTask} stopNo={sheetTask ? numbers.get(sheetTask.id) : undefined} currentUserId={user.id} onClose={() => setSheetTask(null)} onSaved={saved} />
    </div>
  );
}

function NextUp({ task, stopNo, selected, starting, onStart, onDeliver, queueTotal }: { task: DeliveryTask; stopNo?: number; selected: boolean; starting: boolean; onStart: () => void; onDeliver: () => void; queueTotal?: number }) {
  const pay = paymentLabel(task);
  const map = mapsHref(task);
  const lines = task.lines ?? [];
  return (
    <>
      {/* Phone (screenshot 1) */}
      <div className="md:hidden space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.08em] text-[#B4440F]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#B4440F]" /> Next delivery
          </span>
          <span className="text-[13px] font-semibold text-[#5A6C5E]">{queueTotal ? `1/${queueTotal}` : ""}</span>
        </div>
        <OpenStopCard task={task} label="Next stop" starting={starting} onStart={onStart} onDeliver={onDeliver} />
      </div>

      {/* Tablet / desktop (screenshot 2) */}
      <article className={`hidden md:block relative overflow-hidden ${K.card} ${selected ? "ring-1 ring-[#C9501C]/30" : ""}`}>
        <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#C9501C]" aria-hidden="true" />
        <div className="pl-6 pr-5 py-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="px-2 py-1 rounded-md bg-[#C9501C] text-white text-[11px] font-extrabold tracking-wide">NEXT UP</span>
              {stopNo !== undefined && <span className="text-[17px] font-extrabold">Stop #{stopNo}</span>}
            </div>
            <Pill tone={pay.tone}>{pay.text}</Pill>
          </div>
          <div>
            <h2 className="text-[19px] font-extrabold tracking-[-0.01em]">{displayName(task)}</h2>
            <p className="text-[14px] text-[#5A6C5E]">
              {placeLine(task)}
              {task.landmark ? `, ${task.landmark}` : ""}
            </p>
          </div>
          {task.deliveryInstructions && (
            <p className={`${K.soft} flex items-start gap-2.5 px-4 py-3 text-[13px] text-[#1A2E20]`}>
              <Info className="w-4 h-4 text-[#B4440F] shrink-0 mt-0.5" />
              <span>
                {task.orderType === "RESIDENT" ? "Resident" : "Customer"} instruction: “{task.deliveryInstructions}”
              </span>
            </p>
          )}
          {lines.length > 0 && (
            <div className={`${K.soft} px-4 py-3`}>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#5A6C5E] mb-2">Manifest items</p>
              <div className="flex flex-wrap gap-2">
                {lines.map((l) => (
                  <span key={l.lineId} className="px-3 py-1.5 rounded-lg bg-white text-[13px] text-[#1A2E20]">
                    {l.quantity}× {l.productName}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            {telHref(task.customerPhone) && (
              <CallLink phone={task.customerPhone} className={`${K.greyBtn} h-11 px-4 text-[13px]`}>
                <Phone className="w-4 h-4" /> Call {task.orderType === "RESIDENT" ? "Resident" : "Customer"}
              </CallLink>
            )}
            {map && (
              <a href={map} target="_blank" rel="noreferrer" className={`${K.greyBtn} h-11 px-4 text-[13px]`}>
                <Send className="w-4 h-4" /> Get Directions
              </a>
            )}
            {task.status === "ASSIGNED" && (
              <button type="button" onClick={onStart} disabled={starting} className={`${K.greyBtn} h-11 px-4 text-[13px]`}>
                <PlayCircle className="w-4 h-4" /> {starting ? "Starting…" : "Start Delivery"}
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={onDeliver} className={`${K.primaryBtn} h-11 px-5 text-[13px]`}>
              <PencilLine className="w-4 h-4" /> Mark as delivered
            </button>
          </div>
        </div>
      </article>
    </>
  );
}

/** A pending stop in full (phones): who, where, what, how it is paid, and every action. */
function OpenStopCard({ task, label, starting, onStart, onDeliver }: { task: DeliveryTask; label: string; starting: boolean; onStart: () => void; onDeliver: () => void }) {
  const pay = paymentLabel(task);
  const map = mapsHref(task);
  const lines = task.lines ?? [];
  return (
    <article aria-label={label} className={`${K.card} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[20px] font-extrabold tracking-[-0.01em] truncate">{displayName(task)}</h2>
          <p className="text-[14px] text-[#1A2E20]">{placeLine(task)}</p>
          {task.landmark && <p className="text-[13px] text-[#B4440F]">{task.landmark}</p>}
        </div>
        <Pill tone="grey">{task.paymentMode === "MONTHLY" ? "Subscription" : task.paymentMode === "NONE" ? "Room" : pay.text}</Pill>
      </div>
      {lines.length > 0 && <p className="text-[13px] text-[#5A6C5E]">{lines.map((l) => `${l.quantity}× ${l.productName}`).join(" · ")}</p>}
      <div className="space-y-2">
        {(telHref(task.customerPhone) || map) && (
          <div className="flex gap-2">
            {telHref(task.customerPhone) && (
              <CallLink phone={task.customerPhone} wrapClassName="relative flex flex-1" className={`${K.greyBtn} h-11 text-[13px] w-full`}>
                <Phone className="w-4 h-4" /> Call
              </CallLink>
            )}
            {map && (
              <a href={map} target="_blank" rel="noreferrer" className={`${K.greyBtn} h-11 text-[13px] flex-1`}>
                <Send className="w-4 h-4" /> Directions
              </a>
            )}
          </div>
        )}
        <div className="flex gap-2">
          {task.status === "ASSIGNED" && (
            <button type="button" onClick={onStart} disabled={starting} className={`${K.greyBtn} h-12 text-[14px] flex-1`}>
              <PlayCircle className="w-4 h-4" /> {starting ? "Starting…" : "Start"}
            </button>
          )}
          <button type="button" onClick={onDeliver} className={`${K.primaryBtn} h-12 text-[15px] flex-1`}>
            Mark as delivered
          </button>
        </div>
      </div>
    </article>
  );
}

/** Today's run at a glance (phones): done of total, percentage and a bar. */
function ProgressCard({ done, total, remaining, pct }: { done: number; total: number; remaining: number; pct: number }) {
  return (
    <section aria-label="Today's progress" className={`${K.card} p-4 space-y-3`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[15px] font-bold text-[#1F2320]">
          <span className="text-[22px] font-extrabold tabular-nums">{done}</span>
          <span className="text-[#6E7F70] font-semibold"> / {total} done</span>
        </p>
        <span className={`text-[14px] font-extrabold tabular-nums ${remaining === 0 ? "text-[#2F6B24]" : "text-[#C9501C]"}`}>{remaining === 0 ? "All done" : `${pct}%`}</span>
      </div>
      <div className="h-2.5 rounded-full bg-[#EFEAE1] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Deliveries done">
        <div className={`h-full rounded-full transition-[width] duration-700 ${remaining === 0 ? "bg-[#2F6B24]" : "bg-[#C9501C]"}`} style={{ width: `${pct}%` }} />
      </div>
    </section>
  );
}

function StopRow({ task, stopNo, selected, onOpen }: { task: DeliveryTask; stopNo?: number; selected: boolean; onOpen: () => void }) {
  const o = deliveryOutcome(task);
  const open = o === "WAITING" || o === "OUT";
  const lines = task.lines ?? [];
  const items = lines.map((l) => `${l.quantity}× ${l.productName}`).join(", ");
  const short = lines.filter((l) => undeliveredOf(l) > 0);
  const tel = open ? telHref(task.customerPhone) : null;
  return (
    <div className="flex items-stretch gap-2">
    <button type="button" onClick={onOpen} className={`rn-press flex-1 min-w-0 text-left ${K.card} px-4 py-3.5 flex items-center gap-3.5 transition-colors ${selected ? "ring-1 ring-[#C9501C]/30" : "hover:border-[#D9D1C2]"}`}>
      <span className={`w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-[15px] font-bold ${open ? "bg-[#F1ECE3] text-[#1A2E20]" : "bg-[#DDF1D6] text-[#2F6B24]"}`}>{two(stopNo)}</span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-bold truncate">{displayName(task)}</span>
        </span>
        <span className="block text-[13px] text-[#5A6C5E] truncate">
          {placeLine(task)}
          {items ? ` · ${items}` : ""}
        </span>
        {short.length > 0 && (
          <span className="block text-[12px] text-[#8F6710] truncate">
            {short.map((l) => `${undeliveredOf(l)} ${l.productName} short — ${l.disposition ? DISPOSITION_LABEL[l.disposition].toLowerCase() : "not recorded"}`).join(" · ")}
          </span>
        )}
      </span>
      {open ? (
        task.paymentMode === "DOORSTEP" ? (
          <Pill tone="danger">
            <Banknote className="w-3.5 h-3.5" /> Collect {rupees(task.orderTotal)}
          </Pill>
        ) : (
          <Pill tone="grey">{task.paymentMode === "MONTHLY" ? "Monthly Plan" : "Room"}</Pill>
        )
      ) : (
        <Pill tone={o === "DELIVERED" ? "success" : o === "PARTIAL" ? "accent" : "danger"}>{OUTCOME_LABEL[o]}</Pill>
      )}
      <ChevronRight className="w-4 h-4 text-[#8E9F89] shrink-0" />
    </button>
    {tel && (
      <CallLink phone={task.customerPhone} wrapClassName="relative flex shrink-0" label={`Call ${displayName(task)}`} className={`rn-press ${K.card} w-14 h-full shrink-0 flex items-center justify-center text-[#C9501C] hover:bg-[#FCE9DD] active:bg-[#FCE9DD]`}>
        <Phone className="w-5 h-5" />
      </CallLink>
    )}
    </div>
  );
}
