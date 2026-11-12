"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, ClipboardList, RefreshCw, AlertTriangle, Download, LayoutList, Wallet, History as HistoryIcon, DoorOpen } from "lucide-react";
import { MButton, MChips, MHero, MNotice, MSearch, MSegment, MSheet, PhoneOrDesktop, useIsPhone } from "@/components/app/m";
import type { AuthenticatedUser, DeliveryTask, MealType } from "@/types";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessToday, businessMeal } from "@/lib/businessDate";
import { summarizeDeliveries, deliveryOutcome, needsFollowUp, DeliveryOutcome, DISPOSITION_LABEL, undeliveredOf, OUTCOME_LABEL } from "@/lib/delivery/outcome";
import { CustodyPanel } from "../components/CustodyPanel";
import { ThaliDesk } from "./Thalis";
import { useDeliveryTasks, useManifest, useDeliveryStaff, postJson, StaffOption } from "./data";
import { MealSwitch, DateStepper, HeroDayStepper, OutcomeBadge, Notice, Count, btn, rupees, timeOf, displayName, placeLine, itemSummary } from "./ui";
import { TaskPanel } from "./TaskPanel";
import { DeliverySheet } from "./DeliverySheet";
import { HistoryView } from "./HistoryView";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { FullPageLoader } from "@/components/feedback/FullPageLoader";
import { SelectMenu } from "@/components/forms/SelectMenu";
import { PageHeader, Segmented, Badge } from "@/components/ui/kit";
import { useInstantChoice } from "@/lib/useInstantChoice";

type Tab = "board" | "problems" | "custody" | "history" | "rooms";
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

/** How long an unresolved problem has been open ("2h 15m", "3d 4h"), from when it was reported. */
function openFor(t: DeliveryTask, now = Date.now()): string | null {
  if (t.resolvedAt) return null;
  const since = t.exceptionAt || t.deliveredAt;
  if (!since) return null;
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function ManagerDelivery({ user }: { user: AuthenticatedUser }) {
  const today = businessToday();
  const isOwner = user.role === "SUPER_ADMIN";
  const canManage = user.role === "SUPER_ADMIN" || user.role === "OPERATIONS_MANAGER";
  // Owner and Manager act directly; the server enforces every permission.
  const readOnly = !canManage;
  const [tab, setTab] = useState<Tab>(isOwner ? "history" : "board");
  // The section switch lights up on the tap; the section itself follows as a background render.
  const [shownTab, pickTab] = useInstantChoice<Tab>(tab, setTab);
  const [date, setDate] = useState(today);
  const [meal, setMeal] = useState<MealType>(() => businessMeal());
  const [filter, setFilter] = useState<DeliveryOutcome | "ALL">("ALL");
  const phone = useIsPhone();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState("");
  // Person filter: "" = everyone, "__none" = unassigned, else a staff id.
  const [person, setPerson] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStaff, setBulkStaff] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [recordTask, setRecordTask] = useState<DeliveryTask | null>(null);

  // Links from notifications and other pages open the right tab, day, meal and stop.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab");
    if (t === "board" || t === "problems" || t === "custody" || t === "history" || t === "rooms") setTab(t);
    const d = p.get("date");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDate(d);
    const m = p.get("meal");
    if (m === "LUNCH" || m === "DINNER") setMeal(m);
    const task = p.get("task");
    if (task) setFocusId(task);
  }, []);
  const [notice, setNotice] = useTimedMessage<{ tone: "ok" | "error" | "warn"; text: string }>();
  useEffect(() => {
    const failed = (e: Event) => {
      setNotice({ tone: "error", text: (e as CustomEvent).detail?.text || "A delivery could not be saved." } as any);
      const id = (e as CustomEvent).detail?.taskId;
      if (id) setHeld((h) => Object.fromEntries(Object.entries(h).filter(([k]) => k !== id)));
      invalidateErpCache(["delivery", "orders"]);
    };
    window.addEventListener("erp:delivery-save-failed", failed);
    return () => window.removeEventListener("erp:delivery-save-failed", failed);
  }, []);
  const [preparing, setPreparing] = useState(false);

  const tasksQ = useDeliveryTasks(date, meal);
  const manifest = useManifest(date, meal);
  const staffQ = useDeliveryStaff(canManage);
  // Delivery staff, plus the signed-in Owner/Manager to take a delivery themselves (one-off; the
  // default delivery partner is unchanged).
  const assignable: StaffOption[] = [...(staffQ.data ?? []), { id: user.id, fullName: `Me — ${user.fullName}` }];
  const defaultId = (staffQ.data ?? []).find((s) => s.isDefault)?.id ?? null;
  // Deliveries recorded from this screen show as done at once and stay so until the server's list
  // agrees (a refresh that arrives before the background save cannot bring them back as open).
  const [held, setHeld] = useState<Record<string, DeliveryTask>>({});
  const tasks = useMemo(
    () =>
      (tasksQ.data ?? []).map((t) =>
        held[t.id] && (t.status === "PENDING" || t.status === "ASSIGNED" || t.status === "OUT_FOR_DELIVERY")
          ? { ...t, ...held[t.id], lines: held[t.id].lines?.length ? held[t.id].lines : t.lines }
          : t
      ),
    [tasksQ.data, held]
  );
  useEffect(() => {
    const ids = Object.keys(held);
    if (!ids.length || !tasksQ.data) return;
    const settled = ids.filter((id) => {
      const t = tasksQ.data!.find((x) => x.id === id);
      return t && !(t.status === "PENDING" || t.status === "ASSIGNED" || t.status === "OUT_FOR_DELIVERY");
    });
    if (settled.length) setHeld((h) => Object.fromEntries(Object.entries(h).filter(([id]) => !settled.includes(id))));
  }, [tasksQ.data, held]);
  useEffect(() => {
    if (!Object.keys(held).length) return;
    const t = setTimeout(() => setHeld({}), 120_000);
    return () => clearTimeout(t);
  }, [held]);
  const summary = useMemo(() => summarizeDeliveries(tasks), [tasks]);
  const changed = useChangedIds(tasks);
  const m = manifest.data;

  useEffect(() => setSelected(new Set()), [date, meal]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filter !== "ALL" && deliveryOutcome(t) !== filter) return false;
      if (filter === "ALL" && t.status === "CANCELLED") return false;
      if (person && (t.assignedTo ?? "__none") !== person) return false;
      if (!q) return true;
      return [displayName(t), t.roomNumber, t.deliveryAddress, t.customerPhone, t.assignedToName].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [tasks, filter, search, person]);

  // Per person for this day and meal (all stops, whatever the filters): what each one has, how it
  // went, and the money taken at the door. Custody (declared / accepted / still held) is on the
  // Cash custody tab.
  const byPerson = useMemo(() => {
    const rows = new Map<string, { key: string; name: string; assigned: number; delivered: number; partial: number; failed: number; open: number; cancelled: number; collected: number; due: number }>();
    for (const t of tasks) {
      const key = t.assignedTo ?? "__none";
      const r = rows.get(key) ?? { key, name: t.assignedTo ? t.assignedToName || "Delivery staff" : "Unassigned", assigned: 0, delivered: 0, partial: 0, failed: 0, open: 0, cancelled: 0, collected: 0, due: 0 };
      const o = deliveryOutcome(t);
      if (o === "CANCELLED") r.cancelled++;
      else {
        r.assigned++;
        if (o === "DELIVERED") r.delivered++;
        else if (o === "PARTIAL") r.partial++;
        else if (o === "NOT_DELIVERED") r.failed++;
        else r.open++;
        r.collected += t.collectedAmount || 0;
        r.due += t.expectedAmount || 0;
      }
      rows.set(key, r);
    }
    return Array.from(rows.values()).sort((a, b) => (a.key === "__none" ? -1 : b.key === "__none" ? 1 : a.name.localeCompare(b.name)));
  }, [tasks]);

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

  // The prepared list keeps itself current: new subscriptions and room meals since it was prepared
  // are added on open and every few minutes (only what is new; nothing is recorded when nothing was
  // added). Orders add their own stops when they are taken.
  const preparedNow = Boolean(m?.prepared);
  useEffect(() => {
    if (readOnly || !preparedNow) return;
    let stopped = false;
    const run = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      try {
        const r = await postJson<any>("/api/delivery/manifest", { serviceDate: date, mealType: meal, trigger: "TOPUP" });
        if (!stopped && r?.created > 0) {
          invalidateErpCache(["delivery"]);
          setNotice({ tone: "ok", text: `${r.created} new stop${r.created === 1 ? "" : "s"} added to the list.` });
        }
      } catch {
        // The next run tries again.
      }
    };
    void run();
    const timer = window.setInterval(run, 4 * 60 * 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [readOnly, preparedNow, date, meal]);

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
      className={`rn-stat text-left transition-colors ${filter === o ? "bg-[var(--rn-accent-tint)]" : "hover:bg-white/60"}`}
    >
      <span className="block text-[12px] text-[var(--rn-ink-3)]">{label}</span>
      <span className={`block mt-1 text-[22px] leading-tight font-semibold tabular-nums ${tone || "text-[var(--rn-ink)]"}`}>
        <Count value={value} />
      </span>
    </button>
  );

  return (
    <div className="space-y-5">
      <PhoneOrDesktop
        phone={phone}
        mobile={
          <div className="m-stack">
            <MSegment
              label="Meal"
              value={meal}
              onChange={setMeal}
              options={[
                { value: "BREAKFAST", label: "Breakfast" },
                { value: "LUNCH", label: "Lunch" },
                { value: "DINNER", label: "Dinner" },
              ]}
            />
            <MHero
              tone="orange"
              label={<>Delivered · {meal === "BREAKFAST" ? "Breakfast" : meal === "LUNCH" ? "Lunch" : "Dinner"}</>}
              value={`${summary.delivered}/${summary.waiting + summary.out + summary.delivered + summary.partial + summary.notDelivered}`}
              note={
                !m
                  ? "Loading the list…"
                  : !m.schemaReady
                  ? undefined
                  : m.prepared
                  ? `List ready ${timeOf(m.preparedAt)}${m.lastRunAt && m.lastRunAt !== m.preparedAt ? ` · updated ${timeOf(m.lastRunAt)}` : ""} · ${m.taskCount} stops`
                  : m.prepareAt
                  ? m.due
                    ? "Preparing the list now…"
                    : `List prepares after ${m.prepareAt}`
                  : "List not prepared yet"
              }
              action={<HeroDayStepper value={date} today={today} onChange={setDate} />}
              items={[
                { label: "Out now", value: summary.out, onClick: () => { setTab("board"); setFilter(filter === "OUT" ? "ALL" : "OUT"); } },
                summary.waiting > 0
                  ? { label: "Not assigned", value: summary.waiting, onClick: () => { setTab("board"); setFilter(filter === "WAITING" ? "ALL" : "WAITING"); } }
                  : { label: "Delivered", value: summary.delivered, onClick: () => { setTab("board"); setFilter(filter === "DELIVERED" ? "ALL" : "DELIVERED"); } },
                { label: "Problems", value: summary.partial + summary.notDelivered, onClick: () => setTab("problems") },
                { label: "To collect", value: rupees(summary.money.outstanding) },
              ]}
            />
            {!readOnly && m?.schemaReady && !m.prepared && !m.prepareAt && (
              <MButton kind="primary" icon={RefreshCw} onClick={prepare} disabled={preparing} className="w-full">
                Prepare the list
              </MButton>
            )}
            {m && m.prepared && m.unassignedCount > 0 && <MNotice tone="red">{m.unassignedCount} stop{m.unassignedCount === 1 ? "" : "s"} without a delivery person</MNotice>}
            {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
            <nav aria-label="Delivery sections" className="m-places" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
              {([
                { value: "board", label: "Board", icon: LayoutList },
                { value: "problems", label: problems.length ? `Problems ${problems.length}` : "Problems", icon: AlertTriangle },
                { value: "custody", label: "Cash", icon: Wallet },
                { value: "history", label: "History", icon: HistoryIcon },
              ] as const).map((p) => {
                const Icon = p.icon;
                return (
                  <button key={p.value} type="button" onClick={() => pickTab(p.value as Tab)} aria-current={shownTab === p.value ? "page" : undefined} className="m-place m-press">
                    <Icon strokeWidth={1.9} />
                    <span>{p.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        }
        desktop={
          <div className="space-y-5">
      {/* Header: the meal being run, the day, and the list behind it */}
      <PageHeader
        title="Delivery"
        actions={
          <>
            <MealSwitch value={meal} onChange={setMeal} meals={["BREAKFAST", "LUNCH", "DINNER"]} />
            <DateStepper value={date} today={today} onChange={setDate} />
          </>
        }
      />
      {/* The list behind this meal: when it was prepared and by whom, and how many stops wait for a person. */}
      {(m === undefined || m === null || m.schemaReady || isOwner) && (
        <section aria-label="Delivery list" className="rn-card px-5 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13.5px] min-w-0">
            {!m ? (
              <span className="inline-flex items-center gap-2 rn-t-meta"><BikeLoader inline label="Loading" /> Loading the {meal.toLowerCase()} list…</span>
            ) : !m.schemaReady ? (
              // Owner only: the database has not had the update that adds list preparation.
              <span className="rn-t-meta">Automatic list preparation is not available until the latest database update is installed. Orders still appear below.</span>
            ) : m.prepared ? (
              <>
                <span className="font-medium text-[var(--rn-ink)]">{meal === "BREAKFAST" ? "Breakfast" : meal === "LUNCH" ? "Lunch" : "Dinner"} list prepared {timeOf(m.preparedAt)}</span>
                <span className="rn-t-meta"> · {m.trigger === "AUTO" ? "automatically" : `by ${m.preparedByName || "—"}`}{m.lastRunAt && m.lastRunAt !== m.preparedAt ? ` · updated ${timeOf(m.lastRunAt)}` : ""} · {m.taskCount} stops</span>
                {m.unassignedCount > 0 && <> <Badge tone="warn">{m.unassignedCount} unassigned</Badge></>}
              </>
            ) : (
              <>
                <span className="font-medium text-[var(--rn-ink)]">List not prepared yet</span>
                <span className="rn-t-meta"> · {m.prepareAt ? (m.due ? "preparing now…" : `prepares automatically after ${m.prepareAt}`) : "prepare it by hand"}</span>
              </>
            )}
          </p>
          {!readOnly && m?.schemaReady && !m.prepared && !m.prepareAt && (
            <button type="button" onClick={prepare} disabled={preparing} className={`rn-btn rn-btn-sm rn-refresh ${preparing ? "is-spinning" : ""}`}>
              <RefreshCw />
              Prepare list
            </button>
          )}
        </section>
      )}

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {/* Totals for the whole day and meal (search and filters never change them) */}
      <section aria-label="Summary" className="rn-card rn-stats grid grid-cols-3 sm:grid-cols-6">
        {figure("Not assigned", summary.waiting, "WAITING")}
        {figure("Out", summary.out, "OUT", "text-status-info-text")}
        {figure("Delivered", summary.delivered, "DELIVERED", "text-status-success-text")}
        {figure("Partial", summary.partial, "PARTIAL", "text-status-warning-text")}
        {figure("Not delivered", summary.notDelivered, "NOT_DELIVERED", "text-status-danger-text")}
        <div className="rn-stat col-span-3 sm:col-span-1">
          <span className="block text-[12px] text-[var(--rn-ink-3)]">Outstanding</span>
          <span className="block mt-1 text-[22px] leading-tight font-semibold tabular-nums text-[var(--rn-accent)]"><Count value={rupees(summary.money.outstanding)} /></span>
          <span className="block text-[11.5px] text-[var(--rn-ink-3)]">{rupees(summary.money.collected)} / {rupees(summary.money.due)} in</span>
        </div>
      </section>

      <Segmented
        label="Delivery sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "board", label: "Board" },
          { value: "problems", label: "Problems", count: problems.length || undefined },
          { value: "custody", label: "Custody" },
          { value: "history", label: "History" },
        ]}
      />

          </div>
        }
      />

      {tab === "board" && (
        <section className="rn-enter space-y-4">
          <MSearch
            value={search}
            onChange={setSearch}
            placeholder="Search name, room, address, phone"
            onFilter={() => setFiltersOpen(true)}
            filterCount={(filter !== "ALL" ? 1 : 0) + (person ? 1 : 0)}
          />
          <MSheet
            warm
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            title="Filters"
            footer={
              <>
                <MButton
                  kind="soft"
                  onClick={() => {
                    setFilter("ALL");
                    setPerson("");
                  }}
                >
                  Clear
                </MButton>
                <MButton kind="primary" onClick={() => setFiltersOpen(false)}>
                  Done
                </MButton>
              </>
            }
          >
            <p className="m-sheet-label">Status</p>
            <MChips
              label="Status"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map((x) => ({
                value: x,
                label: x === "ALL" ? "All" : x === "CANCELLED" ? "Cancelled" : OUTCOME_LABEL[x],
                count: x === "ALL" ? summary.total : x === "CANCELLED" ? summary.cancelled : undefined,
              }))}
            />
            {byPerson.length > 1 && (
              <>
                <p className="m-sheet-label">Delivery person</p>
                <MChips label="Delivery person" value={person} onChange={setPerson} options={[{ value: "", label: "Everyone" }, ...byPerson.map((r) => ({ value: r.key, label: r.name }))]} />
              </>
            )}
          </MSheet>

          {tasksQ.isLoading && !tasksQ.data ? (
            <FullPageLoader label="Loading deliveries…" size="md" />
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
                      {g.id && defaultId && (
                        g.id === defaultId
                          ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-canvas border border-surface-subtle text-text-secondary">Default partner</span>
                          : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-status-warning-bg border border-status-warning-border text-status-warning-text">Changed for these orders</span>
                      )}
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
                  <span className="flex items-center gap-2">
                    {openFor(t) && <span className="text-[11px] text-status-warning-text tabular-nums">Open {openFor(t)}</span>}
                    <OutcomeBadge task={t} />
                  </span>
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
        <section className="rn-enter space-y-4">
          <CustodyPanel />
          <ThaliDesk canManage={!readOnly} />
        </section>
      )}

      {tab === "history" && (
        <section className="rn-enter space-y-4">

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
            options={assignable.map((s) => ({ value: s.id, label: s.fullName }))}
            className="flex-1 min-w-[150px]"
            triggerClassName="bg-white text-text-primary"
          />
          <button type="button" disabled={!bulkStaff} onClick={bulkAssign} className="rn-btn rn-btn-primary">Assign</button>
          <button type="button" onClick={() => setSelected(new Set())} className="rn-press min-h-[44px] px-3 text-sm text-sage-pale">Clear</button>
        </div>
      )}

      <TaskPanel
        taskId={focusId}
        onClose={() => setFocusId(null)}
        readOnly={readOnly}
        staff={assignable}
        pastCutoff={Boolean(m?.pastCutoff)}
        onRecord={(t) => setRecordTask(t)}
      />
      <DeliverySheet
        task={recordTask}
        currentUserId={user.id}
        onClose={() => setRecordTask(null)}
        onSaved={(text, done) => {
          // Shown as done now; the lists refresh when the background save is confirmed.
          if (done) setHeld((h) => ({ ...h, [done.id]: done }));
          setNotice({ tone: "ok", text });
        }}
      />
    </div>
  );
}
