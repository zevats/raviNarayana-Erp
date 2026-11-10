/**
 * Live PostgreSQL verification of the self-service account (no table of its own; signed request
 * tokens, limits in login_attempts): profile, work summary and devices;
 * password change confirmed by a code emailed to the current address; email change confirmed by
 * one code sent to the current address and one sent to the new address; resend throttle; notices;
 * signing out other devices. Disposable local database only (RN_PG_VERIFY_URL); synthetic data;
 * codes are read from a temporary dev outbox.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { getAsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { hashPassword, verifyPassword } from "../apps/erp/src/server/authentication/auth";
import {
  getMyAccount,
  startPasswordChange,
  confirmPasswordChange,
  startEmailChange,
  confirmEmailChange,
  resendAccountCodes,
  signOutOtherDevices,
} from "../apps/erp/src/server/account/accountService";
import { deviceLabel } from "../apps/erp/src/lib/deviceLabel";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const IP = `10.9.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const CLIENT = { ip: IP, userAgent: ANDROID };

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
  console.log("PG SELF-SERVICE ACCOUNT VERIFICATION (live local PostgreSQL)");
  console.log("================================================================================");
  const outbox = fs.mkdtempSync(path.join(os.tmpdir(), "rn-account-outbox-"));
  process.env.EMAIL_ADAPTER = "outbox";
  process.env.ERP_EMAIL_OUTBOX_DIR = outbox;
  const mails = (email: string) =>
    fs
      .readdirSync(outbox)
      .map((f) => JSON.parse(fs.readFileSync(path.join(outbox, f), "utf8")))
      .filter((m) => m.to === email)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  const codeFor = (email: string, kind: string) => mails(email).find((m) => m.kind === kind)?.otp as string | undefined;
  /** Moves this person's recorded sends back a minute (and out of the 15-minute window if asked), as if time had passed. */
  const ageSends = (staffId: string, ms = 61_000) =>
    db.query<any>("SELECT id, attempted_at FROM login_attempts WHERE identifier LIKE ?", [`acr-sent:${staffId}:%`]).then((rows) =>
      Promise.all(rows.map((r) => db.execute("UPDATE login_attempts SET attempted_at = ? WHERE id = ?", [new Date(new Date(r.attempted_at).getTime() - ms).toISOString(), r.id])))
    );

  console.log("\n--- Device names ---");
  assert(deviceLabel(ANDROID) === "Chrome on Android", `Android Chrome named (${deviceLabel(ANDROID)})`);
  assert(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1") === "Safari on iPhone", "iPhone Safari named");
  assert(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0") === "Edge on Windows", "Windows Edge named");
  assert(deviceLabel(null) === "Unknown device", "Missing user agent shown as unknown");

  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const driver = await insertStaff(db, "DELIVERY_PERSON", "Account Driver");
  const other = await insertStaff(db, "OPERATIONS_MANAGER", "Account Manager");
  const START = "Start-Password-2026";
  await db.execute("UPDATE staff_users SET password_hash = ? WHERE id = ?", [await hashPassword(START), driver.id]);
  const now = new Date();
  const later = new Date(now.getTime() + 3600_000).toISOString();
  const mkSession = async (ua: string | null) => {
    const hash = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
    await db.execute("INSERT INTO sessions (id, token_hash, staff_id, expires_at, created_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)", [`sess_${crypto.randomUUID()}`, hash, driver.id, later, now.toISOString(), ua]);
    return hash;
  };
  const current = await mkSession(ANDROID);
  await mkSession("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36");
  await mkSession(null);

  console.log("\n--- Profile ---");
  const me = await getMyAccount(driver, current, db);
  assert(me.fullName === "Account Driver" && me.role === "DELIVERY_PERSON" && me.email === driver.email, "Profile shows the signed-in staff member");
  assert(me.otherSessions === 2 && me.devices.length === 3, `Devices listed, others counted without this one (got ${me.otherSessions} / ${me.devices.length})`);
  assert(me.devices[0].current && me.devices[0].label === "Chrome on Android", `This device first, named (${me.devices[0]?.label})`);
  assert(!JSON.stringify(me).includes(current), "Session tokens never leave the server");
  assert(me.summary !== null && me.summary.stopsThisMonth === 0 && me.summary.cashWithYou === 0, "Delivery staff get a work summary");
  const mgrMe = await getMyAccount(other, null, db);
  assert(mgrMe.summary === null && mgrMe.fullName === "Account Manager", "Each person sees only their own profile");

  console.log("\n--- Password (code to current email) ---");
  const NEW_PW = "Brand-New-Pass-77";
  await rejects("Short password refused", () => startPasswordChange(driver, { currentPassword: START, newPassword: "short1" }, CLIENT, db), /at least 12/);
  await rejects("Password without a number refused", () => startPasswordChange(driver, { currentPassword: START, newPassword: "onlylettershere" }, CLIENT, db), /number/);
  await rejects("Password containing the username refused", () => startPasswordChange(driver, { currentPassword: START, newPassword: `${driver.username}123` }, CLIENT, db), /username/);
  await rejects("Wrong current password refused", () => startPasswordChange(driver, { currentPassword: "Wrong-Password-1", newPassword: NEW_PW }, CLIENT, db), /not correct/);
  await rejects("Same as current refused", () => startPasswordChange(driver, { currentPassword: START, newPassword: START }, CLIENT, db), /different/);
  const pw = await startPasswordChange(driver, { currentPassword: START, newPassword: NEW_PW }, CLIENT, db);
  const pwCode = codeFor(driver.email, "account_code_password");
  assert(Boolean(pwCode) && /^\d{6}$/.test(pwCode!) && pw.sentTo.includes("@"), "A 6-digit code is emailed to the current address");
  const pwMail = mails(driver.email).find((m) => m.kind === "account_code_password");
  assert(/Change your password/.test(pwMail?.html || "") && /Chrome on Android/.test(pwMail?.html || ""), "Branded email names the change and the device");
  const decoded = Buffer.from(pw.requestId.split(".")[0], "base64url").toString("utf8");
  assert(!decoded.includes(pwCode!) && !decoded.includes(NEW_PW), "The request carries neither the code nor the new password");
  const tampered = pw.requestId.replace(/^./, (c) => (c === "e" ? "f" : "e"));
  await rejects("A changed request token is refused", () => confirmPasswordChange(driver, { requestId: tampered, code: pwCode!, newPassword: NEW_PW }, CLIENT, current, db), /expired/);
  await rejects("Confirming with a different new password is refused", () => confirmPasswordChange(driver, { requestId: pw.requestId, code: pwCode!, newPassword: "Other-Pass-2026x" }, CLIENT, current, db), /does not match/);
  const before = await db.queryOne<any>("SELECT password_hash FROM staff_users WHERE id = ?", [driver.id]);
  assert(await verifyPassword(START, before.password_hash), "Password unchanged until the code is entered");
  await rejects("Starting again within a minute is refused", () => startPasswordChange(driver, { currentPassword: START, newPassword: NEW_PW }, CLIENT, db), /wait/);
  await rejects("Resend within a minute is refused", () => resendAccountCodes(driver, { requestId: pw.requestId }, CLIENT, db), /wait/);
  await rejects("Wrong code refused with tries left", () => confirmPasswordChange(driver, { requestId: pw.requestId, code: "000000", newPassword: NEW_PW }, CLIENT, current, db), /Wrong code\. 2 tries left/);
  await rejects("Another person cannot use this request", () => confirmPasswordChange(other, { requestId: pw.requestId, code: pwCode!, newPassword: NEW_PW }, CLIENT, null, db), /expired/);
  await ageSends(driver.id);
  const re = await resendAccountCodes(driver, { requestId: pw.requestId }, CLIENT, db);
  const pwCode2 = codeFor(driver.email, "account_code_password");
  await rejects("After a resend the earlier request stops working", () => confirmPasswordChange(driver, { requestId: pw.requestId, code: pwCode!, newPassword: NEW_PW }, CLIENT, current, db), /expired/);
  const changed = await confirmPasswordChange(driver, { requestId: re.requestId, code: pwCode2!, newPassword: NEW_PW }, CLIENT, current, db);
  const row = await db.queryOne<any>("SELECT password_hash FROM staff_users WHERE id = ?", [driver.id]);
  assert(await verifyPassword(NEW_PW, row.password_hash) && !(await verifyPassword(START, row.password_hash)), "New password works, old one does not");
  const left = await db.query<any>("SELECT token_hash FROM sessions WHERE staff_id = ?", [driver.id]);
  assert(changed.otherDevicesSignedOut === 2 && left.length === 1 && left[0].token_hash === current, "Other devices signed out; this device stays signed in");
  assert(mails(driver.email).some((m) => m.kind === "account_notice_password_changed"), "A 'password was changed' notice is emailed");
  await rejects("A used code cannot be used again", () => confirmPasswordChange(driver, { requestId: re.requestId, code: pwCode2!, newPassword: NEW_PW }, CLIENT, current, db), /expired/);
  const audit = await db.queryOne<any>("SELECT metadata FROM audit_logs WHERE target_id = ? AND action = 'account.password_changed'", [driver.id]);
  assert(Boolean(audit) && String(audit.metadata).includes("emailVerified"), "Password change is in the audit log (email verified)");
  const limiter = `10.8.${crypto.randomInt(1, 250)}.${crypto.randomInt(1, 250)}`;
  for (let i = 0; i < 6; i++) {
    try {
      await startPasswordChange(driver, { currentPassword: "Wrong-Password-1", newPassword: "Another-Pass-99" }, { ip: limiter }, db);
    } catch {}
  }
  await rejects("Repeated wrong passwords are rate limited", () => startPasswordChange(driver, { currentPassword: "Wrong-Password-1", newPassword: "Another-Pass-99" }, { ip: limiter }, db), /Too many/);

  console.log("\n--- Email (codes to the current and to the new address) ---");
  const oldEmail = driver.email;
  await rejects("Invalid email refused", () => startEmailChange(driver, { newEmail: "not-an-email", currentPassword: NEW_PW }, CLIENT, db), /valid email/);
  await rejects("Email of another account refused", () => startEmailChange(driver, { newEmail: other.email, currentPassword: NEW_PW }, CLIENT, db), /another account/);
  await rejects("Same email refused", () => startEmailChange(driver, { newEmail: oldEmail, currentPassword: NEW_PW }, CLIENT, db), /already your email/);
  await rejects("Wrong current password refused", () => startEmailChange(driver, { newEmail: "new.driver@example.com", currentPassword: "nope-nope-123" }, CLIENT, db), /not correct/);
  const newEmail = `driver.${crypto.randomBytes(3).toString("hex")}@example.com`;
  const em = await startEmailChange(driver, { newEmail, currentPassword: NEW_PW }, CLIENT, db);
  const oldCode = codeFor(oldEmail, "account_code_email_current");
  const newCode = codeFor(newEmail, "account_code_email_new");
  assert(Boolean(oldCode) && Boolean(newCode) && oldCode !== newCode, "One code goes to the current address and a different one to the new address");
  assert(em.sentToCurrent.includes("@") && em.sentToNew.includes("@") && !em.sentToNew.includes(newEmail.split("@")[0]), "Addresses shown masked");
  await rejects("The new-inbox code alone is not enough", () => confirmEmailChange(driver, { requestId: em.requestId, currentCode: "000000", newCode: newCode! }, CLIENT, db), /current email is wrong\. 2 tries left/);
  await rejects("The current-inbox code alone is not enough", () => confirmEmailChange(driver, { requestId: em.requestId, currentCode: oldCode!, newCode: "000000" }, CLIENT, db), /new email is wrong\. 1 try left/);
  const stillOld = await db.queryOne<any>("SELECT email FROM staff_users WHERE id = ?", [driver.id]);
  assert(stillOld.email === oldEmail, "Email unchanged while a code is missing");
  const ok = await confirmEmailChange(driver, { requestId: em.requestId, currentCode: oldCode!, newCode: newCode! }, CLIENT, db);
  const after = await db.queryOne<any>("SELECT email FROM staff_users WHERE id = ?", [driver.id]);
  assert(ok.email === newEmail && after.email === newEmail, "Email changed once both codes are right");
  assert(mails(oldEmail).some((m) => m.kind === "account_notice_email_changed_old") && mails(newEmail).some((m) => m.kind === "account_notice_email_changed_new"), "Notices go to the old and the new address");
  await rejects("Used codes cannot be used again", () => confirmEmailChange(driver, { requestId: em.requestId, currentCode: oldCode!, newCode: newCode! }, CLIENT, db), /expired/);
  const eaudit = await db.queryOne<any>("SELECT metadata FROM audit_logs WHERE target_id = ? AND action = 'account.email_changed'", [driver.id]);
  assert(Boolean(eaudit) && !String(eaudit.metadata).includes(newEmail), "Email change audited with masked addresses");

  // Three wrong tries end the request.
  const second = `driver2.${crypto.randomBytes(3).toString("hex")}@example.com`;
  await ageSends(driver.id);
  const em2 = await startEmailChange(driver, { newEmail: second, currentPassword: NEW_PW }, CLIENT, db);
  for (let i = 0; i < 2; i++) {
    try {
      await confirmEmailChange(driver, { requestId: em2.requestId, currentCode: "111111", newCode: "111111" }, CLIENT, db);
    } catch {}
  }
  await rejects("Third wrong try ends the request", () => confirmEmailChange(driver, { requestId: em2.requestId, currentCode: "111111", newCode: "111111" }, CLIENT, db), /Too many wrong codes/);
  await rejects("Even the right codes no longer work", () => confirmEmailChange(driver, { requestId: em2.requestId, currentCode: codeFor(newEmail, "account_code_email_current")!, newCode: codeFor(second, "account_code_email_new")! }, CLIENT, db), /expired/);
  const still = await db.queryOne<any>("SELECT email FROM staff_users WHERE id = ?", [driver.id]);
  assert(still.email === newEmail, "Email unchanged after a failed request");

  // Sends are limited: once a minute, at most 5 in 15 minutes.
  await ageSends(driver.id, 16 * 60_000);
  let em3 = await startEmailChange(driver, { newEmail: second, currentPassword: NEW_PW }, CLIENT, db);
  await rejects("A resend within a minute is refused", () => resendAccountCodes(driver, { requestId: em3.requestId }, CLIENT, db), /wait/);
  for (let i = 0; i < 4; i++) {
    await ageSends(driver.id, 61_000);
    em3 = { ...em3, ...(await resendAccountCodes(driver, { requestId: em3.requestId }, CLIENT, db)) };
  }
  await ageSends(driver.id, 61_000);
  await rejects("A sixth send in 15 minutes is refused", () => resendAccountCodes(driver, { requestId: em3.requestId }, CLIENT, db), /Too many codes sent/);

  console.log("\n--- Devices ---");
  await mkSession(null);
  await mkSession(null);
  const out = await signOutOtherDevices(driver, CLIENT, current, db);
  const remaining = await db.query<any>("SELECT token_hash FROM sessions WHERE staff_id = ?", [driver.id]);
  assert(out.signedOut === 2 && remaining.length === 1 && remaining[0].token_hash === current, "Sign out other devices keeps only this one");
  assert(mails(newEmail).some((m) => m.kind === "account_notice_devices_signed_out"), "A notice is emailed after signing out other devices");

  console.log(`\nACCOUNT RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
  fs.rmSync(outbox, { recursive: true, force: true });
  await closePg();
  process.exit(state.failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  try {
    await closePg();
  } catch {}
  process.exit(1);
});
