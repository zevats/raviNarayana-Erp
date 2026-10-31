import { NextRequest, NextResponse } from "next/server";
import { dbMetricsEnabled, snapshotDbMetrics } from "@/server/database/queryMetrics";
import { getPgSql } from "@/server/database/client";

export const dynamic = "force-dynamic";

/**
 * Development-only query metrics for performance measurement. Responds 404 unless
 * ERP_DB_METRICS=1 outside production; the session middleware still applies. No SQL
 * parameters are ever recorded or returned. ?reset=1 returns the snapshot and clears it.
 * `connections` reports the app's open PostgreSQL sessions and how many were opened since the
 * previous reset (each new one costs a TCP + SCRAM handshake).
 */
export async function GET(request: NextRequest) {
  if (!dbMetricsEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const reset = request.nextUrl.searchParams.get("reset") === "1";
  const snapshot = snapshotDbMetrics(reset);
  let connections: { open: number; openedSinceReset: number } | null = null;
  try {
    const sql = getPgSql();
    if (sql) {
      const [row] = await sql`
        SELECT count(*)::int AS open,
               count(*) FILTER (WHERE backend_start > ${new Date(snapshot.since)})::int AS opened
        FROM pg_stat_activity
        WHERE application_name = 'rn-erp' AND datname = current_database()`;
      connections = { open: row.open, openedSinceReset: row.opened };
    }
  } catch {
    connections = null;
  }
  return NextResponse.json({ ...snapshot, connections });
}
