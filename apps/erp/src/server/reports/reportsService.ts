import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission } from "../authorization/authorize";
import { RENT_RECEIPT_SQL, RENT_SETTLEMENT_SQL } from "../finance/financialDefinitions";
import { listStaffCustody } from "../delivery/deliveryService";
import { hasDeliveryOpsSchema, activeCollectionSql } from "../delivery/deliveryRules";
import { hasBedsSchema } from "../rooms/bedService";
import { businessToday, businessMonthStart } from "@/lib/businessDate";
import { AuthenticatedUser, Permission } from "@/types";

/**
 * Reports (Phase 8). Each report reads live records with the canonical definitions in
 * financialDefinitions.ts / FINANCIAL_DEFINITIONS.md and returns columns, rows, totals and, per
 * row, a link to the source records. A query that fails raises an error (shown as such on the
 * page); nothing is replaced by zero. Dates are business (IST) dates.
 */

export type ReportKey =
  | "daily-closing"
  | "rent-collection"
  | "occupancy"
  | "resident-ledger"
  | "expenses"
  | "tiffin-revenue"
  | "delivery"
  | "cash-custody"
  | "outstanding";

export type ColumnType = "text" | "date" | "money" | "number" | "percent";
export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}
export interface ReportResult {
  key: ReportKey;
  title: string;
  description: string;
  from: string;
  to: string;
  division: "COMBINED" | "PG" | "TIFFIN";
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null> & { _link?: string | null }>;
  totals: Record<string, number>;
  total: number;
  limit: number;
  offset: number;
}

export interface ReportOptions {
  from?: string;
  to?: string;
  division?: "COMBINED" | "PG" | "TIFFIN";
  search?: string;
  residentId?: string;
  limit?: number;
  offset?: number;
}

export const REPORTS: Array<{ key: ReportKey; title: string; description: string; permission: Permission; divisions: boolean }> = [
  { key: "daily-closing", title: "Daily cash closing", description: "Expected and counted cash per day, the difference and its reason.", permission: "finance.read", divisions: true },
  { key: "rent-collection", title: "Rent collection", description: "Per resident: rent charged and paid in the period, what is still owed and the last payment.", permission: "finance.read", divisions: false },
  { key: "occupancy", title: "Occupancy", description: "Per room on the last day of the period: beds, occupied, free, out of service or under maintenance.", permission: "rooms.read", divisions: false },
  { key: "resident-ledger", title: "Resident ledger", description: "Every rent charge, payment, deposit, deposit applied, refund and reversal. Choose a resident for a running balance.", permission: "finance.read", divisions: false },
  { key: "expenses", title: "Expenses", description: "Expenses paid in the period with category, payee and method.", permission: "finance.read", divisions: true },
  { key: "tiffin-revenue", title: "Tiffin revenue", description: "Tiffin invoices issued in the period: invoiced, paid and outstanding per customer.", permission: "finance.read", divisions: false },
  { key: "delivery", title: "Deliveries", description: "Per day and person: stops, delivered, not delivered, cancelled, reasons, money due and collected.", permission: "delivery.manage", divisions: false },
  { key: "cash-custody", title: "Cash with staff", description: "Per person: cash collected, handed over, accepted and the difference in the period, and what they hold now.", permission: "delivery.manage", divisions: false },
  { key: "outstanding", title: "Outstanding balances", description: "Residents' rent and tiffin customers' invoices still owed, each worked out per person.", permission: "finance.read", divisions: true },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const n = (v: unknown) => Number(v || 0);
const istStartUtc = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
const istEndUtc = (d: string) => new Date(new Date(`${d}T00:00:00+05:30`).getTime() + 86400000).toISOString();

type Built = { columns: ReportColumn[]; rows: ReportResult["rows"]; totalKeys: string[] };

async function build(db: AsyncDb, actor: AuthenticatedUser, key: ReportKey, o: Required<Pick<ReportOptions, "from" | "to" | "division">> & ReportOptions): Promise<Built> {
  const { from, to, division } = o;
  switch (key) {
    case "daily-closing": {
      const rows = await db.query<any>(
        `SELECT c.closing_date, c.division, c.expected_cash_balance, c.actual_cash_counted, c.cash_discrepancy, c.discrepancy_reason, c.status, s.full_name AS finalized_by
         FROM daily_cashbook_closings c LEFT JOIN staff_users s ON s.id = c.finalized_by
         WHERE c.closing_date >= ? AND c.closing_date <= ? ${division !== "COMBINED" ? "AND c.division = ?" : ""}
         ORDER BY c.closing_date DESC, c.division`,
        division !== "COMBINED" ? [from, to, division] : [from, to]
      );
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "division", label: "Division", type: "text" },
          { key: "expected", label: "Expected cash", type: "money" }, { key: "counted", label: "Cash counted", type: "money" },
          { key: "variance", label: "Difference", type: "money" }, { key: "reason", label: "Reason", type: "text" },
          { key: "status", label: "Status", type: "text" }, { key: "by", label: "Finalized by", type: "text" },
        ],
        rows: rows.map((r) => ({
          date: r.closing_date, division: r.division, expected: n(r.expected_cash_balance), counted: r.actual_cash_counted === null ? null : n(r.actual_cash_counted),
          variance: n(r.cash_discrepancy), reason: r.discrepancy_reason || null, status: r.status, by: r.finalized_by || null, _link: "/finance?tab=closing",
        })),
        totalKeys: ["expected", "counted", "variance"],
      };
    }
    case "rent-collection": {
      const rows = await db.query<any>(
        `SELECT r.id, r.full_name, rm.room_number,
           COALESCE(SUM(CASE WHEN ft.transaction_type = 'RENT_CHARGE' AND ft.transaction_date >= ? AND ft.transaction_date <= ? THEN ft.amount ELSE 0 END), 0) AS billed,
           COALESCE(SUM(CASE WHEN ${RENT_RECEIPT_SQL.replace(/\b(transaction_type|category|customer_id)\b/g, "ft.$1")} AND ft.transaction_date >= ? AND ft.transaction_date <= ? THEN ft.amount ELSE 0 END), 0) AS paid,
           COALESCE(SUM(CASE WHEN ft.transaction_type = 'RENT_PAYMENT' AND ft.category = 'DEPOSIT_APPLICATION' AND ft.transaction_date >= ? AND ft.transaction_date <= ? THEN ft.amount ELSE 0 END), 0) AS from_deposit,
           COALESCE(SUM(CASE WHEN ft.transaction_type = 'RENT_CHARGE' THEN ft.amount ELSE 0 END), 0)
             - COALESCE(SUM(CASE WHEN ${RENT_SETTLEMENT_SQL.replace(/\b(transaction_type|category|customer_id)\b/g, "ft.$1")} THEN ft.amount ELSE 0 END), 0) AS balance,
           MAX(CASE WHEN ${RENT_RECEIPT_SQL.replace(/\b(transaction_type|category|customer_id)\b/g, "ft.$1")} THEN ft.transaction_date END) AS last_payment
         FROM residents r
         JOIN financial_transactions ft ON ft.resident_id = r.id AND ft.status = 'POSTED'
         LEFT JOIN resident_stays s ON s.resident_id = r.id AND s.status = 'ACTIVE'
         LEFT JOIN rooms rm ON rm.id = s.room_id
         GROUP BY r.id, r.full_name, rm.room_number
         ORDER BY r.full_name`,
        [from, to, from, to, from, to]
      );
      return {
        columns: [
          { key: "resident", label: "Resident", type: "text" }, { key: "room", label: "Room", type: "text" },
          { key: "billed", label: "Rent charged", type: "money" }, { key: "paid", label: "Paid", type: "money" },
          { key: "fromDeposit", label: "From deposit", type: "money" }, { key: "outstanding", label: "Owed now", type: "money" },
          { key: "lastPayment", label: "Last payment", type: "date" },
        ],
        rows: rows
          .filter((r) => n(r.billed) > 0 || n(r.paid) > 0 || n(r.from_deposit) > 0 || n(r.balance) > 0)
          .map((r) => ({ resident: r.full_name, room: r.room_number || "—", billed: n(r.billed), paid: n(r.paid), fromDeposit: n(r.from_deposit), outstanding: Math.max(0, n(r.balance)), lastPayment: r.last_payment || null, _link: "/finance?tab=residents" })),
        totalKeys: ["billed", "paid", "fromDeposit", "outstanding"],
      };
    }
    case "occupancy": {
      const beds = await hasBedsSchema(db);
      const rows = await db.query<any>(
        `SELECT rm.id, rm.room_number, rm.floor, rm.capacity, rm.is_active,
           (SELECT COUNT(*) FROM resident_stays s WHERE s.room_id = rm.id AND s.check_in_date <= ? AND (s.check_out_date IS NULL OR s.check_out_date > ?) AND s.status IN ('ACTIVE', 'COMPLETED')) AS occupied
           ${beds ? `, (SELECT COUNT(*) FROM room_beds b WHERE b.room_id = rm.id AND b.status = 'OUT_OF_SERVICE') AS out_of_service,
                     (SELECT COUNT(*) FROM room_maintenance m WHERE m.room_id = rm.id AND m.start_date <= ? AND (m.end_date IS NULL OR m.end_date >= ?)) AS maintenance` : ""}
         FROM rooms rm ORDER BY rm.floor, rm.room_number`,
        beds ? [to, to, to, to] : [to, to]
      );
      return {
        columns: [
          { key: "room", label: "Room", type: "text" }, { key: "floor", label: "Floor", type: "number" }, { key: "capacity", label: "Beds", type: "number" },
          { key: "occupied", label: "Occupied", type: "number" }, { key: "unavailable", label: "Unavailable", type: "number" },
          { key: "vacant", label: "Free", type: "number" }, { key: "occupancy", label: "Occupancy", type: "percent" }, { key: "state", label: "State", type: "text" },
        ],
        rows: rows.filter((r) => Number(r.is_active)).map((r) => {
          const capacity = n(r.capacity);
          const occupied = n(r.occupied);
          const underMaintenance = n(r.maintenance) > 0;
          const unavailable = underMaintenance ? Math.max(0, capacity - occupied) : Math.min(n(r.out_of_service), Math.max(0, capacity - occupied));
          return {
            room: r.room_number, floor: n(r.floor), capacity, occupied, unavailable, vacant: Math.max(0, capacity - occupied - unavailable),
            occupancy: capacity > 0 ? Math.round((occupied / capacity) * 100) : 0, state: underMaintenance ? "Under maintenance" : "In use", _link: "/rooms",
          };
        }),
        totalKeys: ["capacity", "occupied", "unavailable", "vacant"],
      };
    }
    case "resident-ledger": {
      const params: any[] = [from, to];
      let residentFilter = "AND ft.resident_id IS NOT NULL";
      if (o.residentId) {
        residentFilter = "AND ft.resident_id = ?";
        params.push(o.residentId);
      }
      const rows = await db.query<any>(
        `SELECT ft.id, ft.transaction_date, ft.transaction_type, ft.category, ft.amount, ft.payment_method, ft.reference_number, ft.description, ft.status,
                r.full_name, orig.transaction_type AS reversed_type
         FROM financial_transactions ft
         JOIN residents r ON r.id = ft.resident_id
         LEFT JOIN financial_transactions orig ON orig.id = ft.reversal_of_id
         WHERE ft.transaction_date >= ? AND ft.transaction_date <= ? ${residentFilter}
           AND ft.transaction_type IN ('RENT_CHARGE', 'RENT_PAYMENT', 'SECURITY_DEPOSIT', 'DEPOSIT_REFUND', 'REVERSAL')
           AND ft.customer_id IS NULL
         ORDER BY ft.transaction_date ASC, ft.created_at ASC`,
        params
      );
      const label = (r: any) =>
        r.transaction_type === "RENT_CHARGE" ? "Rent charged" :
        r.transaction_type === "RENT_PAYMENT" ? (r.category === "DEPOSIT_APPLICATION" ? "Deposit applied to rent" : "Rent paid") :
        r.transaction_type === "SECURITY_DEPOSIT" ? "Deposit received" :
        r.transaction_type === "DEPOSIT_REFUND" ? "Deposit refunded" : `Reversal of ${String(r.reversed_type || "entry").toLowerCase().replace(/_/g, " ")}`;
      // Running rent balance (only meaningful for one resident): charges add, rent settled subtracts.
      let balance = 0;
      const out = rows.map((r) => {
        const amt = n(r.amount);
        const counts = r.status === "POSTED";
        let charge = 0;
        let credit = 0;
        if (counts && r.transaction_type === "RENT_CHARGE") charge = amt;
        if (counts && r.transaction_type === "RENT_PAYMENT") credit = amt;
        balance += charge - credit;
        return {
          date: r.transaction_date, resident: r.full_name, entry: label(r), method: r.payment_method || null, reference: r.reference_number || null,
          charge: charge || null, credit: credit || null, deposit: counts && r.transaction_type === "SECURITY_DEPOSIT" ? amt : counts && r.transaction_type === "DEPOSIT_REFUND" ? -amt : null,
          status: r.status === "REVERSED" ? "Reversed" : "Posted", balance: o.residentId ? balance : null, _link: "/finance?tab=residents",
        };
      });
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "resident", label: "Resident", type: "text" }, { key: "entry", label: "Entry", type: "text" },
          { key: "method", label: "Method", type: "text" }, { key: "reference", label: "Reference", type: "text" },
          { key: "charge", label: "Charged", type: "money" }, { key: "credit", label: "Settled", type: "money" }, { key: "deposit", label: "Deposit ±", type: "money" },
          { key: "status", label: "Status", type: "text" }, ...(o.residentId ? [{ key: "balance", label: "Rent balance", type: "money" as ColumnType }] : []),
        ],
        rows: out,
        totalKeys: ["charge", "credit", "deposit"],
      };
    }
    case "expenses": {
      const div = division === "PG" ? "AND ft.category NOT IN ('GROCERY', 'KITCHEN_SUPPLIES', 'LPG')" : division === "TIFFIN" ? "AND ft.category IN ('GROCERY', 'KITCHEN_SUPPLIES', 'LPG')" : "";
      const rows = await db.query<any>(
        `SELECT ft.transaction_date, ft.category, ft.payee_vendor, ft.payment_method, ft.amount, ft.reference_number, ft.description
         FROM financial_transactions ft
         WHERE ft.transaction_type = 'EXPENSE' AND ft.status = 'POSTED' AND ft.transaction_date >= ? AND ft.transaction_date <= ? ${div}
         ORDER BY ft.transaction_date DESC, ft.created_at DESC`,
        [from, to]
      );
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "category", label: "Category", type: "text" }, { key: "payee", label: "Paid to", type: "text" },
          { key: "method", label: "Method", type: "text" }, { key: "amount", label: "Amount", type: "money" }, { key: "reference", label: "Reference", type: "text" },
          { key: "description", label: "Details", type: "text" },
        ],
        rows: rows.map((r) => ({ date: r.transaction_date, category: String(r.category).replace(/_/g, " ").toLowerCase(), payee: r.payee_vendor || null, method: r.payment_method || null, amount: n(r.amount), reference: r.reference_number || null, description: r.description || null, _link: "/finance" })),
        totalKeys: ["amount"],
      };
    }
    case "tiffin-revenue": {
      const rows = await db.query<any>(
        `SELECT i.id, i.invoice_number, i.billing_period, i.issue_date, i.total_amount, i.amount_paid, i.balance_due, i.status, c.full_name,
                (SELECT string_agg(ii.description, ', ') FROM invoice_items ii WHERE ii.invoice_id = i.id) AS items
         FROM invoices i JOIN tiffin_customers c ON c.id = i.customer_id
         WHERE i.invoice_category = 'TIFFIN' AND i.status IN ('ISSUED', 'PARTIALLY_PAID', 'PAID') AND i.issue_date >= ? AND i.issue_date <= ?
         ORDER BY i.issue_date DESC`,
        [from, to]
      );
      return {
        columns: [
          { key: "customer", label: "Customer", type: "text" }, { key: "invoice", label: "Invoice", type: "text" }, { key: "period", label: "Billing period", type: "text" },
          { key: "items", label: "Items", type: "text" }, { key: "invoiced", label: "Invoiced", type: "money" }, { key: "paid", label: "Paid", type: "money" },
          { key: "outstanding", label: "Outstanding", type: "money" }, { key: "status", label: "Status", type: "text" },
        ],
        rows: rows.map((r) => ({ customer: r.full_name, invoice: r.invoice_number || "—", period: r.billing_period, items: r.items || null, invoiced: n(r.total_amount), paid: n(r.amount_paid), outstanding: n(r.balance_due), status: String(r.status).replace(/_/g, " ").toLowerCase(), _link: "/tiffin?tab=billing" })),
        totalKeys: ["invoiced", "paid", "outstanding"],
      };
    }
    case "delivery": {
      const rows = await db.query<any>(
        `SELECT t.service_date, t.meal_type, COALESCE(u.full_name, 'Unassigned') AS person,
           COUNT(*) AS stops,
           SUM(CASE WHEN t.status = 'DELIVERED' THEN 1 ELSE 0 END) AS delivered,
           SUM(CASE WHEN t.status = 'EXCEPTION' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN t.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
           SUM(CASE WHEN t.status IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY') THEN 1 ELSE 0 END) AS open,
           COALESCE(SUM((SELECT SUM(COALESCE(oi.delivered_quantity, 0) * oi.unit_price) FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.delivery_task_id = t.id AND t.status = 'DELIVERED')), 0) AS due,
           COALESCE(SUM((SELECT SUM(dc.amount) FROM delivery_collections dc WHERE dc.delivery_task_id = t.id${(await hasDeliveryOpsSchema(db)) ? ` AND ${activeCollectionSql("dc")}` : ""})), 0) AS collected,
           string_agg(DISTINCT NULLIF(t.exception_reason, ''), '; ') AS reasons
         FROM delivery_tasks t LEFT JOIN staff_users u ON u.id = t.assigned_to
         WHERE t.service_date >= ? AND t.service_date <= ?
         GROUP BY t.service_date, t.meal_type, COALESCE(u.full_name, 'Unassigned')
         ORDER BY t.service_date DESC, t.meal_type, person`,
        [from, to]
      );
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "meal", label: "Meal", type: "text" }, { key: "person", label: "Person", type: "text" },
          { key: "stops", label: "Stops", type: "number" }, { key: "delivered", label: "Delivered", type: "number" }, { key: "failed", label: "Not delivered", type: "number" },
          { key: "cancelled", label: "Cancelled", type: "number" }, { key: "open", label: "Still open", type: "number" },
          { key: "due", label: "Due at the door", type: "money" }, { key: "collected", label: "Collected", type: "money" }, { key: "reasons", label: "Reasons not delivered", type: "text" },
        ],
        rows: rows.map((r) => ({
          date: r.service_date, meal: String(r.meal_type).toLowerCase(), person: r.person, stops: n(r.stops), delivered: n(r.delivered), failed: n(r.failed), cancelled: n(r.cancelled), open: n(r.open),
          due: n(r.due), collected: n(r.collected), reasons: r.reasons || null, _link: `/delivery?tab=board&date=${r.service_date}&meal=${r.meal_type}`,
        })),
        totalKeys: ["stops", "delivered", "failed", "cancelled", "open", "due", "collected"],
      };
    }
    case "cash-custody": {
      const [collected, handovers, now] = await Promise.all([
        db.query<any>(
          `SELECT dc.collected_by, u.full_name,
             SUM(CASE WHEN dc.payment_method = 'CASH' THEN dc.amount ELSE 0 END) AS cash,
             SUM(CASE WHEN dc.payment_method = 'UPI' THEN dc.amount ELSE 0 END) AS upi
           FROM delivery_collections dc JOIN staff_users u ON u.id = dc.collected_by
           WHERE dc.collected_at >= ? AND dc.collected_at < ?${(await hasDeliveryOpsSchema(db)) ? ` AND ${activeCollectionSql("dc")}` : ""}
           GROUP BY dc.collected_by, u.full_name`,
          [istStartUtc(from), istEndUtc(to)]
        ),
        db.query<any>(
          `SELECT h.driver_id, u.full_name,
             SUM(h.declared_cash) AS declared,
             SUM(CASE WHEN h.status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED') THEN h.accepted_cash ELSE 0 END) AS accepted,
             SUM(CASE WHEN h.status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED') THEN h.declared_cash - h.accepted_cash ELSE 0 END) AS short,
             SUM(CASE WHEN h.status = 'DECLARED' THEN h.declared_cash ELSE 0 END) AS awaiting
           FROM driver_cash_handovers h JOIN staff_users u ON u.id = h.driver_id
           WHERE h.shift_date >= ? AND h.shift_date <= ?
           GROUP BY h.driver_id, u.full_name`,
          [from, to]
        ),
        listStaffCustody(actor, db).then((r) => r.staff),
      ]);
      const people = new Map<string, any>();
      const row = (id: string, name: string) => {
        if (!people.has(id)) people.set(id, { person: name, cash: 0, upi: 0, declared: 0, awaiting: 0, accepted: 0, short: 0, holdingNow: 0 });
        return people.get(id);
      };
      for (const c of collected) Object.assign(row(c.collected_by, c.full_name), { cash: n(c.cash), upi: n(c.upi) });
      for (const h of handovers) Object.assign(row(h.driver_id, h.full_name), { declared: n(h.declared), accepted: n(h.accepted), short: n(h.short), awaiting: n(h.awaiting) });
      for (const s of now) if (people.has(s.staffId) || s.cashPending > 0) row(s.staffId, s.staffName).holdingNow = s.cashPending;
      return {
        columns: [
          { key: "person", label: "Person", type: "text" }, { key: "cash", label: "Cash collected", type: "money" }, { key: "upi", label: "UPI collected", type: "money" },
          { key: "declared", label: "Cash handed over", type: "money" }, { key: "awaiting", label: "Waiting to be accepted", type: "money" },
          { key: "accepted", label: "Accepted", type: "money" }, { key: "short", label: "Short", type: "money" }, { key: "holdingNow", label: "Still holding now", type: "money" },
        ],
        rows: Array.from(people.values()).map((p) => ({ ...p, _link: "/delivery?tab=custody" })).sort((a, b) => String(a.person).localeCompare(String(b.person))),
        totalKeys: ["cash", "upi", "declared", "awaiting", "accepted", "short", "holdingNow"],
      };
    }
    case "outstanding": {
      const residents = division === "TIFFIN" ? [] : await db.query<any>(
        `SELECT * FROM (
           SELECT r.full_name AS name, rm.room_number AS place, MAX(CASE WHEN ${RENT_RECEIPT_SQL.replace(/\b(transaction_type|category|customer_id)\b/g, "ft.$1")} THEN ft.transaction_date END) AS last_payment,
             SUM(CASE WHEN ft.transaction_type = 'RENT_CHARGE' THEN ft.amount ELSE 0 END) - SUM(CASE WHEN ${RENT_SETTLEMENT_SQL.replace(/\b(transaction_type|category|customer_id)\b/g, "ft.$1")} THEN ft.amount ELSE 0 END) AS due
           FROM residents r
           JOIN financial_transactions ft ON ft.resident_id = r.id AND ft.status = 'POSTED'
           LEFT JOIN resident_stays s ON s.resident_id = r.id AND s.status = 'ACTIVE'
           LEFT JOIN rooms rm ON rm.id = s.room_id
           GROUP BY r.id, r.full_name, rm.room_number
         ) x WHERE due > 0 ORDER BY due DESC`
      );
      const customers = division === "PG" ? [] : await db.query<any>(
        `SELECT c.full_name AS name, c.phone AS place, SUM(i.balance_due) AS due, MAX(i.due_date) AS last_due
         FROM invoices i JOIN tiffin_customers c ON c.id = i.customer_id
         WHERE i.invoice_category = 'TIFFIN' AND i.status IN ('ISSUED', 'PARTIALLY_PAID') AND i.balance_due > 0
         GROUP BY c.id, c.full_name, c.phone
         ORDER BY due DESC`
      );
      return {
        columns: [
          { key: "kind", label: "Owed by", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "place", label: "Room / phone", type: "text" },
          { key: "due", label: "Owed", type: "money" }, { key: "date", label: "Last payment / due date", type: "date" },
        ],
        rows: [
          ...residents.map((r) => ({ kind: "Resident (rent)", name: r.name, place: r.place || "Left", due: n(r.due), date: r.last_payment || null, _link: "/finance?tab=residents" })),
          ...customers.map((c) => ({ kind: "Tiffin customer", name: c.name, place: c.place, due: n(c.due), date: c.last_due || null, _link: "/tiffin?tab=billing" })),
        ],
        totalKeys: ["due"],
      };
    }
  }
}

export async function runReport(actor: AuthenticatedUser, key: ReportKey, options: ReportOptions = {}, asyncDb?: AsyncDb): Promise<ReportResult> {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw new Error("Unknown report.");
  requirePermission(actor, def.permission, { action: `reports.${key}` });
  const db = asyncDb ?? getAsyncDb();
  const to = options.to && DATE.test(options.to) ? options.to : businessToday();
  const from = options.from && DATE.test(options.from) ? options.from : businessMonthStart();
  if (from > to) throw new Error("The start date must be on or before the end date.");
  const division = def.divisions && (options.division === "PG" || options.division === "TIFFIN") ? options.division : "COMBINED";
  const built = await build(db, actor, key, { ...options, from, to, division });
  const q = options.search?.trim().toLowerCase();
  const textKeys = built.columns.filter((c) => c.type === "text" || c.type === "date").map((c) => c.key);
  const rows = q ? built.rows.filter((r) => textKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(q))) : built.rows;
  const totals: Record<string, number> = {};
  for (const k of built.totalKeys) totals[k] = rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const limit = Math.min(500, Math.max(1, Number(options.limit) || 50));
  const offset = Math.max(0, Number(options.offset) || 0);
  return { key, title: def.title, description: def.description, from, to, division, columns: built.columns, rows: rows.slice(offset, offset + limit), totals, total: rows.length, limit, offset };
}

/** All rows (for CSV), same filters. */
export async function runReportForExport(actor: AuthenticatedUser, key: ReportKey, options: ReportOptions = {}, asyncDb?: AsyncDb) {
  return runReport(actor, key, { ...options, limit: 500, offset: 0 }, asyncDb).then(async (first) => {
    if (first.total <= first.rows.length) return first;
    const all = [...first.rows];
    for (let off = 500; off < first.total; off += 500) all.push(...(await runReport(actor, key, { ...options, limit: 500, offset: off }, asyncDb)).rows);
    return { ...first, rows: all, limit: all.length };
  });
}

/** CSV with every cell guarded against spreadsheet formula injection. */
export function reportToCsv(r: ReportResult): string {
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    let s = String(value);
    if (["=", "+", "-", "@", "\t", "\r"].includes(s.charAt(0))) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [r.columns.map((c) => cell(c.label)).join(",")];
  for (const row of r.rows) lines.push(r.columns.map((c) => cell(row[c.key])).join(","));
  if (Object.keys(r.totals).length > 0) lines.push(r.columns.map((c, i) => cell(i === 0 ? "Total" : c.key in r.totals ? r.totals[c.key] : "")).join(","));
  return lines.join("\r\n");
}
