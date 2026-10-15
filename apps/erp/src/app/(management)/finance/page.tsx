"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  CreditCard,
  Plus,
  Search,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Receipt,
  Users,
  Wallet,
  Building,
  TrendingDown,
  TrendingUp,
  X,
  ShieldAlert,
  ArrowRight,
  FileText,
  RotateCcw,
} from "lucide-react";
import {
  FinancialTransaction,
  CashbookSummary,
  ResidentFinancialSummary,
  ResidentListItem,
  PaymentMethod,
  ExpenseCategory,
  TransactionType,
} from "@/types";

export default function FinancePage() {
  const [activeTab, setActiveTab] = useState<"cashbook" | "residents">("cashbook");

  // Summary and transactions state
  const [cashbook, setCashbook] = useState<CashbookSummary | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [residents, setResidents] = useState<ResidentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date filters
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(firstDayOfMonth);
  const [endDate, setEndDate] = useState(today);

  // Transaction table filters
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isChargeModalOpen, setIsChargeModalOpen] = useState(false);
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [receiptTx, setReceiptTx] = useState<FinancialTransaction | null>(null);
  const [reversalTarget, setReversalTarget] = useState<FinancialTransaction | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [selectedResidentSummary, setSelectedResidentSummary] = useState<ResidentFinancialSummary | null>(null);
  const [loadingResidentDossier, setLoadingResidentDossier] = useState(false);

  // Form submission feedback
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Forms
  const [paymentForm, setPaymentForm] = useState({
    residentId: "",
    amount: "",
    paymentMethod: "UPI" as PaymentMethod,
    transactionDate: today,
    referenceNumber: "",
    description: "",
  });

  const [chargeForm, setChargeForm] = useState({
    residentId: "",
    amount: "",
    billingPeriod: `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`,
    transactionDate: today,
    description: "Monthly PG accommodation & amenities rent",
  });

  const [depositForm, setDepositForm] = useState({
    residentId: "",
    amount: "",
    paymentMethod: "UPI" as PaymentMethod,
    transactionDate: today,
    referenceNumber: "",
    description: "Security deposit held against room occupancy",
  });

  const [expenseForm, setExpenseForm] = useState({
    category: "GROCERY" as ExpenseCategory,
    amount: "",
    paymentMethod: "UPI" as PaymentMethod,
    payeeVendor: "",
    transactionDate: today,
    referenceNumber: "",
    description: "",
  });

  // Selected resident rent balance lookup
  const [selectedResidentRentBalance, setSelectedResidentRentBalance] = useState<number | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [resSummary, resTx, resResidents] = await Promise.all([
        fetch(`/api/finance/cashbook?startDate=${startDate}&endDate=${endDate}`, { cache: "no-store" }),
        fetch(`/api/finance/transactions?startDate=${startDate}&endDate=${endDate}`, { cache: "no-store" }),
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
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  // Load resident financial dossier
  const handleViewResidentSummary = async (residentId: string) => {
    setLoadingResidentDossier(true);
    setSelectedResidentSummary(null);
    try {
      const res = await fetch(`/api/finance/residents/${residentId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load resident statement.");
      setSelectedResidentSummary(data.summary);
    } catch (err: any) {
      alert(err.message || "Failed to load resident statement.");
    } finally {
      setLoadingResidentDossier(false);
    }
  };

  // Lookup balance when resident changes in payment modal
  const handleResidentSelectForPayment = async (residentId: string) => {
    setPaymentForm((prev) => ({ ...prev, residentId }));
    if (!residentId) {
      setSelectedResidentRentBalance(null);
      return;
    }
    try {
      const res = await fetch(`/api/finance/residents/${residentId}`);
      const data = await res.json();
      if (res.ok && data.summary) {
        setSelectedResidentRentBalance(data.summary.outstandingRentBalance);
        if (data.summary.outstandingRentBalance > 0) {
          setPaymentForm((prev) => ({
            ...prev,
            amount: String(data.summary.outstandingRentBalance),
          }));
        }
      }
    } catch {
      setSelectedResidentRentBalance(null);
    }
  };

  // Record Rent Payment
  const handleSubmitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSubmitting(true);

    try {
      const idempotencyKey = `pay_${crypto.randomUUID()}`;
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RENT_PAYMENT",
          residentId: paymentForm.residentId,
          amount: Number(paymentForm.amount),
          paymentMethod: paymentForm.paymentMethod,
          transactionDate: paymentForm.transactionDate,
          referenceNumber: paymentForm.referenceNumber,
          description: paymentForm.description,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record payment.");

      setActionSuccess(`Rent payment of ₹${Number(paymentForm.amount).toLocaleString("en-IN")} recorded.`);
      setIsPaymentModalOpen(false);
      setPaymentForm({
        residentId: "",
        amount: "",
        paymentMethod: "UPI",
        transactionDate: today,
        referenceNumber: "",
        description: "",
      });
      setSelectedResidentRentBalance(null);

      await fetchData();
      if (data.transaction) setReceiptTx(data.transaction);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to record rent payment.");
    } finally {
      setSubmitting(false);
    }
  };

  // Record Rent Charge
  const handleSubmitCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSubmitting(true);

    try {
      const idempotencyKey = `chg_${crypto.randomUUID()}`;
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RENT_CHARGE",
          residentId: chargeForm.residentId,
          amount: Number(chargeForm.amount),
          billingPeriod: chargeForm.billingPeriod,
          transactionDate: chargeForm.transactionDate,
          description: chargeForm.description,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record rent charge.");

      setActionSuccess(`Rent charge of ₹${Number(chargeForm.amount).toLocaleString("en-IN")} issued.`);
      setIsChargeModalOpen(false);
      setChargeForm({
        residentId: "",
        amount: "",
        billingPeriod: `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`,
        transactionDate: today,
        description: "Monthly PG accommodation & amenities rent",
      });

      await fetchData();
      if (data.transaction) setReceiptTx(data.transaction);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to record rent charge.");
    } finally {
      setSubmitting(false);
    }
  };

  // Record Security Deposit
  const handleSubmitDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSubmitting(true);

    try {
      const idempotencyKey = `dep_${crypto.randomUUID()}`;
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SECURITY_DEPOSIT",
          residentId: depositForm.residentId,
          amount: Number(depositForm.amount),
          paymentMethod: depositForm.paymentMethod,
          transactionDate: depositForm.transactionDate,
          referenceNumber: depositForm.referenceNumber,
          description: depositForm.description,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record security deposit.");

      setActionSuccess(`Security deposit of ₹${Number(depositForm.amount).toLocaleString("en-IN")} received.`);
      setIsDepositModalOpen(false);
      setDepositForm({
        residentId: "",
        amount: "",
        paymentMethod: "UPI",
        transactionDate: today,
        referenceNumber: "",
        description: "Security deposit held against room occupancy",
      });

      await fetchData();
      if (data.transaction) setReceiptTx(data.transaction);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to record security deposit.");
    } finally {
      setSubmitting(false);
    }
  };

  // Record Expense
  const handleSubmitExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError(null);
    setSubmitting(true);

    try {
      const idempotencyKey = `exp_${crypto.randomUUID()}`;
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "EXPENSE",
          category: expenseForm.category,
          amount: Number(expenseForm.amount),
          paymentMethod: expenseForm.paymentMethod,
          payeeVendor: expenseForm.payeeVendor,
          transactionDate: expenseForm.transactionDate,
          referenceNumber: expenseForm.referenceNumber,
          description: expenseForm.description,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record expense.");

      setActionSuccess(`Expense of ₹${Number(expenseForm.amount).toLocaleString("en-IN")} recorded.`);
      setIsExpenseModalOpen(false);
      setExpenseForm({
        category: "GROCERY",
        amount: "",
        paymentMethod: "UPI",
        payeeVendor: "",
        transactionDate: today,
        referenceNumber: "",
        description: "",
      });

      await fetchData();
      if (data.transaction) setReceiptTx(data.transaction);
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to record expense.");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Reversal
  const handleReverseTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversalTarget) return;
    setActionError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REVERSAL",
          transactionId: reversalTarget.id,
          reason: reversalReason,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reverse transaction.");

      setActionSuccess(`Transaction ${reversalTarget.id} successfully reversed.`);
      setReversalTarget(null);
      setReversalReason("");

      await fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to reverse transaction.");
    } finally {
      setSubmitting(false);
    }
  };

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (typeFilter !== "ALL" && tx.transactionType !== typeFilter) {
        return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const party = (tx.residentName || tx.payeeVendor || "").toLowerCase();
        const desc = (tx.description || "").toLowerCase();
        const ref = (tx.referenceNumber || "").toLowerCase();
        const id = tx.id.toLowerCase();
        if (!party.includes(q) && !desc.includes(q) && !ref.includes(q) && !id.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [transactions, typeFilter, searchQuery]);

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in max-w-7xl mx-auto">
      
      {/* ============================================================== */}
      {/* HEADER                                                         */}
      {/* ============================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#8E9F89]/20">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-[#B58A57]" />
            <span className="text-[11px] uppercase tracking-[0.2em] font-serif text-[#654735] font-semibold">
              PHASE 4 &bull; FINANCIAL MANAGEMENT
            </span>
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl lg:text-4xl text-[#1A2E20] font-normal tracking-tight">
            Finance &amp; Persistent Cashbook
          </h1>
          <p className="text-xs sm:text-sm text-[#445448] mt-1 font-light max-w-2xl">
            Live rent collection, billing invoices, security deposits held, operational expenses, and net cash movements.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] transition-colors shrink-0 shadow-xs"
            title="Refresh financial ledger"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={() => {
              setActionError(null);
              setIsPaymentModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs sm:text-sm font-medium transition-all shadow-md active:scale-95"
          >
            <CreditCard className="w-4 h-4 text-[#B58A57]" />
            <span>Record Payment</span>
          </button>

          <button
            onClick={() => {
              setActionError(null);
              setIsChargeModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#B58A57]/40 bg-[#FAF8F5] hover:bg-[#FAF8F5]/80 text-[#654735] text-xs sm:text-sm font-medium transition-all shadow-xs"
          >
            <Receipt className="w-4 h-4 text-[#B58A57]" />
            <span>Issue Rent Charge</span>
          </button>

          <button
            onClick={() => {
              setActionError(null);
              setIsDepositModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-[#8E9F89]/35 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs sm:text-sm font-medium transition-all shadow-xs"
          >
            <Wallet className="w-4 h-4 text-[#5D7656]" />
            <span>Receive Deposit</span>
          </button>

          <button
            onClick={() => {
              setActionError(null);
              setIsExpenseModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-rose-200 bg-rose-50/60 hover:bg-rose-50 text-rose-800 text-xs sm:text-sm font-medium transition-all shadow-xs"
          >
            <TrendingDown className="w-4 h-4 text-rose-700" />
            <span>Record Expense</span>
          </button>
        </div>
      </div>

      {/* Global alert feedback */}
      {actionSuccess && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm flex items-center justify-between shadow-xs animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-700 hover:text-emerald-900">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs sm:text-sm flex items-start gap-2 shadow-xs">
          <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Unable to load finance data</p>
            <p className="text-red-800/80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* DATE RANGE FILTER BAR                                          */}
      {/* ============================================================== */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/20 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 text-[#1A2E20] font-medium font-serif">
          <Calendar className="w-4 h-4 text-[#5D7656]" />
          <span>Accounting Period:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 bg-[#FAF8F5] px-2.5 py-1.5 rounded-xl border border-[#8E9F89]/25">
            <span className="text-[11px] text-[#5E715C]">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-[#1A2E20] font-mono text-xs focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-[#FAF8F5] px-2.5 py-1.5 rounded-xl border border-[#8E9F89]/25">
            <span className="text-[11px] text-[#5E715C]">To:</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-[#1A2E20] font-mono text-xs focus:outline-none"
            />
          </div>

          {/* Quick preset buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setStartDate(firstDayOfMonth);
                setEndDate(today);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-[#8E9F89]/25 bg-white hover:bg-[#FAF8F5] text-[11px] text-[#1A2E20] transition-colors"
            >
              This Month
            </button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 30);
                setStartDate(d.toISOString().slice(0, 10));
                setEndDate(today);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-[#8E9F89]/25 bg-white hover:bg-[#FAF8F5] text-[11px] text-[#1A2E20] transition-colors"
            >
              Last 30 Days
            </button>
            <button
              onClick={() => {
                setStartDate("2026-01-01");
                setEndDate(today);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-[#8E9F89]/25 bg-white hover:bg-[#FAF8F5] text-[11px] text-[#1A2E20] transition-colors"
            >
              All Time
            </button>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* 5 OPERATIONAL FINANCE KPI CARDS                                */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* Card 1: Rent Collected */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/20 p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase font-serif tracking-wider text-[#5D7656]">
              Rent Collected
            </span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-200">
              <ArrowDownRight className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-serif text-[#1A2E20]">
              ₹{(cashbook?.totalRentCollected || 0).toLocaleString("en-IN")}
            </span>
            <p className="text-[11px] text-[#5E715C] mt-0.5 font-light">
              Actual money received in period
            </p>
          </div>
        </div>

        {/* Card 2: Security Deposits Held */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/20 p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase font-serif tracking-wider text-[#5D7656]">
              Deposits Held
            </span>
            <div className="w-7 h-7 rounded-lg bg-[#FAF8F5] text-[#B58A57] flex items-center justify-center border border-[#8E9F89]/30">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-serif text-[#1A2E20]">
              ₹{(cashbook?.totalDepositsCollected || 0).toLocaleString("en-IN")}
            </span>
            <p className="text-[11px] text-[#5E715C] mt-0.5 font-light">
              Refundable liability (not rent)
            </p>
          </div>
        </div>

        {/* Card 3: Expenses Paid */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/20 p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase font-serif tracking-wider text-rose-800">
              Expenses Paid
            </span>
            <div className="w-7 h-7 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center border border-rose-200">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-serif text-rose-950">
              ₹{(cashbook?.totalExpensesPaid || 0).toLocaleString("en-IN")}
            </span>
            <p className="text-[11px] text-rose-700/80 mt-0.5 font-light">
              Operational money spent
            </p>
          </div>
        </div>

        {/* Card 4: Net Cash Movement */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/20 p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase font-serif tracking-wider text-[#5D7656]">
              Net Cash Movement
            </span>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
              (cashbook?.netCashMovement || 0) >= 0
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-rose-50 text-rose-700 border-rose-200"
            }`}>
              {(cashbook?.netCashMovement || 0) >= 0 ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
            </div>
          </div>
          <div className="mt-3">
            <span className={`text-2xl font-serif ${
              (cashbook?.netCashMovement || 0) >= 0 ? "text-[#1A2E20]" : "text-rose-700"
            }`}>
              {(cashbook?.netCashMovement || 0) < 0 ? "-" : ""}₹{Math.abs(cashbook?.netCashMovement || 0).toLocaleString("en-IN")}
            </span>
            <p className="text-[11px] text-[#5E715C] mt-0.5 font-light">
              (Rent + Deposits) - Expenses
            </p>
          </div>
        </div>

        {/* Card 5: Total Outstanding Rent */}
        <div className="bg-[#FAF8F5] rounded-2xl border border-[#B58A57]/35 p-4 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase font-serif tracking-wider text-[#654735] font-semibold">
              Outstanding Rent
            </span>
            <div className="w-7 h-7 rounded-lg bg-white text-[#B58A57] flex items-center justify-center border border-[#B58A57]/30">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-2xl font-serif text-[#1A2E20]">
              ₹{(cashbook?.totalOutstandingRent || 0).toLocaleString("en-IN")}
            </span>
            <p className="text-[11px] text-[#654735] mt-0.5 font-light">
              Total billed rent unpaid
            </p>
          </div>
        </div>

      </div>

      {/* ============================================================== */}
      {/* TABS & NAVIGATION                                              */}
      {/* ============================================================== */}
      <div className="flex items-center gap-2 border-b border-[#8E9F89]/20 pb-3">
        <button
          onClick={() => setActiveTab("cashbook")}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-serif font-medium transition-all ${
            activeTab === "cashbook"
              ? "bg-[#1A2E20] text-white shadow-xs"
              : "bg-white text-[#5E715C] hover:text-[#1A2E20] border border-[#8E9F89]/20"
          }`}
        >
          Persistent Cashbook &amp; Ledger ({filteredTransactions.length})
        </button>
        <button
          onClick={() => setActiveTab("residents")}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-serif font-medium transition-all ${
            activeTab === "residents"
              ? "bg-[#1A2E20] text-white shadow-xs"
              : "bg-white text-[#5E715C] hover:text-[#1A2E20] border border-[#8E9F89]/20"
          }`}
        >
          Resident Account Statements ({residents.length})
        </button>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: PERSISTENT CASHBOOK & TRANSACTION LEDGER                */}
      {/* ============================================================== */}
      {activeTab === "cashbook" && (
        <div className="space-y-4">
          
          {/* Filter Bar */}
          <div className="bg-white rounded-2xl border border-[#8E9F89]/20 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-[#5D7656] shrink-0" />
              <input
                type="text"
                placeholder="Search transactions by resident, payee, ref #, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-xs text-[#1A2E20] placeholder-[#5E715C]/60 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#5E715C] uppercase tracking-wider font-serif">Type:</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-none"
              >
                <option value="ALL">All Types</option>
                <option value="RENT_PAYMENT">Rent Payments (In)</option>
                <option value="RENT_CHARGE">Rent Charges (Billed)</option>
                <option value="SECURITY_DEPOSIT">Security Deposits (Held)</option>
                <option value="EXPENSE">Expenses (Out)</option>
                <option value="REVERSAL">Reversals &amp; Corrections</option>
              </select>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="bg-white rounded-2xl sm:rounded-3xl border border-[#8E9F89]/20 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#8E9F89]/15 bg-[#FAF8F5]/80 text-[#5D7656] font-serif uppercase tracking-wider text-[11px]">
                    <th className="py-3.5 px-4 font-semibold">Date &amp; ID</th>
                    <th className="py-3.5 px-4 font-semibold">Type</th>
                    <th className="py-3.5 px-4 font-semibold">Party / Account</th>
                    <th className="py-3.5 px-4 font-semibold">Payment Method &amp; Ref</th>
                    <th className="py-3.5 px-4 font-semibold">Description / Period</th>
                    <th className="py-3.5 px-4 font-semibold text-right">Amount (₹)</th>
                    <th className="py-3.5 px-4 font-semibold text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#8E9F89]/10">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-[#5E715C]">
                        <Receipt className="w-8 h-8 mx-auto text-[#8E9F89]/50 mb-2" />
                        <p className="font-serif text-sm text-[#1A2E20]">No transactions recorded in this period</p>
                        <p className="text-[11px] font-light mt-0.5">
                          Use the action buttons above to record rent payments, rent charges, deposits, or expenses.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => {
                      const isCharge = tx.transactionType === "RENT_CHARGE";
                      const isPayment = tx.transactionType === "RENT_PAYMENT";
                      const isDeposit = tx.transactionType === "SECURITY_DEPOSIT";
                      const isExpense = tx.transactionType === "EXPENSE";
                      const isReversal = tx.transactionType === "REVERSAL";
                      const isReversedStatus = tx.status === "REVERSED";

                      return (
                        <tr
                          key={tx.id}
                          className={`hover:bg-[#FAF8F5]/60 transition-colors ${
                            isReversedStatus ? "opacity-60 bg-stone-50/50" : ""
                          }`}
                        >
                          {/* Date & ID */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className="font-medium text-[#1A2E20] block font-mono">
                              {tx.transactionDate}
                            </span>
                            <span className="text-[10px] text-[#5E715C] font-mono">
                              {tx.id.slice(0, 16)}...
                            </span>
                          </td>

                          {/* Type */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {isPayment && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Rent Payment
                              </span>
                            )}
                            {isCharge && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                                Rent Charge
                              </span>
                            )}
                            {isDeposit && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FAF8F5] text-[#B58A57] border border-[#B58A57]/30">
                                Security Deposit
                              </span>
                            )}
                            {isExpense && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-50 text-rose-800 border border-rose-200">
                                Expense ({tx.category})
                              </span>
                            )}
                            {isReversal && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-stone-100 text-stone-700 border border-stone-300">
                                Reversal
                              </span>
                            )}
                            {isReversedStatus && (
                              <span className="ml-1.5 text-[9px] uppercase font-bold text-red-600">
                                [Reversed]
                              </span>
                            )}
                          </td>

                          {/* Party / Account */}
                          <td className="py-3.5 px-4">
                            {tx.residentName ? (
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-[#1A2E20]">{tx.residentName}</span>
                                {tx.roomNumber && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#FAF8F5] text-[#5D7656] border border-[#8E9F89]/25">
                                    Rm {tx.roomNumber}
                                  </span>
                                )}
                              </div>
                            ) : tx.payeeVendor ? (
                              <span className="font-medium text-[#1A2E20]">{tx.payeeVendor}</span>
                            ) : (
                              <span className="text-[#5E715C] italic">General Operations</span>
                            )}
                          </td>

                          {/* Payment Method & Ref */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {tx.paymentMethod ? (
                              <div>
                                <span className="text-[11px] text-[#1A2E20] font-medium block">
                                  {tx.paymentMethod}
                                </span>
                                {tx.referenceNumber && (
                                  <span className="text-[10px] font-mono text-[#5E715C]">
                                    Ref: {tx.referenceNumber}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-[#5E715C] text-[11px]">&mdash;</span>
                            )}
                          </td>

                          {/* Description / Billing Period */}
                          <td className="py-3.5 px-4 max-w-xs truncate">
                            {tx.billingPeriod && (
                              <span className="block font-medium text-[#1A2E20]">
                                Period: {tx.billingPeriod}
                              </span>
                            )}
                            <span className="text-[#5E715C] text-[11px] truncate block">
                              {tx.description || "&mdash;"}
                            </span>
                          </td>

                          {/* Amount */}
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <span
                              className={`font-mono text-sm font-semibold ${
                                isPayment || isDeposit
                                  ? "text-emerald-700"
                                  : isExpense
                                  ? "text-rose-700"
                                  : isCharge
                                  ? "text-amber-800"
                                  : "text-stone-600"
                              } ${isReversedStatus ? "line-through text-stone-400" : ""}`}
                            >
                              {isPayment || isDeposit ? "+" : isExpense ? "-" : ""}
                              ₹{tx.amount.toLocaleString("en-IN")}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => setReceiptTx(tx)}
                                className="p-1.5 rounded-lg border border-[#8E9F89]/25 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] transition-colors"
                                title="View receipt"
                              >
                                <Receipt className="w-3.5 h-3.5" />
                              </button>

                              {!isReversedStatus && !isReversal && (
                                <button
                                  onClick={() => {
                                    setReversalTarget(tx);
                                    setReversalReason("");
                                  }}
                                  className="p-1.5 rounded-lg border border-[#8E9F89]/25 bg-white hover:bg-rose-50 text-rose-700 transition-colors"
                                  title="Reverse / correct transaction"
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
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: RESIDENT ACCOUNT STATEMENTS                             */}
      {/* ============================================================== */}
      {activeTab === "residents" && (
        <div className="bg-white rounded-2xl sm:rounded-3xl border border-[#8E9F89]/20 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-[#8E9F89]/15 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg text-[#1A2E20]">
                Resident Rent Balances &amp; Statements
              </h3>
              <p className="text-xs text-[#5E715C] mt-0.5 font-light">
                Per-resident rent accounting derived strictly from persisted rent charges and payment receipts.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#8E9F89]/15 bg-[#FAF8F5]/80 text-[#5D7656] font-serif uppercase tracking-wider text-[11px]">
                  <th className="py-3.5 px-4 font-semibold">Resident</th>
                  <th className="py-3.5 px-4 font-semibold">Room / Status</th>
                  <th className="py-3.5 px-4 font-semibold">Contact</th>
                  <th className="py-3.5 px-4 font-semibold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/10">
                {residents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-[#5E715C]">
                      No residents currently registered.
                    </td>
                  </tr>
                ) : (
                  residents.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FAF8F5]/60 transition-colors">
                      <td className="py-3.5 px-4">
                        <span className="font-medium text-[#1A2E20] block">{r.fullName}</span>
                        <span className="text-[10px] text-[#5E715C] font-mono">{r.id}</span>
                      </td>

                      <td className="py-3.5 px-4">
                        {r.currentRoomNumber ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#1A2E20] text-white">
                            Room {r.currentRoomNumber} (Fl {r.currentFloor})
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#5E715C] italic">Unassigned</span>
                        )}
                        <span className="ml-2 text-[10px] text-[#5E715C]">
                          {r.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 font-mono text-[#1A2E20]">
                        {r.phone}
                      </td>

                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleViewResidentSummary(r.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] font-medium text-xs transition-colors"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#5D7656]" />
                            <span>Statement</span>
                          </button>

                          <button
                            onClick={() => {
                              handleResidentSelectForPayment(r.id);
                              setIsPaymentModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white font-medium text-xs transition-colors"
                          >
                            <CreditCard className="w-3.5 h-3.5 text-[#B58A57]" />
                            <span>Collect</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: RECORD RENT PAYMENT                                   */}
      {/* ============================================================== */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-[#8E9F89]/30 shadow-2xl overflow-hidden animate-slide-up">
            <div className="p-6 border-b border-[#8E9F89]/15 flex items-center justify-between bg-[#FAF8F5]">
              <div>
                <span className="text-[10px] font-mono tracking-widest uppercase text-[#5D7656]">
                  PHASE 4 &bull; RENT RECEIPT
                </span>
                <h3 className="font-serif text-xl text-[#1A2E20] font-normal mt-0.5">
                  Record Rent Payment
                </h3>
              </div>
              <button
                onClick={() => setIsPaymentModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white border border-[#8E9F89]/30 flex items-center justify-center text-[#5E715C] hover:text-[#1A2E20]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitPayment} className="p-6 space-y-4">
              {actionError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Select Resident *</label>
                <select
                  required
                  value={paymentForm.residentId}
                  onChange={(e) => handleResidentSelectForPayment(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                >
                  <option value="">-- Choose Resident --</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName} ({r.phone}) {r.currentRoomNumber ? `• Rm ${r.currentRoomNumber}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              {/* Outstanding rent feedback box */}
              {selectedResidentRentBalance !== null && (
                <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#B58A57]/30 flex items-center justify-between text-xs">
                  <span className="text-[#654735]">Current Outstanding Rent:</span>
                  <span className="font-serif font-bold text-sm text-[#1A2E20]">
                    ₹{selectedResidentRentBalance.toLocaleString("en-IN")}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Amount Received (₹) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="8500"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Payment Method *</label>
                  <select
                    value={paymentForm.paymentMethod}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentMethod: e.target.value as PaymentMethod })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  >
                    <option value="UPI">UPI / QR Code</option>
                    <option value="CASH">Cash in Hand</option>
                    <option value="BANK_TRANSFER">Bank IMPS / NEFT</option>
                    <option value="CHEQUE">Bank Cheque</option>
                    <option value="OTHER">Other / POS Card</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Transaction Date *</label>
                  <input
                    type="date"
                    required
                    value={paymentForm.transactionDate}
                    onChange={(e) => setPaymentForm({ ...paymentForm, transactionDate: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Reference / UTR #</label>
                  <input
                    type="text"
                    placeholder="e.g. UPI UTR 429381..."
                    value={paymentForm.referenceNumber}
                    onChange={(e) => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Receipt Notes / Description</label>
                <input
                  type="text"
                  placeholder="e.g. October rent paid via GooglePay"
                  value={paymentForm.description}
                  onChange={(e) => setPaymentForm({ ...paymentForm, description: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#8E9F89]/15">
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-serif text-[#5E715C] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-[#1A2E20] text-white hover:bg-[#263B2D] text-xs font-serif font-medium transition-all shadow-md disabled:opacity-50"
                >
                  {submitting ? "Recording..." : "Confirm & Save Payment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: ISSUE RENT CHARGE                                     */}
      {/* ============================================================== */}
      {isChargeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-[#8E9F89]/30 shadow-2xl overflow-hidden animate-slide-up">
            <div className="p-6 border-b border-[#8E9F89]/15 flex items-center justify-between bg-[#FAF8F5]">
              <div>
                <span className="text-[10px] font-mono tracking-widest uppercase text-[#5D7656]">
                  PHASE 4 &bull; BILLING INVOICE
                </span>
                <h3 className="font-serif text-xl text-[#1A2E20] font-normal mt-0.5">
                  Issue Rent Charge
                </h3>
              </div>
              <button
                onClick={() => setIsChargeModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white border border-[#8E9F89]/30 flex items-center justify-center text-[#5E715C] hover:text-[#1A2E20]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitCharge} className="p-6 space-y-4">
              {actionError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Resident to Bill *</label>
                <select
                  required
                  value={chargeForm.residentId}
                  onChange={(e) => setChargeForm({ ...chargeForm, residentId: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                >
                  <option value="">-- Choose Resident --</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName} ({r.phone}) {r.currentRoomNumber ? `• Rm ${r.currentRoomNumber}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Billing Period *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. October 2026"
                    value={chargeForm.billingPeriod}
                    onChange={(e) => setChargeForm({ ...chargeForm, billingPeriod: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Charge Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="8500"
                    value={chargeForm.amount}
                    onChange={(e) => setChargeForm({ ...chargeForm, amount: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Posting Date *</label>
                <input
                  type="date"
                  required
                  value={chargeForm.transactionDate}
                  onChange={(e) => setChargeForm({ ...chargeForm, transactionDate: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Charge Description</label>
                <input
                  type="text"
                  value={chargeForm.description}
                  onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#8E9F89]/15">
                <button
                  type="button"
                  onClick={() => setIsChargeModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-serif text-[#5E715C] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-[#1A2E20] text-white hover:bg-[#263B2D] text-xs font-serif font-medium transition-all shadow-md disabled:opacity-50"
                >
                  {submitting ? "Posting..." : "Post Rent Charge"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: RECEIVE SECURITY DEPOSIT                              */}
      {/* ============================================================== */}
      {isDepositModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-[#8E9F89]/30 shadow-2xl overflow-hidden animate-slide-up">
            <div className="p-6 border-b border-[#8E9F89]/15 flex items-center justify-between bg-[#FAF8F5]">
              <div>
                <span className="text-[10px] font-mono tracking-widest uppercase text-[#5D7656]">
                  PHASE 4 &bull; DEPOSIT LIABILITY
                </span>
                <h3 className="font-serif text-xl text-[#1A2E20] font-normal mt-0.5">
                  Receive Security Deposit
                </h3>
              </div>
              <button
                onClick={() => setIsDepositModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white border border-[#8E9F89]/30 flex items-center justify-center text-[#5E715C] hover:text-[#1A2E20]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitDeposit} className="p-6 space-y-4">
              {actionError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>
                  <strong>Accounting Rule:</strong> Security deposits are tracked as refundable held liabilities. They do not reduce monthly rent owed and are not counted as rental revenue.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Resident *</label>
                <select
                  required
                  value={depositForm.residentId}
                  onChange={(e) => setDepositForm({ ...depositForm, residentId: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                >
                  <option value="">-- Choose Resident --</option>
                  {residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName} ({r.phone}) {r.currentRoomNumber ? `• Rm ${r.currentRoomNumber}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Deposit Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="17000"
                    value={depositForm.amount}
                    onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Payment Method *</label>
                  <select
                    value={depositForm.paymentMethod}
                    onChange={(e) => setDepositForm({ ...depositForm, paymentMethod: e.target.value as PaymentMethod })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  >
                    <option value="UPI">UPI / QR Code</option>
                    <option value="BANK_TRANSFER">Bank IMPS / NEFT</option>
                    <option value="CASH">Cash in Hand</option>
                    <option value="CHEQUE">Bank Cheque</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Date Received *</label>
                  <input
                    type="date"
                    required
                    value={depositForm.transactionDate}
                    onChange={(e) => setDepositForm({ ...depositForm, transactionDate: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Reference / UTR #</label>
                  <input
                    type="text"
                    placeholder="e.g. UTR 429381..."
                    value={depositForm.referenceNumber}
                    onChange={(e) => setDepositForm({ ...depositForm, referenceNumber: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#8E9F89]/15">
                <button
                  type="button"
                  onClick={() => setIsDepositModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-serif text-[#5E715C] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-[#1A2E20] text-white hover:bg-[#263B2D] text-xs font-serif font-medium transition-all shadow-md disabled:opacity-50"
                >
                  {submitting ? "Recording..." : "Save Deposit Receipt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 4: RECORD EXPENSE                                        */}
      {/* ============================================================== */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-lg w-full border border-[#8E9F89]/30 shadow-2xl overflow-hidden animate-slide-up">
            <div className="p-6 border-b border-[#8E9F89]/15 flex items-center justify-between bg-rose-50/50">
              <div>
                <span className="text-[10px] font-mono tracking-widest uppercase text-rose-800">
                  PHASE 4 &bull; OPERATING EXPENSE
                </span>
                <h3 className="font-serif text-xl text-[#1A2E20] font-normal mt-0.5">
                  Record Business Expense
                </h3>
              </div>
              <button
                onClick={() => setIsExpenseModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white border border-[#8E9F89]/30 flex items-center justify-center text-[#5E715C] hover:text-[#1A2E20]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitExpense} className="p-6 space-y-4">
              {actionError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Expense Category *</label>
                  <select
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value as ExpenseCategory })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  >
                    <option value="GROCERY">Groceries &amp; Provisions</option>
                    <option value="UTILITIES">Electricity &amp; Water</option>
                    <option value="MAINTENANCE">Repairs &amp; Maintenance</option>
                    <option value="STAFF_SALARY">Staff Wages</option>
                    <option value="KITCHEN_SUPPLIES">Kitchen Supplies &amp; Gas</option>
                    <option value="INTERNET">Wi-Fi &amp; Connectivity</option>
                    <option value="MARKETING">Marketing &amp; Listing</option>
                    <option value="OTHER">Other Operational Cost</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Amount Paid (₹) *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="3500"
                    value={expenseForm.amount}
                    onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Payment Method *</label>
                  <select
                    value={expenseForm.paymentMethod}
                    onChange={(e) => setExpenseForm({ ...expenseForm, paymentMethod: e.target.value as PaymentMethod })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  >
                    <option value="UPI">UPI / QR</option>
                    <option value="CASH">Cash in Hand</option>
                    <option value="BANK_TRANSFER">Bank IMPS / NEFT</option>
                    <option value="CHEQUE">Bank Cheque</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Date Paid *</label>
                  <input
                    type="date"
                    required
                    value={expenseForm.transactionDate}
                    onChange={(e) => setExpenseForm({ ...expenseForm, transactionDate: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Payee / Vendor</label>
                  <input
                    type="text"
                    placeholder="e.g. Met City Wholesalers"
                    value={expenseForm.payeeVendor}
                    onChange={(e) => setExpenseForm({ ...expenseForm, payeeVendor: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Reference / Invoice #</label>
                  <input
                    type="text"
                    placeholder="e.g. Bill # 9042"
                    value={expenseForm.referenceNumber}
                    onChange={(e) => setExpenseForm({ ...expenseForm, referenceNumber: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">Description *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Weekly kitchen vegetable supplies"
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#8E9F89]/15">
                <button
                  type="button"
                  onClick={() => setIsExpenseModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-serif text-[#5E715C] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-rose-800 text-white hover:bg-rose-900 text-xs font-serif font-medium transition-all shadow-md disabled:opacity-50"
                >
                  {submitting ? "Recording..." : "Record Expense Outflow"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 5: RECEIPT DOSSIER VIEW                                  */}
      {/* ============================================================== */}
      {receiptTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full border border-[#8E9F89]/30 shadow-2xl overflow-hidden animate-slide-up">
            <div className="p-6 bg-gradient-to-br from-[#1A2E20] to-[#263B2D] text-white flex items-center justify-between">
              <div>
                <span className="text-[10px] font-mono tracking-widest uppercase text-[#B58A57]">
                  TRANSACTION RECEIPT
                </span>
                <h3 className="font-serif text-xl font-normal mt-0.5">
                  Ravinarayan ERP
                </h3>
              </div>
              <button
                onClick={() => setReceiptTx(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
                <span className="text-[#5E715C]">Transaction ID</span>
                <span className="font-mono text-[#1A2E20] font-semibold">{receiptTx.id}</span>
              </div>

              <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
                <span className="text-[#5E715C]">Date</span>
                <span className="font-mono text-[#1A2E20] font-semibold">{receiptTx.transactionDate}</span>
              </div>

              <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
                <span className="text-[#5E715C]">Type</span>
                <span className="font-medium text-[#1A2E20]">{receiptTx.transactionType}</span>
              </div>

              {receiptTx.residentName && (
                <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
                  <span className="text-[#5E715C]">Resident</span>
                  <span className="font-medium text-[#1A2E20]">{receiptTx.residentName}</span>
                </div>
              )}

              {receiptTx.payeeVendor && (
                <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
                  <span className="text-[#5E715C]">Payee / Vendor</span>
                  <span className="font-medium text-[#1A2E20]">{receiptTx.payeeVendor}</span>
                </div>
              )}

              {receiptTx.billingPeriod && (
                <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
                  <span className="text-[#5E715C]">Billing Period</span>
                  <span className="font-medium text-[#1A2E20]">{receiptTx.billingPeriod}</span>
                </div>
              )}

              {receiptTx.paymentMethod && (
                <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
                  <span className="text-[#5E715C]">Payment Method</span>
                  <span className="font-medium text-[#1A2E20]">{receiptTx.paymentMethod}</span>
                </div>
              )}

              {receiptTx.referenceNumber && (
                <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
                  <span className="text-[#5E715C]">Reference / UTR</span>
                  <span className="font-mono text-[#1A2E20]">{receiptTx.referenceNumber}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <span className="font-serif text-sm font-semibold text-[#1A2E20]">Amount Recorded:</span>
                <span className="font-serif text-2xl font-normal text-[#1A2E20]">
                  ₹{receiptTx.amount.toLocaleString("en-IN")}
                </span>
              </div>

              <div className="pt-4 flex justify-end">
                <button
                  onClick={() => setReceiptTx(null)}
                  className="px-5 py-2 rounded-xl bg-[#1A2E20] text-white text-xs font-serif"
                >
                  Close Receipt
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 6: REVERSAL CONFIRMATION                                 */}
      {/* ============================================================== */}
      {reversalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full border border-rose-200 shadow-2xl overflow-hidden animate-slide-up">
            <div className="p-6 bg-rose-50 border-b border-rose-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-rose-700" />
                <h3 className="font-serif text-lg text-rose-950 font-normal">
                  Reverse Financial Transaction
                </h3>
              </div>
              <button
                onClick={() => setReversalTarget(null)}
                className="w-8 h-8 rounded-full bg-white border border-rose-200 flex items-center justify-center text-rose-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReverseTransaction} className="p-6 space-y-4 text-xs">
              <p className="text-[#5E715C] leading-relaxed">
                You are performing an immutable financial reversal for transaction <strong className="text-[#1A2E20] font-mono">{reversalTarget.id}</strong> (₹{reversalTarget.amount.toLocaleString("en-IN")}). The original transaction will be preserved and flagged as REVERSED.
              </p>

              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Reversal Reason (Audit Required) *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="e.g. Accidental duplicate entry corrected by accountant"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  className="w-full px-3 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setReversalTarget(null)}
                  className="px-4 py-2 rounded-xl text-xs font-serif text-[#5E715C]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2.5 rounded-xl bg-rose-800 hover:bg-rose-900 text-white text-xs font-serif font-medium transition-all shadow-md disabled:opacity-50"
                >
                  {submitting ? "Reversing..." : "Confirm Reversal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 7: RESIDENT FINANCIAL STATEMENT DOSSIER                  */}
      {/* ============================================================== */}
      {selectedResidentSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full border border-[#8E9F89]/30 shadow-2xl overflow-hidden animate-slide-up max-h-[90vh] flex flex-col">
            <div className="p-6 bg-[#FAF8F5] border-b border-[#8E9F89]/20 flex items-center justify-between shrink-0">
              <div>
                <span className="text-[10px] font-mono tracking-widest uppercase text-[#5D7656]">
                  RESIDENT FINANCIAL DOSSIER
                </span>
                <h3 className="font-serif text-xl text-[#1A2E20] font-normal mt-0.5">
                  {selectedResidentSummary.fullName}
                </h3>
                <div className="flex items-center gap-2 mt-1 text-xs text-[#5E715C]">
                  <span>{selectedResidentSummary.phone}</span>
                  {selectedResidentSummary.currentRoomNumber && (
                    <span className="px-2 py-0.5 rounded-full bg-[#1A2E20] text-white text-[10px]">
                      Room {selectedResidentSummary.currentRoomNumber}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedResidentSummary(null)}
                className="w-8 h-8 rounded-full bg-white border border-[#8E9F89]/30 flex items-center justify-center text-[#5E715C] hover:text-[#1A2E20]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* 3 Metric cards for resident */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/25 text-center">
                  <span className="text-[10px] uppercase font-serif tracking-wider text-[#5D7656] block">
                    Total Billed Rent
                  </span>
                  <span className="font-serif text-lg text-[#1A2E20] font-bold block mt-1">
                    ₹{selectedResidentSummary.totalRentCharges.toLocaleString("en-IN")}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-emerald-50/60 border border-emerald-200 text-center">
                  <span className="text-[10px] uppercase font-serif tracking-wider text-emerald-800 block">
                    Total Rent Paid
                  </span>
                  <span className="font-serif text-lg text-emerald-900 font-bold block mt-1">
                    ₹{selectedResidentSummary.totalRentPaid.toLocaleString("en-IN")}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-[#FAF8F5] border border-[#B58A57]/40 text-center">
                  <span className="text-[10px] uppercase font-serif tracking-wider text-[#654735] block">
                    Outstanding Rent
                  </span>
                  <span className={`font-serif text-lg font-bold block mt-1 ${
                    selectedResidentSummary.outstandingRentBalance > 0 ? "text-amber-800" : "text-emerald-800"
                  }`}>
                    ₹{selectedResidentSummary.outstandingRentBalance.toLocaleString("en-IN")}
                  </span>
                </div>
              </div>

              {/* Security Deposit Badge */}
              <div className="p-3 rounded-xl bg-white border border-[#8E9F89]/20 flex items-center justify-between text-xs">
                <span className="text-[#5D7656]">Security Deposit Held (Refundable Liability):</span>
                <span className="font-serif font-bold text-sm text-[#1A2E20]">
                  ₹{selectedResidentSummary.totalSecurityDepositHeld.toLocaleString("en-IN")}
                </span>
              </div>

              {/* Resident Transaction History */}
              <div>
                <h4 className="font-serif text-sm font-semibold text-[#1A2E20] mb-2">
                  Account Ledger History
                </h4>
                <div className="border border-[#8E9F89]/20 rounded-2xl overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-[#FAF8F5] text-[10px] font-serif uppercase tracking-wider text-[#5D7656] border-b border-[#8E9F89]/15">
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3">Description</th>
                        <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#8E9F89]/10">
                      {selectedResidentSummary.transactions.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-[#5E715C]">
                            No transactions recorded for this resident.
                          </td>
                        </tr>
                      ) : (
                        selectedResidentSummary.transactions.map((t) => (
                          <tr key={t.id}>
                            <td className="py-2.5 px-3 font-mono">{t.transactionDate}</td>
                            <td className="py-2.5 px-3 font-medium">
                              {t.transactionType === "RENT_PAYMENT"
                                ? "Rent Payment"
                                : t.transactionType === "RENT_CHARGE"
                                ? "Rent Charge"
                                : t.transactionType === "SECURITY_DEPOSIT"
                                ? "Security Deposit"
                                : t.transactionType}
                            </td>
                            <td className="py-2.5 px-3 text-[#5E715C] max-w-[200px] truncate">
                              {t.description || t.billingPeriod || "&mdash;"}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-semibold">
                              {t.transactionType === "RENT_PAYMENT" || t.transactionType === "SECURITY_DEPOSIT"
                                ? `+₹${t.amount.toLocaleString("en-IN")}`
                                : `₹${t.amount.toLocaleString("en-IN")}`}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="p-4 bg-[#FAF8F5] border-t border-[#8E9F89]/20 flex justify-end shrink-0">
              <button
                onClick={() => setSelectedResidentSummary(null)}
                className="px-5 py-2 rounded-xl bg-[#1A2E20] text-white text-xs font-serif"
              >
                Close Statement
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
