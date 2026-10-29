"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  Truck,
  IndianRupee,
  Minus,
  Plus,
  HelpCircle,
  MapPin,
  Phone,
} from "lucide-react";
import { DeliveryTask, PaymentMethod } from "@/types";
import { enqueueDeliveryAction } from "../../offlineQueue";

interface SingleScreenDeliveryModalProps {
  task: DeliveryTask | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentUserId?: string;
}

export function SingleScreenDeliveryModal({
  task,
  isOpen,
  onClose,
  onSuccess,
  currentUserId,
}: SingleScreenDeliveryModalProps) {
  // Parse order items from delivery notes if structured
  const orderMetadata = useMemo(() => {
    if (!task?.deliveryNotes) return null;
    const match = task.deliveryNotes.match(/\[ORDER_JSON:(\{.*?\})\]/);
    if (match && match[1]) {
      try {
        return JSON.parse(match[1]);
      } catch {
        return null;
      }
    }
    return null;
  }, [task]);

  const items = useMemo(() => {
    if (orderMetadata?.items && Array.isArray(orderMetadata.items)) {
      return orderMetadata.items;
    }
    // Default single portion item fallback
    return [
      {
        productName: task?.mealType ? `${task.mealType} Thali` : "Meal Portion",
        quantity: 1,
        unitPrice: Number(task?.collectedAmount) || 120,
      },
    ];
  }, [orderMetadata, task]);

  const totalOrderedQuantity = useMemo(() => {
    return items.reduce((s: number, it: any) => s + (Number(it.quantity) || 1), 0);
  }, [items]);

  // Quantity state: Delivered is the single primary input; Undelivered is auto-calculated
  const [deliveredQuantity, setDeliveredQuantity] = useState<number>(totalOrderedQuantity);
  const [undeliveredQuantity, setUndeliveredQuantity] = useState<number>(0);
  const [undeliveredReason, setUndeliveredReason] = useState<string>("");

  // Payment state
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [recipientName, setRecipientName] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  // Amount calculation
  const unitPriceEstimate = useMemo(() => {
    const totalCost = items.reduce((s: number, it: any) => s + ((Number(it.quantity) || 1) * (Number(it.unitPrice) || 0)), 0);
    return totalOrderedQuantity > 0 ? Math.round(totalCost / totalOrderedQuantity) : 120;
  }, [items, totalOrderedQuantity]);

  const expectedAmountToCollect = useMemo(() => {
    return Math.max(0, deliveredQuantity * unitPriceEstimate);
  }, [deliveredQuantity, unitPriceEstimate]);

  const [collectedAmount, setCollectedAmount] = useState<string>(expectedAmountToCollect.toString());

  // Auto-update collected amount when delivered quantity changes
  useEffect(() => {
    setCollectedAmount(expectedAmountToCollect.toString());
  }, [expectedAmountToCollect]);

  // One idempotency key per opened task: a retry after a lost response, or the offline
  // replay of this submission, must be recognised by the server as the same completion.
  const [idempotencyKey, setIdempotencyKey] = useState<string>("");
  const [queuedOffline, setQueuedOffline] = useState(false);

  // Reset when task changes
  useEffect(() => {
    if (task) {
      setDeliveredQuantity(totalOrderedQuantity);
      setUndeliveredQuantity(0);
      setUndeliveredReason("");
      setRecipientName(task.residentName || task.customerName || "");
      setNotes("");
      setIdempotencyKey(`del_${task.id}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
      setQueuedOffline(false);
    }
  }, [task, totalOrderedQuantity]);

  // Complementary calculations: single Delivered input determines Undelivered automatically
  const handleDeliveredChange = (val: number) => {
    const clamped = Math.max(0, Math.min(totalOrderedQuantity, isNaN(val) ? 0 : val));
    setDeliveredQuantity(clamped);
    setUndeliveredQuantity(totalOrderedQuantity - clamped);
  };

  const collectedNum = parseInt(collectedAmount, 10) || 0;
  const remainingBalance = Math.max(0, expectedAmountToCollect - collectedNum);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task) return;
    setErrorMessage(null);

    // Validation
    if (undeliveredQuantity > 0 && !undeliveredReason.trim()) {
      setErrorMessage("Please select or enter a reason for undelivered portions.");
      return;
    }

    setIsSubmitting(true);

    try {
      // Build item-level reconciliation
      const itemReconciliation = items.map((it: any) => {
        const itemQty = Number(it.quantity) || 1;
        const itemRatio = totalOrderedQuantity > 0 ? itemQty / totalOrderedQuantity : 1;
        const itemDelivered = Math.round(deliveredQuantity * itemRatio);
        const itemUndelivered = Math.max(0, itemQty - itemDelivered);
        return {
          productName: it.productName,
          orderedQuantity: itemQty,
          deliveredQuantity: itemDelivered,
          undeliveredQuantity: itemUndelivered,
          undeliveredReason: itemUndelivered > 0 ? undeliveredReason.trim() : undefined,
          unitPrice: Number(it.unitPrice) || unitPriceEstimate,
        };
      });

      const payload = {
        recipientName: recipientName.trim() || undefined,
        notes: notes.trim() || undefined,
        collectedAmount: collectedNum,
        paymentMethod: collectedNum > 0 ? paymentMethod : undefined,
        deliveredQuantity,
        undeliveredQuantity,
        undeliveredReason: undeliveredQuantity > 0 ? undeliveredReason.trim() : undefined,
        itemsReconciliation: itemReconciliation,
      };

      const queueForSync = () => {
        enqueueDeliveryAction("COMPLETE_DELIVERY", task.id, payload, currentUserId, idempotencyKey);
        setQueuedOffline(true);
      };

      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        queueForSync();
        return;
      }

      let res: Response;
      try {
        res = await fetch(`/api/delivery/tasks/${task.id}/deliver`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, idempotencyKey }),
        });
      } catch {
        // Network failure (dead zone, dropped connection): keep the completion on the device.
        queueForSync();
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm delivery.");

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to submit delivery confirmation.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !task) return null;

  const isExternal = task.orderType === "EXTERNAL";
  const customerDisplayName = isExternal ? task.customerName || "City Customer" : task.residentName || `Room ${task.roomNumber}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full border border-[#DCD6CD] shadow-2xl flex flex-col max-h-[94vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#FAF8F5] border-b border-[#E6E1DA] flex items-center justify-between shrink-0">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#8E9F89] block">
              Single-Screen Completion
            </span>
            <h3 className="font-serif text-lg text-[#1A2E20] font-bold">Confirm Delivery</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#8E9F89] hover:text-[#1A2E20] hover:bg-[#E6E1DA]/50 rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-800 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {queuedOffline && (
            <div
              role="status"
              className="p-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 text-amber-700" />
              <span>
                No connection. This delivery is saved on this phone and will sync automatically when you are back
                online (see Offline Sync).
              </span>
            </div>
          )}

          {/* Customer & Stop Info Card */}
          <div className="p-3.5 bg-[#FAF8F5] rounded-2xl border border-[#E6E1DA] space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-serif text-sm font-bold text-[#1A2E20]">
                {customerDisplayName}
              </span>
              <span className="px-2 py-0.5 rounded font-mono text-[10px] uppercase bg-[#1A2E20]/5 text-[#1A2E20] border border-[#1A2E20]/15">
                {task.mealType}
              </span>
            </div>

            {task.deliveryAddress && (
              <p className="text-[#5D7656] flex items-start gap-1">
                <MapPin className="w-3.5 h-3.5 text-[#B58A57] shrink-0 mt-0.5" />
                <span>{task.deliveryAddress}</span>
              </p>
            )}

            {task.customerPhone && (
              <p className="text-[#8E9F89] font-mono text-[11px] flex items-center gap-1">
                <Phone className="w-3 h-3 text-[#B58A57]" />
                {task.customerPhone}
              </p>
            )}
          </div>

          {/* QUANTITY SECTION: DIRECT DELIVERED INPUT & AUTO UNDELIVERED */}
          <div className="p-4 bg-white rounded-2xl border border-[#E6E1DA] shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-serif font-bold text-[#1A2E20]">
                Portion Delivery &amp; Reconciliation
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-[#FAF8F5] text-[#5D7656] border border-[#E6E1DA]">
                Ordered: <strong>{totalOrderedQuantity}</strong> portions
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Single Delivered Portions Input */}
              <div className="p-3 rounded-xl border bg-emerald-50/40 border-emerald-300">
                <label className="block text-[11px] font-serif font-bold text-emerald-900 mb-1.5">
                  Delivered Portions *
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={deliveredQuantity <= 0}
                    onClick={() => handleDeliveredChange(deliveredQuantity - 1)}
                    className="w-8 h-8 rounded-lg bg-white border border-[#DCD6CD] text-[#1A2E20] flex items-center justify-center font-bold text-sm disabled:opacity-30 hover:bg-[#FAF8F5]"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min="0"
                    max={totalOrderedQuantity}
                    value={deliveredQuantity}
                    onChange={(e) => handleDeliveredChange(parseInt(e.target.value, 10))}
                    className="flex-1 text-center py-1 text-sm font-mono font-bold bg-white border border-emerald-300 rounded-lg text-emerald-950"
                  />
                  <button
                    type="button"
                    disabled={deliveredQuantity >= totalOrderedQuantity}
                    onClick={() => handleDeliveredChange(deliveredQuantity + 1)}
                    className="w-8 h-8 rounded-lg bg-emerald-700 text-white flex items-center justify-center font-bold text-sm disabled:opacity-30 hover:bg-emerald-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Automatic Calculated Undelivered Display */}
              <div className={`p-3 rounded-xl border flex flex-col justify-between ${
                undeliveredQuantity > 0
                  ? "bg-amber-50/60 border-amber-300"
                  : "bg-[#FAF8F5] border-[#E6E1DA]"
              }`}>
                <label className="block text-[11px] font-serif font-medium text-[#5D7656]">
                  Undelivered / Returned
                </label>
                <div className="flex items-baseline gap-1.5 py-1">
                  <span className={`text-xl font-mono font-bold ${
                    undeliveredQuantity > 0 ? "text-amber-800" : "text-[#5D7656]"
                  }`}>
                    {undeliveredQuantity}
                  </span>
                  <span className="text-[11px] font-serif text-[#8E9F89]">
                    {undeliveredQuantity === 0 ? "All delivered" : "shortfall"}
                  </span>
                </div>
                <span className="text-[10px] text-[#8E9F89] italic">
                  Auto-calculated (Ordered − Delivered)
                </span>
              </div>
            </div>

            {/* Mandatory Shortfall Reason if any portion is undelivered */}
            {undeliveredQuantity > 0 && (
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 space-y-2">
                <label className="block text-xs font-serif font-bold text-amber-900">
                  Shortfall Reason (Mandatory for {undeliveredQuantity} undelivered portion{undeliveredQuantity > 1 ? "s" : ""}) *
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    "Customer took fewer portions",
                    "Canceled at door",
                    "Damage in transit",
                    "Customer unavailable",
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setUndeliveredReason(chip)}
                      className={`px-2 py-1 text-[10px] font-serif rounded-lg border transition ${
                        undeliveredReason === chip
                          ? "bg-amber-800 text-white border-amber-800"
                          : "bg-white text-amber-900 border-amber-300 hover:bg-amber-100"
                      }`}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  required
                  placeholder="Or enter custom reason..."
                  value={undeliveredReason}
                  onChange={(e) => setUndeliveredReason(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-amber-300 rounded-lg text-[#1A2E20]"
                />
              </div>
            )}
          </div>

          {/* AMOUNT & COLLECTION SECTION */}
          <div className="p-4 bg-white rounded-2xl border border-[#E6E1DA] shadow-2xs space-y-3">
            <span className="text-xs font-serif font-bold text-[#1A2E20] block">
              Payment &amp; Collection
            </span>

            <div className="grid grid-cols-3 gap-2 p-2.5 bg-[#FAF8F5] rounded-xl text-xs text-center border border-[#E6E1DA]">
              <div>
                <span className="text-[10px] text-[#8E9F89] uppercase font-mono block">Expected</span>
                <span className="font-serif font-bold text-[#1A2E20] text-sm">
                  ₹{expectedAmountToCollect}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#8E9F89] uppercase font-mono block">Collected</span>
                <span className="font-serif font-bold text-emerald-800 text-sm">
                  ₹{collectedNum}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-[#8E9F89] uppercase font-mono block">Remaining</span>
                <span className={`font-serif font-bold text-sm ${remainingBalance > 0 ? "text-amber-800" : "text-[#5D7656]"}`}>
                  ₹{remainingBalance}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                  Cash Collected (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={collectedAmount}
                  onChange={(e) => setCollectedAmount(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl font-mono font-bold text-[#1A2E20]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
                >
                  <option value="CASH">Cash (Driver Custody)</option>
                  <option value="UPI">UPI / QR Code</option>
                </select>
              </div>
            </div>
          </div>

          {/* RECIPIENT & OPTIONAL NOTES */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                Handover Recipient
              </label>
              <input
                type="text"
                placeholder="Recipient name"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-serif text-[#1A2E20] mb-1">
                Notes
              </label>
              <input
                type="text"
                placeholder="e.g. Handed at security"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
              />
            </div>
          </div>

          {/* FINAL CONFIRM BUTTON */}
          <div className="pt-2">
            {queuedOffline ? (
              <button
                type="button"
                onClick={onClose}
                className="w-full py-3 bg-[#1A2E20] hover:bg-[#2A4230] text-white font-serif font-bold text-sm rounded-2xl transition shadow-md flex items-center justify-center gap-2"
              >
                Done
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-serif font-bold text-sm rounded-2xl transition shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5" />
                {isSubmitting ? "Recording Delivery..." : "Confirm Delivery"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
