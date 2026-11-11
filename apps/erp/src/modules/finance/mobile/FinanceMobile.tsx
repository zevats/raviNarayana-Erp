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
import { AccountSheet } from "../components/ReceivablesView";

export type FinanceTab = "cashbook" | "receivables" | "residents" | "invoices" | "closing";

const PLACES: Array<{ value: FinanceTab; label: string; icon: React.ElementType }> = [
  { value: "cashbook", label: "Cashbook", icon: BookOpenText },
  { value: "receivables", label: "Owed", icon: HandCoins },
  { value: "residents", label: "Dues", icon: Wallet },
  { value: "invoices", label: "Invoices", icon: FileText },
  { value: "closing", label: "Closing", icon: LockKeyhole },
];

/** The five finance places in one row. */
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

function txParty(tx: FinancialTransaction) {
  return tx.residentName || tx.customerName || tx.payeeVendor || TYPE_LABEL[tx.transactionType] || "Entry";
}

function isPgTx(tx: FinancialTransaction) {
  return Boolean(
    tx.residentId ||
      ["RENT_PAYMENT", "SECURITY_DEPOSIT", "DEPOSIT_REFUND", "RENT_CHARGE"].includes(tx.transactionType) ||
      (tx.transactionType === "EXPENSE" && !["GROCERY", "KITCHEN_SUPPLIES"].includes(tx.category))
  );
}
function isTiffinTx(tx: FinancialTransaction) {
  return Boolean(
    tx.customerId ||
      ["TIFFIN_PAYMENT", "TIFFIN_CHARGE"].includes(tx.transactionType) ||
      (tx.transactionType === "EXPENSE" && ["GROCERY", "KITCHEN_SUPPLIES"].includes(tx.category))
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
  onCharge,
  onRentRun,
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
  onCharge: () => void;
  onRentRun?: () => void;
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
      <MSegment
        label="Period"
        value={period}
        onChange={choosePeriod}
        options={[
          { value: "MONTH", label: "Month" },
          { value: "30", label: "30 days" },
          { value: "ALL", label: "All" },
          { value: "CUSTOM", label: period === "CUSTOM" ? "Dates ✓" : "Dates" },
        ]}
      />

      <MHero
        label={<>Net cash · {periodName}</>}
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
          { label: "Payment", icon: CreditCard, onClick: onPay, tone: "green" },
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
              Record payment
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
                      sub={[txParty(tx) === TYPE_LABEL[tx.transactionType] ? "" : TYPE_LABEL[tx.transactionType] || plainCategory(tx.transactionType), tx.paymentMethod ? formatPaymentMethodLabel(tx.paymentMethod) : "", where].filter(Boolean).join(" · ")}
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
                <MPill tone={txLook(openTx).tone}>{TYPE_LABEL[openTx.transactionType] || plainCategory(openTx.transactionType)}</MPill>
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
          {onRentRun && (
            <MRow
              icon={CalendarClock}
              tone="accent"
              title="Monthly rent"
              onClick={() => {
                setMoreOpen(false);
                onRentRun();
              }}
            />
          )}
          <MRow
            icon={Receipt}
            tone="amber"
            title="Rent charge"
            onClick={() => {
              setMoreOpen(false);
              onCharge();
            }}
          />
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

/* ================================================================== Receivables */

interface RecAccount {
  accountKey: string;
  kind: "RESIDENT" | "CUSTOMER" | "ORDER";
  name: string;
  phone: string | null;
  place: string | null;
  pg: number;
  tiffin: number;
  delivery: number;
  total: number;
  oldestDate: string | null;
  ageDays: number | null;
  partiallyPaid: boolean;
  openItems: number;
  reviews: number;
  payLaterEnabled: boolean | null;
}
interface RecList {
  summary: {
    total: number;
    bySource: { PG: number; TIFFIN: number; DELIVERY: number };
    ageing: Record<"0_7" | "8_30" | "31_60" | "61_PLUS", number>;
    unallocatedCredit: number;
    accountsOwing: number;
    reviews: number;
  };
  accounts: RecAccount[];
  total: number;
}
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load.");
  return data as T;
}
const ageTone = (d: number | null): MTone => ((d ?? 0) > 60 ? "red" : (d ?? 0) > 30 ? "amber" : "neutral");
const daysText = (n: number | null) => (n === null ? "" : n === 0 ? "today" : `${n} day${n === 1 ? "" : "s"}`);

export function ReceivablesMobile({ initialReviewOnly = false }: { initialReviewOnly?: boolean }) {
  const [source, setSource] = useState<"ALL" | "PG" | "TIFFIN" | "DELIVERY">("ALL");
  const [bucket, setBucket] = useState<"ALL" | "0_7" | "8_30" | "31_60" | "61_PLUS">("ALL");
  const [status, setStatus] = useState<"ALL" | "UNPAID" | "PARTIALLY_PAID">("ALL");
  const [reviewOnly, setReviewOnly] = useState(initialReviewOnly);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 300);
  const [limit, setLimit] = useState(30);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  React.useEffect(() => setLimit(30), [source, bucket, status, reviewOnly, from, to, q]);
  const url = useMemo(() => {
    const p = new URLSearchParams({ source, status, bucket, limit: String(limit), offset: "0" });
    if (q) p.set("q", q);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (reviewOnly) p.set("review", "1");
    return `/api/finance/receivables?${p.toString()}`;
  }, [source, status, bucket, reviewOnly, from, to, q, limit]);
  const list = useErpQuery<RecList>(url, () => getJson<RecList>(url), { tags: ["finance", "receivables", "delivery", "tiffin"], ttl: 15000 });
  const d = list.data;
  const s = d?.summary;
  const filterCount = [status !== "ALL", reviewOnly, Boolean(from || to)].filter(Boolean).length;
  const clear = () => {
    setSource("ALL");
    setBucket("ALL");
    setStatus("ALL");
    setReviewOnly(false);
    setFrom("");
    setTo("");
    setSearch("");
  };
  const money = (v: number | undefined) => (s ? formatMoney(v ?? 0) : "—");

  return (
    <MStack>
      <MHero
        label="Owed to you"
        value={money(s?.total)}
        note={s ? `${s.accountsOwing} account${s.accountsOwing === 1 ? "" : "s"}${s.unallocatedCredit ? ` · advance ${formatMoney(s.unallocatedCredit)}` : ""}` : undefined}
        items={[
          { label: "PG rent", value: money(s?.bySource.PG), onClick: () => setSource("PG") },
          { label: "Tiffin", value: money(s?.bySource.TIFFIN), onClick: () => setSource("TIFFIN") },
          { label: "Delivery", value: money(s?.bySource.DELIVERY), onClick: () => setSource("DELIVERY") },
        ]}
      />
      {s && s.reviews > 0 && !reviewOnly && (
        <button type="button" onClick={() => setReviewOnly(true)} className="m-notice m-notice-red m-press text-left">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            {s.reviews} unpaid deliver{s.reviews === 1 ? "y" : "ies"} to review
          </span>
        </button>
      )}
      <MSegment
        label="Source"
        value={source}
        onChange={setSource}
        options={[
          { value: "ALL", label: "All" },
          { value: "PG", label: "PG" },
          { value: "TIFFIN", label: "Tiffin" },
          { value: "DELIVERY", label: "Delivery" },
        ]}
      />
      <MSegment
        label="Owed for"
        value={bucket}
        onChange={setBucket}
        options={[
          { value: "ALL", label: "Any" },
          { value: "0_7", label: "0–7" },
          { value: "8_30", label: "8–30" },
          { value: "31_60", label: "31–60" },
          { value: "61_PLUS", label: "60+" },
        ]}
      />
      <MSearch value={search} onChange={setSearch} placeholder="Search name, phone or room" onFilter={() => setFiltersOpen(true)} filterCount={filterCount} />

      {list.error && !d ? (
        <MEmpty icon={AlertTriangle} title="Could not load">
          <MButton kind="soft" onClick={() => list.refetch()}>
            Try again
          </MButton>
        </MEmpty>
      ) : !d ? (
        <MSkeletonRows rows={6} />
      ) : d.accounts.length === 0 ? (
        <MEmpty icon={HandCoins} title={filterCount || source !== "ALL" || bucket !== "ALL" || q ? "No accounts match" : "Nothing outstanding"}>
          {(filterCount > 0 || source !== "ALL" || bucket !== "ALL" || Boolean(q)) && (
            <MButton kind="soft" onClick={clear}>
              Clear filters
            </MButton>
          )}
        </MEmpty>
      ) : (
        <>
          <MGroup>
            {d.accounts.map((a) => (
              <MRow
                key={a.accountKey}
                avatar={initials(a.name)}
                tone={ageTone(a.ageDays)}
                title={a.name}
                sub={[a.place, a.reviews > 0 ? "to review" : a.partiallyPaid ? "partly paid" : "", daysText(a.ageDays)].filter(Boolean).join(" · ")}
                right={formatMoney(a.total)}
                rightTone={a.total < 0 ? "green" : undefined}
                onClick={() => setOpen(a.accountKey)}
              />
            ))}
          </MGroup>
          <MMore shown={d.accounts.length} total={d.total} onMore={() => setLimit((l) => l + 30)} />
        </>
      )}

      <MSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <>
            <MButton
              kind="soft"
              onClick={() => {
                setStatus("ALL");
                setReviewOnly(false);
                setFrom("");
                setTo("");
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
        <p className="m-sheet-label">Payment</p>
        <MChips label="Payment" value={status} onChange={setStatus} options={[{ value: "ALL", label: "All" }, { value: "UNPAID", label: "Unpaid" }, { value: "PARTIALLY_PAID", label: "Partly paid" }]} />
        <p className="m-sheet-label">Unpaid deliveries</p>
        <MChips label="Unpaid deliveries" value={reviewOnly ? "YES" : "NO"} onChange={(v) => setReviewOnly(v === "YES")} options={[{ value: "NO", label: "All" }, { value: "YES", label: "Only to review" }]} />
        <p className="m-sheet-label">Owed since</p>
        <div className="grid grid-cols-2 gap-2.5">
          <input type="date" className="m-input" aria-label="From" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          <input type="date" className="m-input" aria-label="To" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
      </MSheet>

      <AccountSheet accountKey={open} onClose={() => setOpen(null)} />
    </MStack>
  );
}

/* ================================================================== Resident dues */

export function DuesMobile({ residents, isLoading }: { residents: ResidentListItem[]; isLoading: boolean }) {
  const [view, setView] = useState<"OWING" | "ALL">("OWING");
  const [search, setSearch] = useState("");
  const q = React.useDeferredValue(search.trim().toLowerCase());
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(40);
  const url = "/api/finance/receivables?source=PG&status=ALL&bucket=ALL&limit=500&offset=0";
  const owing = useErpQuery<RecList>(url, () => getJson<RecList>(url), { tags: ["finance", "receivables"], ttl: 15000 });
  const owedById = useMemo(() => {
    const m = new Map<string, RecAccount>();
    for (const a of owing.data?.accounts ?? []) if (a.accountKey.startsWith("R")) m.set(a.accountKey.slice(2), a);
    return m;
  }, [owing.data]);
  const inHouse = residents.filter((r) => r.status === "ACTIVE").length;
  const matches = (name: string, extra: string) => !q || `${name} ${extra}`.toLowerCase().includes(q);
  const owingList = (owing.data?.accounts ?? []).filter((a) => a.accountKey.startsWith("R") && a.total > 0 && matches(a.name, `${a.place ?? ""} ${a.phone ?? ""}`));
  const allList = residents
    .filter((r) => matches(r.fullName, `${r.currentRoomNumber ?? ""} ${r.phone ?? ""}`))
    .sort((x, y) => (owedById.get(y.id)?.total ?? 0) - (owedById.get(x.id)?.total ?? 0) || x.fullName.localeCompare(y.fullName));
  React.useEffect(() => setShown(40), [view, q]);
  const total = owing.data?.summary.bySource.PG;

  return (
    <MStack>
      <MHero
        label="Rent owed by residents"
        value={total === undefined ? "—" : formatMoney(total)}
        items={[
          { label: "Owing", value: owing.data ? String(owingList.length || owing.data.summary.accountsOwing) : "—", onClick: () => setView("OWING") },
          { label: "In house", value: isLoading ? "—" : String(inHouse), onClick: () => setView("ALL") },
        ]}
      />
      <MSegment
        label="Show"
        value={view}
        onChange={setView}
        options={[
          { value: "OWING", label: "Owing" },
          { value: "ALL", label: "All residents" },
        ]}
      />
      <MSearch value={search} onChange={setSearch} placeholder="Search name, room or phone" />
      {view === "OWING" ? (
        !owing.data ? (
          <MSkeletonRows rows={5} />
        ) : owingList.length === 0 ? (
          <MEmpty icon={Wallet} title={q ? "No one matches" : "No rent owed"} />
        ) : (
          <MGroup>
            {owingList.map((a) => (
              <MRow
                key={a.accountKey}
                avatar={initials(a.name)}
                tone={ageTone(a.ageDays)}
                title={a.name}
                sub={[a.place ? `Room ${a.place}` : "", daysText(a.ageDays)].filter(Boolean).join(" · ")}
                right={formatMoney(a.total)}
                onClick={() => setOpen(a.accountKey)}
              />
            ))}
          </MGroup>
        )
      ) : isLoading && residents.length === 0 ? (
        <MSkeletonRows rows={6} />
      ) : allList.length === 0 ? (
        <MEmpty icon={Users} title="No residents match" />
      ) : (
        <>
          <MGroup>
            {allList.slice(0, shown).map((r) => {
              const owed = owedById.get(r.id)?.total ?? 0;
              return (
                <MRow
                  key={r.id}
                  avatar={initials(r.fullName)}
                  tone={r.status === "ACTIVE" ? "accent" : "neutral"}
                  title={r.fullName}
                  sub={[r.currentRoomNumber ? `Room ${r.currentRoomNumber}` : "", r.status === "ACTIVE" ? "In house" : r.status === "CHECKED_OUT" ? "Checked out" : ""].filter(Boolean).join(" · ")}
                  right={owed > 0 ? formatMoney(owed) : owed < 0 ? formatMoney(owed) : "Settled"}
                  rightTone={owed > 0 ? undefined : "green"}
                  onClick={() => setOpen(`R:${r.id}`)}
                />
              );
            })}
          </MGroup>
          <MMore shown={shown} total={allList.length} onMore={() => setShown((s) => s + 40)} step={40} />
        </>
      )}
      {/* Balances, statement and Receive payment for the resident. */}
      <AccountSheet accountKey={open} onClose={() => setOpen(null)} />
    </MStack>
  );
}
