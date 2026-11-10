import { getAsyncDb, AsyncDb } from "../database/db";
import { hasDeliveryOpsSchema } from "../delivery/deliveryRules";
import { RENT_RECEIPT_SQL, TIFFIN_RECEIPT_SQL } from "../finance/financialDefinitions";
import { businessToday, businessMonthStart, businessMonthKey, addBusinessDays } from "@/lib/businessDate";
import { ClosingDivision } from "@/types";

/**
 * Dashboard figures added in Phase 9, each read from live records (definitions in
 * docs/FINANCIAL_DEFINITIONS.md). Every block is loaded on its own so one failing query is reported
 * for that block only; nothing is replaced by zero.
 */

export interface DashboardOps {
  today: {
    date: string;
    waiting: number;
    out: number;
    delivered: number;
    total: number;
    completionRate: number;
    problems: number;
    boxes: { lunch: number; dinner: number };
  } | null;
  custody: { cashWithStaff: number; awaitingAcceptance: number } | null;
  people: { activeResidents: number } | null;
  tiffin: { activeSubscriptions: number; pausedSubscriptions: number; activeCustomers: number } | null;
  recent: Array<{ id: string; date: string; type: string; category: string; amount: number; method: string | null; party: string | null; createdAt: string }> | null;
  money: {
    collectedThisMonth: number;
    expensesThisMonth: number;
    netCollected: number;
    lastClosedDay: string | null;
    yesterdayUnclosed: boolean;
  } | null;
  charts: {
    dailyCollections: Array<{ date: string; value: number }>;
    deliveryCompletion: Array<{ date: string; value: number; delivered: number; total: number }>;
    expensesByCategory: Array<{ category: string; value: number }>;
    occupancyHistory: Array<{ month: string; value: number; occupied: number; capacity: number }>;
  } | null;
  failed: string[];
}

const n = (v: unknown) => Number(v || 0);
const divisionCollectedSql = (division: ClosingDivision) =>
  division === "PG" ? RENT_RECEIPT_SQL : division === "TIFFIN" ? TIFFIN_RECEIPT_SQL : `(${RENT_RECEIPT_SQL} OR ${TIFFIN_RECEIPT_SQL})`;
const divisionExpenseSql = (division: ClosingDivision) =>
  division === "PG" ? "AND category NOT IN ('GROCERY', 'KITCHEN_SUPPLIES')" : division === "TIFFIN" ? "AND category IN ('GROCERY', 'KITCHEN_SUPPLIES')" : "";

async function block<T>(name: string, failed: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[Dashboard] ${name} could not be loaded:`, (err as Error).message);
    failed.push(name);
    return null;
  }
}

export async function getDashboardOps(division: ClosingDivision = "COMBINED", asyncDb?: AsyncDb): Promise<DashboardOps> {
  const db = asyncDb ?? getAsyncDb();
  const today = businessToday();
  const yesterday = addBusinessDays(today, -1);
  const monthStart = businessMonthStart();
  const failed: string[] = [];

  const [todayBlock, custody, people, money, charts, tiffin, recent] = await Promise.all([
    block("Today's deliveries", failed, async () => {
      // Databases without the delivery update (migration 0014) have no resolution tracking and no
      // per-stop item lines: count every exception, and boxes from order lines only.
      const opsSchema = await hasDeliveryOpsSchema(db);
      const row = await db.queryOne<any>(
        `SELECT
           SUM(CASE WHEN status IN ('PENDING', 'ASSIGNED') THEN 1 ELSE 0 END) AS waiting,
           SUM(CASE WHEN status = 'OUT_FOR_DELIVERY' THEN 1 ELSE 0 END) AS out_now,
           SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered,
           SUM(CASE WHEN status <> 'CANCELLED' THEN 1 ELSE 0 END) AS total,
           SUM(CASE WHEN status = 'EXCEPTION'${opsSchema ? " AND resolved_at IS NULL" : ""} THEN 1 ELSE 0 END) AS problems
         FROM delivery_tasks WHERE service_date = ?`,
        [today]
      );
      // Boxes going out today: order lines plus subscription/resident stop lines (not cancelled).
      const boxes = await db.query<any>(
        opsSchema
          ? `SELECT t.meal_type, COALESCE(SUM(COALESCE(oi.quantity, 0)), 0) + COALESCE(SUM(COALESCE(ti.quantity, 0)), 0) AS boxes
         FROM delivery_tasks t
         LEFT JOIN orders o ON o.delivery_task_id = t.id
         LEFT JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN delivery_task_items ti ON ti.task_id = t.id
         WHERE t.service_date = ? AND t.status <> 'CANCELLED'
         GROUP BY t.meal_type`
          : `SELECT t.meal_type, COALESCE(SUM(COALESCE(oi.quantity, 0)), 0) AS boxes
         FROM delivery_tasks t
         LEFT JOIN orders o ON o.delivery_task_id = t.id
         LEFT JOIN order_items oi ON oi.order_id = o.id
         WHERE t.service_date = ? AND t.status <> 'CANCELLED'
         GROUP BY t.meal_type`,
        [today]
      );
      const total = n(row?.total);
      const delivered = n(row?.delivered);
      const by = (m: string) => n(boxes.find((b) => b.meal_type === m)?.boxes);
      return {
        date: today, waiting: n(row?.waiting), out: n(row?.out_now), delivered, total,
        completionRate: total > 0 ? Math.round((delivered / total) * 100) : 0, problems: n(row?.problems),
        boxes: { lunch: by("LUNCH"), dinner: by("DINNER") },
      };
    }),
    block("Cash with staff", failed, async () => {
      const row = await db.queryOne<any>(
        `SELECT
           COALESCE(SUM(CASE WHEN h.id IS NULL OR h.status = 'DECLARED' THEN dc.amount ELSE 0 END), 0) AS held,
           COALESCE(SUM(CASE WHEN h.status = 'DECLARED' THEN dc.amount ELSE 0 END), 0) AS awaiting
         FROM delivery_collections dc LEFT JOIN driver_cash_handovers h ON h.id = dc.handover_id
         WHERE dc.payment_method = 'CASH'`
      );
      return { cashWithStaff: n(row?.held), awaitingAcceptance: n(row?.awaiting) };
    }),
    block("Residents", failed, async () => {
      const row = await db.queryOne<any>("SELECT COUNT(DISTINCT resident_id) AS n FROM resident_stays WHERE status = 'ACTIVE'");
      return { activeResidents: n(row?.n) };
    }),
    block("Money this month", failed, async () => {
      const [m, closed, yRow] = await Promise.all([
        db.queryOne<any>(
          `SELECT
             COALESCE(SUM(CASE WHEN ${divisionCollectedSql(division)} THEN amount ELSE 0 END), 0) AS collected,
             COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' ${divisionExpenseSql(division)} THEN amount ELSE 0 END), 0) AS expenses
           FROM financial_transactions WHERE status = 'POSTED' AND transaction_date >= ? AND transaction_date <= ?`,
          [monthStart, today]
        ),
        db.queryOne<any>("SELECT MAX(closing_date) AS d FROM daily_cashbook_closings WHERE status = 'FINALIZED'"),
        db.queryOne<any>(
          `SELECT COUNT(*) AS movements,
             (SELECT COUNT(*) FROM daily_cashbook_closings c WHERE c.closing_date = ? AND c.status = 'FINALIZED') AS finalized
           FROM financial_transactions WHERE transaction_date = ? AND status = 'POSTED'`,
          [yesterday, yesterday]
        ),
      ]);
      const collected = n(m?.collected);
      const expenses = n(m?.expenses);
      return {
        collectedThisMonth: collected, expensesThisMonth: expenses, netCollected: collected - expenses,
        lastClosedDay: closed?.d || null, yesterdayUnclosed: n(yRow?.movements) > 0 && n(yRow?.finalized) === 0,
      };
    }),
    block("Charts", failed, async () => {
      const from30 = addBusinessDays(today, -29);
      const from14 = addBusinessDays(today, -13);
      const [daily, completion, categories, months] = await Promise.all([
        db.query<any>(
          `SELECT transaction_date AS d, COALESCE(SUM(amount), 0) AS v FROM financial_transactions
           WHERE status = 'POSTED' AND ${divisionCollectedSql(division)} AND transaction_date >= ? AND transaction_date <= ?
           GROUP BY transaction_date`,
          [from30, today]
        ),
        db.query<any>(
          `SELECT service_date AS d, SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered, SUM(CASE WHEN status <> 'CANCELLED' THEN 1 ELSE 0 END) AS total
           FROM delivery_tasks WHERE service_date >= ? AND service_date <= ? GROUP BY service_date`,
          [from14, today]
        ),
        db.query<any>(
          `SELECT category, COALESCE(SUM(amount), 0) AS v FROM financial_transactions
           WHERE status = 'POSTED' AND transaction_type = 'EXPENSE' ${divisionExpenseSql(division)} AND transaction_date >= ? AND transaction_date <= ?
           GROUP BY category ORDER BY v DESC`,
          [monthStart, today]
        ),
        // Occupancy at each month end (or today for this month), from the stays' own dates.
        Promise.all(
          [-5, -4, -3, -2, -1, 0].map(async (off) => {
            const month = businessMonthKey(off);
            const [y, mm] = month.split("-").map(Number);
            const last = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
            const asOf = off === 0 ? today : last;
            const row = await db.queryOne<any>(
              `SELECT
                 (SELECT COUNT(*) FROM resident_stays s WHERE s.check_in_date <= ? AND (s.check_out_date IS NULL OR s.check_out_date > ?) AND s.status IN ('ACTIVE', 'COMPLETED')) AS occupied,
                 (SELECT COALESCE(SUM(capacity), 0) FROM rooms WHERE is_active = 1 AND created_at <= ?) AS capacity`,
              [asOf, asOf, `${asOf}T23:59:59.999Z`]
            );
            const capacity = n(row?.capacity);
            const occupied = n(row?.occupied);
            return { month, occupied, capacity, value: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0 };
          })
        ),
      ]);
      const dailyMap = new Map(daily.map((r) => [r.d, n(r.v)]));
      const compMap = new Map(completion.map((r) => [r.d, r]));
      return {
        dailyCollections: Array.from({ length: 30 }, (_, i) => {
          const d = addBusinessDays(from30, i);
          return { date: d, value: dailyMap.get(d) ?? 0 };
        }),
        deliveryCompletion: Array.from({ length: 14 }, (_, i) => {
          const d = addBusinessDays(from14, i);
          const r = compMap.get(d);
          const total = n(r?.total);
          const delivered = n(r?.delivered);
          return { date: d, delivered, total, value: total > 0 ? Math.round((delivered / total) * 100) : 0 };
        }),
        expensesByCategory: categories.map((c) => ({ category: String(c.category).replace(/_/g, " ").toLowerCase(), value: n(c.v) })),
        occupancyHistory: months,
      };
    }),
    block("Tiffin", failed, async () => {
      const row = await db.queryOne<any>(
        `SELECT
           (SELECT COUNT(*) FROM tiffin_subscriptions WHERE status = 'ACTIVE') AS active,
           (SELECT COUNT(*) FROM tiffin_subscriptions WHERE status = 'PAUSED') AS paused,
           (SELECT COUNT(*) FROM tiffin_customers WHERE status = 'ACTIVE') AS customers`
      );
      return { activeSubscriptions: n(row?.active), pausedSubscriptions: n(row?.paused), activeCustomers: n(row?.customers) };
    }),
    block("Recent transactions", failed, async () => {
      const rows = await db.query<any>(
        `SELECT ft.id, ft.transaction_date, ft.transaction_type, ft.category, ft.amount, ft.payment_method, ft.created_at,
                COALESCE(r.full_name, c.full_name, ft.payee_vendor) AS party
         FROM financial_transactions ft
         LEFT JOIN residents r ON r.id = ft.resident_id
         LEFT JOIN tiffin_customers c ON c.id = ft.customer_id
         WHERE ft.status = 'POSTED' AND ft.transaction_type <> 'REVERSAL' ${
           division === "PG"
             ? "AND (ft.transaction_type IN ('RENT_PAYMENT', 'RENT_CHARGE', 'SECURITY_DEPOSIT', 'DEPOSIT_REFUND') OR (ft.transaction_type = 'EXPENSE' AND COALESCE(ft.category, '') NOT IN ('GROCERY', 'KITCHEN_SUPPLIES')))"
             : division === "TIFFIN"
             ? "AND (ft.transaction_type IN ('TIFFIN_PAYMENT', 'TIFFIN_CHARGE') OR (ft.transaction_type = 'EXPENSE' AND ft.category IN ('GROCERY', 'KITCHEN_SUPPLIES')))"
             : ""
         }
         ORDER BY ft.created_at DESC
         LIMIT 12`
      );
      return rows.map((r) => ({
        id: r.id, date: r.transaction_date, type: r.transaction_type, category: r.category, amount: n(r.amount),
        method: r.payment_method || null, party: r.party || null, createdAt: r.created_at,
      }));
    }),
  ]);

  return { today: todayBlock, custody, people, money, charts, tiffin, recent, failed };
}
