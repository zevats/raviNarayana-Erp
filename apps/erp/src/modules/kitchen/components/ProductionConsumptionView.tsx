"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  UtensilsCrossed,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  RotateCcw,
  Check,
  X,
  Layers,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import {
  DailyMealPlan,
  ProductionConsumptionPreview,
  KitchenProductionConsumption,
  MealType,
} from "@/types";
import { businessToday, addBusinessDays } from "@/lib/businessDate";

interface ProductionConsumptionViewProps {
  onNotify?: (msg: string) => void;
}

export default function ProductionConsumptionView({ onNotify }: ProductionConsumptionViewProps) {
  const todayStr = businessToday();
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  const [plans, setPlans] = useState<DailyMealPlan[]>([]);
  const [previews, setPreviews] = useState<Record<string, ProductionConsumptionPreview>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Reversal modal
  const [isReverseModalOpen, setIsReverseModalOpen] = useState<boolean>(false);
  const [reversingPlanId, setReversingPlanId] = useState<string | null>(null);
  const [reversalReason, setReversalReason] = useState<string>("");
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/kitchen/plans?serviceDate=${selectedDate}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load meal plans");

      const mealPlans: DailyMealPlan[] = data.plans || [];
      setPlans(mealPlans);

      // Load preview for each meal plan in parallel
      const previewMap: Record<string, ProductionConsumptionPreview> = {};
      await Promise.all(
        mealPlans.map(async (p) => {
          try {
            const pRes = await fetch(`/api/kitchen/consumption/preview?planId=${p.id}`);
            const pData = await pRes.json();
            if (pRes.ok && pData.preview) {
              previewMap[p.id] = pData.preview;
            }
          } catch {
            // ignore individual preview failures
          }
        })
      );
      setPreviews(previewMap);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stepDate = (days: number) => {
    setSelectedDate(addBusinessDays(selectedDate, days));
  };

  const handleConfirmConsumption = async (planId: string, mealType: string) => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kitchen/consumption/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "INSUFFICIENT_STOCK") {
          throw new Error(
            `Insufficient stock to confirm: ${data.shortages?.map((s: any) => `${s.materialName} (short by ${s.shortage})`).join(", ")}`
          );
        }
        throw new Error(data.error || "Failed to confirm consumption");
      }

      onNotify?.(`Production ingredient consumption posted for ${mealType}.`);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openReverseModal = (planId: string) => {
    setReversingPlanId(planId);
    setReversalReason("");
    setIsReverseModalOpen(true);
  };

  const handleReverseConsumption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversingPlanId || !reversalReason.trim()) return;

    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/kitchen/consumption/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: reversingPlanId,
          reason: reversalReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reverse consumption");

      onNotify?.("Production consumption reversed and inventory balances restored.");
      setIsReverseModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center justify-between bg-red-900/30 border border-red-500/50 text-red-200 px-4 py-3 rounded-lg text-sm">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Date Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#8E9F89]/20 pb-4">
        <div>
          <h2 className="text-lg font-serif text-[#FAF8F5]">Recipe-Based Production Consumption</h2>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-[#263B2D]/70 border border-[#8E9F89]/30 rounded-lg p-1 text-xs text-[#FAF8F5]">
            <button
              onClick={() => stepDate(-1)}
              className="p-1 hover:bg-[#1A2E20] rounded text-[#8E9F89] hover:text-[#FAF8F5] transition"
              title="Previous Day"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-2 px-3 font-mono font-medium">
              <Calendar className="w-3.5 h-3.5 text-[#B58A57]" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent border-0 text-[#FAF8F5] text-xs focus:outline-none cursor-pointer"
              />
            </div>
            <button
              onClick={() => stepDate(1)}
              className="p-1 hover:bg-[#1A2E20] rounded text-[#8E9F89] hover:text-[#FAF8F5] transition"
              title="Next Day"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {selectedDate !== todayStr && (
              <button
                onClick={() => setSelectedDate(todayStr)}
                className="ml-1 px-2 py-0.5 text-[10px] bg-[#B58A57]/20 text-[#B58A57] hover:bg-[#B58A57]/30 rounded transition font-medium"
              >
                Today
              </button>
            )}
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 bg-[#263B2D]/70 border border-[#8E9F89]/30 text-[#8E9F89] hover:text-[#FAF8F5] rounded-lg transition"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Meal Plans Grid */}
      <div className="space-y-6">
        {plans.length === 0 ? (
          <div className="bg-[#1A2E20]/40 border border-[#8E9F89]/20 rounded-xl p-8 text-center text-[#8E9F89]">
            <UtensilsCrossed className="w-8 h-8 text-[#8E9F89]/40 mx-auto mb-2" />
            <p className="text-sm">No meal plans scheduled for {selectedDate}.</p>
            <p className="text-xs text-[#8E9F89]/60 mt-1">
              Create and complete a daily meal plan to preview and post ingredient consumption.
            </p>
          </div>
        ) : (
          plans.map((plan) => {
            const preview = previews[plan.id];
            const isCompleted = plan.status === "COMPLETED";
            const actualCooked = plan.actualCookedCount || 0;
            const hasExisting = preview?.existingConsumption !== null;

            return (
              <div
                key={plan.id}
                className="bg-[#1A2E20]/60 border border-[#8E9F89]/20 rounded-xl overflow-hidden shadow-lg"
              >
                {/* Header */}
                <div className="p-4 bg-[#263B2D]/50 border-b border-[#8E9F89]/20 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-serif text-lg font-semibold text-[#FAF8F5]">{plan.mealType}</span>
                    <span
                      className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
                        plan.status === "COMPLETED"
                          ? "bg-emerald-950 border border-emerald-600/40 text-emerald-300"
                          : plan.status === "CONFIRMED"
                          ? "bg-blue-950 border border-blue-600/40 text-blue-300"
                          : "bg-[#263B2D] border border-[#8E9F89]/40 text-[#8E9F89]"
                      }`}
                    >
                      {plan.status}
                    </span>

                    {preview?.recipe && (
                      <span className="text-xs text-[#B58A57] font-medium">
                        Recipe: {preview.recipe.name} (v{preview.recipe.version})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="text-[#8E9F89]">
                      Planned: <span className="text-[#FAF8F5] font-semibold">{plan.finalPreparationCount}</span>
                    </div>
                    <div className="text-[#8E9F89]">
                      Authoritative Cooked:{" "}
                      <span
                        className={`font-bold ${
                          isCompleted && actualCooked > 0 ? "text-emerald-400" : "text-amber-400"
                        }`}
                      >
                        {actualCooked > 0 ? `${actualCooked} portions` : "Not Reconciled"}
                      </span>
                    </div>

                    {/* Status / Confirm / Reverse Buttons */}
                    {hasExisting ? (
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 px-2.5 py-1 bg-emerald-950 border border-emerald-600/40 text-emerald-300 rounded text-xs font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Consumption Posted</span>
                        </span>
                        <button
                          onClick={() => openReverseModal(plan.id)}
                          disabled={actionLoading}
                          className="flex items-center gap-1 px-2.5 py-1 bg-rose-950/60 border border-rose-600/40 text-rose-300 hover:bg-rose-900/60 rounded text-xs font-semibold transition"
                          title="Reverse and correct posted consumption"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reverse</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleConfirmConsumption(plan.id, plan.mealType)}
                        disabled={!preview?.canConfirm || actionLoading}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition ${
                          preview?.canConfirm
                            ? "bg-[#B58A57] text-[#1A2E20] hover:bg-[#B58A57]/90 cursor-pointer shadow-md"
                            : "bg-[#263B2D] text-[#8E9F89] border border-[#8E9F89]/20 cursor-not-allowed opacity-60"
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Confirm Consumption</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Body / Ingredients Preview */}
                <div className="p-4 space-y-3">
                  {!isCompleted && (
                    <div className="flex items-center gap-2 bg-amber-950/30 border border-amber-600/30 rounded-lg p-3 text-xs text-amber-200">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>
                        Plan is currently in <strong>{plan.status}</strong> status. Production reconciliation is required to record the authoritative cooked count before consumption can be confirmed.
                      </span>
                    </div>
                  )}

                  {!preview?.recipe && (
                    <div className="flex items-center gap-2 bg-rose-950/30 border border-rose-600/30 rounded-lg p-3 text-xs text-rose-200">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>
                        No active recipe configured for meal type <strong>{plan.mealType}</strong>. Create a recipe under the Recipes tab to calculate ingredient consumption.
                      </span>
                    </div>
                  )}

                  {preview?.hasShortages && (
                    <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-600/40 rounded-lg p-3 text-xs text-rose-200">
                      <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>
                        One or more ingredients have insufficient inventory balance. Record a stock replenishment receipt to clear shortages before confirming.
                      </span>
                    </div>
                  )}

                  {preview?.ingredients && preview.ingredients.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs text-[#FAF8F5]">
                        <thead className="bg-[#263B2D]/40 text-[#8E9F89] uppercase font-mono text-[10px]">
                          <tr>
                            <th className="p-2">Ingredient Material</th>
                            <th className="p-2">Category</th>
                            <th className="p-2">Per Portion</th>
                            <th className="p-2">Total Required</th>
                            <th className="p-2">Available in Stock</th>
                            <th className="p-2">Stock Sufficiency</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#8E9F89]/10 font-mono text-[11px]">
                          {preview.ingredients.map((ing) => (
                            <tr key={ing.materialId} className="hover:bg-[#263B2D]/20">
                              <td className="p-2 font-sans font-semibold">
                                {ing.materialName}{" "}
                                <span className="text-[10px] text-[#B58A57] font-mono">({ing.materialCode})</span>
                              </td>
                              <td className="p-2 text-[#8E9F89] font-sans">{ing.category}</td>
                              <td className="p-2 text-[#8E9F89]">
                                {ing.quantityPerServingBase.toFixed(1)} {ing.baseUnit}
                              </td>
                              <td className="p-2 font-bold text-[#FAF8F5]">
                                {ing.requiredQuantityBase.toLocaleString()} {ing.baseUnit}
                              </td>
                              <td className="p-2 text-[#FAF8F5]">
                                {ing.currentStockBase.toLocaleString()} {ing.baseUnit}
                              </td>
                              <td className="p-2">
                                {ing.isSufficient ? (
                                  <span className="flex items-center gap-1 text-emerald-400 font-semibold text-[10px]">
                                    <Check className="w-3 h-3" />
                                    <span>Sufficient</span>
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 text-rose-400 font-bold text-[10px]">
                                    <AlertTriangle className="w-3 h-3" />
                                    <span>Short by {ing.shortageBase.toLocaleString()} {ing.baseUnit}</span>
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Existing Consumption Meta */}
                  {preview?.existingConsumption && (
                    <div className="bg-[#1A2E20] border border-[#8E9F89]/20 rounded-lg p-3 text-xs text-[#8E9F89] flex flex-wrap items-center justify-between gap-2">
                      <div>
                        Posted by{" "}
                        <span className="text-[#FAF8F5] font-semibold">
                          {preview.existingConsumption.postedByName || preview.existingConsumption.postedBy}
                        </span>{" "}
                        on{" "}
                        <span className="font-mono text-[#FAF8F5]">
                          {new Date(preview.existingConsumption.postedAt).toLocaleString("en-IN")}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-[#B58A57]">
                        Ref: {preview.existingConsumption.id}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* REVERSAL MODAL */}
      {isReverseModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#1A2E20] border border-rose-600/40 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#8E9F89]/20 pb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-rose-400" />
                <h2 className="text-lg font-serif text-[#FAF8F5]">Reverse Production Consumption</h2>
              </div>
              <button onClick={() => setIsReverseModalOpen(false)} className="text-[#8E9F89] hover:text-[#FAF8F5]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[#8E9F89]">
              Reversing this consumption will generate compensating stock movements and restore the exact deducted ingredient quantities back to raw material balances.
            </p>
            <form onSubmit={handleReverseConsumption} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">
                  Mandatory Reversal / Correction Reason
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production quantity adjusted after reconciliation audit"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-rose-400"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[#8E9F89]/20">
                <button
                  type="button"
                  onClick={() => setIsReverseModalOpen(false)}
                  className="px-4 py-2 bg-[#263B2D] text-[#8E9F89] hover:text-[#FAF8F5] rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-rose-600 text-white font-semibold rounded hover:bg-rose-500 transition"
                >
                  {actionLoading ? "Reversing..." : "Confirm Reversal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
