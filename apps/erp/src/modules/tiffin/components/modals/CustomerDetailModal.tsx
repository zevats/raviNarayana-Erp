"use client";

import React from "react";
import { X, User, Phone, MapPin, Compass, FileText, CheckCircle2, XCircle, Edit, Calendar } from "lucide-react";
import { TiffinCustomer } from "@/types";

interface CustomerDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: TiffinCustomer | null;
  onEdit?: (customer: TiffinCustomer) => void;
  onToggleStatus?: (customer: TiffinCustomer) => void;
}

export function CustomerDetailModal({
  isOpen,
  onClose,
  customer,
  onEdit,
  onToggleStatus,
}: CustomerDetailModalProps) {
  if (!isOpen || !customer) return null;

  const isActive = customer.status === "ACTIVE";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-lg w-full my-6 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#1A2E20]/10 flex items-center justify-center text-[#1A2E20] shrink-0">
              <User className="w-5 h-5 text-[#B58A57]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="customer-detail-title" className="text-base font-bold text-[#1A2E20] truncate">
                  {customer.fullName}
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    isActive ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-700"
                  }`}
                >
                  {customer.status}
                </span>
              </div>
              <p className="text-[11px] text-[#5A6C5E] mt-0.5 font-mono">
                ID: {customer.id}
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

        {/* Details Sheet */}
        <div className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto max-h-[75vh]">
          {/* Customer Metadata Card */}
          <div className="p-3 bg-white border border-[#8E9F89]/25 rounded-xl space-y-2">
            <div className="flex justify-between items-center text-[11px] border-b border-[#8E9F89]/15 pb-2">
              <span className="text-[#5A6C5E]">Customer Type:</span>
              <span className="font-semibold text-[#1A2E20] px-2 py-0.5 bg-[#FAF8F5] rounded border border-[#8E9F89]/20">
                {customer.customerType}
              </span>
            </div>
            <div className="flex justify-between items-center text-[11px] border-b border-[#8E9F89]/15 pb-2">
              <span className="text-[#5A6C5E]">Dietary Preference:</span>
              <span className="font-semibold text-emerald-800 px-2 py-0.5 bg-emerald-50 rounded border border-emerald-200">
                {customer.dietaryPreference}
              </span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[#5A6C5E]">Customer Since:</span>
              <span className="font-mono text-[#1A2E20]">
                {customer.createdAt.slice(0, 10)}
              </span>
            </div>
          </div>

          {/* Contact Information */}
          <div className="p-3 bg-white border border-[#8E9F89]/25 rounded-xl space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89]">
              Contact Details
            </div>
            <div className="flex items-center gap-2 text-xs text-[#1A2E20]">
              <Phone className="w-3.5 h-3.5 text-[#B58A57] shrink-0" />
              <span className="font-semibold">{customer.phone}</span>
              <span className="text-[10px] text-[#5A6C5E]">(Primary)</span>
            </div>
            {customer.alternatePhone && (
              <div className="flex items-center gap-2 text-xs text-[#5A6C5E]">
                <Phone className="w-3.5 h-3.5 text-[#8E9F89] shrink-0" />
                <span>{customer.alternatePhone}</span>
                <span className="text-[10px] text-[#8E9F89]">(Alternate)</span>
              </div>
            )}
          </div>

          {/* Delivery Location */}
          <div className="p-3 bg-white border border-[#8E9F89]/25 rounded-xl space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89]">
              Delivery &amp; Service Address
            </div>
            <div className="flex items-start gap-2 text-xs text-[#1A2E20]">
              <MapPin className="w-3.5 h-3.5 text-[#B58A57] shrink-0 mt-0.5" />
              <span className="leading-relaxed">{customer.deliveryAddress}</span>
            </div>
            {customer.landmark && (
              <div className="flex items-start gap-2 text-xs text-[#5A6C5E] pt-1 border-t border-[#8E9F89]/15">
                <Compass className="w-3.5 h-3.5 text-[#8E9F89] shrink-0 mt-0.5" />
                <span><strong>Landmark:</strong> {customer.landmark}</span>
              </div>
            )}
            {customer.deliveryInstructions && (
              <div className="p-2.5 bg-[#FAF8F5] rounded-lg border border-[#8E9F89]/20 text-[11px] text-[#5A6C5E]">
                <strong>Delivery Instructions:</strong> {customer.deliveryInstructions}
              </div>
            )}
          </div>

          {/* Internal Notes */}
          {customer.notes && (
            <div className="p-3 bg-white border border-[#8E9F89]/25 rounded-xl space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89]">
                Internal Notes
              </div>
              <p className="text-xs text-[#5A6C5E] leading-relaxed">
                {customer.notes}
              </p>
            </div>
          )}

          {/* Audit trail */}
          <div className="text-[11px] text-[#8E9F89] space-y-0.5 pt-1">
            {customer.createdByName && <div>Created by: {customer.createdByName}</div>}
            {customer.updatedByName && <div>Last updated by: {customer.updatedByName}</div>}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between p-4 bg-white border-t border-[#8E9F89]/20">
          {onToggleStatus ? (
            <button
              onClick={() => {
                onClose();
                onToggleStatus(customer);
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                isActive
                  ? "border border-red-200 text-red-700 hover:bg-red-50"
                  : "border border-green-200 text-green-700 hover:bg-green-50"
              }`}
            >
              {isActive ? "Deactivate Customer" : "Reactivate Customer"}
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            {onEdit && (
              <button
                onClick={() => {
                  onClose();
                  onEdit(customer);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1A2E20] text-white rounded-xl text-xs font-semibold hover:bg-[#263B2D] transition-colors"
              >
                <Edit className="w-3.5 h-3.5 text-[#B58A57]" />
                Edit Profile
              </button>
            )}
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 border border-[#8E9F89]/30 text-[#5A6C5E] hover:bg-[#FAF8F5] rounded-xl text-xs font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
