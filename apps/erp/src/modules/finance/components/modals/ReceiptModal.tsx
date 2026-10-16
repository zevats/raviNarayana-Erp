"use client";

import React, { useState } from "react";
import { X, Receipt, Check, Copy, Printer } from "lucide-react";
import { FinancialTransaction } from "@/types";
import { formatINR } from "../../utils/formatUtils";
import { formatIndianDate } from "../../utils/dateUtils";

interface ReceiptModalProps {
  transaction: FinancialTransaction | null;
  onClose: () => void;
}

export function ReceiptModal({ transaction, onClose }: ReceiptModalProps) {
  const [copied, setCopied] = useState(false);

  if (!transaction) return null;

  const handleCopyId = () => {
    navigator.clipboard.writeText(transaction.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-2xs animate-fade-in print:p-0 print:bg-white">
      <div className="bg-white rounded-3xl max-w-md w-full border border-[#8E9F89]/30 shadow-2xl overflow-hidden animate-slide-up print:border-none print:shadow-none">
        {/* Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-br from-[#1A2E20] to-[#263B2D] text-white flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono tracking-widest uppercase text-[#B58A57]">
              TRANSACTION VOUCHER
            </span>
            <h3 className="font-serif text-xl font-normal mt-0.5">
              Ravinarayan ERP
            </h3>
            <p className="text-[11px] text-white/70">
              PG Accommodation &amp; Operations
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors print:hidden"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 space-y-3.5 text-xs">
          {/* Transaction ID */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
            <span className="text-[#5E715C]">Voucher ID</span>
            <div className="flex items-center gap-1.5 font-mono text-[#1A2E20] font-semibold">
              <span>{transaction.id}</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="p-1 hover:bg-stone-100 rounded text-[#5E715C] hover:text-[#1A2E20] print:hidden"
                title="Copy ID"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Date */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
            <span className="text-[#5E715C]">Date</span>
            <span className="font-mono text-[#1A2E20] font-semibold">
              {formatIndianDate(transaction.transactionDate)} ({transaction.transactionDate})
            </span>
          </div>

          {/* Type */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
            <span className="text-[#5E715C]">Transaction Type</span>
            <span className="font-medium text-[#1A2E20]">
              {transaction.transactionType.replace("_", " ")}
            </span>
          </div>

          {/* Status */}
          <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
            <span className="text-[#5E715C]">Posting Status</span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                transaction.status === "REVERSED"
                  ? "bg-red-100 text-red-800 border border-red-300"
                  : "bg-emerald-50 text-emerald-800 border border-emerald-200"
              }`}
            >
              {transaction.status}
            </span>
          </div>

          {/* Resident / Room */}
          {transaction.residentName && (
            <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
              <span className="text-[#5E715C]">Resident</span>
              <span className="font-medium text-[#1A2E20] text-right">
                {transaction.residentName}
                {transaction.roomNumber ? ` (Room ${transaction.roomNumber})` : ""}
              </span>
            </div>
          )}

          {/* Payee / Vendor */}
          {transaction.payeeVendor && (
            <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
              <span className="text-[#5E715C]">Payee / Vendor</span>
              <span className="font-medium text-[#1A2E20]">{transaction.payeeVendor}</span>
            </div>
          )}

          {/* Billing Period */}
          {transaction.billingPeriod && (
            <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
              <span className="text-[#5E715C]">Billing Period</span>
              <span className="font-medium text-[#1A2E20]">{transaction.billingPeriod}</span>
            </div>
          )}

          {/* Payment Method */}
          {transaction.paymentMethod && (
            <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
              <span className="text-[#5E715C]">Payment Method</span>
              <span className="font-medium text-[#1A2E20]">{transaction.paymentMethod}</span>
            </div>
          )}

          {/* Reference Number */}
          {transaction.referenceNumber && (
            <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
              <span className="text-[#5E715C]">Reference / UTR</span>
              <span className="font-mono text-[#1A2E20]">{transaction.referenceNumber}</span>
            </div>
          )}

          {/* Description */}
          {transaction.description && (
            <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/20">
              <span className="text-[#5E715C]">Description</span>
              <span className="text-[#1A2E20] text-right max-w-[220px]">{transaction.description}</span>
            </div>
          )}

          {/* Amount Box */}
          <div className="pt-2 flex items-center justify-between">
            <span className="font-serif text-sm font-semibold text-[#1A2E20]">
              Amount Recorded:
            </span>
            <span className="font-serif text-2xl font-bold text-[#1A2E20] tabular-nums">
              {formatINR(transaction.amount)}
            </span>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 flex items-center justify-between border-t border-[#8E9F89]/15 print:hidden">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] text-xs font-medium transition-colors"
            >
              <Printer className="w-3.5 h-3.5 text-[#5D7656]" />
              <span>Print</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-[#1A2E20] text-white hover:bg-[#263B2D] text-xs font-medium transition-colors shadow-sm"
            >
              Close Voucher
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
