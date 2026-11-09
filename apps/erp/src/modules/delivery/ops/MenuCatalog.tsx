"use client";

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Plus, Pencil, Trash2, Eye, EyeOff, Search, Check, X } from "lucide-react";
import type { TiffinProduct } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { useCurrentUser } from "@/components/auth/CurrentUserContext";
import { hasPermission } from "@/server/authorization/permissions";
import { getJson } from "./data";
import { rupees } from "./ui";
import { BikeLoader } from "@/components/feedback/BikeLoader";

const ProductModal = dynamic(() => import("@/modules/tiffin/components/modals/ProductModal").then((m) => m.ProductModal), { ssr: false });

const UNIT: Record<string, string> = { PER_MEAL: "per meal", PER_DAY: "per day", PER_MONTH: "per month", PER_PIECE: "per piece", PER_PORTION: "per portion" };
const CATEGORY: Record<string, string> = { STANDARD_MEAL: "Meals", SPECIAL: "Specials", EXTRA: "Extras", BEVERAGE: "Drinks", SUBSCRIPTION_PACKAGE: "Packages" };
const ORDER = ["STANDARD_MEAL", "SPECIAL", "EXTRA", "BEVERAGE", "SUBSCRIPTION_PACKAGE"];

/**
 * Orders → Menu: the catalogue and current prices, in compact cards grouped by kind. Owners and
 * Managers (tiffin.manage) add items, edit them, change a price in place, hide an item from new
 * orders, or delete it. Orders keep the price saved when they were placed, so a new price never
 * rewrites an earlier order.
 */
export function MenuCatalog() {
  const user = useCurrentUser();
  const canEdit = hasPermission(user?.role, "tiffin.manage");
  const q = useErpQuery<TiffinProduct[]>("/api/tiffin/products", async () => (await getJson<{ products: TiffinProduct[] }>("/api/tiffin/products")).products || [], {
    ttl: 60000,
    tags: ["products"],
  });
  const products = q.data ?? [];
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TiffinProduct | null | "new">(null);
  const [priceFor, setPriceFor] = useState<string | null>(null);
  const [priceText, setPriceText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const groups = useMemo(() => {
    const s = search.trim().toLowerCase();
    const shown = products.filter((p) => !s || p.name.toLowerCase().includes(s) || (p.description || "").toLowerCase().includes(s));
    const by = new Map<string, TiffinProduct[]>();
    for (const p of shown) by.set(p.category, [...(by.get(p.category) || []), p]);
    return Array.from(by.entries())
      .sort((a, b) => (ORDER.indexOf(a[0]) + 99) % 99 - (ORDER.indexOf(b[0]) + 99) % 99)
      .map(([cat, list]) => [cat, list.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === "ACTIVE" ? -1 : 1))] as const);
  }, [products, search]);

  const done = (text: string) => {
    setNotice({ tone: "ok", text });
    invalidateErpCache(["products", "tiffin_products"]);
  };
  const call = async (id: string, url: string, init: RequestInit, ok: string) => {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save.");
      done(ok);
      return true;
    } catch (e: any) {
      setNotice({ tone: "error", text: e?.message || "Could not save." });
      return false;
    } finally {
      setBusy(null);
    }
  };
  const savePrice = async (p: TiffinProduct) => {
    const price = Number(priceText);
    if (!Number.isFinite(price) || price < 0 || priceText.trim() === "") {
      setNotice({ tone: "error", text: "Enter a price of ₹0 or more." });
      return;
    }
    if (price === p.price) {
      setPriceFor(null);
      return;
    }
    if (await call(p.id, `/api/tiffin/products/${p.id}`, { method: "PATCH", body: JSON.stringify({ price }) }, `${p.name}: price is now ${rupees(price)}. Earlier orders keep their price.`)) setPriceFor(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold text-[var(--rn-ink)] mr-auto">Menu</h2>
        <label className="relative">
          <Search className="pointer-events-none w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[var(--rn-ink-3)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find an item" aria-label="Find a menu item" className="rn-input rn-input-search w-[220px]" />
        </label>
        {canEdit && (
          <button type="button" onClick={() => setEditing("new")} className="rn-btn rn-btn-primary">
            <Plus /> Add item
          </button>
        )}
      </div>
      {notice && (
        <p role={notice.tone === "error" ? "alert" : "status"} className={`rounded-xl px-4 py-2.5 text-[13.5px] ${notice.tone === "error" ? "bg-[#FDECEA] text-[#8A1F12]" : "bg-[#E6F4E1] text-[#1D4E16]"}`}>
          {notice.text}
        </p>
      )}
      {!q.data ? (
        q.error ? <p role="alert" className="text-sm text-status-danger-text">{q.error.message}</p> : <BikeLoader size="sm" label="Loading menu…" className="py-8" />
      ) : groups.length === 0 ? (
        <p className="text-sm text-[var(--rn-ink-2)]">{products.length === 0 ? "No menu items yet." : "No item matches."}</p>
      ) : (
        groups.map(([cat, list]) => (
          <section key={cat} aria-label={CATEGORY[cat] || cat}>
            <h3 className="mb-2 flex items-baseline gap-2 text-[15px] font-bold text-[var(--rn-ink)]">
              {CATEGORY[cat] || cat}
              <span className="text-[12.5px] font-medium text-[var(--rn-ink-3)]">{list.length}</span>
            </h3>
            <ul className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
              {list.map((p) => {
                const off = p.status !== "ACTIVE";
                return (
                  <li
                    key={p.id}
                    data-product-id={p.id}
                    className={`rounded-[18px] border border-[var(--rn-line)] bg-white px-4 py-3 flex flex-col gap-2 ${off ? "opacity-60" : ""}`}
                  >
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-semibold leading-snug text-[var(--rn-ink)]">
                        {p.name}
                        {off && <span className="ml-2 align-middle text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-[#ECE8E2] text-[#3D3631]">Hidden</span>}
                      </p>
                      {p.description && <p className="text-[12.5px] text-[var(--rn-ink-2)] line-clamp-2">{p.description}</p>}
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-2">
                      {priceFor === p.id ? (
                        <form
                          className="flex items-center gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void savePrice(p);
                          }}
                        >
                          <span className="text-[15px] font-bold">₹</span>
                          <input
                            autoFocus
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={priceText}
                            onChange={(e) => setPriceText(e.target.value)}
                            onKeyDown={(e) => e.key === "Escape" && setPriceFor(null)}
                            aria-label={`New price for ${p.name}`}
                            className="w-20 h-9 px-2 rounded-lg border border-[var(--rn-accent)] text-[15px] font-bold tabular-nums"
                          />
                          <button type="submit" disabled={busy === p.id} aria-label="Save price" className="w-9 h-9 rounded-full bg-[var(--rn-accent)] text-white flex items-center justify-center disabled:opacity-60">
                            <Check className="w-4 h-4" />
                          </button>
                          <button type="button" onClick={() => setPriceFor(null)} aria-label="Cancel" className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--rn-ink-2)] hover:bg-[var(--rn-accent-tint)]">
                            <X className="w-4 h-4" />
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => {
                            setPriceFor(p.id);
                            setPriceText(String(p.price));
                          }}
                          title={canEdit ? "Change the price" : undefined}
                          aria-label={canEdit ? `Change the price of ${p.name} (${rupees(p.price)})` : undefined}
                          className={`text-left rounded-lg -ml-1 px-1 ${canEdit ? "hover:bg-[var(--rn-accent-tint)]" : "cursor-default"}`}
                        >
                          <span className="block text-[18px] leading-tight font-bold tabular-nums text-[var(--rn-ink)]">{rupees(p.price)}</span>
                          <span className="block text-[11.5px] text-[var(--rn-ink-3)]">{UNIT[p.billingUnit] || p.billingUnit}</span>
                        </button>
                      )}
                      {canEdit && priceFor !== p.id && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button type="button" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`} title="Edit" className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--rn-ink-2)] hover:bg-[var(--rn-accent-tint)]">
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => call(p.id, `/api/tiffin/products/${p.id}/status`, { method: "POST", body: JSON.stringify({ status: off ? "ACTIVE" : "INACTIVE" }) }, off ? `${p.name} is back on the menu.` : `${p.name} is hidden from new orders.`)}
                            aria-label={off ? `Show ${p.name} on the menu` : `Hide ${p.name} from new orders`}
                            title={off ? "Show on the menu" : "Hide from new orders"}
                            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--rn-ink-2)] hover:bg-[var(--rn-accent-tint)] disabled:opacity-50"
                          >
                            {off ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          </button>
                          <button
                            type="button"
                            disabled={busy === p.id}
                            onClick={() => {
                              if (window.confirm(`Delete ${p.name} from the menu? Earlier orders keep it.`)) {
                                void call(p.id, `/api/tiffin/products/${p.id}`, { method: "DELETE" }, `${p.name} was deleted from the menu.`);
                              }
                            }}
                            aria-label={`Delete ${p.name}`}
                            title="Delete"
                            className="w-9 h-9 rounded-full flex items-center justify-center text-[#A3261A] hover:bg-[#FBEDE8] disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {canEdit && editing !== null && (
        <ProductModal
          isOpen
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSuccess={(_saved, message) => {
            setEditing(null);
            done(message || "Menu saved.");
          }}
        />
      )}
    </div>
  );
}
