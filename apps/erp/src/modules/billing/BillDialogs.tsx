"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { Bill, BillSummary, BillType } from "@/lib/bills";
import { billDay } from "@/lib/bills";
import { Dialog } from "@/components/ui/Dialog";
import { AppSelect } from "@/components/forms/AppSelect";
import { toast } from "@/components/ui/toast";
import { businessToday } from "@/lib/businessDate";
import { AccountDues, DueAccount, METHODS, Method, createBill, methodLabel, money, refreshMoney, send } from "./api";
import { WhatsAppIcon, shareOnWhatsApp } from "./BillViewer";
import { uniqueId } from "@/lib/uniqueId";

const GSTIN = "06AAEFZ6389H1ZL";
const RATES = [5, 12, 18];
const PREF = "rn-bill-kind";

function useBillKind(open: boolean) {
  const [type, setType] = useState<BillType>("NON_GST");
  const [rate, setRate] = useState(5);
  useEffect(() => {
    if (!open) return;
    try {
      const [t, r] = (window.localStorage.getItem(PREF) || "").split(":");
      if (t === "GST" || t === "NON_GST") setType(t);
      if (RATES.includes(Number(r))) setRate(Number(r));
    } catch {}
  }, [open]);
  const remember = () => {
    try {
      window.localStorage.setItem(PREF, `${type}:${rate}`);
    } catch {}
  };
  return { type, setType, rate, setRate, remember };
}

/** Equal-width choices in one row (bill type, GST rate, how it was paid). */
export function Choice<T extends string>({ label, value, onChange, options, size = "md" }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: React.ReactNode }>; size?: "md" | "sm" }) {
  return (
    <div role="radiogroup" aria-label={label} className={`rn-choice ${size === "sm" ? "is-sm" : ""}`} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)} className="rn-choice-item">
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BillKind({ type, setType, rate, setRate }: { type: BillType; setType: (t: BillType) => void; rate: number; setRate: (r: number) => void }) {
  return (
    <div className="space-y-3">
      <Choice
        label="Bill type"
        value={type}
        onChange={setType}
        options={[
          { value: "NON_GST", label: "Non-GST" },
          { value: "GST", label: "GST" },
        ]}
      />
      {type === "GST" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-[13.5px] px-1">
            <span className="text-[var(--rn-ink-2)]">GSTIN</span>
            <span className="font-semibold tabular-nums">{GSTIN}</span>
          </div>
          <Choice label="GST rate" size="sm" value={String(rate)} onChange={(v) => setRate(Number(v))} options={RATES.map((r) => ({ value: String(r), label: `${r}%` }))} />
        </div>
      )}
    </div>
  );
}

/** Generate bill: GST or non-GST, for everything the account owes now. */
export function GenerateBillDialog({ open, onClose, accountKey, name, due, onMade }: { open: boolean; onClose: () => void; accountKey: string; name: string; due: number; onMade: (bill: Bill) => void }) {
  const kind = useBillKind(open);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const make = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const bill = await createBill(accountKey, kind.type, kind.rate);
      kind.remember();
      toast.ok(`Bill ${bill.billNumber} made for ${name} · ${money(bill.total)}`);
      onMade(bill);
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Generate bill"
      description={name}
      size="sm"
      footer={
        <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" disabled={busy || due <= 0} onClick={make}>
          {busy ? "Making the bill…" : `Generate bill · ${money(due)}`}
        </button>
      }
    >
      <div className="space-y-3">
        <BillKind {...kind} />
        {error && <p role="alert" className="rounded-2xl bg-[#FDECE8] px-4 py-3 text-[14px] text-[#A3311D]">{error}</p>}
      </div>
    </Dialog>
  );
}

/**
 * The payment form: amount (fixed ₹ sign, "Full" fills what is due), how it was paid, the bill it
 * was paid against (optional), the date and a reference for non-cash payments. The money pays the
 * account's oldest dues first; nothing is chosen here. One key per opened form, so a retry or a
 * double tap records the payment once.
 */
export function usePaymentForm({
  open,
  accountKey,
  name,
  due,
  bills,
  onDone,
}: {
  open: boolean;
  accountKey: string | null;
  name: string;
  due: number;
  bills: BillSummary[];
  onDone: (account: AccountDues | null, amount: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [billNumber, setBillNumber] = useState("");
  const [date, setDate] = useState(businessToday());
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef("");
  const inFlight = useRef(false);

  useEffect(() => {
    if (!open) return;
    key.current = `recv_${uniqueId()}`;
    setAmount("");
    setMethod("CASH");
    setBillNumber("");
    setDate(businessToday());
    setReference("");
    setError(null);
  }, [open, accountKey]);

  const value = amount.trim() === "" ? NaN : Number(amount);
  const problem = !accountKey ? "Choose who paid." : !Number.isInteger(value) || value <= 0 ? "Enter the amount received." : value > due ? `${name} owes ${money(due)}. Enter ${money(due)} or less.` : null;
  const left = Number.isInteger(value) && value > 0 ? Math.max(0, due - value) : due;
  const tooMuch = Number.isInteger(value) && value > due;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inFlight.current) return;
    if (problem) return setError(problem);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data } = await send<{ account?: AccountDues }>("/api/finance/receivables/payments", {
        accountKey,
        paymentMethod: method,
        transactionDate: date,
        referenceNumber: reference.trim() || undefined,
        amountReceived: value,
        idempotencyKey: key.current,
        billNumber: billNumber || undefined,
      });
      const still = data.account?.totals.total ?? left;
      toast.ok(`${money(value)} received from ${name} by ${methodLabel(method)}. ${still > 0 ? `${money(still)} still due.` : "All dues cleared."}`);
      refreshMoney();
      onDone(data.account ?? null, value);
    } catch (err: any) {
      const text = err.unsure ? "No clear answer from the server. Press Receive again without changing anything: it will not be recorded twice." : err.message;
      setError(text);
      toast.error(text);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const fields = (
    <form onSubmit={submit} className="space-y-4 min-w-0" noValidate>
      <div>
        <label htmlFor="recv-amount" className="rn-t-label block mb-1.5">Amount</label>
        <div className="flex items-center gap-2">
          <input
            id="recv-amount"
            type="number"
            inputMode="numeric"
            min={1}
            max={due}
            step={1}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            placeholder="0"
            className="rn-input rn-money flex-1 min-w-0 h-12 text-[18px] font-semibold"
            autoFocus
          />
          <button type="button" className="rn-btn shrink-0 h-12" onClick={() => setAmount(String(due))} disabled={due <= 0}>
            Full {money(due)}
          </button>
        </div>
      </div>
      <div>
        <span className="rn-t-label block mb-1.5">Paid by</span>
        <Choice label="Paid by" size="sm" value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="min-w-0">
          <span className="rn-t-label block mb-1.5">Bill no.</span>
          <AppSelect value={billNumber} onChange={(e) => setBillNumber(e.target.value)} className="rn-input w-full" aria-label="Bill number">
            <option value="">No bill</option>
            {bills.map((b) => (
              <option key={b.id} value={b.billNumber}>
                {b.billNumber} · {money(b.total)}
              </option>
            ))}
          </AppSelect>
        </label>
        <label className="min-w-0">
          <span className="rn-t-label block mb-1.5">Date</span>
          <input type="date" value={date} max={businessToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rn-input w-full" aria-label="Payment date" />
        </label>
      </div>
      {method !== "CASH" && (
        <label className="block">
          <span className="rn-t-label block mb-1.5">{method === "CHEQUE" ? "Cheque no." : "Reference"}</span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className="rn-input w-full" aria-label="Reference" />
        </label>
      )}
      <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--rn-accent-tint,#EEF3EA)] px-4 py-3 text-[14.5px]">
        <span className="text-[var(--rn-ink-2)]">Due after this</span>
        <span className="tabular-nums font-semibold">{money(left)}</span>
      </div>
      {(error || tooMuch) && <p role="alert" className="rounded-2xl bg-[#FDECE8] px-4 py-3 text-[14px] text-[#A3311D]">{tooMuch ? problem : error}</p>}
      <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
    </form>
  );
  const button = (
    <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" disabled={busy || tooMuch || !accountKey} onClick={() => submit()}>
      {busy ? "Recording…" : Number.isInteger(value) && value > 0 ? `Receive ${money(value)}` : "Receive payment"}
    </button>
  );
  return { fields, button, busy };
}

/** Receive payment for one account (opened from that person's dues). */
export function ReceivePaymentDialog({
  open,
  onClose,
  accountKey,
  name,
  due,
  bills,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountKey: string;
  name: string;
  due: number;
  bills: BillSummary[];
  onDone: (account: AccountDues | null, amount: number) => void;
}) {
  const form = usePaymentForm({ open, accountKey, name, due, bills, onDone });
  return (
    <Dialog open={open} onClose={onClose} busy={form.busy} title="Receive payment" description={`${name} · due ${money(due)}`} size="sm" footer={form.button}>
      {form.fields}
    </Dialog>
  );
}

interface BatchRow {
  account: DueAccount;
  bill?: Bill;
  error?: string;
  sent?: boolean;
}

/**
 * Bill everyone who owes: one bill each for their dues, made in one go, then sent on WhatsApp one
 * tap per person (WhatsApp does not let an app send to many numbers by itself).
 */
export function BillAllDialog({ open, onClose, accounts, label }: { open: boolean; onClose: () => void; accounts: DueAccount[]; label: string }) {
  const kind = useBillKind(open);
  const [rows, setRows] = useState<BatchRow[] | null>(null);
  const [done, setDone] = useState(0);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);
  const targets = useMemo(() => accounts.filter((a) => a.total > 0), [accounts]);
  const total = targets.reduce((s, a) => s + a.total, 0);

  useEffect(() => {
    if (!open) return;
    cancelled.current = false;
    setRows(null);
    setDone(0);
    setRunning(false);
    return () => {
      cancelled.current = true;
    };
  }, [open]);

  const run = async () => {
    if (running || targets.length === 0) return;
    setRunning(true);
    kind.remember();
    const batchId = `batch_${uniqueId()}`;
    const out: BatchRow[] = targets.map((account) => ({ account }));
    setRows([...out]);
    let next = 0;
    const worker = async () => {
      while (!cancelled.current) {
        const i = next++;
        if (i >= out.length) return;
        try {
          out[i].bill = await createBill(out[i].account.accountKey, kind.type, kind.rate, batchId);
        } catch (e: any) {
          out[i].error = e.message;
        }
        setDone((d) => d + 1);
        setRows([...out]);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    setRunning(false);
    const made = out.filter((r) => r.bill).length;
    const failed = out.length - made;
    refreshMoney();
    if (made > 0) toast.ok(`${made} bill${made === 1 ? "" : "s"} made${failed ? `, ${failed} could not be made` : ""}.`);
    else toast.error("No bill could be made. Please try again.");
  };

  const markSent = (i: number) => setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, sent: true } : r)) : prev));
  const sendOne = (i: number) => {
    const r = rows?.[i];
    if (!r?.bill) return;
    shareOnWhatsApp(r.bill, r.bill.snapshot.company.name);
    markSent(i);
  };
  const nextUnsent = rows ? rows.findIndex((r) => r.bill && !r.sent && r.account.phone) : -1;
  const sentCount = rows ? rows.filter((r) => r.sent).length : 0;
  const madeCount = rows ? rows.filter((r) => r.bill).length : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={running}
      title={rows && !running ? `${madeCount} bill${madeCount === 1 ? "" : "s"} ready` : "Bill everyone"}
      description={label}
      size="md"
      footer={
        !rows ? (
          <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" disabled={targets.length === 0} onClick={run}>
            Generate {targets.length} bill{targets.length === 1 ? "" : "s"} · {money(total)}
          </button>
        ) : running ? (
          <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" disabled>
            Making bills… {done} of {targets.length}
          </button>
        ) : nextUnsent >= 0 ? (
          <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" onClick={() => sendOne(nextUnsent)}>
            <WhatsAppIcon /> Send to {rows[nextUnsent].account.name} ({sentCount + 1} of {rows.filter((r) => r.bill && r.account.phone).length})
          </button>
        ) : (
          <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      {!rows ? (
        <div className="space-y-3">
          <BillKind {...kind} />
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--rn-accent-tint,#EEF3EA)] px-4 py-3 text-[14.5px]">
            <span className="text-[var(--rn-ink-2)]">{targets.length} with dues</span>
            <span className="tabular-nums font-semibold">{money(total)}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3 min-w-0">
          {running && (
            <div className="h-2 rounded-full bg-[var(--rn-line)] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={targets.length} aria-valuenow={done}>
              <span className="block h-full rounded-full bg-[var(--rn-accent)] transition-[width] duration-200" style={{ width: `${targets.length ? (done / targets.length) * 100 : 0}%` }} />
            </div>
          )}
          <ul className="divide-y divide-[var(--rn-line)] rounded-2xl border border-[var(--rn-line)]" aria-label="Bills">
            {rows.map((r, i) => (
              <li key={r.account.accountKey} className="flex items-center gap-3 px-3.5 py-2.5 min-w-0">
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold text-[var(--rn-ink)] truncate">{r.account.name}</p>
                  <p className={`text-[12.5px] truncate ${r.error ? "text-[#A3311D]" : "text-[var(--rn-ink-2)]"}`}>
                    {r.error ? r.error : r.bill ? `${r.bill.billNumber} · ${money(r.bill.total)}${r.account.phone ? "" : " · no phone number"}` : "Waiting…"}
                  </p>
                </div>
                {r.bill && r.account.phone ? (
                  <button type="button" className={`rn-btn rn-btn-sm shrink-0 ${r.sent ? "" : "rn-btn-primary"}`} onClick={() => sendOne(i)} aria-label={`Send ${r.account.name}'s bill on WhatsApp`}>
                    {r.sent ? <Check /> : <WhatsAppIcon />} {r.sent ? "Sent" : "Send"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

/** One bill in a list: number, who, when, how much, and what was received against it. */
export function BillRow({ bill, onOpen, showName = true }: { bill: BillSummary; onOpen: () => void; showName?: boolean }) {
  return (
    <button type="button" onClick={onOpen} className="rn-due-row" aria-label={`Open bill ${bill.billNumber}`}>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[14.5px] font-semibold text-[var(--rn-ink)] truncate">{showName ? bill.accountName : bill.billNumber}</span>
        <span className="block text-[12.5px] text-[var(--rn-ink-2)] truncate tabular-nums">
          {showName ? `${bill.billNumber} · ` : ""}
          {billDay(bill.issueDate)} · {bill.type === "GST" ? `GST ${bill.gstRate}%` : "Non-GST"}
          {bill.receivedTotal > 0 ? ` · received ${money(bill.receivedTotal)}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-[15px] font-semibold tabular-nums text-[var(--rn-ink)]">{money(bill.total)}</span>
    </button>
  );
}
