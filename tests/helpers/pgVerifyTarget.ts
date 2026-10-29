/**
 * Shared guard for live-PostgreSQL verification suites (tests/pg_*.test.ts).
 *
 * The target comes only from RN_PG_VERIFY_URL and must be a loopback host whose database
 * name contains "verify". The shared local dev database, generic names and anything remote
 * are refused before a connection is opened. Exit code 2 signals BLOCKED to the runner.
 */
import crypto from "crypto";
import path from "path";
import type { AsyncDb } from "../../apps/erp/src/server/database/db";
import type { AuthenticatedUser, StaffRole } from "../../apps/erp/src/types";

// Compiled to tests/dist/tests/helpers/, so the repo root is four levels up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migrate = require(path.resolve(__dirname, "../../../../scripts/migrate.js"));

const PROTECTED_DB_NAMES = new Set(["ravinarayana_erp_local", "neondb", "postgres"]);

/** Validates RN_PG_VERIFY_URL and points the app's DB client at it. Exits(2) when unusable. */
export function useVerifyDatabase(): string {
  const url = process.env.RN_PG_VERIFY_URL;
  if (!url) {
    console.log("BLOCKED: RN_PG_VERIFY_URL is not set. This suite needs a disposable local PostgreSQL database.");
    process.exit(2);
  }
  const target = migrate.validateMigrationTarget(url); // throws for remote / protected / malformed targets
  if (!target.dbName.includes("verify") || PROTECTED_DB_NAMES.has(target.dbName)) {
    console.log(`BLOCKED: database '${target.dbName}' is not a disposable verification database (name must contain 'verify').`);
    process.exit(2);
  }
  // The app's PG client reads these lazily on first use.
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  return url;
}

export async function migrateVerifyDatabase(url: string): Promise<void> {
  await migrate.runMigrations(url);
}

export function createAsserter() {
  const state = { passed: 0, failed: 0 };
  const assert = (condition: boolean, message: string) => {
    if (condition) {
      state.passed++;
      console.log(`  ✓ PASS: ${message}`);
    } else {
      state.failed++;
      console.log(`  ✗ FAIL: ${message}`);
    }
  };
  return { assert, state };
}

export async function insertStaff(db: AsyncDb, role: StaffRole, fullName: string): Promise<AuthenticatedUser> {
  const suffix = crypto.randomBytes(4).toString("hex");
  const user: AuthenticatedUser = {
    id: `stf_verify_${crypto.randomUUID()}`,
    username: `verify_${role.toLowerCase()}_${suffix}`,
    email: `verify_${suffix}@example.invalid`,
    fullName,
    role,
  };
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'not-a-login-hash', ?, 1, ?, ?)`,
    [user.id, user.username, user.email, user.fullName, role, now, now]
  );
  return user;
}

/** Far-future business date unique to this run, so reruns against one database never collide. */
export function uniqueBusinessDate(offsetDays = 0): string {
  const base = Date.UTC(2040, 0, 1) + (Date.now() % 100000) * 86400000 + offsetDays * 86400000;
  return new Date(base).toISOString().slice(0, 10);
}
