import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations } from "./sqliteMigrations";

interface GlobalFixtureContext {
  _rnErpFixtureDbInstance?: Database.Database | null;
  _rnErpFixtureDbPath?: string | null;
  _rnErpFixtureStatements?: Map<string, Database.Statement>;
}

const globalForFixture = globalThis as unknown as GlobalFixtureContext;

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

export function getFixtureDb(
  rawPath: string | null | undefined = process.env.ERP_DATABASE_PATH,
  options?: { repoRoot?: string }
): Database.Database {
  const validatedPath = resolveFixtureDbPath(rawPath, options);

  if (
    globalForFixture._rnErpFixtureDbInstance &&
    globalForFixture._rnErpFixtureDbInstance.open
  ) {
    if (globalForFixture._rnErpFixtureDbPath === validatedPath) {
      return globalForFixture._rnErpFixtureDbInstance;
    }
    closeFixtureDb();
  }

  const dbDir = path.dirname(validatedPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(validatedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

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
  globalForFixture._rnErpFixtureStatements = statementCache;

  runMigrations(db);

  globalForFixture._rnErpFixtureDbInstance = db;
  globalForFixture._rnErpFixtureDbPath = validatedPath;

  return db;
}

export function closeFixtureDb(): void {
  const db = globalForFixture._rnErpFixtureDbInstance;
  if (db) {
    if (globalForFixture._rnErpFixtureStatements) {
      globalForFixture._rnErpFixtureStatements.clear();
    }
    try {
      if (db.open) {
        db.close();
      }
    } catch {}
    globalForFixture._rnErpFixtureDbInstance = null;
    globalForFixture._rnErpFixtureDbPath = null;
  }
}
