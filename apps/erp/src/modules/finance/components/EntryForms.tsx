"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, FileCheck2, X } from "lucide-react";
import type { FinancialTransaction, ResidentListItem } from "@/types";
import { Dialog } from "@/components/ui/Dialog";
import { SearchField } from "@/components/ui/kit";
import { AppSelect } from "@/components/forms/AppSelect";
import { toast } from "@/components/ui/toast";
import { businessToday } from "@/lib/businessDate";
import { Choice } from "@/modules/billing/BillDialogs";
import { METHODS, Method, methodLabel, money, refreshMoney, send } from "@/modules/billing/api";
import { uniqueId } from "@/lib/uniqueId";

export const EXPENSE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "GROCERY", label: "Grocery" },
  { value: "KITCHEN_SUPPLIES", label: "Kitchen supplies" },
  { value: "LPG", label: "LPG (cooking gas)" },
  { value: "UTILITIES", label: "Electricity & water" },
  { value: "MAINTENANCE", label: "Repairs & maintenance" },
  { value: "STAFF_SALARY", label: "Staff salary" },
  { value: "INTERNET", label: "Internet & phone" },
  { value: "MARKETING", label: "Marketing" },
  { value: "OTHER", label: "Other" },
];
export const categoryLabel = (c: string | null | undefined) => EXPENSE_CATEGORIES.find((x) => x.value === c)?.label ?? (c ? c.charAt(0) + c.slice(1).toLowerCase().replace(/_/g, " ") : "");

const ERR = "rounded-2xl bg-[#FDECE8] px-4 py-3 text-[14px] text-[#A3311D]";

function AmountField({ value, onChange, id, autoFocus }: { value: string; onChange: (v: string) => void; id: string; autoFocus?: boolean }) {
  return (
    <label className="block" htmlFor={id}>
      <span className="rn-t-label block mb-1.5">Amount</span>
      <input id={id} type="number" inputMode="numeric" min={1} step={1} value={value} onChange={(e) => onChange(e.target.value)} placeholder="0" className="rn-input rn-money w-full h-12 text-[18px] font-semibold" autoFocus={autoFocus} />
    </label>
  );
}

function MethodDateRef({ method, setMethod, date, setDate, reference, setReference }: { method: Method; setMethod: (m: Method) => void; date: string; setDate: (d: string) => void; reference: string; setReference: (r: string) => void }) {
  return (
    <>
      <div>
        <span className="rn-t-label block mb-1.5">Paid by</span>
        <Choice label="Paid by" size="sm" value={method} onChange={setMethod} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} />
      </div>
      <div className={`grid gap-3 ${method !== "CASH" ? "grid-cols-2" : "grid-cols-1"}`}>
        <label className="min-w-0">
          <span className="rn-t-label block mb-1.5">Date</span>
          <input type="date" value={date} max={businessToday()} onChange={(e) => e.target.value && setDate(e.target.value)} className="rn-input w-full" aria-label="Date" />
        </label>
        {method !== "CASH" && (
          <label className="min-w-0">
            <span className="rn-t-label block mb-1.5">{method === "CHEQUE" ? "Cheque no." : "Reference"}</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className="rn-input w-full" aria-label="Reference" />
          </label>
        )}
      </div>
    </>
  );
}

/** Expense: what it was for, the amount, how it was paid. */
export function ExpenseDialog({ isOpen, onClose, onSuccess }: { isOpen: boolean; onClose: () => void; onSuccess: (tx: FinancialTransaction, message: string) => void }) {
  const [category, setCategory] = useState("GROCERY");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(businessToday());
  const [reference, setReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef("");
  useEffect(() => {
    if (!isOpen) return;
    key.current = `exp_${uniqueId()}`;
    setFile(null);
    setAmount("");
    setPayee("");
    setNote("");
    setReference("");
    setMethod("CASH");
    setDate(businessToday());
    setError(null);
  }, [isOpen]);
  const value = Number(amount);
  const submit = async () => {
    if (busy) return;
    if (!Number.isInteger(value) || value <= 0) return setError("Enter the amount spent.");
    if (!note.trim()) return setError("Enter what it was for.");
    setBusy(true);
    setError(null);
    try {
      const { data } = await send<{ transaction: FinancialTransaction }>("/api/finance/transactions", {
        action: "EXPENSE",
        category,
        amount: value,
        paymentMethod: method,
        payeeVendor: payee.trim() || undefined,
        transactionDate: date,
        referenceNumber: reference.trim() || undefined,
        description: note.trim(),
        idempotencyKey: key.current,
      });
      if (file && data.transaction?.id) {
        try {
          await uploadEntryFile(data.transaction.id, file, `Bill for ${note.trim()}`);
        } catch (err: any) {
          toast.error(err.message);
        }
      }
      const msg = `${money(value)} spent on ${categoryLabel(category).toLowerCase()} recorded.`;
      toast.ok(msg);
      refreshMoney();
      onSuccess(data.transaction, msg);
      onClose();
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      busy={busy}
      title="Expense"
      size="sm"
      footer={
        <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : Number.isInteger(value) && value > 0 ? `Save ${money(value)}` : "Save expense"}
        </button>
      }
    >
      <form className="space-y-4 min-w-0" noValidate onSubmit={(e) => (e.preventDefault(), submit())}>
        <label className="block">
          <span className="rn-t-label block mb-1.5">Category</span>
          <AppSelect value={category} onChange={(e) => setCategory(e.target.value)} className="rn-input w-full" aria-label="Category">
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </AppSelect>
        </label>
        <AmountField id="expense-amount" value={amount} onChange={setAmount} />
        <div className="grid grid-cols-1 gap-3">
          <label className="block">
            <span className="rn-t-label block mb-1.5">For</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vegetables, gas cylinder, plumber…" className="rn-input w-full" aria-label="What it was for" />
          </label>
          <label className="block">
            <span className="rn-t-label block mb-1.5">Paid to</span>
            <input value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Optional" className="rn-input w-full" aria-label="Paid to" />
          </label>
        </div>
        <MethodDateRef method={method} setMethod={setMethod} date={date} setDate={setDate} reference={reference} setReference={setReference} />
        <FileField file={file} setFile={setFile} />
        {error && <p role="alert" className={ERR}>{error}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialog>
  );
}

/** Security deposit: which resident, the amount, how it was paid. */
export function DepositDialog({ isOpen, onClose, residents, onSuccess }: { isOpen: boolean; onClose: () => void; residents: ResidentListItem[]; onSuccess: (tx: FinancialTransaction, message: string) => void }) {
  const [picked, setPicked] = useState<ResidentListItem | null>(null);
  const [search, setSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [date, setDate] = useState(businessToday());
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef("");
  useEffect(() => {
    if (!isOpen) return;
    key.current = `dep_${uniqueId()}`;
    setPicked(null);
    setSearch("");
    setAmount("");
    setMethod("CASH");
    setDate(businessToday());
    setReference("");
    setError(null);
  }, [isOpen]);
  const inHouse = useMemo(() => residents.filter((r) => r.status === "ACTIVE" && r.currentRoomNumber).sort((a, b) => a.fullName.localeCompare(b.fullName)), [residents]);
  const s = search.trim().toLowerCase();
  const shown = inHouse.filter((r) => !s || r.fullName.toLowerCase().includes(s) || r.phone.includes(s) || (r.currentRoomNumber || "").toLowerCase().includes(s));
  const value = Number(amount);
  const submit = async () => {
    if (busy) return;
    if (!picked) return setError("Choose the resident.");
    if (!Number.isInteger(value) || value <= 0) return setError("Enter the deposit amount.");
    setBusy(true);
    setError(null);
    try {
      const { data } = await send<{ transaction: FinancialTransaction }>("/api/finance/transactions", {
        action: "SECURITY_DEPOSIT",
        residentId: picked.id,
        amount: value,
        paymentMethod: method,
        transactionDate: date,
        referenceNumber: reference.trim() || undefined,
        description: "Security deposit",
        idempotencyKey: key.current,
      });
      const msg = `${money(value)} deposit received from ${picked.fullName} by ${methodLabel(method)}.`;
      toast.ok(msg);
      refreshMoney();
      onSuccess(data.transaction, msg);
      onClose();
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      busy={busy}
      title="Security deposit"
      size="sm"
      footer={
        picked ? (
          <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" disabled={busy} onClick={submit}>
            {busy ? "Saving…" : Number.isInteger(value) && value > 0 ? `Receive ${money(value)}` : "Receive deposit"}
          </button>
        ) : undefined
      }
    >
      <div className="space-y-4 min-w-0">
        {picked ? (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-[var(--rn-line)] bg-white px-4 py-3 min-w-0">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-[var(--rn-ink)] truncate">{picked.fullName}</p>
                <p className="text-[13px] text-[var(--rn-ink-2)] truncate">Room {picked.currentRoomNumber} · {picked.phone}</p>
              </div>
              <button type="button" className="rn-btn rn-btn-sm shrink-0" onClick={() => setPicked(null)}>Change</button>
            </div>
            <form className="space-y-4" noValidate onSubmit={(e) => (e.preventDefault(), submit())}>
              <AmountField id="deposit-amount" value={amount} onChange={setAmount} autoFocus />
              <MethodDateRef method={method} setMethod={setMethod} date={date} setDate={setDate} reference={reference} setReference={setReference} />
              <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
            </form>
          </>
        ) : (
          <div className="space-y-2.5">
            <SearchField value={search} onChange={setSearch} placeholder="Search resident or room" className="w-full" />
            {shown.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[var(--rn-line)] px-4 py-6 text-center text-[14.5px] text-[var(--rn-ink-2)]">{inHouse.length === 0 ? "No resident is in house." : "No one matches."}</p>
            ) : (
              <ul className="rn-due-list rn-pick-list" aria-label="Residents">
                {shown.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="rn-due-row" onClick={() => setPicked(r)}>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-[14.5px] font-semibold text-[var(--rn-ink)] truncate">{r.fullName}</span>
                        <span className="block text-[12.5px] text-[var(--rn-ink-2)] truncate">Room {r.currentRoomNumber} · {r.phone}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {error && <p role="alert" className={ERR}>{error}</p>}
      </div>
    </Dialog>
  );
}

const RECEIVED = new Set(["RENT_PAYMENT", "SECURITY_DEPOSIT", "TIFFIN_PAYMENT"]);
const LINKED = new Set(["TIFFIN_DELIVERY_COLLECTION", "TIFFIN_WALKIN_SALE", "DEPOSIT_APPLICATION"]);

/** Whether an entry can be edited from the cashbook (money received or spent, still posted). */
export function canEditEntry(tx: FinancialTransaction): boolean {
  return tx.status === "POSTED" && (tx.transactionType === "EXPENSE" || RECEIVED.has(tx.transactionType));
}

/** Adds a photo or PDF of a bill to an entry (kept in the entry's documents). */
export async function uploadEntryFile(transactionId: string, file: File, note: string) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("category", "EXPENSE_RECEIPT");
  fd.append("transactionId", transactionId);
  fd.append("notes", note);
  const r = await fetch("/api/documents", { method: "POST", headers: { "X-RN-Quiet": "1" }, body: fd });
  if (!r.ok) throw new Error("The entry was saved, but the bill photo could not be uploaded. Try again from Edit.");
}

function FileField({ file, setFile }: { file: File | null; setFile: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="rn-t-label block mb-1.5">Bill photo</span>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {file ? (
        <div className="rn-file is-chosen">
          <FileCheck2 className="w-5 h-5 shrink-0" aria-hidden />
          <span className="flex-1 min-w-0 truncate">{file.name}</span>
          <button type="button" className="rn-file-x" onClick={() => setFile(null)} aria-label="Remove the bill photo">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button type="button" className="rn-file" onClick={() => input.current?.click()}>
          <span className="rn-file-ico" aria-hidden>
            <Upload className="w-[18px] h-[18px]" />
          </span>
          <span className="flex-1 min-w-0 text-left">
            <span className="block font-semibold">Upload photo or PDF</span>
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * Edit an entry: everything that was recorded can be changed and saved again (amount, date, how it
 * was paid, who, what for, reference, category, bill photo). Balances follow at once. An entry tied
 * to another record (a delivery handover, a counter sale, a deposit used for rent) keeps its amount,
 * date and method; its details can still be edited.
 */
export function EditEntryDialog({ tx, onClose, onSaved }: { tx: FinancialTransaction | null; onClose: () => void; onSaved: (message: string) => void }) {
  const isExpense = tx?.transactionType === "EXPENSE";
  const isOther = tx?.transactionType === "TIFFIN_PAYMENT" && tx?.category === "OTHER_RECEIPT";
  const moneyEditable = Boolean(tx) && !LINKED.has(String(tx?.category || ""));
  const [note, setNote] = useState("");
  const [payee, setPayee] = useState("");
  const [reference, setReference] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!tx) return;
    setNote(tx.description || "");
    setPayee(tx.payeeVendor || "");
    setReference(tx.referenceNumber || "");
    setCategory(tx.category || "OTHER");
    setAmount(String(tx.amount));
    setDate(tx.transactionDate);
    setMethod(((METHODS.find((m) => m.value === tx.paymentMethod)?.value) || "CASH") as Method);
    setFile(null);
    setError(null);
  }, [tx]);
  const submit = async () => {
    if (!tx || busy) return;
    const value = Number(amount);
    if (moneyEditable && (!Number.isInteger(value) || value <= 0)) return setError("Enter the amount in whole rupees.");
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { description: note, referenceNumber: reference };
      if (isExpense || isOther) body.payeeVendor = payee;
      if (isExpense) body.category = category;
      if (moneyEditable) Object.assign(body, { amount: value, transactionDate: date, paymentMethod: method });
      const { data } = await send<{ changed: boolean; billsReopened?: number }>(`/api/finance/transactions/${encodeURIComponent(tx.id)}`, body, "PATCH");
      if (file) await uploadEntryFile(tx.id, file, `Bill for ${note || categoryLabel(category)}`);
      const msg = !data.changed && !file ? "Nothing was changed." : `Entry updated${data.billsReopened ? `; ${data.billsReopened} bill${data.billsReopened === 1 ? " is" : "s are"} due again` : ""}.`;
      toast.ok(msg);
      refreshMoney();
      onSaved(msg);
      onClose();
    } catch (e: any) {
      setError(e.message);
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={Boolean(tx)}
      onClose={onClose}
      busy={busy}
      title={isExpense ? "Edit expense" : "Edit payment"}
      size="sm"
      footer={
        <button type="button" className="rn-btn rn-btn-primary w-full sm:w-auto" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      }
    >
      {tx && (
        <form className="space-y-4 min-w-0" noValidate onSubmit={(e) => (e.preventDefault(), submit())}>
          {isExpense && (
            <label className="block">
              <span className="rn-t-label block mb-1.5">Category</span>
              <AppSelect value={category} onChange={(e) => setCategory(e.target.value)} className="rn-input w-full" aria-label="Category">
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </AppSelect>
            </label>
          )}
          {moneyEditable ? (
            <AmountField id="edit-amount" value={amount} onChange={setAmount} />
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--rn-accent-tint,#EEF3EA)] px-4 py-3 text-[14.5px]">
              <span className="text-[var(--rn-ink-2)]">Amount</span>
              <span className="tabular-nums font-semibold">{money(tx.amount)}</span>
            </div>
          )}
          {(isExpense || isOther) && (
            <label className="block">
              <span className="rn-t-label block mb-1.5">{isExpense ? "Paid to" : "From"}</span>
              <input value={payee} onChange={(e) => setPayee(e.target.value)} className="rn-input w-full" aria-label={isExpense ? "Paid to" : "From"} />
            </label>
          )}
          <label className="block">
            <span className="rn-t-label block mb-1.5">{isExpense ? "For" : "Note"}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="rn-input w-full" aria-label="Note" />
          </label>
          {moneyEditable ? (
            <MethodDateRef method={method} setMethod={setMethod} date={date} setDate={setDate} reference={reference} setReference={setReference} />
          ) : (
            <label className="block">
              <span className="rn-t-label block mb-1.5">Reference</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className="rn-input w-full" aria-label="Reference" />
            </label>
          )}
          {isExpense && <FileField file={file} setFile={setFile} />}
          {error && <p role="alert" className={ERR}>{error}</p>}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      )}
    </Dialog>
  );
}
