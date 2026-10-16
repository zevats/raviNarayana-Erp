"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  Filter,
  Receipt,
  RotateCcw,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  Wallet,
  Building,
  CreditCard,
  FileText,
  AlertCircle,
  ShieldAlert,
} from "lucide-react";
import { FinancialTransaction, TransactionType } from "@/types";
import { formatINRWithSign } from "../utils/formatUtils";
import { formatIndianDate } from "../utils/dateUtils";

interface CashbookLedgerProps {
  transactions: FinancialTransaction[];
  isLoading: boolean;
  onViewReceipt: (tx: FinancialTransaction) => void;
  onInitiateReversal: (tx: FinancialTransaction) => void;
  onOpenPayment: () => void;
  onOpenCharge: () => void;
  onOpenDeposit: () => void;
  onOpenExpense: () => void;
}

const ITEMS_PER_PAGE = 15;

export function CashbookLedger({
  transactions,
  isLoading,
  onViewReceipt,
  onInitiateReversal,
  onOpenPayment,
  onOpenCharge,
  onOpenDeposit,
  onOpenExpense,
}: CashbookLedgerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
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
      // Type filter
      if (typeFilter !== "ALL" && tx.transactionType !== typeFilter) {
        return false;
      }
      // Status filter
      if (statusFilter !== "ALL" && tx.status !== statusFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const party = (tx.residentName || tx.payeeVendor || "").toLowerCase();
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
  }, [transactions, typeFilter, statusFilter, searchQuery]);

  // Reset page when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [typeFilter, statusFilter, searchQuery]);

  // Pagination slice
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [filtered, currentPage]);

  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/20 p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        {/* Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[260px] bg-[#FAF8F5] px-3.5 py-2 rounded-xl border border-[#8E9F89]/25">
          <Search className="w-4 h-4 text-[#5D7656] shrink-0" />
          <input
            type="text"
            placeholder="Search by resident, vendor, ref #, room, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-transparent text-xs text-[#1A2E20] placeholder-[#5E715C]/60 focus:outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-[#5E715C] hover:text-[#1A2E20] text-xs font-bold px-1"
            >
              &times;
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Type Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#5E715C] font-semibold uppercase tracking-wider font-serif">
              Type:
            </span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-none font-medium"
            >
              <option value="ALL">All Types</option>
              <option value="RENT_PAYMENT">Rent Payments (In)</option>
              <option value="RENT_CHARGE">Rent Charges (Billed)</option>
              <option value="SECURITY_DEPOSIT">Security Deposits (Held)</option>
              <option value="EXPENSE">Operational Expenses (Out)</option>
              <option value="REVERSAL">Reversals &amp; Corrections</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#5E715C] font-semibold uppercase tracking-wider font-serif">
              Status:
            </span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-none font-medium"
            >
              <option value="ALL">All Status</option>
              <option value="POSTED">Posted Records</option>
              <option value="REVERSED">Reversed Records</option>
            </select>
          </div>
        </div>
      </div>

      {/* Ledger Table Container */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/20 shadow-2xs overflow-hidden">
        {/* Desktop Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#8E9F89]/15 bg-[#FAF8F5]/80 text-[#5D7656] font-serif uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4 font-semibold">Date &amp; ID</th>
                <th className="py-3.5 px-4 font-semibold">Type &amp; Status</th>
                <th className="py-3.5 px-4 font-semibold">Resident / Payee</th>
                <th className="py-3.5 px-4 font-semibold">Method &amp; Ref</th>
                <th className="py-3.5 px-4 font-semibold">Billing Period / Notes</th>
                <th className="py-3.5 px-4 font-semibold text-right">Amount (₹)</th>
                <th className="py-3.5 px-4 font-semibold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#8E9F89]/10">
              {isLoading ? (
                // Skeleton Rows
                Array.from({ length: 5 }).map((_, idx) => (
                  <tr key={`skel-${idx}`} className="animate-pulse">
                    <td className="py-4 px-4">
                      <div className="h-4 w-20 bg-stone-200 rounded mb-1.5" />
                      <div className="h-3 w-28 bg-stone-100 rounded" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-5 w-24 bg-stone-200 rounded-full" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 w-32 bg-stone-200 rounded" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 w-16 bg-stone-200 rounded mb-1" />
                      <div className="h-3 w-20 bg-stone-100 rounded" />
                    </td>
                    <td className="py-4 px-4">
                      <div className="h-4 w-36 bg-stone-200 rounded" />
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="h-4 w-16 bg-stone-200 rounded ml-auto" />
                    </td>
                    <td className="py-4 px-4 text-center">
                      <div className="h-6 w-14 bg-stone-200 rounded mx-auto" />
                    </td>
                  </tr>
                ))
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-[#5E715C]">
                    <div className="w-12 h-12 rounded-full bg-[#FAF8F5] border border-[#8E9F89]/30 flex items-center justify-center mx-auto mb-3 text-[#5D7656]">
                      <Receipt className="w-6 h-6" />
                    </div>
                    <p className="font-serif text-base text-[#1A2E20] font-medium">
                      No matching financial transactions
                    </p>
                    <p className="text-xs text-[#5E715C] mt-1 max-w-sm mx-auto font-light">
                      {transactions.length === 0
                        ? "No transactions have been recorded for the selected period. Use the actions above to record rent payments, rent charges, deposits, or expenses."
                        : "No transactions match your current search and type filters. Try adjusting your query or resetting filters."}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
                      <button
                        onClick={onOpenPayment}
                        className="px-3.5 py-1.5 rounded-xl bg-[#1A2E20] text-white text-xs font-medium hover:bg-[#263B2D] transition-colors"
                      >
                        Record Payment
                      </button>
                      <button
                        onClick={onOpenCharge}
                        className="px-3.5 py-1.5 rounded-xl border border-[#B58A57]/40 bg-[#FAF8F5] text-[#654735] text-xs font-medium hover:border-[#B58A57] transition-colors"
                      >
                        Issue Rent Charge
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((tx) => {
                  const isPayment = tx.transactionType === "RENT_PAYMENT";
                  const isCharge = tx.transactionType === "RENT_CHARGE";
                  const isDeposit = tx.transactionType === "SECURITY_DEPOSIT";
                  const isExpense = tx.transactionType === "EXPENSE";
                  const isReversal = tx.transactionType === "REVERSAL";
                  const isReversed = tx.status === "REVERSED";

                  const { formatted, isPositive, isNegative, isNeutral } = formatINRWithSign(
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
                      {/* Date & Copyable ID */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-medium text-[#1A2E20] block font-mono">
                          {tx.transactionDate}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span
                            className="text-[10px] text-[#5E715C] font-mono hover:text-[#1A2E20] transition-colors"
                            title={tx.id}
                          >
                            {tx.id.length > 20 ? `${tx.id.slice(0, 18)}...` : tx.id}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => handleCopyId(tx.id, e)}
                            className="p-1 rounded hover:bg-stone-200/60 text-[#5E715C] hover:text-[#1A2E20] transition-colors"
                            title="Copy full transaction ID"
                            aria-label="Copy full transaction ID"
                          >
                            {copiedId === tx.id ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Type & Status */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex flex-col gap-1 items-start">
                          {isPayment && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100/80 text-emerald-800 border border-emerald-200">
                              <TrendingUp className="w-3 h-3" />
                              <span>Rent Payment</span>
                            </span>
                          )}
                          {isCharge && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-[#FAF8F5] text-[#654735] border border-[#B58A57]/35">
                              <Receipt className="w-3 h-3 text-[#B58A57]" />
                              <span>Rent Charge (Billed)</span>
                            </span>
                          )}
                          {isDeposit && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-900 border border-amber-200">
                              <Wallet className="w-3 h-3 text-amber-800" />
                              <span>Deposit (Liability)</span>
                            </span>
                          )}
                          {isExpense && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-800 border border-rose-200">
                              <TrendingDown className="w-3 h-3" />
                              <span>Expense ({tx.category})</span>
                            </span>
                          )}
                          {isReversal && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-stone-100 text-stone-700 border border-stone-300">
                              <RotateCcw className="w-3 h-3" />
                              <span>Reversal</span>
                            </span>
                          )}

                          {isReversed && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-red-100 text-red-800 border border-red-300">
                              [Reversed]
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Party / Resident / Payee */}
                      <td className="py-3.5 px-4">
                        {tx.residentName ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-[#1A2E20]">{tx.residentName}</span>
                            {tx.roomNumber ? (
                              <span className="text-[10px] text-[#5D7656] mt-0.5">
                                Room {tx.roomNumber}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#5E715C]">No room assigned</span>
                            )}
                          </div>
                        ) : tx.payeeVendor ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-[#1A2E20]">{tx.payeeVendor}</span>
                            <span className="text-[10px] text-[#5E715C]">{tx.category} Vendor</span>
                          </div>
                        ) : (
                          <span className="text-[#5E715C] italic">General Operations</span>
                        )}
                      </td>

                      {/* Method & Ref */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {tx.paymentMethod ? (
                          <div>
                            <span className="font-medium text-[#1A2E20] block">
                              {tx.paymentMethod}
                            </span>
                            {tx.referenceNumber ? (
                              <span className="text-[10px] font-mono text-[#5E715C] block">
                                Ref: {tx.referenceNumber}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#5E715C]">—</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[#5E715C]">—</span>
                        )}
                      </td>

                      {/* Billing Period / Description */}
                      <td className="py-3.5 px-4 max-w-xs">
                        {tx.billingPeriod && (
                          <span className="font-medium text-[#1A2E20] block truncate">
                            {tx.billingPeriod}
                          </span>
                        )}
                        <span className="text-[#5E715C] text-[11px] block truncate">
                          {tx.description || "—"}
                        </span>
                      </td>

                      {/* Amount */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <span
                          className={`font-mono text-sm font-semibold tabular-nums ${
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
                          <span className="text-[10px] text-[#5E715C] block">billed receivable</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Receipt / Details */}
                          <button
                            type="button"
                            onClick={() => onViewReceipt(tx)}
                            className="p-1.5 rounded-lg border border-[#8E9F89]/25 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] transition-colors shadow-2xs"
                            title="View receipt and transaction details"
                            aria-label="View receipt"
                          >
                            <Receipt className="w-3.5 h-3.5 text-[#5D7656]" />
                          </button>

                          {/* Reverse Transaction */}
                          {!isReversed && !isReversal && (
                            <button
                              type="button"
                              onClick={() => onInitiateReversal(tx)}
                              className="p-1.5 rounded-lg border border-[#8E9F89]/25 bg-white hover:bg-rose-50 text-rose-700 transition-colors shadow-2xs"
                              title="Reverse / correct transaction"
                              aria-label="Reverse transaction"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {!isLoading && filtered.length > 0 && (
          <div className="p-3 sm:p-4 border-t border-[#8E9F89]/15 bg-[#FAF8F5]/60 flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-[#5E715C]">
              Showing <strong className="text-[#1A2E20] font-mono">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</strong> to{" "}
              <strong className="text-[#1A2E20] font-mono">
                {Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)}
              </strong>{" "}
              of <strong className="text-[#1A2E20] font-mono">{filtered.length}</strong> transactions
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] disabled:opacity-40 transition-colors shadow-2xs"
                title="Previous page"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="px-2.5 py-1 text-xs text-[#1A2E20] font-medium font-mono">
                Page {currentPage} of {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] disabled:opacity-40 transition-colors shadow-2xs"
                title="Next page"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
