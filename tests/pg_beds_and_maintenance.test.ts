/**
 * Live PostgreSQL verification of individual beds and room maintenance (Phase 3, migration 0017):
 * beds created with rooms and kept equal to capacity, bed choice at check-in and transfer, no
 * double allocation (including concurrent check-ins), residents from before beds kept without a
 * bed until placed, out-of-service beds, and maintenance blocking new residents without touching
 * the residents already living there.
 * Disposable local database only (RN_PG_VERIFY_URL); synthetic data.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createRoom, updateRoom, getRoomById, deleteRoom } from "../apps/erp/src/server/rooms/roomService";
import { registerResident, assignResidentToRoom, transferResidentRoom } from "../apps/erp/src/server/residents/residentService";
import { updateBed, placeResidentInBed, startRoomMaintenance, completeRoomMaintenance, listRoomMaintenance, addBed, removeBed } from "../apps/erp/src/server/rooms/bedService";
import { AuthenticatedUser } from "../apps/erp/src/types";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff, uniqueBusinessDate } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = "127.0.0.1";
const rnd = () => crypto.randomBytes(3).toString("hex");
const phone = () => `9${crypto.randomInt(100000000, 999999999)}`;

async function rejects(label: string, fn: () => Promise<unknown>, pattern: RegExp) {
  let err: any = null;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  assert(err !== null && pattern.test(String(err.message)), `${label}${err ? ` (${err.message})` : " — NOT rejected"}`);
}

async function main() {
  console.log("================================================================================");
  console.log("PG BEDS AND ROOM MAINTENANCE (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const owner = await insertStaff(db, "SUPER_ADMIN", "Beds Owner");
  const manager = await insertStaff(db, "OPERATIONS_MANAGER", "Beds Manager");
  const day = uniqueBusinessDate(600);
  const resident = async () => (await registerResident(manager, { fullName: `Bed Resident ${rnd()}`, phone: phone() }, IP, db)).id as string;
  const mkRoom = async (capacity: number) =>
    createRoom(manager, { roomNumber: `B${rnd()}`.toUpperCase(), floor: 1, type: capacity > 1 ? "DOUBLE_SHARING" : "SINGLE", capacity, baseRentMonthly: 7000 } as any, IP, db);
  const room = async (id: string) => (await getRoomById(manager, id, db))!;

  console.log("\n--- 1. Beds come with the room ---");
  const r1 = await mkRoom(2);
  let v = await room(r1.id);
  assert(v.beds?.length === 2 && v.beds.map((b) => b.label).join(",") === "Bed 1,Bed 2" && v.inServiceBeds === 2 && v.availableBeds === 2, "New room with capacity 2 has Bed 1 and Bed 2, both free");

  console.log("\n--- 2. Bed choice and no double allocation ---");
  const bed1 = v.beds![0].id;
  const A = await resident();
  await assignResidentToRoom(manager, { residentId: A, roomId: r1.id, checkInDate: day, monthlyRent: 7000, bedId: bed1 }, IP, db);
  v = await room(r1.id);
  assert(v.beds![0].occupant?.residentId === A && v.occupants?.[0].bedLabel === "Bed 1", "Resident A is in Bed 1");
  const B = await resident();
  await rejects("A taken bed cannot be given to someone else", () => assignResidentToRoom(manager, { residentId: B, roomId: r1.id, checkInDate: day, monthlyRent: 7000, bedId: bed1 }, IP, db), /already taken/);
  const other = await mkRoom(1);
  await rejects("A bed from another room is refused", () => assignResidentToRoom(manager, { residentId: B, roomId: other.id, checkInDate: day, monthlyRent: 7000, bedId: bed1 }, IP, db), /not in Room/);
  await assignResidentToRoom(manager, { residentId: B, roomId: r1.id, checkInDate: day, monthlyRent: 7000 }, IP, db);
  v = await room(r1.id);
  assert(v.availableBeds === 0 && v.occupants?.find((o) => o.residentId === B)?.bedId === null, "Without a bed choice B still checks in (bed to be chosen later); the room is full");
  const C = await resident();
  await rejects("Full room refuses a third resident", () => assignResidentToRoom(manager, { residentId: C, roomId: r1.id, checkInDate: day, monthlyRent: 7000 }, IP, db), /full capacity|no free bed|is full/i);

  console.log("\n--- 3. Concurrent check-ins for one bed ---");
  const r2 = await mkRoom(2);
  const r2bed = (await room(r2.id)).beds![0].id;
  const [X, Y] = [await resident(), await resident()];
  const both = await Promise.allSettled([X, Y].map((rid) => assignResidentToRoom(manager, { residentId: rid, roomId: r2.id, checkInDate: day, monthlyRent: 7000, bedId: r2bed }, IP, db)));
  const okCount = both.filter((x) => x.status === "fulfilled").length;
  const holders = await db.queryOne<any>("SELECT COUNT(*) AS n FROM resident_stays WHERE bed_id = ? AND status = 'ACTIVE'", [r2bed]);
  assert(okCount === 1 && Number(holders.n) === 1, `Two people booking the same bed at once: exactly one gets it (${okCount} succeeded)`);

  console.log("\n--- 4. Residents from before beds, placing them, out of service ---");
  const legacy = await mkRoom(2);
  const L = await resident();
  const legacyStay = `stay_legacy_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.execute("INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, status, created_at, updated_at) VALUES (?, ?, ?, ?, 7000, 'ACTIVE', ?, ?)", [legacyStay, L, legacy.id, day, now, now]);
  v = await room(legacy.id);
  assert(v.occupants?.[0].bedId === null && v.availableBeds === 1, "A stay from before beds keeps no bed and still uses one place");
  const lBed2 = v.beds![1].id;
  await placeResidentInBed(manager, legacyStay, lBed2, IP, db);
  v = await room(legacy.id);
  assert(v.beds![1].occupant?.residentId === L, "Placing that resident in Bed 2 records it");
  await rejects("An occupied bed cannot go out of service", () => updateBed(manager, lBed2, { status: "OUT_OF_SERVICE" }, IP, db), /is in this bed/);
  await updateBed(manager, v.beds![0].id, { status: "OUT_OF_SERVICE", notes: "Broken frame" }, IP, db);
  v = await room(legacy.id);
  // Owner, 2026-11-12: beds and maintenance are no longer managed on screen; an old out-of-service
  // mark no longer closes a bed (the room takes residents up to its capacity).
  assert(v.inServiceBeds === 2 && v.availableBeds === 1, "An old out-of-service mark no longer closes the free bed");
  await rejects("Removing a bed with history is refused", () => removeBed(manager, lBed2, IP, db), /history/);

  console.log("\n--- 5. Capacity follows the beds ---");
  await updateRoom(manager, r1.id, { capacity: 3 } as any, IP, db);
  v = await room(r1.id);
  assert(v.capacity === 3 && v.beds?.length === 3 && v.availableBeds === 1, "Capacity 3 adds Bed 3");
  await rejects("Capacity cannot drop below the residents living there", () => updateRoom(manager, r1.id, { capacity: 1 } as any, IP, db), /Cannot reduce|in use/);
  const added = await addBed(manager, r1.id, "Window bed", IP, db);
  assert((await room(r1.id)).capacity === 4 && added.label === "Window bed", "Adding a named bed raises capacity to 4");
  await removeBed(manager, added.id, IP, db);
  assert((await room(r1.id)).capacity === 3, "Removing an unused bed lowers capacity to 3");

  console.log("\n--- 6. Maintenance ---");
  await startRoomMaintenance(manager, r1.id, { reason: "Bathroom repair", startDate: day }, IP, db);
  v = await room(r1.id);
  const stays = await db.query<any>("SELECT status FROM resident_stays WHERE room_id = ? AND status = 'ACTIVE'", [r1.id]);
  assert(v.maintenance === null && v.availableBeds === 1 && stays.length === 2, "An open maintenance record no longer closes the room: the free bed is still offered, both residents stay");
  const T = await resident();
  await assignResidentToRoom(manager, { residentId: T, roomId: other.id, checkInDate: day, monthlyRent: 7000 }, IP, db);
  await transferResidentRoom(manager, { residentId: T, targetRoomId: r1.id, transferDate: day, reason: "Wants a bigger room", bedId: (await room(r1.id)).beds![2].id }, IP, db);
  v = await room(r1.id);
  assert(v.beds![2].occupant?.residentId === T, "A transfer into the room works while an old maintenance record is open");
  await rejects("A second open maintenance is refused", () => startRoomMaintenance(manager, r1.id, { reason: "Paint" }, IP, db), /already under maintenance/);
  await completeRoomMaintenance(manager, r1.id, { endDate: day, note: "Tiles replaced" }, IP, db);
  const hist = await listRoomMaintenance(manager, r1.id, db);
  assert(hist.length === 1 && hist[0].status === "COMPLETED" && hist[0].completionNote === "Tiles replaced", "History keeps the completed maintenance with its note");
  await rejects("A room with maintenance history cannot be deleted", async () => {
    await db.execute("UPDATE resident_stays SET status = 'COMPLETED', check_out_date = ? WHERE room_id = ? AND status = 'ACTIVE'", [day, other.id]);
    const empty = await mkRoom(1);
    await startRoomMaintenance(manager, empty.id, { reason: "Wiring" }, IP, db);
    await completeRoomMaintenance(manager, empty.id, {}, IP, db);
    await deleteRoom(owner, empty.id, IP, db);
  }, /older records/);
  const unused = await mkRoom(2);
  await deleteRoom(owner, unused.id, IP, db);
  const left = await db.queryOne<any>("SELECT COUNT(*) AS n FROM room_beds WHERE room_id = ?", [unused.id]);
  assert(Number(left.n) === 0, "Deleting an unused room removes its unused beds with it");

  console.log(`\nPG BEDS AND MAINTENANCE: ${state.passed} PASSED, ${state.failed} FAILED`);
  await closePg();
  process.exit(state.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  await closePg().catch(() => {});
  process.exit(1);
});
