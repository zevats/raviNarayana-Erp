"use client";

import React, { useState, useEffect, useCallback } from "react";
import { StatStrip } from "@/components/ui/kit";
import {
  Calendar,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle,
  FileText,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Layers,
  Truck,
  RotateCcw,
  Save,
  Check,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import {
  DailyClosingPreview,
  DailyClosingRecord,
  ClosingDivision,
  PaymentMethod,
} from "@/types";
import { toLocalDateString } from "../utils/dateUtils";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { formatNumberIN, formatMoney } from "@/lib/format";

interface DailyClosingViewProps {
  onMutationSuccess?: (message: string) => void;
  onMutationError?: (message: string) => void;
}

export function DailyClosingView({
  onMutationSuccess,
  onMutationError,
}: DailyClosingViewProps) {
  // Draft, finalize and reopen require finance.manage (Owner); the server enforces this too.
  const canManageFinance = useHasPermission("finance.manage");
  const [selectedDate, setSelectedDate] = useState<string>(toLocalDateString());
  const [selectedDivision, setSelectedDivision] = useState<ClosingDivision>("COMBINED");
  const [preview, setPreview] = useState<DailyClosingPreview | null>(null);
  const [historicalClosings, setHistoricalClosings] = useState<DailyClosingRecord[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form input states
  const [actualCashCounted, setActualCashCounted] = useState<string>("");
  const [actualBankVerified, setActualBankVerified] = useState<string>("");
  const [discrepancyReason, setDiscrepancyReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Reopen modal states
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  // Load preview data for selected date & division
  const fetchPreview = useCallback(async (date: string, division: ClosingDivision) => {
    setIsLoadingPreview(true);
    try {
      const res = await fetch(`/api/finance/closing/preview?closingDate=${date}&division=${division}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load closing preview.");
      }
      setPreview(data.preview);

      // Pre-fill fields if existing record exists
      if (data.preview.existingClosing) {
        const ec = data.preview.existingClosing;
        setActualCashCounted(ec.actualCashCounted !== null ? String(ec.actualCashCounted) : "");
        setActualBankVerified(ec.actualBankVerified !== null ? String(ec.actualBankVerified) : "");
        setDiscrepancyReason(ec.discrepancyReason || "");
        setNotes(ec.notes || "");
      } else {
        setActualCashCounted(String(data.preview.expectedCashBalance));
        setActualBankVerified("");
        setDiscrepancyReason("");
        setNotes("");
      }
    } catch (err: any) {
      if (onMutationError) onMutationError(err.message);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [onMutationError]);

  // Load historical closings
  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const res = await fetch("/api/finance/closing", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setHistoricalClosings(data.closings || []);
      }
    } catch (err: any) {
      console.error("Error loading closing history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchPreview(selectedDate, selectedDivision);
  }, [selectedDate, selectedDivision, fetchPreview]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Derived calculation
  const parsedCashCounted = actualCashCounted.trim() === "" ? NaN : Number(actualCashCounted);
  const parsedBankVerified = actualBankVerified.trim() === "" ? null : Number(actualBankVerified);
  const cashDiscrepancy = !isNaN(parsedCashCounted) && preview
    ? parsedCashCounted - preview.expectedCashBalance
    : 0;

  const isFinalized = preview?.existingClosing?.status === "FINALIZED";

  // Handle Save Draft
  const handleSaveDraft = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/finance/closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "draft",
          closingDate: selectedDate,
          division: selectedDivision,
          actualCashCounted: !isNaN(parsedCashCounted) ? parsedCashCounted : null,
          actualBankVerified: parsedBankVerified,
          discrepancyReason: discrepancyReason.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save closing draft.");

      if (onMutationSuccess) onMutationSuccess("Daily closing draft saved successfully.");
      await fetchPreview(selectedDate, selectedDivision);
      await fetchHistory();
    } catch (err: any) {
      if (onMutationError) onMutationError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Finalize
  const handleFinalize = async () => {
    if (isNaN(parsedCashCounted) || parsedCashCounted < 0) {
      if (onMutationError) onMutationError("Please enter a valid, non-negative cash count.");
      return;
    }

    if (cashDiscrepancy !== 0 && (!discrepancyReason.trim() || discrepancyReason.trim().length < 5)) {
      if (onMutationError) {
        onMutationError("A justification reason of at least 5 characters is mandatory when closing with a cash discrepancy.");
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/finance/closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "finalize",
          closingDate: selectedDate,
          division: selectedDivision,
          actualCashCounted: parsedCashCounted,
          actualBankVerified: parsedBankVerified,
          discrepancyReason: discrepancyReason.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to finalize closing.");

      if (onMutationSuccess) onMutationSuccess(`Daily closing for ${selectedDate} finalized and locked successfully.`);
      await fetchPreview(selectedDate, selectedDivision);
      await fetchHistory();
    } catch (err: any) {
      if (onMutationError) onMutationError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Reopen
  const handleReopen = async () => {
    if (!preview?.existingClosing?.id) return;
    if (!reopenReason.trim() || reopenReason.trim().length < 5) {
      if (onMutationError) onMutationError("A reason of at least 5 characters is required to reopen.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/finance/closing/${preview.existingClosing.id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reopenReason.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reopen closing.");

      if (onMutationSuccess) onMutationSuccess(`Daily closing for ${selectedDate} has been reopened.`);
      setIsReopenModalOpen(false);
      setReopenReason("");
      await fetchPreview(selectedDate, selectedDivision);
      await fetchHistory();
    } catch (err: any) {
      if (onMutationError) onMutationError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const channelList: PaymentMethod[] = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "OTHER"];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 1. Header Toolbar: Date & Division Selector */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-4 bg-white border border-[#8E9F89]/20 rounded-2xl shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/20 rounded-xl text-xs font-medium text-[#1A2E20]">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-semibold focus:outline-hidden"
            />
          </div>

          {/* Division Selector */}
          <div className="inline-flex p-1 bg-[#FAF8F5] border border-[#8E9F89]/20 rounded-xl text-xs font-semibold gap-1">
            <button
              type="button"
              onClick={() => setSelectedDivision("COMBINED")}
              aria-pressed={selectedDivision === "COMBINED"}
              className={`px-3 py-1 rounded-lg transition-all ${
                selectedDivision === "COMBINED"
                  ? "bg-[#1A2E20] text-white shadow-xs"
                  : "text-[#5A6C5E] hover:text-[#1A2E20]"
              }`}
            >
              Combined
            </button>
            <button
              type="button"
              onClick={() => setSelectedDivision("PG")}
              aria-pressed={selectedDivision === "PG"}
              className={`px-3 py-1 rounded-lg transition-all ${
                selectedDivision === "PG"
                  ? "bg-[#1A2E20] text-white shadow-xs"
                  : "text-[#5A6C5E] hover:text-[#1A2E20]"
              }`}
            >
              PG
            </button>
            <button
              type="button"
              onClick={() => setSelectedDivision("TIFFIN")}
              aria-pressed={selectedDivision === "TIFFIN"}
              className={`px-3 py-1 rounded-lg transition-all ${
                selectedDivision === "TIFFIN"
                  ? "bg-[#1A2E20] text-white shadow-xs"
                  : "text-[#5A6C5E] hover:text-[#1A2E20]"
              }`}
            >
              Tiffin
            </button>
          </div>
        </div>

        {/* Status Pill */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {preview?.existingClosing?.status === "FINALIZED" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#E6F1E4] text-[#2F6B24] border border-transparent rounded-full text-xs font-bold">
              <Lock className="w-3.5 h-3.5" />
              FINALIZED &amp; LOCKED
            </span>
          ) : preview?.existingClosing?.status === "REOPENED" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#FBF4E6] text-[#8F6710] border border-transparent rounded-full text-xs font-bold">
              <Unlock className="w-3.5 h-3.5" />
              REOPENED DRAFT
            </span>
          ) : preview?.existingClosing?.status === "DRAFT" ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-black/[0.045] text-[var(--rn-ink-2)] border border-transparent rounded-full text-xs font-bold">
              <FileText className="w-3.5 h-3.5" />
              SAVED DRAFT
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-neutral-100 text-neutral-800 border border-neutral-300 rounded-full text-xs font-bold">
              <RotateCcw className="w-3.5 h-3.5" />
              Not closed yet
            </span>
          )}
        </div>
      </div>

      {/* Late Entries Alert Banner */}
      {preview?.hasLateTransactions && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-3 shadow-xs">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-bold text-sm">
              Post-Closing Discrepancy: Late Transactions Detected!
            </p>
            <p>
              {preview.lateTransactionCount} financial transaction(s) were recorded for this date
              after the daily closing was locked, with a balance delta of ₹
              {formatNumberIN(preview.lateTransactionDelta)}. The historical snapshot
              remains locked. To reconcile these transactions, an authorized manager must reopen this closing.
            </p>
          </div>
        </div>
      )}

      {/* Day figures (same values and definitions as before) */}
      <StatStrip
        items={[
          { label: "Opening cash", value: `₹${formatNumberIN(preview?.openingCashBalance || 0)}` },
          { label: "Money in", value: `+₹${formatNumberIN(preview?.totalInflow || 0)}`, note: `cash +₹${formatNumberIN(preview?.channelBreakdown.CASH.inflow || 0)}`, tone: (preview?.totalInflow || 0) > 0 ? "good" : "default" },
          { label: "Money out", value: `−₹${formatNumberIN(preview?.totalOutflow || 0)}`, note: `cash −₹${formatNumberIN(preview?.channelBreakdown.CASH.outflow || 0)}`, tone: (preview?.totalOutflow || 0) > 0 ? "bad" : "default" },
          { label: "Expected cash in hand", value: `₹${formatNumberIN(preview?.expectedCashBalance || 0)}` },
        ]}
      />

      {/* 3. Channel Breakdown & Delivery Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Multi-Channel Table */}
        <div className="xl:col-span-2 bg-white border border-[#8E9F89]/20 rounded-2xl shadow-2xs p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#1A2E20] flex items-center gap-2">
              Payments by channel
            </h3>
            <span className="text-xs text-[#5A6C5E]">
              {preview?.transactions.length || 0} entries
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse rn-mcards rn-mcards-soft max-lg:[&_tbody]:!px-0">
              <thead>
                <tr className="border-b border-[#8E9F89]/20 text-[#5A6C5E] font-semibold bg-[#FAF8F5]">
                  <th className="py-2.5 px-3">Channel</th>
                  <th className="py-2.5 px-3 text-right">Money in</th>
                  <th className="py-2.5 px-3 text-right">Money out</th>
                  <th className="py-2.5 px-3 text-right">Net</th>
                  <th className="py-2.5 px-3 text-center">Entries</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/10">
                {channelList.map((ch) => {
                  const b = preview?.channelBreakdown[ch];
                  return (
                    <tr key={ch} className="hover:bg-neutral-50/60">
                      <td data-m="title" className="py-2.5 px-3 font-semibold text-[#1A2E20]">
                        {ch === "BANK_TRANSFER" ? "Bank transfer" : ch === "UPI" ? "UPI" : ch.charAt(0) + ch.slice(1).toLowerCase()}
                      </td>
                      <td data-m="kv" className="py-2.5 px-3 text-right tabular-nums text-[var(--rn-ink)]">
                        ₹{formatNumberIN(b?.inflow || 0)}
                      </td>
                      <td data-m="kv" className="py-2.5 px-3 text-right tabular-nums text-[var(--rn-ink)]">
                        ₹{formatNumberIN(b?.outflow || 0)}
                      </td>
                      <td data-m="badge" className="py-2.5 px-3 text-right font-bold text-[#1A2E20]">
                        {formatMoney(b?.net || 0)}
                      </td>
                      <td data-m="hide" className="py-2.5 px-3 text-center text-[#5A6C5E]">
                        {b?.transactionCount || 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Delivery Operational Summary Card */}
        <div className="bg-white border border-[#8E9F89]/20 rounded-2xl shadow-2xs p-5 space-y-4">
          <h3 className="text-sm font-bold text-[#1A2E20] flex items-center gap-2">
            Deliveries this day
          </h3>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-[#8E9F89]/10">
              <span className="text-[#5A6C5E]">Stops</span>
              <span className="font-bold text-[#1A2E20]">{preview?.deliverySummary.totalTasks || 0}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#8E9F89]/10">
              <span className="text-[#5A6C5E]">Delivered</span>
              <span className="font-semibold text-[var(--rn-ink)]">
                {preview?.deliverySummary.deliveredCount || 0}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#8E9F89]/10">
              <span className="text-[#5A6C5E]">Room meals</span>
              <span className="font-semibold text-[#1A2E20]">
                {preview?.deliverySummary.residentTasks || 0}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#8E9F89]/10">
              <span className="text-[#5A6C5E]">Tiffin deliveries</span>
              <span className="font-semibold text-[#1A2E20]">
                {preview?.deliverySummary.externalTasks || 0}
              </span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#8E9F89]/10">
              <span className="text-[#5A6C5E]">Problems</span>
              <span
                className={`font-semibold ${
                  (preview?.deliverySummary.exceptionCount || 0) > 0 ? "text-rose-600 font-bold" : "text-[#5A6C5E]"
                }`}
              >
                {preview?.deliverySummary.exceptionCount || 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Physical Count & Reconciliation Form */}
      <div className="bg-white border border-[#8E9F89]/20 rounded-2xl shadow-2xs p-6 space-y-5">
        <h3 className="text-base font-bold text-[#1A2E20] flex items-center gap-2">
          Count and sign off
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Actual Cash Counted */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1A2E20]">
              Cash counted (₹)
            </label>
            <input
              type="number"
              disabled={isFinalized}
              value={actualCashCounted}
              onChange={(e) => setActualCashCounted(e.target.value)}
              placeholder="e.g. 15000"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#8E9F89]/30 text-sm font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20 disabled:bg-neutral-100 disabled:text-neutral-500"
            />
            <p className="text-[11px] text-[#5A6C5E]">
              Expected: ₹{formatNumberIN(preview?.expectedCashBalance || 0)}
            </p>
          </div>

          {/* Actual Bank Balance Verified */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1A2E20]">
              Verified Bank / UPI Balance (₹) (Optional)
            </label>
            <input
              type="number"
              disabled={isFinalized}
              value={actualBankVerified}
              onChange={(e) => setActualBankVerified(e.target.value)}
              placeholder="Verified online account balance"
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#8E9F89]/30 text-sm font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20 disabled:bg-neutral-100 disabled:text-neutral-500"
            />
          </div>

          {/* Discrepancy Status Card */}
          <div className="p-4 rounded-xl border border-[#8E9F89]/20 bg-[#FAF8F5] flex flex-col justify-center space-y-1">
            <span className="text-xs text-[#5A6C5E] font-medium">Cash Discrepancy</span>
            <div className="flex items-center gap-2">
              {cashDiscrepancy === 0 ? (
                <>
                  <CheckCircle className="w-5 h-5 text-[#2F6B24] shrink-0" />
                  <span className="text-sm font-semibold text-[var(--rn-ink)]">₹0 · matches</span>
                </>
              ) : cashDiscrepancy > 0 ? (
                <>
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                  <span className="text-sm font-bold text-amber-700">
                    +₹{formatNumberIN(cashDiscrepancy)} (Surplus)
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
                  <span className="text-sm font-bold text-rose-700">
                    -₹{formatNumberIN(Math.abs(cashDiscrepancy))} (Shortage)
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Discrepancy Reason Field (Mandatory if variance != 0) */}
        {cashDiscrepancy !== 0 && (
          <div className="space-y-1.5 p-4 bg-amber-50/70 border border-amber-200 rounded-xl">
            <label className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              Discrepancy Justification Reason * (Mandatory when variance exists)
            </label>
            <textarea
              disabled={isFinalized}
              rows={2}
              value={discrepancyReason}
              onChange={(e) => setDiscrepancyReason(e.target.value)}
              placeholder="Explain the root cause of the cash surplus or shortage (min 5 characters)..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-amber-300 text-xs text-amber-950 focus:outline-hidden focus:ring-2 focus:ring-amber-500/20 disabled:bg-neutral-100 disabled:text-neutral-500"
            />
            <p className="text-[10px] text-amber-800">
              {discrepancyReason.trim().length < 5
                ? `Minimum 5 characters required (${discrepancyReason.trim().length}/5)`
                : "Justification valid."}
            </p>
          </div>
        )}

        {/* Notes */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-[#1A2E20]">
            General Closing Notes / Remarks
          </label>
          <input
            type="text"
            disabled={isFinalized}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Reconciled with evening cashier Shift B"
            className="w-full px-3.5 py-2.5 rounded-xl border border-[#8E9F89]/30 text-xs focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20 disabled:bg-neutral-100 disabled:text-neutral-500"
          />
        </div>

        {/* Actions Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#8E9F89]/20">
          <div>
            {preview?.existingClosing?.finalizedByName && (
              <p className="text-xs text-[#5A6C5E]">
                Finalized by <span className="font-semibold text-[#1A2E20]">{preview.existingClosing.finalizedByName}</span> at{" "}
                {new Date(preview.existingClosing.finalizedAt!).toLocaleString("en-IN")}
              </p>
            )}
            {preview?.existingClosing?.reopenedByName && (
              <p className="text-xs text-amber-800">
                Reopened by {preview.existingClosing.reopenedByName}: {preview.existingClosing.reopenReason}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!canManageFinance ? (
              <p className="text-xs text-[#5C6B5A]">
                Only the Owner can close the day.
              </p>
            ) : !isFinalized ? (
              <>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSaveDraft}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-[#8E9F89]/40 text-xs font-semibold text-[#1A2E20] hover:bg-neutral-50 transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save Draft
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleFinalize}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1A2E20] text-white text-xs font-bold hover:bg-[#2A4430] transition-colors shadow-xs"
                >
                  Finalize &amp; Lock Closing
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsReopenModalOpen(true)}
                className="rn-btn"
              >
                <Unlock />
                Reopen Finalized Closing
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 5. Historical Daily Closings Register */}
      <div className="bg-white border border-[#8E9F89]/20 rounded-2xl shadow-2xs p-5 space-y-4">
        <h3 className="text-sm font-bold text-[#1A2E20] flex items-center gap-2">
          Past closings
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse rn-mcards rn-mcards-soft max-lg:[&_tbody]:!px-0">
            <thead>
              <tr className="border-b border-[#8E9F89]/20 text-[#5A6C5E] font-semibold bg-[#FAF8F5]">
                <th className="py-2.5 px-3">Date</th>
                <th className="py-2.5 px-3">Division</th>
                <th className="py-2.5 px-3 text-right">Money in</th>
                <th className="py-2.5 px-3 text-right">Money out</th>
                <th className="py-2.5 px-3 text-right">Expected cash</th>
                <th className="py-2.5 px-3 text-right">Counted cash</th>
                <th className="py-2.5 px-3 text-right">Difference</th>
                <th className="py-2.5 px-3 text-center">Status</th>
                <th className="py-2.5 px-3 text-right">Closed by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#8E9F89]/10">
              {historicalClosings.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-[#5A6C5E]">
                    No past closings
                  </td>
                </tr>
              ) : (
                historicalClosings.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => {
                      setSelectedDate(c.closingDate);
                      setSelectedDivision(c.division);
                    }}
                    className="hover:bg-neutral-50/80 cursor-pointer transition-colors"
                  >
                    <td data-m="title" className="py-2.5 px-3 font-bold text-[#1A2E20]">{c.closingDate}</td>
                    <td data-m="line" className="py-2.5 px-3 text-[#5A6C5E]">{c.division === "COMBINED" ? "PG and Tiffin" : c.division === "PG" ? "PG" : "Tiffin"}</td>
                    <td data-m="kv" className="py-2.5 px-3 text-right tabular-nums text-[var(--rn-ink)]">
                      ₹{formatNumberIN(c.totalInflow)}
                    </td>
                    <td data-m="kv" className="py-2.5 px-3 text-right tabular-nums text-[var(--rn-ink)]">
                      ₹{formatNumberIN(c.totalOutflow)}
                    </td>
                    <td data-m="kv" className="py-2.5 px-3 text-right font-medium text-[#1A2E20]">
                      ₹{formatNumberIN(c.expectedCashBalance)}
                    </td>
                    <td data-m="kv" className="py-2.5 px-3 text-right font-bold text-[#1A2E20]">
                      {c.actualCashCounted !== null ? `₹${formatNumberIN(c.actualCashCounted)}` : "—"}
                    </td>
                    <td data-m="kv" className="py-2.5 px-3 text-right">
                      {c.cashDiscrepancy === 0 ? (
                        <span className="text-[var(--rn-ink-3)]">₹0</span>
                      ) : (
                        <span className="text-rose-600 font-bold">
                          {c.cashDiscrepancy > 0 ? "+" : ""}₹{formatNumberIN(c.cashDiscrepancy)}
                        </span>
                      )}
                    </td>
                    <td data-m="badge" className="py-2.5 px-3 text-center">
                      {c.status === "FINALIZED" ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#E6F1E4] text-[#2F6B24]">
                          Closed
                        </span>
                      ) : c.status === "REOPENED" ? (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FBF4E6] text-[#8F6710]">
                          Reopened
                        </span>
                      ) : (
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/[0.045] text-[var(--rn-ink-2)]">
                          Draft
                        </span>
                      )}
                    </td>
                    <td data-m="hide" className="py-2.5 px-3 text-right text-[#5A6C5E]">
                      {c.finalizedByName || c.preparedByName || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reopen Modal */}
      {isReopenModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-2xs animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-[#1A2E20] flex items-center gap-2">
              <Unlock className="w-5 h-5 text-amber-600" />
              Reopen Finalized Daily Closing
            </h3>
            <p className="text-xs text-[#5A6C5E]">
              Reopening will unlock the daily closing for <span className="font-semibold text-[#1A2E20]">{selectedDate}</span>. An audit event will be permanently recorded.
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#1A2E20]">
                Reopening Justification Reason *
              </label>
              <textarea
                rows={3}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="State why this finalized closing is being unlocked (e.g. correcting mistaken cash drawer count)..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#8E9F89]/30 text-xs focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsReopenModalOpen(false);
                  setReopenReason("");
                }}
                className="px-4 py-2 rounded-xl border border-neutral-300 text-xs font-semibold text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmitting || reopenReason.trim().length < 5}
                onClick={handleReopen}
                className="px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 disabled:opacity-50"
              >
                Confirm Reopening
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
