"use client";

import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Pencil, Receipt, Search, X } from "lucide-react";
import type { CashbookSummary, FinancialTransaction } from "@/types";
import { formatPaymentMethodLabel, tryNormalizePaymentMethod } from "@/types";
import { formatMoney, readableNote } from "@/lib/format";
import { Segmented, StatStrip } from "@/components/ui/kit";
import { AppSelect } from "@/components/forms/AppSelect";
import { SkeletonRows, StateMessage } from "@/components/ui/states";
import { hasReceipt } from "@/modules/billing/ReceiptViewer";
import { canEditEntry } from "./EntryForms";
import { formatIndianDate } from "../utils/dateUtils";
import { CHARGES, MONEY_IN, MONEY_OUT, isPgTx, isTiffinTx, plainCategory, txLook, txParty, typeLabel } from "../mobile/FinanceMobile";

type Flow = "ALL" | "IN" | "OUT";
type Kind = "ALL" | "CHARGE" | "REVERSAL";
type Division = "ALL" | "PG" | "TIFFIN";
type Method = "ALL" | "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";

const STEP = 60;

/**
 * The cashbook on a laptop: the same figures, switch and filters as the phone app, with the entries
 * in a table. Receive, Expense, Deposit and the CSV are in the page header.
 */
export function CashbookDesktop({
  summary,
  transactions,
  isLoading,
  onReceipt,
  onEdit,
}: {
  summary: CashbookSummary | null;
  transactions: FinancialTransaction[];
  isLoading: boolean;
  onReceipt: (tx: FinancialTransaction) => void;
  onEdit: (tx: FinancialTransaction) => void;
}) {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim().toLowerCase());
  const [flow, setFlow] = useState<Flow>("ALL");
  const [kind, setKind] = useState<Kind>("ALL");
  const [division, setDivision] = useState<Division>("ALL");
  const [method, setMethod] = useState<Method>("ALL");
  const [shown, setShown] = useState(STEP);

  const filtered = useMemo(
    () =>
      transactions.filter((tx) => {
        if (division === "PG" && !isPgTx(tx)) return false;
        if (division === "TIFFIN" && !isTiffinTx(tx)) return false;
        if (flow === "IN" && !MONEY_IN.has(tx.transactionType)) return false;
        if (flow === "OUT" && !MONEY_OUT.has(tx.transactionType)) return false;
        if (kind === "CHARGE" && !CHARGES.has(tx.transactionType)) return false;
        if (kind === "REVERSAL" && tx.transactionType !== "REVERSAL") return false;
        if (method !== "ALL" && (tx.paymentMethod ? tryNormalizePaymentMethod(tx.paymentMethod) : null) !== method) return false;
        if (q) {
          const hay = [tx.residentName, tx.customerName, tx.payeeVendor, tx.description, tx.referenceNumber, tx.roomNumber, tx.billingPeriod].join(" ").toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      }),
    [transactions, division, flow, kind, method, q]
  );
  useEffect(() => setShown(STEP), [division, flow, kind, method, q, transactions]);

  const b = summary?.breakdown;
  const net = summary?.netCashMovementExact ?? summary?.netCashMovement ?? 0;
  const moneyIn = b ? b.rentReceipts + b.tiffinReceipts : (summary?.totalRentCollected ?? 0) + (summary?.totalTiffinCollected ?? 0);
  const moneyOut = b ? b.expensesPaid - b.expenseRefunds + b.rentRefunds + b.tiffinRefunds : summary?.totalExpensesPaid ?? 0;
  // Money given back for earlier receipts (part of Money out), shown on its own when there is any.
  const refunds = b ? b.rentRefunds + b.tiffinRefunds : 0;
  const figure = (v: number, signed = false) => (isLoading && !summary ? "—" : formatMoney(v, signed ? { signed: true } : undefined));
  const owed = summary?.totalOutstandingRent ?? 0;
  const filtersOn = flow !== "ALL" || kind !== "ALL" || division !== "ALL" || method !== "ALL" || search.trim() !== "";
  const clear = () => {
    setSearch("");
    setFlow("ALL");
    setKind("ALL");
    setDivision("ALL");
    setMethod("ALL");
  };

  return (
    <div className="space-y-5 min-w-0">
      <StatStrip
        items={[
          { label: "Net cash", value: figure(net, net !== 0), tone: net < 0 ? "bad" : "default" },
          { label: "Money in", value: figure(moneyIn) },
          { label: "Money out", value: figure(moneyOut), note: refunds > 0 ? `refunds ${formatMoney(-refunds)}` : undefined },
          { label: "Deposits held", value: figure(summary?.totalDepositsCollected ?? 0) },
          { label: "Rent owed", value: figure(owed), tone: owed > 0 ? "warn" : "default", href: "/finance?tab=receivables" },
        ]}
      />

      <section className="rn-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-[var(--rn-line)]">
          <label className="relative flex-[3_1_200px] min-w-[190px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--rn-ink-3)] pointer-events-none" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, room or note"
              aria-label="Search the cashbook"
              className="rn-input w-full !pl-10 !pr-9"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear the search" className="absolute right-2.5 top-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-full text-[var(--rn-ink-3)] hover:text-[var(--rn-ink)]">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </label>
          <Segmented
            label="Show"
            size="sm"
            value={flow}
            onChange={setFlow}
            options={[
              { value: "ALL", label: "All" },
              { value: "IN", label: "Received" },
              { value: "OUT", label: "Expenses" },
            ]}
          />
          <AppSelect value={division} onChange={(e) => setDivision(e.target.value as Division)} aria-label="Part of the business" className="rn-input !w-auto flex-[1_1_128px] min-w-[128px] max-w-[170px]">
            <option value="ALL">PG &amp; Tiffin</option>
            <option value="PG">PG</option>
            <option value="TIFFIN">Tiffin</option>
          </AppSelect>
          <AppSelect value={method} onChange={(e) => setMethod(e.target.value as Method)} aria-label="Paid by" className="rn-input !w-auto flex-[1_1_128px] min-w-[128px] max-w-[170px]">
            <option value="ALL">Any method</option>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="BANK_TRANSFER">Bank</option>
            <option value="CHEQUE">Cheque</option>
            <option value="OTHER">Other</option>
          </AppSelect>
          <AppSelect value={kind} onChange={(e) => setKind(e.target.value as Kind)} aria-label="Kind of entry" className="rn-input !w-auto flex-[1_1_128px] min-w-[128px] max-w-[170px]">
            <option value="ALL">All kinds</option>
            <option value="CHARGE">Charges</option>
            <option value="REVERSAL">Reversals</option>
          </AppSelect>
          <span className="ml-auto shrink-0 text-[13px] tabular-nums text-[var(--rn-ink-2)]" data-testid="cashbook-count">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {isLoading && transactions.length === 0 ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : filtered.length === 0 ? (
          <StateMessage
            kind="empty"
            title={transactions.length === 0 ? "Nothing recorded in this period" : "No entries match"}
            action={
              filtersOn && transactions.length > 0 ? (
                <button type="button" className="rn-btn rn-btn-sm" onClick={clear}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <table className="rn-cash-table w-full text-left">
              <colgroup>
                <col style={{ width: "13%" }} />
                <col style={{ width: "27%" }} />
                <col style={{ width: "14%" }} />
                <col />
                <col style={{ width: "14%" }} />
                <col style={{ width: "96px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Entry</th>
                  <th>Paid by</th>
                  <th>Note</th>
                  <th className="!text-right">Amount</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, shown).map((tx) => {
                  const look = txLook(tx);
                  const reversed = tx.status === "REVERSED";
                  const party = txParty(tx);
                  const type = typeLabel(tx) || plainCategory(tx.transactionType);
                  const where = tx.roomNumber ? `Room ${tx.roomNumber}` : tx.transactionType === "EXPENSE" && tx.category ? plainCategory(tx.category) : "";
                  const sub = [party === type ? "" : type, where].filter(Boolean).join(" · ");
                  const note = tx.description ? readableNote(tx.description) : tx.billingPeriod || "";
                  const tone = reversed ? "" : look.amountTone === "green" ? "text-[#2F6B24]" : look.amountTone === "red" ? "text-[#9A3423]" : "";
                  return (
                    <tr key={tx.id}>
                      <td className="tabular-nums text-[var(--rn-ink-2)]">{formatIndianDate(tx.transactionDate)}</td>
                      <td>
                        <span className={`block font-medium text-[var(--rn-ink)] truncate ${reversed ? "line-through opacity-60" : ""}`}>{party}</span>
                        {sub && <span className="block text-[12.5px] text-[var(--rn-ink-3)] truncate">{sub}</span>}
                      </td>
                      <td className="text-[var(--rn-ink-2)]">{tx.paymentMethod ? formatPaymentMethodLabel(tx.paymentMethod) : "—"}</td>
                      <td className="text-[var(--rn-ink-2)]">
                        <span className="block truncate" title={note || undefined}>
                          {note || "—"}
                        </span>
                      </td>
                      <td className={`!text-right tabular-nums font-semibold ${tone} ${reversed ? "line-through opacity-60" : ""}`}>
                        {look.sign}
                        {formatMoney(tx.amount)}
                        {reversed && <span className="block text-[11.5px] font-normal no-underline text-[var(--rn-ink-3)]">Reversed</span>}
                      </td>
                      <td>
                        <span className="flex items-center justify-end gap-1.5">
                          {hasReceipt(tx) && (
                            <button type="button" onClick={() => onReceipt(tx)} className="rn-btn rn-btn-sm rn-btn-icon" aria-label={`Receipt for ${party}`} title="Receipt">
                              <Receipt />
                            </button>
                          )}
                          {canEditEntry(tx) && (
                            <button type="button" onClick={() => onEdit(tx)} className="rn-btn rn-btn-sm rn-btn-icon" aria-label={`Edit the entry for ${party}`} title="Edit">
                              <Pencil />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > shown && (
              <div className="p-3 text-center border-t border-[var(--rn-line)]">
                <button type="button" className="rn-btn rn-btn-sm" onClick={() => setShown((s) => s + STEP)}>
                  Show more ({filtered.length - shown})
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
