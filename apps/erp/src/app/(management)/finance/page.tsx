"use client";

import { friendlyError } from "@/lib/friendlyError";
import React, { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Receipt,
  Users,
  AlertCircle,
  CheckCircle2,
  X,
  FileText,
  Lock,
} from "lucide-react";
import {
  FinancialTransaction,
  CashbookSummary,
  ResidentFinancialSummary,
  ResidentListItem,
} from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { FinanceHeader } from "@/modules/finance/components/FinanceHeader";
import { AccountingPeriodSelector } from "@/modules/finance/components/AccountingPeriodSelector";
import { FinancialSummaryCards } from "@/modules/finance/components/FinancialSummaryCards";
import { CashbookLedger } from "@/modules/finance/components/CashbookLedger";
import { ResidentStatementsView } from "@/modules/finance/components/ResidentStatementsView";
import { InvoiceLedgerView } from "@/modules/finance/components/InvoiceLedgerView";
import { DailyClosingView } from "@/modules/finance/components/DailyClosingView";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { Segmented } from "@/components/ui/kit";

import {
  toLocalDateString,
  getLocalFirstDayOfMonth,
} from "@/modules/finance/utils/dateUtils";
import { exportCashbookToCsv } from "@/modules/finance/utils/exportCsv";
import dynamic from "next/dynamic";
import { preloadWhenIdle } from "@/lib/preloadWhenIdle";
import { MNotice, PhoneOrDesktop, useIsPhone } from "@/components/app/m";
import { FinancePlaces, CashbookMobile, ReceivablesMobile, DuesMobile } from "@/modules/finance/mobile/FinanceMobile";

// Dialogs and secondary views load on demand, off the navigation path.
const loadPaymentModal = () => import("@/modules/finance/components/modals/PaymentModal");
const PaymentModal = dynamic(() => loadPaymentModal().then((m) => m.PaymentModal), { ssr: false });
const loadRentChargeModal = () => import("@/modules/finance/components/modals/RentChargeModal");
const RentChargeModal = dynamic(() => loadRentChargeModal().then((m) => m.RentChargeModal), { ssr: false });
const loadRentRunModal = () => import("@/modules/finance/components/modals/RentRunModal");
const RentRunModal = dynamic(() => loadRentRunModal().then((m) => m.RentRunModal), { ssr: false });
const loadSecurityDepositModal = () => import("@/modules/finance/components/modals/SecurityDepositModal");
const SecurityDepositModal = dynamic(() => loadSecurityDepositModal().then((m) => m.SecurityDepositModal), { ssr: false });
const loadExpenseModal = () => import("@/modules/finance/components/modals/ExpenseModal");
const ExpenseModal = dynamic(() => loadExpenseModal().then((m) => m.ExpenseModal), { ssr: false });
const loadReceiptModal = () => import("@/modules/finance/components/modals/ReceiptModal");
const ReceiptModal = dynamic(() => loadReceiptModal().then((m) => m.ReceiptModal), { ssr: false });
const loadReversalModal = () => import("@/modules/finance/components/modals/ReversalModal");
const ReversalModal = dynamic(() => loadReversalModal().then((m) => m.ReversalModal), { ssr: false });
// Receivables is its own tab: its code loads when the tab opens (preloaded when idle), and until
// then the tab shows the same summary and list skeleton the view uses, never a spinner.
const loadReceivablesView = () => import("@/modules/finance/components/ReceivablesView");
const ReceivablesView = dynamic(() => loadReceivablesView().then((m) => m.ReceivablesView), {
  ssr: false,
  loading: () => (
    <div className="space-y-5" aria-busy="true">
      <div className="rn-card p-4 sm:p-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className="rn-skel block h-10 rounded" />
        ))}
      </div>
      <div className="rn-card p-4 sm:p-5 space-y-3">
        <span className="rn-skel block h-10 w-full rounded-full" />
        <span className="rn-skel block h-10 w-2/3 rounded" />
      </div>
      <div className="rn-card divide-y divide-[var(--rn-line)]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 sm:px-5 py-4 flex items-center gap-4">
            <span className="rn-skel block h-4 w-1/3 rounded" />
            <span className="rn-skel block h-4 w-16 rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  ),
});

export default function FinancePage() {
  // Fetch the dialog and tab code in the background so the first click opens at once.
  useEffect(() => preloadWhenIdle([loadPaymentModal, loadRentChargeModal, loadRentRunModal, loadSecurityDepositModal, loadExpenseModal, loadReceiptModal, loadReversalModal, loadReceivablesView]), []);
  // Owner-level actions (reversal, closings, invoices) are hidden for roles the server would reject.
  const canManageFinance = useHasPermission("finance.manage");
  const phone = useIsPhone();
  type FinanceTab = "cashbook" | "receivables" | "residents" | "invoices" | "closing";
  const SECTION_TITLE: Record<FinanceTab, string> = { cashbook: "Cashbook", receivables: "Receivables", residents: "Resident dues", invoices: "Invoices", closing: "Daily closing" };
  const [activeTab, setTabState] = useState<FinanceTab>("cashbook");
  // The tab follows the address (/finance?tab=closing), so the sidebar's Cashbook, Resident Dues,
  // Invoices and Daily Closing links, notifications and reports all open the right view.
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlTab = searchParams?.get("tab");
  useEffect(() => {
    if (urlTab === "cashbook" || urlTab === "receivables" || urlTab === "residents" || urlTab === "invoices" || urlTab === "closing") setTabState(urlTab);
    else if (!urlTab) setTabState("cashbook");
  }, [urlTab]);
  const setActiveTab = (t: FinanceTab) => {
    setTabState(t);
    // A real page change (title, menu and address follow); the page itself stays mounted, so the
    // shared data is reused and the switch is instant.
    router.replace(`/finance?tab=${t}`, { scroll: false });
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  };

  // Local calendar date filters (defaults to current calendar month)
  const [startDate, setStartDate] = useState(getLocalFirstDayOfMonth());
  const [endDate, setEndDate] = useState(toLocalDateString());

  // Cached data query with background revalidation and instant cache hit
  const cacheKey = `/api/finance/bundle?startDate=${startDate}&endDate=${endDate}`;
  const {
    data: financeData,
    error: financeQueryError,
    isLoading: isFinanceLoading,
    isRevalidating: isFinanceRevalidating,
    refetch: refetchFinance,
  } = useErpQuery<{
    cashbook: CashbookSummary | null;
    transactions: FinancialTransaction[];
    residents: ResidentListItem[];
  }>(
    cacheKey,
    async () => {
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

      return {
        cashbook: dataSummary.summary || null,
        transactions: dataTx.transactions || [],
        residents: dataResidents.residents || [],
      };
    },
    // Balances can change through other staff (handovers, orders): reuse for 60s, never longer.
    { ttl: 60000, tags: ["finance"] }
  );

  const cashbook = financeData?.cashbook || null;
  const transactions = financeData?.transactions || [];
  const residents = financeData?.residents || [];
  const loading = isFinanceLoading && !financeData;
  const isRevalidating = isFinanceRevalidating;
  const [errorOverride, setErrorOverride] = useState<string | null>(null);
  const error = errorOverride || (financeQueryError ? financeQueryError.message : null);

  // Global notification banners
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal dialog states
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isChargeOpen, setIsChargeOpen] = useState(false);
  const [isRentRunOpen, setIsRentRunOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isExpenseOpen, setIsExpenseOpen] = useState(false);
  const [paymentResidentId, setPaymentResidentId] = useState<string | undefined>(undefined);

  const [receiptTx, setReceiptTx] = useState<FinancialTransaction | null>(null);
  const [reversalTarget, setReversalTarget] = useState<FinancialTransaction | null>(null);

  // Refetch financial data for selected date range and invalidate cache
  const fetchData = useCallback(async () => {
    try {
      setErrorOverride(null);
      invalidateErpCache(["finance", "dashboard"]);
      await refetchFinance();
    } catch (err: any) {
      setErrorOverride(err.message || "Failed to load financial records.");
    }
  }, [refetchFinance]);

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
      setActionError(friendlyError(err.message || "Failed to load resident financial statement."));
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

  const modals = (
    <>
        <PaymentModal
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          residents={residents}
          initialResidentId={paymentResidentId}
          onSuccess={handleMutationSuccess}
        />

        <RentRunModal isOpen={isRentRunOpen} onClose={() => setIsRentRunOpen(false)} onDone={fetchData} />

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
    </>
  );

  // Phones: the app layout (same data, dialogs and actions).
  const mobile = (
      <div className="m-stack">
        {actionSuccess && <MNotice onClose={() => setActionSuccess(null)}>{actionSuccess}</MNotice>}
        {actionError && (
          <MNotice tone="red" onClose={() => setActionError(null)}>
            {actionError}
          </MNotice>
        )}
        {error && <MNotice tone="red">{error}</MNotice>}
        <FinancePlaces value={activeTab} onChange={setActiveTab} />
        {activeTab === "cashbook" ? (
          <CashbookMobile
            summary={cashbook}
            transactions={transactions}
            isLoading={loading}
            startDate={startDate}
            endDate={endDate}
            onRange={handleDateRangeChange}
            onPay={() => {
              setPaymentResidentId(undefined);
              setIsPaymentOpen(true);
            }}
            onExpense={() => setIsExpenseOpen(true)}
            onDeposit={() => setIsDepositOpen(true)}
            onCharge={() => setIsChargeOpen(true)}
            onRentRun={() => setIsRentRunOpen(true)}
            onExport={handleExportCashbook}
            onReceipt={(tx) => setReceiptTx(tx)}
            onReverse={canManageFinance ? (tx) => setReversalTarget(tx) : undefined}
            onOwed={() => setActiveTab("residents")}
          />
        ) : activeTab === "receivables" ? (
          <ReceivablesMobile initialReviewOnly={searchParams?.get("review") === "1"} />
        ) : activeTab === "residents" ? (
          <DuesMobile residents={residents} isLoading={loading} />
        ) : activeTab === "invoices" ? (
          <InvoiceLedgerView residents={residents} onOpenRecordPayment={handleOpenPaymentForResident} onRefreshParentFinance={fetchData} />
        ) : (
          <DailyClosingView
            onMutationSuccess={(msg) => {
              setActionSuccess(msg);
              fetchData();
            }}
            onMutationError={(err) => setActionError(friendlyError(err))}
          />
        )}
      </div>
  );

  const desktop = (
    <div className="space-y-5 w-full min-w-0">
      <FinanceHeader
        title={SECTION_TITLE[activeTab]}
        onRefresh={fetchData}
        isLoading={loading || isRevalidating}
        onOpenPayment={() => {
          setPaymentResidentId(undefined);
          setIsPaymentOpen(true);
        }}
        onOpenCharge={() => setIsChargeOpen(true)}
        onOpenRentRun={() => setIsRentRunOpen(true)}
        onOpenDeposit={() => setIsDepositOpen(true)}
        onOpenExpense={() => setIsExpenseOpen(true)}
        onExport={handleExportCashbook}
        canExport={transactions.length > 0}
      />

      {/* Global Alerts */}
      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between shadow-2xs animate-fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold">{actionSuccess}</span>
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
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center justify-between shadow-2xs animate-fade-in">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{actionError}</span>
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
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-center gap-2.5 shadow-2xs animate-fade-in">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Section switch for phones and tablets; on desktop the sidebar lists these four sections. */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0">
        <div className="lg:hidden">
        <Segmented
          label="Finance sections"
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: "cashbook", label: "Cashbook" },
            { value: "receivables", label: "Receivables" },
            { value: "residents", label: "Resident dues" },
            { value: "invoices", label: "Invoices" },
            { value: "closing", label: "Daily closing" },
          ]}
        />
        </div>

        {/* Accounting Period Selector (only in Cashbook tab) */}
        {activeTab === "cashbook" && (
          <AccountingPeriodSelector
            startDate={startDate}
            endDate={endDate}
            onDateRangeChange={handleDateRangeChange}
            onResetFilters={handleResetFilters}
            hasActiveFilters={hasActiveFilters}
          />
        )}
      </div>

      {/* 3. Tab Content */}
      {activeTab === "cashbook" ? (
        <div className="space-y-5">
          {/* 5 Financial Summary KPI Cards */}
          <FinancialSummaryCards summary={cashbook} isLoading={loading} />

          {/* Cashbook Ledger Table */}
          <CashbookLedger
            transactions={transactions}
            isLoading={loading}
            onViewReceipt={(tx) => setReceiptTx(tx)}
            onInitiateReversal={canManageFinance ? (tx) => setReversalTarget(tx) : undefined}
            onOpenPayment={() => {
              setPaymentResidentId(undefined);
              setIsPaymentOpen(true);
            }}
            onOpenCharge={() => setIsChargeOpen(true)}
            onOpenDeposit={() => setIsDepositOpen(true)}
            onOpenExpense={() => setIsExpenseOpen(true)}
          />
        </div>
      ) : activeTab === "receivables" ? (
        /* Who owes what: PG rent, tiffin invoices and delivered orders (read from those records) */
        <ReceivablesView initialReviewOnly={searchParams?.get("review") === "1"} />
      ) : activeTab === "residents" ? (
        /* Resident Statements Directory */
        <ResidentStatementsView
          residents={residents}
          isLoading={loading}
          onOpenPaymentForResident={handleOpenPaymentForResident}
          onLoadStatement={handleLoadStatement}
        />
      ) : activeTab === "invoices" ? (
        /* Invoices & Billing Engine */
        <InvoiceLedgerView
          residents={residents}
          onOpenRecordPayment={handleOpenPaymentForResident}
          onRefreshParentFinance={fetchData}
        />
      ) : (
        /* Daily Closing & Multi-Channel Reconciliation Engine */
        <DailyClosingView
          onMutationSuccess={(msg) => {
            setActionSuccess(msg);
            fetchData();
          }}
          onMutationError={(err) => setActionError(err)}
        />
      )}

    </div>
  );

  return (
    <>
      <PhoneOrDesktop phone={phone} mobile={mobile} desktop={desktop} />
      {modals}
    </>
  );
}
