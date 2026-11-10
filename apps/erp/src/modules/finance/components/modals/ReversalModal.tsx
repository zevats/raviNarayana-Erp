"use client";

import { friendlyError } from "@/lib/friendlyError";
import React, { useState, useRef } from "react";
import { X, ShieldAlert, AlertCircle } from "lucide-react";
import { FinancialTransaction } from "@/types";
import { formatINR } from "../../utils/formatUtils";

interface ReversalModalProps {
  transaction: FinancialTransaction | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}

export function ReversalModal({
  transaction,
  onClose,
  onSuccess,
}: ReversalModalProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Ignores a second activation while a save is being sent (state-based disabling only applies after a render).
  const inFlight = useRef(false);

  if (!transaction) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanReason = reason.trim();
    if (!cleanReason || cleanReason.length < 5) {
      setError("Please provide a meaningful reversal reason of at least 5 characters.");
      return;
    }

    if (inFlight.current) return;

    inFlight.current = true;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/finance/transactions?id=${transaction.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cleanReason }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to reverse transaction.");
      }

      onSuccess(
        `Transaction ${transaction.id} successfully reversed. Balances have been recomputed.`
      );
      onClose();
    } catch (err: any) {
      setError(friendlyError(err.message || "An error occurred while reversing transaction."));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 rn-modal-scrim">
      <div className="rn-modal bg-white rounded-3xl border border-[#8E9F89]/30 max-w-md w-full p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-900 text-white flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                Reverse Transaction
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 space-y-1.5">
            <div className="flex justify-between">
              <span className="text-[#5A6C5E]">Entry</span>
              <span className="font-sans font-semibold text-[#1A2E20]">#{transaction.id.replace(/^[a-z]{2,6}_/, "").replace(/-/g, "").slice(0, 6).toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#5A6C5E]">Type &amp; Date:</span>
              <span className="text-[#1A2E20] font-medium font-sans">
                {transaction.transactionType} ({transaction.transactionDate})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#5A6C5E]">Amount:</span>
              <span className="font-sans font-bold text-[#1A2E20] text-sm tabular-nums">
                {formatINR(transaction.amount)}
              </span>
            </div>
          </div>

          <p className="text-[#5A6C5E] leading-relaxed">
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
              className="w-full px-3.5 py-2 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#8E9F89]/20">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-rose-800 hover:bg-rose-900 text-white text-xs font-semibold shadow-xs disabled:opacity-50"
            >
              {submitting ? "Reversing..." : "Confirm & Execute Reversal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
