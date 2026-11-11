"use client";

import React, { useEffect, useMemo, useState } from "react";
import { X, Search, Check, UserPlus } from "lucide-react";
import type { TiffinCustomer, TiffinProduct, TiffinSubscription, SubscriptionMealTypes } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessToday } from "@/lib/businessDate";
import { planMealsLabel } from "@/lib/planMeals";
import { friendlyError } from "@/lib/friendlyError";
import { PhoneError } from "@/components/forms/PhoneError";
import { phoneProblem } from "@/lib/phone";
import { Segmented } from "@/components/ui/kit";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const FIELD = "w-full h-12 px-4 rounded-2xl border border-[rgba(30,35,32,0.14)] bg-white text-[15px] text-[#1E2320] outline-none focus:border-[#1E3A2B] focus:shadow-[0_0_0_3px_rgba(30,58,43,0.12)]";
const LABEL = "block mb-1.5 text-[13px] font-semibold text-[#1E2320]";

/** Meals of a monthly plan, read from its menu name: 2 meals = lunch + dinner, 1 thali = any meal. */
export function planKind(p?: TiffinProduct | null): SubscriptionMealTypes | null {
  if (!p) return null;
  const t = `${p.code || ""} ${p.name} ${p.description || ""}`;
  if (/BOTH|lunch\s*(&|and|\+|\/|,)\s*dinner|dinner\s*(&|and|\+|\/|,)\s*lunch|\b(2|two)[\s-]*(meals?|times?|time|thalis?)\b|double/i.test(t)) return "BOTH";
  if (/\b(1|one)[\s-]*(meals?|times?|time|thali)\b|single|any\s*meal/i.test(t)) return "ANY";
  return null;
}

/**
 * New subscription (or edit): the customer, one of the two monthly plans (1 thali, or lunch +
 * dinner), the start date and the address. The plan sets the price and runs every day. Customers
 * who already have a plan are not offered again.
 */
export function SubscriptionForm({ open, onClose, subscription, onSaved }: { open: boolean; onClose: () => void; subscription?: TiffinSubscription | null; onSaved: (message: string) => void }) {
  const editing = Boolean(subscription);
  const customersQ = useErpQuery<TiffinCustomer[]>(
    open && !editing ? "subform:/api/tiffin/customers" : null,
    async () => {
      const r = await fetch("/api/tiffin/customers?status=ACTIVE", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      return Array.isArray(d.customers) ? d.customers : [];
    },
    { ttl: 20000, tags: ["tiffin_customers"] }
  );
  const subsQ = useErpQuery<TiffinSubscription[]>(
    open && !editing ? "subform:/api/tiffin/subscriptions" : null,
    async () => {
      const r = await fetch("/api/tiffin/subscriptions?limit=200", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      return Array.isArray(d.subscriptions) ? d.subscriptions : [];
    },
    { ttl: 20000, tags: ["tiffin_subscriptions", "subscriptions"] }
  );
  const plansQ = useErpQuery<TiffinProduct[]>(
    open ? "subform:/api/tiffin/products" : null,
    async () => {
      const r = await fetch("/api/tiffin/products?status=ACTIVE", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      return Array.isArray(d.products) ? d.products : [];
    },
    { ttl: 60000, tags: ["products", "tiffin_products"] }
  );
  // Only the two monthly plans can be given: 1 thali (any meal) and lunch + dinner. A menu item
  // priced like a single meal (under ₹500) is never offered as a monthly plan; if the menu holds
  // more than one plan of a kind, the full-price one is offered.
  const plans = useMemo(() => {
    const monthly = (plansQ.data ?? []).filter((p) => p.billingUnit === "PER_MONTH" && p.price >= 500).sort((a, b) => b.price - a.price);
    const one = monthly.find((p) => planKind(p) === "ANY");
    const two = monthly.find((p) => planKind(p) === "BOTH");
    const known = [one, two].filter(Boolean) as TiffinProduct[];
    return (known.length ? known : monthly.slice(0, 2)).sort((a, b) => a.price - b.price);
  }, [plansQ.data]);
  const taken = useMemo(() => new Set((subsQ.data ?? []).filter((s) => s.status === "ACTIVE" || s.status === "PAUSED").map((s) => s.customerId)), [subsQ.data]);

  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState<TiffinCustomer | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [planId, setPlanId] = useState("");
  const [meals, setMeals] = useState<SubscriptionMealTypes>("BOTH");
  const [start, setStart] = useState(businessToday());
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<TiffinCustomer | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDuplicate(null);
    setBusy(false);
    if (subscription) {
      setPlanId(subscription.productId);
      setMeals(subscription.mealTypes);
      setStart(subscription.startDate);
      setAddress(subscription.deliveryAddress || "");
    } else {
      setMode("pick");
      setSearch("");
      setCustomer(null);
      setNewName("");
      setNewPhone("");
      setPlanId("");
      setMeals("BOTH");
      setStart(businessToday());
      setAddress("");
    }
  }, [open, subscription]);

  // The first plan is chosen for the user; the meals follow the chosen plan.
  useEffect(() => {
    if (!open || editing || planId || plans.length === 0) return;
    setPlanId(plans[0].id);
  }, [open, editing, planId, plans]);
  const plan = plans.find((p) => p.id === planId) || null;
  const kind = planKind(plan);
  useEffect(() => {
    if (!editing && kind) setMeals(kind);
  }, [kind, editing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (customersQ.data ?? [])
      .filter((c) => !taken.has(c.id))
      .filter((c) => !q || c.fullName.toLowerCase().includes(q) || (c.phone || "").includes(q) || (c.customerCode || "").toLowerCase().includes(q))
      .slice(0, 30);
  }, [customersQ.data, taken, search]);

  if (!open) return null;

  const choose = (c: TiffinCustomer) => {
    setCustomer(c);
    setAddress(c.deliveryAddress || "");
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!editing && mode === "pick" && !customer) return setError("Choose the customer.");
    if (!editing && mode === "new") {
      if (newName.trim().length < 2) return setError("Enter the customer's name.");
      if (phoneProblem(newPhone)) return setError(phoneProblem(newPhone));
    }
    if (!plan && !editing) return setError("Choose a monthly plan.");
    if (address.trim().length < 5) return setError("Enter the delivery address.");
    setBusy(true);
    try {
      if (editing && subscription) {
        const r = await fetch(`/api/tiffin/subscriptions/${subscription.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mealTypes: meals, serviceDays: "ALL_DAYS", deliveryAddress: address.trim() }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Could not save the changes.");
        invalidateErpCache(["tiffin_subscriptions", "subscriptions", "tiffin_customers"]);
        onSaved(`${subscription.customerName || "The subscription"} is updated.`);
        return;
      }
      let target = customer;
      if (mode === "new") {
        const r = await fetch("/api/tiffin/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: newName.trim(), phone: newPhone.trim(), deliveryAddress: address.trim() }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.status === 409 && (d.duplicateWarning || d.isDuplicate)) {
          const digits = newPhone.replace(/\D/g, "").slice(-10);
          const existing = (customersQ.data ?? []).find((c) => (c.phone || "").replace(/\D/g, "").slice(-10) === digits) || null;
          setDuplicate(existing);
          throw new Error(d.error || "This phone number is already a customer.");
        }
        if (!r.ok) throw new Error(d.error || "Could not add the customer.");
        target = d.customer as TiffinCustomer;
      }
      const r = await fetch("/api/tiffin/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: target!.id,
          productId: plan!.id,
          startDate: start,
          mealTypes: meals,
          serviceDays: "ALL_DAYS",
          quantityPerMeal: 1,
          deliveryAddress: address.trim(),
          customPrice: plan!.price,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not start the subscription.");
      invalidateErpCache(["tiffin_subscriptions", "subscriptions", "tiffin_customers", "finance", "receivables"]);
      onSaved(`${target!.fullName} is on ${plan!.name} from ${start}. ${rupees(plan!.price)} a month is added to their dues.`);
    } catch (err: any) {
      setError(friendlyError(err?.message || "Could not save."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 rn-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form role="dialog" aria-modal="true" aria-labelledby="subform-title" onSubmit={submit} noValidate className="rn-modal">
        <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4 border-b border-[rgba(30,35,32,0.08)]">
          <h2 id="subform-title" className="text-[20px] font-semibold text-[#1E2320]">{editing ? "Edit subscription" : "New subscription"}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid place-items-center w-11 h-11 -mr-2 rounded-full text-[#4A504B] hover:bg-black/[0.05]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {error && (
            <p role="alert" className="rounded-2xl bg-[#FDECE8] px-4 py-3 text-[14px] text-[#A3311D]">
              {error}
              {duplicate && !taken.has(duplicate.id) && (
                <button type="button" onClick={() => { setMode("pick"); choose(duplicate); setDuplicate(null); setError(null); }} className="ml-2 font-semibold underline underline-offset-2">
                  Use {duplicate.fullName}
                </button>
              )}
            </p>
          )}

          {/* Customer */}
          <section>
            <span className={LABEL}>Customer</span>
            {editing ? (
              <p className="rounded-2xl bg-[#F6F3EC] px-4 py-3 text-[15px] text-[#1E2320]">
                <span className="font-semibold">{subscription!.customerName}</span>
                <span className="text-[#4A504B]"> · {subscription!.customerPhone}</span>
              </p>
            ) : customer ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-[#1E3A2B] bg-white px-4 py-3">
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-[#1E2320] truncate">{customer.fullName}</span>
                  <span className="block text-[13px] text-[#4A504B]">{customer.phone}</span>
                </span>
                <button type="button" onClick={() => setCustomer(null)} className="h-10 px-4 rounded-full text-[14px] font-semibold text-[#1E3A2B] hover:bg-[#EEF3EA]">Change</button>
              </div>
            ) : mode === "new" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <input aria-label="Name" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} className={FIELD} autoFocus />
                  </div>
                  <div>
                    <input id="subform-phone" type="tel" inputMode="tel" aria-label="Phone" placeholder="10-digit mobile" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} className={FIELD} />
                    <PhoneError value={newPhone} inputId="subform-phone" />
                  </div>
                </div>
                <button type="button" onClick={() => setMode("pick")} className="text-[14px] font-semibold text-[#1E3A2B] hover:underline underline-offset-2">Choose an existing customer instead</button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-[#4A504B]" />
                  <input aria-label="Search customers" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} className={`${FIELD} pl-11`} />
                </div>
                <ul className="max-h-56 overflow-y-auto rounded-2xl border border-[rgba(30,35,32,0.10)] divide-y divide-[rgba(30,35,32,0.06)]" aria-label="Customers">
                  {customersQ.isLoading && !customersQ.data && <li className="px-4 py-4 text-[14px] text-[#4A504B]">Loading customers…</li>}
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => choose(c)} className="w-full min-h-[52px] px-4 py-2 text-left flex items-center justify-between gap-3 hover:bg-[#EEF3EA]">
                        <span className="min-w-0">
                          <span className="block text-[15px] font-medium text-[#1E2320] truncate">{c.fullName}</span>
                          <span className="block text-[13px] text-[#4A504B]">{c.phone}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {customersQ.data && matches.length === 0 && <li className="px-4 py-4 text-[14px] text-[#4A504B]">{search.trim() ? "No customer without a plan matches." : "Every customer already has a plan."}</li>}
                </ul>
                <button type="button" onClick={() => { setMode("new"); setError(null); }} className="inline-flex items-center gap-2 h-11 px-4 rounded-full text-[14px] font-semibold text-[#1E3A2B] hover:bg-[#EEF3EA]">
                  <UserPlus className="w-4 h-4" /> New customer
                </button>
              </div>
            )}
          </section>

          {/* Plan */}
          <section>
            <span className={LABEL}>Monthly plan</span>
            {editing ? (
              <p className="rounded-2xl bg-[#F6F3EC] px-4 py-3 text-[15px] text-[#1E2320]">
                <span className="font-semibold">{subscription!.productName}</span>
                <span className="text-[#4A504B]"> · {rupees(subscription!.price)} a month · {planMealsLabel(subscription!.mealTypes)}</span>
              </p>
            ) : plans.length === 0 ? (
              <p className="rounded-2xl bg-[#FBF0D9] px-4 py-3 text-[14px] text-[#6B4A06]">{plansQ.isLoading ? "Loading plans…" : "Add a monthly plan in Orders → Menu first."}</p>
            ) : (
              <div role="radiogroup" aria-label="Monthly plan" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {plans.map((p) => {
                  const on = p.id === planId;
                  const k = planKind(p);
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => setPlanId(p.id)} className={`relative text-left rounded-2xl border-2 px-4 py-3.5 bg-white transition-colors ${on ? "border-[#1E3A2B]" : "border-[rgba(30,35,32,0.10)] hover:border-[rgba(30,58,43,0.35)]"}`}>
                      <span className="block pr-7 text-[15px] font-semibold text-[#1E2320]">{p.name}</span>
                      <span className="block mt-0.5 text-[14px] text-[#3A403C]">
                        <span className="font-semibold tabular-nums">{rupees(p.price)}</span> a month{k ? ` · ${planMealsLabel(k)}` : ""}
                      </span>
                      {on && <span className="absolute right-3 top-3 grid place-items-center w-6 h-6 rounded-full bg-[#1E3A2B] text-white"><Check className="w-3.5 h-3.5" /></span>}
                    </button>
                  );
                })}
              </div>
            )}
            {editing && meals !== "BOTH" && (
              <div className="mt-3">
                <span className={LABEL}>Meals</span>
                <Segmented label="Meals" value={meals === "LUNCH" || meals === "DINNER" ? meals : "ANY"} onChange={(v) => setMeals(v as SubscriptionMealTypes)} options={[{ value: "ANY", label: "Any meal" }, { value: "LUNCH", label: "Lunch" }, { value: "DINNER", label: "Dinner" }]} />
              </div>
            )}
            {!editing && plan && !kind && (
              <div className="mt-3">
                <span className={LABEL}>Meals</span>
                <Segmented label="Meals" value={meals === "BOTH" ? "BOTH" : "ANY"} onChange={(v) => setMeals(v as SubscriptionMealTypes)} options={[{ value: "BOTH", label: "Lunch + dinner" }, { value: "ANY", label: "1 thali, any meal" }]} />
              </div>
            )}
          </section>

          {!editing && (
            <section>
              <label htmlFor="subform-start" className={LABEL}>Starts on</label>
              <input id="subform-start" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} className={FIELD} aria-label="Starts on" />
            </section>
          )}

          <section>
            <label htmlFor="subform-address" className={LABEL}>Delivery address</label>
            <textarea id="subform-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Flat, building, landmark, area" className={`${FIELD} h-auto py-3 resize-none`} />
          </section>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[rgba(30,35,32,0.08)]">
          <button type="submit" disabled={busy} className="rn-btn-primary h-12 px-6 rounded-full text-[15px] font-semibold disabled:opacity-60">
            {busy ? "Saving…" : editing ? "Save changes" : "Start subscription"}
          </button>
        </div>
      </form>
    </div>
  );
}
