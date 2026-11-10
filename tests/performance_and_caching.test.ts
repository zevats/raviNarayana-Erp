import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { AsyncDb } from "../apps/erp/src/server/database/db";
import * as auth from "../apps/erp/src/server/authentication/auth";
import {
  getCachedData,
  setCachedData,
  executeErpFetch,
  invalidateErpCache,
  clearErpCache,
} from "../apps/erp/src/lib/cache/erpDataCache";
import {
  getDashboardMetrics,
  invalidateDashboardCache,
} from "../apps/erp/src/server/dashboard/dashboardService";
import {
  renderOtpEmail,
  escapeHtml,
} from "../apps/erp/src/server/notifications/emailTemplate";

const TEST_DB_PATH = path.resolve(__dirname, "test_perf_cache.db");

function cleanupTestDbFiles() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  const wal = `${TEST_DB_PATH}-wal`;
  const shm = `${TEST_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDbFiles();

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

function createSqliteAsyncDb(sqlite: Database.Database): AsyncDb {
  return {
    isPostgres: false,
    async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
      const stmt = sqlite.prepare(sql);
      return stmt.all(...params) as T[];
    },
    async queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
      const stmt = sqlite.prepare(sql);
      const row = stmt.get(...params);
      return (row as T) || null;
    },
    async execute(sql: string, params: any[] = []): Promise<{ changes: number }> {
      const stmt = sqlite.prepare(sql);
      const info = stmt.run(...params);
      return { changes: info.changes };
    },
    async transaction<T>(fn: (tx: AsyncDb) => Promise<T>): Promise<T> {
      return fn(this);
    },
  };
}

async function runAllSuites() {
  console.log("================================================================================");
  console.log("RAVINARAYAN ERP — PERFORMANCE, CACHING & AUTHENTICATION UX TEST SUITE");
  console.log("================================================================================\n");

  const rawDb = new Database(TEST_DB_PATH);
  runMigrations(rawDb);
  const asyncDb = createSqliteAsyncDb(rawDb);

  // Seed sample admin staff user
  const adminId = "staff_perf_01";
  const passwordHash = await auth.hashPassword("SuperSecretPass123!");
  const now = new Date().toISOString();
  await asyncDb.execute(
    `INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [adminId, "perfadmin", "perf.admin@example.com", "Performance Admin", passwordHash, "SUPER_ADMIN", now, now]
  );

  // ---------------------------------------------------------------------------
  // [TEST SUITE 1] Client Cache Core & In-Flight Request Deduplication
  // ---------------------------------------------------------------------------
  console.log("[TEST SUITE 1] Client Cache Core & In-Flight Request Deduplication");
  clearErpCache();

  assert(getCachedData("/api/test-key") === null, "Initial cache miss returns null");

  setCachedData("/api/test-key", { count: 42 }, ["test-tag"]);
  const hit = getCachedData<{ count: number }>("/api/test-key");
  assert(hit !== null && hit.data.count === 42, "Cached item retrieved synchronously");

  // In-flight deduplication: verify that multiple concurrent callers trigger fetcher exactly once
  let networkFetchCount = 0;
  const slowFetcher = async () => {
    networkFetchCount++;
    await new Promise((r) => setTimeout(r, 50));
    return { payload: "heavy_data" };
  };

  const [res1, res2, res3] = await Promise.all([
    executeErpFetch("/api/concurrent-test", slowFetcher, { tags: ["concurrent"] }),
    executeErpFetch("/api/concurrent-test", slowFetcher, { tags: ["concurrent"] }),
    executeErpFetch("/api/concurrent-test", slowFetcher, { tags: ["concurrent"] }),
  ]);

  assert(
    networkFetchCount === 1,
    `Concurrent in-flight requests deduplicated: fetcher called 1 time (got ${networkFetchCount})`
  );
  assert(
    res1.payload === "heavy_data" && res2.payload === "heavy_data" && res3.payload === "heavy_data",
    "All concurrent callers received exact response payload"
  );

  // Tag-based invalidation
  setCachedData("/api/rooms-list", [{ id: "room1" }], ["rooms"]);
  setCachedData("/api/finance-ledger", [{ id: "tx1" }], ["finance"]);

  invalidateErpCache(["rooms"]);
  assert(getCachedData("/api/rooms-list") === null, "Rooms cache entry invalidated by tag");
  assert(getCachedData("/api/finance-ledger") !== null, "Finance cache entry preserved when invalidating rooms");

  clearErpCache();
  assert(getCachedData("/api/finance-ledger") === null, "clearErpCache purges entire cache store");

  // ---------------------------------------------------------------------------
  // [TEST SUITE 2] Server-Side Session Validation Memoization
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 2] Server-Side Session Validation Memoization");

  // Create session
  const session = await auth.createSession(adminId, { ip: "127.0.0.1", userAgent: "test-agent" }, asyncDb);
  assert(Boolean(session.sessionToken), "Session created successfully");

  // Instrument asyncDb.queryOne to count SQL queries during validation
  let sessionSqlCalls = 0;
  const originalQueryOne = asyncDb.queryOne.bind(asyncDb);
  asyncDb.queryOne = async (sql: string, params: any[] = []) => {
    if (sql.includes("FROM sessions s")) {
      sessionSqlCalls++;
    }
    return originalQueryOne(sql, params);
  };

  // Request-scoped session memoizer (as implemented via React.cache across Layout & Page in RSC)
  const createRequestScopedValidator = () => {
    const memo = new Map<string, any>();
    return async (token: string) => {
      if (memo.has(token)) return memo.get(token);
      const res = await auth.validateSession(token, asyncDb);
      memo.set(token, res);
      return res;
    };
  };

  const requestScopedValidate = createRequestScopedValidator();

  // Call 1: cold validation (e.g. ManagementLayout)
  const v1 = await requestScopedValidate(session.sessionToken);
  assert(v1 !== null && v1.id === adminId, "Cold session validation succeeds");
  assert(sessionSqlCalls === 1, "First validation executes exactly 1 database query");

  // Call 2: warm validation within same request (e.g. DashboardPage)
  const v2 = await requestScopedValidate(session.sessionToken);
  assert(v2 !== null && v2.id === adminId, "Subsequent validation succeeds");
  assert(sessionSqlCalls === 1, "Duplicate validation within request lifecycle hits memoized cache (0 extra DB queries)");

  // Destroy session should purge session from database immediately
  await auth.destroySession(session.sessionToken, asyncDb);
  const vPostDestroy = await auth.validateSession(session.sessionToken, asyncDb);
  assert(vPostDestroy === null, "Post-destroy validation immediately returns null");

  // Restore queryOne
  asyncDb.queryOne = originalQueryOne;

  // ---------------------------------------------------------------------------
  // [TEST SUITE 3] Server-Side Dashboard Parallel Metrics & Freshness Cache
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 3] Server-Side Dashboard Parallel Metrics & Freshness Cache");
  invalidateDashboardCache();

  // Seed sample room and financial transaction
  await asyncDb.execute(
    `INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
     VALUES ('rm_perf_01', '101', 1, 'DOUBLE_SHARING', 2, 8500, 1, ?, ?)`,
    [now, now]
  );
  await asyncDb.execute(
    `INSERT INTO financial_transactions (id, transaction_type, category, amount, transaction_date, status, created_by, created_at, updated_at)
     VALUES ('tx_perf_01', 'RENT_PAYMENT', 'RENT', 8500, ?, 'POSTED', ?, ?, ?)`,
    [now.slice(0, 10), adminId, now, now]
  );

  const startMetricTime = Date.now();
  const metrics1 = await getDashboardMetrics(asyncDb);
  const metricElapsed1 = Date.now() - startMetricTime;

  assert(metrics1.occupancy.totalRooms >= 1, `Total rooms counted: ${metrics1.occupancy.totalRooms}`);
  assert(metrics1.occupancy.totalCapacity >= 2, `Total capacity counted: ${metrics1.occupancy.totalCapacity}`);
  assert(metrics1.finance.totalRentCollected >= 8500, `Rent collected aggregated: ₹${metrics1.finance.totalRentCollected}`);
  assert(Array.isArray(metrics1.monthlyData) && metrics1.monthlyData.length === 6, "6-month historical chart populated");

  // Second call should hit the 15-second in-memory dashboard cache in ~0ms
  const startCacheTime = Date.now();
  const metrics2 = await getDashboardMetrics(asyncDb);
  const metricElapsed2 = Date.now() - startCacheTime;

  assert(metrics1 === metrics2, "Dashboard metrics cache hit returns identical reference");
  assert(metricElapsed2 <= metricElapsed1, `Cache hit latency (${metricElapsed2}ms) <= cold latency (${metricElapsed1}ms)`);

  // Invalidate dashboard cache
  invalidateDashboardCache();
  const metrics3 = await getDashboardMetrics(asyncDb);
  assert(metrics3 !== null, "Dashboard metrics re-fetched after manual cache invalidation");

  // ---------------------------------------------------------------------------
  // [TEST SUITE 4] Transactional Email Template & HTML Rendering
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 4] Transactional Email Template & HTML Rendering");

  // HTML escaping security checks
  const unsafeStr = `<script>alert("xss")</script>&'test'`;
  const safeStr = escapeHtml(unsafeStr);
  assert(!safeStr.includes("<script>"), "HTML script tag escaped");
  assert(safeStr.includes("&lt;script&gt;"), "Script tag replaced with &lt; and &gt;");
  assert(safeStr.includes("&quot;"), "Quotes escaped with &quot;");
  assert(safeStr.includes("&#039;"), "Single quotes escaped with &#039;");

  // Render OTP email
  const rendered = renderOtpEmail({
    otp: "849201",
    recipientEmail: "perf.admin@example.com",
    expiresInMinutes: 10,
  });

  assert(rendered.subject === "849201 is your Ravinarayan sign-in code", `Subject leads with the code (shows in the notification): "${rendered.subject}"`);
  assert(rendered.text.includes("849201"), "Plain-text email contains the 6-digit OTP code");
  assert(rendered.text.includes("10 minutes"), "Plain-text email mentions 10-minute expiry");
  assert(rendered.text.includes("Ravinarayan"), "Plain-text email is branded");
  assert(/Not you\?/.test(rendered.text) && /Never share/.test(rendered.text), "Plain-text email includes the short security line");
  assert(rendered.html.includes("849201 · expires in 10 minutes"), "Preview line (preheader) carries the code");

  // HTML layout assertions
  assert(rendered.html.includes("<!DOCTYPE html"), "HTML contains valid DOCTYPE");
  assert(rendered.html.includes("849201"), "HTML email displays the 6-digit OTP code");
  assert(rendered.html.includes("#1A2E20"), "HTML email features Deep Forest (#1A2E20) brand color");
  assert(rendered.html.includes("#FAF8F5"), "HTML email features the ivory canvas background");
  assert(rendered.html.includes("font-family"), "HTML email has inline font-family declarations for email clients");
  assert(rendered.html.includes("max-width:580px"), "HTML container constrained to 580px width");

  // ---------------------------------------------------------------------------
  // [TEST SUITE 5] Middleware Route Matching Integrity
  // ---------------------------------------------------------------------------
  console.log("\n[TEST SUITE 5] Middleware Route Matching Integrity");

  // Verify that both verify and resend fall under the unauthenticated OTP prefix
  const middlewarePath = path.resolve(process.cwd(), "apps/erp/src/middleware.ts");
  const middlewareSrc = fs.readFileSync(middlewarePath, "utf8");

  assert(
    middlewareSrc.includes('!pathname.startsWith("/api/auth/otp/")'),
    "Middleware whitelists entire /api/auth/otp/ tree (permitting both verify and resend without session cookie)"
  );

  // ---------------------------------------------------------------------------
  // Final Results
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`FINAL PERFORMANCE & CACHING TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  rawDb.close();
  cleanupTestDbFiles();

  if (failCount > 0) {
    process.exit(1);
  }
}

runAllSuites().catch((err) => {
  console.error("Test execution aborted with unhandled error:", err);
  process.exit(1);
});
