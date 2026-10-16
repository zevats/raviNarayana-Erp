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

/**
 * Returns whether a PostgreSQL database URL is configured in the environment.
 */
export function isPostgresConfigured(): boolean {
  return Boolean(getDatabaseUrl());
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
 */
export async function pingDatabase(): Promise<{
  ok: boolean;
  latencyMs: number;
  engine: "postgresql" | "sqlite" | "none";
  error?: string;
}> {
  const start = performance.now();
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

  // Fallback check on SQLite if configured
  try {
    const { getDb } = await import("./db");
    const db = getDb();
    db.prepare("SELECT 1").get();
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    return { ok: true, latencyMs, engine: "sqlite" };
  } catch (err: any) {
    const latencyMs = Math.round((performance.now() - start) * 100) / 100;
    return {
      ok: false,
      latencyMs,
      engine: "none",
      error: "No database available",
    };
  }
}
