"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  UtensilsCrossed,
  Plus,
  Calendar,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Users,
  Coffee,
  Sun,
  Moon,
  Clock,
  Printer,
  ChevronLeft,
  ChevronRight,
  Sliders,
  Check,
  X,
  FileSpreadsheet,
  ArrowRight,
  ShieldAlert,
  Edit2,
  CheckSquare,
  Square,
  HelpCircle,
} from "lucide-react";
import {
  MealType,
  MealPlanStatus,
  DailyMealPlan,
  ResidentMealEligibility,
  PreparationSheetData,
  KitchenDashboardSummary,
  ResidentMealRecord,
  MealPlanAdjustment,
} from "@/types";

export default function KitchenPage() {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [activeTab, setActiveTab] = useState<"today" | "history">("today");

  const [dashboard, setDashboard] = useState<KitchenDashboardSummary | null>(null);
  const [historyPlans, setHistoryPlans] = useState<DailyMealPlan[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // History filters
  const [historyStartDate, setHistoryStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [historyEndDate, setHistoryEndDate] = useState<string>(todayStr);
  const [historyMealType, setHistoryMealType] = useState<string>("ALL");
  const [historyStatus, setHistoryStatus] = useState<string>("ALL");

  // Create / Edit Modal State
  const [isPlanModalOpen, setIsPlanModalOpen] = useState<boolean>(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [modalMealType, setModalMealType] = useState<MealType>("BREAKFAST");
  const [modalServiceDate, setModalServiceDate] = useState<string>(todayStr);
  const [modalGuestCount, setModalGuestCount] = useState<number>(0);
  const [modalNotes, setModalNotes] = useState<string>("");
  const [modalEligibleResidents, setModalEligibleResidents] = useState<ResidentMealEligibility[]>([]);
  const [modalOptOuts, setModalOptOuts] = useState<Set<string>>(new Set());
  const [modalLoadingEligibility, setModalLoadingEligibility] = useState<boolean>(false);

  // Adjust Quantity Modal State
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState<boolean>(false);
  const [adjustingPlan, setAdjustingPlan] = useState<DailyMealPlan | null>(null);
  const [adjustResidentCount, setAdjustResidentCount] = useState<number>(0);
  const [adjustGuestCount, setAdjustGuestCount] = useState<number>(0);
  const [adjustReason, setAdjustReason] = useState<string>("");

  // Prep Sheet Modal State
  const [isPrepSheetOpen, setIsPrepSheetOpen] = useState<boolean>(false);
  const [prepSheetData, setPrepSheetData] = useState<PreparationSheetData | null>(null);
  const [prepSheetLoading, setPrepSheetLoading] = useState<boolean>(false);

  // Fetch Dashboard data for selected date
  const loadDashboard = useCallback(async (date: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/kitchen/plans?summary=true&serviceDate=${date}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load kitchen dashboard.");
      }
      setDashboard(data.dashboard);
    } catch (err: any) {
      setError(err.message || "Network error loading dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch History plans
  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (historyStartDate) params.set("startDate", historyStartDate);
      if (historyEndDate) params.set("endDate", historyEndDate);
      if (historyMealType !== "ALL") params.set("mealType", historyMealType);
      if (historyStatus !== "ALL") params.set("status", historyStatus);

      const res = await fetch(`/api/kitchen/plans?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load historical meal plans.");
      }
      setHistoryPlans(data.plans || []);
    } catch (err: any) {
      setError(err.message || "Network error loading history.");
    } finally {
      setLoading(false);
    }
  }, [historyStartDate, historyEndDate, historyMealType, historyStatus]);

  useEffect(() => {
    if (activeTab === "today") {
      loadDashboard(selectedDate);
    } else {
      loadHistory();
    }
  }, [activeTab, selectedDate, loadDashboard, loadHistory]);

  const showToast = (msg: string) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(null), 4000);
  };

  // Date stepper
  const stepDate = (days: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + days);
    const newDateStr = current.toISOString().slice(0, 10);
    setSelectedDate(newDateStr);
  };

  // Open Create Plan modal
  const handleOpenCreateModal = async (mealType: MealType, dateStr: string) => {
    setEditingPlanId(null);
    setModalMealType(mealType);
    setModalServiceDate(dateStr);
    setModalGuestCount(0);
    setModalNotes("");
    setModalOptOuts(new Set());
    setIsPlanModalOpen(true);
    setModalLoadingEligibility(true);

    try {
      const res = await fetch(`/api/kitchen/eligibility?serviceDate=${dateStr}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load resident eligibility.");
      setModalEligibleResidents(data.residents || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setModalLoadingEligibility(false);
    }
  };

  // Open Edit Plan modal (for draft plan)
  const handleOpenEditModal = async (plan: DailyMealPlan) => {
    setEditingPlanId(plan.id);
    setModalMealType(plan.mealType);
    setModalServiceDate(plan.serviceDate);
    setModalGuestCount(plan.guestCount);
    setModalNotes(plan.notes || "");
    setIsPlanModalOpen(true);
    setModalLoadingEligibility(true);

    try {
      const planRes = await fetch(`/api/kitchen/plans/${plan.id}`);
      const planData = await planRes.json();
      if (!planRes.ok) throw new Error(planData.error || "Failed to load plan details.");

      const records: ResidentMealRecord[] = planData.residentRecords || [];
      const optOuts = new Set<string>();
      records.forEach((r) => {
        if (r.status === "OPTED_OUT") optOuts.add(r.residentId);
      });
      setModalOptOuts(optOuts);

      // Load eligible
      const eligRes = await fetch(`/api/kitchen/eligibility?serviceDate=${plan.serviceDate}`);
      const eligData = await eligRes.json();
      if (eligRes.ok) {
        setModalEligibleResidents(eligData.residents || []);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setModalLoadingEligibility(false);
    }
  };

  // Toggle resident opt-out in modal
  const toggleOptOut = (residentId: string) => {
    setModalOptOuts((prev) => {
      const next = new Set(prev);
      if (next.has(residentId)) {
        next.delete(residentId);
      } else {
        next.add(residentId);
      }
      return next;
    });
  };

  const selectAllResidents = (optIn: boolean) => {
    if (optIn) {
      setModalOptOuts(new Set());
    } else {
      const allIds = new Set(modalEligibleResidents.map((r) => r.residentId));
      setModalOptOuts(allIds);
    }
  };

  // Submit Plan (Draft or Confirmed)
  const handleSavePlan = async (asConfirmed: boolean) => {
    setActionLoading(true);
    setError(null);
    try {
      if (editingPlanId) {
        // Update existing draft
        const res = await fetch(`/api/kitchen/plans/${editingPlanId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guestCount: modalGuestCount,
            notes: modalNotes,
            residentOptOuts: Array.from(modalOptOuts),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update plan.");

        if (asConfirmed) {
          const confRes = await fetch(`/api/kitchen/plans/${editingPlanId}/confirm`, {
            method: "POST",
          });
          const confData = await confRes.json();
          if (!confRes.ok) throw new Error(confData.error || "Failed to confirm plan.");
        }

        showToast("Meal plan updated successfully.");
      } else {
        // Create new
        const res = await fetch("/api/kitchen/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serviceDate: modalServiceDate,
            mealType: modalMealType,
            guestCount: modalGuestCount,
            notes: modalNotes,
            residentOptOuts: Array.from(modalOptOuts),
            status: asConfirmed ? "CONFIRMED" : "DRAFT",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create meal plan.");

        showToast(
          asConfirmed
            ? `${modalMealType} plan created and confirmed.`
            : `${modalMealType} draft plan created.`
        );
      }

      setIsPlanModalOpen(false);
      loadDashboard(selectedDate);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Confirm directly
  const handleConfirmDirect = async (planId: string, mealType: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/kitchen/plans/${planId}/confirm`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to confirm plan.");
      showToast(`${mealType} plan confirmed for kitchen preparation.`);
      loadDashboard(selectedDate);
      if (activeTab === "history") loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Complete directly
  const handleCompleteDirect = async (planId: string, mealType: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/kitchen/plans/${planId}/complete`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to complete plan.");
      showToast(`${mealType} meal service finalized and marked COMPLETED.`);
      loadDashboard(selectedDate);
      if (activeTab === "history") loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Open Adjust Modal
  const handleOpenAdjustModal = (plan: DailyMealPlan) => {
    setAdjustingPlan(plan);
    setAdjustResidentCount(plan.plannedResidentCount);
    setAdjustGuestCount(plan.guestCount);
    setAdjustReason("");
    setIsAdjustModalOpen(true);
  };

  // Submit Adjustment
  const handleSaveAdjustment = async () => {
    if (!adjustingPlan) return;
    if (adjustReason.trim().length < 5) {
      setError("Please provide a justification reason of at least 5 characters.");
      return;
    }

    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/kitchen/plans/${adjustingPlan.id}/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newResidentCount: adjustResidentCount,
          newGuestCount: adjustGuestCount,
          reason: adjustReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record adjustment.");

      showToast("Quantity adjustment recorded with audit trail.");
      setIsAdjustModalOpen(false);
      loadDashboard(selectedDate);
      if (activeTab === "history") loadHistory();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // Open Prep Sheet
  const handleOpenPrepSheet = async (planId: string) => {
    setIsPrepSheetOpen(true);
    setPrepSheetLoading(true);
    setPrepSheetData(null);
    try {
      const res = await fetch(`/api/kitchen/prep-sheet?planId=${planId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load prep sheet.");
      setPrepSheetData(data.prepSheet);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPrepSheetLoading(false);
    }
  };

  // Derived counts for modal
  const modalEligibleTotal = modalEligibleResidents.length;
  const modalOptedOutTotal = modalOptOuts.size;
  const modalConfirmedResidents = Math.max(0, modalEligibleTotal - modalOptedOutTotal);
  const modalFinalPreparationCount = modalConfirmedResidents + Math.max(0, modalGuestCount);

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      {successMessage && (
        <div className="fixed top-20 right-8 z-50 flex items-center gap-2 bg-[#1A2E20] border border-[#B58A57] text-[#FAF8F5] px-4 py-3 rounded-lg shadow-xl animate-fade-in text-sm font-medium">
          <CheckCircle2 className="w-4 h-4 text-[#B58A57]" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Global Error Banner */}
      {error && (
        <div className="flex items-center justify-between bg-red-900/20 border border-red-500/40 text-red-200 px-4 py-3 rounded-lg text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#8E9F89]/20 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-widest font-mono text-[#B58A57] font-semibold">
              Operational Phase 5
            </span>
            <span className="text-[#8E9F89]/40">•</span>
            <span className="text-xs font-mono text-[#8E9F89]">Met City Facility Kitchen</span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-serif text-[#FAF8F5] tracking-tight">
            Daily Tiffin & Kitchen Operations
          </h1>
          <p className="text-sm text-[#8E9F89] mt-0.5">
            Authoritative resident meal planning, preparation sheets, and audit-logged quantity adjustments.
          </p>
        </div>

        {/* Date Selector & Primary Action */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center bg-[#263B2D]/70 border border-[#8E9F89]/30 rounded-lg p-1 text-sm text-[#FAF8F5]">
            <button
              onClick={() => stepDate(-1)}
              className="p-1.5 hover:bg-[#1A2E20] rounded text-[#8E9F89] hover:text-[#FAF8F5] transition"
              title="Previous Day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 px-3 font-mono font-medium">
              <Calendar className="w-3.5 h-3.5 text-[#B58A57]" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent border-0 text-[#FAF8F5] text-sm focus:outline-none cursor-pointer"
              />
            </div>
            <button
              onClick={() => stepDate(1)}
              className="p-1.5 hover:bg-[#1A2E20] rounded text-[#8E9F89] hover:text-[#FAF8F5] transition"
              title="Next Day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {selectedDate !== todayStr && (
              <button
                onClick={() => setSelectedDate(todayStr)}
                className="ml-1 px-2 py-0.5 text-xs bg-[#B58A57]/20 text-[#B58A57] hover:bg-[#B58A57]/30 rounded transition font-medium"
              >
                Today
              </button>
            )}
          </div>

          <button
            onClick={() => (activeTab === "today" ? loadDashboard(selectedDate) : loadHistory())}
            disabled={loading}
            className="p-2 bg-[#263B2D]/70 border border-[#8E9F89]/30 text-[#8E9F89] hover:text-[#FAF8F5] rounded-lg transition"
            title="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#8E9F89]/20">
        <button
          onClick={() => setActiveTab("today")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            activeTab === "today"
              ? "border-[#B58A57] text-[#FAF8F5]"
              : "border-transparent text-[#8E9F89] hover:text-[#FAF8F5]"
          }`}
        >
          <UtensilsCrossed className="w-4 h-4 text-[#B58A57]" />
          <span>Daily Service Plan</span>
          {dashboard && (
            <span className="text-xs bg-[#1A2E20] border border-[#8E9F89]/30 px-1.5 py-0.5 rounded font-mono text-[#FAF8F5]">
              {selectedDate}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("history")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition ${
            activeTab === "history"
              ? "border-[#B58A57] text-[#FAF8F5]"
              : "border-transparent text-[#8E9F89] hover:text-[#FAF8F5]"
          }`}
        >
          <FileSpreadsheet className="w-4 h-4 text-[#B58A57]" />
          <span>Plan History & Explorer</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: DAILY SERVICE PLAN */}
      {/* ========================================================================= */}
      {activeTab === "today" && (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-[#263B2D]/40 border border-[#8E9F89]/20 rounded-xl p-4">
              <div className="text-xs text-[#8E9F89] font-medium uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <UtensilsCrossed className="w-3.5 h-3.5 text-[#B58A57]" />
                Total Portions Today
              </div>
              <div className="text-2xl font-serif text-[#FAF8F5]">
                {dashboard?.metrics.totalMealsPreparedToday ?? 0}
              </div>
              <div className="text-xs text-[#8E9F89] mt-1 font-mono">
                Across all 3 meal services
              </div>
            </div>

            <div className="bg-[#263B2D]/40 border border-[#8E9F89]/20 rounded-xl p-4">
              <div className="text-xs text-[#8E9F89] font-medium uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Coffee className="w-3.5 h-3.5 text-amber-400" />
                Breakfast
              </div>
              <div className="text-2xl font-serif text-[#FAF8F5]">
                {dashboard?.metrics.breakfastCount ?? 0}
              </div>
              <div className="text-xs text-[#8E9F89] mt-1 flex items-center gap-1 font-mono">
                {dashboard?.plans.breakfast ? (
                  <span className="text-emerald-400">Status: {dashboard.plans.breakfast.status}</span>
                ) : (
                  <span className="text-[#8E9F89]/60">Not planned</span>
                )}
              </div>
            </div>

            <div className="bg-[#263B2D]/40 border border-[#8E9F89]/20 rounded-xl p-4">
              <div className="text-xs text-[#8E9F89] font-medium uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5 text-orange-400" />
                Lunch
              </div>
              <div className="text-2xl font-serif text-[#FAF8F5]">
                {dashboard?.metrics.lunchCount ?? 0}
              </div>
              <div className="text-xs text-[#8E9F89] mt-1 flex items-center gap-1 font-mono">
                {dashboard?.plans.lunch ? (
                  <span className="text-emerald-400">Status: {dashboard.plans.lunch.status}</span>
                ) : (
                  <span className="text-[#8E9F89]/60">Not planned</span>
                )}
              </div>
            </div>

            <div className="bg-[#263B2D]/40 border border-[#8E9F89]/20 rounded-xl p-4">
              <div className="text-xs text-[#8E9F89] font-medium uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Moon className="w-3.5 h-3.5 text-blue-400" />
                Dinner
              </div>
              <div className="text-2xl font-serif text-[#FAF8F5]">
                {dashboard?.metrics.dinnerCount ?? 0}
              </div>
              <div className="text-xs text-[#8E9F89] mt-1 flex items-center gap-1 font-mono">
                {dashboard?.plans.dinner ? (
                  <span className="text-emerald-400">Status: {dashboard.plans.dinner.status}</span>
                ) : (
                  <span className="text-[#8E9F89]/60">Not planned</span>
                )}
              </div>
            </div>

            <div className="bg-[#263B2D]/40 border border-[#8E9F89]/20 rounded-xl p-4 col-span-2 md:col-span-1">
              <div className="text-xs text-[#8E9F89] font-medium uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[#B58A57]" />
                Eligible Residents
              </div>
              <div className="text-2xl font-serif text-[#FAF8F5]">
                {dashboard?.metrics.eligibleResidentsCount ?? 0}
              </div>
              <div className="text-xs text-[#8E9F89] mt-1 font-mono">
                Active stays on {selectedDate}
              </div>
            </div>
          </div>

          {/* Meal Service Cards: Breakfast, Lunch, Dinner */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(
              [
                { type: "BREAKFAST" as MealType, title: "Breakfast Service", icon: Coffee, iconColor: "text-amber-400", time: "07:30 - 09:30 AM" },
                { type: "LUNCH" as MealType, title: "Lunch Service", icon: Sun, iconColor: "text-orange-400", time: "12:30 - 02:30 PM" },
                { type: "DINNER" as MealType, title: "Dinner Service", icon: Moon, iconColor: "text-blue-400", time: "07:45 - 09:45 PM" },
              ] as const
            ).map(({ type, title, icon: Icon, iconColor, time }) => {
              const plan = dashboard?.plans[type.toLowerCase() as "breakfast" | "lunch" | "dinner"];

              return (
                <div
                  key={type}
                  className="bg-[#263B2D]/50 border border-[#8E9F89]/25 rounded-xl p-5 flex flex-col justify-between transition hover:border-[#8E9F89]/40"
                >
                  <div>
                    {/* Card Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/15">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-[#1A2E20] rounded-lg border border-[#8E9F89]/20">
                          <Icon className={`w-5 h-5 ${iconColor}`} />
                        </div>
                        <div>
                          <h3 className="font-serif text-lg text-[#FAF8F5] leading-tight">{title}</h3>
                          <span className="text-xs text-[#8E9F89] flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3" /> {time}
                          </span>
                        </div>
                      </div>

                      {/* Status Badge */}
                      {plan ? (
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-mono font-medium border ${
                            plan.status === "COMPLETED"
                              ? "bg-emerald-950/70 text-emerald-300 border-emerald-600/40"
                              : plan.status === "CONFIRMED"
                              ? "bg-blue-950/70 text-blue-300 border-blue-600/40"
                              : "bg-amber-950/70 text-amber-300 border-amber-600/40"
                          }`}
                        >
                          {plan.status}
                        </span>
                      ) : (
                        <span className="text-xs px-2.5 py-0.5 rounded-full font-mono bg-[#1A2E20] text-[#8E9F89]/70 border border-[#8E9F89]/20">
                          UNPLANNED
                        </span>
                      )}
                    </div>

                    {/* Card Body */}
                    {plan ? (
                      <div className="py-4 space-y-3">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs text-[#8E9F89] uppercase tracking-wider font-medium">
                            Preparation Quantity
                          </span>
                          <span className="text-3xl font-serif text-[#FAF8F5] font-semibold">
                            {plan.finalPreparationCount}
                            <span className="text-xs font-mono text-[#8E9F89] ml-1 font-normal">portions</span>
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 bg-[#1A2E20]/60 p-2.5 rounded-lg border border-[#8E9F89]/15 text-xs">
                          <div>
                            <span className="text-[#8E9F89] block">Residents Confirmed</span>
                            <span className="font-mono text-[#FAF8F5] font-medium text-sm">
                              {plan.plannedResidentCount}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#8E9F89] block">Guest / Extra Meals</span>
                            <span className="font-mono text-[#B58A57] font-medium text-sm">
                              +{plan.guestCount}
                            </span>
                          </div>
                        </div>

                        {plan.notes && (
                          <div className="text-xs bg-[#1A2E20]/40 p-2.5 rounded border border-[#8E9F89]/10 text-[#FAF8F5]">
                            <span className="text-[#B58A57] font-medium block text-[11px] uppercase tracking-wider mb-0.5">
                              Menu / Notes
                            </span>
                            {plan.notes}
                          </div>
                        )}

                        <div className="text-[11px] text-[#8E9F89] space-y-0.5 font-mono pt-1">
                          <div>Created by: {plan.createdByName || "Staff"}</div>
                          {plan.confirmedByName && <div>Confirmed by: {plan.confirmedByName}</div>}
                          {plan.completedByName && (
                            <div className="text-emerald-400">
                              Completed: {plan.completedByName} ({plan.completedAt?.slice(11, 16)} UTC)
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="py-8 text-center space-y-3">
                        <p className="text-sm text-[#8E9F89]">
                          No preparation plan created for {title.toLowerCase()} on this date.
                        </p>
                        <button
                          onClick={() => handleOpenCreateModal(type, selectedDate)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#B58A57] text-[#1A2E20] hover:bg-[#B58A57]/90 rounded text-xs font-medium transition shadow"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Create {title} Plan</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Card Actions Footer */}
                  {plan && (
                    <div className="pt-3 border-t border-[#8E9F89]/15 flex flex-wrap items-center justify-between gap-2">
                      <button
                        onClick={() => handleOpenPrepSheet(plan.id)}
                        className="inline-flex items-center gap-1 text-xs text-[#B58A57] hover:underline font-medium"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Prep Sheet</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        {plan.status === "DRAFT" && (
                          <>
                            <button
                              onClick={() => handleOpenEditModal(plan)}
                              className="px-2.5 py-1 bg-[#1A2E20] hover:bg-[#1A2E20]/80 text-[#FAF8F5] border border-[#8E9F89]/30 rounded text-xs font-medium transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleConfirmDirect(plan.id, title)}
                              disabled={actionLoading}
                              className="px-2.5 py-1 bg-[#B58A57] text-[#1A2E20] hover:bg-[#B58A57]/90 rounded text-xs font-medium transition"
                            >
                              Confirm
                            </button>
                          </>
                        )}

                        {plan.status === "CONFIRMED" && (
                          <>
                            <button
                              onClick={() => handleOpenAdjustModal(plan)}
                              className="px-2.5 py-1 bg-[#1A2E20] text-[#B58A57] hover:bg-[#1A2E20]/80 border border-[#B58A57]/40 rounded text-xs font-medium transition"
                            >
                              Adjust
                            </button>
                            <button
                              onClick={() => handleCompleteDirect(plan.id, title)}
                              disabled={actionLoading}
                              className="px-2.5 py-1 bg-emerald-800 text-[#FAF8F5] hover:bg-emerald-700 rounded text-xs font-medium transition"
                            >
                              Complete
                            </button>
                          </>
                        )}

                        {plan.status === "COMPLETED" && (
                          <button
                            onClick={() => handleOpenAdjustModal(plan)}
                            className="px-2.5 py-1 bg-[#1A2E20] text-[#8E9F89] hover:text-[#FAF8F5] border border-[#8E9F89]/30 rounded text-xs font-medium transition"
                          >
                            Correct Qty
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: PLAN HISTORY & EXPLORER */}
      {/* ========================================================================= */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-[#263B2D]/40 border border-[#8E9F89]/20 p-4 rounded-xl flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-[#8E9F89] font-medium">From:</span>
              <input
                type="date"
                value={historyStartDate}
                onChange={(e) => setHistoryStartDate(e.target.value)}
                className="bg-[#1A2E20] border border-[#8E9F89]/30 text-[#FAF8F5] px-2.5 py-1.5 rounded focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[#8E9F89] font-medium">To:</span>
              <input
                type="date"
                value={historyEndDate}
                onChange={(e) => setHistoryEndDate(e.target.value)}
                className="bg-[#1A2E20] border border-[#8E9F89]/30 text-[#FAF8F5] px-2.5 py-1.5 rounded focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[#8E9F89] font-medium">Meal:</span>
              <select
                value={historyMealType}
                onChange={(e) => setHistoryMealType(e.target.value)}
                className="bg-[#1A2E20] border border-[#8E9F89]/30 text-[#FAF8F5] px-2.5 py-1.5 rounded focus:outline-none"
              >
                <option value="ALL">All Meals</option>
                <option value="BREAKFAST">Breakfast</option>
                <option value="LUNCH">Lunch</option>
                <option value="DINNER">Dinner</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[#8E9F89] font-medium">Status:</span>
              <select
                value={historyStatus}
                onChange={(e) => setHistoryStatus(e.target.value)}
                className="bg-[#1A2E20] border border-[#8E9F89]/30 text-[#FAF8F5] px-2.5 py-1.5 rounded focus:outline-none"
              >
                <option value="ALL">All Statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>

            <button
              onClick={loadHistory}
              disabled={loading}
              className="ml-auto px-3 py-1.5 bg-[#B58A57] text-[#1A2E20] font-medium rounded hover:bg-[#B58A57]/90 transition"
            >
              Apply Filter
            </button>
          </div>

          {/* Historical Table */}
          <div className="bg-[#263B2D]/40 border border-[#8E9F89]/20 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[#FAF8F5]">
                <thead className="bg-[#1A2E20]/80 text-[#8E9F89] uppercase tracking-wider text-[11px] font-mono border-b border-[#8E9F89]/20">
                  <tr>
                    <th className="py-3 px-4">Service Date</th>
                    <th className="py-3 px-4">Meal Type</th>
                    <th className="py-3 px-4">Residents</th>
                    <th className="py-3 px-4">Guests</th>
                    <th className="py-3 px-4">Total Preparation</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Attribution</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#8E9F89]/10 font-sans">
                  {historyPlans.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-[#8E9F89]">
                        No meal plans found for the selected filter range.
                      </td>
                    </tr>
                  ) : (
                    historyPlans.map((plan) => (
                      <tr key={plan.id} className="hover:bg-[#1A2E20]/40 transition">
                        <td className="py-3 px-4 font-mono font-medium">{plan.serviceDate}</td>
                        <td className="py-3 px-4">
                          <span className="font-mono text-xs uppercase text-[#B58A57] font-semibold">
                            {plan.mealType}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono">{plan.plannedResidentCount}</td>
                        <td className="py-3 px-4 font-mono text-[#B58A57]">+{plan.guestCount}</td>
                        <td className="py-3 px-4 font-mono font-semibold text-[#FAF8F5]">
                          {plan.finalPreparationCount}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-mono border ${
                              plan.status === "COMPLETED"
                                ? "bg-emerald-950/70 text-emerald-300 border-emerald-600/40"
                                : plan.status === "CONFIRMED"
                                ? "bg-blue-950/70 text-blue-300 border-blue-600/40"
                                : "bg-amber-950/70 text-amber-300 border-amber-600/40"
                            }`}
                          >
                            {plan.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-[#8E9F89]">
                          <div>{plan.createdByName || "Staff"}</div>
                          {plan.completedByName && (
                            <div className="text-[10px] text-emerald-400 font-mono">
                              Done by: {plan.completedByName}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right space-x-2">
                          <button
                            onClick={() => handleOpenPrepSheet(plan.id)}
                            className="text-xs text-[#B58A57] hover:underline font-medium"
                          >
                            Prep Sheet
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: CREATE / EDIT DAILY MEAL PLAN */}
      {/* ========================================================================= */}
      {isPlanModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1A2E20] border border-[#8E9F89]/30 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl animate-fade-in">
            {/* Header */}
            <div className="p-5 border-b border-[#8E9F89]/20 flex items-center justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider text-[#B58A57] font-mono font-semibold">
                  {editingPlanId ? "Edit Meal Plan" : "New Daily Meal Plan"}
                </span>
                <h3 className="text-xl font-serif text-[#FAF8F5]">
                  {modalMealType} Service • {modalServiceDate}
                </h3>
              </div>
              <button
                onClick={() => setIsPlanModalOpen(false)}
                className="text-[#8E9F89] hover:text-[#FAF8F5] transition p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* Formula Preview Strip */}
              <div className="bg-[#263B2D]/80 border border-[#B58A57]/30 rounded-xl p-3.5 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[#8E9F89] block">Confirmed Residents</span>
                  <span className="text-lg font-serif text-[#FAF8F5] font-semibold">
                    {modalConfirmedResidents}
                  </span>
                  <span className="text-[10px] text-[#8E9F89] block">
                    ({modalEligibleTotal} eligible, {modalOptedOutTotal} opted out)
                  </span>
                </div>
                <div className="text-lg text-[#B58A57] font-bold">+</div>
                <div>
                  <span className="text-[#8E9F89] block">Guest / Extra Meals</span>
                  <span className="text-lg font-serif text-[#B58A57] font-semibold">
                    {Math.max(0, modalGuestCount)}
                  </span>
                </div>
                <div className="text-lg text-[#B58A57] font-bold">=</div>
                <div className="text-right">
                  <span className="text-[#8E9F89] block">Final Preparation Total</span>
                  <span className="text-2xl font-serif text-[#FAF8F5] font-bold text-emerald-400">
                    {modalFinalPreparationCount}
                  </span>
                  <span className="text-[10px] text-emerald-300 block font-mono">portions to cook</span>
                </div>
              </div>

              {/* Guest Count Input & Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#FAF8F5] mb-1">
                    Additional Guest / Extra Meals
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    value={modalGuestCount}
                    onChange={(e) => setModalGuestCount(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded-lg px-3 py-2 text-sm text-[#FAF8F5] font-mono focus:outline-none focus:border-[#B58A57]"
                    placeholder="0"
                  />
                  <span className="text-[11px] text-[#8E9F89] mt-0.5 block">
                    Staff meals, visitor portions, or buffer buffer quantity
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#FAF8F5] mb-1">
                    Menu & Preparation Notes
                  </label>
                  <input
                    type="text"
                    value={modalNotes}
                    onChange={(e) => setModalNotes(e.target.value)}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded-lg px-3 py-2 text-sm text-[#FAF8F5] focus:outline-none focus:border-[#B58A57]"
                    placeholder="e.g., Aloo Paratha, Curd, Pickle"
                  />
                  <span className="text-[11px] text-[#8E9F89] mt-0.5 block">
                    Special dietary notes or daily planned menu
                  </span>
                </div>
              </div>

              {/* Resident Attendance Opt-In / Opt-Out List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#FAF8F5]">
                    Eligible PG Residents ({modalEligibleResidents.length})
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => selectAllResidents(true)}
                      className="text-[#B58A57] hover:underline"
                    >
                      Opt-In All
                    </button>
                    <span className="text-[#8E9F89]/40">•</span>
                    <button
                      type="button"
                      onClick={() => selectAllResidents(false)}
                      className="text-[#8E9F89] hover:underline"
                    >
                      Opt-Out All
                    </button>
                  </div>
                </div>

                {modalLoadingEligibility ? (
                  <div className="py-8 text-center text-xs text-[#8E9F89]">
                    Loading eligible resident stay records...
                  </div>
                ) : modalEligibleResidents.length === 0 ? (
                  <div className="p-4 bg-[#263B2D]/40 rounded-lg text-center text-xs text-[#8E9F89]">
                    No active stays found covering {modalServiceDate}. Ensure residents are checked in.
                  </div>
                ) : (
                  <div className="border border-[#8E9F89]/20 rounded-lg overflow-hidden max-h-56 overflow-y-auto divide-y divide-[#8E9F89]/10">
                    {modalEligibleResidents.map((res) => {
                      const isOptedOut = modalOptOuts.has(res.residentId);
                      return (
                        <div
                          key={res.residentId}
                          onClick={() => toggleOptOut(res.residentId)}
                          className={`p-2.5 flex items-center justify-between text-xs cursor-pointer transition ${
                            isOptedOut
                              ? "bg-red-950/20 text-[#8E9F89]"
                              : "hover:bg-[#263B2D]/50 text-[#FAF8F5]"
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {isOptedOut ? (
                              <Square className="w-4 h-4 text-[#8E9F89]" />
                            ) : (
                              <CheckSquare className="w-4 h-4 text-emerald-400" />
                            )}
                            <div>
                              <span className="font-medium">{res.fullName}</span>
                              <span className="text-[#8E9F89] font-mono ml-2">
                                Room {res.roomNumber}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                              isOptedOut
                                ? "bg-red-900/30 text-red-300 border border-red-700/40"
                                : "bg-emerald-900/30 text-emerald-300 border border-emerald-700/40"
                            }`}
                          >
                            {isOptedOut ? "OPTED OUT" : "CONFIRMED"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-[#8E9F89]/20 flex items-center justify-between bg-[#1A2E20]">
              <button
                type="button"
                onClick={() => setIsPlanModalOpen(false)}
                className="px-4 py-2 text-xs text-[#8E9F89] hover:text-[#FAF8F5] transition"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSavePlan(false)}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-[#263B2D] border border-[#8E9F89]/30 text-[#FAF8F5] rounded-lg text-xs font-medium hover:bg-[#263B2D]/80 transition"
                >
                  Save as Draft
                </button>
                <button
                  type="button"
                  onClick={() => handleSavePlan(true)}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-[#B58A57] text-[#1A2E20] rounded-lg text-xs font-medium hover:bg-[#B58A57]/90 transition font-semibold"
                >
                  Confirm Plan ({modalFinalPreparationCount} Portions)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: ADJUST PLAN QUANTITY (AUDIT-LOGGED) */}
      {/* ========================================================================= */}
      {isAdjustModalOpen && adjustingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1A2E20] border border-[#8E9F89]/30 rounded-2xl w-full max-w-md shadow-2xl animate-fade-in p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
              <div>
                <span className="text-xs uppercase tracking-wider text-[#B58A57] font-mono font-semibold">
                  Auditable Correction
                </span>
                <h3 className="text-lg font-serif text-[#FAF8F5]">
                  Adjust Quantity • {adjustingPlan.mealType}
                </h3>
              </div>
              <button
                onClick={() => setIsAdjustModalOpen(false)}
                className="text-[#8E9F89] hover:text-[#FAF8F5]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#263B2D]/60 p-3 rounded-lg border border-[#8E9F89]/20 text-xs flex justify-between">
              <div>
                <span className="text-[#8E9F89] block">Current Count:</span>
                <span className="font-mono text-[#FAF8F5] text-sm font-semibold">
                  {adjustingPlan.finalPreparationCount} Portions
                </span>
              </div>
              <div className="text-right">
                <span className="text-[#8E9F89] block">New Total:</span>
                <span className="font-mono text-emerald-400 text-sm font-semibold">
                  {adjustResidentCount + adjustGuestCount} Portions
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#FAF8F5] mb-1">Resident Count</label>
                <input
                  type="number"
                  min="0"
                  value={adjustResidentCount}
                  onChange={(e) => setAdjustResidentCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded-lg px-3 py-2 text-sm text-[#FAF8F5] font-mono focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#FAF8F5] mb-1">Guest Meals</label>
                <input
                  type="number"
                  min="0"
                  value={adjustGuestCount}
                  onChange={(e) => setAdjustGuestCount(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded-lg px-3 py-2 text-sm text-[#FAF8F5] font-mono focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#FAF8F5] mb-1">
                Mandatory Reason for Adjustment *
              </label>
              <textarea
                rows={3}
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded-lg p-2.5 text-xs text-[#FAF8F5] focus:outline-none focus:border-[#B58A57]"
                placeholder="e.g., 2 additional guests joined dinner; emergency resident late request."
              />
              <span className="text-[11px] text-[#8E9F89]">
                Minimum 5 characters. This adjustment is immutably logged in the kitchen ledger.
              </span>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAdjustModalOpen(false)}
                className="px-3 py-1.5 text-xs text-[#8E9F89] hover:text-[#FAF8F5]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAdjustment}
                disabled={actionLoading}
                className="px-4 py-2 bg-[#B58A57] text-[#1A2E20] font-medium text-xs rounded-lg hover:bg-[#B58A57]/90 transition"
              >
                Record Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: PRINTABLE KITCHEN PREPARATION SHEET */}
      {/* ========================================================================= */}
      {isPrepSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#1A2E20] border border-[#8E9F89]/30 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl animate-fade-in">
            {/* Header */}
            <div className="p-4 border-b border-[#8E9F89]/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-[#B58A57]" />
                <h3 className="text-lg font-serif text-[#FAF8F5]">Kitchen Daily Preparation Sheet</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="px-3 py-1.5 bg-[#B58A57] text-[#1A2E20] rounded text-xs font-semibold hover:bg-[#B58A57]/90 transition flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Sheet</span>
                </button>
                <button
                  onClick={() => setIsPrepSheetOpen(false)}
                  className="text-[#8E9F89] hover:text-[#FAF8F5] p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Printable Document Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 text-[#FAF8F5]">
              {prepSheetLoading ? (
                <div className="py-12 text-center text-sm text-[#8E9F89]">
                  Loading preparation sheet data...
                </div>
              ) : !prepSheetData ? (
                <div className="py-12 text-center text-sm text-red-400">
                  Failed to load preparation sheet.
                </div>
              ) : (
                <div className="space-y-6 font-sans">
                  {/* Document Title Header */}
                  <div className="border-b-2 border-[#B58A57] pb-4 text-center">
                    <span className="text-xs font-mono uppercase tracking-widest text-[#B58A57] font-semibold">
                      Ravinarayan PG Guesthouse • Met City / Yakubpur
                    </span>
                    <h2 className="text-2xl font-serif text-[#FAF8F5] mt-0.5">
                      {prepSheetData.summary.mealType} PREPARATION SHEET
                    </h2>
                    <div className="flex justify-center items-center gap-4 text-xs font-mono text-[#8E9F89] mt-1">
                      <span>Service Date: {prepSheetData.summary.serviceDate}</span>
                      <span>•</span>
                      <span>Plan Status: {prepSheetData.summary.status}</span>
                      <span>•</span>
                      <span>Generated: {new Date().toISOString().slice(0, 16)} UTC</span>
                    </div>
                  </div>

                  {/* Highlight Totals Strip */}
                  <div className="grid grid-cols-4 gap-3 bg-[#263B2D]/60 border border-[#8E9F89]/30 rounded-xl p-4 text-center">
                    <div>
                      <span className="text-xs text-[#8E9F89] block">Eligible Residents</span>
                      <span className="text-xl font-serif text-[#FAF8F5] font-semibold">
                        {prepSheetData.summary.eligibleResidentCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-[#8E9F89] block">Confirmed Residents</span>
                      <span className="text-xl font-serif text-[#FAF8F5] font-semibold">
                        {prepSheetData.summary.confirmedResidentCount}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-[#8E9F89] block">Guest Meals</span>
                      <span className="text-xl font-serif text-[#B58A57] font-semibold">
                        +{prepSheetData.summary.guestCount}
                      </span>
                    </div>
                    <div className="border-l border-[#8E9F89]/30 pl-3">
                      <span className="text-xs text-[#8E9F89] block uppercase tracking-wider font-medium">
                        Total to Cook
                      </span>
                      <span className="text-2xl font-serif text-emerald-400 font-bold">
                        {prepSheetData.summary.finalPreparationCount}
                      </span>
                    </div>
                  </div>

                  {/* Notes / Planned Menu */}
                  {prepSheetData.plan.notes && (
                    <div className="bg-[#263B2D]/40 border border-[#8E9F89]/20 p-3.5 rounded-lg text-xs">
                      <span className="text-[#B58A57] uppercase tracking-wider font-semibold block mb-1">
                        Planned Menu & Dietary Instructions
                      </span>
                      <p className="text-[#FAF8F5]">{prepSheetData.plan.notes}</p>
                    </div>
                  )}

                  {/* Resident Roster Table */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-mono uppercase tracking-wider text-[#8E9F89] font-medium">
                      Resident Attendance Breakdown ({prepSheetData.residentRecords.length} Eligible)
                    </h4>
                    <div className="border border-[#8E9F89]/20 rounded-lg overflow-hidden">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#263B2D] text-[#8E9F89] font-mono border-b border-[#8E9F89]/20">
                          <tr>
                            <th className="py-2 px-3">Room</th>
                            <th className="py-2 px-3">Resident Name</th>
                            <th className="py-2 px-3">Status</th>
                            <th className="py-2 px-3 text-right">Attended / Served</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#8E9F89]/10 font-sans">
                          {prepSheetData.residentRecords.map((r) => (
                            <tr key={r.id} className={r.status === "OPTED_OUT" ? "opacity-50" : ""}>
                              <td className="py-2 px-3 font-mono font-medium">
                                Room {r.roomNumber || "N/A"}
                              </td>
                              <td className="py-2 px-3 font-medium">{r.residentName}</td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                                    r.status === "CONFIRMED"
                                      ? "bg-emerald-950 text-emerald-300 border border-emerald-700/40"
                                      : "bg-red-950 text-red-300 border border-red-700/40"
                                  }`}
                                >
                                  {r.status}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right">
                                <span className="inline-block w-4 h-4 border border-[#8E9F89]/40 rounded" />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Adjustments Trail (if any) */}
                  {prepSheetData.adjustments.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-xs font-mono uppercase tracking-wider text-[#B58A57] font-medium">
                        Audited Quantity Adjustments ({prepSheetData.adjustments.length})
                      </h4>
                      <div className="border border-[#8E9F89]/20 rounded-lg divide-y divide-[#8E9F89]/10 text-xs">
                        {prepSheetData.adjustments.map((adj) => (
                          <div key={adj.id} className="p-2.5 flex justify-between">
                            <div>
                              <span className="font-semibold text-[#FAF8F5]">
                                {adj.previousTotal} → {adj.newTotal} Portions
                              </span>
                              <p className="text-[#8E9F89] mt-0.5">Reason: {adj.reason}</p>
                            </div>
                            <div className="text-right text-[11px] text-[#8E9F89] font-mono">
                              <div>By: {adj.createdByName || "Staff"}</div>
                              <div>{adj.createdAt.slice(0, 16)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Signature Blocks for Kitchen Handover */}
                  <div className="pt-6 border-t border-[#8E9F89]/30 grid grid-cols-3 gap-6 text-center text-xs text-[#8E9F89]">
                    <div>
                      <div className="h-10 border-b border-dashed border-[#8E9F89]/40" />
                      <span className="block mt-1 font-mono">Kitchen In-Charge Signature</span>
                    </div>
                    <div>
                      <div className="h-10 border-b border-dashed border-[#8E9F89]/40" />
                      <span className="block mt-1 font-mono">Cook Handover Verified</span>
                    </div>
                    <div>
                      <div className="h-10 border-b border-dashed border-[#8E9F89]/40" />
                      <span className="block mt-1 font-mono">Delivery / Service Lead</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
