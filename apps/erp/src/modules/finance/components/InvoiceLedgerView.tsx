"use client";

import React, { useState, useMemo } from "react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import {
  FileText,
  Search,
  Filter,
  Plus,
  Printer,
  CreditCard,
  Send,
  XCircle,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowUpDown,
  RefreshCw,
} from "lucide-react";
import { Invoice, InvoiceStatus, InvoiceType, ResidentListItem } from "@/types";
import { formatINR } from "../utils/formatUtils";
import { CreateInvoiceModal } from "./modals/CreateInvoiceModal";
import { PrintableInvoiceModal } from "./modals/PrintableInvoiceModal";
import { AllocatePaymentModal } from "./modals/AllocatePaymentModal";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { businessToday } from "@/lib/businessDate";

interface InvoiceLedgerViewProps {
  residents: ResidentListItem[];
  onOpenRecordPayment?: (residentId: string) => void;
  onRefreshParentFinance?: () => void;
}

export function InvoiceLedgerView({
  residents,
  onOpenRecordPayment,
  onRefreshParentFinance,
}: InvoiceLedgerViewProps) {
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<"ALL" | "RESIDENT" | "TIFFIN">("ALL");

  // Modals
  // Create/issue/allocate/cancel require finance.manage (Owner); the server enforces this too.
  const canManageFinance = useHasPermission("finance.manage");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  const [isAllocateOpen, setIsAllocateOpen] = useState(false);
  const [invoiceToAllocate, setInvoiceToAllocate] = useState<Invoice | null>(null);

  // Cancel dialog
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Cached per filter combination: switching tabs or returning to Finance reuses the list;
  // invoice actions invalidate it (and dependent summaries) so the next render is fresh.
  const invoiceParams = new URLSearchParams();
  if (statusFilter !== "ALL") invoiceParams.set("status", statusFilter);
  if (typeFilter !== "ALL") invoiceParams.set("invoiceType", typeFilter);
  if (categoryFilter !== "ALL") invoiceParams.set("invoiceCategory", categoryFilter);
  invoiceParams.set("limit", "100");
  const invoiceKey = `/api/finance/invoices?${invoiceParams.toString()}`;
  const {
    data: invoiceData,
    error: invoiceLoadError,
    isLoading: invoicesLoading,
    isRevalidating: invoicesRevalidating,
    refetch: refetchInvoices,
  } = useErpQuery<Invoice[]>(
    invoiceKey,
    async () => {
      const res = await fetch(invoiceKey, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load invoices.");
      return data.invoices || [];
    },
    { ttl: 60000, tags: ["finance", "invoices"] }
  );
  const invoices = invoiceData ?? [];
  const loading = invoicesLoading && !invoiceData;

  const fetchInvoices = () => invalidateErpCache(["invoices", "dashboard"]);

  // Client-side search filtering
  const filteredInvoices = useMemo(() => {
    if (!searchTerm.trim()) return invoices;
    const term = searchTerm.toLowerCase().trim();
    return invoices.filter((inv) => {
      const numMatch = inv.invoiceNumber?.toLowerCase().includes(term);
      const residentMatch = inv.residentName?.toLowerCase().includes(term);
      const customerMatch = inv.customerName?.toLowerCase().includes(term);
      const recipientMatch = inv.recipientName?.toLowerCase().includes(term);
      const periodMatch = inv.billingPeriod?.toLowerCase().includes(term);
      const roomMatch = inv.roomNumber?.toLowerCase().includes(term);
      return Boolean(numMatch || residentMatch || customerMatch || recipientMatch || periodMatch || roomMatch);
    });
  }, [invoices, searchTerm]);

  // Aggregates
  const totalBilled = filteredInvoices.reduce((sum, i) => sum + i.totalAmount, 0);
  const totalCollected = filteredInvoices.reduce((sum, i) => sum + i.amountPaid, 0);
  const totalDue = filteredInvoices.reduce((sum, i) => sum + i.balanceDue, 0);

  const todayStr = businessToday();
  const ageingBuckets = useMemo(() => {
    let current = 0;
    let days1To30 = 0;
    let days31To60 = 0;
    let days61To90 = 0;
    let days90Plus = 0;

    for (const inv of filteredInvoices) {
      if (inv.balanceDue <= 0 || inv.status === "CANCELLED" || inv.status === "DRAFT") continue;
      const diffMs = new Date(`${todayStr}T23:59:59.999Z`).getTime() - new Date(`${inv.dueDate}T23:59:59.999Z`).getTime();
      const daysPast = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      if (inv.dueDate >= todayStr) current += inv.balanceDue;
      else if (daysPast <= 30) days1To30 += inv.balanceDue;
      else if (daysPast <= 60) days31To60 += inv.balanceDue;
      else if (daysPast <= 90) days61To90 += inv.balanceDue;
      else days90Plus += inv.balanceDue;
    }
    return { current, days1To30, days31To60, days61To90, days90Plus };
  }, [filteredInvoices, todayStr]);

  const handleIssueInvoice = async (invoiceId: string) => {
    try {
      const res = await fetch(`/api/finance/invoices/${invoiceId}/issue`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to issue invoice.");

      setActionSuccess(`Invoice ${data.invoice.invoiceNumber} successfully issued!`);
      if (selectedInvoice && selectedInvoice.id === invoiceId) {
        setSelectedInvoice(data.invoice);
      }
      fetchInvoices();
      if (onRefreshParentFinance) onRefreshParentFinance();
    } catch (err: any) {
      setError(err.message || "Failed to issue invoice.");
    }
  };

  const handleCancelInvoice = async () => {
    if (!cancelTargetId) return;
    if (!cancelReason.trim() || cancelReason.trim().length < 5) {
      setError("Cancellation reason must be at least 5 characters.");
      return;
    }

    setCancelling(true);
    try {
      const res = await fetch(`/api/finance/invoices/${cancelTargetId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel invoice.");

      setActionSuccess(`Invoice successfully cancelled.`);
      setCancelTargetId(null);
      setCancelReason("");
      fetchInvoices();
      if (onRefreshParentFinance) onRefreshParentFinance();
    } catch (err: any) {
      setError(err.message || "Failed to cancel invoice.");
    } finally {
      setCancelling(false);
    }
  };

  const openPrintModal = async (invoice: Invoice) => {
    try {
      const res = await fetch(`/api/finance/invoices/${invoice.id}`);
      const data = await res.json();
      if (res.ok && data.invoice) {
        setSelectedInvoice(data.invoice);
      } else {
        setSelectedInvoice(invoice);
      }
    } catch {
      setSelectedInvoice(invoice);
    }
    setIsPrintOpen(true);
  };

  const openAllocateModal = async (invoice: Invoice) => {
    try {
      const res = await fetch(`/api/finance/invoices/${invoice.id}`);
      const data = await res.json();
      if (res.ok && data.invoice) {
        setInvoiceToAllocate(data.invoice);
      } else {
        setInvoiceToAllocate(invoice);
      }
    } catch {
      setInvoiceToAllocate(invoice);
    }
    setIsAllocateOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Top Banner Alert / Success */}
      {actionSuccess && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-xl flex items-center justify-between text-green-800 text-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span>{actionSuccess}</span>
          </div>
          <button
            onClick={() => setActionSuccess(null)}
            className="text-green-700 hover:text-green-900 font-semibold text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {(error || (invoiceLoadError && !invoiceData)) && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between text-red-800 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span>{error || invoiceLoadError?.message || "Failed to load invoices."}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 font-semibold text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards for Invoicing */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-4 bg-white border border-[#8E9F89]/25 rounded-2xl shadow-2xs">
          <div className="text-[11px] font-semibold text-[#5A6C5E] uppercase tracking-wider">
            Total Invoiced
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#1A2E20] mt-1 font-serif">
            ₹{formatINR(totalBilled)}
          </div>
          <div className="text-[11px] text-[#5A6C5E] mt-0.5">
            Across {filteredInvoices.length} invoices
          </div>
        </div>

        <div className="p-4 bg-white border border-[#8E9F89]/25 rounded-2xl shadow-2xs">
          <div className="text-[11px] font-semibold text-[#5A6C5E] uppercase tracking-wider">
            Payments Allocated
          </div>
          <div className="text-xl sm:text-2xl font-bold text-green-700 mt-1 font-serif">
            ₹{formatINR(totalCollected)}
          </div>
          <div className="text-[11px] text-[#5A6C5E] mt-0.5">
            Settled against bills
          </div>
        </div>

        <div className="p-4 bg-white border border-[#8E9F89]/25 rounded-2xl shadow-2xs">
          <div className="text-[11px] font-semibold text-[#5A6C5E] uppercase tracking-wider">
            Remaining Invoiced Due
          </div>
          <div className="text-xl sm:text-2xl font-bold text-[#B58A57] mt-1 font-serif">
            ₹{formatINR(totalDue)}
          </div>
          <div className="text-[11px] text-[#5A6C5E] mt-0.5">
            Outstanding receivables
          </div>
        </div>
      </div>

      {/* Accounts Receivable Ageing Schedule */}
      <div className="p-3.5 bg-[#FAF8F5] border border-[#8E9F89]/25 rounded-2xl shadow-2xs">
        <div className="flex items-center justify-between pb-2 border-b border-[#8E9F89]/15">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#1A2E20] flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[#B58A57]" />
            Accounts Receivable Ageing Breakdown
          </span>
          <span className="text-[10px] text-[#5A6C5E]">
            As of Today ({todayStr})
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2.5 text-center">
          <div className="p-2 rounded-xl bg-white border border-emerald-100 shadow-2xs">
            <span className="text-[10px] font-semibold uppercase text-emerald-700 tracking-wider block">Current (&le;0d)</span>
            <span className="text-xs sm:text-sm font-bold text-[#1A2E20] mt-0.5 block">₹{formatINR(ageingBuckets.current)}</span>
          </div>
          <div className="p-2 rounded-xl bg-white border border-amber-100 shadow-2xs">
            <span className="text-[10px] font-semibold uppercase text-amber-700 tracking-wider block">1–30 Days</span>
            <span className="text-xs sm:text-sm font-bold text-[#1A2E20] mt-0.5 block">₹{formatINR(ageingBuckets.days1To30)}</span>
          </div>
          <div className="p-2 rounded-xl bg-white border border-orange-100 shadow-2xs">
            <span className="text-[10px] font-semibold uppercase text-orange-700 tracking-wider block">31–60 Days</span>
            <span className="text-xs sm:text-sm font-bold text-[#1A2E20] mt-0.5 block">₹{formatINR(ageingBuckets.days31To60)}</span>
          </div>
          <div className="p-2 rounded-xl bg-white border border-rose-100 shadow-2xs">
            <span className="text-[10px] font-semibold uppercase text-rose-700 tracking-wider block">61–90 Days</span>
            <span className="text-xs sm:text-sm font-bold text-[#1A2E20] mt-0.5 block">₹{formatINR(ageingBuckets.days61To90)}</span>
          </div>
          <div className="p-2 rounded-xl bg-white border border-red-200 shadow-2xs col-span-2 sm:col-span-1">
            <span className="text-[10px] font-semibold uppercase text-red-700 tracking-wider block">90+ Days</span>
            <span className="text-xs sm:text-sm font-bold text-red-700 mt-0.5 block">₹{formatINR(ageingBuckets.days90Plus)}</span>
          </div>
        </div>
      </div>

      {/* Control Bar: Search, Filters & Generate Button */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white border border-[#8E9F89]/25 rounded-2xl shadow-2xs">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-[#8E9F89] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Search invoice #, resident, room..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#5A6C5E] font-medium hidden md:inline">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
            >
              <option value="ALL">All Statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="ISSUED">Issued</option>
              <option value="PARTIALLY_PAID">Partially Paid</option>
              <option value="PAID">Paid</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#5A6C5E] font-medium hidden md:inline">Source:</span>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as any)}
              className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
            >
              <option value="ALL">All Sources (PG + Tiffin)</option>
              <option value="RESIDENT">PG Accommodation</option>
              <option value="TIFFIN">Commercial Tiffin</option>
            </select>
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#5A6C5E] font-medium hidden md:inline">Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
            >
              <option value="ALL">All Bill Types</option>
              <option value="REGULAR_BILL">Regular Bill (Non-GST)</option>
              <option value="GST_TAX_INVOICE">GST Tax Invoice</option>
            </select>
          </div>

          <button
            onClick={() => refetchInvoices()}
            disabled={invoicesLoading || invoicesRevalidating}
            className="p-1.5 rounded-xl border border-[#8E9F89]/30 hover:bg-[#FAF8F5] text-[#5A6C5E] transition-colors"
            title="Reload invoices"
          >
            <RefreshCw className={`w-4 h-4 ${invoicesLoading || invoicesRevalidating ? "animate-spin text-[#B58A57]" : ""}`} />
          </button>
        </div>

        {/* Primary Action Button (invoices are Owner-level: finance.manage) */}
        {canManageFinance && (
        <button
          onClick={() => setIsCreateOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#1A2E20] hover:bg-[#263B2D] text-white rounded-xl text-xs font-semibold transition-colors shadow-2xs shrink-0"
        >
          <Plus className="w-4 h-4 text-[#B58A57]" />
          Generate Invoice
        </button>
        )}
      </div>

      {/* Invoices Table */}
      <div className="bg-white border border-[#8E9F89]/25 rounded-2xl shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[#5A6C5E] text-xs">
            Loading invoices and billing documents...
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#1A2E20]/5 text-[#1A2E20] flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6 text-[#B58A57]" />
            </div>
            <div className="font-serif font-bold text-base text-[#1A2E20]">
              No Invoices Found
            </div>
            <p className="text-xs text-[#5A6C5E] max-w-sm mx-auto">
              {searchTerm || statusFilter !== "ALL" || typeFilter !== "ALL"
                ? "No billing records match your current filters. Clear filters to see all invoices."
                : "Generate your first resident invoice to begin tracking structured bills, tax breakdowns, and payment allocations."}
            </p>
            {canManageFinance && (
            <button
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1A2E20] text-white rounded-xl text-xs font-semibold hover:bg-[#263B2D] transition-colors shadow-2xs"
            >
              <Plus className="w-3.5 h-3.5 text-[#B58A57]" />
              Generate First Invoice
            </button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile Invoices Card List (< md screens) */}
            <div className="block md:hidden divide-y divide-[#8E9F89]/15">
              {filteredInvoices.map((inv) => {
                const isPaid = inv.status === "PAID";
                const isPartiallyPaid = inv.status === "PARTIALLY_PAID";
                const isDraft = inv.status === "DRAFT";
                const isCancelled = inv.status === "CANCELLED";

                return (
                  <div key={`mobile-inv-${inv.id}`} className="p-4 space-y-2.5">
                    {/* Header: Number & Status */}
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-xs text-[#1A2E20]">
                        {inv.invoiceNumber || "Draft (Pending Issue)"}
                      </span>
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
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
                        {inv.status}
                      </span>
                    </div>

                    {/* Party & Category */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#1A2E20]">
                        {inv.invoiceCategory === "TIFFIN"
                          ? (inv.customerName || inv.recipientName || "Tiffin Customer")
                          : (inv.residentName || inv.recipientName || "PG Resident")}
                      </span>
                      <span className="text-[10px] text-[#5A6C5E] uppercase font-mono">
                        {inv.invoiceType === "GST_TAX_INVOICE" ? "GST Invoice" : "Regular Bill"}
                      </span>
                    </div>

                    {/* Financial Figures */}
                    <div className="grid grid-cols-3 gap-2 bg-[#FAF8F5] p-2.5 rounded-xl border border-[#8E9F89]/15 text-center text-xs">
                      <div>
                        <span className="text-[10px] text-[#5A6C5E] block">Total</span>
                        <span className="font-bold text-[#1A2E20]">₹{formatINR(inv.totalAmount)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#5A6C5E] block">Paid</span>
                        <span className="font-bold text-green-700">₹{formatINR(inv.amountPaid)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-[#5A6C5E] block">Balance</span>
                        <span className={`font-bold ${inv.balanceDue > 0 ? "text-rose-700" : "text-[#1A2E20]"}`}>
                          ₹{formatINR(inv.balanceDue)}
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={() => openPrintModal(inv)}
                        className="px-3 py-1.5 rounded-lg border border-[#8E9F89]/30 text-[#1A2E20] hover:bg-white text-xs font-medium flex items-center gap-1 shadow-2xs"
                      >
                        <Printer className="w-3.5 h-3.5 text-[#B58A57]" />
                        <span>Print Bill</span>
                      </button>

                      {canManageFinance && isDraft && (
                        <button
                          onClick={() => handleIssueInvoice(inv.id)}
                          className="px-3 py-1.5 bg-[#B58A57] hover:bg-[#9E7443] text-white rounded-lg text-xs font-semibold shadow-2xs"
                        >
                          Issue
                        </button>
                      )}

                      {canManageFinance && (inv.status === "ISSUED" || isPartiallyPaid) && (
                        <button
                          onClick={() => openAllocateModal(inv)}
                          className="px-3 py-1.5 bg-[#1A2E20] hover:bg-[#263B2D] text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-2xs"
                        >
                          <CreditCard className="w-3.5 h-3.5 text-[#B58A57]" />
                          <span>Allocate</span>
                        </button>
                      )}

                      {canManageFinance && inv.amountPaid === 0 && !isCancelled && (
                        <button
                          onClick={() => {
                            setCancelTargetId(inv.id);
                            setCancelReason("");
                          }}
                          className="px-2.5 py-1.5 text-xs text-stone-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop / Tablet Horizontal Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#8E9F89]/20 text-[11px] font-bold text-[#1A2E20] uppercase tracking-wider">
                  <th className="py-3 px-4">Invoice #</th>
                  <th className="py-3 px-4">Resident / Customer</th>
                  <th className="py-3 px-3">Period</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3 text-right">Total</th>
                  <th className="py-3 px-3 text-right">Paid</th>
                  <th className="py-3 px-3 text-right">Balance Due</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/15">
                {filteredInvoices.map((inv) => {
                  const isGst = inv.invoiceType === "GST_TAX_INVOICE";
                  const isPaid = inv.status === "PAID";
                  const isPartiallyPaid = inv.status === "PARTIALLY_PAID";
                  const isDraft = inv.status === "DRAFT";
                  const isCancelled = inv.status === "CANCELLED";

                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-[#FAF8F5]/60 transition-colors"
                    >
                      {/* Invoice Number */}
                      <td className="py-3 px-4 font-mono font-semibold text-[#1A2E20]">
                        {inv.invoiceNumber ? (
                          <span className="text-[#1A2E20]">{inv.invoiceNumber}</span>
                        ) : (
                          <span className="text-gray-400 italic">Draft</span>
                        )}
                      </td>

                      {/* Resident / Customer */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#1A2E20]">
                          {inv.invoiceCategory === "TIFFIN"
                            ? (inv.customerName || inv.recipientName || "Tiffin Customer")
                            : (inv.residentName || inv.recipientName || "Resident")}
                        </div>
                        <div className="text-[11px] text-[#5A6C5E]">
                          {inv.invoiceCategory === "TIFFIN" ? (
                            <span className="text-purple-700 font-medium">Commercial Tiffin</span>
                          ) : inv.roomNumber ? (
                            `Room ${inv.roomNumber}`
                          ) : (
                            "No Bed"
                          )}
                        </div>
                      </td>

                      {/* Period */}
                      <td className="py-3 px-3 text-[#5A6C5E]">
                        <div>{inv.billingPeriod}</div>
                        <div className="text-[10px] text-[#8E9F89]">Due {inv.dueDate}</div>
                      </td>

                      {/* Type Badge */}
                      <td className="py-3 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                            isGst
                              ? "bg-[#B58A57]/15 text-[#9E7443] border border-[#B58A57]/30"
                              : "bg-[#1A2E20]/10 text-[#1A2E20]"
                          }`}
                        >
                          {isGst ? "GST Invoice" : "Regular Bill"}
                        </span>
                      </td>

                      {/* Total */}
                      <td className="py-3 px-3 text-right font-medium text-[#1A2E20]">
                        ₹{formatINR(inv.totalAmount)}
                        {isGst && inv.totalTax > 0 && (
                          <div className="text-[10px] text-[#5A6C5E]">
                            (Tax ₹{formatINR(inv.totalTax)})
                          </div>
                        )}
                      </td>

                      {/* Paid */}
                      <td className="py-3 px-3 text-right font-medium text-green-700">
                        ₹{formatINR(inv.amountPaid)}
                      </td>

                      {/* Balance Due */}
                      <td className="py-3 px-3 text-right font-bold text-[#B58A57]">
                        ₹{formatINR(inv.balanceDue)}
                      </td>

                      {/* Status Badge */}
                      <td className="py-3 px-3 text-center">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
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
                          {inv.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View / Print */}
                          <button
                            onClick={() => openPrintModal(inv)}
                            className="p-1.5 rounded-lg border border-[#8E9F89]/30 text-[#1A2E20] hover:bg-white hover:border-[#1A2E20] transition-colors"
                            title="View / Print Branded Bill"
                          >
                            <Printer className="w-3.5 h-3.5 text-[#B58A57]" />
                          </button>

                          {/* Issue (Drafts only) */}
                          {canManageFinance && isDraft && (
                            <button
                              onClick={() => handleIssueInvoice(inv.id)}
                              className="px-2 py-1 bg-[#B58A57] hover:bg-[#9E7443] text-white rounded-lg text-[11px] font-semibold transition-colors"
                              title="Issue and assign official sequential number"
                            >
                              Issue
                            </button>
                          )}

                          {/* Allocate Payment (Issued or Partially Paid) */}
                          {canManageFinance && (inv.status === "ISSUED" || isPartiallyPaid) && (
                            <button
                              onClick={() => openAllocateModal(inv)}
                              className="px-2 py-1 bg-[#1A2E20] hover:bg-[#263B2D] text-white rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1"
                              title="Allocate collected payment against this invoice"
                            >
                              <CreditCard className="w-3 h-3 text-[#B58A57]" />
                              Allocate
                            </button>
                          )}

                          {/* Cancel Invoice */}
                          {canManageFinance && inv.amountPaid === 0 && !isCancelled && (
                            <button
                              onClick={() => {
                                setCancelTargetId(inv.id);
                                setCancelReason("");
                              }}
                              className="p-1.5 rounded-lg text-[#8E9F89] hover:text-red-700 hover:bg-red-50 transition-colors"
                              title="Cancel invoice"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
        )}
      </div>

      {/* Cancellation Prompt Modal */}
      {cancelTargetId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1A2E20]/60 backdrop-blur-xs"
        >
          <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl p-5 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-red-700">
                <XCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#1A2E20]">Cancel Invoice</h3>
                <p className="text-xs text-[#5A6C5E]">
                  This action is permanent and recorded in the audit trail.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Cancellation Reason (Required, min 5 chars)
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g. Duplicate draft created by mistake"
                rows={3}
                className="w-full p-2.5 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelTargetId(null)}
                disabled={cancelling}
                className="px-4 py-2 border border-[#8E9F89]/30 rounded-xl text-xs text-[#5A6C5E] hover:bg-white"
              >
                Keep Invoice
              </button>
              <button
                type="button"
                onClick={handleCancelInvoice}
                disabled={cancelling || cancelReason.trim().length < 5}
                className="px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
              >
                {cancelling ? "Cancelling..." : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <CreateInvoiceModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        residents={residents}
        onSuccess={(inv, msg) => {
          setActionSuccess(msg);
          fetchInvoices();
          if (onRefreshParentFinance) onRefreshParentFinance();
        }}
      />

      <PrintableInvoiceModal
        isOpen={isPrintOpen}
        onClose={() => {
          setIsPrintOpen(false);
          setSelectedInvoice(null);
        }}
        invoice={selectedInvoice}
        onOpenAllocate={(inv) => openAllocateModal(inv)}
        onIssueInvoice={(id) => handleIssueInvoice(id)}
      />

      <AllocatePaymentModal
        isOpen={isAllocateOpen}
        onClose={() => {
          setIsAllocateOpen(false);
          setInvoiceToAllocate(null);
        }}
        invoice={invoiceToAllocate}
        onSuccess={(updatedInv, alloc, msg) => {
          setActionSuccess(msg);
          fetchInvoices();
          if (onRefreshParentFinance) onRefreshParentFinance();
        }}
        onOpenRecordPayment={onOpenRecordPayment}
      />
    </div>
  );
}
