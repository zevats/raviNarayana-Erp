import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import postgres from "postgres";
import { resolveDbPath } from "./db";
import { getDatabaseUrl } from "./client";

export interface MigrationConflict {
  table: string;
  id: string;
  reason: string;
}

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
  conflictsDetected: MigrationConflict[];
  errors: string[];
}

/**
 * Referential integrity order for migrating tables.
 */
export const TABLES_IN_ORDER = [
  "staff_users",
  "rooms",
  "residents",
  "resident_stays",
  "financial_transactions",
  "sessions",
  "session_preemptions",
  "login_attempts",
  "audit_logs",
  "resident_meal_preferences",
  "daily_meal_plans",
  "resident_meal_records",
  "meal_plan_adjustments",
  "delivery_tasks",
  "delivery_task_events",
  "staff_notification_reads",
  "auth_challenges",
  "password_resets",
];

function getPrimaryKey(table: string, row: Record<string, any>): string {
  if (table === "staff_notification_reads") {
    return `${row.staff_id}_${row.notification_id}`;
  }
  return String(row.id);
}

function areRowsEqual(sourceRow: Record<string, any>, targetRow: Record<string, any>): boolean {
  for (const key of Object.keys(sourceRow)) {
    const sVal = sourceRow[key];
    const tVal = targetRow[key];
    if (sVal === null || sVal === undefined) {
      if (tVal !== null && tVal !== undefined) return false;
    } else if (String(sVal) !== String(tVal)) {
      return false;
    }
  }
  return true;
}

export async function migrateSqliteToPostgres(options?: {
  dryRun?: boolean;
}): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    success: false,
    sourceRecordCounts: {},
    targetRecordCounts: {},
    financialChecksum: { sqliteSum: 0, pgSum: 0, match: false },
    activeStaysChecksum: { sqliteCount: 0, pgCount: 0, match: false },
    conflictsDetected: [],
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

  // 1. Take a verified, dated backup of the source database in data/backups
  const dbDir = path.dirname(sqlitePath);
  const backupsDir = path.join(dbDir, "backups");
  if (!fs.existsSync(backupsDir)) {
    try {
      fs.mkdirSync(backupsDir, { recursive: true });
    } catch {}
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupsDir, `erp_backup_${timestamp}.db`);
  try {
    fs.copyFileSync(sqlitePath, backupPath);
    summary.backupPath = backupPath;
  } catch (err: any) {
    summary.errors.push(`Failed to create verified source backup: ${err.message}`);
    return summary;
  }

  // 2. Open source SQLite database in readonly mode
  const sqliteDb = new Database(sqlitePath, { readonly: true });

  // 3. Connect to PostgreSQL target
  let pgSql: postgres.Sql | null = null;
  try {
    pgSql = postgres(pgUrl, { max: 1, idle_timeout: 10 });
    // Verify target connectivity
    await pgSql`SELECT 1`;
  } catch (err: any) {
    summary.errors.push(`Failed to connect to target PostgreSQL instance: ${err.message}`);
    if (pgSql) await pgSql.end({ timeout: 5 });
    sqliteDb.close();
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

    // 5. Transfer data inside a single PostgreSQL transaction with strict conflict detection
    await pgSql.begin(async (tx) => {
      for (const table of TABLES_IN_ORDER) {
        const sourceCount = summary.sourceRecordCounts[table];
        if (sourceCount === 0) continue;

        let rows: Record<string, any>[] = [];
        try {
          rows = sqliteDb.prepare(`SELECT * FROM "${table}"`).all() as Record<string, any>[];
        } catch {
          continue;
        }

        if (rows.length === 0) continue;

        // Fetch existing target rows to detect conflicts
        const existingTargetRows = (await tx`SELECT * FROM ${tx(table)}`) as Record<string, any>[];
        const targetPkMap = new Map<string, Record<string, any>>();
        for (const tRow of existingTargetRows) {
          targetPkMap.set(getPrimaryKey(table, tRow), tRow);
        }

        const rowsToInsert: Record<string, any>[] = [];
        for (const sRow of rows) {
          const pk = getPrimaryKey(table, sRow);
          const existing = targetPkMap.get(pk);
          if (existing) {
            if (!areRowsEqual(sRow, existing)) {
              summary.conflictsDetected.push({
                table,
                id: pk,
                reason: `Record '${pk}' exists in target table '${table}' with divergent data.`,
              });
              summary.errors.push(
                `Conflict detected in '${table}' for ID '${pk}'. Source and target data diverge.`
              );
            }
            // Identical row is safely skipped on rerun
          } else {
            rowsToInsert.push(sRow);
          }
        }

        if (summary.conflictsDetected.length > 0) {
          throw new Error(
            `Migration aborted: ${summary.conflictsDetected.length} data conflict(s) detected. Reruns cannot conceal conflicting records.`
          );
        }

        // Batch insert non-conflicting new rows in chunks of 100
        const chunkSize = 100;
        for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
          const chunk = rowsToInsert.slice(i, i + chunkSize);
          await tx`
            INSERT INTO ${tx(table)} ${(tx as any)(chunk)}
          `;
        }

        const countRow = await tx`SELECT COUNT(*) as count FROM ${tx(table)}`;
        summary.targetRecordCounts[table] = Number(countRow[0].count);

        if (summary.targetRecordCounts[table] !== sourceCount) {
          summary.errors.push(
            `Row count mismatch on table '${table}': Source=${sourceCount}, Target=${summary.targetRecordCounts[table]}`
          );
        }
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

export interface RollbackOptions {
  confirmDestructive: boolean;
  targetUrl?: string;
  allowProduction?: boolean;
}

export async function rollbackPostgresMigration(options: RollbackOptions): Promise<{
  success: boolean;
  truncatedTables: string[];
  error?: string;
}> {
  if (!options.confirmDestructive) {
    return {
      success: false,
      truncatedTables: [],
      error: "Destructive rollback rejected: options.confirmDestructive must be explicitly set to true.",
    };
  }

  const pgUrl = options.targetUrl || getDatabaseUrl(true);
  if (!pgUrl) {
    return {
      success: false,
      truncatedTables: [],
      error: "Target PostgreSQL URL not configured.",
    };
  }

  // Safety guard: prevent accidental destructive rollback on production database
  const isProdEnv = process.env.NODE_ENV === "production";
  if (isProdEnv && !options.allowProduction) {
    return {
      success: false,
      truncatedTables: [],
      error: "Destructive rollback blocked: Cannot truncate production database without explicit allowProduction override.",
    };
  }

  let sql: postgres.Sql | null = null;
  const reversedTables = [...TABLES_IN_ORDER].reverse();
  const truncatedTables: string[] = [];

  try {
    sql = postgres(pgUrl, { max: 1, idle_timeout: 10 });
    await sql.begin(async (tx) => {
      for (const table of reversedTables) {
        await tx`TRUNCATE TABLE ${tx(table)} CASCADE`;
        truncatedTables.push(table);
      }
    });
    return { success: true, truncatedTables };
  } catch (err: any) {
    return { success: false, truncatedTables, error: err.message };
  } finally {
    if (sql) {
      await sql.end({ timeout: 5 });
    }
  }
}
