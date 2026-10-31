"use client";

import React, { useState, useEffect } from "react";
import { X, PauseCircle, AlertCircle } from "lucide-react";
import { TiffinSubscription } from "@/types";
import { businessToday } from "@/lib/businessDate";

interface PauseSubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: TiffinSubscription | null;
  onSuccess: (updatedSub: TiffinSubscription, message: string) => void;
}

export function PauseSubscriptionModal({
  isOpen,
  onClose,
  subscription,
  onSuccess,
}: PauseSubscriptionModalProps) {
  const [pauseStartDate, setPauseStartDate] = useState("");
  const [pauseResumeDate, setPauseResumeDate] = useState("");
  const [pauseReason, setPauseReason] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSubmitting(false);
      const todayStr = businessToday();
      setPauseStartDate(todayStr);
      setPauseResumeDate("");
      setPauseReason("");
    }
  }, [isOpen]);

  if (!isOpen || !subscription) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!pauseStartDate) {
      setError("Please select a pause start date.");
      return;
    }

    if (pauseResumeDate && pauseResumeDate < pauseStartDate) {
      setError("Resume date cannot be earlier than pause start date.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch(`/api/tiffin/subscriptions/${subscription.id}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pauseStartDate,
          pauseResumeDate: pauseResumeDate || null,
          pauseReason: pauseReason.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || "Failed to pause subscription.");
      }

      onSuccess(
        data.subscription,
        `Subscription for ${subscription.customerName || "customer"} paused successfully.`
      );
    } catch (err: any) {
      setError(err.message || "Error pausing subscription.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-md w-full my-6 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-800">
              <PauseCircle className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h2 id="pause-modal-title" className="text-base font-bold text-[#1A2E20]">
                Pause Subscription
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
            Pausing this subscription stops upcoming meal deliveries while keeping all history intact.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="pause-start" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Pause Start Date <span className="text-red-500">*</span>
              </label>
              <input
                id="pause-start"
                type="date"
                value={pauseStartDate}
                onChange={(e) => setPauseStartDate(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              />
            </div>

            <div>
              <label htmlFor="pause-resume" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Expected Resume Date
              </label>
              <input
                id="pause-resume"
                type="date"
                min={pauseStartDate || undefined}
                value={pauseResumeDate}
                onChange={(e) => setPauseResumeDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
                placeholder="Optional"
              />
            </div>
          </div>

          <div>
            <label htmlFor="pause-reason" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Reason for Pause
            </label>
            <textarea
              id="pause-reason"
              rows={2}
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              placeholder="e.g. Traveling out of station for a week..."
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-amber-600 text-white rounded-xl text-xs font-semibold hover:bg-amber-700 transition-colors shadow-xs disabled:opacity-50"
            >
              {submitting ? "Pausing..." : "Confirm Pause"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
