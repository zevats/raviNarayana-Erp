"use client";

import React, { useEffect, useState } from "react";
import { Building2, Clock, Truck, CalendarClock, Bell, CheckCircle2, AlertCircle } from "lucide-react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { SelectMenu } from "@/components/forms/SelectMenu";
import { FullPageLoader } from "@/components/feedback/FullPageLoader";

interface SettingsPayload {
  settings: {
    business: { name: string; phone: string; email: string; address: string; websiteUrl: string };
    meals: { breakfastPrepareAt: string; breakfastCutoffAt: string; lunchPrepareAt: string; lunchCutoffAt: string; dinnerPrepareAt: string; dinnerCutoffAt: string };
    delivery: { defaultDriverId: string | null };
    finance: { rentDueDay: number | null };
    notifications: { subscriptionExpiry: boolean; pendingHandover: boolean; closingReminder: boolean };
  };
  lastChanged: Record<string, { at: string; by: string | null }>;
  deliveryStaff: Array<{ id: string; fullName: string; active: boolean }>;
}
type Section = keyof SettingsPayload["settings"];

const input = "rn-input w-full";
const label = "block text-[12px] font-medium text-[var(--rn-ink-3)] mb-1.5";

function Card({ icon: Icon, title, changed, children, wide = false }: { icon: React.ElementType; title: string; changed?: { at: string; by: string | null }; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`rn-card p-5 sm:p-6 space-y-4 ${wide ? "xl:col-span-2" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--rn-accent-tint)] text-[var(--rn-accent-mid)] shrink-0">
          <Icon className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">{title}</h2>
          {changed && (
            <p className="text-[11.5px] text-[var(--rn-ink-3)] mt-1">
              Last changed {new Date(changed.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}
              {changed.by ? ` by ${changed.by}` : ""}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function SaveRow({ busy, onSave, message }: { busy: boolean; onSave: () => void; message: { ok: boolean; text: string } | null }) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <button type="button" onClick={onSave} disabled={busy} className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-full bg-[#1A2E20] text-white text-sm font-semibold hover:bg-[#263B2D] disabled:opacity-60">
        {busy ? "Saving…" : "Save"}
      </button>
      {message && (
        <span className={`inline-flex items-center gap-1.5 text-xs ${message.ok ? "text-emerald-700" : "text-rose-700"}`}>
          {message.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {message.text}
        </span>
      )}
    </div>
  );
}

export function SettingsView() {
  const q = useErpQuery<SettingsPayload>(
    "/api/settings",
    async () => {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load the settings.");
      return body;
    },
    { ttl: 5000, tags: ["settings"] }
  );
  const [draft, setDraft] = useState<SettingsPayload["settings"] | null>(null);
  const [busy, setBusy] = useState<Section | null>(null);
  const [messages, setMessages] = useState<Partial<Record<Section, { ok: boolean; text: string }>>>({});
  // Each section message clears itself after a time limit (errors stay longer to be read).
  useEffect(() => {
    const list = Object.values(messages);
    if (list.length === 0) return;
    const t = setTimeout(() => setMessages({}), list.some((m) => m && !m.ok) ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [messages]);

  useEffect(() => {
    if (q.data && !draft) setDraft(q.data.settings);
  }, [q.data, draft]);

  if (q.error && !q.data) {
    return <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-sm">{q.error.message}</div>;
  }
  if (!q.data || !draft) return <FullPageLoader label="Loading settings" size="md" />;

  const set = <S extends Section>(section: S, patch: Partial<SettingsPayload["settings"][S]>) =>
    setDraft((d) => (d ? { ...d, [section]: { ...d[section], ...patch } } : d));

  const save = async (section: Section) => {
    setBusy(section);
    setMessages((m) => ({ ...m, [section]: undefined }));
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, values: draft[section] }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save.");
      setDraft((d) => (d ? { ...d, [section]: body.settings[section] } : d));
      invalidateErpCache(["settings"]);
      setMessages((m) => ({ ...m, [section]: { ok: true, text: "Saved." } }));
    } catch (err: any) {
      setMessages((m) => ({ ...m, [section]: { ok: false, text: err.message } }));
    } finally {
      setBusy(null);
    }
  };

  const { lastChanged, deliveryStaff } = q.data;
  const chosen = deliveryStaff.find((s) => s.id === draft.delivery.defaultDriverId);
  const driverOptions = [
    { value: "", label: "Automatic (the longest-serving active delivery staff)" },
    ...deliveryStaff.filter((s) => s.active || s.id === draft.delivery.defaultDriverId).map((s) => ({ value: s.id, label: s.active ? s.fullName : `${s.fullName} (switched off)` })),
  ];

  return (
    <div className="grid gap-5 xl:grid-cols-2 items-start">
      <Card wide icon={Building2} title="Business details" changed={lastChanged.business}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={label} htmlFor="b-name">Business name</label>
            <input id="b-name" className={input} value={draft.business.name} onChange={(e) => set("business", { name: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="b-phone">Phone</label>
            <input id="b-phone" className={input} inputMode="tel" value={draft.business.phone} onChange={(e) => set("business", { phone: e.target.value })} />
          </div>
          <div>
            <label className={label} htmlFor="b-email">Email</label>
            <input id="b-email" className={input} type="email" value={draft.business.email} onChange={(e) => set("business", { email: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="b-address">Address</label>
            <textarea id="b-address" rows={2} className={`${input} py-2`} value={draft.business.address} onChange={(e) => set("business", { address: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="b-web">Website</label>
            <input id="b-web" className={input} placeholder="https://" value={draft.business.websiteUrl} onChange={(e) => set("business", { websiteUrl: e.target.value })} />
          </div>
        </div>
        <SaveRow busy={busy === "business"} onSave={() => save("business")} message={messages.business ?? null} />
      </Card>

      <Card icon={Clock} title="Meal times" changed={lastChanged.meals}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {([
            ["breakfastPrepareAt", "Breakfast list at"],
            ["breakfastCutoffAt", "Breakfast cutoff"],
            ["lunchPrepareAt", "Lunch list at"],
            ["lunchCutoffAt", "Lunch cutoff"],
            ["dinnerPrepareAt", "Dinner list at"],
            ["dinnerCutoffAt", "Dinner cutoff"],
          ] as const).map(([k, l]) => (
            <div key={k}>
              <label className={label} htmlFor={`m-${k}`}>{l}</label>
              <input id={`m-${k}`} type="time" className={input} value={draft.meals[k]} onChange={(e) => set("meals", { [k]: e.target.value } as any)} />
            </div>
          ))}
        </div>
        <SaveRow busy={busy === "meals"} onSave={() => save("meals")} message={messages.meals ?? null} />
      </Card>

      <Card icon={Truck} title="Default delivery partner" changed={lastChanged.delivery}>
        <SelectMenu
          label="Default delivery partner"
          tone="forest"
          value={draft.delivery.defaultDriverId ?? ""}
          onChange={(v) => set("delivery", { defaultDriverId: v || null })}
          options={driverOptions}
          triggerClassName="bg-white border border-[#8E9F89]/40 text-[#1A2E20]"
        />
        {chosen && !chosen.active && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
            {chosen.fullName}&apos;s account is switched off. New orders wait unassigned until you choose someone else.
          </p>
        )}
        <SaveRow busy={busy === "delivery"} onSave={() => save("delivery")} message={messages.delivery ?? null} />
      </Card>

      <Card icon={CalendarClock} title="Monthly rent" changed={lastChanged.finance}>
        <div className="max-w-[220px]">
          <label className={label} htmlFor="f-due">Rent due day (1–28)</label>
          <input
            id="f-due"
            type="number"
            min={1}
            max={28}
            inputMode="numeric"
            className={input}
            value={draft.finance.rentDueDay ?? ""}
            onChange={(e) => set("finance", { rentDueDay: e.target.value === "" ? null : Number(e.target.value) })}
          />
        </div>
        <SaveRow busy={busy === "finance"} onSave={() => save("finance")} message={messages.finance ?? null} />
      </Card>

      <Card icon={Bell} title="Alerts" changed={lastChanged.notifications}>
        <div className="space-y-2">
          {([
            ["subscriptionExpiry", "Subscriptions ending within 7 days"],
            ["pendingHandover", "Cash handed over but not yet accepted"],
            ["closingReminder", "Yesterday's cash not closed"],
          ] as const).map(([k, l]) => (
            <label key={k} className="flex items-center gap-3 text-sm text-[#1A2E20]">
              <input type="checkbox" className="w-4 h-4 accent-[#1A2E20]" checked={draft.notifications[k]} onChange={(e) => set("notifications", { [k]: e.target.checked } as any)} />
              {l}
            </label>
          ))}
        </div>
        <SaveRow busy={busy === "notifications"} onSave={() => save("notifications")} message={messages.notifications ?? null} />
      </Card>
    </div>
  );
}
