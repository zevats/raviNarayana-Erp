"use client";

import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect, useRef } from "react";
import { X, CreditCard, CheckCircle2, AlertCircle, ArrowRight, DollarSign } from "lucide-react";
import { PaymentMethod, TiffinCustomerBalanceSummary } from "@/types";
import { businessToday } from "@/lib/businessDate";

interface RecordTiffinPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: { id: string; name: string; companyName?: string | null; customerType: string }[];
  initialCustomerId?: string;
  initialInvoiceId?: string;
  initialAmount?: number;
  onSuccess: (result: any) => void;
}

export function RecordTiffinPaymentModal({
  isOpen,
  onClose,
  customers,
  initialCustomerId,
  initialInvoiceId,
  initialAmount,
  onSuccess,
}: RecordTiffinPaymentModalProps) {
  const [customerId, setCustomerId] = useState(initialCustomerId || "");
  const [amount, setAmount] = useState<string>(initialAmount ? String(initialAmount) : "");
  const [paymentDate, setPaymentDate] = useState(() => businessToday());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("UPI");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId || "");
  const [notes, setNotes] = useState("");

  const [balanceSummary, setBalanceSummary] = useState<TiffinCustomerBalanceSummary | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Ignores a second activation while a save is being sent (state-based disabling only applies after a render).
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per entry: a retry after a lost response is the same payment to the server
  // (which already de-duplicates by key), never a second one. A new key each time the form opens.
  const entryKey = useRef<string>("");
  useEffect(() => {
    if (isOpen) entryKey.current = `tpay_${crypto.randomUUID()}`;
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (initialCustomerId) setCustomerId(initialCustomerId);
      else if (customers.length > 0 && !customerId) setCustomerId(customers[0].id);
      if (initialAmount) setAmount(String(initialAmount));
      if (initialInvoiceId) setInvoiceId(initialInvoiceId);
      setError(null);
    }
  }, [isOpen, initialCustomerId, initialAmount, initialInvoiceId, customers]);

  // Load balance for customer
  useEffect(() => {
    if (!isOpen || !customerId) {
      setBalanceSummary(null);
      return;
    }
    setLoadingBalance(true);
    fetch(`/api/tiffin/customers/${customerId}/balance`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.balance) {
          setBalanceSummary(data.balance);
          // If invoice not selected and an invoice is open with balance due
          if (!invoiceId && data.balance.invoices?.length > 0) {
            const openInv = data.balance.invoices.find((i: any) => i.status !== "PAID" && i.balanceDue > 0);
            if (openInv) {
              setInvoiceId(openInv.id);
              if (!amount) {
                setAmount(String(openInv.balanceDue));
              }
            }
          }
        }
      })
      .catch((e) => console.error("Failed to load customer balance:", e))
      .finally(() => setLoadingBalance(false));
  }, [isOpen, customerId]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numAmount = Number(amount);
    if (!customerId) {
      setError("Please select a customer.");
      return;
    }
    if (isNaN(numAmount) || numAmount <= 0) {
      setError("Payment amount must be greater than 0.");
      return;
    }
    if (!paymentDate) {
      setError("Payment date is required.");
      return;
    }

    if (inFlight.current) return;

    inFlight.current = true;

    setSubmitting(true);
    try {
      const res = await fetch("/api/tiffin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          amount: numAmount,
          transactionDate: paymentDate,
          paymentMethod,
          referenceNumber: referenceNumber.trim() || undefined,
          notes: notes.trim() || undefined,
          invoiceId: invoiceId || undefined,
          idempotencyKey: entryKey.current || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to record payment.");
      }

      onSuccess(data);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to record payment.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-lg w-full my-6 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-50 rounded-xl text-emerald-800">
              <CreditCard className="w-5 h-5 text-emerald-700" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#1A2E20]">
                Record Tiffin Customer Payment
              </h2>
              <p className="text-xs text-gray-500">
                Posts TIFFIN_PAYMENT into finance cashbook ledger
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

          {/* Customer Selection */}
          <div>
            <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
              Select Customer
            </label>
            <AppSelect
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setInvoiceId("");
              }}
              disabled={Boolean(initialCustomerId)}
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20] disabled:bg-gray-100"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.companyName ? `(${c.companyName})` : ""} [{c.customerType}]
                </option>
              ))}
            </AppSelect>
          </div>

          {/* Customer Balance Snapshot */}
          {balanceSummary && (
            <div className="bg-white border border-[#8E9F89]/20 rounded-xl p-3 flex items-center justify-between text-xs">
              <div>
                <span className="text-gray-500 text-[10px] uppercase font-bold block">Outstanding Balance</span>
                <span className={`text-sm font-bold ${balanceSummary.outstandingBalance > 0 ? "text-amber-800" : "text-emerald-700"}`}>
                  ₹{balanceSummary.outstandingBalance.toLocaleString("en-IN")}
                </span>
              </div>
              <div>
                <span className="text-gray-500 text-[10px] uppercase font-bold block">Total Billed</span>
                <span className="text-xs font-semibold text-[#1A2E20]">₹{balanceSummary.totalCharged.toLocaleString("en-IN")}</span>
              </div>
              <div>
                <span className="text-gray-500 text-[10px] uppercase font-bold block">Total Paid</span>
                <span className="text-xs font-semibold text-emerald-700">₹{balanceSummary.totalPaid.toLocaleString("en-IN")}</span>
              </div>
            </div>
          )}

          {/* Amount & Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
                Payment Amount (₹) *
              </label>
              <input
                type="number"
                step="any"
                min="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 3500"
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] font-semibold focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
                Payment Date *
              </label>
              <input
                type="date"
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
              />
            </div>
          </div>

          {/* Payment Method & Ref */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
                Payment Method *
              </label>
              <AppSelect
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
              >
                <option value="UPI">UPI / QR Code</option>
                <option value="CASH">Cash Payment</option>
                <option value="BANK_TRANSFER">Bank Transfer (NEFT/IMPS)</option>
                <option value="CHEQUE">Cheque</option>
              </AppSelect>
            </div>

            <div>
              <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
                Reference / UTR # (Optional)
              </label>
              <input
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="e.g. UPI-10928374 or Cheque #"
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
              />
            </div>
          </div>

          {/* Direct Invoice Allocation Target */}
          {balanceSummary && balanceSummary.invoices?.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
                Allocate to Specific Invoice (Optional)
              </label>
              <AppSelect
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
              >
                <option value="">Leave Unallocated (Customer Credit Balance)</option>
                {balanceSummary.invoices
                  .filter((inv) => inv.status !== "PAID" && inv.balanceDue > 0)
                  .map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoiceNumber || "Draft"} - Period: {inv.billingPeriod} (Due: ₹{inv.balanceDue.toLocaleString("en-IN")})
                    </option>
                  ))}
              </AppSelect>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-[#1A2E20] block mb-1">
              Internal Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Received via GPay from customer"
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
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
              disabled={submitting}
              className="px-4 py-2 bg-emerald-800 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-xs"
            >
              {submitting ? (
                <>Recording...</>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  Post Payment
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
