import { getAsyncDb, AsyncDb } from "../database/db";

export interface OccupancyMetrics {
  totalRooms: number;
  totalCapacity: number;
  occupiedBeds: number;
  vacantBeds: number;
  occupancyRate: number;
}

export interface FinanceMetrics {
  currentMonthRent: number;
  currentMonthExpenses: number;
  totalRentCollected: number;
  totalRentBilled: number;
  totalExpensesPaid: number;
  totalDepositsHeld: number;
  outstandingRent: number;
  overdueCount: number;
  kitchenCosts: number;
  tiffinRevenue: number;
  tiffinNetResult: number;
}

export interface MealFulfillmentMetrics {
  serviceDate: string;
  breakfast: { status: string; cooked: number; dispatched: number; delivered: number };
  lunch: { status: string; cooked: number; dispatched: number; delivered: number };
  dinner: { status: string; cooked: number; dispatched: number; delivered: number };
  totals: { cooked: number; dispatched: number; delivered: number };
}

export interface DeliverySummaryMetrics {
  totalTasks: number;
  delivered: number;
  exceptions: number;
  completionRate: number;
}

export interface MonthlyRevenueData {
  month: string;
  label: string;
  collected: number;
  expenses: number;
}

export interface DashboardMetricsResult {
  occupancy: OccupancyMetrics;
  finance: FinanceMetrics;
  mealFulfillment: MealFulfillmentMetrics;
  deliverySummary: DeliverySummaryMetrics;
  monthlyData: MonthlyRevenueData[];
}

interface CacheEntry {
  data: DashboardMetricsResult;
  expiresAt: number;
}

let dashboardCache: CacheEntry | null = null;
const DASHBOARD_CACHE_TTL_MS = 15_000; // 15 seconds freshness

export function invalidateDashboardCache(): void {
  dashboardCache = null;
}

/**
 * Fetches all dashboard aggregates with parallel database queries and
 * 15-second in-memory caching to minimize server roundtrip latency.
 */
export async function getDashboardMetrics(
  forcedDb?: AsyncDb,
  bypassCache = false
): Promise<DashboardMetricsResult> {
  const nowMs = Date.now();
  if (!bypassCache && dashboardCache && dashboardCache.expiresAt > nowMs) {
    return dashboardCache.data;
  }

  const db = forcedDb || getAsyncDb();
  const todayIsoDate = new Date().toISOString().slice(0, 10);
  const currentMonthPrefix = todayIsoDate.slice(0, 7);

  // Parallel query group 1: Rooms & Occupancy
  const occupancyPromise = (async (): Promise<OccupancyMetrics> => {
    const [roomRow, activeStaysRow] = await Promise.all([
      db.queryOne<{ totalRooms: number | string; totalCapacity: number | string }>(`
        SELECT 
          COUNT(*) as "totalRooms",
          COALESCE(SUM(capacity), 0) as "totalCapacity"
        FROM rooms
        WHERE is_active = 1
      `),
      db.queryOne<{ occupiedBeds: number | string }>(`
        SELECT COUNT(*) as "occupiedBeds"
        FROM resident_stays
        WHERE status = 'ACTIVE'
      `),
    ]);

    const totalRooms = Number(roomRow?.totalRooms || 0);
    const totalCapacity = Number(roomRow?.totalCapacity || 0);
    const occupiedBeds = Number(activeStaysRow?.occupiedBeds || 0);
    const vacantBeds = Math.max(0, totalCapacity - occupiedBeds);
    const occupancyRate = totalCapacity > 0 ? Math.round((occupiedBeds / totalCapacity) * 100) : 0;

    return { totalRooms, totalCapacity, occupiedBeds, vacantBeds, occupancyRate };
  })();

  // Parallel query group 2: Finance & Revenue Breakdown
  const financePromise = (async (): Promise<FinanceMetrics> => {
    const [
      finSummary,
      rentMonthRow,
      expMonthRow,
      overdueCountRow,
      kitchenCostRow,
      tiffinRevRow,
    ] = await Promise.all([
      db.queryOne<{
        totalRentCollected: number | string;
        totalRentBilled: number | string;
        totalExpensesPaid: number | string;
        totalDepositsHeld: number | string;
      }>(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalRentCollected",
          COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalRentBilled",
          COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalExpensesPaid",
          COALESCE(SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalDepositsHeld"
        FROM financial_transactions
      `),
      db.queryOne<{ rentMonth: number | string }>(`
        SELECT COALESCE(SUM(amount), 0) as "rentMonth"
        FROM financial_transactions
        WHERE transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' AND transaction_date LIKE ?
      `, [`${currentMonthPrefix}%`]),
      db.queryOne<{ expMonth: number | string }>(`
        SELECT COALESCE(SUM(amount), 0) as "expMonth"
        FROM financial_transactions
        WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' AND transaction_date LIKE ?
      `, [`${currentMonthPrefix}%`]),
      db.queryOne<{ count: number | string }>(`
        SELECT COUNT(*) as count FROM (
          SELECT r.id
          FROM residents r
          JOIN financial_transactions t ON t.resident_id = r.id AND t.status = 'POSTED'
          GROUP BY r.id
          HAVING (
            SUM(CASE WHEN t.transaction_type = 'RENT_CHARGE' THEN t.amount ELSE 0 END) -
            SUM(CASE WHEN t.transaction_type = 'RENT_PAYMENT' THEN t.amount ELSE 0 END)
          ) > 0
        ) subq
      `),
      db.queryOne<{ kitchenCost: number | string }>(`
        SELECT COALESCE(SUM(amount), 0) as "kitchenCost"
        FROM financial_transactions
        WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' 
          AND category IN ('GROCERY', 'KITCHEN_SUPPLIES') 
          AND transaction_date LIKE ?
      `, [`${currentMonthPrefix}%`]),
      db.queryOne<{ tiffinRev: number | string }>(`
        SELECT COALESCE(SUM(amount), 0) as "tiffinRev"
        FROM financial_transactions
        WHERE transaction_type = 'RENT_PAYMENT' AND status = 'POSTED'
          AND (category = 'TIFFIN' OR description LIKE '%tiffin%')
          AND transaction_date LIKE ?
      `, [`${currentMonthPrefix}%`]),
    ]);

    const totalRentCollected = Number(finSummary?.totalRentCollected || 0);
    const totalRentBilled = Number(finSummary?.totalRentBilled || 0);
    const totalExpensesPaid = Number(finSummary?.totalExpensesPaid || 0);
    const totalDepositsHeld = Number(finSummary?.totalDepositsHeld || 0);
    const currentMonthRent = Number(rentMonthRow?.rentMonth || 0);
    const currentMonthExpenses = Number(expMonthRow?.expMonth || 0);
    const outstandingRent = Math.max(0, totalRentBilled - totalRentCollected);
    const overdueCount = Number(overdueCountRow?.count || 0);
    const kitchenCosts = Number(kitchenCostRow?.kitchenCost || 0);
    const tiffinRevenue = Number(tiffinRevRow?.tiffinRev || 0);
    const tiffinNetResult = tiffinRevenue - kitchenCosts;

    return {
      currentMonthRent,
      currentMonthExpenses,
      totalRentCollected,
      totalRentBilled,
      totalExpensesPaid,
      totalDepositsHeld,
      outstandingRent,
      overdueCount,
      kitchenCosts,
      tiffinRevenue,
      tiffinNetResult,
    };
  })();

  // Parallel query group 3: 6-Month Historical Revenue Chart
  const monthlyDataPromise = (async (): Promise<MonthlyRevenueData[]> => {
    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const sixMonths: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = d.toISOString().slice(0, 7);
      sixMonths.push(ym);
    }

    const monthlyDbRows = await db.query<{ ym: string; collected: number | string; expenses: number | string }>(`
      SELECT 
        substr(transaction_date, 1, 7) as ym,
        COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as collected,
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as expenses
      FROM financial_transactions
      WHERE substr(transaction_date, 1, 7) IN (${sixMonths.map(() => "?").join(",")})
      GROUP BY substr(transaction_date, 1, 7)
    `, sixMonths);

    const monthMap: Record<string, { collected: number; expenses: number }> = {};
    for (const r of monthlyDbRows) {
      monthMap[r.ym] = { collected: Number(r.collected), expenses: Number(r.expenses) };
    }

    return sixMonths.map((ym) => {
      const mIdx = parseInt(ym.slice(5, 7), 10) - 1;
      const data = monthMap[ym] || { collected: 0, expenses: 0 };
      return {
        month: ym,
        label: monthNames[mIdx] || ym,
        collected: data.collected,
        expenses: data.expenses,
      };
    });
  })();

  // Parallel query group 4: Meal Fulfillment & Delivery Stats
  const mealAndDeliveryPromise = (async (): Promise<{
    mealFulfillment: MealFulfillmentMetrics;
    deliverySummary: DeliverySummaryMetrics;
  }> => {
    let targetKitchenDate = todayIsoDate;
    let mealPlans = await db.query<{
      meal_type: string;
      status: string;
      final_preparation_count: number | string;
      cooked_count: number | string;
    }>(`
      SELECT meal_type, status, final_preparation_count, COALESCE(actual_cooked_count, final_preparation_count) as cooked_count
      FROM daily_meal_plans
      WHERE service_date = ?
    `, [targetKitchenDate]);

    if (mealPlans.length === 0) {
      const latestKitchenDate = await db.queryOne<{ service_date: string }>(`
        SELECT service_date FROM daily_meal_plans ORDER BY service_date DESC LIMIT 1
      `);
      if (latestKitchenDate) {
        targetKitchenDate = latestKitchenDate.service_date;
        mealPlans = await db.query<{
          meal_type: string;
          status: string;
          final_preparation_count: number | string;
          cooked_count: number | string;
        }>(`
          SELECT meal_type, status, final_preparation_count, COALESCE(actual_cooked_count, final_preparation_count) as cooked_count
          FROM daily_meal_plans
          WHERE service_date = ?
        `, [targetKitchenDate]);
      }
    }

    const [deliveryMealStats, delStatsRow] = await Promise.all([
      db.query<{
        meal_type: string;
        total_tasks: number | string;
        dispatched_count: number | string;
        delivered_count: number | string;
      }>(`
        SELECT
          meal_type,
          COUNT(*) as total_tasks,
          COALESCE(SUM(CASE WHEN dispatched_at IS NOT NULL OR status IN ('OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION') THEN 1 ELSE 0 END), 0) as dispatched_count,
          COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as delivered_count
        FROM delivery_tasks
        WHERE service_date = ?
        GROUP BY meal_type
      `, [targetKitchenDate]),
      db.queryOne<{ total_tasks: number | string; delivered: number | string; exceptions: number | string }>(`
        SELECT
          COUNT(*) as total_tasks,
          COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as delivered,
          COALESCE(SUM(CASE WHEN status = 'EXCEPTION' THEN 1 ELSE 0 END), 0) as exceptions
        FROM delivery_tasks
        WHERE service_date = ?
      `, [targetKitchenDate]),
    ]);

    const deliveryMealMap: Record<string, { dispatched: number; delivered: number; total: number }> = {};
    for (const d of deliveryMealStats) {
      deliveryMealMap[d.meal_type] = {
        dispatched: Number(d.dispatched_count),
        delivered: Number(d.delivered_count),
        total: Number(d.total_tasks),
      };
    }

    const bPlan = mealPlans.find((p) => p.meal_type === "BREAKFAST");
    const lPlan = mealPlans.find((p) => p.meal_type === "LUNCH");
    const dPlan = mealPlans.find((p) => p.meal_type === "DINNER");

    const mealFulfillment: MealFulfillmentMetrics = {
      serviceDate: targetKitchenDate,
      breakfast: {
        status: bPlan?.status || "UNPLANNED",
        cooked: bPlan ? Number(bPlan.cooked_count) : 0,
        dispatched: deliveryMealMap["BREAKFAST"]?.dispatched || 0,
        delivered: deliveryMealMap["BREAKFAST"]?.delivered || 0,
      },
      lunch: {
        status: lPlan?.status || "UNPLANNED",
        cooked: lPlan ? Number(lPlan.cooked_count) : 0,
        dispatched: deliveryMealMap["LUNCH"]?.dispatched || 0,
        delivered: deliveryMealMap["LUNCH"]?.delivered || 0,
      },
      dinner: {
        status: dPlan?.status || "UNPLANNED",
        cooked: dPlan ? Number(dPlan.cooked_count) : 0,
        dispatched: deliveryMealMap["DINNER"]?.dispatched || 0,
        delivered: deliveryMealMap["DINNER"]?.delivered || 0,
      },
      totals: {
        cooked: (bPlan ? Number(bPlan.cooked_count) : 0) + (lPlan ? Number(lPlan.cooked_count) : 0) + (dPlan ? Number(dPlan.cooked_count) : 0),
        dispatched: (deliveryMealMap["BREAKFAST"]?.dispatched || 0) + (deliveryMealMap["LUNCH"]?.dispatched || 0) + (deliveryMealMap["DINNER"]?.dispatched || 0),
        delivered: (deliveryMealMap["BREAKFAST"]?.delivered || 0) + (deliveryMealMap["LUNCH"]?.delivered || 0) + (deliveryMealMap["DINNER"]?.delivered || 0),
      },
    };

    const totalDelTasks = Number(delStatsRow?.total_tasks || 0);
    const totalDelivered = Number(delStatsRow?.delivered || 0);
    const totalExceptions = Number(delStatsRow?.exceptions || 0);

    const deliverySummary: DeliverySummaryMetrics = {
      totalTasks: totalDelTasks,
      delivered: totalDelivered,
      exceptions: totalExceptions,
      completionRate: totalDelTasks > 0 ? Math.round((totalDelivered / totalDelTasks) * 100) : 0,
    };

    return { mealFulfillment, deliverySummary };
  })();

  // Execute all top-level groups concurrently!
  const [occupancy, finance, monthlyData, mealAndDelivery] = await Promise.all([
    occupancyPromise,
    financePromise,
    monthlyDataPromise,
    mealAndDeliveryPromise,
  ]);

  const result: DashboardMetricsResult = {
    occupancy,
    finance,
    monthlyData,
    mealFulfillment: mealAndDelivery.mealFulfillment,
    deliverySummary: mealAndDelivery.deliverySummary,
  };

  dashboardCache = {
    data: result,
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
  };

  return result;
}
