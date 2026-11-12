"use client";

/**
 * The dashboard on the phone app: greeting, the month's money, one-tap actions, today's figures,
 * what needs attention and the latest money movements. Built on the app kit (components/app/m.tsx).
 */

import React from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, BedDouble, CheckCircle2, Info, Plus, ReceiptText, Truck, Users, UtensilsCrossed, Wallet, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ClosingDivision, NotificationItem } from "@/types";
import { greeting } from "@/lib/names";
import { formatMoney } from "@/lib/format";
import { MEmpty, MGroup, MHero, MQuick, MRow, MSection, MSegment, MStack, MStats, dayLabel } from "@/components/app/m";
import type { DashboardDivisionView } from "./DashboardView";
import { useQuickOrder } from "@/modules/orders/components/QuickOrder";

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

export function DashboardMobile({
  ownerName,
  division,
  divisions,
  onDivision,
  showMoney,
  view,
  attention,
  cashInHand,
  exportButton,
}: {
  ownerName: string;
  division: ClosingDivision;
  divisions: ClosingDivision[];
  onDivision: (d: ClosingDivision) => void;
  showMoney: boolean;
  view: DashboardDivisionView;
  attention: NotificationItem[];
  cashInHand: number | null;
  exportButton: React.ReactNode;
}) {
  const { ops, occupancy, finance, metricsUnavailable } = view;
  const quick = useQuickOrder();
  const t = ops.today;
  const free = Math.max(0, occupancy.totalCapacity - occupancy.occupiedBeds);
  const tiles: Array<React.ComponentProps<typeof MStats>["items"][number]> = [];
  if (division !== "TIFFIN") tiles.push({ icon: Users, label: `Residents · ${occupancy.occupancyRate}% full`, value: ops.people ? ops.people.activeResidents : "—", href: "/residents" });
  if (division !== "TIFFIN") tiles.push({ icon: BedDouble, label: `Free beds of ${occupancy.totalCapacity}`, value: free, href: "/rooms" });
  if (division !== "PG") tiles.push({ icon: Truck, tone: t && t.problems > 0 ? "red" : "orange", label: t ? (t.problems > 0 ? `Delivered · ${t.problems} problem${t.problems === 1 ? "" : "s"}` : `Delivered · ${t.out} out${t.waiting ? ` · ${t.waiting} not assigned` : ""}`) : "Delivered", value: t ? `${t.delivered}/${t.total}` : "—", href: "/delivery" });
  if (division !== "PG") tiles.push({ icon: UtensilsCrossed, tone: "orange", label: t ? `Thalis · ${t.boxes.breakfast ? `B ${t.boxes.breakfast} · ` : ""}L ${t.boxes.lunch} · D ${t.boxes.dinner}` : "Thalis today", value: t ? (t.boxes.breakfast ?? 0) + t.boxes.lunch + t.boxes.dinner : "—", href: "/orders" });
  if (division === "TIFFIN") tiles.push({ icon: Users, label: `Customers · ${ops.tiffin?.activeSubscriptions ?? 0} plans`, value: ops.tiffin ? ops.tiffin.activeCustomers : "—", href: "/tiffin" });
  if (division === "PG") tiles.push({ icon: Wallet, tone: finance.overdueCount > 0 ? "amber" : "accent", label: `Rent owed · ${finance.overdueCount} owing`, value: metricsUnavailable ? "—" : formatMoney(finance.outstandingRent), href: "/residents" });

  return (
    <MStack>
      <h1 className="rn-dash-hello">{greeting(ownerName)}</h1>

      {showMoney && divisions.length > 1 && (
        <MSegment label="Show" value={division} onChange={onDivision} options={divisions.map((d) => ({ value: d, label: d === "COMBINED" ? "All" : d === "PG" ? "PG" : "Tiffin" }))} />
      )}

      {metricsUnavailable && (
        <div role="alert" className="m-notice m-notice-red">
          Some figures could not be loaded. Pull down or reopen to try again.
        </div>
      )}

      {showMoney && ops.money && (
        <div>
          <MHero
            label={<>Collected this month{division !== "COMBINED" ? ` · ${division === "PG" ? "PG" : "Tiffin"}` : ""}</>}
            value={formatMoney(ops.money.collectedThisMonth)}
            action={
              <Link href="/finance?tab=cashbook" prefetch={false} className="m-hero-btn m-press">
                Cashbook <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            }
            items={[
              { label: "Expenses", value: formatMoney(ops.money.expensesThisMonth) },
              { label: "After expenses", value: formatMoney(ops.money.netCollected) },
              { label: "Cash in hand", value: cashInHand === null ? "—" : formatMoney(cashInHand), href: "/finance?tab=closing" },
              division === "TIFFIN"
                ? { label: "Cash with staff", value: ops.custody ? formatMoney(ops.custody.cashWithStaff) : "—", href: "/delivery?tab=custody" }
                : { label: "Rent owed", value: metricsUnavailable ? "—" : formatMoney(finance.outstandingRent), href: "/residents" },
            ]}
          />
          {ops.money.yesterdayUnclosed && (
            <Link href="/finance?tab=closing" prefetch={false} className="m-notice m-notice-red m-press mt-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">Yesterday&apos;s cash is not closed yet</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      )}

      <MQuick
        items={[
          { label: "New order", icon: Plus, onClick: quick.open, tone: "orange" },
          { label: "Deliveries", icon: Truck, href: "/delivery", tone: "orange" },
          { label: "Collect", icon: Wallet, href: "/finance?tab=receivables", tone: "green" },
          { label: "Residents", icon: Users, href: "/residents", tone: "green" },
        ]}
      />

      <MSection title="Today">
        <MStats items={tiles} />
      </MSection>

      <MSection
        title="Needs attention"
        action={
          attention.length > 4 ? (
            <Link href="/notifications" prefetch={false} className="m-link">
              See all {attention.length}
            </Link>
          ) : undefined
        }
      >
        {attention.length === 0 ? (
          <MEmpty icon={CheckCircle2} title="Nothing waiting on you" />
        ) : (
          <MGroup>
            {attention.slice(0, 4).map((n) => (
              <MRow
                key={n.id}
                icon={n.type === "ALERT" || n.type === "WARNING" ? AlertTriangle : n.type === "SUCCESS" ? CheckCircle2 : Info}
                tone={n.type === "ALERT" ? "red" : n.type === "WARNING" ? "amber" : n.type === "SUCCESS" ? "green" : "neutral"}
                title={n.title}
                sub={n.description}
                href={n.link || "/notifications"}
              />
            ))}
          </MGroup>
        )}
      </MSection>

      {showMoney && ops.recent && ops.recent.length > 0 && (
        <MSection
          title="Latest money"
          action={
            <Link href="/finance?tab=cashbook" prefetch={false} className="m-link">
              See all
            </Link>
          }
        >
          <MGroup>
            {ops.recent.slice(0, 5).map((r) => {
              const inflow = MONEY_IN.has(r.type);
              const outflow = MONEY_OUT.has(r.type);
              return (
                <MRow
                  key={r.id}
                  icon={inflow ? ArrowDownLeft : outflow ? ArrowUpRight : ReceiptText}
                  tone={inflow ? "green" : outflow ? "red" : "neutral"}
                  title={r.party || TYPE_LABEL[r.type] || r.type}
                  sub={[r.party ? TYPE_LABEL[r.type] || r.type : "", r.method, dayLabel(r.date)].filter(Boolean).join(" · ")}
                  right={`${outflow ? "−" : inflow ? "+" : ""}${formatMoney(r.amount)}`}
                  rightTone={inflow ? "green" : outflow ? "red" : undefined}
                />
              );
            })}
          </MGroup>
        </MSection>
      )}

      {quick.element}
    </MStack>
  );
}
