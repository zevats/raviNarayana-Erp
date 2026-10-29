import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { closeDb, getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
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
  transferResidentRoom,
  getResidentById,
  listResidents,
} from "../apps/erp/src/server/residents/residentService";
import {
  previewResidentSettlement,
  finalizeResidentCheckoutSettlement,
} from "../apps/erp/src/server/residents/residentSettlementService";
import {
  recordSecurityDeposit,
} from "../apps/erp/src/server/finance/financeService";
import {
  getDashboardMetrics,
  invalidateDashboardCache,
} from "../apps/erp/src/server/dashboard/dashboardService";
import { AuthenticatedUser, RoomType } from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(__dirname, "..", "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test database
const TEST_ROOMS54_DB_PATH = path.resolve(__dirname, "test_task54_rooms.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_ROOMS54_DB_PATH)) fs.unlinkSync(TEST_ROOMS54_DB_PATH);
  const wal = `${TEST_ROOMS54_DB_PATH}-wal`;
  const shm = `${TEST_ROOMS54_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_ROOMS54_DB_PATH;

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
console.log("TASK 01B.54 REGRESSION TEST SUITE: ROOM/BED INTEGRITY & ROOM TRANSFERS");
console.log("================================================================================\n");

async function runTests() {
  // 1. Initialize schema in isolated DB
  console.log("--- 1. Initializing isolated database with schema migrations ---");
  const rawDb = new Database(TEST_ROOMS54_DB_PATH);
  runMigrations(rawDb);
  const userVersion = rawDb.pragma("user_version", { simple: true }) as number;
  assert(userVersion >= 18, `Database user_version successfully advanced to V18 (got ${userVersion})`);

  // Verify rooms & resident_stays tables & indexes exist
  const roomCount = rawDb.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='rooms'").get() as { count: number };
  assert(roomCount.count === 1, "rooms table exists in SQLite test database");

  const staysCount = rawDb.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='resident_stays'").get() as { count: number };
  assert(staysCount.count === 1, "resident_stays table exists in SQLite test database");

  const idxActiveStay = rawDb.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='index' AND name='idx_unique_active_resident_stay'").get() as { count: number };
  assert(idxActiveStay.count === 1, "idx_unique_active_resident_stay partial index exists");
  rawDb.close();

  const db = getAsyncDb();

  // Test Actors
  const adminActor: AuthenticatedUser = {
    id: "usr_admin_54",
    username: "superadmin_54",
    email: "admin54@ravinarayan.com",
    fullName: "Super Admin 54",
    role: "SUPER_ADMIN",
  };

  const opsActor: AuthenticatedUser = {
    id: "usr_ops_54",
    username: "opsmanager_54",
    email: "ops54@ravinarayan.com",
    fullName: "Operations Manager 54",
    role: "OPERATIONS_MANAGER",
  };

  const deliveryActor: AuthenticatedUser = {
    id: "usr_delivery_54",
    username: "courier_54",
    email: "courier54@ravinarayan.com",
    fullName: "Courier Delivery 54",
    role: "DELIVERY_PERSON",
  };

  // Seed staff user in database for foreign keys / audit logs
  await db.execute(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'hash', ?, 1, datetime('now'), datetime('now'))
  `, [adminActor.id, adminActor.username, adminActor.email, adminActor.fullName, adminActor.role]);

  // ===========================================================================
  // TEST SUITE 1: Authoritative Room & Bed Layout Provisioning
  // ===========================================================================
  console.log("\n--- TEST SUITE 1: Authoritative Room & Bed Layout Provisioning ---");

  // Provision Authoritative Property Rooms (22 Rooms, 39 Confirmed Beds)
  // Out-house: OL1–OL5 (Floor 0, Single, 1 bed each)
  const roomOL1 = await createRoom(adminActor, { roomNumber: "OL1", floor: 0, type: "SINGLE", capacity: 1, baseRentMonthly: 12000 }, db);
  const roomOL2 = await createRoom(adminActor, { roomNumber: "OL2", floor: 0, type: "SINGLE", capacity: 1, baseRentMonthly: 12000 }, db);
  const roomOL3 = await createRoom(adminActor, { roomNumber: "OL3", floor: 0, type: "SINGLE", capacity: 1, baseRentMonthly: 12000 }, db);
  const roomOL4 = await createRoom(adminActor, { roomNumber: "OL4", floor: 0, type: "SINGLE", capacity: 1, baseRentMonthly: 12000 }, db);
  const roomOL5 = await createRoom(adminActor, { roomNumber: "OL5", floor: 0, type: "SINGLE", capacity: 1, baseRentMonthly: 12000 }, db);
  assert(roomOL1.roomNumber === "OL1" && roomOL1.capacity === 1, "Provisioned Out-house single room OL1 (capacity 1)");

  // Ground Floor: 001–008 (Double sharing, 2 beds each)
  const room001 = await createRoom(adminActor, { roomNumber: "001", floor: 0, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 8500 }, db);
  const room002 = await createRoom(adminActor, { roomNumber: "002", floor: 0, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 8500 }, db);
  const room003 = await createRoom(adminActor, { roomNumber: "003", floor: 0, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 8500 }, db);
  const room004 = await createRoom(adminActor, { roomNumber: "004", floor: 0, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 8500 }, db);
  const room005 = await createRoom(adminActor, { roomNumber: "005", floor: 0, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 8500 }, db);
  const room006 = await createRoom(adminActor, { roomNumber: "006", floor: 0, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 8500 }, db);
  const room007 = await createRoom(adminActor, { roomNumber: "007", floor: 0, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 8500 }, db);
  const room008 = await createRoom(adminActor, { roomNumber: "008", floor: 0, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 8500 }, db);
  assert(room001.roomNumber === "001" && room001.capacity === 2, "Provisioned Ground Floor room 001 (Double Sharing, capacity 2)");

  // First Floor: 101–102 (Triple sharing, 3 beds each)
  const room101 = await createRoom(adminActor, { roomNumber: "101", floor: 1, type: "TRIPLE_SHARING", capacity: 3, baseRentMonthly: 7000 }, db);
  const room102 = await createRoom(adminActor, { roomNumber: "102", floor: 1, type: "TRIPLE_SHARING", capacity: 3, baseRentMonthly: 7000 }, db);
  assert(room101.capacity === 3 && room102.capacity === 3, "Provisioned First Floor rooms 101 & 102 (Triple Sharing, capacity 3)");

  // First Floor: 103–108 (Double sharing, 2 beds each)
  const room103 = await createRoom(adminActor, { roomNumber: "103", floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 9000 }, db);
  const room104 = await createRoom(adminActor, { roomNumber: "104", floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 9000 }, db);
  const room105 = await createRoom(adminActor, { roomNumber: "105", floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 9000 }, db);
  const room106 = await createRoom(adminActor, { roomNumber: "106", floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 9000 }, db);
  const room107 = await createRoom(adminActor, { roomNumber: "107", floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 9000 }, db);
  const room108 = await createRoom(adminActor, { roomNumber: "108", floor: 1, type: "DOUBLE_SHARING", capacity: 2, baseRentMonthly: 9000 }, db);
  assert(room108.roomNumber === "108" && room108.capacity === 2, "Provisioned First Floor room 108 (Double Sharing, capacity 2)");

  // Upper Floor: M01 (Executive Suite, capacity 2)
  const roomM01 = await createRoom(adminActor, { roomNumber: "M01", floor: 2, type: "EXECUTIVE_SUITE", capacity: 2, baseRentMonthly: 18000 }, db);
  assert(roomM01.roomNumber === "M01" && roomM01.floor === 2, "Provisioned Upper Floor Master Suite M01");

  // Verify total count = 22 rooms
  const allRooms = await listRooms(adminActor, {}, db);
  assert(allRooms.length === 22, `Total rooms in authoritative layout is 22 (got ${allRooms.length})`);
  const totalBedCapacity = allRooms.reduce((sum, r) => sum + r.capacity, 0);
  // 5 (singles) + 8*2 (16) + 2*3 (6) + 6*2 (12) + 2 (M01) = 41 beds
  assert(totalBedCapacity === 41, `Total capacity is 41 beds across 22 rooms (got ${totalBedCapacity})`);

  // Invariant test: Duplicate room number rejection (case-insensitive)
  try {
    await createRoom(adminActor, { roomNumber: "ol1", floor: 0, type: "SINGLE", capacity: 1, baseRentMonthly: 12000 }, db);
    assert(false, "Should have rejected duplicate room number 'ol1' (case-insensitive collision)");
  } catch (err: any) {
    assert(err.message.includes("Room number already exists"), "Rejected duplicate room number 'ol1' correctly");
  }

  // Invariant test: Non-positive capacity rejection
  try {
    await createRoom(adminActor, { roomNumber: "INV01", floor: 0, type: "SINGLE", capacity: 0, baseRentMonthly: 10000 }, db);
    assert(false, "Should have rejected room with capacity 0");
  } catch (err: any) {
    assert(err.message.includes("capacity must be a positive integer"), "Rejected room with capacity 0");
  }

  // Invariant test: Negative rent rejection
  try {
    await createRoom(adminActor, { roomNumber: "INV02", floor: 0, type: "SINGLE", capacity: 1, baseRentMonthly: -500 }, db);
    assert(false, "Should have rejected room with negative base rent");
  } catch (err: any) {
    assert(err.message.includes("base rent cannot be negative"), "Rejected room with negative base rent");
  }

  // ===========================================================================
  // TEST SUITE 2: Floor Filtering & Derived Vacancy Metrics
  // ===========================================================================
  console.log("\n--- TEST SUITE 2: Room Listing, Floor Filtering & Vacancy Metrics ---");

  const groundFloorRooms = await listRooms(adminActor, { floor: 0 }, db);
  // OL1-OL5 (5) + 001-008 (8) = 13 ground floor rooms
  assert(groundFloorRooms.length === 13, `Ground floor has 13 rooms (got ${groundFloorRooms.length})`);

  const firstFloorRooms = await listRooms(adminActor, { floor: 1 }, db);
  // 101-102 (2) + 103-108 (6) = 8 first floor rooms
  assert(firstFloorRooms.length === 8, `First floor has 8 rooms (got ${firstFloorRooms.length})`);

  const secondFloorRooms = await listRooms(adminActor, { floor: 2 }, db);
  // M01 = 1 room
  assert(secondFloorRooms.length === 1, `Second floor has 1 room (got ${secondFloorRooms.length})`);

  const vacantRooms = await listRooms(adminActor, { status: "VACANT" }, db);
  assert(vacantRooms.length === 22, `All 22 rooms currently vacant (got ${vacantRooms.length})`);

  // ===========================================================================
  // TEST SUITE 3: Resident Check-In & Capacity Enforcement
  // ===========================================================================
  console.log("\n--- TEST SUITE 3: Resident Check-In & Capacity Enforcement ---");

  const res1 = await registerResident(adminActor, {
    fullName: "Amit Kumar",
    phone: "9811001101",
    email: "amit.k@example.com",
    emergencyContact: "9811000001",
    notes: "Panasonic engineer",
  }, db);
  assert(res1.fullName === "Amit Kumar", "Registered resident Amit Kumar");

  // Check in Amit to Room OL1 (Single, capacity 1)
  const stayAmit = await assignResidentToRoom(adminActor, {
    residentId: res1.id,
    roomId: roomOL1.id,
    checkInDate: "2026-10-01",
    monthlyRent: 12000,
    securityDeposit: 12000,
  }, db);
  assert(stayAmit.status === "ACTIVE" && stayAmit.roomNumber === "OL1", "Amit checked in to Room OL1");

  // Verify OL1 occupancy is now 1/1
  const updatedOL1 = await getRoomById(adminActor, roomOL1.id, db);
  assert(updatedOL1?.occupiedBeds === 1 && updatedOL1?.availableBeds === 0, "Room OL1 has 1 occupied bed, 0 available beds");

  // Register resident 2
  const res2 = await registerResident(adminActor, {
    fullName: "Vikas Sharma",
    phone: "9811001102",
    email: "vikas.s@example.com",
  }, db);

  // Attempt to check in Vikas to full room OL1 -> Must reject
  try {
    await assignResidentToRoom(adminActor, {
      residentId: res2.id,
      roomId: roomOL1.id,
      checkInDate: "2026-10-02",
      monthlyRent: 12000,
    }, db);
    assert(false, "Should have rejected check-in to full room OL1");
  } catch (err: any) {
    assert(err.message.includes("full capacity"), `Rejected check-in to full room OL1: ${err.message}`);
  }

  // Invariant test: Resident cannot have two active stays
  try {
    await assignResidentToRoom(adminActor, {
      residentId: res1.id,
      roomId: roomOL2.id,
      checkInDate: "2026-10-02",
      monthlyRent: 12000,
    }, db);
    assert(false, "Should have rejected duplicate active room assignment for Amit");
  } catch (err: any) {
    assert(err.message.includes("already actively assigned"), `Prevented duplicate active check-in for resident: ${err.message}`);
  }

  // ===========================================================================
  // TEST SUITE 4: Atomic Room Transfer Workflow
  // ===========================================================================
  console.log("\n--- TEST SUITE 4: Atomic Room Transfer Workflow ---");

  // Register resident 3: Rahul Yadav
  const res3 = await registerResident(adminActor, {
    fullName: "Rahul Yadav",
    phone: "9811001103",
    email: "rahul.y@example.com",
  }, db);

  // Assign Rahul to Room 001 (Double sharing, capacity 2, rent 8500, deposit 10000)
  const stayRahul = await assignResidentToRoom(adminActor, {
    residentId: res3.id,
    roomId: room001.id,
    checkInDate: "2026-10-05",
    monthlyRent: 8500,
    securityDeposit: 10000,
  }, db);
  assert(stayRahul.status === "ACTIVE", "Rahul checked in to Room 001");

  // Post collected security deposit to financial ledger
  await recordSecurityDeposit(adminActor, {
    residentId: res3.id,
    stayId: stayRahul.id,
    amount: 10000,
    paymentMethod: "UPI",
    transactionDate: "2026-10-05",
  }, db);

  // Room 001 occupancy: 1/2. Room 002 occupancy: 0/2.
  const r001Before = await getRoomById(adminActor, room001.id, db);
  const r002Before = await getRoomById(adminActor, room002.id, db);
  assert(r001Before?.occupiedBeds === 1 && r002Before?.occupiedBeds === 0, "Before transfer: Room 001 has 1 occupant, Room 002 has 0");

  // Execute Atomic Room Transfer: Rahul moves from Room 001 to Room 002 on 2026-10-15
  const transferResult = await transferResidentRoom(opsActor, {
    residentId: res3.id,
    targetRoomId: room002.id,
    transferDate: "2026-10-15",
    newMonthlyRent: 8800,
    reason: "Resident requested relocation closer to window",
  }, db);

  assert(transferResult.residentId === res3.id, "Transfer result contains residentId");
  assert(transferResult.previousRoomNumber === "001", "Transfer result shows previous Room 001");
  assert(transferResult.newRoomNumber === "002", "Transfer result shows destination Room 002");
  assert(transferResult.newMonthlyRent === 8800, "Transfer applied new monthly rent 8800");
  assert(transferResult.securityDepositCarried === 10000, "Security deposit (10000) carried forward without re-billing");

  // Inspect database state after transfer
  const r001After = await getRoomById(adminActor, room001.id, db);
  const r002After = await getRoomById(adminActor, room002.id, db);
  assert(r001After?.occupiedBeds === 0 && r001After?.availableBeds === 2, "Room 001 bed immediately released (0/2 occupied)");
  assert(r002After?.occupiedBeds === 1 && r002After?.availableBeds === 1, "Room 002 bed immediately occupied (1/2 occupied)");

  // Inspect stay history of resident 3
  const rahulProfile = await getResidentById(adminActor, res3.id, db);
  assert(rahulProfile?.status === "ACTIVE", "Resident Rahul remains ACTIVE");
  assert(rahulProfile?.currentRoom?.roomNumber === "002", "Current active room is Room 002");
  assert(rahulProfile?.currentRoom?.monthlyRent === 8800, "Current rent is 8800");
  assert(rahulProfile?.currentRoom?.securityDeposit === 10000, "Active stay has carried forward security deposit");
  assert(rahulProfile?.stays.length === 2, `Resident has 2 stays in history (got ${rahulProfile?.stays.length})`);

  const prevStay = rahulProfile?.stays.find((s) => s.id === stayRahul.id);
  assert(prevStay?.status === "COMPLETED", "Previous stay in Room 001 marked COMPLETED");
  assert(prevStay?.checkOutDate === "2026-10-15", `Previous stay check-out date set to transfer date (2026-10-15)`);

  const newStay = rahulProfile?.stays.find((s) => s.id === transferResult.newStayId);
  assert(newStay?.status === "ACTIVE", "New stay in Room 002 marked ACTIVE");
  assert(newStay?.checkInDate === "2026-10-15", `New stay check-in date set to transfer date (2026-10-15)`);

  // Verify Audit Log
  const auditLogs = await db.query<any>(
    "SELECT * FROM audit_logs WHERE action = 'resident.room_transferred' AND target_id = ?",
    [res3.id]
  );
  assert(auditLogs.length === 1, "Audit log record created for room transfer");
  const auditMeta = JSON.parse(auditLogs[0].metadata);
  assert(auditMeta.previousRoomNumber === "001" && auditMeta.newRoomNumber === "002", "Audit log contains from/to room details");
  assert(auditMeta.securityDepositCarried === 10000, "Audit log records security deposit carried forward");

  // Verify financial transactions re-linked to new stay ID
  const depositTx = await db.queryOne<any>(
    "SELECT stay_id as stayId FROM financial_transactions WHERE resident_id = ? AND transaction_type = 'SECURITY_DEPOSIT'",
    [res3.id]
  );
  assert(depositTx?.stayId === transferResult.newStayId, "Financial transaction stay_id seamlessly transferred to new stay ID");

  // ===========================================================================
  // TEST SUITE 5: Room Transfer Invariant & Error Handling
  // ===========================================================================
  console.log("\n--- TEST SUITE 5: Room Transfer Invariant & Error Handling ---");

  // 1. Reject transfer to same room
  try {
    await transferResidentRoom(adminActor, {
      residentId: res3.id,
      targetRoomId: room002.id,
      transferDate: "2026-10-16",
      reason: "Self transfer test",
    }, db);
    assert(false, "Should have rejected transfer to same room");
  } catch (err: any) {
    assert(err.message.includes("Cannot transfer to the same room"), `Rejected transfer to same room: ${err.message}`);
  }

  // 2. Reject transfer if transfer date precedes check-in date
  try {
    await transferResidentRoom(adminActor, {
      residentId: res3.id,
      targetRoomId: room003.id,
      transferDate: "2026-10-10", // Check in was 2026-10-15
      reason: "Backdated transfer test",
    }, db);
    assert(false, "Should have rejected transfer earlier than current check-in date");
  } catch (err: any) {
    assert(err.message.includes("cannot be earlier than current stay check-in date"), `Rejected premature transfer date: ${err.message}`);
  }

  // 3. Reject transfer to full room (Room OL1 has 1/1 occupied)
  try {
    await transferResidentRoom(adminActor, {
      residentId: res3.id,
      targetRoomId: roomOL1.id,
      transferDate: "2026-10-16",
      reason: "Transfer to full room",
    }, db);
    assert(false, "Should have rejected transfer to full room");
  } catch (err: any) {
    assert(err.message.includes("full capacity"), `Rejected transfer to full room: ${err.message}`);
  }

  // 4. Reject transfer to deactivated room
  await setRoomActiveStatus(adminActor, room008.id, false, db);
  try {
    await transferResidentRoom(adminActor, {
      residentId: res3.id,
      targetRoomId: room008.id,
      transferDate: "2026-10-16",
      reason: "Transfer to inactive room",
    }, db);
    assert(false, "Should have rejected transfer to inactive room");
  } catch (err: any) {
    assert(err.message.includes("currently inactive"), `Rejected transfer to inactive room: ${err.message}`);
  }
  // Reactivate room 008
  await setRoomActiveStatus(adminActor, room008.id, true, db);

  // 5. Reject transfer if resident has no active stay (e.g. unassigned resident 2)
  try {
    await transferResidentRoom(adminActor, {
      residentId: res2.id,
      targetRoomId: room003.id,
      transferDate: "2026-10-16",
      reason: "Transfer unassigned resident",
    }, db);
    assert(false, "Should have rejected transfer of unassigned resident");
  } catch (err: any) {
    assert(err.message.includes("no active room assignment"), `Rejected transfer of unassigned resident: ${err.message}`);
  }

  // 6. Reject transfer if reason is missing or too short
  try {
    await transferResidentRoom(adminActor, {
      residentId: res3.id,
      targetRoomId: room003.id,
      transferDate: "2026-10-16",
      reason: "xyz", // < 5 chars
    }, db);
    assert(false, "Should have rejected short transfer reason");
  } catch (err: any) {
    assert(err.message.includes("minimum 5 characters"), `Rejected short transfer reason: ${err.message}`);
  }

  // ===========================================================================
  // TEST SUITE 6: Concurrency & Transactional Rollback
  // ===========================================================================
  console.log("\n--- TEST SUITE 6: Transactional Integrity & Rollback Protection ---");

  // Verify that an aborted transfer leaves the active stay completely intact
  const stayCountBeforeFail = (await getResidentById(adminActor, res3.id, db))?.stays.length;
  try {
    await transferResidentRoom(adminActor, {
      residentId: res3.id,
      targetRoomId: "non_existent_room_id",
      transferDate: "2026-10-16",
      reason: "Will fail on non-existent room",
    }, db);
  } catch (err: any) {
    assert(err.message.includes("not found"), "Failed cleanly on non-existent room");
  }

  const res3AfterFail = await getResidentById(adminActor, res3.id, db);
  assert(res3AfterFail?.currentRoom?.roomNumber === "002", "Resident remains safely in Room 002 after aborted transfer");
  assert(res3AfterFail?.stays.length === stayCountBeforeFail, "No phantom stay rows created on aborted transfer");

  // ===========================================================================
  // TEST SUITE 7: Subsequent Checkout & Settlement Integration (Task 01B.52)
  // ===========================================================================
  console.log("\n--- TEST SUITE 7: Checkout & Settlement Integration after Room Transfer ---");

  // Rahul (transferred to Room 002) checks out on 2026-10-31
  const settlementPreview = await previewResidentSettlement(adminActor, res3.id, "2026-10-31", db);
  assert(settlementPreview.roomNumber === "002", "Checkout preview references current transferred room (002)");
  assert(settlementPreview.totalDepositHeld === 10000, `Checkout preview recognizes carried-forward deposit: ₹${settlementPreview.totalDepositHeld}`);
  assert(settlementPreview.refundableDepositAvailable === 10000, `Refundable deposit available is ₹${settlementPreview.refundableDepositAvailable}`);

  // Finalize settlement and checkout
  const settlementRecord = await finalizeResidentCheckoutSettlement(adminActor, {
    residentId: res3.id,
    checkOutDate: "2026-10-31",
    refundAmount: 10000,
    refundPaymentMethod: "UPI",
    refundReference: "UPI-SETTLE-T54",
    notes: "Full deposit refunded on scheduled departure",
  }, db);

  assert(settlementRecord.roomNumber === "002", "Settlement record finalized for Room 002");
  assert(settlementRecord.refundAmount === 10000, "Settlement refunded full carried-forward deposit");

  // Verify Room 002 bed is immediately released
  const r002AfterCheckout = await getRoomById(adminActor, room002.id, db);
  assert(r002AfterCheckout?.occupiedBeds === 0 && r002AfterCheckout?.availableBeds === 2, "Room 002 bed released upon final settlement checkout (0/2 occupied)");

  // Verify resident status is CHECKED_OUT
  const rahulFinal = await getResidentById(adminActor, res3.id, db);
  assert(rahulFinal?.status === "CHECKED_OUT", "Resident Rahul status set to CHECKED_OUT");
  assert(rahulFinal?.currentRoom === null, "Current room is null after checkout");

  // ===========================================================================
  // TEST SUITE 8: Dashboard Metrics Occupancy Integrity
  // ===========================================================================
  console.log("\n--- TEST SUITE 8: Dashboard Metrics Occupancy Integrity ---");

  invalidateDashboardCache();
  const metrics = await getDashboardMetrics(db, true);
  assert(metrics.occupancy.totalRooms === 22, `Dashboard reports 22 total active rooms (got ${metrics.occupancy.totalRooms})`);
  assert(metrics.occupancy.totalCapacity === 41, `Dashboard reports 41 total bed capacity (got ${metrics.occupancy.totalCapacity})`);
  // Only Amit in Room OL1 is active
  assert(metrics.occupancy.occupiedBeds === 1, `Dashboard reports exactly 1 occupied bed (got ${metrics.occupancy.occupiedBeds})`);
  assert(metrics.occupancy.vacantBeds === 40, `Dashboard reports 40 vacant beds (got ${metrics.occupancy.vacantBeds})`);

  // ===========================================================================
  // TEST SUITE 9: RBAC & Permission Enforcement
  // ===========================================================================
  console.log("\n--- TEST SUITE 9: RBAC & Permission Enforcement ---");

  // Delivery person attempting room transfer -> Must be denied (residents.manage required)
  try {
    await transferResidentRoom(deliveryActor, {
      residentId: res1.id,
      targetRoomId: roomOL2.id,
      transferDate: "2026-10-15",
      reason: "Unauthorized transfer attempt",
    }, db);
    assert(false, "Should have rejected unauthorized transfer by DELIVERY_PERSON");
  } catch (err: any) {
    assert(err.message.includes("Access denied") || err.message.includes("Forbidden") || err.message.includes("residents.manage"), `Rejected unauthorized transfer attempt: ${err.message}`);
  }

  // Delivery person attempting room creation -> Must be denied (rooms.manage required)
  try {
    await createRoom(deliveryActor, {
      roomNumber: "UNAUTH1",
      floor: 0,
      type: "SINGLE",
      capacity: 1,
      baseRentMonthly: 10000,
    }, db);
    assert(false, "Should have rejected unauthorized room creation by DELIVERY_PERSON");
  } catch (err: any) {
    assert(err.message.includes("Access denied") || err.message.includes("Forbidden") || err.message.includes("rooms.manage"), `Rejected unauthorized room creation: ${err.message}`);
  }

  // ===========================================================================
  // Primary Database Safety Invariant Verification
  // ===========================================================================
  console.log("\n--- Primary Database Safety Verification ---");
  if (primaryStatsBefore) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs, "Primary database (data/erp.db) mtime is completely unchanged");
    assert(primaryStatsBefore.size === primaryStatsAfter.size, "Primary database (data/erp.db) size is completely unchanged");
  }

  console.log("\n================================================================================");
  console.log(`TASK 01B.54 REGRESSION TESTS COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed with fatal error:", err);
  process.exit(1);
});
