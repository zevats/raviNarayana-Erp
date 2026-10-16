"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Receipt,
  Users,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  FinancialTransaction,
  CashbookSummary,
  ResidentFinancialSummary,
  ResidentListItem,
} from "@/types";
import { FinanceHeader } from "@/modules/finance/components/FinanceHeader";
import { AccountingPeriodSelector } from "@/modules/finance/components/AccountingPeriodSelector";
import { FinancialSummaryCards } from "@/modules/finance/components/FinancialSummaryCards";
import { CashbookLedger } from "@/modules/finance/components/CashbookLedger";
import { ResidentStatementsView } from "@/modules/finance/components/ResidentStatementsView";
import { PaymentModal } from "@/modules/finance/components/modals/PaymentModal";
import { RentChargeModal } from "@/modules/finance/components/modals/RentChargeModal";
import { SecurityDepositModal } from "@/modules/finance/components/modals/SecurityDepositModal";
import { ExpenseModal } from "@/modules/finance/components/modals/ExpenseModal";
import { ReceiptModal } from "@/modules/finance/components/modals/ReceiptModal";
import { ReversalModal } from "@/modules/finance/components/modals/ReversalModal";
import {
  toLocalDateString,
  getLocalFirstDayOfMonth,
  getLocalDaysAgo,
} from "@/modules/finance/utils/dateUtils";
import { exportCashbookToCsv } from "@/modules/finance/utils/exportCsv";

export default function FinancePage() {
  const [activeTab, setActiveTab] = useState<"cashbook" | "residents">("cashbook");

  // Local calendar date filters (defaults to current month)
  const [startDate, setStartDate] = useState(getLocalFirstDayOfMonth());
  const [endDate, setEndDate] = useState(toLocalDateString());

  // Data states
  const [cashbook, setCashbook] = useState<CashbookSummary | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [residents, setResidents] = useState<ResidentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Global notification banners
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal dialog states
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isChargeOpen, setIsChargeOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isExpenseOpen, setIsExpenseOpen] = useState(false);
  const [paymentResidentId, setPaymentResidentId] = useState<string | undefined>(undefined);

  const [receiptTx, setReceiptTx] = useState<FinancialTransaction | null>(null);
  const [reversalTarget, setReversalTarget] = useState<FinancialTransaction | null>(null);

  // Fetch financial data for selected date range
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [resSummary, resTx, resResidents] = await Promise.all([
        fetch(`/api/finance/cashbook?startDate=${startDate}&endDate=${endDate}`, { cache: "no-store" }),
        fetch(`/api/finance/transactions?startDate=${startDate}&endDate=${endDate}&limit=500`, { cache: "no-store" }),
        fetch("/api/residents", { cache: "no-store" }),
      ]);

      const [dataSummary, dataTx, dataResidents] = await Promise.all([
        resSummary.json(),
        resTx.json(),
        resResidents.json(),
      ]);

      if (!resSummary.ok) throw new Error(dataSummary.error || "Failed to load cashbook.");
      if (!resTx.ok) throw new Error(dataTx.error || "Failed to load transactions.");

      setCashbook(dataSummary.summary);
      setTransactions(dataTx.transactions || []);
      setResidents(dataResidents.residents || []);
    } catch (err: any) {
      setError(err.message || "Failed to load financial records.");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load single resident financial statement dossier
  const handleLoadStatement = async (residentId: string): Promise<ResidentFinancialSummary | null> => {
    try {
      const res = await fetch(`/api/finance/residents/${residentId}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load resident statement.");
      }
      return data.summary;
    } catch (err: any) {
      setActionError(err.message || "Failed to load resident financial statement.");
      return null;
    }
  };

  // Date range handlers
  const handleDateRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const handleResetFilters = () => {
    setStartDate(getLocalFirstDayOfMonth());
    setEndDate(toLocalDateString());
  };

  // Check if non-default filters are active
  const hasActiveFilters =
    startDate !== getLocalFirstDayOfMonth() || endDate !== toLocalDateString();

  // Export cashbook handler
  const handleExportCashbook = () => {
    exportCashbookToCsv(transactions, {
      startDate,
      endDate,
    });
  };

  // Quick action: Collect payment for specific resident
  const handleOpenPaymentForResident = (residentId: string) => {
    setPaymentResidentId(residentId);
    setIsPaymentOpen(true);
  };

  // Modal success callback
  const handleMutationSuccess = (tx: FinancialTransaction, message: string) => {
    setActionSuccess(message);
    fetchData();
    setReceiptTx(tx);
    setTimeout(() => setActionSuccess(null), 5000);
  };

  const handleReversalSuccess = (message: string) => {
    setActionSuccess(message);
    fetchData();
    setTimeout(() => setActionSuccess(null), 5000);
  };

  return (
    <div className="space-y-6 sm:space-y-7 animate-fade-in max-w-7xl mx-auto pb-12">
      {/* 1. Header & Actions */}
      <FinanceHeader
        onRefresh={fetchData}
        isLoading={loading}
        onOpenPayment={() => {
          setPaymentResidentId(undefined);
          setIsPaymentOpen(true);
        }}
        onOpenCharge={() => setIsChargeOpen(true)}
        onOpenDeposit={() => setIsDepositOpen(true)}
        onOpenExpense={() => setIsExpenseOpen(true)}
        onExport={handleExportCashbook}
        canExport={transactions.length > 0}
      />

      {/* Global Alerts */}
      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm flex items-center justify-between shadow-2xs animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{actionSuccess}</span>
          </div>
          <button
            onClick={() => setActionSuccess(null)}
            className="text-emerald-700 hover:text-emerald-900 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm flex items-center justify-between shadow-2xs animate-fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-medium">{actionError}</span>
          </div>
          <button
            onClick={() => setActionError(null)}
            className="text-rose-700 hover:text-rose-900 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs sm:text-sm flex items-start gap-2.5 shadow-2xs">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Unable to load finance data</p>
            <p className="text-rose-800/80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* 2. Primary Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-[#8E9F89]/20 pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("cashbook")}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all ${
            activeTab === "cashbook"
              ? "bg-[#1A2E20] text-white shadow-2xs"
              : "text-[#5E715C] hover:text-[#1A2E20] hover:bg-[#FAF8F5]"
          }`}
        >
          <Receipt className="w-4 h-4 text-[#B58A57]" />
          <span>Cashbook &amp; Transactions</span>
          {transactions.length > 0 && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                activeTab === "cashbook"
                  ? "bg-white/20 text-white"
                  : "bg-stone-200/70 text-[#1A2E20]"
              }`}
            >
              {transactions.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("residents")}
          className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all ${
            activeTab === "residents"
              ? "bg-[#1A2E20] text-white shadow-2xs"
              : "text-[#5E715C] hover:text-[#1A2E20] hover:bg-[#FAF8F5]"
          }`}
        >
          <Users className="w-4 h-4 text-[#5D7656]" />
          <span>Resident Statements</span>
          {residents.length > 0 && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                activeTab === "residents"
                  ? "bg-white/20 text-white"
                  : "bg-stone-200/70 text-[#1A2E20]"
              }`}
            >
              {residents.length}
            </span>
          )}
        </button>
      </div>

      {/* 3. Tab Content */}
      {activeTab === "cashbook" ? (
        <div className="space-y-6">
          {/* Accounting Period Controls */}
          <AccountingPeriodSelector
            startDate={startDate}
            endDate={endDate}
            onDateRangeChange={handleDateRangeChange}
            onResetFilters={handleResetFilters}
            hasActiveFilters={hasActiveFilters}
          />

          {/* 5 Financial Summary KPI Cards */}
          <FinancialSummaryCards summary={cashbook} isLoading={loading} />

          {/* Cashbook Ledger Table */}
          <CashbookLedger
            transactions={transactions}
            isLoading={loading}
            onViewReceipt={(tx) => setReceiptTx(tx)}
            onInitiateReversal={(tx) => setReversalTarget(tx)}
            onOpenPayment={() => {
              setPaymentResidentId(undefined);
              setIsPaymentOpen(true);
            }}
            onOpenCharge={() => setIsChargeOpen(true)}
            onOpenDeposit={() => setIsDepositOpen(true)}
            onOpenExpense={() => setIsExpenseOpen(true)}
          />
        </div>
      ) : (
        /* Resident Statements Directory */
        <ResidentStatementsView
          residents={residents}
          isLoading={loading}
          onOpenPaymentForResident={handleOpenPaymentForResident}
          onLoadStatement={handleLoadStatement}
        />
      )}

      {/* 4. Transaction Entry Modals */}
      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        residents={residents}
        initialResidentId={paymentResidentId}
        onSuccess={handleMutationSuccess}
      />

      <RentChargeModal
        isOpen={isChargeOpen}
        onClose={() => setIsChargeOpen(false)}
        residents={residents}
        onSuccess={handleMutationSuccess}
      />

      <SecurityDepositModal
        isOpen={isDepositOpen}
        onClose={() => setIsDepositOpen(false)}
        residents={residents}
        onSuccess={handleMutationSuccess}
      />

      <ExpenseModal
        isOpen={isExpenseOpen}
        onClose={() => setIsExpenseOpen(false)}
        onSuccess={handleMutationSuccess}
      />

      <ReceiptModal
        transaction={receiptTx}
        onClose={() => setReceiptTx(null)}
      />

      <ReversalModal
        transaction={reversalTarget}
        onClose={() => setReversalTarget(null)}
        onSuccess={handleReversalSuccess}
      />
    </div>
  );
}
