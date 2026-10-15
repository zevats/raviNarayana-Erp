"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Truck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  User,
  MapPin,
  RefreshCw,
  PlusCircle,
  RotateCcw,
  UserCheck,
  Check,
  ChevronDown,
  Info,
  X,
  Phone,
  Layers,
} from "lucide-react";
import {
  AuthenticatedUser,
  DeliveryTask,
  DeliveryStatus,
  DeliveryExceptionType,
  DeliveryDashboardSummary,
  MealType,
} from "@/types";

export default function DeliveryPage() {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Filters
  const today = new Date().toISOString().slice(0, 10);
  const [serviceDate, setServiceDate] = useState<string>(today);
  const [mealTypeFilter, setMealTypeFilter] = useState<MealType | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | "ALL">("ALL");
  const [orderTypeFilter, setOrderTypeFilter] = useState<"ALL" | "RESIDENT" | "EXTERNAL">("ALL");

  // City / External Order Modal State
  const [isExternalModalOpen, setIsExternalModalOpen] = useState(false);
  const [extCustomerName, setExtCustomerName] = useState("");
  const [extCustomerPhone, setExtCustomerPhone] = useState("");
  const [extDeliveryAddress, setExtDeliveryAddress] = useState("");
  const [extMealType, setExtMealType] = useState<MealType>("LUNCH");
  const [extNotes, setExtNotes] = useState("");
  const [isSubmittingExt, setIsSubmittingExt] = useState(false);

  // Data
  const [tasks, setTasks] = useState<DeliveryTask[]>([]);
  const [summary, setSummary] = useState<DeliveryDashboardSummary | null>(null);
  const [deliveryStaff, setDeliveryStaff] = useState<Array<{ id: string; fullName: string; username: string }>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modals
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [generateMealType, setGenerateMealType] = useState<MealType>("BREAKFAST");
  const [isGenerating, setIsGenerating] = useState(false);

  const [assignTargetTask, setAssignTargetTask] = useState<DeliveryTask | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [isAssigning, setIsAssigning] = useState(false);

  const [exceptionTargetTask, setExceptionTargetTask] = useState<DeliveryTask | null>(null);
  const [exceptionType, setExceptionType] = useState<DeliveryExceptionType>("RESIDENT_UNAVAILABLE");
  const [exceptionReason, setExceptionReason] = useState<string>("");
  const [isReportingException, setIsReportingException] = useState(false);

  const [deliverTargetTask, setDeliverTargetTask] = useState<DeliveryTask | null>(null);
  const [recipientName, setRecipientName] = useState<string>("");
  const [deliveryNotes, setDeliveryNotes] = useState<string>("");
  const [isDelivering, setIsDelivering] = useState(false);

  const [retryTargetTask, setRetryTargetTask] = useState<DeliveryTask | null>(null);
  const [retryReassignStaffId, setRetryReassignStaffId] = useState<string>("");
  const [retryNotes, setRetryNotes] = useState<string>("");
  const [isRetrying, setIsRetrying] = useState(false);

  // 1. Load Current User Session
  useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          setCurrentUser(data.user);
        }
      } catch (err) {
        console.error("Failed to load user:", err);
      } finally {
        setLoadingUser(false);
      }
    }
    loadUser();
  }, []);

  // 2. Fetch Tasks, Summary & Staff
  const fetchData = useCallback(async () => {
    setLoading(true);
    setActionError(null);

    try {
      // Build task query
      const params = new URLSearchParams();
      if (serviceDate) params.append("serviceDate", serviceDate);
      if (mealTypeFilter !== "ALL") params.append("mealType", mealTypeFilter);
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (orderTypeFilter !== "ALL") params.append("orderType", orderTypeFilter);

      const tasksPromise = fetch(`/api/delivery/tasks?${params.toString()}`).then((r) => r.json());

      // If manager or super admin, fetch summary and active staff
      const isManager = currentUser?.role === "SUPER_ADMIN" || currentUser?.role === "OPERATIONS_MANAGER";

      const summaryPromise = isManager
        ? fetch(`/api/delivery/summary?serviceDate=${serviceDate}&mealType=${mealTypeFilter}`).then((r) => r.json())
        : Promise.resolve({ success: true, summary: null });

      const staffPromise = isManager
        ? fetch("/api/delivery/staff").then((r) => r.json())
        : Promise.resolve({ success: true, staff: [] });

      const [tasksRes, summaryRes, staffRes] = await Promise.all([
        tasksPromise,
        summaryPromise,
        staffPromise,
      ]);

      if (tasksRes.success) setTasks(tasksRes.tasks);
      else throw new Error(tasksRes.error || "Failed to load tasks");

      if (summaryRes.success && summaryRes.summary) setSummary(summaryRes.summary);
      if (staffRes.success && staffRes.staff) setDeliveryStaff(staffRes.staff);
    } catch (err: any) {
      setActionError(err.message || "Failed to load delivery data.");
    } finally {
      setLoading(false);
    }
  }, [serviceDate, mealTypeFilter, statusFilter, orderTypeFilter, currentUser]);

  useEffect(() => {
    if (currentUser) {
      fetchData();
    }
  }, [currentUser, fetchData]);

  // Handle Generate Tasks
  const handleGenerateTasks = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGenerating(true);
    setActionError(null);

    try {
      const res = await fetch("/api/delivery/tasks/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceDate,
          mealType: generateMealType,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate tasks.");

      setActionSuccess(
        `Generated ${data.createdCount} delivery task(s) for ${data.mealType} on ${data.serviceDate}. (${data.alreadyExistedCount} already existed, ${data.skippedCount} opted-out).`
      );
      setIsGenerateModalOpen(false);
      await fetchData();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (err: any) {
      setActionError(err.message || "Failed to generate delivery tasks.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle Create City / External Order
  const handleCreateExternalTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingExt(true);
    setActionError(null);
    try {
      const res = await fetch("/api/delivery/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceDate,
          mealType: extMealType,
          customerName: extCustomerName.trim(),
          customerPhone: extCustomerPhone.trim(),
          deliveryAddress: extDeliveryAddress.trim(),
          notes: extNotes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create city order.");

      setActionSuccess(`City tiffin order for ${extCustomerName} created successfully.`);
      setIsExternalModalOpen(false);
      setExtCustomerName("");
      setExtCustomerPhone("");
      setExtDeliveryAddress("");
      setExtNotes("");
      await fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to create city order.");
    } finally {
      setIsSubmittingExt(false);
    }
  };

  // Handle Assign Task
  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTargetTask || !selectedStaffId) return;

    setIsAssigning(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/delivery/tasks/${assignTargetTask.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedToStaffId: selectedStaffId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign task.");

      setActionSuccess(`Task for Room ${assignTargetTask.roomNumber} assigned to ${data.task.assignedToName}.`);
      setAssignTargetTask(null);
      setSelectedStaffId("");
      await fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to assign delivery task.");
    } finally {
      setIsAssigning(false);
    }
  };

  // Handle Dispatch (Start Delivery)
  const handleDispatchTask = async (taskId: string, roomNumber: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/delivery/tasks/${taskId}/dispatch`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to dispatch task.");

      setActionSuccess(`Room ${roomNumber} marked OUT FOR DELIVERY.`);
      await fetchData();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: any) {
      setActionError(err.message || "Failed to start delivery.");
    }
  };

  // Handle Complete Delivery
  const handleCompleteDelivery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deliverTargetTask) return;

    setIsDelivering(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/delivery/tasks/${deliverTargetTask.id}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientName: recipientName.trim() || undefined,
          notes: deliveryNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to complete delivery.");

      setActionSuccess(`Room ${deliverTargetTask.roomNumber} delivery recorded successfully.`);
      setDeliverTargetTask(null);
      setRecipientName("");
      setDeliveryNotes("");
      await fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to complete delivery.");
    } finally {
      setIsDelivering(false);
    }
  };

  // Handle Report Exception
  const handleReportException = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exceptionTargetTask) return;

    setIsReportingException(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/delivery/tasks/${exceptionTargetTask.id}/exception`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exceptionType,
          reason: exceptionReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to report exception.");

      setActionSuccess(`Exception recorded for Room ${exceptionTargetTask.roomNumber}.`);
      setExceptionTargetTask(null);
      setExceptionReason("");
      await fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to report exception.");
    } finally {
      setIsReportingException(false);
    }
  };

  // Handle Retry Exception Task
  const handleRetryTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!retryTargetTask) return;

    setIsRetrying(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/delivery/tasks/${retryTargetTask.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reassignToStaffId: retryReassignStaffId || undefined,
          notes: retryNotes.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to retry task.");

      setActionSuccess(`Room ${retryTargetTask.roomNumber} task reset to ASSIGNED for redelivery.`);
      setRetryTargetTask(null);
      setRetryReassignStaffId("");
      setRetryNotes("");
      await fetchData();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (err: any) {
      setActionError(err.message || "Failed to retry delivery task.");
    } finally {
      setIsRetrying(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3 text-[#1A2E20]">
          <RefreshCw className="w-5 h-5 animate-spin text-[#B58A57]" />
          <span className="font-serif text-sm">Authenticating delivery portal...</span>
        </div>
      </div>
    );
  }

  const isDeliveryStaff = currentUser?.role === "DELIVERY_PERSON";
  const isManager = currentUser?.role === "SUPER_ADMIN" || currentUser?.role === "OPERATIONS_MANAGER";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* ============================================================== */}
      {/* 1. PORTAL HEADER                                              */}
      {/* ============================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E6E1DA] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest bg-[#1A2E20]/10 text-[#1A2E20] rounded border border-[#1A2E20]/20">
              Phase 6 Operational Module
            </span>
            <span className="text-xs text-[#8E9F89] font-serif">• Tiffin Service</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif text-[#1A2E20] mt-1 font-normal tracking-tight">
            {isDeliveryStaff ? "Delivery Workstation" : "Tiffin Delivery & Handover"}
          </h1>
          <p className="text-xs sm:text-sm text-[#5D7656] mt-0.5">
            {isDeliveryStaff
              ? "View your assigned meal deliveries, track handover status, and record proof of delivery."
              : "Generate delivery tasks, assign delivery staff, monitor room handovers, and manage exceptions."}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {isManager && (
            <>
              <button
                onClick={() => setIsGenerateModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#1A2E20] text-white rounded-xl text-xs font-serif tracking-wide hover:bg-[#263B2D] transition shadow-xs"
              >
                <PlusCircle className="w-4 h-4 text-[#C89F6B]" />
                Generate Tasks
              </button>

              <button
                onClick={() => setIsExternalModalOpen(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#FAF8F5] text-[#1A2E20] rounded-xl text-xs font-serif border border-[#B58A57] hover:bg-[#FAF8F5]/80 transition shadow-2xs"
              >
                <PlusCircle className="w-4 h-4 text-[#B58A57]" />
                New City Order
              </button>
            </>
          )}

          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white text-[#1A2E20] rounded-xl text-xs font-serif border border-[#DCD6CD] hover:bg-[#FAF8F5] transition shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#B58A57] ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ============================================================== */}
      {/* 2. ADMINISTRATIVE SUMMARY METRICS (If Manager)                */}
      {/* ============================================================== */}
      {isManager && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <div className="bg-white p-4 rounded-2xl border border-[#E6E1DA] shadow-2xs">
            <span className="text-[10px] uppercase font-mono tracking-wider text-[#8E9F89]">Total Tasks</span>
            <p className="text-2xl font-serif text-[#1A2E20] mt-1">{summary.totalTasks}</p>
            <span className="text-[10px] text-[#5D7656]">For {summary.serviceDate}</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-[#E6E1DA] shadow-2xs">
            <span className="text-[10px] uppercase font-mono tracking-wider text-amber-700">Unassigned</span>
            <p className="text-2xl font-serif text-amber-800 mt-1">{summary.unassignedCount}</p>
            <span className="text-[10px] text-amber-600">Pending staff allocation</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-[#E6E1DA] shadow-2xs">
            <span className="text-[10px] uppercase font-mono tracking-wider text-blue-700">Assigned</span>
            <p className="text-2xl font-serif text-blue-800 mt-1">{summary.assignedCount}</p>
            <span className="text-[10px] text-blue-600">Allocated to delivery</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-[#E6E1DA] shadow-2xs">
            <span className="text-[10px] uppercase font-mono tracking-wider text-indigo-700">In Transit</span>
            <p className="text-2xl font-serif text-indigo-800 mt-1">{summary.outForDeliveryCount}</p>
            <span className="text-[10px] text-indigo-600">Out for delivery</span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-emerald-100 shadow-2xs bg-emerald-50/20">
            <span className="text-[10px] uppercase font-mono tracking-wider text-emerald-800">Delivered</span>
            <p className="text-2xl font-serif text-emerald-900 mt-1">{summary.deliveredCount}</p>
            <span className="text-[10px] text-emerald-700">
              {summary.totalTasks > 0 ? `${Math.round((summary.deliveredCount / summary.totalTasks) * 100)}% complete` : "0% complete"}
            </span>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-red-100 shadow-2xs bg-red-50/20">
            <span className="text-[10px] uppercase font-mono tracking-wider text-red-800">Exceptions</span>
            <p className="text-2xl font-serif text-red-900 mt-1">{summary.exceptionCount}</p>
            <span className="text-[10px] text-red-700">Action required</span>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. FILTER BAR                                                  */}
      {/* ============================================================== */}
      <div className="bg-white p-4 rounded-2xl border border-[#E6E1DA] shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Picker */}
          <div>
            <label className="block text-[10px] uppercase font-mono text-[#8E9F89] mb-1">Service Date</label>
            <input
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              className="px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-lg text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
            />
          </div>

          {/* Meal Filter */}
          <div>
            <label className="block text-[10px] uppercase font-mono text-[#8E9F89] mb-1">Meal</label>
            <select
              value={mealTypeFilter}
              onChange={(e) => setMealTypeFilter(e.target.value as any)}
              className="px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-lg text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
            >
              <option value="ALL">All Meals</option>
              <option value="BREAKFAST">Breakfast</option>
              <option value="LUNCH">Lunch</option>
              <option value="DINNER">Dinner</option>
            </select>
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-[10px] uppercase font-mono text-[#8E9F89] mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-lg text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending (Unassigned)</option>
              <option value="ASSIGNED">Assigned</option>
              <option value="OUT_FOR_DELIVERY">Out for Delivery</option>
              <option value="DELIVERED">Delivered</option>
              <option value="EXCEPTION">Exception</option>
            </select>
          </div>

          {/* Order Type Filter */}
          <div>
            <label className="block text-[10px] uppercase font-mono text-[#8E9F89] mb-1">Destination</label>
            <select
              value={orderTypeFilter}
              onChange={(e) => setOrderTypeFilter(e.target.value as any)}
              className="px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-lg text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
            >
              <option value="ALL">All Destinations</option>
              <option value="RESIDENT">PG Residents</option>
              <option value="EXTERNAL">City Customers</option>
            </select>
          </div>
        </div>

        <div className="text-xs text-[#8E9F89] font-mono">
          Showing {tasks.length} task{tasks.length === 1 ? "" : "s"}
        </div>
      </div>

      {/* ============================================================== */}
      {/* 4. WORKLOAD SUMMARY (If Manager)                              */}
      {/* ============================================================== */}
      {isManager && summary && summary.staffWorkload.length > 0 && (
        <div className="bg-white p-5 rounded-2xl border border-[#E6E1DA] shadow-2xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-serif text-[#1A2E20] font-normal tracking-wide flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#B58A57]" />
              Delivery Staff Workload Overview ({summary.serviceDate})
            </h2>
            <span className="text-[10px] font-mono text-[#8E9F89] uppercase">
              {summary.staffWorkload.length} Active Personnel
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.staffWorkload.map((staff) => (
              <div
                key={staff.staffId}
                className="p-3.5 rounded-xl border border-[#E6E1DA] bg-[#FAF8F5] flex items-center justify-between text-xs"
              >
                <div>
                  <p className="font-serif text-sm text-[#1A2E20]">{staff.staffName}</p>
                  <p className="text-[10px] text-[#8E9F89] font-mono mt-0.5">
                    {staff.assignedCount} assigned • {staff.pendingCount} pending
                  </p>
                </div>
                <div className="text-right">
                  <span className="inline-block px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-100 text-emerald-800">
                    {staff.deliveredCount} delivered
                  </span>
                  {staff.exceptionCount > 0 && (
                    <span className="block mt-1 text-[10px] font-mono text-red-700">
                      {staff.exceptionCount} exception{staff.exceptionCount > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 5. DELIVERY TASKS (Workstation View or Management Table)      */}
      {/* ============================================================== */}
      {loading ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#E6E1DA]">
          <RefreshCw className="w-6 h-6 animate-spin text-[#B58A57] mx-auto mb-2" />
          <p className="text-xs text-[#5D7656] font-serif">Loading delivery records...</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#E6E1DA] space-y-3">
          <Truck className="w-8 h-8 text-[#8E9F89] mx-auto opacity-50" />
          <h3 className="font-serif text-base text-[#1A2E20]">No Delivery Tasks Found</h3>
          <p className="text-xs text-[#5D7656] max-w-md mx-auto">
            {isDeliveryStaff
              ? "You do not have any assigned deliveries for the selected date and filters."
              : "No delivery tasks exist for this date. Generate tasks from confirmed kitchen meal plans above."}
          </p>
          {isManager && (
            <button
              onClick={() => setIsGenerateModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1A2E20] text-white text-xs font-serif rounded-lg hover:bg-[#263B2D] transition shadow-xs"
            >
              <PlusCircle className="w-3.5 h-3.5 text-[#C89F6B]" />
              Generate Tasks Now
            </button>
          )}
        </div>
      ) : (
        /* Task Cards / Workstation List */
        <div className="space-y-3">
          {tasks.map((task) => {
            const isAssignedToMe = task.assignedTo === currentUser?.id;
            const canAction = isManager || isAssignedToMe;

            return (
              <div
                key={task.id}
                className="bg-white rounded-2xl border border-[#E6E1DA] p-4 sm:p-5 shadow-2xs hover:border-[#DCD6CD] transition flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
              >
                {/* Left: Destination, Resident/Customer & Meal info */}
                <div className="flex items-start gap-4">
                  {task.orderType === "EXTERNAL" ? (
                    <div className="w-14 h-14 rounded-xl bg-[#263B2D] text-white flex flex-col items-center justify-center shrink-0 border border-[#3E4E42]">
                      <MapPin className="w-4 h-4 text-[#C89F6B]" />
                      <span className="text-[10px] uppercase font-mono tracking-wider text-[#C89F6B] font-bold">CITY</span>
                    </div>
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-[#1A2E20] text-white flex flex-col items-center justify-center shrink-0 border border-[#263B2D]">
                      <span className="text-[10px] uppercase font-mono tracking-wider text-[#C89F6B]">Room</span>
                      <span className="text-lg font-serif font-bold leading-tight">{task.roomNumber}</span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-serif text-base text-[#1A2E20] font-medium">
                        {task.orderType === "EXTERNAL" ? (task.customerName || "City Customer") : task.residentName}
                      </h4>
                      {task.orderType === "EXTERNAL" ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 uppercase font-semibold">
                          City Order
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#FAF8F5] text-[#5D7656] border border-[#E6E1DA]">
                          Floor {task.floor}
                        </span>
                      )}
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1A2E20]/5 text-[#1A2E20] uppercase border border-[#1A2E20]/15">
                        {task.mealType}
                      </span>
                    </div>

                    {task.orderType === "EXTERNAL" && (
                      <p className="text-xs text-[#5A6C5E] flex flex-wrap items-center gap-2 font-medium">
                        <span className="flex items-center gap-1 text-[#1A2E20]">
                          <MapPin className="w-3 h-3 text-[#B58A57]" />
                          {task.deliveryAddress}
                        </span>
                        {task.customerPhone && (
                          <span className="flex items-center gap-1 text-[#8E9F89]">
                            <Phone className="w-3 h-3 text-[#B58A57]" />
                            {task.customerPhone}
                          </span>
                        )}
                      </p>
                    )}

                    <p className="text-xs text-[#8E9F89] flex items-center gap-2">
                      <span>Service Date: {task.serviceDate}</span>
                      <span>•</span>
                      <span>
                        Assigned To:{" "}
                        <strong className="text-[#1A2E20] font-normal">
                          {task.assignedToName || "Unassigned"}
                        </strong>
                      </span>
                    </p>

                    {/* Delivery Notes or Exception Details */}
                    {task.status === "DELIVERED" && (
                      <p className="text-xs text-emerald-700 flex items-center gap-1.5 pt-0.5">
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        Delivered at {new Date(task.deliveredAt!).toLocaleTimeString()}
                        {task.recipientName && ` (Handover: ${task.recipientName})`}
                      </p>
                    )}

                    {task.status === "EXCEPTION" && (
                      <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs mt-1">
                        <strong>Issue [{task.exceptionType}]:</strong> {task.exceptionReason}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Status Badge & Operational Actions */}
                <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 pt-3 lg:pt-0 border-t lg:border-t-0 border-[#E6E1DA]/60">
                  {/* Status Badge */}
                  <div>
                    {task.status === "PENDING" && (
                      <span className="px-3 py-1 rounded-full text-xs font-serif bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" /> Pending Assignment
                      </span>
                    )}
                    {task.status === "ASSIGNED" && (
                      <span className="px-3 py-1 rounded-full text-xs font-serif bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5" /> Assigned
                      </span>
                    )}
                    {task.status === "OUT_FOR_DELIVERY" && (
                      <span className="px-3 py-1 rounded-full text-xs font-serif bg-indigo-50 text-indigo-800 border border-indigo-200 flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5 animate-pulse" /> Out for Delivery
                      </span>
                    )}
                    {task.status === "DELIVERED" && (
                      <span className="px-3 py-1 rounded-full text-xs font-serif bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Delivered
                      </span>
                    )}
                    {task.status === "EXCEPTION" && (
                      <span className="px-3 py-1 rounded-full text-xs font-serif bg-red-50 text-red-800 border border-red-200 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" /> Exception
                      </span>
                    )}
                  </div>

                  {/* Contextual Action Buttons */}
                  <div className="flex items-center gap-2">
                    {/* Delivery Person / Dispatcher Actions */}
                    {task.status === "ASSIGNED" && canAction && (
                      <button
                        onClick={() => handleDispatchTask(task.id, task.roomNumber || task.customerName || "Order")}
                        className="px-3 py-1.5 bg-[#1A2E20] text-white text-xs font-serif rounded-lg hover:bg-[#263B2D] transition shadow-xs"
                      >
                        Start Delivery
                      </button>
                    )}

                    {task.status === "OUT_FOR_DELIVERY" && canAction && (
                      <button
                        onClick={() => {
                          setDeliverTargetTask(task);
                          setRecipientName("");
                          setDeliveryNotes("");
                        }}
                        className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-serif rounded-lg hover:bg-emerald-800 transition shadow-xs flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Mark Delivered
                      </button>
                    )}

                    {(task.status === "ASSIGNED" || task.status === "OUT_FOR_DELIVERY") && canAction && (
                      <button
                        onClick={() => {
                          setExceptionTargetTask(task);
                          setExceptionType("RESIDENT_UNAVAILABLE");
                          setExceptionReason("");
                        }}
                        className="px-2.5 py-1.5 bg-white text-red-700 border border-red-200 text-xs font-serif rounded-lg hover:bg-red-50 transition"
                      >
                        Report Issue
                      </button>
                    )}

                    {/* Manager Assignment / Reassignment */}
                    {isManager && task.status !== "DELIVERED" && (
                      <button
                        onClick={() => {
                          setAssignTargetTask(task);
                          setSelectedStaffId(task.assignedTo || "");
                        }}
                        className="px-2.5 py-1.5 bg-white text-[#1A2E20] border border-[#DCD6CD] text-xs font-serif rounded-lg hover:bg-[#FAF8F5] transition"
                      >
                        {task.assignedTo ? "Reassign" : "Assign Staff"}
                      </button>
                    )}

                    {/* Manager Retry on Exception */}
                    {isManager && task.status === "EXCEPTION" && (
                      <button
                        onClick={() => {
                          setRetryTargetTask(task);
                          setRetryReassignStaffId(task.assignedTo || "");
                          setRetryNotes("");
                        }}
                        className="px-3 py-1.5 bg-[#B58A57] text-white text-xs font-serif rounded-lg hover:bg-[#9E7443] transition shadow-xs flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Retry Delivery
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================================== */}
      {/* 6. MODALS                                                      */}
      {/* ============================================================== */}

      {/* Generate Tasks Modal */}
      {isGenerateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E6E1DA] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <h3 className="font-serif text-lg text-[#1A2E20]">Generate Delivery Tasks</h3>
              <button onClick={() => setIsGenerateModalOpen(false)} className="text-[#8E9F89] hover:text-[#1A2E20]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleGenerateTasks} className="space-y-4">
              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Service Date</label>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Meal Service</label>
                <select
                  value={generateMealType}
                  onChange={(e) => setGenerateMealType(e.target.value as MealType)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                >
                  <option value="BREAKFAST">Breakfast</option>
                  <option value="LUNCH">Lunch</option>
                  <option value="DINNER">Dinner</option>
                </select>
              </div>

              <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-200/60 text-[11px] text-amber-900 leading-relaxed">
                <Info className="w-3.5 h-3.5 inline mr-1 text-amber-700" />
                Tasks will be generated only for eligible residents on confirmed kitchen meal plans. Opted-out residents are strictly excluded. Duplicate submissions are automatically skipped.
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsGenerateModalOpen(false)}
                  className="px-4 py-2 text-xs font-serif text-[#5D7656] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isGenerating}
                  className="px-5 py-2 bg-[#1A2E20] text-white text-xs font-serif rounded-xl hover:bg-[#263B2D] transition shadow-xs disabled:opacity-50"
                >
                  {isGenerating ? "Generating..." : "Generate Tasks"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New City / External Order Modal */}
      {isExternalModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E6E1DA] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <div>
                <h3 className="font-serif text-lg text-[#1A2E20]">New Citywide Tiffin Order</h3>
                <p className="text-[11px] text-[#5D7656]">External customer delivery without requiring PG room assignment</p>
              </div>
              <button onClick={() => setIsExternalModalOpen(false)} className="text-[#8E9F89] hover:text-[#1A2E20]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateExternalTask} className="space-y-4">
              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Service Date</label>
                <input
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Meal Service</label>
                <select
                  value={extMealType}
                  onChange={(e) => setExtMealType(e.target.value as MealType)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                >
                  <option value="BREAKFAST">Breakfast</option>
                  <option value="LUNCH">Lunch</option>
                  <option value="DINNER">Dinner</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Customer Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Vikas Yadav"
                  value={extCustomerName}
                  onChange={(e) => setExtCustomerName(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Contact Phone *</label>
                <input
                  type="tel"
                  placeholder="e.g. +91 98120 44556"
                  value={extCustomerPhone}
                  onChange={(e) => setExtCustomerPhone(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Delivery Address *</label>
                <textarea
                  placeholder="e.g. Plot 42, Sector 5, Met City, Jhajjar"
                  value={extDeliveryAddress}
                  onChange={(e) => setExtDeliveryAddress(e.target.value)}
                  required
                  rows={2}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Special Delivery Notes (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Gate code #402, extra chapatis"
                  value={extNotes}
                  onChange={(e) => setExtNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsExternalModalOpen(false)}
                  className="px-4 py-2 text-xs font-serif text-[#5D7656] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExt}
                  className="px-5 py-2 bg-[#1A2E20] text-white text-xs font-serif rounded-xl hover:bg-[#263B2D] transition shadow-xs disabled:opacity-50"
                >
                  {isSubmittingExt ? "Creating Order..." : "Create City Order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assign / Reassign Staff Modal */}
      {assignTargetTask && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E6E1DA] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <h3 className="font-serif text-lg text-[#1A2E20]">
                {assignTargetTask.assignedTo ? "Reassign Delivery" : "Assign Delivery Staff"}
              </h3>
              <button onClick={() => setAssignTargetTask(null)} className="text-[#8E9F89] hover:text-[#1A2E20]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAssignTask} className="space-y-4">
              <div className="p-3 bg-[#FAF8F5] rounded-xl border border-[#E6E1DA] text-xs space-y-1">
                <p>
                  <strong>Target:</strong> Room {assignTargetTask.roomNumber} ({assignTargetTask.residentName})
                </p>
                <p>
                  <strong>Meal:</strong> {assignTargetTask.mealType} • {assignTargetTask.serviceDate}
                </p>
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Select Delivery Personnel</label>
                <select
                  value={selectedStaffId}
                  onChange={(e) => setSelectedStaffId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                >
                  <option value="">-- Choose active delivery staff --</option>
                  {deliveryStaff.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.fullName} (@{staff.username})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignTargetTask(null)}
                  className="px-4 py-2 text-xs font-serif text-[#5D7656] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAssigning || !selectedStaffId}
                  className="px-5 py-2 bg-[#1A2E20] text-white text-xs font-serif rounded-xl hover:bg-[#263B2D] transition shadow-xs disabled:opacity-50"
                >
                  {isAssigning ? "Saving..." : "Confirm Assignment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Complete Delivery Modal */}
      {deliverTargetTask && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E6E1DA] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <h3 className="font-serif text-lg text-[#1A2E20]">Confirm Handover & Delivery</h3>
              <button onClick={() => setDeliverTargetTask(null)} className="text-[#8E9F89] hover:text-[#1A2E20]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCompleteDelivery} className="space-y-4">
              <div className="p-3 bg-emerald-50/50 rounded-xl border border-emerald-200/60 text-xs space-y-1">
                <p>
                  <strong>Delivering to:</strong> Room {deliverTargetTask.roomNumber} ({deliverTargetTask.residentName})
                </p>
                <p>
                  <strong>Service:</strong> {deliverTargetTask.mealType} • {deliverTargetTask.serviceDate}
                </p>
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">
                  Recipient Name <span className="text-[#8E9F89] font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder={deliverTargetTask.residentName || deliverTargetTask.customerName || "Customer / Resident"}
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">
                  Handover Notes <span className="text-[#8E9F89] font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Handed directly at door"
                  value={deliveryNotes}
                  onChange={(e) => setDeliveryNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDeliverTargetTask(null)}
                  className="px-4 py-2 text-xs font-serif text-[#5D7656] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDelivering}
                  className="px-5 py-2 bg-emerald-700 text-white text-xs font-serif rounded-xl hover:bg-emerald-800 transition shadow-xs disabled:opacity-50"
                >
                  {isDelivering ? "Recording..." : "Confirm Delivered"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Report Exception Modal */}
      {exceptionTargetTask && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E6E1DA] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <h3 className="font-serif text-lg text-red-800">Report Delivery Issue</h3>
              <button onClick={() => setExceptionTargetTask(null)} className="text-[#8E9F89] hover:text-[#1A2E20]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleReportException} className="space-y-4">
              <div className="p-3 bg-red-50/50 rounded-xl border border-red-200/60 text-xs space-y-1">
                <p>
                  <strong>Target:</strong> Room {exceptionTargetTask.roomNumber} ({exceptionTargetTask.residentName})
                </p>
                <p>
                  <strong>Meal:</strong> {exceptionTargetTask.mealType} • {exceptionTargetTask.serviceDate}
                </p>
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">Issue Category</label>
                <select
                  value={exceptionType}
                  onChange={(e) => setExceptionType(e.target.value as DeliveryExceptionType)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                >
                  <option value="RESIDENT_UNAVAILABLE">Resident Unavailable / Room Locked</option>
                  <option value="RESIDENT_DECLINED">Resident Declined Meal</option>
                  <option value="LOCATION_UNCLEAR">Location or Room Unclear</option>
                  <option value="MEAL_DAMAGED_OR_MISSING">Meal Damaged or Missing Tiffin</option>
                  <option value="OTHER">Other Operational Issue</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">
                  Explanation <span className="text-red-600">*</span>
                </label>
                <textarea
                  required
                  minLength={5}
                  placeholder="Describe the delivery issue clearly (minimum 5 characters)..."
                  value={exceptionReason}
                  onChange={(e) => setExceptionReason(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setExceptionTargetTask(null)}
                  className="px-4 py-2 text-xs font-serif text-[#5D7656] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isReportingException || exceptionReason.trim().length < 5}
                  className="px-5 py-2 bg-red-700 text-white text-xs font-serif rounded-xl hover:bg-red-800 transition shadow-xs disabled:opacity-50"
                >
                  {isReportingException ? "Submitting..." : "Record Exception"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Retry Exception Modal */}
      {retryTargetTask && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 border border-[#E6E1DA] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E6E1DA] pb-3">
              <h3 className="font-serif text-lg text-[#1A2E20]">Retry Delivery Task</h3>
              <button onClick={() => setRetryTargetTask(null)} className="text-[#8E9F89] hover:text-[#1A2E20]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleRetryTask} className="space-y-4">
              <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-200/60 text-xs space-y-1">
                <p>
                  <strong>Target:</strong> Room {retryTargetTask.roomNumber} ({retryTargetTask.residentName})
                </p>
                <p className="text-red-700">
                  <strong>Current Issue:</strong> [{retryTargetTask.exceptionType}] {retryTargetTask.exceptionReason}
                </p>
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">
                  Reassign To Staff <span className="text-[#8E9F89] font-normal">(Optional)</span>
                </label>
                <select
                  value={retryReassignStaffId}
                  onChange={(e) => setRetryReassignStaffId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                >
                  <option value="">Keep current assigned staff ({retryTargetTask.assignedToName})</option>
                  {deliveryStaff.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.fullName} (@{staff.username})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-serif text-[#1A2E20] mb-1">
                  Management Notes <span className="text-[#8E9F89] font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Resident called back, reattempting delivery"
                  value={retryNotes}
                  onChange={(e) => setRetryNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRetryTargetTask(null)}
                  className="px-4 py-2 text-xs font-serif text-[#5D7656] hover:text-[#1A2E20]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRetrying}
                  className="px-5 py-2 bg-[#B58A57] text-white text-xs font-serif rounded-xl hover:bg-[#9E7443] transition shadow-xs disabled:opacity-50"
                >
                  {isRetrying ? "Resetting..." : "Reset for Redelivery"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
