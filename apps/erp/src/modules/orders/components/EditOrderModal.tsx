"use client";

import { friendlyError } from "@/lib/friendlyError";
import React, { useEffect, useMemo, useState } from "react";
import { X, Minus, Plus, AlertCircle, History } from "lucide-react";
import { UnifiedOrder, TiffinProduct } from "@/types";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { BikeLoader } from "@/components/feedback/BikeLoader";

type Mode = "edit" | "cancel";

interface Revision {
  revisionNo: number;
  snapshot: { items: Array<{ productName: string; quantity: number }>; deliveryAddress: string | null; totalAmount: number };
  reason: string | null;
  changedByName: string | null;
  createdAt: string;
}

/**
 * Change or cancel a delivery order that has not gone out (the server decides what is allowed:
 * no money collected, not yet attempted; after the meal cutoff only with the Manager override).
 * Prices come from the server: items already on the order keep their agreed price.
 */
export function EditOrderModal({ order, mode, onClose, onDone }: { order: UnifiedOrder; mode: Mode; onClose: () => void; onDone: (message: string) => void }) {
  // The list's id is the delivery's; the order itself is orderId.
  const orderId = order.orderId || order.id;
  const [menu, setMenu] = useState<TiffinProduct[]>([]);
  const [qty, setQty] = useState<Record<string, number>>(() => {
    const q: Record<string, number> = {};
    for (const it of order.items) if (it.productId) q[it.productId] = (q[it.productId] || 0) + it.quantity;
    return q;
  });
  const [address, setAddress] = useState(order.deliveryAddress || "");
  const [notes, setNotes] = useState(order.notes || "");
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);

  useEffect(() => {
    if (mode !== "edit") return;
    fetch("/api/tiffin/products?status=ACTIVE", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMenu((d.products || []).filter((p: TiffinProduct) => p.billingUnit !== "PER_MONTH")))
      .catch(() => setMenu([]));
    fetch(`/api/orders/${orderId}/revisions`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { revisions: [] }))
      .then((d) => setRevisions(d.revisions || []))
      .catch(() => setRevisions([]));
  }, [mode, orderId]);

  const agreed = useMemo(() => new Map(order.items.filter((i) => i.productId).map((i) => [i.productId!, i.unitPrice])), [order.items]);
  const lines = Object.entries(qty).filter(([, n]) => n > 0);
  const total = lines.reduce((a, [id, n]) => a + n * (agreed.get(id) ?? menu.find((m) => m.id === id)?.price ?? 0), 0);
  const nameOf = (id: string) => menu.find((m) => m.id === id)?.name || order.items.find((i) => i.productId === id)?.productName || "Item";
  const step = (id: string, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(99, (q[id] || 0) + d)) }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "edit"
          ? await fetch(`/api/orders/${orderId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: lines.map(([productId, quantity]) => ({ productId, quantity })), deliveryAddress: address, notes, reason: reason || undefined, overrideCutoff: override }),
            })
          : await fetch(`/api/orders/${orderId}/cancel`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason, overrideCutoff: override }),
            });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save.");
      invalidateErpCache(["orders", "delivery", "dashboard"]);
      onDone(mode === "edit" ? (body.changed ? `Order for ${order.customerName} changed.` : "Nothing was changed.") : `Order for ${order.customerName} cancelled.`);
    } catch (err: any) {
      setError(friendlyError(err.message));
    } finally {
      setBusy(false);
    }
  };

  const needsCutoff = error ? /cutoff/i.test(error) : false;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="edit-order-title" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs">
      <div className="bg-white border border-[#E6E1DA] rounded-3xl shadow-2xl max-w-lg w-full max-h-[90dvh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[#E6E1DA]">
          <h2 id="edit-order-title" className="font-serif text-lg font-bold text-[#1A2E20]">
            {mode === "edit" ? "Change order" : "Cancel order"} · {order.customerName}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[#8E9F89] hover:bg-[#FAF8F5]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto text-sm">
          {mode === "edit" ? (
            <>
              <section aria-label="Items" className="space-y-2">
                {menu.length === 0 && order.items.length === 0 ? (
                  <BikeLoader inline label="Loading menu" />
                ) : (
                  Array.from(new Set([...Object.keys(qty), ...menu.map((m) => m.id)])).map((id) => (
                    <div key={id} className="flex items-center justify-between gap-2">
                      <span className="text-[#1A2E20] truncate">
                        {nameOf(id)} <span className="text-xs text-[#8E9F89]">₹{agreed.get(id) ?? menu.find((m) => m.id === id)?.price ?? "—"}{agreed.has(id) ? " (agreed)" : ""}</span>
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <button type="button" onClick={() => step(id, -1)} aria-label={`Less ${nameOf(id)}`} className="w-9 h-9 rounded-full border border-[#DCD6CD] grid place-items-center"><Minus className="w-4 h-4" /></button>
                        <span className="w-6 text-center tabular-nums">{qty[id] || 0}</span>
                        <button type="button" onClick={() => step(id, 1)} aria-label={`More ${nameOf(id)}`} className="w-9 h-9 rounded-full border border-[#DCD6CD] grid place-items-center"><Plus className="w-4 h-4" /></button>
                      </span>
                    </div>
                  ))
                )}
                <p className="text-right font-serif font-bold text-[#1A2E20]">Total ₹{total}</p>
              </section>
              <label className="block">
                <span className="block text-xs font-semibold text-[#5A6C5E] mb-1">Delivery address</span>
                <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-[#DCD6CD] bg-[#FAF8F5]" />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-[#5A6C5E] mb-1">Notes</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full min-h-[40px] px-3 rounded-xl border border-[#DCD6CD] bg-[#FAF8F5]" />
              </label>
            </>
          ) : (
            <p className="text-[#5A6C5E]">
              The delivery is cancelled and the order is kept as cancelled with your reason. Orders with any money collected cannot be cancelled.
            </p>
          )}
          <label className="block">
            <span className="block text-xs font-semibold text-[#5A6C5E] mb-1">{mode === "cancel" ? "Reason (required)" : "Reason (optional)"}</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full min-h-[40px] px-3 rounded-xl border border-[#DCD6CD] bg-[#FAF8F5]" />
          </label>
          {(needsCutoff || override) && (
            <label className="flex items-center gap-2 text-xs text-amber-800">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="w-4 h-4" />
              The meal is past its cutoff. I confirm the Manager override.
            </label>
          )}
          {error && <p className="text-xs text-rose-700 flex items-center gap-1.5"><AlertCircle className="w-4 h-4 shrink-0" /> {error}</p>}
          {mode === "edit" && revisions && revisions.length > 0 && (
            <section aria-label="Earlier versions" className="pt-3 border-t border-[#E6E1DA] space-y-1 text-xs text-[#5A6C5E]">
              <p className="font-semibold flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Earlier versions</p>
              {revisions.map((r) => (
                <p key={r.revisionNo}>
                  {new Date(r.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} · {r.changedByName || "Staff"}: was {r.snapshot.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")} (₹{r.snapshot.totalAmount}){r.reason ? ` · ${r.reason}` : ""}
                </p>
              ))}
            </section>
          )}
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-[#E6E1DA]">
          <button type="button" onClick={onClose} className="px-4 min-h-[40px] rounded-full border border-[#DCD6CD] text-[#1A2E20] text-sm">Back</button>
          <button
            type="button"
            disabled={busy || (mode === "cancel" ? reason.trim().length < 3 : lines.length === 0)}
            onClick={submit}
            className={`px-4 min-h-[40px] rounded-full text-white text-sm font-semibold disabled:opacity-50 ${mode === "cancel" ? "bg-rose-700 hover:bg-rose-800" : "bg-[#1A2E20] hover:bg-[#263B2D]"}`}
          >
            {busy ? <BikeLoader inline tone="light" label="Saving" /> : mode === "cancel" ? "Cancel order" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
