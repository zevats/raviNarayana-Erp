"use client";

import { friendlyError } from "@/lib/friendlyError";
import { AppSelect } from "@/components/forms/AppSelect";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { formatMoney } from "@/lib/format";
import { businessToday } from "@/lib/businessDate";
import type { ReceivableLine } from "./ReceivablesView";

type Method = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "OTHER";
const METHODS: Array<{ value: Method; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "OTHER", label: "Other" },
];

interface Item {
  key: string;
  source: "PG" | "TIFFIN" | "DELIVERY";
  refId: string;
  label: string;
  sub: string;
  outstanding: number;
  date: string;
}

/**
 * Receive one payment for an account and say exactly where it goes: each open balance has its own
 * amount (nothing is spread automatically; "Fill oldest first" is an explicit choice). The amounts
 * applied must equal the amount received, and none can exceed what is open (the server checks
 * again). Each part is recorded by its own source: rent payment, tiffin payment against its
 * invoice, or a collection on the delivered order. One key per opened dialog, so a retry or a
 * double click records the payment once.
 */
export function ReceivePaymentDialog({
  open,
  onClose,
  accountKey,
  accountName,
  lines,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountKey: string;
  accountName: string;
  lines: ReceivableLine[];
  onDone: (message: string) => void;
}) {
  const items: Item[] = useMemo(() => {
    const pg = lines.filter((l) => l.source === "PG");
    const list: Item[] = [];
    if (pg.length) {
      list.push({
        key: `PG:${accountKey.slice(2)}`,
        source: "PG",
        refId: accountKey.slice(2),
        label: "Rent balance",
        sub: `${pg.length} charge${pg.length === 1 ? "" : "s"} since ${pg[0].date}`,
        outstanding: pg.reduce((a, l) => a + l.outstanding, 0),
        date: pg[0].date,
      });
    }
    for (const l of lines) {
      if (l.source === "PG" || l.outstanding <= 0) continue;
      list.push({
        key: `${l.source}:${l.refId}`,
        source: l.source,
        refId: l.refId,
        label: l.source === "TIFFIN" ? `Invoice ${l.reference}` : `Order · ${l.reference}`,
        sub: `${l.date}${l.paid > 0 ? ` · ${formatMoney(l.paid)} already paid` : ""}`,
        outstanding: l.outstanding,
        date: l.date,
      });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [lines, accountKey]);

  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [received, setReceived] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [date, setDate] = useState(businessToday());
  const [reference, setReference] = useState("");
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef("");
  const inFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    key.current = `recv_${crypto.randomUUID()}`;
    setAmounts({});
    setReceived("");
    setMethod("CASH");
    setDate(businessToday());
    setReference("");
    setStep("enter");
    setError(null);
  }, [open]);

  const chosen = items
    .map((it) => ({ it, amount: amounts[it.key] === undefined || amounts[it.key] === "" ? 0 : Number(amounts[it.key]) }))
    .filter((x) => amounts[x.it.key] !== undefined && amounts[x.it.key] !== "");
  const applied = chosen.reduce((a, x) => a + (Number.isFinite(x.amount) ? x.amount : 0), 0);
  const receivedNum = received.trim() === "" ? NaN : Number(received);
  const problems: string[] = [];
  for (const x of chosen) {
    if (!Number.isInteger(x.amount) || x.amount <= 0) problems.push(`${x.it.label}: enter a whole amount above ₹0.`);
    else if (x.amount > x.it.outstanding) problems.push(`${x.it.label}: only ${formatMoney(x.it.outstanding)} is open.`);
  }
  if (chosen.length === 0) problems.push("Choose at least one balance.");
  if (!Number.isInteger(receivedNum) || receivedNum <= 0) problems.push("Enter the amount received.");
  else if (chosen.length && receivedNum !== applied) problems.push(`Amounts applied (${formatMoney(applied)}) must equal the amount received (${formatMoney(receivedNum)}).`);
  const ready = problems.length === 0;

  const fillOldest = () => {
    if (!Number.isInteger(receivedNum) || receivedNum <= 0) return setError("Enter the amount received first.");
    setError(null);
    let left = receivedNum;
    const next: Record<string, string> = {};
    for (const it of items) {
      if (left <= 0) break;
      const take = Math.min(left, it.outstanding);
      next[it.key] = String(take);
      left -= take;
    }
    setAmounts(next);
    if (left > 0) setError(`${formatMoney(left)} is more than everything open on this account. Payments cannot exceed what is owed.`);
  };

  const submit = async () => {
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    // No answer (network drop) or a server failure: the payment may have been recorded. Stay on the
    // review step so the same payment is sent again with the same key (it is never recorded twice);
    // a changed payment under that key would be refused.
    let unsure = true;
    try {
      const res = await fetch("/api/finance/receivables/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountKey,
          paymentMethod: method,
          transactionDate: date,
          referenceNumber: reference.trim() || undefined,
          amountReceived: receivedNum,
          idempotencyKey: key.current,
          items: chosen.map((x) => ({ source: x.it.source, refId: x.it.refId, amount: x.amount })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      unsure = res.status >= 500;
      if (!res.ok) throw new Error(data.error || "The payment could not be recorded.");
      onDone(`${formatMoney(receivedNum)} received from ${accountName} (${METHODS.find((m) => m.value === method)?.label}).`);
    } catch (e: any) {
      if (unsure) {
        setError("No clear answer from the server, so this payment may already be recorded. Press Record again without changing anything: it will not be recorded twice.");
      } else {
        setError(friendlyError(e.message));
        setStep("enter");
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={step === "enter" ? "Receive payment" : "Confirm payment"}
      description={accountName}
      size="md"
      footer={
        step === "enter" ? (
          <>
            <button type="button" className="rn-btn" onClick={onClose}>Cancel</button>
            <button type="button" className="rn-btn rn-btn-primary" disabled={!ready} onClick={() => setStep("confirm")}>
              Review {Number.isFinite(receivedNum) && receivedNum > 0 ? formatMoney(receivedNum) : ""}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="rn-btn" disabled={busy} onClick={() => setStep("enter")}>Back</button>
            <button type="button" className="rn-btn rn-btn-primary" disabled={busy} onClick={submit}>
              {busy ? "Recording…" : `Record ${formatMoney(receivedNum)}`}
            </button>
          </>
        )
      }
    >
      {step === "enter" ? (
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-2 gap-2.5">
            <label className="min-w-0">
              <span className="rn-t-label block mb-1">Amount received (₹)</span>
              <input type="number" inputMode="numeric" min={1} step={1} value={received} onChange={(e) => setReceived(e.target.value)} className="rn-input w-full tabular-nums" aria-label="Amount received" />
            </label>
            <label className="min-w-0">
              <span className="rn-t-label block mb-1">Paid by</span>
              <AppSelect value={method} onChange={(e) => setMethod(e.target.value as Method)} className="rn-input w-full" aria-label="Payment method">
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </AppSelect>
            </label>
            <label className="min-w-0">
              <span className="rn-t-label block mb-1">Date</span>
              <input type="date" value={date} max={businessToday()} onChange={(e) => setDate(e.target.value)} className="rn-input w-full" aria-label="Payment date" />
            </label>
            <label className="min-w-0">
              <span className="rn-t-label block mb-1">Reference (optional)</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / cheque no." className="rn-input w-full" aria-label="Reference" />
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="rn-t-label">Apply to</span>
            <button type="button" className="rn-btn rn-btn-sm" onClick={fillOldest}>Fill oldest first</button>
          </div>
          <ul className="divide-y divide-[var(--rn-line)] rounded-xl border border-[var(--rn-line)]">
            {items.map((it) => {
              const on = amounts[it.key] !== undefined;
              return (
                <li key={it.key} className="px-3 py-2.5 grid grid-cols-[auto_1fr_auto] items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    checked={on}
                    aria-label={`Pay ${it.label}`}
                    onChange={(e) =>
                      setAmounts((prev) => {
                        const next = { ...prev };
                        if (e.target.checked) next[it.key] = String(it.outstanding);
                        else delete next[it.key];
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-[var(--rn-ink)] truncate">{it.label}</span>
                    <span className="block rn-t-meta truncate">{it.sub} · open {formatMoney(it.outstanding)}</span>
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={it.outstanding}
                    step={1}
                    disabled={!on}
                    value={amounts[it.key] ?? ""}
                    onChange={(e) => setAmounts((prev) => ({ ...prev, [it.key]: e.target.value }))}
                    className="rn-input w-28 tabular-nums text-right"
                    aria-label={`Amount for ${it.label}`}
                  />
                </li>
              );
            })}
          </ul>
          <p className={`text-[13px] tabular-nums ${ready ? "text-[#2F6B24]" : "text-[var(--rn-ink-2)]"}`}>
            Applied {formatMoney(applied)}
            {Number.isFinite(receivedNum) && receivedNum > 0 ? ` of ${formatMoney(receivedNum)} received` : ""}
          </p>
          {error && <p role="alert" className="text-[13px] text-[#9A3423]">{error}</p>}
          {!ready && chosen.length > 0 && <p className="text-[12.5px] text-[#8F6710]">{problems[0]}</p>}
        </div>
      ) : (
        <div className="space-y-3 min-w-0">
          <p className="text-[13.5px] text-[var(--rn-ink)]">
            {formatMoney(receivedNum)} by {METHODS.find((m) => m.value === method)?.label} on {date}
            {reference.trim() ? ` · ref ${reference.trim()}` : ""}
          </p>
          <ul className="divide-y divide-[var(--rn-line)] rounded-xl border border-[var(--rn-line)]">
            {chosen.map((x) => (
              <li key={x.it.key} className="px-3 py-2 flex items-center justify-between gap-3 min-w-0">
                <span className="min-w-0 truncate text-[13px]">{x.it.label}</span>
                <span className="shrink-0 tabular-nums text-[13px] font-semibold">
                  {formatMoney(x.amount)} <span className="rn-t-meta font-normal">· left {formatMoney(x.it.outstanding - x.amount)}</span>
                </span>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-[13px] text-[#9A3423]">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}
