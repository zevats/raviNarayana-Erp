"use client";

import React, { useState, useEffect } from "react";
import { X, User, AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { TiffinCustomer, CustomerType, DietaryPreference } from "@/types";

interface CustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer?: TiffinCustomer | null; // If passed, editing; if null/undefined, creating
  onSuccess: (savedCustomer: TiffinCustomer, message: string) => void;
}

export function CustomerModal({
  isOpen,
  onClose,
  customer,
  onSuccess,
}: CustomerModalProps) {
  const isEditing = Boolean(customer);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [alternatePhone, setAlternatePhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  const [customerType, setCustomerType] = useState<CustomerType>("INDIVIDUAL");
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>("VEG");
  const [notes, setNotes] = useState("");

  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setDuplicateWarning(null);
      setConfirmDuplicate(false);
      setSubmitting(false);

      if (customer) {
        setFullName(customer.fullName);
        setPhone(customer.phone);
        setAlternatePhone(customer.alternatePhone || "");
        setDeliveryAddress(customer.deliveryAddress);
        setLandmark(customer.landmark || "");
        setDeliveryInstructions(customer.deliveryInstructions || "");
        setCustomerType(customer.customerType);
        setDietaryPreference(customer.dietaryPreference);
        setNotes(customer.notes || "");
      } else {
        setFullName("");
        setPhone("");
        setAlternatePhone("");
        setDeliveryAddress("");
        setLandmark("");
        setDeliveryInstructions("");
        setCustomerType("INDIVIDUAL");
        setDietaryPreference("VEG");
        setNotes("");
      }
    }
  }, [isOpen, customer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName.trim() || fullName.trim().length < 2) {
      setError("Customer full name must be at least 2 characters long.");
      return;
    }

    if (!phone.trim()) {
      setError("Primary phone number is required.");
      return;
    }

    if (!deliveryAddress.trim() || deliveryAddress.trim().length < 5) {
      setError("Delivery address must be at least 5 characters long.");
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = isEditing ? `/api/tiffin/customers/${customer!.id}` : "/api/tiffin/customers";
      const method = isEditing ? "PATCH" : "POST";

      const payload: any = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        alternatePhone: alternatePhone.trim() || undefined,
        deliveryAddress: deliveryAddress.trim(),
        landmark: landmark.trim() || undefined,
        deliveryInstructions: deliveryInstructions.trim() || undefined,
        customerType,
        dietaryPreference,
        notes: notes.trim() || undefined,
      };

      if (!isEditing && confirmDuplicate) {
        payload.confirmDuplicate = true;
      }

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.isDuplicate) {
          setDuplicateWarning(data.error.replace("POTENTIAL_DUPLICATE: ", ""));
          setSubmitting(false);
          return;
        }
        throw new Error(data.error || "Failed to save customer.");
      }

      onSuccess(
        data.customer,
        isEditing
          ? `Customer '${data.customer.fullName}' successfully updated.`
          : `Customer '${data.customer.fullName}' successfully created.`
      );
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to save customer.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-xl w-full my-6 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#1A2E20]/10 flex items-center justify-center text-[#1A2E20]">
              <User className="w-5 h-5 text-[#B58A57]" />
            </div>
            <div>
              <h2 id="customer-modal-title" className="text-base sm:text-lg font-bold text-[#1A2E20]">
                {isEditing ? "Edit Tiffin Customer" : "Add Tiffin Customer"}
              </h2>
              <p className="text-xs text-[#5A6C5E]">
                {isEditing
                  ? "Update customer contact, delivery instructions, and preferences."
                  : "Register a new commercial or residential meal client."}
              </p>
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

          {/* Duplicate Phone Alert */}
          {duplicateWarning && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <div className="text-xs">
                  <strong>Potential Duplicate Phone:</strong> {duplicateWarning}
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer pt-1 border-t border-amber-200 text-xs font-semibold text-amber-950">
                <input
                  type="checkbox"
                  checked={confirmDuplicate}
                  onChange={(e) => setConfirmDuplicate(e.target.checked)}
                  className="rounded border-amber-400 text-[#1A2E20] focus:ring-[#1A2E20]"
                />
                <span>I confirm this is a shared phone household / office contact</span>
              </label>
            </div>
          )}

          {/* Full Name & Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="cust-name" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                id="cust-name"
                type="text"
                placeholder="e.g. Ramesh Kumar"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              />
            </div>
            <div>
              <label htmlFor="cust-phone" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Primary Phone <span className="text-red-500">*</span>
              </label>
              <input
                id="cust-phone"
                type="tel"
                placeholder="10-digit mobile (e.g. 9812345678)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              />
            </div>
          </div>

          {/* Alternate Phone & Customer Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="cust-alt-phone" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Alternate Phone (Optional)
              </label>
              <input
                id="cust-alt-phone"
                type="tel"
                placeholder="Optional secondary phone"
                value={alternatePhone}
                onChange={(e) => setAlternatePhone(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              />
            </div>
            <div>
              <label htmlFor="cust-type" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Customer Type
              </label>
              <select
                id="cust-type"
                value={customerType}
                onChange={(e) => setCustomerType(e.target.value as CustomerType)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              >
                <option value="INDIVIDUAL">Individual Client</option>
                <option value="CORPORATE">Corporate / Factory Group</option>
                <option value="RESIDENTIAL_PG">Residential PG Tenant</option>
              </select>
            </div>
          </div>

          {/* Dietary Preference */}
          <div>
            <label className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Dietary Preference
            </label>
            <div className="flex gap-2">
              {(["VEG", "NON_VEG", "JAIN"] as DietaryPreference[]).map((pref) => (
                <button
                  key={pref}
                  type="button"
                  onClick={() => setDietaryPreference(pref)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
                    dietaryPreference === pref
                      ? "border-[#1A2E20] bg-[#1A2E20] text-white shadow-2xs"
                      : "border-[#8E9F89]/30 bg-white text-[#5A6C5E] hover:bg-[#FAF8F5]"
                  }`}
                >
                  {pref === "VEG" ? "Pure Vegetarian" : pref === "NON_VEG" ? "Non-Vegetarian" : "Jain Preparation"}
                </button>
              ))}
            </div>
          </div>

          {/* Delivery Address */}
          <div>
            <label htmlFor="cust-address" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Delivery / Service Address <span className="text-red-500">*</span>
            </label>
            <textarea
              id="cust-address"
              placeholder="Full street address, house/flat/plant unit..."
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              rows={2}
              required
              className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
            />
          </div>

          {/* Landmark & Instructions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="cust-landmark" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Landmark
              </label>
              <input
                id="cust-landmark"
                type="text"
                placeholder="e.g. Near Shiv Mandir / Gate 3"
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              />
            </div>
            <div>
              <label htmlFor="cust-instructions" className="block text-xs font-semibold text-[#1A2E20] mb-1">
                Delivery Instructions
              </label>
              <input
                id="cust-instructions"
                type="text"
                placeholder="e.g. Leave with security guard"
                value={deliveryInstructions}
                onChange={(e) => setDeliveryInstructions(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#8E9F89]/40 rounded-xl text-xs text-[#1A2E20]"
              />
            </div>
          </div>

          {/* Internal Notes */}
          <div>
            <label htmlFor="cust-notes" className="block text-xs font-semibold text-[#1A2E20] mb-1">
              Internal Notes (Optional)
            </label>
            <input
              id="cust-notes"
              type="text"
              placeholder="e.g. Monthly corporate invoice required"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
              disabled={submitting || (Boolean(duplicateWarning) && !confirmDuplicate)}
              className="px-5 py-2 bg-[#1A2E20] hover:bg-[#263B2D] text-white rounded-xl text-xs font-semibold shadow-2xs disabled:opacity-50"
            >
              {submitting
                ? "Saving..."
                : isEditing
                ? "Save Changes"
                : "Create Customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
