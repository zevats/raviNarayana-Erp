import crypto from "crypto";
import { getAsyncDb, AsyncDb } from "../database/db";
import { requirePermission, AuthorizationError } from "../authorization/authorize";
import { hasPermission } from "../authorization/permissions";
import { loadOrderLedgers, applyOldestFirst } from "./orderLedger";
import { recordAuditEventAsync } from "../audit/audit";
import { assertClosingDateNotFinalized, acquireLedgerKeyLock, getBusinessDateString } from "../finance/financeService";
import { hasDeliveryOpsSchema, DISPOSITIONS, subscriptionDayEligibility, activeCollectionSql } from "./deliveryRules";
import { hasPayLaterSchema } from "../database/schemaFeatures";
import { notifyStopsAssigned } from "../notifications/pushService";
import { hasCashShortfallSchema, hasDineInPayLaterSchema } from "../database/schemaFeatures";
import { getSettings } from "../settings/settingsService";
import {
  AuthenticatedUser,
  MealType,
  DeliveryStatus,
  DeliveryExceptionType,
  DeliveryEventType,
  DeliveryTask,
  DeliveryTaskEvent,
  DeliveryBatchGenerationResult,
  DeliveryDashboardSummary,
  DeliveryOrderType,
  DeliveryCollectionStatus,
  DriverHandoverStatus,
  DriverCashHandover,
  DeclareCashHandoverInput,
  AcceptCashHandoverInput,
  DriverCustodySummary,
  QueuedDeliveryAction,
  RecordDeliveryCollectionInput,
  CompleteDeliveryTaskInput,
  CreateExternalDeliveryTaskInput,
  BatchAssignDeliveryTasksInput,
  BatchAssignDeliveryTasksResult,
  BatchDispatchDeliveryTasksInput,
  BatchDispatchDeliveryTasksResult,
  OrderItem,
  DeliveryOrderLine,
  DeliveryLine,
  DeliveryDisposition,
  StaffCustodyRow,
  StaffCustodyCollection,
  PaymentMethod,
  normalizePaymentMethod,
  tryNormalizePaymentMethod,
} from "@/types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_MEAL_TYPES: readonly MealType[] = ["BREAKFAST", "LUNCH", "DINNER"];

const VALID_EXCEPTION_TYPES: readonly DeliveryExceptionType[] = [
  "RESIDENT_UNAVAILABLE",
  "RESIDENT_DECLINED",
  "LOCATION_UNCLEAR",
  "MEAL_DAMAGED_OR_MISSING",
  "OTHER",
];

export interface GenerateDeliveryTasksInput {
  serviceDate: string; // YYYY-MM-DD
  mealType: MealType;
}

export interface AssignDeliveryTaskInput {
  assignedToStaffId: string;
  /** Optional note on why (kept in the delivery's history), e.g. "Owner taking this one himself". */
  reason?: string;
}

/**
 * Who may be given a delivery: an active delivery staff member, or the Owner/Manager who is making
 * the change taking that one delivery themselves. A self-assignment is a single-delivery override:
 * it gives no delivery-staff role or access to the delivery staff app, it is not the default for
 * later orders, and the daily list never carries it over as the "usual delivery person".
 */
async function resolveAssignee(
  db: AsyncDb,
  actor: AuthenticatedUser,
  staffId: string
): Promise<{ id: string; fullName: string; role: string; selfFulfilment: boolean }> {
  const staff = await db.queryOne<any>(`
    SELECT id, full_name as "fullName", role, is_active as "isActive"
    FROM staff_users
    WHERE id = ?
  `, [staffId]);
  if (!staff) {
    throw new Error(`Staff member '${staffId}' not found.`);
  }
  if (!Number(staff.isActive)) {
    throw new Error(`Staff member '${staff.fullName}' is currently inactive and cannot receive delivery assignments.`);
  }
  if (staff.role === "DELIVERY_PERSON") {
    return { id: staff.id, fullName: staff.fullName, role: staff.role, selfFulfilment: false };
  }
  const managesDeliveries = staff.role === "SUPER_ADMIN" || staff.role === "OPERATIONS_MANAGER";
  if (managesDeliveries && staff.id === actor.id) {
    return { id: staff.id, fullName: staff.fullName, role: staff.role, selfFulfilment: true };
  }
  throw new Error(
    managesDeliveries
      ? `Only ${staff.fullName} can take a delivery for themselves. Assign it to delivery staff, or to yourself.`
      : `Staff member '${staff.fullName}' holds role '${staff.role}'. Only active DELIVERY_PERSON staff can be assigned delivery tasks.`
  );
}

export interface ReportDeliveryExceptionInput {
  exceptionType: DeliveryExceptionType;
  reason: string;
}

export interface RetryDeliveryTaskInput {
  reassignToStaffId?: string;
  notes?: string;
}

export interface ListDeliveryTasksOptions {
  serviceDate?: string;
  mealType?: MealType;
  status?: DeliveryStatus;
  assignedTo?: string;
  orderType?: DeliveryOrderType;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Safely strips internal system markers such as [ORDER_JSON:{...}] from notes,
 * returning only genuine human notes or null if empty.
 */
export function extractCleanUserNotes(notes: string | null | undefined): string | null {
  if (!notes || typeof notes !== "string") return null;
  const marker = "[ORDER_JSON:";
  const startIdx = notes.indexOf(marker);
  if (startIdx === -1) {
    const trimmed = notes.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  const jsonStart = startIdx + marker.length;
  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < notes.length; i++) {
    const ch = notes[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0 && ch === "}") {
          if (i + 1 < notes.length && notes[i + 1] === "]") {
            endIdx = i + 2;
          } else {
            endIdx = i + 1;
          }
          break;
        }
      }
    }
  }

  let cleaned = notes;
  if (endIdx !== -1) {
    cleaned = notes.slice(0, startIdx) + notes.slice(endIdx);
  } else {
    const closeBracket = notes.indexOf("}]", jsonStart);
    if (closeBracket !== -1) {
      cleaned = notes.slice(0, startIdx) + notes.slice(closeBracket + 2);
    }
  }

  const trimmed = cleaned.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Extracts structured metadata JSON from bracketed string [ORDER_JSON:{...}]
 */
function extractOrderMetadataJson(notes: string | null | undefined): any | null {
  if (!notes || typeof notes !== "string" || !notes.includes("[ORDER_JSON:")) {
    return null;
  }
  const marker = "[ORDER_JSON:";
  const startIdx = notes.indexOf(marker);
  if (startIdx === -1) return null;
  const jsonStart = startIdx + marker.length;

  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < notes.length; i++) {
    const ch = notes[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{" || ch === "[") {
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 0 && ch === "}") {
          endIdx = i + 1;
          break;
        }
      }
    }
  }

  if (endIdx === -1) return null;
  try {
    return JSON.parse(notes.slice(jsonStart, endIdx));
  } catch {
    return null;
  }
}

function mapRowToDeliveryTask(row: any): DeliveryTask {
  let parsedItems: OrderItem[] | undefined = undefined;
  if (row.delivery_notes && typeof row.delivery_notes === "string" && row.delivery_notes.includes("[ORDER_JSON:")) {
    const meta = extractOrderMetadataJson(row.delivery_notes);
    if (meta && Array.isArray(meta.items)) {
      parsedItems = meta.items;
    }
  }

  return {
    id: row.id,
    orderType: (row.order_type as any) || "RESIDENT",
    mealRecordId: row.meal_record_id || null,
    planId: row.plan_id,
    subscriptionId: row.subscription_id || null,
    serviceDate: row.service_date,
    mealType: row.meal_type as MealType,
    residentId: row.resident_id || null,
    residentName: row.resident_name || row.customer_name || null,
    roomNumber: row.room_number || null,
    floor: row.floor !== null && row.floor !== undefined ? Number(row.floor) : null,
    stayId: row.stay_id || null,
    customerName: row.customer_name || row.resident_name || null,
    customerPhone: row.customer_phone || null,
    deliveryAddress: row.delivery_address || (row.room_number ? `Room ${row.room_number}, Floor ${row.floor}` : null),
    invoiceId: row.invoice_id || null,
    invoiceItemId: row.invoice_item_id || null,
    billedAt: row.billed_at || null,
    collectionStatus: (row.collection_status as DeliveryCollectionStatus) || "NONE",
    collectedAmount: row.collected_amount !== null && row.collected_amount !== undefined ? Number(row.collected_amount) : 0,
    collectedPaymentMethod: row.collected_payment_method || null,
    collectionTransactionId: row.collection_transaction_id || null,
    collectionIdempotencyKey: row.collection_idempotency_key || null,
    handoverId: row.handover_id || null,
    status: row.status as DeliveryStatus,
    assignedTo: row.assigned_to || null,
    assignedToName: row.assigned_to_name || null,
    assignedBy: row.assigned_by || null,
    assignedAt: row.assigned_at || null,
    dispatchedAt: row.dispatched_at || null,
    dispatchedBy: row.dispatched_by || null,
    deliveredAt: row.delivered_at || null,
    deliveredBy: row.delivered_by || null,
    deliveryNotes: extractCleanUserNotes(row.delivery_notes),
    items: parsedItems,
    recipientName: row.recipient_name || null,
    exceptionType: row.exception_type ? (row.exception_type as DeliveryExceptionType) : null,
    exceptionReason: row.exception_reason || null,
    exceptionAt: row.exception_at || null,
    exceptionBy: row.exception_by || null,
    cancelledAt: row.cancelled_at || null,
    cancelledBy: row.cancelled_by || null,
    cancelReason: row.cancel_reason || null,
    cutoffOverride: Number(row.cutoff_override || 0) === 1,
    resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by || null,
    resolutionNote: row.resolution_note || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Structured orders behind delivery tasks (orders / order_items, migration 0012)
// ---------------------------------------------------------------------------

let ordersTablesCheckedAt = 0;
let ordersTablesPresent = false;

/**
 * Whether the orders tables exist. Checked with a catalog lookup instead of catching a failed
 * query (a failed statement aborts a PostgreSQL transaction). A missing result is re-checked
 * after a minute so applying the migration is picked up without a restart.
 */
async function hasOrderTables(db: AsyncDb): Promise<boolean> {
  if (ordersTablesPresent) return true;
  if (Date.now() - ordersTablesCheckedAt < 60_000) return false;
  const row = db.isPostgres
    ? await db.queryOne<{ t: string | null }>("SELECT to_regclass('public.order_items')::text AS t")
    : await db.queryOne<{ t: string | null }>("SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name = 'order_items'");
  ordersTablesPresent = Boolean(row?.t);
  ordersTablesCheckedAt = Date.now();
  return ordersTablesPresent;
}

interface TaskOrderData {
  orderId: string;
  lines: DeliveryOrderLine[];
}

/** Loads the order lines for the given delivery tasks in one query (keyed by task id). */
async function loadTaskOrders(db: AsyncDb, taskIds: string[]): Promise<Map<string, TaskOrderData>> {
  const byTask = new Map<string, TaskOrderData>();
  if (taskIds.length === 0 || !(await hasOrderTables(db))) return byTask;
  const placeholders = taskIds.map(() => "?").join(", ");
  const disposition = (await hasDeliveryOpsSchema(db)) ? "oi.undelivered_disposition" : "NULL";
  const rows = await db.query<any>(
    `SELECT o.delivery_task_id, o.id AS order_id, oi.id AS item_id, oi.product_name, oi.quantity,
            oi.unit_price, oi.line_total, oi.delivered_quantity, oi.undelivered_reason,
            ${disposition} AS undelivered_disposition
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.delivery_task_id IN (${placeholders})
     ORDER BY o.delivery_task_id, oi.line_no`,
    taskIds
  );
  for (const r of rows) {
    const entry: TaskOrderData = byTask.get(r.delivery_task_id) ?? { orderId: r.order_id, lines: [] };
    entry.lines.push({
      orderItemId: r.item_id,
      productName: r.product_name,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unit_price),
      lineTotal: Number(r.line_total),
      deliveredQuantity: r.delivered_quantity === null || r.delivered_quantity === undefined ? null : Number(r.delivered_quantity),
      undeliveredReason: r.undelivered_reason || null,
      undeliveredDisposition: (r.undelivered_disposition as DeliveryDisposition) || null,
    });
    byTask.set(r.delivery_task_id, entry);
  }
  return byTask;
}

/** Item lines of deliveries without an order (subscription / resident meals, migration 0014). */
async function loadTaskItems(db: AsyncDb, taskIds: string[]): Promise<Map<string, DeliveryLine[]>> {
  const byTask = new Map<string, DeliveryLine[]>();
  if (taskIds.length === 0 || !(await hasDeliveryOpsSchema(db))) return byTask;
  const rows = await db.query<any>(
    `SELECT id, task_id, product_name, quantity, delivered_quantity, undelivered_reason, undelivered_disposition
     FROM delivery_task_items WHERE task_id IN (${taskIds.map(() => "?").join(", ")})
     ORDER BY task_id, line_no`,
    taskIds
  );
  for (const r of rows) {
    const lines = byTask.get(r.task_id) ?? [];
    lines.push({
      lineId: r.id,
      source: "TASK",
      productName: r.product_name,
      quantity: Number(r.quantity),
      unitPrice: null,
      deliveredQuantity: r.delivered_quantity === null || r.delivered_quantity === undefined ? null : Number(r.delivered_quantity),
      undeliveredReason: r.undelivered_reason || null,
      disposition: (r.undelivered_disposition as DeliveryDisposition) || null,
    });
    byTask.set(r.task_id, lines);
  }
  return byTask;
}

const tablePresence = new Map<string, { present: boolean; at: number }>();
async function tableExists(db: AsyncDb, table: string): Promise<boolean> {
  const known = tablePresence.get(table);
  if (known && (known.present || Date.now() - known.at < 60_000)) return known.present;
  const row = db.isPostgres
    ? await db.queryOne<{ t: string | null }>("SELECT to_regclass(?)::text AS t", [`public.${table}`])
    : await db.queryOne<{ t: string | null }>("SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
  tablePresence.set(table, { present: Boolean(row?.t), at: Date.now() });
  return Boolean(row?.t);
}

/** Σ recorded collections per delivery (delivery_collections is the source of truth for money). */
async function loadCollectedTotals(db: AsyncDb, taskIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (taskIds.length === 0 || !(await tableExists(db, "delivery_collections"))) return totals;
  const active = (await hasDeliveryOpsSchema(db)) ? ` AND ${activeCollectionSql("dc")}` : "";
  const rows = await db.query<any>(
    `SELECT dc.delivery_task_id, SUM(dc.amount) AS total FROM delivery_collections dc
     WHERE dc.delivery_task_id IN (${taskIds.map(() => "?").join(", ")})${active} GROUP BY dc.delivery_task_id`,
    taskIds
  );
  for (const r of rows) totals.set(r.delivery_task_id, Number(r.total || 0));
  return totals;
}

/** Live landmark and standing delivery instructions from the customer behind each delivery. */
type CustomerHint = {
  landmark: string | null;
  instructions: string | null;
  customerId?: string | null;
  payLaterAllowed?: boolean;
  paymentChoice?: "CASH" | "UPI" | "PAY_LATER" | null;
  paymentReview?: string | null;
};

async function loadCustomerHints(db: AsyncDb, tasks: DeliveryTask[]): Promise<Map<string, CustomerHint>> {
  const hints = new Map<string, CustomerHint>();
  const subIds = Array.from(new Set(tasks.map((t) => t.subscriptionId).filter(Boolean))) as string[];
  const orderIds = Array.from(new Set(tasks.map((t) => t.orderId).filter(Boolean))) as string[];
  // The subscription lookup runs alongside the order lookup below.
  const subRowsP = subIds.length > 0
    ? db.query<any>(
        `SELECT s.id, c.landmark, COALESCE(s.delivery_instructions, c.delivery_instructions) AS instructions
         FROM tiffin_subscriptions s JOIN tiffin_customers c ON c.id = s.customer_id
         WHERE s.id IN (${subIds.map(() => "?").join(", ")})`,
        subIds
      )
    : Promise.resolve([] as any[]);
  if (orderIds.length > 0) {
    // With migration 0021: whether the customer may pay later (only this yes/no reaches the
    // delivery app, never a balance), and what was chosen at the door.
    const pay = await hasPayLaterSchema(db);
    const rows = await db.query<any>(
      `SELECT o.id, o.customer_id, c.landmark, c.delivery_instructions AS instructions${pay ? ", c.pay_later_enabled, o.payment_choice, o.payment_review, o.payment_reviewed_at" : ""}
       FROM orders o LEFT JOIN tiffin_customers c ON c.id = o.customer_id
       WHERE o.id IN (${orderIds.map(() => "?").join(", ")})`,
      orderIds
    );
    for (const r of rows) {
      hints.set(`ord:${r.id}`, {
        landmark: r.landmark || null,
        instructions: r.instructions || null,
        customerId: r.customer_id || null,
        ...(pay
          ? {
              payLaterAllowed: true,
              paymentChoice: r.payment_choice || null,
              paymentReview: r.payment_review && !r.payment_reviewed_at ? r.payment_review : null,
            }
          : {}),
      });
    }
  }
  for (const r of await subRowsP) hints.set(`sub:${r.id}`, { landmark: r.landmark || null, instructions: r.instructions || null });
  return hints;
}

type CustomerBalance = { previous: number; earlierOrders: number; bills: number; credit: number };

/**
 * Balances of the customers behind these orders, from before each order (orderLedger: every payment
 * for the customer's delivered orders is one pool applied oldest first, so credit and earlier dues
 * never both show), plus open tiffin bills and unallocated tiffin payments. Also returns what each
 * delivered order itself still owes on that rule (an order covered by the customer's credit owes 0).
 */
async function loadCustomerBalances(
  db: AsyncDb,
  orderCustomer: Map<string, string>
): Promise<{ before: Map<string, CustomerBalance>; orderOpen: Map<string, number> }> {
  const before = new Map<string, CustomerBalance>();
  const orderOpen = new Map<string, number>();
  const customers = Array.from(new Set(orderCustomer.values()));
  if (customers.length === 0) return { before, orderOpen };
  const marks = customers.map(() => "?").join(", ");
  const [ledgers, bills, credits, dine] = await Promise.all([
    loadOrderLedgers(db, customers),
    db.query<{ customer_id: string; due: number | string }>(
      `SELECT customer_id, SUM(balance_due) AS due FROM invoices
       WHERE invoice_category = 'TIFFIN' AND status IN ('ISSUED', 'PARTIALLY_PAID') AND balance_due > 0 AND customer_id IN (${marks})
       GROUP BY customer_id`,
      customers
    ),
    db.query<{ customer_id: string; credit: number | string }>(
      `SELECT t.customer_id, SUM(t.amount - COALESCE(a.allocated, 0)) AS credit
       FROM financial_transactions t
       LEFT JOIN (SELECT payment_transaction_id, SUM(amount) AS allocated FROM invoice_payment_allocations GROUP BY payment_transaction_id) a ON a.payment_transaction_id = t.id
       WHERE t.transaction_type = 'TIFFIN_PAYMENT' AND t.status = 'POSTED' AND t.amount > COALESCE(a.allocated, 0) AND t.customer_id IN (${marks})
       GROUP BY t.customer_id`,
      customers
    ),
    // Dine-in orders on Pay Later, not paid yet (migration 0024): earlier dues too.
    hasDineInPayLaterSchema(db).then((ok) =>
      ok
        ? db.query<{ customer_id: string; owed: number | string }>(
            `SELECT customer_id, SUM(total_amount) AS owed FROM orders
             WHERE order_type = 'DINE_IN' AND payment_choice = 'PAY_LATER' AND financial_transaction_id IS NULL AND status <> 'CANCELLED' AND customer_id IN (${marks})
             GROUP BY customer_id`,
            customers
          )
        : []
    ),
  ]);
  const dineBy = new Map(dine.map((r) => [r.customer_id, Number(r.owed)]));
  const billBy = new Map(bills.map((b) => [b.customer_id, Number(b.due)]));
  const creditBy = new Map(credits.map((c) => [c.customer_id, Number(c.credit)]));
  for (const l of ledgers.values()) for (const o of l.orders) orderOpen.set(o.id, o.open);
  for (const [orderId, customerId] of orderCustomer) {
    const all = ledgers.get(customerId)?.orders ?? [];
    const others = all.some((o) => o.id === orderId) ? applyOldestFirst(all.filter((o) => o.id !== orderId)) : ledgers.get(customerId);
    const earlierOrders = (others?.owed ?? 0) + (dineBy.get(customerId) ?? 0);
    const bills = billBy.get(customerId) ?? 0;
    const credit = (others?.advance ?? 0) + (creditBy.get(customerId) ?? 0);
    before.set(orderId, { previous: earlierOrders + bills - credit, earlierOrders, bills, credit });
  }
  return { before, orderOpen };
}

/** Amount due for an order: delivered quantities once recorded, otherwise the full order. */
function expectedAmountFor(task: DeliveryTask, lines: DeliveryOrderLine[]): number {
  const outcomeRecorded = (task.status === "DELIVERED" || task.status === "EXCEPTION") && lines.every((l) => l.deliveredQuantity !== null);
  return lines.reduce((sum, l) => sum + (outcomeRecorded ? (l.deliveredQuantity as number) : l.quantity) * l.unitPrice, 0);
}

/** Adds the structured order, its value, the amount due and the balance to each task. */
async function attachOrderData(db: AsyncDb, tasks: DeliveryTask[]): Promise<DeliveryTask[]> {
  const ids = tasks.map((t) => t.id);
  // Independent reads run side by side (one database round trip instead of three).
  const [orders, items, collected] = await Promise.all([loadTaskOrders(db, ids), loadTaskItems(db, ids), loadCollectedTotals(db, ids)]);
  for (const task of tasks) {
    // Money collected comes from the collection records; the task's copied total is a fallback
    // only for databases without the custody ledger.
    if (collected.has(task.id)) task.collectedAmount = collected.get(task.id) as number;
    const order = orders.get(task.id);
    if (order) {
      task.orderId = order.orderId;
      task.orderLines = order.lines;
      task.orderTotal = order.lines.reduce((s, l) => s + l.lineTotal, 0);
      task.expectedAmount = expectedAmountFor(task, order.lines);
      task.balanceDue = Math.max(0, task.expectedAmount - (task.collectedAmount || 0));
      // The structured lines replace the transitional copy parsed from the notes.
      task.items = order.lines.map((l) => ({ productName: l.productName, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal }));
      task.lines = order.lines.map((l) => ({
        lineId: l.orderItemId,
        source: "ORDER",
        productName: l.productName,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        deliveredQuantity: l.deliveredQuantity,
        undeliveredReason: l.undeliveredReason,
        disposition: l.undeliveredDisposition ?? null,
      }));
      task.paymentMode = "DOORSTEP";
      continue;
    }
    task.lines = items.get(task.id) ?? [];
    // Subscriptions are billed monthly and resident meals are part of the stay: no doorstep amount.
    task.paymentMode = task.subscriptionId ? "MONTHLY" : task.orderType === "RESIDENT" ? "NONE" : "DOORSTEP";
    if (task.paymentMode !== "DOORSTEP") {
      task.expectedAmount = null;
      task.balanceDue = null;
    }
  }
  const hints = await loadCustomerHints(db, tasks);
  const orderCustomer = new Map<string, string>();
  for (const task of tasks) {
    const h = task.orderId ? hints.get(`ord:${task.orderId}`) : null;
    if (task.orderId && h?.customerId) orderCustomer.set(task.orderId, h.customerId);
  }
  const { before: balances, orderOpen } = await loadCustomerBalances(db, orderCustomer);
  for (const task of tasks) {
    if (task.orderId) task.customerBalance = balances.get(task.orderId) ?? null;
    // A delivered order of a customer owes what the customer's pool of payments has not covered
    // (oldest order first): credit from an earlier advance pays it even if nothing was collected here.
    if (task.orderId && orderOpen.has(task.orderId) && task.expectedAmount !== null && task.expectedAmount !== undefined) {
      const open = orderOpen.get(task.orderId) as number;
      const here = Math.max(0, task.expectedAmount - (task.collectedAmount || 0));
      task.balanceDue = open;
      task.creditApplied = Math.max(0, here - open);
    }
    const h = (task.subscriptionId && hints.get(`sub:${task.subscriptionId}`)) || (task.orderId && hints.get(`ord:${task.orderId}`)) || null;
    task.landmark = h?.landmark ?? null;
    task.deliveryInstructions = h?.instructions ?? null;
    if (task.orderId && h && h.payLaterAllowed !== undefined) {
      task.payLaterAllowed = h.payLaterAllowed;
      task.paymentChoice = h.paymentChoice ?? null;
      task.paymentReview = h.paymentReview ?? null;
    }
  }
  return tasks;
}

function mapRowToDeliveryEvent(row: any): DeliveryTaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    eventType: row.event_type as DeliveryEventType,
    fromStatus: row.from_status ? (row.from_status as DeliveryStatus) : null,
    toStatus: row.to_status as DeliveryStatus,
    actorId: row.actor_id,
    actorName: row.actor_name,
    notes: row.notes || null,
    createdAt: row.created_at,
  };
}

function mapRowToDriverCashHandover(row: any): DriverCashHandover {
  return {
    id: row.id,
    driverId: row.driver_id,
    driverName: row.driver_name || null,
    shiftDate: row.shift_date,
    declaredCash: Number(row.declared_cash || 0),
    recordedCash: Number(row.recorded_cash ?? row.declared_cash ?? 0),
    shortfallCash: Number(row.recorded_cash ?? row.declared_cash ?? 0) - Number(row.declared_cash || 0),
    shortfallReason: row.shortfall_reason || null,
    writtenOffCash: Number(row.written_off_cash || 0),
    writtenOffBy: row.written_off_by || null,
    writtenOffAt: row.written_off_at || null,
    writeOffReason: row.write_off_reason || null,
    acceptedCash: Number(row.accepted_cash || 0),
    variance: Number(row.variance || 0),
    varianceReason: row.variance_reason || null,
    status: row.status as DriverHandoverStatus,
    transactionId: row.transaction_id || null,
    declaredUpi: Number(row.declared_upi || 0),
    acceptedUpi: Number(row.accepted_upi || 0),
    upiTransactionId: row.upi_transaction_id || null,
    declaredBy: row.declared_by || null,
    declaredByName: row.declared_by_name || null,
    collectionCount: row.collection_count !== undefined ? Number(row.collection_count) : undefined,
    acceptedBy: row.accepted_by || null,
    acceptedByName: row.accepted_by_name || null,
    acceptedAt: row.accepted_at || null,
    notes: row.notes || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Handover with the employee, declarer and verifier names and its number of linked collections. */
const HANDOVER_SELECT = `
  SELECT h.*, u.full_name AS driver_name, a.full_name AS accepted_by_name, d.full_name AS declared_by_name,
         (SELECT COUNT(*) FROM delivery_collections dc WHERE dc.handover_id = h.id) AS collection_count
  FROM driver_cash_handovers h
  JOIN staff_users u ON u.id = h.driver_id
  LEFT JOIN staff_users a ON a.id = h.accepted_by
  LEFT JOIN staff_users d ON d.id = h.declared_by`;

/**
 * Returns eligible active commercial Tiffin subscriptions for a given service date and meal type.
 */
export async function getEligibleTiffinSubscriptionsForDate(
  actor: AuthenticatedUser,
  serviceDate: string,
  mealType: MealType,
  db: AsyncDb
): Promise<Array<{
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerType: string;
  dietaryPreference: string;
  productId: string;
  productName: string;
  quantityPerMeal: number;
  deliveryAddress: string;
  deliveryInstructions: string | null;
}>> {
  const rows = await db.query<any>(`
    SELECT
      s.id as subscription_id,
      s.customer_id,
      s.product_id,
      s.meal_types,
      s.service_days,
      s.quantity_per_meal,
      s.start_date,
      s.end_date,
      s.pause_start_date,
      s.pause_resume_date,
      s.status as subscription_status,
      s.delivery_address,
      s.delivery_instructions,
      c.full_name as customer_name,
      c.phone as customer_phone,
      c.customer_type,
      c.dietary_preference,
      c.delivery_address as customer_address,
      p.name as product_name
    FROM tiffin_subscriptions s
    JOIN tiffin_customers c ON s.customer_id = c.id
    JOIN tiffin_products p ON s.product_id = p.id
    WHERE s.status IN ('ACTIVE', 'PAUSED')
      AND c.status = 'ACTIVE'
      AND p.status = 'ACTIVE'
      AND s.start_date <= ?
      AND (s.end_date IS NULL OR s.end_date >= ?)
    ORDER BY c.full_name ASC
  `, [serviceDate, serviceDate]);

  const eligible: any[] = [];
  for (const row of rows) {
    const verdict = subscriptionDayEligibility(
      {
        status: row.subscription_status,
        mealTypes: row.meal_types,
        serviceDays: row.service_days,
        startDate: row.start_date,
        endDate: row.end_date,
        pauseStartDate: row.pause_start_date,
        pauseResumeDate: row.pause_resume_date,
      },
      serviceDate,
      mealType
    );
    if (!verdict.eligible) continue;

    eligible.push({
      subscriptionId: row.subscription_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerType: row.customer_type,
      dietaryPreference: row.dietary_preference,
      productId: row.product_id,
      productName: row.product_name,
      quantityPerMeal: row.quantity_per_meal || 1,
      deliveryAddress: row.delivery_address || row.customer_address || "Address pending",
      deliveryInstructions: row.delivery_instructions,
    });
  }

  return eligible;
}

/**
 * Generates delivery tasks from eligible, confirmed resident meal records for a confirmed kitchen plan.
 * Business rules enforced:
 * 1. Plan must exist and be in CONFIRMED or COMPLETED status (auto-provisions confirmed plan if absent).
 * 2. Opted-out residents are strictly excluded.
 * 3. Idempotent: Duplicate generation requests skip already existing tasks.
 * 4. Captures resident name and room number snapshots so future room updates/checkouts never rewrite past deliveries.
 * 5. Requires delivery.manage permission.
 */
export async function generateDeliveryTasks(
  actor: AuthenticatedUser,
  input: GenerateDeliveryTasksInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryBatchGenerationResult> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.tasks_generated" });

  const serviceDate = input.serviceDate?.trim();
  const mealType = input.mealType;

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }
  if (!VALID_MEAL_TYPES.includes(mealType)) {
    throw new Error(`Invalid meal type '${mealType}'. Must be BREAKFAST, LUNCH, or DINNER.`);
  }

  const db = asyncDb || getAsyncDb();

  // With migration 0014 installed this is the delivery list preparation (room-delivery residents
  // only, subscription skip / extra, item lines, auto-assignment, database-enforced uniqueness).
  // The code below is the earlier behaviour, kept for databases without it.
  if (await hasDeliveryOpsSchema(db)) {
    const { prepareDeliveryManifest } = await import("./deliveryOps");
    const run = await prepareDeliveryManifest(actor, { serviceDate, mealType, trigger: "MANUAL" }, clientIp, db);
    const planRow = await db.queryOne<{ id: string }>("SELECT id FROM daily_meal_plans WHERE service_date = ? AND meal_type = ?", [serviceDate, mealType]);
    return {
      planId: planRow?.id ?? "",
      serviceDate,
      mealType,
      createdCount: run.created,
      skippedCount: run.skipped,
      alreadyExistedCount: run.alreadyExisted,
      totalEligible: run.created + run.alreadyExisted + run.skipped,
      tasks: await listDeliveryTasks(actor, { serviceDate, mealType }, db),
    };
  }

  // 1. Verify or auto-provision kitchen meal plan
  let plan = await db.queryOne<any>(`
    SELECT id, status, planned_resident_count
    FROM daily_meal_plans
    WHERE service_date = ? AND meal_type = ?
  `, [serviceDate, mealType]);

  if (plan && plan.status === "DRAFT") {
    throw new Error(
      `Meal plan for ${mealType} on ${serviceDate} is currently in DRAFT status. Only CONFIRMED or COMPLETED meal plans can generate delivery tasks.`
    );
  }

  const now = new Date().toISOString();

  if (!plan) {
    const planId = `dmp_${crypto.randomUUID()}`;
    await db.execute(`
      INSERT INTO daily_meal_plans (
        id, service_date, meal_type, planned_resident_count, guest_count,
        final_preparation_count, actual_cooked_count, status, notes,
        created_by, created_at, updated_at
      ) VALUES (?, ?, ?, 0, 0, 0, 0, 'CONFIRMED', 'Auto-created for daily delivery generation', ?, ?, ?)
    `, [planId, serviceDate, mealType, actor.id, now, now]);
    plan = { id: planId, status: "CONFIRMED", planned_resident_count: 0 };
  }

  // 2. Fetch all resident meal records for this plan, joining current resident and room snapshots
  const mealRecords = await db.query<any>(`
    SELECT
      rmr.id as meal_record_id,
      rmr.resident_id,
      rmr.stay_id,
      rmr.status as meal_status,
      r.full_name as resident_name,
      rm.room_number,
      rm.floor
    FROM resident_meal_records rmr
    JOIN residents r ON r.id = rmr.resident_id
    JOIN resident_stays s ON s.id = rmr.stay_id
    JOIN rooms rm ON rm.id = s.room_id
    WHERE rmr.plan_id = ?
    ORDER BY rm.floor ASC, rm.room_number ASC
  `, [plan.id]);

  let createdCount = 0;
  let skippedCount = 0;
  let alreadyExistedCount = 0;

  await db.transaction(async (tx) => {
    for (const rec of mealRecords) {
      if (rec.meal_status === "OPTED_OUT") {
        skippedCount++;
        continue;
      }

      // Check if task already exists for this meal record using scoped tx
      const existing = await tx.queryOne(`
        SELECT id FROM delivery_tasks WHERE meal_record_id = ?
      `, [rec.meal_record_id]);

      if (existing) {
        alreadyExistedCount++;
        continue;
      }

      const taskId = `del_${crypto.randomUUID()}`;
      const eventId = `devt_${crypto.randomUUID()}`;

      await tx.execute(`
        INSERT INTO delivery_tasks (
          id, meal_record_id, plan_id, service_date, meal_type,
          resident_id, resident_name, room_number, floor, stay_id,
          status, assigned_to, assigned_to_name, assigned_by, assigned_at,
          dispatched_at, dispatched_by, delivered_at, delivered_by,
          delivery_notes, recipient_name, exception_type, exception_reason,
          exception_at, exception_by, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          'PENDING', NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL,
          NULL, NULL, ?, ?
        )
      `, [
        taskId,
        rec.meal_record_id,
        plan.id,
        serviceDate,
        mealType,
        rec.resident_id,
        rec.resident_name,
        rec.room_number,
        rec.floor,
        rec.stay_id,
        now,
        now,
      ]);

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, 'CREATED', NULL, 'PENDING', ?, ?, ?, ?)
      `, [
        eventId,
        taskId,
        actor.id,
        actor.fullName,
        "Delivery task generated from confirmed kitchen meal plan",
        now,
      ]);

      createdCount++;
    }

    // 2. Fetch eligible commercial Tiffin subscriptions for serviceDate and mealType
    let tiffinSubsLength = 0;
    try {
      const tiffinSubs = await getEligibleTiffinSubscriptionsForDate(actor, serviceDate, mealType, tx as any);
      tiffinSubsLength = tiffinSubs.length;
      for (const sub of tiffinSubs) {
        const existingSubTask = await tx.queryOne(`
          SELECT id FROM delivery_tasks WHERE plan_id = ? AND subscription_id = ?
        `, [plan.id, sub.subscriptionId]);

        if (existingSubTask) {
          alreadyExistedCount++;
          continue;
        }

        const taskId = `del_sub_${crypto.randomUUID()}`;
        const eventId = `devt_${crypto.randomUUID()}`;
        const deliveryNotes = sub.deliveryInstructions
          ? (sub.quantityPerMeal > 1 ? `Qty: ${sub.quantityPerMeal} | ${sub.deliveryInstructions}` : sub.deliveryInstructions)
          : (sub.quantityPerMeal > 1 ? `Qty: ${sub.quantityPerMeal} thalis` : null);

        await tx.execute(`
          INSERT INTO delivery_tasks (
            id, order_type, meal_record_id, plan_id, subscription_id, service_date, meal_type,
            resident_id, resident_name, room_number, floor, stay_id,
            customer_name, customer_phone, delivery_address, delivery_notes,
            status, created_at, updated_at
          ) VALUES (
            ?, 'EXTERNAL', NULL, ?, ?, ?, ?,
            NULL, ?, NULL, NULL, NULL,
            ?, ?, ?, ?,
            'PENDING', ?, ?
          )
        `, [
          taskId,
          plan.id,
          sub.subscriptionId,
          serviceDate,
          mealType,
          sub.customerName,
          sub.customerName,
          sub.customerPhone,
          sub.deliveryAddress,
          deliveryNotes,
          now,
          now,
        ]);

        await tx.execute(`
          INSERT INTO delivery_task_events (
            id, task_id, event_type, from_status, to_status,
            actor_id, actor_name, notes, created_at
          ) VALUES (?, ?, 'CREATED', NULL, 'PENDING', ?, ?, ?, ?)
        `, [
          eventId,
          taskId,
          actor.id,
          actor.fullName,
          `Delivery task generated for commercial Tiffin subscription (${sub.productName})`,
          now,
        ]);

        createdCount++;
      }
    } catch {
      // In isolated environments without tiffin tables, gracefully ignore
    }

    const totalEligible = mealRecords.length + tiffinSubsLength;

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.tasks_generated",
      targetType: "meal_plan",
      targetId: plan.id,
      metadata: {
        serviceDate,
        mealType,
        createdCount,
        skippedCount,
        alreadyExistedCount,
        totalEligible,
        residentEligible: mealRecords.length,
        tiffinEligible: tiffinSubsLength,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const generatedTasks = await listDeliveryTasks(actor, {
    serviceDate,
    mealType,
  }, db);

  return {
    planId: plan.id,
    serviceDate,
    mealType,
    createdCount,
    skippedCount,
    alreadyExistedCount,
    totalEligible: mealRecords.length,
    tasks: generatedTasks,
  };
}

/**
 * Creates an external city customer delivery order.
 * Tiffin delivery is not restricted to residents or rooms within the PG.
 * Captures customer identity, contact details, and delivery address.
 * Requires delivery.manage permission.
 */
export async function createExternalDeliveryTask(
  actor: AuthenticatedUser,
  input: CreateExternalDeliveryTaskInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.external_order_created" });

  const serviceDate = input.serviceDate?.trim();
  const mealType = input.mealType;
  const customerName = input.customerName?.trim();
  const customerPhone = input.customerPhone?.trim();
  const deliveryAddress = input.deliveryAddress?.trim();
  const notes = input.notes?.trim() || null;

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }
  if (!VALID_MEAL_TYPES.includes(mealType)) {
    throw new Error(`Invalid meal type '${mealType}'. Must be BREAKFAST, LUNCH, or DINNER.`);
  }
  if (!customerName || customerName.length < 2) {
    throw new Error("Customer name must be at least 2 characters.");
  }
  if (!customerPhone || customerPhone.length < 7) {
    throw new Error("Valid customer contact number is required.");
  }
  if (!deliveryAddress || deliveryAddress.length < 5) {
    throw new Error("Valid delivery address in the city is required (min 5 characters).");
  }

  const db = asyncDb || getAsyncDb();

  const taskId = `del_ext_${crypto.randomUUID()}`;
  const eventId = `devt_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    // Find or attach to meal plan for that date and meal inside transaction
    const planRow = await tx.queryOne<{ id: string; status: string }>(`
      SELECT id, status FROM daily_meal_plans WHERE service_date = ? AND meal_type = ?
    `, [serviceDate, mealType]);

    let planId: string;
    if (planRow) {
      planId = planRow.id;
    } else {
      planId = `dmp_${crypto.randomUUID()}`;
      await tx.execute(`
        INSERT INTO daily_meal_plans (
          id, service_date, meal_type, planned_resident_count, guest_count,
          final_preparation_count, actual_cooked_count, status, notes,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, 0, 1, 1, 1, 'CONFIRMED', 'Auto-created for external city delivery', ?, ?, ?)
      `, [planId, serviceDate, mealType, actor.id, now, now]);
    }

    await tx.execute(`
      INSERT INTO delivery_tasks (
        id, order_type, meal_record_id, plan_id, service_date, meal_type,
        resident_id, resident_name, room_number, floor, stay_id,
        customer_name, customer_phone, delivery_address, delivery_notes,
        status, created_at, updated_at
      ) VALUES (
        ?, 'EXTERNAL', NULL, ?, ?, ?,
        NULL, ?, NULL, NULL, NULL,
        ?, ?, ?, ?,
        'PENDING', ?, ?
      )
    `, [
      taskId, planId, serviceDate, mealType,
      customerName,
      customerName, customerPhone, deliveryAddress, notes,
      now, now
    ]);

    // The event and the audit entry are independent: both go to the database together.
    const eventWrite = tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'CREATED', NULL, 'PENDING', ?, ?, ?, ?)
    `, [eventId, taskId, actor.id, actor.fullName, notes, now]);
    eventWrite.catch(() => {}); // awaited below; never left unhandled if the audit write fails first

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.external_order_created",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        orderType: "EXTERNAL",
        serviceDate,
        mealType,
        customerName,
        customerPhone,
        deliveryAddress,
      },
      ipAddress: clientIp,
    }, tx);
    await eventWrite;
  });

  const createdRow = await db.queryOne(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  return mapRowToDeliveryTask(createdRow);
}

/**
 * Assigns or reassigns a delivery task to an active delivery staff member.
 * Requires delivery.manage permission.
 */
export async function assignDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input: AssignDeliveryTaskInput,
  clientIp?: string,
  asyncDb?: AsyncDb,
  /** detail: false skips reloading the task: the result has the new status (and assignee); other fields are as before. */
  opts: { detail?: boolean } = {}
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.task_assigned" });

  const assignedToStaffId = input.assignedToStaffId?.trim();
  if (!assignedToStaffId) {
    throw new Error("Target delivery person staff ID is required.");
  }

  const db = asyncDb || getAsyncDb();

  // Target: active delivery staff, or the Owner/Manager taking this delivery themselves.
  const staff = await resolveAssignee(db, actor, assignedToStaffId);
  const reason = input.reason?.trim().slice(0, 300) || null;

  // Fetch target delivery task
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);
  if (currentTask.status === "DELIVERED") {
    throw new Error("Delivered tasks cannot be reassigned.");
  }
  if (currentTask.status === "CANCELLED") {
    throw new Error("This delivery was cancelled and cannot be assigned.");
  }
  if (currentTask.invoiceId) {
    throw new Error("Task is linked to an invoice and cannot be reassigned.");
  }

  const isReassignment = !!currentTask.assignedTo;
  const eventType: DeliveryEventType = isReassignment ? "REASSIGNED" : "ASSIGNED";
  const fromStatus = currentTask.status;
  const toStatus: DeliveryStatus = "ASSIGNED";
  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    const assignResult = await tx.execute(`
      UPDATE delivery_tasks
      SET
        status = 'ASSIGNED',
        assigned_to = ?,
        assigned_to_name = ?,
        assigned_by = ?,
        assigned_at = ?,
        exception_type = NULL,
        exception_reason = NULL,
        exception_at = NULL,
        exception_by = NULL,
        updated_at = ?
      WHERE id = ? AND status NOT IN ('DELIVERED', 'CANCELLED')
    `, [
      staff.id,
      staff.fullName,
      actor.id,
      now,
      now,
      taskId,
    ]);
    if (assignResult.changes === 0) {
      throw new Error("This delivery was completed or cancelled meanwhile. Reload the list.");
    }

    // The event and the audit entry are independent: both go to the database together.
    const eventWrite = tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      eventId,
      taskId,
      eventType,
      fromStatus,
      toStatus,
      actor.id,
      actor.fullName,
      (isReassignment
        ? `Reassigned from ${currentTask.assignedToName || "prior staff"} to ${staff.fullName}`
        : `Assigned to ${staff.fullName}`) +
        (staff.selfFulfilment ? " (handling it personally)" : "") +
        (reason ? `. Reason: ${reason}` : ""),
      now,
    ]);
    eventWrite.catch(() => {}); // awaited below; never left unhandled if the audit write fails first

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: isReassignment ? "delivery.task_reassigned" : "delivery.task_assigned",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        assignedToStaffId: staff.id,
        assignedToStaffName: staff.fullName,
        previousAssignedTo: currentTask.assignedTo,
        previousAssignedToName: currentTask.assignedToName,
        selfFulfilment: staff.selfFulfilment,
        reason,
        fromStatus,
        toStatus,
      },
      ipAddress: clientIp,
    }, tx);
    await eventWrite;
  });

  // The phone alert is for delivery staff; someone taking a delivery themselves needs none.
  if (currentTask.assignedTo !== staff.id && !staff.selfFulfilment) notifyStopsAssigned([taskId], staff.id);
  if (opts.detail === false) return { ...currentTask, status: "ASSIGNED", assignedTo: staff.id, assignedToName: staff.fullName };
  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

/**
 * Assigns multiple delivery tasks to an active delivery staff member in a single atomic transaction.
 * Requires delivery.manage permission.
 */
export async function batchAssignDeliveryTasks(
  actor: AuthenticatedUser,
  input: BatchAssignDeliveryTasksInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<BatchAssignDeliveryTasksResult> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.tasks_batch_assigned" });

  const assignedToStaffId = input.assignedToStaffId?.trim();
  if (!assignedToStaffId) {
    throw new Error("Target delivery person staff ID is required.");
  }

  const rawTaskIds = Array.isArray(input.taskIds) ? input.taskIds : [];
  const taskIds = Array.from(new Set(rawTaskIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)));

  if (taskIds.length === 0) {
    throw new Error("At least one valid delivery task ID must be provided for batch assignment.");
  }
  if (taskIds.length > 200) {
    throw new Error("Batch assignment limit is 200 tasks per operation.");
  }

  const db = asyncDb || getAsyncDb();

  // Target: active delivery staff, or the Owner/Manager taking these deliveries themselves.
  const staff = await resolveAssignee(db, actor, assignedToStaffId);

  // Fetch all requested tasks
  const inPlaceholders = taskIds.map(() => "?").join(", ");
  const taskRows = await db.query<any>(`
    SELECT * FROM delivery_tasks WHERE id IN (${inPlaceholders})
  `, taskIds);

  if (taskRows.length !== taskIds.length) {
    const foundIds = new Set(taskRows.map((r) => r.id));
    const missing = taskIds.filter((id) => !foundIds.has(id));
    throw new Error(`The following delivery task(s) were not found: ${missing.join(", ")}`);
  }

  // Safety checks across all selected tasks:
  for (const row of taskRows) {
    if (row.status === "DELIVERED") {
      throw new Error(`Task '${row.id}' (${row.customer_name || row.resident_name || "Room " + row.room_number}) has already been delivered and cannot be reassigned.`);
    }
    if (row.status === "CANCELLED") {
      throw new Error(`Task '${row.id}' (${row.customer_name || row.resident_name || "Room " + row.room_number}) was cancelled and cannot be assigned.`);
    }
    if (row.invoice_id) {
      throw new Error(`Task '${row.id}' is linked to an invoice (${row.invoice_id}) and cannot be reassigned.`);
    }
  }

  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const row of taskRows) {
      const currentTask = mapRowToDeliveryTask(row);
      const isReassignment = !!currentTask.assignedTo;
      const eventType: DeliveryEventType = isReassignment ? "REASSIGNED" : "ASSIGNED";
      const fromStatus = currentTask.status;
      const toStatus: DeliveryStatus = "ASSIGNED";
      const eventId = `devt_${crypto.randomUUID()}`;

      const batchResult = await tx.execute(`
        UPDATE delivery_tasks
        SET
          status = 'ASSIGNED',
          assigned_to = ?,
          assigned_to_name = ?,
          assigned_by = ?,
          assigned_at = ?,
          exception_type = NULL,
          exception_reason = NULL,
          exception_at = NULL,
          exception_by = NULL,
          updated_at = ?
        WHERE id = ? AND status NOT IN ('DELIVERED', 'CANCELLED')
      `, [
        staff.id,
        staff.fullName,
        actor.id,
        now,
        now,
        currentTask.id,
      ]);
      if (batchResult.changes === 0) {
        throw new Error(`Task '${currentTask.id}' was completed or cancelled meanwhile. Nothing was assigned; reload the list.`);
      }

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        eventId,
        currentTask.id,
        eventType,
        fromStatus,
        toStatus,
        actor.id,
        actor.fullName,
        isReassignment
          ? `Batch reassigned from ${currentTask.assignedToName || "prior staff"} to ${staff.fullName}`
          : `Batch assigned to ${staff.fullName}`,
        now,
      ]);
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.tasks_batch_assigned",
      targetType: "delivery_task_batch",
      targetId: staff.id,
      metadata: {
        assignedToStaffId: staff.id,
        assignedToStaffName: staff.fullName,
        taskCount: taskIds.length,
        taskIds,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedRows = await db.query<any>(`
    SELECT * FROM delivery_tasks WHERE id IN (${inPlaceholders})
  `, taskIds);

  if (!staff.selfFulfilment) notifyStopsAssigned(taskIds, staff.id);
  return {
    assignedCount: updatedRows.length,
    assignedStaffId: staff.id,
    assignedStaffName: staff.fullName,
    tasks: updatedRows.map(mapRowToDeliveryTask),
  };
}

/**
 * Marks a task as OUT_FOR_DELIVERY (dispatched).
 * Delivery staff can only dispatch tasks assigned to themselves.
 * Requires delivery.update permission.
 */
export async function dispatchDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  clientIp?: string,
  asyncDb?: AsyncDb,
  /** detail: false skips reloading the task: the result has the new status (and assignee); other fields are as before. */
  opts: { detail?: boolean } = {}
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.task_dispatched" });

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);

  // Ownership check: delivery persons can only update tasks assigned to them
  if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You are not assigned to this delivery task.");
  }

  if (!currentTask.assignedTo) {
    throw new Error("Task must be assigned to a delivery person before it can be dispatched.");
  }

  if (currentTask.status === "DELIVERED") {
    throw new Error("Task has already been delivered.");
  }

  // Idempotent dispatch
  if (currentTask.status === "OUT_FOR_DELIVERY") {
    return currentTask;
  }

  if (currentTask.status !== "ASSIGNED") {
    throw new Error(`Cannot dispatch task in status '${currentTask.status}'. Task must be in ASSIGNED status.`);
  }

  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE delivery_tasks
      SET
        status = 'OUT_FOR_DELIVERY',
        dispatched_at = ?,
        dispatched_by = ?,
        updated_at = ?
      WHERE id = ?
    `, [now, actor.id, now, taskId]);

    // The event and the audit entry are independent: both go to the database together.
    const eventWrite = tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'DISPATCHED', 'ASSIGNED', 'OUT_FOR_DELIVERY', ?, ?, ?, ?)
    `, [
      eventId,
      taskId,
      actor.id,
      actor.fullName,
      "Tiffin dispatched from kitchen and out for delivery",
      now,
    ]);
    eventWrite.catch(() => {}); // awaited below; never left unhandled if the audit write fails first

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.task_dispatched",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        roomNumber: currentTask.roomNumber,
        serviceDate: currentTask.serviceDate,
        mealType: currentTask.mealType,
      },
      ipAddress: clientIp,
    }, tx);
    await eventWrite;
  });

  if (opts.detail === false) return { ...currentTask, status: "OUT_FOR_DELIVERY" };
  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

/**
 * Marks multiple delivery tasks as OUT_FOR_DELIVERY in a single atomic transaction.
 * Delivery personnel can only dispatch tasks assigned to themselves.
 * Requires delivery.update permission.
 */
export async function batchDispatchDeliveryTasks(
  actor: AuthenticatedUser,
  input: BatchDispatchDeliveryTasksInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<BatchDispatchDeliveryTasksResult> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.tasks_batch_dispatched" });

  const rawTaskIds = Array.isArray(input.taskIds) ? input.taskIds : [];
  const taskIds = Array.from(new Set(rawTaskIds.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean)));

  if (taskIds.length === 0) {
    throw new Error("At least one valid delivery task ID must be provided for batch dispatch.");
  }
  if (taskIds.length > 200) {
    throw new Error("Batch dispatch limit is 200 tasks per operation.");
  }

  const db = asyncDb || getAsyncDb();

  const inPlaceholders = taskIds.map(() => "?").join(", ");
  const taskRows = await db.query<any>(`
    SELECT * FROM delivery_tasks WHERE id IN (${inPlaceholders})
  `, taskIds);

  if (taskRows.length !== taskIds.length) {
    const foundIds = new Set(taskRows.map((r) => r.id));
    const missing = taskIds.filter((id) => !foundIds.has(id));
    throw new Error(`The following delivery task(s) were not found: ${missing.join(", ")}`);
  }

  // Pre-validate all tasks
  for (const row of taskRows) {
    const task = mapRowToDeliveryTask(row);

    // Ownership check: delivery persons can only dispatch tasks assigned to them
    if (actor.role === "DELIVERY_PERSON" && task.assignedTo !== actor.id) {
      throw new AuthorizationError(403, `You are not assigned to delivery task '${task.id}'.`);
    }

    if (!task.assignedTo) {
      throw new Error(`Task '${task.id}' must be assigned to a delivery person before it can be dispatched.`);
    }

    if (task.status === "DELIVERED") {
      throw new Error(`Task '${task.id}' has already been delivered.`);
    }

    if (task.status !== "ASSIGNED" && task.status !== "OUT_FOR_DELIVERY") {
      throw new Error(`Cannot dispatch task '${task.id}' in status '${task.status}'. Task must be in ASSIGNED status.`);
    }
  }

  const now = new Date().toISOString();
  let dispatchedCount = 0;

  await db.transaction(async (tx) => {
    for (const row of taskRows) {
      const task = mapRowToDeliveryTask(row);

      // Idempotent dispatch: if already OUT_FOR_DELIVERY, leave as is
      if (task.status === "OUT_FOR_DELIVERY") {
        continue;
      }

      const eventId = `devt_${crypto.randomUUID()}`;

      await tx.execute(`
        UPDATE delivery_tasks
        SET
          status = 'OUT_FOR_DELIVERY',
          dispatched_at = ?,
          dispatched_by = ?,
          updated_at = ?
        WHERE id = ?
      `, [now, actor.id, now, task.id]);

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, 'DISPATCHED', 'ASSIGNED', 'OUT_FOR_DELIVERY', ?, ?, ?, ?)
      `, [
        eventId,
        task.id,
        actor.id,
        actor.fullName,
        "Batch dispatched from kitchen and out for delivery",
        now,
      ]);

      dispatchedCount++;
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.tasks_batch_dispatched",
      targetType: "delivery_task_batch",
      targetId: actor.id,
      metadata: {
        taskCount: taskIds.length,
        dispatchedCount,
        taskIds,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedRows = await db.query<any>(`
    SELECT * FROM delivery_tasks WHERE id IN (${inPlaceholders})
  `, taskIds);

  return {
    dispatchedCount,
    tasks: updatedRows.map(mapRowToDeliveryTask),
  };
}

/**
 * Marks a task as DELIVERED upon successful handover to the resident.
 * Records delivery timestamp, actor attribution, and optional recipient verification.
 * Requires delivery.update permission.
 */
export async function completeDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input?: CompleteDeliveryTaskInput,
  clientIpOrDb?: string | AsyncDb,
  maybeDb?: AsyncDb
): Promise<DeliveryTask> {
  const clientIp = typeof clientIpOrDb === "string" ? clientIpOrDb : undefined;
  const asyncDb = typeof clientIpOrDb === "object" ? clientIpOrDb : maybeDb;

  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.task_delivered" });

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);

  // Ownership check: delivery persons can only complete tasks assigned to them
  if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You are not assigned to this delivery task.");
  }

  if (!currentTask.assignedTo) {
    if (actor.role === "SUPER_ADMIN" || actor.role === "OPERATIONS_MANAGER") {
      const defaultDriver = await getDefaultDeliveryStaff(db);
      const targetStaffId = defaultDriver ? defaultDriver.id : actor.id;
      const targetStaffName = defaultDriver ? defaultDriver.fullName : actor.fullName;
      const assignNow = new Date().toISOString();
      await db.execute(`
        UPDATE delivery_tasks
        SET assigned_to = ?, assigned_to_name = ?, assigned_by = ?, assigned_at = ?, updated_at = ?
        WHERE id = ?
      `, [targetStaffId, targetStaffName, actor.id, assignNow, assignNow, taskId]);
      currentTask.assignedTo = targetStaffId;
      currentTask.assignedToName = targetStaffName;
    } else {
      throw new Error("Task must be assigned to a delivery person before it can be marked as delivered.");
    }
  }

  if (currentTask.status === "CANCELLED") {
    throw new Error("This delivery was cancelled; nothing can be recorded on it.");
  }

  // Idempotent delivery
  if (currentTask.status === "DELIVERED") {
    return (await getDeliveryTaskById(actor, taskId, db))!.task;
  }

  // Deliveries with item lines (orders placed through the Orders page, and subscription / resident
  // meals once migration 0014 is installed) record the outcome per line; for orders the amount
  // due is computed here from the saved prices (never from the browser).
  const order = (await loadTaskOrders(db, [taskId])).get(taskId);
  const lines: DeliveryLine[] = order
    ? order.lines.map(orderLineToDeliveryLine)
    : (await loadTaskItems(db, [taskId])).get(taskId) ?? [];
  if (lines.length > 0 && currentTask.status === "EXCEPTION" && lines.every((l) => l.deliveredQuantity !== null)) {
    // The "not delivered" outcome is already recorded (duplicate tap or offline replay).
    return (await getDeliveryTaskById(actor, taskId, db))!.task;
  }

  if (currentTask.status === "EXCEPTION") {
    throw new Error("Task is currently in EXCEPTION status. It must be retried or reassigned before delivery.");
  }

  if (lines.length > 0) {
    return completeLinedDelivery(actor, currentTask, taskRow, { orderId: order?.orderId ?? null, lines }, input, clientIp, db);
  }

  const recipientName = input?.recipientName?.trim() || null;
  const rawNotes = input?.notes?.trim() || null;
  const deliveredQty = input?.deliveredQuantity !== undefined && !isNaN(Number(input.deliveredQuantity)) ? Number(input.deliveredQuantity) : undefined;
  const undeliveredQty = input?.undeliveredQuantity !== undefined && !isNaN(Number(input.undeliveredQuantity)) ? Number(input.undeliveredQuantity) : undefined;
  const undeliveredReason = input?.undeliveredReason?.trim() || undefined;

  // Validation: If any portion is undelivered, require reason
  if (undeliveredQty !== undefined && undeliveredQty > 0 && !undeliveredReason) {
    throw new Error("Reason is required when portions remain undelivered.");
  }

  let qtyInfo = "";
  if (input?.itemsReconciliation && input.itemsReconciliation.length > 0) {
    const lines = input.itemsReconciliation.map((r) =>
      `${r.productName}: ${r.deliveredQuantity}/${r.orderedQuantity} delivered (₹${r.unitPrice * r.deliveredQuantity})${r.undeliveredQuantity > 0 ? ` [Undelivered: ${r.undeliveredQuantity} portions undelivered - ${r.undeliveredReason || undeliveredReason || "Shortfall"}]` : ""}`
    );
    qtyInfo = `[Recon - ${lines.join("; ")}]`;
  } else if (deliveredQty !== undefined || undeliveredQty !== undefined) {
    const parts: string[] = [];
    if (deliveredQty !== undefined) parts.push(`Delivered: ${deliveredQty}`);
    if (undeliveredQty !== undefined) parts.push(`Undelivered: ${undeliveredQty} portions undelivered`);
    if (undeliveredReason) parts.push(`Reason: ${undeliveredReason}`);
    qtyInfo = `[Qty - ${parts.join(", ")}]`;
  }
  // Preserve any [ORDER_JSON:...] block if present in raw DB row
  const rawDbNotes = taskRow.delivery_notes || "";
  const jsonMatch = rawDbNotes.match(/\[ORDER_JSON:\{[\s\S]*?\}\]/);
  const jsonPrefix = jsonMatch ? jsonMatch[0] : "";
  const cleanPriorNotes = extractCleanUserNotes(rawDbNotes) || "";
  const newNotes = [rawNotes, qtyInfo].filter(Boolean).join(" ");
  const combinedHumanNotes = [cleanPriorNotes, newNotes].filter(Boolean).join(" ");
  const deliveryNotes = [jsonPrefix, combinedHumanNotes].filter(Boolean).join(" ") || null;

  const hasCollection = input?.collectedAmount !== undefined && input?.collectedAmount !== null && Number(input.collectedAmount) > 0;
  let collectedAmount = 0;
  let collectedPaymentMethod: PaymentMethod | null = null;
  let collectionStatus: DeliveryCollectionStatus = currentTask.collectionStatus || "NONE";
  let collectionIdempotencyKey: string | null = null;

  if (hasCollection) {
    collectedAmount = Math.round(Number(input!.collectedAmount));
    if (collectedAmount <= 0) {
      throw new Error("Collected amount must be a positive integer.");
    }
    collectedPaymentMethod = normalizePaymentMethod(input!.paymentMethod || "CASH");
    collectionStatus = "COLLECTED";
    collectionIdempotencyKey = input?.idempotencyKey?.trim() || `dcol_${crypto.randomUUID()}`;
  }

  const isZeroDelivered = deliveredQty === 0 && (undeliveredQty || 0) > 0;
  const finalStatus: DeliveryStatus = isZeroDelivered ? "EXCEPTION" : "DELIVERED";
  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  // Completion is applied at most once. The status guard in each UPDATE makes a concurrent
  // duplicate (online retry racing an offline replay, double tap) a no-op instead of a
  // second write with duplicate events/audit rows.
  await db.transaction(async (tx) => {
    if (isZeroDelivered) {
      const applied = await tx.execute(`
        UPDATE delivery_tasks
        SET
          status = 'EXCEPTION',
          exception_type = 'OTHER',
          exception_reason = ?,
          exception_at = ?,
          exception_by = ?,
          delivery_notes = ?,
          updated_at = ?
        WHERE id = ? AND status NOT IN ('DELIVERED', 'EXCEPTION')
      `, [
        undeliveredReason || "Zero delivered portions",
        now,
        actor.id,
        deliveryNotes,
        now,
        taskId,
      ]);
      if (applied.changes === 0) return;

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, 'EXCEPTION', ?, 'EXCEPTION', ?, ?, ?, ?)
      `, [
        eventId,
        taskId,
        currentTask.status,
        actor.id,
        actor.fullName,
        `Zero delivered: ${undeliveredReason || "Declined at door"}.${deliveryNotes ? ` Note: ${deliveryNotes}` : ""}`,
        now,
      ]);
    } else {
      const applied = await tx.execute(`
        UPDATE delivery_tasks
        SET
          status = 'DELIVERED',
          delivered_at = ?,
          delivered_by = ?,
          recipient_name = ?,
          delivery_notes = ?,
          collection_status = ?,
          collected_amount = ?,
          collected_payment_method = ?,
          collection_idempotency_key = COALESCE(?, collection_idempotency_key),
          updated_at = ?
        WHERE id = ? AND status NOT IN ('DELIVERED', 'EXCEPTION')
      `, [
        now,
        actor.id,
        recipientName,
        deliveryNotes,
        collectionStatus,
        collectedAmount,
        collectedPaymentMethod,
        collectionIdempotencyKey,
        now,
        taskId,
      ]);
      if (applied.changes === 0) return;

      if (hasCollection && collectedPaymentMethod) {
        await recordCustodyCollection(tx, {
          deliveryTaskId: taskId,
          collectedBy: currentTask.assignedTo || actor.id,
          amount: collectedAmount,
          paymentMethod: collectedPaymentMethod,
          collectedAt: now,
          idempotencyKey: collectionIdempotencyKey,
        });
      }

      if (input?.itemsReconciliation && input.itemsReconciliation.length > 0) {
        await recordOrderLineDelivery(tx, taskId, input.itemsReconciliation);
      }

      const eventNotes = hasCollection
        ? `${recipientName ? `Handed over to ${recipientName}.` : "Handed over."} Collected ₹${collectedAmount} via ${collectedPaymentMethod}.${deliveryNotes ? ` Note: ${deliveryNotes}` : ""}`
        : (recipientName ? `Handed over to ${recipientName}` : "Handed over to resident");

      await tx.execute(`
        INSERT INTO delivery_task_events (
          id, task_id, event_type, from_status, to_status,
          actor_id, actor_name, notes, created_at
        ) VALUES (?, ?, 'DELIVERED', ?, 'DELIVERED', ?, ?, ?, ?)
      `, [
        eventId,
        taskId,
        currentTask.status,
        actor.id,
        actor.fullName,
        eventNotes,
        now,
      ]);
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: isZeroDelivered ? "delivery.task_exception" : "delivery.task_delivered",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        roomNumber: currentTask.roomNumber,
        serviceDate: currentTask.serviceDate,
        mealType: currentTask.mealType,
        recipientName,
        deliveredAt: now,
        hasCollection,
        collectedAmount,
        collectedPaymentMethod,
        collectionStatus,
        deliveredQuantity: deliveredQty,
        undeliveredQuantity: undeliveredQty !== undefined ? undeliveredQty : null,
        undeliveredReason,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

function orderLineToDeliveryLine(l: DeliveryOrderLine): DeliveryLine {
  return {
    lineId: l.orderItemId,
    source: "ORDER",
    productName: l.productName,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    deliveredQuantity: l.deliveredQuantity,
    undeliveredReason: l.undeliveredReason,
    disposition: l.undeliveredDisposition ?? null,
  };
}

/**
 * Completes a delivery that has item lines: one outcome per line, validated against the lines.
 * - delivered is a whole number 0..ordered; undelivered (if sent) must equal ordered − delivered;
 * - every short line needs a reason (its own, else the delivery-level one) and, once migration
 *   0014 is installed, a disposition (returned / with delivery staff / discarded);
 * - something delivered → DELIVERED (a short line makes it a partial delivery) and, once 0014 is
 *   installed, the recipient's name is required; nothing delivered → EXCEPTION (not delivered);
 * - orders: amount due = Σ delivered × saved unit price; collected must be 0..amount due; the order
 *   becomes COMPLETED only when something was delivered (a failed delivery stays open);
 * - subscription and resident meals take no doorstep payment (monthly billing / part of the stay);
 * - the task, the lines, the order status, the event and the audit row are written in one
 *   transaction, guarded so a duplicate or concurrent completion applies at most once.
 */
async function completeLinedDelivery(
  actor: AuthenticatedUser,
  currentTask: DeliveryTask,
  taskRow: any,
  source: { orderId: string | null; lines: DeliveryLine[] },
  input: CompleteDeliveryTaskInput | undefined,
  clientIp: string | undefined,
  db: AsyncDb
): Promise<DeliveryTask> {
  const opsSchema = await hasDeliveryOpsSchema(db);
  const isOrder = source.orderId !== null;
  const noun = isOrder ? "order" : "delivery";
  const submitted = Array.isArray(input?.lines) ? input!.lines : null;
  if (!submitted || submitted.length === 0) {
    throw new Error(`Enter the delivered quantity for every item on this ${noun}.`);
  }
  const byId = new Map(source.lines.map((l) => [l.lineId, l]));
  const seen = new Set<string>();
  const fallbackReason = input?.undeliveredReason?.trim() || "";
  const outcomes = submitted.map((s) => {
    const line = byId.get(String(s?.lineId || s?.orderItemId || ""));
    if (!line || seen.has(line.lineId)) {
      throw new Error(`The delivered items do not match this ${noun}. Reload the delivery list and try again.`);
    }
    seen.add(line.lineId);
    const delivered = Number(s.deliveredQuantity);
    if (!Number.isInteger(delivered) || delivered < 0) {
      throw new Error(`Delivered quantity for '${line.productName}' must be a whole number, 0 or more.`);
    }
    if (delivered > line.quantity) {
      throw new Error(`Delivered quantity for '${line.productName}' cannot be more than the ${line.quantity} ordered.`);
    }
    if (s.undeliveredQuantity !== undefined && s.undeliveredQuantity !== null) {
      const undelivered = Number(s.undeliveredQuantity);
      if (!Number.isInteger(undelivered) || undelivered < 0) {
        throw new Error(`Undelivered quantity for '${line.productName}' must be a whole number, 0 or more.`);
      }
      if (delivered + undelivered !== line.quantity) {
        throw new Error(`Delivered and undelivered for '${line.productName}' must add up to the ${line.quantity} ordered.`);
      }
    }
    const undelivered = line.quantity - delivered;
    const reason = undelivered > 0 ? s.reason?.trim() || fallbackReason : "";
    if (undelivered > 0 && !reason) {
      throw new Error(`A reason is required when any item is not fully delivered ('${line.productName}': ${undelivered} not delivered).`);
    }
    let disposition: DeliveryDisposition | null = null;
    if (undelivered > 0 && opsSchema) {
      if (!s.disposition || !(DISPOSITIONS as readonly string[]).includes(s.disposition)) {
        throw new Error(`Choose what happened to the ${undelivered} '${line.productName}' not delivered: returned, with delivery staff, or discarded.`);
      }
      disposition = s.disposition;
    }
    return { line, delivered, undelivered, reason: undelivered > 0 ? reason : null, disposition };
  });
  if (seen.size !== source.lines.length) {
    throw new Error(`Enter the delivered quantity for every item on this ${noun}.`);
  }

  const hasShortfall = outcomes.some((o) => o.undelivered > 0);
  const totalDelivered = outcomes.reduce((s, o) => s + o.delivered, 0);
  const amountDue = isOrder ? outcomes.reduce((s, o) => s + o.delivered * (o.line.unitPrice ?? 0), 0) : 0;
  const rawCollected = input?.collectedAmount;
  const collected = rawCollected === undefined || rawCollected === null || (rawCollected as any) === "" ? 0 : Number(rawCollected);
  if (!Number.isInteger(collected) || collected < 0) {
    throw new Error("Amount collected must be a whole number of rupees, 0 or more.");
  }
  if (!isOrder && collected > 0) {
    throw new Error(
      currentTask.subscriptionId
        ? "Subscription meals are billed monthly; no payment is taken at the door."
        : "This meal is not charged at the door; nothing can be collected."
    );
  }
  // With migration 0022 a customer may pay more than this order at the door: the extra settles their
  // earlier orders (oldest first) and anything beyond that is kept as an advance (customer credit).
  // Each part is its own collection record; the whole amount is held by the employee at the door.
  const doorAllocation = isOrder && Boolean(source.orderId) && (await hasCashShortfallSchema(db));
  if (collected > amountDue && !doorAllocation) {
    throw new Error(`Amount collected (₹${collected}) cannot be more than the amount due for the delivered items (₹${amountDue}).`);
  }
  const orderPart = Math.min(collected, amountDue);
  const extraPart = collected - orderPart;
  const nothingDelivered = totalDelivered === 0;
  if (nothingDelivered && collected > 0) {
    throw new Error("Nothing was delivered, so no payment can be recorded at the door. Record a payment for earlier orders from the office.");
  }
  const recipientName = input?.recipientName?.trim() || null;
  if (!nothingDelivered && opsSchema && !recipientName) {
    throw new Error("Enter the name of the person who received the delivery.");
  }
  // The payment chosen at the door (migration 0021): Cash, UPI, or Pay Later (nothing collected).
  // A balance left for a customer who is not approved for Pay Later is still recorded (the food was
  // handed over, and an offline delivery can sync after the approval changed) and is flagged for a
  // Manager on the order. It is never treated as paid.
  const choice = input?.paymentChoice === "CASH" || input?.paymentChoice === "UPI" || input?.paymentChoice === "PAY_LATER" ? input.paymentChoice : null;
  if (isOrder && choice === "PAY_LATER" && collected > 0) {
    throw new Error("Pay Later collects nothing at the door. Choose Cash or UPI to record money received.");
  }
  if (isOrder && collected > 0 && choice && input?.paymentMethod && normalizePaymentMethod(input.paymentMethod) !== choice) {
    throw new Error("The payment method does not match the payment chosen.");
  }
  const paymentMethod = collected > 0 ? normalizePaymentMethod(choice && choice !== "PAY_LATER" ? choice : input?.paymentMethod || "CASH") : null;
  const storedChoice = choice ?? (paymentMethod === "CASH" || paymentMethod === "UPI" ? paymentMethod : null);
  const recordPayment = isOrder && !nothingDelivered && (await hasPayLaterSchema(db));
  let payLaterReview: string | null = null;
  const collectionKey = collected > 0 ? input?.idempotencyKey?.trim() || `dcol_${crypto.randomUUID()}` : null;
  // The money is held by the employee the delivery is assigned to (the one at the door), else by
  // whoever records it. Ownership is stored on the collection, never inferred later.
  const custodian = currentTask.assignedTo || actor.id;
  const userNote = input?.notes?.trim() || null;
  const rawDbNotes = taskRow.delivery_notes || "";
  const jsonMatch = rawDbNotes.match(/\[ORDER_JSON:\{[\s\S]*?\}\]/);
  const priorNotes = extractCleanUserNotes(rawDbNotes) || "";
  const deliveryNotes = [jsonMatch ? jsonMatch[0] : "", [priorNotes, userNote].filter(Boolean).join(" ")].filter(Boolean).join(" ") || null;
  const now = new Date().toISOString();
  const outcomeText = outcomes
    .map(
      (o) =>
        `${o.line.productName} ${o.delivered}/${o.line.quantity}` +
        (o.undelivered > 0 ? ` (${o.undelivered} not delivered: ${o.reason}${o.disposition ? `; ${o.disposition.toLowerCase().replace("_", " ")}` : ""})` : "")
    )
    .join(", ");

  await db.transaction(async (tx) => {
    const applied = nothingDelivered
      ? await tx.execute(
          `UPDATE delivery_tasks
           SET status = 'EXCEPTION', exception_type = 'OTHER', exception_reason = ?, exception_at = ?, exception_by = ?,
               delivery_notes = ?, updated_at = ?
           WHERE id = ? AND status NOT IN ('DELIVERED', 'EXCEPTION', 'CANCELLED')`,
          [outcomes.map((o) => o.reason).filter(Boolean).join("; "), now, actor.id, deliveryNotes, now, currentTask.id]
        )
      : await tx.execute(
          `UPDATE delivery_tasks
           SET status = 'DELIVERED', delivered_at = ?, delivered_by = ?, recipient_name = ?, delivery_notes = ?,
               collection_status = ?, collected_amount = ?, collected_payment_method = ?,
               collection_idempotency_key = COALESCE(?, collection_idempotency_key), updated_at = ?
           WHERE id = ? AND status NOT IN ('DELIVERED', 'EXCEPTION', 'CANCELLED')`,
          [
            now,
            actor.id,
            recipientName,
            deliveryNotes,
            collected > 0 ? "COLLECTED" : "NONE",
            collected,
            paymentMethod,
            collectionKey,
            now,
            currentTask.id,
          ]
        );
    // Already completed by a duplicate or concurrent request: nothing else is written.
    if (applied.changes === 0) return;

    if (collected > 0 && paymentMethod) {
      await recordCustodyCollection(tx, {
        deliveryTaskId: currentTask.id,
        orderId: source.orderId,
        collectedBy: custodian,
        amount: orderPart,
        paymentMethod,
        collectedAt: now,
        idempotencyKey: collectionKey,
        serviceDate: currentTask.serviceDate,
        allocation: "ORDER",
      });
      if (extraPart > 0) {
        let left = extraPart;
        const owner = await tx.queryOne<{ customer_id: string | null }>("SELECT customer_id FROM orders WHERE id = ?", [source.orderId]);
        if (owner?.customer_id) {
          // One door payment at a time per customer, so two stops cannot both settle the same old order.
          await acquireLedgerKeyLock(tx, `customer-dues:${owner.customer_id}`);
          for (const prev of await customerOpenOrders(tx, owner.customer_id, source.orderId)) {
            if (left <= 0) break;
            const take = Math.min(left, prev.open);
            await recordCustodyCollection(tx, {
              deliveryTaskId: prev.delivery_task_id,
              orderId: prev.id,
              collectedBy: custodian,
              amount: take,
              paymentMethod,
              collectedAt: now,
              idempotencyKey: `${collectionKey}:prev:${prev.id}`,
              serviceDate: currentTask.serviceDate,
              allocation: "PREVIOUS_DUES",
              collectedAtTaskId: currentTask.id,
            });
            left -= take;
          }
        }
        if (left > 0) {
          await recordCustodyCollection(tx, {
            deliveryTaskId: currentTask.id,
            orderId: source.orderId,
            collectedBy: custodian,
            amount: left,
            paymentMethod,
            collectedAt: now,
            idempotencyKey: `${collectionKey}:advance`,
            serviceDate: currentTask.serviceDate,
            allocation: "ADVANCE",
          });
        }
      }
    }

    // These writes do not depend on each other: they go to the database together (one round trip)
    // inside the same transaction, which still commits or rolls back as a whole.
    const writes: Promise<unknown>[] = [];
    for (const o of outcomes) {
      if (o.line.source === "ORDER") {
        writes.push(tx.execute(
          opsSchema
            ? "UPDATE order_items SET delivered_quantity = ?, undelivered_reason = ?, undelivered_disposition = ? WHERE id = ?"
            : "UPDATE order_items SET delivered_quantity = ?, undelivered_reason = ? WHERE id = ?",
          opsSchema ? [o.delivered, o.reason, o.disposition, o.line.lineId] : [o.delivered, o.reason, o.line.lineId]
        ));
      } else {
        writes.push(tx.execute(
          "UPDATE delivery_task_items SET delivered_quantity = ?, undelivered_reason = ?, undelivered_disposition = ?, updated_at = ? WHERE id = ?",
          [o.delivered, o.reason, o.disposition, now, o.line.lineId]
        ));
      }
    }
    // The order is complete once something was delivered; a failed delivery stays open (it can be
    // retried or cancelled), so the order and its delivery never contradict each other.
    if (source.orderId && !nothingDelivered) {
      writes.push(tx.execute("UPDATE orders SET status = 'COMPLETED', updated_at = ? WHERE id = ? AND status = 'CONFIRMED'", [now, source.orderId]));
    }
    if (recordPayment && source.orderId) {
      // Pay Later is open to every customer (owner decision, 2026-11-07): a balance left at the door
      // simply stays on the customer's account (Finance -> Receivables); no approval, no review flag.
      const detail: string | null = null;
      writes.push(tx.execute(
        "UPDATE orders SET payment_choice = ?, payment_review = ?, payment_review_detail = ?, payment_reviewed_by = NULL, payment_reviewed_at = NULL, updated_at = ? WHERE id = ?",
        [storedChoice, payLaterReview, detail, now, source.orderId]
      ));
    }

    writes.push(tx.execute(
      `INSERT INTO delivery_task_events (id, task_id, event_type, from_status, to_status, actor_id, actor_name, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `devt_${crypto.randomUUID()}`,
        currentTask.id,
        nothingDelivered ? "EXCEPTION" : "DELIVERED",
        currentTask.status,
        nothingDelivered ? "EXCEPTION" : "DELIVERED",
        actor.id,
        actor.fullName,
        nothingDelivered
          ? `Not delivered: ${outcomeText}.`
          : `${hasShortfall ? "Partly delivered" : "Delivered"} ${outcomeText}.` +
            (isOrder ? ` Due ₹${amountDue}, collected ₹${collected}${paymentMethod ? ` via ${paymentMethod}` : ""}, balance ₹${amountDue - orderPart}${extraPart > 0 ? `; ₹${extraPart} more taken for earlier dues or as an advance` : ""}.` : "") +
            (recipientName ? ` Received by ${recipientName}.` : ""),
        now,
      ]
    ));
    await Promise.all(writes);

    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: nothingDelivered ? "delivery.task_exception" : "delivery.task_delivered",
        targetType: "delivery_task",
        targetId: currentTask.id,
        metadata: {
          orderId: source.orderId,
          serviceDate: currentTask.serviceDate,
          mealType: currentTask.mealType,
          lines: outcomes.map((o) => ({
            lineId: o.line.lineId,
            source: o.line.source,
            ordered: o.line.quantity,
            delivered: o.delivered,
            unitPrice: o.line.unitPrice,
            undeliveredReason: o.reason,
            disposition: o.disposition,
          })),
          undeliveredReason: hasShortfall ? outcomes.map((o) => o.reason).filter(Boolean).join("; ") : null,
          amountDue,
          collectedAmount: collected,
          paymentMethod,
          balanceDue: amountDue - orderPart,
          extraCollected: extraPart,
          recipientName,
          paymentChoice: recordPayment ? storedChoice : undefined,
          payLaterReview: payLaterReview ?? undefined,
          viaOfflineSync: input?.viaOfflineSync ? true : undefined,
        },
        ipAddress: clientIp,
      },
      tx
    );
  });

  const detail = await getDeliveryTaskById(actor, currentTask.id, db);
  return detail!.task;
}

/**
 * Records per-line delivered quantities for the order behind a delivery task (ISSUE-024).
 * Called inside the delivery completion transaction; a task without an orders row is ignored.
 */
async function recordOrderLineDelivery(
  tx: AsyncDb,
  deliveryTaskId: string,
  reconciliation: Array<{ productName: string; deliveredQuantity: number; undeliveredReason?: string }>
): Promise<void> {
  const lines = await tx.query<any>(
    `SELECT oi.id, oi.product_name, oi.quantity
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.delivery_task_id = ?
     ORDER BY oi.line_no`,
    [deliveryTaskId]
  );
  const used = new Set<string>();
  for (const rec of reconciliation) {
    const line = lines.find((l) => !used.has(l.id) && l.product_name === rec.productName) ?? lines.find((l) => !used.has(l.id));
    if (!line) break;
    used.add(line.id);
    const delivered = Math.max(0, Math.min(Number(line.quantity), Math.round(Number(rec.deliveredQuantity) || 0)));
    await tx.execute(
      "UPDATE order_items SET delivered_quantity = ?, undelivered_reason = ? WHERE id = ?",
      [delivered, delivered < Number(line.quantity) ? rec.undeliveredReason?.trim() || null : null, line.id]
    );
  }
}

/**
 * Reports a delivery exception using controlled categories and mandatory reason.
 * Does NOT delete the task; records exception state and detailed history for review/retry.
 * Requires delivery.update permission.
 */
export async function reportDeliveryException(
  actor: AuthenticatedUser,
  taskId: string,
  input: ReportDeliveryExceptionInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.task_exception" });

  const exceptionType = input.exceptionType;
  const reason = input.reason?.trim();

  if (!VALID_EXCEPTION_TYPES.includes(exceptionType)) {
    throw new Error(
      `Invalid exception type '${exceptionType}'. Must be RESIDENT_UNAVAILABLE, RESIDENT_DECLINED, LOCATION_UNCLEAR, MEAL_DAMAGED_OR_MISSING, or OTHER.`
    );
  }
  if (!reason || reason.length < 5) {
    throw new Error("A clear exception reason of at least 5 characters is required.");
  }

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);

  // Ownership check: delivery persons can only report exceptions on tasks assigned to them
  if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You are not assigned to this delivery task.");
  }

  if (currentTask.status === "DELIVERED") {
    throw new Error("Delivered tasks cannot be marked as exceptions without an authorized correction workflow.");
  }
  if (currentTask.status === "CANCELLED") {
    throw new Error("This delivery was cancelled.");
  }
  if (currentTask.invoiceId) {
    throw new Error("Task is linked to an invoice and cannot be marked as an exception.");
  }

  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE delivery_tasks
      SET
        status = 'EXCEPTION',
        exception_type = ?,
        exception_reason = ?,
        exception_at = ?,
        exception_by = ?,
        updated_at = ?
      WHERE id = ? AND status NOT IN ('DELIVERED', 'CANCELLED')
    `, [
      exceptionType,
      reason,
      now,
      actor.id,
      now,
      taskId,
    ]);

    await tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'EXCEPTION', ?, 'EXCEPTION', ?, ?, ?, ?)
    `, [
      eventId,
      taskId,
      currentTask.status,
      actor.id,
      actor.fullName,
      `Exception [${exceptionType}]: ${reason}`,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.task_exception",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        exceptionType,
        reason,
        roomNumber: currentTask.roomNumber,
        serviceDate: currentTask.serviceDate,
        mealType: currentTask.mealType,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

/**
 * Retries an exception task, resetting it to ASSIGNED status for redelivery.
 * Optionally reassigns to another delivery staff member.
 * Requires delivery.manage permission.
 */
export async function retryDeliveryTask(
  actor: AuthenticatedUser,
  taskId: string,
  input?: RetryDeliveryTaskInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.manage", { ip: clientIp, action: "delivery.task_retried" });

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);
  if (currentTask.status !== "EXCEPTION") {
    throw new Error(`Task '${taskId}' is in status '${currentTask.status}'. Only tasks in EXCEPTION status can be retried.`);
  }

  let targetStaffId = currentTask.assignedTo;
  let targetStaffName = currentTask.assignedToName;

  let selfFulfilment = false;
  if (input?.reassignToStaffId) {
    const staff = await resolveAssignee(db, actor, input.reassignToStaffId.trim());
    targetStaffId = staff.id;
    targetStaffName = staff.fullName;
    selfFulfilment = staff.selfFulfilment;
  }

  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;
  const notes = input?.notes?.trim() || `Retried by management${input?.reassignToStaffId ? ` and reassigned to ${targetStaffName}` : ""}`;
  const clearResolution = (await hasDeliveryOpsSchema(db)) ? "resolved_at = NULL, resolved_by = NULL, resolution_note = NULL," : "";

  await db.transaction(async (tx) => {
    const retried = await tx.execute(`
      UPDATE delivery_tasks
      SET
        status = 'ASSIGNED',
        assigned_to = ?,
        assigned_to_name = ?,
        assigned_by = ?,
        assigned_at = ?,
        exception_type = NULL,
        exception_reason = NULL,
        exception_at = NULL,
        exception_by = NULL,
        dispatched_at = NULL,
        dispatched_by = NULL,
        ${clearResolution}
        updated_at = ?
      WHERE id = ? AND status = 'EXCEPTION'
    `, [
      targetStaffId,
      targetStaffName,
      actor.id,
      now,
      now,
      taskId,
    ]);
    if (retried.changes === 0) {
      throw new Error("This delivery is no longer waiting for a retry. Reload the list.");
    }

    await tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'RETRIED', 'EXCEPTION', 'ASSIGNED', ?, ?, ?, ?)
    `, [
      eventId,
      taskId,
      actor.id,
      actor.fullName,
      notes,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.task_retried",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        reassignedToStaffId: targetStaffId,
        reassignedToStaffName: targetStaffName,
        notes,
      },
      ipAddress: clientIp,
    }, tx);
  });

  if (targetStaffId && !selfFulfilment && targetStaffId !== actor.id) notifyStopsAssigned([taskId], targetStaffId);
  const taskDetail = await getDeliveryTaskById(actor, taskId, db);
  return taskDetail!.task;
}

/**
 * Lists delivery tasks with optional date, meal, and status filters.
 * Delivery personnel are strictly restricted to tasks assigned to themselves.
 * Requires delivery.read permission.
 */
export async function listDeliveryTasks(
  actor: AuthenticatedUser,
  options?: ListDeliveryTasksOptions,
  asyncDb?: AsyncDb
): Promise<DeliveryTask[]> {
  requirePermission(actor, "delivery.read");

  const db = asyncDb || getAsyncDb();
  const conditions: string[] = [];
  const params: any[] = [];

  // Strict ownership isolation: Delivery Person can ONLY view their assigned tasks
  if (actor.role === "DELIVERY_PERSON") {
    conditions.push("assigned_to = ?");
    params.push(actor.id);
  } else if (options?.assignedTo) {
    if (options.assignedTo === "UNASSIGNED") {
      conditions.push("assigned_to IS NULL");
    } else {
      conditions.push("assigned_to = ?");
      params.push(options.assignedTo);
    }
  }

  if (options?.serviceDate) {
    conditions.push("service_date = ?");
    params.push(options.serviceDate);
  }
  if (options?.mealType) {
    conditions.push("meal_type = ?");
    params.push(options.mealType);
  }
  if (options?.status) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options?.orderType) {
    conditions.push("order_type = ?");
    params.push(options.orderType);
  }
  if (options?.search?.trim()) {
    const q = `%${options.search.trim().toLowerCase()}%`;
    conditions.push(`(
      LOWER(resident_name) LIKE ? OR
      LOWER(customer_name) LIKE ? OR
      LOWER(room_number) LIKE ? OR
      LOWER(delivery_address) LIKE ? OR
      LOWER(customer_phone) LIKE ?
    )`);
    params.push(q, q, q, q, q);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(500, Math.max(1, Number(options?.limit) || 200));
  const offset = Math.max(0, Number(options?.offset) || 0);

  const rows = await db.query<any>(`
    SELECT *
    FROM delivery_tasks
    ${whereClause}
    ORDER BY service_date DESC, floor ASC, room_number ASC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  return attachOrderData(db, rows.map(mapRowToDeliveryTask));
}

/**
 * Retrieves a single delivery task along with its full event timeline.
 * Enforces ownership restrictions for delivery personnel.
 * Requires delivery.read permission.
 */
export async function getDeliveryTaskById(
  actor: AuthenticatedUser,
  taskId: string,
  asyncDb?: AsyncDb
): Promise<{ task: DeliveryTask; events: DeliveryTaskEvent[] } | null> {
  requirePermission(actor, "delivery.read");

  const db = asyncDb || getAsyncDb();
  const row = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!row) return null;

  const task = mapRowToDeliveryTask(row);

  // Ownership isolation: Delivery Person cannot view tasks assigned to others
  if (actor.role === "DELIVERY_PERSON" && task.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You do not have permission to view this delivery task.");
  }
  const [, eventRows] = await Promise.all([
    attachOrderData(db, [task]),
    db.query<any>(`
    SELECT *
    FROM delivery_task_events
    WHERE task_id = ?
    ORDER BY created_at ASC
  `, [taskId]),
  ]);

  return {
    task,
    events: eventRows.map(mapRowToDeliveryEvent),
  };
}

/**
 * Calculates delivery dashboard metrics and staff workload breakdown.
 * Requires delivery.read permission.
 */
export async function getDeliveryDashboardSummary(
  actor: AuthenticatedUser,
  serviceDate: string,
  mealType?: MealType | "ALL",
  asyncDb?: AsyncDb
): Promise<DeliveryDashboardSummary> {
  requirePermission(actor, "delivery.read");

  if (!serviceDate || !DATE_REGEX.test(serviceDate)) {
    throw new Error("Valid service date in YYYY-MM-DD format is required.");
  }

  const db = asyncDb || getAsyncDb();
  const conditions = ["service_date = ?"];
  const params: any[] = [serviceDate];

  if (mealType && mealType !== "ALL" && VALID_MEAL_TYPES.includes(mealType)) {
    conditions.push("meal_type = ?");
    params.push(mealType);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countsRow = await db.queryOne<any>(`
    SELECT
      COALESCE(SUM(CASE WHEN status <> 'CANCELLED' THEN 1 ELSE 0 END), 0) as totalTasks,
      COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) as pendingCount,
      COALESCE(SUM(CASE WHEN status = 'ASSIGNED' THEN 1 ELSE 0 END), 0) as assignedCount,
      COALESCE(SUM(CASE WHEN status = 'OUT_FOR_DELIVERY' THEN 1 ELSE 0 END), 0) as outForDeliveryCount,
      COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as deliveredCount,
      COALESCE(SUM(CASE WHEN status = 'EXCEPTION' THEN 1 ELSE 0 END), 0) as exceptionCount,
      COALESCE(SUM(CASE WHEN assigned_to IS NULL AND status <> 'CANCELLED' THEN 1 ELSE 0 END), 0) as unassignedCount
    FROM delivery_tasks
    ${whereClause}
  `, params);

  // Active delivery personnel workload (using cross-engine compatible is_active = 1)
  const staffRows = await db.query<any>(`
    SELECT
      u.id as staffId,
      u.full_name as staffName,
      COUNT(t.id) as assignedCount,
      COALESCE(SUM(CASE WHEN t.status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as deliveredCount,
      COALESCE(SUM(CASE WHEN t.status IN ('ASSIGNED', 'OUT_FOR_DELIVERY') THEN 1 ELSE 0 END), 0) as pendingCount,
      COALESCE(SUM(CASE WHEN t.status = 'EXCEPTION' THEN 1 ELSE 0 END), 0) as exceptionCount
    FROM staff_users u
    LEFT JOIN delivery_tasks t ON t.assigned_to = u.id AND t.service_date = ?
    WHERE u.role = 'DELIVERY_PERSON' AND u.is_active = 1
    GROUP BY u.id, u.full_name
    ORDER BY u.full_name ASC
  `, [serviceDate]);

  return {
    serviceDate,
    mealType: mealType || "ALL",
    totalTasks: Number(countsRow?.totalTasks) || 0,
    pendingCount: Number(countsRow?.pendingCount) || 0,
    assignedCount: Number(countsRow?.assignedCount) || 0,
    outForDeliveryCount: Number(countsRow?.outForDeliveryCount) || 0,
    deliveredCount: Number(countsRow?.deliveredCount) || 0,
    exceptionCount: Number(countsRow?.exceptionCount) || 0,
    unassignedCount: Number(countsRow?.unassignedCount) || 0,
    staffWorkload: staffRows.map((r) => ({
      staffId: r.staffId,
      staffName: r.staffName,
      assignedCount: Number(r.assignedCount) || 0,
      deliveredCount: Number(r.deliveredCount) || 0,
      pendingCount: Number(r.pendingCount) || 0,
      exceptionCount: Number(r.exceptionCount) || 0,
    })),
  };
}

/**
 * Lists all active delivery personnel available for assignment.
 * Requires delivery.read permission.
 */
export async function listActiveDeliveryStaff(
  actor: AuthenticatedUser,
  asyncDb?: AsyncDb
): Promise<Array<{
  id: string;
  fullName: string;
  username: string;
}>> {
  requirePermission(actor, "delivery.read");

  const db = asyncDb || getAsyncDb();
  const rows = await db.query<any>(`
    SELECT id, full_name as fullName, username
    FROM staff_users
    WHERE role = 'DELIVERY_PERSON' AND is_active = 1
    ORDER BY full_name ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    username: r.username,
  }));
}

export interface DefaultDeliveryStaffResolution {
  staff: { id: string; fullName: string; username: string } | null;
  /** How the person was chosen; "UNAVAILABLE" when the partner set in Settings is switched off. */
  source: "SETTING" | "ENV" | "OLDEST_ACTIVE" | "UNAVAILABLE" | "NONE";
  /** The partner chosen in Settings when it can no longer take deliveries. */
  configured?: { id: string; fullName: string | null } | null;
}

/**
 * Resolves the default delivery person for auto-assigned orders.
 *
 * 1. The delivery partner chosen in Settings. If that account is switched off (or no longer a
 *    delivery account), nobody is chosen: orders wait unassigned and the Owner/Manager get an
 *    alert, rather than the work silently going to someone else.
 * 2. Without a Settings choice: ERP_DEFAULT_DELIVERY_USERNAME, when set and pointing at an active
 *    DELIVERY_PERSON.
 * 3. Otherwise the longest-serving active DELIVERY_PERSON (the single-driver setup).
 * Never matches on personal names and never returns a non-delivery role.
 */
export async function resolveDefaultDeliveryStaff(asyncDb?: AsyncDb): Promise<DefaultDeliveryStaffResolution> {
  const db = asyncDb || getAsyncDb();
  const configuredId = (await getSettings(db)).delivery.defaultDriverId;
  if (configuredId) {
    const row = await db.queryOne<{ id: string; fullName: string; username: string; role: string; isActive: number | boolean }>(`
      SELECT id, full_name as "fullName", username, role, is_active as "isActive"
      FROM staff_users WHERE id = ?
    `, [configuredId]);
    if (row && row.role === "DELIVERY_PERSON" && Number(row.isActive)) {
      return { staff: { id: row.id, fullName: row.fullName, username: row.username }, source: "SETTING" };
    }
    return { staff: null, source: "UNAVAILABLE", configured: { id: configuredId, fullName: row?.fullName ?? null } };
  }
  const configured = process.env.ERP_DEFAULT_DELIVERY_USERNAME?.trim().toLowerCase();
  if (configured) {
    const row = await db.queryOne<{ id: string; fullName: string; username: string }>(`
      SELECT id, full_name as "fullName", username
      FROM staff_users
      WHERE role = 'DELIVERY_PERSON' AND is_active = 1 AND lower(username) = ?
    `, [configured]);
    if (row) return { staff: row, source: "ENV" };
  }
  const row = await db.queryOne<{ id: string; fullName: string; username: string }>(`
    SELECT id, full_name as "fullName", username
    FROM staff_users
    WHERE role = 'DELIVERY_PERSON' AND is_active = 1
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `);
  return row ? { staff: row, source: "OLDEST_ACTIVE" } : { staff: null, source: "NONE" };
}

export async function getDefaultDeliveryStaff(
  asyncDb?: AsyncDb
): Promise<{ id: string; fullName: string; username: string } | null> {
  return (await resolveDefaultDeliveryStaff(asyncDb)).staff;
}

/** @deprecated Use getDefaultDeliveryStaff. Kept for existing callers. */
export const getCanonicalSureshDeliveryStaff = getDefaultDeliveryStaff;

/**
 * Records a payment collection directly for a delivery task.
 * Requires delivery.update permission.
 */
export async function recordDeliveryCollection(
  actor: AuthenticatedUser,
  taskId: string,
  input: RecordDeliveryCollectionInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DeliveryTask> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.collection_recorded" });

  const db = asyncDb || getAsyncDb();
  const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [taskId]);
  if (!taskRow) {
    throw new Error(`Delivery task '${taskId}' not found.`);
  }

  const currentTask = mapRowToDeliveryTask(taskRow);

  if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
    throw new AuthorizationError(403, "You are not assigned to this delivery task.");
  }

  const idempotencyKey = input.idempotencyKey?.trim() || null;
  if (idempotencyKey && currentTask.collectionIdempotencyKey === idempotencyKey) {
    const prior = await db.queryOne<{ amount: number | string; payment_method: string }>(
      "SELECT amount, payment_method FROM delivery_collections WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (prior && (Number(prior.amount) !== Number(input.collectedAmount) || prior.payment_method !== normalizePaymentMethod(input.paymentMethod))) {
      throw new Error("This payment reference was already used for a different amount or method. Close the form and record the payment again.");
    }
    return (await getDeliveryTaskById(actor, taskId, db))!.task;
  }
  if (currentTask.status === "CANCELLED") {
    throw new Error("This delivery was cancelled; no payment can be recorded on it.");
  }
  if (currentTask.subscriptionId && (await hasDeliveryOpsSchema(db))) {
    throw new Error("Subscription meals are billed monthly; no payment is taken at the door.");
  }

  // Order-backed deliveries: this records a further payment against the balance (added to what
  // was already collected), never more than the amount due for the delivered items.
  const order = (await loadTaskOrders(db, [taskId])).get(taskId);
  if (order) {
    return collectOrderBalance(actor, currentTask, order, input, idempotencyKey, clientIp, db);
  }

  const collectedAmount = Math.round(Number(input.collectedAmount));
  if (collectedAmount <= 0) {
    throw new Error("Collected amount must be a positive integer.");
  }

  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  const notes = input.notes?.trim() || null;
  const now = new Date().toISOString();
  const eventId = `devt_${crypto.randomUUID()}`;
  const legacyKey = idempotencyKey || `dcol_${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    await tx.execute(`
      UPDATE delivery_tasks
      SET
        collection_status = 'COLLECTED',
        collected_amount = collected_amount + ?,
        collected_payment_method = COALESCE(collected_payment_method, ?),
        collection_idempotency_key = COALESCE(?, collection_idempotency_key),
        updated_at = ?
      WHERE id = ?
    `, [
      collectedAmount,
      paymentMethod,
      legacyKey,
      now,
      taskId,
    ]);
    await recordCustodyCollection(tx, {
      deliveryTaskId: taskId,
      collectedBy: actor.id,
      amount: collectedAmount,
      paymentMethod,
      collectedAt: now,
      idempotencyKey: legacyKey,
      notes,
      serviceDate: currentTask.serviceDate,
    });

    await tx.execute(`
      INSERT INTO delivery_task_events (
        id, task_id, event_type, from_status, to_status,
        actor_id, actor_name, notes, created_at
      ) VALUES (?, ?, 'DELIVERED', ?, ?, ?, ?, ?, ?)
    `, [
      eventId,
      taskId,
      currentTask.status,
      currentTask.status,
      actor.id,
      actor.fullName,
      `Doorstep collection recorded: ₹${collectedAmount} via ${paymentMethod}.${notes ? ` Note: ${notes}` : ""}`,
      now,
    ]);

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.collection_recorded",
      targetType: "delivery_task",
      targetId: taskId,
      metadata: {
        collectedAmount,
        paymentMethod,
        collectionStatus: "COLLECTED",
        serviceDate: currentTask.serviceDate,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedDetail = await getDeliveryTaskById(actor, taskId, db);
  return updatedDetail!.task;
}

async function collectOrderBalance(
  actor: AuthenticatedUser,
  currentTask: DeliveryTask,
  order: TaskOrderData,
  input: RecordDeliveryCollectionInput,
  idempotencyKey: string | null,
  clientIp: string | undefined,
  db: AsyncDb
): Promise<DeliveryTask> {
  if (currentTask.status !== "DELIVERED") {
    throw new Error("Record the delivery first; payment is collected against delivered items.");
  }
  const amount = Number(input.collectedAmount);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Amount must be a whole number of rupees greater than 0.");
  }
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  const notes = input.notes?.trim() || null;
  const amountDue = expectedAmountFor(currentTask, order.lines);
  const now = new Date().toISOString();
  const collectionKey = idempotencyKey || `dcol_${crypto.randomUUID()}`;

  await db.transaction(async (tx) => {
    // Serialise concurrent collections on this task and re-read the current total under the lock.
    const locked = await tx.queryOne<any>(
      `SELECT collected_amount, collected_payment_method, collection_status, collection_idempotency_key
       FROM delivery_tasks WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`,
      [currentTask.id]
    );
    // Replays of one collection (double click, network retry, offline resend) carry the same key:
    // they return without a second record. A key reused for a different payment is refused.
    if (idempotencyKey) {
      const prior = await tx.queryOne<{ delivery_task_id: string; amount: number | string; payment_method: string }>(
        "SELECT delivery_task_id, amount, payment_method FROM delivery_collections WHERE idempotency_key = ?",
        [idempotencyKey]
      );
      if (prior) {
        if (prior.delivery_task_id !== currentTask.id || Number(prior.amount) !== amount || prior.payment_method !== paymentMethod) {
          throw new Error("This payment reference was already used for a different amount or method. Close the form and record the payment again.");
        }
        return;
      }
      if (locked?.collection_idempotency_key === idempotencyKey) return;
    }
    // A payment after an earlier handover is simply a new collection in the receiver's custody.
    // Collections whose cashbook entry was reversed no longer count towards what was paid.
    const active = (await hasDeliveryOpsSchema(tx)) ? ` AND ${activeCollectionSql("dc")}` : "";
    const recorded = await tx.queryOne<{ total: number | null }>(
      `SELECT SUM(dc.amount) AS total FROM delivery_collections dc WHERE dc.delivery_task_id = ?${active}`,
      [currentTask.id]
    );
    const already = Number(recorded?.total ?? locked?.collected_amount ?? 0);
    // A customer's orders are one account: what this order still owes after the customer's earlier
    // payments and advances (oldest first), the figure Receivables shows for it.
    const owner = order.orderId ? await tx.queryOne<{ customer_id: string | null }>("SELECT customer_id FROM orders WHERE id = ?", [order.orderId]) : null;
    if (owner?.customer_id) {
      await acquireLedgerKeyLock(tx, `customer-dues:${owner.customer_id}`);
      const ledger = (await loadOrderLedgers(tx, [owner.customer_id])).get(owner.customer_id);
      const line = ledger?.orders.find((o) => o.id === order.orderId);
      const open = line ? line.open : Math.max(0, amountDue - already);
      if (amount > open) {
        throw new Error(
          open === 0
            ? "Nothing is outstanding on this order: the customer's earlier payments or advance already cover it."
            : `Only ₹${open} is outstanding on this order (₹${amountDue} due; the rest is covered by payments and the customer's credit).`
        );
      }
    } else if (already + amount > amountDue) {
      throw new Error(`Only ₹${Math.max(0, amountDue - already)} is outstanding on this order (₹${amountDue} due, ₹${already} collected).`);
    }
    const total = already + amount;
    await tx.execute(
      `UPDATE delivery_tasks
       SET collection_status = 'COLLECTED', collected_amount = ?, collected_payment_method = COALESCE(collected_payment_method, ?),
           collection_idempotency_key = ?, updated_at = ?
       WHERE id = ?`,
      [total, paymentMethod, collectionKey, now, currentTask.id]
    );
    // Credited to whoever received this payment (a manager collecting at the office holds it, not the driver).
    await recordCustodyCollection(tx, {
      deliveryTaskId: currentTask.id,
      orderId: order.orderId,
      collectedBy: actor.id,
      amount,
      paymentMethod,
      collectedAt: now,
      idempotencyKey: collectionKey,
      notes,
      serviceDate: currentTask.serviceDate,
    });
    await tx.execute(
      `INSERT INTO delivery_task_events (id, task_id, event_type, from_status, to_status, actor_id, actor_name, notes, created_at)
       VALUES (?, ?, 'DELIVERED', 'DELIVERED', 'DELIVERED', ?, ?, ?, ?)`,
      [
        `devt_${crypto.randomUUID()}`,
        currentTask.id,
        actor.id,
        actor.fullName,
        `Payment ₹${amount} via ${paymentMethod}. Collected ₹${total} of ₹${amountDue}; balance ₹${amountDue - total}.${notes ? ` Note: ${notes}` : ""}`,
        now,
      ]
    );
    await recordAuditEventAsync(
      {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "delivery.collection_recorded",
        targetType: "delivery_task",
        targetId: currentTask.id,
        metadata: { orderId: order.orderId, amount, paymentMethod, collectedTotal: total, amountDue, balanceDue: amountDue - total, serviceDate: currentTask.serviceDate },
        ipAddress: clientIp,
      },
      tx
    );
  });

  return (await getDeliveryTaskById(actor, currentTask.id, db))!.task;
}

// ---------------------------------------------------------------------------
// Staff-wise custody ledger (migration 0013): delivery_collections + driver_cash_handovers
// ---------------------------------------------------------------------------
//
// Every payment received for a delivery is one delivery_collections row, attributed to the staff
// member who holds the money (collected_by, a stable staff id). Custody is computed from those
// rows only, per employee:
//   undeclared          = collections not yet in any declaration (handover_id IS NULL)
//   awaiting acceptance = collections linked to a DECLARED handover
//   handed over         = accepted_cash / accepted_upi of settled handovers (ACCEPTED or
//                         DISCREPANCY_FLAGGED); the shortfall (declared − accepted) stays visible.
// A declaration links exactly the employee's undeclared collections (so nothing is declared
// twice) and is never edited afterwards; acceptance records what was actually received.

/** Records one payment in the custody ledger (inside the caller's transaction). */
async function recordCustodyCollection(
  tx: AsyncDb,
  input: {
    deliveryTaskId: string;
    orderId?: string | null;
    collectedBy: string;
    amount: number;
    paymentMethod: PaymentMethod;
    collectedAt: string;
    idempotencyKey?: string | null;
    notes?: string | null;
    /** Service date of the delivery; kept on the payment (the cashbook uses the handover date). */
    serviceDate?: string | null;
    /** Migration 0022: what the money paid (this order, an earlier order, an advance) and the stop where it was taken. */
    allocation?: "ORDER" | "PREVIOUS_DUES" | "ADVANCE";
    collectedAtTaskId?: string | null;
  }
): Promise<void> {
  if (!(input.amount > 0)) return;
  const opsSchema = await hasDeliveryOpsSchema(tx);
  const allocSchema = await hasCashShortfallSchema(tx);
  const withServiceDate = Boolean(input.serviceDate) && opsSchema;
  const collectionId = `dcol_${crypto.randomUUID()}`;
  // Owner decision (round 13): UPI is paid straight into the PG account. It is booked in the
  // cashbook when recorded and never becomes money a staff member holds or hands over.
  let directTxId: string | null = null;
  if (opsSchema && input.paymentMethod !== "CASH") {
    const bookDate = getBusinessDateString(new Date(input.collectedAt));
    await assertClosingDateNotFinalized(tx, bookDate, "TIFFIN");
    directTxId = `tx_dcol_upi_${crypto.randomUUID()}`;
    const who = await tx.queryOne<{ full_name: string }>("SELECT full_name FROM staff_users WHERE id = ?", [input.collectedBy]);
    await tx.execute(
      `INSERT INTO financial_transactions (
         id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, customer_id,
         stay_id, category, description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id,
         invoice_id, created_by, created_at, updated_at
       ) VALUES (?, 'TIFFIN_PAYMENT', ?, ?, ?, ?, NULL, NULL, NULL, 'TIFFIN_DELIVERY_COLLECTION', ?, ?, NULL, ?, 'POSTED', NULL, NULL, ?, ?, ?)`,
      [
        directTxId,
        Math.round(input.amount),
        bookDate,
        input.paymentMethod,
        collectionId,
        `${input.paymentMethod} paid directly to the PG account at delivery${input.serviceDate ? ` (${input.serviceDate})` : ""}; recorded by ${who?.full_name || "staff"}.`,
        bookDate,
        `dcol_upi_${collectionId}`,
        input.collectedBy,
        input.collectedAt,
        input.collectedAt,
      ]
    );
  }
  await tx.execute(
    `INSERT INTO delivery_collections (id, delivery_task_id, order_id, collected_by, amount, payment_method, collected_at, handover_id, idempotency_key, source, notes, created_at${withServiceDate ? ", service_date" : ""}${opsSchema ? ", transaction_id" : ""}${allocSchema ? ", allocation, collected_at_task_id" : ""})
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'APP', ?, ?${withServiceDate ? ", ?" : ""}${opsSchema ? ", ?" : ""}${allocSchema ? ", ?, ?" : ""})`,
    [
      collectionId,
      input.deliveryTaskId,
      input.orderId || null,
      input.collectedBy,
      Math.round(input.amount),
      input.paymentMethod,
      input.collectedAt,
      input.idempotencyKey || null,
      input.notes || null,
      input.collectedAt,
      ...(withServiceDate ? [input.serviceDate] : []),
      ...(opsSchema ? [directTxId] : []),
      ...(allocSchema ? [input.allocation || "ORDER", input.collectedAtTaskId || input.deliveryTaskId] : []),
    ]
  );
}

/**
 * Earlier delivered orders of a customer that still owe something (oldest first), on the same rule
 * as Receivables (orderLedger: the customer's payments applied oldest first, so an order already
 * covered by an advance is not paid twice).
 */
async function customerOpenOrders(tx: AsyncDb, customerId: string, excludeOrderId: string | null): Promise<Array<{ id: string; delivery_task_id: string; open: number }>> {
  const ledger = (await loadOrderLedgers(tx, [customerId], { excludeOrderId })).get(customerId);
  return (ledger?.orders ?? []).filter((o) => o.open > 0).map((o) => ({ id: o.id, delivery_task_id: o.deliveryTaskId, open: o.open }));
}

/**
 * A cashbook reversal of a delivery collection's own entry (UPI paid to the PG account), applied to
 * the delivery inside the reversal's transaction. The collection row stays (history); because its
 * entry is now REVERSED it no longer counts (activeCollectionSql), so the order's balance due comes
 * back. The task's copied total, status and method are recomputed from the collections that still
 * count, and the delivery timeline records the reversal. Cash collections have no entry of their
 * own, and a handover entry covers several collections, so neither reaches this function (the
 * reversal refuses handover entries before it starts). Returns null when the entry is not a
 * single delivery collection.
 */
export async function applyCollectionEntryReversal(
  tx: AsyncDb,
  entryId: string,
  actor: AuthenticatedUser,
  reason: string,
  now: string
): Promise<{ deliveryTaskId: string; orderId: string | null; amount: number; collectedNow: number } | null> {
  if (!(await hasDeliveryOpsSchema(tx))) return null;
  const collection = await tx.queryOne<{ id: string; delivery_task_id: string; order_id: string | null; amount: number | string; payment_method: string }>(
    "SELECT id, delivery_task_id, order_id, amount, payment_method FROM delivery_collections WHERE transaction_id = ?",
    [entryId]
  );
  if (!collection) return null;
  const task = await tx.queryOne<{ status: string; collection_status: string }>(
    `SELECT status, collection_status FROM delivery_tasks WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`,
    [collection.delivery_task_id]
  );
  if (!task) return null;
  const remaining = await tx.query<{ amount: number | string; payment_method: string }>(
    `SELECT dc.amount, dc.payment_method FROM delivery_collections dc
     WHERE dc.delivery_task_id = ? AND ${activeCollectionSql("dc")}
     ORDER BY dc.collected_at ASC`,
    [collection.delivery_task_id]
  );
  const collectedNow = remaining.reduce((sum, r) => sum + Number(r.amount), 0);
  const nextStatus = collectedNow === 0 && task.collection_status === "COLLECTED" ? "NONE" : task.collection_status;
  await tx.execute(
    `UPDATE delivery_tasks SET collected_amount = ?, collection_status = ?, collected_payment_method = ?, updated_at = ? WHERE id = ?`,
    [collectedNow, nextStatus, remaining[0]?.payment_method ?? null, now, collection.delivery_task_id]
  );
  const amount = Number(collection.amount);
  await tx.execute(
    `INSERT INTO delivery_task_events (id, task_id, event_type, from_status, to_status, actor_id, actor_name, notes, created_at)
     VALUES (?, ?, 'UPDATED', ?, ?, ?, ?, ?, ?)`,
    [
      `devt_${crypto.randomUUID()}`,
      collection.delivery_task_id,
      task.status,
      task.status,
      actor.id,
      actor.fullName,
      `Payment ₹${amount} via ${collection.payment_method} reversed in the cashbook: ${reason}. Collected now ₹${collectedNow}.`,
      now,
    ]
  );
  return { deliveryTaskId: collection.delivery_task_id, orderId: collection.order_id, amount, collectedNow };
}

const CUSTODY_ROW_SQL_TEMPLATE = `
  SELECT
    u.id AS staff_id, u.full_name AS staff_name, u.role AS role,
    COALESCE(c.cash_collected, 0) AS cash_collected,
    COALESCE(c.upi_collected, 0) AS upi_collected,
    COALESCE(c.cash_undeclared, 0) AS cash_undeclared,
    COALESCE(c.upi_undeclared, 0) AS upi_undeclared,
    COALESCE(c.cash_awaiting, 0) AS cash_awaiting,
    COALESCE(c.upi_awaiting, 0) AS upi_awaiting,
    COALESCE(h.cash_accepted, 0) AS cash_accepted,
    COALESCE(h.cash_recorded_all, 0) AS cash_recorded_all,
    COALESCE(h.cash_declared_pending, 0) AS cash_declared_pending,
    COALESCE(h.cash_written_off, 0) AS cash_written_off,
    COALESCE(h.upi_accepted, 0) AS upi_accepted,
    COALESCE(h.cash_declared_settled, 0) AS cash_declared_settled,
    COALESCE(h.upi_declared_settled, 0) AS upi_declared_settled,
    COALESCE(h.pending_count, 0) AS pending_count,
    COALESCE(h.discrepancy_count, 0) AS discrepancy_count
  FROM staff_users u
  LEFT JOIN (
    SELECT dc.collected_by,
      SUM(CASE WHEN dc.payment_method = 'CASH' THEN dc.amount ELSE 0 END) AS cash_collected,
      SUM(CASE WHEN dc.payment_method <> 'CASH' /*ACTIVE*/ THEN dc.amount ELSE 0 END) AS upi_collected,
      SUM(CASE WHEN dc.payment_method = 'CASH' AND dc.handover_id IS NULL THEN dc.amount ELSE 0 END) AS cash_undeclared,
      SUM(CASE WHEN dc.payment_method <> 'CASH' AND dc.handover_id IS NULL /*DIRECT*/ THEN dc.amount ELSE 0 END) AS upi_undeclared,
      SUM(CASE WHEN dc.payment_method = 'CASH' AND hh.status = 'DECLARED' THEN dc.amount ELSE 0 END) AS cash_awaiting,
      SUM(CASE WHEN dc.payment_method <> 'CASH' AND hh.status = 'DECLARED' THEN dc.amount ELSE 0 END) AS upi_awaiting
    FROM delivery_collections dc
    LEFT JOIN driver_cash_handovers hh ON hh.id = dc.handover_id
    GROUP BY dc.collected_by
  ) c ON c.collected_by = u.id
  LEFT JOIN (
    SELECT driver_id,
      SUM(CASE WHEN status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED') THEN accepted_cash ELSE 0 END) AS cash_accepted,
      SUM(/*RECORDED*/) AS cash_recorded_all,
      SUM(CASE WHEN status = 'DECLARED' THEN declared_cash ELSE 0 END) AS cash_declared_pending,
      SUM(/*WRITTEN_OFF*/) AS cash_written_off,
      SUM(CASE WHEN status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED') THEN accepted_upi ELSE 0 END) AS upi_accepted,
      SUM(CASE WHEN status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED') THEN declared_cash ELSE 0 END) AS cash_declared_settled,
      SUM(CASE WHEN status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED') THEN declared_upi ELSE 0 END) AS upi_declared_settled,
      SUM(CASE WHEN status = 'DECLARED' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN status = 'DISCREPANCY_FLAGGED' THEN 1 ELSE 0 END) AS discrepancy_count
    FROM driver_cash_handovers
    GROUP BY driver_id
  ) h ON h.driver_id = u.id`;

/** Staff custody per employee; with migration 0014, UPI booked directly to the PG account is excluded. */
async function custodyRowSql(db: AsyncDb): Promise<string> {
  const ops = await hasDeliveryOpsSchema(db);
  // Before migration 0022 a declaration's recorded cash equals its declared cash and nothing is
  // written off, so the same formulas give the earlier figures.
  const shortfall = await hasCashShortfallSchema(db);
  return CUSTODY_ROW_SQL_TEMPLATE.replace("/*DIRECT*/", ops ? "AND dc.transaction_id IS NULL" : "")
    .replace("/*ACTIVE*/", ops ? `AND ${activeCollectionSql("dc")}` : "")
    .replace("/*RECORDED*/", shortfall ? "recorded_cash" : "declared_cash")
    .replace("/*WRITTEN_OFF*/", shortfall ? "written_off_cash" : "0");
}

function mapCustodyRow(r: any): StaffCustodyRow {
  const n = (v: any) => Number(v || 0);
  // Cash awaiting verification is what was physically handed over (declared), not the collections
  // the declaration covers; what was recorded but neither handed over, received nor written off is an
  // unresolved shortage the employee still owes.
  const cashAwaiting = n(r.cash_declared_pending);
  const cashPending = n(r.cash_undeclared) + cashAwaiting;
  const upiPending = n(r.upi_undeclared) + n(r.upi_awaiting);
  const cashShort = n(r.cash_recorded_all) - cashAwaiting - n(r.cash_accepted) - n(r.cash_written_off);
  const upiShort = n(r.upi_declared_settled) - n(r.upi_accepted);
  const discrepancies = n(r.discrepancy_count);
  const pendingHandovers = n(r.pending_count);
  return {
    staffId: r.staff_id,
    staffName: r.staff_name,
    role: r.role,
    cashCollected: n(r.cash_collected),
    upiCollected: n(r.upi_collected),
    cashUndeclared: n(r.cash_undeclared),
    upiUndeclared: n(r.upi_undeclared),
    cashAwaitingAcceptance: cashAwaiting,
    upiAwaitingAcceptance: n(r.upi_awaiting),
    cashHandedOver: n(r.cash_accepted),
    upiReconciled: n(r.upi_accepted),
    cashPending,
    upiPending,
    cashShort,
    cashOwed: n(r.cash_undeclared) + Math.max(0, cashShort),
    cashWrittenOff: n(r.cash_written_off),
    upiShort,
    pendingHandovers,
    discrepancies,
    status: cashShort !== 0 || (discrepancies > 0 && upiShort !== 0)
      ? "DISCREPANCY"
      : pendingHandovers > 0
        ? "AWAITING_ACCEPTANCE"
        : cashPending > 0 || upiPending > 0
          ? "HOLDING"
          : "CLEAR",
  };
}

function canSeeAllCustody(actor: AuthenticatedUser): boolean {
  return actor.role === "SUPER_ADMIN" || actor.role === "OPERATIONS_MANAGER" || actor.role === "ACCOUNTANT";
}

/**
 * Staff-wise custody: one row per employee who has collected money, holds a handover, or is an
 * active delivery person, plus an aggregate that is the sum of those rows. Owner/Manager see all
 * employees; anyone else sees only their own row.
 */
export async function listStaffCustody(
  actor: AuthenticatedUser,
  asyncDb?: AsyncDb
): Promise<{ staff: StaffCustodyRow[]; totals: Omit<StaffCustodyRow, "staffId" | "staffName" | "role" | "status"> }> {
  if (!hasPermission(actor.role, "delivery.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }
  const db = asyncDb || getAsyncDb();
  const own = !canSeeAllCustody(actor);
  const rows = await db.query<any>(
    `${await custodyRowSql(db)}
     WHERE ${own ? "u.id = ?" : "(c.collected_by IS NOT NULL OR h.driver_id IS NOT NULL OR (u.role = 'DELIVERY_PERSON' AND u.is_active = 1))"}
     ORDER BY u.full_name`,
    own ? [actor.id] : []
  );
  const staff = rows.map(mapCustodyRow);
  const keys = [
    "cashCollected", "upiCollected", "cashUndeclared", "upiUndeclared", "cashAwaitingAcceptance", "upiAwaitingAcceptance",
    "cashHandedOver", "upiReconciled", "cashPending", "upiPending", "cashShort", "upiShort", "pendingHandovers", "discrepancies",
  ] as const;
  const totals = Object.fromEntries(keys.map((k) => [k, staff.reduce((s, r) => s + (r[k] as number), 0)])) as any;
  return { staff, totals };
}

/** One employee's custody position, collections and handover history (own only for staff). */
export async function getStaffCustodyDetail(
  actor: AuthenticatedUser,
  staffId: string,
  asyncDb?: AsyncDb
): Promise<{ custody: StaffCustodyRow; collections: StaffCustodyCollection[]; handovers: DriverCashHandover[] }> {
  if (!hasPermission(actor.role, "delivery.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }
  if (!canSeeAllCustody(actor) && actor.id !== staffId) {
    throw new AuthorizationError(403, "You can only view your own custody.");
  }
  const db = asyncDb || getAsyncDb();
  const row = await db.queryOne<any>(`${await custodyRowSql(db)} WHERE u.id = ?`, [staffId]);
  if (!row) throw new Error(`Staff member '${staffId}' not found.`);
  const collections = await db.query<any>(
    `SELECT dc.*, t.customer_name, t.resident_name, t.service_date, hh.status AS handover_status
     FROM delivery_collections dc
     JOIN delivery_tasks t ON t.id = dc.delivery_task_id
     LEFT JOIN driver_cash_handovers hh ON hh.id = dc.handover_id
     WHERE dc.collected_by = ?
     ORDER BY dc.collected_at DESC
     LIMIT 200`,
    [staffId]
  );
  const handovers = await listDriverCashHandovers(actor, { driverId: staffId }, db);
  return {
    custody: mapCustodyRow(row),
    collections: collections.map((c) => ({
      id: c.id,
      deliveryTaskId: c.delivery_task_id,
      orderId: c.order_id || null,
      customerName: c.customer_name || c.resident_name || null,
      serviceDate: c.service_date,
      amount: Number(c.amount),
      paymentMethod: c.payment_method,
      collectedAt: c.collected_at,
      handoverId: c.handover_id || null,
      handoverStatus: (c.handover_status as DriverHandoverStatus) || null,
      // Booked straight to the PG account (UPI, migration 0014): never held or handed over.
      paidToAccount: Boolean(c.transaction_id),
      source: c.source,
    })),
    handovers,
  };
}

/**
 * Declares an employee's custody for handover. The amounts are computed from the employee's
 * undeclared collections, which are linked to the declaration (so they can never be declared
 * twice). One declaration may await acceptance at a time. Requires delivery.update permission.
 */
export async function createCashHandoverDeclaration(
  actor: AuthenticatedUser,
  input: DeclareCashHandoverInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DriverCashHandover> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.cash_handover_declared" });

  // Delivery staff declare only for themselves; a manager may declare on behalf of an employee.
  const employeeId = actor.role === "DELIVERY_PERSON" ? actor.id : input.driverId?.trim() || actor.id;
  const shiftDate = input.shiftDate?.trim() || getBusinessDateString();
  if (!DATE_REGEX.test(shiftDate)) {
    throw new Error("Valid shift date in YYYY-MM-DD format is required.");
  }
  const statedCash = input.declaredCash === undefined || input.declaredCash === null || (input.declaredCash as any) === "" ? null : Number(input.declaredCash);
  if (statedCash !== null && (!Number.isFinite(statedCash) || statedCash < 0)) {
    throw new Error("Declared cash amount cannot be negative.");
  }

  const db = asyncDb || getAsyncDb();
  const employee = await db.queryOne<any>(`SELECT id, full_name AS "fullName", is_active AS "isActive" FROM staff_users WHERE id = ?`, [employeeId]);
  if (!employee) throw new Error(`Staff member '${employeeId}' not found.`);
  if (!Boolean(Number(employee.isActive))) throw new Error(`Staff member '${employee.fullName}' is currently inactive.`);

  const handoverId = `dch_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let notes = input.notes?.trim() || null;

  await db.transaction(async (tx) => {
    // One employee's declarations are serialised; a concurrent second declaration waits here and
    // then finds nothing left to declare.
    await acquireLedgerKeyLock(tx, `custody:${employee.id}`);
    const pending = await tx.queryOne<{ id: string }>(
      "SELECT id FROM driver_cash_handovers WHERE driver_id = ? AND status = 'DECLARED' LIMIT 1",
      [employee.id]
    );
    if (pending) {
      throw new Error("A handover declaration is already awaiting the manager's verification. It must be accepted before declaring again.");
    }
    const eligible = await tx.query<{ id: string; amount: number; payment_method: string }>(
      `SELECT id, amount, payment_method FROM delivery_collections WHERE collected_by = ? AND handover_id IS NULL${(await hasDeliveryOpsSchema(tx)) ? " AND transaction_id IS NULL" : ""}`,
      [employee.id]
    );
    const shortfallSchema = await hasCashShortfallSchema(tx);
    if (shortfallSchema) {
      // Migration 0022: the declaration records what was physically handed over (declared_cash) next
      // to what the system recorded for these collections (recorded_cash). A shortfall needs the
      // employee's reason and stays owed by them (custody) until handed over later or written off by
      // the Owner; handing over more than recorded pays back an earlier shortfall, never more.
      const recordedCash = eligible.filter((c) => c.payment_method === "CASH").reduce((s, c) => s + Number(c.amount), 0);
      const recordedUpi = eligible.filter((c) => c.payment_method !== "CASH").reduce((s, c) => s + Number(c.amount), 0);
      const owedBefore = await tx.queryOne<{ short: number | string }>(
        `SELECT COALESCE(SUM(recorded_cash - accepted_cash - written_off_cash), 0) AS short
         FROM driver_cash_handovers WHERE driver_id = ? AND status <> 'DECLARED'`,
        [employee.id]
      );
      const earlierShort = Math.max(0, Number(owedBefore?.short || 0));
      const handed = statedCash === null ? recordedCash : Math.round(statedCash);
      if (eligible.length === 0 && earlierShort === 0) throw new Error("There is no cash to hand over.");
      if (handed > recordedCash + earlierShort) {
        throw new Error(`You can hand over at most ₹${recordedCash + earlierShort} (₹${recordedCash} collected${earlierShort ? ` + ₹${earlierShort} still owed from earlier` : ""}).`);
      }
      if (eligible.length === 0 && recordedUpi === 0 && handed === 0) throw new Error("Enter the cash you are handing over.");
      const shortfall = recordedCash - handed;
      const shortfallReason = shortfall > 0 ? notes : null;
      if (shortfall > 0 && (!shortfallReason || shortfallReason.length < 5)) {
        throw new Error(`Recorded cash is ₹${recordedCash}; you are handing over ₹${handed}. Explain the ₹${shortfall} difference (at least 5 characters).`);
      }
      await tx.execute(
        `INSERT INTO driver_cash_handovers (
           id, driver_id, shift_date, declared_cash, recorded_cash, shortfall_reason, accepted_cash, variance, variance_reason, status,
           declared_upi, accepted_upi, declared_by, notes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL, 'DECLARED', ?, 0, ?, ?, ?, ?)`,
        [handoverId, employee.id, shiftDate, handed, recordedCash, shortfallReason, recordedUpi, actor.id, shortfall > 0 ? null : notes, now, now]
      );
      if (eligible.length > 0) {
        const linkedNow = await tx.execute(
          `UPDATE delivery_collections SET handover_id = ?
           WHERE id IN (${eligible.map(() => "?").join(", ")}) AND handover_id IS NULL`,
          [handoverId, ...eligible.map((c) => c.id)]
        );
        if (linkedNow.changes !== eligible.length) throw new Error("Collections changed while declaring. Please try again.");
      }
      await recordAuditEventAsync({
        actorId: actor.id,
        actorUsername: actor.username,
        action: "delivery.cash_handover_declared",
        targetType: "driver_cash_handover",
        targetId: handoverId,
        metadata: {
          driverId: employee.id,
          driverName: employee.fullName,
          declaredBy: actor.id,
          shiftDate,
          recordedCash,
          handedOverCash: handed,
          shortfall,
          shortfallReason,
          earlierShortBefore: earlierShort,
          declaredUpi: recordedUpi,
          collectionIds: eligible.map((c) => c.id),
        },
        ipAddress: clientIp,
      }, tx);
      return;
    }
    if (eligible.length === 0) {
      throw new Error("There is no cash to hand over.");
    }
    const declaredCash = eligible.filter((c) => c.payment_method === "CASH").reduce((s, c) => s + Number(c.amount), 0);
    const declaredUpi = eligible.filter((c) => c.payment_method !== "CASH").reduce((s, c) => s + Number(c.amount), 0);
    // A different amount than recorded needs a reason. The declaration still closes every recorded
    // collection (custody stays exact); the stated amount and reason go to the manager, who records
    // what was actually received when counting, so any difference becomes a flagged discrepancy.
    if (statedCash !== null && Math.round(statedCash) !== declaredCash) {
      if (!notes) {
        throw new Error(`Recorded cash total is ₹${declaredCash}; you entered ₹${Math.round(statedCash)}. Add a reason for the difference.`);
      }
      notes = `Handing over ₹${Math.round(statedCash)} of ₹${declaredCash} recorded. Reason: ${notes}`;
    }

    await tx.execute(
      `INSERT INTO driver_cash_handovers (
         id, driver_id, shift_date, declared_cash, accepted_cash, variance, variance_reason, status,
         declared_upi, accepted_upi, declared_by, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 0, 0, NULL, 'DECLARED', ?, 0, ?, ?, ?, ?)`,
      [handoverId, employee.id, shiftDate, declaredCash, declaredUpi, actor.id, notes, now, now]
    );
    const linked = await tx.execute(
      `UPDATE delivery_collections SET handover_id = ?
       WHERE id IN (${eligible.map(() => "?").join(", ")}) AND handover_id IS NULL`,
      [handoverId, ...eligible.map((c) => c.id)]
    );
    if (linked.changes !== eligible.length) {
      throw new Error("Collections changed while declaring. Please try again.");
    }

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.cash_handover_declared",
      targetType: "driver_cash_handover",
      targetId: handoverId,
      metadata: {
        driverId: employee.id,
        driverName: employee.fullName,
        declaredBy: actor.id,
        shiftDate,
        declaredCash,
        declaredUpi,
        collectionIds: eligible.map((c) => c.id),
      },
      ipAddress: clientIp,
    }, tx);
  });

  const row = await db.queryOne<any>(`${HANDOVER_SELECT} WHERE h.id = ?`, [handoverId]);
  return mapRowToDriverCashHandover(row);
}

/**
 * Verifies and accepts a declaration: records the cash actually counted and the UPI confirmed as
 * received, posts each to the cashbook once, and settles exactly the collections linked to the
 * declaration. Any difference requires an explanation and marks the handover DISCREPANCY_FLAGGED;
 * the original declared figures are never changed. Requires a manager/owner/accountant who is not
 * the employee (or the person who declared it).
 */
export async function acceptCashHandover(
  actor: AuthenticatedUser,
  handoverId: string,
  input: AcceptCashHandoverInput,
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<DriverCashHandover> {
  if (!canSeeAllCustody(actor)) {
    throw new AuthorizationError(403, "You do not have permission to verify and accept driver cash handovers.");
  }
  const db = asyncDb || getAsyncDb();
  const handoverRow = await db.queryOne<any>(`${HANDOVER_SELECT} WHERE h.id = ?`, [handoverId]);
  if (!handoverRow) {
    throw new Error(`Cash handover '${handoverId}' not found.`);
  }
  // Separation of duties: nobody verifies their own custody (the Owner, who has no one above, may).
  if ((actor.id === handoverRow.driver_id || actor.id === handoverRow.declared_by) && actor.role !== "SUPER_ADMIN") {
    throw new AuthorizationError(403, "Delivery personnel cannot accept their own cash handover. An accountant or manager must verify and accept cash.");
  }
  if (handoverRow.status !== "DECLARED") {
    throw new Error("This cash handover has already been accepted and settled.");
  }
  // Stale-record protection: the verifier must be looking at this exact declaration.
  if (input.expectedDriverId !== undefined && input.expectedDriverId !== handoverRow.driver_id) {
    throw new Error("This declaration belongs to a different employee than the one on your screen. Reload and verify again.");
  }
  const declaredCash = Number(handoverRow.declared_cash || 0);
  const declaredUpi = Number(handoverRow.declared_upi || 0);
  if (
    (input.expectedDeclaredCash !== undefined && Number(input.expectedDeclaredCash) !== declaredCash) ||
    (input.expectedDeclaredUpi !== undefined && Number(input.expectedDeclaredUpi) !== declaredUpi)
  ) {
    throw new Error("The declared amounts differ from what is on your screen. Reload and verify again.");
  }

  const acceptedCash = Number(input.acceptedCash);
  if (!Number.isInteger(acceptedCash) || acceptedCash < 0) {
    throw new Error("Cash received must be a whole number of rupees, 0 or more.");
  }
  let acceptedUpi = 0;
  if (declaredUpi > 0) {
    if (input.acceptedUpi === undefined || input.acceptedUpi === null || (input.acceptedUpi as any) === "") {
      throw new Error(`Confirm how much of the ₹${declaredUpi} UPI was received in the business account.`);
    }
    acceptedUpi = Number(input.acceptedUpi);
    if (!Number.isInteger(acceptedUpi) || acceptedUpi < 0) {
      throw new Error("UPI confirmed must be a whole number of rupees, 0 or more.");
    }
    if (acceptedUpi > declaredUpi) {
      throw new Error(`UPI confirmed (₹${acceptedUpi}) cannot exceed the ₹${declaredUpi} UPI collected.`);
    }
  } else if (input.acceptedUpi !== undefined && input.acceptedUpi !== null && Number(input.acceptedUpi) > 0) {
    throw new Error("No UPI was declared in this handover.");
  }

  const variance = acceptedCash - declaredCash;
  const upiVariance = acceptedUpi - declaredUpi;
  const varianceReason = input.varianceReason?.trim() || null;
  const hasDiscrepancy = variance !== 0 || upiVariance !== 0;
  if (hasDiscrepancy && (!varianceReason || varianceReason.length < 5)) {
    throw new Error(
      `Received amounts differ from the declaration (cash ₹${acceptedCash} of ₹${declaredCash}${declaredUpi > 0 ? `, UPI ₹${acceptedUpi} of ₹${declaredUpi}` : ""}). A variance explanation of at least 5 characters is mandatory.`
    );
  }
  const finalStatus: DriverHandoverStatus = hasDiscrepancy ? "DISCREPANCY_FLAGGED" : "ACCEPTED";
  const now = new Date().toISOString();

  // Owner decision (round 11): the cashbook records the day the money was actually handed over
  // (accepted); the declaration keeps its shift date and each collection its delivery's service
  // date. Switched on together with migration 0014; before it the shift date is used as before.
  const handoverDate = (await hasDeliveryOpsSchema(db)) ? getBusinessDateString() : handoverRow.shift_date;

  await db.transaction(async (tx) => {
    await assertClosingDateNotFinalized(tx, handoverDate, "TIFFIN");
    // Re-read under a row lock: a concurrent or repeated acceptance stops here.
    const locked = await tx.queryOne<{ status: string }>(
      `SELECT status FROM driver_cash_handovers WHERE id = ?${tx.isPostgres ? " FOR UPDATE" : ""}`,
      [handoverId]
    );
    if (!locked || locked.status !== "DECLARED") {
      throw new Error("This cash handover has already been accepted and settled.");
    }

    // The money reaches the business books here, once per handover and payment kind.
    const post = async (kind: "CASH" | "UPI", amount: number) => {
      if (amount <= 0) return null;
      const txId = `tx_dch_${kind === "CASH" ? "" : "upi_"}${crypto.randomUUID()}`;
      await tx.execute(
        `INSERT INTO financial_transactions (
           id, transaction_type, amount, transaction_date, payment_method, reference_number, resident_id, customer_id,
           stay_id, category, description, billing_period, payee_vendor, idempotency_key, status, reversal_of_id,
           invoice_id, created_by, created_at, updated_at
         ) VALUES (?, 'TIFFIN_PAYMENT', ?, ?, ?, ?, NULL, NULL, NULL, 'TIFFIN_DELIVERY_COLLECTION', ?, ?, NULL, ?, 'POSTED', NULL, NULL, ?, ?, ?)`,
        [
          txId,
          amount,
          handoverDate,
          kind,
          handoverId,
          `${kind === "CASH" ? "Cash" : "UPI"} handover from ${handoverRow.driver_name} (declared ${handoverRow.shift_date}). Declared ₹${kind === "CASH" ? declaredCash : declaredUpi}, received ₹${amount}.`,
          handoverRow.shift_date,
          kind === "CASH" ? `dch_tx_${handoverId}` : `dch_upi_${handoverId}`,
          actor.id,
          now,
          now,
        ]
      );
      return txId;
    };
    const cashTxId = await post("CASH", acceptedCash);
    const upiTxId = await post("UPI", acceptedUpi);

    const updated = await tx.execute(
      `UPDATE driver_cash_handovers
       SET accepted_cash = ?, accepted_upi = ?, variance = ?, variance_reason = ?, status = ?,
           transaction_id = ?, upi_transaction_id = ?, accepted_by = ?, accepted_at = ?,
           notes = COALESCE(?, notes), updated_at = ?
       WHERE id = ? AND status = 'DECLARED'`,
      [acceptedCash, acceptedUpi, variance, varianceReason, finalStatus, cashTxId, upiTxId, actor.id, now, input.notes?.trim() || null, now, handoverId]
    );
    if (updated.changes === 0) {
      throw new Error("This cash handover has already been accepted and settled.");
    }

    // Deliveries whose every collection is now settled show as handed over.
    await tx.execute(
      `UPDATE delivery_tasks
       SET collection_status = 'HANDED_OVER', handover_id = ?, updated_at = ?
       WHERE id IN (SELECT delivery_task_id FROM delivery_collections WHERE handover_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM delivery_collections c2
           LEFT JOIN driver_cash_handovers h2 ON h2.id = c2.handover_id
           WHERE c2.delivery_task_id = delivery_tasks.id AND (c2.handover_id IS NULL OR h2.status = 'DECLARED')
         )`,
      [handoverId, now, handoverId]
    );

    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.cash_handover_accepted",
      targetType: "driver_cash_handover",
      targetId: handoverId,
      metadata: {
        driverId: handoverRow.driver_id,
        shiftDate: handoverRow.shift_date,
        declaredCash,
        recordedCash: Number(handoverRow.recorded_cash ?? declaredCash),
        shortfall: Number(handoverRow.recorded_cash ?? declaredCash) - declaredCash,
        acceptedCash,
        declaredUpi,
        acceptedUpi,
        variance,
        upiVariance,
        varianceReason,
        status: finalStatus,
        transactionId: cashTxId,
        upiTransactionId: upiTxId,
      },
      ipAddress: clientIp,
    }, tx);
  });

  const updatedRow = await db.queryOne<any>(`${HANDOVER_SELECT} WHERE h.id = ?`, [handoverId]);
  return mapRowToDriverCashHandover(updatedRow);
}

/**
 * Custody summary for one employee (kept for existing callers). cashInCustody is everything the
 * employee still holds across all dates; totals for collected/accepted are for the given date.
 */
/**
 * Owner-only: write off part or all of an employee's unresolved cash shortage (migration 0022), e.g.
 * cash genuinely lost. No money enters the books; the amount, reason, Owner and time are kept on the
 * employee's latest settled handover and in the audit log, and the shortage stops being owed.
 */
export async function writeOffCashShortfall(
  actor: AuthenticatedUser,
  staffId: string,
  input: { amount: number; reason: string },
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<StaffCustodyRow> {
  if (actor.role !== "SUPER_ADMIN") {
    throw new AuthorizationError(403, "Only the Owner can write off a cash shortage.");
  }
  const db = asyncDb || getAsyncDb();
  if (!(await hasCashShortfallSchema(db))) {
    throw Object.assign(new Error("Writing off a shortage becomes available after database migration 0022."), { statusCode: 409 });
  }
  const amount = Number(input.amount);
  const reason = String(input.reason || "").trim();
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Enter a whole number of rupees greater than 0.");
  if (reason.length < 5) throw new Error("Give the reason for the write-off (at least 5 characters).");
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    await acquireLedgerKeyLock(tx, `custody:${staffId}`);
    const row = mapCustodyRow(await tx.queryOne<any>(`${await custodyRowSql(tx)} WHERE u.id = ?`, [staffId]));
    if (!(row.cashShort > 0)) throw new Error("This employee has no unresolved cash shortage.");
    if (amount > row.cashShort) throw new Error(`The unresolved shortage is ₹${row.cashShort}; you can write off at most that.`);
    const target = await tx.queryOne<{ id: string }>(
      `SELECT id FROM driver_cash_handovers WHERE driver_id = ? AND status <> 'DECLARED' ORDER BY created_at DESC LIMIT 1${tx.isPostgres ? " FOR UPDATE" : ""}`,
      [staffId]
    );
    if (!target) throw new Error("A shortage can be written off once its handover has been verified.");
    await tx.execute(
      `UPDATE driver_cash_handovers
       SET written_off_cash = written_off_cash + ?, written_off_by = ?, written_off_at = ?,
           write_off_reason = CASE WHEN write_off_reason IS NULL THEN ? ELSE write_off_reason || ' | ' || ? END, updated_at = ?
       WHERE id = ?`,
      [amount, actor.id, now, `₹${amount}: ${reason}`, `₹${amount}: ${reason}`, now, target.id]
    );
    await recordAuditEventAsync({
      actorId: actor.id,
      actorUsername: actor.username,
      action: "delivery.cash_shortfall_written_off",
      targetType: "driver_cash_handover",
      targetId: target.id,
      metadata: { staffId, amount, reason, shortageBefore: row.cashShort, shortageAfter: row.cashShort - amount },
      ipAddress: clientIp,
    }, tx);
  });
  return mapCustodyRow(await db.queryOne<any>(`${await custodyRowSql(db)} WHERE u.id = ?`, [staffId]));
}

export async function getDriverCustodySummary(
  actor: AuthenticatedUser,
  driverId: string,
  shiftDate: string,
  asyncDb?: AsyncDb
): Promise<DriverCustodySummary> {
  if (!hasPermission(actor.role, "delivery.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }
  if (actor.role === "DELIVERY_PERSON" && actor.id !== driverId) {
    throw new AuthorizationError(403, "You can only view your own cash custody summary.");
  }
  const db = asyncDb || getAsyncDb();
  const driver = await db.queryOne<any>(`SELECT id, full_name AS "fullName" FROM staff_users WHERE id = ?`, [driverId]);
  if (!driver) throw new Error(`Staff member '${driverId}' not found.`);
  const day = await db.queryOne<any>(
    `SELECT COALESCE(SUM(dc.amount), 0) AS total
     FROM delivery_collections dc JOIN delivery_tasks t ON t.id = dc.delivery_task_id
     WHERE dc.collected_by = ? AND dc.payment_method = 'CASH' AND t.service_date = ?`,
    [driverId, shiftDate]
  );
  const held = await db.queryOne<any>(
    `SELECT COALESCE(SUM(dc.amount), 0) AS cash, COUNT(DISTINCT dc.delivery_task_id) AS tasks
     FROM delivery_collections dc LEFT JOIN driver_cash_handovers h ON h.id = dc.handover_id
     WHERE dc.collected_by = ? AND dc.payment_method = 'CASH' AND (dc.handover_id IS NULL OR h.status = 'DECLARED')`,
    [driverId]
  );
  const accepted = await db.queryOne<any>(
    `SELECT COALESCE(SUM(accepted_cash), 0) AS total FROM driver_cash_handovers
     WHERE driver_id = ? AND shift_date = ? AND status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED')`,
    [driverId, shiftDate]
  );
  return {
    driverId: driver.id,
    driverName: driver.fullName,
    shiftDate,
    totalCashCollected: Number(day?.total || 0),
    totalAcceptedHandover: Number(accepted?.total || 0),
    cashInCustody: Number(held?.cash || 0),
    pendingCollectionTasksCount: Number(held?.tasks || 0),
  };
}

/** Aggregate of the staff-wise ledger for a date (kept for existing callers). */
export async function getFleetCustodySummary(
  actor: AuthenticatedUser,
  shiftDate: string,
  asyncDb?: AsyncDb
): Promise<DriverCustodySummary & { activeDriverCount: number }> {
  if (!hasPermission(actor.role, "delivery.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }
  const db = asyncDb || getAsyncDb();
  const day = await db.queryOne<any>(
    `SELECT COALESCE(SUM(dc.amount), 0) AS total
     FROM delivery_collections dc JOIN delivery_tasks t ON t.id = dc.delivery_task_id
     WHERE dc.payment_method = 'CASH' AND t.service_date = ?`,
    [shiftDate]
  );
  const held = await db.queryOne<any>(
    `SELECT COALESCE(SUM(dc.amount), 0) AS cash, COUNT(DISTINCT dc.delivery_task_id) AS tasks
     FROM delivery_collections dc LEFT JOIN driver_cash_handovers h ON h.id = dc.handover_id
     WHERE dc.payment_method = 'CASH' AND (dc.handover_id IS NULL OR h.status = 'DECLARED')`
  );
  const accepted = await db.queryOne<any>(
    `SELECT COALESCE(SUM(accepted_cash), 0) AS total FROM driver_cash_handovers
     WHERE shift_date = ? AND status IN ('ACCEPTED', 'DISCREPANCY_FLAGGED')`,
    [shiftDate]
  );
  const drivers = await db.queryOne<any>(`SELECT COUNT(*) AS count FROM staff_users WHERE role = 'DELIVERY_PERSON' AND is_active = 1`);
  return {
    driverId: "FLEET_AGGREGATE",
    driverName: "All Delivery Drivers",
    shiftDate,
    totalCashCollected: Number(day?.total || 0),
    totalAcceptedHandover: Number(accepted?.total || 0),
    cashInCustody: Number(held?.cash || 0),
    pendingCollectionTasksCount: Number(held?.tasks || 0),
    activeDriverCount: Number(drivers?.count || 0),
  };
}

/**
 * Lists cash handover declarations.
 * Requires delivery.read permission.
 */
export async function listDriverCashHandovers(
  actor: AuthenticatedUser,
  filters?: { driverId?: string; shiftDate?: string; status?: DriverHandoverStatus },
  asyncDb?: AsyncDb
): Promise<DriverCashHandover[]> {
  if (!hasPermission(actor.role, "delivery.read") && !hasPermission(actor.role, "finance.read")) {
    throw new AuthorizationError(403, "Access denied. Insufficient permissions.");
  }

  const db = asyncDb || getAsyncDb();

  const conditions: string[] = [];
  const params: any[] = [];

  const targetDriver =
    actor.role === "DELIVERY_PERSON" ? actor.id : filters?.driverId?.trim();

  if (targetDriver) {
    conditions.push("h.driver_id = ?");
    params.push(targetDriver);
  }

  if (filters?.shiftDate?.trim()) {
    conditions.push("h.shift_date = ?");
    params.push(filters.shiftDate.trim());
  }

  if (filters?.status?.trim()) {
    conditions.push("h.status = ?");
    params.push(filters.status.trim());
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await db.query<any>(`${HANDOVER_SELECT} ${whereClause} ORDER BY h.created_at DESC`, params);

  return rows.map(mapRowToDriverCashHandover);
}

/**
 * Synchronizes offline-queued delivery actions in batch with conflict detection.
 * Returns per-item sync statuses: SYNCED, IDEMPOTENT_IGNORED, CONFLICT, or ERROR.
 */
export async function syncDeliveryActions(
  actor: AuthenticatedUser,
  actions: QueuedDeliveryAction[],
  clientIp?: string,
  asyncDb?: AsyncDb
): Promise<{
  results: Array<{
    actionId: string;
    success: boolean;
    taskId?: string;
    status: "SYNCED" | "IDEMPOTENT_IGNORED" | "CONFLICT" | "ERROR";
    error?: string;
    task?: DeliveryTask;
  }>;
}> {
  requirePermission(actor, "delivery.update", { ip: clientIp, action: "delivery.offline_sync" });

  const db = asyncDb || getAsyncDb();
  const results: Array<{
    actionId: string;
    success: boolean;
    taskId?: string;
    status: "SYNCED" | "IDEMPOTENT_IGNORED" | "CONFLICT" | "ERROR";
    error?: string;
    task?: DeliveryTask;
  }> = [];

  for (const item of actions) {
    try {
      if (!item.taskId) {
        results.push({
          actionId: item.id,
          success: false,
          status: "ERROR",
          error: "Missing taskId in queued action.",
        });
        continue;
      }

      // Security Invariant: Account context isolation. An action must name the staff member who
      // queued it; one without an owner, or queued by someone else, is never applied.
      if (!item.userId || item.userId !== actor.id) {
        results.push({
          actionId: item.id,
          success: false,
          taskId: item.taskId,
          status: "CONFLICT",
          error: "Security violation: Action was queued by a different authenticated account and cannot be synchronized under this session.",
        });
        continue;
      }

      const taskRow = await db.queryOne<any>(`SELECT * FROM delivery_tasks WHERE id = ?`, [item.taskId]);
      if (!taskRow) {
        results.push({
          actionId: item.id,
          success: false,
          taskId: item.taskId,
          status: "ERROR",
          error: `Task '${item.taskId}' was not found on server.`,
        });
        continue;
      }

      const currentTask = mapRowToDeliveryTask(taskRow);

      if (actor.role === "DELIVERY_PERSON" && currentTask.assignedTo !== actor.id) {
        results.push({
          actionId: item.id,
          success: false,
          taskId: item.taskId,
          status: "CONFLICT",
          error: "Task has been reassigned to another delivery person.",
          task: currentTask,
        });
        continue;
      }

      if (item.action === "COMPLETE_DELIVERY") {
        if (currentTask.status === "DELIVERED") {
          // Idempotent: already delivered by this driver
          results.push({
            actionId: item.id,
            success: true,
            taskId: item.taskId,
            status: "IDEMPOTENT_IGNORED",
            task: currentTask,
          });
          continue;
        }

        const replayedNotDelivered =
          Array.isArray(item.payload?.lines) &&
          item.payload.lines.length > 0 &&
          item.payload.lines.every((l: any) => Number(l?.deliveredQuantity) === 0);
        if (currentTask.status === "EXCEPTION" && replayedNotDelivered) {
          // The same "not delivered" outcome was already recorded (e.g. sent online, then replayed).
          results.push({ actionId: item.id, success: true, taskId: item.taskId, status: "IDEMPOTENT_IGNORED", task: currentTask });
          continue;
        }

        if (currentTask.status === "EXCEPTION") {
          results.push({
            actionId: item.id,
            success: false,
            taskId: item.taskId,
            status: "CONFLICT",
            error: "Task is in EXCEPTION state on server. Must be retried before delivery.",
            task: currentTask,
          });
          continue;
        }

        const completed = await completeDeliveryTask(
          actor,
          item.taskId,
          {
            recipientName: item.payload?.recipientName,
            notes: item.payload?.notes,
            collectedAmount: item.payload?.collectedAmount,
            paymentMethod: item.payload?.paymentMethod,
            idempotencyKey: item.idempotencyKey,
            // Partial-delivery fields must survive the offline path exactly as the online route passes them.
            lines: Array.isArray(item.payload?.lines) ? item.payload.lines : undefined,
            deliveredQuantity:
              item.payload?.deliveredQuantity !== undefined ? Number(item.payload.deliveredQuantity) : undefined,
            undeliveredQuantity:
              item.payload?.undeliveredQuantity !== undefined ? Number(item.payload.undeliveredQuantity) : undefined,
            undeliveredReason: item.payload?.undeliveredReason,
            itemsReconciliation: Array.isArray(item.payload?.itemsReconciliation)
              ? item.payload.itemsReconciliation
              : undefined,
            // The payment chosen at the door and the approval the phone showed then travel with the
            // queued completion; the server decides with the approval as it is now (flag, not reject).
            paymentChoice: item.payload?.paymentChoice,
            payLaterAllowedAtSelection: typeof item.payload?.payLaterAllowedAtSelection === "boolean" ? item.payload.payLaterAllowedAtSelection : undefined,
            viaOfflineSync: true,
          },
          clientIp,
          db
        );

        results.push({
          actionId: item.id,
          success: true,
          taskId: item.taskId,
          status: "SYNCED",
          task: completed,
        });
      } else if (item.action === "REPORT_EXCEPTION") {
        if (currentTask.status === "EXCEPTION") {
          results.push({
            actionId: item.id,
            success: true,
            taskId: item.taskId,
            status: "IDEMPOTENT_IGNORED",
            task: currentTask,
          });
          continue;
        }

        if (currentTask.status === "DELIVERED") {
          results.push({
            actionId: item.id,
            success: false,
            taskId: item.taskId,
            status: "CONFLICT",
            error: "Task has already been delivered on server; cannot record exception.",
            task: currentTask,
          });
          continue;
        }

        const excepted = await reportDeliveryException(
          actor,
          item.taskId,
          {
            exceptionType: item.payload?.exceptionType,
            reason: item.payload?.reason,
          },
          clientIp,
          db
        );

        results.push({
          actionId: item.id,
          success: true,
          taskId: item.taskId,
          status: "SYNCED",
          task: excepted,
        });
      } else if (item.action === "RECORD_COLLECTION") {
        if (
          item.idempotencyKey &&
          currentTask.collectionIdempotencyKey === item.idempotencyKey
        ) {
          results.push({
            actionId: item.id,
            success: true,
            taskId: item.taskId,
            status: "IDEMPOTENT_IGNORED",
            task: currentTask,
          });
          continue;
        }

        const updated = await recordDeliveryCollection(
          actor,
          item.taskId,
          {
            collectedAmount: item.payload?.collectedAmount,
            paymentMethod: item.payload?.paymentMethod,
            idempotencyKey: item.idempotencyKey,
            notes: item.payload?.notes,
          },
          clientIp,
          db
        );

        results.push({
          actionId: item.id,
          success: true,
          taskId: item.taskId,
          status: "SYNCED",
          task: updated,
        });
      } else {
        results.push({
          actionId: item.id,
          success: false,
          taskId: item.taskId,
          status: "ERROR",
          error: `Unsupported offline queue action: '${item.action}'`,
        });
      }
    } catch (err: any) {
      results.push({
        actionId: item.id,
        success: false,
        taskId: item.taskId,
        status: "ERROR",
        error: err.message || "Unknown error processing offline item.",
      });
    }
  }

  return { results };
}

