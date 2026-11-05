"use client";

import React, { useState } from "react";
import { ShieldCheck, AlertCircle } from "lucide-react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { useHasPermission } from "@/components/auth/CurrentUserContext";
import { formatINR } from "@/modules/finance/utils/formatUtils";

interface Proposal {
  id: string;
  residentName: string;
  roomNumber: string | null;
  checkoutDate: string;
  refundAmount: number;
  deductionsAmount: number;
  depositAppliedAmount: number;
  proposedByName: string | null;
  createdAt: string;
  payload: { deductions?: Array<{ reason: string; amount: number }>; refundPaymentMethod?: string };
}

/**
 * Checkout settlements a Manager has sent for approval. The Owner approves (the checkout and
 * settlement are then finalized) or rejects with a reason; the Manager sees them waiting and can
 * withdraw one. Shows nothing when none are waiting.
 */
export function SettlementApprovals({ onDecided }: { onDecided: () => void }) {
  const isOwner = useHasPermission("finance.manage");
  const q = useErpQuery<{ proposals: Proposal[] }>(
    "/api/residents/settlement-proposals",
    async () => {
      const res = await fetch("/api/residents/settlement-proposals", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not load settlements waiting for approval.");
      return body;
    },
    { ttl: 15000, tags: ["residents", "finance"] }
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const proposals = q.data?.proposals ?? [];
  if (proposals.length === 0) return null;

  const act = async (id: string, action: "approve" | "reject" | "withdraw") => {
    let note: string | undefined;
    if (action === "reject") {
      const reason = window.prompt("Why is this settlement rejected?");
      if (!reason) return;
      note = reason;
    } else if (action === "approve" && !window.confirm("Approve this settlement? The resident is checked out and the deposit amounts are posted now.")) {
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const res = await fetch("/api/residents/settlement-proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, note }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not update the settlement.");
      invalidateErpCache(["residents", "rooms", "finance", "dashboard"]);
      await q.refetch();
      onDecided();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-label="Settlements waiting for approval" className="p-4 rounded-2xl border border-amber-200 bg-amber-50/60 space-y-3">
      <h2 className="text-sm font-bold text-[#1A2E20] flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-[#B58A57]" />
        {isOwner ? "Checkout settlements waiting for your approval" : "Checkout settlements waiting for the Owner"}
      </h2>
      {error && <p className="text-xs text-rose-700 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</p>}
      <ul className="space-y-2">
        {proposals.map((p) => (
          <li key={p.id} className="bg-white border border-[#8E9F89]/25 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-[#5A6C5E]">
              <p className="text-sm font-semibold text-[#1A2E20]">{p.residentName}{p.roomNumber ? ` · Room ${p.roomNumber}` : ""} · leaving {p.checkoutDate}</p>
              <p className="mt-0.5 tabular-nums">
                Refund {formatINR(p.refundAmount)}{p.payload.refundPaymentMethod ? ` (${p.payload.refundPaymentMethod})` : ""} · Deductions {formatINR(p.deductionsAmount)} · Deposit to rent {formatINR(p.depositAppliedAmount)}
              </p>
              {(p.payload.deductions ?? []).length > 0 && (
                <p className="mt-0.5">{(p.payload.deductions ?? []).map((d) => `${d.reason} ${formatINR(d.amount)}`).join(", ")}</p>
              )}
              <p className="mt-0.5">Prepared by {p.proposedByName || "Manager"}</p>
            </div>
            <div className="flex items-center gap-2">
              {isOwner ? (
                <>
                  <button type="button" disabled={busy === p.id} onClick={() => act(p.id, "reject")} className="px-3 py-1.5 rounded-xl border border-rose-200 text-rose-700 text-xs font-semibold hover:bg-rose-50 disabled:opacity-50">Reject</button>
                  <button type="button" disabled={busy === p.id} onClick={() => act(p.id, "approve")} className="px-3 py-1.5 rounded-xl bg-[#1A2E20] text-white text-xs font-semibold hover:bg-[#263B2D] disabled:opacity-50">Approve</button>
                </>
              ) : (
                <button type="button" disabled={busy === p.id} onClick={() => act(p.id, "withdraw")} className="px-3 py-1.5 rounded-xl border border-[#8E9F89]/40 text-[#1A2E20] text-xs font-semibold hover:bg-[#FAF8F5] disabled:opacity-50">Withdraw</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
