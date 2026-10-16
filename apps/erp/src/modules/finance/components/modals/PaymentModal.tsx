"use client";

import React, { useState, useEffect } from "react";
import { X, CreditCard, AlertCircle, ArrowRight } from "lucide-react";
import { ResidentListItem, PaymentMethod, FinancialTransaction } from "@/types";
import { toLocalDateString } from "../../utils/dateUtils";
import { formatINR } from "../../utils/formatUtils";

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  residents: ResidentListItem[];
  initialResidentId?: string;
  onSuccess: (tx: FinancialTransaction, message: string) => void;
}

export function PaymentModal({
  isOpen,
  onClose,
  residents,
  initialResidentId,
  onSuccess,
}: PaymentModalProps) {
  const [residentId, setResidentId] = useState(initialResidentId || "");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI");
  const [transactionDate, setTransactionDate] = useState(toLocalDateString());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [description, setDescription] = useState("");

  const [outstandingBalance, setOutstandingBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Sync initialResidentId when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setTransactionDate(toLocalDateString());
      if (initialResidentId) {
        setResidentId(initialResidentId);
        fetchResidentBalance(initialResidentId);
      }
    }
  }, [isOpen, initialResidentId]);

  const fetchResidentBalance = async (resId: string) => {
    if (!resId) {
      setOutstandingBalance(null);
      return;
    }
    setLoadingBalance(true);
    try {
      const res = await fetch(`/api/finance/residents/${resId}`);
      const data = await res.json();
      if (res.ok && data.summary) {
        const bal = data.summary.outstandingRentBalance;
        setOutstandingBalance(bal);
        if (bal > 0) {
          setAmount(String(bal));
        }
      }
    } catch {
      setOutstandingBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  };

  const handleResidentChange = (resId: string) => {
    setResidentId(resId);
    setError(null);
    fetchResidentBalance(resId);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numAmount = Number(amount);
    if (!residentId) {
      setError("Please select a resident.");
      return;
    }
    if (!Number.isInteger(numAmount) || numAmount <= 0) {
      setError("Payment amount must be a positive integer in INR.");
      return;
    }
    if (outstandingBalance !== null && numAmount > outstandingBalance) {
      setError(
        `Payment (₹${numAmount.toLocaleString("en-IN")}) exceeds the resident's current outstanding rent balance (₹${outstandingBalance.toLocaleString("en-IN")}).`
      );
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `pay_${crypto.randomUUID()}`;
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RENT_PAYMENT",
          residentId,
          amount: numAmount,
          paymentMethod,
          transactionDate,
          referenceNumber: referenceNumber.trim() || undefined,
          description: description.trim() || undefined,
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to record rent payment.");
      }

      onSuccess(
        data.transaction,
        `Rent payment of ${formatINR(numAmount)} successfully recorded.`
      );
      onClose();
    } catch (err: any) {
      setError(err.message || "An error occurred while saving payment.");
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
            <span className="text-[10px] font-mono tracking-widest uppercase text-[#5D7656]">
              RENT COLLECTION RECEIPT
            </span>
            <h3 className="font-serif text-xl text-[#1A2E20] font-normal mt-0.5">
              Record Rent Payment
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
              onChange={(e) => handleResidentChange(e.target.value)}
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

          {/* Outstanding Balance Banner */}
          {residentId && (
            <div className="p-3 rounded-xl bg-[#FAF8F5] border border-[#B58A57]/30 flex items-center justify-between">
              <span className="text-[#654735] font-medium">Current Outstanding Balance:</span>
              <span className="font-serif font-bold text-sm text-[#1A2E20] tabular-nums">
                {loadingBalance ? "Checking..." : formatINR(outstandingBalance ?? 0)}
              </span>
            </div>
          )}

          {/* Amount & Payment Method */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Amount Received (₹) *
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
                Payment Method *
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-none font-medium"
              >
                <option value="UPI">UPI / QR Transfer</option>
                <option value="CASH">Cash in Hand</option>
                <option value="BANK_TRANSFER">Bank IMPS / NEFT</option>
                <option value="CHEQUE">Bank Cheque</option>
                <option value="OTHER">POS Card / Other</option>
              </select>
            </div>
          </div>

          {/* Date & Reference */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Transaction Date *
              </label>
              <input
                type="date"
                required
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Reference / UTR #
              </label>
              <input
                type="text"
                placeholder="e.g. UPI 429381..."
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-none font-mono"
              />
            </div>
          </div>

          {/* Description / Notes */}
          <div>
            <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Receipt Notes / Description
            </label>
            <input
              type="text"
              placeholder="e.g. October rent paid via GooglePay"
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
              {submitting ? "Recording..." : "Confirm & Save Payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
