"use client";

/**
 * Residents on the phone app: who is in house at a glance, one-tap register and check in, a compact
 * list, and one sheet per resident with every action. Built on the app kit.
 */

import React, { useState } from "react";
import { ArrowRightLeft, BedDouble, DoorOpen, History, LogOut, Phone, Plus, UserCog, Users } from "lucide-react";
import type { ResidentListItem } from "@/types";
import { MButton, MEmpty, MField, MGroup, MHero, MNotice, MPill, MQuick, MRow, MSearch, MSegment, MSheet, MSkeletonRows, MStack, initials } from "@/components/app/m";

type Status = "ALL" | "ACTIVE" | "CHECKED_OUT" | "UNASSIGNED";

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
}: {
  residents: ResidentListItem[];
  allCount: number;
  loading: boolean;
  stats: { total: number; active: number; checkedOutCount: number; unassignedCount: number };
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
}) {
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
          { label: "Rooms", icon: DoorOpen, href: "/rooms", tone: "neutral" },
        ]}
      />
      {approvals}
      {success && <MNotice>{success}</MNotice>}
      {error && <MNotice tone="red">{error}</MNotice>}

      <MHero
        label="In house"
        value={loading ? "—" : stats.active}
        items={[
          { label: "Registered", value: stats.total, onClick: () => setStatus("ALL") },
          { label: "Checked out", value: stats.checkedOutCount, onClick: () => setStatus("CHECKED_OUT") },
          { label: "No room yet", value: stats.unassignedCount, onClick: () => setStatus("UNASSIGNED") },
        ]}
      />

      <MSegment
        label="Show"
        value={status}
        onChange={setStatus}
        options={[
          { value: "ACTIVE", label: "In house" },
          { value: "CHECKED_OUT", label: "Left" },
          { value: "UNASSIGNED", label: "No room" },
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
                tone={here ? "accent" : left ? "neutral" : "amber"}
                title={r.fullName}
                sub={here ? [`Room ${r.currentRoomNumber}`, r.checkInDate ? `since ${r.checkInDate}` : ""].filter(Boolean).join(" · ") : r.phone}
                rightSub={here ? undefined : left ? "Left" : "No room"}
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
                <MPill tone={inHouse(open) ? "green" : (open.totalStayCount ?? 0) > 0 ? "neutral" : "amber"}>{inHouse(open) ? "In house" : (open.totalStayCount ?? 0) > 0 ? "Checked out" : "No room yet"}</MPill>
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
