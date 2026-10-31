/**
 * Legacy order backfill CLI (ISSUE-008): converts pre-0012 order representations
 * ([ORDER_JSON] in delivery notes / counter-sale ledger descriptions) into orders + order_items.
 *
 * Safe by construction:
 *   - The target is validated by the same fail-closed validator as the migration runner
 *     (loopback hosts only; protected rehearsal/generic database names refused).
 *   - Source rows are never modified. Conversion is idempotent (deterministic ids + UNIQUE links),
 *     so re-running is a no-op for rows already converted.
 *   - --dry-run reports what would be converted without writing.
 *
 * Usage (after `npm run db:migrate` has applied 0012):
 *   npx tsc -p tests/tsconfig.json
 *   node -r ./tests/register_paths.js scripts/backfill-orders.js [--dry-run]
 * The target comes from DATABASE_URL, else apps/erp/.env.development.local (never .env.local).
 */

const fs = require("fs");
const path = require("path");
const { validateMigrationTarget } = require("./migrate.js");

function resolveTargetUrl() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) return process.env.DATABASE_URL.trim();
  const devLocalPath = path.resolve(__dirname, "../apps/erp/.env.development.local");
  if (fs.existsSync(devLocalPath)) {
    for (const line of fs.readFileSync(devLocalPath, "utf8").split(/\r?\n/)) {
      const m = line.trim().match(/^DATABASE_URL\s*=\s*(.+)$/);
      if (m) return m[1].trim().replace(/^"(.*)"$/, "$1");
    }
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = resolveTargetUrl();
  const target = validateMigrationTarget(url); // throws before any connection for unsafe targets
  console.log(`[BACKFILL] Target validated: host='${target.hostname}', port=${target.port}, db='${target.dbName}'`);
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;

  const { getAsyncDb } = require("../tests/dist/apps/erp/src/server/database/db");
  const { closePg } = require("../tests/dist/apps/erp/src/server/database/client");
  const { backfillLegacyOrders } = require("../tests/dist/apps/erp/src/server/orders/orderService");
  const db = getAsyncDb();

  try {
    const pendingDelivery = await db.queryOne(
      "SELECT COUNT(*) AS n FROM delivery_tasks t WHERE t.order_type = 'EXTERNAL' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.delivery_task_id = t.id)"
    );
    const pendingSales = await db.queryOne(
      "SELECT COUNT(*) AS n FROM financial_transactions ft WHERE ft.category = 'TIFFIN_WALKIN_SALE' AND ft.transaction_type = 'TIFFIN_PAYMENT' AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.financial_transaction_id = ft.id)"
    );
    console.log(`[BACKFILL] Pending legacy delivery orders: ${Number(pendingDelivery.n)}, counter sales: ${Number(pendingSales.n)}`);
    if (dryRun) {
      console.log("[BACKFILL] Dry run: nothing written.");
      return;
    }
    const result = await backfillLegacyOrders(db);
    console.log("[BACKFILL] Result:", JSON.stringify(result, null, 2));
    if (result.failures.length > 0) process.exitCode = 1;
  } finally {
    await closePg();
  }
}

main().catch((err) => {
  console.error(`[BACKFILL FATAL] ${err.message}`);
  process.exit(1);
});
