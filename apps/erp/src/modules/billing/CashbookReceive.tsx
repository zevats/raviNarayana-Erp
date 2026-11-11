"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { BillSummary } from "@/lib/bills";
import { Dialog } from "@/components/ui/Dialog";
import { SearchField } from "@/components/ui/kit";
import { toast } from "@/components/ui/toast";
import { useErpQuery } from "@/lib/cache/erpDataCache";
import { businessToday } from "@/lib/businessDate";
import { DueAccount, METHODS, Method, listAccountBills, methodLabel, money, refreshMoney, send } from "./api";
import { Choice, usePaymentForm } from "./BillDialogs";
import { useDues } from "./DuesList";

type Kind = "RENT" | "TIFFIN" | "OTHER";

/**
 * Cashbook → Receive: money in, straight from the cashbook. Rent (a resident) and Tiffin (a tiffin
 * customer) are received against that person's dues, oldest first, exactly as from Dues, so what
 * they owe goes down at once. Other is money that is nobody's dues (a guest at the counter, a
 * one-off sale): it is recorded with who paid and what for.
 */
export function CashbookReceiveDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>("RENT");
  const [picked, setPicked] = useState<DueAccount | null>(null);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (!open) return;
    setKind("RENT");
    setPicked(null);
    setSearch("");
  }, [open]);
  useEffect(() => {
    setPicked(null);
    setSearch("");
  }, [kind]);

  const residents = useDues("RESIDENT", open);
  const customers = useDues("CUSTOMER", open);
  const list = kind === "RENT" ? residents : customers;
  const owing = useMemo(() => (list.data?.accounts ?? []).filter((a) => a.total > 0), [list.data]);
  const s = search.trim().toLowerCase();
  const matches = useMemo(
    () => owing.filter((a) => !s || a.name.toLowerCase().includes(s) || (a.phone || "").includes(s.replace(/\s+/g, "")) || (a.place || "").toLowerCase().includes(s)).slice(0, 40),
    [owing, s]
  );

  const billsQ = useErpQuery<{ bills: BillSummary[]; total: number }>(picked ? `bills:account:${picked.accountKey}` : null, () => listAccountBills(picked!.accountKey), { tags: ["bills"], ttl: 15000 });
  const form = usePaymentForm({
    open: open && Boolean(picked),
    accountKey: picked?.accountKey ?? null,
    name: picked?.name ?? "",
    due: picked?.total ?? 0,
    bills: billsQ.data?.bills ?? [],
    onDone: () => onDone(),
  });
  const other = useOtherForm(open && kind === "OTHER", onDone);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={form.busy || other.busy}
      title="Receive"
      size="sm"
      footer={kind === "OTHER" ? other.button : picked ? form.button : undefined}
    >
      <div className="space-y-4 min-w-0">
        <Choice
          label="For"
          value={kind}
          onChange={setKind}
          options={[
            { value: "RENT", label: "Rent" },
            { value: "TIFFIN", label: "Tiffin" },
            { value: "OTHER", label: "Other" },
          ]}
        />
        {kind === "OTHER" ? (
          other.fields
        ) : picked ? (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--rn-line)] bg-white px-4 py-3 min-w-0">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-[var(--rn-ink)] truncate">{picked.name}</p>
                <p className="text-[13px] text-[var(--rn-ink-2)] truncate">
                  {[picked.kind === "RESIDENT" && picked.place ? `Room ${picked.place}` : picked.phone, `due ${money(picked.total)}`].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button type="button" className="rn-btn rn-btn-sm shrink-0" onClick={() => setPicked(null)}>
                Change
              </button>
            </div>
            {form.fields}
          </>
        ) : (
          <div className="space-y-2.5">
            <SearchField value={search} onChange={setSearch} placeholder={kind === "RENT" ? "Search resident or room" : "Search customer or phone"} className="w-full" />
            {!list.data ? (
              <div className="space-y-2" aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <span key={i} className="rn-skel block h-[56px] w-full rounded-2xl" />
                ))}
              </div>
            ) : matches.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--rn-line)] px-4 py-6 text-center text-[14.5px] text-[var(--rn-ink-2)]">
                {owing.length === 0 ? (kind === "RENT" ? "No resident owes rent." : "No tiffin customer owes anything.") : "No one matches."}
              </p>
            ) : (
              <ul className="rn-due-list max-h-[46vh] overflow-y-auto" aria-label="Who paid">
                {matches.map((a) => (
                  <li key={a.accountKey}>
                    <button type="button" className="rn-due-row" onClick={() => setPicked(a)}>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-[14.5px] font-semibold text-[var(--rn-ink)] truncate">{a.name}</span>
                        <span className="block text-[12.5px] text-[var(--rn-ink-2)] truncate">{a.kind === "RESIDENT" ? (a.place ? `Room ${a.place}` : "Resident") : a.phone}</span>
                      </span>
                      <span className="shrink-0 text-[15px] font-semibold tabular-nums text-[#A3311D]">{money(a.total)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Other: who paid, what for, the amount and how it was paid. */
function useOtherForm(open: boolean, onDone: () => void) {
  const [payer, setPayer] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [date, setDate] = useState(businessToday());
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef("");
  const inFlight = useRef(false);
  useEffect(() => {
    if (!open) return;
    key.current = `rcpt_${crypto.randomUUID()}`;
    setPayer("");
    setNote("");
    setAmount("");
    setMethod("CASH");
    setDate(businessToday());
    setReference("");
    setError(null);
  }, [open]);
  const value = amount.trim() === "" ? NaN : Number(amount);
  const problem = payer.trim().length < 2 ? "Enter who paid." : !Number.isInteger(value) || value <= 0 ? "Enter the amount received." : null;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (inFlight.current) return;
    if (problem) return setError(problem);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await send("/api/finance/receipts", {
        amount: value,
        paymentMethod: method,
        transactionDate: date,
        payerName: payer.trim(),
        note: note.trim() || undefined,
        referenceNumber: reference.trim() || undefined,
        idempotencyKey: key.current,
      });
      toast.ok(`${money(value)} received from ${payer.trim()} by ${methodLabel(method)}.`);
      refreshMoney();
      onDone();
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
      <div className="grid grid-cols-1 gap-3">
        <label className="block">
          <span className="rn-t-label block mb-1.5">From</span>
          <input value={payer} onChange={(e) => setPayer(e.target.value)} placeholder="Name" className="rn-input w-full" aria-label="Received from" autoFocus />
        </label>
        <label className="block">
          <span className="rn-t-label block mb-1.5">For</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className="rn-input w-full" aria-label="What it is for" />
        </label>
      </div>
      <label className="block">
        <span className="rn-t-label block mb-1.5">Amount</span>
        <input type="number" inputMode="numeric" min={1} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="rn-input rn-money w-full h-12 text-[18px] font-semibold" aria-label="Amount" id="other-amount" />
      </label>
      <div>
        <span className="rn-t-label block mb-1.5">Paid by</span>
        <Choice label="Paid by" size="sm" value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} />
      </div>
      <div className={`grid gap-3 ${method !== "CASH" ? "grid-cols-2" : "grid-cols-1"}`}>
        <label className="min-w-0">
          <span className="rn-t-label block mb-1.5">Date</span>
          <input type="date" value={date} max={businessToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rn-input w-full" aria-label="Payment date" />
        </label>
        {method !== "CASH" && (
          <label className="min-w-0">
            <span className="rn-t-label block mb-1.5">{method === "CHEQUE" ? "Cheque no." : "Reference"}</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className="rn-input w-full" aria-label="Reference" />
          </label>
        )}
      </div>
      {error && <p role="alert" className="rounded-2xl bg-[#FDECE8] px-4 py-3 text-[14px] text-[#A3311D]">{error}</p>}
      <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
    </form>
  );
  const button = (
    <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" disabled={busy} onClick={() => submit()}>
      {busy ? "Recording…" : Number.isInteger(value) && value > 0 ? `Receive ${money(value)}` : "Receive"}
    </button>
  );
  return { fields, button, busy };
}
