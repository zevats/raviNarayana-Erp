"use client";

import { friendlyError } from "@/lib/friendlyError";
import { useTimedMessage } from "@/lib/useTimedMessage";
import { businessMeal } from "@/lib/businessDate";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect } from "react";
import { X, ShoppingBag, Plus, User, Phone, MapPin, Calendar, Clock, DollarSign, AlertTriangle, CheckCircle2 } from "lucide-react";
import { TiffinCustomer, TiffinProduct, MealType } from "@/types";
import { businessToday } from "@/lib/businessDate";
import { BikeLoader } from "@/components/feedback/BikeLoader";

interface CreateTiffinOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CreateTiffinOrderModal({
  isOpen,
  onClose,
  onSuccess,
}: CreateTiffinOrderModalProps) {
  const [customers, setCustomers] = useState<TiffinCustomer[]>([]);
  const [products, setProducts] = useState<TiffinProduct[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Form states
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("NEW");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [serviceDate, setServiceDate] = useState(() => businessToday());
  const [mealType, setMealType] = useState<MealType>(() => businessMeal());
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [customPrice, setCustomPrice] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useTimedMessage<string>();

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMsg(null);
      setSubmitting(false);
      setLoadingOptions(true);

      Promise.all([
        fetch("/api/tiffin/customers").then((r) => r.ok ? r.json() : { customers: [] }),
        fetch("/api/tiffin/products").then((r) => r.ok ? r.json() : { products: [] }),
      ])
        .then(([custData, prodData]) => {
          const loadedCusts: TiffinCustomer[] = custData.customers || [];
          const loadedProds: TiffinProduct[] = prodData.products || [];
          setCustomers(loadedCusts);
          setProducts(loadedProds.filter((p) => p.status === "ACTIVE"));
          if (loadedProds.length > 0) {
            setSelectedProductId(loadedProds[0].id);
          }
        })
        .catch(() => {
          // ignore
        })
        .finally(() => {
          setLoadingOptions(false);
        });
    }
  }, [isOpen]);

  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    if (customerId === "NEW") {
      setCustomerName("");
      setCustomerPhone("");
      setDeliveryAddress("");
    } else {
      const cust = customers.find((c) => c.id === customerId);
      if (cust) {
        setCustomerName(cust.fullName);
        setCustomerPhone(cust.phone);
        setDeliveryAddress(cust.deliveryAddress + (cust.landmark ? ` (${cust.landmark})` : ""));
      }
    }
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const unitPrice = customPrice !== null ? customPrice : (selectedProduct ? Number(selectedProduct.price) : 0);
  const totalPrice = unitPrice * quantity;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customerName.trim() || customerName.trim().length < 2) {
      setError("Customer name must be at least 2 characters.");
      return;
    }
    if (!customerPhone.trim() || customerPhone.trim().length < 7) {
      setError("Valid customer phone number is required.");
      return;
    }
    if (!deliveryAddress.trim() || deliveryAddress.trim().length < 5) {
      setError("Delivery address must be at least 5 characters.");
      return;
    }
    if (quantity <= 0) {
      setError("Quantity must be at least 1.");
      return;
    }

    setSubmitting(true);
    try {
      const productName = selectedProduct ? selectedProduct.name : "Custom Tiffin";
      const combinedNotes = [
        `Order: ${productName} x ${quantity} (Total: ₹${totalPrice}).`,
        notes.trim() || null,
      ].filter(Boolean).join(" ");

      const res = await fetch("/api/delivery/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceDate,
          mealType,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          deliveryAddress: deliveryAddress.trim(),
          notes: combinedNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create delivery order.");
      }

      setSuccessMsg("Order created and added to delivery queue successfully!");
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to submit order."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-[#D5CEBF] overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#1A2E20] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-white/10 rounded-lg">
              <ShoppingBag className="w-5 h-5 text-[#B58A57]" />
            </span>
            <div>
              <h3 className="font-serif font-bold text-lg leading-tight">Create Tiffin Order</h3>
              <p className="text-xs text-white/70">Place order directly into kitchen &amp; delivery run</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Customer Selection */}
          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Customer
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
              <button
                type="button"
                onClick={() => handleCustomerChange("NEW")}
                className={`px-3 py-2 text-xs font-semibold rounded-xl border transition-all text-left flex items-center gap-2 ${
                  selectedCustomerId === "NEW"
                    ? "border-[#1A2E20] bg-[#1A2E20]/5 text-[#1A2E20] ring-1 ring-[#1A2E20]"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Plus className="w-3.5 h-3.5 text-[#B58A57]" />
                <span>New / Walk-in Customer</span>
              </button>

              <AppSelect
                value={selectedCustomerId === "NEW" ? "" : selectedCustomerId}
                onChange={(e) => handleCustomerChange(e.target.value || "NEW")}
                className={`w-full px-3 py-2 text-xs rounded-xl border bg-white focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20 ${
                  selectedCustomerId !== "NEW" ? "border-[#1A2E20] font-semibold text-[#1A2E20]" : "border-gray-200 text-gray-600"
                }`}
              >
                <option value="">Select Existing Customer...</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} ({c.phone})
                  </option>
                ))}
              </AppSelect>
            </div>

            {/* Customer Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Customer Name *
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 absolute left-3 top-3 text-gray-400" />
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Anand Verma"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Phone Number *
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 absolute left-3 top-3 text-gray-400" />
                  <input
                    type="tel"
                    required
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="9876543210"
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20"
                  />
                </div>
              </div>
            </div>

            <div className="mt-2">
              <label className="block text-[11px] font-medium text-gray-600 mb-1">
                Delivery Address *
              </label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  required
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Plot 42, Hiranandani Tech Park, Flat 301"
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-3"></div>

          {/* Service Date & Meal Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
                Service Date *
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 absolute left-3 top-3 text-gray-400" />
                <input
                  type="date"
                  required
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
                Meal Type *
              </label>
              <div className="relative">
                <Clock className="w-3.5 h-3.5 absolute left-3 top-3 text-gray-400" />
                <AppSelect
                  value={mealType}
                  onChange={(e) => setMealType(e.target.value as MealType)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20 font-medium"
                >
                  <option value="LUNCH">LUNCH</option>
                  <option value="DINNER">DINNER</option>
                </AppSelect>
              </div>
            </div>
          </div>

          {/* Menu Item & Quantity */}
          <div className="bg-[#FAF8F5] p-3.5 rounded-xl border border-[#D5CEBF]/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#1A2E20] uppercase tracking-wider">
                Menu Item &amp; Quantity
              </span>
              {selectedProduct && (
                <span className="text-xs font-bold text-[#B58A57]">
                  ₹{Number(selectedProduct.price)} / meal
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Select Product
                </label>
                <AppSelect
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20 font-medium"
                >
                  {products.length === 0 && <option value="">No catalog products available</option>}
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — ₹{p.price} ({p.category})
                    </option>
                  ))}
                </AppSelect>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1">
                  Quantity
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20 font-bold text-center"
                />
              </div>
            </div>

            {/* Total Calculation Display */}
            <div className="flex items-center justify-between pt-2 border-t border-[#D5CEBF]/40">
              <span className="text-xs font-semibold text-gray-600">Calculated Order Total:</span>
              <span className="text-base font-bold text-[#1A2E20]">
                ₹{totalPrice.toLocaleString("en-IN")}
              </span>
            </div>
          </div>

          {/* Delivery Notes */}
          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Order Notes / Delivery Instructions (Optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Call upon arrival, less spicy, deliver to security desk..."
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20"
            />
          </div>

          {/* Action buttons */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 text-xs font-bold text-white bg-[#1A2E20] hover:bg-[#263B2D] rounded-xl transition-all shadow-sm flex items-center gap-2"
            >
              {submitting ? (
                <>
                  <BikeLoader inline tone="light" label="Working" />
                  <span>Adding Order...</span>
                </>
              ) : (
                <>
                  <ShoppingBag className="w-4 h-4 text-[#B58A57]" />
                  <span>Add to Delivery Queue</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
