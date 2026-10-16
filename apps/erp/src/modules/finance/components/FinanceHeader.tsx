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
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#8E9F89]/20">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full bg-[#B58A57]" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-[#654735]">
            Operational Cashbook &amp; Ledger
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-serif text-[#1A2E20] font-normal tracking-tight">
          Finance &amp; Cashbook
        </h1>
        <p className="text-xs sm:text-sm text-[#5E715C] mt-1 font-light max-w-2xl leading-relaxed">
          Comprehensive rent billing, payment receipts, refundable deposit liabilities, operational expenses, and live cash movement.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-medium transition-colors shadow-2xs disabled:opacity-40"
          title="Export current ledger records to CSV"
        >
          <Download className="w-4 h-4 text-[#5D7656]" />
          <span>Export CSV</span>
        </button>

        {/* Primary Action: Record Payment */}
        <button
          onClick={onOpenPayment}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-medium transition-all shadow-md active:scale-95 hover:shadow-lg"
        >
          <CreditCard className="w-4 h-4 text-[#B58A57]" />
          <span>Record Payment</span>
        </button>

        {/* Secondary Action: Issue Rent Charge */}
        <button
          onClick={onOpenCharge}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#B58A57]/40 bg-[#FAF8F5] hover:bg-[#FAF8F5]/80 text-[#654735] text-xs sm:text-sm font-medium transition-all shadow-2xs hover:border-[#B58A57]"
        >
          <Receipt className="w-4 h-4 text-[#B58A57]" />
          <span>Issue Rent Charge</span>
        </button>

        {/* Secondary Action: Receive Deposit */}
        <button
          onClick={onOpenDeposit}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#8E9F89]/35 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-medium transition-all shadow-2xs"
        >
          <Wallet className="w-4 h-4 text-[#5D7656]" />
          <span>Receive Deposit</span>
        </button>

        {/* Secondary Action: Record Expense */}
        <button
          onClick={onOpenExpense}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-rose-200 bg-rose-50/60 hover:bg-rose-50 text-rose-800 text-xs sm:text-sm font-medium transition-all shadow-2xs"
        >
          <TrendingDown className="w-4 h-4 text-rose-700" />
          <span>Record Expense</span>
        </button>
      </div>
    </div>
  );
}
