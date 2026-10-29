"use client";

import React, { useState } from "react";
import { X, XCircle, AlertCircle } from "lucide-react";
import { TiffinSubscription } from "@/types";

interface CancelSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: TiffinSubscription | null;
  onSuccess: (updatedSub: TiffinSubscription, message: string) => void;
}

export function CancelSubscriptionModal({
  isOpen,
  onClose,
  subscription,
  onSuccess,
}: CancelSubscriptionModalProps) {
  const [cancellationReason, setCancellationReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !subscription) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/tiffin/subscriptions/${subscription.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancellationReason: cancellationReason.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || "Failed to cancel subscription.");
      }

      onSuccess(
        data.subscription,
        `Subscription for ${subscription.customerName || "customer"} cancelled successfully.`
      );
    } catch (err: any) {
      setError(err.message || "Error cancelling subscription.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-md w-full my-6 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-800">
              <XCircle className="w-5 h-5 text-red-700" />
            </div>
            <div>
              <h2 id="cancel-modal-title" className="text-base font-bold text-[#1A2E20]">
                Cancel Subscription
              </h2>
              <p className="text-xs text-[#5A6C5E]">
                {subscription.customerName} — {subscription.productName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#5A6C5E] hover:text-[#1A2E20] hover:bg-[#FAF8F5] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 text-xs sm:text-sm">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <p className="text-xs text-gray-600">
            Are you sure you want to cancel this subscription? Service will be permanently stopped. All historical records and pricing will be preserved for audit and billing.
          </p>

          <div>
            <label htmlFor="cancel-reason" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Cancellation Reason (Optional)
            </label>
            <textarea
              id="cancel-reason"
              rows={3}
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              placeholder="e.g. Relocated to another city, dietary change..."
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#8E9F89]/20">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 border border-[#8E9F89]/40 text-[#5A6C5E] hover:text-[#1A2E20] rounded-xl text-xs font-semibold hover:bg-gray-100 transition-colors"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-red-600 text-white rounded-xl text-xs font-semibold hover:bg-red-700 transition-colors shadow-xs disabled:opacity-50"
            >
              {submitting ? "Cancelling..." : "Confirm Cancellation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
