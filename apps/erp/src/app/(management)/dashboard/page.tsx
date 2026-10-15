import React from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  BedDouble,
  Users,
  CreditCard,
  UtensilsCrossed,
  Truck,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Calendar,
  AlertCircle,
  Bell,
  Sparkles,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { validateSession, ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { getDb } from "@/server/database/db";
import { NotificationItem } from "@/types";
import { getNotifications } from "@/server/notifications/notificationService";
import { ExportReportModal } from "./ExportReportModal";
import { MonthlyRevenueChart } from "./MonthlyRevenueChart";

export const dynamic = "force-dynamic";

function formatCurrency(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return "Just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  } catch {
    return isoString;
  }
}

export default async function DashboardPage() {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get(ERP_COOKIE_NAME)?.value || "";
  const user = validateSession(sessionToken);

  const ownerName = user?.fullName || "Dr. Ravinder Gulia";
  const todayIsoDate = new Date().toISOString().slice(0, 10);
  const currentMonthPrefix = todayIsoDate.slice(0, 7);

  // Default metric containers
  let occupancy = {
    totalRooms: 0,
    totalCapacity: 0,
    occupiedBeds: 0,
    vacantBeds: 0,
    occupancyRate: 0,
  };

  let finance = {
    currentMonthRent: 0,
    currentMonthExpenses: 0,
    totalRentCollected: 0,
    totalRentBilled: 0,
    totalExpensesPaid: 0,
    totalDepositsHeld: 0,
    outstandingRent: 0,
    overdueCount: 0,
    kitchenCosts: 0,
    tiffinRevenue: 0,
    tiffinNetResult: 0,
  };

  let mealFulfillment = {
    serviceDate: todayIsoDate,
    breakfast: { status: "UNPLANNED", cooked: 0, dispatched: 0, delivered: 0 },
    lunch: { status: "UNPLANNED", cooked: 0, dispatched: 0, delivered: 0 },
    dinner: { status: "UNPLANNED", cooked: 0, dispatched: 0, delivered: 0 },
    totals: { cooked: 0, dispatched: 0, delivered: 0 },
  };

  let liveNotifications: { notifications: NotificationItem[]; unreadCount: number } = {
    notifications: [],
    unreadCount: 0,
  };

  let deliverySummary = {
    totalTasks: 0,
    delivered: 0,
    exceptions: 0,
    completionRate: 0,
  };

  let monthlyData: { month: string; label: string; collected: number; expenses: number }[] = [];

  try {
    const db = getDb();

    // 1. Rooms & Occupancy
    const roomRow = db.prepare(`
      SELECT 
        COUNT(*) as totalRooms,
        COALESCE(SUM(capacity), 0) as totalCapacity
      FROM rooms
      WHERE is_active = 1
    `).get() as { totalRooms: number; totalCapacity: number } | undefined;

    const activeStaysRow = db.prepare(`
      SELECT COUNT(*) as occupiedBeds
      FROM resident_stays
      WHERE status = 'ACTIVE'
    `).get() as { occupiedBeds: number } | undefined;

    const totalRooms = roomRow?.totalRooms || 0;
    const totalCapacity = roomRow?.totalCapacity || 0;
    const occupiedBeds = activeStaysRow?.occupiedBeds || 0;
    const vacantBeds = Math.max(0, totalCapacity - occupiedBeds);
    const occupancyRate = totalCapacity > 0 ? Math.round((occupiedBeds / totalCapacity) * 100) : 0;

    occupancy = {
      totalRooms,
      totalCapacity,
      occupiedBeds,
      vacantBeds,
      occupancyRate,
    };

    // 2. Finance
    const finSummary = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalRentCollected,
        COALESCE(SUM(CASE WHEN transaction_type = 'RENT_CHARGE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalRentBilled,
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalExpensesPaid,
        COALESCE(SUM(CASE WHEN transaction_type = 'SECURITY_DEPOSIT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as totalDepositsHeld
      FROM financial_transactions
    `).get() as {
      totalRentCollected: number;
      totalRentBilled: number;
      totalExpensesPaid: number;
      totalDepositsHeld: number;
    } | undefined;

    const rentMonthRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as rentMonth
      FROM financial_transactions
      WHERE transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' AND transaction_date LIKE ?
    `).get(`${currentMonthPrefix}%`) as { rentMonth: number } | undefined;

    const expMonthRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as expMonth
      FROM financial_transactions
      WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' AND transaction_date LIKE ?
    `).get(`${currentMonthPrefix}%`) as { expMonth: number } | undefined;

    const overdueCountRow = db.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT r.id
        FROM residents r
        JOIN financial_transactions t ON t.resident_id = r.id AND t.status = 'POSTED'
        GROUP BY r.id
        HAVING (
          SUM(CASE WHEN t.transaction_type = 'RENT_CHARGE' THEN t.amount ELSE 0 END) -
          SUM(CASE WHEN t.transaction_type = 'RENT_PAYMENT' THEN t.amount ELSE 0 END)
        ) > 0
      )
    `).get() as { count: number } | undefined;

    // Attributable Tiffin Operating Costs & Revenue
    const kitchenCostRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as kitchenCost
      FROM financial_transactions
      WHERE transaction_type = 'EXPENSE' AND status = 'POSTED' 
        AND category IN ('GROCERY', 'KITCHEN_SUPPLIES') 
        AND transaction_date LIKE ?
    `).get(`${currentMonthPrefix}%`) as { kitchenCost: number } | undefined;

    const tiffinRevRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as tiffinRev
      FROM financial_transactions
      WHERE transaction_type = 'RENT_PAYMENT' AND status = 'POSTED'
        AND (category = 'TIFFIN' OR description LIKE '%tiffin%')
        AND transaction_date LIKE ?
    `).get(`${currentMonthPrefix}%`) as { tiffinRev: number } | undefined;

    const totalRentCollected = finSummary?.totalRentCollected || 0;
    const totalRentBilled = finSummary?.totalRentBilled || 0;
    const totalExpensesPaid = finSummary?.totalExpensesPaid || 0;
    const totalDepositsHeld = finSummary?.totalDepositsHeld || 0;
    const currentMonthRent = rentMonthRow?.rentMonth || 0;
    const currentMonthExpenses = expMonthRow?.expMonth || 0;
    const outstandingRent = Math.max(0, totalRentBilled - totalRentCollected);
    const overdueCount = overdueCountRow?.count || 0;
    const kitchenCosts = kitchenCostRow?.kitchenCost || 0;
    const tiffinRevenue = tiffinRevRow?.tiffinRev || 0;
    const tiffinNetResult = tiffinRevenue - kitchenCosts;

    finance = {
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

    // 3. 6-Month Historical Revenue Chart
    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const sixMonths: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = d.toISOString().slice(0, 7);
      sixMonths.push(ym);
    }

    const monthlyDbRows = db.prepare(`
      SELECT 
        substr(transaction_date, 1, 7) as ym,
        COALESCE(SUM(CASE WHEN transaction_type = 'RENT_PAYMENT' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as collected,
        COALESCE(SUM(CASE WHEN transaction_type = 'EXPENSE' AND status = 'POSTED' THEN amount ELSE 0 END), 0) as expenses
      FROM financial_transactions
      WHERE substr(transaction_date, 1, 7) IN (${sixMonths.map(() => "?").join(",")})
      GROUP BY substr(transaction_date, 1, 7)
    `).all(...sixMonths) as { ym: string; collected: number; expenses: number }[];

    const monthMap: Record<string, { collected: number; expenses: number }> = {};
    for (const r of monthlyDbRows) {
      monthMap[r.ym] = { collected: r.collected, expenses: r.expenses };
    }

    monthlyData = sixMonths.map((ym) => {
      const mIdx = parseInt(ym.slice(5, 7), 10) - 1;
      const data = monthMap[ym] || { collected: 0, expenses: 0 };
      return {
        month: ym,
        label: monthNames[mIdx] || ym,
        collected: data.collected,
        expenses: data.expenses,
      };
    });

    // 4. Meal Fulfillment Tracking (Cooked, Dispatched, Delivered)
    let targetKitchenDate = todayIsoDate;
    let mealPlans = db.prepare(`
      SELECT meal_type, status, final_preparation_count, COALESCE(actual_cooked_count, final_preparation_count) as cooked_count
      FROM daily_meal_plans
      WHERE service_date = ?
    `).all(targetKitchenDate) as { meal_type: string; status: string; final_preparation_count: number; cooked_count: number }[];

    if (mealPlans.length === 0) {
      const latestKitchenDate = db.prepare(`
        SELECT service_date FROM daily_meal_plans ORDER BY service_date DESC LIMIT 1
      `).get() as { service_date: string } | undefined;
      if (latestKitchenDate) {
        targetKitchenDate = latestKitchenDate.service_date;
        mealPlans = db.prepare(`
          SELECT meal_type, status, final_preparation_count, COALESCE(actual_cooked_count, final_preparation_count) as cooked_count
          FROM daily_meal_plans
          WHERE service_date = ?
        `).all(targetKitchenDate) as { meal_type: string; status: string; final_preparation_count: number; cooked_count: number }[];
      }
    }

    // Delivery stats grouped by meal type for target service date
    const deliveryMealStats = db.prepare(`
      SELECT
        meal_type,
        COUNT(*) as total_tasks,
        COALESCE(SUM(CASE WHEN dispatched_at IS NOT NULL OR status IN ('OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION') THEN 1 ELSE 0 END), 0) as dispatched_count,
        COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as delivered_count
      FROM delivery_tasks
      WHERE service_date = ?
      GROUP BY meal_type
    `).all(targetKitchenDate) as { meal_type: string; total_tasks: number; dispatched_count: number; delivered_count: number }[];

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

    mealFulfillment = {
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

    // 5. Overall Delivery Statistics
    const delStatsRow = db.prepare(`
      SELECT
        COUNT(*) as total_tasks,
        COALESCE(SUM(CASE WHEN status = 'DELIVERED' THEN 1 ELSE 0 END), 0) as delivered,
        COALESCE(SUM(CASE WHEN status = 'EXCEPTION' THEN 1 ELSE 0 END), 0) as exceptions
      FROM delivery_tasks
      WHERE service_date = ?
    `).get(targetKitchenDate) as { total_tasks: number; delivered: number; exceptions: number } | undefined;

    const totalDelTasks = delStatsRow?.total_tasks || 0;
    const totalDelivered = delStatsRow?.delivered || 0;
    const totalExceptions = delStatsRow?.exceptions || 0;

    deliverySummary = {
      totalTasks: totalDelTasks,
      delivered: totalDelivered,
      exceptions: totalExceptions,
      completionRate: totalDelTasks > 0 ? Math.round((totalDelivered / totalDelTasks) * 100) : 0,
    };

    // 6. Actionable Live Notifications
    if (user) {
      liveNotifications = getNotifications(user, { limit: 4 });
    }

  } catch (err) {
    console.error("Dashboard database query error:", err);
  }

  // Summary object for export modal
  const exportSummary = {
    occupiedBeds: occupancy.occupiedBeds,
    totalCapacity: occupancy.totalCapacity,
    occupancyRate: occupancy.occupancyRate,
    availableBeds: occupancy.vacantBeds,
    currentMonthRent: finance.currentMonthRent,
    outstandingRent: finance.outstandingRent,
    overdueCount: finance.overdueCount,
    tiffinNetResult: finance.tiffinNetResult,
    kitchenCosts: finance.kitchenCosts,
    tiffinRevenue: finance.tiffinRevenue,
    totalExpenses: finance.totalExpensesPaid,
    totalMeals: mealFulfillment.totals.cooked,
    totalDeliveryTasks: deliverySummary.totalTasks,
    deliveredCount: deliverySummary.delivered,
    deliveryExceptions: deliverySummary.exceptions,
  };

  return (
    <div className="space-y-7 pb-12">
      
      {/* ============================================================== */}
      {/* 1. EXECUTIVE HEADER (Reference-Led Layout)                     */}
      {/* ============================================================== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2">
        <div className="border-l-4 border-[#B58A57] pl-3.5">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-[#1A2E20]">
            Executive Overview
          </h1>
          <p className="text-xs sm:text-sm text-[#5A6C5E] mt-1 font-sans">
            Namaste, <strong className="font-semibold text-[#1A2E20]">{ownerName}</strong>. Here is your property&apos;s operational and financial summary for today.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3 shrink-0">
          <ExportReportModal summary={exportSummary} />
        </div>
      </div>

      {/* ============================================================== */}
      {/* 2. TOP ROW: 3 PRIMARY METRIC CARDS (Spacious & Responsive)     */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Card 1: Bed Occupancy */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-6 shadow-2xs flex flex-col justify-between relative overflow-hidden group hover:border-[#5D7656] transition-colors min-h-[160px]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
              BED OCCUPANCY
            </div>
            <div className="flex items-baseline justify-between mt-3">
              <span className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1A2E20]">
                {occupancy.occupancyRate}%
              </span>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                ~{occupancy.occupancyRate}%
              </span>
            </div>
          </div>
          <div className="mt-4 pt-2">
            <div className="text-xs text-[#5A6C5E] truncate">
              {occupancy.occupiedBeds} of {occupancy.totalCapacity} beds occupied
            </div>
            <div className="w-16 h-1 bg-[#654735] rounded-full mt-2" />
          </div>
        </div>

        {/* Card 2: Pending Dues (Outstanding Rent) */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-6 shadow-2xs flex flex-col justify-between relative overflow-hidden group hover:border-[#B58A57] transition-colors min-h-[160px]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
              PENDING DUES
            </div>
            <div className="mt-3">
              <span className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1A2E20]">
                {formatCurrency(finance.outstandingRent)}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-2">
            <Link
              href="/finance"
              className="text-xs text-[#5A6C5E] hover:text-[#1A2E20] flex items-center gap-1.5 transition-colors border-l-2 border-rose-500 pl-2.5"
            >
              <span>Action required for {finance.overdueCount} accounts &rarr;</span>
            </Link>
          </div>
        </div>

        {/* Card 3: Rent Collected (Current Month) */}
        <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-6 shadow-2xs flex flex-col justify-between relative overflow-hidden group hover:border-[#5D7656] transition-colors min-h-[160px]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
              RENT COLLECTED
            </div>
            <div className="mt-3">
              <span className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1A2E20]">
                {formatCurrency(finance.currentMonthRent)}
              </span>
            </div>
          </div>
          <div className="mt-4 pt-2 flex items-center justify-between">
            <span className="text-xs text-[#5A6C5E]">
              October 2026 collections
            </span>
            <div className="flex gap-1.5">
              <span className="w-2.5 h-1.5 rounded-full bg-[#5D7656]" />
              <span className="w-2.5 h-1.5 rounded-full bg-[#5D7656]" />
              <span className="w-2.5 h-1.5 rounded-full bg-[#5D7656]/40" />
            </div>
          </div>
        </div>

      </div>

      {/* ============================================================== */}
      {/* 3. MIDDLE ROW: MONTHLY REVENUE (LEFT 2 COLS) + KPIS (RIGHT 1 COL) */}
      {/* ============================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        
        {/* Left Column (2 Columns): Monthly Revenue Chart */}
        <div className="lg:col-span-2">
          <MonthlyRevenueChart data={monthlyData} />
        </div>

        {/* Right Column (1 Column): Relocated Secondary KPI Cards - Centered Vertically */}
        <div className="lg:col-span-1 flex flex-col justify-center gap-5 sm:gap-6">
          
          {/* Relocated Card 1: Available Beds */}
          <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-6 shadow-2xs flex flex-col justify-between relative overflow-hidden group hover:border-[#5D7656] transition-colors min-h-[155px]">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
                  AVAILABLE BEDS
                </span>
                <span className="text-[11px] font-semibold text-[#8E9F89] uppercase tracking-wider">
                  Beds Left
                </span>
              </div>
              <div className="mt-3">
                <span className="text-3xl sm:text-4xl font-bold tracking-tight text-[#1A2E20]">
                  {occupancy.vacantBeds}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 flex items-center justify-between border-t border-stone-100">
              <div className="w-full flex items-center gap-2">
                <div className="h-1 bg-[#B58A57]/30 flex-1 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#B58A57] rounded-full"
                    style={{ width: `${occupancy.totalCapacity > 0 ? (occupancy.vacantBeds / occupancy.totalCapacity) * 100 : 0}%` }}
                  />
                </div>
                <BedDouble className="w-4 h-4 text-[#B58A57] shrink-0" />
              </div>
            </div>
          </div>

          {/* Relocated Card 2: This Month's Tiffin Net Result */}
          <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-6 shadow-2xs flex flex-col justify-between relative overflow-hidden group hover:border-[#B58A57] transition-colors min-h-[155px]">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6E7F70]">
                  TIFFIN NET RESULT
                </span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
                  finance.tiffinNetResult >= 0
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-rose-50 text-rose-700 border-rose-200"
                }`}>
                  {finance.tiffinNetResult >= 0 ? "Profit" : "Operating Cost"}
                </span>
              </div>
              <div className="mt-3">
                <span className={`text-3xl sm:text-4xl font-bold tracking-tight ${
                  finance.tiffinNetResult >= 0 ? "text-emerald-700" : "text-rose-700"
                }`}>
                  {finance.tiffinNetResult < 0 ? "-" : "+"}{formatCurrency(Math.abs(finance.tiffinNetResult))}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-3 flex items-center justify-between text-xs text-[#5A6C5E] border-t border-stone-100">
              <span>Costs: {formatCurrency(finance.kitchenCosts)}</span>
              <span className="text-[#8E9F89]">&bull; {deliverySummary.delivered} Delivered</span>
            </div>
          </div>

        </div>

      </div>

      {/* ============================================================== */}
      {/* 4. FULL-WIDTH OPERATIONAL SECTIONS: MEAL FULFILLMENT & NOTIFICATIONS */}
      {/* ============================================================== */}
      <div className="space-y-6 w-full">
        
        {/* Section 1: Meal Fulfillment Tracking (Full Width, on Top) */}
        <div className="w-full bg-white rounded-2xl border border-[#8E9F89]/25 p-6 shadow-2xs hover:border-[#5D7656] transition-colors">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-[#8E9F89]/20">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/30 flex items-center justify-center text-[#5D7656] shrink-0">
                <UtensilsCrossed className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-[#1A2E20] tracking-tight">
                  Meal Fulfillment Tracking
                </h3>
                <p className="text-xs text-[#5A6C5E] mt-0.5">
                  Service Date: <strong className="text-[#1A2E20]">{mealFulfillment.serviceDate}</strong> &bull; Total meals: <strong className="text-[#1A2E20]">{mealFulfillment.totals.cooked} portions</strong>
                </p>
              </div>
            </div>

            {/* Overall Fulfillment Percentage Badge */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                {mealFulfillment.totals.delivered} of {mealFulfillment.totals.cooked} Delivered ({mealFulfillment.totals.cooked > 0 ? Math.round((mealFulfillment.totals.delivered / mealFulfillment.totals.cooked) * 100) : 0}%)
              </span>
            </div>
          </div>

          {/* 3 Meal Breakdown: Breakfast, Lunch, Dinner in a spacious 3-column desktop grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-5">
            
            {/* Breakfast */}
            <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 flex flex-col justify-between hover:border-[#5D7656] transition-colors">
              <div>
                <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/15">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#1A2E20]">
                    Breakfast
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    mealFulfillment.breakfast.status === "COMPLETED" || mealFulfillment.breakfast.status === "CONFIRMED"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-stone-100 text-stone-600 border-stone-200"
                  }`}>
                    {mealFulfillment.breakfast.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 py-3.5 text-center">
                  <div className="bg-white/80 rounded-lg p-2.5 border border-[#8E9F89]/15">
                    <span className="text-[10px] uppercase font-semibold text-[#8E9F89] block tracking-wider">Cooked</span>
                    <span className="text-lg font-bold text-[#1A2E20] mt-0.5 block">{mealFulfillment.breakfast.cooked}</span>
                  </div>
                  <div className="bg-white/80 rounded-lg p-2.5 border border-[#8E9F89]/15">
                    <span className="text-[10px] uppercase font-semibold text-[#8E9F89] block tracking-wider">Dispatched</span>
                    <span className="text-lg font-bold text-[#263B2D] mt-0.5 block">{mealFulfillment.breakfast.dispatched}</span>
                  </div>
                  <div className="bg-white/80 rounded-lg p-2.5 border border-[#8E9F89]/15">
                    <span className="text-[10px] uppercase font-semibold text-emerald-700 block tracking-wider">Delivered</span>
                    <span className="text-lg font-bold text-emerald-700 mt-0.5 block">{mealFulfillment.breakfast.delivered}</span>
                  </div>
                </div>
              </div>

              <div className="pt-2.5 border-t border-[#8E9F89]/15">
                <div className="flex items-center justify-between text-[11px] text-[#5A6C5E] mb-1.5">
                  <span>Fulfillment Rate</span>
                  <span className="font-semibold text-emerald-800">
                    {mealFulfillment.breakfast.cooked > 0 ? Math.round((mealFulfillment.breakfast.delivered / mealFulfillment.breakfast.cooked) * 100) : 0}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-stone-200/70 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all"
                    style={{
                      width: `${mealFulfillment.breakfast.cooked > 0 ? Math.min(100, (mealFulfillment.breakfast.delivered / mealFulfillment.breakfast.cooked) * 100) : 0}%`
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Lunch */}
            <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 flex flex-col justify-between hover:border-[#5D7656] transition-colors">
              <div>
                <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/15">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#1A2E20]">
                    Lunch
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    mealFulfillment.lunch.status === "COMPLETED" || mealFulfillment.lunch.status === "CONFIRMED"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-stone-100 text-stone-600 border-stone-200"
                  }`}>
                    {mealFulfillment.lunch.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 py-3.5 text-center">
                  <div className="bg-white/80 rounded-lg p-2.5 border border-[#8E9F89]/15">
                    <span className="text-[10px] uppercase font-semibold text-[#8E9F89] block tracking-wider">Cooked</span>
                    <span className="text-lg font-bold text-[#1A2E20] mt-0.5 block">{mealFulfillment.lunch.cooked}</span>
                  </div>
                  <div className="bg-white/80 rounded-lg p-2.5 border border-[#8E9F89]/15">
                    <span className="text-[10px] uppercase font-semibold text-[#8E9F89] block tracking-wider">Dispatched</span>
                    <span className="text-lg font-bold text-[#263B2D] mt-0.5 block">{mealFulfillment.lunch.dispatched}</span>
                  </div>
                  <div className="bg-white/80 rounded-lg p-2.5 border border-[#8E9F89]/15">
                    <span className="text-[10px] uppercase font-semibold text-emerald-700 block tracking-wider">Delivered</span>
                    <span className="text-lg font-bold text-emerald-700 mt-0.5 block">{mealFulfillment.lunch.delivered}</span>
                  </div>
                </div>
              </div>

              <div className="pt-2.5 border-t border-[#8E9F89]/15">
                <div className="flex items-center justify-between text-[11px] text-[#5A6C5E] mb-1.5">
                  <span>Fulfillment Rate</span>
                  <span className="font-semibold text-emerald-800">
                    {mealFulfillment.lunch.cooked > 0 ? Math.round((mealFulfillment.lunch.delivered / mealFulfillment.lunch.cooked) * 100) : 0}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-stone-200/70 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all"
                    style={{
                      width: `${mealFulfillment.lunch.cooked > 0 ? Math.min(100, (mealFulfillment.lunch.delivered / mealFulfillment.lunch.cooked) * 100) : 0}%`
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Dinner */}
            <div className="p-4 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 flex flex-col justify-between hover:border-[#5D7656] transition-colors">
              <div>
                <div className="flex items-center justify-between pb-2.5 border-b border-[#8E9F89]/15">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#1A2E20]">
                    Dinner
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    mealFulfillment.dinner.status === "COMPLETED" || mealFulfillment.dinner.status === "CONFIRMED"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-stone-100 text-stone-600 border-stone-200"
                  }`}>
                    {mealFulfillment.dinner.status}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 py-3.5 text-center">
                  <div className="bg-white/80 rounded-lg p-2.5 border border-[#8E9F89]/15">
                    <span className="text-[10px] uppercase font-semibold text-[#8E9F89] block tracking-wider">Cooked</span>
                    <span className="text-lg font-bold text-[#1A2E20] mt-0.5 block">{mealFulfillment.dinner.cooked}</span>
                  </div>
                  <div className="bg-white/80 rounded-lg p-2.5 border border-[#8E9F89]/15">
                    <span className="text-[10px] uppercase font-semibold text-[#8E9F89] block tracking-wider">Dispatched</span>
                    <span className="text-lg font-bold text-[#263B2D] mt-0.5 block">{mealFulfillment.dinner.dispatched}</span>
                  </div>
                  <div className="bg-white/80 rounded-lg p-2.5 border border-[#8E9F89]/15">
                    <span className="text-[10px] uppercase font-semibold text-emerald-700 block tracking-wider">Delivered</span>
                    <span className="text-lg font-bold text-emerald-700 mt-0.5 block">{mealFulfillment.dinner.delivered}</span>
                  </div>
                </div>
              </div>

              <div className="pt-2.5 border-t border-[#8E9F89]/15">
                <div className="flex items-center justify-between text-[11px] text-[#5A6C5E] mb-1.5">
                  <span>Fulfillment Rate</span>
                  <span className="font-semibold text-emerald-800">
                    {mealFulfillment.dinner.cooked > 0 ? Math.round((mealFulfillment.dinner.delivered / mealFulfillment.dinner.cooked) * 100) : 0}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-stone-200/70 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full transition-all"
                    style={{
                      width: `${mealFulfillment.dinner.cooked > 0 ? Math.min(100, (mealFulfillment.dinner.delivered / mealFulfillment.dinner.cooked) * 100) : 0}%`
                    }}
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Daily Fulfillment Totals Bar */}
          <div className="mt-5 pt-4 border-t border-[#8E9F89]/20 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-6 sm:gap-10">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#1A2E20]" />
                <span className="text-[#5A6C5E]">Total Cooked: <strong className="text-[#1A2E20] font-semibold">{mealFulfillment.totals.cooked}</strong> portions</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#263B2D]" />
                <span className="text-[#5A6C5E]">Total Dispatched: <strong className="text-[#1A2E20] font-semibold">{mealFulfillment.totals.dispatched}</strong> portions</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                <span className="text-[#5A6C5E]">Total Delivered: <strong className="text-emerald-700 font-semibold">{mealFulfillment.totals.delivered}</strong> portions</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Notification Center (Directly Underneath, Full Width, Fixed Bounded Height, Internally Scrollable) */}
        <div
          id="notifications"
          className="w-full bg-[#1A2E20] text-white rounded-2xl p-6 shadow-md border border-[#263B2D] flex flex-col max-h-[380px] h-[380px]"
        >
          {/* Header (Pinned / Sticky at top, always visible) */}
          <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[#263B2D] border border-[#B58A57]/40 flex items-center justify-center text-[#B58A57] shrink-0">
                <Bell className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-serif font-bold tracking-tight text-white">
                  Notification Center
                </h3>
                <p className="text-xs text-[#A8B9A1] mt-0.5">
                  Live operational alerts across Finance, Kitchen, and Delivery.
                </p>
              </div>
            </div>

            {liveNotifications.unreadCount > 0 && (
              <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-[#B58A57] text-white shrink-0">
                {liveNotifications.unreadCount} unread
              </span>
            )}
          </div>

          {/* Scrollable Notification List (Internally scrollable, page height remains stable) */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden pt-4 pr-1 space-y-2.5 min-h-0">
            {liveNotifications.notifications.length === 0 ? (
              <div className="p-6 rounded-xl bg-[#263B2D]/50 text-xs text-[#A8B9A1] text-center">
                All systems clear. No pending alerts.
              </div>
            ) : (
              liveNotifications.notifications.map((item) => (
                <Link
                  key={item.id}
                  href={item.link || "#"}
                  className="block p-3.5 rounded-xl bg-[#263B2D]/70 border border-white/10 hover:border-[#B58A57]/50 hover:bg-[#263B2D] transition-all text-xs group"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        item.type === "ALERT" ? "bg-rose-400" : item.type === "WARNING" ? "bg-amber-400" : item.type === "SUCCESS" ? "bg-emerald-400" : "bg-sky-400"
                      }`} />
                      <span className="font-semibold text-white group-hover:text-[#C89F6B] transition-colors">
                        {item.title}
                      </span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-white/10 text-[#C89F6B] border border-white/5 uppercase tracking-wider">
                        {item.domain}
                      </span>
                    </div>
                    {item.timestamp && (
                      <span className="text-[11px] text-[#8E9F89] shrink-0">
                        {formatRelativeTime(item.timestamp)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-white/75 mt-1.5 leading-relaxed pl-4">
                    {item.description}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>

      </div>

      {/* ============================================================== */}
      {/* 5. PRINT-ONLY EXECUTIVE DOSSIER (Visible only during printing)  */}
      {/* ============================================================== */}
      <div className="hidden print:block p-8 space-y-6 bg-white text-black">
        <div className="border-b-2 border-black pb-4 flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              RAVINARAYAN PG GUESTHOUSE
            </h1>
            <p className="text-sm font-medium">
              Official Executive Operations &amp; Financial Briefing
            </p>
          </div>
          <div className="text-right text-xs">
            <div><strong>Date:</strong> {todayIsoDate}</div>
            <div><strong>Reporting Period:</strong> October 2026</div>
            <div><strong>Prepared For:</strong> {ownerName} (Owner)</div>
          </div>
        </div>

        {/* Print Summary Table */}
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="py-2 font-bold">Operational Domain</th>
              <th className="py-2 font-bold">Key Performance Metric</th>
              <th className="py-2 font-bold text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-300">
            <tr>
              <td className="py-1.5">Room &amp; Bed Occupancy</td>
              <td>Occupied Beds / Total Bed Capacity</td>
              <td className="py-1.5 text-right font-semibold">{occupancy.occupiedBeds} / {occupancy.totalCapacity} ({occupancy.occupancyRate}%)</td>
            </tr>
            <tr>
              <td className="py-1.5">Room &amp; Bed Occupancy</td>
              <td>Available Beds for Intake</td>
              <td className="py-1.5 text-right font-semibold">{occupancy.vacantBeds} Beds</td>
            </tr>
            <tr>
              <td className="py-1.5">Finance &amp; Collections</td>
              <td>Current Month Rent Collected (MTD)</td>
              <td className="py-1.5 text-right font-semibold">{formatCurrency(finance.currentMonthRent)}</td>
            </tr>
            <tr>
              <td className="py-1.5">Finance &amp; Collections</td>
              <td>Total Rent Collected (All Time)</td>
              <td className="py-1.5 text-right font-semibold">{formatCurrency(finance.totalRentCollected)}</td>
            </tr>
            <tr>
              <td className="py-1.5">Finance &amp; Collections</td>
              <td>Outstanding Rent Dues</td>
              <td className="py-1.5 text-right font-semibold text-rose-700">{formatCurrency(finance.outstandingRent)} ({finance.overdueCount} accounts)</td>
            </tr>
            <tr>
              <td className="py-1.5">Finance &amp; Collections</td>
              <td>Security Deposits Custodial Liability</td>
              <td className="py-1.5 text-right font-semibold">{formatCurrency(finance.totalDepositsHeld)}</td>
            </tr>
            <tr>
              <td className="py-1.5">Tiffin &amp; Kitchen</td>
              <td>Current Month Tiffin Operating Result</td>
              <td className="py-1.5 text-right font-semibold">{finance.tiffinNetResult < 0 ? "-" : "+"}{formatCurrency(Math.abs(finance.tiffinNetResult))}</td>
            </tr>
            <tr>
              <td className="py-1.5">Tiffin &amp; Kitchen</td>
              <td>Attributable Kitchen Operating Costs</td>
              <td className="py-1.5 text-right font-semibold">{formatCurrency(finance.kitchenCosts)}</td>
            </tr>
            <tr>
              <td className="py-1.5">Tiffin &amp; Kitchen</td>
              <td>Daily Meal Portions Prepared</td>
              <td className="py-1.5 text-right font-semibold">{mealFulfillment.totals.cooked} Portions</td>
            </tr>
            <tr>
              <td className="py-1.5">Delivery Fulfillment</td>
              <td>Delivered Meals / Completion Rate</td>
              <td className="py-1.5 text-right font-semibold">{deliverySummary.delivered} / {deliverySummary.totalTasks} ({deliverySummary.completionRate}%)</td>
            </tr>
            <tr>
              <td className="py-1.5">Delivery Fulfillment</td>
              <td>Active Delivery Exceptions</td>
              <td className="py-1.5 text-right font-semibold">{deliverySummary.exceptions} Exception(s)</td>
            </tr>
          </tbody>
        </table>

        <div className="pt-4 border-t border-black text-[10px] text-gray-600 flex justify-between">
          <span>Confidential internal briefing &bull; Ravinarayan ERP</span>
          <span>Authoritative records verified from SQLite operational database</span>
        </div>
      </div>

    </div>
  );
}
