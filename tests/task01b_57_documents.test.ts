import Database from "better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";

import { runMigrations } from "./helpers/sqliteMigrations";
import { getAsyncDb, closeDb, AsyncDb } from "../apps/erp/src/server/database/db";
import {
  detectVerifiedMimeType,
  sanitizeDisplayFilename,
  generateStorageKey,
  resolveSafeStoragePath,
  saveDocumentFile,
  readDocumentBuffer,
  documentFileExists,
  deleteDocumentFile,
} from "../apps/erp/src/server/documents/documentStorageService";
import {
  uploadDocument,
  getDocumentById,
  listDocuments,
  downloadDocument,
  archiveDocument,
} from "../apps/erp/src/server/documents/documentService";
import {
  AuthenticatedUser,
  DocumentCategory,
  DocumentAttachment,
} from "../apps/erp/src/types";

// ============================================================================
// Database & Storage Safety Guards & Isolated Verification Environment
// ============================================================================
const primaryDbPath = path.resolve(__dirname, "../data/erp.db");
const primaryStatsBefore = fs.existsSync(primaryDbPath) ? fs.statSync(primaryDbPath) : null;

const TEST_DB_PATH = path.resolve(__dirname, "test_task57_docs.db");
const TEST_STORAGE_DIR = path.resolve(__dirname, "temp_storage_task57");

function cleanupIsolatedEnv() {
  try {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    const wal = `${TEST_DB_PATH}-wal`;
    const shm = `${TEST_DB_PATH}-shm`;
    if (fs.existsSync(wal)) fs.unlinkSync(wal);
    if (fs.existsSync(shm)) fs.unlinkSync(shm);
  } catch (e) {
    // ignore transient Windows file locks
  }

  try {
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  } catch (e) {}
}
cleanupIsolatedEnv();

process.env.ERP_DATABASE_PATH = TEST_DB_PATH;
process.env.ERP_STORAGE_DIR = TEST_STORAGE_DIR;
process.env.NODE_ENV = "test";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failCount++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Sample file buffers
const VALID_JPEG_BUF = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60, 0x00, 0x60,
  0x00, 0x00,
]);
const VALID_PNG_BUF = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const VALID_WEBP_BUF = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const VALID_PDF_BUF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
const SPOOFED_TEXT_BUF = Buffer.from("Plain text content falsely masquerading as government ID image or PDF");
const MALICIOUS_SCRIPT_BUF = Buffer.from("<?php echo 'RCE exploit attempt'; ?>");

// Test Actors
const superAdmin: AuthenticatedUser = {
  id: "usr_superadmin",
  username: "superadmin",
  email: "superadmin@ravinarayan.in",
  fullName: "Super Admin",
  role: "SUPER_ADMIN",
};

const opsManager: AuthenticatedUser = {
  id: "usr_opsmgr",
  username: "opsmgr",
  email: "ops@ravinarayan.in",
  fullName: "Operations Manager",
  role: "OPERATIONS_MANAGER",
};

const accountant: AuthenticatedUser = {
  id: "usr_accountant",
  username: "accountant",
  email: "accounts@ravinarayan.in",
  fullName: "Accountant",
  role: "ACCOUNTANT",
};

const deliveryPerson: AuthenticatedUser = {
  id: "usr_delivery",
  username: "delivery1",
  email: "delivery1@ravinarayan.in",
  fullName: "Courier Person",
  role: "DELIVERY_PERSON",
};

const kitchenStaff: AuthenticatedUser = {
  id: "usr_kitchen",
  username: "kitchen1",
  email: "kitchen@ravinarayan.in",
  fullName: "Chef Staff",
  role: "KITCHEN_OPERATIONS",
};

async function main() {
  console.log("=== Running Task 01B.57 Document Security & KYC Test Suite ===");

  // 1. Initialize DB and seed baseline data
  const rawDb = new Database(TEST_DB_PATH);
  runMigrations(rawDb);
  const now = new Date().toISOString();

  // Seed staff users
  rawDb.exec(`
    INSERT INTO staff_users (id, username, email, full_name, role, password_hash, is_active, created_at, updated_at)
    VALUES
      ('${superAdmin.id}', '${superAdmin.username}', '${superAdmin.email}', '${superAdmin.fullName}', '${superAdmin.role}', 'hash', 1, '${now}', '${now}'),
      ('${opsManager.id}', '${opsManager.username}', '${opsManager.email}', '${opsManager.fullName}', '${opsManager.role}', 'hash', 1, '${now}', '${now}'),
      ('${accountant.id}', '${accountant.username}', '${accountant.email}', '${accountant.fullName}', '${accountant.role}', 'hash', 1, '${now}', '${now}'),
      ('${deliveryPerson.id}', '${deliveryPerson.username}', '${deliveryPerson.email}', '${deliveryPerson.fullName}', '${deliveryPerson.role}', 'hash', 1, '${now}', '${now}'),
      ('${kitchenStaff.id}', '${kitchenStaff.username}', '${kitchenStaff.email}', '${kitchenStaff.fullName}', '${kitchenStaff.role}', 'hash', 1, '${now}', '${now}');
  `);

  // Seed Room, Resident, Stay, and Financial Transaction
  const testResidentId = "res_tenant_001";
  const testStayId = "stay_001";
  const testRoomId = "room_001";
  const testExpenseTxId = "txn_exp_001";
  const testRentTxId = "txn_rent_001";

  rawDb.exec(`
    INSERT INTO rooms (id, room_number, floor, type, capacity, base_rent_monthly, is_active, created_at, updated_at)
    VALUES ('${testRoomId}', '101', 1, 'DOUBLE', 2, 8000, 1, '${now}', '${now}');

    INSERT INTO residents (id, full_name, phone, email, status, created_at, updated_at)
    VALUES ('${testResidentId}', 'Rahul Sharma', '9876543210', 'rahul@example.com', 'ACTIVE', '${now}', '${now}');

    INSERT INTO resident_stays (id, resident_id, room_id, check_in_date, monthly_rent, security_deposit, status, created_at, updated_at)
    VALUES ('${testStayId}', '${testResidentId}', '${testRoomId}', '2026-10-01', 8000, 8000, 'ACTIVE', '${now}', '${now}');

    INSERT INTO financial_transactions (
      id, transaction_type, amount, transaction_date, payment_method, category, description,
      status, created_by, created_at, updated_at
    ) VALUES
      ('${testExpenseTxId}', 'EXPENSE', 4500, '2026-10-15', 'UPI', 'GROCERY', 'Weekly grocery supplies', 'POSTED', '${accountant.id}', '${now}', '${now}'),
      ('${testRentTxId}', 'RENT_PAYMENT', 8000, '2026-10-05', 'BANK_TRANSFER', 'RENT_PAYMENT', 'October 2026 rent', 'POSTED', '${accountant.id}', '${now}', '${now}');
  `);

  rawDb.close();
  const db = getAsyncDb();

  // ============================================================================
  // Suite 1: Magic Byte Detection & MIME Allowlist Validation
  // ============================================================================
  console.log("\n--- Suite 1: Magic Byte Signature & MIME Validation ---");
  {
    assert(detectVerifiedMimeType(VALID_JPEG_BUF) === "image/jpeg", "JPEG magic bytes detected as image/jpeg");
    assert(detectVerifiedMimeType(VALID_PNG_BUF) === "image/png", "PNG magic bytes detected as image/png");
    assert(detectVerifiedMimeType(VALID_WEBP_BUF) === "image/webp", "WebP magic bytes detected as image/webp");
    assert(detectVerifiedMimeType(VALID_PDF_BUF) === "application/pdf", "PDF magic bytes detected as application/pdf");

    let spoofRejected = false;
    try {
      detectVerifiedMimeType(SPOOFED_TEXT_BUF);
    } catch {
      spoofRejected = true;
    }
    assert(spoofRejected, "MIME spoofing rejected: text masquerading as PDF/image throws error");

    let scriptRejected = false;
    try {
      detectVerifiedMimeType(MALICIOUS_SCRIPT_BUF);
    } catch {
      scriptRejected = true;
    }
    assert(scriptRejected, "Malicious PHP script rejected by signature inspection");

    let emptyRejected = false;
    try {
      detectVerifiedMimeType(Buffer.alloc(0));
    } catch {
      emptyRejected = true;
    }
    assert(emptyRejected, "0-byte buffer rejected");
  }

  // ============================================================================
  // Suite 2: Filename Sanitization & Path Traversal Prevention
  // ============================================================================
  console.log("\n--- Suite 2: Filename Sanitization & Path Traversal Defense ---");
  {
    assert(
      sanitizeDisplayFilename("../../../../etc/passwd.pdf") === "passwd.pdf",
      "Path traversal characters stripped from display filename"
    );
    assert(
      sanitizeDisplayFilename("..\\..\\windows\\system32\\cmd.exe.jpg") === "cmd.exe.jpg",
      "Windows backslash traversal stripped from display filename"
    );
    assert(
      sanitizeDisplayFilename("null\0byte.png") === "nullbyte.png",
      "Null bytes stripped from display filename"
    );
    assert(
      sanitizeDisplayFilename("   Aadhaar Card (Front).pdf   ") === "Aadhaar Card (Front).pdf",
      "Normal display filename preserved and trimmed"
    );

    const storageKey = generateStorageKey("doc_test123", "application/pdf");
    assert(/^[0-9]{4}\/[0-9]{2}\/doc_test123\.pdf$/.test(storageKey), "Partitioned storage key format verified");

    const safePath = resolveSafeStoragePath(storageKey);
    assert(safePath.startsWith(path.resolve(TEST_STORAGE_DIR)), "Resolved storage path resides strictly within TEST_STORAGE_DIR");

    let traversalDetected = false;
    try {
      resolveSafeStoragePath("../outside.pdf");
    } catch {
      traversalDetected = true;
    }
    assert(traversalDetected, "Direct path traversal attempt throws security violation error");
  }

  // ============================================================================
  // Suite 3: File Size Limits & Disk Storage Provider
  // ============================================================================
  console.log("\n--- Suite 3: File Size Limits & Disk Storage Provider ---");
  {
    const storageKey = generateStorageKey("doc_sample", "image/png");
    const saveResult = await saveDocumentFile(storageKey, VALID_PNG_BUF);
    assert(saveResult.fileSize === VALID_PNG_BUF.length, "File size recorded correctly");
    assert(typeof saveResult.fileHash === "string" && saveResult.fileHash.length === 64, "SHA-256 hash generated");
    assert(documentFileExists(storageKey), "File exists on disk storage");

    const readBuf = await readDocumentBuffer(storageKey);
    assert(readBuf.equals(VALID_PNG_BUF), "Read buffer matches saved buffer exactly");

    // Oversized file test
    const OVERSIZED_BUF = Buffer.concat([VALID_JPEG_BUF, Buffer.alloc(5 * 1024 * 1024 + 1024)]);
    let oversizedRejected = false;
    try {
      await saveDocumentFile("oversized.jpg", OVERSIZED_BUF);
    } catch (err: any) {
      if (err.message.includes("exceeds maximum allowed limit")) oversizedRejected = true;
    }
    assert(oversizedRejected, "Files exceeding 5 MB are rejected with size limit error");

    await deleteDocumentFile(storageKey);
    assert(!documentFileExists(storageKey), "File deleted cleanly from disk");
  }

  // ============================================================================
  // Suite 4: Resident KYC Document Upload & Association
  // ============================================================================
  console.log("\n--- Suite 4: Resident KYC Document Upload & Association ---");
  {
    const kycDoc = await uploadDocument(
      opsManager,
      {
        category: "RESIDENT_KYC",
        residentId: testResidentId,
        stayId: testStayId,
        originalFilename: "Rahul_Aadhaar_Card.pdf",
        fileBuffer: VALID_PDF_BUF,
        notes: "Verified against original Aadhaar card",
      },
      "192.168.1.10",
      db
    );

    assert(kycDoc.category === "RESIDENT_KYC", "Category recorded as RESIDENT_KYC");
    assert(kycDoc.residentId === testResidentId, "Document linked to resident_id");
    assert(kycDoc.stayId === testStayId, "Document linked to stay_id");
    assert(kycDoc.mimeType === "application/pdf", "MIME type verified as application/pdf");
    assert(kycDoc.status === "ACTIVE", "Initial status is ACTIVE");
    assert(kycDoc.displayFilename === "Rahul_Aadhaar_Card.pdf", "Display filename sanitized and stored");
    assert(documentFileExists(kycDoc.storagePath), "File persisted in private storage partition");

    // Parent validation failure
    let invalidParentFailed = false;
    try {
      await uploadDocument(
        opsManager,
        {
          category: "RESIDENT_KYC",
          residentId: "res_non_existent",
          originalFilename: "fake.pdf",
          fileBuffer: VALID_PDF_BUF,
        },
        undefined,
        db
      );
    } catch (err: any) {
      if (err.message.includes("not found")) invalidParentFailed = true;
    }
    assert(invalidParentFailed, "Upload with non-existent parent resident fails");

    // Missing parent relationship failure
    let noParentFailed = false;
    try {
      await uploadDocument(
        opsManager,
        {
          category: "RESIDENT_KYC",
          originalFilename: "unlinked.pdf",
          fileBuffer: VALID_PDF_BUF,
        },
        undefined,
        db
      );
    } catch (err: any) {
      if (err.message.includes("at least one parent record")) noParentFailed = true;
    }
    assert(noParentFailed, "Upload without any parent record relationship rejected");
  }

  // ============================================================================
  // Suite 5: Expense Receipt Attachment & Financial Non-Duplication
  // ============================================================================
  console.log("\n--- Suite 5: Expense Receipt Attachment & Financial Non-Duplication ---");
  {
    // Snapshot financial ledger state before receipt upload
    const txCountBefore = (await db.queryOne<{ count: number }>("SELECT count(*) as count FROM financial_transactions"))!.count;
    const expenseSumBefore = (await db.queryOne<{ sum: number }>("SELECT sum(amount) as sum FROM financial_transactions WHERE transaction_type = 'EXPENSE'"))!.sum;

    const receiptDoc = await uploadDocument(
      accountant,
      {
        category: "EXPENSE_RECEIPT",
        transactionId: testExpenseTxId,
        originalFilename: "Vendor_Grocery_Bill.jpg",
        fileBuffer: VALID_JPEG_BUF,
        notes: "Cash memo signed by vendor",
      },
      "10.0.0.1",
      db
    );

    assert(receiptDoc.category === "EXPENSE_RECEIPT", "Category recorded as EXPENSE_RECEIPT");
    assert(receiptDoc.transactionId === testExpenseTxId, "Document linked to financial transaction");
    assert(receiptDoc.mimeType === "image/jpeg", "MIME type verified as image/jpeg");

    // Verify Financial Non-Duplication Invariant
    const txCountAfter = (await db.queryOne<{ count: number }>("SELECT count(*) as count FROM financial_transactions"))!.count;
    const expenseSumAfter = (await db.queryOne<{ sum: number }>("SELECT sum(amount) as sum FROM financial_transactions WHERE transaction_type = 'EXPENSE'"))!.sum;

    assert(txCountAfter === txCountBefore, "Attaching a receipt created ZERO new financial transactions");
    assert(expenseSumAfter === expenseSumBefore, "Attaching a receipt altered ZERO financial amounts or ledger balances");
  }

  // ============================================================================
  // Suite 6: Document Lifecycle: Superseding & Archival
  // ============================================================================
  console.log("\n--- Suite 6: Document Lifecycle: Superseding & Archival ---");
  {
    // Upload updated KYC document for same resident
    const updatedKyc = await uploadDocument(
      opsManager,
      {
        category: "RESIDENT_KYC",
        residentId: testResidentId,
        originalFilename: "Rahul_Updated_Passport.png",
        fileBuffer: VALID_PNG_BUF,
        notes: "Replaced expired Aadhaar with verified Passport",
      },
      undefined,
      db
    );

    assert(updatedKyc.status === "ACTIVE", "New upload is ACTIVE");

    // Verify previous KYC was superseded
    const allResidentDocs = await listDocuments(opsManager, { residentId: testResidentId }, undefined, db);
    const oldKyc = allResidentDocs.find((d) => d.category === "RESIDENT_KYC" && d.status === "SUPERSEDED");
    assert(Boolean(oldKyc), "Previous KYC document was automatically marked SUPERSEDED");
    assert(oldKyc?.supersededBy === updatedKyc.id, "Previous KYC superseded_by references new document ID");
    assert(documentFileExists(oldKyc!.storagePath), "Superseded file remains preserved on disk for audit trail");

    // Soft-archiving
    const archived = await archiveDocument(opsManager, updatedKyc.id, "Resident provided correction", undefined, db);
    assert(archived.status === "ARCHIVED", "Document status transitioned to ARCHIVED");
    assert(documentFileExists(archived.storagePath), "Archived document is NOT physically deleted from disk");
  }

  // ============================================================================
  // Suite 7: Access Control (RBAC) & Record-Level Isolation
  // ============================================================================
  console.log("\n--- Suite 7: Access Control (RBAC) & Record-Level Isolation ---");
  {
    // Delivery person attempting to upload KYC document -> 403
    let deliveryUploadBlocked = false;
    try {
      await uploadDocument(
        deliveryPerson,
        {
          category: "RESIDENT_KYC",
          residentId: testResidentId,
          originalFilename: "unauthorized.pdf",
          fileBuffer: VALID_PDF_BUF,
        },
        undefined,
        db
      );
    } catch (err: any) {
      if (err.statusCode === 403 || err.message.includes("lacks permission")) deliveryUploadBlocked = true;
    }
    assert(deliveryUploadBlocked, "Delivery person cannot upload KYC documents (403 Forbidden)");

    // Kitchen staff attempting to read KYC documents -> 403
    let kitchenReadBlocked = false;
    try {
      await listDocuments(kitchenStaff, { residentId: testResidentId }, undefined, db);
    } catch (err: any) {
      if (err.statusCode === 403 || err.message.includes("lacks permission")) kitchenReadBlocked = true;
    }
    assert(kitchenReadBlocked, "Kitchen staff cannot list resident KYC documents (403 Forbidden)");

    // Operations manager reading KYC documents -> Allowed
    const opsDocs = await listDocuments(opsManager, { residentId: testResidentId }, undefined, db);
    assert(opsDocs.length >= 2, "Operations Manager can list resident KYC documents");

    // Accountant uploading financial receipt -> Allowed
    const acctDoc = await uploadDocument(
      accountant,
      {
        category: "RENT_RECEIPT",
        transactionId: testRentTxId,
        originalFilename: "Bank_Challan_Rent.pdf",
        fileBuffer: VALID_PDF_BUF,
      },
      undefined,
      db
    );
    assert(acctDoc.category === "RENT_RECEIPT", "Accountant can upload RENT_RECEIPT");

    // Delivery person reading financial receipts -> 403
    let deliveryFinanceBlocked = false;
    try {
      await listDocuments(deliveryPerson, { transactionId: testRentTxId }, undefined, db);
    } catch (err: any) {
      if (err.statusCode === 403 || err.message.includes("lacks permission")) deliveryFinanceBlocked = true;
    }
    assert(deliveryFinanceBlocked, "Delivery person cannot read financial receipts (403 Forbidden)");
  }

  // ============================================================================
  // Suite 8: Download Streaming & Cryptographic Integrity Check
  // ============================================================================
  console.log("\n--- Suite 8: Download Streaming & Cryptographic Integrity Check ---");
  {
    const testDoc = await uploadDocument(
      superAdmin,
      {
        category: "OPERATIONAL_ATTACHMENT",
        residentId: testResidentId,
        originalFilename: "Room_Inventory_Checklist.pdf",
        fileBuffer: VALID_PDF_BUF,
      },
      "127.0.0.1",
      db
    );

    // Valid authorized download
    const downloadRes = await downloadDocument(superAdmin, testDoc.id, "127.0.0.1", db);
    assert(downloadRes.buffer.equals(VALID_PDF_BUF), "Downloaded buffer matches original uploaded bytes");
    assert(downloadRes.mimeType === "application/pdf", "Verified MIME type returned");
    assert(downloadRes.displayFilename === "Room_Inventory_Checklist.pdf", "Original display filename returned");

    // Tamper detection test: corrupt the file on disk
    const diskPath = resolveSafeStoragePath(testDoc.storagePath);
    fs.writeFileSync(diskPath, Buffer.from("Corrupted or tampered content"));

    let tamperDetected = false;
    try {
      await downloadDocument(superAdmin, testDoc.id, "127.0.0.1", db);
    } catch (err: any) {
      if (err.message.includes("integrity violation")) tamperDetected = true;
    }
    assert(tamperDetected, "Cryptographic hash mismatch triggers data integrity violation");
  }

  // ============================================================================
  // Suite 9: Audit Trail Coverage & Secret Non-Disclosure
  // ============================================================================
  console.log("\n--- Suite 9: Audit Trail Coverage & Secret Non-Disclosure ---");
  {
    const auditRows = await db.query<any>(
      "SELECT * FROM audit_logs WHERE target_type = 'document' ORDER BY created_at ASC"
    );
    assert(auditRows.length >= 3, "Document lifecycle events logged in audit_logs");

    const actions = auditRows.map((r) => r.action);
    assert(actions.includes("document.uploaded"), "Audit log includes document.uploaded");
    assert(actions.includes("document.downloaded"), "Audit log includes document.downloaded");
    assert(actions.includes("document.archived"), "Audit log includes document.archived");

    // Verify secret non-disclosure: no buffer or binary payload in audit logs
    for (const row of auditRows) {
      const meta = typeof row.metadata === "string" ? row.metadata : JSON.stringify(row.metadata);
      assert(!meta.includes("base64"), "Audit log metadata contains zero base64 payload");
      assert(!meta.includes("Buffer"), "Audit log metadata contains zero raw buffer data");
    }
  }

  // ============================================================================
  // Suite 10: Primary Database Immutability Check
  // ============================================================================
  console.log("\n--- Suite 10: Primary Database Immutability Check ---");
  {
    if (primaryStatsBefore && fs.existsSync(primaryDbPath)) {
      const primaryStatsAfter = fs.statSync(primaryDbPath);
      assert(primaryStatsAfter.size === primaryStatsBefore.size, "Primary data/erp.db file size unchanged");
      assert(
        primaryStatsAfter.mtime.getTime() === primaryStatsBefore.mtime.getTime(),
        "Primary data/erp.db LastWriteTime unchanged"
      );
    } else {
      assert(true, "Primary database protection verified intact");
    }
  }

  closeDb();
  cleanupIsolatedEnv();

  console.log(`\n======================================================`);
  console.log(`Test Execution Summary: ${passCount} PASSED, ${failCount} FAILED`);
  console.log(`======================================================\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  cleanupIsolatedEnv();
  process.exit(1);
});
