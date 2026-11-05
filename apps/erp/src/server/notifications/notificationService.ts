import { getAsyncDb } from "../database/db";
import { onBusinessDataChanged } from "../database/changeSignals";
import { AuthenticatedUser, NotificationItem } from "@/types";
import { hasPermission } from "../authorization/permissions";
import { getSettings } from "../settings/settingsService";
import { businessToday, addBusinessDays } from "@/lib/businessDate";

export interface GetNotificationsOptions {
  limit?: number;
  unreadOnly?: boolean;
}

interface NotificationCacheEntry {
  data: { items: NotificationItem[]; unreadCount: number };
  expiresAt: number;
}

type NotificationFeed = NotificationCacheEntry["data"];

const notificationsCache = new Map<string, NotificationCacheEntry>();
const NOTIFICATIONS_CACHE_TTL_MS = 30_000;
// Concurrent requests for the same feed (dashboard page render + header bell) share one computation.
const inflightFeeds = new Map<string, Promise<NotificationFeed>>();
// Bumped on every invalidation: a computation that started before it must not cache its result.
let feedGeneration = 0;

// Alerts are derived from business data; a committed business write drops every cached feed.
onBusinessDataChanged(() => invalidateNotificationCache());

export function invalidateNotificationCache(staffId?: string): void {
  feedGeneration++;
  if (staffId) {
    for (const map of [notificationsCache, inflightFeeds]) {
      for (const key of map.keys()) {
        if (key.startsWith(`${staffId}:`)) {
          map.delete(key);
        }
      }
    }
  } else {
    notificationsCache.clear();
    inflightFeeds.clear();
  }
}

function sliceFeed(feed: NotificationFeed, options?: GetNotificationsOptions) {
  const limit = options?.limit || 30;
  const filtered = options?.unreadOnly ? feed.items.filter((i) => !i.isRead) : feed.items;
  return {
    notifications: filtered.slice(0, limit),
    unreadCount: feed.unreadCount,
  };
}

/**
 * Aggregates live actionable notifications across Finance, Delivery, and Kitchen modules.
 * Tracks per-user read/unread state using staff_notification_reads table.
 */
export async function getNotifications(
  actor: AuthenticatedUser,
  options?: GetNotificationsOptions
): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
  const cacheKey = `${actor.id}:${options?.unreadOnly ? 1 : 0}`;
  const cached = notificationsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return sliceFeed(cached.data, options);
  }

  let pending = inflightFeeds.get(cacheKey);
  if (!pending) {
    const generation = feedGeneration;
    const promise: Promise<NotificationFeed> = buildNotificationFeed(actor)
      .then((feed) => {
        if (generation === feedGeneration) {
          notificationsCache.set(cacheKey, { data: feed, expiresAt: Date.now() + NOTIFICATIONS_CACHE_TTL_MS });
        }
        return feed;
      })
      .finally(() => {
        if (inflightFeeds.get(cacheKey) === promise) inflightFeeds.delete(cacheKey);
      });
    inflightFeeds.set(cacheKey, promise);
    pending = promise;
  }
  return sliceFeed(await pending, options);
}

/** Runs one feed query; a missing table (feature not installed yet) gives no items, never an error. */
async function optional<T>(q: () => Promise<T[]>): Promise<T[]> {
  try {
    return await q();
  } catch (err: any) {
    if (/does not exist|no such table|no such column/i.test(String(err?.message))) return [];
    throw err;
  }
}

/**
 * The bell feed, derived from live records (no stored notifications, so nothing can be generated
 * twice: every item has a stable id per record and is read once per person). Items are limited to
 * what the viewer's role may see: delivery management needs delivery.manage, money items
 * finance.read, Owner decisions finance.manage. Dates are business (IST) dates.
 */
async function buildNotificationFeed(actor: AuthenticatedUser): Promise<NotificationFeed> {
  const db = getAsyncDb();
  const canManageDelivery = hasPermission(actor.role, "delivery.manage");
  const canSeeMoney = hasPermission(actor.role, "finance.read");
  const isOwnerFinance = hasPermission(actor.role, "finance.manage");
  const canSeeTiffin = hasPermission(actor.role, "tiffin.read") && canManageDelivery;
  const settings = await getSettings(db);
  const today = businessToday();
  const yesterday = addBusinessDays(today, -1);
  const none = async () => [] as any[];

  const [
    readRows,
    exceptions,
    pendingSummary,
    dispatchedSummary,
    overdueResidents,
    recentPayments,
    expiringSubs,
    pendingHandovers,
    unclosed,
    proposals,
    paymentReviews,
  ] = await Promise.all([
    db.query<{ notification_id: string }>(`SELECT notification_id FROM staff_notification_reads WHERE staff_id = ?`, [actor.id]),
    // Deliveries not completed and not yet resolved (age shows on the Problems tab)
    canManageDelivery
      ? db.query<any>(`
          SELECT dt.id, dt.order_type, dt.customer_name, dt.delivery_address, dt.room_number,
                 dt.exception_reason, dt.service_date, dt.meal_type, dt.updated_at, dt.exception_at,
                 r.full_name as resident_name
          FROM delivery_tasks dt
          LEFT JOIN residents r ON r.id = dt.resident_id
          WHERE dt.status = 'EXCEPTION'
          ORDER BY dt.updated_at DESC
          LIMIT 10`)
      : none(),
    // Stops nobody has been given yet
    canManageDelivery
      ? db.query<any>(`
          SELECT service_date, meal_type, COUNT(*) as count, MAX(created_at) as latest_created
          FROM delivery_tasks
          WHERE status = 'PENDING'
          GROUP BY service_date, meal_type
          ORDER BY latest_created DESC
          LIMIT 3`)
      : none(),
    canManageDelivery
      ? db.query<any>(`
          SELECT service_date, meal_type, COUNT(*) as count, MAX(dispatched_at) as latest_dispatched
          FROM delivery_tasks
          WHERE status IN ('OUT_FOR_DELIVERY', 'DISPATCHED')
          GROUP BY service_date, meal_type
          ORDER BY latest_dispatched DESC
          LIMIT 2`)
      : none(),
    canSeeMoney
      ? db.query<any>(`
          SELECT
            r.id as resident_id,
            r.full_name,
            rm.room_number,
            COALESCE(SUM(CASE WHEN ft.transaction_type = 'RENT_CHARGE' AND ft.status = 'POSTED' THEN ft.amount ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN ft.transaction_type = 'RENT_PAYMENT' AND ft.status = 'POSTED' AND ft.customer_id IS NULL AND COALESCE(ft.category, '') <> 'TIFFIN' THEN ft.amount ELSE 0 END), 0) as balance,
            MAX(ft.created_at) as latest_activity
          FROM residents r
          JOIN resident_stays s ON s.resident_id = r.id AND s.status = 'ACTIVE'
          JOIN rooms rm ON rm.id = s.room_id
          LEFT JOIN financial_transactions ft ON ft.resident_id = r.id
          GROUP BY r.id, r.full_name, rm.room_number
          HAVING (
            COALESCE(SUM(CASE WHEN ft.transaction_type = 'RENT_CHARGE' AND ft.status = 'POSTED' THEN ft.amount ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN ft.transaction_type = 'RENT_PAYMENT' AND ft.status = 'POSTED' AND ft.customer_id IS NULL AND COALESCE(ft.category, '') <> 'TIFFIN' THEN ft.amount ELSE 0 END), 0)
          ) > 0
          ORDER BY balance DESC
          LIMIT 5`)
      : none(),
    canSeeMoney
      ? db.query<any>(`
          SELECT ft.id, ft.amount, ft.payment_method, ft.transaction_date, ft.description, ft.created_at,
                 r.full_name as resident_name, rm.room_number
          FROM financial_transactions ft
          LEFT JOIN residents r ON r.id = ft.resident_id
          LEFT JOIN resident_stays s ON s.id = ft.stay_id
          LEFT JOIN rooms rm ON rm.id = s.room_id
          WHERE ft.transaction_type = 'RENT_PAYMENT' AND ft.status = 'POSTED' AND COALESCE(ft.category, '') <> 'DEPOSIT_APPLICATION'
          ORDER BY ft.created_at DESC
          LIMIT 5`)
      : none(),
    // Subscriptions ending within 7 days (Settings → Alerts)
    canSeeTiffin && settings.notifications.subscriptionExpiry
      ? db.query<any>(`
          SELECT s.id, s.end_date, s.updated_at, c.full_name
          FROM tiffin_subscriptions s JOIN tiffin_customers c ON c.id = s.customer_id
          WHERE s.status IN ('ACTIVE', 'PAUSED') AND s.end_date IS NOT NULL AND s.end_date >= ? AND s.end_date <= ?
          ORDER BY s.end_date ASC
          LIMIT 10`, [today, addBusinessDays(today, 7)])
      : none(),
    // Cash handed over by staff but not yet checked and accepted (Settings → Alerts)
    canManageDelivery && settings.notifications.pendingHandover
      ? db.query<any>(`
          SELECT h.id, h.shift_date, h.declared_cash, h.created_at, u.full_name
          FROM driver_cash_handovers h JOIN staff_users u ON u.id = h.driver_id
          WHERE h.status = 'DECLARED'
          ORDER BY h.created_at ASC
          LIMIT 10`)
      : none(),
    // Yesterday had money movements but its cash was not closed (Owner; Settings → Alerts)
    isOwnerFinance && settings.notifications.closingReminder
      ? db.query<any>(`
          SELECT CAST(? AS text) AS closing_date, COUNT(*) AS movements
          FROM financial_transactions
          WHERE transaction_date = ? AND status = 'POSTED'
            AND NOT EXISTS (SELECT 1 FROM daily_cashbook_closings c WHERE c.closing_date = ? AND c.status = 'FINALIZED')
          HAVING COUNT(*) > 0`, [yesterday, yesterday, yesterday])
      : none(),
    // Checkout settlements a Manager sent for the Owner's approval
    isOwnerFinance
      ? optional(() => db.query<any>(`
          SELECT p.id, p.refund_amount, p.created_at, res.full_name
          FROM settlement_proposals p JOIN residents res ON res.id = p.resident_id
          WHERE p.status = 'PENDING'
          ORDER BY p.created_at ASC
          LIMIT 10`))
      : none(),
    // Orders delivered with a balance for a customer not approved for Pay Later (migration 0021;
    // without it the query fails and optional() returns nothing).
    canManageDelivery
      ? optional(() => db.query<any>(`
          SELECT o.id, o.customer_name, o.service_date, o.meal_type, o.updated_at
          FROM orders o
          WHERE o.payment_review IS NOT NULL AND o.payment_reviewed_at IS NULL
          ORDER BY o.updated_at DESC
          LIMIT 10`))
      : none(),
  ]);

  const readIds = new Set(readRows.map((r) => r.notification_id));
  const items: NotificationItem[] = [];
  const push = (item: Omit<NotificationItem, "isRead">) => items.push({ ...item, isRead: readIds.has(item.id) });

  for (const ex of exceptions) {
    const name = ex.order_type === "EXTERNAL" ? (ex.customer_name || "Customer") : (ex.resident_name || `Room ${ex.room_number}`);
    const dest = ex.order_type === "EXTERNAL" ? (ex.delivery_address || "Address") : `Room ${ex.room_number || ""}`;
    push({
      id: `notif_del_ex_${ex.id}`,
      domain: "DELIVERY",
      type: "ALERT",
      title: `Not delivered: ${name}`,
      description: `${ex.exception_reason || "The delivery could not be completed"} (${dest} • ${ex.meal_type}). Waiting to be resolved.`,
      timestamp: ex.exception_at || ex.updated_at,
      link: `/delivery?tab=problems&date=${ex.service_date}&meal=${ex.meal_type}&task=${ex.id}`,
      metadata: { taskId: ex.id, serviceDate: ex.service_date, mealType: ex.meal_type },
    });
  }

  for (const pnd of pendingSummary) {
    if (Number(pnd.count) > 0) {
      push({
        id: `notif_del_pending_${pnd.service_date}_${pnd.meal_type}`,
        domain: "DELIVERY",
        type: "WARNING",
        title: `${pnd.count} ${String(pnd.meal_type).toLowerCase()} deliveries not assigned`,
        description: `${pnd.count} stop(s) for ${pnd.service_date} have nobody to deliver them.`,
        timestamp: pnd.latest_created || new Date().toISOString(),
        link: `/delivery?tab=board&date=${pnd.service_date}&meal=${pnd.meal_type}`,
        metadata: { serviceDate: pnd.service_date, mealType: pnd.meal_type, count: pnd.count },
      });
    }
  }

  for (const d of dispatchedSummary) {
    if (Number(d.count) > 0) {
      push({
        id: `notif_del_dispatched_${d.service_date}_${d.meal_type}`,
        domain: "DELIVERY",
        type: "INFO",
        title: `${d.count} ${String(d.meal_type).toLowerCase()} deliveries out now`,
        description: `${d.count} stop(s) are on the way.`,
        timestamp: d.latest_dispatched || new Date().toISOString(),
        link: `/delivery?tab=board&date=${d.service_date}&meal=${d.meal_type}`,
        metadata: { serviceDate: d.service_date, mealType: d.meal_type, count: d.count },
      });
    }
  }

  for (const res of overdueResidents) {
    push({
      id: `notif_fin_overdue_${res.resident_id}`,
      domain: "FINANCE",
      type: "ALERT",
      title: `Rent due: ${res.full_name}`,
      description: `₹${Number(res.balance).toLocaleString("en-IN")} outstanding (Room ${res.room_number}).`,
      timestamp: res.latest_activity || new Date().toISOString(),
      link: `/finance?tab=residents`,
      metadata: { residentId: res.resident_id, balance: res.balance },
    });
  }

  for (const pay of recentPayments) {
    const payer = pay.resident_name ? `${pay.resident_name} (Room ${pay.room_number})` : "Resident";
    push({
      id: `notif_fin_pay_${pay.id}`,
      domain: "FINANCE",
      type: "SUCCESS",
      title: `Payment received: ₹${Number(pay.amount).toLocaleString("en-IN")}`,
      description: `By ${pay.payment_method || "payment"} from ${payer}.`,
      timestamp: pay.created_at || pay.transaction_date,
      link: `/finance`,
      metadata: { transactionId: pay.id, amount: pay.amount },
    });
  }

  for (const sub of expiringSubs) {
    push({
      id: `notif_sub_exp_${sub.id}_${sub.end_date}`,
      domain: "DELIVERY",
      type: "WARNING",
      title: `Subscription ending: ${sub.full_name}`,
      description: `Ends on ${sub.end_date}. Renew or let it end.`,
      timestamp: sub.updated_at,
      link: `/tiffin?tab=subscriptions`,
      metadata: { subscriptionId: sub.id, endDate: sub.end_date },
    });
  }

  for (const h of pendingHandovers) {
    push({
      id: `notif_handover_${h.id}`,
      domain: "FINANCE",
      type: "WARNING",
      title: `Cash to check: ${h.full_name}`,
      description: `₹${Number(h.declared_cash).toLocaleString("en-IN")} handed over for ${h.shift_date}, not yet accepted.`,
      timestamp: h.created_at,
      link: `/delivery?tab=custody`,
      metadata: { handoverId: h.id },
    });
  }

  for (const c of unclosed) {
    push({
      id: `notif_closing_${c.closing_date}`,
      domain: "FINANCE",
      type: "WARNING",
      title: `Cash not closed for ${c.closing_date}`,
      description: `${c.movements} money movement(s) that day. Count the cash and finalize the day.`,
      timestamp: `${today}T00:00:00.000Z`,
      link: `/finance?tab=closing`,
      metadata: { closingDate: c.closing_date },
    });
  }

  for (const sp of proposals) {
    push({
      id: `notif_settle_${sp.id}`,
      domain: "FINANCE",
      type: "ALERT",
      title: `Checkout to approve: ${sp.full_name}`,
      description: Number(sp.refund_amount) > 0 ? `Deposit refund of ₹${Number(sp.refund_amount).toLocaleString("en-IN")} waiting for your approval.` : "Settlement waiting for your approval.",
      timestamp: sp.created_at,
      link: `/residents`,
      metadata: { proposalId: sp.id },
    });
  }

  for (const pr of paymentReviews) {
    push({
      id: `notif_pay_review_${pr.id}`,
      domain: "DELIVERY",
      type: "ALERT",
      title: `Unpaid delivery to review: ${pr.customer_name}`,
      description: `Delivered ${String(pr.meal_type).toLowerCase()} on ${pr.service_date} with money still due, but the customer is not approved for Pay Later.`,
      timestamp: pr.updated_at,
      link: `/finance?tab=receivables&review=1`,
      metadata: { orderId: pr.id },
    });
  }

  // The delivery partner chosen in Settings can no longer take deliveries.
  if (canManageDelivery && settings.delivery.defaultDriverId) {
    const driver = await db.queryOne<any>("SELECT full_name, role, is_active FROM staff_users WHERE id = ?", [settings.delivery.defaultDriverId]);
    if (!driver || driver.role !== "DELIVERY_PERSON" || !Number(driver.is_active)) {
      push({
        id: `notif_default_driver_${settings.delivery.defaultDriverId}`,
        domain: "DELIVERY",
        type: "ALERT",
        title: "Default delivery partner unavailable",
        description: `${driver?.full_name || "The chosen partner"} can't take deliveries, so new orders wait unassigned. Choose someone in Settings.`,
        timestamp: new Date().toISOString(),
        link: hasPermission(actor.role, "system.manage") ? `/settings` : `/delivery?tab=board`,
        metadata: { staffId: settings.delivery.defaultDriverId },
      });
    }
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const unreadCount = items.filter((i) => !i.isRead).length;
  return { items, unreadCount };
}

/**
 * Marks a specific notification as read for the authenticated staff user.
 */
export async function markNotificationAsRead(actor: AuthenticatedUser, notificationId: string): Promise<void> {
  const db = getAsyncDb();
  const now = new Date().toISOString();
  await db.execute(`
    INSERT INTO staff_notification_reads (staff_id, notification_id, read_at)
    VALUES (?, ?, ?)
    ON CONFLICT (staff_id, notification_id) DO NOTHING
  `, [actor.id, notificationId, now]);
  invalidateNotificationCache(actor.id);
}

/**
 * Marks all notifications as read for the authenticated staff user.
 */
export async function markAllNotificationsAsRead(actor: AuthenticatedUser): Promise<void> {
  const db = getAsyncDb();
  const { notifications } = await getNotifications(actor, { limit: 100 });
  if (notifications.length === 0) return;
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const n of notifications) {
      await tx.execute(`
        INSERT INTO staff_notification_reads (staff_id, notification_id, read_at)
        VALUES (?, ?, ?)
        ON CONFLICT (staff_id, notification_id) DO NOTHING
      `, [actor.id, n.id, now]);
    }
  });
  invalidateNotificationCache(actor.id);
}
