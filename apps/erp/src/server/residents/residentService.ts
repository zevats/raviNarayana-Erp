import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import {
  AuthenticatedUser,
  ResidentStatus,
  ResidentDetail,
  ResidentListItem,
  ResidentStayRecord,
} from "@/types";

export interface RegisterResidentInput {
  fullName: string;
  phone: string;
  email?: string;
  emergencyContact?: string;
  notes?: string;
}

export interface CheckInInput {
  residentId: string;
  roomId: string;
  checkInDate: string;
  monthlyRent: number;
  securityDeposit?: number;
}

export interface CheckOutInput {
  residentId: string;
  checkOutDate?: string;
}

const PHONE_REGEX = /^[0-9+ -]{10,15}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lists residents with their current active room assignment.
 * Requires residents.read permission.
 */
export async function listResidents(
  actor: AuthenticatedUser,
  options?: {
    status?: "ACTIVE" | "CHECKED_OUT" | "ALL";
    search?: string;
  },
  asyncDb?: AsyncDb
): Promise<ResidentListItem[]> {
  requirePermission(actor, "residents.read");
  const db = asyncDb ?? getAsyncDb();

  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.status && options.status !== "ALL") {
    conditions.push("res.status = ?");
    params.push(options.status);
  }

  if (options?.search) {
    const term = `%${options.search.trim().toLowerCase()}%`;
    conditions.push("(LOWER(res.full_name) LIKE ? OR res.phone LIKE ? OR LOWER(rm.room_number) LIKE ?)");
    params.push(term, term, term);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    SELECT 
      res.id,
      res.full_name as "fullName",
      res.phone,
      res.email,
      res.status,
      res.created_at as "createdAt",
      rm.room_number as "currentRoomNumber",
      rm.floor as "currentFloor",
      s.check_in_date as "checkInDate",
      (SELECT COUNT(*) FROM resident_stays WHERE resident_id = res.id) as "totalStayCount",
      (SELECT COUNT(*) FROM resident_stays WHERE resident_id = res.id AND status = 'COMPLETED') as "completedStayCount"
    FROM residents res
    LEFT JOIN resident_stays s ON s.resident_id = res.id AND s.status = 'ACTIVE'
    LEFT JOIN rooms rm ON rm.id = s.room_id
    ${whereClause}
    ORDER BY res.created_at DESC
  `;

  const rows = await db.query<any>(query, params);
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    phone: r.phone,
    email: r.email,
    status: r.status,
    createdAt: r.createdAt,
    currentRoomNumber: r.currentRoomNumber,
    currentFloor: r.currentFloor !== null && r.currentFloor !== undefined ? Number(r.currentFloor) : null,
    checkInDate: r.checkInDate,
    totalStayCount: Number(r.totalStayCount || 0),
    completedStayCount: Number(r.completedStayCount || 0),
  }));
}

/**
 * Retrieves a full resident profile including complete stay history.
 */
export async function getResidentById(
  actor: AuthenticatedUser,
  residentId: string,
  asyncDb?: AsyncDb
): Promise<ResidentDetail | null> {
  requirePermission(actor, "residents.read");
  const db = asyncDb ?? getAsyncDb();

  const residentRow = await db.queryOne<any>(`
    SELECT 
      id,
      full_name as "fullName",
      phone,
      email,
      emergency_contact as "emergencyContact",
      notes,
      status,
      created_at as "createdAt",
      updated_at as "updatedAt"
    FROM residents
    WHERE id = ?
  `, [residentId]);

  if (!residentRow) return null;

  // Query stay history
  const rawStays = await db.query<any>(`
    SELECT 
      s.id,
      s.resident_id as "residentId",
      s.room_id as "roomId",
      rm.room_number as "roomNumber",
      rm.floor,
      s.check_in_date as "checkInDate",
      s.check_out_date as "checkOutDate",
      s.monthly_rent as "monthlyRent",
      s.security_deposit as "securityDeposit",
      s.status,
      s.created_at as "createdAt"
    FROM resident_stays s
    JOIN rooms rm ON rm.id = s.room_id
    WHERE s.resident_id = ?
    ORDER BY s.check_in_date DESC, s.created_at DESC
  `, [residentId]);

  const stayRows: ResidentStayRecord[] = rawStays.map((s) => ({
    id: s.id,
    residentId: s.residentId,
    roomId: s.roomId,
    roomNumber: s.roomNumber,
    floor: Number(s.floor),
    checkInDate: s.checkInDate,
    checkOutDate: s.checkOutDate || null,
    monthlyRent: Number(s.monthlyRent),
    securityDeposit: Number(s.securityDeposit || 0),
    status: s.status,
    createdAt: s.createdAt,
  }));

  const activeStay = stayRows.find((s) => s.status === "ACTIVE");

  return {
    id: residentRow.id,
    fullName: residentRow.fullName,
    phone: residentRow.phone,
    email: residentRow.email || null,
    emergencyContact: residentRow.emergencyContact || null,
    notes: residentRow.notes || null,
    status: residentRow.status as ResidentStatus,
    currentRoom: activeStay
      ? {
          roomId: activeStay.roomId,
          roomNumber: activeStay.roomNumber!,
          floor: activeStay.floor!,
          stayId: activeStay.id,
          checkInDate: activeStay.checkInDate,
          monthlyRent: activeStay.monthlyRent,
          securityDeposit: activeStay.securityDeposit,
        }
      : null,
    stays: stayRows,
    createdAt: residentRow.createdAt,
    updatedAt: residentRow.updatedAt,
  };
}

/**
 * Registers a new resident profile.
 * Requires residents.manage permission.
 */
export async function registerResident(
  actor: AuthenticatedUser,
  input: RegisterResidentInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<ResidentDetail> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "residents.manage", { ip: clientIp, action: "resident.register" });

  const cleanName = input.fullName?.trim();
  const cleanPhone = input.phone?.trim();
  const cleanEmail = input.email?.trim().toLowerCase() || null;
  const cleanEmergency = input.emergencyContact?.trim() || null;
  const cleanNotes = input.notes?.trim() || null;

  if (!cleanName || cleanName.length < 2 || cleanName.length > 100) {
    throw new Error("Full name must be between 2 and 100 characters.");
  }
  if (!cleanPhone || !PHONE_REGEX.test(cleanPhone)) {
    throw new Error("Valid phone number with at least 10 digits is required.");
  }
  if (cleanEmail && !EMAIL_REGEX.test(cleanEmail)) {
    throw new Error("Invalid email format.");
  }

  // Check unique phone number
  const existingPhone = await db.queryOne<{ id: string }>("SELECT id FROM residents WHERE phone = ?", [cleanPhone]);
  if (existingPhone) {
    throw new Error(`A resident with phone number '${cleanPhone}' is already registered.`);
  }

  const id = `res_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.execute(`
      INSERT INTO residents (id, full_name, phone, email, emergency_contact, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `, [id, cleanName, cleanPhone, cleanEmail, cleanEmergency, cleanNotes, now, now]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "resident.registered",
      targetType: "resident",
      targetId: id,
      metadata: {
        fullName: cleanName,
        phone: cleanPhone,
        hasEmail: Boolean(cleanEmail),
      },
      ipAddress: clientIp,
    }, tx);
  });

  return {
    id,
    fullName: cleanName,
    phone: cleanPhone,
    email: cleanEmail,
    emergencyContact: cleanEmergency,
    notes: cleanNotes,
    status: "ACTIVE",
    currentRoom: null,
    stays: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Assigns a resident to a room and records their check-in.
 * Enforces room capacity and prevents duplicate active room assignments.
 */
export async function assignResidentToRoom(
  actor: AuthenticatedUser,
  input: CheckInInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<ResidentStayRecord> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "residents.manage", { ip: clientIp, targetId: input.residentId, action: "resident.check_in" });

  const residentId = input.residentId?.trim();
  const roomId = input.roomId?.trim();
  const checkInDate = input.checkInDate?.trim();
  const monthlyRent = Number(input.monthlyRent);
  const securityDeposit = Number(input.securityDeposit || 0);

  if (!residentId) throw new Error("Resident ID is required.");
  if (!roomId) throw new Error("Room ID is required.");
  if (!checkInDate || !DATE_REGEX.test(checkInDate)) {
    throw new Error("Valid check-in date in YYYY-MM-DD format is required.");
  }
  if (isNaN(monthlyRent) || monthlyRent < 0) {
    throw new Error("Monthly rent must be a non-negative amount.");
  }
  if (isNaN(securityDeposit) || securityDeposit < 0) {
    throw new Error("Security deposit must be a non-negative amount.");
  }

  let createdStay: ResidentStayRecord;

  await db.transaction(async (tx) => {
    // 1. Verify resident exists
    const resident = await tx.queryOne<any>("SELECT id, full_name as \"fullName\", status FROM residents WHERE id = ?", [residentId]);
    if (!resident) {
      throw new Error(`Resident '${residentId}' not found.`);
    }

    // 2. Prevent duplicate active stay: resident cannot already be checked in
    const activeStay = await tx.queryOne<{ id: string; roomNumber: string }>(`
      SELECT s.id, rm.room_number as "roomNumber"
      FROM resident_stays s
      JOIN rooms rm ON rm.id = s.room_id
      WHERE s.resident_id = ? AND s.status = 'ACTIVE'
    `, [residentId]);

    if (activeStay) {
      throw new Error(`Resident is already actively assigned to Room ${activeStay.roomNumber}. Check out before reassigning.`);
    }

    // 3. Verify room exists and is active
    const room = await tx.queryOne<any>("SELECT id, room_number as \"roomNumber\", floor, capacity, is_active as \"isActive\" FROM rooms WHERE id = ?", [roomId]);
    if (!room) {
      throw new Error(`Room '${roomId}' not found.`);
    }
    if (!Boolean(room.isActive)) {
      throw new Error(`Room ${room.roomNumber} is currently inactive and cannot accept check-ins.`);
    }

    // 4. Verify capacity limit under transaction: count active stays in target room
    const currentOccupancy = await tx.queryOne<{ count: number | string }>(`
      SELECT COUNT(*) as count FROM resident_stays WHERE room_id = ? AND status = 'ACTIVE'
    `, [roomId]);

    const occupancyCount = Number(currentOccupancy?.count || 0);
    if (occupancyCount >= Number(room.capacity)) {
      throw new Error(
        `Room ${room.roomNumber} is at full capacity (${occupancyCount}/${room.capacity} beds occupied). No beds available.`
      );
    }

    const stayId = `stay_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    await tx.execute(`
      INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
    `, [stayId, residentId, roomId, checkInDate, monthlyRent, securityDeposit, now, now]);

    // Update resident active status
    await tx.execute("UPDATE residents SET status = 'ACTIVE', updated_at = ? WHERE id = ?", [now, residentId]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "resident.checked_in",
      targetType: "resident",
      targetId: residentId,
      metadata: {
        stayId,
        roomId,
        roomNumber: room.roomNumber,
        checkInDate,
        monthlyRent,
        securityDeposit,
      },
      ipAddress: clientIp,
    }, tx);

    createdStay = {
      id: stayId,
      residentId,
      roomId,
      roomNumber: room.roomNumber,
      floor: Number(room.floor),
      checkInDate,
      checkOutDate: null,
      monthlyRent,
      securityDeposit,
      status: "ACTIVE",
      createdAt: now,
    };
  });

  return createdStay!;
}

/**
 * Checks out a resident from their active room assignment.
 * Preserves stay history and immediately releases bed capacity.
 */
export async function checkOutResident(
  actor: AuthenticatedUser,
  input: CheckOutInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<void> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "residents.manage", { ip: clientIp, targetId: input.residentId, action: "resident.check_out" });

  const residentId = input.residentId?.trim();
  const checkOutDate = input.checkOutDate?.trim() || new Date().toISOString().slice(0, 10);

  if (!residentId) throw new Error("Resident ID is required.");
  if (!DATE_REGEX.test(checkOutDate)) {
    throw new Error("Valid check-out date in YYYY-MM-DD format is required.");
  }

  await db.transaction(async (tx) => {
    // Find active stay
    const activeStay = await tx.queryOne<{ id: string; roomId: string; checkInDate: string; roomNumber: string }>(`
      SELECT s.id, s.room_id as "roomId", s.check_in_date as "checkInDate", rm.room_number as "roomNumber"
      FROM resident_stays s
      JOIN rooms rm ON rm.id = s.room_id
      WHERE s.resident_id = ? AND s.status = 'ACTIVE'
    `, [residentId]);

    if (!activeStay) {
      throw new Error("Resident has no active room assignment to check out.");
    }

    if (checkOutDate < activeStay.checkInDate) {
      throw new Error(
        `Check-out date (${checkOutDate}) cannot be earlier than check-in date (${activeStay.checkInDate}).`
      );
    }

    const now = new Date().toISOString();

    // Mark stay completed
    await tx.execute(`
      UPDATE resident_stays 
      SET status = 'COMPLETED', check_out_date = ?, updated_at = ? 
      WHERE id = ?
    `, [checkOutDate, now, activeStay.id]);

    // Update resident status
    await tx.execute("UPDATE residents SET status = 'CHECKED_OUT', updated_at = ? WHERE id = ?", [now, residentId]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "resident.checked_out",
      targetType: "resident",
      targetId: residentId,
      metadata: {
        stayId: activeStay.id,
        roomId: activeStay.roomId,
        roomNumber: activeStay.roomNumber,
        checkInDate: activeStay.checkInDate,
        checkOutDate,
      },
      ipAddress: clientIp,
    }, tx);
  });
}

export interface UpdateResidentInput {
  fullName?: string;
  phone?: string;
  email?: string | null;
  emergencyContact?: string | null;
  notes?: string | null;
}

/**
 * Updates an existing resident's personal details, contact info, and notes.
 * Enforces phone uniqueness and validates input constraints.
 */
export async function updateResident(
  actor: AuthenticatedUser,
  residentId: string,
  input: UpdateResidentInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<ResidentDetail> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "residents.manage", { ip: clientIp, targetId: residentId, action: "resident.update" });

  const current = await getResidentById(actor, residentId, db);
  if (!current) {
    throw new Error(`Resident '${residentId}' not found.`);
  }

  const updates: string[] = [];
  const params: any[] = [];
  const auditMeta: Record<string, any> = {};

  if (input.fullName !== undefined) {
    const cleanName = input.fullName.trim();
    if (!cleanName || cleanName.length < 2 || cleanName.length > 100) {
      throw new Error("Full name must be between 2 and 100 characters.");
    }
    updates.push("full_name = ?");
    params.push(cleanName);
    auditMeta.fullName = { from: current.fullName, to: cleanName };
  }

  if (input.phone !== undefined) {
    const cleanPhone = input.phone.trim();
    if (!cleanPhone || !PHONE_REGEX.test(cleanPhone)) {
      throw new Error("Valid phone number with at least 10 digits is required.");
    }
    if (cleanPhone !== current.phone) {
      const existing = await db.queryOne<{ id: string }>("SELECT id FROM residents WHERE phone = ? AND id != ?", [cleanPhone, residentId]);
      if (existing) {
        throw new Error(`A resident with phone number '${cleanPhone}' is already registered.`);
      }
      updates.push("phone = ?");
      params.push(cleanPhone);
      auditMeta.phone = { from: current.phone, to: cleanPhone };
    }
  }

  if (input.email !== undefined) {
    const cleanEmail = input.email ? input.email.trim().toLowerCase() : null;
    if (cleanEmail && !EMAIL_REGEX.test(cleanEmail)) {
      throw new Error("Invalid email format.");
    }
    updates.push("email = ?");
    params.push(cleanEmail);
    auditMeta.email = { from: current.email, to: cleanEmail };
  }

  if (input.emergencyContact !== undefined) {
    const cleanEmergency = input.emergencyContact ? input.emergencyContact.trim() : null;
    updates.push("emergency_contact = ?");
    params.push(cleanEmergency);
    auditMeta.emergencyContact = { from: current.emergencyContact, to: cleanEmergency };
  }

  if (input.notes !== undefined) {
    const cleanNotes = input.notes ? input.notes.trim() : null;
    updates.push("notes = ?");
    params.push(cleanNotes);
    auditMeta.notes = { from: current.notes, to: cleanNotes };
  }

  if (updates.length === 0) {
    return current;
  }

  const now = new Date().toISOString();
  updates.push("updated_at = ?");
  params.push(now, residentId);

  await db.transaction(async (tx) => {
    await tx.execute(`UPDATE residents SET ${updates.join(", ")} WHERE id = ?`, params);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "resident.updated",
      targetType: "resident",
      targetId: residentId,
      metadata: auditMeta,
      ipAddress: clientIp,
    }, tx);
  });

  return (await getResidentById(actor, residentId, db))!;
}
