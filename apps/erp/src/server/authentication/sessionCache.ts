import type { AuthenticatedUser } from "@/types";

/**
 * Valid sessions remembered for a few seconds, so ordinary requests skip the database lookup
 * (each lookup costs a full database round trip). Production builds only: tests and development
 * always read the database. Anything that changes sessions or a staff member's role or status calls
 * invalidateSessionCache(), which clears it at once and again shortly after, so a change made inside
 * a transaction is never kept stale by a request that read it just before the commit.
 */
// Fresh for 10 s; after that it is still used for up to a minute while the database is checked
// again in the background (the next request sees the result), so a pause between taps never costs
// a round trip. A session changed or revoked anywhere clears the cache at once (below).
const FRESH_MS = 10_000;
const MAX_MS = 60_000;
const enabled = process.env.NODE_ENV === "production" && process.env.ERP_SESSION_CACHE !== "off";
const entries = new Map<string, { user: AuthenticatedUser; at: number; expiresAt: string }>();

/** The cached user, and whether it should be checked again (in the background). */
export function getCachedSession(tokenHash: string): { user: AuthenticatedUser; stale: boolean } | null {
  if (!enabled) return null;
  const hit = entries.get(tokenHash);
  if (!hit) return null;
  const age = Date.now() - hit.at;
  if (age > MAX_MS || hit.expiresAt <= new Date().toISOString()) {
    entries.delete(tokenHash);
    return null;
  }
  return { user: hit.user, stale: age > FRESH_MS };
}

export function cacheSession(tokenHash: string, user: AuthenticatedUser, expiresAt: string): void {
  if (!enabled) return;
  if (entries.size > 5000) entries.clear();
  entries.set(tokenHash, { user, at: Date.now(), expiresAt });
}

/** A background check found the session gone or the account inactive. */
export function forgetCachedSession(tokenHash: string): void {
  entries.delete(tokenHash);
}

export function invalidateSessionCache(): void {
  entries.clear();
  if (enabled) setTimeout(() => entries.clear(), 2000).unref?.();
}
