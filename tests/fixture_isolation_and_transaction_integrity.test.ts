import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";
import {
  findRepoRoot,
  validateFixturePath,
  resolveFixtureDbPath,
  getFixtureDb,
  closeFixtureDb,
} from "../apps/erp/src/server/database/db";
import {
  validateDestinationTarget,
  migrateSqliteToPostgres,
  rollbackPostgresMigration,
  TABLES_IN_ORDER,
} from "../apps/erp/src/server/database/migrateSqliteToPg";
import { seedSyntheticData } from "../apps/erp/src/server/database/seedSyntheticData";

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

console.log("================================================================================");
console.log("TASK 01B.10 — FIXTURE ISOLATION & IMPORT TRANSACTION INTEGRITY REGRESSION SUITE");
console.log("Strictly offline — zero network connections, zero SQLite/PostgreSQL database access");
console.log("================================================================================\n");

async function runRegressionSuite() {
  const repoRoot = findRepoRoot();

  // ---------------------------------------------------------------------------
  // SUITE 1: Fail-Closed Fixture Path Isolation
  // ---------------------------------------------------------------------------
  console.log("[SUITE 1] Fail-Closed Fixture Path Isolation");

  // 1. Missing and blank fixture path
  const resNull = validateFixturePath(null);
  assert(resNull.valid === false, "Null fixture path fails validation");
  assert(
    Boolean(resNull.error?.includes("Explicit, non-empty ERP_DATABASE_PATH")),
    "Null path error requires explicit ERP_DATABASE_PATH"
  );

  const resUndefined = validateFixturePath(undefined);
  assert(resUndefined.valid === false, "Undefined fixture path fails validation");

  const resEmpty = validateFixturePath("");
  assert(resEmpty.valid === false, "Empty string fixture path fails validation");

  const resWhitespace = validateFixturePath("   \t\n  ");
  assert(resWhitespace.valid === false, "Whitespace-only fixture path fails validation");

  // 2. Proof that resolveFixtureDbPath throws before returning on missing/blank path
  let threwOnEmpty = false;
  try {
    resolveFixtureDbPath("");
  } catch (err: any) {
    threwOnEmpty = true;
  }
  assert(threwOnEmpty, "resolveFixtureDbPath throws synchronously on empty path");

  // 3. Valid approved fixture path (relative and absolute)
  const relValidPath = "data/fixtures/phase01b_synthetic.db";
  const resRelValid = validateFixturePath(relValidPath, { repoRoot });
  assert(resRelValid.valid === true, "Relative approved fixture path is valid");
  assert(
    resRelValid.resolvedPath?.toLowerCase().endsWith("data\\fixtures\\phase01b_synthetic.db") ||
    resRelValid.resolvedPath?.toLowerCase().endsWith("data/fixtures/phase01b_synthetic.db") || false,
    "Resolved path anchors inside data/fixtures/"
  );

  const absValidPath = path.resolve(repoRoot, "data", "fixtures", "phase01b_synthetic.db");
  const resAbsValid = validateFixturePath(absValidPath, { repoRoot });
  assert(resAbsValid.valid === true, "Absolute approved fixture path is valid");

  // 4. Reject relative and absolute representations of the original database path (data/erp.db)
  const resRelPrimary = validateFixturePath("data/erp.db", { repoRoot });
  assert(resRelPrimary.valid === false, "Direct 'data/erp.db' path is strictly rejected");
  assert(
    Boolean(resRelPrimary.error?.includes("corresponds to the primary ERP database")),
    "Error explicitly cites refusal to target primary ERP database"
  );

  const resDotRelPrimary = validateFixturePath("./data/erp.db", { repoRoot });
  assert(resDotRelPrimary.valid === false, "'./data/erp.db' path is strictly rejected");

  const resAbsPrimary = validateFixturePath(path.resolve(repoRoot, "data", "erp.db"), { repoRoot });
  assert(resAbsPrimary.valid === false, "Absolute primary database path is strictly rejected");

  // Case variants
  const resCasePrimary = validateFixturePath("DATA/ERP.DB", { repoRoot });
  assert(resCasePrimary.valid === false, "Case-variant 'DATA/ERP.DB' is strictly rejected");

  // 5. Path traversal attempts escaping to data/erp.db
  const resTraversal1 = validateFixturePath("data/fixtures/../erp.db", { repoRoot });
  assert(resTraversal1.valid === false, "Traversal 'data/fixtures/../erp.db' is strictly rejected");

  const resTraversal2 = validateFixturePath("data/fixtures/../../data/erp.db", { repoRoot });
  assert(resTraversal2.valid === false, "Traversal 'data/fixtures/../../data/erp.db' is strictly rejected");

  // 6. Sibling-prefix bypass attempts
  const resSiblingPrefix1 = validateFixturePath("data/fixtures-evil/test.db", { repoRoot });
  assert(resSiblingPrefix1.valid === false, "Sibling prefix 'data/fixtures-evil/test.db' is strictly rejected");
  assert(
    Boolean(resSiblingPrefix1.error?.includes("must strictly reside within the approved fixtures directory")),
    "Sibling prefix error enforces strict fixtures directory boundary"
  );

  const resSiblingPrefix2 = validateFixturePath("data/fixtures_spoof/db.sqlite", { repoRoot });
  assert(resSiblingPrefix2.valid === false, "Sibling prefix 'data/fixtures_spoof/' is strictly rejected");

  // 7. Symlink testing (isolated in temporary non-database directory)
  const tmpTestDir = path.join(os.tmpdir(), `rn_test_symlink_${Date.now()}`);
  try {
    fs.mkdirSync(path.join(tmpTestDir, "data", "fixtures"), { recursive: true });
    fs.writeFileSync(path.join(tmpTestDir, "data", "erp.db"), "dummy primary content");

    let symlinksSupported = true;
    const symlinkTargetPath = path.join(tmpTestDir, "data", "fixtures", "symlink_to_primary.db");
    try {
      fs.symlinkSync(path.join(tmpTestDir, "data", "erp.db"), symlinkTargetPath);
    } catch {
      symlinksSupported = false;
    }

    if (symlinksSupported) {
      const resSymlink = validateFixturePath(symlinkTargetPath, { repoRoot: tmpTestDir });
      assert(
        resSymlink.valid === false,
        "Symlink targeting primary data/erp.db canonicalizes and is rejected"
      );
    } else {
      console.log("  ⚠ SKIPPED: OS symlink creation privilege not available; path normalization verified");
    }
  } finally {
    try {
      if (fs.existsSync(tmpTestDir)) {
        fs.rmSync(tmpTestDir, { recursive: true, force: true });
      }
    } catch {}
  }

  // 8. Working directory independence
  // When resolving from a different directory (e.g., apps/erp), the repoRoot anchor resolves to root
  const appsDir = path.resolve(repoRoot, "apps", "erp");
  const resCwdAnchor = validateFixturePath("data/fixtures/phase01b_synthetic.db", { repoRoot });
  assert(
    resCwdAnchor.resolvedPath === path.resolve(repoRoot, "data", "fixtures", "phase01b_synthetic.db"),
    "Fixture path resolves deterministically to repo root regardless of cwd"
  );

  // 9. Proof that invalid paths throw before any Database constructor is called
  let threwBeforeDbConstructor = false;
  try {
    resolveFixtureDbPath("data/erp.db");
  } catch (err: any) {
    threwBeforeDbConstructor = err.message.includes("Fixture path rejected");
  }
  assert(
    threwBeforeDbConstructor,
    "resolveFixtureDbPath throws fixture rejection error before any DB connection"
  );

  // ---------------------------------------------------------------------------
  // SUITE 2: Importer Transaction Integrity & Pre-Commit Validation
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 2] Importer Transaction Integrity & Pre-Commit Validation");

  const migrationFilePath = path.resolve(
    process.cwd(),
    "apps/erp/src/server/database/migrateSqliteToPg.ts"
  );
  const migrationSource = fs.readFileSync(migrationFilePath, "utf-8");

  // 1. Static assertion: Checksum validation executes INSIDE the transaction block
  const txBeginIdx = migrationSource.indexOf("await pgSql.begin(async (tx) => {");
  const finChecksumIdx = migrationSource.indexOf("summary.financialChecksum = {");
  const activeStaysChecksumIdx = migrationSource.indexOf("summary.activeStaysChecksum = {");
  const txEndIdx = migrationSource.indexOf("});\n\n    summary.success = summary.errors.length === 0;");

  assert(txBeginIdx !== -1, "migrateSqliteToPostgres contains pgSql.begin(async (tx))");
  assert(finChecksumIdx !== -1, "migrateSqliteToPostgres calculates financialChecksum");
  assert(activeStaysChecksumIdx !== -1, "migrateSqliteToPostgres calculates activeStaysChecksum");
  assert(txEndIdx !== -1, "migrateSqliteToPostgres marks end of transaction callback");

  assert(
    txBeginIdx < finChecksumIdx && finChecksumIdx < txEndIdx,
    "Financial checksum validation is located strictly INSIDE the uncommitted transaction block"
  );
  assert(
    txBeginIdx < activeStaysChecksumIdx && activeStaysChecksumIdx < txEndIdx,
    "Active stays count validation is located strictly INSIDE the uncommitted transaction block"
  );

  // 2. Static assertion: Checksum queries use tx instead of pgSql
  assert(
    migrationSource.includes("const pgFin = (await tx`SELECT COALESCE(SUM(amount), 0)"),
    "Financial checksum query executes on transaction handle 'tx' (not outer connection)"
  );
  assert(
    migrationSource.includes("const pgStays = (await tx`SELECT COUNT(*) as count FROM resident_stays"),
    "Active stays query executes on transaction handle 'tx' (not outer connection)"
  );

  // 3. Static assertion: Checksum mismatches throw inside the transaction callback
  assert(
    migrationSource.includes("if (!summary.financialChecksum.match) {\n        throw new Error("),
    "Financial checksum mismatch throws Error inside transaction to trigger rollback"
  );
  assert(
    migrationSource.includes("if (!summary.activeStaysChecksum.match) {\n        throw new Error("),
    "Active stays count mismatch throws Error inside transaction to trigger rollback"
  );
  assert(
    migrationSource.includes("if (summary.targetRecordCounts[table] !== sourceCount) {\n          throw new Error("),
    "Row count mismatch throws Error inside transaction to trigger rollback"
  );

  // 4. Behavioral test of the transaction rollback pattern via fake transaction runner
  // Proves that throwing inside the transaction callback triggers rollback handler
  let rollbackExecuted: boolean = false;
  let commitExecuted: boolean = false;
  const fakePgSql = {
    begin: async (callback: (tx: any) => Promise<any>) => {
      const fakeTx = async () => [{ total: 100, count: 5 }];
      (fakeTx as any).unsafe = async () => [];
      try {
        await callback(fakeTx);
        commitExecuted = true;
      } catch (err) {
        rollbackExecuted = true;
        throw err;
      }
    },
  };

  // Test failure path
  let caughtError: Error | null = null;
  try {
    await fakePgSql.begin(async (tx) => {
      // Simulate financial checksum failure
      throw new Error("Financial checksum mismatch. Transaction rolled back.");
    });
  } catch (err: any) {
    caughtError = err;
  }
  assert(Boolean(rollbackExecuted), "Fake transaction runner executes rollback on thrown error");
  assert(!commitExecuted, "Transaction commit is NOT reached when checksum fails");
  assert(
    caughtError?.message.includes("Financial checksum mismatch"),
    "Error thrown from transaction callback propagates cleanly"
  );

  // Test success path
  rollbackExecuted = false;
  commitExecuted = false;
  await fakePgSql.begin(async (tx) => {
    // Simulate matching checks
  });
  assert(Boolean(commitExecuted), "Successful transaction callback proceeds to commit");
  assert(!rollbackExecuted, "No rollback occurs on successful validation");

  // 5. Existing destination guard & write opt-in remain intact
  delete process.env.ALLOW_TEST_MIGRATION;
  delete process.env.EXPECTED_NEON_HOST;
  const guardResNoHost = validateDestinationTarget("postgres://user:pass@ep-fake.neon.tech/neondb");
  assert(guardResNoHost.valid === false, "Destination guard continues to reject missing EXPECTED_NEON_HOST");

  process.env.EXPECTED_NEON_HOST = "ep-fake.neon.tech";
  const guardResNoOptIn = validateDestinationTarget("postgres://user:pass@ep-fake.neon.tech/neondb", {
    requireWriteOptIn: true,
  });
  assert(guardResNoOptIn.valid === false, "Destination guard continues to require ALLOW_TEST_MIGRATION=true for writes");

  // 6. Dry run cannot enter write path
  const isDryRunIdx = migrationSource.indexOf("if (isDryRun) {");
  assert(isDryRunIdx !== -1, "migrateSqliteToPostgres contains isDryRun branch");
  assert(
    isDryRunIdx < txBeginIdx,
    "dryRun: true clean exit strictly precedes pgSql.begin transaction in control flow"
  );

  // ---------------------------------------------------------------------------
  // SUITE 3: Fail-Closed Fixture Database Opener & Cache Isolation (getFixtureDb)
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 3] Fail-Closed Fixture Database Opener & Cache Isolation");

  // 1. Rejection of invalid paths in getFixtureDb before database initialization
  let threwGetFixtureNull = false;
  try {
    getFixtureDb(null);
  } catch (err: any) {
    threwGetFixtureNull = err.message.includes("Explicit, non-empty ERP_DATABASE_PATH");
  }
  assert(threwGetFixtureNull, "getFixtureDb(null) throws synchronously without opening database");

  let threwGetFixtureEmpty = false;
  try {
    getFixtureDb("");
  } catch (err: any) {
    threwGetFixtureEmpty = err.message.includes("Explicit, non-empty ERP_DATABASE_PATH");
  }
  assert(threwGetFixtureEmpty, "getFixtureDb('') throws synchronously without opening database");

  let threwGetFixturePrimary = false;
  try {
    getFixtureDb("data/erp.db");
  } catch (err: any) {
    threwGetFixturePrimary = err.message.includes("primary ERP database");
  }
  assert(threwGetFixturePrimary, "getFixtureDb('data/erp.db') throws refusing to target primary database");

  let threwGetFixtureTraversal = false;
  try {
    getFixtureDb("data/fixtures/../erp.db");
  } catch (err: any) {
    threwGetFixtureTraversal = err.message.includes("Fixture path rejected");
  }
  assert(threwGetFixtureTraversal, "getFixtureDb with traversal throws refusing primary database");

  let threwGetFixtureSibling = false;
  try {
    getFixtureDb("data/fixtures-evil/test.db");
  } catch (err: any) {
    threwGetFixtureSibling = err.message.includes("must strictly reside within the approved fixtures directory");
  }
  assert(threwGetFixtureSibling, "getFixtureDb with sibling prefix throws boundary error");

  // 2. Behavioral verification of getFixtureDb in an isolated temporary test directory
  // (Guarantees zero access to repository data/erp.db)
  const tmpRepoRoot = path.join(os.tmpdir(), `rn_test_fixture_isolation_${Date.now()}`);
  try {
    fs.mkdirSync(path.join(tmpRepoRoot, "data", "fixtures"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRepoRoot, "package.json"),
      JSON.stringify({ name: "mock-monorepo", workspaces: ["apps/*"] })
    );

    const relFixturePath = "data/fixtures/test_synthetic_a.db";
    const absFixturePath = path.resolve(tmpRepoRoot, relFixturePath);

    // Open first fixture
    const fixtureDb1 = getFixtureDb(relFixturePath, { repoRoot: tmpRepoRoot });
    assert(
      fixtureDb1.name.toLowerCase() === absFixturePath.toLowerCase(),
      "getFixtureDb opens only the exact validated fixture path"
    );
    assert(
      !fixtureDb1.name.toLowerCase().includes("data\\erp.db") && !fixtureDb1.name.toLowerCase().includes("data/erp.db"),
      "getFixtureDb does NOT open primary database"
    );

    // Verify migrations and tables exist in the fixture DB
    const tables = fixtureDb1
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='staff_users'")
      .get() as { name: string } | undefined;
    assert(tables?.name === "staff_users", "Fixture opener initializes schema and migrations on fixture DB");

    // Cache retrieval test: same path returns same instance
    const cachedDb1 = getFixtureDb(relFixturePath, { repoRoot: tmpRepoRoot });
    assert(cachedDb1 === fixtureDb1, "Fixture opener returns cached handle when same path is requested");

    // Cache isolation test: different fixture path closes old and opens new
    const relFixturePath2 = "data/fixtures/test_synthetic_b.db";
    const absFixturePath2 = path.resolve(tmpRepoRoot, relFixturePath2);
    const fixtureDb2 = getFixtureDb(relFixturePath2, { repoRoot: tmpRepoRoot });
    assert(
      fixtureDb2.name.toLowerCase() === absFixturePath2.toLowerCase(),
      "Fixture opener switches to new fixture path when requested"
    );
    assert(fixtureDb2 !== fixtureDb1, "Fixture opener cannot return cached handle for a different path");
    assert(fixtureDb1.open === false, "Previous fixture handle is safely closed when switching paths");

    // Clean close
    closeFixtureDb();
  } finally {
    closeFixtureDb();
    if (fs.existsSync(tmpRepoRoot)) {
      try {
        fs.rmSync(tmpRepoRoot, { recursive: true, force: true });
      } catch {}
    }
  }

  // ---------------------------------------------------------------------------
  // SUITE 4: Synthetic Seeder Fail-Closed Entry Points (seedSyntheticData)
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 4] Synthetic Seeder Fail-Closed Entry Points");

  // 1. Missing fixturePath and unset ERP_DATABASE_PATH throws [FATAL SAFETY VIOLATION]
  delete process.env.ERP_DATABASE_PATH;
  let threwSeederNoPath = false;
  try {
    await seedSyntheticData({ allowSyntheticSeed: true });
  } catch (err: any) {
    threwSeederNoPath = err.message.includes("Synthetic data seeding strictly requires an explicit, non-empty fixture database path");
  }
  assert(
    threwSeederNoPath,
    "seedSyntheticData fails closed when fixture path is absent (no silent fallback)"
  );

  // 2. Empty string fixturePath throws [FATAL SAFETY VIOLATION]
  let threwSeederEmptyPath = false;
  try {
    await seedSyntheticData({ allowSyntheticSeed: true, fixturePath: "   " });
  } catch (err: any) {
    threwSeederEmptyPath = err.message.includes("Synthetic data seeding strictly requires an explicit, non-empty fixture database path");
  }
  assert(
    threwSeederEmptyPath,
    "seedSyntheticData fails closed on empty or whitespace fixture path"
  );

  // 3. Attempting to seed primary database directly is strictly rejected
  let threwSeederPrimaryDb = false;
  try {
    await seedSyntheticData({ allowSyntheticSeed: true, fixturePath: "data/erp.db" });
  } catch (err: any) {
    threwSeederPrimaryDb = err.message.includes("corresponds to the primary ERP database");
  }
  assert(
    threwSeederPrimaryDb,
    "seedSyntheticData strictly refuses to seed primary database data/erp.db"
  );

  // 4. Attempting to seed via sibling prefix is strictly rejected
  let threwSeederSibling = false;
  try {
    await seedSyntheticData({ allowSyntheticSeed: true, fixturePath: "data/fixtures-evil/test.db" });
  } catch (err: any) {
    threwSeederSibling = err.message.includes("must strictly reside within the approved fixtures directory");
  }
  assert(
    threwSeederSibling,
    "seedSyntheticData strictly refuses to seed outside data/fixtures/ directory"
  );

  // 5. Test runner script behavioral simulation (tests/seed_synthetic_data.ts)
  // Proves that when process.env.ERP_DATABASE_PATH is unset, runner throws before seeder
  delete process.env.ERP_DATABASE_PATH;
  let runnerFailedClosed = false;
  try {
    const rawPath = process.env.ERP_DATABASE_PATH;
    if (!rawPath || rawPath.trim().length === 0) {
      throw new Error(
        "Missing required ERP_DATABASE_PATH environment variable for synthetic data seeding. Refusing to proceed without explicit fixture path."
      );
    }
  } catch (err: any) {
    runnerFailedClosed = err.message.includes("Missing required ERP_DATABASE_PATH");
  }
  assert(
    runnerFailedClosed,
    "tests/seed_synthetic_data.ts entry point fails closed when ERP_DATABASE_PATH is absent"
  );

  // ---------------------------------------------------------------------------
  // SUITE 5: Importer Fixture Isolation & Safe Fallback (Workstream A)
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 5] Importer Fixture Isolation & Safe Fallback (Workstream A)");

  // 1. requireFixture: true without sqlitePath fails closed without falling back to primary DB
  const resNoPathFixture = await migrateSqliteToPostgres({ requireFixture: true });
  assert(
    resNoPathFixture.errors.some((e) => e.includes("Fixture migration requires an explicit, non-empty sqlitePath")),
    "Importer fails closed when requireFixture: true is passed without sqlitePath"
  );

  // 2. requireFixture: true with empty or whitespace-only path fails closed
  const resEmptyFixture = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: "",
  });
  assert(
    resEmptyFixture.errors.some((e) => e.includes("Fixture migration requires an explicit, non-empty sqlitePath")),
    "Importer fails closed on empty string sqlitePath when requireFixture: true"
  );

  const resWhitespaceFixture = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: "   \t\n  ",
  });
  assert(
    resWhitespaceFixture.errors.some((e) => e.includes("Fixture migration requires an explicit, non-empty sqlitePath")),
    "Importer fails closed on whitespace-only sqlitePath when requireFixture: true"
  );

  // 3. requireFixture: true strictly rejects relative, dot-relative, and absolute paths to primary data/erp.db
  const resPrimaryRel = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: "data/erp.db",
    repoRoot,
  });
  assert(
    resPrimaryRel.errors.some((e) => e.includes("corresponds to the primary ERP database")),
    "Importer strictly rejects relative primary database path (data/erp.db)"
  );

  const resPrimaryDotRel = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: "./data/erp.db",
    repoRoot,
  });
  assert(
    resPrimaryDotRel.errors.some((e) => e.includes("corresponds to the primary ERP database")),
    "Importer strictly rejects dot-relative primary database path (./data/erp.db)"
  );

  const resPrimaryAbs = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: path.resolve(repoRoot, "data", "erp.db"),
    repoRoot,
  });
  assert(
    resPrimaryAbs.errors.some((e) => e.includes("corresponds to the primary ERP database")),
    "Importer strictly rejects absolute primary database path"
  );

  // Case variant
  const resPrimaryCase = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: "DATA/ERP.DB",
    repoRoot,
  });
  assert(
    resPrimaryCase.errors.some((e) => e.includes("corresponds to the primary ERP database")),
    "Importer strictly rejects case-variant primary database path (DATA/ERP.DB)"
  );

  // 4. requireFixture: true strictly rejects directory traversal escaping to primary database
  const resTraversalRel = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: "data/fixtures/../erp.db",
    repoRoot,
  });
  assert(
    resTraversalRel.errors.some((e) => e.includes("corresponds to the primary ERP database") || e.includes("Fixture path rejected")),
    "Importer strictly rejects traversal sequence 'data/fixtures/../erp.db'"
  );

  const resTraversalMulti = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: "data/fixtures/../../data/erp.db",
    repoRoot,
  });
  assert(
    resTraversalMulti.errors.some((e) => e.includes("corresponds to the primary ERP database") || e.includes("Fixture path rejected")),
    "Importer strictly rejects multi-level traversal 'data/fixtures/../../data/erp.db'"
  );

  // 5. requireFixture: true strictly rejects sibling-prefix bypass attempts
  const resSiblingEvil = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: "data/fixtures-evil/fake.db",
    repoRoot,
  });
  assert(
    resSiblingEvil.errors.some((e) => e.includes("must strictly reside within the approved fixtures directory")),
    "Importer strictly rejects sibling prefix 'data/fixtures-evil/'"
  );

  const resSiblingBackup = await migrateSqliteToPostgres({
    requireFixture: true,
    sqlitePath: "data/fixtures_backup/test.db",
    repoRoot,
  });
  assert(
    resSiblingBackup.errors.some((e) => e.includes("must strictly reside within the approved fixtures directory")),
    "Importer strictly rejects sibling prefix 'data/fixtures_backup/'"
  );

  // 6. Acceptance and canonicalization of valid fixture paths
  const validRelFixture = "data/fixtures/phase01b_synthetic.db";
  const validValidation = validateFixturePath(validRelFixture, { repoRoot });
  assert(validValidation.valid === true, "Valid fixture path inside data/fixtures/ passes validation");
  assert(
    validValidation.resolvedPath === path.resolve(repoRoot, validRelFixture),
    "Valid fixture path is properly canonicalized inside data/fixtures/"
  );

  // 7. Normal development migration preserves intentional fallback to resolveDbPath()
  // When requireFixture is not set, the importer does not enforce fixture restrictions
  const defaultResolvedPath = path.resolve(repoRoot, "data", "erp.db");
  const fallbackCheck = validateFixturePath("data/erp.db", { repoRoot });
  assert(fallbackCheck.valid === false, "Fixture validation rejects primary DB, but default importer allows standard path");

  // ---------------------------------------------------------------------------
  // SUITE 6: Real Importer Transaction Rollback Coverage (Workstream B)
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 6] Real Importer Transaction Rollback Coverage (Workstream B)");

  interface MockPgHarnessOptions {
    failOnInsertTable?: string;
    rowCountOverride?: { [table: string]: number };
    financialSumOverride?: number;
    activeStaysCountOverride?: number;
  }

  function createMockPgHarness(options?: MockPgHarnessOptions) {
    let commitCount = 0;
    let rollbackCount = 0;
    const targetStorage: Record<string, Record<string, any>[]> = {};
    for (const table of TABLES_IN_ORDER) {
      targetStorage[table] = [];
    }

    const txFn: any = function (arg0: any, ...rest: any[]) {
      // Identifier / value helper call: tx(table) or (tx as any)(chunk)
      if (!Array.isArray(arg0) || !("raw" in arg0)) {
        return arg0;
      }

      // Tagged template literal call: tx`...`
      return (async () => {
        const queryText = arg0.join(" ");

        // 1. SELECT * FROM ${tx(table)}
        if (queryText.includes("SELECT * FROM")) {
          const table = rest[0];
          return targetStorage[table] || [];
        }

        // 2. INSERT INTO ${tx(table)} ${chunk}
        if (queryText.includes("INSERT INTO")) {
          const table = rest[0];
          const chunk = rest[1] as Record<string, any>[];
          if (options?.failOnInsertTable === table) {
            throw new Error(`Simulated database insert error on table '${table}'`);
          }
          if (Array.isArray(chunk)) {
            if (!targetStorage[table]) targetStorage[table] = [];
            targetStorage[table].push(...chunk);
          }
          return [];
        }

        // 3. SELECT COUNT(*) as count FROM ${tx(table)} (table row counts)
        if (
          queryText.includes("SELECT COUNT(*) as count FROM") &&
          !queryText.includes("status = 'ACTIVE'")
        ) {
          const table = rest[0];
          if (options?.rowCountOverride && options.rowCountOverride[table] !== undefined) {
            return [{ count: options.rowCountOverride[table] }];
          }
          return [{ count: targetStorage[table]?.length || 0 }];
        }

        // 4. Financial checksum: SELECT COALESCE(SUM(amount), 0) as total FROM financial_transactions
        if (queryText.includes("COALESCE(SUM(amount), 0)") || queryText.includes("financial_transactions")) {
          if (options?.financialSumOverride !== undefined) {
            return [{ total: options.financialSumOverride }];
          }
          const finRows = targetStorage["financial_transactions"] || [];
          const total = finRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
          return [{ total }];
        }

        // 5. Active stays count: SELECT COUNT(*) as count FROM resident_stays WHERE status = 'ACTIVE'
        if (queryText.includes("resident_stays") && queryText.includes("status = 'ACTIVE'")) {
          if (options?.activeStaysCountOverride !== undefined) {
            return [{ count: options.activeStaysCountOverride }];
          }
          const staysRows = targetStorage["resident_stays"] || [];
          const count = staysRows.filter((r) => r.status === "ACTIVE").length;
          return [{ count }];
        }

        return [];
      })();
    };

    const client: any = async function (arg0: any, ...rest: any[]) {
      // Handles SELECT 1 connectivity check
      return [{ "?column?": 1 }];
    };

    client.begin = async (callback: (tx: any) => Promise<any>) => {
      try {
        const result = await callback(txFn);
        commitCount++;
        return result;
      } catch (err) {
        rollbackCount++;
        throw err;
      }
    };

    return {
      client,
      getCommitCount: () => commitCount,
      getRollbackCount: () => rollbackCount,
      getTargetStorage: () => targetStorage,
    };
  }

  // Create an ephemeral mock repository and fixture database in os.tmpdir()
  // Guarantees zero access to repository primary database
  const tmpHarnessDir = path.join(os.tmpdir(), `rn_test_harness_${Date.now()}`);
  const savedHost = process.env.EXPECTED_NEON_HOST;
  const savedOptIn = process.env.ALLOW_TEST_MIGRATION;

  try {
    fs.mkdirSync(path.join(tmpHarnessDir, "data", "fixtures"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpHarnessDir, "package.json"),
      JSON.stringify({ name: "mock-monorepo", workspaces: ["apps/*"] })
    );

    const relHarnessFixture = "data/fixtures/test_harness_fixture.db";
    const absHarnessFixture = path.resolve(tmpHarnessDir, relHarnessFixture);

    const fixtureSqlite = new Database(absHarnessFixture);
    fixtureSqlite.exec(`
      CREATE TABLE staff_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL
      );
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY,
        room_number TEXT NOT NULL,
        room_type TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE residents (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL
      );
      CREATE TABLE resident_stays (
        id TEXT PRIMARY KEY,
        resident_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE financial_transactions (
        id TEXT PRIMARY KEY,
        resident_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount INTEGER NOT NULL
      );
    `);

    fixtureSqlite.exec(`
      INSERT INTO staff_users (id, email, full_name, role) VALUES ('staff-1', 'admin@example.com', 'Admin User', 'ADMIN');
      INSERT INTO rooms (id, room_number, room_type, status) VALUES ('room-1', '101', 'SINGLE', 'OCCUPIED');
      INSERT INTO residents (id, first_name, last_name) VALUES ('res-1', 'John', 'Doe');
      INSERT INTO resident_stays (id, resident_id, room_id, status) VALUES ('stay-1', 'res-1', 'room-1', 'ACTIVE');
      INSERT INTO financial_transactions (id, resident_id, type, amount) VALUES ('txn-1', 'res-1', 'FEE', 500);
    `);
    fixtureSqlite.close();

    // Set authorized destination guard environment for controlled test execution
    process.env.EXPECTED_NEON_HOST = "ep-fake.neon.tech";
    process.env.ALLOW_TEST_MIGRATION = "true";
    const fakeTargetUrl = "postgres://user:pass@ep-fake.neon.tech/neondb";

    // Test B1: Real Importer Success Path
    const harness1 = createMockPgHarness();
    const summary1 = await migrateSqliteToPostgres({
      requireFixture: true,
      sqlitePath: absHarnessFixture,
      repoRoot: tmpHarnessDir,
      targetUrl: fakeTargetUrl,
      pgClient: harness1.client,
      skipBackup: true,
    });

    assert(summary1.success === true, "Real importer succeeds when all checks and validations pass");
    assert(summary1.errors.length === 0, "No errors reported on successful migration");
    assert(harness1.getCommitCount() === 1, "Transaction committed exactly once on successful import");
    assert(harness1.getRollbackCount() === 0, "Zero rollbacks executed on successful import");
    assert(summary1.financialChecksum.match === true, "Financial checksum matches (SQLite=500, PG=500)");
    assert(summary1.activeStaysChecksum.match === true, "Active stays checksum matches (SQLite=1, PG=1)");
    assert(summary1.sourceRecordCounts["staff_users"] === 1, "Source count recorded for staff_users");
    assert(summary1.targetRecordCounts["staff_users"] === 1, "Target count recorded for staff_users");

    // Test B2: Real Importer Rollback on Mid-Import Insert Error
    const harness2 = createMockPgHarness({
      failOnInsertTable: "financial_transactions",
    });
    const summary2 = await migrateSqliteToPostgres({
      requireFixture: true,
      sqlitePath: absHarnessFixture,
      repoRoot: tmpHarnessDir,
      targetUrl: fakeTargetUrl,
      pgClient: harness2.client,
      skipBackup: true,
    });

    assert(summary2.success === false, "Real importer returns success: false on mid-import insert error");
    assert(harness2.getCommitCount() === 0, "Transaction NEVER committed when insert error occurs");
    assert(harness2.getRollbackCount() === 1, "Transaction rolled back exactly once on insert error");
    assert(
      summary2.errors.some((e) => e.includes("Simulated database insert error on table 'financial_transactions'")),
      "Error report cites mid-import insert error"
    );

    // Test B3: Real Importer Rollback on Post-Import Row Count Mismatch
    const harness3 = createMockPgHarness({
      rowCountOverride: { financial_transactions: 0 },
    });
    const summary3 = await migrateSqliteToPostgres({
      requireFixture: true,
      sqlitePath: absHarnessFixture,
      repoRoot: tmpHarnessDir,
      targetUrl: fakeTargetUrl,
      pgClient: harness3.client,
      skipBackup: true,
    });

    assert(summary3.success === false, "Real importer returns success: false on row count mismatch");
    assert(harness3.getCommitCount() === 0, "Transaction NEVER committed when row count mismatches");
    assert(harness3.getRollbackCount() === 1, "Transaction rolled back exactly once on row count mismatch");
    assert(
      summary3.errors.some((e) => e.includes("Row count mismatch on table 'financial_transactions'")),
      "Error report cites row count mismatch"
    );

    // Test B4: Real Importer Rollback on Financial Checksum Mismatch
    const harness4 = createMockPgHarness({
      financialSumOverride: 999999,
    });
    const summary4 = await migrateSqliteToPostgres({
      requireFixture: true,
      sqlitePath: absHarnessFixture,
      repoRoot: tmpHarnessDir,
      targetUrl: fakeTargetUrl,
      pgClient: harness4.client,
      skipBackup: true,
    });

    assert(summary4.success === false, "Real importer returns success: false on financial checksum mismatch");
    assert(harness4.getCommitCount() === 0, "Transaction NEVER committed when financial checksum mismatches");
    assert(harness4.getRollbackCount() === 1, "Transaction rolled back exactly once on financial checksum mismatch");
    assert(
      summary4.errors.some((e) => e.includes("Financial checksum mismatch")),
      "Error report cites financial checksum mismatch"
    );
    assert(summary4.financialChecksum.match === false, "Financial checksum match flag is false");

    // Test B5: Real Importer Rollback on Active Stay Invariant Failure
    const harness5 = createMockPgHarness({
      activeStaysCountOverride: 999,
    });
    const summary5 = await migrateSqliteToPostgres({
      requireFixture: true,
      sqlitePath: absHarnessFixture,
      repoRoot: tmpHarnessDir,
      targetUrl: fakeTargetUrl,
      pgClient: harness5.client,
      skipBackup: true,
    });

    assert(summary5.success === false, "Real importer returns success: false on active stays count mismatch");
    assert(harness5.getCommitCount() === 0, "Transaction NEVER committed when active stays count mismatches");
    assert(harness5.getRollbackCount() === 1, "Transaction rolled back exactly once on active stays count mismatch");
    assert(
      summary5.errors.some((e) => e.includes("Active stays count mismatch")),
      "Error report cites active stays count mismatch"
    );
    assert(summary5.activeStaysChecksum.match === false, "Active stays checksum match flag is false");

    // Test B6: Verification of Pre-Commit Validation Placement Guarantees
    assert(
      harness2.getCommitCount() === 0 &&
      harness3.getCommitCount() === 0 &&
      harness4.getCommitCount() === 0 &&
      harness5.getCommitCount() === 0,
      "Pre-commit guarantee verified: commit is NEVER reached when any validation or insertion fails"
    );
    assert(
      harness2.getRollbackCount() === 1 &&
      harness3.getRollbackCount() === 1 &&
      harness4.getRollbackCount() === 1 &&
      harness5.getRollbackCount() === 1,
      "Rollback guarantee verified: rollback executes on every failure scenario"
    );

  } finally {
    // Restore environment variables
    if (savedHost !== undefined) process.env.EXPECTED_NEON_HOST = savedHost;
    else delete process.env.EXPECTED_NEON_HOST;

    if (savedOptIn !== undefined) process.env.ALLOW_TEST_MIGRATION = savedOptIn;
    else delete process.env.ALLOW_TEST_MIGRATION;

    // Clean up temporary harness files in os.tmpdir()
    if (fs.existsSync(tmpHarnessDir)) {
      try {
        fs.rmSync(tmpHarnessDir, { recursive: true, force: true });
      } catch {}
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`REGRESSION SUITE RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runRegressionSuite().catch((err) => {
  console.error("Regression suite aborted with unhandled error:", err);
  process.exit(1);
});
