"use client";

import { Pencil } from "lucide-react";
import { Segmented } from "@/components/ui/kit";
import { canEditEntry } from "./EntryForms";
import { readableNote } from "@/lib/format";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useMemo } from "react";
import {
  Search,
  Receipt,
  RotateCcw,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Wallet,
  AlertCircle,
} from "lucide-react";
import {
  FinancialTransaction,
  formatPaymentMethodLabel,
  tryNormalizePaymentMethod,
} from "@/types";
import { formatINRWithSign } from "../utils/formatUtils";
import { BikeLoader } from "@/components/feedback/BikeLoader";

interface CashbookLedgerProps {
  transactions: FinancialTransaction[];
  isLoading: boolean;
  onViewReceipt: (tx: FinancialTransaction) => void;
  /** Omitted for users without finance.manage: reversals are Owner-only. */
  onInitiateReversal?: (tx: FinancialTransaction) => void;
  /** Edit a received payment or an expense. */
  onEdit?: (tx: FinancialTransaction) => void;
  onOpenPayment: () => void;
  onOpenDeposit: () => void;
  onOpenExpense: () => void;
}

const ITEMS_PER_PAGE = 15;

/** Category codes as words (TIFFIN_DELIVERY_COLLECTION -> Tiffin delivery collection). */
const plainCategory = (c: string) => {
  const s = String(c || "").replace(/_/g, " ").toLowerCase().trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

export function CashbookLedger({
  transactions,
  isLoading,
  onViewReceipt,
  onInitiateReversal,
  onEdit,
  onOpenPayment,
}: CashbookLedgerProps) {
  // Received / Expenses: money in and money out on their own, the way people look for them.
  const [flow, setFlow] = useState<"ALL" | "IN" | "OUT">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  // The box updates at once; the (up to 500-row) list follows without blocking typing.
  const deferredQuery = React.useDeferredValue(searchQuery);
  const [divisionFilter, setDivisionFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [methodFilter, setMethodFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filtered transactions
  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      // Division filter
      if (divisionFilter === "PG") {
        const isPg = Boolean(
          tx.residentId ||
          ["RENT_PAYMENT", "SECURITY_DEPOSIT", "DEPOSIT_REFUND", "RENT_CHARGE"].includes(tx.transactionType) ||
          (tx.transactionType === "EXPENSE" && !["GROCERY", "KITCHEN_SUPPLIES", "LPG"].includes(tx.category))
        );
        if (!isPg) return false;
      } else if (divisionFilter === "TIFFIN") {
        const isTiffin = Boolean(
          tx.customerId ||
          ["TIFFIN_PAYMENT", "TIFFIN_CHARGE"].includes(tx.transactionType) ||
          (tx.transactionType === "EXPENSE" && ["GROCERY", "KITCHEN_SUPPLIES", "LPG"].includes(tx.category))
        );
        if (!isTiffin) return false;
      }

      if (flow === "IN" && !["RENT_PAYMENT", "SECURITY_DEPOSIT", "TIFFIN_PAYMENT"].includes(tx.transactionType)) return false;
      if (flow === "OUT" && !["EXPENSE", "DEPOSIT_REFUND"].includes(tx.transactionType)) return false;
      // Type filter
      if (typeFilter !== "ALL" && tx.transactionType !== typeFilter) {
        return false;
      }
      // Method filter
      if (methodFilter !== "ALL") {
        const txNormMethod = tx.paymentMethod ? tryNormalizePaymentMethod(tx.paymentMethod) : null;
        if (txNormMethod !== methodFilter) {
          return false;
        }
      }
      // Status filter
      if (statusFilter !== "ALL" && tx.status !== statusFilter) {
        return false;
      }
      // Search query
      if (deferredQuery.trim()) {
        const q = deferredQuery.toLowerCase().trim();
        const party = (tx.residentName || tx.customerName || tx.payeeVendor || "").toLowerCase();
        const desc = (tx.description || "").toLowerCase();
        const ref = (tx.referenceNumber || "").toLowerCase();
        const room = (tx.roomNumber || "").toLowerCase();
        const period = (tx.billingPeriod || "").toLowerCase();
        const id = tx.id.toLowerCase();

        if (
          !party.includes(q) &&
          !desc.includes(q) &&
          !ref.includes(q) &&
          !room.includes(q) &&
          !period.includes(q) &&
          !id.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [transactions, divisionFilter, typeFilter, methodFilter, statusFilter, deferredQuery, flow]);

  // Reset page when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [divisionFilter, typeFilter, methodFilter, statusFilter, deferredQuery, flow]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [filtered, currentPage]);

  const startIndex = filtered.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1;
  const endIndex = Math.min(currentPage * ITEMS_PER_PAGE, filtered.length);

  // Rows are rebuilt only when the visible page or a row's state changes, not on every keystroke in
  // the search box (the box updates at once; the list follows through the deferred query).
  const mobileRows = useMemo(
    () =>
      paginated.map((tx) => {
                const isPayment = tx.transactionType === "RENT_PAYMENT";
                const isCharge = tx.transactionType === "RENT_CHARGE";
                const isDeposit = tx.transactionType === "SECURITY_DEPOSIT";
                const isTiffinPayment = tx.transactionType === "TIFFIN_PAYMENT";
                const isTiffinCharge = tx.transactionType === "TIFFIN_CHARGE";
                const isExpense = tx.transactionType === "EXPENSE";
                const isReversal = tx.transactionType === "REVERSAL";
                const isReversed = tx.status === "REVERSED";

                const { formatted, isPositive, isNegative } = formatINRWithSign(
                  tx.amount,
                  tx.transactionType,
                  tx.status
                );

                return (
                  <div
                    key={`mobile-${tx.id}`}
                    className={`p-4 space-y-2.5 transition-colors ${
                      isReversed ? "bg-stone-50/70 opacity-75" : "hover:bg-[#FAF8F5]/40"
                    }`}
                  >
                    {/* Top Row: Type Badges & Amount */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isPayment && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <TrendingUp className="w-3 h-3" />
                            <span>Rent Payment</span>
                          </span>
                        )}
                        {isCharge && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FAF8F5] text-[#654735] border border-[#B58A57]/35">
                            <Receipt className="w-3 h-3 text-[#B58A57]" />
                            <span>Rent Charge</span>
                          </span>
                        )}
                        {isDeposit && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                            <Wallet className="w-3 h-3 text-amber-800" />
                            <span>Deposit</span>
                          </span>
                        )}
                        {isTiffinPayment && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-800 border border-teal-200">
                            <TrendingUp className="w-3 h-3" />
                            <span>Tiffin Payment</span>
                          </span>
                        )}
                        {isTiffinCharge && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-900 border border-amber-300">
                            <Receipt className="w-3 h-3 text-amber-800" />
                            <span>Tiffin Charge</span>
                          </span>
                        )}
                        {isExpense && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                            <TrendingDown className="w-3 h-3" />
                            <span>Expense</span>
                          </span>
                        )}
                        {isReversal && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-700 border border-stone-300">
                            <RotateCcw className="w-3 h-3" />
                            <span>Reversal</span>
                          </span>
                        )}
                        {isReversed && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-200 text-stone-600">
                            REVERSED
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-base font-bold tabular-nums font-sans ${
                          isReversed
                            ? "line-through text-stone-400"
                            : isPositive
                            ? "text-emerald-700"
                            : isNegative
                            ? "text-rose-700"
                            : "text-[#1A2E20]"
                        }`}
                      >
                        {formatted}
                      </span>
                    </div>

                    {/* Middle Row: Party / Room & Date */}
                    <div className="flex items-center justify-between text-xs text-[#1A2E20]">
                      <span className="font-semibold truncate max-w-[200px]">
                        {tx.residentName || tx.customerName || tx.payeeVendor || "General Transaction"}
                      </span>
                      <span className="text-[#5A6C5E] text-[11px] font-medium font-sans shrink-0">
                        {tx.transactionDate}
                      </span>
                    </div>

                    {/* Category & Payment Method */}
                    <div className="flex items-center justify-between text-[11px] text-[#5A6C5E]">
                      <span>
                        {tx.roomNumber ? `Room ${tx.roomNumber}` : tx.category ? `${plainCategory(tx.category)}${tx.transactionType === "EXPENSE" ? " expense" : ""}` : "PG"}
                      </span>
                      <span className="font-sans font-medium text-[#1A2E20]">
                        {formatPaymentMethodLabel(tx.paymentMethod)}
                        {tx.referenceNumber && !/^[a-z]+_[0-9a-f-]{6,}/i.test(tx.referenceNumber) ? ` • ${tx.referenceNumber}` : ""}
                      </span>
                    </div>

                    {/* Description if present */}
                    {tx.description && (
                      <p className="text-[11px] text-[#5A6C5E] bg-[#FAF8F5] p-2 rounded-lg border border-[#8E9F89]/15">
                        {readableNote(tx.description)}
                      </p>
                    )}

                    {/* Mobile Action Bar */}
                    <div className="flex items-center justify-end pt-2 border-t border-[#8E9F89]/15 text-xs">

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onViewReceipt(tx)}
                          className="min-h-[36px] px-3 py-1.5 rounded-lg border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs font-medium flex items-center gap-1.5 shadow-2xs"
                        >
                          <Receipt className="w-3.5 h-3.5 text-[#B58A57]" />
                          <span>Receipt</span>
                        </button>
                        {onEdit && canEditEntry(tx) && (
                          <button
                            type="button"
                            onClick={() => onEdit(tx)}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs font-medium flex items-center gap-1.5 shadow-2xs"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </button>
                        )}

                        {onInitiateReversal && !isReversed && !isReversal && (
                          <button
                            type="button"
                            onClick={() => onInitiateReversal?.(tx)}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-medium flex items-center gap-1 shadow-2xs"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reverse</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paginated, copiedId, onViewReceipt, onInitiateReversal, onEdit]
  );
  const tableRows = useMemo(
    () =>
      paginated.map((tx) => {
                    const isPayment = tx.transactionType === "RENT_PAYMENT";
                    const isCharge = tx.transactionType === "RENT_CHARGE";
                    const isDeposit = tx.transactionType === "SECURITY_DEPOSIT";
                    const isTiffinPayment = tx.transactionType === "TIFFIN_PAYMENT";
                    const isTiffinCharge = tx.transactionType === "TIFFIN_CHARGE";
                    const isExpense = tx.transactionType === "EXPENSE";
                    const isReversal = tx.transactionType === "REVERSAL";
                    const isReversed = tx.status === "REVERSED";

                    const { formatted, isPositive, isNegative } = formatINRWithSign(
                      tx.amount,
                      tx.transactionType,
                      tx.status
                    );

                    return (
                      <tr
                        key={tx.id}
                        className={`hover:bg-[#FAF8F5]/60 transition-colors ${
                          isReversed ? "bg-stone-50/70 opacity-75" : ""
                        }`}
                      >
                        {/* 1. Date & ID */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-sans text-xs font-semibold text-[#1A2E20] block">
                            {tx.transactionDate}
                          </span>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-[#6E7F70] font-sans">
                            <span className="truncate max-w-[120px]" title={tx.id}>
                              {tx.id.slice(0, 14)}...
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleCopyId(tx.id, e)}
                              className="p-0.5 rounded hover:bg-stone-200/60 text-[#6E7F70] hover:text-[#1A2E20] transition-colors"
                              title="Copy transaction ID"
                            >
                              {copiedId === tx.id ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* 2. Type & Status */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isPayment && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <TrendingUp className="w-3 h-3" />
                                <span>Rent Payment</span>
                              </span>
                            )}
                            {isCharge && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#FAF8F5] text-[#654735] border border-[#B58A57]/35">
                                <Receipt className="w-3 h-3 text-[#B58A57]" />
                                <span>Rent Charge</span>
                              </span>
                            )}
                            {isDeposit && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                                <Wallet className="w-3 h-3 text-amber-800" />
                                <span>Deposit</span>
                              </span>
                            )}
                            {isTiffinPayment && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-800 border border-teal-200">
                                <TrendingUp className="w-3 h-3" />
                                <span>Tiffin Payment</span>
                              </span>
                            )}
                            {isTiffinCharge && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-900 border border-amber-300">
                                <Receipt className="w-3 h-3 text-amber-800" />
                                <span>Tiffin Charge</span>
                              </span>
                            )}
                            {isExpense && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-700 border border-stone-200">
                                <TrendingDown className="w-3 h-3" />
                                <span>Expense ({tx.category})</span>
                              </span>
                            )}
                            {isReversal && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                                <RotateCcw className="w-3 h-3" />
                                <span>Reversal</span>
                              </span>
                            )}

                            {isReversed && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-stone-200 text-stone-700">
                                Reversed
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 3. Party / Room */}
                        <td className="py-3 px-4">
                          <div className="font-semibold text-xs text-[#1A2E20] truncate max-w-[150px]" title={tx.residentName || tx.customerName || tx.payeeVendor || "General Operations"}>
                            {tx.residentName || tx.customerName || tx.payeeVendor || "General Operations"}
                          </div>
                          <div className="text-[11px] text-[#5A6C5E] mt-0.5 truncate max-w-[150px]">
                            {tx.roomNumber ? `Room ${tx.roomNumber}` : tx.customerName ? "Tiffin Customer" : tx.payeeVendor ? `${tx.category} Vendor` : "Operations"}
                          </div>
                        </td>

                        {/* 4. Payment Method & Ref */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="text-xs text-[#1A2E20] font-medium font-sans">
                            {formatPaymentMethodLabel(tx.paymentMethod)}
                          </div>
                          <div className="text-[11px] text-[#6E7F70] font-sans mt-0.5 truncate max-w-[130px]" title={tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : ""}>
                            {tx.referenceNumber ? `Ref: ${tx.referenceNumber}` : "—"}
                          </div>
                        </td>

                        {/* 5. Description & Period */}
                        <td className="py-3 px-4 max-w-[200px]">
                          {tx.billingPeriod && (
                            <div className="text-[11px] font-medium text-[#1A2E20] truncate">
                              {tx.billingPeriod}
                            </div>
                          )}
                          <div className="text-[11px] text-[#5A6C5E] truncate" title={readableNote(tx.description)}>
                            {readableNote(tx.description) || "—"}
                          </div>
                        </td>

                        {/* 6. Amount */}
                        <td className="py-3 px-4 text-right whitespace-nowrap min-w-[120px]">
                          <span
                            className={`font-sans text-xs sm:text-sm font-bold tabular-nums ${
                              isReversed
                                ? "line-through text-stone-400"
                                : isPositive
                                ? "text-emerald-700"
                                : isNegative
                                ? "text-rose-700"
                                : "text-[#1A2E20]"
                            }`}
                          >
                            {formatted}
                          </span>
                          {isCharge && !isReversed && (
                            <span className="block text-[10px] text-[#6E7F70]">receivable</span>
                          )}
                        </td>

                        {/* 7. Actions */}
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => onViewReceipt(tx)}
                              className="p-1.5 rounded-lg border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] transition-colors shadow-2xs"
                              title="View voucher receipt"
                            >
                              <Receipt className="w-3.5 h-3.5 text-[#B58A57]" />
                            </button>
                            {onEdit && canEditEntry(tx) && (
                              <button
                                type="button"
                                onClick={() => onEdit(tx)}
                                className="p-1.5 rounded-lg border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] transition-colors shadow-2xs"
                                title="Edit"
                                aria-label="Edit entry"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {onInitiateReversal && !isReversed && !isReversal && (
                              <button
                                type="button"
                                onClick={() => onInitiateReversal?.(tx)}
                                className="p-1.5 rounded-lg border border-[#8E9F89]/30 bg-white hover:bg-rose-50 text-stone-600 hover:text-rose-700 transition-colors shadow-2xs"
                                title="Reverse transaction"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paginated, copiedId, onViewReceipt, onInitiateReversal, onEdit]
  );

  return (
    <div className="space-y-4">
      {/* 1. Search and Filters Bar (Matching Residents & Rooms pattern) */}
      <div className="rn-card">
<div className="p-4 sm:p-5 border-b border-[var(--rn-line)] flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 min-w-0 [&>*]:min-w-0">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#6E7F70] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search name, room or note"
            className="w-full pl-9 pr-8 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs sm:text-sm text-[#1A2E20] placeholder:text-[#6E7F70] focus:outline-hidden focus:border-[#1A2E20] focus:ring-1 focus:ring-[#1A2E20]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6E7F70] hover:text-[#1A2E20] text-sm font-bold"
            >
              &times;
            </button>
          )}
        </div>

        <Segmented
          label="Show"
          value={flow}
          onChange={setFlow}
          options={[
            { value: "ALL", label: "All entries" },
            { value: "IN", label: "Received" },
            { value: "OUT", label: "Expenses" },
          ]}
        />

        {/* Division, Type, Method & Status Filters */}
        <div className="flex flex-wrap items-center gap-2 rn-filter-row">
          <span className="text-xs text-[#5A6C5E] font-medium hidden sm:inline">Division:</span>
          <AppSelect
            value={divisionFilter}
            onChange={(e) => setDivisionFilter(e.target.value)}
            className="px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] font-semibold focus:outline-hidden focus:border-[#1A2E20]"
          >
            <option value="ALL">All Divisions</option>
            <option value="PG">PG Guesthouse</option>
            <option value="TIFFIN">Tiffin Service</option>
          </AppSelect>

          <span className="text-xs text-[#5A6C5E] font-medium hidden sm:inline">Type:</span>
          <AppSelect
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden focus:border-[#1A2E20]"
          >
            <option value="ALL">All Types</option>
            <option value="RENT_PAYMENT">Rent Payment</option>
            <option value="RENT_CHARGE">Rent Charge (Billed)</option>
            <option value="SECURITY_DEPOSIT">Security Deposit</option>
            <option value="TIFFIN_PAYMENT">Tiffin Payment</option>
            <option value="TIFFIN_CHARGE">Tiffin Charge</option>
            <option value="EXPENSE">Expense</option>
            <option value="REVERSAL">Reversal</option>
          </AppSelect>

          <span className="text-xs text-[#5A6C5E] font-medium hidden sm:inline">Method:</span>
          <AppSelect
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden focus:border-[#1A2E20]"
          >
            <option value="ALL">All Methods</option>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI / QR</option>
            <option value="BANK_TRANSFER">Bank Transfer</option>
            <option value="CHEQUE">Cheque</option>
            <option value="OTHER">Card / Other</option>
          </AppSelect>

          <span className="text-xs text-[#5A6C5E] font-medium hidden sm:inline">Status:</span>
          <AppSelect
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] font-medium focus:outline-hidden focus:border-[#1A2E20]"
          >
            <option value="ALL">All Status</option>
            <option value="POSTED">Posted</option>
            <option value="REVERSED">Reversed</option>
          </AppSelect>

          <span className="text-xs text-[#6E7F70] pl-1 font-sans font-medium tabular-nums whitespace-nowrap">
            {filtered.length} record{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* 2. Table / Cards Container */}
      <div>
        {/* Loading State */}
        {isLoading ? (
          <BikeLoader tone="forest" label="Loading transactions…" className="p-12" />
        ) : filtered.length === 0 ? (
          /* Empty State */
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#FAF8F5] border border-[#8E9F89]/30 flex items-center justify-center mx-auto text-[#1A2E20]">
              <Receipt className="w-6 h-6 text-[#B58A57]" />
            </div>
            <h3 className="font-serif text-lg text-[#1A2E20] font-bold">No Transactions Found</h3>
            <p className="text-xs text-[#5A6C5E] max-w-md mx-auto">
              {transactions.length === 0
                ? "No financial transactions recorded for this period. Use the action buttons above to record a payment, charge, deposit, or expense."
                : "No transactions match your search query or filter selection."}
            </p>
            {transactions.length === 0 && (
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  onClick={onOpenPayment}
                  className="px-4 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold shadow-xs"
                >
                  Receive
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Mobile Card List (< md screens) - Prevents Wide Table Viewport Overflow */}
            <div className="lg:hidden rn-mlist">
              {mobileRows}
            </div>

            {/* Dedicated Horizontally Scrollable Transaction Table (Desktop/Tablet) */}
            <div className="hidden lg:block overflow-x-auto w-full min-w-0">
              <table className="w-full min-w-[760px] text-left border-collapse">
                <thead>
                  <tr className="bg-[#FAF8F5] border-b border-[#8E9F89]/20 text-[11px] uppercase font-semibold tracking-wider text-[#6E7F70]">
                    <th className="py-3 px-4 whitespace-nowrap">Date &amp; ID</th>
                    <th className="py-3 px-4 whitespace-nowrap">Type</th>
                    <th className="py-3 px-4 whitespace-nowrap">Party / Room</th>
                    <th className="py-3 px-4 whitespace-nowrap">Payment Method &amp; Ref</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Amount</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#8E9F89]/15 text-xs text-[#1A2E20]">
                  {tableRows}
                </tbody>
              </table>
            </div>

            {/* Pagination Footer */}
            <div className="border-t border-[#8E9F89]/20 bg-[#FAF8F5]/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#5A6C5E] min-w-0">
              <div className="font-sans tabular-nums">
                Showing <strong className="text-[#1A2E20]">{startIndex}</strong> to{" "}
                <strong className="text-[#1A2E20]">{endIndex}</strong> of{" "}
                <strong className="text-[#1A2E20]">{filtered.length}</strong> transactions
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="p-1.5 rounded-lg border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] disabled:opacity-40 transition-colors shadow-2xs"
                  title="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                <span className="font-sans text-xs tabular-nums text-[#1A2E20]">
                  Page {currentPage}/{totalPages}
                </span>

                <button
                  type="button"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 rounded-lg border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] disabled:opacity-40 transition-colors shadow-2xs"
                  title="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
</div>
    </div>
  );
}
