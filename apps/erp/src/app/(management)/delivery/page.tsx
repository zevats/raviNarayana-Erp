"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Truck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  PlusCircle,
  RotateCcw,
  Check,
  X,
  MapPin,
  Phone,
  IndianRupee,
  ShieldCheck,
  Send,
  HelpCircle,
  Search,
} from "lucide-react";
import {
  AuthenticatedUser,
  DeliveryTask,
  DeliveryStatus,
  MealType,
  PaymentMethod,
  DriverCustodySummary,
  DriverCashHandover,
} from "@/types";
import { SingleScreenDeliveryModal } from "@/modules/delivery/components/modals/SingleScreenDeliveryModal";

export default function DeliveryPage() {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Filters
  const today = new Date().toISOString().slice(0, 10);
  const [serviceDate, setServiceDate] = useState<string>(today);
  const [mealTypeFilter, setMealTypeFilter] = useState<MealType | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Data
  const [tasks, setTasks] = useState<DeliveryTask[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Handover & Custody State
  const [custodySummary, setCustodySummary] = useState<DriverCustodySummary | null>(null);
  const [pendingHandovers, setPendingHandovers] = useState<DriverCashHandover[]>([]);
  const [isDeclareModalOpen, setIsDeclareModalOpen] = useState(false);
  const [declaredCashInput, setDeclaredCashInput] = useState("");
  const [declareNotes, setDeclareNotes] = useState("");
  const [isDeclaring, setIsDeclaring] = useState(false);

  // Delivery Completion Modal State
  const [deliverTargetTask, setDeliverTargetTask] = useState<DeliveryTask | null>(null);

  // Load user
  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) setCurrentUser(data.user);
      })
      .catch(() => {})
      .finally(() => setLoadingUser(false));
  }, []);

  const isDeliveryStaff = currentUser?.role === "DELIVERY_PERSON";
  const isManagerOrOwner = currentUser?.role === "SUPER_ADMIN" || currentUser?.role === "OPERATIONS_MANAGER";

  // Fetch Delivery Tasks
  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        serviceDate,
      });
      if (mealTypeFilter !== "ALL") params.append("mealType", mealTypeFilter);
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (searchQuery.trim()) params.append("search", searchQuery.trim());

      const res = await fetch(`/api/delivery/tasks?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load delivery tasks");
      const data = await res.json();
      if (data.success && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
      }
    } catch (err: any) {
      // Quiet fail on network flutter
    } finally {
      setLoading(false);
    }
  }, [serviceDate, mealTypeFilter, statusFilter, searchQuery]);

  // Fetch Handover & Custody
  const fetchHandoverData = useCallback(async () => {
    if (!currentUser) return;
    try {
      // For Delivery Boy: his own summary.
      // For Manager/Owner: aggregate summary (no driverId, so no 400 error!)
      const summaryUrl = isDeliveryStaff
        ? `/api/delivery/handover?summary=true&driverId=${currentUser.id}&shiftDate=${serviceDate}`
        : `/api/delivery/handover?summary=true&shiftDate=${serviceDate}`;

      const res = await fetch(summaryUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.summary) setCustodySummary(data.summary);
      }

      // Fetch pending declarations for review
      if (isManagerOrOwner) {
        const hRes = await fetch(`/api/delivery/handover?shiftDate=${serviceDate}&status=DECLARED`);
        if (hRes.ok) {
          const hData = await hRes.json();
          if (Array.isArray(hData.handovers)) setPendingHandovers(hData.handovers);
        }
      }
    } catch {
      // Ignore
    }
  }, [currentUser, isDeliveryStaff, isManagerOrOwner, serviceDate]);

  // Combined refresh
  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchTasks(), fetchHandoverData()]);
    setLoading(false);
  }, [fetchTasks, fetchHandoverData]);

  // Initial load
  useEffect(() => {
    if (currentUser) {
      refreshAll();
    }
  }, [currentUser, refreshAll]);

  // Live polling every 4s without manual refresh
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchTasks();
        fetchHandoverData();
      }
    }, 4000);

    const onFocus = () => {
      fetchTasks();
      fetchHandoverData();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("erp:order_created", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("erp:order_created", onFocus);
    };
  }, [fetchTasks, fetchHandoverData]);

  // Compact real counts
  const counts = useMemo(() => {
    const pending = tasks.filter((t) => t.status === "PENDING" || t.status === "ASSIGNED").length;
    const outForDelivery = tasks.filter((t) => t.status === "OUT_FOR_DELIVERY").length;
    const completed = tasks.filter((t) => t.status === "DELIVERED").length;
    return { pending, outForDelivery, completed };
  }, [tasks]);

  // Handlers
  const handleDispatchSingle = async (taskId: string) => {
    try {
      const res = await fetch(`/api/delivery/tasks/${taskId}/dispatch`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to start delivery");
      }
      setActionSuccess("Order marked Out for Delivery.");
      refreshAll();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      setActionError(err.message || "Failed to start delivery");
    }
  };

  const handleDeclareCashHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const amount = parseInt(declaredCashInput, 10);
    if (isNaN(amount) || amount <= 0) {
      setActionError("Please enter a valid cash amount to declare.");
      return;
    }
    setIsDeclaring(true);
    try {
      const res = await fetch("/api/delivery/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: currentUser.id,
          shiftDate: serviceDate,
          declaredCash: amount,
          notes: declareNotes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit cash declaration");
      setActionSuccess(`₹${amount} cash declared. Please hand physical cash to the manager.`);
      setIsDeclareModalOpen(false);
      setDeclaredCashInput("");
      setDeclareNotes("");
      refreshAll();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to declare handover.");
    } finally {
      setIsDeclaring(false);
    }
  };

  const handleAcceptHandover = async (handoverId: string, declaredCash: number) => {
    try {
      const res = await fetch(`/api/delivery/handover/${handoverId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acceptedCash: declaredCash,
          notes: "Physically verified and accepted by manager",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to accept cash handover");
      setActionSuccess(`Accepted ₹${declaredCash} cash handover. Cashbook ledger updated.`);
      refreshAll();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to accept handover.");
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E6E1DA] pb-5">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-[#8E9F89] block">
            {isDeliveryStaff ? "Delivery Run Execution" : "Delivery Oversight & Handover"}
          </span>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl sm:text-3xl text-[#1A2E20] font-bold">Delivery</h1>
            {/* Real counts */}
            <div className="flex items-center gap-1.5 text-xs font-mono">
              <span className="px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                Pending: <strong>{counts.pending}</strong>
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                In Transit: <strong>{counts.outForDelivery}</strong>
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                Completed: <strong>{counts.completed}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-2">
          {/* If delivery staff, show quick cash declaration button */}
          {isDeliveryStaff && (
            <button
              onClick={() => setIsDeclareModalOpen(true)}
              className="px-4 py-2.5 bg-[#1A2E20] hover:bg-[#263B2D] text-white font-serif font-medium text-xs rounded-2xl shadow-xs transition flex items-center gap-1.5"
            >
              <IndianRupee className="w-4 h-4 text-[#C89F6B]" />
              Declare Cash Handover
            </button>
          )}

          <button
            onClick={refreshAll}
            disabled={loading}
            className="p-2.5 text-[#5D7656] hover:text-[#1A2E20] bg-white border border-[#E6E1DA] rounded-2xl shadow-2xs transition"
            title="Refresh Deliveries"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Messages */}
      {actionError && (
        <div className="p-3.5 bg-red-50 border border-red-200 text-red-800 text-xs rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-red-600 hover:text-red-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {actionSuccess && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-600 hover:text-emerald-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* CASH CUSTODY / HANDOVER SUMMARY STRIP */}
      {custodySummary && (
        <div className="p-4 bg-white rounded-3xl border border-[#E6E1DA] shadow-2xs flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#1A2E20] text-[#C89F6B] flex items-center justify-center shrink-0">
              <IndianRupee className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#8E9F89] block">
                {isDeliveryStaff ? "My Cash Custody" : "Fleet Cash Custody Summary"}
              </span>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="font-serif text-lg font-bold text-[#1A2E20]">
                  ₹{custodySummary.cashInCustody} in Custody
                </span>
                <span className="text-xs text-[#8E9F89] font-mono">
                  (Total Collected: ₹{custodySummary.totalCashCollected} • Settled: ₹{custodySummary.totalAcceptedHandover})
                </span>
              </div>
            </div>
          </div>

          {/* Pending Review for Managers */}
          {isManagerOrOwner && pendingHandovers.length > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 p-2.5 rounded-2xl border border-amber-200 text-xs w-full md:w-auto">
              <span className="font-serif font-bold text-amber-900">
                {pendingHandovers.length} Pending Handover(s):
              </span>
              {pendingHandovers.map((h) => (
                <button
                  key={h.id}
                  onClick={() => handleAcceptHandover(h.id, h.declaredCash)}
                  className="px-3 py-1 bg-amber-800 hover:bg-amber-900 text-white rounded-xl text-xs font-serif font-medium transition shadow-xs flex items-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Accept ₹{h.declaredCash} ({h.driverName})
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FILTER BAR */}
      <div className="bg-white p-3.5 rounded-2xl border border-[#E6E1DA] shadow-2xs flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#8E9F89]" />
          <input
            type="text"
            placeholder="Search stops by customer, room, or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto shrink-0 flex-wrap">
          <input
            type="date"
            value={serviceDate}
            onChange={(e) => setServiceDate(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
          />

          <select
            value={mealTypeFilter}
            onChange={(e) => setMealTypeFilter(e.target.value as any)}
            className="px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
          >
            <option value="ALL">All Meals</option>
            <option value="BREAKFAST">Breakfast</option>
            <option value="LUNCH">Lunch</option>
            <option value="DINNER">Dinner</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-2.5 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
          >
            <option value="ALL">All Statuses</option>
            <option value="ASSIGNED">Assigned (Ready)</option>
            <option value="OUT_FOR_DELIVERY">In Transit</option>
            <option value="DELIVERED">Delivered</option>
            <option value="EXCEPTION">Issues / Shortfalls</option>
          </select>
        </div>
      </div>

      {/* DELIVERIES LIST */}
      {loading ? (
        <div className="p-12 text-center text-xs font-serif text-[#8E9F89]">
          Loading delivery queue...
        </div>
      ) : tasks.length === 0 ? (
        <div className="p-12 bg-white rounded-3xl border border-[#E6E1DA] text-center space-y-3">
          <Truck className="w-10 h-10 text-[#C89F6B] mx-auto opacity-40" />
          <h3 className="font-serif text-lg text-[#1A2E20]">No Deliveries Scheduled</h3>
          <p className="text-xs text-[#8E9F89] max-w-sm mx-auto">
            All orders confirmed on the Orders page automatically appear here and are assigned to the default delivery staff.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task, idx) => {
            const isExternal = task.orderType === "EXTERNAL";
            const displayName = isExternal
              ? task.customerName || "City Customer"
              : `Room ${task.roomNumber} (${task.residentName})`;

            return (
              <div
                key={task.id}
                className="bg-white rounded-2xl border border-[#E6E1DA] p-4 sm:p-5 shadow-2xs hover:border-[#DCD6CD] transition space-y-3"
              >
                {/* Header: Stop Info, Badge & Status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#1A2E20] text-white flex flex-col items-center justify-center shrink-0 border border-[#263B2D]">
                      <span className="text-[9px] font-mono text-[#C89F6B] font-bold">#{idx + 1}</span>
                      <span className="text-[9px] font-mono uppercase text-white/70">
                        {isExternal ? "EXT" : "PG"}
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono uppercase px-2 py-0.2 rounded bg-[#1A2E20]/5 text-[#1A2E20] border border-[#1A2E20]/15">
                          {task.mealType}
                        </span>
                        {task.assignedToName && (
                          <span className="text-[10px] font-mono text-[#5D7656]">
                            Assigned: <strong>{task.assignedToName}</strong>
                          </span>
                        )}
                      </div>

                      <h3 className="font-serif text-base text-[#1A2E20] font-semibold mt-0.5">
                        {displayName}
                      </h3>

                      {task.customerPhone && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-[#8E9F89] font-mono">{task.customerPhone}</span>
                          <a
                            href={`tel:${task.customerPhone}`}
                            className="inline-flex items-center gap-1 text-[11px] font-serif text-[#1A2E20] bg-[#FAF8F5] px-2 py-0.5 rounded border border-[#DCD6CD] hover:bg-[#E6E1DA] transition"
                          >
                            <Phone className="w-3 h-3 text-[#B58A57]" /> Call
                          </a>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="text-right space-y-1">
                    {task.status === "ASSIGNED" && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-blue-50 text-blue-800 border border-blue-200 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Ready for Run
                      </span>
                    )}
                    {task.status === "OUT_FOR_DELIVERY" && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-indigo-50 text-indigo-800 border border-indigo-200 inline-flex items-center gap-1">
                        <Truck className="w-3 h-3 animate-pulse" /> Out for Delivery
                      </span>
                    )}
                    {task.status === "DELIVERED" && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Delivered
                      </span>
                    )}
                    {task.status === "EXCEPTION" && (
                      <span className="px-2.5 py-1 rounded-full text-[11px] font-serif bg-red-50 text-red-800 border border-red-200 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Shortfall / Exception
                      </span>
                    )}

                    {(task.collectedAmount || 0) > 0 && (
                      <span className="block text-[10px] font-mono text-emerald-800">
                        Collected: ₹{task.collectedAmount} ({task.collectedPaymentMethod})
                      </span>
                    )}
                  </div>
                </div>

                {/* Delivery Address */}
                {task.deliveryAddress && (
                  <div className="p-2.5 bg-[#FAF8F5] rounded-xl border border-[#E6E1DA] text-xs flex items-start gap-2">
                    <MapPin className="w-3.5 h-3.5 text-[#B58A57] shrink-0 mt-0.5" />
                    <span className="text-[#1A2E20] font-medium">{task.deliveryAddress}</span>
                  </div>
                )}

                {/* Ordered Items Breakdown */}
                {task.items && task.items.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {task.items.map((it, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 bg-[#FAF8F5] border border-[#E6E1DA] rounded-lg text-[11px] font-mono text-[#1A2E20]"
                      >
                        {it.quantity}x {it.productName}
                      </span>
                    ))}
                  </div>
                )}

                {/* Notes & Instructions */}
                {task.deliveryNotes && (
                  <p className="text-xs text-[#5D7656] italic">
                    Note: {task.deliveryNotes}
                  </p>
                )}

                {/* ACTION BUTTONS (FOR ACTIVE TASKS) */}
                {(task.status === "ASSIGNED" || task.status === "OUT_FOR_DELIVERY") && (
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6E1DA]/60">
                    {/* Single-Screen Delivery Completion Modal Trigger */}
                    <button
                      onClick={() => setDeliverTargetTask(task)}
                      className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-serif font-medium rounded-xl transition shadow-xs inline-flex items-center gap-1.5"
                    >
                      <Check className="w-4 h-4" />
                      Mark Delivered
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* SINGLE-SCREEN DELIVERY MODAL */}
      <SingleScreenDeliveryModal
        task={deliverTargetTask}
        isOpen={Boolean(deliverTargetTask)}
        onClose={() => setDeliverTargetTask(null)}
        onSuccess={() => {
          setActionSuccess("Delivery confirmed and reconciled successfully.");
          refreshAll();
          setTimeout(() => setActionSuccess(null), 3000);
        }}
        currentUserId={currentUser?.id}
      />

      {/* DECLARE CASH HANDOVER MODAL (FOR DELIVERY BOY) */}
      {isDeclareModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 space-y-4 border border-[#E6E1DA] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <h3 className="font-serif text-lg text-[#1A2E20] font-bold">Declare Cash Handover</h3>
              <button onClick={() => setIsDeclareModalOpen(false)} className="text-[#8E9F89] hover:text-[#1A2E20]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleDeclareCashHandover} className="space-y-4 text-xs">
              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900">
                Current unhanded cash in custody: <strong>₹{custodySummary?.cashInCustody || 0}</strong>
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">
                  Cash Amount to Hand Over (₹) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="1"
                  placeholder="e.g. 500"
                  value={declaredCashInput}
                  onChange={(e) => setDeclaredCashInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono font-bold bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
                />
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">
                  Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Shift 1 lunch collection"
                  value={declareNotes}
                  onChange={(e) => setDeclareNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsDeclareModalOpen(false)}
                  className="px-4 py-2 text-xs font-serif text-[#5D7656]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeclaring}
                  className="px-5 py-2 bg-[#1A2E20] text-white text-xs font-serif rounded-xl hover:bg-[#263B2D] transition disabled:opacity-50"
                >
                  {isDeclaring ? "Submitting..." : "Declare Handover"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
