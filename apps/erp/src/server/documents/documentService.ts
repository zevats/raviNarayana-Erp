import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { recordAuditEventAsync } from "../audit/audit";
import {
  AuthenticatedUser,
  DocumentAttachment,
  DocumentCategory,
  DocumentStatus,
  UploadDocumentInput,
  DocumentListFilter,
} from "@/types";
import {
  detectVerifiedMimeType,
  sanitizeDisplayFilename,
  generateStorageKey,
  saveDocumentFile,
  readDocumentBuffer,
  deleteDocumentFile,
} from "./documentStorageService";

function mapRowToDocument(row: any): DocumentAttachment {
  return {
    id: row.id,
    category: row.category as DocumentCategory,
    residentId: row.residentId ?? row.resident_id ?? null,
    stayId: row.stayId ?? row.stay_id ?? null,
    transactionId: row.transactionId ?? row.transaction_id ?? null,
    invoiceId: row.invoiceId ?? row.invoice_id ?? null,
    settlementId: row.settlementId ?? row.settlement_id ?? null,
    displayFilename: row.displayFilename ?? row.display_filename,
    mimeType: row.mimeType ?? row.mime_type,
    fileSize: Number(row.fileSize ?? row.file_size),
    fileHash: row.fileHash ?? row.file_hash,
    storagePath: row.storagePath ?? row.storage_path,
    status: (row.status ?? "ACTIVE") as DocumentStatus,
    supersededBy: row.supersededBy ?? row.superseded_by ?? null,
    notes: row.notes ?? null,
    uploadedBy: row.uploadedBy ?? row.uploaded_by,
    uploadedByName: row.uploadedByName ?? row.uploaded_by_name,
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
  };
}

/**
 * Checks whether the category belongs to the resident KYC domain.
 */
function isResidentCategory(category: DocumentCategory): boolean {
  return (
    category === "RESIDENT_KYC" ||
    category === "RESIDENT_ADDRESS_PROOF" ||
    category === "OPERATIONAL_ATTACHMENT"
  );
}

/**
 * Enforces category-specific authorization rules.
 */
// Receipts for entries a Manager may record (finance.record). Settlement receipts and every
// delete/supersede of a financial document stay Owner-level (finance.manage).
const RECORDABLE_FINANCIAL_CATEGORIES: ReadonlySet<DocumentCategory> = new Set<DocumentCategory>([
  "RENT_RECEIPT",
  "SECURITY_DEPOSIT_RECEIPT",
  "EXPENSE_RECEIPT",
]);

function assertCategoryPermission(
  actor: AuthenticatedUser,
  category: DocumentCategory,
  operation: "read" | "upload" | "manage",
  clientIp?: string
): void {
  if (isResidentCategory(category)) {
    const perm = operation === "read" ? "residents.read" : "residents.manage";
    requirePermission(actor, perm, { ip: clientIp, action: `document.${operation}` });
  } else {
    // Financial categories (RENT_RECEIPT, SECURITY_DEPOSIT_RECEIPT, CHECKOUT_SETTLEMENT_RECEIPT, EXPENSE_RECEIPT)
    const perm =
      operation === "read"
        ? "finance.read"
        : operation === "upload" && RECORDABLE_FINANCIAL_CATEGORIES.has(category)
          ? "finance.record"
          : "finance.manage";
    requirePermission(actor, perm, { ip: clientIp, action: `document.${operation}` });
  }
}

/**
 * Uploads, validates, hashes, persists, and records a document attachment.
 * Guarantees zero ledger modification and complete rollback on storage failure.
 */
export async function uploadDocument(
  actor: AuthenticatedUser,
  input: UploadDocumentInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DocumentAttachment> {
  const db = asyncDb ?? getAsyncDb();

  // 1. Authorization enforcement
  assertCategoryPermission(actor, input.category, "upload", clientIp);

  // 2. Validate parent record relationship
  const residentId = input.residentId?.trim() || null;
  const stayId = input.stayId?.trim() || null;
  const transactionId = input.transactionId?.trim() || null;
  const invoiceId = input.invoiceId?.trim() || null;
  const settlementId = input.settlementId?.trim() || null;

  if (!residentId && !stayId && !transactionId && !invoiceId && !settlementId) {
    throw new Error(
      "Document must be associated with at least one parent record (resident, stay, transaction, invoice, or settlement)."
    );
  }

  if (residentId) {
    const res = await db.queryOne<{ id: string }>("SELECT id FROM residents WHERE id = ?", [residentId]);
    if (!res) throw new Error(`Resident '${residentId}' not found.`);
  }

  if (stayId) {
    const stay = await db.queryOne<{ id: string }>("SELECT id FROM resident_stays WHERE id = ?", [stayId]);
    if (!stay) throw new Error(`Resident stay '${stayId}' not found.`);
  }

  if (transactionId) {
    const tx = await db.queryOne<{ id: string }>("SELECT id FROM financial_transactions WHERE id = ?", [transactionId]);
    if (!tx) throw new Error(`Financial transaction '${transactionId}' not found.`);
  }

  if (invoiceId) {
    const inv = await db.queryOne<{ id: string }>("SELECT id FROM invoices WHERE id = ?", [invoiceId]);
    if (!inv) throw new Error(`Invoice '${invoiceId}' not found.`);
  }

  if (settlementId) {
    const st = await db.queryOne<{ id: string }>("SELECT id FROM resident_settlements WHERE id = ?", [settlementId]);
    if (!st) throw new Error(`Resident settlement '${settlementId}' not found.`);
  }

  // 3. Inspect buffer magic bytes for authoritative MIME type validation
  const verifiedMime = detectVerifiedMimeType(input.fileBuffer);

  // 4. Sanitize original display filename
  const displayFilename = sanitizeDisplayFilename(input.originalFilename);

  // 5. Generate unique document ID and independent storage key
  const docId = `doc_${crypto.randomUUID().replace(/-/g, "")}`;
  const storageKey = generateStorageKey(docId, verifiedMime);

  // 6. Write to private disk storage
  let savedFile: { fileSize: number; fileHash: string; storagePath: string };
  try {
    savedFile = await saveDocumentFile(storageKey, input.fileBuffer);
  } catch (err: any) {
    throw new Error(`Failed to store document file: ${err.message}`);
  }

  const now = new Date().toISOString();
  const cleanNotes = input.notes?.trim() || null;

  try {
    // 7. Persist document metadata within transaction
    await db.transaction(async (tx) => {
      // Check for an existing ACTIVE document of the same category on the same parent record
      // If found, supersede it so the latest upload is active
      let existingActiveId: string | null = null;
      if (residentId) {
        const existing = await tx.queryOne<{ id: string }>(
          "SELECT id FROM document_attachments WHERE resident_id = ? AND category = ? AND status = 'ACTIVE' LIMIT 1",
          [residentId, input.category]
        );
        if (existing) existingActiveId = existing.id;
      } else if (transactionId) {
        const existing = await tx.queryOne<{ id: string }>(
          "SELECT id FROM document_attachments WHERE transaction_id = ? AND category = ? AND status = 'ACTIVE' LIMIT 1",
          [transactionId, input.category]
        );
        if (existing) existingActiveId = existing.id;
      }

      // 1. Insert the new document record first so its ID exists for foreign key references
      await tx.execute(`
        INSERT INTO document_attachments (
          id, category, resident_id, stay_id, transaction_id, invoice_id,
          settlement_id, display_filename, mime_type, file_size, file_hash,
          storage_path, status, superseded_by, notes, uploaded_by,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, ?, ?, ?)
      `, [
        docId,
        input.category,
        residentId,
        stayId,
        transactionId,
        invoiceId,
        settlementId,
        displayFilename,
        verifiedMime,
        savedFile.fileSize,
        savedFile.fileHash,
        savedFile.storagePath,
        cleanNotes,
        actor.id,
        now,
        now,
      ]);

      // 2. Mark previous active document of same category on same parent record as SUPERSEDED
      if (existingActiveId) {
        await tx.execute(
          "UPDATE document_attachments SET status = 'SUPERSEDED', superseded_by = ?, updated_at = ? WHERE id = ?",
          [docId, now, existingActiveId]
        );
      }

      await recordAuditEventAsync({
        actorId: actor.id,
        actorUsername: actor.username,
        action: "document.uploaded",
        targetType: "document",
        targetId: docId,
        metadata: {
          category: input.category,
          displayFilename,
          mimeType: verifiedMime,
          fileSize: savedFile.fileSize,
          residentId,
          stayId,
          transactionId,
          invoiceId,
          settlementId,
          supersededDocId: existingActiveId,
        },
        ipAddress: clientIp,
      }, tx);
    });
  } catch (err: any) {
    // Rollback: cleanup the written file if DB transaction fails
    await deleteDocumentFile(storageKey);
    throw err;
  }

  return (await getDocumentById(actor, docId, clientIp, db))!;
}

/**
 * Retrieves document attachment record with server-side access control.
 */
export async function getDocumentById(
  actor: AuthenticatedUser,
  docId: string,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DocumentAttachment | null> {
  const db = asyncDb ?? getAsyncDb();
  const trimmedId = docId?.trim();
  if (!trimmedId) return null;

  const row = await db.queryOne<any>(`
    SELECT
      d.*,
      u.full_name as uploaded_by_name
    FROM document_attachments d
    JOIN staff_users u ON u.id = d.uploaded_by
    WHERE d.id = ?
  `, [trimmedId]);

  if (!row) return null;

  const doc = mapRowToDocument(row);

  // Assert reading permission
  assertCategoryPermission(actor, doc.category, "read", clientIp);

  return doc;
}

/**
 * Lists documents matching filter parameters with strict domain authorization.
 */
export async function listDocuments(
  actor: AuthenticatedUser,
  filter: DocumentListFilter,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DocumentAttachment[]> {
  const db = asyncDb ?? getAsyncDb();

  // If specific category is requested, check that category
  if (filter.category) {
    assertCategoryPermission(actor, filter.category, "read", clientIp);
  } else if (filter.residentId) {
    requirePermission(actor, "residents.read", { ip: clientIp, action: "document.list" });
  } else if (filter.transactionId || filter.invoiceId || filter.settlementId) {
    requirePermission(actor, "finance.read", { ip: clientIp, action: "document.list" });
  } else {
    // Global list: require at least one operational read permission
    const canReadResidents = hasPermission(actor.role, "residents.read");
    const canReadFinance = hasPermission(actor.role, "finance.read");
    if (!canReadResidents && !canReadFinance) {
      throw new AuthorizationError(403, "Lacks permission to list document attachments.");
    }
  }

  const clauses: string[] = [];
  const params: any[] = [];

  if (filter.category) {
    clauses.push("d.category = ?");
    params.push(filter.category);
  }
  if (filter.residentId) {
    clauses.push("d.resident_id = ?");
    params.push(filter.residentId);
  }
  if (filter.stayId) {
    clauses.push("d.stay_id = ?");
    params.push(filter.stayId);
  }
  if (filter.transactionId) {
    clauses.push("d.transaction_id = ?");
    params.push(filter.transactionId);
  }
  if (filter.invoiceId) {
    clauses.push("d.invoice_id = ?");
    params.push(filter.invoiceId);
  }
  if (filter.settlementId) {
    clauses.push("d.settlement_id = ?");
    params.push(filter.settlementId);
  }
  if (filter.status) {
    clauses.push("d.status = ?");
    params.push(filter.status);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = await db.query<any>(`
    SELECT
      d.*,
      u.full_name as uploaded_by_name
    FROM document_attachments d
    JOIN staff_users u ON u.id = d.uploaded_by
    ${whereSql}
    ORDER BY d.created_at DESC
  `, params);

  return rows.map(mapRowToDocument);
}

/**
 * Downloads document file buffer with cryptographic integrity verification.
 */
export async function downloadDocument(
  actor: AuthenticatedUser,
  docId: string,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<{
  doc: DocumentAttachment;
  buffer: Buffer;
  mimeType: string;
  displayFilename: string;
  fileSize: number;
}> {
  const db = asyncDb ?? getAsyncDb();
  const doc = await getDocumentById(actor, docId, clientIp, db);

  if (!doc) {
    throw new Error(`Document '${docId}' not found.`);
  }

  const buffer = await readDocumentBuffer(doc.storagePath);

  // Cryptographic integrity verification
  const computedHash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (computedHash !== doc.fileHash) {
    throw new Error(
      "Data integrity violation: document file hash on disk does not match recorded cryptographic checksum."
    );
  }

  await recordAuditEventAsync({
    actorId: actor.id,
    actorUsername: actor.username,
    action: "document.downloaded",
    targetType: "document",
    targetId: doc.id,
    metadata: {
      category: doc.category,
      displayFilename: doc.displayFilename,
      fileSize: doc.fileSize,
    },
    ipAddress: clientIp,
  });

  return {
    doc,
    buffer,
    mimeType: doc.mimeType,
    displayFilename: doc.displayFilename,
    fileSize: doc.fileSize,
  };
}

/**
 * Soft-archives a document attachment while preserving historical auditability.
 * Never hard-deletes the file on disk.
 */
export async function archiveDocument(
  actor: AuthenticatedUser,
  docId: string,
  notes?: string,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DocumentAttachment> {
  const db = asyncDb ?? getAsyncDb();
  const doc = await getDocumentById(actor, docId, clientIp, db);

  if (!doc) {
    throw new Error(`Document '${docId}' not found.`);
  }

  assertCategoryPermission(actor, doc.category, "manage", clientIp);

  if (doc.status === "ARCHIVED") {
    return doc;
  }

  const now = new Date().toISOString();
  const appendNotes = notes?.trim()
    ? doc.notes
      ? `${doc.notes} | Archived: ${notes.trim()}`
      : `Archived: ${notes.trim()}`
    : doc.notes;

  await db.transaction(async (tx) => {
    await tx.execute(
      "UPDATE document_attachments SET status = 'ARCHIVED', notes = ?, updated_at = ? WHERE id = ?",
      [appendNotes, now, doc.id]
    );

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "document.archived",
      targetType: "document",
      targetId: doc.id,
      metadata: {
        category: doc.category,
        displayFilename: doc.displayFilename,
        notes: notes?.trim() || null,
      },
      ipAddress: clientIp,
    }, tx);
  });

  return (await getDocumentById(actor, doc.id, clientIp, db))!;
}
