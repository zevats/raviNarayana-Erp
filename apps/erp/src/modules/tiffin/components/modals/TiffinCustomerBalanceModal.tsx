"use client";

import React, { useState, useEffect } from "react";
import { X, User, CreditCard, FileText, CheckCircle2, Clock, AlertCircle, Printer, Plus } from "lucide-react";
import { TiffinCustomerBalanceSummary, Invoice, FinancialTransaction } from "@/types";

interface TiffinCustomerBalanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  customerId: string | null;
  onOpenRecordPayment?: (customerId: string, invoiceId?: string, amount?: number) => void;
  onOpenPrintInvoice?: (invoice: Invoice) => void;
}

export function TiffinCustomerBalanceModal({
  isOpen,
  onClose,
  customerId,
  onOpenRecordPayment,
  onOpenPrintInvoice,
}: TiffinCustomerBalanceModalProps) {
  const [balance, setBalance] = useState<TiffinCustomerBalanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"invoices" | "payments">("invoices");

  useEffect(() => {
    if (!isOpen || !customerId) {
      setBalance(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetch(`/api/tiffin/customers/${customerId}/balance`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || "Failed to load balance summary.");
        setBalance(data.balance);
      })
      .catch((err) => {
        setError(err.message || "Failed to fetch customer balance.");
      })
      .finally(() => setLoading(false));
  }, [isOpen, customerId]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-2xl w-full my-6 overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#1A2E20]/5 rounded-xl text-[#1A2E20]">
              <User className="w-5 h-5 text-[#B58A57]" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#1A2E20]">
                {balance?.customerName || "Customer Financial Dossier"}
              </h2>
              {balance?.phone && (
                <p className="text-xs text-gray-500 font-mono">
                  {balance.phone}
                </p>
              )}
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
        <div className="p-5 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-gray-500">
              Loading financial records...
            </div>
          ) : balance ? (
            <>
              {/* Balance Summary KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-white border border-[#8E9F89]/20 rounded-xl p-3 text-center">
                  <div className="text-[10px] uppercase font-bold text-gray-500">Total Billed</div>
                  <div className="text-base font-bold text-[#1A2E20] mt-0.5">
                    ₹{balance.totalCharged.toLocaleString("en-IN")}
                  </div>
                </div>

                <div className="bg-white border border-[#8E9F89]/20 rounded-xl p-3 text-center">
                  <div className="text-[10px] uppercase font-bold text-emerald-700">Total Paid</div>
                  <div className="text-base font-bold text-emerald-700 mt-0.5">
                    ₹{balance.totalPaid.toLocaleString("en-IN")}
                  </div>
                </div>

                <div className="bg-white border border-[#8E9F89]/20 rounded-xl p-3 text-center">
                  <div className="text-[10px] uppercase font-bold text-amber-700">Due Balance</div>
                  <div className={`text-base font-bold mt-0.5 ${balance.outstandingBalance > 0 ? "text-amber-800" : "text-gray-800"}`}>
                    ₹{balance.outstandingBalance.toLocaleString("en-IN")}
                  </div>
                </div>

                <div className="bg-white border border-[#8E9F89]/20 rounded-xl p-3 text-center">
                  <div className="text-[10px] uppercase font-bold text-blue-700">Unallocated</div>
                  <div className="text-base font-bold text-blue-700 mt-0.5">
                    ₹{balance.unallocatedPaymentAmount.toLocaleString("en-IN")}
                  </div>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab("invoices")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      activeTab === "invoices"
                        ? "bg-[#1A2E20] text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    Invoices ({balance.invoices.length})
                  </button>
                  <button
                    onClick={() => setActiveTab("payments")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      activeTab === "payments"
                        ? "bg-[#1A2E20] text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    Payments ({balance.payments.length})
                  </button>
                </div>

                {onOpenRecordPayment && customerId && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenRecordPayment(customerId);
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-emerald-700 text-white rounded-lg text-xs font-bold hover:bg-emerald-800 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Record Payment
                  </button>
                )}
              </div>

              {/* Invoices List */}
              {activeTab === "invoices" && (
                <div className="space-y-2">
                  {balance.invoices.length === 0 ? (
                    <div className="py-8 text-center text-xs text-gray-500">
                      No invoices recorded for this customer yet.
                    </div>
                  ) : (
                    balance.invoices.map((inv) => (
                      <div
                        key={inv.id}
                        className="bg-white border border-gray-200 rounded-xl p-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-mono font-bold text-[#1A2E20]">
                            {inv.invoiceNumber || "Draft Invoice"}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            Period: <span className="font-semibold text-gray-700">{inv.billingPeriod}</span> • Due: {inv.dueDate}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="font-bold text-[#1A2E20]">
                            ₹{inv.totalAmount.toLocaleString("en-IN")}
                          </div>
                          <div className="text-[11px] text-gray-500">
                            Paid: ₹{inv.amountPaid.toLocaleString("en-IN")} | Due: ₹{inv.balanceDue.toLocaleString("en-IN")}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                              inv.status === "PAID"
                                ? "bg-green-100 text-green-800"
                                : inv.status === "PARTIALLY_PAID"
                                ? "bg-amber-100 text-amber-800"
                                : inv.status === "DRAFT"
                                ? "bg-gray-100 text-gray-700"
                                : inv.status === "CANCELLED"
                                ? "bg-red-100 text-red-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {inv.status}
                          </span>

                          {onOpenPrintInvoice && (
                            <button
                              onClick={() => {
                                onClose();
                                onOpenPrintInvoice(inv);
                              }}
                              title="Print / View Invoice"
                              className="p-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Payments List */}
              {activeTab === "payments" && (
                <div className="space-y-2">
                  {balance.payments.length === 0 ? (
                    <div className="py-8 text-center text-xs text-gray-500">
                      No payments recorded for this customer yet.
                    </div>
                  ) : (
                    balance.payments.map((tx: FinancialTransaction) => (
                      <div
                        key={tx.id}
                        className="bg-white border border-gray-200 rounded-xl p-3 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-emerald-800">
                            {tx.paymentMethod || "Payment"} • ₹{tx.amount.toLocaleString("en-IN")}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            Date: {tx.transactionDate} {tx.referenceNumber && `• Ref: ${tx.referenceNumber}`}
                          </div>
                          {tx.description && (
                            <div className="text-[10px] text-gray-400 mt-0.5 italic">
                              {tx.description}
                            </div>
                          )}
                        </div>

                        <div className="text-right">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                              tx.status === "POSTED"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {tx.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 bg-white border-t border-gray-200 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-xl text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
