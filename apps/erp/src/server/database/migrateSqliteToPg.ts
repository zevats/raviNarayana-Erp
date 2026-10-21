import fs from "fs";
import path from "path";
import crypto from "crypto";
import postgres from "postgres";
import { resolveDbPath, validateFixturePath } from "./db";
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

export interface TargetValidationResult {
  valid: boolean;
  error?: string;
  parsedHost?: string;
  parsedDatabase?: string;
}

/**
 * Shared destination identity guard for PostgreSQL migrations and rollbacks.
 * Enforces fail-closed verification of connection URL, exact hostname match against
 * EXPECTED_NEON_HOST, optional database name match against EXPECTED_NEON_DATABASE,
 * and explicit test-write authorization (ALLOW_TEST_MIGRATION=true).
 * Never logs credentials, query parameters, or sensitive URL components.
 */
export function validateDestinationTarget(
  targetUrl: string | null | undefined,
  options?: { requireWriteOptIn?: boolean }
): TargetValidationResult {
  if (!targetUrl || typeof targetUrl !== "string" || targetUrl.trim().length === 0) {
    return {
      valid: false,
      error: "PostgreSQL target URL (DIRECT_URL or DATABASE_URL) is not configured in environment.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl.trim());
  } catch {
    return {
      valid: false,
      error: "Target PostgreSQL URL is malformed.",
    };
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return {
      valid: false,
      error: "Target PostgreSQL URL must use 'postgres:' or 'postgresql:' protocol.",
    };
  }

  const expectedHost = process.env.EXPECTED_NEON_HOST?.trim();
  if (!expectedHost) {
    return {
      valid: false,
      error: "Destination guard rejected: EXPECTED_NEON_HOST environment variable must be explicitly configured with the exact target hostname.",
    };
  }

  const actualHost = parsed.hostname.toLowerCase();
  if (actualHost !== expectedHost.toLowerCase()) {
    return {
      valid: false,
      error: "Destination guard rejected: Target hostname does not match EXPECTED_NEON_HOST.",
    };
  }

  const expectedDb = process.env.EXPECTED_NEON_DATABASE?.trim();
  const actualDb = parsed.pathname.replace(/^\//, "");
  if (expectedDb && actualDb.toLowerCase() !== expectedDb.toLowerCase()) {
    return {
      valid: false,
      error: "Destination guard rejected: Target database name does not match EXPECTED_NEON_DATABASE.",
    };
  }

  if (options?.requireWriteOptIn) {
    const optIn = process.env.ALLOW_TEST_MIGRATION?.trim().toLowerCase();
    if (optIn !== "true" && optIn !== "1") {
      return {
        valid: false,
        error: "Destination guard rejected: Explicit test-write opt-in (ALLOW_TEST_MIGRATION=true) is required for database write operations.",
      };
    }
  }

  return {
    valid: true,
    parsedHost: actualHost,
    parsedDatabase: actualDb,
  };
}

export interface MigrationOptions {
  dryRun?: boolean;
  sqlitePath?: string;
  requireFixture?: boolean;
  repoRoot?: string;
  targetUrl?: string;
  pgClient?: any;
  skipBackup?: boolean;
}

export async function migrateSqliteToPostgres(options?: MigrationOptions): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    success: false,
    sourceRecordCounts: {},
    targetRecordCounts: {},
    financialChecksum: { sqliteSum: 0, pgSum: 0, match: false },
    activeStaysChecksum: { sqliteCount: 0, pgCount: 0, match: false },
    conflictsDetected: [],
    errors: [],
  };

  const isDryRun = Boolean(options?.dryRun);

  // 1. Resolve source SQLite database path
  let sqlitePath: string;
  if (options?.requireFixture) {
    if (
      !options.sqlitePath ||
      typeof options.sqlitePath !== "string" ||
      options.sqlitePath.trim().length === 0
    ) {
      summary.errors.push(
        "Fixture migration requires an explicit, non-empty sqlitePath. Refusing to fall back to primary database."
      );
      return summary;
    }
    const fixtureValidation = validateFixturePath(options.sqlitePath, {
      repoRoot: options.repoRoot,
    });
    if (!fixtureValidation.valid || !fixtureValidation.resolvedPath) {
      summary.errors.push(
        fixtureValidation.error || "Fixture database path validation failed."
      );
      return summary;
    }
    sqlitePath = fixtureValidation.resolvedPath;
  } else {
    sqlitePath = options?.sqlitePath || resolveDbPath();
  }

  if (!fs.existsSync(sqlitePath)) {
    summary.errors.push(`Source SQLite database not found at ${sqlitePath}`);
    return summary;
  }

  // 2. Validate destination target using fail-closed guard
  const pgUrl = options?.targetUrl || getDatabaseUrl(true); // use direct URL for migrations
  const guard = validateDestinationTarget(pgUrl, { requireWriteOptIn: !isDryRun });
  if (!guard.valid) {
    summary.errors.push(guard.error || "Destination target validation failed.");
    return summary;
  }

  // 3. Open source SQLite database in readonly mode
  const BetterSqlite3 = require("better-sqlite3");
  const sqliteDb = new BetterSqlite3(sqlitePath, { readonly: true });

  // 4. Connect to PostgreSQL target to verify connectivity
  let pgSql: postgres.Sql | null = null;
  const isExternalClient = Boolean(options?.pgClient);
  if (isExternalClient) {
    pgSql = options!.pgClient;
    try {
      await pgSql!`SELECT 1`;
    } catch (err: any) {
      summary.errors.push(`Failed to verify target PostgreSQL instance: ${err.message}`);
      sqliteDb.close();
      return summary;
    }
  } else {
    try {
      pgSql = postgres(pgUrl!, { max: 1, idle_timeout: 10 });
      await pgSql`SELECT 1`;
    } catch (err: any) {
      summary.errors.push(`Failed to connect to target PostgreSQL instance: ${err.message}`);
      if (pgSql) await pgSql.end({ timeout: 5 });
      sqliteDb.close();
      return summary;
    }
  }

  try {
    // 5. Inspect source table counts
    for (const table of TABLES_IN_ORDER) {
      try {
        const row = sqliteDb.prepare(`SELECT COUNT(*) as count FROM "${table}"`).get() as { count: number };
        summary.sourceRecordCounts[table] = row.count;
      } catch {
        summary.sourceRecordCounts[table] = 0;
      }
    }

    // 6. DRY-RUN CLEAN RETURN:
    // When dry-run is requested, return source counts and verified connectivity cleanly.
    // Zero filesystem backup files are created, and zero writes/transactions are issued to PostgreSQL.
    if (isDryRun) {
      summary.success = true;
      return summary;
    }

    // 7. LIVE MIGRATION BACKUP:
    // Only created on authorized live migrations (not dry-run).
    // Uses exclusive creation strategy (COPYFILE_EXCL) to guarantee existing backups are never silently overwritten.
    if (!options?.skipBackup) {
      const dbDir = path.dirname(sqlitePath);
      const backupsDir = path.join(dbDir, "backups");
      if (!fs.existsSync(backupsDir)) {
        try {
          fs.mkdirSync(backupsDir, { recursive: true });
        } catch {}
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      let backupPath = path.join(backupsDir, `erp_backup_${timestamp}.db`);
      if (fs.existsSync(backupPath)) {
        const nonce = crypto.randomBytes(4).toString("hex");
        backupPath = path.join(backupsDir, `erp_backup_${timestamp}_${nonce}.db`);
      }

      try {
        fs.copyFileSync(sqlitePath, backupPath, fs.constants.COPYFILE_EXCL);
        summary.backupPath = backupPath;
      } catch (err: any) {
        summary.errors.push(`Failed to create verified source backup: ${err.message}`);
        sqliteDb.close();
        if (pgSql && !isExternalClient) await pgSql.end({ timeout: 5 });
        return summary;
      }
    }

    if (!pgSql) {
      throw new Error("Target PostgreSQL client is not initialized");
    }

    // 8. Transfer data inside a single PostgreSQL transaction with strict conflict detection
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
          throw new Error(
            `Row count mismatch on table '${table}': Source=${sourceCount}, Target=${summary.targetRecordCounts[table]}. Transaction rolled back.`
          );
        }
      }

      // PRE-COMMIT INTEGRITY VALIDATION:
      // Executed strictly INSIDE the uncommitted transaction on tx so any mismatch triggers rollback.
      // 1. Financial checksum: compare sum of all amounts (whole INR)
      const sqliteFin = sqliteDb
        .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM financial_transactions")
        .get() as { total: number };
      const pgFin = (await tx`SELECT COALESCE(SUM(amount), 0) as total FROM financial_transactions`) as Array<{ total: any }>;

      summary.financialChecksum = {
        sqliteSum: Number(sqliteFin.total),
        pgSum: Number(pgFin[0].total),
        match: Number(sqliteFin.total) === Number(pgFin[0].total),
      };

      if (!summary.financialChecksum.match) {
        throw new Error(
          `Financial checksum mismatch: SQLite=${summary.financialChecksum.sqliteSum}, PG=${summary.financialChecksum.pgSum}. Transaction rolled back.`
        );
      }

      // 2. Active stays count checksum
      const sqliteStays = sqliteDb
        .prepare("SELECT COUNT(*) as count FROM resident_stays WHERE status = 'ACTIVE'")
        .get() as { count: number };
      const pgStays = (await tx`SELECT COUNT(*) as count FROM resident_stays WHERE status = 'ACTIVE'`) as Array<{ count: any }>;

      summary.activeStaysChecksum = {
        sqliteCount: Number(sqliteStays.count),
        pgCount: Number(pgStays[0].count),
        match: Number(sqliteStays.count) === Number(pgStays[0].count),
      };

      if (!summary.activeStaysChecksum.match) {
        throw new Error(
          `Active stays count mismatch: SQLite=${summary.activeStaysChecksum.sqliteCount}, PG=${summary.activeStaysChecksum.pgCount}. Transaction rolled back.`
        );
      }
    });

    summary.success = summary.errors.length === 0;
  } catch (err: any) {
    summary.errors.push(`Data migration aborted: ${err.message}`);
    summary.success = false;
  } finally {
    sqliteDb.close();
    if (pgSql && !isExternalClient) {
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

  // Destination identity guard: require valid target and explicit test-write opt-in before connecting or truncating
  const guard = validateDestinationTarget(pgUrl, { requireWriteOptIn: true });
  if (!guard.valid) {
    return {
      success: false,
      truncatedTables: [],
      error: `Destructive rollback blocked: ${guard.error}`,
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
