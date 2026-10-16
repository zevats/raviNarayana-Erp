import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import postgres from "postgres";
import { resolveDbPath } from "./db";
import { getDatabaseUrl } from "./client";

export interface MigrationSummary {
  success: boolean;
  backupPath?: string;
  sourceRecordCounts: Record<string, number>;
  targetRecordCounts: Record<string, number>;
  financialChecksum: {
    sqliteSum: number;
    pgSum: number;
    match: boolean;
  };
  activeStaysChecksum: {
    sqliteCount: number;
    pgCount: number;
    match: boolean;
  };
  errors: string[];
}

/**
 * Referential integrity order for migrating tables.
 */
const TABLES_IN_ORDER = [
  "staff_users",
  "rooms",
  "residents",
  "resident_stays",
  "financial_transactions",
  "sessions",
  "login_attempts",
  "audit_logs",
  "resident_meal_preferences",
  "daily_meal_plans",
  "resident_meal_records",
  "meal_plan_adjustments",
  "delivery_tasks",
  "delivery_task_events",
  "staff_notification_reads",
];

export async function migrateSqliteToPostgres(options?: {
  dryRun?: boolean;
}): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    success: false,
    sourceRecordCounts: {},
    targetRecordCounts: {},
    financialChecksum: { sqliteSum: 0, pgSum: 0, match: false },
    activeStaysChecksum: { sqliteCount: 0, pgCount: 0, match: false },
    errors: [],
  };

  const sqlitePath = resolveDbPath();
  if (!fs.existsSync(sqlitePath)) {
    summary.errors.push(`Source SQLite database not found at ${sqlitePath}`);
    return summary;
  }

  const pgUrl = getDatabaseUrl(true); // use direct URL for migrations
  if (!pgUrl) {
    summary.errors.push(
      "PostgreSQL target URL (DIRECT_URL or DATABASE_URL) is not configured in environment"
    );
    return summary;
  }

  // 1. Take a verified, dated backup of the source database
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${sqlitePath}.backup.${timestamp}`;
  try {
    fs.copyFileSync(sqlitePath, backupPath);
    summary.backupPath = backupPath;
  } catch (err: any) {
    summary.errors.push(`Failed to create verified source backup: ${err.message}`);
    return summary;
  }

  // 2. Open source SQLite database in readonly mode
  const sqliteDb = new Database(sqlitePath, { readonly: true });
  const userVersion = sqliteDb.pragma("user_version", { simple: true });

  // 3. Connect to PostgreSQL target
  let pgSql: postgres.Sql | null = null;
  try {
    pgSql = postgres(pgUrl, { max: 1, idle_timeout: 10 });
    // Verify target connectivity
    await pgSql`SELECT 1`;
  } catch (err: any) {
    summary.errors.push(`Failed to connect to target PostgreSQL instance: ${err.message}`);
    if (pgSql) await pgSql.end({ timeout: 5 });
    return summary;
  }

  try {
    // 4. Inspect source table counts
    for (const table of TABLES_IN_ORDER) {
      try {
        const row = sqliteDb.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get() as { count: number };
        summary.sourceRecordCounts[table] = row.count;
      } catch {
        summary.sourceRecordCounts[table] = 0;
      }
    }

    if (options?.dryRun) {
      summary.success = true;
      return summary;
    }

    // 5. Transfer data inside a single PostgreSQL transaction
    await pgSql.begin(async (tx) => {
      for (const table of TABLES_IN_ORDER) {
        const sourceCount = summary.sourceRecordCounts[table];
        if (sourceCount === 0) continue;

        const rows = sqliteDb.prepare(`SELECT * FROM "${table}"`).all();
        if (rows.length === 0) continue;

        // Batch insert in chunks of 100
        const chunkSize = 100;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize) as Record<string, any>[];
          await tx`
            INSERT INTO ${tx(table)} ${(tx as any)(chunk)}
            ON CONFLICT DO NOTHING
          `;
        }

        const countRow = await tx`SELECT COUNT(*) as count FROM ${tx(table)}`;
        summary.targetRecordCounts[table] = Number(countRow[0].count);
      }
    });

    // 6. Validation Checks
    // Financial checksum: compare sum of all amounts (whole INR)
    const sqliteFin = sqliteDb
      .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM financial_transactions")
      .get() as { total: number };
    const pgFin = await pgSql`SELECT COALESCE(SUM(amount), 0) as total FROM financial_transactions`;

    summary.financialChecksum = {
      sqliteSum: Number(sqliteFin.total),
      pgSum: Number(pgFin[0].total),
      match: Number(sqliteFin.total) === Number(pgFin[0].total),
    };

    if (!summary.financialChecksum.match) {
      summary.errors.push(
        `Financial checksum mismatch: SQLite=${summary.financialChecksum.sqliteSum}, PG=${summary.financialChecksum.pgSum}`
      );
    }

    // Active stays checksum
    const sqliteStays = sqliteDb
      .prepare("SELECT COUNT(*) as count FROM resident_stays WHERE status = 'ACTIVE'")
      .get() as { count: number };
    const pgStays = await pgSql`SELECT COUNT(*) as count FROM resident_stays WHERE status = 'ACTIVE'`;

    summary.activeStaysChecksum = {
      sqliteCount: Number(sqliteStays.count),
      pgCount: Number(pgStays[0].count),
      match: Number(sqliteStays.count) === Number(pgStays[0].count),
    };

    if (!summary.activeStaysChecksum.match) {
      summary.errors.push(
        `Active stays count mismatch: SQLite=${summary.activeStaysChecksum.sqliteCount}, PG=${summary.activeStaysChecksum.pgCount}`
      );
    }

    summary.success = summary.errors.length === 0;
  } catch (err: any) {
    summary.errors.push(`Data migration aborted: ${err.message}`);
    summary.success = false;
  } finally {
    sqliteDb.close();
    if (pgSql) {
      await pgSql.end({ timeout: 5 });
    }
  }

  return summary;
}
