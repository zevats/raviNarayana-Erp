"use client";

import React from "react";
import {
  CreditCard,
  Receipt,
  Wallet,
  TrendingDown,
  RefreshCw,
  Download,
} from "lucide-react";

interface FinanceHeaderProps {
  onRefresh: () => void;
  isLoading: boolean;
  onOpenPayment: () => void;
  onOpenCharge: () => void;
  onOpenDeposit: () => void;
  onOpenExpense: () => void;
  onExport: () => void;
  canExport: boolean;
}

export function FinanceHeader({
  onRefresh,
  isLoading,
  onOpenPayment,
  onOpenCharge,
  onOpenDeposit,
  onOpenExpense,
  onExport,
  canExport,
}: FinanceHeaderProps) {
  return (
    <div className="flex flex-col 2xl:flex-row 2xl:items-center 2xl:justify-between gap-4 pb-3 border-b border-[#8E9F89]/20 min-w-0">
      <div className="border-l-4 border-[#B58A57] pl-3.5 min-w-0">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1A2E20]">
          Finance &amp; Cashbook
        </h1>
        <p className="text-xs sm:text-sm text-[#5A6C5E] mt-1 font-sans">
          Operational cashbook ledger, rent billing, payment collections, deposit liabilities, and expenses.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 min-w-0 w-full 2xl:w-auto">
        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-2.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] transition-colors shadow-2xs disabled:opacity-50"
          title="Refresh financial records"
          aria-label="Refresh financial records"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-[#B58A57]" : ""}`} />
        </button>

        {/* Export Button */}
        <button
          onClick={onExport}
          disabled={!canExport || isLoading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-medium transition-colors shadow-2xs disabled:opacity-40"
          title="Export current ledger records to CSV"
        >
          <Download className="w-4 h-4 text-[#5D7656]" />
          <span>Export CSV</span>
        </button>

        {/* Secondary: Issue Rent Charge */}
        <button
          onClick={onOpenCharge}
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#B58A57]/40 bg-[#FAF8F5] hover:bg-[#FAF8F5]/80 text-[#654735] text-xs sm:text-sm font-semibold transition-all shadow-2xs"
        >
          <Receipt className="w-4 h-4 text-[#B58A57]" />
          <span>Issue Rent Charge</span>
        </button>

        {/* Secondary: Receive Deposit */}
        <button
          onClick={onOpenDeposit}
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-medium transition-all shadow-2xs"
        >
          <Wallet className="w-4 h-4 text-[#5D7656]" />
          <span>Receive Deposit</span>
        </button>

        {/* Secondary: Record Expense */}
        <button
          onClick={onOpenExpense}
          className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-medium transition-all shadow-2xs"
        >
          <TrendingDown className="w-4 h-4 text-[#654735]" />
          <span>Record Expense</span>
        </button>

        {/* Primary Action: Record Payment */}
        <button
          onClick={onOpenPayment}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-semibold transition-all shadow-md active:scale-95"
        >
          <CreditCard className="w-4 h-4 text-[#B58A57]" />
          <span>Record Payment</span>
        </button>
      </div>
    </div>
  );
}
