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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-2xs animate-fade-in">
      <div className="bg-white rounded-3xl max-w-lg w-full border border-[#8E9F89]/30 shadow-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-[#8E9F89]/15 flex items-center justify-between bg-[#FAF8F5]">
          <div>
            <span className="text-[10px] font-mono tracking-widest uppercase text-[#B58A57]">
              RENT BILLING INVOICE
            </span>
            <h3 className="font-serif text-xl text-[#1A2E20] font-normal mt-0.5">
              Issue Monthly Rent Charge
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white border border-[#8E9F89]/30 flex items-center justify-center text-[#5E715C] hover:text-[#1A2E20] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2 shadow-2xs">
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
              className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-none"
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
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono focus:outline-none"
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
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-none"
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
              className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono focus:outline-none"
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
              className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-none"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#8E9F89]/15">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 rounded-xl text-xs text-[#5E715C] hover:text-[#1A2E20] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 rounded-xl bg-[#1A2E20] text-white hover:bg-[#263B2D] text-xs font-medium transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              {submitting ? "Posting..." : "Confirm & Post Rent Charge"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
