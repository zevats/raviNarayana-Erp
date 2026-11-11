"use client";

import React, { useEffect, useState } from "react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { AppSelect } from "@/components/forms/AppSelect";
import { Dialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/toast";
import { friendlyError } from "@/lib/friendlyError";

export interface Assignee {
  id: string;
  fullName: string;
  role: string;
  isDelivery: boolean;
  isMe: boolean;
}

const ROLE: Record<string, string> = { DELIVERY_PERSON: "Delivery", SUPER_ADMIN: "Owner", OPERATIONS_MANAGER: "Manager", ACCOUNTANT: "Accountant" };

/** Everyone a delivery can go to (all active staff) and who gets new orders by default. */
export function useAssignees(enabled = true) {
  return useErpQuery<{ staff: Assignee[]; defaultStaffId: string | null }>(
    enabled ? "/api/delivery/staff?all=1" : null,
    async () => {
      const r = await fetch("/api/delivery/staff?all=1", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not load staff.");
      return { staff: Array.isArray(d.staff) ? d.staff : [], defaultStaffId: d.defaultStaffId ?? null };
    },
    { ttl: 120000, tags: ["staff", "settings"] }
  );
}

export const assigneeLabel = (s: Assignee) => `${s.fullName}${s.isMe ? " (me)" : ""} · ${ROLE[s.role] ?? s.role}`;

/** "Assign to" select: every active staff member; the default delivery person comes first. */
export function AssignToSelect({ value, onChange, className = "" }: { value: string; onChange: (id: string) => void; className?: string }) {
  const q = useAssignees();
  const staff = q.data?.staff ?? [];
  const def = q.data?.defaultStaffId ?? "";
  // The default delivery person is chosen for the user once the list arrives.
  useEffect(() => {
    if (!value && def) onChange(def);
  }, [def, value, onChange]);
  return (
    <AppSelect value={value} onChange={(e) => onChange(e.target.value)} className={className} aria-label="Assign to">
      {!def && <option value="">Not assigned yet</option>}
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {assigneeLabel(s)}
          {s.id === def ? " · default" : ""}
        </option>
      ))}
    </AppSelect>
  );
}

/** Give a taken order's delivery to someone else (any active staff member). */
export function ReassignDialog({ order, onClose }: { order: { deliveryTaskId?: string | null; customerName: string; assignedTo?: string | null; assignedToName?: string | null } | null; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTo(order?.assignedTo || "");
    setError(null);
  }, [order]);
  const q = useAssignees(Boolean(order));
  const staff = q.data?.staff ?? [];
  const save = async () => {
    if (!order?.deliveryTaskId || !to || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/delivery/tasks/${encodeURIComponent(order.deliveryTaskId)}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-RN-Quiet": "1" },
        body: JSON.stringify({ assignedToStaffId: to }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Could not reassign.");
      const name = staff.find((s) => s.id === to)?.fullName || "them";
      toast.ok(`${order.customerName}'s order is now with ${name}.`);
      invalidateErpCache(["orders", "delivery", "dashboard", "custody"]);
      onClose();
    } catch (e: any) {
      const text = friendlyError(e.message);
      setError(text);
      toast.error(text);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(order)}
      onClose={onClose}
      busy={busy}
      title="Assign to"
      description={order ? `${order.customerName}${order.assignedToName ? ` · now with ${order.assignedToName}` : ""}` : undefined}
      size="sm"
      footer={
        <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" disabled={busy || !to || to === order?.assignedTo} onClick={save}>
          {busy ? "Saving…" : "Assign"}
        </button>
      }
    >
      <div className="space-y-3">
        {!q.data ? (
          <span className="rn-skel block h-12 w-full rounded-2xl" />
        ) : (
          <ul className="rn-due-list" role="radiogroup" aria-label="Staff">
            {staff.map((s) => (
              <li key={s.id}>
                <button type="button" role="radio" aria-checked={to === s.id} onClick={() => setTo(s.id)} className="rn-due-row">
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-[15px] font-semibold text-[var(--rn-ink)] truncate">
                      {s.fullName}
                      {s.isMe ? " (me)" : ""}
                    </span>
                    <span className="block text-[12.5px] text-[var(--rn-ink-2)]">{ROLE[s.role] ?? s.role}{s.id === q.data?.defaultStaffId ? " · default" : ""}</span>
                  </span>
                  <span className={`shrink-0 w-5 h-5 rounded-full border-2 ${to === s.id ? "border-[var(--rn-accent)] bg-[var(--rn-accent)] shadow-[inset_0_0_0_3px_#fff]" : "border-[#C9C3B7]"}`} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="rounded-2xl bg-[#FDECE8] px-4 py-3 text-[14px] text-[#A3311D]">{error}</p>}
      </div>
    </Dialog>
  );
}
