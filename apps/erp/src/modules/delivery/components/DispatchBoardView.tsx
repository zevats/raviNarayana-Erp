"use client";

import React, { useState, useMemo } from "react";
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
  History,
  Phone,
  Layers,
  Search,
  Filter,
  Receipt,
  AlertCircle,
  FileText,
} from "lucide-react";
import {
  AuthenticatedUser,
  DeliveryTask,
  DeliveryStatus,
  DeliveryDashboardSummary,
  MealType,
} from "@/types";

interface DispatchBoardViewProps {
  currentUser: AuthenticatedUser;
  serviceDate: string;
  setServiceDate: (d: string) => void;
  mealTypeFilter: MealType | "ALL";
  setMealTypeFilter: (m: MealType | "ALL") => void;
  statusFilter: DeliveryStatus | "ALL";
  setStatusFilter: (s: DeliveryStatus | "ALL") => void;
  orderTypeFilter: "ALL" | "RESIDENT" | "EXTERNAL";
  setOrderTypeFilter: (o: "ALL" | "RESIDENT" | "EXTERNAL") => void;
  driverFilter: string;
  setDriverFilter: (d: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  tasks: DeliveryTask[];
  summary: DeliveryDashboardSummary | null;
  deliveryStaff: Array<{ id: string; fullName: string; username: string }>;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenGenerateModal: () => void;
  onOpenExternalModal: () => void;
  onOpenBatchAssignModal: (tasks: DeliveryTask[]) => void;
  onBatchDispatch: (taskIds: string[]) => Promise<void>;
  onOpenSingleAssignModal: (task: DeliveryTask) => void;
  onOpenCompleteModal: (task: DeliveryTask) => void;
  onOpenExceptionModal: (task: DeliveryTask) => void;
  onOpenRetryModal: (task: DeliveryTask) => void;
  onOpenTimelineModal: (task: DeliveryTask) => void;
  onDispatchSingle: (taskId: string, label: string) => Promise<void>;
}

export function DispatchBoardView({
  currentUser,
  serviceDate,
  setServiceDate,
  mealTypeFilter,
  setMealTypeFilter,
  statusFilter,
  setStatusFilter,
  orderTypeFilter,
  setOrderTypeFilter,
  driverFilter,
  setDriverFilter,
  searchQuery,
  setSearchQuery,
  tasks,
  summary,
  deliveryStaff,
  loading,
  onRefresh,
  onOpenGenerateModal,
  onOpenExternalModal,
  onOpenBatchAssignModal,
  onBatchDispatch,
  onOpenSingleAssignModal,
  onOpenCompleteModal,
  onOpenExceptionModal,
  onOpenRetryModal,
  onOpenTimelineModal,
  onDispatchSingle,
}: DispatchBoardViewProps) {
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [isBatchDispatching, setIsBatchDispatching] = useState(false);

  // Client-side text filter for instant search responsiveness
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Driver filter
    if (driverFilter && driverFilter !== "ALL") {
      if (driverFilter === "UNASSIGNED") {
        result = result.filter((t) => !t.assignedTo);
      } else {
        result = result.filter((t) => t.assignedTo === driverFilter);
      }
    }

    // Text search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((t) => {
        const residentName = (t.residentName || "").toLowerCase();
        const customerName = (t.customerName || "").toLowerCase();
        const roomNumber = (t.roomNumber || "").toLowerCase();
        const address = (t.deliveryAddress || "").toLowerCase();
        const phone = (t.customerPhone || "").toLowerCase();
        const driverName = (t.assignedToName || "").toLowerCase();
        return (
          residentName.includes(q) ||
          customerName.includes(q) ||
          roomNumber.includes(q) ||
          address.includes(q) ||
          phone.includes(q) ||
          driverName.includes(q)
        );
      });
    }

    return result;
  }, [tasks, driverFilter, searchQuery]);

  // Selection handlers
  const handleSelectAll = () => {
    if (selectedTaskIds.length === filteredTasks.length) {
      setSelectedTaskIds([]);
    } else {
      setSelectedTaskIds(filteredTasks.map((t) => t.id));
    }
  };

  const handleToggleTask = (taskId: string) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const selectedTasks = useMemo(() => {
    return tasks.filter((t) => selectedTaskIds.includes(t.id));
  }, [tasks, selectedTaskIds]);

  const dispatchableSelectedTasks = useMemo(() => {
    return selectedTasks.filter((t) => t.status === "ASSIGNED" && !t.invoiceId);
  }, [selectedTasks]);

  const handleBatchDispatchClick = async () => {
    if (dispatchableSelectedTasks.length === 0) return;
    setIsBatchDispatching(true);
    try {
      await onBatchDispatch(dispatchableSelectedTasks.map((t) => t.id));
      setSelectedTaskIds([]);
    } finally {
      setIsBatchDispatching(false);
    }
  };

  const isAllSelected = filteredTasks.length > 0 && selectedTaskIds.length === filteredTasks.length;

  return (
    <div className="space-y-6">
      {/* 1. Portal Header & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E6E1DA] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-widest bg-[#1A2E20]/10 text-[#1A2E20] rounded border border-[#1A2E20]/20">
              Dispatch & Route Control
            </span>
            <span className="text-xs text-[#8E9F89] font-serif">• Operational Hub</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif text-[#1A2E20] mt-1 font-normal tracking-tight">
            Delivery Dispatch Board
          </h1>
          <p className="text-xs sm:text-sm text-[#5D7656] mt-0.5">
            Assemble dispatch runs, allocate delivery personnel, track room and customer handovers, and reconcile exceptions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={onOpenGenerateModal}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#1A2E20] text-white rounded-xl text-xs font-serif hover:bg-[#263B2D] transition shadow-xs"
          >
            <PlusCircle className="w-3.5 h-3.5 text-[#C89F6B]" />
            Generate from Kitchen
          </button>

          <button
            onClick={onOpenExternalModal}
            className="inline-flex items-center gap-2 px-3 py-2 bg-[#FAF8F5] text-[#1A2E20] rounded-xl text-xs font-serif border border-[#B58A57] hover:bg-[#FAF8F5]/80 transition shadow-2xs"
          >
            <PlusCircle className="w-3.5 h-3.5 text-[#B58A57]" />
            New City Order
          </button>

          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white text-[#1A2E20] rounded-xl text-xs font-serif border border-[#DCD6CD] hover:bg-[#FAF8F5] transition shadow-2xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#B58A57] ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* 2. Operational Metrics Pipeline Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <button
            onClick={() => setStatusFilter("ALL")}
            className={`p-4 rounded-2xl border text-left transition shadow-2xs ${
              statusFilter === "ALL"
                ? "bg-[#1A2E20] text-white border-[#1A2E20]"
                : "bg-white text-[#1A2E20] border-[#E6E1DA] hover:border-[#DCD6CD]"
            }`}
          >
            <span className={`text-[10px] uppercase font-mono tracking-wider ${statusFilter === "ALL" ? "text-[#C89F6B]" : "text-[#8E9F89]"}`}>
              Total Stops
            </span>
            <p className="text-2xl font-serif mt-1 font-medium">{summary.totalTasks}</p>
            <span className={`text-[10px] ${statusFilter === "ALL" ? "text-white/70" : "text-[#5D7656]"}`}>
              {summary.serviceDate}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter("PENDING")}
            className={`p-4 rounded-2xl border text-left transition shadow-2xs ${
              statusFilter === "PENDING"
                ? "bg-amber-800 text-white border-amber-800"
                : "bg-white text-amber-900 border-[#E6E1DA] hover:border-amber-300"
            }`}
          >
            <span className={`text-[10px] uppercase font-mono tracking-wider ${statusFilter === "PENDING" ? "text-amber-200" : "text-amber-700"}`}>
              Unassigned
            </span>
            <p className="text-2xl font-serif mt-1 font-medium">{summary.unassignedCount}</p>
            <span className={`text-[10px] ${statusFilter === "PENDING" ? "text-amber-100" : "text-amber-600"}`}>
              Needs Staff
            </span>
          </button>

          <button
            onClick={() => setStatusFilter("ASSIGNED")}
            className={`p-4 rounded-2xl border text-left transition shadow-2xs ${
              statusFilter === "ASSIGNED"
                ? "bg-blue-800 text-white border-blue-800"
                : "bg-white text-blue-900 border-[#E6E1DA] hover:border-blue-300"
            }`}
          >
            <span className={`text-[10px] uppercase font-mono tracking-wider ${statusFilter === "ASSIGNED" ? "text-blue-200" : "text-blue-700"}`}>
              Assigned
            </span>
            <p className="text-2xl font-serif mt-1 font-medium">{summary.assignedCount}</p>
            <span className={`text-[10px] ${statusFilter === "ASSIGNED" ? "text-blue-100" : "text-blue-600"}`}>
              Ready to Dispatch
            </span>
          </button>

          <button
            onClick={() => setStatusFilter("OUT_FOR_DELIVERY")}
            className={`p-4 rounded-2xl border text-left transition shadow-2xs ${
              statusFilter === "OUT_FOR_DELIVERY"
                ? "bg-indigo-800 text-white border-indigo-800"
                : "bg-white text-indigo-900 border-[#E6E1DA] hover:border-indigo-300"
            }`}
          >
            <span className={`text-[10px] uppercase font-mono tracking-wider ${statusFilter === "OUT_FOR_DELIVERY" ? "text-indigo-200" : "text-indigo-700"}`}>
              In Transit
            </span>
            <p className="text-2xl font-serif mt-1 font-medium">{summary.outForDeliveryCount}</p>
            <span className={`text-[10px] ${statusFilter === "OUT_FOR_DELIVERY" ? "text-indigo-100" : "text-indigo-600"}`}>
              Out on route
            </span>
          </button>

          <button
            onClick={() => setStatusFilter("DELIVERED")}
            className={`p-4 rounded-2xl border text-left transition shadow-2xs ${
              statusFilter === "DELIVERED"
                ? "bg-emerald-800 text-white border-emerald-800"
                : "bg-white text-emerald-900 border-[#E6E1DA] hover:border-emerald-300"
            }`}
          >
            <span className={`text-[10px] uppercase font-mono tracking-wider ${statusFilter === "DELIVERED" ? "text-emerald-200" : "text-emerald-700"}`}>
              Delivered
            </span>
            <p className="text-2xl font-serif mt-1 font-medium">{summary.deliveredCount}</p>
            <span className={`text-[10px] ${statusFilter === "DELIVERED" ? "text-emerald-100" : "text-emerald-600"}`}>
              {summary.totalTasks > 0 ? `${Math.round((summary.deliveredCount / summary.totalTasks) * 100)}% Fulfilled` : "0%"}
            </span>
          </button>

          <button
            onClick={() => setStatusFilter("EXCEPTION")}
            className={`p-4 rounded-2xl border text-left transition shadow-2xs ${
              statusFilter === "EXCEPTION"
                ? "bg-red-800 text-white border-red-800"
                : "bg-white text-red-900 border-[#E6E1DA] hover:border-red-300"
            }`}
          >
            <span className={`text-[10px] uppercase font-mono tracking-wider ${statusFilter === "EXCEPTION" ? "text-red-200" : "text-red-700"}`}>
              Exceptions
            </span>
            <p className="text-2xl font-serif mt-1 font-medium">{summary.exceptionCount}</p>
            <span className={`text-[10px] ${statusFilter === "EXCEPTION" ? "text-red-100" : "text-red-600"}`}>
              Action Required
            </span>
          </button>
        </div>
      )}

      {/* 3. Comprehensive Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-[#E6E1DA] shadow-2xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Service Date */}
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
              <label className="block text-[10px] uppercase font-mono text-[#8E9F89] mb-1">Meal Service</label>
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

            {/* Driver Filter */}
            <div>
              <label className="block text-[10px] uppercase font-mono text-[#8E9F89] mb-1">Delivery Person</label>
              <select
                value={driverFilter}
                onChange={(e) => setDriverFilter(e.target.value)}
                className="px-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-lg text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
              >
                <option value="ALL">All Personnel</option>
                <option value="UNASSIGNED">Unassigned Only</option>
                {deliveryStaff.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.fullName}
                  </option>
                ))}
              </select>
            </div>

            {/* Destination Type Filter */}
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

          {/* Search Box */}
          <div className="w-full sm:w-72">
            <label className="block text-[10px] uppercase font-mono text-[#8E9F89] mb-1">Quick Search</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8E9F89] absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search room, customer, address, driver..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#FAF8F5] border border-[#DCD6CD] rounded-lg text-[#1A2E20] focus:outline-hidden focus:border-[#B58A57]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2 text-xs text-[#8E9F89] hover:text-[#1A2E20]"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Status Pipeline Filter Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E6E1DA]/60">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[10px] font-mono uppercase text-[#8E9F89] mr-1">Status:</span>
            {(["ALL", "PENDING", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "EXCEPTION"] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-lg text-xs font-serif transition ${
                  statusFilter === st
                    ? "bg-[#1A2E20] text-white font-medium"
                    : "bg-[#FAF8F5] text-[#5D7656] hover:bg-[#E6E1DA]/50"
                }`}
              >
                {st === "ALL"
                  ? "All"
                  : st === "PENDING"
                  ? "Unassigned"
                  : st === "ASSIGNED"
                  ? "Assigned"
                  : st === "OUT_FOR_DELIVERY"
                  ? "In Transit"
                  : st === "DELIVERED"
                  ? "Delivered"
                  : "Exceptions"}
              </button>
            ))}
          </div>

          <div className="text-[11px] font-mono text-[#8E9F89]">
            Showing {filteredTasks.length} of {tasks.length} task(s)
          </div>
        </div>
      </div>

      {/* 4. Multi-Select Batch Actions Bar */}
      {selectedTaskIds.length > 0 && (
        <div className="p-3.5 bg-[#1A2E20] text-white rounded-2xl shadow-sm border border-[#263B2D] flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2.5 text-xs">
            <Layers className="w-4 h-4 text-[#C89F6B]" />
            <span className="font-serif">
              <strong>{selectedTaskIds.length}</strong> task(s) selected
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onOpenBatchAssignModal(selectedTasks)}
              className="px-3.5 py-1.5 bg-[#C89F6B] text-[#1A2E20] rounded-xl text-xs font-serif font-medium hover:bg-[#B58A57] transition flex items-center gap-1.5 shadow-xs"
            >
              <UserCheck className="w-3.5 h-3.5" />
              Batch Assign Staff
            </button>

            {dispatchableSelectedTasks.length > 0 && (
              <button
                onClick={handleBatchDispatchClick}
                disabled={isBatchDispatching}
                className="px-3.5 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-serif hover:bg-indigo-700 transition flex items-center gap-1.5 shadow-xs disabled:opacity-50"
              >
                <Truck className="w-3.5 h-3.5" />
                {isBatchDispatching
                  ? "Dispatching..."
                  : `Batch Dispatch (${dispatchableSelectedTasks.length})`}
              </button>
            )}

            <button
              onClick={() => setSelectedTaskIds([])}
              className="px-2.5 py-1.5 bg-white/10 text-white rounded-xl text-xs font-serif hover:bg-white/20 transition"
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* 5. Dispatch Table / Task List */}
      {loading ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#E6E1DA]">
          <RefreshCw className="w-6 h-6 animate-spin text-[#B58A57] mx-auto mb-2" />
          <p className="text-xs text-[#5D7656] font-serif">Loading delivery records...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-[#E6E1DA] space-y-3">
          <Truck className="w-8 h-8 text-[#8E9F89] mx-auto opacity-50" />
          <h3 className="font-serif text-base text-[#1A2E20]">No Delivery Tasks Found</h3>
          <p className="text-xs text-[#5D7656] max-w-md mx-auto">
            {tasks.length === 0
              ? "No delivery tasks exist for this date and meal. Click 'Generate from Kitchen' to pull confirmed resident and subscription meals."
              : "No tasks matched your active filter or search criteria."}
          </p>
          {tasks.length === 0 && (
            <button
              onClick={onOpenGenerateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#1A2E20] text-white text-xs font-serif rounded-lg hover:bg-[#263B2D] transition shadow-xs"
            >
              <PlusCircle className="w-3.5 h-3.5 text-[#C89F6B]" />
              Generate Tasks Now
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Select all header */}
          <div className="flex items-center justify-between px-2 text-xs text-[#8E9F89] font-mono">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAllSelected}
                onChange={handleSelectAll}
                className="w-4 h-4 rounded text-[#1A2E20] border-[#DCD6CD] focus:ring-[#B58A57]"
              />
              <span>Select all visible ({filteredTasks.length})</span>
            </label>
          </div>

          {filteredTasks.map((task) => {
            const isExternal = task.orderType === "EXTERNAL";
            const isSelected = selectedTaskIds.includes(task.id);
            const isBilled = !!task.invoiceId;

            return (
              <div
                key={task.id}
                className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-2xs transition flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 ${
                  isSelected ? "border-[#1A2E20] bg-[#FAF8F5]/40 ring-1 ring-[#1A2E20]" : "border-[#E6E1DA] hover:border-[#DCD6CD]"
                }`}
              >
                {/* Left: Checkbox + Destination Details */}
                <div className="flex items-start gap-3.5">
                  <div className="pt-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleTask(task.id)}
                      className="w-4 h-4 rounded text-[#1A2E20] border-[#DCD6CD] focus:ring-[#B58A57] cursor-pointer"
                    />
                  </div>

                  {/* Destination Icon / Room Badge */}
                  {isExternal ? (
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
                        {isExternal ? task.customerName || "City Customer" : task.residentName}
                      </h4>
                      {isExternal ? (
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
                      {isBilled && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1 font-semibold">
                          <Receipt className="w-3 h-3" /> Billed
                        </span>
                      )}
                      {isExternal && task.status === "DELIVERED" && !isBilled && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                          Ready to Bill
                        </span>
                      )}
                    </div>

                    {isExternal && (
                      <p className="text-xs text-[#5A6C5E] flex flex-wrap items-center gap-2 font-medium">
                        <span className="flex items-center gap-1 text-[#1A2E20]">
                          <MapPin className="w-3 h-3 text-[#B58A57]" />
                          {task.deliveryAddress || <span className="text-red-600 italic">Missing address</span>}
                        </span>
                        {task.customerPhone && (
                          <span className="flex items-center gap-1 text-[#8E9F89]">
                            <Phone className="w-3 h-3 text-[#B58A57]" />
                            {task.customerPhone}
                          </span>
                        )}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-xs text-[#8E9F89]">
                      <span>Date: {task.serviceDate}</span>
                      <span>•</span>
                      <span>
                        Assigned To:{" "}
                        <strong className={task.assignedToName ? "text-[#1A2E20] font-normal" : "text-amber-700 font-medium"}>
                          {task.assignedToName || "Unassigned"}
                        </strong>
                      </span>
                    </div>

                    {/* Delivery Notes or Exception Details */}
                    {task.deliveryNotes && (
                      <p className="text-xs text-[#5D7656] italic pt-0.5">
                        Note: {task.deliveryNotes}
                      </p>
                    )}

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
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Dispatch button if Assigned */}
                    {task.status === "ASSIGNED" && (
                      <button
                        onClick={() => onDispatchSingle(task.id, task.roomNumber || task.customerName || "Stop")}
                        className="px-3 py-1.5 bg-[#1A2E20] text-white text-xs font-serif rounded-lg hover:bg-[#263B2D] transition shadow-xs flex items-center gap-1"
                      >
                        <Truck className="w-3.5 h-3.5 text-[#C89F6B]" />
                        Dispatch
                      </button>
                    )}

                    {/* Mark Delivered button if Out for Delivery */}
                    {task.status === "OUT_FOR_DELIVERY" && (
                      <button
                        onClick={() => onOpenCompleteModal(task)}
                        className="px-3 py-1.5 bg-emerald-700 text-white text-xs font-serif rounded-lg hover:bg-emerald-800 transition shadow-xs flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        Mark Delivered
                      </button>
                    )}

                    {/* Report Issue if Assigned or Out for Delivery */}
                    {(task.status === "ASSIGNED" || task.status === "OUT_FOR_DELIVERY") && (
                      <button
                        onClick={() => onOpenExceptionModal(task)}
                        className="px-2.5 py-1.5 bg-white text-red-700 border border-red-200 text-xs font-serif rounded-lg hover:bg-red-50 transition"
                      >
                        Report Issue
                      </button>
                    )}

                    {/* Assign / Reassign Staff (disabled if already billed or delivered) */}
                    {task.status !== "DELIVERED" && !isBilled && (
                      <button
                        onClick={() => onOpenSingleAssignModal(task)}
                        className="px-2.5 py-1.5 bg-white text-[#1A2E20] border border-[#DCD6CD] text-xs font-serif rounded-lg hover:bg-[#FAF8F5] transition"
                      >
                        {task.assignedTo ? "Reassign" : "Assign Staff"}
                      </button>
                    )}

                    {/* Retry on Exception */}
                    {task.status === "EXCEPTION" && (
                      <button
                        onClick={() => onOpenRetryModal(task)}
                        className="px-3 py-1.5 bg-[#B58A57] text-white text-xs font-serif rounded-lg hover:bg-[#9E7443] transition shadow-xs flex items-center gap-1"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Retry
                      </button>
                    )}

                    {/* View Audit Timeline */}
                    <button
                      onClick={() => onOpenTimelineModal(task)}
                      className="p-1.5 bg-white text-[#8E9F89] hover:text-[#1A2E20] border border-[#DCD6CD] rounded-lg transition"
                      title="View Audit Events"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
