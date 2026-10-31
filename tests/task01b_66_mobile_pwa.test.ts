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

// Isolated disposable test DB for Task 01B.66
const TEST_PWA_DB_PATH = path.resolve(ROOT, "tests", "test_task66_pwa.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_PWA_DB_PATH)) fs.unlinkSync(TEST_PWA_DB_PATH);
  const wal = `${TEST_PWA_DB_PATH}-wal`;
  const shm = `${TEST_PWA_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_PWA_DB_PATH;

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
console.log("TASK 01B.66: MOBILE APP FOUNDATION & PWA VERIFICATION TEST SUITE");
console.log("================================================================================\n");

async function runTask66Tests() {
  // ============================================================================
  // TEST SUITE 1: PWA Manifest & App Metadata Invariants
  // ============================================================================
  console.log("[TEST SUITE 1] PWA Manifest & App Metadata Invariants");

  const manifestWebmanifestPath = path.resolve(ROOT, "apps/erp/public/manifest.webmanifest");
  const manifestJsonPath = path.resolve(ROOT, "apps/erp/public/manifest.json");

  assert(fs.existsSync(manifestWebmanifestPath), "manifest.webmanifest exists in apps/erp/public/");
  assert(fs.existsSync(manifestJsonPath), "manifest.json exists in apps/erp/public/");

  const webmanifestContent = fs.readFileSync(manifestWebmanifestPath, "utf-8");
  const parsedManifest = JSON.parse(webmanifestContent);

  assert(parsedManifest.name.includes("Ravi Narayana"), "Manifest name matches brand identity");
  assert(
    parsedManifest.short_name.includes("Ravi") || parsedManifest.short_name.includes("RN"),
    "Manifest short_name matches brand abbreviation"
  );
  assert(parsedManifest.display === "standalone", "Manifest display mode is standalone");
  assert(
    parsedManifest.start_url === "/" || parsedManifest.start_url === "/dashboard",
    "Manifest start_url is root or dashboard"
  );
  assert(parsedManifest.background_color === "#FAF8F5", "Manifest background_color is warm neutral #FAF8F5");
  assert(parsedManifest.theme_color === "#1A2E20", "Manifest theme_color is deep botanical evergreen #1A2E20");
  assert(Array.isArray(parsedManifest.icons) && parsedManifest.icons.length >= 3, "Manifest defines at least 3 icons");

  // Verify Next.js layout metadata manifest linkage & elimination of route collision
  const layoutPath = path.resolve(ROOT, "apps/erp/src/app/layout.tsx");
  assert(fs.existsSync(layoutPath), "layout.tsx exists in apps/erp/src/app/");
  const layoutContent = fs.readFileSync(layoutPath, "utf-8");
  assert(
    layoutContent.includes('manifest: "/manifest.webmanifest"'),
    "Root layout configures manifest: '/manifest.webmanifest'"
  );

  // Verify manifest route conflict is prevented (no colliding app/manifest.ts with public/manifest.webmanifest)
  const manifestTsPath = path.resolve(ROOT, "apps/erp/src/app/manifest.ts");
  assert(
    !fs.existsSync(manifestTsPath),
    "Conflicting apps/erp/src/app/manifest.ts eliminated in favor of authoritative public/manifest.webmanifest"
  );

  // Verify PNG Icon Files and Valid PNG Headers
  const icons = [
    { file: "icon-192.png", width: 192, height: 192 },
    { file: "icon-512.png", width: 512, height: 512 },
    { file: "maskable-icon-512.png", width: 512, height: 512 },
    { file: "apple-touch-icon.png", width: 180, height: 180 },
  ];

  for (const ic of icons) {
    const iconPath = path.resolve(ROOT, "apps/erp/public/icons", ic.file);
    assert(fs.existsSync(iconPath), `Icon asset exists: ${ic.file}`);
    const buf = fs.readFileSync(iconPath);
    // Check PNG signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    const isPng =
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a;
    assert(isPng, `Icon ${ic.file} is a valid PNG binary`);

    // Verify IHDR dimensions (offset 16-23: width 4 bytes BE, height 4 bytes BE)
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert(
      width === ic.width && height === ic.height,
      `Icon ${ic.file} has correct dimensions: ${width}x${height} (expected ${ic.width}x${ic.height})`
    );
  }

  // ============================================================================
  // TEST SUITE 2: Service Worker Security & Caching Isolation Invariants
  // ============================================================================
  console.log("\n[TEST SUITE 2] Service Worker Security & Caching Isolation Invariants");

  const swPath = path.resolve(ROOT, "apps/erp/public/sw.js");
  assert(fs.existsSync(swPath), "sw.js exists in apps/erp/public/");

  const swContent = fs.readFileSync(swPath, "utf-8");

  // Invariant 1: Strictly DO NOT cache API or financial routes
  assert(
    swContent.includes('pathname.startsWith("/api/")'),
    "Service worker explicitly bypasses /api/ requests from CacheStorage"
  );
  assert(
    swContent.includes('pathname.includes("/storage")'),
    "Service worker explicitly bypasses /storage/ KYC/document endpoints"
  );
  assert(
    swContent.includes('pathname.includes("/documents")'),
    "Service worker explicitly bypasses /documents/ endpoints"
  );
  assert(
    swContent.includes('pathname.includes("/auth")'),
    "Service worker explicitly bypasses /auth/ session endpoints"
  );
  assert(
    swContent.includes('pathname.includes("/kyc")'),
    "Service worker explicitly bypasses /kyc/ sensitive documents"
  );
  assert(
    swContent.includes('pathname.includes("/closing")'),
    "Service worker explicitly bypasses /closing/ financial endpoints"
  );

  // Invariant 2: Strictly bypass non-GET requests
  assert(
    swContent.includes('request.method !== "GET"'),
    "Service worker strictly bypasses all non-GET methods (POST, PUT, DELETE)"
  );

  // Invariant 3: Static pre-cached assets include offline fallback and brand assets
  assert(
    swContent.includes('"/offline"'),
    "Service worker pre-caches /offline fallback page"
  );
  assert(
    swContent.includes('"/icons/icon-192.png"') && swContent.includes('"/icons/icon-512.png"'),
    "Service worker pre-caches brand icons"
  );

  // Invariant 4: Fallback navigation to /offline when disconnected
  assert(
    swContent.includes('request.mode === "navigate"') && swContent.includes('cache.match("/offline")'),
    "Service worker falls back to pre-cached /offline for offline navigations"
  );

  // ============================================================================
  // TEST SUITE 3: Offline Fallback Page & PWA Registrar Invariants
  // ============================================================================
  console.log("\n[TEST SUITE 3] Offline Fallback Page & PWA Registrar Invariants");

  const offlinePagePath = path.resolve(ROOT, "apps/erp/src/app/offline/page.tsx");
  assert(fs.existsSync(offlinePagePath), "Offline page exists at apps/erp/src/app/offline/page.tsx");

  const offlinePageContent = fs.readFileSync(offlinePagePath, "utf-8");
  assert(
    offlinePageContent.includes("getOfflineQueue") && offlinePageContent.includes("processOfflineQueue"),
    "Offline page imports and integrates offlineQueue management"
  );
  assert(
    offlinePageContent.includes("Delivery Driver Offline Protection"),
    "Offline page displays driver local protection notice"
  );
  assert(
    offlinePageContent.includes("Sync Now"),
    "Offline page provides manual Sync Now trigger for drivers and staff"
  );

  const registrarPath = path.resolve(ROOT, "apps/erp/src/components/pwa/PwaRegistrar.tsx");
  assert(fs.existsSync(registrarPath), "PwaRegistrar component exists");

  const registrarContent = fs.readFileSync(registrarPath, "utf-8");
  assert(
    registrarContent.includes('.register("/sw.js"'),
    "PwaRegistrar registers /sw.js"
  );
  assert(
    registrarContent.includes("beforeinstallprompt"),
    "PwaRegistrar intercepts beforeinstallprompt for install banner"
  );

  // Viewport and Safe-area CSS styles
  const cssPath = path.resolve(ROOT, "apps/erp/src/styles/globals.css");
  const cssContent = fs.readFileSync(cssPath, "utf-8");
  assert(cssContent.includes("pb-safe"), "globals.css defines pb-safe utility");
  assert(cssContent.includes("pt-safe"), "globals.css defines pt-safe utility");
  assert(cssContent.includes("touch-action: manipulation"), "globals.css enforces touch manipulation");

  // ============================================================================
  // TEST SUITE 4: Role-Aware Navigation & Bottom Bar Invariants
  // ============================================================================
  console.log("\n[TEST SUITE 4] Role-Aware Navigation & Mobile Bottom Bar Invariants");

  const shellPath = path.resolve(ROOT, "apps/erp/src/components/layout/ErpShell.tsx");
  const shellContent = fs.readFileSync(shellPath, "utf-8");
const staffShellContent = fs.readFileSync(path.join(path.dirname(shellPath), "DeliveryStaffShell.tsx"), "utf-8");

  // Delivery Person mobile navigation isolation
  assert(
    shellContent.includes('user.role === "DELIVERY_PERSON"'),
    "ErpShell differentiates DELIVERY_PERSON navigation"
  );
  assert(
    shellContent.includes("DeliveryStaffShell") && staffShellContent.includes('label: "My Stops"') && staffShellContent.includes('label: "My Cash"') && staffShellContent.includes('label: "History"') && staffShellContent.includes("queuedCount > 0"),
    "Delivery staff shell presents My Stops (with the offline queue count), My Cash and History"
  );
  assert(
    shellContent.includes("pb-safe"),
    "ErpShell bottom nav bar adheres to mobile safe area padding"
  );

  // Role redirection logic on root and dashboard
  const rootPagePath = path.resolve(ROOT, "apps/erp/src/app/page.tsx");
  const rootContent = fs.readFileSync(rootPagePath, "utf-8");
  assert(
    rootContent.includes('user.role === "DELIVERY_PERSON"') && rootContent.includes('redirect("/delivery")'),
    "Root page redirects DELIVERY_PERSON directly to /delivery"
  );

  const dashboardPagePath = path.resolve(ROOT, "apps/erp/src/app/(management)/dashboard/page.tsx");
  const dashboardContent = fs.readFileSync(dashboardPagePath, "utf-8");
  assert(
    dashboardContent.includes('user?.role === "DELIVERY_PERSON"') && dashboardContent.includes('redirect("/delivery")'),
    "Dashboard page redirects DELIVERY_PERSON directly to /delivery"
  );

  // ============================================================================
  // TEST SUITE 5: Offline Queue Operations & Idempotency Key Semantics
  // ============================================================================
  console.log("\n[TEST SUITE 5] Offline Queue Operations & Idempotency Key Semantics");

  const queueModulePath = path.resolve(ROOT, "apps/erp/src/modules/delivery/offlineQueue.ts");
  assert(fs.existsSync(queueModulePath), "offlineQueue.ts exists");

  const queueContent = fs.readFileSync(queueModulePath, "utf-8");
  assert(
    queueContent.includes("erp_delivery_offline_queue_v1"),
    "offlineQueue uses versioned storage key erp_delivery_offline_queue_v1"
  );
  assert(
    queueContent.includes("idempotencyKey"),
    "offlineQueue generates unique idempotencyKey for every queued action"
  );
  assert(
    queueContent.includes('item.action === "COMPLETE_DELIVERY"') || queueContent.includes("actions: pending"),
    "offlineQueue synchronizes pending queue with /api/delivery/sync"
  );

  // Since Task 01B.70 delivery completion (including shortfalls with a reason) happens in
  // SingleScreenDeliveryModal; the old page-level exception flow no longer exists (ISSUE-006/021).
  const deliveryModalPath = path.resolve(ROOT, "apps/erp/src/modules/delivery/components/modals/SingleScreenDeliveryModal.tsx");
  const deliveryModalContent = fs.readFileSync(deliveryModalPath, "utf-8");
  assert(
    deliveryModalContent.includes('enqueueDeliveryAction("COMPLETE_DELIVERY"'),
    "Delivery completion enqueues COMPLETE_DELIVERY when offline or on network failure"
  );
  assert(
    /enqueueDeliveryAction\("COMPLETE_DELIVERY",[^;]*idempotencyKey\)/.test(deliveryModalContent),
    "Offline replay reuses the online attempt's idempotency key"
  );
  assert(
    queueContent.includes("clean.itemsReconciliation") && queueContent.includes("clean.undeliveredReason"),
    "Queued completions keep shortfall reason and item reconciliation"
  );
  const shellSource = fs.readFileSync(path.resolve(ROOT, "apps/erp/src/components/layout/ErpShell.tsx"), "utf-8");
  assert(
    shellSource.includes("processOfflineQueue(user.id)") && shellSource.includes('addEventListener("online", syncQueuedActions)'),
    "ErpShell replays the offline queue automatically when connectivity returns"
  );

  // ============================================================================
  // TEST SUITE 6: Database Integration & Offline Action Synchronization
  // ============================================================================
  console.log("\n[TEST SUITE 6] Database Integration & Offline Action Synchronization");

  const db = new Database(TEST_PWA_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);

  const driverUser: AuthenticatedUser = {
    id: "usr_driver_pwa_01",
    username: "driver_pwa",
    email: "driver.pwa@ravinarayan.in",
    fullName: "Raju Mobile Driver",
    role: "DELIVERY_PERSON",
  };

  const otherDriverUser: AuthenticatedUser = {
    id: "usr_driver_pwa_02",
    username: "driver_other",
    email: "driver.other@ravinarayan.in",
    fullName: "Other Mobile Driver",
    role: "DELIVERY_PERSON",
  };

  const adminUser: AuthenticatedUser = {
    id: "usr_admin_pwa",
    username: "admin_pwa",
    email: "admin.pwa@ravinarayan.in",
    fullName: "Admin Supervisor",
    role: "SUPER_ADMIN",
  };

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fake_hash', ?, 1, ?, ?)
  `).run(driverUser.id, driverUser.username, driverUser.email, driverUser.fullName, driverUser.role, now, now);

  db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fake_hash', ?, 1, ?, ?)
  `).run(otherDriverUser.id, otherDriverUser.username, otherDriverUser.email, otherDriverUser.fullName, otherDriverUser.role, now, now);

  db.prepare(`
    INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'fake_hash', ?, 1, ?, ?)
  `).run(adminUser.id, adminUser.username, adminUser.email, adminUser.fullName, adminUser.role, now, now);

  const asyncDb = getAsyncDb();

  // Create external delivery tasks using the authoritative service layer
  const shiftDate = "2026-10-24";
  const taskOrder1 = await createExternalDeliveryTask(adminUser, {
    serviceDate: shiftDate,
    mealType: "LUNCH",
    customerName: "Ashok Self",
    customerPhone: "+91 98111 22233",
    deliveryAddress: "Room 101, Ground Floor",
    notes: "Collect cash ₹150",
  }, undefined, asyncDb);

  const taskOrder2 = await createExternalDeliveryTask(adminUser, {
    serviceDate: shiftDate,
    mealType: "LUNCH",
    customerName: "Resident Bhavna",
    customerPhone: "+91 98222 33344",
    deliveryAddress: "Room 102, First Floor",
    notes: "Doorstep delivery",
  }, undefined, asyncDb);

  const taskOrder3 = await createExternalDeliveryTask(adminUser, {
    serviceDate: shiftDate,
    mealType: "LUNCH",
    customerName: "Resident Chitra",
    customerPhone: "+91 98333 44455",
    deliveryAddress: "Room 103, First Floor",
    notes: "Hand to resident",
  }, undefined, asyncDb);

  // Assign and dispatch tasks
  await assignDeliveryTask(adminUser, taskOrder1.id, { assignedToStaffId: driverUser.id }, undefined, asyncDb);
  await assignDeliveryTask(adminUser, taskOrder2.id, { assignedToStaffId: driverUser.id }, undefined, asyncDb);
  await assignDeliveryTask(adminUser, taskOrder3.id, { assignedToStaffId: otherDriverUser.id }, undefined, asyncDb);

  await dispatchDeliveryTask(driverUser, taskOrder1.id, undefined, asyncDb);
  await dispatchDeliveryTask(driverUser, taskOrder2.id, undefined, asyncDb);
  await dispatchDeliveryTask(otherDriverUser, taskOrder3.id, undefined, asyncDb);

  // Test 6.1: Sync COMPLETE_DELIVERY action with CASH doorstep collection
  console.log("\n  -> Testing offline sync of COMPLETE_DELIVERY action");
  const queuedCompleteAction: QueuedDeliveryAction = {
    id: "queue_act_001",
    action: "COMPLETE_DELIVERY",
    userId: driverUser.id,
    taskId: taskOrder1.id,
    payload: {
      recipientName: "Ashok Self",
      notes: "Delivered to door",
      collectedAmount: 150,
      paymentMethod: "CASH",
    },
    idempotencyKey: `offline_${taskOrder1.id}_1001`,
    createdAt: now,
    retryCount: 0,
    status: "PENDING",
  };

  const syncResult1 = await syncDeliveryActions(
    driverUser,
    [queuedCompleteAction],
    "127.0.0.1",
    asyncDb
  );

  assert(syncResult1.results.length === 1, "Sync returned 1 result");
  assert(syncResult1.results[0].status === "SYNCED", "Queued delivery completed with status SYNCED");
  assert(syncResult1.results[0].success === true, "Queued delivery completed with success === true");

  const task1After = await getDeliveryTaskById(adminUser, taskOrder1.id, asyncDb);
  assert(task1After !== null && task1After.task.status === "DELIVERED", "Task status updated to DELIVERED in database");
  assert(task1After?.task.collectedAmount === 150, "Task collected_amount recorded as 150");
  assert(task1After?.task.collectionStatus === "COLLECTED", "Task collection_status updated to COLLECTED");
  assert(task1After?.task.recipientName === "Ashok Self", "Recipient name recorded accurately");

  // Test 6.2: Idempotent Replay of the Same Action
  console.log("\n  -> Testing idempotent replay of COMPLETE_DELIVERY action");
  const syncResult2 = await syncDeliveryActions(
    driverUser,
    [queuedCompleteAction],
    "127.0.0.1",
    asyncDb
  );

  assert(syncResult2.results.length === 1, "Replay returned 1 result");
  assert(
    syncResult2.results[0].status === "IDEMPOTENT_IGNORED",
    "Repeated sync returned IDEMPOTENT_IGNORED without duplicate side-effects"
  );
  assert(syncResult2.results[0].success === true, "Idempotent replay treated as success");

  // Test 6.3: Sync REPORT_EXCEPTION action
  console.log("\n  -> Testing offline sync of REPORT_EXCEPTION action");
  const queuedExceptionAction: QueuedDeliveryAction = {
    id: "queue_act_002",
    action: "REPORT_EXCEPTION",
    userId: driverUser.id,
    taskId: taskOrder2.id,
    payload: {
      exceptionType: "RESIDENT_UNAVAILABLE",
      reason: "Resident not present in room, door locked",
    },
    idempotencyKey: `offline_${taskOrder2.id}_1002`,
    createdAt: now,
    retryCount: 0,
    status: "PENDING",
  };

  const syncResult3 = await syncDeliveryActions(
    driverUser,
    [queuedExceptionAction],
    "127.0.0.1",
    asyncDb
  );

  assert(syncResult3.results.length === 1, "Exception sync returned 1 result");
  assert(syncResult3.results[0].status === "SYNCED", "Queued exception completed with status SYNCED");

  const task2After = await getDeliveryTaskById(adminUser, taskOrder2.id, asyncDb);
  assert(task2After !== null && task2After.task.status === "EXCEPTION", "Task status updated to EXCEPTION in database");
  assert(task2After?.task.exceptionType === "RESIDENT_UNAVAILABLE", "Exception type recorded accurately");

  // Test 6.4: Conflict Handling - Exception on already Delivered Task
  console.log("\n  -> Testing conflict detection: Exception on already delivered task");
  const conflictingExceptionAction: QueuedDeliveryAction = {
    id: "queue_act_003",
    action: "REPORT_EXCEPTION",
    userId: driverUser.id,
    taskId: taskOrder1.id, // Already delivered!
    payload: {
      exceptionType: "OTHER",
      reason: "Late exception attempt on delivered task",
    },
    idempotencyKey: `offline_${taskOrder1.id}_conflict`,
    createdAt: now,
    retryCount: 0,
    status: "PENDING",
  };

  const syncResult4 = await syncDeliveryActions(
    driverUser,
    [conflictingExceptionAction],
    "127.0.0.1",
    asyncDb
  );

  assert(syncResult4.results.length === 1, "Conflict sync returned 1 result");
  assert(syncResult4.results[0].status === "CONFLICT", "Server detected CONFLICT on already delivered task");
  assert(syncResult4.results[0].success === false, "Conflicting action reported success: false");

  // Test 6.5: Driver Reassignment Conflict Handling
  console.log("\n  -> Testing driver ownership check during offline sync");
  const unauthorizedDriverAction: QueuedDeliveryAction = {
    id: "queue_act_004",
    action: "COMPLETE_DELIVERY",
    userId: driverUser.id,
    taskId: taskOrder3.id, // Assigned to otherDriverUser (driver_pwa_02)
    payload: {
      recipientName: "Chitra",
    },
    idempotencyKey: `offline_${taskOrder3.id}_unauth`,
    createdAt: now,
    retryCount: 0,
    status: "PENDING",
  };

  const syncResult5 = await syncDeliveryActions(
    driverUser, // Raju trying to complete task assigned to Suresh
    [unauthorizedDriverAction],
    "127.0.0.1",
    asyncDb
  );

  assert(syncResult5.results.length === 1, "Ownership check returned 1 result");
  assert(
    syncResult5.results[0].status === "CONFLICT",
    "Server rejected action with CONFLICT when task belongs to another driver"
  );
  assert(
    syncResult5.results[0].error?.includes("reassigned to another delivery person") === true,
    "Error indicates reassignment / ownership mismatch"
  );

  // ============================================================================
  // TEST SUITE 7: Primary DB & Protected DB Immutability Guard
  // ============================================================================
  console.log("\n[TEST SUITE 7] Primary DB & Protected DB Immutability Guard");

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

runTask66Tests().catch((err) => {
  console.error("Unhandled test error:", err);
  cleanupTestDb();
  process.exit(1);
});
