"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, ClipboardList, RefreshCw, Eye, PencilLine, AlertTriangle, Download } from "lucide-react";
import type { AuthenticatedUser, DeliveryTask, MealType } from "@/types";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessToday, businessMeal } from "@/lib/businessDate";
import { summarizeDeliveries, deliveryOutcome, needsFollowUp, DeliveryOutcome, DISPOSITION_LABEL, undeliveredOf, OUTCOME_LABEL } from "@/lib/delivery/outcome";
import { CustodyPanel } from "../components/CustodyPanel";
import { useDeliveryTasks, useManifest, useDeliveryStaff, postJson } from "./data";
import { MealSwitch, DateStepper, OutcomeBadge, Notice, Count, btn, rupees, timeOf, displayName, placeLine, itemSummary } from "./ui";
import { TaskPanel } from "./TaskPanel";
import { DeliverySheet } from "./DeliverySheet";
import { HistoryView } from "./HistoryView";
import { exportDeliveryDay } from "./exportDay";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { SelectMenu } from "@/components/forms/SelectMenu";

type Tab = "board" | "problems" | "custody" | "history";
const FILTERS: Array<DeliveryOutcome | "ALL"> = ["ALL", "WAITING", "OUT", "DELIVERED", "PARTIAL", "NOT_DELIVERED", "CANCELLED"];

/** Remembers each row's last outcome so a row that changes state briefly lights up. */
function useChangedIds(tasks: DeliveryTask[]): Set<string> {
  const prev = useRef<Map<string, string>>(new Map());
  const [changed, setChanged] = useState<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const t of tasks) {
      const sig = `${deliveryOutcome(t)}|${t.assignedTo}`;
      const before = prev.current.get(t.id);
      if (before !== undefined && before !== sig) next.add(t.id);
      prev.current.set(t.id, sig);
    }
    if (next.size > 0) {
      setChanged(next);
      const timer = setTimeout(() => setChanged(new Set()), 900);
      return () => clearTimeout(timer);
    }
  }, [tasks]);
  return changed;
}

export function ManagerDelivery({ user }: { user: AuthenticatedUser }) {
  const today = businessToday();
  const isOwner = user.role === "SUPER_ADMIN";
  const canManage = user.role === "SUPER_ADMIN" || user.role === "OPERATIONS_MANAGER";
  // The Owner sees delivery records read-only unless they explicitly switch to making changes.
  const [ownerEditing, setOwnerEditing] = useState(false);
  const readOnly = !canManage || (isOwner && !ownerEditing);
  const [tab, setTab] = useState<Tab>(isOwner ? "history" : "board");
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<MealType>(() => businessMeal());
  const [filter, setFilter] = useState<DeliveryOutcome | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStaff, setBulkStaff] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [recordTask, setRecordTask] = useState<DeliveryTask | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);
  const [preparing, setPreparing] = useState(false);

  const tasksQ = useDeliveryTasks(date, meal);
  const manifest = useManifest(date, meal);
  const staffQ = useDeliveryStaff(canManage);
  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const summary = useMemo(() => summarizeDeliveries(tasks), [tasks]);
  const changed = useChangedIds(tasks);
  const m = manifest.data;

  useEffect(() => setSelected(new Set()), [date, meal]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter !== "ALL" && deliveryOutcome(t) !== filter) return false;
      if (filter === "ALL" && t.status === "CANCELLED") return false;
      if (!q) return true;
      return [displayName(t), t.roomNumber, t.deliveryAddress, t.customerPhone, t.assignedToName].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [tasks, filter, search]);

  const groups = useMemo(() => {
    const by = new Map<string, { id: string | null; name: string; tasks: DeliveryTask[] }>();
    for (const t of visible) {
      const k = t.assignedTo ?? "__none";
      const g = by.get(k) ?? { id: t.assignedTo, name: t.assignedTo ? t.assignedToName || "Delivery staff" : "Unassigned", tasks: [] };
      g.tasks.push(t);
      by.set(k, g);
    }
    const order: Record<DeliveryOutcome, number> = { NOT_DELIVERED: 0, PARTIAL: 1, OUT: 2, WAITING: 3, DELIVERED: 4, CANCELLED: 5 };
    const list = Array.from(by.values());
    list.forEach((g) => g.tasks.sort((a, b) => order[deliveryOutcome(a)] - order[deliveryOutcome(b)] || displayName(a).localeCompare(displayName(b))));
    return list.sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.name.localeCompare(b.name)));
  }, [visible]);

  const problems = useMemo(() => tasks.filter(needsFollowUp), [tasks]);

  const prepare = async () => {
    if (preparing) return;
    setPreparing(true);
    setNotice(null);
    try {
      const r = await postJson<any>("/api/delivery/manifest", { serviceDate: date, mealType: meal, trigger: "MANUAL" });
      invalidateErpCache(["delivery"]);
      setNotice({ tone: "ok", text: r.created > 0 ? `${r.created} new stop(s) added${r.unassigned ? `, ${r.unassigned} waiting for assignment` : ""}.` : "The list is up to date; nothing new to add." });
    } catch (e: any) {
      setNotice({ tone: "error", text: e.message });
    } finally {
      setPreparing(false);
    }
  };

  const bulkAssign = async () => {
    if (!bulkStaff || selected.size === 0) return;
    try {
      const r = await postJson<any>("/api/delivery/tasks/batch-assign", { taskIds: Array.from(selected), assignedToStaffId: bulkStaff });
      invalidateErpCache(["delivery", "orders"]);
      setNotice({ tone: "ok", text: `${r.assignedCount ?? selected.size} stop(s) assigned to ${r.assignedStaffName ?? "the delivery person"}.` });
      setSelected(new Set());
    } catch (e: any) {
      setNotice({ tone: "error", text: e.message });
    }
  };

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const figure = (label: string, value: number, o: DeliveryOutcome, tone = "") => (
    <button
      type="button"
      onClick={() => {
        setTab("board");
        setFilter(filter === o ? "ALL" : o);
      }}
      aria-pressed={filter === o}
      className={`rn-press group text-left px-3 py-2 rounded-2xl border transition-colors ${filter === o ? "bg-forest-deepest border-forest-deepest text-text-light" : "bg-white border-surface-subtle hover:border-sage"}`}
    >
      <span className={`block font-serif text-3xl leading-none ${filter === o ? "" : tone}`}>
        <Count value={value} />
      </span>
      <span className={`block mt-1 text-[11px] tracking-wide ${filter === o ? "text-sage-pale" : "text-text-muted"}`}>{label}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      {/* Header: the meal being run, the day, and the list behind it */}
      <header aria-label="Delivery list" className="rounded-[28px] bg-surface-ivory border border-surface-subtle rn-lift overflow-hidden">
        <div className="px-4 sm:px-6 pt-4 pb-3 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-baseline gap-3">
            <h1 className="font-serif text-3xl text-text-primary">Delivery</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MealSwitch value={meal} onChange={setMeal} />
            <DateStepper value={date} today={today} onChange={setDate} />
            {isOwner && (
              <button type="button" onClick={() => setOwnerEditing((v) => !v)} className={ownerEditing ? btn.brass : btn.quiet} title="The Owner view is read-only unless you switch to making changes">
                {ownerEditing ? <PencilLine className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {ownerEditing ? "Making changes" : "View only"}
              </button>
            )}
          </div>
        </div>
        <div className="px-4 sm:px-6 py-3 bg-surface-cream/70 border-t border-surface-subtle flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <ClipboardList className="w-5 h-5 text-brass-dark shrink-0 mt-0.5" />
            <div className="text-sm min-w-0">
              {!m ? (
                <span className="inline-flex items-center gap-2 text-text-muted"><BikeLoader inline label="Loading" /> Loading the {meal.toLowerCase()} list…</span>
              ) : !m.schemaReady ? (
                <span className="text-status-warning-text">List preparation is switched off until the delivery update (migration 0014) is approved and installed. Orders still appear here as before.</span>
              ) : m.prepared ? (
                <span className="text-text-primary">
                  <span className="font-medium">{meal === "LUNCH" ? "Lunch" : "Dinner"} list prepared</span> {timeOf(m.preparedAt)} {m.trigger === "AUTO" ? "automatically" : ""} by {m.preparedByName || "—"}
                  {m.lastRunAt && m.lastRunAt !== m.preparedAt ? <span className="text-text-muted"> · updated {timeOf(m.lastRunAt)} by {m.lastRunByName}</span> : null}
                  <span className="text-text-muted"> · {m.taskCount} stops{m.unassignedCount > 0 ? ` · ` : ""}</span>
                  {m.unassignedCount > 0 && <span className="text-status-warning-text font-medium">{m.unassignedCount} unassigned</span>}
                </span>
              ) : (
                <span className="text-text-secondary">
                  <span className="font-medium text-text-primary">Not prepared yet.</span>{" "}
                  {m.prepareAt ? (m.due ? "Preparing now…" : `Prepares automatically when someone opens Delivery after ${m.prepareAt}.`) : "Prepare it by hand."}
                </span>
              )}
              {m?.cutoffAt && <span className="block text-[11px] text-text-muted">Changes after {m.cutoffAt} need a Manager override with a reason{m.pastCutoff ? " — cutoff has passed" : ""}.</span>}
            </div>
          </div>
          {!readOnly && m?.schemaReady && (
            <button type="button" onClick={prepare} disabled={preparing} className={btn.quiet}>
              <RefreshCw className={`w-4 h-4 ${preparing ? "animate-spin" : ""}`} />
              {m.prepared ? "Update list" : "Prepare list"}
            </button>
          )}
        </div>
      </header>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {/* Totals for the whole day and meal (search and filters never change them) */}
      <section aria-label="Summary" className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {figure("Waiting", summary.waiting, "WAITING")}
        {figure("Out", summary.out, "OUT", "text-status-info-text")}
        {figure("Delivered", summary.delivered, "DELIVERED", "text-status-success-text")}
        {figure("Partial", summary.partial, "PARTIAL", "text-status-warning-text")}
        {figure("Not delivered", summary.notDelivered, "NOT_DELIVERED", "text-status-danger-text")}
        <div className="px-3 py-2 rounded-2xl bg-forest-deepest text-text-light">
          <span className="block font-serif text-2xl leading-none"><Count value={rupees(summary.money.outstanding)} /></span>
          <span className="block mt-1 text-[11px] text-sage-pale">
            Outstanding · {rupees(summary.money.collected)} of {rupees(summary.money.due)} in
          </span>
        </div>
      </section>

      <nav aria-label="Delivery sections" className="flex flex-wrap gap-1 border-b border-surface-subtle">
        {([
          ["board", "Board"],
          ["problems", `Problems${problems.length ? ` · ${problems.length}` : ""}`],
          ["custody", "Custody"],
          ["history", "History"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-current={tab === k ? "page" : undefined}
            className={`rn-press px-4 min-h-[44px] text-sm whitespace-nowrap border-b-2 -mb-px ${tab === k ? "border-brass text-text-primary font-medium" : "border-transparent text-text-muted hover:text-text-primary"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "board" && (
        <section className="rn-enter space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-text-subdued absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, room, address, phone" className="w-full min-h-[44px] pl-9 pr-3 rounded-2xl border border-surface-subtle bg-white text-sm" />
            </label>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={`rn-press px-3 min-h-[36px] rounded-xl text-xs border whitespace-nowrap ${filter === f ? "bg-forest-deepest text-text-light border-forest-deepest" : "bg-white text-text-secondary border-surface-subtle"}`}>
                  {f === "ALL" ? `All · ${summary.total}` : f === "CANCELLED" ? `Cancelled · ${summary.cancelled}` : OUTCOME_LABEL[f]}
                </button>
              ))}
            </div>
          </div>

          {tasksQ.isLoading && !tasksQ.data ? (
            <BikeLoader label="Loading deliveries…" className="py-16" />
          ) : groups.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-surface-subtle p-8 text-center text-sm text-text-muted">
              {tasks.length === 0 ? `No deliveries for ${meal.toLowerCase()} on this day.` : "Nothing matches this filter."}
            </div>
          ) : (
            groups.map((g) => {
              const s = summarizeDeliveries(g.tasks);
              const ids = g.tasks.filter((t) => ["WAITING", "OUT", "NOT_DELIVERED"].includes(deliveryOutcome(t))).map((t) => t.id);
              return (
                <div key={g.id ?? "none"} className={`rounded-3xl border bg-white overflow-hidden ${g.id === null ? "border-status-warning-border" : "border-surface-subtle"}`}>
                  <div className={`px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 ${g.id === null ? "bg-status-warning-bg" : "bg-surface-canvas"}`}>
                    <div className="flex items-center gap-3">
                      {!readOnly && ids.length > 0 && (
                        <input type="checkbox" aria-label={`Select all of ${g.name}`} checked={ids.every((id) => selected.has(id))} onChange={(e) => setSelected((prev) => { const n = new Set(prev); ids.forEach((id) => (e.target.checked ? n.add(id) : n.delete(id))); return n; })} className="w-5 h-5 accent-forest" />
                      )}
                      <h3 className="font-serif text-lg text-text-primary">{g.name}</h3>
                      {g.id === null && <AlertTriangle className="w-4 h-4 text-status-warning-text" />}
                    </div>
                    <p className="text-xs text-text-muted tabular-nums">
                      {s.total} stops · {s.delivered + s.partial} done{s.partial ? ` (${s.partial} partial)` : ""}{s.notDelivered ? ` · ${s.notDelivered} not delivered` : ""}
                      {s.staff[0]?.collected ? ` · ${rupees(s.staff[0].collected)} collected` : ""}
                    </p>
                  </div>
                  <ul className="divide-y divide-surface-subtle">
                    {g.tasks.map((t) => {
                      const o = deliveryOutcome(t);
                      const short = (t.lines ?? []).reduce((n, l) => n + undeliveredOf(l), 0);
                      return (
                        <li key={t.id} className={`flex items-stretch ${changed.has(t.id) ? "rn-flash" : ""}`}>
                          {!readOnly && (
                            <label className="flex items-center pl-4">
                              <input type="checkbox" aria-label={`Select ${displayName(t)}`} disabled={!["WAITING", "OUT", "NOT_DELIVERED"].includes(o)} checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="w-5 h-5 accent-forest disabled:opacity-20" />
                            </label>
                          )}
                          <button type="button" onClick={() => setFocusId(t.id)} className="rn-press flex-1 min-w-0 text-left px-4 py-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 hover:bg-surface-canvas">
                            <span className="min-w-0">
                              <span className="font-medium text-text-primary">{displayName(t)}</span>
                              <span className="ml-2 text-[11px] uppercase tracking-wide text-text-subdued">{t.orderType === "RESIDENT" ? "Room" : t.subscriptionId ? "Subscription" : "Order"}</span>
                            </span>
                            <span className="justify-self-end"><OutcomeBadge outcome={o} /></span>
                            <span className="text-xs text-text-muted truncate">{placeLine(t)} · {itemSummary(t)}</span>
                            <span className="justify-self-end text-xs tabular-nums text-text-secondary">
                              {t.paymentMode === "DOORSTEP"
                                ? o === "WAITING" || o === "OUT"
                                  ? rupees(t.orderTotal)
                                  : (t.balanceDue || 0) > 0
                                    ? <span className="text-status-warning-text">{rupees(t.balanceDue)} due</span>
                                    : "Paid"
                                : t.paymentMode === "MONTHLY" ? "Monthly" : ""}
                            </span>
                            {(short > 0 || t.status === "EXCEPTION" || t.status === "CANCELLED") && (
                              <span className="col-span-2 text-xs text-status-warning-text">
                                {t.status === "CANCELLED"
                                  ? `Cancelled: ${t.cancelReason || ""}`
                                  : (t.lines ?? []).filter((l) => undeliveredOf(l) > 0).map((l) => `${undeliveredOf(l)} ${l.productName} — ${l.undeliveredReason || "no reason"}${l.disposition ? ` (${DISPOSITION_LABEL[l.disposition].toLowerCase()})` : ""}`).join("; ") || t.exceptionReason}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </section>
      )}

      {tab === "problems" && (
        <section className="rn-enter space-y-3">
          {problems.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-surface-subtle p-8 text-center text-sm text-text-muted">No open problems for this meal.</div>
          ) : (
            problems.map((t) => (
              <button key={t.id} type="button" onClick={() => setFocusId(t.id)} className="rn-press w-full text-left rounded-3xl border border-status-warning-border bg-white px-4 py-3 hover:bg-surface-canvas">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text-primary">{displayName(t)}</span>
                  <OutcomeBadge task={t} />
                </div>
                <p className="text-xs text-text-muted">{placeLine(t)} · {t.assignedToName || "Unassigned"}{t.deliveredAt ? ` · ${timeOf(t.deliveredAt)}` : t.exceptionAt ? ` · ${timeOf(t.exceptionAt)}` : ""}</p>
                <ul className="mt-2 space-y-1">
                  {(t.lines ?? []).filter((l) => undeliveredOf(l) > 0).map((l) => (
                    <li key={l.lineId} className="text-sm text-text-secondary">
                      <span className="font-medium text-status-warning-text tabular-nums">{l.deliveredQuantity}/{l.quantity}</span> {l.productName} · {l.undeliveredReason || "no reason"} · {l.disposition ? DISPOSITION_LABEL[l.disposition] : "where it went not recorded"}
                    </li>
                  ))}
                  {(t.lines ?? []).length === 0 && t.exceptionReason && <li className="text-sm text-text-secondary">{t.exceptionReason}</li>}
                </ul>
              </button>
            ))
          )}
        </section>
      )}

      {tab === "custody" && (
        <section className="rn-enter">
          <CustodyPanel />
        </section>
      )}

      {tab === "history" && (
        <section className="rn-enter space-y-4">
          <div className="flex justify-end">
            <button type="button" disabled={tasks.length === 0} onClick={() => exportDeliveryDay(tasks, date, meal)} className={btn.quiet}>
              <Download className="w-4 h-4" /> Download {meal === "LUNCH" ? "lunch" : "dinner"} deliveries (CSV)
            </button>
          </div>
          <HistoryView date={date} meal={meal} onDate={setDate} onOpen={(id) => setFocusId(id)} />
        </section>
      )}

      {!readOnly && selected.size > 0 && (
        <div className="rn-enter fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-2rem)] max-w-xl rounded-2xl bg-forest-deepest text-text-light px-4 py-3 flex flex-wrap items-center gap-2 rn-lift">
          <span className="text-sm">{selected.size} selected</span>
          <SelectMenu
            label="Assign to"
            placeholder="Assign to…"
            tone="forest"
            up
            value={bulkStaff}
            onChange={setBulkStaff}
            options={(staffQ.data ?? []).map((s) => ({ value: s.id, label: s.fullName }))}
            className="flex-1 min-w-[150px]"
            triggerClassName="bg-white text-text-primary"
          />
          <button type="button" disabled={!bulkStaff} onClick={bulkAssign} className={btn.brass}>Assign</button>
          <button type="button" onClick={() => setSelected(new Set())} className="rn-press min-h-[44px] px-3 text-sm text-sage-pale">Clear</button>
        </div>
      )}

      <TaskPanel
        taskId={focusId}
        onClose={() => setFocusId(null)}
        readOnly={readOnly}
        staff={staffQ.data ?? []}
        pastCutoff={Boolean(m?.pastCutoff)}
        onRecord={(t) => setRecordTask(t)}
      />
      <DeliverySheet
        task={recordTask}
        currentUserId={user.id}
        onClose={() => setRecordTask(null)}
        onSaved={(text) => {
          invalidateErpCache(["delivery", "orders", "custody", "handover", "dashboard"]);
          setNotice({ tone: "ok", text });
        }}
      />
    </div>
  );
}
