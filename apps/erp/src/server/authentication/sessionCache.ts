import type { AuthenticatedUser } from "@/types";

/**
 * Valid sessions remembered for a few seconds, so ordinary requests skip the database lookup
 * (each lookup costs a full database round trip). Production builds only: tests and development
 * always read the database. Anything that changes sessions or a staff member's role or status calls
 * invalidateSessionCache(), which clears it at once and again shortly after, so a change made inside
 * a transaction is never kept stale by a request that read it just before the commit.
 */
const TTL_MS = 10_000;
const enabled = process.env.NODE_ENV === "production" && process.env.ERP_SESSION_CACHE !== "off";
const entries = new Map<string, { user: AuthenticatedUser; until: number; expiresAt: string }>();

export function getCachedSession(tokenHash: string): AuthenticatedUser | null {
  if (!enabled) return null;
  const hit = entries.get(tokenHash);
  if (!hit) return null;
  if (Date.now() > hit.until || hit.expiresAt <= new Date().toISOString()) {
    entries.delete(tokenHash);
    return null;
  }
  return hit.user;
}

export function cacheSession(tokenHash: string, user: AuthenticatedUser, expiresAt: string): void {
  if (!enabled) return;
  if (entries.size > 5000) entries.clear();
  entries.set(tokenHash, { user, until: Date.now() + TTL_MS, expiresAt });
}

export function invalidateSessionCache(): void {
  entries.clear();
  if (enabled) setTimeout(() => entries.clear(), 2000).unref?.();
}
