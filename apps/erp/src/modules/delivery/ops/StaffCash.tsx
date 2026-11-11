"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useMemo, useRef, useState } from "react";
import { Clock, HandCoins, QrCode, Hourglass, CheckCircle2, AlertTriangle } from "lucide-react";
import type { AuthenticatedUser, DriverCashHandover, StaffCustodyCollection, StaffCustodyRow } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { postJsonRequest } from "@/lib/http/requestJson";
import { CashIcon } from "@/components/brand/CashIcon";
import { businessToday } from "@/lib/businessDate";
import { getJson, LIVE_MS } from "./data";
import { rupees } from "./ui";
import { K, Pill, PageLoader, LoadError, EmptyState, initials, clock, shortDay } from "./staffKit";

type Detail = { custody: StaffCustodyRow; collections: StaffCustodyCollection[]; handovers: DriverCashHandover[] };
const bizDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(iso));
const when = (iso: string, today: string) => `${bizDate(iso) === today ? "Today" : shortDay(bizDate(iso))}, ${clock(iso)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * My Cash: the cash this delivery partner is carrying, handing it to the manager, and past
 * handovers. UPI goes straight into the PG account, so it is shown for information only.
 */
export function StaffCash({ user }: { user: AuthenticatedUser }) {
  const key = `/api/delivery/custody?staffId=${user.id}`;
  const q = useErpQuery<Detail>(key, () => getJson<Detail>(key), { ttl: LIVE_MS, tags: ["custody", "handover", "delivery"], pollIntervalMs: LIVE_MS });
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [amountText, setAmountText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useTimedMessage<{ tone: "ok" | "error"; text: string }>();
  const inFlight = useRef(false);
  // Hand over is instant: the screen shows the handover as waiting for approval at once and the
  // request goes on in the background; if it is refused, the form comes back with the reason.
  const [sent, setSent] = useState<{ declaredCash: number; shortfallCash: number; shortfallReason: string | null } | null>(null);
  const today = businessToday();

  const collections = useMemo(() => [...(q.data?.collections ?? [])].sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : -1)), [q.data]);
  if (q.data === undefined) {
    return q.error ? <LoadError text="Could not load your cash." onRetry={() => q.refetch()} /> : <PageLoader label="Counting your cash…" />;
  }

  const c = q.data.custody;
  const handovers = q.data.handovers;
  const serverWaiting = handovers.find((h) => h.status === "DECLARED") || null;
  const waiting = serverWaiting ?? (sent as unknown as DriverCashHandover | null);
  // Approved in the last 10 minutes: a short note, then it goes (history keeps the record).
  const justApproved = !waiting
    ? handovers.find((h) => h.status !== "DECLARED" && h.acceptedAt && Date.now() - Date.parse(h.acceptedAt) < 10 * 60_000) || null
    : null;
  const isCash = (x: StaffCustodyCollection) => x.paymentMethod === "CASH";
  const withYou = collections.filter((x) => isCash(x) && !x.handoverId);
  const waitingRows = collections.filter((x) => isCash(x) && x.handoverStatus === "DECLARED");
  // Cash the employee still has to hand over: collections not yet declared plus any shortage left
  // from earlier handovers (handed over less than recorded, or the manager counted less).
  const recordedNew = c.cashUndeclared;
  const owedEarlier = Math.max(0, c.cashShort);
  const cashWithYou = c.cashOwed ?? recordedNew + owedEarlier;
  const upiToday = collections.filter((x) => !isCash(x) && bizDate(x.collectedAt) === today).reduce((s, x) => s + x.amount, 0);
  // Today's handovers only (older ones are in the office records).
  const pastHandovers = handovers.filter((h) => h.status !== "DECLARED" && bizDate(h.acceptedAt || h.createdAt || `${h.shiftDate}T12:00:00+05:30`) === today);

  const amount = Math.round(Number(amountText));
  const amountOk = amountText.trim() !== "" && Number.isFinite(amount) && amount >= 0;
  // Less than the newly recorded cash needs a reason (it becomes a shortage the manager sees);
  // more than that pays back an earlier shortage, up to what is owed.
  const differs = amountOk && amount < Math.round(recordedNew);
  const tooMuch = amountOk && amount > Math.round(cashWithYou);
  const canSend = amountOk && !tooMuch && (amount > 0 || recordedNew > 0) && (!differs || note.trim().length >= 5);
  const startHandover = () => {
    setAmountText(String(Math.round(cashWithYou)));
    setNote("");
    setConfirming(true);
  };

  const handOver = async () => {
    if (inFlight.current || !canSend) return;
    inFlight.current = true;
    setMsg(null);
    const reason = note.trim() || undefined;
    // Shown at once as given and waiting for approval.
    setSent({ declaredCash: amount, shortfallCash: Math.max(0, Math.round(recordedNew) - amount), shortfallReason: differs ? reason ?? null : null });
    setConfirming(false);
    try {
      await postJsonRequest<{ handover: DriverCashHandover }>("/api/delivery/handover/declare", { declaredCash: amount, notes: reason });
      // The server's figures replace the screen's (refreshed in the background).
      invalidateErpCache(["custody", "handover"]);
      void q.refetch().finally(() => setSent(null));
      setMsg({ tone: "ok", text: `${rupees(amount)} given to the owner. Waiting for approval.` });
      setNote("");
    } catch (e: any) {
      setSent(null);
      setConfirming(true);
      setMsg({ tone: "error", text: e.message });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className="mx-auto max-w-[760px] space-y-5">
      <div>
        <h1 className="text-[28px] md:text-[32px] font-extrabold tracking-[-0.02em]">My Cash</h1>
      </div>

      {msg && <p role={msg.tone === "error" ? "alert" : "status"} className={`rn-enter rounded-xl px-4 py-3 text-sm font-medium ${msg.tone === "ok" ? "bg-[#DDF1D6] text-[#2F6B24]" : "bg-[#FBE3DD] text-[#9A3423]"}`}>{msg.text}</p>}

      {/* Cash with you */}
      <section className={`${K.card} p-4`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[14px] font-semibold text-[#5A6C5E]">Cash with you</p>
            <p className="mt-1 text-[40px] leading-none font-extrabold tracking-[-0.02em] text-[#1F2320]">{rupees(cashWithYou)}</p>
            <p className="mt-2 text-[13px] text-[#5A6C5E]">
              {cashWithYou > 0
                ? [recordedNew > 0 && `${rupees(recordedNew)} from ${plural(withYou.length, "delivery", "deliveries")}`, owedEarlier > 0 && `${rupees(owedEarlier)} short from earlier handovers`].filter(Boolean).join(" · ")
                : "No cash with you right now."}
            </p>
          </div>
          <CashIcon size={56} className="shrink-0" />
        </div>

        {waiting && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#FBF1DE] px-4 py-3">
            <Hourglass className="w-5 h-5 text-[#8F6710] shrink-0" />
            <p className="text-[14px] text-[#5C430B]">
              <span className="font-bold">{rupees(waiting.declaredCash)}</span> given to the owner · <span className="font-semibold">Waiting for owner approval</span>
              {(waiting.shortfallCash ?? 0) > 0 && (
                <span className="block text-[12.5px] mt-0.5">{rupees(waiting.shortfallCash ?? 0)} less than recorded{waiting.shortfallReason ? ` — ${waiting.shortfallReason}` : ""}</span>
              )}
            </p>
          </div>
        )}

        {justApproved && (
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#DDF1D6] px-4 py-3">
            <CheckCircle2 className="w-5 h-5 text-[#2F6B24] shrink-0" />
            <p className="text-[14px] text-[#1D4E16]">
              <span className="font-bold">{rupees(justApproved.acceptedCash)}</span> approved{justApproved.acceptedByName ? ` by ${justApproved.acceptedByName}` : ""}.
            </p>
          </div>
        )}

        {cashWithYou > 0 && !waiting && (
          <div className="mt-5">
            {confirming ? (
              <div className="rn-enter space-y-3">
                <label className="block">
                  <span className="block text-[13px] font-semibold text-[#3E4540] mb-1.5">Cash you are handing over</span>
                  <span className={`${K.soft} flex items-center h-14 px-4 focus-within:ring-4 focus-within:ring-[#C9501C]/20`}>
                    <span className="text-[22px] font-extrabold text-[#6E7F70] mr-1">₹</span>
                    <input
                      value={amountText}
                      onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
                      inputMode="numeric"
                      aria-label="Cash you are handing over"
                      className="flex-1 min-w-0 bg-transparent text-[22px] font-extrabold tabular-nums outline-none"
                    />
                  </span>
                </label>
                {differs && (
                  <p className="text-[13px] font-semibold text-[#9A3423]">
                    Recorded cash is {rupees(recordedNew)}. {rupees(recordedNew - amount)} less: add a reason. It stays recorded against you until handed over.
                  </p>
                )}
                {tooMuch && <p className="text-[13px] font-semibold text-[#9A3423]">You owe {rupees(cashWithYou)} in total; you can't hand over more.</p>}
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={differs ? "Reason for the shortfall (needed)" : "Note for the owner (optional)"}
                  aria-label={differs ? "Reason" : "Note for the owner"}
                  className={`${K.soft} w-full h-12 px-4 text-[14px] outline-none ${differs && note.trim().length < 5 ? "ring-2 ring-[#9A3423]/40" : ""}`}
                />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setConfirming(false)} className={`${K.greyBtn} h-12`}>
                    Back
                  </button>
                  <button type="button" onClick={handOver} disabled={busy || !canSend} className={`${K.primaryBtn} h-12`}>
                    {busy ? "Sending…" : `Hand over ${amountOk ? rupees(amount) : ""}`}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={startHandover} className={`${K.primaryBtn} w-full h-14 text-[15px]`}>
                <HandCoins className="w-5 h-5" /> Hand over {rupees(cashWithYou)} to owner
              </button>
            )}
          </div>
        )}
        {cashWithYou > 0 && waiting && <p className="mt-3 text-[13px] text-[#5A6C5E]">You can hand over the rest once the owner approves the last handover.</p>}
      </section>

      {/* UPI: information only */}
      <section className={`${K.card} p-4 flex items-center gap-3.5`}>
        <span className="w-11 h-11 rounded-xl bg-[#DDF1D6] text-[#2F6B24] flex items-center justify-center shrink-0">
          <QrCode className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold">UPI today · {rupees(upiToday)}</p>
          <p className="text-[13px] text-[#5A6C5E]">Paid to the PG account</p>
        </div>
      </section>

      {/* Cash still to settle */}
      <section className="space-y-2.5">
        <h2 className="text-[17px] font-extrabold">Cash collected</h2>
        {withYou.length + waitingRows.length === 0 ? (
          <EmptyState compact title="No cash collected yet" />
        ) : (
          <ul className="space-y-2.5">
            {[...withYou, ...waitingRows].map((x) => (
              <li key={x.id} className={`${K.card} px-4 py-3.5 flex items-center gap-3.5`}>
                <span className="w-10 h-10 rounded-xl bg-[#FCE9DD] text-[#B4440F] flex items-center justify-center text-[14px] font-extrabold shrink-0">{initials(x.customerName || "")}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold truncate">{x.customerName || "Customer"}</p>
                  <p className="flex items-center gap-1.5 text-[12px] text-[#5A6C5E]">
                    <Clock className="w-3.5 h-3.5" /> {when(x.collectedAt, today)}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[18px] font-extrabold">{rupees(x.amount)}</p>
                  {x.handoverStatus === "DECLARED" ? <Pill tone="accent">Waiting for approval</Pill> : <Pill tone="grey">With you</Pill>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Handover history */}
      <section className="space-y-2.5">
        <h2 className="text-[17px] font-extrabold">Today&apos;s handovers</h2>
        {pastHandovers.length === 0 ? (
          <EmptyState compact title="No handovers today" />
        ) : (
          <ul className={`${K.card} divide-y divide-[#ECE6DB]`}>
            {pastHandovers.slice(0, 20).map((h) => {
              const handedShort = (h.recordedCash ?? h.declaredCash) - h.declaredCash;
              const countShort = h.declaredCash - h.acceptedCash;
              return (
                <li key={h.id} className="px-4 py-3.5 flex items-start gap-3">
                  {h.status === "ACCEPTED" ? <CheckCircle2 className="w-5 h-5 text-[#2F6B24] shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 text-[#9A3423] shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-bold">{rupees(h.acceptedCash)} cash</p>
                    <p className="text-[12px] text-[#5A6C5E]">
                      {h.acceptedAt ? when(h.acceptedAt, today) : shortDay(h.shiftDate)}
                      {h.acceptedByName ? ` · Approved by ${h.acceptedByName}` : ""}
                    </p>
                    {handedShort > 0 && (
                      <p className="text-[12px] text-[#9A3423]">
                        Gave {rupees(h.declaredCash)} / {rupees(h.recordedCash ?? h.declaredCash)}{h.shortfallReason ? ` — ${h.shortfallReason}` : ""}
                      </p>
                    )}
                    {countShort !== 0 && (
                      <p className="text-[12px] text-[#9A3423]">
                        Manager counted {countShort > 0 ? `${rupees(countShort)} less` : `${rupees(-countShort)} more`} than given
                        {h.varianceReason ? ` — ${h.varianceReason}` : ""}
                      </p>
                    )}
                    {(h.writtenOffCash ?? 0) > 0 && <p className="text-[12px] text-[#5A6C5E]">{rupees(h.writtenOffCash ?? 0)} written off by the Owner{h.writeOffReason ? ` — ${h.writeOffReason}` : ""}</p>}
                  </div>
                  <Pill tone={h.status === "ACCEPTED" ? "success" : "danger"}>{h.status === "ACCEPTED" ? "Approved" : "Approved · difference"}</Pill>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
