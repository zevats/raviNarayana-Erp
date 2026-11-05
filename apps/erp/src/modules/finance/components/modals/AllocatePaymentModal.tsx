"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, CreditCard, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { Invoice, InvoicePaymentAllocation } from "@/types";
import { formatINR } from "../../utils/formatUtils";

interface AllocatePaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  onSuccess: (updatedInvoice: Invoice, allocation: InvoicePaymentAllocation, message: string) => void;
  onOpenRecordPayment?: (residentId: string) => void;
}

interface UnallocatedPayment {
  paymentId: string;
  transactionDate: string;
  amount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  paymentMethod: string | null;
  referenceNumber: string | null;
}

export function AllocatePaymentModal({
  isOpen,
  onClose,
  invoice,
  onSuccess,
  onOpenRecordPayment,
}: AllocatePaymentModalProps) {
  const [payments, setPayments] = useState<UnallocatedPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Ignores a second activation while a save is being sent (state-based disabling only applies after a render).
  const inFlight = useRef(false);

  useEffect(() => {
    if (isOpen && invoice) {
      setError(null);
      inFlight.current = false;
      setSubmitting(false);
      setNotes("");
      loadUnallocatedPayments(invoice.residentId, invoice.customerId);
    }
  }, [isOpen, invoice]);

  const loadUnallocatedPayments = async (residentId?: string | null, customerId?: string | null) => {
    setLoadingPayments(true);
    try {
      const query = customerId
        ? `customerId=${encodeURIComponent(customerId)}`
        : `residentId=${encodeURIComponent(residentId || "")}`;
      const res = await fetch(`/api/finance/invoices/unallocated-payments?${query}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load unallocated payments.");

      const list: UnallocatedPayment[] = data.payments || [];
      setPayments(list);
      if (list.length > 0 && invoice) {
        setSelectedPaymentId(list[0].paymentId);
        const suggested = Math.min(list[0].unallocatedAmount, invoice.balanceDue);
        setAmount(String(suggested));
      } else {
        setSelectedPaymentId("");
        setAmount("");
      }
    } catch (err: any) {
      setError(err.message || "Failed to load unallocated payments.");
    } finally {
      setLoadingPayments(false);
    }
  };

  const handlePaymentSelect = (paymentId: string) => {
    setSelectedPaymentId(paymentId);
    const p = payments.find((item) => item.paymentId === paymentId);
    if (p && invoice) {
      const suggested = Math.min(p.unallocatedAmount, invoice.balanceDue);
      setAmount(String(suggested));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice) return;
    setError(null);

    const numAmount = Number(amount);
    if (!selectedPaymentId) {
      setError("Please select a payment transaction to allocate.");
      return;
    }
    if (!Number.isInteger(numAmount) || numAmount <= 0) {
      setError("Allocation amount must be a positive integer in INR.");
      return;
    }
    if (numAmount > invoice.balanceDue) {
      setError(`Cannot allocate ₹${formatINR(numAmount)}. Invoice balance due is only ₹${formatINR(invoice.balanceDue)}.`);
      return;
    }

    const sel = payments.find((p) => p.paymentId === selectedPaymentId);
    if (sel && numAmount > sel.unallocatedAmount) {
      setError(`Cannot allocate ₹${formatINR(numAmount)}. Selected payment only has ₹${formatINR(sel.unallocatedAmount)} unallocated.`);
      return;
    }

    if (inFlight.current) return;

    inFlight.current = true;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/finance/invoices/${invoice.id}/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentTransactionId: selectedPaymentId,
          amount: numAmount,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to allocate payment.");

      onSuccess(
        data.invoice,
        data.allocation,
        `₹${formatINR(numAmount)} successfully allocated to Invoice ${invoice.invoiceNumber || invoice.id}.`
      );
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to allocate payment.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (!isOpen || !invoice) return null;

  const selectedPayment = payments.find((p) => p.paymentId === selectedPaymentId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="alloc-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#B58A57]/15 flex items-center justify-center text-[#9E7443]">
              <CreditCard className="w-5 h-5 text-[#B58A57]" />
            </div>
            <div>
              <h2 id="alloc-title" className="text-base sm:text-lg font-bold text-[#1A2E20]">
                Allocate Payment to Invoice
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#5A6C5E] hover:text-[#1A2E20] hover:bg-[#FAF8F5] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 text-xs sm:text-sm">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Invoice Summary Pill */}
          <div className="p-3 bg-white border border-[#8E9F89]/30 rounded-xl flex items-center justify-between">
            <div>
              <div className="text-[11px] text-[#5A6C5E]">Invoice Target</div>
              <div className="font-bold text-[#1A2E20]">{invoice.invoiceNumber || "Draft Invoice"}</div>
              <div className="text-[11px] text-[#5A6C5E]">{invoice.residentName || "Resident"}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[#5A6C5E]">Balance Due</div>
              <div className="text-sm font-bold text-[#B58A57]">₹{formatINR(invoice.balanceDue)}</div>
            </div>
          </div>

          {loadingPayments ? (
            <div className="p-4 text-center text-[#5A6C5E]">
              Loading resident unallocated payments...
            </div>
          ) : payments.length === 0 ? (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-2 text-center text-amber-900">
              <AlertTriangle className="w-6 h-6 mx-auto text-amber-600" />
              <div className="font-semibold text-xs">No Unallocated Payments Found</div>
              <p className="text-[11px] text-amber-800">
                This {invoice.invoiceCategory === "TIFFIN" ? "customer" : "resident"} currently has no unallocated payments recorded in the financial cashbook.
              </p>
              {onOpenRecordPayment && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenRecordPayment(invoice.residentId || invoice.customerId || "");
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1A2E20] text-white rounded-lg text-xs font-semibold hover:bg-[#263B2D] transition-colors"
                >
                  <CreditCard className="w-3.5 h-3.5" /> Record Payment First
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Payment Selector */}
              <div>
                <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Select Unallocated Payment <span className="text-red-500">*</span>
                </label>
                <select
                  value={selectedPaymentId}
                  onChange={(e) => handlePaymentSelect(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
                >
                  {payments.map((p) => (
                    <option key={p.paymentId} value={p.paymentId}>
                      {p.transactionDate} — ₹{formatINR(p.amount)} ({p.paymentMethod || "CASH"}) • Available: ₹{formatINR(p.unallocatedAmount)}
                    </option>
                  ))}
                </select>
                {selectedPayment && (
                  <div className="text-[11px] text-[#5A6C5E] mt-1">
                    Reference: {selectedPayment.referenceNumber || "None"} • Unallocated Remaining: ₹{formatINR(selectedPayment.unallocatedAmount)}
                  </div>
                )}
              </div>

              {/* Amount to allocate */}
              <div>
                <label htmlFor="alloc-amount" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Amount to Allocate (INR) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-[#5A6C5E] font-medium">₹</span>
                  <input
                    id="alloc-amount"
                    type="number"
                    min="1"
                    max={Math.min(selectedPayment?.unallocatedAmount || 0, invoice.balanceDue)}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    className="w-full pl-7 pr-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] font-semibold"
                  />
                </div>
                <div className="flex justify-between text-[11px] text-[#5A6C5E] mt-1">
                  <span>Max applicable: ₹{formatINR(Math.min(selectedPayment?.unallocatedAmount || 0, invoice.balanceDue))}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedPayment) {
                        setAmount(String(Math.min(selectedPayment.unallocatedAmount, invoice.balanceDue)));
                      }
                    }}
                    className="text-[#B58A57] font-semibold hover:underline"
                  >
                    Set Max
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label htmlFor="alloc-notes" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                  Allocation Notes (Optional)
                </label>
                <input
                  id="alloc-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Applied via UPI ref #12345"
                  className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
                />
              </div>
            </>
          )}

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#8E9F89]/20">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 border border-[#8E9F89]/30 rounded-xl text-xs font-medium text-[#5A6C5E] hover:bg-[#FAF8F5] transition-colors"
            >
              Cancel
            </button>
            {payments.length > 0 && (
              <button
                type="submit"
                disabled={submitting || !selectedPaymentId || Number(amount) <= 0}
                className="px-5 py-2 bg-[#1A2E20] hover:bg-[#263B2D] text-white rounded-xl text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
              >
                {submitting ? "Allocating..." : `Confirm Allocation (₹${formatINR(Number(amount) || 0)})`}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
