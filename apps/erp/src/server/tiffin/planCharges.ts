import crypto from "crypto";
import { AsyncDb } from "../database/db";
import { hasInvoiceIdempotencySchema } from "../database/schemaFeatures";
import { getInvoiceCompanyConfig } from "../settings/settingsService";
import { acquireLedgerKeyLock, assertClosingDateNotFinalized, getBusinessDateString } from "../finance/financeService";
import { generateNextInvoiceNumber } from "../finance/invoiceService";
import { recordAuditEventAsync } from "../audit/audit";

/**
 * Monthly plans are owed in full for every month they run, whether or not a thali was taken
 * (owner decision, 2026-11-11). Nobody "bills" a plan: the month's amount is added to the
 * customer's dues by itself on the day each month of the plan starts.
 *
 *   - A plan month runs from the plan's start day: a plan started on 15 Nov owes for
 *     15 Nov – 14 Dec, then again from 15 Dec. A start on the 29th–31st uses the last day of a
 *     shorter month.
 *   - The charge is the plan's agreed monthly price, once per month (the database allows one
 *     charge per customer, plan and month; a month that already has one, even a cancelled one, is
 *     never charged again).
 *   - Only running plans are charged. An ended plan keeps what it already owes.
 *
 * The charge is the same record a plan bill used to create (an issued tiffin invoice with its
 * ledger charge), so receivables, statements, reports and payments read it without any change.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The first day of plan month `k` (0 = the start date itself). */
export function planMonthStart(startDate: string, k: number): string {
  const [y, m, d] = startDate.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + k, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/** The last day of plan month `k`. */
export function planMonthEnd(startDate: string, k: number): string {
  const next = new Date(`${planMonthStart(startDate, k + 1)}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

interface PlanRow {
  id: string;
  customer_id: string;
  start_date: string;
  end_date: string | null;
  price: number | string;
  customer_name: string;
  customer_phone: string | null;
  delivery_address: string | null;
  product_name: string;
}

/**
 * Plan months that started before this day are not added by themselves: before it, plan bills were
 * made by hand (Billing), so a month the business chose not to bill is never charged afterwards.
 * ERP_PLAN_CHARGES_FROM (YYYY-MM-DD) changes it.
 */
export function planChargesFrom(): string {
  const v = (process.env.ERP_PLAN_CHARGES_FROM || "").trim();
  return DATE.test(v) ? v : "2026-11-01";
}

let lastRunAt = 0;
let running: Promise<number> | null = null;

/** How often the lazy check may run (it also runs whenever a plan is created). */
const intervalMs = () => {
  const v = Number(process.env.ERP_PLAN_CHARGE_INTERVAL_MS);
  return Number.isFinite(v) && v >= 0 ? v : 60_000;
};

/**
 * Adds every plan month that has started and is not yet on the customer's dues. Safe to call at
 * any time and from several requests at once: each plan is charged under its own lock and a month
 * is charged once. Returns how many charges were added.
 */
export async function ensurePlanCharges(db: AsyncDb, actor: { id: string; username?: string | null }, options: { subscriptionId?: string; today?: string } = {}): Promise<number> {
  if (!db.isPostgres || !(await hasInvoiceIdempotencySchema(db))) return 0;
  const today = options.today && DATE.test(options.today) ? options.today : getBusinessDateString(new Date());
  const plans = await db.query<PlanRow>(
    `SELECT s.id, s.customer_id, s.start_date, s.end_date, s.price,
            c.full_name AS customer_name, c.phone AS customer_phone, c.delivery_address, p.name AS product_name
     FROM tiffin_subscriptions s
     JOIN tiffin_customers c ON c.id = s.customer_id
     JOIN tiffin_products p ON p.id = s.product_id
     WHERE s.status = 'ACTIVE' AND p.billing_unit = 'PER_MONTH' AND s.start_date <= ?${options.subscriptionId ? " AND s.id = ?" : ""}`,
    options.subscriptionId ? [today, options.subscriptionId] : [today]
  );
  if (plans.length === 0) return 0;
  const charged = await db.query<{ subscription_id: string; billing_month: string }>(
    `SELECT subscription_id, billing_month FROM invoices
     WHERE invoice_category = 'TIFFIN' AND subscription_id IS NOT NULL AND billing_month IS NOT NULL${options.subscriptionId ? " AND subscription_id = ?" : ""}`,
    options.subscriptionId ? [options.subscriptionId] : []
  );
  const have = new Set(charged.map((r) => `${r.subscription_id}|${r.billing_month}`));

  const floor = planChargesFrom();
  let added = 0;
  for (const plan of plans) {
    if (!DATE.test(plan.start_date) || !(Number(plan.price) > 0)) continue;
    const until = plan.end_date && DATE.test(plan.end_date) && plan.end_date < today ? plan.end_date : today;
    const missing: number[] = [];
    for (let k = 0; k < 240; k++) {
      const from = planMonthStart(plan.start_date, k);
      if (from > until) break;
      if (from < floor) continue;
      if (!have.has(`${plan.id}|${from.slice(0, 7)}`)) missing.push(k);
    }
    if (missing.length === 0) continue;
    try {
      added += await db.transaction(async (tx) => {
        await acquireLedgerKeyLock(tx, `plan-charge:${plan.id}`);
        const live = await tx.queryOne<{ status: string }>("SELECT status FROM tiffin_subscriptions WHERE id = ?", [plan.id]);
        if (live?.status !== "ACTIVE") return 0;
        await assertClosingDateNotFinalized(tx, today, "TIFFIN");
        const company = await getInvoiceCompanyConfig(tx);
        let n = 0;
        for (const k of missing) {
          const from = planMonthStart(plan.start_date, k);
          const to = planMonthEnd(plan.start_date, k);
          const month = from.slice(0, 7);
          const exists = await tx.queryOne("SELECT id FROM invoices WHERE invoice_category = 'TIFFIN' AND customer_id = ? AND subscription_id = ? AND billing_month = ? LIMIT 1", [plan.customer_id, plan.id, month]);
          if (exists) continue;
          const amount = Number(plan.price);
          const now = new Date().toISOString();
          const invoiceId = `inv_${crypto.randomUUID()}`;
          const itemId = `inv_item_${crypto.randomUUID()}`;
          const chargeId = `txn_${crypto.randomUUID()}`;
          const number = await generateNextInvoiceNumber(Number(today.slice(0, 4)), tx);
          const description = `${plan.product_name} · ${from} to ${to}`;
          await tx.execute(
            `INSERT INTO financial_transactions (
               id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, customer_id, stay_id, category,
               description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id, invoice_id, created_by, created_at, updated_at
             ) VALUES (?, 'TIFFIN_CHARGE', ?, ?, NULL, NULL, NULL, ?, NULL, 'TIFFIN', ?, ?, NULL, NULL, 'POSTED', NULL, ?, ?, ?, ?)`,
            [chargeId, amount, today, plan.customer_id, `Monthly plan: ${description}`, month, invoiceId, actor.id, now, now]
          );
          await tx.execute(
            `INSERT INTO invoices (
               id, invoice_number, invoice_type, invoice_category, status, resident_id, customer_id, subscription_id, stay_id, issue_date,
               due_date, billing_period, subtotal, cgst_amount, sgst_amount, igst_amount, total_tax, total_amount, amount_paid, balance_due,
               company_name, company_address, company_gstin, company_state_code, recipient_name, recipient_phone, recipient_email, recipient_address,
               recipient_gstin, recipient_state_code, rent_charge_id, notes, cancelled_at, cancellation_reason, created_by, created_at, updated_at
             ) VALUES (?, ?, 'REGULAR_BILL', 'TIFFIN', 'ISSUED', NULL, ?, ?, NULL, ?, ?, ?, ?, 0, 0, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
            [
              invoiceId, number, plan.customer_id, plan.id, from, from, month, amount, amount, amount,
              company.companyName, company.companyAddress, company.companyGstin, company.companyStateCode,
              plan.customer_name, plan.customer_phone, plan.delivery_address, company.companyStateCode, chargeId,
              "Monthly plan charge (added automatically)", actor.id, now, now,
            ]
          );
          await tx.execute("UPDATE invoices SET billing_month = ? WHERE id = ?", [month, invoiceId]);
          await tx.execute(
            `INSERT INTO invoice_items (
               id, invoice_id, subscription_id, service_start_date, service_end_date, description, sac_hsn_code, quantity, unit_price, amount,
               tax_rate, cgst_rate, sgst_rate, igst_rate, cgst_amount, sgst_amount, igst_amount, total_item_amount, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
            [itemId, invoiceId, plan.id, from, to, description, amount, amount, amount, now]
          );
          await recordAuditEventAsync(
            {
              actorId: actor.id,
              actorUsername: actor.username || "system",
              action: "tiffin.plan_charged",
              targetType: "invoice",
              targetId: invoiceId,
              metadata: { subscriptionId: plan.id, customerId: plan.customer_id, month, from, to, amount, automatic: true },
            },
            tx
          );
          n++;
        }
        return n;
      });
    } catch (e) {
      // One plan that cannot be charged now (for example today's cashbook is closed) does not stop
      // the others; it is tried again on the next run.
      console.warn("[plan charges] not added for one plan:", (e as Error)?.message);
    }
  }
  return added;
}

/**
 * The lazy check used by the screens that show dues: at most once per interval per server, and
 * never more than one run at a time. A failure never breaks the screen that asked.
 */
export async function ensurePlanChargesSoon(db: AsyncDb, actor: { id: string; username?: string | null }): Promise<void> {
  if (Date.now() - lastRunAt < intervalMs()) return;
  if (!running) {
    lastRunAt = Date.now();
    running = ensurePlanCharges(db, actor)
      .catch((e) => {
        console.warn("[plan charges] check failed:", (e as Error)?.message);
        return 0;
      })
      .finally(() => {
        running = null;
      });
  }
  await running;
}
