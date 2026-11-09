"use client";

import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect, useRef } from "react";
import { X, UtensilsCrossed, AlertCircle } from "lucide-react";
import { TiffinProduct, ProductCategory, BillingUnit } from "@/types";
import { formatINR } from "@/modules/finance/utils/formatUtils";

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product?: TiffinProduct | null;
  onSuccess: (savedProduct: TiffinProduct, message: string) => void;
}

export function ProductModal({
  isOpen,
  onClose,
  product,
  onSuccess,
}: ProductModalProps) {
  const isEditing = Boolean(product);

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ProductCategory>("STANDARD_MEAL");
  const [billingUnit, setBillingUnit] = useState<BillingUnit>("PER_MEAL");
  const [price, setPrice] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Ignores a second activation while a save is being sent (state-based disabling only applies after a render).
  const inFlight = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      inFlight.current = false;
      setSubmitting(false);

      if (product) {
        setCode(product.code);
        setName(product.name);
        setDescription(product.description || "");
        setCategory(product.category);
        setBillingUnit(product.billingUnit);
        setPrice(String(product.price));
      } else {
        setCode("");
        setName("");
        setDescription("");
        setCategory("STANDARD_MEAL");
        setBillingUnit("PER_MEAL");
        setPrice("");
      }
    }
  }, [isOpen, product]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isEditing && (!code.trim() || !/^[A-Z0-9_\-]{3,20}$/.test(code.trim().toUpperCase()))) {
      setError("Product code must be 3-20 uppercase alphanumeric characters, hyphens, or underscores.");
      return;
    }

    if (!name.trim() || name.trim().length < 2) {
      setError("Product name must be at least 2 characters long.");
      return;
    }

    const numPrice = Number(price);
    if (!Number.isInteger(numPrice) || numPrice < 0) {
      setError("Price must be a non-negative whole integer in INR.");
      return;
    }

    if (inFlight.current) return;

    inFlight.current = true;

    setSubmitting(true);
    try {
      const endpoint = isEditing ? `/api/tiffin/products/${product!.id}` : "/api/tiffin/products";
      const method = isEditing ? "PATCH" : "POST";

      const payload: any = {
        name: name.trim(),
        description: description.trim() || undefined,
        category,
        billingUnit,
        price: numPrice,
      };

      if (!isEditing) {
        payload.code = code.trim().toUpperCase();
      }

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save product.");
      }

      onSuccess(
        data.product,
        isEditing
          ? `Product '${data.product.name}' (${data.product.code}) updated successfully.`
          : `Product '${data.product.name}' (${data.product.code}) added to catalog.`
      );
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save product.");
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
      aria-labelledby="product-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-lg w-full my-6 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#B58A57]/15 flex items-center justify-center text-[#9E7443]">
              <UtensilsCrossed className="w-5 h-5 text-[#B58A57]" />
            </div>
            <div>
              <h2 id="product-modal-title" className="text-base sm:text-lg font-bold text-[#1A2E20]">
                {isEditing ? "Edit Catalog Item" : "Add Meal / Package to Catalog"}
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

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 text-xs sm:text-sm overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Code & Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="prod-code" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Product Code <span className="text-red-500">*</span>
              </label>
              <input
                id="prod-code"
                type="text"
                placeholder="e.g. TIF-DAILY"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                disabled={isEditing}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] font-mono uppercase disabled:bg-gray-100 disabled:text-gray-500"
              />
            </div>
            <div>
              <label htmlFor="prod-name" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Item Name <span className="text-red-500">*</span>
              </label>
              <input
                id="prod-name"
                type="text"
                placeholder="e.g. Daily Standard Tiffin"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              />
            </div>
          </div>

          {/* Category & Billing Unit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="prod-category" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Category
              </label>
              <AppSelect
                id="prod-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as ProductCategory)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              >
                <option value="STANDARD_MEAL">Standard Meal / Thali</option>
                <option value="SUBSCRIPTION_PACKAGE">Subscription Package</option>
                <option value="SPECIAL">Special / Friday Special</option>
                <option value="EXTRA">Extra Portion / Add-on</option>
                <option value="BEVERAGE">Beverage (Lassi, Chaas)</option>
              </AppSelect>
            </div>
            <div>
              <label htmlFor="prod-unit" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Billing Unit
              </label>
              <AppSelect
                id="prod-unit"
                value={billingUnit}
                onChange={(e) => setBillingUnit(e.target.value as BillingUnit)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              >
                <option value="PER_MEAL">Per Meal</option>
                <option value="PER_MONTH">Per Month</option>
                <option value="PER_DAY">Per Day</option>
                <option value="PER_PIECE">Per Piece</option>
                <option value="PER_PORTION">Per Portion / Cup</option>
              </AppSelect>
            </div>
          </div>

          {/* Price (INR) */}
          <div>
            <label htmlFor="prod-price" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Base Price (INR) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-[#5A6C5E] font-medium">₹</span>
              <input
                id="prod-price"
                type="number"
                min="0"
                step="1"
                placeholder="Price in whole INR (e.g. 80)"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
                className="w-full pl-7 pr-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20] font-semibold"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="prod-desc" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Description &amp; Contents
            </label>
            <textarea
              id="prod-desc"
              placeholder="e.g. 4 Tawa Roti, Seasonal Sabzi, Dal Tadka, Rice, Salad"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#8E9F89]/20">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 border border-[#8E9F89]/30 rounded-xl text-xs font-medium text-[#5A6C5E] hover:bg-[#FAF8F5]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-[#1A2E20] hover:bg-[#263B2D] text-white rounded-xl text-xs font-semibold shadow-2xs disabled:opacity-50"
            >
              {submitting
                ? "Saving..."
                : isEditing
                ? "Update Item"
                : "Add to Catalog"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
