import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import bcrypt from "bcryptjs";
import { runMigrations } from "./migrations";
import { performDatabaseCleanup } from "./cleanup";
import { validateAdminEnvironment } from "./env";

interface GlobalDatabaseContext {
  _rnErpDbInstance?: Database.Database | null;
  _rnErpStatements?: Map<string, Database.Statement>;
  _rnShutdownRegistered?: boolean;
  _rnErpFixtureDbInstance?: Database.Database | null;
  _rnErpFixtureDbPath?: string | null;
  _rnErpFixtureStatements?: Map<string, Database.Statement>;
}

const globalForDb = globalThis as unknown as GlobalDatabaseContext;

export function resolveDbPath(): string {
  if (process.env.ERP_DATABASE_PATH && process.env.ERP_DATABASE_PATH.trim().length > 0) {
    const raw = process.env.ERP_DATABASE_PATH.trim();
    if (path.isAbsolute(raw)) {
      return path.normalize(raw);
    }
    const repoRoot = findRepoRoot();
    return path.resolve(repoRoot, raw);
  }

  // 1. Check if data/erp.db exists in current working directory (repo root)
  const cwdDataDb = path.resolve(process.cwd(), "data", "erp.db");
  if (fs.existsSync(cwdDataDb)) {
    return cwdDataDb;
  }

  // 2. Check if data/erp.db exists in monorepo root (when running inside apps/erp)
  const monorepoDataDb = path.resolve(process.cwd(), "../../data", "erp.db");
  if (fs.existsSync(monorepoDataDb)) {
    return monorepoDataDb;
  }

  // 3. Default creation target: determine whether running inside apps/erp or repo root
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

/**
 * Discovers the monorepo root directory deterministically by traversing upwards
 * from startDir looking for the root package.json defining workspaces.
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
 * Returns canonical representation of a path, resolving existing directory symlinks
 * even if the final file does not exist yet.
 */
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
 * - Requires explicit, non-empty path.
 * - Resolves deterministically against repo root.
 * - Rejects any path matching the primary ERP database (data/erp.db) across all representations.
 * - Requires the target to strictly reside within the approved 'data/fixtures/' directory.
 * - Rejects path traversal and sibling-prefix directories.
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

  // If path is absolute, resolve(trimmed); if relative, resolve from repoRoot
  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(repoRoot, trimmed);

  const canonicalTarget = getCanonicalPath(resolved);

  // 1. Disallow targeting data/erp.db directly or canonical equivalent
  const canonicalPrimaryDb = getCanonicalPath(path.resolve(repoRoot, "data", "erp.db"));
  if (canonicalTarget.toLowerCase() === canonicalPrimaryDb.toLowerCase()) {
    return {
      valid: false,
      error: "Fixture path rejected: Target path corresponds to the primary ERP database (data/erp.db). Fixtures must not target the primary database.",
    };
  }

  // 2. Disallow any file named erp.db inside data/ directly
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

  // 3. Must be strictly inside approved fixtures directory
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

/**
 * Fail-closed fixture path resolver. Throws an error immediately if the path is invalid,
 * preventing any database initialization from silently targeting the primary database.
 */
export function resolveFixtureDbPath(
  rawPath: string | null | undefined = process.env.ERP_DATABASE_PATH,
  options?: { repoRoot?: string }
): string {
  const result = validateFixturePath(rawPath, options);
  if (!result.valid || !result.resolvedPath) {
    throw new Error(result.error || "Fixture database path validation failed.");
  }
  return result.resolvedPath;
}

/**
 * Opens and initializes a dedicated SQLite database instance for synthetic fixtures.
 * - Requires a path that strictly passes validateFixturePath().
 * - Rejects any attempt to target data/erp.db or paths outside data/fixtures/.
 * - Keeps fixture lifecycle and statement cache completely isolated from the primary DB singleton.
 * - Ensures that a cached handle for a different path is never returned.
 */
export function getFixtureDb(
  rawPath: string | null | undefined = process.env.ERP_DATABASE_PATH,
  options?: { repoRoot?: string }
): Database.Database {
  // 1. Strictly validate and canonicalize path; throws synchronously on invalid/missing path
  const validatedPath = resolveFixtureDbPath(rawPath, options);

  // 2. Cache isolation: check if an instance for this exact path is already open
  if (
    globalForDb._rnErpFixtureDbInstance &&
    globalForDb._rnErpFixtureDbInstance.open
  ) {
    if (globalForDb._rnErpFixtureDbPath === validatedPath) {
      return globalForDb._rnErpFixtureDbInstance;
    }
    // If a different path was requested, close the existing fixture handle before opening a new one
    closeFixtureDb();
  }

  // 3. Ensure target directory exists
  const dbDir = path.dirname(validatedPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // 4. Open the validated fixture database
  const db = new Database(validatedPath);

  // 5. Apply SQLite configuration
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // 6. Statement cache dedicated to fixtures (isolated from primary DB cache)
  const statementCache = new Map<string, Database.Statement>();
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((source: string) => {
    const key = source.trim();
    let stmt = statementCache.get(key);
    if (!stmt) {
      stmt = originalPrepare(source);
      statementCache.set(key, stmt);
    }
    return stmt;
  }) as any;
  globalForDb._rnErpFixtureStatements = statementCache;

  // 7. Run migrations and initial setup strictly on this fixture database instance
  runMigrations(db);
  seedInitialAdmin(db);
  performDatabaseCleanup(db);

  // 8. Store in dedicated fixture context
  globalForDb._rnErpFixtureDbInstance = db;
  globalForDb._rnErpFixtureDbPath = validatedPath;

  return db;
}

/**
 * Closes the active fixture database handle and clears fixture statement caches.
 */
export function closeFixtureDb(): void {
  const db = globalForDb._rnErpFixtureDbInstance;
  if (db) {
    if (globalForDb._rnErpFixtureStatements) {
      globalForDb._rnErpFixtureStatements.clear();
    }
    try {
      if (db.open) {
        db.close();
      }
    } catch {}
    globalForDb._rnErpFixtureDbInstance = null;
    globalForDb._rnErpFixtureDbPath = null;
  }
}

export function getDb(): Database.Database {
  if (globalForDb._rnErpDbInstance && globalForDb._rnErpDbInstance.open) {
    return globalForDb._rnErpDbInstance;
  }

  const dbPath = resolveDbPath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);

  // WAL mode for high concurrency
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Prepared statement caching: keeps statements alive with the DB singleton
  // and protects against V8 GC finalizer assertion failures (env != nullptr)
  const statementCache = new Map<string, Database.Statement>();
  const originalPrepare = db.prepare.bind(db);
  db.prepare = ((source: string) => {
    const key = source.trim();
    let stmt = statementCache.get(key);
    if (!stmt) {
      stmt = originalPrepare(source);
      statementCache.set(key, stmt);
    }
    return stmt;
  }) as any;

  globalForDb._rnErpStatements = statementCache;

  // Versioned migrations
  runMigrations(db);

  // Seeding with environment validation
  seedInitialAdmin(db);

  // Bounded cleanup for expired sessions and old rate-limit records
  performDatabaseCleanup(db);

  globalForDb._rnErpDbInstance = db;

  // Register clean shutdown handlers once per process
  if (!globalForDb._rnShutdownRegistered && typeof process !== "undefined" && typeof process.once === "function") {
    globalForDb._rnShutdownRegistered = true;
    process.once("SIGTERM", () => closeDb());
    process.once("SIGINT", () => closeDb());
  }

  return globalForDb._rnErpDbInstance;
}

export function closeDb(): void {
  closeFixtureDb();
  const db = globalForDb._rnErpDbInstance;
  if (db) {
    if (globalForDb._rnErpStatements) {
      globalForDb._rnErpStatements.clear();
    }
    try {
      if (db.open) {
        db.close();
      }
    } catch {
      // Ignore errors on close
    }
    globalForDb._rnErpDbInstance = null;
  }
}

function seedInitialAdmin(db: Database.Database): void {
  const rowCount = db.prepare("SELECT COUNT(*) as count FROM staff_users").get() as { count: number };
  
  // Validate environment rules. Returns null if staff already exist.
  const adminConfig = validateAdminEnvironment(rowCount.count);
  if (!adminConfig) {
    return;
  }

  const passwordHash = bcrypt.hashSync(adminConfig.password, 12);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO staff_users (
      id, username, email, full_name, password_hash, role, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'SUPER_ADMIN', 1, ?, ?)
  `).run(
    "usr_super_admin_01",
    adminConfig.username,
    adminConfig.email,
    adminConfig.fullName,
    passwordHash,
    now,
    now
  );
}

import { getPgSql, isPostgresConfigured, getDatabaseEngine } from "./client";

export interface AsyncDb {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<{ changes: number }>;
  transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T>;
  isPostgres: boolean;
}

export function convertPlaceholders(query: string): string {
  let paramIndex = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let currentSegment = "";
  let result = "";

  function processNonQuoted(seg: string): string {
    // 1. Convert ? to $1, $2, ...
    seg = seg.replace(/\?/g, () => `$${paramIndex++}`);
    // 2. Quote unquoted camelCase aliases (preserving case in PostgreSQL)
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

export function getAsyncDb(): AsyncDb {
  const isProduction = process.env.NODE_ENV === "production";
  const engine = getDatabaseEngine();

  if (isProduction && !isPostgresConfigured()) {
    throw new Error(
      "[FATAL PRODUCTION CONFIGURATION] PostgreSQL database URL (DATABASE_URL) is required in production (NODE_ENV=production). Silent fallback to local ephemeral SQLite is strictly prohibited."
    );
  }

  if (engine === "postgresql" && isPostgresConfigured()) {
    const sqlClient = getPgSql()!;
    const pgDb: AsyncDb = {
      isPostgres: true,
      async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
        const res = await sqlClient.unsafe(convertPlaceholders(sql), params || []);
        return Array.from(res) as T[];
      },
      async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
        const res = await sqlClient.unsafe(convertPlaceholders(sql), params || []);
        return (res[0] as T) || null;
      },
      async execute(sql: string, params?: any[]): Promise<{ changes: number }> {
        const res = await sqlClient.unsafe(convertPlaceholders(sql), params || []);
        return { changes: res.count || 0 };
      },
      async transaction<T>(cb: (tx: AsyncDb) => Promise<T>): Promise<T> {
        return (await sqlClient.begin(async (sqlTx) => {
          const txClient: AsyncDb = {
            isPostgres: true,
            async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
              const res = await sqlTx.unsafe(convertPlaceholders(sql), params || []);
              return Array.from(res) as T[];
            },
            async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
              const res = await sqlTx.unsafe(convertPlaceholders(sql), params || []);
              return (res[0] as T) || null;
            },
            async execute(sql: string, params?: any[]): Promise<{ changes: number }> {
              const res = await sqlTx.unsafe(convertPlaceholders(sql), params || []);
              return { changes: res.count || 0 };
            },
            transaction: (nestedCb) => nestedCb(txClient),
          };
          return await cb(txClient);
        })) as T;
      },
    };
    return pgDb;
  }

  // SQLite fallback
  const db = getDb();
  return createAsyncDbFromSqlite(db);
}

export function createAsyncDbFromSqlite(db: Database.Database): AsyncDb {
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
          } catch {
            // ignore rollback failure if already rolled back
          }
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
 * Engine-aware check to determine if demo data provenance (seed_manifest) is present.
 * Works seamlessly across PostgreSQL and SQLite without direct schema dependencies.
 */
export async function checkDemoProvenance(asyncDb?: AsyncDb): Promise<boolean> {
  try {
    const db = asyncDb || getAsyncDb();
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
        return rowCount > 0;
      }
    } else {
      const manifestTable = await db.queryOne<{ count: number }>(
        "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='seed_manifest'"
      );
      if (manifestTable && Number(manifestTable.count) > 0) {
        const manifestCount = await db.queryOne<{ count: number }>(
          "SELECT count(*) as count FROM seed_manifest"
        );
        return Boolean(manifestCount && Number(manifestCount.count) > 0);
      }
    }
    return false;
  } catch {
    return false;
  }
}
