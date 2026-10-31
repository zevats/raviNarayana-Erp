"use client";

import React from "react";
import type { TiffinProduct } from "@/types";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { getJson } from "./data";
import { rupees } from "./ui";
import { BikeLoader } from "@/components/feedback/BikeLoader";

const UNIT: Record<string, string> = { PER_MEAL: "per meal", PER_DAY: "per day", PER_MONTH: "per month", PER_PIECE: "per piece", PER_PORTION: "per portion" };
const CATEGORY: Record<string, string> = { STANDARD_MEAL: "Meals", SUBSCRIPTION_PACKAGE: "Packages", EXTRA: "Extras", BEVERAGE: "Drinks", SPECIAL: "Specials" };

/**
 * Orders → Menu: the real catalogue and current prices (read from the products the order form
 * uses). Orders keep the price saved when they were placed, so changing a price never rewrites
 * an earlier order. Prices are changed by the Owner.
 */
export function MenuCatalog() {
  const q = useErpQuery<TiffinProduct[]>("/api/tiffin/products", async () => (await getJson<{ products: TiffinProduct[] }>("/api/tiffin/products")).products || [], {
    ttl: 60000,
    tags: ["products"],
  });
  const products = q.data ?? [];
  const groups = Object.entries(
    products.reduce<Record<string, TiffinProduct[]>>((acc, p) => {
      (acc[p.category] ||= []).push(p);
      return acc;
    }, {})
  );
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-2xl text-text-primary">Menu</h2>
      </div>
      {!q.data ? (
        q.error ? <p role="alert" className="text-sm text-status-danger-text">{q.error.message}</p> : <BikeLoader size="sm" label="Loading menu…" className="py-8" />
      ) : products.length === 0 ? (
        <p className="text-sm text-text-muted">No menu items yet.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {groups.map(([cat, list]) => (
            <section key={cat} className="rounded-3xl bg-white border border-surface-subtle p-4">
              <h3 className="font-serif text-lg text-text-primary mb-2">{CATEGORY[cat] || cat}</h3>
              <ul className="divide-y divide-surface-subtle">
                {list
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => (
                    <li key={p.id} className={`py-2 flex items-baseline justify-between gap-3 ${p.status !== "ACTIVE" ? "opacity-50" : ""}`}>
                      <span className="min-w-0">
                        <span className="text-text-primary">{p.name}</span>
                        {p.status !== "ACTIVE" && <span className="ml-2 text-[11px] text-text-muted">inactive</span>}
                        {p.description && <span className="block text-xs text-text-muted truncate">{p.description}</span>}
                      </span>
                      <span className="text-right whitespace-nowrap">
                        <span className="font-serif text-lg text-text-primary">{rupees(p.price)}</span>
                        <span className="block text-[11px] text-text-muted">{UNIT[p.billingUnit] || p.billingUnit}</span>
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
