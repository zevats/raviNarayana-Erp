"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Calendar,
  AlertCircle,
  Tag,
  Clock,
  MapPin,
  FileText,
  User,
  Package,
} from "lucide-react";
import {
  TiffinSubscription,
  TiffinCustomer,
  TiffinProduct,
  SubscriptionMealTypes,
  SubscriptionServiceDays,
} from "@/types";
import { formatINR } from "@/modules/finance/utils/formatUtils";
import { businessToday } from "@/lib/businessDate";

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription?: TiffinSubscription | null; // If editing
  customers: TiffinCustomer[];
  products: TiffinProduct[];
  preselectedCustomerId?: string;
  onSuccess: (savedSubscription: TiffinSubscription, message: string) => void;
}

export function SubscriptionModal({
  isOpen,
  onClose,
  subscription,
  customers,
  products,
  preselectedCustomerId,
  onSuccess,
}: SubscriptionModalProps) {
  const isEditing = Boolean(subscription);

  // Form states
  const [customerId, setCustomerId] = useState("");
  const [productId, setProductId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [mealTypes, setMealTypes] = useState<SubscriptionMealTypes>("BOTH");
  const [serviceDays, setServiceDays] = useState<SubscriptionServiceDays>("ALL_DAYS");
  const [quantityPerMeal, setQuantityPerMeal] = useState("1");
  const [customPrice, setCustomPrice] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [notes, setNotes] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Ignores a second activation while a save is being sent (state-based disabling only applies after a render).
  const inFlight = useRef(false);

  // Filter to active customers and products for selection
  const activeCustomers = customers.filter((c) => c.status === "ACTIVE");
  const activeProducts = products.filter((p) => p.status === "ACTIVE");

  const selectedProduct = products.find((p) => p.id === productId);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      inFlight.current = false;
      setSubmitting(false);

      if (subscription) {
        setCustomerId(subscription.customerId);
        setProductId(subscription.productId);
        setStartDate(subscription.startDate);
        setEndDate(subscription.endDate || "");
        setMealTypes(subscription.mealTypes);
        setServiceDays(subscription.serviceDays);
        setQuantityPerMeal(String(subscription.quantityPerMeal || 1));
        setCustomPrice(String(subscription.price));
        setDeliveryAddress(subscription.deliveryAddress);
        setDeliveryInstructions(subscription.deliveryInstructions || "");
        setNotes(subscription.notes || "");
      } else {
        const todayStr = businessToday();
        setCustomerId(preselectedCustomerId || (activeCustomers[0]?.id || ""));
        const defaultProd = activeProducts[0];
        setProductId(defaultProd?.id || "");
        setStartDate(todayStr);
        setEndDate("");
        setMealTypes(defaultProd?.category === "STANDARD_MEAL" ? "BOTH" : "BOTH");
        setServiceDays("ALL_DAYS");
        setQuantityPerMeal("1");
        setCustomPrice(defaultProd ? String(defaultProd.price) : "");

        const cust = customers.find((c) => c.id === (preselectedCustomerId || activeCustomers[0]?.id));
        setDeliveryAddress(cust?.deliveryAddress || "");
        setDeliveryInstructions(cust?.deliveryInstructions || "");
        setNotes("");
      }
    }
  }, [isOpen, subscription, preselectedCustomerId]);

  // When customer changes in create mode, auto-fill delivery address
  const handleCustomerChange = (newCustId: string) => {
    setCustomerId(newCustId);
    if (!isEditing) {
      const cust = customers.find((c) => c.id === newCustId);
      if (cust) {
        setDeliveryAddress(cust.deliveryAddress);
        setDeliveryInstructions(cust.deliveryInstructions || "");
      }
    }
  };

  // When product changes in create mode, auto-fill price
  const handleProductChange = (newProdId: string) => {
    setProductId(newProdId);
    const prod = products.find((p) => p.id === newProdId);
    if (prod && !isEditing) {
      setCustomPrice(String(prod.price));
      if (prod.code === "TIF-MON-SINGLE") {
        setMealTypes("LUNCH");
      } else if (prod.code === "TIF-MON-BOTH" || prod.code === "TIF-DAILY") {
        setMealTypes("BOTH");
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customerId) {
      setError("Please select a customer.");
      return;
    }
    if (!productId) {
      setError("Please select a product or meal package.");
      return;
    }
    if (!startDate) {
      setError("Please specify a service start date.");
      return;
    }
    if (endDate && endDate < startDate) {
      setError("End date cannot be earlier than start date.");
      return;
    }
    if (!deliveryAddress || deliveryAddress.trim().length < 5) {
      setError("Delivery address must be at least 5 characters long.");
      return;
    }

    const qty = parseInt(quantityPerMeal, 10);
    if (isNaN(qty) || qty < 1) {
      setError("Quantity per meal must be at least 1.");
      return;
    }

    const priceNum = customPrice ? parseInt(customPrice, 10) : (selectedProduct?.price || 0);
    if (isNaN(priceNum) || priceNum < 0) {
      setError("Agreed price must be a non-negative whole integer.");
      return;
    }

    if (inFlight.current) return;

    inFlight.current = true;

    setSubmitting(true);

    try {
      const payload: any = {
        customerId,
        productId,
        startDate,
        endDate: endDate ? endDate : null,
        mealTypes,
        serviceDays,
        quantityPerMeal: qty,
        customPrice: priceNum,
        deliveryAddress: deliveryAddress.trim(),
        deliveryInstructions: deliveryInstructions.trim() || null,
        notes: notes.trim() || null,
      };

      const url = isEditing && subscription
        ? `/api/tiffin/subscriptions/${subscription.id}`
        : "/api/tiffin/subscriptions";
      const method = isEditing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || data.message || "Failed to save subscription.");
      }

      onSuccess(
        data.subscription,
        isEditing
          ? `Subscription updated successfully.`
          : `Subscription created successfully for ${data.subscription.customerName || "customer"}.`
      );
    } catch (err: any) {
      setError(err.message || "Error saving subscription.");
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
      aria-labelledby="subscription-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-xl w-full my-6 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1A2E20]/10 flex items-center justify-center text-[#1A2E20]">
              <Package className="w-5 h-5 text-[#B58A57]" />
            </div>
            <div>
              <h2 id="subscription-modal-title" className="text-base sm:text-lg font-bold text-[#1A2E20]">
                {isEditing ? "Edit Tiffin Subscription" : "Create Tiffin Subscription"}
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
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 text-xs sm:text-sm overflow-y-auto flex-1 max-h-[75vh]">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Customer Selection */}
          <div>
            <label htmlFor="sub-customer" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Customer <span className="text-red-500">*</span>
            </label>
            <select
              id="sub-customer"
              value={customerId}
              onChange={(e) => handleCustomerChange(e.target.value)}
              disabled={isEditing}
              required
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] disabled:bg-gray-100 disabled:text-gray-500"
            >
              <option value="">Select customer...</option>
              {(isEditing ? customers : activeCustomers).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName} ({c.phone}) — {c.customerType} [{c.dietaryPreference}]
                </option>
              ))}
            </select>
          </div>

          {/* Product / Package Selection */}
          <div>
            <label htmlFor="sub-product" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Meal Package / Catalog Product <span className="text-red-500">*</span>
            </label>
            <select
              id="sub-product"
              value={productId}
              onChange={(e) => handleProductChange(e.target.value)}
              disabled={isEditing}
              required
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] disabled:bg-gray-100 disabled:text-gray-500"
            >
              <option value="">Select meal package...</option>
              {(isEditing ? products : activeProducts).map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.code}] {p.name} — {formatINR(p.price)} / {p.billingUnit.toLowerCase().replace("per_", "")} ({p.category})
                </option>
              ))}
            </select>
          </div>

          {/* Service Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="sub-start-date" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Service Start Date <span className="text-red-500">*</span>
              </label>
              <input
                id="sub-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isEditing}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] disabled:bg-gray-100"
              />
            </div>

            <div>
              <label htmlFor="sub-end-date" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                End Date (Optional / Open-ended)
              </label>
              <input
                id="sub-end-date"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
                placeholder="Leave blank for ongoing"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">Leave blank for ongoing monthly subscription</p>
            </div>
          </div>

          {/* Schedule Configuration: Meal Types & Service Days */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="sub-meal-types" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Meal Delivery
              </label>
              <select
                id="sub-meal-types"
                value={mealTypes}
                onChange={(e) => setMealTypes(e.target.value as SubscriptionMealTypes)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              >
                <option value="BOTH">Lunch & Dinner (Both)</option>
                <option value="LUNCH">Lunch Only</option>
                <option value="DINNER">Dinner Only</option>
                <option value="BREAKFAST">Breakfast Only</option>
              </select>
            </div>

            <div>
              <label htmlFor="sub-service-days" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Service Days
              </label>
              <select
                id="sub-service-days"
                value={serviceDays}
                onChange={(e) => setServiceDays(e.target.value as SubscriptionServiceDays)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              >
                <option value="ALL_DAYS">All 7 Days</option>
                <option value="MON_SAT">Mon - Sat (6 Days)</option>
                <option value="MON_FRI">Mon - Fri (5 Days)</option>
              </select>
            </div>

            <div>
              <label htmlFor="sub-qty" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Qty / Meal
              </label>
              <input
                id="sub-qty"
                type="number"
                min="1"
                step="1"
                value={quantityPerMeal}
                onChange={(e) => setQuantityPerMeal(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              />
            </div>
          </div>

          {/* Agreed Price Snapshot */}
          <div>
            <label htmlFor="sub-price" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Agreed Subscription Price (INR) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-[#5A6C5E] font-medium">₹</span>
              <input
                id="sub-price"
                type="number"
                min="0"
                step="1"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                required
                className="w-full pl-7 pr-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] font-semibold font-mono"
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              {selectedProduct ? `Catalog baseline: ${formatINR(selectedProduct.price)} (${selectedProduct.billingUnit})` : "Enter agreed price"}
            </p>
          </div>

          {/* Delivery Address & Instructions */}
          <div>
            <label htmlFor="sub-address" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Delivery Address <span className="text-red-500">*</span>
            </label>
            <textarea
              id="sub-address"
              rows={2}
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              required
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              placeholder="Full delivery location for this subscription..."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="sub-instructions" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Delivery Instructions
              </label>
              <input
                id="sub-instructions"
                type="text"
                value={deliveryInstructions}
                onChange={(e) => setDeliveryInstructions(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
                placeholder="Gate code, security desk, etc."
              />
            </div>

            <div>
              <label htmlFor="sub-notes" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Internal Notes
              </label>
              <input
                id="sub-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
                placeholder="Special dietary request, etc."
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#8E9F89]/20">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 border border-[#8E9F89]/40 text-[#5A6C5E] hover:text-[#1A2E20] rounded-xl text-xs font-semibold hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-[#1A2E20] text-[#FAF8F5] rounded-xl text-xs font-semibold hover:bg-[#2A4430] transition-colors shadow-xs disabled:opacity-50"
            >
              {submitting ? "Saving..." : isEditing ? "Save Changes" : "Create Subscription"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
