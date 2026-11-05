"use client";

import React, { useState } from "react";
import {
  X,
  Printer,
  Download,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  FileText,
  Send,
  Building,
} from "lucide-react";
import { Invoice } from "@/types";
import { formatINR } from "../../utils/formatUtils";
import { useErpQuery } from "@/lib/cache/erpDataCache";

interface PrintableInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  onOpenAllocate?: (invoice: Invoice) => void;
  onIssueInvoice?: (invoiceId: string) => void;
}

export function PrintableInvoiceModal({
  isOpen,
  onClose,
  invoice,
  onOpenAllocate,
  onIssueInvoice,
}: PrintableInvoiceModalProps) {
  const [issuing, setIssuing] = useState(false);
  // Contact line for the printed copy (Settings → Business details); the invoice record is unchanged.
  const contact = useErpQuery<{ phone: string; email: string } | null>(
    isOpen ? "/api/settings/business" : null,
    async () => {
      const res = await fetch("/api/settings/business", { cache: "no-store" });
      if (!res.ok) return null;
      return (await res.json()).business ?? null;
    },
    { ttl: 60000, tags: ["settings"] }
  );

  if (!isOpen || !invoice) return null;

  const isGst = invoice.invoiceType === "GST_TAX_INVOICE";
  const isPaid = invoice.status === "PAID";
  const isPartiallyPaid = invoice.status === "PARTIALLY_PAID";
  const isDraft = invoice.status === "DRAFT";
  const isCancelled = invoice.status === "CANCELLED";

  const handlePrint = () => {
    window.print();
  };

  const handleIssue = async () => {
    if (!onIssueInvoice || !invoice.id) return;
    setIssuing(true);
    try {
      await onIssueInvoice(invoice.id);
    } finally {
      setIssuing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto print:p-0 print:bg-white print:static"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-3xl w-full my-6 overflow-hidden flex flex-col max-h-[92dvh] print:max-h-none print:border-none print:shadow-none print:rounded-none print:w-full print:m-0">
        {/* Top Control Bar (Hidden when printing) */}
        <div className="flex items-center justify-between p-4 bg-white border-b border-[#8E9F89]/20 print:hidden">
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                isPaid
                  ? "bg-green-100 text-green-800"
                  : isPartiallyPaid
                  ? "bg-amber-100 text-amber-800"
                  : isDraft
                  ? "bg-gray-100 text-gray-700"
                  : isCancelled
                  ? "bg-red-100 text-red-800"
                  : "bg-blue-100 text-blue-800"
              }`}
            >
              {invoice.status}
            </span>
            <span className="text-xs text-[#5A6C5E]">
              {isGst ? "GST Tax Invoice" : "Regular Non-GST Bill"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isDraft && onIssueInvoice && (
              <button
                onClick={handleIssue}
                disabled={issuing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#B58A57] hover:bg-[#9E7443] text-white rounded-lg text-xs font-semibold transition-colors shadow-2xs disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {issuing ? "Issuing..." : "Issue Invoice"}
              </button>
            )}

            {(invoice.status === "ISSUED" || isPartiallyPaid) && onOpenAllocate && (
              <button
                onClick={() => {
                  onClose();
                  onOpenAllocate(invoice);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1A2E20] hover:bg-[#263B2D] text-white rounded-lg text-xs font-semibold transition-colors shadow-2xs"
              >
                <CreditCard className="w-3.5 h-3.5" />
                Allocate Payment
              </button>
            )}

            <button
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#8E9F89]/30 bg-white hover:bg-[#FAF8F5] text-[#1A2E20] rounded-lg text-xs font-semibold transition-colors shadow-2xs"
            >
              <Printer className="w-3.5 h-3.5 text-[#B58A57]" />
              Print / Save PDF
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#5A6C5E] hover:text-[#1A2E20] hover:bg-[#FAF8F5] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Branded Document Sheet */}
        <div
          id="printable-invoice-content"
          className="p-6 sm:p-10 bg-white text-[#1A2E20] overflow-y-auto flex-1 font-sans text-xs print:p-8 print:text-black"
        >
          {/* Header & Brand */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b-2 border-[#1A2E20]">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl sm:text-2xl font-serif font-bold text-[#1A2E20]">
                  {invoice.companyName}
                </span>
              </div>
              <p className="text-xs text-[#5A6C5E] mt-0.5">
                Botanical Living &amp; Fresh Tiffin Service
              </p>
              <p className="text-[11px] text-[#5A6C5E] mt-1 max-w-sm">
                {invoice.companyAddress}
              </p>
              {(contact.data?.phone || contact.data?.email) && (
                <p className="text-[11px] text-[#5A6C5E] mt-0.5">
                  {[contact.data?.phone, contact.data?.email].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="text-[11px] text-[#5A6C5E] mt-1 flex flex-wrap gap-x-4">
                {invoice.companyGstin ? (
                  <span>
                    <strong>GSTIN:</strong> {invoice.companyGstin}
                  </span>
                ) : (
                  <span className="italic">Non-GST Accommodation Establishment</span>
                )}
                <span>
                  <strong>State Code:</strong> {invoice.companyStateCode} (Haryana)
                </span>
              </div>
            </div>

            <div className="text-left sm:text-right">
              <div className="inline-block px-3 py-1 rounded bg-[#1A2E20]/5 text-[#1A2E20] font-bold text-sm tracking-wide uppercase border border-[#1A2E20]/20">
                {isGst ? "Tax Invoice" : invoice.invoiceCategory === "TIFFIN" ? "Tiffin Meal Bill" : "Accommodation Bill"}
              </div>
              <div className="mt-2 text-xs">
                <div className="font-bold text-[#1A2E20] text-sm">
                  {invoice.invoiceNumber || "DRAFT — NOT YET ISSUED"}
                </div>
                <div className="text-[#5A6C5E] mt-0.5">
                  <strong>Date:</strong> {invoice.issueDate}
                </div>
                <div className="text-[#5A6C5E] mt-0.5">
                  <strong>Due Date:</strong> {invoice.dueDate}
                </div>
                <div className="text-[#5A6C5E] mt-0.5">
                  <strong>Billing Period:</strong> {invoice.billingPeriod}
                </div>
              </div>
            </div>
          </div>

          {/* Recipient / Bill To */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-5 border-b border-[#8E9F89]/20">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89]">
                {invoice.invoiceCategory === "TIFFIN" ? "Billed To (Tiffin Customer)" : "Billed To (Resident / Guest)"}
              </span>
              <div className="font-bold text-sm text-[#1A2E20] mt-1">
                {invoice.recipientName}
              </div>
              {invoice.roomNumber && (
                <div className="text-xs text-[#5A6C5E]">
                  Room No: <strong>{invoice.roomNumber}</strong>
                </div>
              )}
              <div className="text-xs text-[#5A6C5E] mt-0.5">
                Phone: {invoice.recipientPhone}
              </div>
              {invoice.recipientEmail && (
                <div className="text-xs text-[#5A6C5E]">
                  Email: {invoice.recipientEmail}
                </div>
              )}
              {invoice.recipientAddress && (
                <div className="text-[11px] text-[#5A6C5E] mt-0.5">
                  {invoice.recipientAddress}
                </div>
              )}
            </div>

            <div className="sm:text-right">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89]">
                Place of Supply
              </span>
              <div className="text-xs text-[#1A2E20] mt-1 font-semibold">
                State: Haryana (Code {invoice.recipientStateCode})
              </div>
              {invoice.recipientGstin && (
                <div className="text-xs text-[#5A6C5E] mt-0.5">
                  Resident GSTIN: <strong>{invoice.recipientGstin}</strong>
                </div>
              )}
              {invoice.rentChargeId && (
                <div className="text-[11px] text-[#5A6C5E] mt-1">
                  Ledger Charge Ref: <code>{invoice.rentChargeId}</code>
                </div>
              )}
            </div>
          </div>

          {/* Itemized Table */}
          <div className="py-5">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-[#1A2E20] text-[11px] font-bold text-[#1A2E20] uppercase tracking-wider">
                  <th className="py-2 pr-2">#</th>
                  <th className="py-2 px-2">Description</th>
                  <th className="py-2 px-2">SAC/HSN</th>
                  <th className="py-2 px-2 text-right">Qty</th>
                  <th className="py-2 px-2 text-right">Rate</th>
                  <th className="py-2 px-2 text-right">Amount</th>
                  {isGst && (
                    <>
                      <th className="py-2 px-2 text-right">Tax Rate</th>
                      <th className="py-2 px-2 text-right">CGST</th>
                      <th className="py-2 px-2 text-right">SGST</th>
                    </>
                  )}
                  <th className="py-2 pl-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/20 text-xs">
                {invoice.items && invoice.items.length > 0 ? (
                  invoice.items.map((item, idx) => (
                    <tr key={item.id || idx}>
                      <td className="py-2.5 pr-2 text-[#5A6C5E]">{idx + 1}</td>
                      <td className="py-2.5 px-2 font-medium text-[#1A2E20]">
                        {item.description}
                      </td>
                      <td className="py-2.5 px-2 text-[#5A6C5E]">{item.sacHsnCode || "—"}</td>
                      <td className="py-2.5 px-2 text-right text-[#5A6C5E]">{item.quantity}</td>
                      <td className="py-2.5 px-2 text-right text-[#5A6C5E]">₹{formatINR(item.unitPrice)}</td>
                      <td className="py-2.5 px-2 text-right text-[#1A2E20] font-medium">₹{formatINR(item.amount)}</td>
                      {isGst && (
                        <>
                          <td className="py-2.5 px-2 text-right text-[#5A6C5E]">{item.taxRate}%</td>
                          <td className="py-2.5 px-2 text-right text-[#5A6C5E]">₹{formatINR(item.cgstAmount)}</td>
                          <td className="py-2.5 px-2 text-right text-[#5A6C5E]">₹{formatINR(item.sgstAmount)}</td>
                        </>
                      )}
                      <td className="py-2.5 pl-2 text-right font-bold text-[#1A2E20]">
                        ₹{formatINR(item.totalItemAmount)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={isGst ? 10 : 7} className="py-4 text-center text-[#5A6C5E]">
                      Accommodation &amp; Living Services for {invoice.billingPeriod}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals & Tax Summary Breakdown */}
          <div className="flex flex-col sm:flex-row justify-between gap-6 py-4 border-t border-[#8E9F89]/20">
            <div className="space-y-2 max-w-sm">
              {invoice.notes && (
                <div className="p-3 bg-[#FAF8F5] rounded-lg border border-[#8E9F89]/20 text-[11px] text-[#5A6C5E]">
                  <strong>Notes:</strong> {invoice.notes}
                </div>
              )}
              <div className="text-[11px] text-[#5A6C5E] space-y-0.5">
                <div><strong>Terms &amp; Settlement:</strong></div>
                <div>• All rents are due on or before the due date.</div>
                <div>• Liquid payments can be remitted via UPI, Bank Transfer, or Cash at the front desk.</div>
              </div>
            </div>

            <div className="w-full sm:w-64 space-y-1.5 text-xs">
              <div className="flex justify-between text-[#5A6C5E]">
                <span>Taxable Subtotal:</span>
                <span className="font-medium text-[#1A2E20]">₹{formatINR(invoice.subtotal)}</span>
              </div>
              {isGst && (
                <>
                  <div className="flex justify-between text-[#5A6C5E]">
                    <span>CGST (Central Tax):</span>
                    <span>₹{formatINR(invoice.cgstAmount)}</span>
                  </div>
                  <div className="flex justify-between text-[#5A6C5E]">
                    <span>SGST (State Tax):</span>
                    <span>₹{formatINR(invoice.sgstAmount)}</span>
                  </div>
                  {invoice.igstAmount > 0 && (
                    <div className="flex justify-between text-[#5A6C5E]">
                      <span>IGST (Integrated Tax):</span>
                      <span>₹{formatINR(invoice.igstAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[#5A6C5E]">
                    <span>Total Tax:</span>
                    <span>₹{formatINR(invoice.totalTax)}</span>
                  </div>
                </>
              )}
              <div className="flex justify-between text-sm font-bold text-[#1A2E20] pt-2 border-t-2 border-[#1A2E20]">
                <span>Invoice Total:</span>
                <span>₹{formatINR(invoice.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-xs text-green-700 font-semibold">
                <span>Amount Paid:</span>
                <span>- ₹{formatINR(invoice.amountPaid)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-[#B58A57] pt-1 border-t border-[#8E9F89]/20">
                <span>Balance Due:</span>
                <span>₹{formatINR(invoice.balanceDue)}</span>
              </div>
            </div>
          </div>

          {/* Applied Payments History */}
          {invoice.allocations && invoice.allocations.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[#8E9F89]/20">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89]">
                Allocated Payment Receipts
              </span>
              <div className="mt-2 divide-y divide-[#8E9F89]/15 border border-[#8E9F89]/20 rounded-lg overflow-hidden">
                {invoice.allocations.map((alloc) => (
                  <div
                    key={alloc.id}
                    className="p-2.5 bg-[#FAF8F5] flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-medium text-[#1A2E20]">
                        {alloc.paymentDate || alloc.allocatedAt.slice(0, 10)}
                      </span>
                      <span className="text-[#5A6C5E] ml-2">
                        via {alloc.paymentMethod || "CASH"}
                        {alloc.referenceNumber ? ` (Ref: ${alloc.referenceNumber})` : ""}
                      </span>
                      {alloc.paymentReversed && (
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[#9A3423]">Payment reversed</span>
                      )}
                      {alloc.notes && (
                        <div className="text-[11px] text-[#5A6C5E] italic">
                          {alloc.notes}
                        </div>
                      )}
                    </div>
                    <div className={alloc.paymentReversed ? "font-bold text-[#8E9F89] line-through" : "font-bold text-green-700"}>
                      ₹{formatINR(alloc.amount)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Signatures & Footer */}
          <div className="mt-10 pt-6 border-t border-[#8E9F89]/20 flex justify-between items-end text-[11px] text-[#5A6C5E]">
            <div>
              <div>Ravinarayan PG Guesthouse Management</div>
              <div>This is a computer-generated billing document.</div>
            </div>
            <div className="text-right">
              <div className="h-10 border-b border-[#1A2E20]/40 w-40 mb-1"></div>
              <div>Authorized Signatory</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
