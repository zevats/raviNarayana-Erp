"use client";

import React, { useEffect, useMemo, useState } from "react";
import { greeting } from "@/lib/names";
import Link from "next/link";
import { Users, Truck, ReceiptText, ArrowUpRight, BedDouble, UtensilsCrossed, AlertTriangle, Info, CheckCircle2, ArrowDownLeft, ArrowUpLeft, ArrowRight, Wallet, Banknote } from "lucide-react";
import type { DashboardOps } from "@/server/dashboard/dashboardOpsService";
import type { NotificationItem, ClosingDivision } from "@/types";
import { CollectionsChart, ExpenseDonut, CompletionTrend } from "./DashboardCharts";
import { ExportReportModal } from "./ExportReportModal";
import { formatMoney } from "@/lib/format";

const rupees = (v: number) => formatMoney(v);
const shortDay = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const TYPE_LABEL: Record<string, string> = {
  RENT_PAYMENT: "Rent received",
  TIFFIN_PAYMENT: "Tiffin payment",
  SECURITY_DEPOSIT: "Deposit received",
  DEPOSIT_REFUND: "Deposit refunded",
  EXPENSE: "Expense",
  RENT_CHARGE: "Rent charged",
  TIFFIN_CHARGE: "Tiffin billed",
};
const MONEY_IN = new Set(["RENT_PAYMENT", "TIFFIN_PAYMENT", "SECURITY_DEPOSIT"]);
const MONEY_OUT = new Set(["EXPENSE", "DEPOSIT_REFUND"]);
const DIVISION_LABEL: Record<ClosingDivision, string> = { COMBINED: "All", PG: "PG", TIFFIN: "Tiffin" };
// Which notifications belong to which part of the business (by where they lead).
const TIFFIN_LINK = /^\/(delivery|orders|tiffin|kitchen)/;
const PG_LINK = /^\/(residents|rooms)|tab=residents|report=outstanding/;

export interface DashboardDivisionView {
  ops: DashboardOps;
  occupancy: { totalRooms: number; totalCapacity: number; occupiedBeds: number; vacantBeds: number; occupancyRate: number };
  finance: { outstandingRent: number; totalDepositsHeld: number; overdueCount: number };
  monthlyData: Array<{ month: string; label: string; collected: number; expenses: number }>;
  metricsUnavailable: boolean;
  exportSummary: React.ComponentProps<typeof ExportReportModal>["summary"];
}

/** Stat tile: icon circle, title, link mark, large figure, one quiet line. Same height in a row. */
function StatTile({ icon: Icon, title, value, note, href }: { icon: React.ElementType; title: string; value: string; note: React.ReactNode; href: string }) {
  return (
    <Link href={href} prefetch={false} className="rn-glass rn-hover-lift rn-dash-tile rounded-[20px] sm:rounded-[26px] p-3.5 sm:p-5 flex flex-col gap-2 sm:gap-4 min-w-0 h-full sm:min-h-[156px]">
      {/* Phones: the delivery app's tile (icon, large figure, name, one quiet line). */}
      <span className="sm:hidden flex flex-col gap-2.5 min-w-0">
        <span className="rn-dash-tile-icon"><Icon className="w-[18px] h-[18px]" strokeWidth={1.9} /></span>
        <span className="rn-dash-tile-value tabular-nums">{value}</span>
        <span className="min-w-0">
          <span className="block rn-dash-tile-title">{title}</span>
          <span className="block rn-dash-tile-note truncate">{note}</span>
        </span>
      </span>
      <span className="hidden sm:flex items-center justify-between gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-full bg-[var(--rn-accent-tint)] border border-white text-[var(--rn-accent-mid)] shrink-0">
          <Icon className="w-5 h-5" strokeWidth={1.7} />
        </span>
        <span className="grid place-items-center w-8 h-8 rounded-full border border-[var(--rn-line)] text-[var(--rn-ink-3)] shrink-0" aria-hidden>
          <ArrowUpRight className="w-4 h-4" />
        </span>
      </span>
      <span className="hidden sm:block sm:-mb-2 sm:truncate leading-tight text-[12px] sm:text-[14px] font-medium leading-tight text-[var(--rn-ink-2)] sm:text-[var(--rn-ink)]">{title}</span>
      <span className="mt-auto hidden sm:flex items-end gap-x-3 gap-y-1 flex-wrap">
        <span className="text-[20px] sm:text-[30px] leading-none font-semibold tracking-[-0.02em] text-[var(--rn-ink)] tabular-nums">{value}</span>
        <span className="hidden sm:inline text-[12.5px] text-[var(--rn-ink-3)] pb-0.5 truncate max-w-full">{note}</span>
      </span>
    </Link>
  );
}

function Failed({ what }: { what: string }) {
  return <div role="alert" className="rn-glass rounded-[26px] p-5 text-[13px] text-red-900 h-full">{what} could not be loaded. Refresh the page to try again.</div>;
}

/**
 * A list card: the first few rows, and a link to the full page when there are more (the card never
 * grows on the dashboard). Links inside the rows keep working as links.
 */
function ListCard<T>({
  title,
  action,
  items,
  shownCount = 4,
  empty,
  renderItem,
  listClassName = "mt-3 divide-y divide-[var(--rn-line)]",
  moreHref,
  id,
}: {
  title: string;
  action?: React.ReactNode;
  items: T[] | null;
  shownCount?: number;
  empty: React.ReactNode;
  renderItem: (item: T, i: number) => React.ReactNode;
  listClassName?: string;
  moreHref: string;
  id?: string;
}) {
  const more = items ? Math.max(0, items.length - shownCount) : 0;
  const shown = items ? items.slice(0, shownCount) : [];
  return (
    <section id={id} className="rn-glass rounded-[28px] p-5 sm:p-6 min-w-0 h-full flex flex-col">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">{title}</h2>
        {action}
      </div>
      {items === null ? (
        <p className="mt-4 text-[13px] text-red-900">Could not be loaded.</p>
      ) : items.length === 0 ? (
        <div className="mt-6">{empty}</div>
      ) : (
        <ul className={listClassName}>{shown.map((it, i) => renderItem(it, i))}</ul>
      )}
      {more > 0 && (
        <Link
          href={moreHref}
          prefetch={false}
          className="mt-auto pt-3 self-start inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--rn-accent)] hover:underline underline-offset-2"
        >
          See all {items!.length}
          <ArrowRight className="w-4 h-4" />
        </Link>
      )}
    </section>
  );
}

export function DashboardView({
  ownerName,
  initialDivision,
  divisions,
  showMoney,
  views,
  notifications,
  cashInHand,
  startDate,
  endDate,
}: {
  ownerName: string;
  initialDivision: ClosingDivision;
  divisions: ClosingDivision[];
  showMoney: boolean;
  views: Record<ClosingDivision, DashboardDivisionView>;
  notifications: NotificationItem[];
  cashInHand: number | null;
  startDate?: string;
  endDate?: string;
}) {
  // Switching All / PG / Tiffin is instant: every view was loaded with the page. The address keeps
  // the choice (a reload or a shared link opens the same view) without a new request.
  const [division, setDivision] = useState<ClosingDivision>(initialDivision);
  useEffect(() => setDivision(initialDivision), [initialDivision]);
  const choose = (d: ClosingDivision) => {
    setDivision(d);
    const url = new URL(window.location.href);
    if (d === "COMBINED") url.searchParams.delete("division");
    else url.searchParams.set("division", d);
    window.history.replaceState(window.history.state, "", url.toString());
  };
  const v = views[division] ?? views.COMBINED;
  const { ops, occupancy, finance, monthlyData, metricsUnavailable, exportSummary } = v;
  const t = ops.today;
  const expenseTotal = (ops.charts?.expensesByCategory ?? []).reduce((a, c) => a + c.value, 0);
  const free = Math.max(0, occupancy.totalCapacity - occupancy.occupiedBeds);
  const pg = division !== "TIFFIN";
  const tiffin = division !== "PG";
  const attention = useMemo(
    () => notifications.filter((n) => (division === "PG" ? !TIFFIN_LINK.test(n.link || "") : division === "TIFFIN" ? !PG_LINK.test(n.link || "") : true)),
    [notifications, division]
  );

  // Tiles follow the view: PG shows the house, Tiffin the kitchen and deliveries, All a mix.
  const tiles =
    division === "PG"
      ? [
          <StatTile key="res" icon={Users} title="Residents" value={ops.people ? String(ops.people.activeResidents) : "—"} note={<>{occupancy.occupancyRate}% of {occupancy.totalCapacity} beds</>} href="/residents" />,
          <StatTile key="beds" icon={BedDouble} title="Free beds" value={String(free)} note={<>{occupancy.occupiedBeds} occupied · {occupancy.totalRooms} rooms</>} href="/rooms" />,
          <StatTile key="owed" icon={Wallet} title="Rent owed" value={metricsUnavailable ? "—" : rupees(finance.outstandingRent)} note={<>{finance.overdueCount} resident{finance.overdueCount === 1 ? "" : "s"} owing</>} href="/reports?report=outstanding" />,
        ]
      : division === "TIFFIN"
      ? [
          <StatTile key="del" icon={Truck} title="Deliveries" value={t ? `${t.delivered}/${t.total}` : "—"} note={t ? (t.problems > 0 ? <span className="text-amber-700">{t.problems} problem{t.problems === 1 ? "" : "s"}</span> : `${t.waiting} waiting · ${t.out} out`) : "not loaded"} href="/delivery?tab=board" />,
          <StatTile key="box" icon={UtensilsCrossed} title="Thalis out" value={t ? String(t.boxes.lunch + t.boxes.dinner) : "—"} note={t ? `Lunch ${t.boxes.lunch} · Dinner ${t.boxes.dinner}` : "not loaded"} href="/orders" />,
          <StatTile key="cust" icon={Users} title="Customers" value={ops.tiffin ? String(ops.tiffin.activeCustomers) : "—"} note={ops.tiffin ? `${ops.tiffin.activeSubscriptions} active plans` : "not loaded"} href="/tiffin" />,
        ]
      : [
          <StatTile key="res" icon={Users} title="Residents" value={ops.people ? String(ops.people.activeResidents) : "—"} note={<>{occupancy.occupancyRate}% of {occupancy.totalCapacity} beds</>} href="/residents" />,
          <StatTile key="del" icon={Truck} title="Deliveries" value={t ? `${t.delivered}/${t.total}` : "—"} note={t ? (t.problems > 0 ? <span className="text-amber-700">{t.problems} problem{t.problems === 1 ? "" : "s"}</span> : `${t.waiting} waiting · ${t.out} out`) : "not loaded"} href="/delivery?tab=board" />,
          <StatTile key="box" icon={UtensilsCrossed} title="Thalis out" value={t ? String(t.boxes.lunch + t.boxes.dinner) : "—"} note={t ? `Lunch ${t.boxes.lunch} · Dinner ${t.boxes.dinner}` : "not loaded"} href="/orders" />,
        ];

  const roomsCard = (
    <Link href="/rooms" prefetch={false} className="flex flex-col rn-glass rn-hover-lift rounded-[28px] p-5 flex-1">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--rn-accent-tint)] text-[var(--rn-accent-mid)]"><BedDouble className="w-5 h-5" strokeWidth={1.7} /></span>
        <span className="flex-1 text-[15px] font-semibold text-[var(--rn-ink)]">Rooms &amp; beds</span>
        <span className="text-[13px] text-[var(--rn-ink-3)] tabular-nums">{occupancy.totalRooms} {occupancy.totalRooms === 1 ? "room" : "rooms"}</span>
      </div>
      {/* Few beds: one dot per bed (filled = occupied). Many beds: one occupancy bar, so the card
          keeps its size whatever the number of beds. */}
      {occupancy.totalCapacity <= 24 ? (
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label={`${occupancy.occupiedBeds} beds occupied, ${free} free`}>
          {Array.from({ length: occupancy.totalCapacity }, (_, i) => (
            <span key={i} className={`w-3.5 h-3.5 rounded-full ${i < occupancy.occupiedBeds ? "bg-[var(--rn-accent-mid)]" : "border-2 border-[var(--rn-accent-mid)]/40"}`} />
          ))}
        </div>
      ) : (
        <div className="mt-4" aria-label={`${occupancy.occupiedBeds} of ${occupancy.totalCapacity} beds occupied`}>
          <div className="flex items-baseline justify-between text-[12.5px] text-[var(--rn-ink-3)]">
            <span>{occupancy.totalCapacity} beds</span>
            <span className="tabular-nums font-semibold text-[var(--rn-ink)]">{occupancy.totalCapacity > 0 ? Math.round((occupancy.occupiedBeds / occupancy.totalCapacity) * 100) : 0}% full</span>
          </div>
          <div className="mt-2 h-2.5 rounded-full bg-black/[0.07] overflow-hidden">
            <div className="h-full rounded-full bg-[var(--rn-accent-mid)]" style={{ width: `${occupancy.totalCapacity > 0 ? Math.min(100, (occupancy.occupiedBeds / occupancy.totalCapacity) * 100) : 0}%` }} />
          </div>
        </div>
      )}
      {/* The counts fill the card (no empty band when the row is taller than the card's content) */}
      <div className="mt-4 flex-1 grid grid-cols-2 gap-2 text-center">
        {[
          ["Occupied", occupancy.occupiedBeds],
          ["Free beds", free],
        ].map(([label, val]) => (
          <div key={label as string} className="rounded-2xl bg-white/60 py-3 flex flex-col items-center justify-center">
            <p className="text-[20px] font-semibold tabular-nums text-[var(--rn-ink)]">{val}</p>
            <p className="text-[11.5px] text-[var(--rn-ink-3)]">{label}</p>
          </div>
        ))}
      </div>
    </Link>
  );
  const tiffinCard = (
    <Link href="/tiffin?tab=subscriptions" prefetch={false} className="flex flex-col rn-glass rn-hover-lift rounded-[28px] p-5 flex-1">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--rn-accent-tint)] text-[var(--rn-accent-mid)]"><UtensilsCrossed className="w-5 h-5" strokeWidth={1.7} /></span>
        <span className="flex-1 text-[15px] font-semibold text-[var(--rn-ink)]">Tiffin</span>
      </div>
      {ops.tiffin ? (
        <div className="mt-4 flex-1 grid grid-cols-3 gap-2 text-center">
          {[
            ["Active plans", ops.tiffin.activeSubscriptions],
            ["Paused", ops.tiffin.pausedSubscriptions],
            ["Customers", ops.tiffin.activeCustomers],
          ].map(([label, val]) => (
            <div key={label as string} className="rounded-2xl bg-white/60 py-3 flex flex-col items-center justify-center">
              <p className="text-[20px] font-semibold tabular-nums text-[var(--rn-ink)]">{val}</p>
              <p className="text-[11.5px] text-[var(--rn-ink-3)]">{label}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-red-900">Could not be loaded.</p>
      )}
    </Link>
  );

  const occupancyBars =
    ops.charts && pg ? (
      <MiniBars
        title="Occupancy at month end"
        subtitle="Last 6 months"
        data={ops.charts.occupancyHistory.map((m) => ({ label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${m.month}-01T00:00:00Z`)), value: m.value, detail: `${m.occupied} of ${m.capacity} beds` }))}
      />
    ) : null;
  const completion = ops.charts && tiffin ? <CompletionTrend days={ops.charts.deliveryCompletion} /> : null;

  return (
    <div className="space-y-5">
      {metricsUnavailable && (
        <div role="alert" className="rn-glass rounded-[22px] p-4 text-[13px] text-red-900">
          Some figures could not be loaded because the database is not reachable. Refresh once it is available.
        </div>
      )}

      {/* Greeting + controls */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="lg:hidden rn-dash-hello">{greeting(ownerName)}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showMoney && divisions.length > 1 && (
            <div role="radiogroup" aria-label="Show" className="flex-1 sm:flex-none inline-flex p-1 rounded-full rn-glass text-[12.5px] [&>button]:flex-1 [&>button]:justify-center sm:[&>button]:flex-none">
              {divisions.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={division === d}
                  onClick={() => choose(d)}
                  className={`px-4 h-9 inline-flex items-center rounded-full transition-colors ${division === d ? "bg-[var(--rn-accent)] text-white font-semibold" : "text-[var(--rn-ink-3)] hover:text-[var(--rn-ink)]"}`}
                >
                  {DIVISION_LABEL[d]}
                </button>
              ))}
            </div>
          )}
          <ExportReportModal summary={exportSummary} division={division} startDate={startDate} endDate={endDate} />
        </div>
      </div>

      {/* Row 1: tiles + chart (left), money + spending (right); both columns end level */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] items-stretch">
        <div className="flex flex-col gap-5 min-w-0">
          <div className="rn-dash-tiles grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4 auto-rows-fr">{tiles}</div>
          {showMoney && ops.charts ? (
            <div className="flex-1 min-h-0 flex flex-col [&>*]:flex-1">
              <CollectionsChart daily={ops.charts.dailyCollections} monthly={monthlyData.map((m) => ({ month: m.month, label: m.label, collected: m.collected }))} />
            </div>
          ) : showMoney ? (
            <Failed what="Money received" />
          ) : null}
        </div>

        {showMoney && (
          <div className="flex flex-col gap-5 min-w-0">
            {ops.money ? (
              <section className="rn-dash-money rounded-[28px] p-6 text-white relative overflow-hidden" style={{ background: "linear-gradient(150deg, #263B2D 0%, #1A2E20 70%)", boxShadow: "0 30px 60px -32px rgba(10,20,14,0.7)" }}>
                <span className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/5" aria-hidden />
                <div className="flex items-center gap-3 min-h-[44px]">
                  <span className="flex-1 text-[14.5px] font-medium">
                    Collected this month{division !== "COMBINED" && <span className="text-white/55"> · {DIVISION_LABEL[division]}</span>}
                  </span>
                  <Link href="/finance?tab=cashbook" prefetch={false} aria-label="Open the cashbook" className="grid place-items-center w-8 h-8 rounded-full border border-white/15 hover:bg-white/10">
                    <ArrowUpRight className="w-4 h-4" />
                  </Link>
                </div>
                <p className="rn-dash-money-total mt-5 text-[38px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{rupees(ops.money.collectedThisMonth)}</p>
                <div className="mt-5 grid grid-cols-2 gap-3 text-[12.5px]">
                  <div className="rn-dash-money-cell rounded-2xl bg-white/[0.07] px-3.5 py-3">
                    <p className="text-white/55">Expenses</p>
                    <p className="mt-1 text-[15px] font-semibold tabular-nums">{rupees(ops.money.expensesThisMonth)}</p>
                  </div>
                  <div className="rn-dash-money-cell rounded-2xl bg-white/[0.07] px-3.5 py-3">
                    <p className="text-white/55">Collected − expenses</p>
                    <p className="mt-1 text-[15px] font-semibold tabular-nums">{rupees(ops.money.netCollected)}</p>
                  </div>
                  <div className="rn-dash-money-cell rounded-2xl bg-white/[0.07] px-3.5 py-3">
                    <p className="text-white/55">Cash in hand</p>
                    <p className="mt-1 text-[15px] font-semibold tabular-nums">{cashInHand === null ? "—" : rupees(cashInHand)}</p>
                  </div>
                  {division === "TIFFIN" ? (
                    <Link href="/delivery?tab=custody" prefetch={false} className="rn-dash-money-cell rounded-2xl bg-white/[0.07] px-3.5 py-3 hover:bg-white/[0.12] transition-colors">
                      <p className="text-white/55 flex items-center gap-1"><Banknote className="w-3.5 h-3.5" /> Cash with staff</p>
                      <p className="mt-1 text-[15px] font-semibold tabular-nums">{ops.custody ? rupees(ops.custody.cashWithStaff) : "—"}</p>
                    </Link>
                  ) : (
                    <Link href="/reports?report=outstanding" prefetch={false} className="rn-dash-money-cell rounded-2xl bg-white/[0.07] px-3.5 py-3 hover:bg-white/[0.12] transition-colors">
                      <p className="text-white/55">Rent owed</p>
                      <p className="mt-1 text-[15px] font-semibold tabular-nums">{metricsUnavailable ? "—" : rupees(finance.outstandingRent)}</p>
                    </Link>
                  )}
                </div>
                {ops.money.yesterdayUnclosed && (
                  <Link href="/finance?tab=closing" prefetch={false} className="rn-dash-money-warn mt-4 flex items-center gap-2 rounded-2xl bg-[#C89F6B]/20 px-3.5 py-2.5 text-[12.5px] text-[#F3DDBB] hover:bg-[#C89F6B]/30">
                    <AlertTriangle className="w-4 h-4" /> Yesterday&apos;s cash is not closed yet
                  </Link>
                )}
              </section>
            ) : (
              <Failed what="Money this month" />
            )}
            {ops.charts && (
              <div className="flex-1 min-h-0 flex flex-col [&>*]:flex-1">
                <ExpenseDonut items={ops.charts.expensesByCategory} total={expenseTotal} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 2: transactions, attention, and the rooms / tiffin cards; every card in the row is the
          same height (lists show a few rows; "See all" opens the full page). */}
      <div className={`grid gap-5 items-stretch lg:grid-cols-2 ${showMoney ? "xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)]" : ""}`}>
        {showMoney && (
          <ListCard
            title="Recent transactions"
            moreHref="/finance?tab=cashbook"
            action={<Link href="/finance?tab=cashbook" prefetch={false} className="text-[13px] text-[var(--rn-ink-3)] hover:text-[var(--rn-ink)]">See all</Link>}
            items={ops.recent}
            empty={<p className="text-[13px] text-[var(--rn-ink-3)]">No transactions yet.</p>}
            renderItem={(r) => {
              const inflow = MONEY_IN.has(r.type);
              const outflow = MONEY_OUT.has(r.type);
              return (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <span className={`grid place-items-center w-10 h-10 rounded-full shrink-0 ${inflow ? "bg-[#E6F1E4] text-[#2F6B24]" : outflow ? "bg-[#FBEDE8] text-[#9A3423]" : "bg-black/[0.04] text-[var(--rn-ink-3)]"}`}>
                    {inflow ? <ArrowDownLeft className="w-4 h-4" /> : outflow ? <ArrowUpLeft className="w-4 h-4" /> : <ReceiptText className="w-4 h-4" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] text-[var(--rn-ink)] truncate">{r.party || TYPE_LABEL[r.type] || r.type}</span>
                    <span className="block text-[12px] text-[var(--rn-ink-3)] truncate">{TYPE_LABEL[r.type] || r.type}{r.method ? ` · ${r.method}` : ""} · {shortDay(r.date)}</span>
                  </span>
                  <span className={`text-[15px] font-semibold tabular-nums ${inflow ? "text-[#2F6B24]" : outflow ? "text-[#9A3423]" : "text-[var(--rn-ink)]"}`}>
                    {outflow ? "−" : inflow ? "+" : ""}{rupees(r.amount)}
                  </span>
                </li>
              );
            }}
          />
        )}

        <ListCard
          id="notifications"
          moreHref="/notifications"
          title="Needs attention"
          items={attention}
          listClassName="mt-3 space-y-2"
          empty={<p className="flex items-center gap-2 text-[13px] text-[var(--rn-ink-3)]"><CheckCircle2 className="w-4 h-4 text-[#2F6B24]" /> Nothing waiting on you.</p>}
          renderItem={(n) => (
            <li key={n.id}>
              <Link href={n.link || "/dashboard"} prefetch={false} className="flex items-start gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/70 transition-colors">
                <span className={`grid place-items-center w-9 h-9 rounded-full shrink-0 ${n.type === "ALERT" ? "bg-[#FBEDE8] text-[#9A3423]" : n.type === "WARNING" ? "bg-[#FBF4E6] text-[#8F6710]" : n.type === "SUCCESS" ? "bg-[#E6F1E4] text-[#2F6B24]" : "bg-black/[0.04] text-[var(--rn-ink-3)]"}`}>
                  {n.type === "ALERT" || n.type === "WARNING" ? <AlertTriangle className="w-4 h-4" /> : n.type === "SUCCESS" ? <CheckCircle2 className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13.5px] truncate ${n.isRead ? "text-[var(--rn-ink-2)]" : "text-[var(--rn-ink)] font-medium"}`}>{n.title}</span>
                  <span className="block text-[12px] text-[var(--rn-ink-3)] truncate">{n.description}</span>
                </span>
              </Link>
            </li>
          )}
        />

        <div className={`flex flex-col gap-5 min-w-0 ${showMoney ? "lg:col-span-2 xl:col-span-1" : ""}`}>
          {pg && roomsCard}
          {tiffin && tiffinCard}
        </div>
      </div>

      {/* Row 3: history charts for the view (one fills the row on its own) */}
      {(occupancyBars || completion) && (
        <div className={`grid gap-5 items-stretch ${occupancyBars && completion ? "lg:grid-cols-2" : ""}`}>
          {completion}
          {occupancyBars}
        </div>
      )}
    </div>
  );
}

/** Compact percentage columns with the value under each (labels visible; no hover needed). */
function MiniBars({ title, subtitle, data }: { title: string; subtitle: string; data: Array<{ label: string; value: number; detail: string }> }) {
  const any = data.some((d) => d.value > 0);
  return (
    <section className="rn-glass rounded-[28px] p-5 sm:p-6 min-w-0 h-full">
      <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">{title}</h2>
      <p className="text-[12.5px] text-[var(--rn-ink-3)] mt-0.5">{subtitle}</p>
      {!any ? (
        <p className="mt-4 h-[190px] grid place-items-center text-[13px] text-[var(--rn-ink-3)]">Nothing recorded in this period.</p>
      ) : (
        <div className="mt-4 flex items-end gap-1.5 h-[190px] pb-1">
          {data.map((d) => (
            <div key={d.label} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1.5 h-full" title={`${d.label}: ${d.value}% (${d.detail})`}>
              <span className="text-[10.5px] tabular-nums text-[var(--rn-ink-3)]">{d.value}%</span>
              <span className="w-full max-w-[24px] rounded-t-[8px] rounded-b-[3px] bg-[#238A4E] transition-[height] duration-500 ease-out" style={{ height: `${Math.max(d.value > 0 ? 4 : 2, d.value * 0.85)}px`, opacity: d.value > 0 ? 1 : 0.18 }} />
              <span className="text-[10.5px] text-[var(--rn-ink-3)] truncate max-w-full">{d.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
