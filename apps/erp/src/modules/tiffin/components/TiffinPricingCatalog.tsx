"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useMemo } from "react";
import {
  Search,
  Plus,
  Tag,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Edit,
  Power,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
  UtensilsCrossed,
  Sparkles,
  Layers,
  Coffee,
  Package,
} from "lucide-react";
import { TiffinProduct, ProductCategory, ProductStatus, BillingUnit } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { formatINR } from "@/modules/finance/utils/formatUtils";
import { ProductModal } from "./modals/ProductModal";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { useHasPermission } from "@/components/auth/CurrentUserContext";

const ITEMS_PER_PAGE = 12;

export function TiffinPricingCatalog() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [currentPage, setCurrentPage] = useState(1);

  // Modal states
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<TiffinProduct | null>(null);

  // Status toggle confirmation
  const [statusTarget, setStatusTarget] = useState<TiffinProduct | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const canManageMenu = useHasPermission("tiffin.manage");
  const [deleteTarget, setDeleteTarget] = useState<TiffinProduct | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Feedback notifications
  const [feedback, setFeedback] = useTimedMessage<{ type: "success" | "error"; message: string }>();

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // Data fetching with SWR caching
  const cacheKey = "/api/tiffin/products";
  const {
    data: productsData,
    error: productsError,
    isLoading,
    isRevalidating,
    refetch,
  } = useErpQuery<{ products: TiffinProduct[] }>(
    cacheKey,
    async () => {
      const res = await fetch("/api/tiffin/products", { cache: "no-store" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || "Failed to load tiffin products");
      }
      return res.json();
    },
    { ttl: 15000, tags: ["tiffin_products", "products"] }
  );

  const products = productsData?.products || [];

  // Filtered products
  const filteredProducts = useMemo(() => {
    return products.filter((prod) => {
      // Category filter
      if (categoryFilter !== "ALL" && prod.category !== categoryFilter) {
        return false;
      }
      // Status filter
      if (statusFilter !== "ALL" && prod.status !== statusFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesCode = prod.code.toLowerCase().includes(q);
        const matchesName = prod.name.toLowerCase().includes(q);
        const matchesDesc = prod.description ? prod.description.toLowerCase().includes(q) : false;
        if (!matchesCode && !matchesName && !matchesDesc) {
          return false;
        }
      }
      return true;
    });
  }, [products, categoryFilter, statusFilter, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE) || 1;
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProducts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredProducts, currentPage]);

  // Reset page if filtered results change
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  // Handlers
  const handleOpenAdd = () => {
    setEditingProduct(null);
    setIsProductModalOpen(true);
  };

  const handleOpenEdit = (product: TiffinProduct) => {
    setEditingProduct(product);
    setIsProductModalOpen(true);
  };

  const handleModalSuccess = (savedProduct: TiffinProduct, message: string) => {
    setIsProductModalOpen(false);
    setEditingProduct(null);
    invalidateErpCache(["tiffin_products"]);
    refetch();
    showFeedback("success", message);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/tiffin/products/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the menu item.");
      invalidateErpCache(["tiffin_products"]);
      refetch();
      showFeedback("success", `"${deleteTarget.name}" was deleted from the menu.`);
      setDeleteTarget(null);
    } catch (err: any) {
      showFeedback("error", err.message || "Could not delete the menu item.");
      setDeleteTarget(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleConfirmStatusToggle = async () => {
    if (!statusTarget) return;

    const newStatus: ProductStatus = statusTarget.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    setIsUpdatingStatus(true);

    try {
      const res = await fetch(`/api/tiffin/products/${statusTarget.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to update product status");
      }

      invalidateErpCache(["tiffin_products"]);
      refetch();
      showFeedback(
        "success",
        `Product "${statusTarget.name}" (${statusTarget.code}) is now ${newStatus === "ACTIVE" ? "active" : "inactive"}.`
      );
      setStatusTarget(null);
    } catch (err: any) {
      showFeedback("error", err.message || "Error updating product status");
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Helper renderers
  const renderCategoryBadge = (category: ProductCategory) => {
    switch (category) {
      case "STANDARD_MEAL":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
            <UtensilsCrossed className="w-3 h-3" />
            Standard Meal
          </span>
        );
      case "SUBSCRIPTION_PACKAGE":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
            <Package className="w-3 h-3" />
            Subscription
          </span>
        );
      case "SPECIAL":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
            <Sparkles className="w-3 h-3" />
            Special
          </span>
        );
      case "EXTRA":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
            <Layers className="w-3 h-3" />
            Add-on / Extra
          </span>
        );
      case "BEVERAGE":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-100 text-cyan-800 border border-cyan-200">
            <Coffee className="w-3 h-3" />
            Beverage
          </span>
        );
    }
  };

  const renderBillingUnit = (unit: BillingUnit) => {
    switch (unit) {
      case "PER_MEAL":
        return "per meal";
      case "PER_DAY":
        return "per day";
      case "PER_MONTH":
        return "per month";
      case "PER_PIECE":
        return "per piece";
      case "PER_PORTION":
        return "per portion";
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

      {/* Control bar */}
      <div className="rn-card">
<div className="p-4 sm:p-5 border-b border-[var(--rn-line)] space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search box */}
          <div className="relative flex-1">
            <Search className="pointer-events-none w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by code (e.g. TIF-DAILY), product name, or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-[#FAF8F5] border border-[#8E9F89]/40 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20 focus:border-[#1A2E20]"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                invalidateErpCache(["tiffin_products"]);
                refetch();
              }}
              disabled={isRevalidating}
              className="p-2 border border-[#8E9F89]/40 text-[#1A2E20] rounded-xl hover:bg-[#FAF8F5] transition-colors disabled:opacity-50"
              title="Refresh Catalog"
              aria-label="Refresh catalog"
            >
              <RefreshCw className={`w-4 h-4 ${isRevalidating ? "animate-spin" : ""}`} />
            </button>


            <button
              onClick={handleOpenAdd}
              className="flex items-center gap-2 px-4 py-2 bg-[#1A2E20] text-[#FAF8F5] font-semibold text-sm rounded-xl hover:bg-[#2A4430] transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
          </div>
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#8E9F89]/20 text-xs">
          <span className="font-medium text-gray-500">Filter by:</span>

          {/* Category filter */}
          <AppSelect
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Filter by product category"
            className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/40 rounded-lg text-gray-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20"
          >
            <option value="ALL">All Categories</option>
            <option value="STANDARD_MEAL">Standard Meals</option>
            <option value="SUBSCRIPTION_PACKAGE">Subscription Packages</option>
            <option value="SPECIAL">Special / Diet Meals</option>
            <option value="EXTRA">Extras & Add-ons</option>
            <option value="BEVERAGE">Beverages</option>
          </AppSelect>

          {/* Status filter */}
          <AppSelect
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setCurrentPage(1);
            }}
            aria-label="Filter by product status"
            className="px-2.5 py-1.5 bg-[#FAF8F5] border border-[#8E9F89]/40 rounded-lg text-gray-700 font-medium focus:outline-hidden focus:ring-2 focus:ring-[#1A2E20]/20"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </AppSelect>

          {(categoryFilter !== "ALL" || statusFilter !== "ALL" || searchQuery) && (
            <button
              onClick={() => {
                setCategoryFilter("ALL");
                setStatusFilter("ALL");
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

      {/* Catalog Table */}
      <div>
        {isLoading ? (
          <BikeLoader tone="forest" label="Loading prices…" className="p-12" />
        ) : productsError ? (
          <div className="p-8 text-center text-red-600">
            <AlertCircle className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm font-semibold">Failed to load pricing catalog</p>
            <p className="text-xs mt-1 text-red-500">{productsError.message}</p>
            <button
              onClick={() => refetch()}
              className="mt-3 px-3 py-1.5 bg-red-100 text-red-800 text-xs font-semibold rounded-lg hover:bg-red-200 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Tag className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <h3 className="text-base font-bold text-[#1A2E20]">No pricing catalog items found</h3>
            <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
              {searchQuery || categoryFilter !== "ALL" || statusFilter !== "ALL"
                ? "No products matched your active filters. Try adjusting or clearing search parameters."
                : "No menu items yet. Add your thalis, extras, drinks and monthly plans."}
            </p>
            {!(searchQuery || categoryFilter !== "ALL" || statusFilter !== "ALL") && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <button
                  onClick={handleOpenAdd}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#1A2E20] text-white text-xs font-semibold rounded-xl hover:bg-[#2A4430] transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add First Product
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#FAF8F5] border-b border-[#8E9F89]/20 text-[11px] font-bold uppercase tracking-wider text-gray-600">
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Product Name & Description</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Billing Unit</th>
                  <th className="py-3 px-4 text-right">Price (INR)</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#8E9F89]/15 text-sm">
                {paginatedProducts.map((product) => {
                  const isActive = product.status === "ACTIVE";
                  return (
                    <tr
                      key={product.id}
                      className="hover:bg-[#FAF8F5]/60 transition-colors group cursor-pointer"
                      onClick={() => handleOpenEdit(product)}
                    >
                      {/* Code */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-mono text-xs font-bold px-2.5 py-1 bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-lg text-[#1A2E20]">
                          {product.code}
                        </span>
                      </td>

                      {/* Name & Description */}
                      <td className="py-3.5 px-4 max-w-sm">
                        <div className="font-semibold text-[#1A2E20] group-hover:text-[#B58A57] transition-colors">
                          {product.name}
                        </div>
                        {product.description && (
                          <div className="text-xs text-gray-500 mt-0.5 line-clamp-1" title={product.description}>
                            {product.description}
                          </div>
                        )}
                      </td>

                      {/* Category */}
                      <td className="py-3.5 px-4 whitespace-nowrap">{renderCategoryBadge(product.category)}</td>

                      {/* Billing Unit */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-xs text-gray-600 capitalize">
                        {renderBillingUnit(product.billingUnit)}
                      </td>

                      {/* Price */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="font-bold text-[#1A2E20] font-mono text-sm">
                          {formatINR(product.price)}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            isActive
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              : "bg-gray-100 text-gray-600 border border-gray-200"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-600" : "bg-gray-400"}`} />
                          {isActive ? "Active" : "Inactive"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td
                        className="py-3.5 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleOpenEdit(product)}
                            className="p-1.5 text-gray-500 hover:text-[#1A2E20] hover:bg-gray-100 rounded-lg transition-colors"
                            title="Edit product"
                            aria-label={`Edit ${product.name}`}
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => setStatusTarget(product)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              isActive
                                ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            }`}
                            title={isActive ? "Deactivate Product" : "Reactivate Product"}
                            aria-label={isActive ? `Deactivate ${product.name}` : `Activate ${product.name}`}
                          >
                            <Power className="w-4 h-4" />
                          </button>
                          {canManageMenu && (
                            <button
                              onClick={() => setDeleteTarget(product)}
                              className="p-1.5 text-[#9A3423] hover:bg-red-50 rounded-lg transition-colors"
                              title="Delete menu item"
                              aria-label={`Delete ${product.name}`}
                            >
                              <Trash2 className="w-4 h-4" />
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

        {/* Pagination controls */}
        {filteredProducts.length > ITEMS_PER_PAGE && (
          <div className="p-3 bg-[#FAF8F5] border-t border-[#8E9F89]/20 flex items-center justify-between text-xs text-gray-600">
            <div>
              Showing <span className="font-semibold">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to{" "}
              <span className="font-semibold">
                {Math.min(currentPage * ITEMS_PER_PAGE, filteredProducts.length)}
              </span>{" "}
              of <span className="font-semibold">{filteredProducts.length}</span> items
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
      {deleteTarget && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/30 sm:p-4">
          <div role="dialog" aria-modal="true" aria-label={`Delete ${deleteTarget.name}`} className="rn-dialog bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-3">
            <p className="text-lg font-bold text-[#1A2E20]">Delete &ldquo;{deleteTarget.name}&rdquo;?</p>
            <p className="text-sm text-[#3E4E42]">
              It is removed from the menu for good. Items already used in orders or subscriptions can&apos;t be deleted: deactivate them instead so past records keep their item.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="rn-btn" onClick={() => setDeleteTarget(null)} disabled={isDeleting}>Cancel</button>
              <button type="button" className="rn-btn rn-btn-primary" onClick={handleConfirmDelete} disabled={isDeleting}>{isDeleting ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
      {statusTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-product-status-title"
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
                <h3 id="confirm-product-status-title" className="text-base font-bold text-[#1A2E20]">
                  {statusTarget.status === "ACTIVE" ? "Deactivate Product" : "Reactivate Product"}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {statusTarget.name} ({statusTarget.code})
                </p>
              </div>
            </div>

            <p className="text-sm text-gray-600">
              {statusTarget.status === "ACTIVE" ? (
                <>
                  Are you sure you want to deactivate <strong>{statusTarget.name}</strong>? It will no longer be
                  selectable for new subscriptions or daily orders, but historical transaction snapshots will be
                  preserved.
                </>
              ) : (
                <>
                  Are you sure you want to reactivate <strong>{statusTarget.name}</strong>? It will immediately
                  become available for new customer orders and subscriptions.
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

      {/* Product Create/Edit Modal */}
      <ProductModal
        isOpen={isProductModalOpen}
        onClose={() => {
          setIsProductModalOpen(false);
          setEditingProduct(null);
        }}
        product={editingProduct}
        onSuccess={handleModalSuccess}
      />
    </div>
  );
}
