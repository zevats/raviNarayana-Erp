import { getAsyncDb, AsyncDb } from "../database/db";
import { businessToday, businessMonthKey } from "@/lib/businessDate";
import { onBusinessDataChanged } from "../database/changeSignals";
import { RENT_SETTLEMENT_SQL, TIFFIN_RECEIPT_SQL, getDepositsHeld, getOutstandingRent } from "../finance/financialDefinitions";
import { ClosingDivision } from "@/types";

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

export interface DashboardMetricsOptions {
  division?: ClosingDivision;
  /** Part of the cache key: cached aggregates are never shared across roles. */
  viewerRole?: string;
  startDate?: string;
  endDate?: string;
}

interface CacheEntry {
  data: DashboardMetricsResult;
  expiresAt: number;
}

const dashboardCaches = new Map<string, CacheEntry>();
const DASHBOARD_CACHE_TTL_MS = 15_000; // 15 seconds freshness

export function invalidateDashboardCache(): void {
  dashboardCaches.clear();
}

// Any committed business write (payment, delivery, check-in, order, ...) drops cached aggregates,
// so the 15s cache only ever spares repeated reads of unchanged data.
onBusinessDataChanged(invalidateDashboardCache);

/**
 * Fetches all dashboard aggregates with parallel database queries and
 * 15-second in-memory caching to minimize server roundtrip latency.
 */
export async function getDashboardMetrics(
  forcedDb?: AsyncDb,
  bypassCache?: boolean
): Promise<DashboardMetricsResult>;
export async function getDashboardMetrics(
  options?: DashboardMetricsOptions,
  forcedDb?: AsyncDb,
  bypassCache?: boolean
): Promise<DashboardMetricsResult>;
export async function getDashboardMetrics(
  optionsOrDb?: DashboardMetricsOptions | AsyncDb,
  forcedDbOrBypass?: AsyncDb | boolean,
  bypassCache = false
): Promise<DashboardMetricsResult> {
  let options: DashboardMetricsOptions = {};
  let db: AsyncDb;
  let effectiveBypass = bypassCache;

  if (optionsOrDb && typeof (optionsOrDb as any).query === "function") {
    db = optionsOrDb as AsyncDb;
    if (typeof forcedDbOrBypass === "boolean") {
      effectiveBypass = forcedDbOrBypass;
    }
  } else {
    options = (optionsOrDb as DashboardMetricsOptions) || {};
    if (forcedDbOrBypass && typeof (forcedDbOrBypass as any).query === "function") {
      db = forcedDbOrBypass as AsyncDb;
    } else {
      db = getAsyncDb();
    }
  }

  const division = options.division || "COMBINED";
  const cacheKey = `${options.viewerRole || "system"}_${division}_${options.startDate || ""}_${options.endDate || ""}`;
  const nowMs = Date.now();
  const cached = dashboardCaches.get(cacheKey);
  if (!effectiveBypass && cached && cached.expiresAt > nowMs) {
    return cached.data;
  }

  const todayIsoDate = businessToday();
  const currentMonthPrefix = todayIsoDate.slice(0, 7);
  const startDate = options.startDate || `${currentMonthPrefix}-01`;
  const endDate = options.endDate || todayIsoDate;

  // Parallel query group 1: Rooms & Occupancy
  const occupancyPromise = (async (): Promise<OccupancyMetrics> => {
    if (division === "TIFFIN") {
      return { totalRooms: 0, totalCapacity: 0, occupiedBeds: 0, vacantBeds: 0, occupancyRate: 0 };
    }

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
      outstanding,
      kitchenCostRow,
      tiffinRevRow,
      depositsHeld,
    ] = await Promise.all([
      db.queryOne<{
        totalRentCollected: number | string;
        totalRentBilled: number | string;
        totalExpensesPaid: number | string;
        pgExpensesPaid: number | string;
        tiffinExpensesPaid: number | string;
        totalTiffinCollected: number | string;
      }>(`
        SELECT
          COALESCE(SUM(CASE WHEN ${RENT_SETTLEMENT_SQL} AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalRentCollected",
          COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalRentBilled",
          COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalExpensesPaid",
          COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND category NOT IN ('GROCERY', 'KITCHEN_SUPPLIES') AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "pgExpensesPaid",
          COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND category IN ('GROCERY', 'KITCHEN_SUPPLIES') AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "tiffinExpensesPaid",
          COALESCE(SUM(CASE WHEN ${TIFFIN_RECEIPT_SQL} AND status = 'POSTED' THEN amount ELSE 0 END), 0) as "totalTiffinCollected"
        FROM financial_transactions
      `),
      db.queryOne<{ rentMonth: number | string }>(`
        SELECT COALESCE(SUM(amount), 0) as "rentMonth"
        FROM financial_transactions
        WHERE ${RENT_SETTLEMENT_SQL} AND status = 'POSTED' AND transaction_date >= ? AND transaction_date <= ?
      `, [startDate, endDate]),
      db.queryOne<{ expMonth: number | string }>(`
        SELECT COALESCE(SUM(amount), 0) as "expMonth"
        FROM financial_transactions
        WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' AND transaction_date >= ? AND transaction_date <= ?
      `, [startDate, endDate]),
      getOutstandingRent(db),
      db.queryOne<{ kitchenCost: number | string }>(`
        SELECT COALESCE(SUM(amount), 0) as "kitchenCost"
        FROM financial_transactions
        WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' 
          AND category IN ('GROCERY', 'KITCHEN_SUPPLIES') 
          AND transaction_date >= ? AND transaction_date <= ?
      `, [startDate, endDate]),
      db.queryOne<{ tiffinRev: number | string }>(`
        SELECT COALESCE(SUM(amount), 0) as "tiffinRev"
        FROM financial_transactions
        WHERE ${TIFFIN_RECEIPT_SQL} AND status = 'POSTED'
          AND transaction_date >= ? AND transaction_date <= ?
      `, [startDate, endDate]),
      getDepositsHeld(db),
    ]);

    const rawTotalRentCollected = Number(finSummary?.totalRentCollected || 0);
    const rawTotalRentBilled = Number(finSummary?.totalRentBilled || 0);
    const rawTotalExpensesPaid = Number(finSummary?.totalExpensesPaid || 0);
    const rawPgExpensesPaid = Number(finSummary?.pgExpensesPaid || 0);
    const rawTiffinExpensesPaid = Number(finSummary?.tiffinExpensesPaid || 0);
    const rawTotalDepositsHeld = depositsHeld;
    const rawTotalTiffinCollected = Number(finSummary?.totalTiffinCollected || 0);

    const currentMonthRent = Number(rentMonthRow?.rentMonth || 0);
    const currentMonthExpenses = Number(expMonthRow?.expMonth || 0);
    const overdueCount = outstanding.residents;
    const kitchenCosts = Number(kitchenCostRow?.kitchenCost || 0);
    const tiffinRevenue = Number(tiffinRevRow?.tiffinRev || 0);
    const tiffinNetResult = tiffinRevenue - kitchenCosts;

    if (division === "PG") {
      const outstandingRent = outstanding.total;
      return {
        currentMonthRent,
        currentMonthExpenses: Math.max(0, currentMonthExpenses - kitchenCosts),
        totalRentCollected: rawTotalRentCollected,
        totalRentBilled: rawTotalRentBilled,
        totalExpensesPaid: rawPgExpensesPaid,
        totalDepositsHeld: rawTotalDepositsHeld,
        outstandingRent,
        overdueCount,
        kitchenCosts: 0,
        tiffinRevenue: 0,
        tiffinNetResult: 0,
      };
    } else if (division === "TIFFIN") {
      return {
        currentMonthRent: 0,
        currentMonthExpenses: kitchenCosts,
        totalRentCollected: 0,
        totalRentBilled: 0,
        totalExpensesPaid: rawTiffinExpensesPaid,
        totalDepositsHeld: 0,
        outstandingRent: 0,
        overdueCount: 0,
        kitchenCosts,
        tiffinRevenue,
        tiffinNetResult,
      };
    }

    // COMBINED
    const outstandingRent = outstanding.total;
    return {
      currentMonthRent,
      currentMonthExpenses,
      totalRentCollected: rawTotalRentCollected,
      totalRentBilled: rawTotalRentBilled,
      totalExpensesPaid: rawTotalExpensesPaid,
      totalDepositsHeld: rawTotalDepositsHeld,
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
    for (let i = 5; i >= 0; i--) {
      sixMonths.push(businessMonthKey(-i));
    }

    let collectedSql = `CASE WHEN (${RENT_SETTLEMENT_SQL} OR ${TIFFIN_RECEIPT_SQL}) AND status = 'POSTED' THEN amount ELSE 0 END`;
    let expenseSql = "CASE WHEN transaction_type = 'EXPENSE' AND status = 'POSTED' THEN amount ELSE 0 END";

    if (division === "PG") {
      collectedSql = `CASE WHEN ${RENT_SETTLEMENT_SQL} AND status = 'POSTED' THEN amount ELSE 0 END`;
      expenseSql = "CASE WHEN transaction_type = 'EXPENSE' AND category NOT IN ('GROCERY', 'KITCHEN_SUPPLIES') AND status = 'POSTED' THEN amount ELSE 0 END";
    } else if (division === "TIFFIN") {
      collectedSql = `CASE WHEN ${TIFFIN_RECEIPT_SQL} AND status = 'POSTED' THEN amount ELSE 0 END`;
      expenseSql = "CASE WHEN transaction_type = 'EXPENSE' AND category IN ('GROCERY', 'KITCHEN_SUPPLIES') AND status = 'POSTED' THEN amount ELSE 0 END";
    }

    const monthlyDbRows = await db.query<{ ym: string; collected: number | string; expenses: number | string }>(`
      SELECT 
        substr(transaction_date, 1, 7) as ym,
        COALESCE(SUM(${collectedSql}), 0) as collected,
        COALESCE(SUM(${expenseSql}), 0) as expenses
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
      planned_resident_count: number | string;
      planned_tiffin_count: number | string;
      cooked_count: number | string;
    }>(`
      SELECT
        meal_type,
        status,
        final_preparation_count,
        COALESCE(planned_resident_count, 0) as planned_resident_count,
        COALESCE(planned_tiffin_count, 0) as planned_tiffin_count,
        COALESCE(actual_cooked_count, final_preparation_count) as cooked_count
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
          planned_resident_count: number | string;
          planned_tiffin_count: number | string;
          cooked_count: number | string;
        }>(`
          SELECT
            meal_type,
            status,
            final_preparation_count,
            COALESCE(planned_resident_count, 0) as planned_resident_count,
            COALESCE(planned_tiffin_count, 0) as planned_tiffin_count,
            COALESCE(actual_cooked_count, final_preparation_count) as cooked_count
          FROM daily_meal_plans
          WHERE service_date = ?
        `, [targetKitchenDate]);
      }
    }

    let delOrderFilter = "";
    if (division === "PG") {
      delOrderFilter = "AND order_type = 'RESIDENT'";
    } else if (division === "TIFFIN") {
      delOrderFilter = "AND order_type = 'EXTERNAL'";
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
        WHERE service_date = ? ${delOrderFilter}
        GROUP BY meal_type
      `, [targetKitchenDate]),
      db.queryOne<{ total_tasks: number | string; delivered: number | string; exceptions: number | string }>(`
        SELECT
          COUNT(*) as total_tasks,
          COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as delivered,
          COALESCE(SUM(CASE WHEN status = 'EXCEPTION' THEN 1 ELSE 0 END), 0) as exceptions
        FROM delivery_tasks
        WHERE service_date = ? ${delOrderFilter}
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

    const getCookedCount = (plan?: typeof bPlan) => {
      if (!plan) return 0;
      if (division === "PG") return Number(plan.planned_resident_count);
      if (division === "TIFFIN") return Number(plan.planned_tiffin_count);
      return Number(plan.cooked_count);
    };

    const bCooked = getCookedCount(bPlan);
    const lCooked = getCookedCount(lPlan);
    const dCooked = getCookedCount(dPlan);

    const mealFulfillment: MealFulfillmentMetrics = {
      serviceDate: targetKitchenDate,
      breakfast: {
        status: bPlan?.status || "UNPLANNED",
        cooked: bCooked,
        dispatched: deliveryMealMap["BREAKFAST"]?.dispatched || 0,
        delivered: deliveryMealMap["BREAKFAST"]?.delivered || 0,
      },
      lunch: {
        status: lPlan?.status || "UNPLANNED",
        cooked: lCooked,
        dispatched: deliveryMealMap["LUNCH"]?.dispatched || 0,
        delivered: deliveryMealMap["LUNCH"]?.delivered || 0,
      },
      dinner: {
        status: dPlan?.status || "UNPLANNED",
        cooked: dCooked,
        dispatched: deliveryMealMap["DINNER"]?.dispatched || 0,
        delivered: deliveryMealMap["DINNER"]?.delivered || 0,
      },
      totals: {
        cooked: bCooked + lCooked + dCooked,
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

  dashboardCaches.set(cacheKey, {
    data: result,
    expiresAt: Date.now() + DASHBOARD_CACHE_TTL_MS,
  });

  return result;
}
