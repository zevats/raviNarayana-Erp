import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { recordAuditEventAsync } from "../audit/audit";
import { AuthenticatedUser } from "@/types";

/**
 * Business settings (migration 0016). Every setting here has a consumer in the application; a key
 * without a saved row uses its default, which is the behaviour before settings existed. Values are
 * read from the database (shared by every server instance); each instance keeps a copy for at most
 * CACHE_MS, and a save refreshes the saving instance immediately.
 */

export interface BusinessSettings {
  business: {
    /** Invoice header and emails. */
    name: string;
    /** Printed on invoices. */
    phone: string;
    /** Printed on invoices. */
    email: string;
    /** Invoice header. */
    address: string;
    /** "Public Site" link in the ERP menu (hidden when empty). */
    websiteUrl: string;
  };
  meals: {
    /** Delivery list preparation time (HH:MM, IST) and cancellation cutoff, per meal. */
    lunchPrepareAt: string;
    lunchCutoffAt: string;
    dinnerPrepareAt: string;
    dinnerCutoffAt: string;
  };
  delivery: {
    /** Staff id of the delivery partner new orders go to; null = automatic (the existing rule). */
    defaultDriverId: string | null;
  };
  finance: {
    /** Day of the month (1–28) monthly rent is charged automatically; null = automatic rent off. */
    rentDueDay: number | null;
  };
  notifications: {
    subscriptionExpiry: boolean;
    pendingHandover: boolean;
    closingReminder: boolean;
  };
}

export type SettingsSection = keyof BusinessSettings;

/** Defaults for a deployment that has never saved a setting (matches the behaviour before 0016). */
export function defaultSettings(): BusinessSettings {
  return {
    business: {
      name: (process.env.ERP_COMPANY_NAME || "Ravinarayan PG Guesthouse").trim(),
      phone: "",
      email: "",
      address: (process.env.ERP_COMPANY_ADDRESS || "").trim(),
      websiteUrl: (process.env.NEXT_PUBLIC_WEBSITE_URL || "").trim(),
    },
    meals: { lunchPrepareAt: "08:00", lunchCutoffAt: "07:30", dinnerPrepareAt: "15:30", dinnerCutoffAt: "15:00" },
    delivery: { defaultDriverId: null },
    finance: { rentDueDay: null },
    notifications: { subscriptionExpiry: true, pendingHandover: true, closingReminder: true },
  };
}

const CACHE_MS = 10_000;
let cached: { at: number; value: BusinessSettings } | null = null;
let tableMissingUntil = 0;

function isMissingTable(err: any): boolean {
  return /business_settings/.test(String(err?.message)) && /does not exist|no such table/i.test(String(err?.message));
}

/** Current settings: saved values over defaults. Never throws for a database without migration 0016. */
export async function getSettings(asyncDb?: AsyncDb, fresh = false): Promise<BusinessSettings> {
  const now = Date.now();
  if (!fresh && cached && now - cached.at < CACHE_MS) return cached.value;
  const merged = defaultSettings();
  if (now < tableMissingUntil) return merged;
  const db = asyncDb ?? getAsyncDb();
  let rows: Array<{ key: string; value: string }> = [];
  try {
    if (db.isPostgres) {
      const t = await db.queryOne<{ t: string | null }>("SELECT to_regclass('public.business_settings')::text AS t");
      if (!t?.t) {
        tableMissingUntil = now + 60_000;
        return merged;
      }
    }
    rows = await db.query<{ key: string; value: string }>("SELECT key, value FROM business_settings");
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    tableMissingUntil = now + 60_000;
    return merged;
  }
  for (const row of rows) {
    const [section, field] = row.key.split(".") as [SettingsSection, string];
    const target = (merged as any)[section];
    if (!target || !(field in target)) continue;
    try {
      target[field] = JSON.parse(row.value);
    } catch {
      // A malformed stored value keeps the default.
    }
  }
  cached = { at: now, value: merged };
  return merged;
}

/** Test seam and post-save refresh. */
export function clearSettingsCache(): void {
  cached = null;
  tableMissingUntil = 0;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

async function validateSection(db: AsyncDb, section: SettingsSection, input: any): Promise<Record<string, unknown>> {
  if (!input || typeof input !== "object") throw new Error("Nothing to save.");
  const str = (v: unknown, label: string, max: number) => {
    if (v === undefined || v === null) return "";
    if (typeof v !== "string") throw new Error(`${label} must be text.`);
    const t = v.trim();
    if (t.length > max) throw new Error(`${label} is too long (at most ${max} characters).`);
    return t;
  };
  switch (section) {
    case "business": {
      const out = {
        name: str(input.name, "Business name", 120),
        phone: str(input.phone, "Business phone", 20),
        email: str(input.email, "Business email", 120),
        address: str(input.address, "Business address", 300),
        websiteUrl: str(input.websiteUrl, "Website address", 200),
      };
      if (!out.name) throw new Error("Business name is required.");
      if (out.phone && !/^[+\d][\d\s-]{6,18}$/.test(out.phone)) throw new Error("Enter a valid phone number.");
      if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new Error("Enter a valid email address.");
      if (out.websiteUrl) {
        let url: URL;
        try {
          url = new URL(out.websiteUrl);
        } catch {
          throw new Error("Website address must be a full address, like https://ravinarayan.in");
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Website address must start with https://");
      }
      return out;
    }
    case "meals": {
      const out: Record<string, string> = {};
      for (const k of ["lunchPrepareAt", "lunchCutoffAt", "dinnerPrepareAt", "dinnerCutoffAt"]) {
        const v = String(input[k] ?? "").trim();
        if (!HHMM.test(v)) throw new Error("Times must be in 24-hour HH:MM format, like 07:30.");
        out[k] = v;
      }
      if (minutes(out.lunchCutoffAt) > minutes(out.lunchPrepareAt)) throw new Error("The lunch cutoff must be at or before the lunch list time.");
      if (minutes(out.dinnerCutoffAt) > minutes(out.dinnerPrepareAt)) throw new Error("The dinner cutoff must be at or before the dinner list time.");
      if (minutes(out.dinnerPrepareAt) <= minutes(out.lunchPrepareAt)) throw new Error("The dinner list time must be after the lunch list time.");
      return out;
    }
    case "delivery": {
      const id = input.defaultDriverId === null || input.defaultDriverId === "" || input.defaultDriverId === undefined ? null : String(input.defaultDriverId).trim();
      if (id) {
        const staff = await db.queryOne<{ role: string; is_active: number | boolean }>("SELECT role, is_active FROM staff_users WHERE id = ?", [id]);
        if (!staff || staff.role !== "DELIVERY_PERSON") throw new Error("Choose a delivery staff account.");
        if (!Number(staff.is_active)) throw new Error("That delivery staff account is switched off.");
      }
      return { defaultDriverId: id };
    }
    case "finance": {
      const raw = input.rentDueDay;
      if (raw === null || raw === "" || raw === undefined) return { rentDueDay: null };
      const day = Number(raw);
      if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error("Rent due day must be a whole number from 1 to 28.");
      return { rentDueDay: day };
    }
    case "notifications": {
      const out: Record<string, boolean> = {};
      for (const k of ["subscriptionExpiry", "pendingHandover", "closingReminder"]) {
        if (typeof input[k] !== "boolean") throw new Error("Notification choices must be on or off.");
        out[k] = input[k];
      }
      return out;
    }
    default:
      throw new Error("Unknown settings section.");
  }
}

/** Saves one section (Owner only). Every changed key is written and audited with old and new values. */
export async function updateSettingsSection(
  actor: AuthenticatedUser,
  section: SettingsSection,
  input: unknown,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<BusinessSettings> {
  requirePermission(actor, "system.manage", { ip: clientIp, action: "settings.updated" });
  const db = asyncDb ?? getAsyncDb();
  const values = await validateSection(db, section, input);
  const current = (await getSettings(db, true))[section] as Record<string, unknown>;
  const at = new Date().toISOString();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  await db.transaction(async (tx) => {
    for (const [field, value] of Object.entries(values)) {
      if (JSON.stringify(current[field]) === JSON.stringify(value)) continue;
      changes[field] = { from: current[field], to: value };
      await tx.execute(
        `INSERT INTO business_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
        [`${section}.${field}`, JSON.stringify(value), actor.id, at]
      );
    }
    if (Object.keys(changes).length > 0) {
      await recordAuditEventAsync(
        { actorId: actor.id, actorUsername: actor.username, action: "settings.updated", targetType: "settings", targetId: section, metadata: { section, changes }, ipAddress: clientIp },
        tx
      );
    }
  });
  clearSettingsCache();
  return getSettings(db, true);
}

/** Settings for the Owner's settings page, with who last changed each section. */
export async function getSettingsForAdmin(actor: AuthenticatedUser, asyncDb?: AsyncDb) {
  requirePermission(actor, "system.manage");
  const db = asyncDb ?? getAsyncDb();
  const settings = await getSettings(db, true);
  let lastChanged: Record<string, { at: string; by: string | null }> = {};
  try {
    const rows = await db.query<{ key: string; updated_at: string; full_name: string | null }>(
      "SELECT b.key, b.updated_at, s.full_name FROM business_settings b LEFT JOIN staff_users s ON s.id = b.updated_by"
    );
    for (const r of rows) {
      const section = r.key.split(".")[0];
      if (!lastChanged[section] || lastChanged[section].at < r.updated_at) lastChanged[section] = { at: r.updated_at, by: r.full_name };
    }
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    lastChanged = {};
  }
  const drivers = await db.query<{ id: string; full_name: string; is_active: number | boolean }>(
    "SELECT id, full_name, is_active FROM staff_users WHERE role = 'DELIVERY_PERSON' ORDER BY full_name ASC"
  );
  return {
    settings,
    lastChanged,
    deliveryStaff: drivers.map((d) => ({ id: d.id, fullName: d.full_name, active: Boolean(Number(d.is_active)) })),
  };
}

/**
 * Seller details for a new invoice: business name and address from Settings when saved, otherwise
 * the environment (ERP_COMPANY_*). GSTIN and state code stay environment configuration: they are
 * validated tax registration data, not an everyday setting. Issued invoices keep their snapshot.
 */
export async function getInvoiceCompanyConfig(asyncDb?: AsyncDb) {
  const { getCompanyBillingConfig } = await import("../database/env");
  const base = getCompanyBillingConfig();
  const { business } = await getSettings(asyncDb);
  return {
    ...base,
    companyName: business.name || base.companyName,
    companyAddress: business.address || base.companyAddress,
  };
}
