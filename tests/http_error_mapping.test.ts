/**
 * API error classification: database failures must not be reported as "400 Bad Request".
 * Pure function checks; no database, no network.
 */
import { isDatabaseError, databaseErrorResponse } from "../apps/erp/src/server/database/availability";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.log(`  ✗ FAIL: ${message}`);
  }
}

function pgError(code: string, message: string) {
  return Object.assign(new Error(message), { name: "PostgresError", code, severity: "ERROR" });
}

async function main() {
  console.log("[SUITE] Database vs. validation errors in API routes");
  const missingTable = pgError("42P01", 'relation "orders" does not exist');
  const r500 = databaseErrorResponse("/api/orders", missingTable);
  const body500 = r500 ? await r500.json() : null;
  assert(isDatabaseError(missingTable), "42P01 (missing table) is recognised as a database error");
  assert(r500?.status === 500 && body500?.code === "DATABASE_ERROR", "Missing table → 500 DATABASE_ERROR (was 400)");
  assert(!JSON.stringify(body500).includes("relation"), "SQL detail is not sent to the browser");

  const r409 = databaseErrorResponse("/api/orders", pgError("23505", "duplicate key value violates unique constraint"));
  assert(r409?.status === 409, "Integrity-constraint violation (class 23) → 409");

  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
  assert(databaseErrorResponse("/api/orders", refused)?.status === 503, "Unreachable database → 503");

  const validation = new Error("Valid customer phone number is required for delivery orders.");
  assert(!isDatabaseError(validation) && databaseErrorResponse("/api/orders", validation) === null, "Business validation error is left to the route (stays 400)");
  const sqlite = Object.assign(new Error("UNIQUE constraint failed"), { code: "SQLITE_CONSTRAINT" });
  assert(!isDatabaseError(sqlite), "Non-PostgreSQL codes are not misclassified");

  console.log(`\nHTTP ERROR MAPPING RESULTS: ${passed} PASSED, ${failed} FAILED`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
