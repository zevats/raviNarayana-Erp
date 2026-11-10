/**
 * Sign-in sessions: each user may be signed in once in the app (the Android app's web view) and
 * once in a browser at the same time. A new sign-in replaces only the earlier session of the same
 * kind. Disposable verification database only (RN_PG_VERIFY_URL; names contain "verify" and "test").
 */
import { getAsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { createSession, validateSessionDetailed, destroySession, sessionKind } from "../apps/erp/src/server/authentication/auth";
import { useVerifyDatabase, migrateVerifyDatabase, createAsserter, insertStaff } from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();
const APP_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36";
const PHONE_BROWSER_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function main() {
  console.log("================================================================================");
  console.log("SESSIONS: ONE APP + ONE BROWSER (live local PostgreSQL)");
  console.log("================================================================================");
  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  const staff = await insertStaff(db, "OPERATIONS_MANAGER", "Session Manager");
  const ok = async (t: string) => (await validateSessionDetailed(t, db)).user?.id === staff.id;

  console.log("\n--- 1. Kinds ---");
  assert(sessionKind(APP_UA) === "app", "The Android app's web view counts as the app");
  assert(sessionKind(PHONE_BROWSER_UA) === "browser" && sessionKind(DESKTOP_UA) === "browser" && sessionKind(undefined) === "browser", "Phone and desktop browsers count as a browser");

  console.log("\n--- 2. App and browser side by side ---");
  const browser1 = await createSession(staff.id, { preempt: true, ip: "10.0.0.1", userAgent: DESKTOP_UA }, db);
  const app1 = await createSession(staff.id, { preempt: true, ip: "10.0.0.2", userAgent: APP_UA }, db);
  assert((await ok(browser1.sessionToken)) && (await ok(app1.sessionToken)), "Signing in on the app keeps the browser session signed in");

  console.log("\n--- 3. A second sign-in of the same kind replaces the earlier one only ---");
  const app2 = await createSession(staff.id, { preempt: true, ip: "10.0.0.3", userAgent: APP_UA }, db);
  const oldApp = await validateSessionDetailed(app1.sessionToken, db);
  assert(oldApp.user === null && oldApp.isPreempted === true, "The earlier app session is signed out (and told why)");
  assert((await ok(app2.sessionToken)) && (await ok(browser1.sessionToken)), "The new app session and the browser session stay signed in");
  const browser2 = await createSession(staff.id, { preempt: true, ip: "10.0.0.4", userAgent: PHONE_BROWSER_UA }, db);
  const oldBrowser = await validateSessionDetailed(browser1.sessionToken, db);
  assert(oldBrowser.user === null && oldBrowser.isPreempted === true, "A browser sign-in on another device signs out the earlier browser session");
  assert((await ok(browser2.sessionToken)) && (await ok(app2.sessionToken)), "The app session is untouched by the browser sign-in");
  const n = await db.queryOne<any>("SELECT COUNT(*)::int AS n FROM sessions WHERE staff_id = ?", [staff.id]);
  assert(Number(n?.n) === 2, `Exactly two sessions remain (${n?.n})`);

  await destroySession(app2.sessionToken, db);
  await destroySession(browser2.sessionToken, db);

  console.log("\n================================================================================");
  console.log(`SESSIONS RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
  console.log("================================================================================");
}

main()
  .catch((err) => {
    state.failed++;
    console.error("Test runner error:", err?.stack ?? err?.message ?? err);
  })
  .finally(async () => {
    try {
      await closePg();
    } catch {}
    process.exit(state.failed > 0 ? 1 : 0);
  });
