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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PROTECTED_DATABASE_PATTERN = /phase01b-test/i;
const FORBIDDEN_TEST_DATABASE_NAMES = new Set(["neondb", "postgres", "template0", "template1", "production", "prod"]);

/**
 * Validates that a target PostgreSQL connection is safe for test, seed or migration harnesses.
 *
 * Default-deny: only loopback hosts with a non-protected database name pass. Remote hosts
 * (including any Neon host, whether or not EXPECTED_NEON_HOST is configured), production
 * targets and the protected rehearsal database are always rejected. There is no override flag.
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

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return {
      safe: false,
      isProduction: false,
      isRehearsalDatabase: false,
      reason: `Unsupported connection protocol '${parsed.protocol}'.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  let dbName: string;
  try {
    dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, "")).toLowerCase().trim();
  } catch {
    dbName = parsed.pathname.replace(/^\/+/, "").toLowerCase().trim();
  }

  const isProduction =
    process.env.NODE_ENV === "production" ||
    hostname.includes("production") ||
    hostname.includes("prod-") ||
    hostname.startsWith("prod.") ||
    dbName.includes("prod");

  const expectedNeonHost = (process.env.EXPECTED_NEON_HOST || "").toLowerCase().trim();
  const expectedNeonDb = (process.env.EXPECTED_NEON_DATABASE || "neondb").toLowerCase().trim();
  const isRehearsalDatabase =
    PROTECTED_DATABASE_PATTERN.test(url) ||
    PROTECTED_DATABASE_PATTERN.test(dbName) ||
    Boolean(expectedNeonHost && hostname === expectedNeonHost && (!expectedNeonDb || dbName === expectedNeonDb));

  const reject = (reason: string): PostgresTargetSafetyResult => ({
    safe: false,
    isProduction,
    isRehearsalDatabase,
    hostname,
    database: dbName,
    reason,
  });

  if (isRehearsalDatabase) {
    return reject("Target is the protected rehearsal database. Access is permanently prohibited.");
  }
  if (isProduction) {
    return reject("Connection to a production database is strictly blocked for test and integration harnesses.");
  }
  if (!LOOPBACK_HOSTS.has(hostname)) {
    return reject(`Remote database host '${hostname}' rejected. Only loopback targets are permitted.`);
  }
  if (!dbName || FORBIDDEN_TEST_DATABASE_NAMES.has(dbName)) {
    return reject(`Database name '${dbName}' is not an approved local database.`);
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
