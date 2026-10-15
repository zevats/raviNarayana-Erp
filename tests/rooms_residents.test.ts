import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "../apps/erp/src/server/database/migrations";
import { hasPermission } from "../apps/erp/src/server/authorization/permissions";
import {
  requirePermission,
  AuthorizationError,
} from "../apps/erp/src/server/authorization/authorize";
import {
  createRoom,
  updateRoom,
  setRoomActiveStatus,
  listRooms,
  getRoomById,
} from "../apps/erp/src/server/rooms/roomService";
import {
  registerResident,
  assignResidentToRoom,
  checkOutResident,
  listResidents,
  getResidentById,
} from "../apps/erp/src/server/residents/residentService";
import { getAuditLogs, sanitizeAuditMetadata } from "../apps/erp/src/server/audit/audit";
import { AuthenticatedUser } from "../apps/erp/src/types";

// Isolated test database path
const TEST_ROOMS_DB_PATH = path.resolve(__dirname, "test_rooms.db");

function cleanupTestDb() {
  if (fs.existsSync(TEST_ROOMS_DB_PATH)) fs.unlinkSync(TEST_ROOMS_DB_PATH);
  const wal = `${TEST_ROOMS_DB_PATH}-wal`;
  const shm = `${TEST_ROOMS_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_ROOMS_DB_PATH;

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
  }
}

console.log("================================================================================");
console.log("RAVINARAYAN ERP — PHASE 3 CORE: ROOMS & RESIDENT MANAGEMENT TEST SUITE");
console.log("================================================================================\n");

async function runRoomsResidentsTests() {
  // Test actors
  const superAdminUser: AuthenticatedUser = {
    id: "usr_super_admin_01",
    username: "admin",
    email: "admin@ravinarayan.in",
    fullName: "Ravinarayan Super Admin",
    role: "SUPER_ADMIN",
  };

  const opsManagerUser: AuthenticatedUser = {
    id: "usr_ops_manager_01",
    username: "opsmanager",
    email: "ops@ravinarayan.in",
    fullName: "Operations Lead",
    role: "OPERATIONS_MANAGER",
  };

  const accountantUser: AuthenticatedUser = {
    id: "usr_accountant_01",
    username: "accountant",
    email: "accountant@ravinarayan.in",
    fullName: "Staff Accountant",
    role: "ACCOUNTANT",
  };

  const deliveryUser: AuthenticatedUser = {
    id: "usr_delivery_01",
    username: "deliveryperson",
    email: "delivery@ravinarayan.in",
    fullName: "Delivery Staff",
    role: "DELIVERY_PERSON",
  };

  // -----------------------------------------------------------------------------
  // TEST SUITE 1: Migration V2 -> V3 & Schema Invariants
  // -----------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Database Migration V2 -> V3 & Schema Verification");

  const db = new Database(TEST_ROOMS_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Simulate existing V2 schema
  db.exec(`
    CREATE TABLE staff_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      staff_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      FOREIGN KEY (staff_id) REFERENCES staff_users(id) ON DELETE CASCADE
    );

    CREATE TABLE login_attempts (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      success INTEGER NOT NULL
    );

    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_username TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      metadata TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.pragma("user_version = 2");

  // Insert super admin and ops manager records for foreign key & authorization testing
  db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES ('usr_super_admin_01', 'admin', 'admin@ravinarayan.in', 'Ravinarayan Super Admin', 'hash123', 'SUPER_ADMIN', 1, '2026-10-15T00:00:00Z', '2026-10-15T00:00:00Z')
  `).run();

  // Apply Migration V3
  runMigrations(db);

  const version = db.pragma("user_version", { simple: true });
  assert(Number(version) >= 3, `Database schema version advanced to at least 3 (got ${version})`);

  // Verify rooms table schema
  const roomCols = (db.prepare("PRAGMA table_info(rooms)").all() as any[]).map((c: any) => c.name);
  assert(
    roomCols.includes("id") &&
      roomCols.includes("room_number") &&
      roomCols.includes("floor") &&
      roomCols.includes("type") &&
      roomCols.includes("capacity") &&
      roomCols.includes("base_rent_monthly") &&
      roomCols.includes("is_active"),
    "rooms table created with all required columns"
  );

  // Verify residents table schema
  const residentCols = (db.prepare("PRAGMA table_info(residents)").all() as any[]).map((c: any) => c.name);
  assert(
    residentCols.includes("id") &&
      residentCols.includes("full_name") &&
      residentCols.includes("phone") &&
      residentCols.includes("email") &&
      residentCols.includes("emergency_contact") &&
      residentCols.includes("status"),
    "residents table created with all required columns"
  );

  // Verify resident_stays table schema
  const stayCols = (db.prepare("PRAGMA table_info(resident_stays)").all() as any[]).map((c: any) => c.name);
  assert(
    stayCols.includes("id") &&
      stayCols.includes("resident_id") &&
      stayCols.includes("room_id") &&
      stayCols.includes("check_in_date") &&
      stayCols.includes("check_out_date") &&
      stayCols.includes("monthly_rent") &&
      stayCols.includes("security_deposit") &&
      stayCols.includes("status"),
    "resident_stays table created with all required columns"
  );

  // Verify partial unique index exists
  const indices = (db.prepare("PRAGMA index_list(resident_stays)").all() as any[]).map((i: any) => i.name);
  assert(
    indices.includes("idx_unique_active_resident_stay"),
    "Partial unique index idx_unique_active_resident_stay verified on resident_stays"
  );

  // -----------------------------------------------------------------------------
  // TEST SUITE 2: Room Inventory & Capacity Invariants
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Room Creation, Validation & Derived Occupancy");

  // 2a: Create Room 101 (Double Sharing, Capacity: 2, Rent: 8500)
  const room101 = createRoom(
    opsManagerUser,
    {
      roomNumber: "101",
      floor: 1,
      type: "DOUBLE_SHARING",
      capacity: 2,
      baseRentMonthly: 8500,
    },
    "192.168.1.50"
  );
  assert(room101.id.startsWith("room_"), "createRoom returns room with prefixed id");
  assert(room101.roomNumber === "101" && room101.capacity === 2, "Room 101 created with capacity 2");

  // 2b: Create Room 102 (Single, Capacity: 1, Rent: 14000)
  const room102 = createRoom(
    superAdminUser,
    {
      roomNumber: "102",
      floor: 1,
      type: "SINGLE",
      capacity: 1,
      baseRentMonthly: 14000,
    },
    "192.168.1.51"
  );
  assert(room102.roomNumber === "102" && room102.capacity === 1, "Room 102 created with capacity 1");

  // 2c: Reject duplicate room number
  let duplicateRoomBlocked = false;
  try {
    createRoom(opsManagerUser, {
      roomNumber: "101",
      floor: 2,
      type: "DOUBLE_SHARING",
      capacity: 2,
      baseRentMonthly: 9000,
    });
  } catch (err: any) {
    duplicateRoomBlocked = err.message.includes("already exists");
  }
  assert(duplicateRoomBlocked, "Duplicate room number creation prevented");

  // 2d: Reject invalid capacity (<= 0)
  let zeroCapacityBlocked = false;
  try {
    createRoom(opsManagerUser, {
      roomNumber: "103",
      floor: 1,
      type: "SINGLE",
      capacity: 0,
      baseRentMonthly: 8000,
    });
  } catch (err: any) {
    zeroCapacityBlocked = err.message.toLowerCase().includes("capacity");
  }
  assert(zeroCapacityBlocked, "createRoom rejects zero or negative capacity");

  // 2e: List rooms derives correct initial occupancy
  const initialRooms = listRooms(opsManagerUser);
  assert(initialRooms.length === 2, "listRooms returns exactly 2 created rooms");
  const initial101 = initialRooms.find((r) => r.roomNumber === "101");
  assert(
    initial101?.occupiedBeds === 0 && initial101?.availableBeds === 2,
    "Room 101 derived occupancy is 0 occupied and 2 available beds"
  );

  // -----------------------------------------------------------------------------
  // TEST SUITE 3: Resident Registration & Phone Uniqueness
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Resident Registration & Phone Uniqueness");

  // 3a: Register Resident 1
  const resident1 = registerResident(
    opsManagerUser,
    {
      fullName: "Aarav Sharma",
      phone: "+91 98765 43210",
      email: "aarav.sharma@example.com",
      emergencyContact: "+91 98765 00000",
      notes: "Senior Software Engineer at Met City",
    },
    "192.168.1.50"
  );
  assert(resident1.id.startsWith("res_"), "registerResident returns resident with prefixed id");
  assert(resident1.phone === "+91 98765 43210", "Resident phone preserved accurately");
  assert(resident1.status === "ACTIVE", "New resident defaults to ACTIVE status");

  // 3b: Register Resident 2
  const resident2 = registerResident(
    opsManagerUser,
    {
      fullName: "Vikram Malhotra",
      phone: "+91 98111 22233",
      email: "vikram.m@example.com",
    },
    "192.168.1.50"
  );
  assert(resident2.fullName === "Vikram Malhotra", "Resident 2 registered successfully");

  // 3c: Register Resident 3
  const resident3 = registerResident(
    opsManagerUser,
    {
      fullName: "Rohan Verma",
      phone: "9822233344",
      notes: "Relocating from Delhi",
    },
    "192.168.1.50"
  );
  assert(resident3.phone === "9822233344", "Resident 3 phone registered");

  // 3d: Duplicate phone registration blocked
  let duplicatePhoneBlocked = false;
  try {
    registerResident(opsManagerUser, {
      fullName: "Imposter Aarav",
      phone: "+91 98765 43210",
    });
  } catch (err: any) {
    duplicatePhoneBlocked = err.message.includes("already registered");
  }
  assert(duplicatePhoneBlocked, "Duplicate phone registration blocked");

  // -----------------------------------------------------------------------------
  // TEST SUITE 4: Room Assignment, Capacity Limits & Overbooking Defense
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Room Assignment, Capacity Enforcement & Overbooking Defense");

  // 4a: Check in Resident 1 into Room 101 (Bed 1 of 2)
  const stay1 = assignResidentToRoom(
    opsManagerUser,
    {
      residentId: resident1.id,
      roomId: room101.id,
      checkInDate: "2026-10-15",
      monthlyRent: 8500,
      securityDeposit: 17000,
    },
    "192.168.1.50"
  );
  assert(stay1.id.startsWith("stay_"), "assignResidentToRoom creates stay record with prefixed id");
  assert(stay1.status === "ACTIVE", "Stay record status is ACTIVE");

  // Verify room 101 occupancy is now 1/2
  const roomsAfterStay1 = listRooms(opsManagerUser);
  const room101After1 = roomsAfterStay1.find((r) => r.id === room101.id);
  assert(
    room101After1?.occupiedBeds === 1 && room101After1?.availableBeds === 1,
    "Room 101 derived occupancy updated to 1 occupied and 1 available bed"
  );

  // Verify resident 1 active room assignment is loaded
  const res1Detail = getResidentById(opsManagerUser, resident1.id);
  assert(res1Detail?.status === "ACTIVE", "Resident status is ACTIVE");
  assert(res1Detail?.currentRoom?.roomId === room101.id, "Resident detail includes active stay in Room 101");

  // 4b: Check in Resident 2 into Room 101 (Bed 2 of 2 - Full Capacity)
  const stay2 = assignResidentToRoom(
    opsManagerUser,
    {
      residentId: resident2.id,
      roomId: room101.id,
      checkInDate: "2026-10-15",
      monthlyRent: 8500,
      securityDeposit: 17000,
    },
    "192.168.1.50"
  );
  assert(stay2.status === "ACTIVE", "Resident 2 checked in to Room 101");

  // Verify room 101 occupancy is now 2/2 (0 available)
  const roomsAfterStay2 = listRooms(opsManagerUser);
  const room101After2 = roomsAfterStay2.find((r) => r.id === room101.id);
  assert(
    room101After2?.occupiedBeds === 2 && room101After2?.availableBeds === 0,
    "Room 101 derived occupancy updated to 2 occupied and 0 available beds"
  );

  // 4c: Overbooking Attempt: Attempt to check in Resident 3 into FULL Room 101
  let overbookingBlocked = false;
  try {
    assignResidentToRoom(opsManagerUser, {
      residentId: resident3.id,
      roomId: room101.id,
      checkInDate: "2026-10-15",
      monthlyRent: 8500,
    });
  } catch (err: any) {
    overbookingBlocked = err.message.includes("full capacity") || err.message.includes("No beds available");
  }
  assert(overbookingBlocked, "Overbooking Blocked: Assigning resident to full room rejected");

  // -----------------------------------------------------------------------------
  // TEST SUITE 5: Anti-Double-Booking & Engine-Level Partial Unique Index
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Anti-Double Booking & Partial Unique Index Enforcement");

  // 5a: Application-level check: Resident 1 (already in Room 101) cannot be assigned to Room 102
  let doubleBookingAppBlocked = false;
  try {
    assignResidentToRoom(opsManagerUser, {
      residentId: resident1.id,
      roomId: room102.id,
      checkInDate: "2026-10-15",
      monthlyRent: 14000,
    });
  } catch (err: any) {
    doubleBookingAppBlocked = err.message.includes("already actively assigned");
  }
  assert(doubleBookingAppBlocked, "Application guard prevents assigning already-active resident to a second room");

  // 5b: Engine-level check: Direct SQL insertion of second ACTIVE stay for resident 1
  let dbConstraintViolated = false;
  try {
    db.prepare(`
      INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
      VALUES ('stay_rogue_attempt', ?, ?, '2026-10-15', 14000, 0, 'ACTIVE', datetime('now'), datetime('now'))
    `).run(resident1.id, room102.id);
  } catch (err: any) {
    dbConstraintViolated = err.message.includes("UNIQUE constraint failed: resident_stays.resident_id");
  }
  assert(
    dbConstraintViolated,
    "SQLite partial unique index (idx_unique_active_resident_stay) strictly aborts concurrent duplicate active stay"
  );

  // -----------------------------------------------------------------------------
  // TEST SUITE 6: Check-Out, Instant Capacity Release & Stay History
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 6] Check-Out Workflow, Instant Capacity Release & Stay History");

  // 6a: Check out Resident 1 from Room 101
  checkOutResident(
    opsManagerUser,
    {
      residentId: resident1.id,
      checkOutDate: "2026-10-16",
    },
    "192.168.1.50"
  );

  // 6b: Instant Capacity Release: Room 101 occupancy immediately drops from 2 to 1
  const roomsAfterCheckout = listRooms(opsManagerUser);
  const room101AfterCheckout = roomsAfterCheckout.find((r) => r.id === room101.id);
  assert(
    room101AfterCheckout?.occupiedBeds === 1 && room101AfterCheckout?.availableBeds === 1,
    "Room 101 occupancy immediately releases bed: now 1 occupied and 1 available"
  );

  // 6c: Resident 1 status updated to CHECKED_OUT and currentRoom is null
  const res1AfterCheckout = getResidentById(opsManagerUser, resident1.id);
  assert(res1AfterCheckout?.status === "CHECKED_OUT", "Resident status updated to CHECKED_OUT");
  assert(res1AfterCheckout?.currentRoom === null, "Resident has no active room assignment");
  assert(res1AfterCheckout?.stays.length === 1, "Historical stay preserved in resident stay history");
  const pastStay = res1AfterCheckout?.stays[0];
  assert(
    pastStay?.status === "COMPLETED" && pastStay?.checkOutDate === "2026-10-16",
    "Stay record marked COMPLETED with exact checkOutDate recorded"
  );

  // 6d: Resident 3 can now claim the released bed in Room 101
  const stay3 = assignResidentToRoom(opsManagerUser, {
    residentId: resident3.id,
    roomId: room101.id,
    checkInDate: "2026-10-16",
    monthlyRent: 8500,
    securityDeposit: 17000,
  });
  assert(stay3.status === "ACTIVE", "Resident 3 successfully checked in to released bed in Room 101");

  // 6e: Resident 1 (checked out) can be checked in again in Room 102
  const stay1Recheckin = assignResidentToRoom(opsManagerUser, {
    residentId: resident1.id,
    roomId: room102.id,
    checkInDate: "2026-10-17",
    monthlyRent: 14000,
    securityDeposit: 20000,
  });
  assert(stay1Recheckin.status === "ACTIVE", "Previously checked-out resident re-checks into Room 102");

  // Verify Resident 1 now has 2 stay records: 1 COMPLETED and 1 ACTIVE
  const res1FullHistory = getResidentById(opsManagerUser, resident1.id);
  assert(res1FullHistory?.stays.length === 2, "Resident stay history contains both completed and active stays");
  assert(
    res1FullHistory?.stays.some((s) => s.status === "COMPLETED") &&
      res1FullHistory?.stays.some((s) => s.status === "ACTIVE"),
    "Stay history accurately tracks past and current room assignments"
  );

  // -----------------------------------------------------------------------------
  // TEST SUITE 7: Room Modification & Deactivation Safety Guards
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 7] Room Modification & Deactivation Safety Guards");

  // 7a: Room 101 currently has 2 active occupants (resident2 and resident3).
  // Attempt to reduce capacity from 2 to 1 should be blocked!
  let capacityReductionBlocked = false;
  try {
    updateRoom(opsManagerUser, room101.id, {
      capacity: 1,
    });
  } catch (err: any) {
    capacityReductionBlocked = err.message.includes("Cannot reduce room capacity");
  }
  assert(
    capacityReductionBlocked,
    "Safety Guard: Cannot reduce room capacity below current active occupant count"
  );

  // 7b: Valid update: Room 102 base rent update succeeds
  const updated102 = updateRoom(opsManagerUser, room102.id, {
    baseRentMonthly: 15000,
  });
  assert(updated102.baseRentMonthly === 15000, "Room 102 monthly rent updated successfully");

  // 7c: Attempt to deactivate Room 101 while occupied should be blocked!
  let deactivatingOccupiedRoomBlocked = false;
  try {
    setRoomActiveStatus(opsManagerUser, room101.id, false);
  } catch (err: any) {
    deactivatingOccupiedRoomBlocked = err.message.includes("Cannot deactivate Room");
  }
  assert(
    deactivatingOccupiedRoomBlocked,
    "Safety Guard: Cannot deactivate room that currently has active occupants"
  );

  // 7d: Create a vacant Room 201 and verify deactivating it succeeds
  const room201 = createRoom(opsManagerUser, {
    roomNumber: "201",
    floor: 2,
    type: "TRIPLE_SHARING",
    capacity: 3,
    baseRentMonthly: 7000,
  });
  setRoomActiveStatus(opsManagerUser, room201.id, false);
  const deactivated201 = getRoomById(opsManagerUser, room201.id);
  assert(deactivated201?.isActive === false, "Vacant room successfully deactivated");

  // -----------------------------------------------------------------------------
  // TEST SUITE 8: Server-Side RBAC Enforcement (401 & 403)
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 8] Server-Side RBAC Enforcement on Room & Resident Services");

  // 8a: Unauthenticated caller throws 401
  let unauthRoomBlocked = false;
  try {
    listRooms(null as any);
  } catch (err: any) {
    unauthRoomBlocked = err instanceof AuthorizationError && err.statusCode === 401;
  }
  assert(unauthRoomBlocked, "Unauthenticated listRooms throws HTTP 401 AuthorizationError");

  // 8b: Super Admin and Operations Manager have rooms.manage and residents.manage
  assert(hasPermission(superAdminUser.role, "rooms.manage"), "SUPER_ADMIN has rooms.manage");
  assert(hasPermission(opsManagerUser.role, "rooms.manage"), "OPERATIONS_MANAGER has rooms.manage");
  assert(hasPermission(superAdminUser.role, "residents.manage"), "SUPER_ADMIN has residents.manage");
  assert(hasPermission(opsManagerUser.role, "residents.manage"), "OPERATIONS_MANAGER has residents.manage");

  // 8c: Least Privilege: Accountant can read residents (for billing) but CANNOT manage rooms or residents
  assert(hasPermission(accountantUser.role, "residents.read"), "ACCOUNTANT has residents.read");
  assert(!hasPermission(accountantUser.role, "rooms.manage"), "Least Privilege: ACCOUNTANT lacks rooms.manage");
  assert(!hasPermission(accountantUser.role, "residents.manage"), "Least Privilege: ACCOUNTANT lacks residents.manage");

  let accountantRoomCreateBlocked = false;
  try {
    createRoom(accountantUser, {
      roomNumber: "301",
      floor: 3,
      type: "SINGLE",
      capacity: 1,
      baseRentMonthly: 12000,
    });
  } catch (err: any) {
    accountantRoomCreateBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(accountantRoomCreateBlocked, "Privilege Guard: ACCOUNTANT blocked from createRoom with HTTP 403");

  let accountantAssignBlocked = false;
  try {
    assignResidentToRoom(accountantUser, {
      residentId: resident1.id,
      roomId: room201.id,
      checkInDate: "2026-10-18",
      monthlyRent: 7000,
    });
  } catch (err: any) {
    accountantAssignBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(accountantAssignBlocked, "Privilege Guard: ACCOUNTANT blocked from assignResidentToRoom with HTTP 403");

  // 8d: Least Privilege: Delivery Person has NO access to rooms or residents
  let deliveryRoomsBlocked = false;
  try {
    listRooms(deliveryUser);
  } catch (err: any) {
    deliveryRoomsBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(deliveryRoomsBlocked, "Privilege Guard: DELIVERY_PERSON blocked from listRooms with HTTP 403");

  let deliveryResidentsBlocked = false;
  try {
    listResidents(deliveryUser);
  } catch (err: any) {
    deliveryResidentsBlocked = err instanceof AuthorizationError && err.statusCode === 403;
  }
  assert(deliveryResidentsBlocked, "Privilege Guard: DELIVERY_PERSON blocked from listResidents with HTTP 403");

  // -----------------------------------------------------------------------------
  // TEST SUITE 9: Immutable Audit Logging & Sensitive Data Redaction
  // -----------------------------------------------------------------------------
  console.log("\n[TEST SUITE 9] Immutable Audit Trail Verification");

  const auditEvents = getAuditLogs({ limit: 100 });
  const auditActions = auditEvents.map((e) => e.action);

  assert(auditActions.includes("room.created"), "Audit trail captured room.created event");
  assert(auditActions.includes("room.updated"), "Audit trail captured room.updated event");
  assert(auditActions.includes("room.deactivated"), "Audit trail captured room.deactivated event");
  assert(auditActions.includes("resident.registered"), "Audit trail captured resident.registered event");
  assert(auditActions.includes("resident.checked_in"), "Audit trail captured resident.checked_in event");
  assert(auditActions.includes("resident.checked_out"), "Audit trail captured resident.checked_out event");

  // Check that metadata is clean of sensitive data
  let allMetadataSafe = true;
  for (const log of auditEvents) {
    if (log.metadata) {
      if (
        log.metadata.includes("password") ||
        log.metadata.includes("token_hash") ||
        log.metadata.includes("sessionToken")
      ) {
        allMetadataSafe = false;
        break;
      }
    }
  }
  assert(allMetadataSafe, "All room and resident audit metadata verified free of secrets and tokens");

  // -----------------------------------------------------------------------------
  // CLEANUP & SUMMARY
  // -----------------------------------------------------------------------------
  db.close();
  const { closeDb } = require("../apps/erp/src/server/database/db");
  closeDb();
  cleanupTestDb();

  console.log("\n================================================================================");
  console.log(`FINAL ROOMS & RESIDENTS TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRoomsResidentsTests().catch((err) => {
  console.error("Test runner encountered unhandled error:", err);
  process.exit(1);
});
