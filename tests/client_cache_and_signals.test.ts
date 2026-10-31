/**
 * Unit tests for the performance/caching work (VL-26+):
 *  - client data cache: user scoping, tag invalidation + global hook, in-flight de-duplication, age
 *  - server change signals: which statements count as business writes
 *  - business date helpers (Asia/Kolkata, not UTC)
 * Pure functions only; no database, no network.
 */
import {
  setCachedData,
  getCachedData,
  invalidateErpCache,
  clearErpCache,
  executeErpFetch,
  setCacheOwner,
  onErpCacheInvalidated,
  getCacheAgeMs,
} from "../apps/erp/src/lib/cache/erpDataCache";
import { isBusinessWrite, onBusinessDataChanged, signalBusinessDataChanged } from "../apps/erp/src/server/database/changeSignals";
import { businessToday, addBusinessDays } from "../apps/erp/src/lib/businessDate";
import { sectionRedirectFor } from "../apps/erp/src/server/authorization/sectionAccess";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${message}`);
  }
}

async function main() {
  console.log("[SUITE 1] Client cache scoping per signed-in user");
  clearErpCache();
  setCacheOwner("user_owner");
  setCachedData("/api/finance/cashbook?x=1", { balance: 100 }, ["finance"]);
  assert(getCachedData("/api/finance/cashbook?x=1") !== null, "Entry is readable by the user who loaded it");
  setCacheOwner("user_owner");
  assert(getCachedData("/api/finance/cashbook?x=1") !== null, "Re-binding the same user keeps the cache");
  setCacheOwner("user_driver");
  assert(getCachedData("/api/finance/cashbook?x=1") === null, "Switching to another account clears every cached entry");

  console.log("\n[SUITE 2] Tag invalidation and the global hook");
  setCachedData("/api/orders?serviceDate=2026-10-30", { n: 1 }, ["orders"]);
  setCachedData("/api/rooms", { n: 2 }, ["rooms"]);
  const seen: Array<string[] | null> = [];
  const off = onErpCacheInvalidated((tags) => seen.push(tags));
  invalidateErpCache(["orders", "dashboard"]);
  assert(getCachedData("/api/orders?serviceDate=2026-10-30") === null, "Invalidating 'orders' drops the orders entry");
  assert(getCachedData("/api/rooms") !== null, "Unrelated entries (rooms) are kept");
  assert(seen.length === 1 && JSON.stringify(seen[0]) === JSON.stringify(["orders", "dashboard"]), "Global hook receives the invalidated tags (drives router refresh)");
  clearErpCache();
  off();

  console.log("\n[SUITE 3] In-flight de-duplication and age");
  let calls = 0;
  const fetcher = () => new Promise<number>((resolve) => setTimeout(() => { calls++; resolve(42); }, 20));
  const [a, b, c] = await Promise.all([
    executeErpFetch("/api/staff", fetcher, { tags: ["staff"] }),
    executeErpFetch("/api/staff", fetcher, { tags: ["staff"] }),
    executeErpFetch("/api/staff", fetcher, { tags: ["staff"] }),
  ]);
  assert(calls === 1 && a === 42 && b === 42 && c === 42, "Three concurrent requests for one key make one network call");
  const age = getCacheAgeMs("/api/staff");
  assert(age !== null && age >= 0 && age < 1000, `Cache age is tracked (${age} ms)`);
  assert(getCacheAgeMs("/api/never-loaded") === null, "Unknown key has no age");

  console.log("\n[SUITE 4] Business-write classification for server cache invalidation");
  assert(isBusinessWrite("INSERT INTO financial_transactions (id) VALUES (?)"), "Ledger insert is a business write");
  assert(isBusinessWrite('UPDATE "delivery_tasks" SET status = ? WHERE id = ?'), "Delivery update is a business write");
  assert(isBusinessWrite("  delete from resident_stays where id = ?"), "Delete is a business write (case/whitespace tolerant)");
  assert(!isBusinessWrite("INSERT INTO sessions (id) VALUES (?)"), "Session insert is not");
  assert(!isBusinessWrite("DELETE FROM auth_challenges WHERE id = ?"), "OTP challenge delete is not");
  assert(!isBusinessWrite("INSERT INTO login_attempts (id) VALUES (?)"), "Login attempt is not");
  assert(!isBusinessWrite("INSERT INTO audit_logs (id) VALUES (?)"), "Audit log is not");
  assert(!isBusinessWrite("SELECT * FROM financial_transactions"), "Reads are not");
  let signals = 0;
  const offSignal = onBusinessDataChanged(() => signals++);
  signalBusinessDataChanged();
  offSignal();
  signalBusinessDataChanged();
  assert(signals === 1, "Listeners receive signals until unsubscribed");

  console.log("\n[SUITE 5] Business date (Asia/Kolkata)");
  // 2026-10-29T20:00Z is 01:30 on 30 Oct in India: UTC would still say the 29th.
  assert(businessToday(new Date("2026-10-29T20:00:00Z")) === "2026-10-30", "After IST midnight the business date has rolled over");
  assert(businessToday(new Date("2026-10-29T18:00:00Z")) === "2026-10-29", "Before IST midnight it has not");
  assert(addBusinessDays("2026-12-31", 1) === "2027-01-01", "Year rollover");
  assert(addBusinessDays("2026-03-01", -1) === "2026-02-28", "Month rollback");

  console.log("\n[SUITE 6] In-flight requests vs. invalidation (no pre-mutation data after a change)");
  clearErpCache();
  setCacheOwner("user_owner");
  let release: (v: string) => void = () => {};
  const slowOld = executeErpFetch("/api/delivery/tasks?d=1", () => new Promise<string>((r) => (release = r)), { tags: ["delivery"] });
  invalidateErpCache(["delivery"]); // a delivery was completed while the poll was in flight
  let freshCalls = 0;
  const fresh = executeErpFetch("/api/delivery/tasks?d=1", async () => { freshCalls++; return "after-change"; }, { tags: ["delivery"] });
  assert((await fresh) === "after-change" && freshCalls === 1, "A request after the invalidation does not join the earlier in-flight request");
  release("before-change");
  assert((await slowOld) === "before-change", "The earlier caller still receives its own response");
  assert(getCachedData("/api/delivery/tasks?d=1")?.data === "after-change", "The pre-change response is not written over the fresh cache entry");

  let releaseB: (v: string) => void = () => {};
  const beforeLogout = executeErpFetch("/api/finance/cashbook?x=2", () => new Promise<string>((r) => (releaseB = r)), { tags: ["finance"] });
  clearErpCache(); // sign-out
  releaseB("owner-figures");
  await beforeLogout;
  assert(getCachedData("/api/finance/cashbook?x=2") === null, "A response arriving after sign-out is discarded");

  let releaseC: (v: string) => void = () => {};
  const beforeSwitch = executeErpFetch("/api/staff?y=1", () => new Promise<string>((r) => (releaseC = r)), { tags: ["staff"] });
  setCacheOwner("user_manager");
  releaseC("owner-staff");
  await beforeSwitch;
  assert(getCachedData("/api/staff?y=1") === null, "A response for the previous account is discarded after an account switch");

  console.log("\n[SUITE 7] Cache size is bounded");
  clearErpCache();
  for (let i = 0; i < 350; i++) setCachedData(`/api/orders?serviceDate=k${i}`, i, ["orders"]);
  assert(getCachedData("/api/orders?serviceDate=k0") === null, "Oldest entries are evicted beyond the bound");
  assert(getCachedData("/api/orders?serviceDate=k349")?.data === 349, "Newest entry is kept");
  let kept = 0;
  for (let i = 0; i < 350; i++) if (getCachedData(`/api/orders?serviceDate=k${i}`)) kept++;
  assert(kept === 300, `Exactly the bound is kept (${kept})`);
  clearErpCache();

  console.log("\n[SUITE 8] Section redirects by role (before the page renders)");
  assert(sectionRedirectFor("DELIVERY_PERSON", "/delivery") === null, "Delivery stays on /delivery");
  for (const p of ["/dashboard", "/rooms", "/residents/abc", "/finance", "/staff", "/orders"]) {
    assert(sectionRedirectFor("DELIVERY_PERSON", p) === "/delivery", `Delivery is sent from ${p} to /delivery`);
  }
  assert(sectionRedirectFor("OPERATIONS_MANAGER", "/staff") === "/dashboard", "Manager is sent from /staff to /dashboard");
  for (const p of ["/dashboard", "/rooms", "/residents", "/finance", "/orders", "/delivery"]) {
    assert(sectionRedirectFor("OPERATIONS_MANAGER", p) === null, `Manager keeps ${p}`);
    assert(sectionRedirectFor("SUPER_ADMIN", p) === null, `Owner keeps ${p}`);
  }
  assert(sectionRedirectFor("SUPER_ADMIN", "/staff") === null, "Owner keeps /staff");
  assert(sectionRedirectFor("KITCHEN_OPERATIONS", "/finance") === "/dashboard", "A role without finance.read is sent away from /finance");
  assert(sectionRedirectFor("DELIVERY_PERSON", "/deliveryx") === "/delivery", "Prefix matching respects segment boundaries");

  console.log(`\nCLIENT CACHE & SIGNALS RESULTS: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
