import crypto from "crypto";
import { getDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEvent } from "../audit/audit";
import {
  AuthenticatedUser,
  RoomType,
  RoomWithOccupancy,
  RoomOccupant,
} from "@/types";

export interface CreateRoomInput {
  roomNumber: string;
  floor: number;
  type: RoomType;
  capacity: number;
  baseRentMonthly: number;
}

export interface UpdateRoomInput {
  roomNumber?: string;
  floor?: number;
  type?: RoomType;
  capacity?: number;
  baseRentMonthly?: number;
}

const VALID_ROOM_TYPES: readonly RoomType[] = [
  "SINGLE",
  "DOUBLE_SHARING",
  "TRIPLE_SHARING",
  "EXECUTIVE_SUITE",
] as const;

export function isValidRoomType(type: string): type is RoomType {
  return VALID_ROOM_TYPES.includes(type as RoomType);
}

/**
 * Lists rooms with server-calculated occupancy.
 * Requires rooms.read permission.
 */
export function listRooms(
  actor: AuthenticatedUser,
  options?: {
    floor?: number;
    status?: "VACANT" | "OCCUPIED" | "ALL";
    search?: string;
  }
): RoomWithOccupancy[] {
  requirePermission(actor, "rooms.read");
  const db = getDb();

  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.floor !== undefined && !isNaN(options.floor)) {
    conditions.push("r.floor = ?");
    params.push(options.floor);
  }

  if (options?.search) {
    conditions.push("LOWER(r.room_number) LIKE ?");
    params.push(`%${options.search.trim().toLowerCase()}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT 
      r.id, r.room_number as roomNumber, r.floor, r.type, r.capacity,
      r.base_rent_monthly as baseRentMonthly, r.is_active as isActive,
      r.created_at as createdAt, r.updated_at as updatedAt,
      (SELECT COUNT(*) FROM resident_stays s WHERE s.room_id = r.id AND s.status = 'ACTIVE') as occupiedBeds
    FROM rooms r
    ${whereClause}
    ORDER BY r.floor ASC, r.room_number ASC
  `;

  const rows = db.prepare(query).all(...params) as any[];

  // Attach occupants for each room
  const occupantsStmt = db.prepare(`
    SELECT 
      res.id as residentId, s.id as stayId, res.full_name as fullName,
      res.phone, s.check_in_date as checkInDate
    FROM resident_stays s
    JOIN residents res ON s.resident_id = res.id
    WHERE s.room_id = ? AND s.status = 'ACTIVE'
    ORDER BY s.check_in_date ASC
  `);

  const results: RoomWithOccupancy[] = rows.map((r) => {
    const occupied = Number(r.occupiedBeds || 0);
    const capacity = Number(r.capacity);
    const occupants = occupantsStmt.all(r.id) as RoomOccupant[];

    return {
      id: r.id,
      roomNumber: r.roomNumber,
      floor: Number(r.floor),
      type: r.type as RoomType,
      capacity,
      occupiedBeds: occupied,
      availableBeds: Math.max(0, capacity - occupied),
      baseRentMonthly: Number(r.baseRentMonthly),
      isActive: Boolean(r.isActive),
      occupants,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });

  if (options?.status === "VACANT") {
    return results.filter((r) => r.isActive && r.availableBeds > 0);
  }
  if (options?.status === "OCCUPIED") {
    return results.filter((r) => r.isActive && r.occupiedBeds > 0);
  }

  return results;
}

/**
 * Retrieves a single room by ID with occupants.
 */
export function getRoomById(
  actor: AuthenticatedUser,
  roomId: string
): RoomWithOccupancy | null {
  requirePermission(actor, "rooms.read");
  const db = getDb();

  const row = db.prepare(`
    SELECT 
      r.id, r.room_number as roomNumber, r.floor, r.type, r.capacity,
      r.base_rent_monthly as baseRentMonthly, r.is_active as isActive,
      r.created_at as createdAt, r.updated_at as updatedAt,
      (SELECT COUNT(*) FROM resident_stays s WHERE s.room_id = r.id AND s.status = 'ACTIVE') as occupiedBeds
    FROM rooms r
    WHERE r.id = ?
  `).get(roomId) as any;

  if (!row) return null;

  const occupants = db.prepare(`
    SELECT 
      res.id as residentId, s.id as stayId, res.full_name as fullName,
      res.phone, s.check_in_date as checkInDate
    FROM resident_stays s
    JOIN residents res ON s.resident_id = res.id
    WHERE s.room_id = ? AND s.status = 'ACTIVE'
    ORDER BY s.check_in_date ASC
  `).all(roomId) as RoomOccupant[];

  const occupied = Number(row.occupiedBeds || 0);
  const capacity = Number(row.capacity);

  return {
    id: row.id,
    roomNumber: row.roomNumber,
    floor: Number(row.floor),
    type: row.type as RoomType,
    capacity,
    occupiedBeds: occupied,
    availableBeds: Math.max(0, capacity - occupied),
    baseRentMonthly: Number(row.baseRentMonthly),
    isActive: Boolean(row.isActive),
    occupants,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Provisions a new room.
 * Requires rooms.manage permission.
 */
export function createRoom(
  actor: AuthenticatedUser,
  input: CreateRoomInput,
  clientIp?: string
): RoomWithOccupancy {
  requirePermission(actor, "rooms.manage", { ip: clientIp, action: "room.create" });

  const cleanRoomNumber = input.roomNumber?.trim().toUpperCase();
  const floor = Number(input.floor);
  const type = input.type;
  const capacity = Number(input.capacity);
  const baseRentMonthly = Number(input.baseRentMonthly);

  // Invariant validation
  if (!cleanRoomNumber || cleanRoomNumber.length < 1 || cleanRoomNumber.length > 20) {
    throw new Error("Room number must be between 1 and 20 characters.");
  }
  if (isNaN(floor) || floor < 0 || floor > 30) {
    throw new Error("Floor must be an integer between 0 (Ground) and 30.");
  }
  if (!isValidRoomType(type)) {
    throw new Error(`Invalid room type '${type}'. Must be SINGLE, DOUBLE_SHARING, TRIPLE_SHARING, or EXECUTIVE_SUITE.`);
  }
  if (isNaN(capacity) || capacity <= 0 || capacity > 10) {
    throw new Error("Room bed capacity must be a positive integer between 1 and 10.");
  }
  if (isNaN(baseRentMonthly) || baseRentMonthly < 0) {
    throw new Error("Monthly base rent cannot be negative.");
  }

  const db = getDb();

  // Check unique room number
  const existing = db.prepare("SELECT id FROM rooms WHERE UPPER(room_number) = ?").get(cleanRoomNumber);
  if (existing) {
    throw new Error("Room number already exists.");
  }

  const id = `room_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(id, cleanRoomNumber, floor, type, capacity, baseRentMonthly, now, now);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "room.created",
      targetType: "room",
      targetId: id,
      metadata: {
        roomNumber: cleanRoomNumber,
        floor,
        type,
        capacity,
        baseRentMonthly,
      },
      ipAddress: clientIp,
    });
  });

  tx();

  return {
    id,
    roomNumber: cleanRoomNumber,
    floor,
    type,
    capacity,
    occupiedBeds: 0,
    availableBeds: capacity,
    baseRentMonthly,
    isActive: true,
    occupants: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Updates room details, rent, or capacity.
 * Enforces that capacity cannot be reduced below current active occupancy.
 */
export function updateRoom(
  actor: AuthenticatedUser,
  roomId: string,
  input: UpdateRoomInput,
  clientIp?: string
): RoomWithOccupancy {
  requirePermission(actor, "rooms.manage", { ip: clientIp, targetId: roomId, action: "room.update" });

  const db = getDb();
  const current = getRoomById(actor, roomId);
  if (!current) {
    throw new Error(`Room '${roomId}' not found.`);
  }

  const updates: string[] = [];
  const params: any[] = [];
  const auditMeta: Record<string, any> = {};

  if (input.roomNumber !== undefined) {
    const cleanRoomNumber = input.roomNumber.trim().toUpperCase();
    if (!cleanRoomNumber || cleanRoomNumber.length < 1 || cleanRoomNumber.length > 20) {
      throw new Error("Room number must be between 1 and 20 characters.");
    }
    if (cleanRoomNumber !== current.roomNumber.toUpperCase()) {
      const existing = db.prepare("SELECT id FROM rooms WHERE UPPER(room_number) = ? AND id != ?").get(cleanRoomNumber, roomId);
      if (existing) {
        throw new Error("Room number already exists.");
      }
      updates.push("room_number = ?");
      params.push(cleanRoomNumber);
      auditMeta.roomNumber = { from: current.roomNumber, to: cleanRoomNumber };
    }
  }

  if (input.floor !== undefined) {
    const floor = Number(input.floor);
    if (isNaN(floor) || floor < 0 || floor > 30) {
      throw new Error("Floor must be an integer between 0 and 30.");
    }
    updates.push("floor = ?");
    params.push(floor);
    auditMeta.floor = { from: current.floor, to: floor };
  }

  if (input.type !== undefined) {
    if (!isValidRoomType(input.type)) {
      throw new Error("Invalid room type.");
    }
    updates.push("type = ?");
    params.push(input.type);
    auditMeta.type = { from: current.type, to: input.type };
  }

  if (input.capacity !== undefined) {
    const capacity = Number(input.capacity);
    if (isNaN(capacity) || capacity <= 0 || capacity > 10) {
      throw new Error("Capacity must be an integer between 1 and 10.");
    }
    // Prevent reducing capacity below current occupancy
    if (capacity < current.occupiedBeds) {
      throw new Error(
        `Cannot reduce room capacity to ${capacity} beds because ${current.occupiedBeds} beds are currently occupied by active residents. Check out or reassign residents before reducing capacity.`
      );
    }
    updates.push("capacity = ?");
    params.push(capacity);
    auditMeta.capacity = { from: current.capacity, to: capacity };
  }

  if (input.baseRentMonthly !== undefined) {
    const rent = Number(input.baseRentMonthly);
    if (isNaN(rent) || rent < 0) {
      throw new Error("Monthly base rent cannot be negative.");
    }
    updates.push("base_rent_monthly = ?");
    params.push(rent);
    auditMeta.baseRentMonthly = { from: current.baseRentMonthly, to: rent };
  }

  if (updates.length === 0) {
    return current;
  }

  const now = new Date().toISOString();
  updates.push("updated_at = ?");
  params.push(now, roomId);

  const tx = db.transaction(() => {
    db.prepare(`UPDATE rooms SET ${updates.join(", ")} WHERE id = ?`).run(...params);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "room.updated",
      targetType: "room",
      targetId: roomId,
      metadata: auditMeta,
      ipAddress: clientIp,
    });
  });

  tx();

  return getRoomById(actor, roomId)!;
}

/**
 * Activates or deactivates a room.
 * Invariant: Cannot deactivate a room with active residents.
 */
export function setRoomActiveStatus(
  actor: AuthenticatedUser,
  roomId: string,
  isActive: boolean,
  clientIp?: string
): void {
  requirePermission(actor, "rooms.manage", { ip: clientIp, targetId: roomId, action: "room.status" });

  const db = getDb();
  const current = getRoomById(actor, roomId);
  if (!current) {
    throw new Error(`Room '${roomId}' not found.`);
  }

  if (current.isActive === isActive) {
    return;
  }

  if (!isActive && current.occupiedBeds > 0) {
    throw new Error(
      `Cannot deactivate Room ${current.roomNumber} while ${current.occupiedBeds} resident(s) are actively occupying beds.`
    );
  }

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare("UPDATE rooms SET is_active = ?, updated_at = ? WHERE id = ?").run(
      isActive ? 1 : 0,
      now,
      roomId
    );

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: isActive ? "room.activated" : "room.deactivated",
      targetType: "room",
      targetId: roomId,
      metadata: {
        roomNumber: current.roomNumber,
        previousStatus: current.isActive,
        newStatus: isActive,
      },
      ipAddress: clientIp,
    });
  });

  tx();
}

/**
 * Permanently deletes a room if and only if it has zero active occupants and zero historical stay records.
 * If active occupants exist or historical records exist, deletion is safely blocked.
 */
export function deleteRoom(
  actor: AuthenticatedUser,
  roomId: string,
  clientIp?: string
): void {
  requirePermission(actor, "rooms.manage", { ip: clientIp, targetId: roomId, action: "room.delete" });

  const db = getDb();
  const current = getRoomById(actor, roomId);
  if (!current) {
    throw new Error(`Room '${roomId}' not found.`);
  }

  if (current.occupiedBeds > 0) {
    throw new Error(
      `Cannot delete Room ${current.roomNumber} because it currently has ${current.occupiedBeds} active occupant(s). Check out all residents before deleting.`
    );
  }

  // Check historical stays
  const stayHistory = db.prepare("SELECT COUNT(*) as count FROM resident_stays WHERE room_id = ?").get(roomId) as { count: number };
  if (stayHistory.count > 0) {
    throw new Error(
      `Cannot delete Room ${current.roomNumber} because it has historical stay and billing records. To preserve audit and financial integrity, deactivate the room instead.`
    );
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);

    recordAuditEvent({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "room.deleted",
      targetType: "room",
      targetId: roomId,
      metadata: {
        roomNumber: current.roomNumber,
        floor: current.floor,
        type: current.type,
        capacity: current.capacity,
        baseRentMonthly: current.baseRentMonthly,
      },
      ipAddress: clientIp,
    });
  });

  tx();
}

