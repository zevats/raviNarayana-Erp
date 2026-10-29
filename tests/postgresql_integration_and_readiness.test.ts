import path from "path";
import fs from "fs";
import {
  validatePostgresTargetSafety,
  seedInitialPostgresAdmin,
  createMockPostgresAsyncDb,
} from "../apps/erp/src/server/database/pgIntegration";
import {
  getDatabaseEngine,
  isPostgresConfigured,
  isPostgresActive,
  pingDatabase,
} from "../apps/erp/src/server/database/client";
import {
  convertPlaceholders,
  getAsyncDb,
  AsyncDb,
} from "../apps/erp/src/server/database/db";
import { TABLES_IN_ORDER } from "../apps/erp/src/server/database/migrateSqliteToPg";
import { createRoom, listRooms, getRoomById } from "../apps/erp/src/server/rooms/roomService";
import { registerResident } from "../apps/erp/src/server/residents/residentService";
import { AuthenticatedUser } from "../apps/erp/src/types";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
  }
}

const mockSuperAdmin: AuthenticatedUser = {
  id: "usr_mock_superadmin",
  username: "superadmin",
  email: "superadmin@ravinarayan.in",
  fullName: "Super Admin",
  role: "SUPER_ADMIN",
};

async function runIntegrationAndReadinessTests() {
  console.log("================================================================================");
  console.log("TASK 01B.25 — POSTGRESQL INTEGRATION, PRODUCTION READINESS & COMPATIBILITY");
  console.log("Strictly offline — zero unauthorized remote database network calls");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // SUITE 1: Target Identity & Safety Guard
  // ---------------------------------------------------------------------------
  console.log("[SUITE 1] PostgreSQL Target Identity & Safety Guards");

  const unconfiguredSafety = validatePostgresTargetSafety(null);
  assert(!unconfiguredSafety.safe, "Rejects null/missing PostgreSQL connection URL");
  assert(unconfiguredSafety.reason?.includes("No PostgreSQL database URL"), "Identifies unconfigured database URL");

  const malformedSafety = validatePostgresTargetSafety("not-a-valid-url");
  assert(!malformedSafety.safe, "Rejects malformed PostgreSQL connection URL");

  const prodSafety = validatePostgresTargetSafety("postgres://admin:secret@prod-db.aws.postgres.com:5432/ravinarayan_prod");
  assert(!prodSafety.safe, "Strictly blocks connection targeting production host");
  assert(prodSafety.isProduction === true, "Accurately tags production target as isProduction: true");

  const rehearsalHost = "ep-test-123.ap-southeast-1.aws.neon.tech";
  const origHost = process.env.EXPECTED_NEON_HOST;
  const origDb = process.env.EXPECTED_NEON_DATABASE;
  const origOptIn = process.env.ALLOW_TEST_MIGRATION;

  try {
    process.env.EXPECTED_NEON_HOST = rehearsalHost;
    process.env.EXPECTED_NEON_DATABASE = "neondb";
    delete process.env.ALLOW_TEST_MIGRATION;

    const rehearsalBlocked = validatePostgresTargetSafety(`postgres://user:pw@${rehearsalHost}:5432/neondb`);
    assert(!rehearsalBlocked.safe, "Blocks rehearsal database connection when ALLOW_TEST_MIGRATION=true is missing");
    assert(rehearsalBlocked.isRehearsalDatabase === true, "Correctly identifies designated rehearsal target host and db");

    // Since Task 01B.73 the rehearsal database is permanently blocked; the opt-in flag is not an override.
    process.env.ALLOW_TEST_MIGRATION = "true";
    const rehearsalWithFlag = validatePostgresTargetSafety(`postgres://user:pw@${rehearsalHost}:5432/neondb`);
    assert(!rehearsalWithFlag.safe, "Rehearsal database stays blocked even when ALLOW_TEST_MIGRATION=true is set");
  } finally {
    if (origHost) process.env.EXPECTED_NEON_HOST = origHost; else delete process.env.EXPECTED_NEON_HOST;
    if (origDb) process.env.EXPECTED_NEON_DATABASE = origDb; else delete process.env.EXPECTED_NEON_DATABASE;
    if (origOptIn) process.env.ALLOW_TEST_MIGRATION = origOptIn; else delete process.env.ALLOW_TEST_MIGRATION;
  }

  // Default-deny: remote hosts are rejected even when no EXPECTED_NEON_HOST is configured (ISSUE-003).
  delete process.env.EXPECTED_NEON_HOST;
  const remoteNeon = validatePostgresTargetSafety("postgres://user:pw@ep-other-999.us-east-2.aws.neon.tech:5432/neondb");
  assert(!remoteNeon.safe, "Rejects an unconfigured remote Neon host (no fail-open when EXPECTED_NEON_HOST is unset)");
  const remoteLocalName = validatePostgresTargetSafety("postgres://user:pw@db.example.com:5432/ravinarayana_erp_local");
  assert(!remoteLocalName.safe, "Rejects a remote host even when the database name looks local");
  const protectedOnLoopback = validatePostgresTargetSafety("postgres://user:pw@127.0.0.1:5432/ravi-narayana-erp-phase01b-test");
  assert(!protectedOnLoopback.safe && protectedOnLoopback.isRehearsalDatabase, "Rejects the protected rehearsal name on any host");
  const encodedProtected = validatePostgresTargetSafety("postgres://user:pw@127.0.0.1:5432/ravi-narayana-erp-phase01b%2Dtest");
  assert(!encodedProtected.safe, "Rejects a percent-encoded protected rehearsal name");
  const loopbackNeondb = validatePostgresTargetSafety("postgres://user:pw@127.0.0.1:5432/neondb");
  assert(!loopbackNeondb.safe, "Rejects generic database names (neondb) even on loopback");
  const httpTarget = validatePostgresTargetSafety("http://127.0.0.1:5432/ravinarayana_erp_local");
  assert(!httpTarget.safe, "Rejects non-postgres protocols");
  const localTarget = validatePostgresTargetSafety("postgres://user:pw@127.0.0.1:5432/ravinarayana_erp_local");
  assert(localTarget.safe, "Accepts the loopback local development database");
  const verifyTarget = validatePostgresTargetSafety("postgresql://u:p@localhost:55432/rn_erp_verify_test");
  assert(verifyTarget.safe, "Accepts a loopback disposable verification database");

  // ---------------------------------------------------------------------------
  // SUITE 2: PostgreSQL Single-Database Engine Enforcement
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 2] PostgreSQL Single-Database Engine Enforcement");

  const origEngine = process.env.DATABASE_ENGINE;
  const origNodeEnv = process.env.NODE_ENV;

  try {
    delete process.env.DATABASE_ENGINE;
    process.env.NODE_ENV = "development";
    assert(getDatabaseEngine() === "postgresql", "Default database engine in development is 'postgresql'");

    let sqliteEngineThrew = false;
    try {
      process.env.DATABASE_ENGINE = "sqlite";
      getDatabaseEngine();
    } catch (err: any) {
      sqliteEngineThrew = err.message.includes("SQLite has been decommissioned");
    }
    assert(sqliteEngineThrew, "DATABASE_ENGINE=sqlite throws fatal error (SQLite decommissioned)");

    process.env.DATABASE_ENGINE = "postgresql";
    assert(getDatabaseEngine() === "postgresql", "Explicit DATABASE_ENGINE=postgresql selects 'postgresql'");

    process.env.DATABASE_ENGINE = "postgres";
    assert(getDatabaseEngine() === "postgresql", "DATABASE_ENGINE=postgres alias normalized to 'postgresql'");

    delete process.env.DATABASE_ENGINE;
    process.env.NODE_ENV = "production";
    assert(getDatabaseEngine() === "postgresql", "Production environment (NODE_ENV=production) strictly defaults to 'postgresql'");
  } finally {
    if (origEngine) process.env.DATABASE_ENGINE = origEngine; else delete process.env.DATABASE_ENGINE;
    process.env.NODE_ENV = origNodeEnv;
  }

  // ---------------------------------------------------------------------------
  // SUITE 3: PostgreSQL Query Parameter & CamelCase Identifier Transformation
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 3] Parameter Placeholder ($n) & Quoted Alias Transformation");

  const q1 = "SELECT id, room_number as roomNumber, base_rent_monthly as baseRentMonthly FROM rooms WHERE floor = ? AND type = ?";
  const c1 = convertPlaceholders(q1);
  assert(c1.includes("$1") && c1.includes("$2"), "Converts ? placeholders to positional $1, $2");
  assert(c1.includes('as "roomNumber"'), "Automatically quotes camelCase alias 'roomNumber' to '\"roomNumber\"'");
  assert(c1.includes('as "baseRentMonthly"'), "Automatically quotes camelCase alias 'baseRentMonthly' to '\"baseRentMonthly\"'");

  const q2 = "SELECT count(*) as count, max(amount) as max_amount FROM tx WHERE notes = 'Is this working?' AND status = ?";
  const c2 = convertPlaceholders(q2);
  assert(c2.includes("$1"), "Replaces ? placeholder after single-quoted string");
  assert(c2.includes("'Is this working?'"), "Preserves ? inside single-quoted string literal");
  assert(c2.includes("as count"), "Leaves lowercase alias 'as count' unquoted");
  assert(c2.includes("as max_amount"), "Leaves snake_case alias 'as max_amount' unquoted");

  const q3 = 'SELECT id, room_number as "alreadyQuoted" FROM rooms WHERE id = ?';
  const c3 = convertPlaceholders(q3);
  assert(c3.includes('as "alreadyQuoted"'), "Preserves already quoted double-quote alias without double-wrapping");

  // ---------------------------------------------------------------------------
  // SUITE 4: Drizzle Migrations & Schema Topology Verification
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 4] Drizzle Migration Files & Referential Schema Topology");

  const drizzleDir = path.resolve(process.cwd(), "apps/erp/src/server/database/drizzle");
  assert(fs.existsSync(drizzleDir), "Drizzle migrations directory exists");

  const migrationFiles = fs.readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));
  assert(migrationFiles.length >= 2, `Found ${migrationFiles.length} versioned Drizzle SQL migration files`);

  assert(TABLES_IN_ORDER.length === 18, `All 18 operational tables mapped in topological order (got ${TABLES_IN_ORDER.length})`);
  assert(TABLES_IN_ORDER[0] === "staff_users", "staff_users is root table in topological order");
  assert(TABLES_IN_ORDER[TABLES_IN_ORDER.length - 1] === "password_resets", "password_resets is terminal leaf table");

  // ---------------------------------------------------------------------------
  // SUITE 5: Initial Administrator Provisioning for PostgreSQL
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 5] Initial Administrator Provisioning (PostgreSQL Engine)");

  let seededUsers: any[] = [];
  const mockPgAdminDb = createMockPostgresAsyncDb({
    onQuery: (sql) => {
      if (sql.includes("COUNT(*)")) {
        return [{ count: seededUsers.length }];
      }
      return seededUsers;
    },
    onExecute: (sql, params) => {
      if (sql.includes("INSERT INTO staff_users")) {
        seededUsers.push({
          id: params[0],
          username: params[1],
          email: params[2],
          fullName: params[3],
          role: "SUPER_ADMIN",
          isActive: 1,
        });
        return { changes: 1 };
      }
      return { changes: 0 };
    },
  });

  const seedResult1 = await seedInitialPostgresAdmin(mockPgAdminDb, {
    username: "admin",
    email: "admin@ravinarayan.in",
    fullName: "Dr. Ravinder Gulia",
    password: "StrongValidPassword2026!",
  });

  assert(seedResult1.seeded === true, "Successfully seeded initial administrator into empty PostgreSQL staff_users");
  assert(seededUsers.length === 1, "Staff record persisted in database");
  assert(seededUsers[0].username === "admin", "Admin username matches configuration");

  // Second run: idempotent skip
  const seedResult2 = await seedInitialPostgresAdmin(mockPgAdminDb, {
    username: "admin",
    email: "admin@ravinarayan.in",
    fullName: "Dr. Ravinder Gulia",
    password: "StrongValidPassword2026!",
  });

  assert(seedResult2.seeded === false, "Second seeding run safely skipped when staff_users is populated");
  assert(seedResult2.message.includes("already contains 1 user(s)"), "Provides clear audit message for skip");

  // ---------------------------------------------------------------------------
  // SUITE 6: End-to-End Domain Workflows via PostgreSQL AsyncDb Adapter
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 6] End-to-End Domain Workflows on PostgreSQL Adapter");

  const roomsStore: any[] = [];
  const residentsStore: any[] = [];
  const auditStore: any[] = [];

  const mockPgDomainDb = createMockPostgresAsyncDb({
    onQuery: (sql, params) => {
      if (sql.includes("FROM rooms") && sql.includes("WHERE r.id = $1")) {
        const found = roomsStore.find((r) => r.id === params[0]);
        return found ? [found] : [];
      }
      if (sql.includes("FROM rooms") && sql.includes("WHERE UPPER(room_number) = $1")) {
        const found = roomsStore.find((r) => r.roomNumber.toUpperCase() === String(params[0]).toUpperCase());
        return found ? [found] : [];
      }
      if (sql.includes("FROM rooms")) {
        return roomsStore;
      }
      if (sql.includes("FROM resident_stays")) {
        return [];
      }
      return [];
    },
    onExecute: (sql, params) => {
      if (sql.includes("INSERT INTO rooms")) {
        roomsStore.push({
          id: params[0],
          roomNumber: params[1],
          floor: params[2],
          type: params[3],
          capacity: params[4],
          baseRentMonthly: params[5],
          isActive: 1,
          occupiedBeds: 0,
          residents: [],
          createdAt: params[6],
          updatedAt: params[7],
        });
        return { changes: 1 };
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        auditStore.push({ id: params[0], action: params[3] });
        return { changes: 1 };
      }
      return { changes: 1 };
    },
  });

  // Workflow 6a: Room Creation on PostgreSQL Adapter
  const createdRoom = await createRoom(
    mockSuperAdmin,
    {
      roomNumber: "PG-201",
      floor: 2,
      type: "DOUBLE_SHARING",
      capacity: 2,
      baseRentMonthly: 14000,
    },
    "192.168.1.10",
    mockPgDomainDb
  );

  assert(createdRoom.roomNumber === "PG-201", "createRoom executed successfully on PostgreSQL AsyncDb adapter");
  assert(createdRoom.floor === 2, "Room floor accurately saved");
  assert(createdRoom.baseRentMonthly === 14000, "Monthly rent accurately recorded");

  // Workflow 6b: Room Lookup on PostgreSQL Adapter
  const fetchedRoom = await getRoomById(mockSuperAdmin, createdRoom.id, mockPgDomainDb);
  assert(fetchedRoom !== null && fetchedRoom.id === createdRoom.id, "getRoomById retrieved room through PostgreSQL parameter binding ($1)");

  // Workflow 6c: Audit Log Recording on PostgreSQL Adapter
  assert(auditStore.some((a) => a.action === "room.created"), "recordAuditEventAsync recorded 'room.created' event via PostgreSQL adapter");

  console.log("\n================================================================================");
  console.log(`INTEGRATION TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runIntegrationAndReadinessTests().catch((err) => {
  console.error("Integration test runner unhandled rejection:", err);
  process.exit(1);
});
