"use client";

import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useMemo } from "react";
import {
  Search,
  Plus,
  Phone,
  MapPin,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
  User,
  Eye,
  Edit,
  Power,
  ChevronLeft,
  ChevronRight,
  X,
  Building2,
  Home,
  Compass,
} from "lucide-react";
import { TiffinCustomer, CustomerType, CustomerStatus, DietaryPreference } from "@/types";
import { formatINR } from "@/modules/finance/utils/formatUtils";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { CustomerModal } from "./modals/CustomerModal";
import { CustomerDetailModal } from "./modals/CustomerDetailModal";
import { TiffinCustomerBalanceModal } from "./modals/TiffinCustomerBalanceModal";
import { BikeLoader } from "@/components/feedback/BikeLoader";

const ITEMS_PER_PAGE = 10;

const TYPE_LABEL: Record<string, string> = { INDIVIDUAL: "Individual", CORPORATE: "Corporate", RESIDENTIAL_PG: "PG resident" };
const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("") || "?";

export function TiffinCustomerDirectory() {
  // State for search and filters
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [dietFilter, setDietFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  // Modal states
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<TiffinCustomer | null>(null);

  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<TiffinCustomer | null>(null);
  const [accountCustomerId, setAccountCustomerId] = useState<string | null>(null);

  // Status toggle confirmation dialog
  const [statusTarget, setStatusTarget] = useState<TiffinCustomer | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Feedback notifications
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // Data fetching with SWR caching
  const cacheKey = "/api/tiffin/customers";
  const {
    data: customersData,
    error: customersError,
    isLoading,
    isRevalidating,
    refetch,
  } = useErpQuery<{ customers: TiffinCustomer[] }>(
    cacheKey,
    async () => {
      const res = await fetch("/api/tiffin/customers", { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || "Failed to load tiffin customers");
      }
      return res.json();
    },
    { ttl: 15000, tags: ["tiffin_customers", "customers"] }
  );

  const customers = customersData?.customers || [];

  // Filtered customers
  const filteredCustomers = useMemo(() => {
    return customers.filter((cust) => {
      // Type filter
      if (typeFilter !== "ALL" && cust.customerType !== typeFilter) {
        return false;
      }
      // Status filter
      if (statusFilter !== "ALL" && cust.status !== statusFilter) {
        return false;
      }
      // Diet filter
      if (dietFilter !== "ALL" && cust.dietaryPreference !== dietFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = cust.fullName.toLowerCase().includes(q);
        const matchesPhone = cust.phone.includes(q) || (cust.alternatePhone && cust.alternatePhone.includes(q));
        const matchesAddress = cust.deliveryAddress.toLowerCase().includes(q);
        const matchesLandmark = cust.landmark ? cust.landmark.toLowerCase().includes(q) : false;
        const matchesCode = (cust.customerCode || "").toLowerCase().includes(q);
        if (!matchesName && !matchesPhone && !matchesAddress && !matchesLandmark && !matchesCode) {
          return false;
        }
      }
      return true;
    });
  }, [customers, typeFilter, statusFilter, dietFilter, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredCustomers.length / ITEMS_PER_PAGE) || 1;
  const paginatedCustomers = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredCustomers.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredCustomers, currentPage]);

  // Adjust page if filters reduce total pages
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  // Handlers
  const handleOpenAdd = () => {
    setEditingCustomer(null);
    setIsCustomerModalOpen(true);
  };

  const handleOpenEdit = (customer: TiffinCustomer) => {
    setEditingCustomer(customer);
    setIsCustomerModalOpen(true);
  };

  const handleViewDetail = (customer: TiffinCustomer) => {
    setSelectedCustomer(customer);
    setIsDetailModalOpen(true);
  };

  const handleModalSuccess = (savedCustomer: TiffinCustomer, message: string) => {
    setIsCustomerModalOpen(false);
    setEditingCustomer(null);
    invalidateErpCache(["tiffin_customers"]);
    refetch();
    showFeedback("success", message);
  };

  const handleConfirmStatusToggle = async () => {
    if (!statusTarget) return;

    const newStatus: CustomerStatus = statusTarget.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setIsUpdatingStatus(true);

    try {
      const res = await fetch(`/api/tiffin/customers/${statusTarget.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to update customer status");
      }

      invalidateErpCache(["tiffin_customers"]);
      refetch();
      showFeedback(
        "success",
        `Customer ${statusTarget.fullName} is now ${newStatus === "ACTIVE" ? "active" : "inactive"}.`
      );
      setStatusTarget(null);
    } catch (err: any) {
      showFeedback("error", err.message || "Error updating customer status");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Helper renderers for badges
  const renderTypeBadge = (type: CustomerType) => {
    switch (type) {
      case "CORPORATE":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
            <Building2 className="w-3 h-3" />
            Corporate
          </span>
        );
      case "RESIDENTIAL_PG":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <Home className="w-3 h-3" />
            PG Resident
          </span>
        );
      case "INDIVIDUAL":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-200">
            <User className="w-3 h-3" />
            Individual
          </span>
        );
    }
  };

  const renderDietBadge = (diet: DietaryPreference) => {
    switch (diet) {
      case "VEG":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            Veg
          </span>
        );
      case "NON_VEG":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            Non-Veg
          </span>
        );
      case "JAIN":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            Jain
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Feedback banner */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${
            feedback.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            )}
            <p className="text-sm font-medium">{feedback.message}</p>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg transition-colors"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Control bar: search, filters, actions */}
      <div className="rn-card">
<div className="p-4 sm:p-5 border-b border-[var(--rn-line)] space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="pointer-events-none w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by customer name, phone number, delivery address, or landmark..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-[#FAF8F5] border border-[#8E9F89]/40 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20 focus:border-[#1A2E20]"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                invalidateErpCache(["tiffin_customers"]);
                refetch();
              }}
              disabled={isRevalidating}
              className="p-2 border border-[#8E9F89]/40 text-[#1A2E20] rounded-xl hover:bg-[#FAF8F5] transition-colors disabled:opacity-50"
              title="Refresh Customer List"
              aria-label="Refresh customer list"
            >
              <RefreshCw className={`w-4 h-4 ${isRevalidating ? "animate-spin" : ""}`} />
            </button>

            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-2 px-4 py-2 bg-[#1A2E20] text-[#FAF8F5] font-semibold text-sm rounded-xl hover:bg-[#2A4430] transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Add Customer</span>
            </button>
          </div>
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#8E9F89]/20 text-xs">
          <span className="font-medium text-gray-500">Filter by:</span>

          {/* Type filter */}
          <AppSelect
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Filter by customer type"
            className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/40 rounded-lg text-gray-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20"
          >
            <option value="ALL">All Types</option>
            <option value="INDIVIDUAL">Individual</option>
            <option value="CORPORATE">Corporate</option>
            <option value="RESIDENTIAL_PG">PG Resident</option>
          </AppSelect>

          {/* Diet filter */}
          <AppSelect
            value={dietFilter}
            onChange={(e) => {
              setDietFilter(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Filter by dietary preference"
            className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/40 rounded-lg text-gray-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20"
          >
            <option value="ALL">All Diets</option>
            <option value="VEG">Veg</option>
            <option value="NON_VEG">Non-Veg</option>
            <option value="JAIN">Jain</option>
          </AppSelect>

          {/* Status filter */}
          <AppSelect
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Filter by customer status"
            className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/40 rounded-lg text-gray-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </AppSelect>

          {(typeFilter !== "ALL" || statusFilter !== "ALL" || dietFilter !== "ALL" || searchQuery) && (
            <button
              onClick={() => {
                setTypeFilter("ALL");
                setStatusFilter("ALL");
                setDietFilter("ALL");
                setSearchQuery("");
                setCurrentPage(1);
              }}
              className="text-xs text-red-600 hover:text-red-700 underline font-medium ml-auto"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Directory Table */}
      <div>
        {isLoading ? (
          <BikeLoader tone="forest" label="Loading customers…" className="p-12" />
        ) : customersError ? (
          <div className="p-8 text-center text-red-600">
            <AlertCircle className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm font-semibold">Failed to load customers</p>
            <p className="text-xs mt-1 text-red-500">{customersError.message}</p>
            <button
              onClick={() => refetch()}
              className="mt-3 px-3 py-1.5 bg-red-100 text-red-800 text-xs font-semibold rounded-lg hover:bg-red-200 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <User className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <h3 className="text-base font-bold text-[#1A2E20]">No tiffin customers found</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              {searchQuery || typeFilter !== "ALL" || statusFilter !== "ALL" || dietFilter !== "ALL"
                ? "No customers matched your active filter criteria. Try adjusting or resetting your search."
                : "Get started by adding your first commercial tiffin customer with delivery details."}
            </p>
            {!(searchQuery || typeFilter !== "ALL" || statusFilter !== "ALL" || dietFilter !== "ALL") && (
              <button
                onClick={handleOpenAdd}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#1A2E20] text-white text-xs font-semibold rounded-xl hover:bg-[#2A4430] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add First Customer
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left border-collapse">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[17%]" />
                <col className="w-[27%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#8E9F89]/20 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7A8A7C]">
                  <th className="py-3 pl-5 pr-3 font-semibold">Customer</th>
                  <th className="py-3 px-3 font-semibold">Contact</th>
                  <th className="py-3 px-3 font-semibold">Delivery address</th>
                  <th className="py-3 px-3 font-semibold text-right">Due</th>
                  <th className="py-3 pl-3 pr-5 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/12 text-sm">
                {paginatedCustomers.map((customer) => {
                  const isActive = customer.status === "ACTIVE";
                  const due = customer.balance?.due;
                  return (
                    <tr
                      key={customer.id}
                      className="hover:bg-[#FAF8F5] transition-colors cursor-pointer"
                      onClick={() => handleViewDetail(customer)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleViewDetail(customer);
                        }
                      }}
                      aria-label={`Open ${customer.fullName}`}
                    >
                      <td className="py-3.5 pl-5 pr-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-full bg-[#F3EADD] text-[#8A6436] flex items-center justify-center font-semibold text-sm shrink-0">
                            {initialsOf(customer.fullName)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-[#1A2E20] truncate" title={customer.fullName}>
                              {customer.fullName}
                            </div>
                            <div className="text-[12px] text-[#7A8A7C] truncate">
                              {customer.customerCode ? <span className="font-medium text-[#5A6C5E] tabular-nums">{customer.customerCode}</span> : null}
                              {customer.customerCode ? " · " : ""}
                              {TYPE_LABEL[customer.customerType] || customer.customerType}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="text-[13.5px] text-[#1A2E20] tabular-nums truncate">{customer.phone}</div>
                        {customer.alternatePhone && <div className="text-[12px] text-[#7A8A7C] tabular-nums truncate">Alt {customer.alternatePhone}</div>}
                      </td>
                      <td className="py-3.5 px-3">
                        <div className="text-[13.5px] text-[#1A2E20] truncate" title={customer.deliveryAddress}>
                          {customer.deliveryAddress}
                        </div>
                        {customer.landmark && <div className="text-[12px] text-[#7A8A7C] truncate" title={customer.landmark}>Near {customer.landmark}</div>}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        {due === undefined || due === null ? (
                          <span className="text-[#9AA59C]">—</span>
                        ) : due > 0 ? (
                          <>
                            <div className="font-semibold tabular-nums text-[#B4440F]">{formatINR(due)}</div>
                            {(customer.balance?.unpaidOrders ?? 0) > 0 && (
                              <div className="text-[11.5px] text-[#7A8A7C]">
                                {customer.balance!.unpaidOrders} order{customer.balance!.unpaidOrders === 1 ? "" : "s"}
                              </div>
                            )}
                          </>
                        ) : due < 0 ? (
                          <>
                            <div className="font-semibold tabular-nums text-[#2F6B24]">{formatINR(-due)}</div>
                            <div className="text-[11.5px] text-[#7A8A7C]">paid ahead</div>
                          </>
                        ) : (
                          <span className="text-[13px] text-[#7A8A7C]">Settled</span>
                        )}
                      </td>
                      <td className="py-3.5 pl-3 pr-5 text-right">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold whitespace-nowrap ${
                            isActive ? "bg-[#E4F2E0] text-[#2F6B24]" : "bg-[#EEECE8] text-[#6E6A63]"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[#3C8A2E]" : "bg-[#A5A097]"}`} />
                          {isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination controls */}
        {filteredCustomers.length > ITEMS_PER_PAGE && (
          <div className="p-3 bg-[#FAF8F5] border-t border-[#8E9F89]/20 flex items-center justify-between text-xs text-gray-600">
            <div>
              Showing <span className="font-semibold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to{" "}
              <span className="font-semibold">
                {Math.min(currentPage * ITEMS_PER_PAGE, filteredCustomers.length)}
              </span>{" "}
              of <span className="font-semibold">{filteredCustomers.length}</span> customers
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-[#8E9F89]/30 text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 font-medium">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-[#8E9F89]/30 text-gray-700 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
</div>

      {/* Status Toggle Confirmation Modal */}
      {statusTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-status-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1A2E20]/60 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl border border-[#8E9F89]/30 p-5 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  statusTarget.status === "ACTIVE"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                <Power className="w-5 h-5" />
              </div>
              <div>
                <h3 id="confirm-status-title" className="text-base font-bold text-[#1A2E20]">
                  {statusTarget.status === "ACTIVE" ? "Deactivate Customer" : "Reactivate Customer"}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{statusTarget.fullName}</p>
              </div>
            </div>

            <p className="text-sm text-gray-600">
              {statusTarget.status === "ACTIVE" ? (
                <>
                  Are you sure you want to deactivate <strong>{statusTarget.fullName}</strong>? Deactivating will
                  prevent new orders and deliveries, but historical records will be preserved.
                </>
              ) : (
                <>
                  Are you sure you want to reactivate <strong>{statusTarget.fullName}</strong>? They will be
                  eligible for new orders and active deliveries.
                </>
              )}
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#8E9F89]/20">
              <button
                type="button"
                onClick={() => setStatusTarget(null)}
                disabled={isUpdatingStatus}
                className="px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmStatusToggle}
                disabled={isUpdatingStatus}
                className={`px-4 py-2 text-xs font-semibold text-white rounded-xl transition-colors shadow-xs ${
                  statusTarget.status === "ACTIVE"
                    ? "bg-amber-600 hover:bg-amber-700"
                    : "bg-emerald-600 hover:bg-emerald-700"
                }`}
              >
                {isUpdatingStatus ? "Updating..." : statusTarget.status === "ACTIVE" ? "Confirm Deactivation" : "Confirm Activation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Create/Edit Modal */}
      <CustomerModal
        isOpen={isCustomerModalOpen}
        onClose={() => {
          setIsCustomerModalOpen(false);
          setEditingCustomer(null);
        }}
        customer={editingCustomer}
        onSuccess={handleModalSuccess}
      />

      {/* Customer Detail View Modal */}
      <CustomerDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedCustomer(null);
        }}
        customer={selectedCustomer}
        onEdit={(customer) => {
          setIsDetailModalOpen(false);
          handleOpenEdit(customer);
        }}
        onToggleStatus={(customer) => {
          setIsDetailModalOpen(false);
          setStatusTarget(customer);
        }}
        onViewAccount={(customer) => {
          setIsDetailModalOpen(false);
          setAccountCustomerId(customer.id);
        }}
      />

      {/* Invoices, payments and outstanding balance */}
      <TiffinCustomerBalanceModal
        isOpen={accountCustomerId !== null}
        onClose={() => setAccountCustomerId(null)}
        customerId={accountCustomerId}
      />
    </div>
  );
}
