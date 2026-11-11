"use client";

/**
 * Rooms on the phone app: occupancy at a glance, a compact list of rooms (free beds on the right) and
 * one sheet per room with its beds, people and actions. Built on the app kit.
 */

import React, { useState } from "react";
import { BedDouble, DoorOpen, Edit3, LogOut, Plus, Trash2, UserCog, UserPlus, Wrench } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { MButton, MChips, MEmpty, MField, MGroup, MHero, MNotice, MRow, MSearch, MSection, MSegment, MSheet, MSkeletonRows, MStack, initials } from "@/components/app/m";

interface Occupant {
  stayId: string;
  fullName: string;
  phone: string;
}
interface Bed {
  id: string;
  label: string;
  status: string;
  occupant?: { fullName: string } | null;
}
export interface MobileRoom {
  id: string;
  roomNumber: string;
  floor: number;
  type: string;
  capacity: number;
  occupiedBeds: number;
  availableBeds: number;
  baseRentMonthly: number;
  maintenance?: unknown;
  beds?: Bed[];
  occupants?: Occupant[];
}

export function RoomsMobile<R extends MobileRoom>({
  rooms,
  allCount,
  loading,
  stats,
  search,
  setSearch,
  floor,
  setFloor,
  floors,
  status,
  setStatus,
  floorLabel,
  typeLabel,
  success,
  error,
  onAdd,
  onEditRoom,
  onDeleteRoom,
  onBeds,
  onAddTenant,
  onEditResident,
  onCheckOut,
}: {
  rooms: R[];
  allCount: number;
  loading: boolean;
  stats: { occupancyRate: number; occupiedBeds: number; totalCapacity: number; availableBeds: number; totalRooms: number };
  search: string;
  setSearch: (v: string) => void;
  floor: string;
  setFloor: (v: string) => void;
  floors: number[];
  status: "ALL" | "VACANT" | "OCCUPIED";
  setStatus: (v: "ALL" | "VACANT" | "OCCUPIED") => void;
  floorLabel: (f: number | null) => string;
  typeLabel: (t: string) => string;
  success: string | null;
  error: string | null;
  onAdd: () => void;
  onEditRoom: (r: R) => void;
  onDeleteRoom: (r: R) => void;
  onBeds: (id: string) => void;
  onAddTenant: (r: R) => void;
  onEditResident: (o: Occupant, r: R) => void;
  onCheckOut: (o: Occupant, r: R) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? rooms.find((r) => r.id === openId) ?? null : null;
  const act = (fn: () => void) => {
    setOpenId(null);
    fn();
  };

  return (
    <MStack>
      {success && <MNotice>{success}</MNotice>}
      {error && <MNotice tone="red">{error}</MNotice>}
      <MHero
        label="Beds filled"
        value={loading ? "—" : `${stats.occupancyRate}%`}
        note={`${stats.occupiedBeds}/${stats.totalCapacity} beds · ${stats.totalRooms} rooms`}
        action={
          <button type="button" onClick={onAdd} className="m-hero-btn m-press">
            <Plus className="w-4 h-4" /> Room
          </button>
        }
        items={[
          { label: "Free beds", value: stats.availableBeds, onClick: () => setStatus("VACANT") },
          { label: "Occupied beds", value: stats.occupiedBeds, onClick: () => setStatus("OCCUPIED") },
        ]}
      />
      <MSegment
        label="Rooms"
        value={status}
        onChange={setStatus}
        options={[
          { value: "ALL", label: "All" },
          { value: "VACANT", label: "Free beds" },
          { value: "OCCUPIED", label: "Occupied" },
        ]}
      />
      {floors.length > 1 && (
        <MChips
          label="Floor"
          value={floor}
          onChange={setFloor}
          options={[{ value: "ALL", label: "All floors" }, ...floors.map((f) => ({ value: String(f), label: floorLabel(f) }))]}
        />
      )}
      <MSearch value={search} onChange={setSearch} placeholder="Search room or resident" />

      {loading ? (
        <MSkeletonRows rows={6} />
      ) : rooms.length === 0 ? (
        <MEmpty icon={DoorOpen} title={allCount === 0 ? "No rooms yet" : "No rooms match"}>
          {allCount === 0 && (
            <MButton kind="primary" icon={Plus} onClick={onAdd}>
              Add room
            </MButton>
          )}
        </MEmpty>
      ) : (
        <MGroup>
          {rooms.map((r) => (
            <MRow
              key={r.id}
              avatar={r.roomNumber.length <= 4 ? r.roomNumber : initials(r.roomNumber)}
              tone={r.maintenance ? "amber" : r.availableBeds === 0 ? "accent" : r.occupiedBeds === 0 ? "green" : "blue"}
              title={`Room ${r.roomNumber}`}
              sub={[floorLabel(r.floor), typeLabel(r.type), r.occupants && r.occupants.length ? r.occupants.map((o) => o.fullName.split(" ")[0]).join(", ") : ""].filter(Boolean).join(" · ")}
              right={`${r.occupiedBeds}/${r.capacity}`}
              rightSub={r.maintenance ? "Repairs" : r.availableBeds === 0 ? "Full" : `${r.availableBeds} free`}
              onClick={() => setOpenId(r.id)}
            />
          ))}
        </MGroup>
      )}

      <MSheet
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        title={open ? `Room ${open.roomNumber}` : ""}
        tall
        footer={
          open && open.availableBeds > 0 ? (
            <MButton kind="primary" icon={UserPlus} onClick={() => act(() => onAddTenant(open))}>
              Add a resident
            </MButton>
          ) : null
        }
      >
        {open && (
          <>
            <div className="m-card py-1">
              <MField label="Floor">{floorLabel(open.floor)}</MField>
              <MField label="Kind">{typeLabel(open.type)}</MField>
              <MField label="Beds">{`${open.occupiedBeds}/${open.capacity} filled`}</MField>
              <MField label="Rent">{`${formatMoney(open.baseRentMonthly)} a bed`}</MField>
              {Boolean(open.maintenance) && <MField label="Repairs" tone="amber">Under maintenance</MField>}
            </div>
            {open.beds && open.beds.length > 0 && (
              <MSection title="Beds">
                <div className="m-card">
                  <div className="flex flex-wrap gap-1.5">
                    {open.beds.map((bed) => {
                      const state = bed.occupant ? "occupied" : bed.status === "OUT_OF_SERVICE" ? "off" : open.maintenance ? "maintenance" : "free";
                      return (
                        <span
                          key={bed.id}
                          className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12.5px] font-medium ${
                            state === "occupied" ? "bg-[var(--rn-accent)] text-white" : state === "off" ? "bg-black/[0.06] text-[var(--m-ink-3)] line-through" : state === "maintenance" ? "bg-[#FBF0D5] text-[#885807]" : "bg-[#E6F2E2] text-[#2D6A24]"
                          }`}
                        >
                          <BedDouble className="w-3.5 h-3.5" />
                          {bed.label.replace(/^Bed\s*/i, "")}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </MSection>
            )}
            <MSection title="People">
              {open.occupants && open.occupants.length > 0 ? (
                <MGroup>
                  {open.occupants.map((o) => (
                    <MRow key={o.stayId} avatar={initials(o.fullName)} tone="accent" title={o.fullName} sub={o.phone} chevron={false}>
                      <MButton kind="soft" icon={UserCog} className="m-btn-sm" onClick={() => act(() => onEditResident(o, open))}>
                        Edit
                      </MButton>
                      <MButton kind="danger" icon={LogOut} className="m-btn-sm" onClick={() => act(() => onCheckOut(o, open))}>
                        Check out
                      </MButton>
                    </MRow>
                  ))}
                </MGroup>
              ) : (
                <MEmpty title="No one in this room" />
              )}
            </MSection>
            <MGroup>
              {(open.beds?.length ?? 0) > 0 && <MRow icon={Wrench} tone="amber" title="Beds and repairs" onClick={() => act(() => onBeds(open.id))} />}
              <MRow icon={Edit3} tone="neutral" title="Edit room" onClick={() => act(() => onEditRoom(open))} />
              <MRow icon={Trash2} tone="red" title="Delete room" onClick={() => act(() => onDeleteRoom(open))} />
            </MGroup>
          </>
        )}
      </MSheet>
    </MStack>
  );
}
