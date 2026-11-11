import { AsyncDb } from "../database/db";
import { recordAuditEventAsync } from "../audit/audit";
import { loadCustomerBalancesById } from "./customerBalance";

/**
 * Customers who have not ordered for three months leave the customer list by themselves (owner,
 * 2026-11-11). Nothing is deleted: the customer is set inactive, so their orders, payments and
 * history stay on record, and their next order brings them back. Never archived:
 *   - a current PG resident (in house now);
 *   - anyone who owes money or has money with us (dues or credit);
 *   - anyone on a running monthly plan;
 *   - anyone added in the last three months.
 */
const DAYS = 90;
let lastRunAt = 0;

export async function archiveIdleCustomers(db: AsyncDb, actor: { id: string; username?: string | null }, now = new Date()): Promise<number> {
  if (!db.isPostgres) return 0;
  const since = new Date(now.getTime() - DAYS * 86400000).toISOString();
  const sinceDate = since.slice(0, 10);
  const idle = await db.query<{ id: string; full_name: string }>(
    `SELECT c.id, c.full_name
     FROM tiffin_customers c
     WHERE c.status = 'ACTIVE' AND c.created_at < ?
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND (o.created_at >= ? OR o.service_date >= ?))
       AND NOT EXISTS (SELECT 1 FROM tiffin_subscriptions s WHERE s.customer_id = c.id AND s.status IN ('ACTIVE', 'PAUSED'))
       AND NOT EXISTS (
         SELECT 1 FROM residents r JOIN resident_stays st ON st.resident_id = r.id AND st.status = 'ACTIVE'
         WHERE right(regexp_replace(COALESCE(r.phone, ''), '[^0-9]', '', 'g'), 10) = right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10)
       )
     LIMIT 500`,
    [since, since, sinceDate]
  );
  if (idle.length === 0) return 0;
  const balances = await loadCustomerBalancesById(db, idle.map((c) => c.id));
  const clear = idle.filter((c) => {
    const b = balances.get(c.id);
    return !b || (b.due === 0 && b.credit === 0);
  });
  if (clear.length === 0) return 0;
  const at = now.toISOString();
  await db.transaction(async (tx) => {
    for (const c of clear) {
      await tx.execute("UPDATE tiffin_customers SET status = 'INACTIVE', updated_at = ? WHERE id = ? AND status = 'ACTIVE'", [at, c.id]);
    }
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username || "system",
        action: "tiffin.customers_archived",
        targetType: "tiffin_customer",
        targetId: clear[0].id,
        metadata: { count: clear.length, customers: clear.slice(0, 50).map((c) => ({ id: c.id, name: c.full_name })), rule: `no order for ${DAYS} days, nothing due, no plan, not in house` },
      },
      tx
    );
  });
  return clear.length;
}

/** At most once an hour per server, and a failure never breaks the screen that asked. */
export async function archiveIdleCustomersSoon(db: AsyncDb, actor: { id: string; username?: string | null }): Promise<void> {
  if (Date.now() - lastRunAt < 60 * 60 * 1000) return;
  lastRunAt = Date.now();
  try {
    await archiveIdleCustomers(db, actor);
  } catch (e) {
    console.warn("[customers] idle check failed:", (e as Error)?.message);
  }
}
