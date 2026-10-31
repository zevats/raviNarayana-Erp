import path from "path";
import { timed } from "./queryMetrics";
import { businessWriteTable, signalBusinessDataChanged } from "./changeSignals";
import fs from "fs";
import { getPgSql, isPostgresConfigured, getDatabaseEngine } from "./client";

interface GlobalDatabaseContext {
  _rnTestAsyncDb?: AsyncDb | null;
  _rnTestDbProvider?: (() => AsyncDb | null) | null;
  _rnTestGetDb?: (() => any) | null;
  _rnTestCloseDb?: (() => void) | null;
}

const globalForDb = globalThis as unknown as GlobalDatabaseContext;

export interface AsyncDb {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ changes: number }>;
  transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T>;
  isPostgres: boolean;
}

/**
 * Converts standard parameterized SQL ('?' placeholders) to PostgreSQL positional parameters ('$1', '$2', ...)
 * and preserves camelCase column aliases across engines.
 */
export function convertPlaceholders(query: string): string {
  let paramIndex = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let currentSegment = "";
  let result = "";

  function processNonQuoted(seg: string): string {
    seg = seg.replace(/\?/g, () => `$${paramIndex++}`);
    seg = seg.replace(/\b(AS|as)\s+([a-zA-Z_][a-zA-Z0-9_]*[A-Z][a-zA-Z0-9_]*)\b/g, 'as "$2"');
    return seg;
  }

  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if (char === "'" && !inDoubleQuote) {
      if (!inSingleQuote) {
        result += processNonQuoted(currentSegment);
        currentSegment = "";
      }
      inSingleQuote = !inSingleQuote;
      result += char;
    } else if (char === '"' && !inSingleQuote) {
      if (!inDoubleQuote) {
        result += processNonQuoted(currentSegment);
        currentSegment = "";
      }
      inDoubleQuote = !inDoubleQuote;
      result += char;
    } else if (inSingleQuote || inDoubleQuote) {
      result += char;
    } else {
      currentSegment += char;
    }
  }

  if (currentSegment.length > 0) {
    result += processNonQuoted(currentSegment);
  }

  return result;
}

/**
 * Registers an isolated test double for offline unit and integration tests.
 */
export function setTestAsyncDb(testDb: AsyncDb | null): void {
  globalForDb._rnTestAsyncDb = testDb;
}

/**
 * Returns the application database interface.
 * Strictly requires PostgreSQL in production and development.
 * SQLite has been decommissioned. Automatic fallback to SQLite is prohibited.
 */
export function getAsyncDb(): AsyncDb {
  // Production Environment Safety: silent fallback to local SQLite is strictly prohibited
  if (process.env.NODE_ENV === "production" && !isPostgresConfigured()) {
    throw new Error(
      "[FATAL PRODUCTION CONFIGURATION] PostgreSQL database URL (DATABASE_URL) is required in production (NODE_ENV=production). Silent fallback to local ephemeral SQLite is strictly prohibited."
    );
  }

  // 1. Check for explicitly registered offline test double
  if (globalForDb._rnTestAsyncDb) {
    return globalForDb._rnTestAsyncDb;
  }

  // 2. Check for offline test provider registered by test runners
  if (globalForDb._rnTestDbProvider) {
    const testDb = globalForDb._rnTestDbProvider();
    if (testDb) {
      return testDb;
    }
  }

  // 3. PostgreSQL Configuration Requirement
  if (!isPostgresConfigured()) {
    throw new Error(
      "[FATAL DATABASE CONFIGURATION] PostgreSQL database connection string (DATABASE_URL or DIRECT_URL) is required. SQLite runtime has been decommissioned. Silent fallback to local ephemeral SQLite is strictly prohibited."
    );
  }

  const sqlClient = getPgSql();
  if (!sqlClient) {
    throw new Error(
      "[FATAL DATABASE CONFIGURATION] PostgreSQL client could not be initialized from DATABASE_URL."
    );
  }

  const pgDb: AsyncDb = {
    isPostgres: true,
    async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
      const res = await timed(sql, () => sqlClient.unsafe(convertPlaceholders(sql), params || []));
      return Array.from(res) as T[];
    },
    async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
      const res = await timed(sql, () => sqlClient.unsafe(convertPlaceholders(sql), params || []));
      return (res[0] as T) || null;
    },
    async execute(sql: string, params?: any[]): Promise<{ changes: number }> {
      const res = await timed(sql, () => sqlClient.unsafe(convertPlaceholders(sql), params || []));
      const table = res.count ? businessWriteTable(sql) : null;
      if (table) signalBusinessDataChanged([table]);
      return { changes: res.count || 0 };
    },
    async transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T> {
      // Derived-data caches are told about business writes only after the transaction commits.
      const writtenTables = new Set<string>();
      const result = (await sqlClient.begin(async (sqlTx) => {
        const txClient: AsyncDb = {
          isPostgres: true,
          async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
            const res = await timed(sql, () => sqlTx.unsafe(convertPlaceholders(sql), params || []));
            return Array.from(res) as T[];
          },
          async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
            const res = await timed(sql, () => sqlTx.unsafe(convertPlaceholders(sql), params || []));
            return (res[0] as T) || null;
          },
          async execute(sql: string, params?: any[]): Promise<{ changes: number }> {
            const res = await timed(sql, () => sqlTx.unsafe(convertPlaceholders(sql), params || []));
            const table = res.count ? businessWriteTable(sql) : null;
            if (table) writtenTables.add(table);
            return { changes: res.count || 0 };
          },
          transaction: (nestedCb) => nestedCb(txClient),
        };
        return await cb(txClient);
      })) as T;
      if (writtenTables.size > 0) signalBusinessDataChanged(Array.from(writtenTables));
      return result;
    },
  };

  return pgDb;
}

/**
 * Adapter allowing offline test suites to inject an isolated test double
 * without requiring runtime SQLite dependencies in the ERP application package.
 */
export function createAsyncDbFromSqlite(db: any): AsyncDb {
  const dbWithLock = db as unknown as { _rnAsyncTxLock?: Promise<void> };
  if (!dbWithLock._rnAsyncTxLock) {
    dbWithLock._rnAsyncTxLock = Promise.resolve();
  }

  const sqliteDb: AsyncDb = {
    isPostgres: false,
    async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
      const rows = db.prepare(sql).all(...(params || []));
      return rows as T[];
    },
    async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
      const row = db.prepare(sql).get(...(params || []));
      return (row as T) || null;
    },
    async execute(sql: string, params?: any[]): Promise<{ changes: number }> {
      const info = db.prepare(sql).run(...(params || []));
      return { changes: info.changes };
    },
    async transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T> {
      const prevLock = dbWithLock._rnAsyncTxLock || Promise.resolve();
      let releaseLock: () => void;
      dbWithLock._rnAsyncTxLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });

      await prevLock;
      try {
        db.exec("BEGIN IMMEDIATE");
        try {
          const txClient: AsyncDb = {
            isPostgres: false,
            query: sqliteDb.query,
            queryOne: sqliteDb.queryOne,
            execute: sqliteDb.execute,
            transaction: (nestedCb) => nestedCb(txClient),
          };
          const res = await cb(txClient);
          db.exec("COMMIT");
          return res;
        } catch (err) {
          try {
            db.exec("ROLLBACK");
          } catch {}
          throw err;
        }
      } finally {
        releaseLock!();
      }
    },
  };
  return sqliteDb;
}

/**
 * @deprecated Legacy SQLite synchronous accessor.
 * Retained strictly as an offline test double hook. In the application runtime,
 * SQLite has been decommissioned and getAsyncDb() must be used.
 */
export function getDb(): any {
  if (globalForDb._rnTestGetDb) {
    return globalForDb._rnTestGetDb();
  }
  throw new Error(
    "[FATAL DATABASE CONFIGURATION] getDb() is not supported in the PostgreSQL runtime. SQLite has been decommissioned. Use getAsyncDb()."
  );
}

/**
 * Resets cached test database connection.
 */
export function closeDb(): void {
  if (globalForDb._rnTestCloseDb) {
    globalForDb._rnTestCloseDb();
  }
  globalForDb._rnTestAsyncDb = null;
}

let cachedDemoProvenance: boolean | null = null;

export function invalidateDemoProvenanceCache(): void {
  cachedDemoProvenance = null;
}

/**
 * Engine-aware check to determine if demo data provenance (seed_manifest) is present.
 */
export async function checkDemoProvenance(asyncDb?: AsyncDb): Promise<boolean> {
  if (cachedDemoProvenance !== null && !asyncDb) {
    return cachedDemoProvenance;
  }
  try {
    const db = asyncDb || getAsyncDb();
    let result = false;
    if (db.isPostgres) {
      const manifestTable = await db.queryOne<{ count: string | number }>(
        "SELECT count(*) as count FROM information_schema.tables WHERE table_name = 'seed_manifest'"
      );
      const count = manifestTable
        ? typeof manifestTable.count === "string"
          ? parseInt(manifestTable.count, 10)
          : Number(manifestTable.count)
        : 0;
      if (count > 0) {
        const manifestCount = await db.queryOne<{ count: string | number }>(
          "SELECT count(*) as count FROM seed_manifest"
        );
        const rowCount = manifestCount
          ? typeof manifestCount.count === "string"
            ? parseInt(manifestCount.count, 10)
            : Number(manifestCount.count)
          : 0;
        result = rowCount > 0;
      }
    } else {
      const manifestTable = await db.queryOne<{ count: number }>(
        "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='seed_manifest'"
      );
      if (manifestTable && Number(manifestTable.count) > 0) {
        const manifestCount = await db.queryOne<{ count: number }>(
          "SELECT count(*) as count FROM seed_manifest"
        );
        result = Boolean(manifestCount && Number(manifestCount.count) > 0);
      }
    }
    if (!asyncDb) {
      cachedDemoProvenance = result;
    }
    return result;
  } catch {
    return false;
  }
}

/**
 * Discovers the monorepo root directory deterministically by traversing upwards.
 */
export function findRepoRoot(startDir: string = __dirname): string {
  let curr = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(curr, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) {
          return curr;
        }
      } catch {}
    }
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }
  return process.cwd();
}

/**
 * Resolves repository database path for offline migration scripts and diagnostics.
 */
export function resolveDbPath(): string {
  if (process.env.ERP_DATABASE_PATH && process.env.ERP_DATABASE_PATH.trim().length > 0) {
    const raw = process.env.ERP_DATABASE_PATH.trim();
    if (path.isAbsolute(raw)) {
      return path.normalize(raw);
    }
    const repoRoot = findRepoRoot();
    return path.resolve(repoRoot, raw);
  }

  const cwdDataDb = path.resolve(process.cwd(), "data", "erp.db");
  if (fs.existsSync(cwdDataDb)) {
    return cwdDataDb;
  }

  const monorepoDataDb = path.resolve(process.cwd(), "../../data", "erp.db");
  if (fs.existsSync(monorepoDataDb)) {
    return monorepoDataDb;
  }

  const isInsideApps =
    path.basename(path.resolve(process.cwd(), "..")) === "apps" ||
    path.basename(process.cwd()) === "erp";
  const targetDir = isInsideApps
    ? path.resolve(process.cwd(), "../../data")
    : path.resolve(process.cwd(), "data");

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return path.join(targetDir, "erp.db");
}

export interface FixturePathValidationResult {
  valid: boolean;
  resolvedPath?: string;
  error?: string;
}

function getCanonicalPath(targetPath: string): string {
  const normalized = path.normalize(targetPath);
  let curr = normalized;
  const segments: string[] = [];
  while (!fs.existsSync(curr)) {
    const parent = path.dirname(curr);
    if (parent === curr) break;
    segments.unshift(path.basename(curr));
    curr = parent;
  }
  if (fs.existsSync(curr)) {
    try {
      const real = fs.realpathSync(curr);
      return segments.length > 0 ? path.join(real, ...segments) : real;
    } catch {
      return normalized;
    }
  }
  return normalized;
}

/**
 * Validates that a requested database path for synthetic fixtures is safely isolated.
 */
export function validateFixturePath(
  rawPath: string | null | undefined,
  options?: { repoRoot?: string }
): FixturePathValidationResult {
  if (!rawPath || typeof rawPath !== "string" || rawPath.trim().length === 0) {
    return {
      valid: false,
      error: "Fixture path rejected: Explicit, non-empty ERP_DATABASE_PATH configuration is required for fixture operations.",
    };
  }

  const repoRoot = options?.repoRoot || findRepoRoot();
  const trimmed = rawPath.trim();

  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(repoRoot, trimmed);

  const canonicalTarget = getCanonicalPath(resolved);

  const canonicalPrimaryDb = getCanonicalPath(path.resolve(repoRoot, "data", "erp.db"));
  if (canonicalTarget.toLowerCase() === canonicalPrimaryDb.toLowerCase()) {
    return {
      valid: false,
      error: "Fixture path rejected: Target path corresponds to the primary ERP database (data/erp.db). Fixtures must not target the primary database.",
    };
  }

  const dataDir = getCanonicalPath(path.resolve(repoRoot, "data"));
  if (
    path.dirname(canonicalTarget).toLowerCase() === dataDir.toLowerCase() &&
    path.basename(canonicalTarget).toLowerCase() === "erp.db"
  ) {
    return {
      valid: false,
      error: "Fixture path rejected: Target cannot be erp.db within data directory.",
    };
  }

  const approvedFixturesDir = getCanonicalPath(path.resolve(repoRoot, "data", "fixtures"));
  const rel = path.relative(approvedFixturesDir.toLowerCase(), canonicalTarget.toLowerCase());

  if (!rel || rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      valid: false,
      error: `Fixture path rejected: Fixture database must strictly reside within the approved fixtures directory ('data/fixtures/'). Target: '${trimmed}'.`,
    };
  }

  return {
    valid: true,
    resolvedPath: canonicalTarget,
  };
}
