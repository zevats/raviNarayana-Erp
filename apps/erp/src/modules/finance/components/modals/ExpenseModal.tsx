"use client";

import React, { useState, useEffect } from "react";
import { X, TrendingDown, AlertCircle } from "lucide-react";
import { ExpenseCategory, PaymentMethod, FinancialTransaction } from "@/types";
import { toLocalDateString } from "../../utils/dateUtils";
import { formatINR } from "../../utils/formatUtils";

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (tx: FinancialTransaction, message: string) => void;
}

const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "GROCERY", label: "Grocery & Provisions" },
  { value: "KITCHEN_SUPPLIES", label: "Kitchen & Cooking Supplies" },
  { value: "UTILITIES", label: "Utilities (Electricity, Water, Gas)" },
  { value: "MAINTENANCE", label: "Property Maintenance & Repairs" },
  { value: "STAFF_SALARY", label: "Staff Wages & Salaries" },
  { value: "INTERNET", label: "Internet & Telecommunications" },
  { value: "MARKETING", label: "Marketing & Signage" },
  { value: "OTHER", label: "Other Operational Expense" },
];

export function ExpenseModal({ isOpen, onClose, onSuccess }: ExpenseModalProps) {
  const [category, setCategory] = useState<ExpenseCategory>("GROCERY");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI");
  const [payeeVendor, setPayeeVendor] = useState("");
  const [transactionDate, setTransactionDate] = useState(toLocalDateString());
  const [referenceNumber, setReferenceNumber] = useState("");
  const [description, setDescription] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setTransactionDate(toLocalDateString());
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numAmount = Number(amount);
    if (!Number.isInteger(numAmount) || numAmount <= 0) {
      setError("Expense amount must be a positive integer in INR.");
      return;
    }
    if (!description.trim()) {
      setError("Expense description is required for audit verification.");
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey = `exp_${crypto.randomUUID()}`;
      const res = await fetch("/api/finance/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "EXPENSE",
          category,
          amount: numAmount,
          paymentMethod,
          payeeVendor: payeeVendor.trim() || undefined,
          transactionDate,
          referenceNumber: referenceNumber.trim() || undefined,
          description: description.trim(),
          idempotencyKey,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to record expense.");
      }

      onSuccess(
        data.transaction,
        `Expense of ${formatINR(numAmount)} recorded under ${category}.`
      );
      onClose();
    } catch (err: any) {
      setError(err.message || "An error occurred while recording expense.");
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
              <TrendingDown className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-serif text-xl text-[#1A2E20] font-bold">
                Record Operational Expense
              </h3>
              <p className="text-[11px] text-[#5A6C5E]">
                Log verified operational disbursement and vendor payment
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

          {/* Category & Amount */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Expense Category *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20] font-medium"
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Amount (₹) *
              </label>
              <input
                type="number"
                required
                min="1"
                placeholder="2500"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono focus:outline-hidden focus:border-[#1A2E20]"
              />
            </div>
          </div>

          {/* Payment Method & Payee/Vendor */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Payment Method *
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20] font-medium"
              >
                <option value="UPI">UPI / QR Transfer</option>
                <option value="CASH">Cash in Hand</option>
                <option value="BANK_TRANSFER">Bank IMPS / NEFT</option>
                <option value="CHEQUE">Bank Cheque</option>
                <option value="OTHER">POS Card / Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Payee / Vendor Name
              </label>
              <input
                type="text"
                placeholder="e.g. Haryana Dairy Farm"
                value={payeeVendor}
                onChange={(e) => setPayeeVendor(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20]"
              />
            </div>
          </div>

          {/* Date & Reference */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Disbursement Date *
              </label>
              <input
                type="date"
                required
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] font-mono focus:outline-hidden focus:border-[#1A2E20]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Reference / Bill #
              </label>
              <input
                type="text"
                placeholder="e.g. Bill #8921"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#FAF8F5] border border-[#8E9F89]/35 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:border-[#1A2E20] font-mono"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Expense Item Description *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Weekly milk, butter, and provisions delivery"
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
              {submitting ? "Saving..." : "Confirm & Save Expense"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
