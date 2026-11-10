"use client";

import { friendlyError } from "@/lib/friendlyError";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useState, useEffect, useCallback } from "react";
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  History,
  Edit2,
  CheckCircle2,
  X,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  KitchenRawMaterial,
  KitchenStockMovement,
  RawMaterialCategory,
  RawMaterialBaseUnit,
} from "@/types";

interface InventoryManagerViewProps {
  onNotify?: (msg: string) => void;
}

export default function InventoryManagerView({ onNotify }: InventoryManagerViewProps) {
  const [materials, setMaterials] = useState<KitchenRawMaterial[]>([]);
  const [movements, setMovements] = useState<KitchenStockMovement[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [lowStockOnly, setLowStockOnly] = useState<boolean>(false);
  const [activeSubTab, setActiveSubTab] = useState<"catalog" | "movements">("catalog");

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState<boolean>(false);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState<boolean>(false);
  const [isWasteModalOpen, setIsWasteModalOpen] = useState<boolean>(false);
  const [selectedMaterial, setSelectedMaterial] = useState<KitchenRawMaterial | null>(null);

  // Form states
  const [formCode, setFormCode] = useState<string>("");
  const [formName, setFormName] = useState<string>("");
  const [formDescription, setFormDescription] = useState<string>("");
  const [formCategory, setFormCategory] = useState<RawMaterialCategory>("GRAINS");
  const [formBaseUnit, setFormBaseUnit] = useState<RawMaterialBaseUnit>("G");
  const [formInitialStock, setFormInitialStock] = useState<number>(0);
  const [formReorderThreshold, setFormReorderThreshold] = useState<number>(1000);

  // Action form states
  const [actionQuantity, setActionQuantity] = useState<number>(1);
  const [actionUnit, setActionUnit] = useState<string>("KG");
  const [actionReason, setActionReason] = useState<string>("");
  const [actionRef, setActionRef] = useState<string>("");
  const [adjustType, setAdjustType] = useState<"ADD" | "SUB">("ADD");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qParams = new URLSearchParams();
      if (search.trim()) qParams.set("search", search.trim());
      if (selectedCategory !== "ALL") qParams.set("category", selectedCategory);
      if (lowStockOnly) qParams.set("lowStockOnly", "true");

      const [matRes, movRes] = await Promise.all([
        fetch(`/api/kitchen/inventory/materials?${qParams.toString()}`),
        fetch("/api/kitchen/inventory/movements?limit=50"),
      ]);

      const matData = await matRes.json();
      const movData = await movRes.json();

      if (!matRes.ok) throw new Error(matData.error || "Failed to load materials");
      if (!movRes.ok) throw new Error(movData.error || "Failed to load movements");

      setMaterials(matData.materials || []);
      setMovements(movData.movements || []);
    } catch (err: any) {
      setError(friendlyError(err.message));
    } finally {
      setLoading(false);
    }
  }, [search, selectedCategory, lowStockOnly]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Unit display formatter
  const formatBalance = (amountBase: number, baseUnit: RawMaterialBaseUnit) => {
    if (baseUnit === "G") {
      if (Math.abs(amountBase) >= 1000) {
        const kg = (amountBase / 1000).toFixed(amountBase % 1000 === 0 ? 0 : 2);
        return `${kg} kg (${amountBase.toLocaleString()} g)`;
      }
      return `${amountBase.toLocaleString()} g`;
    }
    if (baseUnit === "ML") {
      if (Math.abs(amountBase) >= 1000) {
        const l = (amountBase / 1000).toFixed(amountBase % 1000 === 0 ? 0 : 2);
        return `${l} L (${amountBase.toLocaleString()} ml)`;
      }
      return `${amountBase.toLocaleString()} ml`;
    }
    return `${amountBase.toLocaleString()} pcs`;
  };

  const handleCreateMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/kitchen/inventory/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: formCode,
          name: formName,
          description: formDescription,
          category: formCategory,
          baseUnit: formBaseUnit,
          initialStock: formInitialStock,
          reorderThreshold: formReorderThreshold,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create material");

      onNotify?.(`Raw material '${data.material.name}' added successfully.`);
      setIsCreateModalOpen(false);
      resetCreateForm();
      loadData();
    } catch (err: any) {
      setError(friendlyError(err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const resetCreateForm = () => {
    setFormCode("");
    setFormName("");
    setFormDescription("");
    setFormCategory("GRAINS");
    setFormBaseUnit("G");
    setFormInitialStock(0);
    setFormReorderThreshold(1000);
  };

  const handleRecordReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/kitchen/inventory/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: selectedMaterial.id,
          quantity: Number(actionQuantity),
          unit: actionUnit,
          reason: actionReason,
          referenceNumber: actionRef,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record receipt");

      onNotify?.(`Receipt of ${actionQuantity} ${actionUnit} recorded for '${selectedMaterial.name}'.`);
      setIsReceiptModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(friendlyError(err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/kitchen/inventory/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: selectedMaterial.id,
          adjustmentType: adjustType,
          quantity: Number(actionQuantity),
          unit: actionUnit,
          reason: actionReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record adjustment");

      onNotify?.(`Stock adjustment recorded for '${selectedMaterial.name}'.`);
      setIsAdjustModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(friendlyError(err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordWaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMaterial) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/kitchen/inventory/waste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: selectedMaterial.id,
          quantity: Number(actionQuantity),
          unit: actionUnit,
          reason: actionReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record waste");

      onNotify?.(`Material waste recorded for '${selectedMaterial.name}'.`);
      setIsWasteModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(friendlyError(err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const openReceiptModal = (mat: KitchenRawMaterial) => {
    setSelectedMaterial(mat);
    setActionUnit(mat.baseUnit === "G" ? "KG" : mat.baseUnit === "ML" ? "L" : "PCS");
    setActionQuantity(1);
    setActionReason("Stock replenishment receipt");
    setActionRef("");
    setIsReceiptModalOpen(true);
  };

  const openAdjustModal = (mat: KitchenRawMaterial) => {
    setSelectedMaterial(mat);
    setActionUnit(mat.baseUnit === "G" ? "KG" : mat.baseUnit === "ML" ? "L" : "PCS");
    setActionQuantity(1);
    setActionReason("");
    setAdjustType("ADD");
    setIsAdjustModalOpen(true);
  };

  const openWasteModal = (mat: KitchenRawMaterial) => {
    setSelectedMaterial(mat);
    setActionUnit(mat.baseUnit === "G" ? "KG" : mat.baseUnit === "ML" ? "L" : "PCS");
    setActionQuantity(1);
    setActionReason("Spoilage / Expired batch");
    setIsWasteModalOpen(true);
  };

  const lowStockCount = materials.filter((m) => m.currentStock <= m.reorderThreshold).length;

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

      {/* Low Stock Warning Strip */}
      {lowStockCount > 0 && (
        <div className="flex items-center justify-between bg-amber-950/40 border border-amber-600/40 rounded-xl p-4 text-amber-200">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <div>
              <div className="font-semibold text-sm">
                {lowStockCount} raw material{lowStockCount > 1 ? "s" : ""} at or below reorder threshold
              </div>
              <div className="text-xs text-amber-300/80 mt-0.5">
                Replenish stock promptly before upcoming meal preparation batches.
              </div>
            </div>
          </div>
          <button
            onClick={() => setLowStockOnly(!lowStockOnly)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              lowStockOnly
                ? "bg-amber-600 text-white border-amber-500"
                : "bg-amber-900/40 text-amber-200 border-amber-600/40 hover:bg-amber-900/60"
            }`}
          >
            {lowStockOnly ? "Show All Items" : "Filter Low Stock"}
          </button>
        </div>
      )}

      {/* Sub Tabs & Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveSubTab("catalog")}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition ${
              activeSubTab === "catalog"
                ? "bg-[#B58A57] text-[#1A2E20] border-[#B58A57] font-semibold"
                : "bg-[#263B2D]/40 text-[#8E9F89] border-[#8E9F89]/30 hover:text-[#FAF8F5]"
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Materials Catalogue ({materials.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab("movements")}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition ${
              activeSubTab === "movements"
                ? "bg-[#B58A57] text-[#1A2E20] border-[#B58A57] font-semibold"
                : "bg-[#263B2D]/40 text-[#8E9F89] border-[#8E9F89]/30 hover:text-[#FAF8F5]"
            }`}
          >
            <History className="w-4 h-4" />
            <span>Movement Ledger ({movements.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#8E9F89]" />
            <input
              type="text"
              placeholder="Search code or name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-[#1A2E20] border border-[#8E9F89]/30 rounded-lg pl-9 pr-3 py-1.5 text-xs text-[#FAF8F5] focus:outline-none focus:border-[#B58A57]"
            />
          </div>

          <AppSelect
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-[#1A2E20] border border-[#8E9F89]/30 rounded-lg px-3 py-1.5 text-xs text-[#FAF8F5] focus:outline-none focus:border-[#B58A57]"
          >
            <option value="ALL">All Categories</option>
            <option value="GRAINS">Grains</option>
            <option value="PULSES">Pulses</option>
            <option value="VEGETABLES">Vegetables</option>
            <option value="DAIRY">Dairy</option>
            <option value="SPICES">Spices</option>
            <option value="OILS">Oils</option>
            <option value="PACKAGING">Packaging</option>
            <option value="OTHER">Other</option>
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
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#B58A57] text-[#1A2E20] hover:bg-[#B58A57]/90 rounded-lg text-xs font-semibold transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Material</span>
          </button>
        </div>
      </div>

      {/* CATALOG VIEW */}
      {activeSubTab === "catalog" && (
        <div className="bg-[#1A2E20]/60 border border-[#8E9F89]/20 rounded-xl overflow-hidden">
          <table className="w-full text-left text-xs text-[#FAF8F5]">
            <thead className="bg-[#263B2D]/80 border-b border-[#8E9F89]/30 text-[#8E9F89] uppercase tracking-wider font-mono">
              <tr>
                <th className="p-3">Code / Name</th>
                <th className="p-3">Category</th>
                <th className="p-3">Base Unit</th>
                <th className="p-3">Current Stock</th>
                <th className="p-3">Reorder Threshold</th>
                <th className="p-3 text-right">Stock Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#8E9F89]/10">
              {materials.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-[#8E9F89]">
                    No raw materials found matching filters.
                  </td>
                </tr>
              ) : (
                materials.map((mat) => {
                  const isLow = mat.currentStock <= mat.reorderThreshold;
                  return (
                    <tr key={mat.id} className="hover:bg-[#263B2D]/30 transition">
                      <td className="p-3">
                        <div className="font-semibold text-[#FAF8F5]">{mat.name}</div>
                        <div className="text-[11px] font-mono text-[#B58A57]">{mat.code}</div>
                        {mat.description && (
                          <div className="text-[11px] text-[#8E9F89] truncate max-w-xs">{mat.description}</div>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#263B2D] border border-[#8E9F89]/30 text-[#8E9F89]">
                          {mat.category}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-[#8E9F89]">{mat.baseUnit}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-semibold ${isLow ? "text-amber-400" : "text-emerald-400"}`}>
                            {formatBalance(mat.currentStock, mat.baseUnit)}
                          </span>
                          {isLow && (
                            <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              Low
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 font-mono text-[#8E9F89]">
                        {formatBalance(mat.reorderThreshold, mat.baseUnit)}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openReceiptModal(mat)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-950/60 border border-emerald-600/40 text-emerald-300 hover:bg-emerald-900/60 rounded text-[11px] font-medium transition"
                            title="Record Incoming Stock Receipt"
                          >
                            <ArrowDownRight className="w-3 h-3" />
                            <span>Receipt</span>
                          </button>
                          <button
                            onClick={() => openAdjustModal(mat)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-[#263B2D] border border-[#8E9F89]/30 text-[#8E9F89] hover:text-[#FAF8F5] rounded text-[11px] font-medium transition"
                            title="Stock Correction / Adjustment"
                          >
                            <Edit2 className="w-3 h-3" />
                            <span>Adjust</span>
                          </button>
                          <button
                            onClick={() => openWasteModal(mat)}
                            className="flex items-center gap-1 px-2.5 py-1 bg-red-950/40 border border-red-600/40 text-red-300 hover:bg-red-900/40 rounded text-[11px] font-medium transition"
                            title="Record Spoilage or Waste"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Waste</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* MOVEMENTS VIEW */}
      {activeSubTab === "movements" && (
        <div className="bg-[#1A2E20]/60 border border-[#8E9F89]/20 rounded-xl overflow-hidden">
          <table className="w-full text-left text-xs text-[#FAF8F5]">
            <thead className="bg-[#263B2D]/80 border-b border-[#8E9F89]/30 text-[#8E9F89] uppercase tracking-wider font-mono">
              <tr>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Material</th>
                <th className="p-3">Movement Type</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Source / Reason</th>
                <th className="p-3">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#8E9F89]/10 font-mono">
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-[#8E9F89] font-sans">
                    No stock movements recorded yet.
                  </td>
                </tr>
              ) : (
                movements.map((mov) => {
                  const isPositive = mov.quantityBase > 0;
                  return (
                    <tr key={mov.id} className="hover:bg-[#263B2D]/30 transition text-[11px]">
                      <td className="p-3 text-[#8E9F89]">
                        {new Date(mov.createdAt).toLocaleString("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="p-3 font-sans">
                        <span className="font-semibold text-[#FAF8F5]">{mov.materialName}</span>{" "}
                        <span className="text-[10px] text-[#B58A57] font-mono">({mov.materialCode})</span>
                      </td>
                      <td className="p-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            mov.movementType === "RECEIPT" || mov.movementType === "OPENING_BALANCE"
                              ? "bg-emerald-950 border border-emerald-600/40 text-emerald-300"
                              : mov.movementType === "PRODUCTION_CONSUMPTION"
                              ? "bg-blue-950 border border-blue-600/40 text-blue-300"
                              : mov.movementType === "PRODUCTION_REVERSAL"
                              ? "bg-purple-950 border border-purple-600/40 text-purple-300"
                              : mov.movementType === "WASTE"
                              ? "bg-red-950 border border-red-600/40 text-red-300"
                              : "bg-[#263B2D] border border-[#8E9F89]/40 text-[#FAF8F5]"
                          }`}
                        >
                          {mov.movementType.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="p-3 font-bold">
                        <span className={isPositive ? "text-emerald-400" : "text-rose-400"}>
                          {isPositive ? "+" : ""}
                          {mov.quantityBase.toLocaleString()} {mov.unit}
                        </span>
                      </td>
                      <td className="p-3 text-[#FAF8F5] font-sans">
                        <div>{mov.reason}</div>
                        {mov.sourceId && (
                          <div className="text-[10px] font-mono text-[#8E9F89]">Source: {mov.sourceId}</div>
                        )}
                      </td>
                      <td className="p-3 text-[#8E9F89] font-sans">{mov.actorName || mov.actorId}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* CREATE MATERIAL MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#1A2E20] border border-[#B58A57]/40 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#8E9F89]/20 pb-3">
              <h2 className="text-lg font-serif text-[#FAF8F5]">Add Raw Material to Catalogue</h2>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-[#8E9F89] hover:text-[#FAF8F5]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateMaterial} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">
                  Material Code (Unique)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. RM-ATTA, RM-RICE"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57] uppercase font-mono"
                />
              </div>
              <div>
                <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Material Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Wheat Flour (Chakki Atta)"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Category</label>
                  <AppSelect
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value as RawMaterialCategory)}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                  >
                    <option value="GRAINS">Grains</option>
                    <option value="PULSES">Pulses</option>
                    <option value="VEGETABLES">Vegetables</option>
                    <option value="DAIRY">Dairy</option>
                    <option value="SPICES">Spices</option>
                    <option value="OILS">Oils</option>
                    <option value="PACKAGING">Packaging</option>
                    <option value="OTHER">Other</option>
                  </AppSelect>
                </div>
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">
                    Canonical Base Unit
                  </label>
                  <AppSelect
                    value={formBaseUnit}
                    onChange={(e) => setFormBaseUnit(e.target.value as RawMaterialBaseUnit)}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                  >
                    <option value="G">Gram (G - Mass)</option>
                    <option value="ML">Milliliter (ML - Volume)</option>
                    <option value="PCS">Piece (PCS - Count)</option>
                  </AppSelect>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">
                    Initial Stock ({formBaseUnit})
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formInitialStock}
                    onChange={(e) => setFormInitialStock(Number(e.target.value))}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">
                    Reorder Threshold ({formBaseUnit})
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formReorderThreshold}
                    onChange={(e) => setFormReorderThreshold(Number(e.target.value))}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57] font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">
                  Description / Specification
                </label>
                <input
                  type="text"
                  placeholder="e.g. 50kg bag, MP Sharbati"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#8E9F89]/20">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 bg-[#263B2D] text-[#8E9F89] hover:text-[#FAF8F5] rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#B58A57] text-[#1A2E20] font-semibold rounded hover:bg-[#B58A57]/90 transition"
                >
                  {submitting ? "Saving..." : "Create Material"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RECEIPT MODAL */}
      {isReceiptModalOpen && selectedMaterial && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#1A2E20] border border-[#B58A57]/40 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#8E9F89]/20 pb-3">
              <div>
                <h2 className="text-lg font-serif text-[#FAF8F5]">Record Stock Receipt</h2>
                <p className="text-xs text-[#8E9F89]">{selectedMaterial.name} ({selectedMaterial.code})</p>
              </div>
              <button onClick={() => setIsReceiptModalOpen(false)} className="text-[#8E9F89] hover:text-[#FAF8F5]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecordReceipt} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Quantity</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={actionQuantity}
                    onChange={(e) => setActionQuantity(Number(e.target.value))}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Unit</label>
                  <AppSelect
                    value={actionUnit}
                    onChange={(e) => setActionUnit(e.target.value)}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                  >
                    {selectedMaterial.baseUnit === "G" && (
                      <>
                        <option value="KG">Kilograms (KG)</option>
                        <option value="G">Grams (G)</option>
                      </>
                    )}
                    {selectedMaterial.baseUnit === "ML" && (
                      <>
                        <option value="L">Liters (L)</option>
                        <option value="ML">Milliliters (ML)</option>
                      </>
                    )}
                    {selectedMaterial.baseUnit === "PCS" && <option value="PCS">Pieces (PCS)</option>}
                  </AppSelect>
                </div>
              </div>
              <div>
                <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Delivery Reference / Bill No.</label>
                <input
                  type="text"
                  placeholder="e.g. INV-9821, Mandi Slip #4"
                  value={actionRef}
                  onChange={(e) => setActionRef(e.target.value)}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                />
              </div>
              <div>
                <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Notes / Reason</label>
                <input
                  type="text"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[#8E9F89]/20">
                <button
                  type="button"
                  onClick={() => setIsReceiptModalOpen(false)}
                  className="px-4 py-2 bg-[#263B2D] text-[#8E9F89] hover:text-[#FAF8F5] rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 text-white font-semibold rounded hover:bg-emerald-500 transition"
                >
                  {submitting ? "Adding..." : "Add to Stock"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADJUSTMENT MODAL */}
      {isAdjustModalOpen && selectedMaterial && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#1A2E20] border border-[#B58A57]/40 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#8E9F89]/20 pb-3">
              <div>
                <h2 className="text-lg font-serif text-[#FAF8F5]">Stock Adjustment</h2>
                <p className="text-xs text-[#8E9F89]">
                  {selectedMaterial.name} (Current: {formatBalance(selectedMaterial.currentStock, selectedMaterial.baseUnit)})
                </p>
              </div>
              <button onClick={() => setIsAdjustModalOpen(false)} className="text-[#8E9F89] hover:text-[#FAF8F5]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecordAdjustment} className="space-y-3 text-xs">
              <div>
                <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Adjustment Direction</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAdjustType("ADD")}
                    className={`py-2 rounded font-semibold transition ${
                      adjustType === "ADD"
                        ? "bg-emerald-600 text-white"
                        : "bg-[#263B2D] text-[#8E9F89] hover:text-[#FAF8F5]"
                    }`}
                  >
                    + Positive Correction (Add)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustType("SUB")}
                    className={`py-2 rounded font-semibold transition ${
                      adjustType === "SUB"
                        ? "bg-rose-600 text-white"
                        : "bg-[#263B2D] text-[#8E9F89] hover:text-[#FAF8F5]"
                    }`}
                  >
                    - Negative Correction (Deduct)
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Quantity</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={actionQuantity}
                    onChange={(e) => setActionQuantity(Number(e.target.value))}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Unit</label>
                  <AppSelect
                    value={actionUnit}
                    onChange={(e) => setActionUnit(e.target.value)}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                  >
                    {selectedMaterial.baseUnit === "G" && (
                      <>
                        <option value="KG">Kilograms (KG)</option>
                        <option value="G">Grams (G)</option>
                      </>
                    )}
                    {selectedMaterial.baseUnit === "ML" && (
                      <>
                        <option value="L">Liters (L)</option>
                        <option value="ML">Milliliters (ML)</option>
                      </>
                    )}
                    {selectedMaterial.baseUnit === "PCS" && <option value="PCS">Pieces (PCS)</option>}
                  </AppSelect>
                </div>
              </div>
              <div>
                <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">
                  Mandatory Audit Reason
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Physical inventory count reconciliation"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[#8E9F89]/20">
                <button
                  type="button"
                  onClick={() => setIsAdjustModalOpen(false)}
                  className="px-4 py-2 bg-[#263B2D] text-[#8E9F89] hover:text-[#FAF8F5] rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-[#B58A57] text-[#1A2E20] font-semibold rounded hover:bg-[#B58A57]/90 transition"
                >
                  {submitting ? "Saving..." : "Apply Adjustment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WASTE MODAL */}
      {isWasteModalOpen && selectedMaterial && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-[#1A2E20] border border-[#B58A57]/40 rounded-xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#8E9F89]/20 pb-3">
              <div>
                <h2 className="text-lg font-serif text-[#FAF8F5]">Record Spoilage / Waste</h2>
                <p className="text-xs text-[#8E9F89]">{selectedMaterial.name} ({selectedMaterial.code})</p>
              </div>
              <button onClick={() => setIsWasteModalOpen(false)} className="text-[#8E9F89] hover:text-[#FAF8F5]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleRecordWaste} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Waste Quantity</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={actionQuantity}
                    onChange={(e) => setActionQuantity(Number(e.target.value))}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Unit</label>
                  <AppSelect
                    value={actionUnit}
                    onChange={(e) => setActionUnit(e.target.value)}
                    className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                  >
                    {selectedMaterial.baseUnit === "G" && (
                      <>
                        <option value="KG">Kilograms (KG)</option>
                        <option value="G">Grams (G)</option>
                      </>
                    )}
                    {selectedMaterial.baseUnit === "ML" && (
                      <>
                        <option value="L">Liters (L)</option>
                        <option value="ML">Milliliters (ML)</option>
                      </>
                    )}
                    {selectedMaterial.baseUnit === "PCS" && <option value="PCS">Pieces (PCS)</option>}
                  </AppSelect>
                </div>
              </div>
              <div>
                <label className="block text-[#8E9F89] mb-1 uppercase tracking-wider font-mono">Reason for Waste</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Moisture damage, infested, expired"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  className="w-full bg-[#263B2D] border border-[#8E9F89]/30 rounded p-2 text-[#FAF8F5] focus:border-[#B58A57]"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[#8E9F89]/20">
                <button
                  type="button"
                  onClick={() => setIsWasteModalOpen(false)}
                  className="px-4 py-2 bg-[#263B2D] text-[#8E9F89] hover:text-[#FAF8F5] rounded transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-red-600 text-white font-semibold rounded hover:bg-red-500 transition"
                >
                  {submitting ? "Deducting..." : "Record Waste Deduction"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
