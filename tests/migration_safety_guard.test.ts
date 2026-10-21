import fs from "fs";
import path from "path";
import os from "os";
import {
  validateDestinationTarget,
  migrateSqliteToPostgres,
  rollbackPostgresMigration,
} from "../apps/erp/src/server/database/migrateSqliteToPg";

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
console.log("TASK 01B.5 — OFFLINE MIGRATION SAFETY GUARD UNIT TESTS");
console.log("Strictly offline — zero network connections, zero database writes");
console.log("================================================================================\n");

async function runSafetyGuardTests() {
  // Preserve original environment
  const originalEnv = { ...process.env };

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: Missing EXPECTED_NEON_HOST -> rejected
    // -------------------------------------------------------------------------
    console.log("[SCENARIO 1] Missing EXPECTED_NEON_HOST rejection");
    delete process.env.EXPECTED_NEON_HOST;
    delete process.env.ALLOW_TEST_MIGRATION;

    const res1 = validateDestinationTarget(
      "postgres://user:secret@ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech/neondb"
    );
    assert(res1.valid === false, "Missing EXPECTED_NEON_HOST fails validation");
    assert(
      Boolean(res1.error?.includes("EXPECTED_NEON_HOST")),
      "Rejection error message explicitly cites missing EXPECTED_NEON_HOST"
    );

    // -------------------------------------------------------------------------
    // SCENARIO 2: Malformed URL -> rejected
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 2] Malformed or invalid protocol URL rejection");
    process.env.EXPECTED_NEON_HOST = "ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech";

    const res2a = validateDestinationTarget("invalid-non-url-string");
    assert(res2a.valid === false, "Non-URL string fails validation");
    assert(
      Boolean(res2a.error?.includes("malformed")),
      "Rejection error message identifies malformed URL"
    );

    const res2b = validateDestinationTarget(
      "http://ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech/neondb"
    );
    assert(res2b.valid === false, "Non-postgres protocol (http:) fails validation");
    assert(
      Boolean(res2b.error?.includes("protocol")),
      "Rejection error message identifies protocol requirement"
    );

    const res2c = validateDestinationTarget("");
    assert(res2c.valid === false, "Empty URL string fails validation");

    // -------------------------------------------------------------------------
    // SCENARIO 3: Mismatched hostname -> rejected
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 3] Target hostname mismatch rejection");
    process.env.EXPECTED_NEON_HOST = "ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech";

    const res3 = validateDestinationTarget(
      "postgres://user:secret@ep-different-project-789012.ap-southeast-1.aws.neon.tech/neondb"
    );
    assert(res3.valid === false, "Mismatched target hostname fails validation");
    assert(
      Boolean(res3.error?.includes("Target hostname does not match EXPECTED_NEON_HOST")),
      "Rejection error message explicitly identifies hostname mismatch"
    );

    // Also verify optional database mismatch
    process.env.EXPECTED_NEON_DATABASE = "neondb";
    const res3DbMismatch = validateDestinationTarget(
      "postgres://user:secret@ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech/otherdb"
    );
    assert(res3DbMismatch.valid === false, "Mismatched target database name fails validation");
    assert(
      Boolean(res3DbMismatch.error?.includes("EXPECTED_NEON_DATABASE")),
      "Rejection error message identifies database name mismatch"
    );
    delete process.env.EXPECTED_NEON_DATABASE;

    // -------------------------------------------------------------------------
    // SCENARIO 4: Matching hostname without ALLOW_TEST_MIGRATION=true -> rejected for write ops
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 4] Missing write opt-in (ALLOW_TEST_MIGRATION=true) rejection");
    process.env.EXPECTED_NEON_HOST = "ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech";
    delete process.env.ALLOW_TEST_MIGRATION;

    const res4Unset = validateDestinationTarget(
      "postgres://user:secret@ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech/neondb",
      { requireWriteOptIn: true }
    );
    assert(res4Unset.valid === false, "Unset ALLOW_TEST_MIGRATION rejected for write operations");
    assert(
      Boolean(res4Unset.error?.includes("ALLOW_TEST_MIGRATION=true")),
      "Rejection error message requires explicit ALLOW_TEST_MIGRATION=true opt-in"
    );

    process.env.ALLOW_TEST_MIGRATION = "false";
    const res4ExplicitFalse = validateDestinationTarget(
      "postgres://user:secret@ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech/neondb",
      { requireWriteOptIn: true }
    );
    assert(res4ExplicitFalse.valid === false, "ALLOW_TEST_MIGRATION=false rejected for write operations");

    // -------------------------------------------------------------------------
    // SCENARIO 5: Matching hostname with ALLOW_TEST_MIGRATION=true -> validation passes offline
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 5] Authorized target identity passes offline validation");
    process.env.EXPECTED_NEON_HOST = "ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech";
    process.env.EXPECTED_NEON_DATABASE = "neondb";
    process.env.ALLOW_TEST_MIGRATION = "true";

    const res5 = validateDestinationTarget(
      "postgres://user:secret@ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech/neondb",
      { requireWriteOptIn: true }
    );
    assert(res5.valid === true, "Authorized target identity passes validation offline");
    assert(
      res5.parsedHost === "ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech",
      "Parsed host matches expected hostname"
    );
    assert(res5.parsedDatabase === "neondb", "Parsed database matches expected database");

    // Case-insensitivity check
    const res5Case = validateDestinationTarget(
      "postgres://user:secret@EP-PHASE01B-TEST-123456.ap-southeast-1.aws.neon.tech/NEONDB",
      { requireWriteOptIn: true }
    );
    assert(res5Case.valid === true, "Case-insensitive hostname and database comparison passes");

    // -------------------------------------------------------------------------
    // SCENARIO 6: Suffix-only .neon.tech match alone -> rejected
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 6] Suffix-only and spoofed domain rejection");
    process.env.EXPECTED_NEON_HOST = "ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech";

    const res6AttackerPrefix = validateDestinationTarget(
      "postgres://user:secret@ep-phase01b-test-123456-evil.ap-southeast-1.aws.neon.tech/neondb"
    );
    assert(res6AttackerPrefix.valid === false, "Target with extra suffix in subdomain rejected");

    const res6OtherSubdomain = validateDestinationTarget(
      "postgres://user:secret@ep-production-instance-000000.ap-southeast-1.aws.neon.tech/neondb"
    );
    assert(res6OtherSubdomain.valid === false, "Target sharing .neon.tech cloud suffix rejected when host differs");

    // -------------------------------------------------------------------------
    // SCENARIO 7: Rollback without valid destination guard -> blocked before connection
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 7] Guarded rollback destination rejection before connection");
    process.env.NODE_ENV = "development";
    delete process.env.ALLOW_TEST_MIGRATION;
    delete process.env.EXPECTED_NEON_HOST;

    const res7 = await rollbackPostgresMigration({
      confirmDestructive: true,
      targetUrl: "postgres://user:secret@ep-unauthorized.neon.tech/neondb",
    });
    assert(res7.success === false, "Destructive rollback rejected when destination guard fails");
    assert(
      Boolean(res7.error?.includes("Destructive rollback blocked")),
      "Rollback returns 'Destructive rollback blocked' error message"
    );
    assert(res7.truncatedTables.length === 0, "Zero tables truncated when rollback is blocked");

    // -------------------------------------------------------------------------
    // SCENARIO 8: dryRun: true in migrateSqliteToPostgres skips backup creation
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 8] Dry-run skips backup file creation");
    const migrationFile = path.resolve(
      process.cwd(),
      "apps/erp/src/server/database/migrateSqliteToPg.ts"
    );
    const migrationSource = fs.readFileSync(migrationFile, "utf-8");

    // Static code structure assertion: dry-run return MUST precede fs.copyFileSync
    const dryRunIdx = migrationSource.indexOf("if (isDryRun)");
    const copyFileIdx = migrationSource.indexOf("fs.copyFileSync(sqlitePath, backupPath");
    assert(dryRunIdx !== -1, "migrateSqliteToPostgres contains explicit isDryRun branch");
    assert(copyFileIdx !== -1, "migrateSqliteToPostgres contains backup copyFileSync call");
    assert(
      dryRunIdx < copyFileIdx,
      "isDryRun clean exit strictly precedes backup copyFileSync in control flow"
    );

    // Dynamic verification: when target URL is unconfigured, dry-run safely aborts without backupPath
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_URL;
    const dryRunRes = await migrateSqliteToPostgres({ dryRun: true });
    assert(dryRunRes.backupPath === undefined, "Dry run aborts without setting backupPath");

    // -------------------------------------------------------------------------
    // SCENARIO 9: Exclusive backup creation prevents overwriting existing backup
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 9] Exclusive backup creation and collision resolution");
    // 1. Source code specifies fs.constants.COPYFILE_EXCL
    assert(
      migrationSource.includes("fs.constants.COPYFILE_EXCL"),
      "migrateSqliteToPg.ts uses fs.constants.COPYFILE_EXCL for atomic creation"
    );

    // 2. Source code implements nonce fallback on timestamp collision
    assert(
      migrationSource.includes("crypto.randomBytes(4).toString(\"hex\")"),
      "migrateSqliteToPg.ts appends random hex nonce if timestamp collision occurs"
    );

    // 3. Verify node's COPYFILE_EXCL prevents file overwrite
    const tmpSrc = path.join(os.tmpdir(), `test_safeguard_src_${Date.now()}.tmp`);
    const tmpDest = path.join(os.tmpdir(), `test_safeguard_dest_${Date.now()}.tmp`);
    fs.writeFileSync(tmpSrc, "source data payload");
    fs.writeFileSync(tmpDest, "existing backup payload to protect");

    let threwExclusiveError = false;
    try {
      fs.copyFileSync(tmpSrc, tmpDest, fs.constants.COPYFILE_EXCL);
    } catch (err: any) {
      threwExclusiveError = err.code === "EEXIST";
    } finally {
      if (fs.existsSync(tmpSrc)) fs.unlinkSync(tmpSrc);
      if (fs.existsSync(tmpDest)) fs.unlinkSync(tmpDest);
    }
    assert(
      threwExclusiveError,
      "fs.constants.COPYFILE_EXCL raises EEXIST when destination file exists, preventing silent overwrite"
    );

    // -------------------------------------------------------------------------
    // SCENARIO 10: Production guard blocks rollback even if ALLOW_TEST_MIGRATION=true
    // -------------------------------------------------------------------------
    console.log("\n[SCENARIO 10] Production guard blocks rollback despite test opt-in");
    process.env.NODE_ENV = "production";
    process.env.EXPECTED_NEON_HOST = "ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech";
    process.env.ALLOW_TEST_MIGRATION = "true";

    const res10 = await rollbackPostgresMigration({
      confirmDestructive: true,
      targetUrl: "postgres://user:secret@ep-phase01b-test-123456.ap-southeast-1.aws.neon.tech/neondb",
      allowProduction: false,
    });
    assert(res10.success === false, "Production rollback rejected without explicit allowProduction");
    assert(
      Boolean(
        res10.error?.includes(
          "Cannot truncate production database without explicit allowProduction override"
        )
      ),
      "Error identifies production database truncation protection"
    );
    assert(res10.truncatedTables.length === 0, "Zero tables truncated in production rollback attempt");

  } finally {
    // Restore original environment
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log(`MIGRATION SAFETY GUARD TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runSafetyGuardTests().catch((err) => {
  console.error("Test execution aborted with unhandled error:", err);
  process.exit(1);
});
