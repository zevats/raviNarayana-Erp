"use client";

import { friendlyError } from "@/lib/friendlyError";
import { useTimedMessage } from "@/lib/useTimedMessage";
import { businessMeal } from "@/lib/businessDate";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect } from "react";
import { X, DollarSign, Plus, Minus, User, Phone, AlertTriangle, CheckCircle2, ShoppingCart, CreditCard, Banknote } from "lucide-react";
import { TiffinProduct, MealType, PaymentMethod } from "@/types";
import { BikeLoader } from "@/components/feedback/BikeLoader";

interface RecordWalkInSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceDate: string;
  defaultMealType?: MealType;
  onSuccess?: () => void;
}

export function RecordWalkInSaleModal({
  isOpen,
  onClose,
  serviceDate,
  defaultMealType,
  onSuccess,
}: RecordWalkInSaleModalProps) {
  const [products, setProducts] = useState<TiffinProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const [mealType, setMealType] = useState<MealType>(() => defaultMealType ?? businessMeal());
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [unitPrice, setUnitPrice] = useState<number>(100);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "UPI">("CASH");
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useTimedMessage<string>();

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccessMsg(null);
      setSubmitting(false);
      setMealType(defaultMealType ?? businessMeal());
      setQuantity(1);
      setBuyerName("");
      setBuyerPhone("");
      setNotes("");

      setLoadingProducts(true);
      fetch("/api/tiffin/products")
        .then((r) => r.ok ? r.json() : { products: [] })
        .then((data) => {
          const prods: TiffinProduct[] = (data.products || []).filter((p: TiffinProduct) => p.status === "ACTIVE");
          setProducts(prods);
          if (prods.length > 0) {
            setSelectedProductId(prods[0].id);
            setUnitPrice(Number(prods[0].price) || 100);
          } else {
            setUnitPrice(100);
          }
        })
        .catch(() => {
          setUnitPrice(100);
        })
        .finally(() => {
          setLoadingProducts(false);
        });
    }
  }, [isOpen, defaultMealType]);

  const handleProductChange = (productId: string) => {
    setSelectedProductId(productId);
    const prod = products.find((p) => p.id === productId);
    if (prod) {
      setUnitPrice(Number(prod.price) || 100);
    }
  };

  const selectedProduct = products.find((p) => p.id === selectedProductId);
  const totalAmount = quantity * unitPrice;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (quantity <= 0) {
      setError("Quantity must be at least 1.");
      return;
    }
    if (unitPrice < 0) {
      setError("Unit price cannot be negative.");
      return;
    }

    setSubmitting(true);
    try {
      const prodName = selectedProduct ? selectedProduct.name : "Walk-in Counter Meal";
      const res = await fetch("/api/kitchen/walkin-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceDate,
          mealType,
          productId: selectedProductId || undefined,
          productName: prodName,
          quantity,
          unitPrice,
          paymentMethod,
          buyerName: buyerName.trim() || undefined,
          buyerPhone: buyerPhone.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to record walk-in sale.");
      }

      setSuccessMsg("Sale recorded directly to cashbook ledger!");
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1000);
    } catch (err: any) {
      setError(friendlyError(err.message || "Failed to submit sale."));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn rn-modal-scrim">
      <div className="rn-modal w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#D5CEBF] overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#1A2E20] text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-white/10 rounded-lg">
              <ShoppingCart className="w-5 h-5 text-[#B58A57]" />
            </span>
            <div>
              <h3 className="font-serif font-bold text-lg leading-tight">Record Walk-in Sale</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
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

          {/* Meal Type */}
          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Service / Meal
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(["LUNCH", "DINNER"] as MealType[]).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMealType(m)}
                  className={`py-2 text-xs font-bold rounded-xl border transition-all ${
                    mealType === m
                      ? "border-[#1A2E20] bg-[#1A2E20] text-white"
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Product & Price */}
          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Select Item / Thali
            </label>
            <AppSelect
              value={selectedProductId}
              onChange={(e) => handleProductChange(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-gray-200 bg-white font-medium focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ₹{p.price}
                </option>
              ))}
              <option value="">Custom Meal / Walk-in Plate</option>
            </AppSelect>
          </div>

          {/* Quantity & Unit Price */}
          <div className="grid grid-cols-2 gap-3 bg-[#FAF8F5] p-3 rounded-xl border border-[#D5CEBF]/60">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">
                Portions / Qty
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="p-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-14 py-1 text-center font-bold text-sm rounded-lg border border-gray-300 bg-white focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setQuantity((q) => q + 1)}
                  className="p-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">
                Rate / Plate (₹)
              </label>
              <input
                type="number"
                min="0"
                value={unitPrice}
                onChange={(e) => setUnitPrice(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full px-3 py-1.5 font-bold text-sm rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20"
              />
            </div>

            <div className="col-span-2 pt-2 border-t border-[#D5CEBF]/40 flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-600">Total Collected:</span>
              <span className="text-lg font-bold text-[#1A2E20]">₹{totalAmount.toLocaleString("en-IN")}</span>
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <label className="block text-xs font-bold text-[#1A2E20] uppercase tracking-wider mb-1">
              Payment Method *
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("CASH")}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition-all ${
                  paymentMethod === "CASH"
                    ? "border-[#1A2E20] bg-[#1A2E20]/5 text-[#1A2E20] ring-1 ring-[#1A2E20]"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <Banknote className="w-4 h-4 text-emerald-600" />
                <span>Cash Collection</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("UPI")}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-xl border text-xs font-bold transition-all ${
                  paymentMethod === "UPI"
                    ? "border-[#1A2E20] bg-[#1A2E20]/5 text-[#1A2E20] ring-1 ring-[#1A2E20]"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <CreditCard className="w-4 h-4 text-blue-600" />
                <span>UPI / QR Scan</span>
              </button>
            </div>
          </div>

          {/* Optional Buyer Details */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">
                Buyer Name (Optional)
              </label>
              <input
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder="Walk-in guest"
                className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-600 mb-1">
                Phone (Optional)
              </label>
              <input
                type="tel"
                value={buyerPhone}
                onChange={(e) => setBuyerPhone(e.target.value)}
                placeholder="9876543210"
                className="w-full px-3 py-1.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#1A2E20]/20"
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-gray-100">
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2.5 text-xs font-bold text-white bg-[#1A2E20] hover:bg-[#263B2D] rounded-xl transition-all shadow-sm flex items-center gap-2"
            >
              {submitting ? (
                <>
                  Working…
                  <span>Recording...</span>
                </>
              ) : (
                <>
                  <ShoppingCart className="w-4 h-4 text-[#B58A57]" />
                  <span>Confirm Sale (₹{totalAmount})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
