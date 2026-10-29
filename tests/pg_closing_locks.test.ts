/**
 * Live PostgreSQL verification of the daily-closing lock protocol (ISSUE-001 / ISSUE-002).
 *
 * Runs ONLY against a disposable local PostgreSQL database supplied via RN_PG_VERIFY_URL.
 * The target must be a loopback host and the database name must contain "verify"; anything
 * else (including the shared local dev database `ravinarayana_erp_local`) is refused before
 * any connection is opened.
 *
 * Verifies against real PostgreSQL (not the SQLite test double):
 *   1. A PG-division ledger writer and a COMBINED finalization cannot deadlock.
 *   2. Writes are rejected once the date is FINALIZED.
 *   3. An advisory-lock failure propagates instead of being swallowed.
 *   4. Under concurrent writers + finalization, every committed write is either inside the
 *      closing snapshot or was rejected — no write lands silently after the snapshot.
 */
import { getAsyncDb, AsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";
import { recordExpense, assertClosingDateNotFinalized } from "../apps/erp/src/server/finance/financeService";
import { finalizeDailyClosing } from "../apps/erp/src/server/finance/cashbookClosingService";
import {
  useVerifyDatabase,
  migrateVerifyDatabase,
  createAsserter,
  insertStaff,
  uniqueBusinessDate as uniqueDate,
} from "./helpers/pgVerifyTarget";

const verifyUrl = useVerifyDatabase();
const { assert, state } = createAsserter();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([p, sleep(ms).then(() => { throw new Error(`TIMEOUT: ${label} did not settle within ${ms}ms`); })]);
}

interface LockHooks {
  onFirstLock?: () => void;
  afterFirstLock?: () => Promise<unknown>;
  failLock?: boolean;
}

/** Wraps an AsyncDb so a test can pause a transaction right after its first advisory lock. */
function instrumentedDb(base: AsyncDb, hooks: LockHooks): AsyncDb {
  return {
    isPostgres: base.isPostgres,
    query: base.query.bind(base),
    queryOne: base.queryOne.bind(base),
    execute: base.execute.bind(base),
    transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T> {
      return base.transaction((tx) => {
        let first = true;
        const wrapped: AsyncDb = {
          isPostgres: tx.isPostgres,
          async query<R = any>(sql: string, params?: any[]): Promise<R[]> {
            if (sql.includes("pg_advisory")) {
              if (hooks.failLock) throw new Error("simulated advisory lock failure");
              const res = await tx.query<R>(sql, params);
              if (first) {
                first = false;
                hooks.onFirstLock?.();
                if (hooks.afterFirstLock) await hooks.afterFirstLock();
              }
              return res;
            }
            return tx.query<R>(sql, params);
          },
          queryOne: tx.queryOne.bind(tx),
          execute: tx.execute.bind(tx),
          transaction: (nested) => nested(wrapped),
        };
        return cb(wrapped);
      });
    },
  };
}

function isDeadlockLike(err: any): boolean {
  const text = `${err?.code ?? ""} ${err?.message ?? ""}`;
  return /40P01|25P02|deadlock|current transaction is aborted/i.test(text);
}

async function main() {
  console.log("================================================================================");
  console.log("PG CLOSING LOCK VERIFICATION (live local PostgreSQL)");
  console.log("================================================================================");

  await migrateVerifyDatabase(verifyUrl);
  const db: AsyncDb = getAsyncDb();
  assert(db.isPostgres === true, "Service layer is running on PostgreSQL, not the SQLite test double");

  const actor = await insertStaff(db, "SUPER_ADMIN", "Lock Verification Owner");

  // --------------------------------------------------------------------------
  console.log("\n--- 1. PG writer vs COMBINED finalization interleaving (deadlock check) ---");
  {
    const date = uniqueDate(0);
    let releaseWriter!: () => void;
    const writerGate = new Promise<void>((r) => (releaseWriter = r));
    let markWriterPaused!: () => void;
    const writerPaused = new Promise<void>((r) => (markWriterPaused = r));

    // Writer pauses after its first advisory lock until the finalizer holds its first lock
    // (or 1.5s pass, which is what happens when the finalizer is correctly blocked).
    const writerDb = instrumentedDb(db, {
      onFirstLock: () => markWriterPaused(),
      afterFirstLock: () => Promise.race([writerGate, sleep(1500)]),
    });
    const finalizerDb = instrumentedDb(db, { onFirstLock: () => releaseWriter() });

    const writerP = recordExpense(
      actor,
      { category: "MAINTENANCE", amount: 125, transactionDate: date, paymentMethod: "CASH", description: "lock interleave writer" },
      writerDb
    );
    await withTimeout(writerPaused, 10000, "writer first lock");
    const finalP = finalizeDailyClosing(
      actor,
      { closingDate: date, division: "COMBINED", actualCashCounted: 0, discrepancyReason: "verification variance" },
      "127.0.0.1",
      finalizerDb
    );

    const [w, f] = await withTimeout(Promise.allSettled([writerP, finalP]), 20000, "interleaved writer/finalizer");
    const errors = [w, f].filter((r) => r.status === "rejected").map((r: any) => r.reason);
    for (const e of errors) console.log(`    rejection: ${e?.code ?? ""} ${e?.message}`);
    assert(!errors.some(isDeadlockLike), "No deadlock / aborted-transaction error between PG writer and COMBINED finalizer");
    assert(w.status === "fulfilled", "PG ledger writer committed");
    assert(f.status === "fulfilled", "COMBINED finalization committed");

    if (w.status === "fulfilled" && f.status === "fulfilled") {
      const row = await db.queryOne<any>(
        "SELECT snapshot_data FROM daily_cashbook_closings WHERE closing_date = ? AND division = 'COMBINED'",
        [date]
      );
      const snapshot = JSON.parse(row.snapshot_data);
      assert(
        snapshot.transactionIds.includes((w as any).value.id),
        "Finalization waited for the in-flight writer: its transaction is inside the closing snapshot"
      );
    }

    // ------------------------------------------------------------------------
    console.log("\n--- 2. Writes after finalization are rejected ---");
    let rejected: any = null;
    try {
      await recordExpense(
        actor,
        { category: "UTILITIES", amount: 50, transactionDate: date, paymentMethod: "CASH", description: "late entry after close" },
        db
      );
    } catch (err) {
      rejected = err;
    }
    assert(rejected !== null && /FINALIZED/.test(rejected.message), "Expense on a FINALIZED date is rejected");
    const lateRows = await db.query<any>(
      "SELECT id FROM financial_transactions WHERE transaction_date = ? AND description = 'late entry after close'",
      [date]
    );
    assert(lateRows.length === 0, "Rejected late entry left no ledger row");
  }

  // --------------------------------------------------------------------------
  console.log("\n--- 3. Advisory lock failure propagates (no silent fallback) ---");
  {
    const date = uniqueDate(1);
    const failingDb = instrumentedDb(db, { failLock: true });
    let err: any = null;
    try {
      await recordExpense(
        actor,
        { category: "UTILITIES", amount: 70, transactionDate: date, paymentMethod: "CASH", description: "lock failure probe" },
        failingDb
      );
    } catch (e) {
      err = e;
    }
    assert(err !== null && /simulated advisory lock failure/.test(err.message), "Lock acquisition failure surfaces to the caller");
    const rows = await db.query<any>(
      "SELECT id FROM financial_transactions WHERE transaction_date = ? AND description = 'lock failure probe'",
      [date]
    );
    assert(rows.length === 0, "No ledger row is written when the closing lock could not be acquired");

    let directErr: any = null;
    try {
      await failingDb.transaction((tx) => assertClosingDateNotFinalized(tx, date, "COMBINED"));
    } catch (e) {
      directErr = e;
    }
    assert(directErr !== null, "assertClosingDateNotFinalized rejects when its lock cannot be acquired");
  }

  // --------------------------------------------------------------------------
  console.log("\n--- 4. Concurrent writers + COMBINED finalization: snapshot consistency ---");
  {
    const date = uniqueDate(2);
    const writers: Promise<any>[] = [];
    for (let i = 0; i < 12; i++) {
      const category = i % 2 === 0 ? "GROCERY" : "MAINTENANCE"; // alternates TIFFIN / PG divisions
      writers.push(
        sleep(Math.floor(Math.random() * 40)).then(() =>
          recordExpense(
            actor,
            { category, amount: 10 + i, transactionDate: date, paymentMethod: "CASH", description: `stress writer ${i}` },
            db
          )
        )
      );
    }
    const finalP = sleep(15).then(() =>
      finalizeDailyClosing(
        actor,
        { closingDate: date, division: "COMBINED", actualCashCounted: 0, discrepancyReason: "verification variance" },
        "127.0.0.1",
        db
      )
    );
    const results = await withTimeout(Promise.allSettled([...writers, finalP]), 30000, "stress run");
    const writerResults = results.slice(0, writers.length);
    const finalResult = results[results.length - 1];
    const allErrors = results.filter((r) => r.status === "rejected").map((r: any) => r.reason);
    assert(!allErrors.some(isDeadlockLike), "No deadlocks across 12 concurrent writers and a COMBINED finalization");
    assert(finalResult.status === "fulfilled", "Finalization committed under write contention");
    assert(
      writerResults.every((r) => r.status === "fulfilled" || /FINALIZED/.test((r as any).reason?.message ?? "")),
      "Every writer either committed or was rejected by the closing lock"
    );

    const row = await db.queryOne<any>(
      "SELECT snapshot_data FROM daily_cashbook_closings WHERE closing_date = ? AND division = 'COMBINED'",
      [date]
    );
    const snapshotIds = new Set<string>(row ? JSON.parse(row.snapshot_data).transactionIds : []);
    const persisted = await db.query<any>("SELECT id FROM financial_transactions WHERE transaction_date = ?", [date]);
    const leaked = persisted.filter((r: any) => !snapshotIds.has(r.id));
    assert(leaked.length === 0, `Every persisted transaction for the date is inside the snapshot (${persisted.length} persisted, ${leaked.length} outside)`);
  }

  console.log("\n================================================================================");
  console.log(`PG CLOSING LOCK RESULTS: ${state.passed} PASSED, ${state.failed} FAILED`);
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
