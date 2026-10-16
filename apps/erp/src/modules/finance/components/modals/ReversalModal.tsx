"use client";

import React, { useState } from "react";
import { X, ShieldAlert, AlertCircle } from "lucide-react";
import { FinancialTransaction } from "@/types";
import { formatINR } from "../../utils/formatUtils";

interface ReversalModalProps {
  transaction: FinancialTransaction | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function ReversalModal({ transaction, onClose, onSuccess }: ReversalModalProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!transaction) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!reason.trim()) {
      setError("An audit reason is required to reverse a financial transaction.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REVERSAL",
          transactionId: transaction.id,
          reason: reason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to reverse transaction.");
      }

      onSuccess(
        `Transaction ${transaction.id} (${formatINR(transaction.amount)}) successfully reversed.`
      );
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to reverse transaction.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-2xs animate-fade-in">
      <div className="bg-white rounded-3xl max-w-md w-full border border-rose-200 shadow-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="p-5 sm:p-6 bg-rose-50 border-b border-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-rose-700" />
            <h3 className="font-serif text-lg text-rose-950 font-normal">
              Reverse Financial Transaction
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white border border-rose-200 flex items-center justify-center text-rose-800 hover:text-rose-950 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2 shadow-2xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[#5E715C]">Target Transaction:</span>
              <span className="font-mono font-semibold text-[#1A2E20]">{transaction.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#5E715C]">Type &amp; Date:</span>
              <span className="text-[#1A2E20] font-medium">
                {transaction.transactionType} ({transaction.transactionDate})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#5E715C]">Amount:</span>
              <span className="font-mono font-bold text-[#1A2E20] text-sm">
                {formatINR(transaction.amount)}
              </span>
            </div>
          </div>

          <p className="text-[#5E715C] leading-relaxed">
            This will record an auditable reversal. The original transaction will be preserved and flagged as{" "}
            <strong className="text-rose-800 uppercase font-semibold">REVERSED</strong>. Any associated resident rent balance will be updated automatically.
          </p>

          <div>
            <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Reversal Reason (Required for Audit Trail) *
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Inadvertent double payment receipt corrected by accounts manager"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-xs text-[#5E715C] hover:text-[#1A2E20] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-rose-800 hover:bg-rose-900 text-white text-xs font-medium transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              {submitting ? "Reversing..." : "Confirm & Execute Reversal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
