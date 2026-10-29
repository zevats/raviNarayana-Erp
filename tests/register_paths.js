const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");

const erpPackageJson = path.resolve(__dirname, "../apps/erp/package.json");
const erpRequire = createRequire(erpPackageJson);

const Module = require("module");
const originalRequire = Module.prototype.require;

// Registry of open SQLite database handles with reference counting
const openDatabases = new Map();

function normalizeDbPath(p) {
  if (!p) return "";
  return path.normalize(path.resolve(p)).toLowerCase();
}

function wrapBetterSqlite3(BetterSqlite3Class) {
  function WrappedBetterSqlite3(filename, options) {
    const norm = normalizeDbPath(filename);
    const entry = openDatabases.get(norm);
    if (entry && entry.instance && entry.instance.open) {
      entry.refCount++;
      return entry.instance;
    }

    const dbDir = path.dirname(filename);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new BetterSqlite3Class(filename, options);
    try {
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
      db.pragma("busy_timeout = 10000");
    } catch {}

    const entryRecord = { instance: db, refCount: 1 };
    openDatabases.set(norm, entryRecord);

    const origClose = db.close.bind(db);
    db.close = function () {
      const current = openDatabases.get(norm);
      if (current) {
        current.refCount--;
        if (current.refCount > 0) {
          return;
        }
        openDatabases.delete(norm);
      }
      return origClose();
    };

    return db;
  }
  WrappedBetterSqlite3.prototype = BetterSqlite3Class.prototype;
  return WrappedBetterSqlite3;
}

let wrappedBetterSqlite = null;

Module.prototype.require = function (id) {
  if (typeof id === "string" && id.startsWith("@/")) {
    const rel = id.slice(2);
    const resolvedInDist = path.resolve(__dirname, "dist/apps/erp/src", rel);
    try {
      return originalRequire.call(this, resolvedInDist);
    } catch {
      const resolvedInSrc = path.resolve(__dirname, "../apps/erp/src", rel);
      return originalRequire.call(this, resolvedInSrc);
    }
  }

  if (id === "better-sqlite3") {
    if (!wrappedBetterSqlite) {
      let raw;
      try {
        raw = originalRequire.apply(this, arguments);
      } catch (err) {
        raw = erpRequire(id);
      }
      wrappedBetterSqlite = wrapBetterSqlite3(raw);
    }
    return wrappedBetterSqlite;
  }

  try {
    return originalRequire.apply(this, arguments);
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") {
      try {
        return erpRequire(id);
      } catch {
        throw err;
      }
    }
    throw err;
  }
};

// ============================================================================
// OFFLINE TEST DOUBLE HARNESS
// Automatically provisions isolated SQLite test adapters for offline test
// suites running against explicit ERP_DATABASE_PATH fixtures.
// ============================================================================
let cachedTestDb = null;
let currentDbPath = null;

function getOrCreateTestSqlite() {
  const dbPath = process.env.ERP_DATABASE_PATH || path.resolve(__dirname, "test_erp.db");
  const norm = normalizeDbPath(dbPath);
  const entry = openDatabases.get(norm);

  let sqliteInstance;
  if (entry && entry.instance && entry.instance.open) {
    sqliteInstance = entry.instance;
  } else {
    const Database = require("better-sqlite3");
    sqliteInstance = new Database(dbPath);
  }

  if (cachedTestDb && currentDbPath === norm) {
    return cachedTestDb;
  }

  try {
    const { runMigrations } = require(path.resolve(__dirname, "dist/tests/helpers/sqliteMigrations.js"));
    runMigrations(sqliteInstance);
  } catch {}

  let dbModule;
  try {
    dbModule = require(path.resolve(__dirname, "dist/apps/erp/src/server/database/db.js"));
  } catch {
    dbModule = erpRequire("./src/server/database/db");
  }

  cachedTestDb = dbModule.createAsyncDbFromSqlite(sqliteInstance);
  currentDbPath = norm;
  return cachedTestDb;
}

globalThis._rnTestDbProvider = function () {
  if (process.env.DATABASE_URL && !process.env.FORCE_SQLITE_TEST_DOUBLE) {
    return null;
  }
  const dbPath = process.env.ERP_DATABASE_PATH || path.resolve(__dirname, "test_erp.db");
  const norm = normalizeDbPath(dbPath);
  if (cachedTestDb && currentDbPath === norm) {
    return cachedTestDb;
  }

  return getOrCreateTestSqlite();
};

globalThis._rnTestGetDb = function () {
  const dbPath = process.env.ERP_DATABASE_PATH || path.resolve(__dirname, "test_erp.db");
  const norm = normalizeDbPath(dbPath);
  const entry = openDatabases.get(norm);
  if (entry && entry.instance && entry.instance.open) {
    entry.refCount++;
    return entry.instance;
  }
  const Database = require("better-sqlite3");
  return new Database(dbPath);
};

globalThis._rnTestCloseDb = function () {
  const dbPath = process.env.ERP_DATABASE_PATH || path.resolve(__dirname, "test_erp.db");
  const norm = normalizeDbPath(dbPath);
  const entry = openDatabases.get(norm);
  if (entry) {
    try {
      if (entry.instance.open) {
        // Force close on explicit closeDb()
        entry.refCount = 0;
        openDatabases.delete(norm);
        entry.instance.close();
      }
    } catch {}
    openDatabases.delete(norm);
  }
  cachedTestDb = null;
  currentDbPath = null;
};
