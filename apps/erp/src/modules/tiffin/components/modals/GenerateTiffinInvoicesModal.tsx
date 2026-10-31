"use client";

import React, { useState } from "react";
import { X, FileText, CheckCircle2, AlertCircle, AlertTriangle, ShieldCheck, Calendar, Info } from "lucide-react";
import { TiffinBillingPeriodPreview, GenerateTiffinInvoicesResult } from "@/types";

interface GenerateTiffinInvoicesModalProps {
  isOpen: boolean;
  onClose: () => void;
  billingPeriod: string;
  preview: TiffinBillingPeriodPreview | null;
  onSuccess: (result: GenerateTiffinInvoicesResult) => void;
}

export function GenerateTiffinInvoicesModal({
  isOpen,
  onClose,
  billingPeriod,
  preview,
  onSuccess,
}: GenerateTiffinInvoicesModalProps) {
  const [issueImmediately, setIssueImmediately] = useState(true);
  const [paymentTermsDays, setPaymentTermsDays] = useState(15);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !preview) return null;

  const unbilledCustomers = preview.customers.filter((c) => !c.alreadyBilled && c.totalAmount > 0);
  const zeroMealCustomers = preview.customers.filter((c) => !c.alreadyBilled && c.totalAmount === 0);
  const alreadyBilledCustomers = preview.customers.filter((c) => c.alreadyBilled);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/tiffin/billing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billingPeriod,
          issueImmediately,
          paymentTermsDays,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate tiffin invoices.");
      }

      onSuccess(data.result);
      onClose();
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-xl w-full my-6 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#1A2E20]/5 rounded-xl text-[#1A2E20]">
              <FileText className="w-5 h-5 text-[#B58A57]" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#1A2E20]">
                Generate Tiffin Invoices
              </h2>
              <p className="text-xs text-gray-500">
                Period: <span className="font-semibold text-[#1A2E20]">{billingPeriod}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Verification Scope Summary */}
          <div className="bg-white border border-[#8E9F89]/20 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-[#1A2E20] border-b border-gray-100 pb-2">
              <span>Billing Preview Summary</span>
              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-mono text-[11px]">
                Verified Fulfilment
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 text-center">
              <div className="p-2 bg-[#FAF8F5] rounded-lg">
                <div className="text-[10px] text-gray-500 uppercase font-bold">Unbilled Customers</div>
                <div className="text-sm font-bold text-[#1A2E20]">{unbilledCustomers.length}</div>
              </div>
              <div className="p-2 bg-[#FAF8F5] rounded-lg">
                <div className="text-[10px] text-gray-500 uppercase font-bold">Verified Meals</div>
                <div className="text-sm font-bold text-emerald-700">{preview.totalBillableDeliveredMeals}</div>
              </div>
              <div className="p-2 bg-[#FAF8F5] rounded-lg">
                <div className="text-[10px] text-gray-500 uppercase font-bold">Total Billable</div>
                <div className="text-sm font-bold text-[#B58A57]">₹{preview.totalProjectedAmount.toLocaleString("en-IN")}</div>
              </div>
            </div>
          </div>

          {/* Idempotency Info */}
          {alreadyBilledCustomers.length > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex items-start gap-2">
              <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
              <div>
                <span className="font-semibold">Idempotency Guard Active:</span>{" "}
                {alreadyBilledCustomers.length} customer(s) already have invoices for {billingPeriod} and will be safely preserved without duplicates.
              </div>
            </div>
          )}

          {zeroMealCustomers.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <div>
                <span className="font-semibold">{zeroMealCustomers.length} Customer(s) with 0 Verified Meals:</span>{" "}
                Customers with 0 delivered meals or flat packages with 0 active days will be skipped.
              </div>
            </div>
          )}

          {/* Invoice Mode */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#1A2E20]">
              Generation Lifecycle Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setIssueImmediately(true)}
                className={`p-3 rounded-xl border text-left text-xs transition-all ${
                  issueImmediately
                    ? "border-[#1A2E20] bg-[#1A2E20]/5 font-semibold text-[#1A2E20]"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}
              >
                <div className="font-bold flex items-center gap-1.5 text-emerald-800">
                  <ShieldCheck className="w-4 h-4" /> Issue Immediately (Final)
                </div>
              </button>

              <button
                type="button"
                onClick={() => setIssueImmediately(false)}
                className={`p-3 rounded-xl border text-left text-xs transition-all ${
                  !issueImmediately
                    ? "border-[#1A2E20] bg-[#1A2E20]/5 font-semibold text-[#1A2E20]"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                }`}
              >
                <div className="font-bold flex items-center gap-1.5 text-gray-800">
                  <FileText className="w-4 h-4" /> Save as Drafts
                </div>
              </button>
            </div>
          </div>

          {/* Payment Terms */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
                Payment Terms
              </label>
              <select
                value={paymentTermsDays}
                onChange={(e) => setPaymentTermsDays(Number(e.target.value))}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
              >
                <option value={7}>Net 7 Days</option>
                <option value={15}>Net 15 Days (Standard)</option>
                <option value={30}>Net 30 Days (Corporate)</option>
                <option value={0}>Immediate / Due on Receipt</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
                Tax Type
              </label>
              <input
                type="text"
                disabled
                value="Regular Bill (0% GST Exempt Food)"
                className="w-full px-3 py-2 bg-gray-100 border border-[#8E9F89]/20 rounded-xl text-xs text-gray-600"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
              Invoice Memo / Public Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Monthly commercial tiffin delivery billing"
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || unbilledCustomers.length === 0}
              className="px-4 py-2 bg-[#1A2E20] text-[#FAF8F5] rounded-xl text-xs font-bold hover:bg-[#1A2E20]/90 transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
            >
              {submitting ? (
                <>Processing...</>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Generate {unbilledCustomers.length} Invoices
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
