import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { AuthenticatedUser, RoomBed, RoomMaintenanceRecord } from "@/types";
import { businessToday } from "@/lib/businessDate";

/**
 * Beds and room maintenance (migration 0017). Until the migration is installed every caller gets
 * the previous behaviour (capacity as a count, no maintenance state); the SQLite test double never
 * has these tables.
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
let bedsPresent = false;
let bedsCheckedAt = 0;

export async function hasBedsSchema(db: AsyncDb): Promise<boolean> {
  if (bedsPresent) return true;
  if (Date.now() - bedsCheckedAt < 60_000) return false;
  const row = db.isPostgres
    ? await db.queryOne<{ t: string | null }>("SELECT to_regclass('public.room_beds')::text AS t")
    : await db.queryOne<{ t: string | null }>("SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name = 'room_beds'");
  bedsPresent = Boolean(row?.t);
  bedsCheckedAt = Date.now();
  return bedsPresent;
}

async function requireBedsSchema(db: AsyncDb): Promise<void> {
  if (!(await hasBedsSchema(db))) {
    const err: any = new Error("Beds and maintenance need the latest database update, which is not installed yet.");
    err.statusCode = 409;
    throw err;
  }
}

function mapMaintenance(r: any): RoomMaintenanceRecord {
  return {
    id: r.id,
    roomId: r.room_id,
    reason: r.reason,
    startDate: r.start_date,
    endDate: r.end_date || null,
    status: r.status,
    completionNote: r.completion_note || null,
    startedByName: r.started_by_name || null,
    completedByName: r.completed_by_name || null,
    createdAt: r.created_at,
  };
}

/** Beds (with whoever is in them) and the open maintenance record, for the given rooms. */
export async function loadBedState(
  db: AsyncDb,
  roomIds?: string[]
): Promise<Map<string, { beds: RoomBed[]; maintenance: RoomMaintenanceRecord | null }>> {
  const out = new Map<string, { beds: RoomBed[]; maintenance: RoomMaintenanceRecord | null }>();
  if (!(await hasBedsSchema(db))) return out;
  const filter = roomIds && roomIds.length > 0 ? `WHERE b.room_id IN (${roomIds.map(() => "?").join(", ")})` : "";
  const beds = await db.query<any>(
    `SELECT b.id, b.room_id, b.label, b.status, b.notes,
            s.id AS stay_id, res.id AS resident_id, res.full_name AS resident_name
     FROM room_beds b
     LEFT JOIN resident_stays s ON s.bed_id = b.id AND s.status = 'ACTIVE'
     LEFT JOIN residents res ON res.id = s.resident_id
     ${filter}
     ORDER BY b.room_id, length(b.label), b.label`,
    roomIds ?? []
  );
  const mFilter = roomIds && roomIds.length > 0 ? `AND m.room_id IN (${roomIds.map(() => "?").join(", ")})` : "";
  const open = await db.query<any>(
    `SELECT m.*, su.full_name AS started_by_name FROM room_maintenance m
     LEFT JOIN staff_users su ON su.id = m.started_by
     WHERE m.status = 'OPEN' ${mFilter}`,
    roomIds ?? []
  );
  for (const b of beds) {
    const entry = out.get(b.room_id) ?? { beds: [], maintenance: null };
    entry.beds.push({
      id: b.id,
      roomId: b.room_id,
      label: b.label,
      status: b.status,
      notes: b.notes || null,
      occupant: b.stay_id ? { stayId: b.stay_id, residentId: b.resident_id, fullName: b.resident_name } : null,
    });
    out.set(b.room_id, entry);
  }
  for (const m of open) {
    const entry = out.get(m.room_id) ?? { beds: [], maintenance: null };
    entry.maintenance = mapMaintenance(m);
    out.set(m.room_id, entry);
  }
  return out;
}

/**
 * Checks, inside the caller's transaction (room row already locked), that a resident may move
 * into the room, and returns the bed to record. Rules: no open maintenance; the bed (when one is
 * chosen) belongs to the room, is in service and free; without a chosen bed there must be more
 * in-service beds than residents already living there.
 */
export async function claimBedForStay(
  tx: AsyncDb,
  room: { id: string; roomNumber: string },
  bedId: string | null | undefined,
  activeStaysInRoom: number
): Promise<string | null> {
  if (!(await hasBedsSchema(tx))) return null;
  const maintenance = await tx.queryOne<any>("SELECT reason FROM room_maintenance WHERE room_id = ? AND status = 'OPEN'", [room.id]);
  if (maintenance) {
    throw new Error(`Room ${room.roomNumber} is under maintenance (${maintenance.reason}) and cannot take a new resident until the work is marked complete.`);
  }
  const inService = await tx.queryOne<{ n: number | string }>("SELECT COUNT(*) AS n FROM room_beds WHERE room_id = ? AND status = 'IN_SERVICE'", [room.id]);
  const inServiceBeds = Number(inService?.n || 0);
  if (bedId) {
    const bed = await tx.queryOne<any>(
      `SELECT b.id, b.label, b.status, b.room_id,
              (SELECT COUNT(*) FROM resident_stays s WHERE s.bed_id = b.id AND s.status = 'ACTIVE') AS taken
       FROM room_beds b WHERE b.id = ?${tx.isPostgres ? " FOR UPDATE OF b" : ""}`,
      [bedId]
    );
    if (!bed || bed.room_id !== room.id) throw new Error(`That bed is not in Room ${room.roomNumber}.`);
    if (bed.status !== "IN_SERVICE") throw new Error(`${bed.label} in Room ${room.roomNumber} is out of service.`);
    if (Number(bed.taken) > 0) throw new Error(`${bed.label} in Room ${room.roomNumber} is already taken.`);
    return bed.id;
  }
  if (activeStaysInRoom >= inServiceBeds) {
    throw new Error(`Room ${room.roomNumber} has no free bed in service (${activeStaysInRoom} of ${inServiceBeds} in-service beds taken).`);
  }
  return null;
}

/** Keeps rooms.capacity equal to the room's number of beds (the bed rows are the source of truth). */
async function syncCapacity(tx: AsyncDb, roomId: string, at: string): Promise<number> {
  const row = await tx.queryOne<{ n: number | string }>("SELECT COUNT(*) AS n FROM room_beds WHERE room_id = ?", [roomId]);
  const n = Number(row?.n || 0);
  if (n > 0) await tx.execute("UPDATE rooms SET capacity = ?, updated_at = ? WHERE id = ?", [n, at, roomId]);
  return n;
}

/**
 * Makes a room's bed rows match a capacity entered on the room form: adds "Bed N" rows, or removes
 * trailing beds that are free and were never used. Refuses to drop below the beds in use.
 */
export async function resizeRoomBeds(tx: AsyncDb, roomId: string, capacity: number, at: string): Promise<void> {
  if (!(await hasBedsSchema(tx))) return;
  const beds = await tx.query<any>(
    `SELECT b.id, b.label,
            (SELECT COUNT(*) FROM resident_stays s WHERE s.bed_id = b.id) AS used,
            (SELECT COUNT(*) FROM resident_stays s WHERE s.bed_id = b.id AND s.status = 'ACTIVE') AS taken
     FROM room_beds b WHERE b.room_id = ? ORDER BY length(b.label), b.label`,
    [roomId]
  );
  if (beds.length < capacity) {
    const labels = new Set(beds.map((b) => String(b.label).toLowerCase()));
    let n = 1;
    for (let added = beds.length; added < capacity; n++) {
      const label = `Bed ${n}`;
      if (labels.has(label.toLowerCase())) continue;
      await tx.execute(
        "INSERT INTO room_beds (id, room_id, label, status, created_at, updated_at) VALUES (?, ?, ?, 'IN_SERVICE', ?, ?)",
        [`bed_${crypto.randomUUID()}`, roomId, label, at, at]
      );
      added++;
    }
  } else if (beds.length > capacity) {
    const removable = beds.filter((b) => Number(b.used) === 0).reverse();
    const toRemove = beds.length - capacity;
    if (removable.length < toRemove) {
      throw new Error(`This room has ${beds.length - removable.length} bed(s) in use or with history; capacity cannot go below that. Take beds out of service instead.`);
    }
    for (const b of removable.slice(0, toRemove)) await tx.execute("DELETE FROM room_beds WHERE id = ?", [b.id]);
  }
  await syncCapacity(tx, roomId, at);
}

// ---------------------------------------------------------------------------
// Bed management
// ---------------------------------------------------------------------------

export async function addBed(actor: AuthenticatedUser, roomId: string, label: string, clientIp?: string, asyncDb?: AsyncDb): Promise<RoomBed> {
  requirePermission(actor, "rooms.manage", { ip: clientIp, targetId: roomId, action: "rooms.bed_added" });
  const db = asyncDb ?? getAsyncDb();
  await requireBedsSchema(db);
  const name = label?.trim();
  if (!name || name.length > 30) throw new Error("Bed name is required (at most 30 characters).");
  const at = new Date().toISOString();
  const id = `bed_${crypto.randomUUID()}`;
  await db.transaction(async (tx) => {
    const room = await tx.queryOne<any>(`SELECT id, room_number FROM rooms WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [roomId]);
    if (!room) throw new Error("Room not found.");
    const dup = await tx.queryOne("SELECT id FROM room_beds WHERE room_id = ? AND lower(label) = lower(?)", [roomId, name]);
    if (dup) throw new Error(`Room ${room.room_number} already has a bed called "${name}".`);
    await tx.execute("INSERT INTO room_beds (id, room_id, label, status, created_at, updated_at) VALUES (?, ?, ?, 'IN_SERVICE', ?, ?)", [id, roomId, name, at, at]);
    const capacity = await syncCapacity(tx, roomId, at);
    await recordAuditEventAsync({ actorId: actor.id, actorUsername: actor.username, action: "rooms.bed_added", targetType: "room", targetId: roomId, metadata: { bedId: id, label: name, capacity }, ipAddress: clientIp }, tx);
  });
  return (await loadBedState(db, [roomId])).get(roomId)!.beds.find((b) => b.id === id)!;
}

/** Rename a bed, take it out of service (only when free) or back into service. */
export async function updateBed(
  actor: AuthenticatedUser,
  bedId: string,
  input: { label?: string; status?: "IN_SERVICE" | "OUT_OF_SERVICE"; notes?: string | null },
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<RoomBed> {
  requirePermission(actor, "rooms.manage", { ip: clientIp, targetId: bedId, action: "rooms.bed_updated" });
  const db = asyncDb ?? getAsyncDb();
  await requireBedsSchema(db);
  const at = new Date().toISOString();
  let roomId = "";
  await db.transaction(async (tx) => {
    const bed = await tx.queryOne<any>(`SELECT * FROM room_beds WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [bedId]);
    if (!bed) throw new Error("Bed not found.");
    roomId = bed.room_id;
    const label = input.label !== undefined ? input.label.trim() : bed.label;
    if (!label || label.length > 30) throw new Error("Bed name is required (at most 30 characters).");
    if (label.toLowerCase() !== String(bed.label).toLowerCase()) {
      const dup = await tx.queryOne("SELECT id FROM room_beds WHERE room_id = ? AND lower(label) = lower(?) AND id <> ?", [bed.room_id, label, bedId]);
      if (dup) throw new Error(`This room already has a bed called "${label}".`);
    }
    const status = input.status ?? bed.status;
    if (status !== "IN_SERVICE" && status !== "OUT_OF_SERVICE") throw new Error("Bed status must be in service or out of service.");
    if (status === "OUT_OF_SERVICE" && bed.status !== "OUT_OF_SERVICE") {
      const taken = await tx.queryOne<any>("SELECT res.full_name FROM resident_stays s JOIN residents res ON res.id = s.resident_id WHERE s.bed_id = ? AND s.status = 'ACTIVE'", [bedId]);
      if (taken) throw new Error(`${taken.full_name} is in this bed. Move them first, then take the bed out of service.`);
    }
    const notes = input.notes !== undefined ? input.notes?.trim() || null : bed.notes;
    await tx.execute("UPDATE room_beds SET label = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?", [label, status, notes, at, bedId]);
    await recordAuditEventAsync({
      actorId: actor.id, actorUsername: actor.username, action: "rooms.bed_updated", targetType: "room", targetId: bed.room_id,
      metadata: { bedId, from: { label: bed.label, status: bed.status }, to: { label, status }, notes }, ipAddress: clientIp,
    }, tx);
  });
  return (await loadBedState(db, [roomId])).get(roomId)!.beds.find((b) => b.id === bedId)!;
}

/** Removes a bed that was never used (beds with history are taken out of service instead). */
export async function removeBed(actor: AuthenticatedUser, bedId: string, clientIp?: string, asyncDb?: AsyncDb): Promise<void> {
  requirePermission(actor, "rooms.manage", { ip: clientIp, targetId: bedId, action: "rooms.bed_removed" });
  const db = asyncDb ?? getAsyncDb();
  await requireBedsSchema(db);
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    const bed = await tx.queryOne<any>(`SELECT * FROM room_beds WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [bedId]);
    if (!bed) throw new Error("Bed not found.");
    const used = await tx.queryOne<{ n: number | string }>("SELECT COUNT(*) AS n FROM resident_stays WHERE bed_id = ?", [bedId]);
    if (Number(used?.n || 0) > 0) throw new Error("This bed has stay history and cannot be removed. Take it out of service instead.");
    const count = await tx.queryOne<{ n: number | string }>("SELECT COUNT(*) AS n FROM room_beds WHERE room_id = ?", [bed.room_id]);
    if (Number(count?.n || 0) <= 1) throw new Error("A room needs at least one bed.");
    await tx.execute("DELETE FROM room_beds WHERE id = ?", [bedId]);
    const capacity = await syncCapacity(tx, bed.room_id, at);
    await recordAuditEventAsync({ actorId: actor.id, actorUsername: actor.username, action: "rooms.bed_removed", targetType: "room", targetId: bed.room_id, metadata: { bedId, label: bed.label, capacity }, ipAddress: clientIp }, tx);
  });
}

/**
 * Puts a resident who already lives in the room into a particular bed (for residents checked in
 * before beds existed, or a move to another bed in the same room).
 */
export async function placeResidentInBed(actor: AuthenticatedUser, stayId: string, bedId: string, clientIp?: string, asyncDb?: AsyncDb): Promise<void> {
  requirePermission(actor, "residents.manage", { ip: clientIp, targetId: stayId, action: "resident.bed_placed" });
  const db = asyncDb ?? getAsyncDb();
  await requireBedsSchema(db);
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    const stay = await tx.queryOne<any>(`SELECT s.*, r.room_number FROM resident_stays s JOIN rooms r ON r.id = s.room_id WHERE s.id = ?${tx.isPostgres ? " FOR UPDATE OF s" : ""}`, [stayId]);
    if (!stay || stay.status !== "ACTIVE") throw new Error("Only a current stay can be given a bed.");
    if (stay.bed_id === bedId) return;
    const bed = await tx.queryOne<any>(
      `SELECT b.*, (SELECT COUNT(*) FROM resident_stays s WHERE s.bed_id = b.id AND s.status = 'ACTIVE') AS taken FROM room_beds b WHERE b.id = ?${tx.isPostgres ? " FOR UPDATE OF b" : ""}`,
      [bedId]
    );
    if (!bed || bed.room_id !== stay.room_id) throw new Error(`That bed is not in Room ${stay.room_number}. Use Transfer to move to another room.`);
    if (bed.status !== "IN_SERVICE") throw new Error(`${bed.label} is out of service.`);
    if (Number(bed.taken) > 0) throw new Error(`${bed.label} is already taken.`);
    await tx.execute("UPDATE resident_stays SET bed_id = ?, updated_at = ? WHERE id = ?", [bedId, at, stayId]);
    await recordAuditEventAsync({
      actorId: actor.id, actorUsername: actor.username, action: "resident.bed_placed", targetType: "resident", targetId: stay.resident_id,
      metadata: { stayId, roomId: stay.room_id, fromBedId: stay.bed_id || null, toBedId: bedId, bedLabel: bed.label }, ipAddress: clientIp,
    }, tx);
  });
}

// ---------------------------------------------------------------------------
// Room maintenance
// ---------------------------------------------------------------------------

/**
 * Marks a room as under maintenance. Residents already in the room stay (their stay is not
 * changed); the room just takes no new check-ins or transfers until the work is complete.
 */
export async function startRoomMaintenance(
  actor: AuthenticatedUser,
  roomId: string,
  input: { reason: string; startDate?: string },
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<RoomMaintenanceRecord> {
  requirePermission(actor, "rooms.manage", { ip: clientIp, targetId: roomId, action: "rooms.maintenance_started" });
  const db = asyncDb ?? getAsyncDb();
  await requireBedsSchema(db);
  const reason = input.reason?.trim();
  if (!reason || reason.length < 3) throw new Error("Say what the maintenance is for (at least 3 characters).");
  const startDate = input.startDate?.trim() || businessToday();
  if (!DATE_REGEX.test(startDate)) throw new Error("Start date must be YYYY-MM-DD.");
  const at = new Date().toISOString();
  const id = `rmt_${crypto.randomUUID()}`;
  await db.transaction(async (tx) => {
    const room = await tx.queryOne<any>(`SELECT id, room_number FROM rooms WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`, [roomId]);
    if (!room) throw new Error("Room not found.");
    const open = await tx.queryOne("SELECT id FROM room_maintenance WHERE room_id = ? AND status = 'OPEN'", [roomId]);
    if (open) throw new Error(`Room ${room.room_number} is already under maintenance.`);
    const occupants = await tx.queryOne<{ n: number | string }>("SELECT COUNT(*) AS n FROM resident_stays WHERE room_id = ? AND status = 'ACTIVE'", [roomId]);
    await tx.execute(
      `INSERT INTO room_maintenance (id, room_id, reason, start_date, status, started_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
      [id, roomId, reason, startDate, actor.id, at, at]
    );
    await recordAuditEventAsync({
      actorId: actor.id, actorUsername: actor.username, action: "rooms.maintenance_started", targetType: "room", targetId: roomId,
      metadata: { maintenanceId: id, reason, startDate, residentsStaying: Number(occupants?.n || 0) }, ipAddress: clientIp,
    }, tx);
  });
  return (await listRoomMaintenance(actor, roomId, db))[0];
}

export async function completeRoomMaintenance(
  actor: AuthenticatedUser,
  roomId: string,
  input: { endDate?: string; note?: string },
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<RoomMaintenanceRecord> {
  requirePermission(actor, "rooms.manage", { ip: clientIp, targetId: roomId, action: "rooms.maintenance_completed" });
  const db = asyncDb ?? getAsyncDb();
  await requireBedsSchema(db);
  const endDate = input.endDate?.trim() || businessToday();
  if (!DATE_REGEX.test(endDate)) throw new Error("Completion date must be YYYY-MM-DD.");
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    const open = await tx.queryOne<any>(`SELECT * FROM room_maintenance WHERE room_id = ? AND status = 'OPEN'${tx.isPostgres ? " FOR UPDATE" : ""}`, [roomId]);
    if (!open) throw new Error("This room is not under maintenance.");
    if (endDate < open.start_date) throw new Error(`Completion date cannot be before the start (${open.start_date}).`);
    const note = input.note?.trim() || null;
    await tx.execute(
      "UPDATE room_maintenance SET status = 'COMPLETED', end_date = ?, completion_note = ?, completed_by = ?, updated_at = ? WHERE id = ? AND status = 'OPEN'",
      [endDate, note, actor.id, at, open.id]
    );
    await recordAuditEventAsync({
      actorId: actor.id, actorUsername: actor.username, action: "rooms.maintenance_completed", targetType: "room", targetId: roomId,
      metadata: { maintenanceId: open.id, startDate: open.start_date, endDate, note }, ipAddress: clientIp,
    }, tx);
  });
  return (await listRoomMaintenance(actor, roomId, db))[0];
}

/** Maintenance history for a room, newest first. */
export async function listRoomMaintenance(actor: AuthenticatedUser, roomId: string, asyncDb?: AsyncDb): Promise<RoomMaintenanceRecord[]> {
  requirePermission(actor, "rooms.read");
  const db = asyncDb ?? getAsyncDb();
  if (!(await hasBedsSchema(db))) return [];
  const rows = await db.query<any>(
    `SELECT m.*, a.full_name AS started_by_name, b.full_name AS completed_by_name
     FROM room_maintenance m
     LEFT JOIN staff_users a ON a.id = m.started_by
     LEFT JOIN staff_users b ON b.id = m.completed_by
     WHERE m.room_id = ? ORDER BY m.created_at DESC`,
    [roomId]
  );
  return rows.map(mapMaintenance);
}
