"use client";

import React from "react";
import {
  X,
  Calendar,
  Clock,
  User,
  Package,
  MapPin,
  FileText,
  PauseCircle,
  PlayCircle,
  XCircle,
  Edit,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { TiffinSubscription } from "@/types";
import { formatINR } from "@/modules/finance/utils/formatUtils";

interface SubscriptionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: TiffinSubscription | null;
  onEdit?: (subscription: TiffinSubscription) => void;
  onPause?: (subscription: TiffinSubscription) => void;
  onResume?: (subscription: TiffinSubscription) => void;
  onCancel?: (subscription: TiffinSubscription) => void;
}

export function SubscriptionDetailModal({
  isOpen,
  onClose,
  subscription,
  onEdit,
  onPause,
  onResume,
  onCancel,
}: SubscriptionDetailModalProps) {
  if (!isOpen || !subscription) return null;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "bg-emerald-100 text-emerald-800 border-emerald-300";
      case "PAUSED":
        return "bg-amber-100 text-amber-800 border-amber-300";
      case "CANCELLED":
        return "bg-rose-100 text-rose-800 border-rose-300";
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
        return "Lunch Only";
      case "DINNER":
        return "Dinner Only";
      case "BREAKFAST":
        return "Breakfast";
      default:
        return mealType;
    }
  };

  const getServiceDaysLabel = (days: string) => {
    switch (days) {
      case "ALL_DAYS":
        return "All 7 Days (Mon - Sun)";
      case "MON_SAT":
        return "6 Days (Mon - Sat)";
      case "MON_FRI":
        return "5 Days (Mon - Fri)";
      default:
        return days;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="subscription-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs overflow-y-auto"
    >
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-xl w-full my-6 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#1A2E20]/10 flex items-center justify-center text-[#1A2E20] shrink-0">
              <Package className="w-5 h-5 text-[#B58A57]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="subscription-detail-title" className="text-base font-bold text-[#1A2E20] truncate">
                  {subscription.productName || "Tiffin Subscription"}
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${getStatusBadge(
                    subscription.status
                  )}`}
                >
                  {subscription.status}
                </span>
              </div>
              <p className="text-[11px] text-[#5A6C5E] mt-0.5 font-mono">
                Sub ID: {subscription.id}
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

        {/* Content Body */}
        <div className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto max-h-[75vh]">
          {/* Pause Notification Banner */}
          {subscription.status === "PAUSED" && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2.5 text-amber-900">
              <PauseCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <div className="font-semibold">Subscription is currently paused</div>
                <div>
                  Paused from: <span className="font-mono">{subscription.pauseStartDate}</span>
                  {subscription.pauseResumeDate && (
                    <> until <span className="font-mono">{subscription.pauseResumeDate}</span></>
                  )}
                </div>
                {subscription.pauseReason && (
                  <div className="text-[11px] text-amber-800 italic mt-1">
                    "{subscription.pauseReason}"
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cancellation Banner */}
          {subscription.status === "CANCELLED" && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-rose-900">
              <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5">
                <div className="font-semibold">Subscription Cancelled</div>
                {subscription.cancelledAt && (
                  <div>
                    Cancelled on: <span className="font-mono">{subscription.cancelledAt.slice(0, 10)}</span>
                  </div>
                )}
                {subscription.cancellationReason && (
                  <div className="text-[11px] text-rose-800 italic mt-1">
                    "{subscription.cancellationReason}"
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Customer Summary Card */}
          <div className="p-3.5 bg-white border border-[#8E9F89]/25 rounded-xl space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89] flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[#B58A57]" />
              Customer Details
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-[#1A2E20]">{subscription.customerName || "Customer"}</span>
              <span className="text-[#5A6C5E] font-mono">{subscription.customerPhone}</span>
            </div>
            {subscription.deliveryAddress && (
              <div className="flex items-start gap-2 text-[11px] text-[#5A6C5E] pt-1 border-t border-[#8E9F89]/15">
                <MapPin className="w-3.5 h-3.5 text-[#B58A57] shrink-0 mt-0.5" />
                <span>{subscription.deliveryAddress}</span>
              </div>
            )}
            {subscription.deliveryInstructions && (
              <div className="text-[11px] text-[#5A6C5E] bg-[#FAF8F5] p-2 rounded border border-[#8E9F89]/20">
                <span className="font-semibold text-[#1A2E20]">Delivery Instructions:</span>{" "}
                {subscription.deliveryInstructions}
              </div>
            )}
          </div>

          {/* Subscription Schedule Card */}
          <div className="p-3.5 bg-white border border-[#8E9F89]/25 rounded-xl space-y-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89] flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#B58A57]" />
              Schedule & Service Plan
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-[#FAF8F5] rounded-lg border border-[#8E9F89]/15">
                <div className="text-[10px] text-[#5A6C5E]">Meal Times</div>
                <div className="font-semibold text-[#1A2E20] mt-0.5">
                  {getMealTypeLabel(subscription.mealTypes)}
                </div>
              </div>

              <div className="p-2 bg-[#FAF8F5] rounded-lg border border-[#8E9F89]/15">
                <div className="text-[10px] text-[#5A6C5E]">Service Frequency</div>
                <div className="font-semibold text-[#1A2E20] mt-0.5">
                  {getServiceDaysLabel(subscription.serviceDays)}
                </div>
              </div>

              <div className="p-2 bg-[#FAF8F5] rounded-lg border border-[#8E9F89]/15">
                <div className="text-[10px] text-[#5A6C5E]">Quantity Per Meal</div>
                <div className="font-semibold text-[#1A2E20] mt-0.5">
                  {subscription.quantityPerMeal} {subscription.quantityPerMeal === 1 ? "thali" : "thalis"}
                </div>
              </div>

              <div className="p-2 bg-[#FAF8F5] rounded-lg border border-[#8E9F89]/15">
                <div className="text-[10px] text-[#5A6C5E]">Price Agreed</div>
                <div className="font-semibold text-emerald-800 mt-0.5">
                  {formatINR(subscription.price)}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-[#8E9F89]/15 flex items-center justify-between text-xs">
              <div>
                <span className="text-[#5A6C5E]">Start Date: </span>
                <span className="font-mono font-medium text-[#1A2E20]">{subscription.startDate}</span>
              </div>
              <div>
                <span className="text-[#5A6C5E]">End Date: </span>
                <span className="font-mono font-medium text-[#1A2E20]">
                  {subscription.endDate || "Ongoing"}
                </span>
              </div>
            </div>
          </div>

          {/* Notes Card if present */}
          {subscription.notes && (
            <div className="p-3 bg-white border border-[#8E9F89]/25 rounded-xl space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89]">
                Notes
              </div>
              <p className="text-xs text-[#5A6C5E]">{subscription.notes}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="flex justify-between items-center text-[10px] text-[#5A6C5E] px-1 font-mono">
            <span>Created: {subscription.createdAt.slice(0, 10)}</span>
            <span>Updated: {subscription.updatedAt.slice(0, 10)}</span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-white border-t border-[#8E9F89]/20 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {/* Pause / Resume button */}
            {subscription.status === "ACTIVE" && onPause && (
              <button
                type="button"
                onClick={() => onPause(subscription)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 text-xs font-medium transition-colors"
              >
                <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                Pause
              </button>
            )}

            {subscription.status === "PAUSED" && onResume && (
              <button
                type="button"
                onClick={() => onResume(subscription)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 text-xs font-medium transition-colors"
              >
                <PlayCircle className="w-3.5 h-3.5 text-emerald-600" />
                Resume
              </button>
            )}

            {/* Cancel button */}
            {(subscription.status === "ACTIVE" || subscription.status === "PAUSED") && onCancel && (
              <button
                type="button"
                onClick={() => onCancel(subscription)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 text-xs font-medium transition-colors"
              >
                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                Cancel Plan
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Edit button */}
            {subscription.status !== "CANCELLED" && onEdit && (
              <button
                type="button"
                onClick={() => onEdit(subscription)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#8E9F89]/40 bg-white text-[#1A2E20] hover:bg-[#FAF8F5] text-xs font-medium transition-colors"
              >
                <Edit className="w-3.5 h-3.5 text-[#B58A57]" />
                Edit
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-[#1A2E20] text-[#FAF8F5] hover:bg-[#2C4A34] text-xs font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
