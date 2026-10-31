/**
 * Server-side "business data changed" signal.
 *
 * Server caches of derived data (e.g. dashboard aggregates) register a listener here, and the
 * live-update stream (/api/events) forwards it to open browsers. The database layer signals after
 * a write to a business table has committed, so cached summaries are never served after the data
 * behind them changed. Authentication/audit bookkeeping writes do not signal, so logins and
 * session checks do not thrash the caches.
 */

/** Receives the business tables written by the committed statement or transaction. */
type Listener = (tables: string[]) => void;

// Kept on globalThis so every route bundle in the process shares one listener set.
const globalForSignals = globalThis as unknown as { _rnBusinessListeners?: Set<Listener> };
const listeners: Set<Listener> = (globalForSignals._rnBusinessListeners ??= new Set<Listener>());

const NON_BUSINESS_TABLES = /^(sessions|session_preemptions|login_attempts|auth_challenges|password_reset_tokens|audit_logs|staff_notification_reads)$/i;
const WRITE_TABLE = /^\s*(?:insert\s+into|update|delete\s+from)\s+"?([a-z_][a-z0-9_]*)"?/i;

export function onBusinessDataChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The business table a statement writes to, or null (reads, auth/audit bookkeeping). */
export function businessWriteTable(sql: string): string | null {
  const m = WRITE_TABLE.exec(sql);
  return m && !NON_BUSINESS_TABLES.test(m[1]) ? m[1].toLowerCase() : null;
}

/** True when the statement writes to a table whose data feeds business summaries. */
export function isBusinessWrite(sql: string): boolean {
  return businessWriteTable(sql) !== null;
}

export function signalBusinessDataChanged(tables: string[] = []): void {
  listeners.forEach((fn) => {
    try {
      fn(tables);
    } catch (e) {
      console.error("Business data change listener error:", e);
    }
  });
}
