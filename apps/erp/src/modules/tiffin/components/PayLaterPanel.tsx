"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";

interface PayLaterStatus {
  customerId: string;
  customerName: string;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  outstandingDelivery: number;
  unpaidOrders: number;
  oldestUnpaidDate: string | null;
  oldestUnpaidDays: number | null;
  reviewsOpen: number;
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

/**
 * Pay Later approval for one customer (Owner / Manager): whether delivery staff may hand over an
 * order with money still due, the delivery balance already outstanding and how old it is, and who
 * changed the approval last. The server enforces who may change it; there is no credit limit.
 */
export function PayLaterPanel({ customerId, compact = false }: { customerId: string; compact?: boolean }) {
  const [status, setStatus] = useState<PayLaterStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/tiffin/customers/${encodeURIComponent(customerId)}/pay-later`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) return setState("unavailable");
      if (!res.ok) throw new Error(data.error || "Could not load Pay Later.");
      setStatus(data.status);
      setState("ready");
    } catch (e: any) {
      setMessage(e.message);
      setState("error");
    }
  }, [customerId]);

  useEffect(() => {
    setConfirm(null);
    setMessage(null);
    load();
  }, [load]);

  const change = async (enabled: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tiffin/customers/${encodeURIComponent(customerId)}/pay-later`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change Pay Later.");
      setStatus(data.status);
      setConfirm(null);
      setMessage(enabled ? "Pay Later allowed." : "Pay Later stopped. Orders already delivered keep their balance.");
      invalidateErpCache(["tiffin", "delivery", "finance"]);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (state === "unavailable") {
    return (
      <section aria-label="Pay Later" className="p-3 bg-white border border-[#8E9F89]/25 rounded-xl text-[12px] text-[#5A6C5E]">
        Pay Later becomes available after database migration 0021 is installed.
      </section>
    );
  }

  return (
    <section aria-label="Pay Later" className={`bg-white border border-[#8E9F89]/25 rounded-xl ${compact ? "p-3" : "p-3 sm:p-4"} space-y-2.5 text-xs`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#8E9F89]">Pay Later</span>
        {status && (
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${status.enabled ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-[#FAF8F5] text-[#5A6C5E] border border-[#8E9F89]/25"}`}
          >
            {status.enabled ? "Allowed" : "Not allowed"}
          </span>
        )}
      </div>

      {state === "loading" && !status ? (
        <div className="space-y-2" aria-busy="true">
          <span className="rn-skel block h-4 w-2/3 rounded" />
          <span className="rn-skel block h-4 w-1/2 rounded" />
        </div>
      ) : state === "error" ? (
        <p role="alert" className="text-[#9A3423]">{message}</p>
      ) : status ? (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <dt className="text-[#5A6C5E]">Delivery balance due</dt>
            <dd className={`text-right font-semibold tabular-nums ${status.outstandingDelivery > 0 ? "text-[#9A3423]" : "text-[#1A2E20]"}`}>{formatMoney(status.outstandingDelivery)}</dd>
            <dt className="text-[#5A6C5E]">Unpaid orders</dt>
            <dd className="text-right tabular-nums text-[#1A2E20]">{status.unpaidOrders}</dd>
            <dt className="text-[#5A6C5E]">Oldest unpaid</dt>
            <dd className="text-right text-[#1A2E20]">{status.oldestUnpaidDate ? `${status.oldestUnpaidDate} · ${status.oldestUnpaidDays} day${status.oldestUnpaidDays === 1 ? "" : "s"}` : "—"}</dd>
            {status.reviewsOpen > 0 && (
              <>
                <dt className="text-[#9A3423]">To review</dt>
                <dd className="text-right font-semibold text-[#9A3423]">{status.reviewsOpen} order{status.reviewsOpen === 1 ? "" : "s"}</dd>
              </>
            )}
          </dl>
          <p className="text-[11px] text-[#8E9F89]">
            {status.updatedAt ? `Last changed by ${status.updatedBy || "staff"} on ${when(status.updatedAt)}` : "Never changed"}
          </p>
          {message && <p role="status" className="text-[12px] text-[#1A2E20]">{message}</p>}
          {confirm === null ? (
            <button
              type="button"
              onClick={() => setConfirm(!status.enabled)}
              className={`w-full min-h-[40px] rounded-lg text-[12px] font-semibold ${status.enabled ? "border border-[#9A3423]/40 text-[#9A3423] bg-white hover:bg-[#FBE3DD]" : "bg-[#1A2E20] text-white hover:bg-[#2C4433]"}`}
            >
              {status.enabled ? "Stop Pay Later" : "Allow Pay Later"}
            </button>
          ) : (
            <div className="rounded-lg bg-[#FAF8F5] border border-[#8E9F89]/25 p-2.5 space-y-2">
              <p className="text-[12px] text-[#1A2E20]">
                {confirm
                  ? `Allow ${status.customerName} to receive deliveries and pay later? There is no credit limit.`
                  : `Stop Pay Later for ${status.customerName}? New deliveries must be paid at the door; the ${formatMoney(status.outstandingDelivery)} already due stays on the account.`}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirm(null)} className="min-h-[40px] rounded-lg border border-[#8E9F89]/30 bg-white text-[12px] font-semibold text-[#1A2E20]">
                  Back
                </button>
                <button type="button" disabled={busy} onClick={() => change(confirm)} className="min-h-[40px] rounded-lg bg-[#1A2E20] text-white text-[12px] font-semibold disabled:opacity-60">
                  {busy ? "Saving…" : confirm ? "Allow" : "Stop"}
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
