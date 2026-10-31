/**
 * Development-only database query metrics (performance work, VL-26+).
 *
 * Enabled only when ERP_DB_METRICS=1 and NODE_ENV !== "production". Records the number of
 * statements and their duration, grouped by a normalised SQL fingerprint. Parameters are never
 * recorded (they can contain OTP hashes, personal data or amounts).
 */

interface Bucket {
  count: number;
  totalMs: number;
}

const globalForMetrics = globalThis as unknown as {
  _rnDbMetrics?: { queries: number; totalMs: number; maxMs: number; since: number; byFingerprint: Map<string, Bucket> };
};

export function dbMetricsEnabled(): boolean {
  return process.env.ERP_DB_METRICS === "1" && process.env.NODE_ENV !== "production";
}

function store() {
  if (!globalForMetrics._rnDbMetrics) {
    globalForMetrics._rnDbMetrics = { queries: 0, totalMs: 0, maxMs: 0, since: Date.now(), byFingerprint: new Map() };
  }
  return globalForMetrics._rnDbMetrics;
}

function fingerprint(sql: string): string {
  return sql
    .replace(/\s+/g, " ")
    .replace(/'[^']*'/g, "?")
    .replace(/\$\d+/g, "?")
    .trim()
    .slice(0, 120);
}

export function recordDbQuery(sql: string, ms: number): void {
  if (!dbMetricsEnabled()) return;
  const s = store();
  s.queries++;
  s.totalMs += ms;
  s.maxMs = Math.max(s.maxMs, ms);
  const key = fingerprint(sql);
  const bucket = s.byFingerprint.get(key) ?? { count: 0, totalMs: 0 };
  bucket.count++;
  bucket.totalMs += ms;
  s.byFingerprint.set(key, bucket);
}

export function snapshotDbMetrics(reset = false) {
  const s = store();
  const top = [...s.byFingerprint.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 25)
    .map(([sql, b]) => ({ sql, count: b.count, totalMs: Math.round(b.totalMs) }));
  const snapshot = { queries: s.queries, totalMs: Math.round(s.totalMs), maxMs: Math.round(s.maxMs), since: s.since, top };
  if (reset) {
    s.queries = 0;
    s.totalMs = 0;
    s.maxMs = 0;
    s.since = Date.now();
    s.byFingerprint.clear();
  }
  return snapshot;
}

/** Wraps a query promise factory with timing when metrics are enabled. */
export async function timed<T>(sql: string, run: () => Promise<T>): Promise<T> {
  if (!dbMetricsEnabled()) return run();
  const start = performance.now();
  try {
    return await run();
  } finally {
    recordDbQuery(sql, performance.now() - start);
  }
}
