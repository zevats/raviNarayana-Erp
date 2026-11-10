"use client";

import { friendlyError } from "@/lib/friendlyError";
import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useEffect, useRef, useState } from "react";
import { IndianRupee, ShieldCheck, AlertTriangle, X, ChevronRight } from "lucide-react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { useCurrentUser } from "@/components/auth/CurrentUserContext";
import { DriverCashHandover, StaffCustodyRow, StaffCustodyCollection } from "@/types";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { Badge } from "@/components/ui/kit";
import { LoadError, StateMessage } from "@/components/ui/states";
import { formatDateTime } from "@/lib/format";

const LIVE_MS = 20000;
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const when = (iso?: string | null) =>
  iso ? formatDateTime(iso, "en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

type Overview = { staff: StaffCustodyRow[]; totals: Omit<StaffCustodyRow, "staffId" | "staffName" | "role" | "status"> };
type Detail = { custody: StaffCustodyRow; collections: StaffCustodyCollection[]; handovers: DriverCashHandover[] };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not load custody.");
  return data as T;
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    CLEAR: ["Clear", "bg-emerald-50 text-emerald-800 border-emerald-200"],
    HOLDING: ["Holding money", "bg-blue-50 text-blue-800 border-blue-200"],
    AWAITING_ACCEPTANCE: ["Awaiting verification", "bg-amber-50 text-amber-900 border-amber-200"],
    DISCREPANCY: ["Discrepancy", "bg-red-50 text-red-800 border-red-200"],
    DECLARED: ["Awaiting verification", "bg-amber-50 text-amber-900 border-amber-200"],
    ACCEPTED: ["Accepted", "bg-emerald-50 text-emerald-800 border-emerald-200"],
    DISCREPANCY_FLAGGED: ["Accepted with discrepancy", "bg-red-50 text-red-800 border-red-200"],
  };
  const [label, cls] = map[status] || [status, "bg-gray-50 text-gray-700 border-gray-200"];
  return <span className={`px-2 py-0.5 rounded-full text-[11px] border whitespace-nowrap ${cls}`}>{label}</span>;
}

/** Handover history rows (shared by the employee view and the detail drawer). */
function HandoverHistory({ handovers }: { handovers: DriverCashHandover[] }) {
  if (handovers.length === 0) return <p className="text-xs text-[#8E9F89]">No handovers yet.</p>;
  return (
    <ul className="divide-y divide-[#E6E1DA] text-xs">
      {handovers.map((h) => {
        const cashShort = h.status === "DECLARED" ? 0 : h.declaredCash - h.acceptedCash;
        const upiShort = h.status === "DECLARED" ? 0 : (h.declaredUpi || 0) - (h.acceptedUpi || 0);
        return (
          <li key={h.id} className="py-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-[#1A2E20]">
                Declared {when(h.createdAt)}
                {h.declaredByName && h.declaredBy !== h.driverId ? ` by ${h.declaredByName}` : ""}
              </span>
              <StatusChip status={h.status} />
            </div>
            {(h.shortfallCash ?? 0) > 0 && (
              <p className="text-red-800">
                Handed over {inr(h.declaredCash)} / {inr(h.recordedCash ?? h.declaredCash)} · {inr(h.shortfallCash ?? 0)} short{h.shortfallReason ? ` — ${h.shortfallReason}` : ""}
              </p>
            )}
            {(h.writtenOffCash ?? 0) > 0 && <p className="text-[#5A6C5E]">Written off by the Owner: {inr(h.writtenOffCash ?? 0)}{h.writeOffReason ? ` — ${h.writeOffReason}` : ""}</p>}
            <div className="font-mono text-[#5D7656]">
              Cash {inr(h.declaredCash)} · UPI {inr(h.declaredUpi || 0)}
              {h.status !== "DECLARED" && (
                <>
                  {" "}→ received cash {inr(h.acceptedCash)} · UPI {inr(h.acceptedUpi || 0)}
                </>
              )}
            </div>
            {h.status !== "DECLARED" && (
              <div className="text-[#8E9F89]">
                Verified by {h.acceptedByName || "—"} on {when(h.acceptedAt)}
              </div>
            )}
            {(cashShort !== 0 || upiShort !== 0) && (
              <div className="text-red-800">
                {cashShort !== 0 && `Cash ${cashShort > 0 ? "short" : "over"} ${inr(Math.abs(cashShort))}. `}
                {upiShort !== 0 && `UPI not received ${inr(upiShort)}. `}
                {h.varianceReason ? `Reason: ${h.varianceReason}` : ""}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Employee view: own custody only
// ---------------------------------------------------------------------------
/** One employee's own custody: what they hold, declaring it, and their handover history. */
export function MyCustody({ staffId }: { staffId: string }) {
  const key = `/api/delivery/custody?staffId=${staffId}`;
  const q = useErpQuery<Detail>(key, () => getJson<Detail>(key), { ttl: LIVE_MS, tags: ["custody", "handover", "delivery"], pollIntervalMs: LIVE_MS });
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useTimedMessage<{ ok: boolean; text: string }>();
  const inFlight = useRef(false);

  const c = q.data?.custody;
  const pending = q.data?.handovers.find((h) => h.status === "DECLARED") || null;
  const canDeclare = Boolean(c && !pending && (c.cashUndeclared > 0 || c.upiUndeclared > 0));

  const declare = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/delivery/handover/declare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not submit the declaration.");
      setMessage({ ok: true, text: `Declared ${inr(data.handover.declaredCash)} cash and ${inr(data.handover.declaredUpi || 0)} UPI. Hand the cash to the manager.` });
      setConfirming(false);
      setNote("");
      invalidateErpCache(["custody", "handover"]);
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="p-4 bg-white rounded-3xl border border-[#E6E1DA] space-y-3" aria-label="My custody">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-base font-bold text-[#1A2E20] flex items-center gap-2">
          My custody
        </h2>
        {c && <StatusChip status={c.status} />}
      </div>
      {q.error && !q.data && <p className="text-xs text-red-700">{q.error.message}</p>}
      {!c ? (
        q.error ? null : <BikeLoader size="sm" label="Loading cash…" className="py-6" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-2xl bg-[#FAF8F5] border border-[#E6E1DA]">
              <span className="block text-[11px] text-[#8E9F89]">Cash with me</span>
              <span className="text-lg font-bold text-[#1A2E20]">{inr(c.cashPending)}</span>
              {c.cashAwaitingAcceptance > 0 && <span className="block text-[11px] text-amber-800">{inr(c.cashAwaitingAcceptance)} declared, awaiting manager</span>}
            </div>
            <div className="p-3 rounded-2xl bg-[#FAF8F5] border border-[#E6E1DA]">
              <span className="block text-[11px] text-[#8E9F89]">UPI to be confirmed</span>
              <span className="text-lg font-bold text-[#1A2E20]">{inr(c.upiPending)}</span>
              {c.upiAwaitingAcceptance > 0 && <span className="block text-[11px] text-amber-800">{inr(c.upiAwaitingAcceptance)} declared</span>}
            </div>
          </div>
          <p className="text-[11px] text-[#5D7656] font-mono">
            Collected: cash {inr(c.cashCollected)} · UPI {inr(c.upiCollected)} — handed over: cash {inr(c.cashHandedOver)} · UPI {inr(c.upiReconciled)}
          </p>
          {(c.cashShort !== 0 || c.upiShort !== 0) && (
            <p className="text-xs text-red-800 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Manager recorded a difference: cash {c.cashShort > 0 ? "short" : "over"} {inr(Math.abs(c.cashShort))}
              {c.upiShort !== 0 ? `, UPI not received ${inr(c.upiShort)}` : ""}.
            </p>
          )}
          {pending && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-2">
              Waiting for the manager since {when(pending.createdAt)}: cash {inr(pending.declaredCash)}, UPI {inr(pending.declaredUpi || 0)}.
            </p>
          )}
          {message && (
            <p role={message.ok ? "status" : "alert"} className={`text-xs rounded-xl p-2 ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
              {message.text}
            </p>
          )}
          {confirming ? (
            <div className="p-3 rounded-2xl border border-[#1A2E20]/20 space-y-2">
              <p className="text-sm text-[#1A2E20]">
                Declare <strong>{inr(c.cashUndeclared)}</strong> cash and <strong>{inr(c.upiUndeclared)}</strong> UPI from your recorded collections?
              </p>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note for the manager (optional)"
                className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#DCD6CD] rounded-xl"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="flex-1 h-11 rounded-xl border border-[#DCD6CD] text-sm">
                  Cancel
                </button>
                <button type="button" disabled={busy} onClick={declare} className="flex-1 h-11 rounded-xl bg-[#1A2E20] text-white text-sm font-bold disabled:opacity-50">
                  {busy ? "Submitting…" : "Submit declaration"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!canDeclare}
              onClick={() => setConfirming(true)}
              className="w-full h-11 rounded-xl bg-[#1A2E20] text-white text-sm font-bold disabled:opacity-40"
            >
              {pending ? "Waiting for manager verification" : canDeclare ? "Declare handover" : "Nothing to declare"}
            </button>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer text-[#5D7656]">My handovers ({q.data!.handovers.length})</summary>
            <div className="pt-2">
              <HandoverHistory handovers={q.data!.handovers} />
            </div>
          </details>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Verification (Manager / Owner)
// ---------------------------------------------------------------------------
function VerifyHandover({ handover, onClose }: { handover: DriverCashHandover; onClose: (msg?: string) => void }) {
  const declaredUpi = handover.declaredUpi || 0;
  const [cash, setCash] = useState("");
  const [upi, setUpi] = useState(declaredUpi > 0 ? "" : "0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const cashN = cash.trim() === "" ? NaN : Number(cash);
  const upiN = upi.trim() === "" ? NaN : Number(upi);
  const differs = Number.isFinite(cashN) && Number.isFinite(upiN) && (cashN !== handover.declaredCash || upiN !== declaredUpi);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    setError(null);
    if (!Number.isInteger(cashN) || cashN < 0) return setError("Enter the cash you counted (₹, whole number).");
    if (!Number.isInteger(upiN) || upiN < 0 || upiN > declaredUpi) return setError(`Enter the UPI received in the account (₹0 to ${inr(declaredUpi)}).`);
    if (differs && reason.trim().length < 5) return setError("Explain the difference (at least 5 characters).");
    inFlight.current = true;
    setBusy(true);
    // Instant: the dialog closes with the confirmation now; the request goes on in the background
    // and a refusal is reported on the custody screen ("erp:handover-accept-failed").
    const optimistic = differs
      ? `${handover.driverName}: received ${inr(cashN)} cash and ${inr(upiN)} UPI; difference recorded.`
      : `${handover.driverName}: handover accepted (${inr(cashN)} cash, ${inr(upiN)} UPI).`;
    onClose(optimistic);
    try {
      const res = await fetch(`/api/delivery/handover/${handover.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acceptedCash: cashN,
          acceptedUpi: upiN,
          varianceReason: differs ? reason.trim() : undefined,
          expectedDriverId: handover.driverId,
          expectedDeclaredCash: handover.declaredCash,
          expectedDeclaredUpi: declaredUpi,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not record the verification.");
      invalidateErpCache(["custody", "handover", "finance", "dashboard"]);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent("erp:handover-accept-failed", { detail: { text: `${handover.driverName}: not accepted. ${err.message}` } }));
      invalidateErpCache(["custody", "handover"]);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4 rn-modal-scrim">
      <form
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label={`Verify handover from ${handover.driverName}`}
        className="rn-modal bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[94dvh] overflow-y-auto"
      >
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[11px] text-[#8E9F89]">Verify handover from</span>
            <h3 className="font-serif text-xl font-bold text-[#1A2E20]">{handover.driverName}</h3>
            <span className="text-[11px] text-[#8E9F89]">
              Declared {when(handover.createdAt)} · {handover.collectionCount ?? "—"} collections
            </span>
          </div>
          <button type="button" aria-label="Close" onClick={() => onClose()} className="p-2 -m-1 text-[#8E9F89]">
            <X className="w-5 h-5" />
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-xl p-2">
            {error}
          </p>
        )}
        {handover.notes && (
          <p className={`text-sm rounded-xl p-3 ${/^Handing over ₹/.test(handover.notes) ? "bg-amber-50 border border-amber-200 text-amber-900 font-semibold" : "bg-[#FAF8F5] border border-[#E6E1DA] text-[#1A2E20]"}`}>
            {handover.notes}
          </p>
        )}
        {(handover.shortfallCash ?? 0) !== 0 && (
          <div className="text-sm rounded-xl p-3 bg-amber-50 border border-amber-200 text-amber-900 space-y-0.5" aria-label="Cash reconciliation">
            <p className="flex justify-between gap-3"><span>Recorded collections</span><span className="font-semibold tabular-nums">{inr(handover.recordedCash ?? handover.declaredCash)}</span></p>
            <p className="flex justify-between gap-3"><span>Handed over now</span><span className="font-semibold tabular-nums">{inr(handover.declaredCash)}</span></p>
            {(handover.shortfallCash ?? 0) > 0 ? (
              <p className="flex justify-between gap-3 font-bold"><span>Short (stays owed by the employee)</span><span className="tabular-nums">{inr(handover.shortfallCash ?? 0)}</span></p>
            ) : (
              <p className="flex justify-between gap-3 font-bold"><span>Paying back an earlier shortage</span><span className="tabular-nums">{inr(-(handover.shortfallCash ?? 0))}</span></p>
            )}
            {handover.shortfallReason && <p className="pt-1">Reason: {handover.shortfallReason}</p>}
          </div>
        )}
        <div className={`grid gap-3 ${declaredUpi > 0 ? "grid-cols-2" : "grid-cols-1"}`}>
          <div className="p-3 rounded-2xl bg-[#FAF8F5] border border-[#E6E1DA] space-y-1">
            <span className="block text-[11px] text-[#8E9F89]">Cash handed over</span>
            <span className="block text-base font-bold">{inr(handover.declaredCash)}</span>
            <label htmlFor="cash-counted" className="block text-[11px] text-[#1A2E20] pt-1">
              Cash counted
            </label>
            <input id="cash-counted" type="number" inputMode="numeric" min={0} step={1} value={cash} onChange={(e) => setCash(e.target.value)} className="w-full h-11 px-2 text-base font-mono font-bold border border-[#DCD6CD] rounded-xl" />
          </div>
          {/* UPI is paid straight into the PG account (migration 0014); only older declarations carry UPI to confirm. */}
          {declaredUpi > 0 && <div className="p-3 rounded-2xl bg-[#FAF8F5] border border-[#E6E1DA] space-y-1">
            <span className="block text-[11px] text-[#8E9F89]">UPI declared</span>
            <span className="block text-base font-bold">{inr(declaredUpi)}</span>
            <label htmlFor="upi-received" className="block text-[11px] text-[#1A2E20] pt-1">
              UPI received in account
            </label>
            <input id="upi-received" type="number" inputMode="numeric" min={0} max={declaredUpi} step={1} value={upi} disabled={declaredUpi === 0} onChange={(e) => setUpi(e.target.value)} className="w-full h-11 px-2 text-base font-mono font-bold border border-[#DCD6CD] rounded-xl disabled:bg-gray-50" />
          </div>}
        </div>
        {differs && (
          <div className="space-y-1">
            <label htmlFor="variance-reason" className="block text-sm font-bold text-red-800">
              Reason for the difference *
            </label>
            <input id="variance-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. ₹50 short, driver to pay tomorrow" className="w-full h-11 px-3 text-sm border border-red-300 rounded-xl" />
          </div>
        )}
        <button type="submit" disabled={busy} className="w-full h-12 rounded-2xl bg-emerald-700 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-2">
          {busy ? "Working…" : <ShieldCheck className="w-5 h-5" />}
          {differs ? "Record received amounts and discrepancy" : "Accept handover"}
        </button>
      </form>
    </div>
  );
}

function StaffDetail({ staffId, onClose }: { staffId: string; onClose: () => void }) {
  const key = `/api/delivery/custody?staffId=${staffId}`;
  const q = useErpQuery<Detail>(key, () => getJson<Detail>(key), { ttl: LIVE_MS, tags: ["custody", "handover"] });
  const d = q.data;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4 rn-modal-scrim">
      <div role="dialog" aria-modal="true" aria-label="Employee custody" className="rn-modal rn-modal-wide bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[94dvh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[11px] text-[#8E9F89]">Custody ledger</span>
            <h3 className="font-serif text-xl font-bold text-[#1A2E20]">{d?.custody.staffName || "…"}</h3>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="p-2 -m-1 text-[#8E9F89]">
            <X className="w-5 h-5" />
          </button>
        </div>
        {!d ? (
          q.error ? <p role="alert" className="text-xs text-red-700">{q.error.message}</p> : <BikeLoader size="sm" label="Loading…" className="py-10" />
        ) : (
          <>
            <p className="text-xs font-mono text-[#1A2E20]">
              Holding: cash {inr(d.custody.cashPending)} · UPI {inr(d.custody.upiPending)} — handed over: cash {inr(d.custody.cashHandedOver)} · UPI {inr(d.custody.upiReconciled)}
              {(d.custody.cashShort !== 0 || d.custody.upiShort !== 0) && ` — short: cash ${inr(d.custody.cashShort)}, UPI ${inr(d.custody.upiShort)}`}
            </p>
            <div>
              <h4 className="text-sm font-bold text-[#1A2E20] mb-1">Handovers</h4>
              <HandoverHistory handovers={d.handovers} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-[#1A2E20] mb-1">Collections ({d.collections.length})</h4>
              <ul className="divide-y divide-[#E6E1DA] text-xs">
                {d.collections.map((c) => (
                  <li key={c.id} className="py-1.5 flex items-center justify-between gap-2">
                    <span className="text-[#1A2E20]">
                      {c.customerName || "—"} <span className="text-[#8E9F89]">· {c.serviceDate}{c.orderId ? ` · order ${c.orderId.slice(-6).toUpperCase()}` : ""}</span>
                    </span>
                    <span className="font-mono whitespace-nowrap">
                      {inr(c.amount)} {c.paymentMethod === "CASH" ? "cash" : c.paymentMethod} ·{" "}
                      {c.handoverStatus === "DECLARED" ? "declared" : c.handoverStatus ? "handed over" : "with employee"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StaffOverview() {
  const key = "/api/delivery/custody";
  const q = useErpQuery<Overview>(key, () => getJson<Overview>(key), { ttl: LIVE_MS, tags: ["custody", "handover", "delivery"], pollIntervalMs: LIVE_MS });
  const pendingKey = "/api/delivery/handover?status=DECLARED";
  const pq = useErpQuery<DriverCashHandover[]>(
    pendingKey,
    async () => (await getJson<{ handovers: DriverCashHandover[] }>(pendingKey)).handovers || [],
    { ttl: LIVE_MS, tags: ["custody", "handover"], pollIntervalMs: LIVE_MS }
  );
  const [verify, setVerify] = useState<DriverCashHandover | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [writeOff, setWriteOff] = useState<StaffCustodyRow | null>(null);
  const [message, setMessage] = useTimedMessage<string>();
  // A verification that the server refused after the dialog closed (see VerifyHandover).
  useEffect(() => {
    const failed = (e: Event) => setMessage((e as CustomEvent).detail?.text || "A handover could not be accepted.");
    window.addEventListener("erp:handover-accept-failed", failed);
    return () => window.removeEventListener("erp:handover-accept-failed", failed);
  }, [setMessage]);
  const rows = q.data?.staff ?? [];
  const t = q.data?.totals;
  const pending = pq.data ?? [];
  const me = useCurrentUser();
  const myRow = rows.find((r) => r.staffId === me?.id);
  const iHoldMoney = Boolean(myRow && (myRow.cashPending > 0 || myRow.upiPending > 0 || myRow.pendingHandovers > 0));

  // Oldest declaration per employee: the row's Verify opens it (the verify dialog shows amounts).
  const pendingBy = new Map<string, DriverCashHandover[]>();
  for (const h of pending) pendingBy.set(h.driverId, [...(pendingBy.get(h.driverId) ?? []), h]);

  return (
    <section className="rn-card" aria-label="Staff custody">
      <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="rn-t-section">Staff custody</h2>
        </div>
        {pending.length > 0 && <Badge tone="warn">{pending.length} to verify</Badge>}
      </div>
      {message && <p role="status" className="rn-notice rn-notice-good mx-5 sm:mx-6 mb-3">{message}</p>}
      {q.error && !q.data ? (
        <LoadError message={q.error.message} onRetry={() => q.refetch()} title="Custody could not be loaded" />
      ) : q.isLoading && !q.data ? (
        <BikeLoader label="Loading custody" className="py-10" />
      ) : rows.length === 0 ? (
        <StateMessage title="No cash with staff" compact />
      ) : (
        <table className="rn-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="text-right">Cash collected</th>
              <th className="text-right">Cash handed over</th>
              <th className="text-right">Cash pending</th>
              <th>Status</th>
              <th className="text-right"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const waiting = pendingBy.get(r.staffId) ?? [];
              const short = r.cashShort;
              return (
                <tr key={r.staffId}>
                  <td>
                    <span className="flex items-center gap-3">
                      <span className="grid place-items-center w-9 h-9 rounded-full bg-[var(--rn-accent-tint)] text-[var(--rn-accent)] text-[13px] font-semibold shrink-0" aria-hidden>
                        {r.staffName.trim().charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-medium text-[var(--rn-ink)]">{r.staffName}</span>
                        <span className="block rn-t-meta">{ROLE_NAME[r.role] || r.role}</span>
                      </span>
                    </span>
                  </td>
                  <td className="num">{inr(r.cashCollected)}</td>
                  <td className="num">{inr(r.cashHandedOver)}</td>
                  <td className={`num text-[15px] font-semibold ${r.cashPending > 0 ? "text-[var(--rn-ink)]" : "text-[var(--rn-ink-3)]"}`}>{inr(r.cashPending)}</td>
                  <td>
                    {short > 0 ? (
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        <Badge tone="bad">Short {inr(short)}</Badge>
                        {me?.role === "SUPER_ADMIN" && (
                          <button type="button" className="rn-btn rn-btn-sm" onClick={() => setWriteOff(r)} aria-label={`Write off ${r.staffName}'s shortage`}>
                            Write off
                          </button>
                        )}
                      </span>
                    ) : (
                      <Badge tone={r.status === "AWAITING_ACCEPTANCE" ? "warn" : r.status === "DISCREPANCY" ? "bad" : r.status === "CLEAR" ? "good" : "neutral"}>{STATUS_LABEL[r.status] || r.status}</Badge>
                    )}
                  </td>
                  <td className="text-right">
                    {waiting.length > 0 ? (
                      <button type="button" className="rn-btn rn-btn-sm rn-btn-primary" onClick={() => setVerify(waiting[0])} aria-label={`Verify ${r.staffName}'s handover`}>
                        Verify{waiting.length > 1 ? ` (${waiting.length})` : ""}
                      </button>
                    ) : (
                      <button type="button" className="rn-btn rn-btn-sm" onClick={() => setDetail(r.staffId)} aria-label={`Custody details for ${r.staffName}`}>
                        Details
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {t && rows.length > 1 && (
            <tfoot>
              <tr className="font-semibold">
                <td>All staff</td>
                <td className="num">{inr(t.cashCollected)}</td>
                <td className="num">{inr(t.cashHandedOver)}</td>
                <td className="num">{inr(t.cashPending)}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      )}
      {verify && (
        <VerifyHandover
          handover={verify}
          onClose={(msg) => {
            setVerify(null);
            if (msg) setMessage(msg);
          }}
        />
      )}
      {detail && <StaffDetail staffId={detail} onClose={() => setDetail(null)} />}
      {writeOff && (
        <WriteOffShortage
          row={writeOff}
          onClose={(msg) => {
            setWriteOff(null);
            if (msg) setMessage(msg);
          }}
        />
      )}
      {/* A manager/owner who collected money declares it like anyone else (verified by someone else). */}
      {iHoldMoney && me && <div className="px-5 sm:px-6 pb-5"><MyCustody staffId={me.id} /></div>}
    </section>
  );
}

/** Owner only: write off part of an employee's unresolved cash shortage, with a reason (audited). */
function WriteOffShortage({ row, onClose }: { row: StaffCustodyRow; onClose: (msg?: string) => void }) {
  const [amount, setAmount] = useState(String(row.cashShort));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const n = Math.round(Number(amount));
  const ok = Number.isInteger(n) && n > 0 && n <= row.cashShort && reason.trim().length >= 5;
  const submit = async () => {
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/delivery/custody/${encodeURIComponent(row.staffId)}/write-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: n, reason: reason.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not write off the shortage.");
      invalidateErpCache(["custody", "handover"]);
      onClose(`${inr(n)} written off for ${row.staffName}.`);
    } catch (e: any) {
      setError(friendlyError(e.message));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/30 sm:p-4 rn-modal-scrim">
      <div role="dialog" aria-modal="true" aria-label={`Write off ${row.staffName}'s shortage`} className="rn-modal rn-dialog bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] text-[#8E9F89]">Write off a cash shortage</p>
            <p className="text-lg font-bold text-[#1A2E20]">{row.staffName}</p>
          </div>
          <button type="button" onClick={() => onClose()} aria-label="Close" className="p-2 rounded-full hover:bg-[#FAF8F5]"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-[#3E4E42]">
          Unresolved shortage <strong>{inr(row.cashShort)}</strong>. A write-off records no money; it stops the amount being owed by the employee and is kept in the audit log.
        </p>
        {error && <p role="alert" className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-xl p-2">{error}</p>}
        <label className="block text-sm font-semibold text-[#1A2E20]">
          Amount to write off
          <input type="text" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="mt-1 w-full h-11 px-3 rounded-xl border border-[#E6E1DA] text-base font-bold" />
        </label>
        <label className="block text-sm font-semibold text-[#1A2E20]">
          Reason (at least 5 characters)
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cash lost, confirmed with the driver" className="mt-1 w-full h-11 px-3 rounded-xl border border-[#E6E1DA] text-sm" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="rn-btn" onClick={() => onClose()}>Cancel</button>
          <button type="button" className="rn-btn rn-btn-primary" disabled={!ok || busy} onClick={submit}>{busy ? "Saving…" : `Write off ${Number.isInteger(n) && n > 0 ? inr(n) : ""}`}</button>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  CLEAR: "Clear",
  HOLDING: "Holding cash",
  AWAITING_ACCEPTANCE: "Awaiting verification",
  DISCREPANCY: "Discrepancy",
};
const ROLE_NAME: Record<string, string> = { DELIVERY_PERSON: "Delivery", OPERATIONS_MANAGER: "Manager", SUPER_ADMIN: "Owner" };

/** Custody section of the Delivery page: own ledger for staff, staff-wise oversight for Manager/Owner. */
export function CustodyPanel() {
  const user = useCurrentUser();
  if (!user) return null;
  const oversight = user.role === "SUPER_ADMIN" || user.role === "OPERATIONS_MANAGER" || user.role === "ACCOUNTANT";
  return oversight ? <StaffOverview /> : <MyCustody staffId={user.id} />;
}
