import crypto from "crypto";
import { getDb } from "../database/db";
import { AuditEventInput, AuditLogRecord } from "@/types";

const SENSITIVE_KEY_PATTERN = /password|token|hash|secret|cookie|credit|auth/i;

/**
 * Strips sensitive fields (passwords, tokens, hashes) from metadata objects
 * to guarantee that credentials are never stored in the audit logs.
 */
export function sanitizeAuditMetadata(metadata?: Record<string, any> | null): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      sanitized[key] = JSON.parse(sanitizeAuditMetadata(value) || "{}");
    } else {
      sanitized[key] = value;
    }
  }

  return JSON.stringify(sanitized);
}

/**
 * Records an immutable audit log entry for security and operational events.
 * Persists asynchronously to PostgreSQL via recordAuditEventAsync without blocking the caller.
 * Never stores raw credentials, password hashes, or session tokens.
 */
export function recordAuditEvent(input: AuditEventInput): AuditLogRecord {
  const id = `aud_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const sanitizedMeta = sanitizeAuditMetadata(input.metadata);

  // Asynchronously record event without blocking synchronous caller
  recordAuditEventAsync(input).catch((err) => {
    console.error("[Audit Error] Failed to persist audit event:", err);
  });

  return {
    id,
    actorId: input.actorId || null,
    actorUsername: input.actorUsername || null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId || null,
    metadata: sanitizedMeta,
    ipAddress: input.ipAddress || null,
    createdAt: now,
  };
}

/**
 * Query audit log records for authorized auditors (e.g. SUPER_ADMIN, OPERATIONS_MANAGER, ACCOUNTANT).
 */
export function getAuditLogs(options?: {
  limit?: number;
  offset?: number;
  action?: string;
  actorId?: string;
}): AuditLogRecord[] {
  const db = getDb();
  const limit = Math.min(Math.max(options?.limit || 50, 1), 200);
  const offset = Math.max(options?.offset || 0, 0);

  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.action) {
    conditions.push("action = ?");
    params.push(options.action);
  }

  if (options?.actorId) {
    conditions.push("actor_id = ?");
    params.push(options.actorId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `
    SELECT 
      id, actor_id as actorId, actor_username as actorUsername, action, 
      target_type as targetType, target_id as targetId, metadata, 
      ip_address as ipAddress, created_at as createdAt
    FROM audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);
  return db.prepare(query).all(...params) as AuditLogRecord[];
}

import { getAsyncDb, AsyncDb } from "../database/db";

export async function recordAuditEventAsync(input: AuditEventInput, asyncDb?: AsyncDb): Promise<AuditLogRecord> {
  const db = asyncDb || getAsyncDb();
  const id = `aud_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const sanitizedMeta = sanitizeAuditMetadata(input.metadata);

  await db.execute(
    `INSERT INTO audit_logs (id, actor_id, actor_username, action, target_type, target_id, metadata, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.actorId || null,
      input.actorUsername || null,
      input.action,
      input.targetType,
      input.targetId || null,
      sanitizedMeta,
      input.ipAddress || null,
      now,
    ]
  );

  return {
    id,
    actorId: input.actorId || null,
    actorUsername: input.actorUsername || null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId || null,
    metadata: sanitizedMeta,
    ipAddress: input.ipAddress || null,
    createdAt: now,
  };
}

export async function getAuditLogsAsync(
  options?: {
    limit?: number;
    offset?: number;
    action?: string;
    actorId?: string;
  },
  asyncDb?: AsyncDb
): Promise<AuditLogRecord[]> {
  const db = asyncDb || getAsyncDb();
  const limit = Math.min(Math.max(options?.limit || 50, 1), 200);
  const offset = Math.max(options?.offset || 0, 0);

  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.action) {
    conditions.push("action = ?");
    params.push(options.action);
  }

  if (options?.actorId) {
    conditions.push("actor_id = ?");
    params.push(options.actorId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `
    SELECT
      id, actor_id as "actorId", actor_username as "actorUsername", action,
      target_type as "targetType", target_id as "targetId", metadata,
      ip_address as "ipAddress", created_at as "createdAt"
    FROM audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);
  return db.query<AuditLogRecord>(query, params);
}

