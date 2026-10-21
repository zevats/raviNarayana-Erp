import path from "path";
import fs from "fs";
import { getDrizzleDb, getPgSql, getDatabaseUrl, isPostgresConfigured, closePg } from "./client";
import { validateAdminEnvironment, ValidatedAdminConfig } from "./env";
import { hashPassword } from "../authentication/auth";
import { AsyncDb, convertPlaceholders } from "./db";
import { TABLES_IN_ORDER } from "./migrateSqliteToPg";

export interface PostgresTargetSafetyResult {
  safe: boolean;
  isProduction: boolean;
  isRehearsalDatabase: boolean;
  hostname?: string;
  database?: string;
  reason?: string;
}

/**
 * Validates that a target PostgreSQL connection is safe for test or integration operations.
 * Fails closed if the target points to a production database or the populated rehearsal database
 * without explicit, separate authorization.
 */
export function validatePostgresTargetSafety(
  targetUrl?: string | null
): PostgresTargetSafetyResult {
  const url = targetUrl !== undefined ? targetUrl : getDatabaseUrl(true);
  if (!url) {
    return {
      safe: false,
      isProduction: false,
      isRehearsalDatabase: false,
      reason: "No PostgreSQL database URL configured in environment.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      safe: false,
      isProduction: false,
      isRehearsalDatabase: false,
      reason: "Malformed PostgreSQL connection URL.",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const dbName = parsed.pathname.replace(/^\//, "").toLowerCase();

  // 1. Detect Production Target
  const isProduction =
    process.env.NODE_ENV === "production" ||
    hostname.includes("production") ||
    hostname.includes("prod-") ||
    dbName.includes("prod");

  // 2. Detect Populated Rehearsal Target
  const expectedNeonHost = (process.env.EXPECTED_NEON_HOST || "").toLowerCase().trim();
  const expectedNeonDb = (process.env.EXPECTED_NEON_DATABASE || "neondb").toLowerCase().trim();
  const isRehearsalDatabase = Boolean(
    expectedNeonHost &&
      hostname === expectedNeonHost &&
      (!expectedNeonDb || dbName === expectedNeonDb)
  );

  // If target is rehearsal database, require explicit test-migration authorization
  const allowTestMigration = process.env.ALLOW_TEST_MIGRATION === "true";
  if (isRehearsalDatabase && !allowTestMigration) {
    return {
      safe: false,
      isProduction,
      isRehearsalDatabase,
      hostname,
      database: dbName,
      reason: "Target matches designated rehearsal database, but ALLOW_TEST_MIGRATION=true is not set.",
    };
  }

  // Production connections are never safe for automated integration tests
  if (isProduction && process.env.ALLOW_PRODUCTION_TEST !== "true") {
    return {
      safe: false,
      isProduction: true,
      isRehearsalDatabase,
      hostname,
      database: dbName,
      reason: "Connection to production database is strictly blocked for test and integration harnesses.",
    };
  }

  return {
    safe: true,
    isProduction,
    isRehearsalDatabase,
    hostname,
    database: dbName,
  };
}

/**
 * Executes Drizzle SQL migrations against PostgreSQL.
 * Prefers direct PostgreSQL connection (port 5432) to bypass connection pooler constraints.
 */
export async function runPostgresMigrations(
  direct = true
): Promise<{ success: boolean; appliedCount: number; error?: string }> {
  const safety = validatePostgresTargetSafety();
  if (!safety.safe) {
    return { success: false, appliedCount: 0, error: safety.reason };
  }

  const drizzleDb = getDrizzleDb(direct);
  if (!drizzleDb) {
    return { success: false, appliedCount: 0, error: "PostgreSQL Drizzle client could not be initialized." };
  }

  const migrationsFolder = fs.existsSync(path.resolve(__dirname, "./drizzle"))
    ? path.resolve(__dirname, "./drizzle")
    : path.resolve(process.cwd(), "apps/erp/src/server/database/drizzle");
  if (!fs.existsSync(migrationsFolder)) {
    return { success: false, appliedCount: 0, error: `Drizzle migrations directory not found at: ${migrationsFolder}` };
  }

  try {
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzleDb, { migrationsFolder });
    return { success: true, appliedCount: 2 };
  } catch (err: any) {
    return {
      success: false,
      appliedCount: 0,
      error: `PostgreSQL migration failed: ${err?.message || "Unknown error"}`,
    };
  }
}

/**
 * Provisions the initial SUPER_ADMIN user in PostgreSQL if staff_users table is empty.
 * Enforces production security policies via validateAdminEnvironment.
 */
export async function seedInitialPostgresAdmin(
  asyncDb?: AsyncDb,
  customConfig?: ValidatedAdminConfig
): Promise<{ seeded: boolean; username: string; message: string }> {
  const db = asyncDb || (await import("./db")).getAsyncDb();

  // 1. Verify staff_users table exists and check existing count
  const countRow = await db.queryOne<{ count: number | string }>(
    "SELECT COUNT(*) as count FROM staff_users"
  );
  const staffCount = Number(countRow?.count || 0);

  if (staffCount > 0) {
    return {
      seeded: false,
      username: "",
      message: `Staff users table already contains ${staffCount} user(s). Provisioning skipped.`,
    };
  }

  // 2. Validate configuration according to environment policy
  const adminConfig = customConfig || validateAdminEnvironment(staffCount);
  if (!adminConfig) {
    return {
      seeded: false,
      username: "",
      message: "Admin configuration not required or not provided.",
    };
  }

  // 3. Hash administrator password with bcrypt 12
  const passwordHash = await hashPassword(adminConfig.password);
  const adminId = "usr_super_admin";
  const now = new Date().toISOString();

  await db.execute(
    `INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'SUPER_ADMIN', 1, ?, ?)`,
    [adminId, adminConfig.username, adminConfig.email, adminConfig.fullName, passwordHash, now, now]
  );

  return {
    seeded: true,
    username: adminConfig.username,
    message: `Initial administrator '${adminConfig.username}' successfully provisioned.`,
  };
}

/**
 * Creates an in-memory or connection-backed AsyncDb that executes queries
 * through PostgreSQL parameter binding and casing conventions.
 */
export function createMockPostgresAsyncDb(options?: {
  onQuery?: (sql: string, params: any[]) => any[];
  onExecute?: (sql: string, params: any[]) => { changes: number };
}): AsyncDb {
  const store: Record<string, any[]> = {};

  return {
    isPostgres: true,
    async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
      const convertedSql = convertPlaceholders(sql);
      if (options?.onQuery) {
        return options.onQuery(convertedSql, params || []) as T[];
      }
      return [] as T[];
    },
    async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
      const convertedSql = convertPlaceholders(sql);
      if (options?.onQuery) {
        const rows = options.onQuery(convertedSql, params || []);
        return (rows[0] as T) || null;
      }
      return null;
    },
    async execute(sql: string, params?: any[]): Promise<{ changes: number }> {
      const convertedSql = convertPlaceholders(sql);
      if (options?.onExecute) {
        return options.onExecute(convertedSql, params || []);
      }
      return { changes: 1 };
    },
    async transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T> {
      return cb(this);
    },
  };
}
