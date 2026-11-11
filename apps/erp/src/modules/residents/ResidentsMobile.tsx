"use client";

/**
 * Residents on the phone app: who is in house at a glance, one-tap register and check in, a compact
 * list, and one sheet per resident with every action. Built on the app kit.
 */

import React, { useState } from "react";
import { ArrowRightLeft, BedDouble, DoorOpen, FileText, History, LogOut, Phone, Plus, UserCog, Users, Wallet } from "lucide-react";
import type { ResidentListItem } from "@/types";
import { MButton, MEmpty, MField, MGroup, MHero, MNotice, MPill, MQuick, MRow, MSearch, MSegment, MSheet, MSkeletonRows, MStack, initials } from "@/components/app/m";

type Status = "ALL" | "ACTIVE" | "CHECKED_OUT";

export function ResidentsMobile({
  residents,
  allCount,
  loading,
  stats,
  search,
  setSearch,
  status,
  setStatus,
  floorLabel,
  success,
  error,
  approvals,
  onRegister,
  onCheckIn,
  onCheckOut,
  onProfile,
  onEdit,
  onMove,
  dueOf,
  onDues,
  onBillAll,
}: {
  residents: ResidentListItem[];
  allCount: number;
  loading: boolean;
  stats: { total: number; active: number; checkedOutCount: number };
  search: string;
  setSearch: (v: string) => void;
  status: Status;
  setStatus: (v: Status) => void;
  floorLabel: (f: number | null) => string;
  success: string | null;
  error: string | null;
  approvals: React.ReactNode;
  onRegister: () => void;
  onCheckIn: (residentId?: string) => void;
  onCheckOut: (r: ResidentListItem) => void;
  onProfile: (r: ResidentListItem) => void;
  onEdit: (r: ResidentListItem) => void;
  onMove: (r: ResidentListItem) => void;
  /** Rent due per resident id (Owner and Manager); null hides money. */
  dueOf: Map<string, number> | null;
  onDues: (r: ResidentListItem) => void;
  onBillAll?: () => void;
}) {
  const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const totalDue = dueOf ? Array.from(dueOf.values()).reduce((a, b) => a + b, 0) : 0;
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? residents.find((r) => r.id === openId) ?? null : null;
  const inHouse = (r: ResidentListItem) => r.status === "ACTIVE" && Boolean(r.currentRoomNumber);
  const act = (fn: () => void) => {
    setOpenId(null);
    fn();
  };

  return (
    <MStack>
      <MQuick
        items={[
          { label: "New resident", icon: Plus, onClick: onRegister, tone: "accent" },
          { label: "Check in", icon: BedDouble, onClick: () => onCheckIn(), tone: "green" },
          ...(onBillAll ? [{ label: "Bill all", icon: FileText, onClick: onBillAll, tone: "neutral" as const }] : [{ label: "Rooms", icon: DoorOpen, href: "/rooms", tone: "neutral" as const }]),
        ]}
      />
      {approvals}
      {success && <MNotice>{success}</MNotice>}
      {error && <MNotice tone="red">{error}</MNotice>}

      <MHero
        label="In house"
        value={loading ? "—" : stats.active}
        items={[
          ...(dueOf ? [{ label: "Rent due", value: money(totalDue) }] : []),
          { label: "Checked out · 30 days", value: stats.checkedOutCount, onClick: () => setStatus("CHECKED_OUT") },
          { label: "Listed", value: stats.total, onClick: () => setStatus("ALL") },
        ]}
      />

      <MSegment
        label="Show"
        value={status}
        onChange={setStatus}
        options={[
          { value: "ACTIVE", label: "In house" },
          { value: "CHECKED_OUT", label: "Checked out" },
          { value: "ALL", label: "All" },
        ]}
      />
      <MSearch value={search} onChange={setSearch} placeholder="Search name, phone or room" />

      {loading ? (
        <MSkeletonRows rows={6} />
      ) : residents.length === 0 ? (
        <MEmpty icon={Users} title={allCount === 0 ? "No residents yet" : "No residents match"}>
          {allCount === 0 && (
            <MButton kind="primary" icon={Plus} onClick={onRegister}>
              New resident
            </MButton>
          )}
        </MEmpty>
      ) : (
        <MGroup>
          {residents.map((r) => {
            const here = inHouse(r);
            const left = !here && (r.totalStayCount ?? 0) > 0;
            return (
              <MRow
                key={r.id}
                avatar={initials(r.fullName)}
                tone={here ? "accent" : "neutral"}
                title={r.fullName}
                sub={here ? [`Room ${r.currentRoomNumber}`, r.checkInDate ? `since ${r.checkInDate}` : ""].filter(Boolean).join(" · ") : r.phone}
                right={dueOf?.get(r.id) ? money(dueOf.get(r.id)!) : undefined}
                rightTone={dueOf?.get(r.id) ? "red" : undefined}
                rightSub={here ? (dueOf?.get(r.id) ? "due" : undefined) : r.lastCheckOutDate ? `Left ${r.lastCheckOutDate.slice(8, 10)}/${r.lastCheckOutDate.slice(5, 7)}` : "Left"}
                onClick={() => setOpenId(r.id)}
              />
            );
          })}
        </MGroup>
      )}

      <MSheet
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open?.fullName}
        footer={
          open ? (
            inHouse(open) ? (
              <MButton kind="danger" icon={LogOut} onClick={() => act(() => onCheckOut(open))}>
                Check out
              </MButton>
            ) : (
              <MButton kind="primary" icon={BedDouble} onClick={() => act(() => onCheckIn(open.id))}>
                Give a room
              </MButton>
            )
          ) : null
        }
      >
        {open && (
          <>
            <div className="m-card py-1">
              <MField label="Status">
                <MPill tone={inHouse(open) ? "green" : "neutral"}>{inHouse(open) ? "In house" : "Checked out"}</MPill>
              </MField>
              {inHouse(open) && <MField label="Room">{`${open.currentRoomNumber} · ${floorLabel(open.currentFloor)}`}</MField>}
              {inHouse(open) && open.checkInDate && <MField label="Since">{open.checkInDate}</MField>}
              <MField label="Phone">
                <a href={`tel:${open.phone}`} className="inline-flex items-center gap-1.5 text-[var(--rn-accent)]">
                  <Phone className="w-4 h-4" /> {open.phone}
                </a>
              </MField>
              {open.email && <MField label="Email">{open.email}</MField>}
            </div>
            <MGroup>
              {dueOf && <MRow icon={Wallet} tone="red" title="Dues, bill and payment" right={dueOf.get(open.id) ? money(dueOf.get(open.id)!) : "Nothing due"} onClick={() => act(() => onDues(open))} />}
              <MRow icon={History} tone="accent" title="Profile and stays" onClick={() => act(() => onProfile(open))} />
              <MRow icon={UserCog} tone="neutral" title="Edit details" onClick={() => act(() => onEdit(open))} />
              {inHouse(open) && <MRow icon={ArrowRightLeft} tone="blue" title="Move to another room" onClick={() => act(() => onMove(open))} />}
            </MGroup>
          </>
        )}
      </MSheet>
    </MStack>
  );
}
