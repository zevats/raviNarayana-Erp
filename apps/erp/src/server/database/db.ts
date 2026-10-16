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
}

const globalForDb = globalThis as unknown as GlobalDatabaseContext;

export function resolveDbPath(): string {
  if (process.env.ERP_DATABASE_PATH) {
    return path.resolve(process.cwd(), process.env.ERP_DATABASE_PATH);
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
