import { invalidateSessionCache } from "../authentication/sessionCache";
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { AuthenticatedUser, MyAccount } from "@/types";
import { verifyPassword, hashPassword, checkRateLimit, recordLoginAttempt, maskEmail } from "../authentication/auth";
import { getEmailAdapter } from "../notifications/emailAdapter";
import { renderAccountCodeEmail, renderAccountNoticeEmail, AccountCodePurpose, AccountNoticeKind } from "../notifications/accountEmails";
import { RenderedEmail } from "../notifications/emailTemplate";
import { recordAuditEventAsync } from "../audit/audit";
import { getBusinessDateString } from "../finance/financeService";
import { deviceLabel } from "@/lib/deviceLabel";

/**
 * Self-service account: the signed-in staff member's profile with a short work summary and their
 * devices, and changes confirmed by email codes:
 *   - password: current password + new password, then a code sent to the current email;
 *   - email: current password + new address, then one code sent to the current address and one to
 *     the new address — both are needed.
 *
 * No table of its own (works on the current schema): an open change travels as a server-signed
 * token (HMAC-SHA256) that holds only keyed hashes of the codes and of the new password, never the
 * values. Wrong tries, single use and send limits are rows in login_attempts under their own
 * identifiers and the marker IP "account-code", so they never count against sign-in limits.
 * Codes: 6 digits, 3 wrong tries, 10 minutes, single use; a new code once a minute, 5 per 15 minutes.
 * A notice email follows every completed change.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 12;
const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;
const SEND_WINDOW_MS = 15 * 60_000;
const MAX_SENDS = 5;
const MAX_ATTEMPTS = 3;
const MARK_IP = "account-code";

export class AccountError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = "AccountError";
  }
}

/** Where a request came from: IP for the rate limit and audit, user agent for the device name. */
export interface AccountClient {
  ip: string;
  userAgent?: string | null;
}

type ChangeKind = "PASSWORD" | "EMAIL";
interface ChangeToken {
  v: 1;
  id: string;
  sid: string;
  kind: ChangeKind;
  /** Current email when the change started; the change is refused if it moved meanwhile. */
  ce: string;
  ne?: string;
  cc: string;
  nc?: string;
  pw?: string;
  exp: number;
}

/** Signing key: ACCOUNT_CHANGE_SECRET, else derived from the server-only database URL. */
function signingKey(): Buffer {
  const explicit = process.env.ACCOUNT_CHANGE_SECRET;
  const base = explicit || process.env.DATABASE_URL || process.env.DIRECT_URL;
  if (!base) throw new AccountError("Account changes are not available on this server.", 503);
  return crypto.createHash("sha256").update(`rn-erp-account-change-v1\0${base}`).digest();
}

const mac = (data: string) => crypto.createHmac("sha256", signingKey()).update(data).digest("hex");

function sameMac(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

const codeMac = (id: string, which: "cur" | "new", code: string) => mac(`code|${id}|${which}|${code.trim()}`);
const passwordMac = (staffId: string, password: string) => mac(`pw|${staffId}|${password}`);
const newCode = () => crypto.randomInt(100000, 1000000).toString();

function seal(t: ChangeToken): string {
  const body = Buffer.from(JSON.stringify(t)).toString("base64url");
  return `${body}.${mac(`tok|${body}`)}`;
}

const expired = () => new AccountError("This code has expired. Start again to get a new one.");

function open(user: AuthenticatedUser, token: string | undefined, kind: ChangeKind): ChangeToken {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || !sameMac(sig, mac(`tok|${body}`))) throw expired();
  let t: ChangeToken;
  try {
    t = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw expired();
  }
  if (t.v !== 1 || t.sid !== user.id || t.kind !== kind || Date.now() > t.exp) throw expired();
  return t;
}

/** A request is closed once used, ended by wrong tries, or replaced by a resend. */
async function isClosed(id: string, db: AsyncDb): Promise<boolean> {
  const row = await db.queryOne<{ done: number; wrong: number }>(
    `SELECT
       (SELECT COUNT(*) FROM login_attempts WHERE id = ?) AS done,
       (SELECT COUNT(*) FROM login_attempts WHERE identifier = ? AND success = 0) AS wrong`,
    [`acr_done_${id}`, `acr:${id}`]
  );
  return Number(row?.done || 0) > 0 || Number(row?.wrong || 0) >= MAX_ATTEMPTS;
}

/** Closes a request for good; false if it was already closed (single use under concurrency). */
async function close(id: string, db: AsyncDb): Promise<boolean> {
  try {
    const res = await db.execute(
      "INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success) VALUES (?, ?, ?, ?, 1)",
      [`acr_done_${id}`, `acr-done:${id}`, MARK_IP, new Date().toISOString()]
    );
    return (res.changes ?? 1) > 0;
  } catch {
    return false;
  }
}

/** Once a minute, and at most 5 sends in 15 minutes, per person and kind of change. */
async function throttleSend(user: AuthenticatedUser, kind: ChangeKind, db: AsyncDb): Promise<void> {
  const key = `acr-sent:${user.id}:${kind}`;
  const rows = await db.query<{ attempted_at: string }>(
    "SELECT attempted_at FROM login_attempts WHERE identifier = ? AND attempted_at >= ? ORDER BY attempted_at DESC",
    [key, new Date(Date.now() - SEND_WINDOW_MS).toISOString()]
  );
  const wait = rows[0] ? RESEND_AFTER_MS - (Date.now() - new Date(rows[0].attempted_at).getTime()) : 0;
  if (wait > 0) throw new AccountError(`Please wait ${Math.ceil(wait / 1000)} seconds before asking for a new code.`, 429);
  if (rows.length >= MAX_SENDS) throw new AccountError("Too many codes sent. Please try again in 15 minutes.", 429);
}

async function recordSend(user: AuthenticatedUser, kind: ChangeKind, db: AsyncDb): Promise<void> {
  await db.execute("INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success) VALUES (?, ?, ?, ?, 1)", [
    `acrs_${crypto.randomUUID()}`,
    `acr-sent:${user.id}:${kind}`,
    MARK_IP,
    new Date().toISOString(),
  ]);
}

async function sendEmail(to: string, email: RenderedEmail, kind: string, otp?: string): Promise<boolean> {
  try {
    const adapter = getEmailAdapter();
    if (adapter.sendRendered) return await adapter.sendRendered(to, email, { kind, otp });
    return otp ? await adapter.sendOtp(to, otp) : false;
  } catch {
    return false;
  }
}

const sendCode = (to: string, purpose: AccountCodePurpose, code: string, ctx: { name: string; device: string; newEmail?: string }) =>
  sendEmail(to, renderAccountCodeEmail(purpose, code, ctx), `account_code_${purpose.toLowerCase()}`, code);

/** Notices are best effort: the change is already saved when they go out. */
async function sendNotice(to: string, kind: AccountNoticeKind, ctx: { name: string; device: string; newEmail?: string }): Promise<void> {
  await sendEmail(to, renderAccountNoticeEmail(kind, ctx), `account_notice_${kind.toLowerCase()}`);
}

/** Wrong current password: counted against the account (same limits as sign-in) and audited. */
async function checkCurrentPassword(user: AuthenticatedUser, password: string, ip: string, db: AsyncDb): Promise<void> {
  const key = `account:${user.username}`;
  const limit = await checkRateLimit(key, ip, db);
  if (limit.isLimited) throw new AccountError(`Too many wrong attempts. Try again in ${limit.remainingMinutes} minutes.`, 429);
  const row = await db.queryOne<{ password_hash: string }>("SELECT password_hash FROM staff_users WHERE id = ? AND is_active = 1", [user.id]);
  if (!row || !(await verifyPassword(password || "", row.password_hash))) {
    await recordLoginAttempt(key, ip, false, db);
    throw new AccountError("Your current password is not correct.");
  }
}

function checkNewPassword(user: AuthenticatedUser, next: string): void {
  if (next.length < MIN_PASSWORD) throw new AccountError(`Use at least ${MIN_PASSWORD} characters.`);
  if (next.length > 128) throw new AccountError("Use at most 128 characters.");
  if (!/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) throw new AccountError("Use letters and at least one number.");
  if (next.toLowerCase().includes(user.username.toLowerCase())) throw new AccountError("Do not use your username in the password.");
}

async function staffRow(user: AuthenticatedUser, db: AsyncDb): Promise<{ email: string; full_name: string; password_hash: string }> {
  const row = await db.queryOne<any>("SELECT email, full_name, password_hash FROM staff_users WHERE id = ? AND is_active = 1", [user.id]);
  if (!row) throw new AccountError("Account not found.", 404);
  return row;
}

/** A wrong code costs one of 3 tries; the third closes the request. */
async function wrongCode(id: string, which: string, db: AsyncDb): Promise<never> {
  await db.execute("INSERT INTO login_attempts (id, identifier, ip_address, attempted_at, success) VALUES (?, ?, ?, ?, 0)", [
    `acrf_${crypto.randomUUID()}`,
    `acr:${id}`,
    MARK_IP,
    new Date().toISOString(),
  ]);
  const row = await db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM login_attempts WHERE identifier = ? AND success = 0", [`acr:${id}`]);
  const left = MAX_ATTEMPTS - Number(row?.n || 0);
  if (left <= 0) throw new AccountError("Too many wrong codes. Start again to get a new one.");
  throw new AccountError(`${which} ${left} ${left === 1 ? "try" : "tries"} left.`);
}

export async function getMyAccount(user: AuthenticatedUser, sessionTokenHash: string | null, asyncDb?: AsyncDb): Promise<MyAccount> {
  const db = asyncDb || getAsyncDb();
  const row = await db.queryOne<any>("SELECT id, username, email, full_name, role, created_at, last_login_at FROM staff_users WHERE id = ?", [user.id]);
  if (!row) throw new AccountError("Account not found.", 404);
  const sessions = await db.query<any>(
    "SELECT id, token_hash, user_agent, created_at FROM sessions WHERE staff_id = ? AND expires_at > ? ORDER BY created_at DESC",
    [user.id, new Date().toISOString()]
  );
  const devices = sessions.map((s) => ({ id: s.id as string, label: deviceLabel(s.user_agent), current: Boolean(sessionTokenHash) && s.token_hash === sessionTokenHash, signedInAt: s.created_at as string }));
  devices.sort((a, b) => Number(b.current) - Number(a.current));
  const today = getBusinessDateString();
  const monthStart = `${today.slice(0, 7)}-01`;

  let summary: MyAccount["summary"] = null;
  if (row.role === "DELIVERY_PERSON") {
    const t = await db.queryOne<any>(
      `SELECT
         COALESCE(SUM(CASE WHEN status <> 'CANCELLED' THEN 1 ELSE 0 END), 0) AS stops,
         COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) AS delivered,
         COALESCE(SUM(CASE WHEN status = 'EXCEPTION' THEN 1 ELSE 0 END), 0) AS not_delivered,
         COALESCE(SUM(CASE WHEN service_date = ? AND status <> 'CANCELLED' THEN 1 ELSE 0 END), 0) AS today_stops,
         COALESCE(SUM(CASE WHEN service_date = ? AND status IN ('DELIVERED', 'EXCEPTION') THEN 1 ELSE 0 END), 0) AS today_done
       FROM delivery_tasks WHERE assigned_to = ? AND service_date >= ? AND service_date <= ?`,
      [today, today, user.id, monthStart, today]
    );
    const handed = await db.queryOne<any>(
      "SELECT COALESCE(SUM(accepted_cash), 0) AS cash, COUNT(*) AS n FROM driver_cash_handovers WHERE driver_id = ? AND status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED') AND shift_date >= ?",
      [user.id, monthStart]
    );
    const held = await db.queryOne<any>(
      "SELECT COALESCE(SUM(dc.amount), 0) AS cash FROM delivery_collections dc LEFT JOIN driver_cash_handovers h ON h.id = dc.handover_id WHERE dc.collected_by = ? AND dc.payment_method = 'CASH' AND (dc.handover_id IS NULL OR h.status = 'DECLARED')",
      [user.id]
    );
    const done = Number(t?.delivered || 0) + Number(t?.not_delivered || 0);
    summary = {
      monthLabel: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthStart}T00:00:00Z`)),
      stopsThisMonth: Number(t?.stops || 0),
      deliveredThisMonth: Number(t?.delivered || 0),
      deliveredRate: done ? Math.round((Number(t?.delivered || 0) / done) * 100) : null,
      todayDone: Number(t?.today_done || 0),
      todayStops: Number(t?.today_stops || 0),
      cashHandedOverThisMonth: Number(handed?.cash || 0),
      handoversThisMonth: Number(handed?.n || 0),
      cashWithYou: Number(held?.cash || 0),
    };
  }

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    memberSince: row.created_at,
    lastSignIn: row.last_login_at || null,
    otherSessions: devices.filter((d) => !d.current).length,
    devices,
    summary,
  };
}


/** Step 1 of a password change: checks both passwords, then emails a code to the current address. */
export async function startPasswordChange(
  user: AuthenticatedUser,
  input: { currentPassword?: string; newPassword?: string },
  client: AccountClient,
  asyncDb?: AsyncDb
): Promise<{ requestId: string; sentTo: string }> {
  const db = asyncDb || getAsyncDb();
  const next = input.newPassword || "";
  checkNewPassword(user, next);
  await checkCurrentPassword(user, input.currentPassword || "", client.ip, db);
  const row = await staffRow(user, db);
  if (await verifyPassword(next, row.password_hash)) throw new AccountError("Choose a password different from your current one.");
  await throttleSend(user, "PASSWORD", db);

  const id = crypto.randomUUID();
  const code = newCode();
  const token = seal({ v: 1, id, sid: user.id, kind: "PASSWORD", ce: row.email, cc: codeMac(id, "cur", code), pw: passwordMac(user.id, next), exp: Date.now() + CODE_TTL_MS });
  if (!(await sendCode(row.email, "PASSWORD", code, { name: row.full_name, device: deviceLabel(client.userAgent) }))) {
    throw new AccountError("We could not send the code to your email. Please try again in a moment.", 502);
  }
  await recordSend(user, "PASSWORD", db);
  return { requestId: token, sentTo: maskEmail(row.email) };
}

/** Step 1 of an email change: current password and the new address; a code goes to each inbox. */
export async function startEmailChange(
  user: AuthenticatedUser,
  input: { newEmail?: string; currentPassword?: string },
  client: AccountClient,
  asyncDb?: AsyncDb
): Promise<{ requestId: string; sentToCurrent: string; sentToNew: string }> {
  const db = asyncDb || getAsyncDb();
  const email = (input.newEmail || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 160) throw new AccountError("Enter a valid email address.");
  const row = await staffRow(user, db);
  if (row.email?.toLowerCase() === email) throw new AccountError("That is already your email.");
  if (await db.queryOne("SELECT id FROM staff_users WHERE lower(email) = ? AND id <> ?", [email, user.id])) throw new AccountError("That email is used by another account.");
  await checkCurrentPassword(user, input.currentPassword || "", client.ip, db);
  await throttleSend(user, "EMAIL", db);
  return issueEmailCodes(user, row, email, client, db);
}

async function issueEmailCodes(
  user: AuthenticatedUser,
  row: { email: string; full_name: string },
  email: string,
  client: AccountClient,
  db: AsyncDb
): Promise<{ requestId: string; sentToCurrent: string; sentToNew: string }> {
  const id = crypto.randomUUID();
  const currentCode = newCode();
  let nextCode = newCode();
  while (nextCode === currentCode) nextCode = newCode();
  const token = seal({ v: 1, id, sid: user.id, kind: "EMAIL", ce: row.email, ne: email, cc: codeMac(id, "cur", currentCode), nc: codeMac(id, "new", nextCode), exp: Date.now() + CODE_TTL_MS });
  const ctx = { name: row.full_name, device: deviceLabel(client.userAgent), newEmail: email };
  const [toCurrent, toNew] = await Promise.all([sendCode(row.email, "EMAIL_CURRENT", currentCode, ctx), sendCode(email, "EMAIL_NEW", nextCode, ctx)]);
  if (!toCurrent || !toNew) {
    throw new AccountError(toNew ? "We could not send the code to your current email. Please try again in a moment." : "We could not send the code to the new address. Check it and try again.", 502);
  }
  await recordSend(user, "EMAIL", db);
  return { requestId: token, sentToCurrent: maskEmail(row.email), sentToNew: maskEmail(email) };
}

/**
 * Sends fresh codes for an open change (once a minute, 5 per 15 minutes). The earlier codes stop
 * working; the reply carries the new request id to use from now on.
 */
export async function resendAccountCodes(
  user: AuthenticatedUser,
  input: { requestId?: string; newPassword?: string },
  client: AccountClient,
  asyncDb?: AsyncDb
): Promise<{ requestId: string }> {
  const db = asyncDb || getAsyncDb();
  const kind: ChangeKind = (() => {
    try {
      return JSON.parse(Buffer.from(String(input.requestId || "").split(".")[0], "base64url").toString("utf8")).kind === "EMAIL" ? "EMAIL" : "PASSWORD";
    } catch {
      return "PASSWORD";
    }
  })();
  const t = open(user, input.requestId, kind);
  if (await isClosed(t.id, db)) throw expired();
  await throttleSend(user, kind, db);
  const row = await staffRow(user, db);
  if (row.email !== t.ce) throw expired();
  let result: { requestId: string };
  if (kind === "EMAIL") {
    result = await issueEmailCodes(user, row, t.ne!, client, db);
  } else {
    const id = crypto.randomUUID();
    const code = newCode();
    const token = seal({ v: 1, id, sid: user.id, kind: "PASSWORD", ce: row.email, cc: codeMac(id, "cur", code), pw: t.pw, exp: Date.now() + CODE_TTL_MS });
    if (!(await sendCode(row.email, "PASSWORD", code, { name: row.full_name, device: deviceLabel(client.userAgent) }))) {
      throw new AccountError("We could not send the code. Please try again in a moment.", 502);
    }
    await recordSend(user, "PASSWORD", db);
    result = { requestId: token };
  }
  await close(t.id, db);
  return { requestId: result.requestId };
}

/** Step 2 of a password change: the code from the current inbox; other devices are signed out. */
export async function confirmPasswordChange(
  user: AuthenticatedUser,
  input: { requestId?: string; code?: string; newPassword?: string },
  client: AccountClient,
  currentTokenHash: string | null,
  asyncDb?: AsyncDb
): Promise<{ otherDevicesSignedOut: number }> {
  const db = asyncDb || getAsyncDb();
  const t = open(user, input.requestId, "PASSWORD");
  if (await isClosed(t.id, db)) throw expired();
  const next = input.newPassword || "";
  if (!sameMac(passwordMac(user.id, next), t.pw)) throw new AccountError("The new password does not match. Start again.");
  if (!sameMac(codeMac(t.id, "cur", input.code || ""), t.cc)) await wrongCode(t.id, "Wrong code.", db);
  const row = await staffRow(user, db);
  if (row.email !== t.ce) throw expired();
  const hash = await hashPassword(next);
  if (!(await close(t.id, db))) throw new AccountError("This code was already used.");

  const now = new Date().toISOString();
  let signedOut = 0;
  await db.transaction(async (tx) => {
    await tx.execute("UPDATE staff_users SET password_hash = ?, updated_at = ? WHERE id = ?", [hash, now, user.id]);
    const others = await tx.execute(
      `DELETE FROM sessions WHERE staff_id = ?${currentTokenHash ? " AND token_hash <> ?" : ""}`,
      currentTokenHash ? [user.id, currentTokenHash] : [user.id]
    );
    invalidateSessionCache();
    signedOut = others.changes || 0;
    await recordAuditEventAsync(
      { actorId: user.id, actorUsername: user.username, action: "account.password_changed", targetType: "staff_user", targetId: user.id, metadata: { otherDevicesSignedOut: signedOut, emailVerified: true }, ipAddress: client.ip },
      tx
    );
  });
  await sendNotice(row.email, "PASSWORD_CHANGED", { name: row.full_name, device: deviceLabel(client.userAgent) });
  return { otherDevicesSignedOut: signedOut };
}

/** Step 2 of an email change: both codes (current inbox and new inbox) are needed. */
export async function confirmEmailChange(
  user: AuthenticatedUser,
  input: { requestId?: string; currentCode?: string; newCode?: string },
  client: AccountClient,
  asyncDb?: AsyncDb
): Promise<{ email: string }> {
  const db = asyncDb || getAsyncDb();
  const t = open(user, input.requestId, "EMAIL");
  if (await isClosed(t.id, db)) throw expired();
  const currentOk = sameMac(codeMac(t.id, "cur", input.currentCode || ""), t.cc);
  const newOk = sameMac(codeMac(t.id, "new", input.newCode || ""), t.nc);
  if (!currentOk || !newOk) {
    await wrongCode(t.id, !currentOk && !newOk ? "Both codes are wrong." : !currentOk ? "The code from your current email is wrong." : "The code from the new email is wrong.", db);
  }
  const newEmail = t.ne!;
  const row = await staffRow(user, db);
  if (row.email !== t.ce) throw expired();
  if (await db.queryOne("SELECT id FROM staff_users WHERE lower(email) = ? AND id <> ?", [newEmail, user.id])) throw new AccountError("That email is used by another account.");
  if (!(await close(t.id, db))) throw new AccountError("This code was already used.");
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    const res = await tx.execute("UPDATE staff_users SET email = ?, updated_at = ? WHERE id = ? AND email = ?", [newEmail, now, user.id, t.ce]);
    if (!res.changes) throw expired();
    await recordAuditEventAsync(
      { actorId: user.id, actorUsername: user.username, action: "account.email_changed", targetType: "staff_user", targetId: user.id, metadata: { from: maskEmail(t.ce), to: maskEmail(newEmail), verifiedBoth: true }, ipAddress: client.ip },
      tx
    );
  });
  const ctx = { name: row.full_name, device: deviceLabel(client.userAgent), newEmail };
  await Promise.all([sendNotice(t.ce, "EMAIL_CHANGED_OLD", ctx), sendNotice(newEmail, "EMAIL_CHANGED_NEW", ctx)]);
  return { email: newEmail };
}

/** Signs out every other device of this account; this one stays signed in. */
export async function signOutOtherDevices(user: AuthenticatedUser, client: AccountClient, currentTokenHash: string | null, asyncDb?: AsyncDb): Promise<{ signedOut: number }> {
  const db = asyncDb || getAsyncDb();
  if (!currentTokenHash) throw new AccountError("Sign in again first.", 401);
  let signedOut = 0;
  await db.transaction(async (tx) => {
    const res = await tx.execute("DELETE FROM sessions WHERE staff_id = ? AND token_hash <> ?", [user.id, currentTokenHash]);
    invalidateSessionCache();
    signedOut = res.changes || 0;
    await recordAuditEventAsync(
      { actorId: user.id, actorUsername: user.username, action: "account.devices_signed_out", targetType: "staff_user", targetId: user.id, metadata: { signedOut }, ipAddress: client.ip },
      tx
    );
  });
  if (signedOut > 0) {
    const row = await staffRow(user, db);
    await sendNotice(row.email, "DEVICES_SIGNED_OUT", { name: row.full_name, device: deviceLabel(client.userAgent) });
  }
  return { signedOut };
}
