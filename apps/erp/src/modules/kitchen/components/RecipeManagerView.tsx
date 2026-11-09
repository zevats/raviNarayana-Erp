"use client";

import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect, useCallback } from "react";
import {
  Utensils,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  Layers,
  Sparkles,
  BookOpen,
} from "lucide-react";
import {
  KitchenRecipe,
  KitchenRecipeIngredient,
  KitchenRawMaterial,
  MealType,
} from "@/types";

interface RecipeManagerViewProps {
  onNotify?: (msg: string) => void;
}

export default function RecipeManagerView({ onNotify }: RecipeManagerViewProps) {
  const [recipes, setRecipes] = useState<KitchenRecipe[]>([]);
  const [materials, setMaterials] = useState<KitchenRawMaterial[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedMealType, setSelectedMealType] = useState<string>("ALL");
  const [expandedRecipeIds, setExpandedRecipeIds] = useState<Set<string>>(new Set());

  // Modal
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingRecipe, setEditingRecipe] = useState<KitchenRecipe | null>(null);
  const [formName, setFormName] = useState<string>("");
  const [formDescription, setFormDescription] = useState<string>("");
  const [formMealType, setFormMealType] = useState<MealType | "">("LUNCH");
  const [formYieldServings, setFormYieldServings] = useState<number>(1);
  const [formIngredients, setFormIngredients] = useState<
    Array<{
      materialId: string;
      quantity: number;
      unit: string;
      lossPercent: number;
      notes: string;
    }>
  >([]);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qParams = new URLSearchParams();
      if (selectedMealType !== "ALL") qParams.set("mealType", selectedMealType);

      const [recRes, matRes] = await Promise.all([
        fetch(`/api/kitchen/recipes?${qParams.toString()}`),
        fetch("/api/kitchen/inventory/materials?isActive=true"),
      ]);

      const recData = await recRes.json();
      const matData = await matRes.json();

      if (!recRes.ok) throw new Error(recData.error || "Failed to load recipes");
      if (!matRes.ok) throw new Error(matData.error || "Failed to load raw materials");

      setRecipes(recData.recipes || []);
      setMaterials(matData.materials || []);

      // Auto-expand first recipe
      if (recData.recipes && recData.recipes.length > 0) {
        setExpandedRecipeIds(new Set([recData.recipes[0].id]));
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedMealType]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleExpand = (id: string) => {
    setExpandedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreateModal = () => {
    setEditingRecipe(null);
    setFormName("");
    setFormDescription("");
    setFormMealType("LUNCH");
    setFormYieldServings(1);
    setFormIngredients([
      {
        materialId: materials[0]?.id || "",
        quantity: 100,
        unit: materials[0]?.baseUnit === "G" ? "G" : "PCS",
        lossPercent: 0,
        notes: "",
      },
    ]);
    setIsModalOpen(true);
  };

  const openEditModal = (recipe: KitchenRecipe) => {
    setEditingRecipe(recipe);
    setFormName(recipe.name);
    setFormDescription(recipe.description || "");
    setFormMealType(recipe.mealType || "");
    setFormYieldServings(recipe.yieldServings);
    setFormIngredients(
      (recipe.ingredients || []).map((ing) => ({
        materialId: ing.materialId,
        quantity: ing.displayQuantity,
        unit: ing.displayUnit,
        lossPercent: ing.lossPercent,
        notes: ing.notes || "",
      }))
    );
    setIsModalOpen(true);
  };

  const addIngredientLine = () => {
    setFormIngredients((prev) => [
      ...prev,
      {
        materialId: materials[0]?.id || "",
        quantity: 100,
        unit: materials[0]?.baseUnit === "G" ? "G" : "PCS",
        lossPercent: 0,
        notes: "",
      },
    ]);
  };

  const removeIngredientLine = (index: number) => {
    setFormIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  const updateIngredientLine = (index: number, field: string, value: any) => {
    setFormIngredients((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const updated = { ...item, [field]: value };
        if (field === "materialId") {
          const selectedMat = materials.find((m) => m.id === value);
          if (selectedMat) {
            updated.unit = selectedMat.baseUnit === "G" ? "G" : selectedMat.baseUnit === "ML" ? "ML" : "PCS";
          }
        }
        return updated;
      })
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formIngredients.length === 0) {
      setError("At least one ingredient line is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name: formName,
        description: formDescription,
        mealType: formMealType || null,
        yieldServings: formYieldServings,
        ingredients: formIngredients.map((ing) => ({
          materialId: ing.materialId,
          quantity: Number(ing.quantity),
          unit: ing.unit,
          lossPercent: Number(ing.lossPercent || 0),
          notes: ing.notes,
        })),
      };

      if (editingRecipe) {
        const res = await fetch(`/api/kitchen/recipes/${editingRecipe.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update recipe");
        onNotify?.(`Recipe '${data.recipe.name}' updated to version ${data.recipe.version}.`);
      } else {
        const res = await fetch("/api/kitchen/recipes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create recipe");
        onNotify?.(`Recipe '${data.recipe.name}' created successfully.`);
      }

      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
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

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[#B58A57]" />
          <span className="text-sm font-semibold text-[#FAF8F5]">Recipe Catalogue & Formulation</span>
          <span className="text-xs bg-[#263B2D] px-2 py-0.5 rounded text-[#8E9F89] font-mono">
            {recipes.length} standard recipe{recipes.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <AppSelect
            value={selectedMealType}
            onChange={(e) => setSelectedMealType(e.target.value)}
            className="bg-[#1A2E20] border border-[#8E9F89]/30 rounded-lg px-3 py-1.5 text-xs text-[#FAF8F5] focus:outline-none focus:border-[#B58A57]"
          >
            <option value="ALL">All Meal Types</option>
            <option value="BREAKFAST">Breakfast</option>
            <option value="LUNCH">Lunch</option>
            <option value="DINNER">Dinner</option>
          </AppSelect>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 bg-[#263B2D]/70 border border-[#8E9F89]/30 text-[#8E9F89] hover:text-[#FAF8F5] rounded-lg transition"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#B58A57] text-[#1A2E20] hover:bg-[#B58A57]/90 rounded-lg text-xs font-semibold transition"
          >
            <Plus className="w-4 h-4" />
            <span>Create Recipe</span>
          </button>
        </div>
      </div>

      {/* Recipes Cards List */}
      <div className="space-y-4">
        {recipes.length === 0 ? (
          <div className="bg-[#1A2E20]/40 border border-[#8E9F89]/20 rounded-xl p-8 text-center text-[#8E9F89]">
            <Utensils className="w-8 h-8 text-[#8E9F89]/40 mx-auto mb-2" />
            <p className="text-sm">No recipes defined yet.</p>
            <p className="text-xs text-[#8E9F89]/60 mt-1">
              Add standard recipes for Breakfast, Lunch, and Dinner to automate production consumption tracking.
            </p>
          </div>
        ) : (
          recipes.map((recipe) => {
            const isExpanded = expandedRecipeIds.has(recipe.id);
            return (
              <div
                key={recipe.id}
                className="bg-[#1A2E20]/60 border border-[#8E9F89]/20 rounded-xl overflow-hidden transition"
              >
                {/* Header */}
                <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#263B2D]/40">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleExpand(recipe.id)}
                      className="p-1 text-[#8E9F89] hover:text-[#FAF8F5] transition mt-0.5"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-serif text-base text-[#FAF8F5] font-semibold">{recipe.name}</span>
                        {recipe.mealType && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-[#B58A57]/20 border border-[#B58A57]/40 text-[#B58A57]">
                            {recipe.mealType}
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-[#1A2E20] border border-[#8E9F89]/30 text-[#8E9F89]">
                          v{recipe.version}
                        </span>
                      </div>
                      {recipe.description && (
                        <p className="text-xs text-[#8E9F89] mt-0.5">{recipe.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs font-mono">
                    <div className="text-[#8E9F89]">
                      Yield: <span className="text-[#FAF8F5] font-semibold">{recipe.yieldServings} portion(s)</span>
                    </div>
                    <div className="text-[#8E9F89]">
                      Ingredients:{" "}
                      <span className="text-[#FAF8F5] font-semibold">{recipe.ingredients?.length || 0} items</span>
                    </div>
                    <button
                      onClick={() => openEditModal(recipe)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-[#263B2D] border border-[#8E9F89]/30 text-[#8E9F89] hover:text-[#FAF8F5] rounded text-xs transition"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Edit & Revise</span>
                    </button>
                  </div>
                </div>

                {/* Expanded Ingredients Table */}
                {isExpanded && (
                  <div className="p-4 border-t border-[#8E9F89]/10">
                    <table className="w-full text-left text-xs text-[#FAF8F5]">
                      <thead className="bg-[#263B2D]/40 text-[#8E9F89] uppercase font-mono text-[10px]">
                        <tr>
                          <th className="p-2">Material / Code</th>
                          <th className="p-2">Category</th>
                          <th className="p-2">Display Quantity</th>
                          <th className="p-2">Canonical Qty (Base)</th>
                          <th className="p-2">Qty / Portion</th>
                          <th className="p-2">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#8E9F89]/10 font-mono text-[11px]">
                        {recipe.ingredients && recipe.ingredients.length > 0 ? (
                          recipe.ingredients.map((ing) => {
                            const perServing = (ing.quantityBase / recipe.yieldServings).toFixed(1);
                            return (
                              <tr key={ing.id} className="hover:bg-[#263B2D]/20">
                                <td className="p-2 font-sans font-semibold">
                                  {ing.materialName}{" "}
                                  <span className="text-[10px] text-[#B58A57] font-mono">({ing.materialCode})</span>
                                </td>
                                <td className="p-2 text-[#8E9F89] font-sans">{ing.category}</td>
                                <td className="p-2 font-bold text-emerald-400">
                                  {ing.displayQuantity} {ing.displayUnit}
                                </td>
                                <td className="p-2 text-[#FAF8F5]">
                                  {ing.quantityBase.toLocaleString()} {ing.baseUnit}
                                </td>
                                <td className="p-2 text-[#B58A57] font-bold">
                                  {perServing} {ing.baseUnit}
                                </td>
                                <td className="p-2 text-[#8E9F89] font-sans">{ing.notes || "—"}</td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={6} className="p-4 text-center text-[#8E9F89] font-sans">
                              No ingredient lines configured for this recipe.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* CREATE / EDIT MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#1A2E20] border border-[#B58A57]/40 rounded-xl p-6 max-w-2xl w-full max-h-[90dvh] overflow-y-auto shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#8E9F89]/20 pb-3">
              <div>
                <h2 className="text-lg font-serif text-[#FAF8F5]">
                  {editingRecipe ? `Revise Recipe: ${editingRecipe.name} (v${editingRecipe.version + 1})` : "Create New Recipe"}
                </h2>
                <p className="text-xs text-[#8E9F89]">
                  {editingRecipe
                    ? "Editing ingredient lines creates a new version snapshot to preserve past production batches."
                    : "Standardize ingredients and quantities per serving."}
                </p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-[#8E9F89] hover:text-[#FAF8F5]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Recipe Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Standard PG Lunch Thali"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                  />
                </div>
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Meal Service</label>
                  <AppSelect
                    value={formMealType}
                    onChange={(e) => setFormMealType(e.target.value as MealType | "")}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                  >
                    <option value="">General (All)</option>
                    <option value="BREAKFAST">Breakfast</option>
                    <option value="LUNCH">Lunch</option>
                    <option value="DINNER">Dinner</option>
                  </AppSelect>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">
                    Yield Servings / Portions
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formYieldServings}
                    onChange={(e) => setFormYieldServings(Number(e.target.value))}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Description</label>
                  <input
                    type="text"
                    placeholder="e.g. 4 rotis, rice, dal, subzi, salad"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                  />
                </div>
              </div>

              {/* Dynamic Ingredient Lines */}
              <div className="space-y-2 pt-2 border-t border-[#8E9F89]/20">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-[#FAF8F5] uppercase tracking-wider font-mono">
                    Ingredients ({formIngredients.length})
                  </span>
                  <button
                    type="button"
                    onClick={addIngredientLine}
                    className="flex items-center gap-1 text-[#B58A57] hover:text-[#B58A57]/80 text-xs font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Ingredient</span>
                  </button>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {formIngredients.map((ing, idx) => {
                    const selectedMat = materials.find((m) => m.id === ing.materialId);
                    return (
                      <div key={idx} className="flex items-center gap-2 bg-[#263B2D]/50 p-2 rounded border border-[#8E9F89]/20">
                        <div className="flex-1">
                          <AppSelect
                            value={ing.materialId}
                            onChange={(e) => updateIngredientLine(idx, "materialId", e.target.value)}
                            className="w-full bg-[#1A2E20] border border-[#8E9F89]/30 rounded p-1.5 text-xs text-[#FAF8F5]"
                          >
                            {materials.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.code}) - {m.baseUnit}
                              </option>
                            ))}
                          </AppSelect>
                        </div>
                        <div className="w-24">
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            required
                            placeholder="Qty"
                            value={ing.quantity}
                            onChange={(e) => updateIngredientLine(idx, "quantity", Number(e.target.value))}
                            className="w-full bg-[#1A2E20] border border-[#8E9F89]/30 rounded p-1.5 text-xs text-[#FAF8F5] font-mono"
                          />
                        </div>
                        <div className="w-20">
                          <AppSelect
                            value={ing.unit}
                            onChange={(e) => updateIngredientLine(idx, "unit", e.target.value)}
                            className="w-full bg-[#1A2E20] border border-[#8E9F89]/30 rounded p-1.5 text-xs text-[#FAF8F5]"
                          >
                            {selectedMat?.baseUnit === "G" && (
                              <>
                                <option value="G">G</option>
                                <option value="KG">KG</option>
                              </>
                            )}
                            {selectedMat?.baseUnit === "ML" && (
                              <>
                                <option value="ML">ML</option>
                                <option value="L">L</option>
                              </>
                            )}
                            {selectedMat?.baseUnit === "PCS" && <option value="PCS">PCS</option>}
                            {!selectedMat && <option value="G">G</option>}
                          </AppSelect>
                        </div>
                        <div className="w-28">
                          <input
                            type="text"
                            placeholder="Notes"
                            value={ing.notes}
                            onChange={(e) => updateIngredientLine(idx, "notes", e.target.value)}
                            className="w-full bg-[#1A2E20] border border-[#8E9F89]/30 rounded p-1.5 text-xs text-[#FAF8F5]"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeIngredientLine(idx)}
                          className="p-1.5 text-red-400 hover:text-red-300"
                          title="Remove Line"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#8E9F89]/20">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 bg-[#263B2D] text-[#8E9F89] hover:text-[#FAF8F5] rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#B58A57] text-[#1A2E20] font-semibold rounded hover:bg-[#B58A57]/90 transition"
                >
                  {submitting ? "Saving..." : editingRecipe ? "Save & Bump Version" : "Create Recipe"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
