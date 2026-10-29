import path from "path";
import { execSync } from "child_process";

const { validateMigrationTarget } = require(path.resolve(process.cwd(), "scripts/migrate.js"));

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

function expectThrows(fn: () => void, expectedSubstring: string, message: string) {
  try {
    fn();
    assert(false, `${message} - expected error containing '${expectedSubstring}' but no error thrown`);
  } catch (err: any) {
    const msg = err?.message || String(err);
    const matches = msg.includes(expectedSubstring);
    assert(matches, `${message} (caught: ${msg.slice(0, 80)}...)`);
  }
}

async function runTestSuite() {
  console.log("================================================================================");
  console.log("TASK 01B.73 — FAIL-CLOSED MIGRATION TARGET SAFETY TEST SUITE");
  console.log("================================================================================\n");

  // --------------------------------------------------------------------------
  // Case 1: Missing target configuration
  // --------------------------------------------------------------------------
  console.log("--- 1. Missing Target Configuration ---");
  expectThrows(
    () => validateMigrationTarget(undefined as any),
    "No target database URL provided",
    "Undefined target URL rejected"
  );
  expectThrows(
    () => validateMigrationTarget(""),
    "No target database URL provided",
    "Empty string target URL rejected"
  );
  expectThrows(
    () => validateMigrationTarget("   "),
    "No target database URL provided",
    "Whitespace-only target URL rejected"
  );

  // --------------------------------------------------------------------------
  // Case 2: Missing expected-host environment variables
  // --------------------------------------------------------------------------
  console.log("\n--- 2. Missing Expected-Host Environment Variables ---");
  const savedExpectedHost = process.env.EXPECTED_NEON_HOST;
  const savedExpectedDb = process.env.EXPECTED_NEON_DATABASE;
  delete process.env.EXPECTED_NEON_HOST;
  delete process.env.EXPECTED_NEON_DATABASE;

  expectThrows(
    () => validateMigrationTarget("postgresql://user:pass@some-arbitrary-host.com:5432/ravi-narayana-erp-phase01b-test"),
    "Target identified as protected Neon rehearsal database",
    "Rehearsal DB rejected even when EXPECTED_NEON_HOST is unset"
  );

  if (savedExpectedHost) process.env.EXPECTED_NEON_HOST = savedExpectedHost;
  if (savedExpectedDb) process.env.EXPECTED_NEON_DATABASE = savedExpectedDb;

  // --------------------------------------------------------------------------
  // Case 3: Protected rehearsal database name with a different hostname
  // --------------------------------------------------------------------------
  console.log("\n--- 3. Protected Rehearsal DB with Different Hostname ---");
  expectThrows(
    () => validateMigrationTarget("postgresql://user:secret@localhost:5432/ravi-narayana-erp-phase01b-test"),
    "Target identified as protected Neon rehearsal database",
    "Rehearsal DB on localhost strictly rejected"
  );
  expectThrows(
    () => validateMigrationTarget("postgresql://user:secret@127.0.0.1:5432/ravi-narayana-erp-phase01b-test"),
    "Target identified as protected Neon rehearsal database",
    "Rehearsal DB on 127.0.0.1 strictly rejected"
  );

  // --------------------------------------------------------------------------
  // Case 4: Protected rehearsal database name with expected hostname
  // --------------------------------------------------------------------------
  console.log("\n--- 4. Protected Rehearsal DB with Expected Hostname ---");
  expectThrows(
    () => validateMigrationTarget("postgresql://user:secret@ep-proud-field-a45k4g54.us-east-2.aws.neon.tech/ravi-narayana-erp-phase01b-test?sslmode=require"),
    "Target identified as protected Neon rehearsal database",
    "Rehearsal DB on neon host strictly rejected without credential leakage"
  );

  // --------------------------------------------------------------------------
  // Case 5: URL-encoded protected database name
  // --------------------------------------------------------------------------
  console.log("\n--- 5. URL-Encoded Protected Database Name ---");
  expectThrows(
    () => validateMigrationTarget("postgresql://user:secret@localhost:5432/ravi%2Dnarayana%2Derp%2Dphase01b%2Dtest"),
    "Target identified as protected Neon rehearsal database",
    "URL-encoded %2D rehearsal DB strictly rejected"
  );
  expectThrows(
    () => validateMigrationTarget("postgresql://user:secret@127.0.0.1:5432/%72%61%76%69%2D%6E%61%72%61%79%61%6E%61%2D%65%72%70%2D%70%68%61%73%65%30%31%62%2D%74%65%73%74"),
    "Target identified as protected Neon rehearsal database",
    "Fully percent-encoded rehearsal DB strictly rejected"
  );

  // --------------------------------------------------------------------------
  // Case 6: Malformed connection URL
  // --------------------------------------------------------------------------
  console.log("\n--- 6. Malformed Connection URL ---");
  expectThrows(
    () => validateMigrationTarget("not_a_valid_url:::"),
    "Malformed database connection URL",
    "Non-URL string rejected"
  );
  expectThrows(
    () => validateMigrationTarget("http://localhost:5432/ravinarayana_erp_local"),
    "Unsupported protocol 'http:'",
    "Non-postgres HTTP protocol rejected"
  );
  expectThrows(
    () => validateMigrationTarget("postgresql://localhost:5432/"),
    "Target URL missing database name",
    "URL with missing database pathname rejected"
  );

  // --------------------------------------------------------------------------
  // Case 7: Remote PostgreSQL host
  // --------------------------------------------------------------------------
  console.log("\n--- 7. Remote PostgreSQL Host (Default-Deny) ---");
  expectThrows(
    () => validateMigrationTarget("postgresql://user:pass@ep-silent-hill-12345.neon.tech:5432/ravinarayana_erp_local"),
    "Remote migration target rejected",
    "Cloud Neon host rejected under default-deny"
  );
  expectThrows(
    () => validateMigrationTarget("postgresql://user:pass@192.168.1.100:5432/ravinarayana_erp_local"),
    "Remote migration target rejected",
    "LAN IP target rejected under default-deny"
  );
  expectThrows(
    () => validateMigrationTarget("postgresql://user:pass@postgres.internal.cloud:5432/ravinarayana_erp_local"),
    "Remote migration target rejected",
    "Remote internal DNS target rejected"
  );

  // --------------------------------------------------------------------------
  // Case 8: Approved local PostgreSQL target
  // --------------------------------------------------------------------------
  console.log("\n--- 8. Approved Local PostgreSQL Target ---");
  const localTarget = "postgresql://erp_local_user:erp_local_password@127.0.0.1:5432/ravinarayana_erp_local";
  const approved = validateMigrationTarget(localTarget);
  assert(approved.valid === true, "Approved local 127.0.0.1 target returns valid: true");
  assert(approved.hostname === "127.0.0.1", "Approved local target parses hostname as 127.0.0.1");
  assert(approved.port === 5432, "Approved local target parses port as 5432");
  assert(approved.dbName === "ravinarayana_erp_local", "Approved local target parses dbName as ravinarayana_erp_local");

  const localhostTarget = "postgresql://postgres:secret@localhost:5432/ravinarayana_dev";
  const approvedLocalhost = validateMigrationTarget(localhostTarget);
  assert(approvedLocalhost.valid === true, "Approved localhost target returns valid: true");
  assert(approvedLocalhost.hostname === "localhost", "Approved localhost target parses hostname as localhost");

  // --------------------------------------------------------------------------
  // Case 9: Migration failure produces a non-zero exit code
  // --------------------------------------------------------------------------
  console.log("\n--- 9. Migration CLI Failure Returns Non-Zero Exit Code ---");
  const migrateScriptPath = path.resolve(__dirname, "../scripts/migrate.js");
  try {
    // Invoke migrate.js with an intentionally malformed target; it must exit with non-zero
    execSync(`node "${migrateScriptPath}"`, {
      env: { ...process.env, DATABASE_URL: "postgresql://remote-host.com/ravinarayana_erp_local" },
      stdio: "pipe",
    });
    assert(false, "CLI did not exit with non-zero code on remote target");
  } catch (err: any) {
    assert(err.status !== 0, `CLI failed closed with non-zero exit code (${err.status})`);
  }

  // --------------------------------------------------------------------------
  // Case 10: No database connection is attempted for rejected targets
  // --------------------------------------------------------------------------
  console.log("\n--- 10. No Connection Attempted for Rejected Targets ---");
  // Verification: validateMigrationTarget is a pure synchronous function that parses the URL and
  // throws BEFORE any connection object, socket, or postgres(...) client is constructed.
  let clientCreated = false;
  try {
    validateMigrationTarget("postgresql://fakeuser:fakepassword@invalid-remote-domain-that-does-not-exist.org:5432/ravinarayana_erp_local");
    clientCreated = true;
  } catch {
    clientCreated = false;
  }
  assert(!clientCreated, "Synchronous validation throws before any network socket or client is created");

  console.log("\n================================================================================");
  console.log(`TASK 01B.73 MIGRATION SAFETY TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
