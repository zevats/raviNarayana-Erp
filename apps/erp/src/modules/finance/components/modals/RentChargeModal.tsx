"use client";

import React, { useState, useEffect } from "react";
import { X, Receipt, AlertCircle } from "lucide-react";
import { ResidentListItem, FinancialTransaction } from "@/types";
import { toLocalDateString } from "../../utils/dateUtils";
import { formatINR } from "../../utils/formatUtils";

interface RentChargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  residents: ResidentListItem[];
  initialResidentId?: string;
  onSuccess: (tx: FinancialTransaction, message: string) => void;
}

export function RentChargeModal({
  isOpen,
  onClose,
  residents,
  initialResidentId,
  onSuccess,
}: RentChargeModalProps) {
  const now = new Date();
  const currentMonthPeriod = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;

  const [residentId, setResidentId] = useState(initialResidentId || "");
  const [amount, setAmount] = useState("");
  const [billingPeriod, setBillingPeriod] = useState(currentMonthPeriod);
  const [transactionDate, setTransactionDate] = useState(toLocalDateString());
  const [description, setDescription] = useState("Monthly PG accommodation & amenities rent");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setTransactionDate(toLocalDateString());
      if (initialResidentId) {
        setResidentId(initialResidentId);
      }
    }
  }, [isOpen, initialResidentId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numAmount = Number(amount);
    if (!residentId) {
      setError("Please select a resident to bill.");
      return;
    }
    if (!Number.isInteger(numAmount) || numAmount <= 0) {
      setError("Rent charge amount must be a positive integer in INR.");
      return;
    }
    if (!billingPeriod.trim()) {
      setError("Billing period (e.g. 'October 2026') is required.");
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `chg_${crypto.randomUUID()}`;
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RENT_CHARGE",
          residentId,
          amount: numAmount,
          billingPeriod: billingPeriod.trim(),
          transactionDate,
          description: description.trim() || undefined,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to issue rent charge.");
      }

      onSuccess(
        data.transaction,
        `Rent charge of ${formatINR(numAmount)} issued for ${billingPeriod}.`
      );
      onClose();
    } catch (err: any) {
      setError(err.message || "An error occurred while issuing rent charge.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#1A2E20] text-[#B58A57] flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                Issue Monthly Rent Charge
              </h3>
              <p className="text-[11px] text-[#5A6C5E]">
                Post scheduled rent receivable invoice to resident ledger
              </p>
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

          {/* Select Resident */}
          <div>
            <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Select Resident *
            </label>
            <select
              required
              value={residentId}
              onChange={(e) => setResidentId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
            >
              <option value="">-- Choose Resident --</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName} ({r.phone}) {r.currentRoomNumber ? `• Room ${r.currentRoomNumber}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Amount & Billing Period */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Charge Amount (₹) *
              </label>
              <input
                type="number"
                required
                min="1"
                placeholder="8500"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans tabular-nums focus:outline-hidden focus:border-[#1A2E20]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Billing Period *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. October 2026"
                value={billingPeriod}
                onChange={(e) => setBillingPeriod(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
              />
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Invoice Posting Date *
            </label>
            <input
              type="date"
              required
              value={transactionDate}
              onChange={(e) => setTransactionDate(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-sans focus:outline-hidden focus:border-[#1A2E20]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Charge Description / Remarks
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
            />
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-[#8E9F89]/20">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl border border-[#8E9F89]/30 text-xs font-semibold text-[#1A2E20] hover:bg-[#FAF8F5]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 rounded-xl bg-[#1A2E20] hover:bg-[#263B2D] text-white text-xs font-semibold shadow-xs disabled:opacity-50"
            >
              {submitting ? "Posting..." : "Confirm & Post Rent Charge"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
