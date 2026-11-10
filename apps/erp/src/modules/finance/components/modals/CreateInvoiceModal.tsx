"use client";

import { friendlyError } from "@/lib/friendlyError";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect, useRef } from "react";
import { X, FileText, Plus, Trash2, AlertCircle, Info } from "lucide-react";
import { ResidentListItem, Invoice, InvoiceType } from "@/types";
import { toLocalDateString } from "../../utils/dateUtils";
import { formatINR } from "../../utils/formatUtils";
import { businessToday, addBusinessDays } from "@/lib/businessDate";

interface CreateInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  residents: ResidentListItem[];
  initialResidentId?: string;
  onSuccess: (invoice: Invoice, message: string) => void;
}

interface LineItemState {
  description: string;
  sacHsnCode: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export function CreateInvoiceModal({
  isOpen,
  onClose,
  residents,
  initialResidentId,
  onSuccess,
}: CreateInvoiceModalProps) {
  const now = new Date();
  const currentMonthPeriod = `${now.toLocaleString("default", { month: "long" })} ${now.getFullYear()}`;

  // Next week for due date
  const defaultDueDate = addBusinessDays(businessToday(), 7);

  const [residentId, setResidentId] = useState(initialResidentId || "");
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("REGULAR_BILL");
  const [billingPeriod, setBillingPeriod] = useState(currentMonthPeriod);
  const [issueDate, setIssueDate] = useState(toLocalDateString());
  const [dueDate, setDueDate] = useState(defaultDueDate);
  const [notes, setNotes] = useState("");
  const [autoIssue, setAutoIssue] = useState(true);
  const [linkExistingCharge, setLinkExistingCharge] = useState(true);

  const [items, setItems] = useState<LineItemState[]>([
    {
      description: "Monthly PG Accommodation & Living Amenities",
      sacHsnCode: "9963",
      quantity: 1,
      unitPrice: 8500,
      taxRate: 0,
    },
  ]);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Ignores a second activation while a save is being sent (state-based disabling only applies after a render).
  const inFlight = useRef(false);
  // One key per opened form: a retry after a lost response returns the invoice already created.
  const entryKey = useRef("");

  useEffect(() => {
    if (isOpen) {
      entryKey.current = `inv_${crypto.randomUUID()}`;
      setError(null);
      setIssueDate(toLocalDateString());
      if (initialResidentId) {
        setResidentId(initialResidentId);
      }
    }
  }, [isOpen, initialResidentId]);

  // When resident changes, update selected resident
  const handleResidentChange = (newResidentId: string) => {
    setResidentId(newResidentId);
  };

  const addItemRow = () => {
    setItems((prev) => [
      ...prev,
      {
        description: "",
        sacHsnCode: "9963",
        quantity: 1,
        unitPrice: 0,
        taxRate: invoiceType === "GST_TAX_INVOICE" ? 12 : 0,
      },
    ]);
  };

  const removeItemRow = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof LineItemState, value: any) => {
    setItems((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        return { ...item, [field]: value };
      })
    );
  };

  // Switch type and adapt tax rates
  const handleTypeChange = (type: InvoiceType) => {
    setInvoiceType(type);
    if (type === "REGULAR_BILL") {
      setItems((prev) => prev.map((item) => ({ ...item, taxRate: 0 })));
    } else {
      setItems((prev) =>
        prev.map((item) => ({
          ...item,
          taxRate: item.taxRate === 0 ? 12 : item.taxRate,
        }))
      );
    }
  };

  // Computations
  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0);
  const totalTax =
    invoiceType === "GST_TAX_INVOICE"
      ? items.reduce(
          (sum, it) =>
            sum + Math.round((it.quantity * it.unitPrice * (it.taxRate || 0)) / 100),
          0
        )
      : 0;
  const grandTotal = subtotal + totalTax;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!residentId) {
      setError("Please select a resident to bill.");
      return;
    }
    if (!billingPeriod.trim()) {
      setError("Billing period (e.g. 'October 2026') is required.");
      return;
    }
    if (items.length === 0) {
      setError("At least one line item is required.");
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (!items[i].description.trim()) {
        setError(`Line item #${i + 1} requires a description.`);
        return;
      }
      if (items[i].quantity <= 0) {
        setError(`Line item #${i + 1} quantity must be at least 1.`);
        return;
      }
      if (items[i].unitPrice < 0) {
        setError(`Line item #${i + 1} unit price cannot be negative.`);
        return;
      }
    }

    if (inFlight.current) return;

    inFlight.current = true;

    setSubmitting(true);
    try {
      const res = await fetch("/api/finance/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId,
          invoiceType,
          billingPeriod: billingPeriod.trim(),
          issueDate,
          dueDate,
          notes: notes.trim() || undefined,
          autoIssue,
          linkExistingCharge,
          idempotencyKey: entryKey.current || undefined,
          items: items.map((it) => ({
            description: it.description.trim(),
            sacHsnCode: it.sacHsnCode.trim() || undefined,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            taxRate: invoiceType === "GST_TAX_INVOICE" ? Number(it.taxRate) : 0,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create invoice.");
      }

      const invoiceNum = data.invoice.invoiceNumber || "Draft";
      onSuccess(
        data.invoice,
        `Invoice ${invoiceNum} generated successfully for ${formatINR(data.invoice.totalAmount)}.`
      );
      onClose();
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to create invoice."));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-invoice-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto rn-modal-scrim"
    >
      <div className="rn-modal rn-modal-wide bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-2xl w-full my-6 overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1A2E20]/10 flex items-center justify-center text-[#1A2E20]">
              <FileText className="w-5 h-5 text-[#B58A57]" />
            </div>
            <div>
              <h2 id="create-invoice-title" className="text-lg font-bold text-[#1A2E20]">
                Generate Resident Invoice
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 text-xs sm:text-sm">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Invoice Type Toggle */}
          <div>
            <label className="block text-xs font-semibold text-[#1A2E20] mb-1.5">
              Invoice Category
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleTypeChange("REGULAR_BILL")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  invoiceType === "REGULAR_BILL"
                    ? "border-[#1A2E20] bg-white text-[#1A2E20] shadow-xs ring-1 ring-[#1A2E20]"
                    : "border-[#8E9F89]/30 bg-[#FAF8F5] text-[#5A6C5E] hover:bg-white"
                }`}
              >
                <div className="font-semibold text-xs text-[#1A2E20]">Regular Bill</div>
              </button>

              <button
                type="button"
                onClick={() => handleTypeChange("GST_TAX_INVOICE")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  invoiceType === "GST_TAX_INVOICE"
                    ? "border-[#B58A57] bg-white text-[#1A2E20] shadow-xs ring-1 ring-[#B58A57]"
                    : "border-[#8E9F89]/30 bg-[#FAF8F5] text-[#5A6C5E] hover:bg-white"
                }`}
              >
                <div className="font-semibold text-xs text-[#B58A57]">GST Tax Invoice</div>
              </button>
            </div>
          </div>

          {invoiceType === "GST_TAX_INVOICE" && (
            <div className="p-3 rounded-xl bg-[#B58A57]/10 border border-[#B58A57]/30 flex items-start gap-2 text-[11px] text-[#1A2E20]">
              <Info className="w-4 h-4 shrink-0 text-[#B58A57] mt-0.5" />
              <span>
                GST Tax Invoices require authentic registered GSTIN configuration (via <code>ERP_COMPANY_GSTIN</code>). If not yet registered with GST authorities, use the Regular Bill option.
              </span>
            </div>
          )}

          {/* Resident Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="inv-resident" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Resident <span className="text-red-500">*</span>
              </label>
              <AppSelect
                id="inv-resident"
                value={residentId}
                onChange={(e) => handleResidentChange(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
              >
                <option value="">-- Select Resident --</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName} ({r.currentRoomNumber ? `Room ${r.currentRoomNumber}` : "No Room"})
                  </option>
                ))}
              </AppSelect>
            </div>

            <div>
              <label htmlFor="inv-period" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Billing Period <span className="text-red-500">*</span>
              </label>
              <input
                id="inv-period"
                type="text"
                value={billingPeriod}
                onChange={(e) => setBillingPeriod(e.target.value)}
                placeholder="e.g. October 2026"
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="inv-issue-date" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Date of Issue
              </label>
              <input
                id="inv-issue-date"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
              />
            </div>
            <div>
              <label htmlFor="inv-due-date" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Due Date
              </label>
              <input
                id="inv-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-[#1A2E20]">
                Line Items
              </label>
              <button
                type="button"
                onClick={addItemRow}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#B58A57] hover:text-[#9E7443]"
              >
                <Plus className="w-3.5 h-3.5" /> Add Line Item
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-white border border-[#8E9F89]/30 rounded-xl space-y-2 shadow-2xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-semibold text-[#8E9F89] uppercase tracking-wider">
                      Item #{idx + 1}
                    </span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItemRow(idx)}
                        className="text-[#8E9F89] hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div className="sm:col-span-6">
                      <input
                        type="text"
                        placeholder="Description (e.g. Monthly Room Rent)"
                        value={item.description}
                        onChange={(e) => updateItem(idx, "description", e.target.value)}
                        required
                        className="w-full px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-lg text-xs text-[#1A2E20]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        placeholder="SAC/HSN"
                        value={item.sacHsnCode}
                        onChange={(e) => updateItem(idx, "sacHsnCode", e.target.value)}
                        className="w-full px-2 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-lg text-xs text-[#1A2E20]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        type="number"
                        placeholder="Qty"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                        required
                        className="w-full px-2 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-lg text-xs text-[#1A2E20]"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <input
                        type="number"
                        placeholder="Rate ₹"
                        min="0"
                        value={item.unitPrice || ""}
                        onChange={(e) => updateItem(idx, "unitPrice", Number(e.target.value))}
                        required
                        className="w-full px-2 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-lg text-xs text-[#1A2E20]"
                      />
                    </div>
                  </div>

                  {invoiceType === "GST_TAX_INVOICE" && (
                    <div className="flex items-center justify-between text-[11px] text-[#5A6C5E] pt-1 border-t border-[#8E9F89]/10">
                      <div className="flex items-center gap-2">
                        <span>GST Tax Rate:</span>
                        <AppSelect
                          value={item.taxRate}
                          onChange={(e) => updateItem(idx, "taxRate", Number(e.target.value))}
                          className="px-2 py-1 bg-white border border-[#8E9F89]/40 rounded text-xs text-[#1A2E20]"
                        >
                          <option value="0">0% (Nil)</option>
                          <option value="5">5% (Tiffin / Food)</option>
                          <option value="12">12% (Accommodation)</option>
                          <option value="18">18% (Standard Services)</option>
                        </AppSelect>
                      </div>
                      <div>
                        Tax: {formatINR(Math.round((item.quantity * item.unitPrice * (item.taxRate || 0)) / 100))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="inv-notes" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Invoice Notes &amp; Payment Instructions
            </label>
            <input
              id="inv-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Please pay by the 5th via UPI / Cash"
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
            />
          </div>

          {/* Ledger Integration Options */}
          <div className="p-3 bg-white border border-[#8E9F89]/30 rounded-xl space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoIssue}
                onChange={(e) => setAutoIssue(e.target.checked)}
                className="rounded border-[#8E9F89]/40 text-[#1A2E20] focus:ring-[#1A2E20]"
              />
              <span className="text-xs font-medium text-[#1A2E20]">
                Issue immediately (assigns sequential number <code>INV-YYYY-XXXX</code>)
              </span>
            </label>

            {autoIssue && (
              <label className="flex items-center gap-2 cursor-pointer pl-6">
                <input
                  type="checkbox"
                  checked={linkExistingCharge}
                  onChange={(e) => setLinkExistingCharge(e.target.checked)}
                  className="rounded border-[#8E9F89]/40 text-[#1A2E20] focus:ring-[#1A2E20]"
                />
              </label>
            )}
          </div>

          {/* Summary Box */}
          <div className="p-3 bg-[#1A2E20]/5 rounded-xl border border-[#1A2E20]/15 space-y-1">
            <div className="flex justify-between text-xs text-[#5A6C5E]">
              <span>Subtotal:</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            {invoiceType === "GST_TAX_INVOICE" && (
              <div className="flex justify-between text-xs text-[#5A6C5E]">
                <span>Total Tax (CGST + SGST):</span>
                <span>{formatINR(totalTax)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-[#1A2E20] pt-1 border-t border-[#1A2E20]/10">
              <span>Grand Total:</span>
              <span>{formatINR(grandTotal)}</span>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-[#1A2E20] hover:bg-[#263B2D] text-white rounded-xl text-xs font-semibold transition-colors shadow-sm disabled:opacity-50"
            >
              {submitting
                ? "Generating..."
                : autoIssue
                ? `Issue Invoice (${formatINR(grandTotal)})`
                : "Save as Draft"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
