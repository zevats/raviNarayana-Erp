"use client";

import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState } from "react";
import { UserCheck, X, AlertTriangle } from "lucide-react";
import { DeliveryTask } from "@/types";

interface BatchAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTasks: DeliveryTask[];
  deliveryStaff: Array<{ id: string; fullName: string; username: string }>;
  onSuccess: (assignedCount: number, staffName: string) => void;
}

export function BatchAssignModal({
  isOpen,
  onClose,
  selectedTasks,
  deliveryStaff,
  onSuccess,
}: BatchAssignModalProps) {
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId) {
      setError("Please select a delivery person.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const taskIds = selectedTasks.map((t) => t.id);
      const res = await fetch("/api/delivery/tasks/batch-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskIds,
          assignedToStaffId: selectedStaffId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to batch assign delivery tasks.");
      }

      const assignedStaff = deliveryStaff.find((s) => s.id === selectedStaffId);
      onSuccess(data.assignedCount || taskIds.length, assignedStaff?.fullName || "Staff");
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to assign tasks.");
    } finally {
      setSubmitting(false);
    }
  };

  const eligibleTasks = selectedTasks.filter((t) => t.status !== "DELIVERED" && !t.invoiceId);
  const blockedTasks = selectedTasks.filter((t) => t.status === "DELIVERED" || !!t.invoiceId);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 border border-[#E6E1DA] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
          <div className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-[#B58A57]" />
            <h3 className="font-serif text-lg text-[#1A2E20]">Batch Assign Delivery Staff</h3>
          </div>
          <button onClick={onClose} className="text-[#8E9F89] hover:text-[#1A2E20]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {blockedTasks.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs space-y-1">
            <p className="font-medium">
              Note: {blockedTasks.length} task(s) are already delivered or billed and cannot be reassigned.
            </p>
            <p className="text-[11px] text-amber-700">
              Only the {eligibleTasks.length} eligible task(s) will be assigned.
            </p>
          </div>
        )}

        <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#E6E1DA] text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[#8E9F89] font-mono uppercase text-[10px]">Selected Tasks</span>
            <span className="font-serif font-medium text-[#1A2E20]">{eligibleTasks.length} stop(s)</span>
          </div>
          <div className="max-h-28 overflow-y-auto pt-1 space-y-1 border-t border-[#E6E1DA]/50 mt-1">
            {eligibleTasks.slice(0, 8).map((task) => (
              <div key={task.id} className="flex items-center justify-between text-[11px] text-[#5D7656]">
                <span>
                  {task.orderType === "EXTERNAL" ? "City: " + (task.customerName || "Customer") : `Room ${task.roomNumber} (${task.residentName})`}
                </span>
                <span className="font-mono text-[10px] text-[#8E9F89]">{task.mealType}</span>
              </div>
            ))}
            {eligibleTasks.length > 8 && (
              <p className="text-[10px] text-[#8E9F89] italic">+ {eligibleTasks.length - 8} more stop(s)...</p>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-serif text-[#1A2E20] mb-1">
              Select Delivery Person <span className="text-red-600">*</span>
            </label>
            <AppSelect
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
            >
              <option value="">-- Choose active delivery staff member --</option>
              {deliveryStaff.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.fullName} (@{staff.username})
                </option>
              ))}
            </AppSelect>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-xs font-serif text-[#5D7656] hover:text-[#1A2E20]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedStaffId || eligibleTasks.length === 0}
              className="px-5 py-2 bg-[#1A2E20] text-white text-xs font-serif rounded-xl hover:bg-[#263B2D] transition shadow-xs disabled:opacity-50"
            >
              {submitting ? "Assigning Tasks..." : `Assign ${eligibleTasks.length} Task(s)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
