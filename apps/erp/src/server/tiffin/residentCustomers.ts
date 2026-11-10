import type { AuthenticatedUser } from "../../types";
import type { AsyncDb } from "../database/db";
import { getAsyncDb } from "../database/db";
import { hasPermission } from "../authorization/permissions";
import { createTiffinCustomer, normalizePhoneNumber } from "./tiffinService";

/**
 * PG residents are tiffin customers too (type "PG Resident"): registering a resident adds them to
 * Tiffin customers, and residents registered earlier are added the first time the customer list is
 * opened. Only missing customers are added: an existing customer with the same phone is left as
 * it is. A failure here never blocks registering a resident or listing customers.
 */
const PG_ADDRESS = "Ravinarayan PG";

async function customerPhones(db: AsyncDb): Promise<Set<string>> {
  const rows = await db.query<{ phone: string }>("SELECT phone FROM tiffin_customers");
  const out = new Set<string>();
  for (const r of rows) {
    const d = String(r.phone || "").replace(/\D/g, "");
    if (d) out.add(d.slice(-10));
  }
  return out;
}

export async function ensureResidentCustomer(
  actor: AuthenticatedUser,
  resident: { fullName: string; phone: string; roomNumber?: string | null },
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<"created" | "exists" | "skipped"> {
  try {
    if (!hasPermission(actor.role, "tiffin.manage")) return "skipped";
    const db = asyncDb || getAsyncDb();
    let phone: string;
    try {
      phone = normalizePhoneNumber(resident.phone);
    } catch {
      return "skipped";
    }
    const digits = phone.replace(/\D/g, "").slice(-10);
    if ((await customerPhones(db)).has(digits)) return "exists";
    await createTiffinCustomer(
      actor,
      {
        fullName: resident.fullName,
        phone,
        deliveryAddress: resident.roomNumber ? `Room ${resident.roomNumber}, ${PG_ADDRESS}` : PG_ADDRESS,
        customerType: "RESIDENTIAL_PG",
        notes: "PG resident",
      },
      clientIp,
      db
    );
    return "created";
  } catch {
    return "skipped";
  }
}

let lastSync = 0;
/** Adds every resident who is not yet a tiffin customer (at most every 10 minutes per process). */
export async function syncResidentCustomers(actor: AuthenticatedUser, asyncDb?: AsyncDb): Promise<number> {
  if (Date.now() - lastSync < 10 * 60_000) return 0;
  if (!hasPermission(actor.role, "tiffin.manage")) return 0;
  lastSync = Date.now();
  try {
    const db = asyncDb || getAsyncDb();
    const residents = await db.query<{ full_name: string; phone: string; room_number: string | null }>(
      `SELECT r.full_name, r.phone, rm.room_number
       FROM residents r
       LEFT JOIN resident_stays s ON s.resident_id = r.id AND s.status = 'ACTIVE'
       LEFT JOIN rooms rm ON rm.id = s.room_id
       WHERE r.status = 'ACTIVE'`
    );
    const have = await customerPhones(db);
    let added = 0;
    for (const r of residents) {
      const d = String(r.phone || "").replace(/\D/g, "").slice(-10);
      if (!d || have.has(d)) continue;
      const res = await ensureResidentCustomer(actor, { fullName: r.full_name, phone: r.phone, roomNumber: r.room_number }, undefined, db);
      if (res === "created") {
        added++;
        have.add(d);
      }
    }
    return added;
  } catch {
    lastSync = 0;
    return 0;
  }
}
