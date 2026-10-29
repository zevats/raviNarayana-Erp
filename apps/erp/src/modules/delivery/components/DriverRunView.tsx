"use client";

import React, { useState, useEffect } from "react";
import {
  Truck,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Phone,
  RefreshCw,
  Clock,
  Check,
  ChevronRight,
  PackageCheck,
  AlertCircle,
  FileText,
  Wifi,
  WifiOff,
  IndianRupee,
  ArrowDownCircle,
  Send,
  X,
} from "lucide-react";
import { DeliveryTask, AuthenticatedUser, DriverCustodySummary } from "@/types";
import { getOfflineQueue, processOfflineQueue } from "../offlineQueue";

interface DriverRunViewProps {
  currentUser: AuthenticatedUser;
  serviceDate: string;
  tasks: DeliveryTask[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onDispatch: (taskId: string, label: string) => Promise<void>;
  onBatchDispatch: (taskIds: string[]) => Promise<void>;
  onOpenCompleteModal: (task: DeliveryTask) => void;
  onOpenExceptionModal: (task: DeliveryTask) => void;
}

export function DriverRunView({
  currentUser,
  serviceDate,
  tasks,
  loading,
  onRefresh,
  onDispatch,
  onBatchDispatch,
  onOpenCompleteModal,
  onOpenExceptionModal,
}: DriverRunViewProps) {
  const [activeTab, setActiveTab] = useState<"PENDING" | "COMPLETED" | "EXCEPTIONS">("PENDING");
  const [isStartingRun, setIsStartingRun] = useState(false);

  // Offline and connectivity state
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [offlinePendingCount, setOfflinePendingCount] = useState<number>(0);
  const [isSyncingOffline, setIsSyncingOffline] = useState<boolean>(false);
  const [offlineSyncMessage, setOfflineSyncMessage] = useState<string | null>(null);

  // Driver Cash Custody state
  const [custody, setCustody] = useState<DriverCustodySummary | null>(null);
  const [isHandoverModalOpen, setIsHandoverModalOpen] = useState(false);
  const [declaredCash, setDeclaredCash] = useState<string>("");
  const [handoverNotes, setHandoverNotes] = useState<string>("");
  const [isSubmittingHandover, setIsSubmittingHandover] = useState(false);
  const [handoverMessage, setHandoverMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Check online status and queue
  useEffect(() => {
    const updateOnlineStatus = () => {
      setIsOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    };

    const updateQueueCount = () => {
      const q = getOfflineQueue();
      setOfflinePendingCount(q.filter((i) => i.status === "PENDING" || i.status === "FAILED").length);
    };

    updateOnlineStatus();
    updateQueueCount();

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    const interval = setInterval(updateQueueCount, 3000);

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
      clearInterval(interval);
    };
  }, []);

  // Fetch driver custody summary
  const fetchCustody = async () => {
    try {
      const res = await fetch(`/api/delivery/handover?summary=true&driverId=${currentUser.id}&shiftDate=${serviceDate}`);
      if (res.ok) {
        const data = await res.json();
        if (data.summary) {
          setCustody(data.summary);
        }
      }
    } catch (e) {
      // Ignore background custody fetch errors
    }
  };

  useEffect(() => {
    fetchCustody();
  }, [currentUser.id, serviceDate, tasks]);

  // Handle Offline Queue Sync
  const handleSyncOffline = async () => {
    setIsSyncingOffline(true);
    setOfflineSyncMessage(null);
    try {
      const { syncedCount, conflictCount, errorCount } = await processOfflineQueue();
      const q = getOfflineQueue();
      setOfflinePendingCount(q.filter((i) => i.status === "PENDING" || i.status === "FAILED").length);

      if (syncedCount > 0 || conflictCount > 0 || errorCount > 0) {
        setOfflineSyncMessage(`Synced ${syncedCount} action(s). ${conflictCount > 0 ? `${conflictCount} conflict(s). ` : ""}${errorCount > 0 ? `${errorCount} error(s).` : ""}`);
        await onRefresh();
        await fetchCustody();
      } else {
        setOfflineSyncMessage("Queue is already up to date.");
      }
      setTimeout(() => setOfflineSyncMessage(null), 4000);
    } catch (err: any) {
      setOfflineSyncMessage("Failed to sync offline actions: " + err.message);
    } finally {
      setIsSyncingOffline(false);
    }
  };

  // Handle Handover Declaration Submit
  const handleDeclareHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingHandover(true);
    setHandoverMessage(null);

    const amount = parseInt(declaredCash, 10);
    if (isNaN(amount) || amount < 0) {
      setHandoverMessage({ type: "error", text: "Please enter a valid cash amount." });
      setIsSubmittingHandover(false);
      return;
    }

    try {
      const res = await fetch("/api/delivery/handover/declare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: currentUser.id,
          shiftDate: serviceDate,
          declaredCash: amount,
          notes: handoverNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to declare cash handover.");

      setHandoverMessage({
        type: "success",
        text: `Declared ₹${amount} for settlement. Please present cash to the office.`,
      });
      setDeclaredCash("");
      setHandoverNotes("");
      await fetchCustody();
      setTimeout(() => {
        setIsHandoverModalOpen(false);
        setHandoverMessage(null);
      }, 3000);
    } catch (err: any) {
      setHandoverMessage({ type: "error", text: err.message || "Failed to declare handover." });
    } finally {
      setIsSubmittingHandover(false);
    }
  };

  // Categorize tasks for driver
  const assignedToMe = tasks.filter((t) => t.assignedTo === currentUser.id);
  const pendingStops = assignedToMe.filter((t) => t.status === "ASSIGNED" || t.status === "OUT_FOR_DELIVERY");
  const readyToDepart = assignedToMe.filter((t) => t.status === "ASSIGNED");
  const completedStops = assignedToMe.filter((t) => t.status === "DELIVERED");
  const exceptionStops = assignedToMe.filter((t) => t.status === "EXCEPTION");

  const displayedTasks =
    activeTab === "PENDING"
      ? pendingStops
      : activeTab === "COMPLETED"
      ? completedStops
      : exceptionStops;

  const handleStartAllDeliveries = async () => {
    if (readyToDepart.length === 0) return;
    setIsStartingRun(true);
    try {
      await onBatchDispatch(readyToDepart.map((t) => t.id));
    } finally {
      setIsStartingRun(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Offline Sync Banner */}
      {(!isOnline || offlinePendingCount > 0) && (
        <div className={`p-4 rounded-2xl border text-xs flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm ${
          !isOnline ? "bg-amber-500/10 border-amber-500/30 text-amber-900" : "bg-blue-50 border-blue-200 text-blue-900"
        }`}>
          <div className="flex items-center gap-2.5">
            {!isOnline ? (
              <WifiOff className="w-5 h-5 text-amber-600 shrink-0" />
            ) : (
              <Wifi className="w-5 h-5 text-blue-600 shrink-0" />
            )}
            <div>
              <p className="font-serif font-medium">
                {!isOnline ? "Working in Offline Mode" : "Online & Reconnected"}
              </p>
              <p className="text-[11px] opacity-80">
                {offlinePendingCount > 0
                  ? `${offlinePendingCount} action(s) saved locally awaiting server sync.`
                  : "All actions synchronized with server."}
              </p>
            </div>
          </div>
          {offlinePendingCount > 0 && isOnline && (
            <button
              onClick={handleSyncOffline}
              disabled={isSyncingOffline}
              className="px-4 py-2 bg-[#1A2E20] hover:bg-[#263B2D] text-white font-serif font-medium text-xs rounded-xl transition flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingOffline ? "animate-spin" : ""}`} />
              {isSyncingOffline ? "Syncing..." : "Sync Now"}
            </button>
          )}
        </div>
      )}

      {offlineSyncMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center justify-between">
          <span>{offlineSyncMessage}</span>
          <button onClick={() => setOfflineSyncMessage(null)} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. Mobile Driver Dossier Card */}
      <div className="bg-[#1A2E20] text-white p-5 rounded-2xl shadow-md border border-[#263B2D] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#C89F6B]">
                Driver Mobile Console
              </span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium ${
                isOnline ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}>
                {isOnline ? <Wifi className="w-2.5 h-2.5" /> : <WifiOff className="w-2.5 h-2.5" />}
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>
            <h2 className="text-xl font-serif font-normal mt-0.5">{currentUser.fullName}</h2>
            <p className="text-xs text-[#8E9F89] font-mono mt-0.5">
              Service Run: {serviceDate}
            </p>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition text-white border border-white/10"
            title="Refresh Stops"
          >
            <RefreshCw className={`w-4 h-4 text-[#C89F6B] ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Driver Stats */}
        <div className="grid grid-cols-4 gap-2 pt-2 border-t border-white/10 text-center">
          <div className="bg-white/5 p-2 rounded-xl">
            <span className="text-[10px] text-[#8E9F89] uppercase font-mono block">Total</span>
            <span className="text-lg font-serif font-bold text-white">{assignedToMe.length}</span>
          </div>
          <div className="bg-white/5 p-2 rounded-xl">
            <span className="text-[10px] text-indigo-300 uppercase font-mono block">Pending</span>
            <span className="text-lg font-serif font-bold text-indigo-300">{pendingStops.length}</span>
          </div>
          <div className="bg-white/5 p-2 rounded-xl">
            <span className="text-[10px] text-emerald-300 uppercase font-mono block">Delivered</span>
            <span className="text-lg font-serif font-bold text-emerald-300">{completedStops.length}</span>
          </div>
          <div className="bg-white/5 p-2 rounded-xl">
            <span className="text-[10px] text-red-300 uppercase font-mono block">Issues</span>
            <span className="text-lg font-serif font-bold text-red-300">{exceptionStops.length}</span>
          </div>
        </div>

        {/* Cash Custody Card */}
        <div className="p-3.5 bg-white/5 border border-white/10 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs">
            <IndianRupee className="w-5 h-5 text-[#C89F6B] shrink-0" />
            <div>
              <p className="font-serif font-medium text-white">
                Cash in Custody: ₹{(custody?.cashInCustody || 0).toLocaleString("en-IN")}
              </p>
              <p className="text-[11px] text-[#8E9F89]">
                Total Collected: ₹{(custody?.totalCashCollected || 0).toLocaleString("en-IN")} • Settled: ₹{(custody?.totalAcceptedHandover || 0).toLocaleString("en-IN")}
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              setDeclaredCash(String(custody?.cashInCustody || ""));
              setIsHandoverModalOpen(true);
            }}
            className="w-full sm:w-auto px-4 py-2 bg-[#C89F6B] hover:bg-[#B58A57] text-[#1A2E20] font-serif font-semibold text-xs rounded-xl transition shadow-xs flex items-center justify-center gap-1.5"
          >
            <ArrowDownCircle className="w-3.5 h-3.5" />
            Declare Handover
          </button>
        </div>

        {/* Start Run Action Banner */}
        {readyToDepart.length > 0 && (
          <div className="p-3.5 bg-[#B58A57]/20 border border-[#B58A57]/40 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs">
              <Truck className="w-5 h-5 text-[#C89F6B] shrink-0" />
              <div>
                <p className="font-serif font-medium text-white">
                  {readyToDepart.length} meal(s) ready at kitchen
                </p>
                <p className="text-[11px] text-[#E6E1DA]">Depart kitchen to mark all out for delivery</p>
              </div>
            </div>
            <button
              onClick={handleStartAllDeliveries}
              disabled={isStartingRun}
              className="w-full sm:w-auto px-4 py-2 bg-[#C89F6B] hover:bg-[#B58A57] text-[#1A2E20] font-serif font-semibold text-xs rounded-xl transition shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Truck className="w-4 h-4" />
              {isStartingRun ? "Departing Kitchen..." : `Depart Kitchen (${readyToDepart.length})`}
            </button>
          </div>
        )}
      </div>

      {/* 2. Navigation Tabs */}
      <div className="flex rounded-xl bg-white p-1 border border-[#E6E1DA] shadow-2xs">
        <button
          onClick={() => setActiveTab("PENDING")}
          className={`flex-1 py-2 text-xs font-serif rounded-lg transition text-center flex items-center justify-center gap-1.5 ${
            activeTab === "PENDING"
              ? "bg-[#1A2E20] text-white font-medium shadow-xs"
              : "text-[#5D7656] hover:text-[#1A2E20]"
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          <span>To Deliver ({pendingStops.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("COMPLETED")}
          className={`flex-1 py-2 text-xs font-serif rounded-lg transition text-center flex items-center justify-center gap-1.5 ${
            activeTab === "COMPLETED"
              ? "bg-[#1A2E20] text-white font-medium shadow-xs"
              : "text-[#5D7656] hover:text-[#1A2E20]"
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Completed ({completedStops.length})</span>
        </button>
        <button
          onClick={() => setActiveTab("EXCEPTIONS")}
          className={`flex-1 py-2 text-xs font-serif rounded-lg transition text-center flex items-center justify-center gap-1.5 ${
            activeTab === "EXCEPTIONS"
              ? "bg-[#1A2E20] text-white font-medium shadow-xs"
              : "text-[#5D7656] hover:text-[#1A2E20]"
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>Issues ({exceptionStops.length})</span>
        </button>
      </div>

      {/* 3. Driver Stop Cards */}
      {displayedTasks.length === 0 ? (
        <div className="p-10 text-center bg-white rounded-2xl border border-[#E6E1DA] space-y-2">
          <PackageCheck className="w-8 h-8 text-[#8E9F89] mx-auto opacity-60" />
          <h3 className="font-serif text-base text-[#1A2E20]">No Stops in this Section</h3>
          <p className="text-xs text-[#5D7656]">
            {activeTab === "PENDING"
              ? "All your deliveries for this service have been completed or marked!"
              : activeTab === "COMPLETED"
              ? "No deliveries completed yet."
              : "No issues or exceptions reported."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {displayedTasks.map((task, idx) => {
            const isExternal = task.orderType === "EXTERNAL";
            const isDispatched = task.status === "OUT_FOR_DELIVERY";

            return (
              <div
                key={task.id}
                className="bg-white rounded-2xl border border-[#E6E1DA] p-4 sm:p-5 shadow-2xs space-y-4 hover:border-[#DCD6CD] transition"
              >
                {/* Header: Destination & Status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {/* Badge */}
                    {isExternal ? (
                      <div className="w-12 h-12 rounded-xl bg-[#263B2D] text-white flex flex-col items-center justify-center shrink-0 border border-[#3E4E42]">
                        <MapPin className="w-4 h-4 text-[#C89F6B]" />
                        <span className="text-[9px] font-mono uppercase text-[#C89F6B] font-bold">CITY</span>
                      </div>
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-[#1A2E20] text-white flex flex-col items-center justify-center shrink-0 border border-[#263B2D]">
                        <span className="text-[9px] uppercase font-mono tracking-wider text-[#C89F6B]">Room</span>
                        <span className="text-base font-serif font-bold">{task.roomNumber}</span>
                      </div>
                    )}

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-[#8E9F89] uppercase">
                          Stop #{idx + 1}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-[#1A2E20]/5 text-[#1A2E20] uppercase border border-[#1A2E20]/15">
                          {task.mealType}
                        </span>
                        {task.invoiceId && (
                          <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                            Billed
                          </span>
                        )}
                        {task.collectionStatus === "COLLECTED" && (
                          <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200">
                            ₹{task.collectedAmount} in Custody ({task.collectedPaymentMethod})
                          </span>
                        )}
                        {task.collectionStatus === "HANDED_OVER" && (
                          <span className="text-[10px] font-mono px-2 py-0.2 rounded bg-indigo-50 text-indigo-800 border border-indigo-200">
                            ₹{task.collectedAmount} Handed Over
                          </span>
                        )}
                      </div>
                      <h4 className="font-serif text-lg text-[#1A2E20] font-medium leading-tight">
                        {isExternal ? task.customerName || "City Customer" : task.residentName}
                      </h4>
                      {!isExternal && (
                        <p className="text-xs text-[#5D7656]">
                          PG Guesthouse • Floor {task.floor}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {task.status === "ASSIGNED" && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-blue-50 text-blue-800 border border-blue-200 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Ready
                      </span>
                    )}
                    {task.status === "OUT_FOR_DELIVERY" && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-indigo-50 text-indigo-800 border border-indigo-200 inline-flex items-center gap-1">
                        <Truck className="w-3 h-3 animate-pulse" /> In Transit
                      </span>
                    )}
                    {task.status === "DELIVERED" && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Done
                      </span>
                    )}
                    {task.status === "EXCEPTION" && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-red-50 text-red-800 border border-red-200 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Issue
                      </span>
                    )}
                  </div>
                </div>

                {/* External Address & Contact Strip */}
                {isExternal && (
                  <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#E6E1DA] space-y-2 text-xs">
                    <div className="flex items-start gap-2 text-[#1A2E20]">
                      <MapPin className="w-4 h-4 text-[#B58A57] shrink-0 mt-0.5" />
                      <span className="font-medium">{task.deliveryAddress}</span>
                    </div>
                    {task.customerPhone && (
                      <div className="flex items-center justify-between pt-1 border-t border-[#E6E1DA]/60">
                        <span className="text-[#8E9F89] font-mono text-[11px]">{task.customerPhone}</span>
                        <a
                          href={`tel:${task.customerPhone}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#1A2E20] text-white text-[11px] font-serif rounded-lg hover:bg-[#263B2D] transition"
                        >
                          <Phone className="w-3 h-3 text-[#C89F6B]" />
                          Call Customer
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {/* Special Delivery Instructions / Notes */}
                {task.deliveryNotes && (
                  <div className="p-2.5 bg-amber-50/60 rounded-xl border border-amber-200/60 text-xs text-amber-900 flex items-start gap-2">
                    <FileText className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                    <span>{task.deliveryNotes}</span>
                  </div>
                )}

                {/* Delivery Outcome Details */}
                {task.status === "DELIVERED" && (
                  <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      Delivered at {new Date(task.deliveredAt || "").toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {task.recipientName && (
                      <span className="font-medium text-[11px]">Handover: {task.recipientName}</span>
                    )}
                  </div>
                )}

                {task.status === "EXCEPTION" && (
                  <div className="p-2.5 bg-red-50 rounded-xl border border-red-200 text-xs text-red-800 space-y-1">
                    <div className="flex items-center gap-1.5 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                      <span>Delivery Failed: [{task.exceptionType}]</span>
                    </div>
                    <p className="text-[11px] text-red-700">{task.exceptionReason}</p>
                  </div>
                )}

                {/* Operational Action Buttons for Active Stops */}
                {(task.status === "ASSIGNED" || task.status === "OUT_FOR_DELIVERY") && (
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#E6E1DA]/60">
                    <button
                      onClick={() => onOpenCompleteModal(task)}
                      className="py-2.5 px-3 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-serif font-medium rounded-xl transition shadow-xs flex items-center justify-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      Delivered
                    </button>
                    <button
                      onClick={() => onOpenExceptionModal(task)}
                      className="py-2.5 px-3 bg-white hover:bg-red-50 text-red-700 border border-red-200 text-xs font-serif rounded-xl transition flex items-center justify-center gap-1.5"
                    >
                      <AlertTriangle className="w-4 h-4" />
                      Report Issue
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Cash Handover Declaration Modal */}
      {isHandoverModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E6E1DA] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <h3 className="font-serif text-lg text-[#1A2E20]">Declare Cash Handover</h3>
              <button onClick={() => setIsHandoverModalOpen(false)} className="text-[#8E9F89] hover:text-[#1A2E20]">
                <X className="w-5 h-5" />
              </button>
            </div>

            {handoverMessage && (
              <div className={`p-3 rounded-xl text-xs ${
                handoverMessage.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
              }`}>
                {handoverMessage.text}
              </div>
            )}

            <form onSubmit={handleDeclareHandover} className="space-y-4">
              <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#E6E1DA] text-xs space-y-1">
                <p>
                  <strong>Current Cash in Custody:</strong> ₹{(custody?.cashInCustody || 0).toLocaleString("en-IN")}
                </p>
                <p className="text-[#8E9F89]">
                  Shift Date: {serviceDate} • Driver: {currentUser.fullName}
                </p>
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">
                  Declared Cash Amount (₹) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  placeholder="e.g. 500"
                  value={declaredCash}
                  onChange={(e) => setDeclaredCash(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">
                  Handover Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Handing over 5 notes of 100"
                  value={handoverNotes}
                  onChange={(e) => setHandoverNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsHandoverModalOpen(false)}
                  className="px-4 py-2 text-xs font-serif text-[#5D7656] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingHandover}
                  className="px-5 py-2 bg-[#1A2E20] text-white text-xs font-serif rounded-xl hover:bg-[#263B2D] transition shadow-xs disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isSubmittingHandover ? "Submitting..." : "Submit Declaration"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
