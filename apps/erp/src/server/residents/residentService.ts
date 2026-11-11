import crypto from "crypto";
import { claimBedForStay, hasBedsSchema } from "../rooms/bedService";
import { settleAutomaticRentOnStayEnd } from "../finance/rentGenerationService";
import { businessToday } from "@/lib/businessDate";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import {
  AuthenticatedUser,
  ResidentStatus,
  ResidentDetail,
  ResidentListItem,
  ResidentStayRecord,
  TransferResidentRoomInput,
  ResidentTransferRecord,
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
  /** Bed to put the resident in (optional; any free in-service bed counts when omitted). */
  bedId?: string | null;
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
      COALESCE(sc.total_stays, 0) as "totalStayCount",
      COALESCE(sc.completed_stays, 0) as "completedStayCount",
      sc.last_check_out as "lastCheckOutDate"
    FROM residents res
    LEFT JOIN resident_stays s ON s.resident_id = res.id AND s.status = 'ACTIVE'
    LEFT JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN (
      SELECT 
        resident_id,
        COUNT(*) as total_stays,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_stays,
        MAX(check_out_date) as last_check_out
      FROM resident_stays
      GROUP BY resident_id
    ) sc ON sc.resident_id = res.id
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
    lastCheckOutDate: r.lastCheckOutDate ? String(r.lastCheckOutDate).slice(0, 10) : null,
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

  // A PG resident is a tiffin customer too (added once; never blocks the registration).
  try {
    const { ensureResidentCustomer } = await import("../tiffin/residentCustomers");
    await ensureResidentCustomer(actor, { fullName: cleanName, phone: cleanPhone }, clientIp, db);
  } catch {
    /* the customer list adds missing residents later */
  }

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

    // 3. Verify room exists and is active (with row lock in PostgreSQL)
    const room = await tx.queryOne<any>(
      tx.isPostgres
        ? 'SELECT id, room_number as "roomNumber", floor, capacity, is_active as "isActive" FROM rooms WHERE id = ? FOR UPDATE'
        : 'SELECT id, room_number as "roomNumber", floor, capacity, is_active as "isActive" FROM rooms WHERE id = ?',
      [roomId]
    );
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

    // Beds and maintenance (migration 0017): no check-in into a room under maintenance; the chosen
    // bed must be free and in service, otherwise any free in-service bed must exist.
    const bedId = await claimBedForStay(tx, { id: room.id, roomNumber: room.roomNumber }, input.bedId, occupancyCount);

    const stayId = `stay_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    if (await hasBedsSchema(tx)) {
      await tx.execute(`
        INSERT INTO resident_stays (id, resident_id, room_id, bed_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
      `, [stayId, residentId, roomId, bedId, checkInDate, monthlyRent, securityDeposit, now, now]);
    } else {
      await tx.execute(`
        INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
      `, [stayId, residentId, roomId, checkInDate, monthlyRent, securityDeposit, now, now]);
    }

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
  const checkOutDate = input.checkOutDate?.trim() || businessToday();

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
    await settleAutomaticRentOnStayEnd(tx, actor, activeStay.id, checkOutDate, clientIp);

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

/**
 * Atomically transfers a resident to a different room.
 * Invariants enforced:
 * 1. Actor must have `residents.manage` permission.
 * 2. Resident must exist and have an active stay.
 * 3. Destination room must exist, be active, and differ from the current room.
 * 4. Destination room capacity must have at least 1 vacant bed under row lock.
 * 5. Transfer date cannot be earlier than the current stay's check-in date.
 * 6. Carries forward the existing security deposit without double-billing or refunding.
 * 7. Atomically completes the old stay and creates the new stay.
 * 8. Creates an immutable audit log record `resident.room_transferred`.
 */
export async function transferResidentRoom(
  actor: AuthenticatedUser,
  input: TransferResidentRoomInput,
  clientIpOrDb?: string | AsyncDb,
  asyncDb?: AsyncDb
): Promise<ResidentTransferRecord> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const db = (typeof clientIpOrDb === "object" && clientIpOrDb !== null) ? clientIpOrDb : (asyncDb ?? getAsyncDb());

  requirePermission(actor, "residents.manage", {
    ip: clientIp,
    targetId: input.residentId,
    action: "resident.transfer_room",
  });

  const residentId = input.residentId?.trim();
  const targetRoomId = input.targetRoomId?.trim();
  const transferDate = input.transferDate?.trim();
  const reason = input.reason?.trim();

  if (!residentId) throw new Error("Resident ID is required.");
  if (!targetRoomId) throw new Error("Destination room ID is required.");
  if (!transferDate || !DATE_REGEX.test(transferDate)) {
    throw new Error("Valid transfer date in YYYY-MM-DD format is required.");
  }
  if (!reason || reason.length < 5) {
    throw new Error("Transfer reason is required (minimum 5 characters).");
  }

  let newRentOverride: number | undefined;
  if (input.newMonthlyRent !== undefined && input.newMonthlyRent !== null) {
    const parsedRent = Number(input.newMonthlyRent);
    if (isNaN(parsedRent) || parsedRent < 0) {
      throw new Error("New monthly rent must be a non-negative amount.");
    }
    newRentOverride = parsedRent;
  }

  let result: ResidentTransferRecord;

  await db.transaction(async (tx) => {
    // 1. Verify resident exists
    const resident = await tx.queryOne<any>(
      'SELECT id, full_name as "fullName", status FROM residents WHERE id = ?',
      [residentId]
    );
    if (!resident) {
      throw new Error(`Resident '${residentId}' not found.`);
    }

    // 2. Fetch current active stay
    const activeStay = await tx.queryOne<any>(
      `SELECT 
        s.id,
        s.room_id as "roomId",
        s.check_in_date as "checkInDate",
        s.monthly_rent as "monthlyRent",
        s.security_deposit as "securityDeposit",
        rm.room_number as "roomNumber",
        rm.floor
      FROM resident_stays s
      JOIN rooms rm ON rm.id = s.room_id
      WHERE s.resident_id = ? AND s.status = 'ACTIVE'`,
      [residentId]
    );

    if (!activeStay) {
      throw new Error("Resident has no active room assignment to transfer.");
    }

    // 3. Invariant: Destination room must differ from current room
    if (targetRoomId === activeStay.roomId) {
      throw new Error(`Resident is already in Room ${activeStay.roomNumber}. Cannot transfer to the same room.`);
    }

    // 4. Invariant: Transfer date cannot precede current stay check-in date
    if (transferDate < activeStay.checkInDate) {
      throw new Error(
        `Transfer date (${transferDate}) cannot be earlier than current stay check-in date (${activeStay.checkInDate}).`
      );
    }

    // 5. Look up and row-lock target room
    const targetRoom = await tx.queryOne<any>(
      tx.isPostgres
        ? 'SELECT id, room_number as "roomNumber", floor, capacity, base_rent_monthly as "baseRentMonthly", is_active as "isActive" FROM rooms WHERE id = ? FOR UPDATE'
        : 'SELECT id, room_number as "roomNumber", floor, capacity, base_rent_monthly as "baseRentMonthly", is_active as "isActive" FROM rooms WHERE id = ?',
      [targetRoomId]
    );

    if (!targetRoom) {
      throw new Error(`Destination room '${targetRoomId}' not found.`);
    }
    if (!Boolean(targetRoom.isActive)) {
      throw new Error(`Destination Room ${targetRoom.roomNumber} is currently inactive and cannot accept transfers.`);
    }

    // 6. Verify destination capacity under transaction
    const currentOccupancy = await tx.queryOne<{ count: number | string }>(
      "SELECT COUNT(*) as count FROM resident_stays WHERE room_id = ? AND status = 'ACTIVE'",
      [targetRoomId]
    );
    const occupancyCount = Number(currentOccupancy?.count || 0);
    const targetCapacity = Number(targetRoom.capacity);

    if (occupancyCount >= targetCapacity) {
      throw new Error(
        `Destination Room ${targetRoom.roomNumber} is at full capacity (${occupancyCount}/${targetCapacity} beds occupied). No beds available for transfer.`
      );
    }

    // Beds and maintenance (migration 0017): same rules as check-in.
    const targetBedId = await claimBedForStay(tx, { id: targetRoom.id, roomNumber: targetRoom.roomNumber }, input.bedId, occupancyCount);

    const effectiveRent = newRentOverride !== undefined ? newRentOverride : Number(targetRoom.baseRentMonthly);
    const now = new Date().toISOString();
    const newStayId = `stay_${crypto.randomUUID()}`;
    const carriedSecurityDeposit = Number(activeStay.securityDeposit || 0);

    // 7. Complete current stay; its automatic rent for this month covers only the nights stayed
    // (the new room is charged from the transfer date by the next rent run).
    await tx.execute(
      "UPDATE resident_stays SET status = 'COMPLETED', check_out_date = ?, updated_at = ? WHERE id = ?",
      [transferDate, now, activeStay.id]
    );
    await settleAutomaticRentOnStayEnd(tx, actor, activeStay.id, transferDate, clientIp);

    // 8. Create new active stay in target room (deposit carried forward)
    if (await hasBedsSchema(tx)) {
      await tx.execute(
        `INSERT INTO resident_stays (
          id, resident_id, room_id, bed_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [newStayId, residentId, targetRoomId, targetBedId, transferDate, effectiveRent, carriedSecurityDeposit, now, now]
      );
    } else {
      await tx.execute(
        `INSERT INTO resident_stays (
          id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [newStayId, residentId, targetRoomId, transferDate, effectiveRent, carriedSecurityDeposit, now, now]
      );
    }

    // 9. Ensure resident status is ACTIVE
    await tx.execute(
      "UPDATE residents SET status = 'ACTIVE', updated_at = ? WHERE id = ?",
      [now, residentId]
    );

    // 10. Carry forward financial ledger link (security deposit, rent payments) from transferred stay
    await tx.execute(
      "UPDATE financial_transactions SET stay_id = ? WHERE resident_id = ? AND stay_id = ?",
      [newStayId, residentId, activeStay.id]
    );

    // 11. Record immutable audit log
    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "resident.room_transferred",
      targetType: "resident",
      targetId: residentId,
      metadata: {
        residentName: resident.fullName,
        previousStayId: activeStay.id,
        previousRoomId: activeStay.roomId,
        previousRoomNumber: activeStay.roomNumber,
        previousMonthlyRent: Number(activeStay.monthlyRent),
        newStayId,
        newRoomId: targetRoomId,
        newRoomNumber: targetRoom.roomNumber,
        newFloor: Number(targetRoom.floor),
        newMonthlyRent: effectiveRent,
        securityDepositCarried: carriedSecurityDeposit,
        transferDate,
        reason,
      },
      ipAddress: clientIp,
    }, tx);

    result = {
      residentId,
      residentName: resident.fullName,
      previousStayId: activeStay.id,
      previousRoomId: activeStay.roomId,
      previousRoomNumber: activeStay.roomNumber,
      previousMonthlyRent: Number(activeStay.monthlyRent),
      newStayId,
      newRoomId: targetRoomId,
      newRoomNumber: targetRoom.roomNumber,
      newFloor: Number(targetRoom.floor),
      newMonthlyRent: effectiveRent,
      transferDate,
      securityDepositCarried: carriedSecurityDeposit,
      reason,
      transferredAt: now,
    };
  });

  return result!;
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

export {
  previewResidentSettlement,
  finalizeResidentCheckoutSettlement,
  getResidentSettlementByStayId,
  listResidentSettlements,
} from "./residentSettlementService";

