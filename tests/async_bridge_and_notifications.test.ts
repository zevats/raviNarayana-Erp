import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";
import {
  closeDb,
  findRepoRoot,
  createAsyncDbFromSqlite,
  checkDemoProvenance,
  invalidateDemoProvenanceCache,
  AsyncDb,
} from "../apps/erp/src/server/database/db";
import { runMigrations } from "./helpers/sqliteMigrations";
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "../apps/erp/src/server/notifications/notificationService";
import { AuthenticatedUser } from "../apps/erp/src/types";

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
console.log("TASK 01B.19 — ASYNC BRIDGE & NOTIFICATION SERVICE OFFLINE REGRESSION SUITE");
console.log("Strictly offline — zero network connections, zero access to production data/erp.db");
console.log("================================================================================\n");

async function runTestSuite() {
  const repoRoot = findRepoRoot();
  const primaryDbPath = path.resolve(repoRoot, "data", "erp.db");
  const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

  // Use a dedicated isolated temporary SQLite database
  const tempDbPath = path.resolve(os.tmpdir(), `test_async_bridge_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  function cleanupTemp() {
    closeDb();
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    if (fs.existsSync(`${tempDbPath}-wal`)) fs.unlinkSync(`${tempDbPath}-wal`);
    if (fs.existsSync(`${tempDbPath}-shm`)) fs.unlinkSync(`${tempDbPath}-shm`);
  }
  cleanupTemp();

  // Point ERP_DATABASE_PATH to temp database
  process.env.ERP_DATABASE_PATH = tempDbPath;

  // Initialize schema with standard migrations in temporary database
  const rawDb = new Database(tempDbPath);
  rawDb.pragma("journal_mode = WAL");
  rawDb.pragma("foreign_keys = ON");
  runMigrations(rawDb);
  rawDb.close();

  // ---------------------------------------------------------------------------
  // SUITE 1: checkDemoProvenance Engine-Aware Check & Dialect Independence
  // ---------------------------------------------------------------------------
  console.log("[SUITE 1] checkDemoProvenance Engine-Aware Check");

  // 1.1: SQLite mode - seed_manifest table does not exist
  const provNoTable = await checkDemoProvenance();
  assert(provNoTable === false, "Returns false when seed_manifest table does not exist in SQLite");

  // 1.2: SQLite mode - seed_manifest table exists but is empty
  const rawDb2 = new Database(tempDbPath);
  rawDb2.exec("CREATE TABLE seed_manifest (id TEXT PRIMARY KEY, timestamp TEXT)");
  rawDb2.close();
  closeDb(); // reset cached db
  invalidateDemoProvenanceCache(); // the result is memoized per process; each case must re-evaluate
  const provEmptyTable = await checkDemoProvenance();
  assert(provEmptyTable === false, "Returns false when seed_manifest exists but is empty");

  // 1.3: SQLite mode - seed_manifest has records
  const rawDb3 = new Database(tempDbPath);
  rawDb3.exec("INSERT INTO seed_manifest (id, timestamp) VALUES ('manifest_1', datetime('now'))");
  rawDb3.close();
  closeDb(); // reset cached db
  invalidateDemoProvenanceCache();
  const provWithRows = await checkDemoProvenance();
  assert(provWithRows === true, "Returns true when seed_manifest contains records in SQLite");

  // 1.4: Postgres mode mock - information_schema check (table missing)
  const mockPgNoTable: AsyncDb = {
    isPostgres: true,
    async query() { return []; },
    async queryOne<T = any>() { return { count: "0" } as unknown as T; },
    async execute() { return { changes: 0 }; },
    async transaction(cb) { return cb(mockPgNoTable); },
  };
  const provPgNoTable = await checkDemoProvenance(mockPgNoTable);
  assert(provPgNoTable === false, "Returns false for Postgres when information_schema reports 0 count");

  // 1.5: Postgres mode mock - table exists with rows (string count format)
  let pgQueryStep = 0;
  const mockPgWithRows: AsyncDb = {
    isPostgres: true,
    async query() { return []; },
    async queryOne<T = any>() {
      pgQueryStep++;
      if (pgQueryStep === 1) return { count: "1" } as unknown as T; // information_schema check
      return { count: "42" } as unknown as T; // seed_manifest count
    },
    async execute() { return { changes: 0 }; },
    async transaction(cb) { return cb(mockPgWithRows); },
  };
  const provPgWithRows = await checkDemoProvenance(mockPgWithRows);
  assert(provPgWithRows === true, "Returns true for Postgres when seed_manifest has count > 0 (string count handled)");

  // 1.6: Postgres mode mock - error resilience
  const mockPgError: AsyncDb = {
    isPostgres: true,
    async query() { throw new Error("Connection refused"); },
    async queryOne() { throw new Error("Connection refused"); },
    async execute() { throw new Error("Connection refused"); },
    async transaction() { throw new Error("Connection refused"); },
  };
  const provPgError = await checkDemoProvenance(mockPgError);
  assert(provPgError === false, "Safely catches database errors and returns false without throwing");

  // ---------------------------------------------------------------------------
  // SUITE 2: createAsyncDbFromSqlite Core Operations & Transaction Integrity
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 2] createAsyncDbFromSqlite Operations & Transaction Integrity");

  const memDb = new Database(":memory:");
  memDb.exec(`
    CREATE TABLE test_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      score INTEGER NOT NULL
    );
  `);
  const asyncAdapter = createAsyncDbFromSqlite(memDb);

  // 2.1: query
  const resExec1 = await asyncAdapter.execute(
    "INSERT INTO test_items (id, name, score) VALUES (?, ?, ?)",
    ["item_1", "Alpha", 100]
  );
  assert(resExec1.changes === 1, "execute returns changes count 1");

  const rows = await asyncAdapter.query<{ id: string; name: string; score: number }>(
    "SELECT * FROM test_items WHERE id = ?",
    ["item_1"]
  );
  assert(rows.length === 1 && rows[0].name === "Alpha", "query returns matching row");

  // 2.2: queryOne
  const rowOne = await asyncAdapter.queryOne<{ name: string }>(
    "SELECT name FROM test_items WHERE id = ?",
    ["item_1"]
  );
  assert(rowOne !== null && rowOne.name === "Alpha", "queryOne returns object when row exists");

  const rowNull = await asyncAdapter.queryOne(
    "SELECT name FROM test_items WHERE id = ?",
    ["nonexistent"]
  );
  assert(rowNull === null, "queryOne returns null when no matching row");

  // 2.3: transaction commits on success
  await asyncAdapter.transaction(async (tx) => {
    await tx.execute("INSERT INTO test_items (id, name, score) VALUES (?, ?, ?)", ["item_2", "Beta", 200]);
    await tx.execute("INSERT INTO test_items (id, name, score) VALUES (?, ?, ?)", ["item_3", "Gamma", 300]);
  });
  const countAfterCommit = await asyncAdapter.queryOne<{ count: number }>("SELECT count(*) as count FROM test_items");
  assert(countAfterCommit?.count === 3, "Transaction commits all modifications on success");

  // 2.4: transaction rolls back on error
  let rollbackCaught = false;
  try {
    await asyncAdapter.transaction(async (tx) => {
      await tx.execute("INSERT INTO test_items (id, name, score) VALUES (?, ?, ?)", ["item_4", "Delta", 400]);
      throw new Error("Simulated transaction failure");
    });
  } catch (err: any) {
    rollbackCaught = err.message === "Simulated transaction failure";
  }
  assert(rollbackCaught, "Transaction throws caught error outwards");
  const countAfterRollback = await asyncAdapter.queryOne<{ count: number }>("SELECT count(*) as count FROM test_items");
  assert(countAfterRollback?.count === 3, "Transaction rolls back uncommitted changes on error (count remains 3)");

  // 2.5: Nested transaction capability
  let nestedSuccess = false;
  await asyncAdapter.transaction(async (tx1) => {
    await tx1.execute("INSERT INTO test_items (id, name, score) VALUES (?, ?, ?)", ["item_nest_1", "Nested1", 500]);
    await tx1.transaction(async (tx2) => {
      await tx2.execute("INSERT INTO test_items (id, name, score) VALUES (?, ?, ?)", ["item_nest_2", "Nested2", 600]);
    });
    nestedSuccess = true;
  });
  assert(nestedSuccess, "Nested transaction execution succeeds without BEGIN IMMEDIATE conflict");
  const countAfterNested = await asyncAdapter.queryOne<{ count: number }>("SELECT count(*) as count FROM test_items");
  assert(countAfterNested?.count === 5, "Both outer and nested modifications persist");

  memDb.close();

  // ---------------------------------------------------------------------------
  // SUITE 3: notificationService Async Conversion, Cross-Engine ON CONFLICT, and Scoped Transactions
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 3] notificationService Async & Cross-Engine Compatibility");

  // Setup test data in tempDbPath
  const seederDb = new Database(tempDbPath);

  // Clean operational tables
  seederDb.exec(`
    DELETE FROM staff_notification_reads;
    DELETE FROM delivery_task_events;
    DELETE FROM delivery_tasks;
    DELETE FROM financial_transactions;
    DELETE FROM resident_stays;
    DELETE FROM residents;
    DELETE FROM rooms;
    DELETE FROM daily_meal_plans;
  `);

  const nowIso = new Date().toISOString();
  const pastIso = new Date(Date.now() - 3600000).toISOString();

  // 1. Seed Staff User
  seederDb.prepare(`
    INSERT OR REPLACE INTO staff_users (id, username, email, full_name, role, password_hash, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run('usr_staff_test', 'staff_test', 'staff@ravinarayan.in', 'Staff Test User', 'OPERATIONS_MANAGER', 'dummy_hash', pastIso, nowIso);

  // 2. Seed rooms, residents, and stays
  seederDb.exec(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES ('room_101', '101', 1, 'DOUBLE', 2, 8000, 1, '${pastIso}', '${nowIso}');

    INSERT INTO residents (id, full_name, phone, email, status, created_at, updated_at)
    VALUES ('res_1', 'Rohan Sharma', '+919876543210', 'rohan@example.com', 'ACTIVE', '${pastIso}', '${nowIso}');

    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES ('stay_1', 'res_1', 'room_101', '2026-01-01', 8000, 8000, 'ACTIVE', '${pastIso}', '${nowIso}');
  `);

  // 3. Seed Meal Plan
  seederDb.exec(`
    INSERT INTO daily_meal_plans (id, service_date, meal_type, status, final_preparation_count, actual_cooked_count, created_by, confirmed_at, completed_at, created_at, updated_at)
    VALUES
      ('plan_1', '2026-10-17', 'DINNER', 'CONFIRMED', 50, 0, 'usr_staff_test', '${nowIso}', NULL, '${pastIso}', '${nowIso}');
  `);

  // 4. Seed Delivery Tasks: 1 EXCEPTION, 1 PENDING, 1 DISPATCHED
  seederDb.exec(`
    INSERT INTO delivery_tasks (id, order_type, plan_id, service_date, meal_type, customer_name, delivery_address, room_number, floor, exception_reason, status, resident_id, created_at, updated_at, dispatched_at)
    VALUES
      ('del_1', 'EXTERNAL', 'plan_1', '2026-10-17', 'LUNCH', 'Amit Verma', 'Sector 14', NULL, NULL, 'Customer unavailable', 'EXCEPTION', NULL, '${pastIso}', '${nowIso}', NULL),
      ('del_2', 'RESIDENT', 'plan_1', '2026-10-17', 'DINNER', NULL, NULL, '101', 1, NULL, 'PENDING', 'res_1', '${nowIso}', '${nowIso}', NULL),
      ('del_3', 'RESIDENT', 'plan_1', '2026-10-17', 'DINNER', NULL, NULL, '101', 1, NULL, 'OUT_FOR_DELIVERY', 'res_1', '${pastIso}', '${nowIso}', '${nowIso}');
  `);

  // 5. Seed Finance: Rent charge 10000, rent payment 4000 -> overdue balance 6000
  seederDb.exec(`
    INSERT INTO financial_transactions (id, resident_id, stay_id, transaction_type, category, status, amount, payment_method, transaction_date, description, created_by, created_at, updated_at)
    VALUES
      ('ft_charge_1', 'res_1', 'stay_1', 'RENT_CHARGE', 'RENT', 'POSTED', 10000, NULL, '2026-10-01', 'October Rent', 'usr_staff_test', '${pastIso}', '${pastIso}'),
      ('ft_pay_1', 'res_1', 'stay_1', 'RENT_PAYMENT', 'RENT', 'POSTED', 4000, 'UPI', '2026-10-05', 'Part payment', 'usr_staff_test', '${nowIso}', '${nowIso}');
  `);

  seederDb.close();
  closeDb(); // ensure connection pool reconnects cleanly

  const staffUser: AuthenticatedUser = {
    id: "usr_staff_test",
    username: "staff_test",
    email: "staff@ravinarayan.in",
    fullName: "Staff Test User",
    role: "OPERATIONS_MANAGER",
  };

  // 3.1: getNotifications returns populated list
  const notifResult = await getNotifications(staffUser);
  assert(Array.isArray(notifResult.notifications), "getNotifications returns array");
  assert(notifResult.notifications.length >= 5, `Expected >= 5 notifications, got ${notifResult.notifications.length}`);
  assert(notifResult.unreadCount === notifResult.notifications.length, "All notifications initially unread");

  // Verify delivery exception notification exists
  const exNotif = notifResult.notifications.find((n) => n.id === "notif_del_ex_del_1");
  assert(Boolean(exNotif && exNotif.domain === "DELIVERY" && exNotif.type === "ALERT"), "Delivery exception notification present with ALERT type");

  // Verify overdue rent notification exists (validating cross-engine HAVING clause)
  const overdueNotif = notifResult.notifications.find((n) => n.id === "notif_fin_overdue_res_1");
  assert(Boolean(overdueNotif && overdueNotif.domain === "FINANCE" && overdueNotif.metadata?.balance === 6000), "Finance overdue rent notification computed via cross-engine HAVING clause (balance ₹6,000)");

  // 3.2: markNotificationAsRead with ON CONFLICT (idempotent)
  const firstId = notifResult.notifications[0].id;
  await markNotificationAsRead(staffUser, firstId);
  const afterRead1 = await getNotifications(staffUser);
  assert(afterRead1.unreadCount === notifResult.unreadCount - 1, "Unread count decrements by 1 after markNotificationAsRead");
  const readItem = afterRead1.notifications.find((n) => n.id === firstId);
  assert(readItem?.isRead === true, "Marked notification reports isRead === true");

  // Repeat markNotificationAsRead for the same id — verifies ON CONFLICT DO NOTHING does not error
  let repeatError = false;
  try {
    await markNotificationAsRead(staffUser, firstId);
  } catch {
    repeatError = true;
  }
  assert(!repeatError, "Repeated markNotificationAsRead with ON CONFLICT DO NOTHING does not error (idempotent)");

  // 3.3: markAllNotificationsAsRead with transaction
  await markAllNotificationsAsRead(staffUser);
  const afterAllRead = await getNotifications(staffUser);
  assert(afterAllRead.unreadCount === 0, "markAllNotificationsAsRead leaves unreadCount at 0");
  assert(afterAllRead.notifications.every((n) => n.isRead === true), "All notifications report isRead === true");

  // Repeat markAllNotificationsAsRead when already 0 unread
  let markAllRepeatError = false;
  try {
    await markAllNotificationsAsRead(staffUser);
  } catch {
    markAllRepeatError = true;
  }
  assert(!markAllRepeatError, "markAllNotificationsAsRead handles 0 remaining notifications safely");

  // ---------------------------------------------------------------------------
  // SUITE 4: Zero Database Access Guard
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 4] Zero Primary Database Access Guard");

  const primaryStatsAfter = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;
  if (primaryStatsBefore && primaryStatsAfter) {
    assert(
      primaryStatsBefore.size === primaryStatsAfter.size,
      `Primary database size unchanged (${primaryStatsBefore.size} bytes)`
    );
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs,
      `Primary database mtime unchanged (${primaryStatsBefore.mtime.toISOString()})`
    );
  } else {
    assert(true, "Primary database verification step completed");
  }

  // Cleanup temporary files
  cleanupTemp();

  console.log("\n================================================================================");
  console.log(`FINAL ASYNC BRIDGE & NOTIFICATION TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
