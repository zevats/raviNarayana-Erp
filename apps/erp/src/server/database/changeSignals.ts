/**
 * Server-side "business data changed" signal.
 *
 * Server caches of derived data (e.g. dashboard aggregates) register a listener here, and the
 * live-update stream (/api/events) forwards it to open browsers. The database layer signals after
 * a write to a business table has committed, so cached summaries are never served after the data
 * behind them changed. Authentication/audit bookkeeping writes do not signal, so logins and
 * session checks do not thrash the caches.
 *
 * Each signal carries the origin of the request that wrote (an opaque hash of its session), so the
 * browser that made a change can tell the echo of its own save from someone else's write.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";

/** Receives the business tables written by the committed statement or transaction. */
type Listener = (tables: string[], origin: string | null) => void;

// Kept on globalThis so every route bundle in the process shares one listener set.
const globalForSignals = globalThis as unknown as { _rnBusinessListeners?: Set<Listener>; _rnChangeOrigin?: AsyncLocalStorage<string> };
const listeners: Set<Listener> = (globalForSignals._rnBusinessListeners ??= new Set<Listener>());
const originStore: AsyncLocalStorage<string> = (globalForSignals._rnChangeOrigin ??= new AsyncLocalStorage<string>());

/** Opaque, non-reversible id for the session making a request (never the token or its stored hash). */
export function changeOriginFor(sessionToken: string): string {
  return createHash("sha256").update("rn-change-origin:" + sessionToken).digest("hex").slice(0, 16);
}

/**
 * Marks the rest of the current request as coming from `origin`. Must run before the request's
 * first await so the handler's continuation inherits it (see resolveUserFromRequest).
 */
export function setChangeOrigin(origin: string): void {
  originStore.enterWith(origin);
}

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
  const origin = originStore.getStore() ?? null;
  listeners.forEach((fn) => {
    try {
      fn(tables, origin);
    } catch (e) {
      console.error("Business data change listener error:", e);
    }
  });
}
