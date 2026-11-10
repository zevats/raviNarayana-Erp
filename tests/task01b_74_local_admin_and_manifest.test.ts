/**
 * Task 01B.74 Verification Test Suite: Local Admin Provisioning & PWA Manifest Collision Resolution
 *
 * Verifies:
 * 1. PWA manifest collision resolution (public manifest is authoritative, no route collision in App Router).
 * 2. Fail-closed target validation in scripts/seed-local-admin.js (remote/rehearsal/invalid targets blocked).
 * 3. PostgreSQL administrator provisioning state and invariants in ravinarayana_erp_local.
 * 4. Idempotent skip behavior when staff_users is already populated.
 * 5. Primary SQLite and protected database immutability.
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getAsyncDb } from "../apps/erp/src/server/database/db";
import { closePg } from "../apps/erp/src/server/database/client";

const ROOT = process.cwd();
const PRIMARY_DB = path.resolve(ROOT, "data/erp.db");
const EXPECTED_PRIMARY_DB_SIZE = 1388544;

let passCount = 0;
let failCount = 0;

function testAssert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("TASK 01B.74 — LOCAL ADMIN PROVISIONING & MANIFEST COLLISION RESOLUTION TESTS");
  console.log("================================================================================");

  // ---------------------------------------------------------------------------
  // SUITE 1: PWA Manifest Collision Resolution
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 1] PWA Manifest Route Collision Resolution");

  const conflictingManifestTs = path.resolve(ROOT, "apps/erp/src/app/manifest.ts");
  testAssert(
    !fs.existsSync(conflictingManifestTs),
    "Conflicting apps/erp/src/app/manifest.ts permanently eliminated to prevent Next.js route collision"
  );

  const publicWebmanifest = path.resolve(ROOT, "apps/erp/public/manifest.webmanifest");
  testAssert(fs.existsSync(publicWebmanifest), "Authoritative public manifest exists at apps/erp/public/manifest.webmanifest");

  const manifestRaw = fs.readFileSync(publicWebmanifest, "utf8");
  let manifestJson: any = null;
  try {
    manifestJson = JSON.parse(manifestRaw);
  } catch {}
  testAssert(Boolean(manifestJson), "manifest.webmanifest is valid, parseable JSON");
  testAssert(manifestJson?.name === "Ravinarayan PG & Tiffin", "Manifest name matches brand identity");
  testAssert(manifestJson?.short_name === "Ravinarayan" || manifestJson?.short_name === "RN ERP", "Manifest short_name is valid");
  testAssert(manifestJson?.display === "standalone", "Manifest display mode is 'standalone'");
  testAssert(manifestJson?.start_url === "/", "Manifest start_url is '/'");
  testAssert(manifestJson?.theme_color === "#1A2E20", "Manifest theme_color is brand Evergreen (#1A2E20)");
  testAssert(manifestJson?.background_color === "#FAF8F5", "Manifest background_color is Warm Neutral (#FAF8F5)");
  testAssert(Array.isArray(manifestJson?.icons) && manifestJson.icons.length >= 4, "Manifest registers at least 4 icon formats");

  const layoutPath = path.resolve(ROOT, "apps/erp/src/app/layout.tsx");
  const layoutContent = fs.readFileSync(layoutPath, "utf8");
  testAssert(
    layoutContent.includes('manifest: "/manifest.webmanifest"'),
    "Root layout configures metadata manifest link pointing to '/manifest.webmanifest'"
  );

  // ---------------------------------------------------------------------------
  // SUITE 2: Fail-Closed Seeding Target Validation
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 2] Fail-Closed Seeding Target Validation Guards");

  const seedScriptPath = path.resolve(ROOT, "scripts/seed-local-admin.js");
  testAssert(fs.existsSync(seedScriptPath), "scripts/seed-local-admin.js exists");

  function testScriptRejection(envOverride: Record<string, string>, expectedErrorFragment: string, label: string) {
    try {
      execSync("node -r ./tests/register_paths.js scripts/seed-local-admin.js", {
        cwd: ROOT,
        env: { ...process.env, ...envOverride },
        stdio: "pipe",
      });
      testAssert(false, `${label} - should have been rejected but succeeded`);
    } catch (err: any) {
      const stderr = (err.stderr || err.stdout || "").toString();
      testAssert(
        stderr.includes(expectedErrorFragment),
        `${label} - correctly failed closed (${expectedErrorFragment})`
      );
    }
  }

  testScriptRejection(
    { DATABASE_URL: "postgresql://user:pass@remote.example.com/ravinarayana_erp_local" },
    "Target host 'remote.example.com' is rejected",
    "Remote host target"
  );

  testScriptRejection(
    { DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/neondb" },
    "Target database 'neondb' is rejected",
    "Non-local database name (neondb)"
  );

  testScriptRejection(
    { DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/ravi-narayana-erp-phase01b-test" },
    "Target database 'ravi-narayana-erp-phase01b-test' is rejected",
    "Protected rehearsal database target"
  );

  testScriptRejection(
    { DATABASE_URL: "http://127.0.0.1:5432/ravinarayana_erp_local" },
    "Unsupported protocol 'http:'",
    "Unsupported HTTP protocol"
  );

  // ---------------------------------------------------------------------------
  // SUITE 3: Administrator Record Invariants in PostgreSQL
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 3] Local PostgreSQL Administrator Record Invariants");

  process.env.DATABASE_URL = "postgresql://erp_local_user:erp_local_password@127.0.0.1:5432/ravinarayana_erp_local";
  const asyncDb = getAsyncDb();
  testAssert(asyncDb.isPostgres === true, "Connected to PostgreSQL database engine");

  const adminRow = await asyncDb.queryOne<any>(
    "SELECT id, username, email, full_name as fullName, role, is_active as isActive, password_hash as passwordHash FROM staff_users WHERE username = ?",
    ["admin"]
  );

  testAssert(adminRow !== null, "Administrator account exists in local PostgreSQL staff_users");
  testAssert(adminRow?.username === "admin", "Administrator username matches 'admin'");
  testAssert(
    typeof adminRow?.email === "string" && /^[^s@]+@[^s@]+$/.test(adminRow.email) &&
      (!process.env.ERP_ADMIN_EMAIL || adminRow.email === process.env.ERP_ADMIN_EMAIL.trim().toLowerCase()),
    "Administrator email is set (and matches ERP_ADMIN_EMAIL when configured)"
  );
  testAssert(adminRow?.role === "SUPER_ADMIN", "Administrator has role 'SUPER_ADMIN'");
  testAssert(Number(adminRow?.isActive) === 1, "Administrator is active (is_active = 1)");
  testAssert(
    typeof adminRow?.passwordHash === "string" && adminRow.passwordHash.startsWith("$2"),
    "Administrator password hash uses bcrypt format ($2)"
  );

  // ---------------------------------------------------------------------------
  // SUITE 4: Idempotent Seeding Protection
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 4] Idempotent Seeding Protection (No Accidental Overwrites)");

  const seedOutput = execSync("node -r ./tests/register_paths.js scripts/seed-local-admin.js", {
    cwd: ROOT,
    env: { ...process.env },
    encoding: "utf8",
  });

  testAssert(
    seedOutput.includes("already contains 1 user(s)") || seedOutput.includes("Existing accounts preserved intact"),
    "Re-running seed script safely skips without modifying existing accounts"
  );

  await closePg();

  // ---------------------------------------------------------------------------
  // SUITE 5: Primary SQLite & Protected Database Immutability Guard
  // ---------------------------------------------------------------------------
  console.log("\n[SUITE 5] Primary Database Immutability Check");

  testAssert(fs.existsSync(PRIMARY_DB), "Primary database data/erp.db exists");
  const stat = fs.statSync(PRIMARY_DB);
  testAssert(stat.size === EXPECTED_PRIMARY_DB_SIZE, `Primary DB size unchanged: ${stat.size} bytes (expected ${EXPECTED_PRIMARY_DB_SIZE})`);

  console.log("\n================================================================================");
  console.log(`TASK 01B.74 TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================");

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner threw an unhandled exception:", err);
  process.exit(1);
});
