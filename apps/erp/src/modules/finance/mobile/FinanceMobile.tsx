"use client";

/**
 * Finance on the phone app: Cashbook, Receivables, Resident dues, Invoices and Daily closing, built
 * on the app kit (components/app/m.tsx). Same data and actions as the desktop views.
 */

import React, { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpenText,
  CalendarDays,
  CalendarClock,
  CreditCard,
  Download,
  FileText,
  HandCoins,
  LockKeyhole,
  MoreHorizontal,
  Receipt,
  ReceiptText,
  RotateCcw,
  TrendingDown,
  Wallet,
  AlertTriangle,
  Users,
} from "lucide-react";
import type { CashbookSummary, FinancialTransaction, ResidentListItem } from "@/types";
import { formatPaymentMethodLabel, tryNormalizePaymentMethod } from "@/types";
import { formatMoney, readableNote } from "@/lib/format";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { getLocalDaysAgo, getLocalFirstDayOfMonth, toLocalDateString } from "../utils/dateUtils";
import {
  MButton,
  MChips,
  MEmpty,
  MField,
  MGroup,
  MHero,
  MMore,
  MPill,
  MQuick,
  MRow,
  MSearch,
  MSection,
  MSegment,
  MSheet,
  MSkeletonRows,
  MStack,
  groupByDay,
  initials,
  type MTone,
} from "@/components/app/m";

export type FinanceTab = "cashbook" | "receivables" | "invoices" | "closing";

const PLACES: Array<{ value: FinanceTab; label: string; icon: React.ElementType }> = [
  { value: "cashbook", label: "Cashbook", icon: BookOpenText },
  { value: "receivables", label: "Dues", icon: HandCoins },
  { value: "invoices", label: "Bills", icon: FileText },
  { value: "closing", label: "Closing", icon: LockKeyhole },
];

/** The finance places in one row. */
export function FinancePlaces({ value, onChange }: { value: FinanceTab; onChange: (t: FinanceTab) => void }) {
  return (
    <nav aria-label="Finance" className="m-places" style={{ gridTemplateColumns: `repeat(${PLACES.length}, minmax(0, 1fr))` }}>
      {PLACES.map((p) => {
        const Icon = p.icon;
        return (
          <button key={p.value} type="button" onClick={() => onChange(p.value)} aria-current={value === p.value ? "page" : undefined} className="m-place m-press">
            <Icon strokeWidth={1.9} />
            <span>{p.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ================================================================== Cashbook */

const TYPE_LABEL: Record<string, string> = {
  RENT_PAYMENT: "Rent received",
  RENT_CHARGE: "Rent charged",
  SECURITY_DEPOSIT: "Deposit received",
  DEPOSIT_REFUND: "Deposit refunded",
  TIFFIN_PAYMENT: "Tiffin payment",
  TIFFIN_CHARGE: "Tiffin billed",
  EXPENSE: "Expense",
  REVERSAL: "Reversal",
};
const MONEY_IN = new Set(["RENT_PAYMENT", "SECURITY_DEPOSIT", "TIFFIN_PAYMENT"]);
const MONEY_OUT = new Set(["EXPENSE", "DEPOSIT_REFUND"]);
const CHARGES = new Set(["RENT_CHARGE", "TIFFIN_CHARGE"]);

type Kind = "ALL" | "IN" | "OUT" | "CHARGE" | "REVERSAL";
type Division = "ALL" | "PG" | "TIFFIN";
type Method = "ALL" | "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
type TxStatus = "ALL" | "POSTED" | "REVERSED";
type Period = "MONTH" | "30" | "ALL" | "CUSTOM";

const plainCategory = (c: string) => {
  const s = String(c || "").replace(/_/g, " ").toLowerCase().trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

function txLook(tx: FinancialTransaction): { icon: React.ElementType; tone: MTone; sign: "+" | "−" | ""; amountTone?: MTone } {
  if (tx.transactionType === "REVERSAL") return { icon: RotateCcw, tone: "neutral", sign: "" };
  if (MONEY_IN.has(tx.transactionType)) return { icon: ArrowDownLeft, tone: "green", sign: "+", amountTone: "green" };
  if (MONEY_OUT.has(tx.transactionType)) return { icon: ArrowUpRight, tone: "red", sign: "−", amountTone: "red" };
  return { icon: ReceiptText, tone: "neutral", sign: "" };
}

/** What an entry is: "Rent received", "Tiffin payment", "Other receipt"… */
function typeLabel(tx: FinancialTransaction): string {
  if (tx.transactionType === "TIFFIN_PAYMENT" && tx.category === "OTHER_RECEIPT") return "Other receipt";
  return TYPE_LABEL[tx.transactionType] || "";
}

function txParty(tx: FinancialTransaction) {
  return tx.residentName || tx.customerName || tx.payeeVendor || typeLabel(tx) || "Entry";
}

function isPgTx(tx: FinancialTransaction) {
  return Boolean(
    tx.residentId ||
      ["RENT_PAYMENT", "SECURITY_DEPOSIT", "DEPOSIT_REFUND", "RENT_CHARGE"].includes(tx.transactionType) ||
      (tx.transactionType === "EXPENSE" && !["GROCERY", "KITCHEN_SUPPLIES", "LPG"].includes(tx.category))
  );
}
function isTiffinTx(tx: FinancialTransaction) {
  return Boolean(
    tx.customerId ||
      ["TIFFIN_PAYMENT", "TIFFIN_CHARGE"].includes(tx.transactionType) ||
      (tx.transactionType === "EXPENSE" && ["GROCERY", "KITCHEN_SUPPLIES", "LPG"].includes(tx.category))
  );
}

export function CashbookMobile({
  summary,
  transactions,
  isLoading,
  startDate,
  endDate,
  onRange,
  onPay,
  onExpense,
  onDeposit,
  onExport,
  onReceipt,
  onReverse,
  onOwed,
}: {
  summary: CashbookSummary | null;
  transactions: FinancialTransaction[];
  isLoading: boolean;
  startDate: string;
  endDate: string;
  onRange: (start: string, end: string) => void;
  onPay: () => void;
  onExpense: () => void;
  onDeposit: () => void;
  onExport: () => void;
  onReceipt: (tx: FinancialTransaction) => void;
  onReverse?: (tx: FinancialTransaction) => void;
  onOwed: () => void;
}) {
  const today = toLocalDateString();
  const firstOfMonth = getLocalFirstDayOfMonth();
  const thirty = getLocalDaysAgo(30);
  const period: Period =
    startDate === firstOfMonth && endDate === today ? "MONTH" : startDate === thirty && endDate === today ? "30" : startDate === "2026-01-01" && endDate === today ? "ALL" : "CUSTOM";
  const [datesOpen, setDatesOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [from, setFrom] = useState(startDate);
  const [to, setTo] = useState(endDate);
  const choosePeriod = (p: Period) => {
    if (p === "MONTH") onRange(firstOfMonth, today);
    else if (p === "30") onRange(thirty, today);
    else if (p === "ALL") onRange("2026-01-01", today);
    else {
      setFrom(startDate);
      setTo(endDate);
      setDatesOpen(true);
    }
  };

  const [search, setSearch] = useState("");
  const q = React.useDeferredValue(search.trim().toLowerCase());
  const [kind, setKind] = useState<Kind>("ALL");
  const [division, setDivision] = useState<Division>("ALL");
  const [method, setMethod] = useState<Method>("ALL");
  const [status, setStatus] = useState<TxStatus>("ALL");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shown, setShown] = useState(40);
  const [openTx, setOpenTx] = useState<FinancialTransaction | null>(null);
  const filterCount = [kind !== "ALL", division !== "ALL", method !== "ALL", status !== "ALL"].filter(Boolean).length;

  const filtered = useMemo(
    () =>
      transactions.filter((tx) => {
        if (division === "PG" && !isPgTx(tx)) return false;
        if (division === "TIFFIN" && !isTiffinTx(tx)) return false;
        if (kind === "IN" && !MONEY_IN.has(tx.transactionType)) return false;
        if (kind === "OUT" && !MONEY_OUT.has(tx.transactionType)) return false;
        if (kind === "CHARGE" && !CHARGES.has(tx.transactionType)) return false;
        if (kind === "REVERSAL" && tx.transactionType !== "REVERSAL") return false;
        if (method !== "ALL" && (tx.paymentMethod ? tryNormalizePaymentMethod(tx.paymentMethod) : null) !== method) return false;
        if (status !== "ALL" && tx.status !== status) return false;
        if (q) {
          const hay = [tx.residentName, tx.customerName, tx.payeeVendor, tx.description, tx.referenceNumber, tx.roomNumber, tx.billingPeriod].join(" ").toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [transactions, division, kind, method, status, q]
  );
  React.useEffect(() => setShown(40), [division, kind, method, status, q, startDate, endDate]);
  const days = useMemo(() => groupByDay(filtered.slice(0, shown), (t) => t.transactionDate), [filtered, shown]);

  const b = summary?.breakdown;
  const net = summary?.netCashMovementExact ?? summary?.netCashMovement ?? 0;
  // Money in: what was received. Money out: expenses and refunds of earlier receipts.
  const moneyIn = b ? b.rentReceipts + b.tiffinReceipts : (summary?.totalRentCollected ?? 0) + (summary?.totalTiffinCollected ?? 0);
  const moneyOut = b ? b.expensesPaid - b.expenseRefunds + b.rentRefunds + b.tiffinRefunds : summary?.totalExpensesPaid ?? 0;
  const periodName = period === "MONTH" ? "this month" : period === "30" ? "last 30 days" : period === "ALL" ? "all time" : `${startDate} – ${endDate}`;
  const figure = (v: number, signed = false) => (isLoading && !summary ? "—" : formatMoney(v, signed ? { signed: true } : undefined));

  return (
    <MStack>
      <MHero
        label={<>Net cash · {periodName}</>}
        action={
          <button type="button" onClick={() => setPeriodOpen(true)} aria-label="Choose the period" className="m-hero-icon m-press">
            <CalendarDays className="w-[18px] h-[18px]" />
          </button>
        }
        value={figure(net, net !== 0)}
        items={[
          { label: "Money in", value: figure(moneyIn) },
          { label: "Money out", value: figure(moneyOut) },
          { label: "Deposits held", value: figure(summary?.totalDepositsCollected ?? 0) },
          { label: "Rent owed", value: figure(summary?.totalOutstandingRent ?? 0), onClick: onOwed },
        ]}
      />

      <MQuick
        items={[
          { label: "Receive", icon: CreditCard, onClick: onPay, tone: "green" },
          { label: "Expense", icon: TrendingDown, onClick: onExpense, tone: "red" },
          { label: "Deposit", icon: Wallet, onClick: onDeposit, tone: "amber" },
          { label: "More", icon: MoreHorizontal, onClick: () => setMoreOpen(true), tone: "neutral" },
        ]}
      />

      <MSearch value={search} onChange={setSearch} placeholder="Search name, room or note" onFilter={() => setFiltersOpen(true)} filterCount={filterCount} />

      {isLoading && transactions.length === 0 ? (
        <MSkeletonRows rows={6} />
      ) : filtered.length === 0 ? (
        <MEmpty icon={Receipt} title={transactions.length === 0 ? "Nothing recorded in this period" : "No entries match"}>
          {transactions.length === 0 ? (
            <MButton kind="primary" icon={CreditCard} onClick={onPay}>
              Receive
            </MButton>
          ) : (
            <MButton
              kind="soft"
              onClick={() => {
                setSearch("");
                setKind("ALL");
                setDivision("ALL");
                setMethod("ALL");
                setStatus("ALL");
              }}
            >
              Clear filters
            </MButton>
          )}
        </MEmpty>
      ) : (
        <>
          {days.map((d) => (
            <MSection key={d.day} title={<span className="m-day">{d.label}</span>}>
              <MGroup>
                {d.items.map((tx) => {
                  const look = txLook(tx);
                  const reversed = tx.status === "REVERSED";
                  const where = tx.roomNumber ? `Room ${tx.roomNumber}` : tx.transactionType === "EXPENSE" && tx.category ? plainCategory(tx.category) : "";
                  return (
                    <MRow
                      key={tx.id}
                      icon={look.icon}
                      tone={reversed ? "neutral" : look.tone}
                      title={txParty(tx)}
                      sub={[txParty(tx) === typeLabel(tx) ? "" : typeLabel(tx) || plainCategory(tx.transactionType), tx.paymentMethod ? formatPaymentMethodLabel(tx.paymentMethod) : "", where].filter(Boolean).join(" · ")}
                      right={`${look.sign}${formatMoney(tx.amount)}`}
                      rightTone={reversed ? undefined : look.amountTone}
                      rightSub={reversed ? "Reversed" : undefined}
                      strike={reversed}
                      onClick={() => setOpenTx(tx)}
                      chevron={false}
                    />
                  );
                })}
              </MGroup>
            </MSection>
          ))}
          <MMore shown={shown} total={filtered.length} onMore={() => setShown((s) => s + 40)} step={40} />
        </>
      )}

      {/* One entry */}
      <MSheet
        open={Boolean(openTx)}
        onClose={() => setOpenTx(null)}
        title={openTx ? txParty(openTx) : ""}
        footer={
          openTx ? (
            <>
              {onReverse && openTx.status !== "REVERSED" && openTx.transactionType !== "REVERSAL" && (
                <MButton
                  kind="danger"
                  icon={RotateCcw}
                  onClick={() => {
                    const t = openTx;
                    setOpenTx(null);
                    onReverse(t);
                  }}
                >
                  Reverse
                </MButton>
              )}
              <MButton
                kind="primary"
                icon={Receipt}
                onClick={() => {
                  const t = openTx;
                  setOpenTx(null);
                  onReceipt(t);
                }}
              >
                Receipt
              </MButton>
            </>
          ) : null
        }
      >
        {openTx && (
          <>
            <div className="m-card text-center py-6">
              <p className={`text-[34px] leading-none font-semibold tracking-[-0.02em] tabular-nums ${openTx.status === "REVERSED" ? "line-through text-[var(--m-ink-3)]" : txLook(openTx).amountTone ? `m-text-${txLook(openTx).amountTone}` : "text-[var(--m-ink)]"}`}>
                {txLook(openTx).sign}
                {formatMoney(openTx.amount)}
              </p>
              <div className="mt-3 flex justify-center gap-2 flex-wrap">
                <MPill tone={txLook(openTx).tone}>{typeLabel(openTx) || plainCategory(openTx.transactionType)}</MPill>
                {openTx.status === "REVERSED" && <MPill tone="neutral">Reversed</MPill>}
              </div>
            </div>
            <div className="m-card py-1">
              <MField label="Date">{openTx.transactionDate}</MField>
              {openTx.roomNumber && <MField label="Room">{openTx.roomNumber}</MField>}
              {openTx.paymentMethod && <MField label="Paid by">{formatPaymentMethodLabel(openTx.paymentMethod)}</MField>}
              {openTx.referenceNumber && !/^[a-z]+_[0-9a-f-]{6,}/i.test(openTx.referenceNumber) && <MField label="Reference">{openTx.referenceNumber}</MField>}
              {openTx.billingPeriod && <MField label="For">{openTx.billingPeriod}</MField>}
              {openTx.transactionType === "EXPENSE" && openTx.category && <MField label="Category">{plainCategory(openTx.category)}</MField>}
              {openTx.description && <MField label="Note">{readableNote(openTx.description)}</MField>}
            </div>
          </>
        )}
      </MSheet>

      {/* Filters */}
      <MSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <>
            <MButton
              kind="soft"
              onClick={() => {
                setKind("ALL");
                setDivision("ALL");
                setMethod("ALL");
                setStatus("ALL");
              }}
            >
              Clear
            </MButton>
            <MButton kind="primary" onClick={() => setFiltersOpen(false)}>
              Show {filtered.length}
            </MButton>
          </>
        }
      >
        <p className="m-sheet-label">Part of the business</p>
        <MChips label="Part of the business" value={division} onChange={setDivision} options={[{ value: "ALL", label: "All" }, { value: "PG", label: "PG" }, { value: "TIFFIN", label: "Tiffin" }]} />
        <p className="m-sheet-label">Kind</p>
        <MChips
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: "ALL", label: "All" },
            { value: "IN", label: "Money in" },
            { value: "OUT", label: "Money out" },
            { value: "CHARGE", label: "Charges" },
            { value: "REVERSAL", label: "Reversals" },
          ]}
        />
        <p className="m-sheet-label">Paid by</p>
        <MChips
          label="Paid by"
          value={method}
          onChange={setMethod}
          options={[
            { value: "ALL", label: "All" },
            { value: "CASH", label: "Cash" },
            { value: "UPI", label: "UPI" },
            { value: "BANK_TRANSFER", label: "Bank" },
            { value: "CHEQUE", label: "Cheque" },
            { value: "OTHER", label: "Other" },
          ]}
        />
        <p className="m-sheet-label">Status</p>
        <MChips label="Status" value={status} onChange={setStatus} options={[{ value: "ALL", label: "All" }, { value: "POSTED", label: "Posted" }, { value: "REVERSED", label: "Reversed" }]} />
      </MSheet>

      {/* Other entries */}
      <MSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Add or export">
        <MGroup>
          <MRow
            icon={Download}
            tone="blue"
            title="Export (CSV)"
            onClick={() => {
              setMoreOpen(false);
              onExport();
            }}
          />
        </MGroup>
      </MSheet>

      {/* Period */}
      <MSheet open={periodOpen} onClose={() => setPeriodOpen(false)} title="Period">
        <MGroup>
          {([
            ["MONTH", "This month"],
            ["30", "Last 30 days"],
            ["ALL", "All time"],
            ["CUSTOM", "Choose dates"],
          ] as Array<[Period, string]>).map(([p, label]) => (
            <MRow
              key={p}
              icon={CalendarDays}
              tone={period === p ? "accent" : "neutral"}
              title={label}
              rightSub={period === p ? "Showing" : undefined}
              chevron={false}
              onClick={() => {
                setPeriodOpen(false);
                choosePeriod(p);
              }}
            />
          ))}
        </MGroup>
      </MSheet>

      {/* Own dates */}
      <MSheet
        open={datesOpen}
        onClose={() => setDatesOpen(false)}
        title="Dates"
        footer={
          <MButton
            kind="primary"
            icon={CalendarDays}
            disabled={!from || !to || from > to}
            onClick={() => {
              onRange(from, to);
              setDatesOpen(false);
            }}
          >
            Show these dates
          </MButton>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className="m-sheet-label">From</span>
          <input type="date" className="m-input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="m-sheet-label">To</span>
          <input type="date" className="m-input" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
        </label>
      </MSheet>
    </MStack>
  );
}
