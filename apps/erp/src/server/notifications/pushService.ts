import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { AuthenticatedUser } from "@/types";

/**
 * Delivery alerts on the Android app through Firebase Cloud Messaging (HTTP v1).
 *
 * The app registers its FCM token after sign-in (POST /api/push/token); when stops are assigned to
 * a delivery partner — or a stop of theirs is cancelled — every phone they are signed in on gets a
 * system notification on the "delivery_alerts" channel, which plays the app's own alert sound even
 * when the app is closed or the phone is locked (within the phone's sound / Do-Not-Disturb rules).
 * Tapping it opens that stop in the app.
 *
 * Configuration (server only, never sent to the app): FIREBASE_SERVICE_ACCOUNT — the service
 * account JSON from Firebase (Project settings → Service accounts → Generate new private key),
 * either as raw JSON or base64. Without it, or before migration 0015, everything here is a no-op.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

let account: ServiceAccount | null | undefined;
let cachedToken: { value: string; expires: number } | null = null;

function serviceAccount(): ServiceAccount | null {
  if (account !== undefined) return account;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return (account = null);
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error("missing fields");
    return (account = { project_id: parsed.project_id, client_email: parsed.client_email, private_key: String(parsed.private_key).replace(/\\n/g, "\n") });
  } catch (e: any) {
    console.error("[Push] FIREBASE_SERVICE_ACCOUNT is not a valid service-account JSON:", e?.message || e);
    return (account = null);
  }
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** OAuth access token for FCM, from a JWT signed with the service account key (cached ~55 min). */
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })
  );
  const signature = b64url(crypto.createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${signature}` }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google token request failed (HTTP ${res.status} ${data.error || ""})`);
  cachedToken = { value: data.access_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function hasTokenTable(db: AsyncDb): Promise<boolean> {
  if (!db.isPostgres) return false;
  const row = await db.queryOne<{ t: string | null }>("SELECT to_regclass('public.push_tokens')::text AS t");
  return Boolean(row?.t);
}

/** Whether alerts can be delivered from this server (Firebase configured and table present). */
export async function pushConfigured(asyncDb?: AsyncDb): Promise<boolean> {
  return Boolean(serviceAccount()) && (await hasTokenTable(asyncDb || getAsyncDb()));
}

/** Links this phone's FCM token to the signed-in staff member (moves it if someone else had it). */
export async function savePushToken(user: AuthenticatedUser, token: string, platform: string, asyncDb?: AsyncDb): Promise<{ saved: boolean }> {
  const db = asyncDb || getAsyncDb();
  if (!(await hasTokenTable(db))) return { saved: false };
  const clean = String(token || "").trim();
  if (clean.length < 20 || clean.length > 4096) throw new Error("This phone did not give a valid notification token.");
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.execute("DELETE FROM push_tokens WHERE token = ?", [clean]);
    await tx.execute("INSERT INTO push_tokens (id, staff_id, token, platform, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, NULL)", [
      `ptok_${crypto.randomUUID()}`,
      user.id,
      clean,
      platform === "ios" ? "ios" : "android",
      now,
    ]);
  });
  return { saved: true };
}

/** Sign-out on a phone: that phone stops getting this person's alerts. */
export async function removePushToken(user: AuthenticatedUser, token: string, asyncDb?: AsyncDb): Promise<void> {
  const db = asyncDb || getAsyncDb();
  if (!(await hasTokenTable(db))) return;
  await db.execute("DELETE FROM push_tokens WHERE staff_id = ? AND token = ?", [user.id, String(token || "").trim()]);
}

type Alert = { title: string; body: string; url: string; tag: string; kind: "new_stop" | "cancelled" };

/** Sends one alert to every phone of a staff member; drops tokens Firebase reports as gone. */
async function sendToStaff(staffId: string, alert: Alert, db: AsyncDb): Promise<number> {
  const sa = serviceAccount();
  if (!sa || !(await hasTokenTable(db))) return 0;
  const tokens = await db.query<{ id: string; token: string }>("SELECT id, token FROM push_tokens WHERE staff_id = ?", [staffId]);
  if (!tokens.length) return 0;
  const bearer = await accessToken(sa);
  let sent = 0;
  await Promise.all(
    tokens.map(async (t) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token: t.token,
            notification: { title: alert.title, body: alert.body },
            // Data for the app: where a tap should go, and which alert it is (for de-duplication).
            data: { url: alert.url, tag: alert.tag, kind: alert.kind },
            android: {
              priority: "HIGH",
              ttl: "3600s",
              collapse_key: alert.tag,
              notification: {
                channel_id: alert.kind === "new_stop" ? "delivery_alerts" : "delivery_updates",
                sound: alert.kind === "new_stop" ? "delivery_alert" : "default",
                tag: alert.tag,
                icon: "ic_stat_rn",
                color: "#C9501C",
                default_vibrate_timings: true,
                visibility: "PRIVATE",
              },
            },
          },
        }),
      }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: String(e?.message || e) } }) }) as any);
      if (res.ok) {
        sent++;
        await db.execute("UPDATE push_tokens SET last_used_at = ? WHERE id = ?", [new Date().toISOString(), t.id]);
        return;
      }
      const err: any = await res.json().catch(() => ({}));
      const code = String(err?.error?.details?.find?.((d: any) => d.errorCode)?.errorCode || err?.error?.status || "");
      if (res.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT") {
        await db.execute("DELETE FROM push_tokens WHERE id = ?", [t.id]);
      } else {
        console.error(`[Push] Alert to a phone failed: HTTP ${res.status} ${code} ${String(err?.error?.message || "").slice(0, 120)}`);
      }
    })
  );
  return sent;
}

const nameOf = (r: any) => r.customer_name || r.resident_name || (r.room_number ? `Room ${r.room_number}` : "a customer");
const placeOf = (r: any) => (r.room_number ? `Room ${r.room_number}` : String(r.delivery_address || "").split(",")[0]);

/** Runs after the request has finished (and its transaction committed); never throws. */
function later(fn: () => Promise<void>): void {
  if (!serviceAccount()) return;
  setTimeout(() => {
    fn().catch((e) => console.error("[Push] Could not send alert:", e?.message || e));
  }, 1200);
}

/**
 * Stops were assigned to a delivery partner: alert their phones. Re-reads the stops first, so an
 * assignment that was rolled back or moved to someone else sends nothing.
 */
export function notifyStopsAssigned(taskIds: string[], staffId: string): void {
  if (!taskIds.length || !staffId) return;
  later(async () => {
    const db = getAsyncDb();
    const marks = taskIds.map(() => "?").join(", ");
    const rows = await db.query<any>(
      `SELECT id, meal_type, customer_name, resident_name, room_number, delivery_address FROM delivery_tasks
       WHERE id IN (${marks}) AND assigned_to = ? AND status IN ('ASSIGNED', 'OUT_FOR_DELIVERY')`,
      [...taskIds, staffId]
    );
    if (!rows.length) return;
    const meal = rows[0].meal_type === "DINNER" ? "dinner" : "lunch";
    const one = rows.length === 1;
    await sendToStaff(
      staffId,
      {
        kind: "new_stop",
        title: one ? `New ${meal} delivery` : `${rows.length} new ${meal} deliveries`,
        body: one ? [nameOf(rows[0]), placeOf(rows[0])].filter(Boolean).join(" · ") : rows.slice(0, 3).map(nameOf).join(", ") + (rows.length > 3 ? "…" : ""),
        url: one ? `/delivery?task=${encodeURIComponent(rows[0].id)}` : "/delivery",
        tag: one ? `stop-${rows[0].id}` : `stops-${meal}-${rows.map((r: any) => r.id).sort().join("").slice(-24)}`,
      },
      db
    );
  });
}

/** A stop assigned to someone was cancelled: tell them so they do not go. */
export function notifyStopCancelled(taskId: string, staffId: string | null | undefined): void {
  if (!taskId || !staffId) return;
  later(async () => {
    const db = getAsyncDb();
    const r = await db.queryOne<any>("SELECT id, meal_type, customer_name, resident_name, room_number, delivery_address FROM delivery_tasks WHERE id = ? AND status = 'CANCELLED'", [taskId]);
    if (!r) return;
    await sendToStaff(staffId, { kind: "cancelled", title: "Delivery cancelled", body: `${nameOf(r)} — no need to go.`, url: "/delivery", tag: `stop-${r.id}` }, db);
  });
}
