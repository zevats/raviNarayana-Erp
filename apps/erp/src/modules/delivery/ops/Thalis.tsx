"use client";

import React, { useState } from "react";
import { PackageCheck, PackageMinus, PackagePlus, Undo2 } from "lucide-react";
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
  HELD: "Brought back",
  EXTRA: "Extra delivered",
  DAMAGED: "Damaged",
  RETURN: "Handed in to PG",
  SHORT: "Not received when checked",
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

/** Delivery partner: the thalis they carry, handing them in, and damage. */
export function StaffThalis() {
  const q = useThalis();
  const [dialog, setDialog] = useState<"return" | "damage" | null>(null);
  if (!q.data?.ready) return null;
  const me = q.data.staff[0];
  const holding = me?.holding ?? 0;
  const pending = q.data.pending;
  if (!me && q.data.recent.length === 0) return null;
  return (
    <section aria-label="Thalis" className={`${K.card} p-5 space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={K.eyebrow}>Thalis with you</p>
          <p className="mt-1 text-[30px] font-extrabold tabular-nums leading-none">{holding}</p>
        </div>
        <PackageCheck className="w-7 h-7 text-[#C9501C]" aria-hidden />
      </div>
      {pending.length > 0 && (
        <p className="rounded-xl bg-[#FCE9DD] px-3.5 py-2.5 text-[13px] font-semibold text-[#B4440F]">
          {thalis(pending.reduce((s, m) => s + m.quantity, 0))} handed in · waiting to be checked
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={`${K.primaryBtn} h-12 text-[14px]`} disabled={holding === 0} onClick={() => setDialog("return")}>
          <Undo2 className="w-4 h-4" /> Hand in to PG
        </button>
        <button type="button" className={`${K.greyBtn} h-12 text-[14px]`} disabled={holding === 0} onClick={() => setDialog("damage")}>
          <PackageMinus className="w-4 h-4" /> Damaged
        </button>
      </div>
      {q.data.recent.length > 0 && (
        <ul className="divide-y divide-[#ECE6DB]">
          {q.data.recent.slice(0, 8).map((m) => (
            <li key={m.id} className="py-2.5 flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0">
                <span className="block font-semibold truncate">{KIND_TEXT[m.kind]}{m.customerName ? ` · ${m.customerName}` : ""}</span>
                <span className="block text-[12px] text-[#5A6C5E]">
                  {when(m.createdAt)}
                  {m.kind === "RETURN" ? (m.status === "PENDING" ? " · waiting to be checked" : ` · ${m.verifiedQuantity ?? m.quantity} received`) : ""}
                </span>
              </span>
              <span className="shrink-0 font-bold tabular-nums">{m.quantity}</span>
            </li>
          ))}
        </ul>
      )}
      <CountDialog
        open={dialog === "return"}
        title="Hand in thalis to the PG"
        countLabel="Thalis handed in"
        max={holding}
        start={holding}
        noteLabel="Note"
        saveLabel="Hand in"
        onClose={() => setDialog(null)}
        onSave={(count, note) => act({ action: "return", quantity: count, note }, `${thalis(count)} handed in. Waiting to be checked.`)}
      />
      <CountDialog
        open={dialog === "damage"}
        title="Damaged thalis"
        countLabel="Thalis damaged"
        max={holding}
        noteLabel="What happened"
        noteRequired={() => true}
        saveLabel="Save"
        onClose={() => setDialog(null)}
        onSave={(count, note) => act({ action: "damage", quantity: count, note }, `${thalis(count)} recorded as damaged.`)}
      />
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
          <p className="text-[12px] text-[#8A3A14]">To check</p>
          <p className="text-[24px] font-semibold tabular-nums text-[#8A3A14]">{d.pending.reduce((s, m) => s + m.quantity, 0)}</p>
        </div>
      </div>

      {d.pending.length > 0 && (
        <ul className="rn-due-list" aria-label="Thalis handed in">
          {d.pending.map((m) => (
            <li key={m.id} className="rn-due-row !cursor-default">
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold truncate">{m.staffName || "Staff"} handed in {thalis(m.quantity)}</span>
                <span className="block text-[12.5px] text-[var(--rn-ink-2)] truncate">{when(m.createdAt)}{m.note ? ` · ${m.note}` : ""}</span>
              </span>
              {canManage && (
                <button type="button" className="rn-btn rn-btn-primary rn-btn-sm shrink-0" onClick={() => setChecking(m)}>
                  Check
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
                  {thalis(s.holding)} with them{s.pending ? ` · ${s.pending} handed in` : ""}
                  {s.extras ? ` · ${s.extras} extra delivered` : ""}
                  {s.damaged ? ` · ${s.damaged} damaged` : ""}
                </span>
              </span>
              {canManage && s.holding > 0 && (
                <button type="button" className="rn-btn rn-btn-sm shrink-0" onClick={() => setHandIn({ staffId: s.staffId, name: s.staffName, holding: s.holding })}>
                  Hand in
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
                    {m.kind === "RETURN" && m.status === "VERIFIED" ? ` · ${m.verifiedQuantity} received${m.verifiedByName ? ` by ${m.verifiedByName}` : ""}` : ""}
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
        title={checking ? `Check ${checking.staffName || "staff"}'s thalis` : ""}
        countLabel={checking ? `Thalis received (of ${checking.quantity})` : "Thalis received"}
        max={checking?.quantity}
        start={checking?.quantity}
        noteLabel="Why fewer"
        noteWhenNeeded
        noteRequired={(count) => Boolean(checking) && count < (checking?.quantity ?? 0)}
        saveLabel="Confirm received"
        onClose={() => setChecking(null)}
        onSave={(count, note) => act({ action: "verify", moveId: checking!.id, receivedQuantity: count, note }, `${thalis(count)} received into the PG's spare stock.`)}
      />
      <CountDialog
        open={Boolean(handIn)}
        title={handIn ? `${handIn.name}: hand in thalis` : ""}
        countLabel="Thalis handed in"
        max={handIn?.holding}
        start={handIn?.holding}
        noteLabel="Note"
        saveLabel="Hand in"
        onClose={() => setHandIn(null)}
        onSave={(count, note) => act({ action: "return", staffId: handIn!.staffId, quantity: count, note }, `${thalis(count)} handed in.`)}
      />
      <Dialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Give spare thalis"
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
      <CountField value={count} onChange={setCount} label={`How many (${max} spare)`} max={max} />
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
