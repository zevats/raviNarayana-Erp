"use client";

import { friendlyError } from "@/lib/friendlyError";
import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useState } from "react";
import { X } from "lucide-react";
import type { DriverCashHandover, StaffRole } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";

const rupees = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
const thalis = (n: number) => `${n} thali${n === 1 ? "" : "s"}`;

interface ThaliReturn {
  id: string;
  staffId: string;
  staffName: string | null;
  quantity: number;
  note: string | null;
}

/** One thing waiting to be accepted: cash handed over, or thalis handed back. */
type Item =
  | { kind: "cash"; id: string; who: string; declared: number; cash: DriverCashHandover }
  | { kind: "thali"; id: string; who: string; declared: number; note: string | null };

/**
 * Owner / Manager: when delivery staff hand over cash or hand back thalis, a pop-up asks to accept
 * it. Everything is done here: Accept takes exactly what was given; "Count is different" asks for
 * what was received and why, in the same pop-up. "Later" hides it for this visit (it stays in
 * Delivery until accepted). Cash is accepted by the Owner; thalis by the Owner or a Manager.
 * Live updates refresh the lists at once; polling is the fallback.
 */
export function HandoverAlert({ role, userId }: { role: StaffRole; userId: string }) {
  const owner = role === "SUPER_ADMIN";
  const cashQ = useErpQuery<DriverCashHandover[]>(
    owner ? "/api/delivery/handover?status=DECLARED" : null,
    async () => {
      const res = await fetch("/api/delivery/handover?status=DECLARED");
      if (res.status === 401 || res.status === 403) return [];
      if (!res.ok) throw new Error("Could not load handovers.");
      const data = await res.json();
      return Array.isArray(data.handovers) ? data.handovers : [];
    },
    { ttl: 20000, tags: ["handover", "custody"], pollIntervalMs: 20000 }
  );
  const thaliQ = useErpQuery<ThaliReturn[]>(
    "handover-alert:/api/delivery/thalis",
    async () => {
      const res = await fetch("/api/delivery/thalis");
      if (!res.ok) return [];
      const data = await res.json().catch(() => ({}));
      return Array.isArray(data.pending) ? data.pending : [];
    },
    { ttl: 20000, tags: ["thalis", "custody"], pollIntervalMs: 20000 }
  );
  const [later, setLater] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useTimedMessage<string>();
  // "Count is different": what was received and why, typed in the pop-up itself.
  const [different, setDifferent] = useState<string | null>(null);
  const [received, setReceived] = useState("");
  const [reason, setReason] = useState("");

  const items: Item[] = [
    ...(cashQ.data ?? []).filter((h) => h.status === "DECLARED").map((h): Item => ({ kind: "cash", id: h.id, who: h.driverName || "Delivery staff", declared: h.declaredCash, cash: h })),
    // Someone else checks the thalis a manager hands back themselves.
    ...(thaliQ.data ?? []).filter((m) => owner || m.staffId !== userId).map((m): Item => ({ kind: "thali", id: m.id, who: m.staffName || "Delivery staff", declared: m.quantity, note: m.note })),
  ].filter((i) => !later.includes(i.id));
  const item = items[0];
  if (!item && !done) return null;

  const amount = (i: Item, n: number) => (i.kind === "cash" ? rupees(n) : thalis(n));
  const refresh = () => invalidateErpCache(["handover", "custody", "thalis", "finance", "dashboard", "delivery"]);
  const send = async (i: Item, got: number, why: string) => {
    const res =
      i.kind === "cash"
        ? await fetch(`/api/delivery/handover/${i.id}/accept`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ acceptedCash: got, acceptedUpi: i.cash.declaredUpi || 0, expectedDeclaredCash: i.cash.declaredCash, varianceReason: why || undefined }),
          })
        : await fetch("/api/delivery/thalis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "verify", moveId: i.id, receivedQuantity: got, note: why || undefined }),
          });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not accept it. Try again.");
  };

  // Accept is instant: the pop-up closes and the confirmation shows at once; the request goes on in
  // the background. If it is refused, the pop-up comes back with the reason.
  const accept = () => {
    if (!item || busy) return;
    const target = item;
    setError(null);
    setLater((l) => [...l, target.id]);
    setDone(`${amount(target, target.declared)} from ${target.who} accepted.`);
    send(target, target.declared, "")
      .then(refresh)
      .catch((e: any) => {
        setDone(null);
        setLater((l) => l.filter((id) => id !== target.id));
        setError(friendlyError(e?.message || "Could not accept it. Try again."));
      });
  };

  const got = Math.round(Number(received));
  const gotOk = received.trim() !== "" && Number.isInteger(got) && got >= 0 && (item?.kind === "cash" || got <= (item?.declared ?? 0));
  const needReason = gotOk && item ? got !== item.declared : false;
  const reasonOk = !needReason || reason.trim().length >= 5;
  const acceptDifferent = async () => {
    if (!item || busy || !gotOk || !reasonOk) return;
    const target = item;
    setBusy(true);
    setError(null);
    try {
      await send(target, got, reason.trim());
      setLater((l) => [...l, target.id]);
      setDifferent(null);
      setDone(`${amount(target, got)} from ${target.who} accepted.`);
      refresh();
    } catch (e: any) {
      setError(friendlyError(e?.message || "Could not accept it. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!item && done) {
    return (
      <div role="status" className="fixed bottom-6 right-6 z-[65] max-w-sm rounded-2xl bg-[#1F3A1A] text-white px-4 py-3 shadow-xl flex items-center gap-3">
        <span className="text-[14px] font-semibold flex-1">{done}</span>
        <button type="button" onClick={() => setDone(null)} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }
  if (!item) return null;

  const cash = item.kind === "cash" ? item.cash : null;
  const short = cash ? (cash.recordedCash ?? cash.declaredCash) - cash.declaredCash : 0;
  const editing = different === item.id;
  const hide = () => {
    setLater((l) => [...l, item.id]);
    setDifferent(null);
    setError(null);
  };
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-[rgba(24,16,10,0.45)] backdrop-blur-[4px] rn-handover-pop">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="handover-alert-title"
        className="w-full max-w-[420px] rounded-[26px] shadow-[0_30px_80px_-30px_rgba(40,20,10,0.6)] overflow-hidden"
        style={{ backgroundColor: "#FFFFFF" }}
      >
        <div className="px-6 pt-6 pb-4">
          <p className="text-[12.5px] font-semibold text-[#8A6A4F]">
            {item.kind === "cash" ? "Cash to accept" : "Thalis to accept"}
            {items.length > 1 ? ` · ${items.length - 1} more after this` : ""}
          </p>
          <h2 id="handover-alert-title" className="mt-1 text-[21px] leading-snug font-bold text-[#1F2320]">
            {item.who} gave {item.kind === "cash" ? `${rupees(item.declared)} in cash` : thalis(item.declared)}
          </h2>
        </div>
        {cash && !editing && (
          <dl className="mx-6 text-[15px]">
            <div className="flex justify-between gap-3 py-2.5">
              <dt className="text-[#3E4E42]">Cash given</dt>
              <dd className="font-bold tabular-nums text-[#1F2320]">{rupees(cash.declaredCash)}</dd>
            </div>
            {cash.recordedCash !== undefined && (
              <div className="flex justify-between gap-3 py-2.5 border-t border-[#EFE9E0]">
                <dt className="text-[#3E4E42]">Collected from customers</dt>
                <dd className="font-semibold tabular-nums text-[#1F2320]">{rupees(cash.recordedCash)}</dd>
              </div>
            )}
            {(cash.declaredUpi || 0) > 0 && (
              <div className="flex justify-between gap-3 py-2.5 border-t border-[#EFE9E0]">
                <dt className="text-[#3E4E42]">Paid by UPI</dt>
                <dd className="font-semibold tabular-nums text-[#1F2320]">{rupees(cash.declaredUpi || 0)}</dd>
              </div>
            )}
            {short > 0 && (
              <div className="-mx-3 mt-1 px-3 py-2.5 rounded-xl bg-[#FDEFEA]">
                <div className="flex justify-between gap-3">
                  <dt className="font-semibold text-[#8A1F12]">Not given yet</dt>
                  <dd className="font-bold tabular-nums text-[#8A1F12]">{rupees(short)}</dd>
                </div>
                {cash.shortfallReason && <p className="mt-0.5 text-[13px] text-[#6B2A1E]">Reason: {cash.shortfallReason}</p>}
              </div>
            )}
          </dl>
        )}
        {item.kind === "thali" && !editing && item.note && <p className="mx-6 text-[14px] text-[#3E4E42]">{item.note}</p>}

        {editing && (
          <div className="mx-6 space-y-3">
            <label className="block">
              <span className="block text-[13px] font-semibold text-[#3E4E42] mb-1.5">{item.kind === "cash" ? "Cash you received" : "Thalis you received"}</span>
              <input
                value={received}
                onChange={(e) => setReceived(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
                inputMode="numeric"
                autoFocus
                aria-label={item.kind === "cash" ? "Cash you received" : "Thalis you received"}
                className="w-full h-12 px-4 rounded-2xl border border-[#D6CFC5] bg-white text-[18px] font-bold tabular-nums text-[#1F2320] outline-none focus:border-[#C9501C] focus:ring-4 focus:ring-[#C9501C]/15"
              />
            </label>
            {item.kind === "thali" && received.trim() !== "" && got > item.declared && <p className="text-[13px] font-semibold text-[#8A1F12]">{thalis(item.declared)} were given; you cannot receive more.</p>}
            {needReason && (
              <label className="block">
                <span className="block text-[13px] font-semibold text-[#3E4E42] mb-1.5">Why is it different?</span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  aria-label="Why is it different?"
                  className="w-full h-12 px-4 rounded-2xl border border-[#D6CFC5] bg-white text-[15px] text-[#1F2320] outline-none focus:border-[#C9501C] focus:ring-4 focus:ring-[#C9501C]/15"
                />
              </label>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mx-6 mt-3 text-[13px] text-[#8A1F12]">
            {error}
          </p>
        )}
        {editing ? (
          <div className="px-5 py-4 mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setDifferent(null);
                setError(null);
              }}
              disabled={busy}
              className="h-12 px-4 rounded-full border border-[#D6CFC5] text-[14px] font-semibold text-[#1F2320] hover:bg-[#F6F2EC]"
            >
              Back
            </button>
            <button type="button" onClick={acceptDifferent} disabled={busy || !gotOk || !reasonOk} className="h-12 px-5 rounded-full bg-[#C9501C] hover:bg-[#B4440F] text-white text-[15px] font-bold disabled:opacity-50">
              {busy ? "Accepting…" : gotOk ? `Accept ${amount(item, got)}` : "Accept"}
            </button>
          </div>
        ) : (
          <div className="px-5 py-4 mt-1 flex flex-wrap items-center gap-2">
            <button type="button" onClick={accept} disabled={busy} className="h-12 px-5 rounded-full bg-[#C9501C] hover:bg-[#B4440F] text-white text-[15px] font-bold disabled:opacity-60 flex-1 min-w-[160px]">
              Accept {amount(item, item.declared)}
            </button>
            <button
              type="button"
              onClick={() => {
                setDifferent(item.id);
                setReceived("");
                setReason("");
                setError(null);
              }}
              className="h-12 px-4 rounded-full border border-[#D6CFC5] text-[14px] font-semibold text-[#1F2320] hover:bg-[#F6F2EC]"
            >
              Count is different
            </button>
            <button type="button" onClick={hide} className="h-12 px-4 rounded-full text-[14px] font-semibold text-[#5A5450] hover:bg-[#F6F2EC]">
              Later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
