"use client";

import React, { useEffect } from "react";
import { X, Pencil, MapPin } from "lucide-react";
import { TiffinSubscription } from "@/types";
import { planMealsLabel } from "@/lib/planMeals";

interface SubscriptionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  subscription: TiffinSubscription | null;
  onEdit?: (subscription: TiffinSubscription) => void;
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const day = (d: string | null | undefined) => (d ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`)) : "—");
const STATUS: Record<string, [string, string]> = {
  ACTIVE: ["Active", "bg-[#E4F2E0] text-[#1D4E16]"],
  PAUSED: ["Paused", "bg-[#FBF0D9] text-[#6B4A06]"],
  CANCELLED: ["Ended", "bg-[#EEECE8] text-[#3A403C]"],
  COMPLETED: ["Ended", "bg-[#EEECE8] text-[#3A403C]"],
};

/** One subscription at a glance: plan, price, meals, dates and where it is delivered. */
export function SubscriptionDetailModal({ isOpen, onClose, subscription: s, onEdit }: SubscriptionDetailModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);
  if (!isOpen || !s) return null;
  const [label, cls] = STATUS[s.status] || [s.status, "bg-[#EEECE8] text-[#3A403C]"];
  const facts: Array<[string, React.ReactNode]> = [
    ["Plan", s.productName || "—"],
    ["Monthly price", rupees(s.price)],
    ["Meals", planMealsLabel(s.mealTypes)],
    ["Started", day(s.startDate)],
    ...(s.status === "PAUSED" ? ([["Paused", `${day(s.pauseStartDate)} → ${s.pauseResumeDate ? day(s.pauseResumeDate) : "until resumed"}`]] as Array<[string, React.ReactNode]>) : []),
    ...(s.status === "CANCELLED" ? ([["Ended", `${day(s.cancelledAt)}${s.cancellationReason ? ` · ${s.cancellationReason}` : ""}`]] as Array<[string, React.ReactNode]>) : []),
  ];
  const editable = Boolean(onEdit) && (s.status === "ACTIVE" || s.status === "PAUSED");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 rn-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="sub-detail-title" className="rn-modal">
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-[rgba(30,35,32,0.08)]">
          <div className="min-w-0">
            <h2 id="sub-detail-title" className="text-[20px] font-semibold text-[#1E2320] truncate">{s.customerName}</h2>
            <p className="mt-1 flex items-center gap-2 text-[14px] text-[#3A403C]">
              <span className="tabular-nums">{s.customerPhone}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${cls}`}>{label}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid place-items-center w-11 h-11 -mr-2 rounded-full text-[#4A504B] hover:bg-black/[0.05]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            {facts.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-[12.5px] text-[#4A504B]">{k}</dt>
                <dd className="text-[15px] font-medium text-[#1E2320] break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="rounded-2xl bg-[#F6F3EC] px-4 py-3">
            <p className="flex items-center gap-1.5 text-[12.5px] text-[#4A504B]"><MapPin className="w-3.5 h-3.5" /> Delivery address</p>
            <p className="mt-0.5 text-[15px] text-[#1E2320]">{s.deliveryAddress || "—"}</p>
          </div>
        </div>
        {editable && (
          <div className="flex justify-end px-6 py-4 border-t border-[rgba(30,35,32,0.08)]">
            <button type="button" onClick={() => onEdit!(s)} className="rn-btn-primary inline-flex items-center gap-2 h-12 px-6 rounded-full text-[15px] font-semibold">
              <Pencil className="w-4 h-4" /> Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
