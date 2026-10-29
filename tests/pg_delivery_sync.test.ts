/**
 * Live PostgreSQL verification of offline delivery completion (ISSUE-006).
 *
 * Runs only against a disposable local database (RN_PG_VERIFY_URL; see helpers/pgVerifyTarget).
 * Verifies:
 *   1. A queued COMPLETE_DELIVERY replayed through /api/delivery/sync keeps partial-delivery data
 *      (delivered/undelivered portions, reason, item reconciliation) and the collection.
 *   2. Replaying the same action is IDEMPOTENT_IGNORED and never changes the collected amount.
 *   3. An online completion racing an offline replay applies exactly once (one DELIVERED event).
 *   4. Actions queued by another account are rejected (CONFLICT).
 *   5. Zero delivered portions synced offline put the task into EXCEPTION.
 */
import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import {
  createExternalDeliveryTask,
  assignDeliveryTask,
  dispatchDeliveryTask,
  completeDeliveryTask,
  syncDeliveryActions,
} from "../apps/erp/src/server/delivery/deliveryService";
import { AuthenticatedUser, QueuedDeliveryAction } from "../apps/erp/src/types";
import {
  useVerifyDatabase,
  migrateVerifyDatabase,
  createAsserter,
  insertStaff,
  uniqueBusinessDate,
} from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();

async function outForDelivery(db: AsyncDb, owner: AuthenticatedUser, driver: AuthenticatedUser, serviceDate: string) {
  const task = await createExternalDeliveryTask(
    owner,
    {
      serviceDate,
      mealType: "LUNCH",
      customerName: "Verify Customer",
      customerPhone: `9${crypto.randomInt(100000000, 999999999)}`,
      deliveryAddress: "Plot 7, Sector 3, Verification Nagar",
    },
    "127.0.0.1",
    db
  );
  await assignDeliveryTask(owner, task.id, { assignedToStaffId: driver.id }, "127.0.0.1", db);
  const current = await db.queryOne<any>("SELECT status FROM delivery_tasks WHERE id = ?", [task.id]);
  if (current.status !== "OUT_FOR_DELIVERY") {
    await dispatchDeliveryTask(owner, task.id, "127.0.0.1", db);
  }
  return task.id as string;
}

function queued(taskId: string, userId: string, payload: Record<string, any>, idempotencyKey: string): QueuedDeliveryAction {
  return {
    id: `queue_${crypto.randomUUID()}`,
    action: "COMPLETE_DELIVERY",
    taskId,
    userId,
    payload,
    idempotencyKey,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: "PENDING",
  };
}

async function deliveredEventCount(db: AsyncDb, taskId: string): Promise<number> {
  const row = await db.queryOne<any>(
    "SELECT COUNT(*)::int AS n FROM delivery_task_events WHERE task_id = ? AND event_type = 'DELIVERED'",
    [taskId]
  );
  return Number(row?.n ?? 0);
}

async function main() {
  console.log("================================================================================");
  console.log("PG DELIVERY OFFLINE SYNC VERIFICATION (live local PostgreSQL)");
  console.log("================================================================================");

  await migrateVerifyDatabase(verifyUrl);
  const db = getAsyncDb();
  assert(db.isPostgres === true, "Service layer is running on PostgreSQL");

  const owner = await insertStaff(db, "SUPER_ADMIN", "Sync Verification Owner");
  const driver = await insertStaff(db, "DELIVERY_PERSON", "Sync Verification Driver");
  const otherDriver = await insertStaff(db, "DELIVERY_PERSON", "Other Driver");
  const serviceDate = uniqueBusinessDate(10);

  console.log("\n--- 1. Offline completion keeps partial-delivery data ---");
  const taskA = await outForDelivery(db, owner, driver, serviceDate);
  const keyA = `del_${taskA}_verify_${crypto.randomUUID()}`;
  const payloadA = {
    deliveredQuantity: 2,
    undeliveredQuantity: 1,
    undeliveredReason: "Customer took only two",
    collectedAmount: 160,
    paymentMethod: "CASH",
    itemsReconciliation: [
      { productName: "Daily Standard Tiffin", orderedQuantity: 3, deliveredQuantity: 2, undeliveredQuantity: 1, undeliveredReason: "Customer took only two", unitPrice: 80 },
    ],
  };
  const first = await syncDeliveryActions(driver, [queued(taskA, driver.id, payloadA, keyA)], "127.0.0.1", db);
  assert(first.results[0]?.status === "SYNCED", `Queued completion synced (got ${first.results[0]?.status} ${first.results[0]?.error ?? ""})`);
  const rowA = await db.queryOne<any>("SELECT * FROM delivery_tasks WHERE id = ?", [taskA]);
  assert(rowA.status === "DELIVERED", "Task is DELIVERED after sync");
  assert(Number(rowA.collected_amount) === 160 && rowA.collected_payment_method === "CASH", "Collection (₹160 CASH) recorded in driver custody");
  assert(rowA.collection_idempotency_key === keyA, "Collection carries the queued idempotency key");
  assert(
    typeof rowA.delivery_notes === "string" && rowA.delivery_notes.includes("2/3 delivered") && rowA.delivery_notes.includes("Customer took only two"),
    "Partial quantities and shortfall reason persisted (previously dropped by the sync path)"
  );

  console.log("\n--- 2. Replay is idempotent ---");
  const replay = await syncDeliveryActions(driver, [queued(taskA, driver.id, { ...payloadA, collectedAmount: 999 }, keyA)], "127.0.0.1", db);
  assert(replay.results[0]?.status === "IDEMPOTENT_IGNORED", `Replay ignored (got ${replay.results[0]?.status})`);
  const rowA2 = await db.queryOne<any>("SELECT collected_amount FROM delivery_tasks WHERE id = ?", [taskA]);
  assert(Number(rowA2.collected_amount) === 160, "Replay did not change the collected amount");
  assert((await deliveredEventCount(db, taskA)) === 1, "Exactly one DELIVERED event after replay");

  console.log("\n--- 3. Online completion racing an offline replay applies once ---");
  const taskB = await outForDelivery(db, owner, driver, serviceDate);
  const keyB = `del_${taskB}_verify_${crypto.randomUUID()}`;
  const payloadB = { deliveredQuantity: 1, undeliveredQuantity: 0, collectedAmount: 80, paymentMethod: "UPI" };
  // Force the worst interleaving deterministically: every completion reads the task, then waits
  // until all racers have read it (both see OUT_FOR_DELIVERY) before any of them writes.
  const racers = 2;
  let reads = 0;
  let releaseReaders!: () => void;
  const allRead = new Promise<void>((r) => (releaseReaders = r));
  const racingDb: AsyncDb = {
    ...db,
    isPostgres: db.isPostgres,
    query: db.query.bind(db),
    execute: db.execute.bind(db),
    transaction: db.transaction.bind(db),
    async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
      const row = await db.queryOne<T>(sql, params);
      if (/^\s*SELECT \* FROM delivery_tasks WHERE id = \?\s*$/.test(sql) && params?.[0] === taskB) {
        reads++;
        if (reads === racers) releaseReaders();
        await Promise.race([allRead, new Promise((r) => setTimeout(r, 2000))]);
      }
      return row;
    },
  };
  const raced = await Promise.allSettled([
    completeDeliveryTask(driver, taskB, { ...payloadB, paymentMethod: "UPI", idempotencyKey: keyB }, "127.0.0.1", racingDb),
    completeDeliveryTask(driver, taskB, { ...payloadB, paymentMethod: "UPI", idempotencyKey: keyB }, "127.0.0.1", racingDb),
  ]);
  assert(reads >= racers, `Both completions read the task before either wrote (reads=${reads})`);
  // A replay through the offline sync after the race must also be a no-op.
  const lateReplay = await syncDeliveryActions(driver, [queued(taskB, driver.id, payloadB, keyB)], "127.0.0.1", db);
  assert(lateReplay.results[0]?.status === "IDEMPOTENT_IGNORED", "Offline replay after the race is ignored");
  const rejected = raced.filter((r) => r.status === "rejected").map((r: any) => r.reason?.message);
  assert(rejected.length === 0, `No request failed in the race (${rejected.join(" | ") || "none"})`);
  assert((await deliveredEventCount(db, taskB)) === 1, "Exactly one DELIVERED event despite concurrent completions");
  const auditRow = await db.queryOne<any>(
    "SELECT COUNT(*)::int AS n FROM audit_logs WHERE target_id = ? AND action = 'delivery.task_delivered'",
    [taskB]
  );
  assert(Number(auditRow?.n) === 1, "Exactly one delivery audit entry");
  const rowB = await db.queryOne<any>("SELECT collected_amount, collected_payment_method FROM delivery_tasks WHERE id = ?", [taskB]);
  assert(Number(rowB.collected_amount) === 80 && rowB.collected_payment_method === "UPI", "Collection recorded once (₹80 UPI)");

  console.log("\n--- 4. Cross-account replay is rejected ---");
  const taskC = await outForDelivery(db, owner, driver, serviceDate);
  const foreign = await syncDeliveryActions(
    driver,
    [queued(taskC, otherDriver.id, { deliveredQuantity: 1, collectedAmount: 80, paymentMethod: "CASH" }, `del_${taskC}_x`)],
    "127.0.0.1",
    db
  );
  assert(foreign.results[0]?.status === "CONFLICT", "Action queued under another account is a CONFLICT");
  const rowC = await db.queryOne<any>("SELECT status FROM delivery_tasks WHERE id = ?", [taskC]);
  assert(rowC.status === "OUT_FOR_DELIVERY", "Task untouched by the rejected action");

  console.log("\n--- 5. Zero delivered offline → EXCEPTION ---");
  const zero = await syncDeliveryActions(
    driver,
    [queued(taskC, driver.id, { deliveredQuantity: 0, undeliveredQuantity: 1, undeliveredReason: "Customer not home" }, `del_${taskC}_zero`)],
    "127.0.0.1",
    db
  );
  assert(zero.results[0]?.success === true, `Zero-delivered action synced (got ${zero.results[0]?.status} ${zero.results[0]?.error ?? ""})`);
  const rowC2 = await db.queryOne<any>("SELECT status, exception_reason FROM delivery_tasks WHERE id = ?", [taskC]);
  assert(rowC2.status === "EXCEPTION" && rowC2.exception_reason === "Customer not home", "Task moved to EXCEPTION with the driver's reason");

  console.log("\n================================================================================");
  console.log(`PG DELIVERY SYNC RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
  console.log("================================================================================");
}

main()
  .catch((err) => {
    state.failed++;
    console.error("Test runner error:", err?.message ?? err);
  })
  .finally(async () => {
    try {
      await closePg();
    } catch {}
    process.exit(state.failed > 0 ? 1 : 0);
  });
