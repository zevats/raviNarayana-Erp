"use client";

import { useTimedMessage } from "@/lib/useTimedMessage";
import React, { useState } from "react";
import { X, BedDouble, Wrench, Plus, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { RoomWithOccupancy, RoomMaintenanceRecord } from "@/types";
import { useErpQuery, invalidateErpCache } from "@/lib/cache/erpDataCache";
import { businessToday } from "@/lib/businessDate";
import { BikeLoader } from "@/components/feedback/BikeLoader";
import { SelectMenu } from "@/components/forms/SelectMenu";

const btnPrimary = "inline-flex items-center gap-1.5 px-3.5 min-h-[36px] rounded-full bg-[#1A2E20] text-white text-xs font-semibold hover:bg-[#263B2D] disabled:opacity-60";
const btnQuiet = "inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-full border border-[#8E9F89]/40 bg-white text-[#1A2E20] text-xs font-semibold hover:bg-[#FAF8F5] disabled:opacity-60";
const input = "w-full min-h-[38px] px-3 rounded-xl border border-[#8E9F89]/40 bg-white text-sm text-[#1A2E20]";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

/**
 * Beds and maintenance for one room: each bed with who is in it, putting residents (checked in
 * before beds existed) into a bed, adding/removing beds, taking a bed out of service, and starting
 * or completing maintenance with its history.
 */
export function RoomBedsPanel({ room, canManage, onClose, onChanged }: { room: RoomWithOccupancy; canManage: boolean; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useTimedMessage<{ ok: boolean; text: string }>();
  const [newBed, setNewBed] = useState("");
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState(businessToday());
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState<Record<string, string>>({});

  const history = useErpQuery<{ records: RoomMaintenanceRecord[] }>(
    `/api/rooms/${room.id}/maintenance`,
    async () => send(`/api/rooms/${room.id}/maintenance`, "GET"),
    { ttl: 15000, tags: ["rooms"] }
  );

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      invalidateErpCache(["rooms", "residents"]);
      onChanged();
      history.refetch();
      setMsg({ ok: true, text: ok });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const beds = room.beds ?? [];
  const freeBeds = beds.filter((b) => b.status === "IN_SERVICE" && !b.occupant);
  const withoutBed = (room.occupants ?? []).filter((o) => !o.bedId);
  const open = room.maintenance;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="beds-title" className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl border border-[#8E9F89]/30 max-w-lg w-full p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-[#8E9F89]/20">
          <h2 id="beds-title" className="text-base font-bold text-[#1A2E20] flex items-center gap-2">
            <BedDouble className="w-5 h-5 text-[#B58A57]" /> Room {room.roomNumber}: beds &amp; maintenance
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[#5A6C5E] hover:bg-[#FAF8F5]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {msg && (
          <p className={`text-xs flex items-center gap-1.5 ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>
            {msg.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />} {msg.text}
          </p>
        )}

        {beds.length === 0 ? (
          <p className="text-sm text-[#5A6C5E]">Individual beds are not set up on this system yet.</p>
        ) : (
          <section aria-label="Beds" className="space-y-2">
            {beds.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-[#8E9F89]/25">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1A2E20]">{b.label}</p>
                  <p className="text-xs text-[#5A6C5E] truncate">
                    {b.occupant ? b.occupant.fullName : b.status === "OUT_OF_SERVICE" ? "Out of service" : open ? "Free (room under maintenance)" : "Free"}
                  </p>
                </div>
                {canManage && !b.occupant && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      className={btnQuiet}
                      onClick={() => run(() => send(`/api/rooms/beds/${b.id}`, "PATCH", { status: b.status === "IN_SERVICE" ? "OUT_OF_SERVICE" : "IN_SERVICE" }), b.status === "IN_SERVICE" ? `${b.label} taken out of service.` : `${b.label} back in service.`)}
                    >
                      {b.status === "IN_SERVICE" ? "Out of service" : "Back in service"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove ${b.label}`}
                      title="Remove (only beds never used)"
                      className="p-2 rounded-full border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                      onClick={() => window.confirm(`Remove ${b.label} from Room ${room.roomNumber}?`) && run(() => send(`/api/rooms/beds/${b.id}`, "DELETE"), `${b.label} removed.`)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {canManage && (
              <div className="flex gap-2">
                <input className={input} placeholder="New bed name, e.g. Bed 4" value={newBed} onChange={(e) => setNewBed(e.target.value)} aria-label="New bed name" />
                <button type="button" className={btnQuiet} disabled={busy || !newBed.trim()} onClick={() => run(() => send(`/api/rooms/${room.id}/beds`, "POST", { label: newBed }).then(() => setNewBed("")), "Bed added.")}>
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
            )}
          </section>
        )}

        {canManage && withoutBed.length > 0 && freeBeds.length > 0 && (
          <section aria-label="Residents without a bed" className="space-y-2 p-3 rounded-2xl bg-[#FAF8F5] border border-[#8E9F89]/20">
            <p className="text-xs font-semibold text-[#5A6C5E]">Living here without a bed chosen</p>
            {withoutBed.map((o) => (
              <div key={o.stayId} className="flex items-center gap-2">
                <span className="text-sm text-[#1A2E20] flex-1 min-w-0 truncate">{o.fullName}</span>
                <div className="min-w-[140px]">
                  <SelectMenu
                    label={`Bed for ${o.fullName}`}
                    tone="forest"
                    value={placing[o.stayId] ?? ""}
                    onChange={(v) => setPlacing((p) => ({ ...p, [o.stayId]: v }))}
                    options={[{ value: "", label: "Choose bed" }, ...freeBeds.map((b) => ({ value: b.id, label: b.label }))]}
                    triggerClassName="bg-white border border-[#8E9F89]/40 text-[#1A2E20]"
                  />
                </div>
                <button type="button" className={btnPrimary} disabled={busy || !placing[o.stayId]} onClick={() => run(() => send(`/api/residents/stays/${o.stayId}/bed`, "POST", { bedId: placing[o.stayId] }), `${o.fullName} placed.`)}>
                  Place
                </button>
              </div>
            ))}
          </section>
        )}

        <section aria-label="Maintenance" className="space-y-3 pt-3 border-t border-[#8E9F89]/20">
          <h3 className="text-sm font-bold text-[#1A2E20] flex items-center gap-2"><Wrench className="w-4 h-4 text-[#B58A57]" /> Maintenance</h3>
          {open ? (
            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 space-y-2">
              <p className="text-sm text-amber-900">
                Under maintenance since {open.startDate}: {open.reason}. No new residents until it is complete.
                {(room.occupants ?? []).length > 0 ? ` ${(room.occupants ?? []).length} resident(s) still live here and are not affected.` : ""}
              </p>
              {canManage && (
                <div className="flex gap-2">
                  <input className={input} placeholder="What was done (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Completion note" />
                  <button type="button" className={btnPrimary} disabled={busy} onClick={() => run(() => send(`/api/rooms/${room.id}/maintenance`, "POST", { action: "complete", note }), "Maintenance complete. The room is available again.")}>
                    Mark complete
                  </button>
                </div>
              )}
            </div>
          ) : (
            canManage && (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input className={input} placeholder="Reason, e.g. Bathroom repair" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Maintenance reason" />
                <input type="date" className={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-label="Start date" />
                <button type="button" className={`${btnQuiet} col-span-2 justify-center`} disabled={busy || reason.trim().length < 3} onClick={() => run(() => send(`/api/rooms/${room.id}/maintenance`, "POST", { action: "start", reason, startDate }).then(() => setReason("")), "Room marked under maintenance.")}>
                  Start maintenance
                </button>
              </div>
            )
          )}
          {history.isLoading && !history.data ? (
            <BikeLoader inline label="Loading history" />
          ) : (history.data?.records ?? []).filter((r) => r.status === "COMPLETED").length > 0 ? (
            <ul className="space-y-1 text-xs text-[#5A6C5E]">
              {(history.data?.records ?? []).filter((r) => r.status === "COMPLETED").map((r) => (
                <li key={r.id}>{r.startDate} → {r.endDate}: {r.reason}{r.completionNote ? ` (${r.completionNote})` : ""}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}
