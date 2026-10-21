import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

interface GlobalPgContext {
  _rnPgSql?: postgres.Sql | null;
  _rnDrizzleDb?: ReturnType<typeof drizzle<typeof schema>> | null;
  _rnPgShutdownRegistered?: boolean;
}

const globalForPg = globalThis as unknown as GlobalPgContext;

/**
 * Returns the configured PostgreSQL connection string.
 * Prefers DATABASE_URL, with optional DIRECT_URL fallback for migration tasks.
 */
export function getDatabaseUrl(direct = false): string | null {
  if (direct && process.env.DIRECT_URL) {
    return process.env.DIRECT_URL;
  }
  return process.env.DATABASE_URL || process.env.DIRECT_URL || null;
}

export type DatabaseEngine = "postgresql" | "sqlite";

/**
 * Returns whether a PostgreSQL database URL is configured in the environment.
 */
export function isPostgresConfigured(): boolean {
  return Boolean(getDatabaseUrl());
}

/**
 * Returns the configured database engine.
 * PostgreSQL is the sole supported runtime database.
 * If DATABASE_ENGINE is explicitly set to 'sqlite', it throws a fatal configuration error.
 */
export function getDatabaseEngine(): DatabaseEngine {
  const explicit = process.env.DATABASE_ENGINE?.toLowerCase().trim();
  if (explicit === "sqlite") {
    throw new Error(
      "[FATAL DATABASE CONFIGURATION] SQLite has been decommissioned. PostgreSQL is the sole supported application database."
    );
  }
  return "postgresql";
}

/**
 * Returns true if PostgreSQL is the active runtime database engine.
 */
export function isPostgresActive(): boolean {
  return isPostgresConfigured();
}

/**
 * Returns the raw postgres client singleton for connection pooling.
 */
export function getPgSql(direct = false): postgres.Sql | null {
  const url = getDatabaseUrl(direct);
  if (!url) {
    return null;
  }

  if (globalForPg._rnPgSql) {
    return globalForPg._rnPgSql;
  }

  const sqlClient = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  globalForPg._rnPgSql = sqlClient;

  if (!globalForPg._rnPgShutdownRegistered && typeof process !== "undefined" && typeof process.once === "function") {
    globalForPg._rnPgShutdownRegistered = true;
    process.once("SIGTERM", () => closePg());
    process.once("SIGINT", () => closePg());
  }

  return globalForPg._rnPgSql;
}

/**
 * Returns the typed Drizzle ORM instance connected to PostgreSQL.
 */
export function getDrizzleDb(direct = false) {
  const sqlClient = getPgSql(direct);
  if (!sqlClient) {
    return null;
  }

  if (!globalForPg._rnDrizzleDb) {
    globalForPg._rnDrizzleDb = drizzle(sqlClient, { schema });
  }

  return globalForPg._rnDrizzleDb;
}

/**
 * Closes the PostgreSQL connection pool gracefully.
 */
export async function closePg(): Promise<void> {
  if (globalForPg._rnPgSql) {
    try {
      await globalForPg._rnPgSql.end({ timeout: 5 });
    } catch {
      // Ignore errors on close
    }
    globalForPg._rnPgSql = null;
    globalForPg._rnDrizzleDb = null;
  }
}

/**
 * Pings the database to verify connectivity and measure latency.
 * SQLite fallback has been decommissioned. In production or development,
 * PostgreSQL is required. Retains offline test double ping support.
 */
export async function pingDatabase(): Promise<{
  ok: boolean;
  latencyMs: number;
  engine: "postgresql" | "sqlite" | "none";
  error?: string;
}> {
  const start = performance.now();

  // Test double ping support for isolated offline test environments (never in production)
  const testDb =
    (globalThis as any)._rnTestAsyncDb ||
    (typeof (globalThis as any)._rnTestDbProvider === "function"
      ? (globalThis as any)._rnTestDbProvider()
      : null);

  if (testDb && process.env.NODE_ENV !== "production") {
    try {
      await testDb.queryOne("SELECT 1");
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      return {
        ok: true,
        latencyMs,
        engine: testDb.isPostgres ? "postgresql" : "sqlite",
      };
    } catch (err: any) {
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      return {
        ok: false,
        latencyMs,
        engine: "none",
        error: err?.message || "Test database ping failed",
      };
    }
  }

  const sqlClient = getPgSql();
  if (sqlClient) {
    try {
      await sqlClient`SELECT 1`;
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      return { ok: true, latencyMs, engine: "postgresql" };
    } catch (err: any) {
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      return {
        ok: false,
        latencyMs,
        engine: "postgresql",
        error: err?.message || "PostgreSQL connection failed",
      };
    }
  }

  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      latencyMs: 0,
      engine: "none",
      error: "PostgreSQL required in production (NODE_ENV=production) but DATABASE_URL is not configured",
    };
  }

  return {
    ok: false,
    latencyMs: 0,
    engine: "none",
    error: "PostgreSQL required: DATABASE_URL is not configured. SQLite runtime has been decommissioned.",
  };
}
