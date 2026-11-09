"use client";

import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useMemo } from "react";
import {
  Search,
  Plus,
  Calendar,
  Clock,
  User,
  Package,
  MapPin,
  PauseCircle,
  PlayCircle,
  XCircle,
  Edit,
  Eye,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import {
  TiffinSubscription,
  TiffinCustomer,
  TiffinProduct,
  SubscriptionStatus,
  SubscriptionMealTypes,
  SubscriptionServiceDays,
} from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { formatINR } from "@/modules/finance/utils/formatUtils";
import { SubscriptionModal } from "./modals/SubscriptionModal";
import { SubscriptionDetailModal } from "./modals/SubscriptionDetailModal";
import { PauseSubscriptionModal } from "./modals/PauseSubscriptionModal";
import { CancelSubscriptionModal } from "./modals/CancelSubscriptionModal";
import { BikeLoader } from "@/components/feedback/BikeLoader";

const ITEMS_PER_PAGE = 10;

export function TiffinSubscriptionList() {
  // Filters and search state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [mealFilter, setMealFilter] = useState<string>("ALL");
  const [daysFilter, setDaysFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  // Modals state
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<TiffinSubscription | null>(null);

  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedSubscription, setSelectedSubscription] = useState<TiffinSubscription | null>(null);

  const [isPauseModalOpen, setIsPauseModalOpen] = useState(false);
  const [pausingSubscription, setPausingSubscription] = useState<TiffinSubscription | null>(null);

  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancellingSubscription, setCancellingSubscription] = useState<TiffinSubscription | null>(null);

  const [resumingSubscriptionId, setResumingSubscriptionId] = useState<string | null>(null);

  // Feedback notifications
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // 1. Fetch subscriptions
  const {
    data: subscriptionsData,
    error: subscriptionsError,
    isLoading,
    isRevalidating,
    refetch: refetchSubscriptions,
  } = useErpQuery<{ subscriptions: TiffinSubscription[] }>(
    "/api/tiffin/subscriptions",
    async () => {
      const res = await fetch("/api/tiffin/subscriptions", { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || "Failed to load tiffin subscriptions");
      }
      return res.json();
    },
    { ttl: 15000, tags: ["tiffin_subscriptions", "subscriptions"] }
  );

  // 2. Fetch customers (for modal selection)
  const { data: customersData } = useErpQuery<{ customers: TiffinCustomer[] }>(
    "/api/tiffin/customers",
    async () => {
      const res = await fetch("/api/tiffin/customers", { cache: "no-store" });
      if (!res.ok) return { customers: [] };
      return res.json();
    },
    { ttl: 30000, tags: ["tiffin_customers", "customers"] }
  );

  // 3. Fetch products (for modal selection)
  const { data: productsData } = useErpQuery<{ products: TiffinProduct[] }>(
    "/api/tiffin/products",
    async () => {
      const res = await fetch("/api/tiffin/products", { cache: "no-store" });
      if (!res.ok) return { products: [] };
      return res.json();
    },
    { ttl: 30000, tags: ["tiffin_products", "products"] }
  );

  const subscriptions = subscriptionsData?.subscriptions || [];
  const customers = customersData?.customers || [];
  const products = productsData?.products || [];

  // Filtered subscriptions list
  const filteredSubscriptions = useMemo(() => {
    return subscriptions.filter((sub) => {
      if (statusFilter !== "ALL" && sub.status !== statusFilter) return false;
      if (mealFilter !== "ALL" && sub.mealTypes !== mealFilter) return false;
      if (daysFilter !== "ALL" && sub.serviceDays !== daysFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesCustomer = sub.customerName?.toLowerCase().includes(q);
        const matchesPhone = sub.customerPhone?.toLowerCase().includes(q);
        const matchesProduct = sub.productName?.toLowerCase().includes(q);
        const matchesId = sub.id?.toLowerCase().includes(q);
        const matchesAddress = sub.deliveryAddress?.toLowerCase().includes(q);
        if (!matchesCustomer && !matchesPhone && !matchesProduct && !matchesId && !matchesAddress) {
          return false;
        }
      }

      return true;
    });
  }, [subscriptions, statusFilter, mealFilter, daysFilter, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredSubscriptions.length / ITEMS_PER_PAGE) || 1;
  const paginatedSubscriptions = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredSubscriptions.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredSubscriptions, currentPage]);

  const handleResume = async (sub: TiffinSubscription) => {
    setResumingSubscriptionId(sub.id);
    try {
      const res = await fetch(`/api/tiffin/subscriptions/${sub.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || "Failed to resume subscription.");
      }
      invalidateErpCache("tiffin_subscriptions");
      refetchSubscriptions();
      showFeedback("success", `Subscription for ${sub.customerName || "customer"} resumed.`);
    } catch (err: any) {
      showFeedback("error", err.message || "Error resuming subscription.");
    } finally {
      setResumingSubscriptionId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "bg-emerald-50 text-emerald-800 border-emerald-300";
      case "PAUSED":
        return "bg-amber-50 text-amber-800 border-amber-300";
      case "CANCELLED":
        return "bg-rose-50 text-rose-800 border-rose-300";
      case "EXPIRED":
        return "bg-gray-100 text-gray-800 border-gray-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  const getMealTypeLabel = (mealType: string) => {
    switch (mealType) {
      case "BOTH":
        return "Lunch & Dinner";
      case "LUNCH":
        return "Lunch";
      case "DINNER":
        return "Dinner";
      case "BREAKFAST":
        return "Breakfast";
      default:
        return mealType;
    }
  };

  const getServiceDaysLabel = (days: string) => {
    switch (days) {
      case "ALL_DAYS":
        return "7 Days";
      case "MON_SAT":
        return "Mon - Sat (6d)";
      case "MON_FRI":
        return "Mon - Fri (5d)";
      default:
        return days;
    }
  };

  return (
    <div className="space-y-4">
      {/* Feedback Alert */}
      {feedback && (
        <div
          role="alert"
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
            feedback.type === "success"
              ? "bg-emerald-50 border-emerald-300 text-emerald-900"
              : "bg-rose-50 border-rose-300 text-rose-900"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-gray-500 hover:text-gray-700 text-xs font-semibold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Action and Filter Controls Bar */}
      <div className="rn-card">
<div className="p-4 sm:p-5 border-b border-[var(--rn-line)] space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="pointer-events-none w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by customer name, phone, item, address or Sub ID..."
              className="w-full pl-10 pr-4 py-2 text-xs bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20 focus:border-[#1A2E20] text-[#1A2E20]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                refetchSubscriptions();
              }}
              disabled={isRevalidating}
              title="Refresh subscriptions"
              className="p-2 border border-[#8E9F89]/30 rounded-xl hover:bg-gray-50 text-gray-600 transition-colors shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRevalidating ? "animate-spin" : ""}`} />
            </button>

            <button
              onClick={() => {
                setEditingSubscription(null);
                setIsSubscriptionModalOpen(true);
              }}
              className="flex items-center justify-center gap-2 bg-[#1A2E20] text-[#FAF8F5] px-4 py-2 rounded-xl text-xs font-bold hover:bg-[#2C4A34] transition-colors shadow-xs shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New Subscription</span>
            </button>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100 text-xs">
          <div className="flex items-center gap-1.5 text-gray-500 font-medium mr-1">
            <Filter className="w-3.5 h-3.5" />
            <span>Filters:</span>
          </div>

          {/* Status filter */}
          <AppSelect
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-lg text-xs text-[#1A2E20] focus:outline-hidden"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="EXPIRED">Expired</option>
          </AppSelect>

          {/* Meal Types filter */}
          <AppSelect
            value={mealFilter}
            onChange={(e) => {
              setMealFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-lg text-xs text-[#1A2E20] focus:outline-hidden"
          >
            <option value="ALL">All Meal Types</option>
            <option value="BOTH">Lunch & Dinner</option>
            <option value="LUNCH">Lunch Only</option>
            <option value="DINNER">Dinner Only</option>
            <option value="BREAKFAST">Breakfast</option>
          </AppSelect>

          {/* Service Days filter */}
          <AppSelect
            value={daysFilter}
            onChange={(e) => {
              setDaysFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-lg text-xs text-[#1A2E20] focus:outline-hidden"
          >
            <option value="ALL">All Service Schedules</option>
            <option value="ALL_DAYS">7 Days (Mon - Sun)</option>
            <option value="MON_SAT">6 Days (Mon - Sat)</option>
            <option value="MON_FRI">5 Days (Mon - Fri)</option>
          </AppSelect>

          {(statusFilter !== "ALL" || mealFilter !== "ALL" || daysFilter !== "ALL" || searchQuery) && (
            <button
              onClick={() => {
                setStatusFilter("ALL");
                setMealFilter("ALL");
                setDaysFilter("ALL");
                setSearchQuery("");
                setCurrentPage(1);
              }}
              className="text-xs text-[#B58A57] hover:underline font-medium ml-auto"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Main Subscriptions Table */}
      <div>
        {isLoading ? (
          <BikeLoader tone="forest" label="Loading subscriptions…" className="p-12" />
        ) : subscriptionsError ? (
          <div className="p-12 text-center text-rose-600 space-y-2">
            <AlertCircle className="w-6 h-6 mx-auto" />
            <p className="text-xs font-semibold">Error loading subscriptions</p>
            <p className="text-[11px] text-gray-500">{subscriptionsError.message}</p>
          </div>
        ) : filteredSubscriptions.length === 0 ? (
          <div className="p-12 text-center text-gray-500 space-y-3">
            <Calendar className="w-10 h-10 mx-auto text-gray-300" />
            <div className="font-semibold text-sm text-[#1A2E20]">No subscriptions found</div>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              {searchQuery || statusFilter !== "ALL" || mealFilter !== "ALL" || daysFilter !== "ALL"
                ? "No subscriptions match your search or filter criteria. Try clearing filters."
                : "Create your first tiffin subscription to link customers with catalog items and service schedules."}
            </p>
            <button
              onClick={() => {
                setEditingSubscription(null);
                setIsSubscriptionModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1A2E20] text-white rounded-xl text-xs font-medium hover:bg-[#2C4A34] transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Subscription</span>
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-[#1A2E20] border-collapse">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#8E9F89]/20 text-[11px] font-bold uppercase tracking-wider text-[#5A6C5E]">
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Plan & Item</th>
                  <th className="py-3 px-4">Schedule</th>
                  <th className="py-3 px-4">Rate & Qty</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/15">
                {paginatedSubscriptions.map((sub) => {
                  const isPaused = sub.status === "PAUSED";
                  const isCancelled = sub.status === "CANCELLED";

                  return (
                    <tr
                      key={sub.id}
                      className="hover:bg-[#FAF8F5]/60 transition-colors group"
                    >
                      {/* Customer Info */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#1A2E20]">
                          {sub.customerName || "Customer"}
                        </div>
                        <div className="text-[11px] text-[#5A6C5E] font-mono mt-0.5">
                          {sub.customerPhone}
                        </div>
                        {sub.deliveryAddress && (
                          <div className="text-[10px] text-gray-500 truncate max-w-[180px] mt-0.5 flex items-center gap-1">
                            <MapPin className="w-2.5 h-2.5 text-gray-400 shrink-0" />
                            <span className="truncate">{sub.deliveryAddress}</span>
                          </div>
                        )}
                      </td>

                      {/* Product Name */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-[#1A2E20]">
                          {sub.productName || "Product"}
                        </div>
                        <div className="text-[11px] text-[#5A6C5E] mt-0.5">
                          {getMealTypeLabel(sub.mealTypes)}
                        </div>
                      </td>

                      {/* Schedule */}
                      <td className="py-3.5 px-4">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#1A2E20]/5 text-[#1A2E20] border border-[#8E9F89]/20">
                          {getServiceDaysLabel(sub.serviceDays)}
                        </span>
                      </td>

                      {/* Rate and Quantity */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-emerald-800">
                          {formatINR(sub.price)}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {sub.quantityPerMeal} {sub.quantityPerMeal === 1 ? "box" : "boxes"} / meal
                        </div>
                      </td>

                      {/* Duration */}
                      <td className="py-3.5 px-4 text-[11px]">
                        <div>
                          <span className="text-gray-500">From: </span>
                          <span className="font-mono text-[#1A2E20]">{sub.startDate}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">To: </span>
                          <span className="font-mono text-[#1A2E20]">{sub.endDate || "Ongoing"}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${getStatusBadge(
                            sub.status
                          )}`}
                        >
                          {sub.status}
                        </span>
                        {isPaused && sub.pauseResumeDate && (
                          <div className="text-[10px] text-amber-700 mt-1 font-mono">
                            Resumes {sub.pauseResumeDate}
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* View button */}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSubscription(sub);
                              setIsDetailModalOpen(true);
                            }}
                            title="View Subscription"
                            className="p-1.5 rounded-lg text-[#5A6C5E] hover:text-[#1A2E20] hover:bg-gray-100 transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Edit button */}
                          {!isCancelled && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSubscription(sub);
                                setIsSubscriptionModalOpen(true);
                              }}
                              title="Edit Subscription"
                              className="p-1.5 rounded-lg text-[#5A6C5E] hover:text-[#1A2E20] hover:bg-gray-100 transition-colors"
                            >
                              <Edit className="w-4 h-4 text-[#B58A57]" />
                            </button>
                          )}

                          {/* Pause / Resume */}
                          {sub.status === "ACTIVE" && (
                            <button
                              type="button"
                              onClick={() => {
                                setPausingSubscription(sub);
                                setIsPauseModalOpen(true);
                              }}
                              title="Pause Subscription"
                              className="p-1.5 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-50 transition-colors"
                            >
                              <PauseCircle className="w-4 h-4" />
                            </button>
                          )}

                          {isPaused && (
                            <button
                              type="button"
                              onClick={() => handleResume(sub)}
                              disabled={resumingSubscriptionId === sub.id}
                              title="Resume Subscription"
                              className="p-1.5 rounded-lg text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 transition-colors disabled:opacity-50"
                            >
                              <PlayCircle
                                className={`w-4 h-4 ${
                                  resumingSubscriptionId === sub.id ? "animate-spin" : ""
                                }`}
                              />
                            </button>
                          )}

                          {/* Cancel */}
                          {!isCancelled && (
                            <button
                              type="button"
                              onClick={() => {
                                setCancellingSubscription(sub);
                                setIsCancelModalOpen(true);
                              }}
                              title="Cancel Subscription"
                              className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                            >
                              <XCircle className="w-4 h-4" />
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
        )}

        {/* Pagination Bar */}
        {filteredSubscriptions.length > ITEMS_PER_PAGE && (
          <div className="p-3 bg-[#FAF8F5] border-t border-[#8E9F89]/20 flex items-center justify-between text-xs text-[#5A6C5E]">
            <div>
              Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredSubscriptions.length)} of{" "}
              {filteredSubscriptions.length} subscriptions
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 rounded border border-[#8E9F89]/30 bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-semibold text-[#1A2E20] px-2">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 rounded border border-[#8E9F89]/30 bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
</div>

      {/* Subscription Modal (Create / Edit) */}
      {isSubscriptionModalOpen && (
        <SubscriptionModal
          isOpen={isSubscriptionModalOpen}
          onClose={() => {
            setIsSubscriptionModalOpen(false);
            setEditingSubscription(null);
          }}
          subscription={editingSubscription}
          customers={customers}
          products={products}
          onSuccess={(savedSub, msg) => {
            setIsSubscriptionModalOpen(false);
            setEditingSubscription(null);
            invalidateErpCache("tiffin_subscriptions");
            refetchSubscriptions();
            showFeedback("success", msg);
          }}
        />
      )}

      {/* Detail Modal */}
      {isDetailModalOpen && (
        <SubscriptionDetailModal
          isOpen={isDetailModalOpen}
          onClose={() => {
            setIsDetailModalOpen(false);
            setSelectedSubscription(null);
          }}
          subscription={selectedSubscription}
          onEdit={(sub) => {
            setIsDetailModalOpen(false);
            setSelectedSubscription(null);
            setEditingSubscription(sub);
            setIsSubscriptionModalOpen(true);
          }}
          onPause={(sub) => {
            setIsDetailModalOpen(false);
            setSelectedSubscription(null);
            setPausingSubscription(sub);
            setIsPauseModalOpen(true);
          }}
          onResume={(sub) => {
            setIsDetailModalOpen(false);
            setSelectedSubscription(null);
            handleResume(sub);
          }}
          onCancel={(sub) => {
            setIsDetailModalOpen(false);
            setSelectedSubscription(null);
            setCancellingSubscription(sub);
            setIsCancelModalOpen(true);
          }}
        />
      )}

      {/* Pause Modal */}
      {isPauseModalOpen && (
        <PauseSubscriptionModal
          isOpen={isPauseModalOpen}
          onClose={() => {
            setIsPauseModalOpen(false);
            setPausingSubscription(null);
          }}
          subscription={pausingSubscription}
          onSuccess={(updatedSub, msg) => {
            setIsPauseModalOpen(false);
            setPausingSubscription(null);
            invalidateErpCache("tiffin_subscriptions");
            refetchSubscriptions();
            showFeedback("success", msg);
          }}
        />
      )}

      {/* Cancel Modal */}
      {isCancelModalOpen && (
        <CancelSubscriptionModal
          isOpen={isCancelModalOpen}
          onClose={() => {
            setIsCancelModalOpen(false);
            setCancellingSubscription(null);
          }}
          subscription={cancellingSubscription}
          onSuccess={(updatedSub, msg) => {
            setIsCancelModalOpen(false);
            setCancellingSubscription(null);
            invalidateErpCache("tiffin_subscriptions");
            refetchSubscriptions();
            showFeedback("success", msg);
          }}
        />
      )}
    </div>
  );
}
