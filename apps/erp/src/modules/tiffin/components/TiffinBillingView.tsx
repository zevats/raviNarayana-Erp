"use client";

import React, { useState, useEffect, useMemo } from "react";
import { StatStrip } from "@/components/ui/kit";
import { RefreshButton } from "@/components/ui/states";
import {
  Receipt,
  Search,
  Filter,
  Plus,
  Printer,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Eye,
  ShieldCheck,
  Utensils,
  Package,
  FileText,
  AlertTriangle,
} from "lucide-react";
import {
  TiffinBillingPeriodPreview,
  TiffinBillingCustomerPreview,
  GenerateTiffinInvoicesResult,
  Invoice,
} from "@/types";
import { GenerateTiffinInvoicesModal } from "./modals/GenerateTiffinInvoicesModal";
import { RecordTiffinPaymentModal } from "./modals/RecordTiffinPaymentModal";
import { TiffinCustomerBalanceModal } from "./modals/TiffinCustomerBalanceModal";
import { PrintableInvoiceModal } from "@/modules/finance/components/modals/PrintableInvoiceModal";
import { formatNumberIN } from "@/lib/format";

export function TiffinBillingView() {
  // Current Period YYYY-MM
  const [selectedPeriod, setSelectedPeriod] = useState<string>(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  });

  const [preview, setPreview] = useState<TiffinBillingPeriodPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "UNBILLED" | "INVOICED" | "ZERO_MEALS">("ALL");

  // Modals state
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isBalanceOpen, setIsBalanceOpen] = useState(false);
  const [isPrintOpen, setIsPrintOpen] = useState(false);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  const fetchPreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tiffin/billing/preview?billingPeriod=${selectedPeriod}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load tiffin billing preview.");
      }
      setPreview(data.preview);
    } catch (err: any) {
      setError(err.message || "Failed to load billing preview.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPreview();
  }, [selectedPeriod]);

  // Navigate periods
  const handlePrevMonth = () => {
    const [y, m] = selectedPeriod.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setSelectedPeriod(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleNextMonth = () => {
    const [y, m] = selectedPeriod.split("-").map(Number);
    const d = new Date(y, m, 1);
    setSelectedPeriod(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleCurrentMonth = () => {
    const now = new Date();
    setSelectedPeriod(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  };

  // Filtered customer list
  const filteredCustomers = useMemo(() => {
    if (!preview) return [];
    return preview.customers.filter((c: TiffinBillingCustomerPreview) => {
      // Search term
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesName = c.customerName.toLowerCase().includes(term);
        const matchesPhone = c.phone.includes(term);
        const matchesInvoice = c.existingInvoiceNumber?.toLowerCase().includes(term);
        if (!matchesName && !matchesPhone && !matchesInvoice) {
          return false;
        }
      }

      // Filter status
      if (filterStatus === "UNBILLED") {
        return !c.alreadyBilled && c.totalAmount > 0;
      }
      if (filterStatus === "INVOICED") {
        return c.alreadyBilled;
      }
      if (filterStatus === "ZERO_MEALS") {
        return !c.alreadyBilled && c.totalAmount === 0;
      }

      return true;
    });
  }, [preview, searchTerm, filterStatus]);

  // Open invoice print modal
  const handleViewInvoice = async (invoiceId: string) => {
    try {
      const res = await fetch(`/api/finance/invoices/${invoiceId}`);
      const data = await res.json();
      if (res.ok && data.invoice) {
        setSelectedInvoice(data.invoice);
        setIsPrintOpen(true);
      } else {
        setNotification({ message: "Failed to load invoice details.", type: "error" });
      }
    } catch {
      setNotification({ message: "Failed to load invoice details.", type: "error" });
    }
  };

  // Customer options for payment modal
  const customerOptions = useMemo(() => {
    if (!preview) return [];
    return preview.customers.map((c) => ({
      id: c.customerId,
      name: c.customerName,
      customerType: c.customerType,
    }));
  }, [preview]);

  return (
    <div className="space-y-5">
      {/* Notifications */}
      {notification && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
            notification.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-xs font-bold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Period Bar & Actions */}
      <div className="rn-card px-4 py-3.5 sm:px-5 flex flex-wrap items-center justify-between gap-3">
        {/* Month Navigator */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="rn-t-label">Billing period</span>
          <div className="flex items-center bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl p-0.5">
            <button
              onClick={handlePrevMonth}
              title="Previous Month"
              className="p-1 text-gray-600 hover:text-[#1A2E20] hover:bg-white rounded-lg transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <input
              type="month"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              className="px-2 py-0.5 text-xs font-bold text-[#1A2E20] bg-transparent focus:outline-hidden"
            />
            <button
              onClick={handleNextMonth}
              title="Next Month"
              className="p-1 text-gray-600 hover:text-[#1A2E20] hover:bg-white rounded-lg transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <button type="button" onClick={handleCurrentMonth} className="rn-btn rn-btn-sm">
            This month
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <RefreshButton onRefresh={fetchPreview} busy={loading} label="Refresh billing preview" />

          <button
            onClick={() => {
              setSelectedCustomerId(null);
              setIsPaymentOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#8E9F89]/40 hover:bg-gray-50 text-emerald-800 rounded-xl text-xs font-bold transition-all shadow-2xs"
          >
            <CreditCard className="w-4 h-4 text-emerald-700" />
            <span>Record Payment</span>
          </button>

          <button
            onClick={() => setIsGenerateOpen(true)}
            disabled={!preview || preview.customers.filter((c) => !c.alreadyBilled && c.totalAmount > 0).length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#1A2E20] hover:bg-[#1A2E20]/90 text-[#FAF8F5] rounded-xl text-xs font-bold transition-all disabled:opacity-50 shadow-xs"
          >
            <FileText className="w-4 h-4 text-[#B58A57]" />
            <span>Generate Invoices</span>
          </button>
        </div>
      </div>

      <StatStrip
        items={[
          { label: "Customers", value: preview?.totalEligibleCustomers || 0, note: "with a subscription" },
          { label: "Meals delivered", value: preview?.totalBillableDeliveredMeals || 0, note: "billable" },
          { label: "To bill", value: `₹${formatNumberIN(preview?.totalProjectedAmount || 0)}`, note: "this period" },
          {
            label: "Invoiced",
            value: `${preview?.alreadyBilledInvoicesCount || 0} / ${preview?.totalEligibleCustomers || 0}`,
            note: `${(preview?.totalEligibleCustomers || 0) - (preview?.alreadyBilledInvoicesCount || 0)} not yet`,
          },
        ]}
      />

      {/* Customer Deliveries Table Card */}
      <div className="rn-card">
        {/* Table Filters Bar */}
        <div className="p-3.5 border-b border-[#8E9F89]/20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search customer, phone, invoice..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden focus:ring-1 focus:ring-[#1A2E20]"
              />
            </div>

            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl text-xs text-[#1A2E20] focus:outline-hidden"
            >
              <option value="ALL">All Customers ({preview?.customers.length || 0})</option>
              <option value="UNBILLED">Ready to Bill ({preview?.customers.filter((c) => !c.alreadyBilled && c.totalAmount > 0).length || 0})</option>
              <option value="INVOICED">Already Invoiced ({preview?.customers.filter((c) => c.alreadyBilled).length || 0})</option>
              <option value="ZERO_MEALS">Zero Deliveries ({preview?.customers.filter((c) => !c.alreadyBilled && c.totalAmount === 0).length || 0})</option>
            </select>
          </div>

          <div className="text-xs text-gray-500 text-right">
            Showing <span className="font-semibold text-[#1A2E20]">{filteredCustomers.length}</span> profiles
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-[#FAF8F5] border-b border-[#8E9F89]/20 text-[11px] font-bold text-[#1A2E20] uppercase tracking-wider">
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-3">Active Subscription</th>
                <th className="py-3 px-3 text-center">Verified Deliveries</th>
                <th className="py-3 px-3 text-right">Amount (₹)</th>
                <th className="py-3 px-3 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#8E9F89]/15">
              {filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-500">
                    {loading ? "Loading preview calculations..." : "No customers found matching current filters."}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((cust) => {
                  return (
                    <tr key={cust.subscriptionId} className="hover:bg-[#FAF8F5]/60 transition-colors">
                      {/* Customer */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[#1A2E20] flex items-center gap-1.5">
                          <span>{cust.customerName}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase ${
                              cust.customerType === "CORPORATE"
                                ? "bg-purple-100 text-purple-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {cust.customerType}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                          {cust.phone}
                        </div>
                      </td>

                      {/* Active Subscription */}
                      <td className="py-3 px-3">
                        <div className="font-medium text-[#1A2E20]">{cust.productName}</div>
                        <div className="text-[10px] text-gray-500">
                          ₹{formatNumberIN(cust.unitPrice)}{cust.billingUnit === "PER_MEAL" ? "/meal" : "/mo"} • {cust.mealTypes}
                        </div>
                      </td>

                      {/* Verified Deliveries */}
                      <td className="py-3 px-3 text-center">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200">
                          <Utensils className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="font-bold text-xs">{cust.deliveredCount}</span>
                          <span className="text-[10px] text-emerald-600">delivered</span>
                        </div>
                        {cust.excludedCount > 0 && (
                          <div className="text-[9px] text-gray-400 mt-0.5">
                            {cust.excludedCount} outside period
                          </div>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="py-3 px-3 text-right">
                        <div className="font-bold text-[#1A2E20] font-serif text-sm">
                          ₹{formatNumberIN(cust.totalAmount)}
                        </div>
                        {cust.warnings.length > 0 && (
                          <div className="text-[10px] text-amber-700 mt-0.5" title={cust.warnings.join("; ")}>
                            {cust.warnings[0]}
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 text-center">
                        {cust.alreadyBilled ? (
                          <div>
                            <button
                              onClick={() => cust.existingInvoiceId && handleViewInvoice(cust.existingInvoiceId)}
                              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono bg-green-100 text-green-800 hover:bg-green-200 transition-colors"
                            >
                              <CheckCircle2 className="w-3 h-3 text-green-600" />
                              {cust.existingInvoiceNumber || "INVOICED"}
                            </button>
                            {cust.existingInvoiceStatus && (
                              <div className="text-[9px] text-gray-400 uppercase mt-0.5">
                                {cust.existingInvoiceStatus}
                              </div>
                            )}
                          </div>
                        ) : cust.totalAmount === 0 ? (
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600">
                            Zero Deliveries
                          </span>
                        ) : (
                          <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-800">
                            Ready to Bill
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Financial Dossier / Ledger */}
                          <button
                            onClick={() => {
                              setSelectedCustomerId(cust.customerId);
                              setIsBalanceOpen(true);
                            }}
                            title="View Customer Balance & Invoices"
                            className="p-1.5 text-gray-600 hover:text-[#1A2E20] hover:bg-[#FAF8F5] rounded-lg border border-gray-200 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Record Payment */}
                          <button
                            onClick={() => {
                              setSelectedCustomerId(cust.customerId);
                              setIsPaymentOpen(true);
                            }}
                            title="Record Payment for Customer"
                            className="p-1.5 text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg border border-emerald-200 transition-colors"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                          </button>

                          {/* Print / View Bill if generated */}
                          {cust.existingInvoiceId && (
                            <button
                              onClick={() => handleViewInvoice(cust.existingInvoiceId!)}
                              title="Print / View Invoice"
                              className="p-1.5 text-purple-700 hover:text-purple-900 hover:bg-purple-50 rounded-lg border border-purple-200 transition-colors"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Invoices Modal */}
      <GenerateTiffinInvoicesModal
        isOpen={isGenerateOpen}
        onClose={() => setIsGenerateOpen(false)}
        billingPeriod={selectedPeriod}
        preview={preview}
        onSuccess={(result: GenerateTiffinInvoicesResult) => {
          setNotification({
            message: `Successfully generated ${result.generatedCount} tiffin invoices.`,
            type: "success",
          });
          fetchPreview();
        }}
      />

      {/* Record Payment Modal */}
      <RecordTiffinPaymentModal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        customers={customerOptions}
        initialCustomerId={selectedCustomerId || undefined}
        onSuccess={() => {
          setNotification({
            message: "Payment recorded successfully and posted to finance cashbook.",
            type: "success",
          });
          fetchPreview();
        }}
      />

      {/* Customer Balance Dossier Modal */}
      <TiffinCustomerBalanceModal
        isOpen={isBalanceOpen}
        onClose={() => setIsBalanceOpen(false)}
        customerId={selectedCustomerId}
        onOpenRecordPayment={(cid) => {
          setSelectedCustomerId(cid);
          setIsPaymentOpen(true);
        }}
        onOpenPrintInvoice={(inv) => {
          setSelectedInvoice(inv);
          setIsPrintOpen(true);
        }}
      />

      {/* Printable Invoice Modal */}
      <PrintableInvoiceModal
        isOpen={isPrintOpen}
        onClose={() => setIsPrintOpen(false)}
        invoice={selectedInvoice}
        onIssueInvoice={async () => {
          fetchPreview();
        }}
      />
    </div>
  );
}
