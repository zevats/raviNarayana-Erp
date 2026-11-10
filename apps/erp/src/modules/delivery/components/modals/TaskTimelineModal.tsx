"use client";

import { friendlyError } from "@/lib/friendlyError";
import React, { useEffect, useState } from "react";
import { History, X, Clock, CheckCircle2, AlertTriangle, Truck, User, RotateCcw } from "lucide-react";
import { DeliveryTask, DeliveryTaskEvent } from "@/types";
import { BikeLoader } from "@/components/feedback/BikeLoader";

interface TaskTimelineModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: DeliveryTask | null;
}

export function TaskTimelineModal({
  isOpen,
  onClose,
  task,
}: TaskTimelineModalProps) {
  const [events, setEvents] = useState<DeliveryTaskEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !task) return;
    const taskId = task.id;

    async function loadTimeline() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/delivery/tasks/${taskId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load task events");
        setEvents(data.events || []);
      } catch (err: any) {
        setError(friendlyError(err.message || "Failed to load audit timeline"));
      } finally {
        setLoading(false);
      }
    }

    loadTimeline();
  }, [isOpen, task]);

  if (!isOpen || !task) return null;

  const getEventIcon = (eventType: string) => {
    switch (eventType) {
      case "CREATED":
        return <Clock className="w-4 h-4 text-amber-600" />;
      case "ASSIGNED":
      case "REASSIGNED":
        return <User className="w-4 h-4 text-blue-600" />;
      case "DISPATCHED":
        return <Truck className="w-4 h-4 text-indigo-600" />;
      case "DELIVERED":
        return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
      case "EXCEPTION":
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case "RETRIED":
        return <RotateCcw className="w-4 h-4 text-[#B58A57]" />;
      default:
        return <History className="w-4 h-4 text-[#8E9F89]" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 rn-modal-scrim">
      <div className="rn-modal bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 border border-[#E6E1DA] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-[#B58A57]" />
            <h3 className="font-serif text-lg text-[#1A2E20]">Delivery Audit Timeline</h3>
          </div>
          <button onClick={onClose} className="text-[#8E9F89] hover:text-[#1A2E20]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#E6E1DA] text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-serif font-medium text-[#1A2E20]">
              {task.orderType === "EXTERNAL" ? task.customerName || "City Customer" : `Room ${task.roomNumber} (${task.residentName})`}
            </span>
            <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded bg-white border border-[#E6E1DA]">
              {task.mealType} • {task.serviceDate}
            </span>
          </div>
          {task.orderType === "EXTERNAL" && task.deliveryAddress && (
            <p className="text-[11px] text-[#5D7656]">{task.deliveryAddress}</p>
          )}
          {task.invoiceId && (
            <p className="text-[10px] text-emerald-700 font-mono">
              Billed: {task.invoiceId} (at {new Date(task.billedAt || "").toLocaleDateString()})
            </p>
          )}
        </div>

        {loading ? (
          <BikeLoader size="sm" label="Loading timeline…" className="py-8" />
        ) : error ? (
          <div className="p-3 bg-red-50 text-red-800 text-xs rounded-xl border border-red-200">
            {error}
          </div>
        ) : events.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#8E9F89] font-serif">
            No events recorded yet.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto pr-2 space-y-3">
            {events.map((evt, idx) => (
              <div key={evt.id || idx} className="flex items-start gap-3 text-xs border-l-2 border-[#E6E1DA] pl-3 py-1">
                <div className="p-1 rounded-md bg-[#FAF8F5] border border-[#E6E1DA] shrink-0 mt-0.5">
                  {getEventIcon(evt.eventType)}
                </div>
                <div className="space-y-0.5 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[#1A2E20] font-mono uppercase text-[11px]">
                      {evt.eventType}
                    </span>
                    <span className="text-[10px] font-mono text-[#8E9F89]">
                      {new Date(evt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                  {evt.notes && (
                    <p className="text-[#5D7656] text-[11px]">{evt.notes}</p>
                  )}
                  <p className="text-[10px] text-[#8E9F89]">By {evt.actorName}</p>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
