import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { runMigrations } from "./helpers/sqliteMigrations";
import { getAsyncDb, closeDb } from "../apps/erp/src/server/database/db";
import {
  computeGstinChecksum,
  validateGstin,
  assertValidGstin,
  isValidGstin,
  GST_STATE_CODES,
  VALID_PAN_ENTITY_TYPES,
  GSTIN_VALIDATION_DISCLAIMER,
} from "../apps/erp/src/server/finance/gstinValidator";
import {
  createInvoice,
  issueInvoice,
  getInvoiceById,
} from "../apps/erp/src/server/finance/invoiceService";
import {
  generateTiffinInvoices,
} from "../apps/erp/src/server/tiffin/tiffinBillingService";
import {
  AuthenticatedUser,
} from "../apps/erp/src/types";

// Primary DB immutability guard
const primaryDbPath = path.resolve(process.cwd(), "data", "erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

// Isolated disposable test database
const TEST_GSTIN_DB_PATH = path.resolve(__dirname, "test_task64_gstin.db");

function cleanupTestDb() {
  closeDb();
  if (fs.existsSync(TEST_GSTIN_DB_PATH)) fs.unlinkSync(TEST_GSTIN_DB_PATH);
  const wal = `${TEST_GSTIN_DB_PATH}-wal`;
  const shm = `${TEST_GSTIN_DB_PATH}-shm`;
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
}
cleanupTestDb();

// Point process environment to isolated test DB
process.env.ERP_DATABASE_PATH = TEST_GSTIN_DB_PATH;

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
console.log("TASK 01B.64 REGRESSION TEST SUITE: GSTIN FORMAT VALIDATION & AUDIT");
console.log("================================================================================\n");

async function runTests() {
  // 1. Initialize schema in isolated DB
  console.log("--- 1. Initializing isolated database with schema migrations ---");
  const rawDb = new Database(TEST_GSTIN_DB_PATH);
  runMigrations(rawDb);
  const userVersion = rawDb.pragma("user_version", { simple: true }) as number;
  assert(userVersion >= 18, `Database user_version successfully advanced to V18+ (got ${userVersion})`);
  rawDb.close();

  const db = getAsyncDb();

  // Test Actors
  const accountantActor: AuthenticatedUser = {
    id: "usr_acct_64",
    username: "accountant_64",
    email: "acct64@ravinarayana.com",
    fullName: "Chief Accountant 64",
    role: "ACCOUNTANT",
  };

  const adminActor: AuthenticatedUser = {
    id: "usr_admin_64",
    username: "admin_64",
    email: "admin64@ravinarayana.com",
    fullName: "Super Admin 64",
    role: "SUPER_ADMIN",
  };

  const now = new Date().toISOString();
  for (const actor of [accountantActor, adminActor]) {
    await db.execute(`
      INSERT INTO staff_users (id, username, email, full_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'hash', ?, 1, ?, ?)
    `, [actor.id, actor.username, actor.email, actor.fullName, actor.role, now, now]);
  }

  // Seed Resident
  await db.execute(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES ('room_64_101', '101', 1, 'SINGLE', 1, 10000, 1, ?, ?)
  `, [now, now]);

  await db.execute(`
    INSERT INTO residents (id, full_name, phone, email, status, created_at, updated_at)
    VALUES ('res_64_01', 'Aditya Verma', '9876543201', 'aditya64@example.com', 'ACTIVE', ?, ?)
  `, [now, now]);

  await db.execute(`
    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES ('stay_64_01', 'res_64_01', 'room_64_101', '2026-10-01', 10000, 10000, 'ACTIVE', ?, ?)
  `, [now, now]);

  // Seed Tiffin Customer
  await db.execute(`
    INSERT INTO tiffin_customers (id, full_name, phone, delivery_address, status, created_by, created_at, updated_at)
    VALUES ('cust_64_01', 'Sunil Rao', '9876543299', 'Sector 15, Gurgaon', 'ACTIVE', ?, ?, ?)
  `, [accountantActor.id, now, now]);

  // ===========================================================================
  // SECTION 2: UNIT TESTS — STATUTORY GSTIN FORMAT & CHECKSUM RULES
  // ===========================================================================
  console.log("\n--- 2. Testing Statutory GSTIN Format & Checksum Calculations ---");

  // Synthetic valid GSTIN examples with mathematical Modulo-36 checksums
  const validExamples = [
    { gstin: "06ABCFE1234F1Z0", state: "Haryana (06)", stateCode: "06", panType: "F" },
    { gstin: "07AAAAA0000A1Z4", state: "Delhi (07)", stateCode: "07", panType: "A" },
    { gstin: "27AABCU9603R1ZN", state: "Maharashtra (27)", stateCode: "27", panType: "C" },
    { gstin: "29ABCTE1234T1Z6", state: "Karnataka (29)", stateCode: "29", panType: "T" },
    { gstin: "99AAAAA0000A1ZR", state: "Centre Jurisdiction (99)", stateCode: "99", panType: "A" },
  ];

  for (const ex of validExamples) {
    const res = validateGstin(ex.gstin);
    assert(res.isValid, `Valid synthetic GSTIN recognized for ${ex.state}: ${ex.gstin}`);
    assert(res.structureValid, `Structure marked valid for ${ex.gstin}`);
    assert(res.checksumValid, `Checksum verified for ${ex.gstin}`);
    assert(res.parsed?.stateCode === ex.stateCode, `Parsed state code matches ${ex.stateCode}`);
    assert(res.parsed?.panEntityType === ex.panType, `Parsed PAN entity type matches ${ex.panType}`);
  }

  // Modulo-36 Checksum Generator Verification
  assert(computeGstinChecksum("06ABCFE1234F1Z") === "0", "computeGstinChecksum produces '0' for Haryana base '06ABCFE1234F1Z'");
  assert(computeGstinChecksum("27AABCU9603R1Z") === "N", "computeGstinChecksum produces 'N' for Maharashtra base '27AABCU9603R1Z'");
  assert(computeGstinChecksum("29ABCTE1234T1Z") === "6", "computeGstinChecksum produces '6' for Karnataka base '29ABCTE1234T1Z'");

  // Checksum Mismatch Detection
  const badChecksumGstin = "06ABCFE1234F1Z9"; // Checksum is 0, but 9 provided
  const checksumRes = validateGstin(badChecksumGstin);
  assert(!checksumRes.isValid, "validateGstin rejects GSTIN with incorrect checksum digit");
  assert(checksumRes.structureValid, "Structure is marked valid despite checksum mismatch");
  assert(!checksumRes.checksumValid, "Checksum marked invalid");
  assert(checksumRes.expectedChecksum === "0" && checksumRes.actualChecksum === "9", "Validation result reports expected '0' vs actual '9'");

  // Length Failures
  const shortGstin = "06ABCFE1234F1Z"; // 14 chars
  const shortRes = validateGstin(shortGstin);
  assert(!shortRes.isValid && shortRes.error?.includes("exactly 15 characters"), "Rejects 14-character GSTIN with length error");

  const longGstin = "06ABCFE1234F1Z00"; // 16 chars
  const longRes = validateGstin(longGstin);
  assert(!longRes.isValid && longRes.error?.includes("exactly 15 characters"), "Rejects 16-character GSTIN with length error");

  // Character Type Failures
  const specialCharGstin = "06ABCFE1234F1@0";
  const specialRes = validateGstin(specialCharGstin);
  assert(!specialRes.isValid && specialRes.error?.includes("invalid characters"), "Rejects GSTIN containing '@' symbol");

  const spaceGstin = "06ABCFE 1234F1Z";
  const spaceRes = validateGstin(spaceGstin);
  assert(!spaceRes.isValid, "Rejects GSTIN containing spaces");

  // State Code Segment Failures
  const zeroStateGstin = "00ABCFE1234F1Z0";
  const zeroStateRes = validateGstin(zeroStateGstin);
  assert(!zeroStateRes.isValid && zeroStateRes.error?.includes("Invalid state code '00'"), "Rejects state code '00'");

  const highStateGstin = "39ABCFE1234F1Z0";
  const highStateRes = validateGstin(highStateGstin);
  assert(!highStateRes.isValid && highStateRes.error?.includes("Invalid state code '39'"), "Rejects state code '39' (out of range)");

  const invalidStateGstin = "98ABCFE1234F1Z0";
  const invalidStateRes = validateGstin(invalidStateGstin);
  assert(!invalidStateRes.isValid && invalidStateRes.error?.includes("Invalid state code '98'"), "Rejects state code '98'");

  // State Code Consistency with Expected Billing State
  const stateMismatchRes = validateGstin("07AAAAA0000A1Z4", { expectedStateCode: "06" });
  assert(!stateMismatchRes.isValid && stateMismatchRes.error?.includes("does not match expected state code '06'"), "Rejects Delhi GSTIN when Haryana (06) expected");

  // PAN Segment Failures
  const badPanNumbers = "0612CFE1234F1Z0"; // digits in first 3 chars
  const badPanRes1 = validateGstin(badPanNumbers);
  assert(!badPanRes1.isValid && badPanRes1.error?.includes("Invalid PAN structure"), "Rejects PAN with numbers in first 3 positions");

  const badPanEntityType = "06ABCZE1234F1Z0"; // 'Z' is not valid entity type in PAN (char 4)
  const badPanRes2 = validateGstin(badPanEntityType);
  assert(!badPanRes2.isValid && badPanRes2.error?.includes("Invalid PAN entity type"), "Rejects PAN with invalid 4th character ('Z')");

  const badPanDigits = "06ABCFE12A4F1Z0"; // letter in 4-digit segment
  const badPanRes3 = validateGstin(badPanDigits);
  assert(!badPanRes3.isValid && badPanRes3.error?.includes("Invalid PAN structure"), "Rejects PAN with letter inside digits segment");

  // Entity Registration Code Failures (13th char)
  const zeroEntityGstin = "06ABCFE1234F0Z0"; // '0' is not valid entity code
  const zeroEntityRes = validateGstin(zeroEntityGstin);
  assert(!zeroEntityRes.isValid && zeroEntityRes.error?.includes("Invalid entity code '0'"), "Rejects 13th character '0'");

  // Default Character Failures (14th char)
  const badDefaultCharGstin = "06ABCFE1234F1A0"; // 'A' instead of 'Z'
  const badDefaultRes = validateGstin(badDefaultCharGstin);
  assert(!badDefaultRes.isValid && badDefaultRes.error?.includes("Invalid default character 'A'"), "Rejects 14th character 'A' (must be 'Z')");

  // Disclaimer Requirement
  assert(
    validateGstin("06ABCFE1234F1Z0").disclaimer === GSTIN_VALIDATION_DISCLAIMER,
    "Validator returns statutory disclaimer that structural checks do not verify portal registration status"
  );

  // ===========================================================================
  // SECTION 3: INVOICE SERVICE SERVER-SIDE BOUNDARY INTEGRATION
  // ===========================================================================
  console.log("\n--- 3. Testing Invoice Service Server-Side GSTIN Validation ---");

  // Case 1: GST Tax Invoice with UNSET ERP_COMPANY_GSTIN
  delete process.env.ERP_COMPANY_GSTIN;
  let unsetGstinBlocked = false;
  try {
    await createInvoice(accountantActor, {
      invoiceType: "GST_TAX_INVOICE",
      residentId: "res_64_01",
      issueDate: "2026-10-25",
      dueDate: "2026-11-05",
      billingPeriod: "October 2026",
      items: [{ description: "Monthly Stay Room 101", quantity: 1, unitPrice: 10000, taxRate: 12 }],
    }, undefined, db);
  } catch (err: any) {
    unsetGstinBlocked = err.message.includes("registered company GSTIN");
  }
  assert(unsetGstinBlocked, "createInvoice: GST_TAX_INVOICE strictly blocked when ERP_COMPANY_GSTIN is unconfigured");

  // Case 2: GST Tax Invoice with MALFORMED ERP_COMPANY_GSTIN
  process.env.ERP_COMPANY_GSTIN = "MALFORMED_GSTIN";
  let malformedGstinBlocked = false;
  try {
    await createInvoice(accountantActor, {
      invoiceType: "GST_TAX_INVOICE",
      residentId: "res_64_01",
      issueDate: "2026-10-25",
      dueDate: "2026-11-05",
      billingPeriod: "October 2026",
      items: [{ description: "Monthly Stay Room 101", quantity: 1, unitPrice: 10000, taxRate: 12 }],
    }, undefined, db);
  } catch (err: any) {
    malformedGstinBlocked = err.message.includes("Company GSTIN (ERP_COMPANY_GSTIN)");
  }
  assert(malformedGstinBlocked, "createInvoice: GST_TAX_INVOICE blocked when ERP_COMPANY_GSTIN is malformed");

  // Case 3: GST Tax Invoice with CHECKSUM-INVALID ERP_COMPANY_GSTIN
  process.env.ERP_COMPANY_GSTIN = "06ABCFE1234F1Z9"; // Checksum is 0, provided 9
  let badChecksumBlocked = false;
  try {
    await createInvoice(accountantActor, {
      invoiceType: "GST_TAX_INVOICE",
      residentId: "res_64_01",
      issueDate: "2026-10-25",
      dueDate: "2026-11-05",
      billingPeriod: "October 2026",
      items: [{ description: "Monthly Stay Room 101", quantity: 1, unitPrice: 10000, taxRate: 12 }],
    }, undefined, db);
  } catch (err: any) {
    badChecksumBlocked = err.message.includes("checksum verification failed");
  }
  assert(badChecksumBlocked, "createInvoice: GST_TAX_INVOICE blocked when ERP_COMPANY_GSTIN fails checksum check");

  // Case 4: GST Tax Invoice with STATE MISMATCH in ERP_COMPANY_GSTIN
  process.env.ERP_COMPANY_GSTIN = "07AAAAA0000A1Z4"; // Delhi GSTIN when Haryana (06) is company state
  let stateMismatchBlocked = false;
  try {
    await createInvoice(accountantActor, {
      invoiceType: "GST_TAX_INVOICE",
      residentId: "res_64_01",
      issueDate: "2026-10-25",
      dueDate: "2026-11-05",
      billingPeriod: "October 2026",
      items: [{ description: "Monthly Stay Room 101", quantity: 1, unitPrice: 10000, taxRate: 12 }],
    }, undefined, db);
  } catch (err: any) {
    stateMismatchBlocked = err.message.includes("does not match expected state code '06'");
  }
  assert(stateMismatchBlocked, "createInvoice: GST_TAX_INVOICE blocked when ERP_COMPANY_GSTIN state code mismatches company state");

  // Case 5: GST Tax Invoice with VALID SYNTHETIC ERP_COMPANY_GSTIN
  process.env.ERP_COMPANY_GSTIN = "06ABCFE1234F1Z0"; // Valid synthetic Haryana GSTIN
  const validGstInvoice = await createInvoice(accountantActor, {
    invoiceType: "GST_TAX_INVOICE",
    residentId: "res_64_01",
    issueDate: "2026-10-25",
    dueDate: "2026-11-05",
    billingPeriod: "October 2026",
    autoIssue: true,
    recipientStateCode: "06",
    items: [{ description: "Monthly Stay Room 101", quantity: 1, unitPrice: 10000, taxRate: 12 }],
  }, undefined, db);

  assert(validGstInvoice.status === "ISSUED", "createInvoice: GST_TAX_INVOICE created and issued successfully with valid GSTIN");
  assert(validGstInvoice.companyGstin === "06ABCFE1234F1Z0", "Invoice stores validated company GSTIN snapshot");
  assert(validGstInvoice.totalTax === 1200, "GST tax calculated accurately (12% = ₹1,200)");
  assert(validGstInvoice.cgstAmount === 600 && validGstInvoice.sgstAmount === 600, "Intrastate CGST and SGST split equally (₹600 each)");

  // Case 6: Regular Bill with NO ERP_COMPANY_GSTIN
  delete process.env.ERP_COMPANY_GSTIN;
  const regularBill = await createInvoice(accountantActor, {
    invoiceType: "REGULAR_BILL",
    residentId: "res_64_01",
    issueDate: "2026-10-26",
    dueDate: "2026-11-05",
    billingPeriod: "October 2026",
    autoIssue: true,
    items: [{ description: "Room Rent Regular Bill", quantity: 1, unitPrice: 8000 }],
  }, undefined, db);

  assert(regularBill.status === "ISSUED", "REGULAR_BILL creates and issues successfully with zero GSTIN configured");
  assert(regularBill.totalTax === 0, "Regular bill enforces 0% tax invariant");
  assert(regularBill.companyGstin === null, "Regular bill company GSTIN is null");

  // Case 7: Recipient GSTIN Validation (B2B Commercial Invoicing)
  process.env.ERP_COMPANY_GSTIN = "06ABCFE1234F1Z0";

  // Invalid recipient GSTIN rejected
  let invalidRecipientGstinBlocked = false;
  try {
    await createInvoice(accountantActor, {
      invoiceType: "GST_TAX_INVOICE",
      customerId: "cust_64_01",
      invoiceCategory: "TIFFIN",
      issueDate: "2026-10-27",
      dueDate: "2026-11-05",
      billingPeriod: "October 2026",
      recipientGstin: "INVALID_RECIP_GSTIN",
      items: [{ description: "Corporate Lunch Supply", quantity: 10, unitPrice: 100, taxRate: 5 }],
    }, undefined, db);
  } catch (err: any) {
    invalidRecipientGstinBlocked = err.message.includes("Recipient GSTIN");
  }
  assert(invalidRecipientGstinBlocked, "createInvoice: Rejects invoice creation with malformed recipient GSTIN");

  // Valid recipient GSTIN accepted
  const validB2bInvoice = await createInvoice(accountantActor, {
    invoiceType: "GST_TAX_INVOICE",
    customerId: "cust_64_01",
    invoiceCategory: "TIFFIN",
    issueDate: "2026-10-27",
    dueDate: "2026-11-05",
    billingPeriod: "October 2026",
    recipientGstin: "07AAAAA0000A1Z4", // Valid Delhi recipient GSTIN
    autoIssue: true,
    items: [{ description: "Corporate Lunch Supply", quantity: 10, unitPrice: 100, taxRate: 5 }],
  }, undefined, db);

  assert(validB2bInvoice.recipientGstin === "07AAAAA0000A1Z4", "createInvoice: Stores validated recipient GSTIN snapshot");
  assert(validB2bInvoice.recipientStateCode === "07", "Recipient state code automatically aligned with recipient GSTIN state prefix (07)");
  assert(validB2bInvoice.igstAmount === 50 && validB2bInvoice.cgstAmount === 0, "Interstate IGST applied (Haryana company to Delhi recipient)");

  // Clean up environment
  delete process.env.ERP_COMPANY_GSTIN;

  // ===========================================================================
  // SECTION 4: PRIMARY DB IMMUTABILITY GUARD
  // ===========================================================================
  console.log("\n--- 4. Primary Database Immutability Verification ---");
  const primaryStatsAfter = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;
  assert(
    // Untouched = absent before and after (isolated sandbox), or identical size and mtime.
    (primaryStatsBefore === null && primaryStatsAfter === null) ||
      (primaryStatsBefore !== null &&
        primaryStatsAfter !== null &&
        primaryStatsBefore.size === primaryStatsAfter.size &&
        primaryStatsBefore.mtimeMs === primaryStatsAfter.mtimeMs),
    primaryStatsAfter
      ? `Primary database data/erp.db is 100% untouched (size: ${primaryStatsAfter.size} bytes, mtime: ${primaryStatsAfter.mtime.toISOString()})`
      : "Primary database data/erp.db was not created or modified (absent before and after)"
  );

  console.log("\n================================================================================");
  console.log(`TASK 01B.64 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("================================================================================\n");

  cleanupTestDb();

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("FATAL TEST SUITE ERROR:", err);
  cleanupTestDb();
  process.exit(1);
});
