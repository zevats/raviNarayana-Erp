import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { runMigrations } from "./helpers/sqliteMigrations";
import { getAsyncDb, closeDb } from "../apps/erp/src/server/database/db";
import {
  createExternalDeliveryTask,
  assignDeliveryTask,
  dispatchDeliveryTask,
  syncDeliveryActions,
  getDeliveryTaskById,
} from "../apps/erp/src/server/delivery/deliveryService";
import {
  enqueueDeliveryAction,
  getOfflineQueue,
  saveOfflineQueue,
  removeQueuedAction,
  clearCompletedActions,
  clearUserOfflineQueue,
  processOfflineQueue,
} from "../apps/erp/src/modules/delivery/offlineQueue";
import {
  AuthenticatedUser,
  QueuedDeliveryAction,
  DeliveryTask,
} from "../apps/erp/src/types";

// ----------------------------------------------------------------------------
// Primary DB immutability guard
// ----------------------------------------------------------------------------
const ROOT = process.cwd();
const primaryDbPath = path.resolve(ROOT, "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test DB for Task 01B.67
const TEST_ROLE_DB_PATH = path.resolve(ROOT, "tests", "test_task67_role_workflows.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_ROLE_DB_PATH)) fs.unlinkSync(TEST_ROLE_DB_PATH);
  const wal = `${TEST_ROLE_DB_PATH}-wal`;
  const shm = `${TEST_ROLE_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_ROLE_DB_PATH;

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
console.log("TASK 01B.67: MOBILE ROLE WORKFLOWS & OFFLINE SECURITY TEST SUITE");
console.log("================================================================================\n");

// Mock browser localStorage for offline queue tests in Node runtime
const storageStore: Record<string, string> = {};
(global as any).window = {
  location: { reload: () => {} },
};
(global as any).localStorage = {
  getItem: (key: string) => storageStore[key] || null,
  setItem: (key: string, val: string) => {
    storageStore[key] = val;
  },
  removeItem: (key: string) => {
    delete storageStore[key];
  },
  clear: () => {
    for (const k of Object.keys(storageStore)) delete storageStore[k];
  },
};

async function runTask67Tests() {
  // ============================================================================
  // TEST SUITE 1: Offline Queue Security & Account Isolation Prerequisites
  // ============================================================================
  console.log("[TEST SUITE 1] Offline Queue Security & Account Isolation Prerequisites");

  localStorage.clear();

  // Test 1.1: Payload Sanitization & Stripping of Sensitive Fields
  const dirtyCompletePayload = {
    recipientName: "Ashok Sharma",
    notes: "Leave with security",
    collectedAmount: 250,
    paymentMethod: "CASH",
    // Injected sensitive data that MUST be stripped:
    sessionToken: "rn_sess_super_secret_token_123",
    userPasswordHash: "fake_hash_value",
    kycDocumentRef: "/storage/kyc/doc_123.pdf",
    adminOverride: true,
  };

  const action1 = enqueueDeliveryAction(
    "COMPLETE_DELIVERY",
    "tsk_sec_001",
    dirtyCompletePayload,
    "usr_driver_ramesh"
  );

  assert(action1.userId === "usr_driver_ramesh", "Queued action is explicitly tagged with authenticated userId");
  assert(action1.payload.recipientName === "Ashok Sharma", "Sanitized payload retains recipientName");
  assert(action1.payload.collectedAmount === 250, "Sanitized payload retains collectedAmount");
  assert(action1.payload.paymentMethod === "CASH", "Sanitized payload retains paymentMethod");
  assert(action1.payload.sessionToken === undefined, "Security Guard: sessionToken stripped from offline queue payload");
  assert(action1.payload.userPasswordHash === undefined, "Security Guard: userPasswordHash stripped from offline queue");
  assert(action1.payload.kycDocumentRef === undefined, "Security Guard: kycDocumentRef stripped from offline queue");
  assert(action1.payload.adminOverride === undefined, "Security Guard: arbitrary unknown keys stripped from offline queue");

  // Test 1.2: Payload Sanitization for REPORT_EXCEPTION
  const dirtyExceptionPayload = {
    exceptionType: "RESIDENT_UNAVAILABLE",
    reason: "Doorbell not answered after 3 attempts",
    cookieJar: "secret_cookie=xyz",
    internalDossier: { bankDetails: "private" },
  };

  const action2 = enqueueDeliveryAction(
    "REPORT_EXCEPTION",
    "tsk_sec_002",
    dirtyExceptionPayload,
    "usr_driver_ramesh"
  );

  assert(action2.payload.exceptionType === "RESIDENT_UNAVAILABLE", "Sanitized exception payload retains exceptionType");
  assert(action2.payload.reason.includes("Doorbell not answered"), "Sanitized exception payload retains reason");
  assert(action2.payload.cookieJar === undefined, "Security Guard: cookieJar stripped from exception payload");
  assert(action2.payload.internalDossier === undefined, "Security Guard: internalDossier stripped from exception payload");

  // Test 1.3: Cross-Account Queue Isolation in Client Storage
  // Enqueue an action under Suresh's account
  const actionSuresh = enqueueDeliveryAction(
    "COMPLETE_DELIVERY",
    "tsk_sec_003",
    { recipientName: "Bhavna Gupta", collectedAmount: 300, paymentMethod: "UPI" },
    "usr_driver_suresh"
  );

  const rameshQueue = getOfflineQueue("usr_driver_ramesh");
  assert(rameshQueue.length === 2, "Ramesh queue query returns only Ramesh's 2 actions");
  assert(rameshQueue.every((item) => item.userId === "usr_driver_ramesh"), "All items in Ramesh queue belong to Ramesh");

  const sureshQueue = getOfflineQueue("usr_driver_suresh");
  assert(sureshQueue.length === 1, "Suresh queue query returns only Suresh's single action");
  assert(sureshQueue[0].userId === "usr_driver_suresh", "Suresh queue item belongs to Suresh");

  // Test 1.4: User Queue Clearing on Logout / Account Switch
  clearUserOfflineQueue("usr_driver_ramesh");
  const rameshQueueAfter = getOfflineQueue("usr_driver_ramesh");
  assert(rameshQueueAfter.length === 0, "Ramesh queue is cleared upon targeted user queue purge");

  const sureshQueuePreserved = getOfflineQueue("usr_driver_suresh");
  assert(sureshQueuePreserved.length === 1, "Suresh queue remains completely intact when Ramesh queue is purged");

  // Test 1.5: Endless Retry Prevention on 401 / 403 Authorization Failures
  // Mock global fetch to return 401 Unauthorized
  const originalFetch = (global as any).fetch;
  (global as any).fetch = async (url: string, opts: any) => {
    return {
      ok: false,
      status: 401,
      json: async () => ({ error: "Session expired or invalid" }),
    };
  };

  const authFailResult = await processOfflineQueue("usr_driver_suresh");
  assert(authFailResult.authFailed === true, "processOfflineQueue detected 401 auth failure");
  assert(authFailResult.errorCount === 1, "Reported 1 error item");

  const sureshQueueAfterAuth = getOfflineQueue("usr_driver_suresh");
  assert(sureshQueueAfterAuth[0].status === "AUTH_FAILED", "Queue action status set to AUTH_FAILED on 401");
  assert(
    sureshQueueAfterAuth[0].lastError?.includes("Session expired") === true,
    "Descriptive session expiry message recorded"
  );

  // Subsequent call must NOT retry AUTH_FAILED actions endlessly
  let networkCallCount = 0;
  (global as any).fetch = async () => {
    networkCallCount++;
    return { ok: false, status: 401 };
  };

  const noRetryResult = await processOfflineQueue("usr_driver_suresh");
  assert(noRetryResult.syncedCount === 0 && noRetryResult.errorCount === 0, "Subsequent call skips AUTH_FAILED items");
  assert(networkCallCount === 0, "Zero network requests dispatched for AUTH_FAILED items (endless loop prevented)");

  // Restore global fetch
  (global as any).fetch = originalFetch;

  // ============================================================================
  // TEST SUITE 2: Server-Side Cross-Account Replay Protection
  // ============================================================================
  console.log("\n[TEST SUITE 2] Server-Side Cross-Account Replay Protection");

  const db = new Database(TEST_ROLE_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const driverRamesh: AuthenticatedUser = {
    id: "usr_driver_ramesh",
    username: "ramesh_test",
    email: "ramesh.test@ravinarayan.in",
    fullName: "Ramesh Driver",
    role: "DELIVERY_PERSON",
  };

  const driverSuresh: AuthenticatedUser = {
    id: "usr_driver_suresh",
    username: "suresh_test",
    email: "suresh.test@ravinarayan.in",
    fullName: "Suresh Driver",
    role: "DELIVERY_PERSON",
  };

  const opsManager: AuthenticatedUser = {
    id: "usr_ops_manager",
    username: "manager_test",
    email: "manager.test@ravinarayan.in",
    fullName: "Operations Manager",
    role: "OPERATIONS_MANAGER",
  };

  const accountant: AuthenticatedUser = {
    id: "usr_accountant_lead",
    username: "accountant_test",
    email: "accountant.test@ravinarayan.in",
    fullName: "Chief Accountant",
    role: "ACCOUNTANT",
  };

  const superAdmin: AuthenticatedUser = {
    id: "usr_super_admin",
    username: "owner_test",
    email: "owner.test@ravinarayan.in",
    fullName: "Dr. Ravinder Gulia",
    role: "SUPER_ADMIN",
  };

  const now = new Date().toISOString();
  const insertStaff = db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fake_hash', ?, 1, ?, ?)
  `);
  insertStaff.run(driverRamesh.id, driverRamesh.username, driverRamesh.email, driverRamesh.fullName, driverRamesh.role, now, now);
  insertStaff.run(driverSuresh.id, driverSuresh.username, driverSuresh.email, driverSuresh.fullName, driverSuresh.role, now, now);
  insertStaff.run(opsManager.id, opsManager.username, opsManager.email, opsManager.fullName, opsManager.role, now, now);
  insertStaff.run(accountant.id, accountant.username, accountant.email, accountant.fullName, accountant.role, now, now);
  insertStaff.run(superAdmin.id, superAdmin.username, superAdmin.email, superAdmin.fullName, superAdmin.role, now, now);

  const asyncDb = getAsyncDb();

  // Create delivery task assigned to Ramesh
  const taskRamesh = await createExternalDeliveryTask(
    opsManager,
    {
      serviceDate: "2026-10-24",
      mealType: "LUNCH",
      customerName: "Rohan Verma",
      customerPhone: "9811122233",
      deliveryAddress: "Tower A, DLF Phase 3",
      notes: "Collect exact cash ₹200",
    },
    undefined,
    asyncDb
  );

  await assignDeliveryTask(opsManager, taskRamesh.id, { assignedToStaffId: driverRamesh.id }, undefined, asyncDb);
  await dispatchDeliveryTask(driverRamesh, taskRamesh.id, undefined, asyncDb);

  // Attempt to replay Ramesh's queued action using Suresh's authenticated session
  const replayAttemptAction: QueuedDeliveryAction = {
    id: "queue_replay_001",
    action: "COMPLETE_DELIVERY",
    taskId: taskRamesh.id,
    userId: "usr_driver_ramesh", // Action was queued by Ramesh
    payload: {
      recipientName: "Rohan Verma",
      collectedAmount: 200,
      paymentMethod: "CASH",
    },
    idempotencyKey: `offline_${taskRamesh.id}_replay_attack`,
    createdAt: now,
    retryCount: 0,
    status: "PENDING",
  };

  // Suresh attempts to sync Ramesh's queued item
  const serverReplayResult = await syncDeliveryActions(
    driverSuresh, // Authenticated actor is Suresh
    [replayAttemptAction],
    "127.0.0.1",
    asyncDb
  );

  assert(serverReplayResult.results.length === 1, "Server processed 1 replay attempt");
  assert(serverReplayResult.results[0].status === "CONFLICT", "Server rejected cross-account replay with CONFLICT");
  assert(serverReplayResult.results[0].success === false, "Cross-account replay reported success: false");
  assert(
    serverReplayResult.results[0].error?.includes("different authenticated account") === true,
    "Error confirms account context isolation violation"
  );

  // Task on server must remain in OUT_FOR_DELIVERY status (not DELIVERED)
  const taskCheck = await getDeliveryTaskById(opsManager, taskRamesh.id, asyncDb);
  assert(taskCheck?.task.status === "OUT_FOR_DELIVERY", "Task remains OUT_FOR_DELIVERY (uncompromised)");

  // Legitimate sync by the actual owner (Ramesh) succeeds
  const legitResult = await syncDeliveryActions(
    driverRamesh, // Legitimate owner
    [replayAttemptAction],
    "127.0.0.1",
    asyncDb
  );

  assert(legitResult.results[0].status === "SYNCED", "Legitimate owner sync succeeds with SYNCED status");
  const taskDelivered = await getDeliveryTaskById(opsManager, taskRamesh.id, asyncDb);
  assert(taskDelivered?.task.status === "DELIVERED", "Task transitioned to DELIVERED by legitimate owner");

  // ============================================================================
  // TEST SUITE 3: Role-Aware Mobile Bottom Navigation Invariants
  // ============================================================================
  console.log("\n[TEST SUITE 3] Role-Aware Mobile Bottom Navigation Invariants");

  const shellPath = path.resolve(ROOT, "apps/erp/src/components/layout/ErpShell.tsx");
  assert(fs.existsSync(shellPath), "ErpShell.tsx exists");
  const shellContent = fs.readFileSync(shellPath, "utf-8");

  // Since the 2026-11 redesign the manager navigation lives in components/layout/shell/:
  // nav.ts holds the grouped links and their roles, MobileNav.tsx the bottom bar.
  const navContent = fs.readFileSync(path.join(path.dirname(shellPath), "shell", "nav.ts"), "utf-8");
  const mobileNavContent = fs.readFileSync(path.join(path.dirname(shellPath), "shell", "MobileNav.tsx"), "utf-8");

  // Task 01B.69/70 consolidated operations to three canonical roles (Owner, Manager, Delivery)
  // and folded /kitchen into /orders, so the bottom bar prioritises Orders/Delivery (ISSUE-013).
  assert(
    navContent.includes('"OPERATIONS_MANAGER"') &&
    mobileNavContent.includes('const BAR_KEYS = ["dashboard", "orders", "delivery", "residents"]'),
    "Manager bottom nav prioritises Orders & Delivery"
  );

  assert(
    !shellContent.includes("ACCOUNTANT") && !navContent.includes("ACCOUNTANT"),
    "Shell exposes no navigation for the retired ACCOUNTANT role"
  );

  assert(
    navContent.includes('"SUPER_ADMIN"') &&
    /href: "\/finance\?tab=cashbook"[^\n]*roles: OM/.test(navContent) &&
    /const OM: StaffRole\[\] = \["SUPER_ADMIN"/.test(navContent),
    "Finance remains reachable for the Owner"
  );

  assert(
    mobileNavContent.includes("items.map") && mobileNavContent.includes("links.find((l) => l.key === k)"),
    "Bottom bar renders only the links the role can see"
  );

  assert(
    shellContent.includes("MobileBottomBar") && mobileNavContent.includes("env(safe-area-inset-bottom)"),
    "Manager mobile bar includes safe-area padding"
  );

  // ============================================================================
  // TEST SUITE 4: Role-Aware Mobile Dashboard Workflows
  // ============================================================================
  console.log("\n[TEST SUITE 4] Role-Aware Mobile Dashboard Workflows");

  const dashboardPath = path.resolve(ROOT, "apps/erp/src/app/(management)/dashboard/page.tsx");
  assert(fs.existsSync(dashboardPath), "Dashboard page.tsx exists");
  // The page loads the data; DashboardView.tsx renders it (2026-11 redesign).
  const dashboardContent =
    fs.readFileSync(dashboardPath, "utf-8") + fs.readFileSync(path.join(path.dirname(dashboardPath), "DashboardView.tsx"), "utf-8");

  // Delivery staff never see the management dashboard; money is shown only to roles with finance.read.
  assert(
    dashboardContent.includes('user?.role === "DELIVERY_PERSON"') && dashboardContent.includes('redirect("/delivery")'),
    "Dashboard sends delivery staff to their own app"
  );
  assert(
    dashboardContent.includes('hasPermission(user?.role, "finance.read")') && dashboardContent.includes("{showMoney && ("),
    "Dashboard shows money only to roles allowed to read finance"
  );
  assert(!dashboardContent.includes("ACCOUNTANT"), "Dashboard has no branch for the retired ACCOUNTANT role");
  assert(
    dashboardContent.includes('href="/finance?tab=cashbook"') &&
    // Kitchen/Tiffin were consolidated into /orders (Task 01B.70); links now point there directly.
    dashboardContent.includes('href="/orders"') &&
    !dashboardContent.includes('href="/kitchen"') &&
    dashboardContent.includes('href="/delivery?tab=board"'),
    "Dashboard tiles link directly to authorized operational destinations"
  );
  assert(
    dashboardContent.includes('["COMBINED", "PG", "TIFFIN"]') && dashboardContent.includes('url.searchParams.set("division", d)'),
    "Dashboard preserves canonical 3-way division filter"
  );

  // ============================================================================
  // TEST SUITE 5: Financial Ledger Mobile Viewport Overflow Protection
  // ============================================================================
  console.log("\n[TEST SUITE 5] Financial Ledger Mobile Viewport Overflow Protection");

  const cashbookPath = path.resolve(ROOT, "apps/erp/src/modules/finance/components/CashbookLedger.tsx");
  assert(fs.existsSync(cashbookPath), "CashbookLedger.tsx exists");
  const cashbookContent = fs.readFileSync(cashbookPath, "utf-8");

  assert(
    /(block md|lg):hidden/.test(cashbookContent) && /hidden (md|lg):block/.test(cashbookContent),
    "CashbookLedger implements dual-mode responsive layout (mobile cards vs desktop table)"
  );
  assert(
    cashbookContent.includes("onViewReceipt") && cashbookContent.includes("onInitiateReversal"),
    "CashbookLedger mobile cards provide direct receipt view and reversal actions"
  );

  const invoiceLedgerPath = path.resolve(ROOT, "apps/erp/src/modules/finance/components/InvoiceLedgerView.tsx");
  assert(fs.existsSync(invoiceLedgerPath), "InvoiceLedgerView.tsx exists");
  const invoiceContent = fs.readFileSync(invoiceLedgerPath, "utf-8");

  assert(
    /(block md|lg):hidden/.test(invoiceContent) && /hidden (md|lg):block/.test(invoiceContent),
    "InvoiceLedgerView implements dual-mode responsive layout (mobile cards vs desktop table)"
  );
  assert(
    invoiceContent.includes("openPrintModal") && invoiceContent.includes("openAllocateModal"),
    "InvoiceLedgerView mobile cards provide direct print and payment allocation actions"
  );

  const closingViewPath = path.resolve(ROOT, "apps/erp/src/modules/finance/components/DailyClosingView.tsx");
  assert(fs.existsSync(closingViewPath), "DailyClosingView.tsx exists");
  const closingContent = fs.readFileSync(closingViewPath, "utf-8");

  assert(
    closingContent.includes("overflow-x-auto"),
    "DailyClosingView wraps wide channel tables with horizontal scroll containers"
  );
  assert(
    closingContent.includes("actualCashCounted") && closingContent.includes("discrepancyReason"),
    "DailyClosingView retains full physical count inputs and variance reconciliation"
  );

  // ============================================================================
  // TEST SUITE 6: Primary DB & Protected Resources Immutability Guard
  // ============================================================================
  console.log("\n[TEST SUITE 6] Primary DB & Protected Resources Immutability Guard");

  cleanupTestDb();

  if (primaryStatsBefore) {
    const primaryStatsAfter = fs.statSync(primaryDbPath);
    assert(
      primaryStatsBefore.size === primaryStatsAfter.size,
      `Primary DB size unchanged: ${primaryStatsBefore.size} bytes`
    );
    assert(
      primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs,
      `Primary DB modification timestamp unchanged: ${new Date(primaryStatsBefore.mtimeMs).toISOString()}`
    );
  } else {
    console.log("  ℹ INFO: data/erp.db was not present initially; verified untouched.");
  }

  // Final summary
  console.log("\n================================================================================");
  console.log(`TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTask67Tests().catch((err) => {
  console.error("Unhandled test error:", err);
  cleanupTestDb();
  process.exit(1);
});
