import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { sanitizeAuditMetadata } from "./audit";
import { AuthenticatedUser } from "@/types";

/**
 * Read-only Activity log over audit_logs (no second audit store). Owner only for now
 * (system.manage); there is no way to change or delete an entry. Metadata is shown after the same
 * redaction applied when it was written, so a sensitive field never reaches the page.
 */

export interface ActivityEntry {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string;
  action: string;
  area: string;
  targetType: string;
  targetId: string | null;
  outcome: "DONE" | "REFUSED";
  details: Record<string, unknown> | null;
  ipAddress: string | null;
}

export interface ActivityFilters {
  actorId?: string;
  action?: string;
  /** First part of the action (finance, delivery, resident, …). */
  area?: string;
  targetId?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** IST date → the UTC instant it starts at (audit timestamps are UTC ISO strings). */
const istStartUtc = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();

export async function listActivity(actor: AuthenticatedUser, filters: ActivityFilters = {}, asyncDb?: AsyncDb) {
  requirePermission(actor, "system.manage", { action: "activity.read" });
  const db = asyncDb ?? getAsyncDb();
  const where: string[] = [];
  const params: any[] = [];
  if (filters.actorId) {
    where.push("a.actor_id = ?");
    params.push(filters.actorId);
  }
  if (filters.action) {
    where.push("a.action = ?");
    params.push(filters.action);
  } else if (filters.area) {
    where.push("a.action LIKE ?");
    params.push(`${filters.area}.%`);
  }
  if (filters.targetId) {
    where.push("a.target_id = ?");
    params.push(filters.targetId.trim());
  }
  if (filters.from && DATE.test(filters.from)) {
    where.push("a.created_at >= ?");
    params.push(istStartUtc(filters.from));
  }
  if (filters.to && DATE.test(filters.to)) {
    const next = new Date(new Date(`${filters.to}T00:00:00+05:30`).getTime() + 86400000).toISOString();
    where.push("a.created_at < ?");
    params.push(next);
  }
  if (filters.search?.trim()) {
    where.push("(LOWER(a.action) LIKE ? OR LOWER(COALESCE(a.target_id, '')) LIKE ? OR LOWER(COALESCE(a.actor_username, '')) LIKE ? OR LOWER(COALESCE(s.full_name, '')) LIKE ?)");
    const q = `%${filters.search.trim().toLowerCase()}%`;
    params.push(q, q, q, q);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
  const offset = Math.max(0, Number(filters.offset) || 0);
  const [rows, total] = await Promise.all([
    db.query<any>(
      `SELECT a.*, s.full_name FROM audit_logs a LEFT JOIN staff_users s ON s.id = a.actor_id ${whereSql}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    db.queryOne<{ n: number | string }>(`SELECT COUNT(*) AS n FROM audit_logs a LEFT JOIN staff_users s ON s.id = a.actor_id ${whereSql}`, params),
  ]);
  const entries: ActivityEntry[] = rows.map((r) => {
    let details: Record<string, unknown> | null = null;
    if (r.metadata) {
      try {
        details = JSON.parse(sanitizeAuditMetadata(JSON.parse(r.metadata)) || "null");
      } catch {
        details = null;
      }
    }
    return {
      id: r.id,
      at: r.created_at,
      actorId: r.actor_id ?? null,
      actorName: r.full_name || r.actor_username || "System",
      action: r.action,
      area: String(r.action).split(".")[0],
      targetType: r.target_type,
      targetId: r.target_id ?? null,
      outcome: r.action === "auth.forbidden" ? "REFUSED" : "DONE",
      details,
      ipAddress: r.ip_address ?? null,
    };
  });
  return { entries, total: Number(total?.n || 0), limit, offset };
}

/** People and action names that appear in the log, for the filter menus. */
export async function getActivityFilterOptions(actor: AuthenticatedUser, asyncDb?: AsyncDb) {
  requirePermission(actor, "system.manage", { action: "activity.read" });
  const db = asyncDb ?? getAsyncDb();
  const [actions, people] = await Promise.all([
    db.query<{ action: string }>("SELECT DISTINCT action FROM audit_logs ORDER BY action"),
    // One index probe per staff member instead of reading the whole log (47 ms → 0.2 ms at 60k rows).
    db.query<{ id: string; full_name: string }>(
      "SELECT s.id, s.full_name FROM staff_users s WHERE EXISTS (SELECT 1 FROM audit_logs a WHERE a.actor_id = s.id) ORDER BY s.full_name"
    ),
  ]);
  return { actions: actions.map((a) => a.action), people: people.map((p) => ({ id: p.id, fullName: p.full_name })) };
}
