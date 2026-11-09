"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Banknote, X } from "lucide-react";
import type { DriverCashHandover } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";

const rupees = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

/**
 * Owner / Manager portal: when a delivery employee hands over cash, a pop-up asks to accept it.
 * Accept records exactly what was handed over; if the count is different, "Count differs" opens the
 * full verification (Delivery → Custody), where a different amount and its reason are entered.
 * "Later" hides that handover for this visit; it stays in the custody list until verified.
 * Live updates refresh the list at once (tag "handover"); polling is the fallback.
 */
export function HandoverAlert() {
  const q = useErpQuery<DriverCashHandover[]>(
    "/api/delivery/handover?status=DECLARED",
    async () => {
      const res = await fetch("/api/delivery/handover?status=DECLARED");
      if (res.status === 401 || res.status === 403) return [];
      if (!res.ok) throw new Error("Could not load handovers.");
      const data = await res.json();
      return Array.isArray(data.handovers) ? data.handovers : [];
    },
    { ttl: 20000, tags: ["handover", "custody"], pollIntervalMs: 20000 }
  );
  const [later, setLater] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const open = (q.data ?? []).filter((h) => h.status === "DECLARED" && !later.includes(h.id));
  const h = open[0];
  if (!h && !done) return null;

  const accept = async () => {
    if (!h || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/delivery/handover/${h.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptedCash: h.declaredCash, acceptedUpi: h.declaredUpi || 0, expectedDeclaredCash: h.declaredCash }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not accept the handover.");
      setDone(`${rupees(h.declaredCash)} cash from ${h.driverName || "the employee"} accepted.`);
      setLater((l) => [...l, h.id]);
      invalidateErpCache(["handover", "custody", "finance", "dashboard", "delivery"]);
    } catch (e: any) {
      setError(e?.message || "Could not accept the handover.");
    } finally {
      setBusy(false);
    }
  };

  if (!h && done) {
    return (
      <div role="status" className="fixed bottom-6 right-6 z-[65] max-w-sm rounded-2xl bg-[#1F3A1A] text-white px-4 py-3 shadow-xl flex items-center gap-3">
        <span className="text-[14px] font-semibold flex-1">{done}</span>
        <button type="button" onClick={() => setDone(null)} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }
  if (!h) return null;

  const short = (h.recordedCash ?? h.declaredCash) - h.declaredCash;
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-[rgba(24,16,10,0.45)] backdrop-blur-[4px]">
      <div role="alertdialog" aria-modal="true" aria-labelledby="handover-alert-title" className="w-full max-w-[440px] rounded-[26px] bg-white shadow-[0_30px_80px_-30px_rgba(40,20,10,0.6)] overflow-hidden">
        <div className="px-5 pt-5 pb-4 flex items-start gap-3">
          <span className="w-11 h-11 rounded-2xl bg-[#E4F2E0] text-[#2F6B24] flex items-center justify-center shrink-0">
            <Banknote className="w-5 h-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-[#8A6A4F]">Cash handover to accept</p>
            <h2 id="handover-alert-title" className="text-[19px] leading-snug font-bold text-[#1F2320]">
              {h.driverName || "Delivery employee"} handed over {rupees(h.declaredCash)}
            </h2>
            {open.length > 1 && <p className="text-[12.5px] text-[#5A5450]">{open.length - 1} more waiting after this one</p>}
          </div>
        </div>
        <dl className="mx-5 rounded-2xl border border-[#ECE6DB] text-[14px] overflow-hidden">
          <div className="flex justify-between gap-3 px-3.5 py-2.5">
            <dt className="text-[#3E4E42]">Cash handed over</dt>
            <dd className="font-bold tabular-nums text-[#1F2320]">{rupees(h.declaredCash)}</dd>
          </div>
          {h.recordedCash !== undefined && (
            <div className="flex justify-between gap-3 px-3.5 py-2.5 border-t border-[#F1ECE3]">
              <dt className="text-[#3E4E42]">Cash recorded at the doors</dt>
              <dd className="font-semibold tabular-nums text-[#1F2320]">{rupees(h.recordedCash)}</dd>
            </div>
          )}
          {short > 0 && (
            <div className="px-3.5 py-2.5 border-t border-[#F1ECE3] bg-[#FDF0EC]">
              <div className="flex justify-between gap-3">
                <dt className="font-semibold text-[#8A1F12]">Short (stays owed by the employee)</dt>
                <dd className="font-bold tabular-nums text-[#8A1F12]">{rupees(short)}</dd>
              </div>
              {h.shortfallReason && <p className="mt-1 text-[12.5px] text-[#6B2A1E]">Reason: {h.shortfallReason}</p>}
            </div>
          )}
          {(h.declaredUpi || 0) > 0 && (
            <div className="flex justify-between gap-3 px-3.5 py-2.5 border-t border-[#F1ECE3]">
              <dt className="text-[#3E4E42]">UPI (paid to the business account)</dt>
              <dd className="font-semibold tabular-nums text-[#1F2320]">{rupees(h.declaredUpi || 0)}</dd>
            </div>
          )}
        </dl>
        {error && <p role="alert" className="mx-5 mt-3 text-[13px] text-[#8A1F12]">{error}</p>}
        <div className="px-5 py-4 mt-1 flex flex-wrap items-center gap-2">
          <button type="button" onClick={accept} disabled={busy} className="h-12 px-5 rounded-full bg-[#2F6B24] hover:bg-[#25561C] text-white text-[15px] font-bold disabled:opacity-60 flex-1 min-w-[160px]">
            {busy ? "Accepting…" : `Accept ${rupees(h.declaredCash)}`}
          </button>
          <Link
            href="/delivery?tab=custody"
            onClick={() => setLater((l) => [...l, h.id])}
            className="h-12 px-4 rounded-full border border-[#D6CFC5] text-[14px] font-semibold text-[#1F2320] flex items-center hover:bg-[#F6F2EC]"
          >
            Count differs
          </Link>
          <button type="button" onClick={() => setLater((l) => [...l, h.id])} className="h-12 px-4 rounded-full text-[14px] font-semibold text-[#5A5450] hover:bg-[#F6F2EC]">
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
