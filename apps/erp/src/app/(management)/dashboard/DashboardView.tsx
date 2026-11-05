import React from "react";
import { greeting } from "@/lib/names";
import Link from "next/link";
import { Users, Truck, ReceiptText, ArrowUpRight, BedDouble, UtensilsCrossed, AlertTriangle, Info, CheckCircle2, ArrowDownLeft, ArrowUpLeft } from "lucide-react";
import type { DashboardOps } from "@/server/dashboard/dashboardOpsService";
import type { NotificationItem, ClosingDivision } from "@/types";
import { CollectionsChart, ExpenseDonut, CompletionTrend } from "./DashboardCharts";
import { ExportReportModal } from "./ExportReportModal";
import { formatNumberIN, formatMoney } from "@/lib/format";

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

/** Reference stat tile: icon circle, title, ⋯ link, large figure, one quiet line. */
function StatTile({ icon: Icon, title, value, note, href, delay }: { icon: React.ElementType; title: string; value: string; note: React.ReactNode; href: string; delay: string }) {
  return (
    <Link href={href} prefetch={false} className={`rn-glass rn-hover-lift rn-rise ${delay} rounded-[26px] p-5 flex flex-col gap-4 min-w-0 min-h-[156px]`}>
      <span className="flex items-center justify-between gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-full bg-[var(--rn-accent-tint)] border border-white text-[var(--rn-accent-mid)] shrink-0">
          <Icon className="w-5 h-5" strokeWidth={1.7} />
        </span>
        <span className="grid place-items-center w-8 h-8 rounded-full border border-[var(--rn-line)] text-[var(--rn-ink-3)] shrink-0" aria-hidden>
          <ArrowUpRight className="w-4 h-4" />
        </span>
      </span>
      <span className="-mb-2 truncate text-[14px] font-medium leading-tight text-[var(--rn-ink)]">{title}</span>
      <span className="flex items-end gap-x-3 gap-y-1 flex-wrap">
        <span className="text-[30px] leading-none font-semibold tracking-[-0.02em] text-[var(--rn-ink)] tabular-nums">{value}</span>
        <span className="text-[12.5px] text-[var(--rn-ink-3)] pb-0.5 truncate max-w-full">{note}</span>
      </span>
    </Link>
  );
}

function Failed({ what }: { what: string }) {
  return <div role="alert" className="rn-glass rounded-[26px] p-5 text-[13px] text-red-900">{what} could not be loaded. Refresh the page to try again.</div>;
}

export function DashboardView({
  ownerName,
  division,
  showMoney,
  ops,
  occupancy,
  finance,
  monthlyData,
  notifications,
  cashInHand,
  metricsUnavailable,
  exportSummary,
  startDate,
  endDate,
}: {
  ownerName: string;
  division: ClosingDivision;
  showMoney: boolean;
  ops: DashboardOps;
  occupancy: { totalRooms: number; totalCapacity: number; occupiedBeds: number; vacantBeds: number; occupancyRate: number };
  finance: { outstandingRent: number; totalDepositsHeld: number; overdueCount: number };
  monthlyData: Array<{ month: string; label: string; collected: number; expenses: number }>;
  notifications: NotificationItem[];
  cashInHand: number | null;
  metricsUnavailable: boolean;
  exportSummary: React.ComponentProps<typeof ExportReportModal>["summary"];
  startDate?: string;
  endDate?: string;
}) {
  const t = ops.today;
  const expenseTotal = (ops.charts?.expensesByCategory ?? []).reduce((a, c) => a + c.value, 0);
  const free = Math.max(0, occupancy.totalCapacity - occupancy.occupiedBeds);

  return (
    <div className="space-y-5">
      {metricsUnavailable && (
        <div role="alert" className="rn-glass rounded-[22px] p-4 text-[13px] text-red-900">
          Some figures could not be loaded because the database is not reachable. Refresh once it is available.
        </div>
      )}

      {/* Greeting + controls */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 rn-rise">
        <div>
          <h2 className="lg:hidden text-[26px] font-semibold tracking-[-0.02em] text-[var(--rn-ink)]">{greeting(ownerName)}</h2>
          <p className="text-[14px] text-[var(--rn-ink-3)] mt-1 lg:mt-0">Here is how the house and the kitchen are doing today.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showMoney && (
            <div className="inline-flex p-1 rounded-full rn-glass text-[12.5px]">
              {(["COMBINED", "PG", "TIFFIN"] as const).map((d) => (
                <Link
                  key={d}
                  href={`/dashboard?division=${d}`}
                  prefetch={false}
                  aria-current={division === d ? "page" : undefined}
                  className={`px-4 h-9 inline-flex items-center rounded-full transition-colors ${division === d ? "bg-[var(--rn-accent)] text-white font-semibold" : "text-[var(--rn-ink-3)] hover:text-[var(--rn-ink)]"}`}
                >
                  {d === "COMBINED" ? "All" : d === "PG" ? "PG" : "Tiffin"}
                </Link>
              ))}
            </div>
          )}
          <ExportReportModal summary={exportSummary} division={division} startDate={startDate} endDate={endDate} />
        </div>
      </div>

      {/* Row 1: tiles + chart (left), money + spending (right) */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5 min-w-0">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile icon={Users} title="Residents" value={ops.people ? String(ops.people.activeResidents) : "—"} note={<>{occupancy.occupancyRate}% of {occupancy.totalCapacity} beds</>} href="/residents" delay="rn-rise-1" />
            <StatTile
              icon={Truck}
              title="Deliveries today"
              value={t ? `${t.delivered}/${t.total}` : "—"}
              note={t ? (t.problems > 0 ? <span className="text-amber-700">{t.problems} problem{t.problems === 1 ? "" : "s"}</span> : `${t.waiting} waiting · ${t.out} out`) : "not loaded"}
              href="/delivery?tab=board"
              delay="rn-rise-2"
            />
            <StatTile
              icon={UtensilsCrossed}
              title="Boxes out today"
              value={t ? String(t.boxes.lunch + t.boxes.dinner) : "—"}
              note={t ? `Lunch ${t.boxes.lunch} · Dinner ${t.boxes.dinner}` : "not loaded"}
              href="/orders"
              delay="rn-rise-3"
            />
          </div>
          {showMoney && ops.charts ? (
            <CollectionsChart daily={ops.charts.dailyCollections} monthly={monthlyData.map((m) => ({ month: m.month, label: m.label, collected: m.collected }))} />
          ) : showMoney ? (
            <Failed what="Money received" />
          ) : null}
        </div>

        <div className="space-y-5 min-w-0">
          {showMoney &&
            (ops.money ? (
              <section className="rounded-[28px] p-6 text-white rn-rise rn-rise-1 relative overflow-hidden" style={{ background: "linear-gradient(150deg, #263B2D 0%, #1A2E20 70%)", boxShadow: "0 30px 60px -32px rgba(10,20,14,0.7)" }}>
                <span className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/5" aria-hidden />
                <div className="flex items-center gap-3 min-h-[44px]">
                  <span className="flex-1 text-[14.5px] font-medium">Collected this month</span>
                  <Link href="/finance?tab=cashbook" prefetch={false} aria-label="Open the cashbook" className="grid place-items-center w-8 h-8 rounded-full border border-white/15 hover:bg-white/10">
                    <ArrowUpRight className="w-4 h-4" />
                  </Link>
                </div>
                <p className="mt-5 text-[38px] leading-none font-semibold tracking-[-0.02em] tabular-nums">{rupees(ops.money.collectedThisMonth)}</p>
                <div className="mt-5 grid grid-cols-2 gap-3 text-[12.5px]">
                  <div className="rounded-2xl bg-white/[0.07] px-3.5 py-3">
                    <p className="text-white/55">Expenses</p>
                    <p className="mt-1 text-[15px] font-semibold tabular-nums">{rupees(ops.money.expensesThisMonth)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.07] px-3.5 py-3">
                    <p className="text-white/55">Collected − expenses</p>
                    <p className="mt-1 text-[15px] font-semibold tabular-nums">{rupees(ops.money.netCollected)}</p>
                  </div>
                  <div className="rounded-2xl bg-white/[0.07] px-3.5 py-3">
                    <p className="text-white/55">Cash in hand</p>
                    <p className="mt-1 text-[15px] font-semibold tabular-nums">{cashInHand === null ? "—" : rupees(cashInHand)}</p>
                  </div>
                  <Link href="/reports?report=outstanding" prefetch={false} className="rounded-2xl bg-white/[0.07] px-3.5 py-3 hover:bg-white/[0.12] transition-colors">
                    <p className="text-white/55">Rent owed</p>
                    <p className="mt-1 text-[15px] font-semibold tabular-nums">{metricsUnavailable ? "—" : rupees(finance.outstandingRent)}</p>
                  </Link>
                </div>
                {ops.money.yesterdayUnclosed && (
                  <Link href="/finance?tab=closing" prefetch={false} className="mt-4 flex items-center gap-2 rounded-2xl bg-[#C89F6B]/20 px-3.5 py-2.5 text-[12.5px] text-[#F3DDBB] hover:bg-[#C89F6B]/30">
                    <AlertTriangle className="w-4 h-4" /> Yesterday&apos;s cash is not closed yet
                  </Link>
                )}
              </section>
            ) : (
              <Failed what="Money this month" />
            ))}
          {showMoney && ops.charts && <ExpenseDonut items={ops.charts.expensesByCategory} total={expenseTotal} />}
        </div>
      </div>

      {/* Row 2: transactions, attention, rooms & tiffin */}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
        {showMoney && (
          <section className="rn-glass rounded-[28px] p-5 sm:p-6 rn-rise rn-rise-2 min-w-0">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">Recent transactions</h2>
              <Link href="/finance?tab=cashbook" prefetch={false} className="text-[13px] text-[var(--rn-ink-3)] hover:text-[var(--rn-ink)]">See all</Link>
            </div>
            {!ops.recent ? (
              <p className="mt-4 text-[13px] text-red-900">Could not be loaded.</p>
            ) : ops.recent.length === 0 ? (
              <p className="mt-6 text-[13px] text-[var(--rn-ink-3)]">No transactions yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--rn-line)]">
                {ops.recent.map((r) => {
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
                })}
              </ul>
            )}
          </section>
        )}

        <section id="notifications" className="rn-glass rounded-[28px] p-5 sm:p-6 rn-rise rn-rise-3 min-w-0">
          <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">Needs attention</h2>
          {notifications.length === 0 ? (
            <p className="mt-6 flex items-center gap-2 text-[13px] text-[var(--rn-ink-3)]"><CheckCircle2 className="w-4 h-4 text-[#2F6B24]" /> Nothing waiting on you.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {notifications.slice(0, 5).map((n) => (
                <li key={n.id}>
                  <Link href={n.link || "/dashboard"} prefetch={false} className="flex items-start gap-3 rounded-2xl px-3 py-2.5 hover:bg-white/70 transition-colors">
                    <span className={`grid place-items-center w-9 h-9 rounded-full shrink-0 ${n.type === "ALERT" ? "bg-[#FBEDE8] text-[#9A3423]" : n.type === "WARNING" ? "bg-[#FBF4E6] text-[#8F6710]" : n.type === "SUCCESS" ? "bg-[#E6F1E4] text-[#2F6B24]" : "bg-black/[0.04] text-[var(--rn-ink-3)]"}`}>
                      {n.type === "ALERT" || n.type === "WARNING" ? <AlertTriangle className="w-4 h-4" /> : n.type === "SUCCESS" ? <CheckCircle2 className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[13.5px] truncate ${n.isRead ? "text-[var(--rn-ink-2)]" : "text-[var(--rn-ink)] font-medium"}`}>{n.title}</span>
                      <span className="block text-[12px] text-[var(--rn-ink-3)] line-clamp-1">{n.description}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-5 min-w-0 lg:col-span-2 xl:col-span-1">
          <Link href="/rooms" prefetch={false} className="block rn-glass rn-hover-lift rounded-[28px] p-5 rn-rise rn-rise-3">
            <div className="flex items-center gap-3">
              <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--rn-accent-tint)] text-[var(--rn-accent-mid)]"><BedDouble className="w-5 h-5" strokeWidth={1.7} /></span>
              <span className="flex-1 text-[15px] font-semibold text-[var(--rn-ink)]">Rooms &amp; beds</span>
              <span className="text-[13px] text-[var(--rn-ink-3)] tabular-nums">{occupancy.totalRooms} {occupancy.totalRooms === 1 ? "room" : "rooms"}</span>
            </div>
            {/* One dot per bed: occupied (filled) and free (outline), from the live counts */}
            <div className="mt-4 flex flex-wrap gap-1.5" aria-label={`${occupancy.occupiedBeds} beds occupied, ${free} free`}>
              {Array.from({ length: Math.min(occupancy.totalCapacity, 60) }, (_, i) => (
                <span key={i} className={`w-3.5 h-3.5 rounded-full ${i < occupancy.occupiedBeds ? "bg-[var(--rn-accent-mid)]" : "border-2 border-[var(--rn-accent-mid)]/40"}`} />
              ))}
            </div>
            <p className="mt-3 text-[12.5px] text-[var(--rn-ink-3)]"><span className="text-[var(--rn-ink)] font-semibold tabular-nums">{occupancy.occupiedBeds}</span> occupied · <span className="text-[var(--rn-ink)] font-semibold tabular-nums">{free}</span> free</p>
          </Link>
          <Link href="/tiffin?tab=subscriptions" prefetch={false} className="block rn-glass rn-hover-lift rounded-[28px] p-5 rn-rise rn-rise-4">
            <div className="flex items-center gap-3">
              <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--rn-accent-tint)] text-[var(--rn-accent-mid)]"><UtensilsCrossed className="w-5 h-5" strokeWidth={1.7} /></span>
              <span className="flex-1 text-[15px] font-semibold text-[var(--rn-ink)]">Tiffin</span>
            </div>
            {ops.tiffin ? (
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[
                  ["Active plans", ops.tiffin.activeSubscriptions],
                  ["Paused", ops.tiffin.pausedSubscriptions],
                  ["Customers", ops.tiffin.activeCustomers],
                ].map(([label, v]) => (
                  <div key={label as string} className="rounded-2xl bg-white/60 py-3">
                    <p className="text-[20px] font-semibold tabular-nums text-[var(--rn-ink)]">{v}</p>
                    <p className="text-[11.5px] text-[var(--rn-ink-3)]">{label}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-[13px] text-red-900">Could not be loaded.</p>
            )}
          </Link>
        </div>
      </div>

      {/* Row 3: completion and occupancy history */}
      {ops.charts && (
        <div className="grid gap-5 lg:grid-cols-2">
          <CompletionTrend days={ops.charts.deliveryCompletion} />
          <MiniBars
            title="Occupancy at month end"
            subtitle="From residents' stay dates, last 6 months"
            data={ops.charts.occupancyHistory.map((m) => ({ label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${m.month}-01T00:00:00Z`)), value: m.value, detail: `${m.occupied} of ${m.capacity} beds` }))}
          />
        </div>
      )}
    </div>
  );
}

/** Compact percentage columns with the value under each (labels visible; no hover needed). */
function MiniBars({ title, subtitle, data }: { title: string; subtitle: string; data: Array<{ label: string; value: number; detail: string }> }) {
  const any = data.some((d) => d.value > 0);
  return (
    <section className="rn-glass rounded-[28px] p-5 sm:p-6 rn-rise min-w-0">
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
