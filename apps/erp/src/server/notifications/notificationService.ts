import { getDb } from "../database/db";
import { AuthenticatedUser, NotificationItem } from "@/types";

export interface GetNotificationsOptions {
  limit?: number;
  unreadOnly?: boolean;
}

/**
 * Aggregates live actionable notifications across Finance, Delivery, and Kitchen modules.
 * Tracks per-user read/unread state using staff_notification_reads table.
 */
export function getNotifications(
  actor: AuthenticatedUser,
  options?: GetNotificationsOptions
): { notifications: NotificationItem[]; unreadCount: number } {
  const db = getDb();
  const limit = options?.limit || 30;

  // 1. Fetch read notification IDs for this staff user
  const readRows = db.prepare(`
    SELECT notification_id FROM staff_notification_reads WHERE staff_id = ?
  `).all(actor.id) as Array<{ notification_id: string }>;
  const readIds = new Set(readRows.map((r) => r.notification_id));

  const items: NotificationItem[] = [];

  // 2. Delivery Exceptions (High Alert)
  const exceptions = db.prepare(`
    SELECT dt.id, dt.order_type, dt.customer_name, dt.delivery_address, dt.room_number,
           dt.exception_reason, dt.service_date, dt.meal_type, dt.updated_at,
           r.full_name as resident_name
    FROM delivery_tasks dt
    LEFT JOIN residents r ON r.id = dt.resident_id
    WHERE dt.status = 'EXCEPTION'
    ORDER BY dt.updated_at DESC
    LIMIT 10
  `).all() as any[];

  for (const ex of exceptions) {
    const notifId = `notif_del_ex_${ex.id}`;
    const name = ex.order_type === "EXTERNAL" ? (ex.customer_name || "City Customer") : (ex.resident_name || `Room ${ex.room_number}`);
    const dest = ex.order_type === "EXTERNAL" ? (ex.delivery_address || "City Address") : `Room ${ex.room_number || ""}`;
    items.push({
      id: notifId,
      domain: "DELIVERY",
      type: "ALERT",
      title: `Delivery Exception: ${name}`,
      description: `${ex.exception_reason || "Delivery could not be completed"} (${dest} • ${ex.meal_type})`,
      timestamp: ex.updated_at,
      link: `/delivery?status=EXCEPTION`,
      isRead: readIds.has(notifId),
      metadata: { taskId: ex.id, serviceDate: ex.service_date, mealType: ex.meal_type },
    });
  }

  // 3. Pending Delivery Assignment
  const pendingSummary = db.prepare(`
    SELECT service_date, meal_type, COUNT(*) as count, MAX(created_at) as latest_created
    FROM delivery_tasks
    WHERE status = 'PENDING'
    GROUP BY service_date, meal_type
    ORDER BY latest_created DESC
    LIMIT 3
  `).all() as any[];

  for (const p of pendingSummary) {
    if (p.count > 0) {
      const notifId = `notif_del_pending_${p.service_date}_${p.meal_type}`;
      items.push({
        id: notifId,
        domain: "DELIVERY",
        type: "WARNING",
        title: `${p.count} ${p.meal_type} Orders Unassigned`,
        description: `${p.count} portions prepared for ${p.service_date} await delivery executive assignment.`,
        timestamp: p.latest_created || new Date().toISOString(),
        link: `/delivery?status=PENDING`,
        isRead: readIds.has(notifId),
        metadata: { serviceDate: p.service_date, mealType: p.meal_type, count: p.count },
      });
    }
  }

  // 4. In-Transit / Dispatched Deliveries
  const dispatchedSummary = db.prepare(`
    SELECT service_date, meal_type, COUNT(*) as count, MAX(dispatched_at) as latest_dispatched
    FROM delivery_tasks
    WHERE status = 'DISPATCHED'
    GROUP BY service_date, meal_type
    ORDER BY latest_dispatched DESC
    LIMIT 2
  `).all() as any[];

  for (const d of dispatchedSummary) {
    if (d.count > 0) {
      const notifId = `notif_del_dispatched_${d.service_date}_${d.meal_type}`;
      items.push({
        id: notifId,
        domain: "DELIVERY",
        type: "INFO",
        title: `${d.count} ${d.meal_type} Orders Out for Delivery`,
        description: `${d.count} tiffins currently in-transit across active delivery routes.`,
        timestamp: d.latest_dispatched || new Date().toISOString(),
        link: `/delivery?status=DISPATCHED`,
        isRead: readIds.has(notifId),
        metadata: { serviceDate: d.service_date, mealType: d.meal_type, count: d.count },
      });
    }
  }

  // 5. Finance: Overdue Balances (Outstanding Rent)
  const overdueResidents = db.prepare(`
    SELECT
      r.id as resident_id,
      r.full_name,
      rm.room_number,
      COALESCE(SUM(CASE WHEN ft.transaction_type = 'RENT_CHARGE' AND ft.status = 'POSTED' THEN ft.amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN ft.transaction_type = 'RENT_PAYMENT' AND ft.status = 'POSTED' THEN ft.amount ELSE 0 END), 0) as balance,
      MAX(ft.created_at) as latest_activity
    FROM residents r
    JOIN resident_stays s ON s.resident_id = r.id AND s.status = 'ACTIVE'
    JOIN rooms rm ON rm.id = s.room_id
    LEFT JOIN financial_transactions ft ON ft.resident_id = r.id
    GROUP BY r.id, r.full_name, rm.room_number
    HAVING balance > 0
    ORDER BY balance DESC
    LIMIT 5
  `).all() as any[];

  for (const res of overdueResidents) {
    const notifId = `notif_fin_overdue_${res.resident_id}`;
    items.push({
      id: notifId,
      domain: "FINANCE",
      type: "ALERT",
      title: `Pending Rent Due: ${res.full_name}`,
      description: `Outstanding balance of ₹${Number(res.balance).toLocaleString("en-IN")} (Room ${res.room_number}).`,
      timestamp: res.latest_activity || new Date().toISOString(),
      link: `/finance`,
      isRead: readIds.has(notifId),
      metadata: { residentId: res.resident_id, balance: res.balance },
    });
  }

  // 6. Recent Payments Received
  const recentPayments = db.prepare(`
    SELECT ft.id, ft.amount, ft.payment_method, ft.transaction_date, ft.description, ft.created_at,
           r.full_name as resident_name, rm.room_number
    FROM financial_transactions ft
    LEFT JOIN residents r ON r.id = ft.resident_id
    LEFT JOIN resident_stays s ON s.id = ft.stay_id
    LEFT JOIN rooms rm ON rm.id = s.room_id
    WHERE ft.transaction_type = 'RENT_PAYMENT' AND ft.status = 'POSTED'
    ORDER BY ft.created_at DESC
    LIMIT 5
  `).all() as any[];

  for (const pay of recentPayments) {
    const notifId = `notif_fin_pay_${pay.id}`;
    const payer = pay.resident_name ? `${pay.resident_name} (Room ${pay.room_number})` : "Resident";
    items.push({
      id: notifId,
      domain: "FINANCE",
      type: "SUCCESS",
      title: `Payment Received: ₹${Number(pay.amount).toLocaleString("en-IN")}`,
      description: `Received via ${pay.payment_method || "Direct"} from ${payer}.`,
      timestamp: pay.created_at || pay.transaction_date,
      link: `/finance`,
      isRead: readIds.has(notifId),
      metadata: { transactionId: pay.id, amount: pay.amount },
    });
  }

  // 7. Kitchen Plans (Active / Confirmed)
  const kitchenPlans = db.prepare(`
    SELECT id, service_date, meal_type, status, final_preparation_count, actual_cooked_count,
           confirmed_at, completed_at, updated_at
    FROM daily_meal_plans
    ORDER BY service_date DESC, created_at DESC
    LIMIT 3
  `).all() as any[];

  for (const kp of kitchenPlans) {
    if (kp.status === "CONFIRMED" || kp.status === "COMPLETED") {
      const notifId = `notif_kitch_${kp.id}_${kp.status}`;
      const count = kp.actual_cooked_count || kp.final_preparation_count;
      items.push({
        id: notifId,
        domain: "KITCHEN",
        type: kp.status === "COMPLETED" ? "SUCCESS" : "INFO",
        title: `${kp.meal_type} Kitchen Plan ${kp.status === "COMPLETED" ? "Completed" : "Confirmed"}`,
        description: `${count} portions ${kp.status === "COMPLETED" ? "cooked and prepped" : "scheduled"} for ${kp.service_date}.`,
        timestamp: kp.completed_at || kp.confirmed_at || kp.updated_at,
        link: `/kitchen`,
        isRead: readIds.has(notifId),
        metadata: { planId: kp.id, serviceDate: kp.service_date, mealType: kp.meal_type },
      });
    }
  }

  // Sort by timestamp descending
  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const unreadCount = items.filter((i) => !i.isRead).length;

  let filtered = items;
  if (options?.unreadOnly) {
    filtered = items.filter((i) => !i.isRead);
  }

  return {
    notifications: filtered.slice(0, limit),
    unreadCount,
  };
}

/**
 * Marks a specific notification as read for the authenticated staff user.
 */
export function markNotificationAsRead(actor: AuthenticatedUser, notificationId: string): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO staff_notification_reads (staff_id, notification_id, read_at)
    VALUES (?, ?, ?)
  `).run(actor.id, notificationId, now);
}

/**
 * Marks all notifications as read for the authenticated staff user.
 */
export function markAllNotificationsAsRead(actor: AuthenticatedUser): void {
  const db = getDb();
  const { notifications } = getNotifications(actor, { limit: 100 });
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO staff_notification_reads (staff_id, notification_id, read_at)
    VALUES (?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const n of notifications) {
      insert.run(actor.id, n.id, now);
    }
  });
  tx();
}
