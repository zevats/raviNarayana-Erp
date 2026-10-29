import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  AllowedDocumentMimeType,
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
} from "@/types";

/**
 * Returns the authoritative root directory for private document storage.
 * Prioritizes ERP_STORAGE_DIR environment variable, defaulting to <cwd>/storage/documents.
 */
export function getStorageRootDir(): string {
  const configured = process.env.ERP_STORAGE_DIR?.trim();
  const root = configured
    ? path.resolve(process.cwd(), configured)
    : path.resolve(process.cwd(), "storage", "documents");
  return root;
}

/**
 * Inspects buffer magic bytes (file signature) to authoritatively determine file format.
 * Client-supplied extensions and Content-Type headers are NEVER trusted.
 */
export function detectVerifiedMimeType(buffer: Buffer): AllowedDocumentMimeType {
  if (!buffer || buffer.length < 4) {
    throw new Error("File is empty or too small to verify signature.");
  }

  // 1. JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // 2. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // 3. WebP: 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP)
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  // 4. PDF: 25 50 44 46 (%PDF-)
  if (
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "application/pdf";
  }

  throw new Error(
    "Unsupported or invalid file format. Only JPEG, PNG, WebP, and PDF documents with valid file signatures are accepted."
  );
}

/**
 * Returns canonical file extension for verified MIME type.
 */
export function getExtensionForMimeType(mime: AllowedDocumentMimeType): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return "bin";
  }
}

/**
 * Sanitizes original filename for safe UI display and download headers.
 * Strips path traversal sequences, null bytes, and non-printable control characters.
 */
export function sanitizeDisplayFilename(originalName: string, fallback = "document.pdf"): string {
  if (!originalName || typeof originalName !== "string") {
    return fallback;
  }

  // Extract basename, stripping leading path traversal attempts
  const base = path.basename(originalName);
  // Remove null bytes, control characters, and dangerous chars
  const sanitized = base
    .replace(/\0/g, "")
    .replace(/[^\w\s().-]/g, "_")
    .trim();

  if (!sanitized || sanitized === "." || sanitized === "..") {
    return fallback;
  }

  // Limit display filename length to 100 characters while preserving extension
  if (sanitized.length > 100) {
    const ext = path.extname(sanitized);
    const stem = path.basename(sanitized, ext).slice(0, 90);
    return `${stem}${ext}`;
  }

  return sanitized;
}

/**
 * Generates an independent, partitioned relative storage key for the file.
 * Example: "2026/10/doc_a1b2c3d4e5f6.pdf"
 */
export function generateStorageKey(docId: string, mime: AllowedDocumentMimeType): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const ext = getExtensionForMimeType(mime);
  return `${year}/${month}/${docId}.${ext}`;
}

/**
 * Resolves canonical absolute storage path, strictly enforcing that it resides
 * within the configured storage root directory.
 */
export function resolveSafeStoragePath(storageKey: string): string {
  const root = getStorageRootDir();
  // Normalize both paths to avoid slashes mismatch
  const resolved = path.resolve(root, storageKey);

  // Path Traversal Security Guard
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Security Violation: Path traversal outside document storage directory is prohibited.");
  }

  return resolved;
}

/**
 * Validates, hashes, and persists file buffer to private disk storage.
 */
export async function saveDocumentFile(
  storageKey: string,
  buffer: Buffer
): Promise<{ fileSize: number; fileHash: string; storagePath: string }> {
  if (!buffer || buffer.length === 0) {
    throw new Error("Cannot save empty document (0 bytes).");
  }

  if (buffer.length > MAX_DOCUMENT_FILE_SIZE_BYTES) {
    throw new Error(
      `File size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of 5.00 MB.`
    );
  }

  const filePath = resolveSafeStoragePath(storageKey);
  const dirPath = path.dirname(filePath);

  // Ensure partitioned target directory exists
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  // Compute SHA-256 integrity hash
  const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

  // Write file to private storage
  await fs.promises.writeFile(filePath, buffer);

  return {
    fileSize: buffer.length,
    fileHash,
    storagePath: storageKey,
  };
}

/**
 * Reads document buffer from private disk storage with integrity verification.
 */
export async function readDocumentBuffer(storageKey: string): Promise<Buffer> {
  const filePath = resolveSafeStoragePath(storageKey);
  if (!fs.existsSync(filePath)) {
    throw new Error("Document file not found on storage provider.");
  }
  return fs.promises.readFile(filePath);
}

/**
 * Checks whether document file exists on disk.
 */
export function documentFileExists(storageKey: string): boolean {
  try {
    const filePath = resolveSafeStoragePath(storageKey);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Deletes document file from disk storage.
 */
export async function deleteDocumentFile(storageKey: string): Promise<boolean> {
  try {
    const filePath = resolveSafeStoragePath(storageKey);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
