"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useEffect, useState } from "react";
import { X, CalendarClock, AlertCircle, CheckCircle2 } from "lucide-react";
import { invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessMonthKey } from "@/lib/businessDate";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { formatINR } from "../../utils/formatUtils";

interface Line {
  stayId: string;
  residentName: string;
  roomNumber: string;
  monthlyRent: number;
  nights: number;
  days: number;
  amount: number;
  status: "TO_CHARGE" | "CHARGED" | "ALREADY_CHARGED" | "MANUAL_CHARGE_EXISTS" | "NOTHING_DUE";
}

const STATUS_LABEL: Record<Line["status"], string> = {
  TO_CHARGE: "To charge",
  CHARGED: "Charged",
  ALREADY_CHARGED: "Already charged",
  MANUAL_CHARGE_EXISTS: "Charged by hand this month",
  NOTHING_DUE: "Nothing due",
};

/**
 * Monthly rent for every resident: preview (prorated by nights for partial months), then charge.
 * Safe to run again; nobody is charged twice.
 */
export function RentRunModal({ isOpen, onClose, onDone }: { isOpen: boolean; onClose: () => void; onDone: () => void }) {
  const [month, setMonth] = useState(businessMonthKey(0));
  const [data, setData] = useState<{ label: string; lines: Line[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useTimedMessage<{ ok: boolean; text: string }>();

  const load = async (m: string) => {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/finance/rent-run?month=${m}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not prepare the rent preview.");
      setData(body);
    } catch (err: any) {
      setData(null);
      setMsg({ ok: false, text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) load(month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, month]);

  if (!isOpen) return null;
  const toCharge = data?.lines.filter((l) => l.status === "TO_CHARGE") ?? [];

  const charge = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/finance/rent-run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not charge the rent.");
      invalidateErpCache(["finance", "residents", "dashboard"]);
      setMsg({ ok: true, text: body.charged > 0 ? `Charged ${body.charged} resident(s), ${formatINR(body.total)} in total.` : "Nothing left to charge for this month." });
      onDone();
      await load(month);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="rent-run-title" className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#1A2E20]/60 backdrop-blur-xs">
      <div className="bg-[#FAF8F5] border border-[#8E9F89]/30 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90dvh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-5 bg-white border-b border-[#8E9F89]/20">
          <h2 id="rent-run-title" className="text-base font-bold text-[#1A2E20] flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-[#B58A57]" /> Monthly rent
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[#5A6C5E] hover:bg-[#FAF8F5]">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[businessMonthKey(0), businessMonthKey(-1)].map((m) => (
              <button key={m} type="button" onClick={() => setMonth(m)} aria-pressed={month === m} className={`px-3 py-1.5 rounded-lg font-semibold ${month === m ? "bg-[#1A2E20] text-white" : "bg-white border border-[#8E9F89]/30 text-[#5A6C5E]"}`}>
                {m === businessMonthKey(0) ? "This month" : "Last month"}
              </button>
            ))}
            <span className="text-[#5A6C5E]">Partial months are charged by nights stayed.</span>
          </div>
          {msg && (
            <p className={`text-xs flex items-center gap-1.5 ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>
              {msg.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {msg.text}
            </p>
          )}
          {loading && !data ? (
            <div className="py-10 flex justify-center"><BikeLoader label="Preparing" /></div>
          ) : data && data.lines.length === 0 ? (
            <p className="text-sm text-[#5A6C5E] py-6 text-center">No residents stayed in {data.label}.</p>
          ) : data ? (
            <table className="w-full text-xs bg-white border border-[#8E9F89]/25 rounded-xl overflow-hidden">
              <thead>
                <tr className="text-left text-[#5A6C5E] bg-[#FAF8F5]">
                  <th className="px-3 py-2 font-semibold">Resident</th>
                  <th className="px-3 py-2 font-semibold">Room</th>
                  <th className="px-3 py-2 font-semibold text-right">Nights</th>
                  <th className="px-3 py-2 font-semibold text-right">Amount</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.stayId} className="border-t border-[#8E9F89]/15 tabular-nums">
                    <td className="px-3 py-2 text-[#1A2E20]">{l.residentName}</td>
                    <td className="px-3 py-2">{l.roomNumber}</td>
                    <td className="px-3 py-2 text-right">{l.nights} / {l.days}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatINR(l.amount)}</td>
                    <td className="px-3 py-2 text-[#5A6C5E]">{STATUS_LABEL[l.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 p-4 bg-white border-t border-[#8E9F89]/20">
          <span className="text-xs text-[#5A6C5E]">{toCharge.length > 0 ? `${toCharge.length} to charge · ${formatINR(data?.total ?? 0)}` : "Nothing to charge"}</span>
          <button type="button" disabled={busy || toCharge.length === 0} onClick={charge} className="px-4 py-2 rounded-xl bg-[#1A2E20] text-white text-xs font-semibold hover:bg-[#263B2D] disabled:opacity-50">
            {busy ? <BikeLoader inline tone="light" label="Charging" /> : `Charge ${data?.label ?? "rent"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
