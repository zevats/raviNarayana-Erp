import Database from "better-sqlite3";

let lastCleanupTimestamp: number = 0;
const CLEANUP_THROTTLE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const LOGIN_ATTEMPTS_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CleanupResult {
  executed: boolean;
  expiredSessionsDeleted: number;
  staleAttemptsDeleted: number;
  durationMs: number;
}

/**
 * Perform bounded cleanup of expired sessions and stale login-attempt records.
 * Throttled to run at most once every 30 minutes under active traffic.
 */
export function performDatabaseCleanup(db: Database.Database, force: boolean = false): CleanupResult {
  const now = Date.now();
  if (!force && now - lastCleanupTimestamp < CLEANUP_THROTTLE_INTERVAL_MS) {
    return {
      executed: false,
      expiredSessionsDeleted: 0,
      staleAttemptsDeleted: 0,
      durationMs: 0,
    };
  }

  const startTime = Date.now();
  const nowIso = new Date(now).toISOString();
  const retentionCutoffIso = new Date(now - LOGIN_ATTEMPTS_RETENTION_MS).toISOString();

  try {
    const tx = db.transaction(() => {
      // 1. Delete strictly expired sessions (active sessions are preserved)
      const sessionResult = db.prepare(`
        DELETE FROM sessions WHERE expires_at < ?
      `).run(nowIso);

      // 2. Delete login attempts older than retention policy (24 hours)
      const attemptsResult = db.prepare(`
        DELETE FROM login_attempts WHERE attempted_at < ?
      `).run(retentionCutoffIso);

      return {
        expiredSessionsDeleted: sessionResult.changes,
        staleAttemptsDeleted: attemptsResult.changes,
      };
    });

    const counts = tx();
    lastCleanupTimestamp = Date.now();
    const durationMs = Date.now() - startTime;

    return {
      executed: true,
      expiredSessionsDeleted: counts.expiredSessionsDeleted,
      staleAttemptsDeleted: counts.staleAttemptsDeleted,
      durationMs,
    };
  } catch (error) {
    // Observable without exposing internal query parameters or sensitive data
    console.error("[Database Cleanup Error] Failed to prune expired records:", error instanceof Error ? error.message : "Unknown error");
    return {
      executed: false,
      expiredSessionsDeleted: 0,
      staleAttemptsDeleted: 0,
      durationMs: Date.now() - startTime,
    };
  }
}
