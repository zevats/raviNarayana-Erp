"use client";

import React, { useState } from "react";
import { Hourglass, PackageCheck, PackagePlus, Undo2 } from "lucide-react";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { postJsonRequest } from "@/lib/http/requestJson";
import { toast } from "@/components/ui/toast";
import { Dialog } from "@/components/ui/Dialog";
import { AppSelect } from "@/components/forms/AppSelect";
import { getJson } from "./data";
import { K } from "./staffKit";

/**
 * Thalis carried by staff (migration 0030): thalis not delivered are brought back and handed in to
 * the PG like cash (checked by the owner or a manager), damaged ones are recorded, extras delivered
 * come out of what is carried, and spare thalis at the PG are given out again so nothing is lost.
 */

interface Move {
  id: string;
  staffId: string;
  staffName: string | null;
  kind: "HELD" | "EXTRA" | "DAMAGED" | "RETURN" | "SHORT" | "ISSUED";
  quantity: number;
  status: "DONE" | "PENDING" | "VERIFIED";
  productName: string | null;
  customerName: string | null;
  note: string | null;
  createdAt: string;
  verifiedQuantity: number | null;
  verifiedByName: string | null;
}
interface Summary {
  ready: boolean;
  stock: number;
  staff: Array<{ staffId: string; staffName: string; holding: number; pending: number; extras: number; damaged: number }>;
  pending: Move[];
  recent: Move[];
}

const KEY = "/api/delivery/thalis";
const TAGS = ["thalis", "delivery", "custody"];
export const useThalis = () => useErpQuery<Summary>(KEY, () => getJson<Summary>(KEY), { ttl: 15000, tags: TAGS, pollIntervalMs: 30000 });
const refresh = () => invalidateErpCache(TAGS);
const thalis = (n: number) => `${n} thali${n === 1 ? "" : "s"}`;
const when = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const KIND_TEXT: Record<Move["kind"], string> = {
  HELD: "Returning to PG",
  EXTRA: "Extra delivered",
  DAMAGED: "Damaged",
  RETURN: "Handed over to PG",
  SHORT: "Not received when accepted",
  ISSUED: "Spare thalis taken",
};

async function act(body: Record<string, unknown>, ok: string): Promise<boolean> {
  try {
    await postJsonRequest(KEY, body);
    toast.ok(ok);
    refresh();
    return true;
  } catch (e: any) {
    toast.error(e?.message || "Could not save. Please try again.");
    return false;
  }
}

function CountField({ value, onChange, label, max }: { value: string; onChange: (v: string) => void; label: string; max?: number }) {
  return (
    <label className="block">
      <span className="rn-t-label block mb-1.5">{label}</span>
      <input type="number" inputMode="numeric" min={0} max={max} step={1} value={value} onChange={(e) => onChange(e.target.value)} className="rn-input w-full tabular-nums" aria-label={label} />
    </label>
  );
}

/** A small form in a dialog: a count and a note. */
function CountDialog({
  open,
  title,
  countLabel,
  max,
  start,
  noteLabel,
  noteRequired,
  saveLabel,
  noteWhenNeeded,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  countLabel: string;
  max?: number;
  start?: number;
  noteLabel: string;
  noteRequired?: (count: number) => boolean;
  saveLabel: string;
  /** Show the note only when it is required (e.g. "Why fewer"). */
  noteWhenNeeded?: boolean;
  onClose: () => void;
  onSave: (count: number, note: string) => Promise<boolean>;
}) {
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  React.useEffect(() => {
    if (open) {
      setCount(start !== undefined ? String(start) : "");
      setNote("");
    }
  }, [open, start]);
  const n = Number(count);
  const valid = count.trim() !== "" && Number.isInteger(n) && n >= 0 && (max === undefined || n <= max);
  const needNote = valid && (noteRequired ? noteRequired(n) : false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title={title}
      accent="orange"
      size="sm"
      footer={
        <button
          type="button"
          className="rn-btn rn-btn-primary w-full sm:w-auto"
          disabled={busy || !valid || (needNote && note.trim().length < 3)}
          onClick={async () => {
            setBusy(true);
            const done = await onSave(n, note.trim());
            setBusy(false);
            if (done) onClose();
          }}
        >
          {busy ? "Saving…" : saveLabel}
        </button>
      }
    >
      <div className="space-y-3">
        <CountField value={count} onChange={setCount} label={countLabel} max={max} />
        {(!noteWhenNeeded || needNote) && <label className="block">
          <span className="rn-t-label block mb-1.5">{noteLabel}{needNote ? " *" : ""}</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className="rn-input w-full" aria-label={noteLabel} />
        </label>}
      </div>
    </Dialog>
  );
}

/**
 * Delivery partner: the thalis they carry and handing them back to the PG. The same steps as My
 * Cash: one tap hands over everything, a different number is a choice of its own, and it then
 * waits for the Owner or a Manager to accept it (their pop-up).
 */
export function StaffThalis() {
  const q = useThalis();
  const [confirming, setConfirming] = useState(false);
  const [custom, setCustom] = useState(false);
  const [countText, setCountText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!q.data?.ready) return null;
  const me = q.data.staff[0];
  const holding = me?.holding ?? 0;
  const waiting = q.data.pending.reduce((n, m) => n + m.quantity, 0);
  if (!me && q.data.recent.length === 0) return null;
  const count = custom ? Math.round(Number(countText)) : holding;
  const countOk = Number.isInteger(count) && count > 0 && count <= holding;
  const handOver = async () => {
    if (busy || !countOk) return;
    setBusy(true);
    const ok = await act({ action: "return", quantity: count }, `${thalis(count)} given to the PG. Waiting for approval.`);
    setBusy(false);
    if (ok) {
      setConfirming(false);
      setCustom(false);
    }
  };
  return (
    <section aria-label="Thalis" className={`${K.card} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[14px] font-semibold text-[#5A6C5E]">Thalis with you</p>
          <p className="mt-1 text-[40px] leading-none font-extrabold tracking-[-0.02em] text-[#1F2320] tabular-nums">{holding}</p>
        </div>
        <PackageCheck className="w-9 h-9 text-[#C9501C] shrink-0" aria-hidden />
      </div>

      {waiting > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-xl bg-[#FBF1DE] px-4 py-3">
          <Hourglass className="w-5 h-5 text-[#8F6710] shrink-0" />
          <p className="text-[14px] text-[#5C430B]">
            <span className="font-bold">{thalis(waiting)}</span> given to the PG · <span className="font-semibold">Waiting for approval</span>
          </p>
        </div>
      )}

      {holding > 0 && waiting === 0 && (
        <div className="mt-5">
          {confirming ? (
            <div className="rn-enter space-y-3">
              {!custom ? (
                <>
                  <div className={`${K.soft} flex items-center justify-between gap-3 px-4 py-4`}>
                    <span className="text-[14px] font-semibold text-[#3E4540]">Handing over</span>
                    <span className="text-[28px] leading-none font-extrabold tabular-nums text-[#1F2320]">{thalis(holding)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCustom(true);
                      setCountText("");
                    }}
                    className="text-[14px] font-semibold text-[#C9501C] hover:underline underline-offset-2"
                  >
                    Giving a different number?
                  </button>
                </>
              ) : (
                <>
                  <label className="block">
                    <span className="block text-[13px] font-semibold text-[#3E4540] mb-1.5">Thalis you are giving</span>
                    <span className={`${K.soft} flex items-center h-14 px-4 focus-within:ring-4 focus-within:ring-[#C9501C]/20`}>
                      <input
                        value={countText}
                        onChange={(e) => setCountText(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                        inputMode="numeric"
                        placeholder="0"
                        autoFocus
                        aria-label="Thalis you are handing over"
                        className="flex-1 min-w-0 bg-transparent text-[22px] font-extrabold tabular-nums outline-none placeholder:text-[#B9B2A6]"
                      />
                    </span>
                  </label>
                  {countText.trim() !== "" && count > holding && <p className="text-[13px] font-semibold text-[#9A3423]">You have {thalis(holding)}; you can&apos;t give more.</p>}
                </>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    setCustom(false);
                  }}
                  disabled={busy}
                  className={`${K.greyBtn} h-12`}
                >
                  Back
                </button>
                <button type="button" onClick={handOver} disabled={busy || !countOk} className={`${K.primaryBtn} h-12`}>
                  {busy ? "Sending…" : `Hand over ${countOk ? count : ""}`}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className={`${K.primaryBtn} w-full h-14 text-[15px]`}>
              <Undo2 className="w-5 h-5" /> Hand over {thalis(holding)} to PG
            </button>
          )}
        </div>
      )}
      {holding > 0 && waiting > 0 && <p className="mt-3 text-[13px] text-[#5A6C5E]">You can hand over the rest once the last handover is approved.</p>}

      {q.data.recent.length > 0 && (
        <ul className="mt-4 divide-y divide-[#ECE6DB]">
          {q.data.recent.slice(0, 8).map((m) => (
            <li key={m.id} className="py-2.5 flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0">
                <span className="block font-semibold truncate">{KIND_TEXT[m.kind]}{m.customerName ? ` · ${m.customerName}` : ""}</span>
                <span className="block text-[12px] text-[#5A6C5E]">
                  {when(m.createdAt)}
                  {m.kind === "RETURN" ? (m.status === "PENDING" ? " · waiting for approval" : ` · ${m.verifiedQuantity ?? m.quantity} accepted`) : ""}
                </span>
              </span>
              <span className="shrink-0 font-bold tabular-nums">{m.quantity}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Owner / Manager: spare thalis at the PG, who carries how many, returns to check, spares to give. */
export function ThaliDesk({ canManage }: { canManage: boolean }) {
  const q = useThalis();
  const [checking, setChecking] = useState<Move | null>(null);
  const [handIn, setHandIn] = useState<{ staffId: string; name: string; holding: number } | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueTo, setIssueTo] = useState("");
  const [staffList, setStaffList] = useState<Array<{ id: string; fullName: string }>>([]);
  if (!q.data) return null;
  if (!q.data.ready) return null;
  const d = q.data;
  const carrying = d.staff.filter((s) => s.holding > 0 || s.pending > 0);
  const openIssue = async () => {
    setIssueOpen(true);
    if (staffList.length === 0) {
      try {
        const r = await getJson<{ staff: Array<{ id: string; fullName: string }> }>("/api/delivery/staff?all=1");
        setStaffList(Array.isArray(r.staff) ? r.staff : []);
      } catch {
        setStaffList([]);
      }
    }
  };
  return (
    <section aria-label="Thalis" className="rn-card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[17px] font-semibold text-[var(--rn-ink)]">Thalis</h2>
        {canManage && (
          <button type="button" className="rn-btn rn-btn-sm" disabled={d.stock === 0} onClick={openIssue}>
            <PackagePlus /> Give spare thalis
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-2xl bg-[var(--rn-accent-tint,#EEF3EA)] px-3.5 py-3">
          <p className="text-[12px] text-[var(--rn-ink-2)]">Spare at PG</p>
          <p className="text-[24px] font-semibold tabular-nums">{d.stock}</p>
        </div>
        <div className="rounded-2xl bg-[#F4F1EA] px-3.5 py-3">
          <p className="text-[12px] text-[var(--rn-ink-2)]">With staff</p>
          <p className="text-[24px] font-semibold tabular-nums">{d.staff.reduce((s, x) => s + x.holding, 0)}</p>
        </div>
        <div className="rounded-2xl bg-[#FCE9DD] px-3.5 py-3">
          <p className="text-[12px] text-[#8A3A14]">To accept</p>
          <p className="text-[24px] font-semibold tabular-nums text-[#8A3A14]">{d.pending.reduce((s, m) => s + m.quantity, 0)}</p>
        </div>
      </div>

      {d.pending.length > 0 && (
        <ul className="rn-due-list" aria-label="Thalis handed in">
          {d.pending.map((m) => (
            <li key={m.id} className="rn-due-row !cursor-default">
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold truncate">{m.staffName || "Staff"} gave {thalis(m.quantity)}</span>
                <span className="block text-[12.5px] text-[var(--rn-ink-2)] truncate">{when(m.createdAt)}{m.note ? ` · ${m.note}` : ""}</span>
              </span>
              {canManage && (
                <button type="button" className="rn-btn rn-btn-primary rn-btn-sm shrink-0" onClick={() => setChecking(m)}>
                  Accept
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {carrying.length > 0 && (
        <ul className="rn-due-list" aria-label="Thalis with staff">
          {carrying.map((s) => (
            <li key={s.staffId} className="rn-due-row !cursor-default">
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold truncate">{s.staffName}</span>
                <span className="block text-[12.5px] text-[var(--rn-ink-2)]">
                  {thalis(s.holding)} with them{s.pending ? ` · ${s.pending} waiting for approval` : ""}
                  {s.extras ? ` · ${s.extras} extra delivered` : ""}
                  {s.damaged ? ` · ${s.damaged} damaged` : ""}
                </span>
              </span>
              {canManage && s.holding > 0 && (
                <button type="button" className="rn-btn rn-btn-sm shrink-0" onClick={() => setHandIn({ staffId: s.staffId, name: s.staffName, holding: s.holding })}>
                  Hand over
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {d.recent.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-[13.5px] font-semibold text-[var(--rn-accent)]">Recent thali records</summary>
          <ul className="mt-2 divide-y divide-[var(--rn-line)]">
            {d.recent.slice(0, 30).map((m) => (
              <li key={m.id} className="py-2 flex items-center justify-between gap-3 text-[13px]">
                <span className="min-w-0">
                  <span className="block font-semibold truncate">
                    {m.staffName || "Staff"} · {KIND_TEXT[m.kind]}
                    {m.customerName ? ` · ${m.customerName}` : ""}
                  </span>
                  <span className="block text-[12px] text-[var(--rn-ink-2)] truncate">
                    {when(m.createdAt)}
                    {m.kind === "RETURN" && m.status === "VERIFIED" ? ` · ${m.verifiedQuantity} accepted${m.verifiedByName ? ` by ${m.verifiedByName}` : ""}` : ""}
                    {m.note ? ` · ${m.note}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{m.quantity}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <CountDialog
        open={Boolean(checking)}
        title={checking ? `${checking.staffName || "Staff"} gave ${thalis(checking.quantity)}` : ""}
        countLabel="Thalis you received"
        max={checking?.quantity}
        start={checking?.quantity}
        noteLabel="Why is it different?"
        noteWhenNeeded
        noteRequired={(count) => Boolean(checking) && count < (checking?.quantity ?? 0)}
        saveLabel="Accept"
        onClose={() => setChecking(null)}
        onSave={(count, note) => act({ action: "verify", moveId: checking!.id, receivedQuantity: count, note }, `${thalis(count)} accepted.`)}
      />
      <CountDialog
        open={Boolean(handIn)}
        title={handIn ? `${handIn.name}: hand over thalis` : ""}
        countLabel="Thalis handed over"
        max={handIn?.holding}
        start={handIn?.holding}
        noteLabel="Note"
        saveLabel="Hand over"
        onClose={() => setHandIn(null)}
        onSave={(count, note) => act({ action: "return", staffId: handIn!.staffId, quantity: count, note }, `${thalis(count)} handed over.`)}
      />
      <Dialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Give spare thalis"
        accent="orange"
        size="sm"
        footer={null}
      >
        <div className="space-y-3">
          <label className="block">
            <span className="rn-t-label block mb-1.5">Give to</span>
            <AppSelect value={issueTo} onChange={(e) => setIssueTo(e.target.value)} className="rn-input w-full" aria-label="Give to">
              <option value="">Choose who takes them</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </AppSelect>
          </label>
          <IssueCount
            max={d.stock}
            disabled={!issueTo}
            onSave={async (count) => {
              const ok = await act({ action: "issue", staffId: issueTo, quantity: count }, `${thalis(count)} given for deliveries.`);
              if (ok) setIssueOpen(false);
              return ok;
            }}
          />
        </div>
      </Dialog>
    </section>
  );
}

function IssueCount({ max, disabled, onSave }: { max: number; disabled: boolean; onSave: (n: number) => Promise<boolean> }) {
  const [count, setCount] = useState("1");
  const [busy, setBusy] = useState(false);
  const n = Number(count);
  const valid = Number.isInteger(n) && n > 0 && n <= max;
  return (
    <div className="space-y-3">
      <CountField value={count} onChange={setCount} label="How many" max={max} />
      <button
        type="button"
        className="rn-btn rn-btn-primary w-full"
        disabled={disabled || !valid || busy}
        onClick={async () => {
          setBusy(true);
          await onSave(n);
          setBusy(false);
        }}
      >
        {busy ? "Saving…" : "Give"}
      </button>
    </div>
  );
}
