import React from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
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
  Layers,
  Info,
  UserCog,
  FileText,
  Lock,
} from "lucide-react";
import { ERP_COOKIE_NAME } from "@/server/authentication/auth";
import { validateSessionCached } from "@/server/authentication/cachedAuth";
import { getDashboardMetrics } from "@/server/dashboard/dashboardService";
import { runAutomaticRentIfDue } from "@/server/finance/rentGenerationService";
import { getDashboardOps, DashboardOps } from "@/server/dashboard/dashboardOpsService";
import { previewDailyClosing } from "@/server/finance/cashbookClosingService";
import { hasPermission } from "@/server/authorization/permissions";
import { DashboardView } from "./DashboardView";
import { NotificationItem, ClosingDivision } from "@/types";
import { getNotifications } from "@/server/notifications/notificationService";
import { ExportReportModal } from "./ExportReportModal";
import { MonthlyRevenueChart } from "./MonthlyRevenueChart";
import { businessToday } from "@/lib/businessDate";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

function formatCurrency(amount: number): string {
  return formatMoney(amount);
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

interface DashboardPageProps {
  searchParams?: {
    division?: ClosingDivision;
    startDate?: string;
    endDate?: string;
  };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get(ERP_COOKIE_NAME)?.value || "";
  const user = await validateSessionCached(sessionToken);

  // Delivery personnel land directly on the mobile Driver Run interface
  if (user?.role === "DELIVERY_PERSON") {
    redirect("/delivery");
  }

  const ownerName = user?.fullName || "Owner";
  const todayIsoDate = businessToday();
  const currentMonthPrefix = todayIsoDate.slice(0, 7);
  const activeDivision: ClosingDivision = searchParams?.division === "PG" || searchParams?.division === "TIFFIN" ? searchParams.division : "COMBINED";

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
  // When figures cannot be loaded the page says so; it never presents placeholder zeros as real data.
  let metricsUnavailable = false;

  // Monthly rent is generated on the first dashboard visit on or after the rent due day (Settings);
  // nothing happens when automatic rent is off or already done. Never blocks the page on failure.
  if (user) await runAutomaticRentIfDue(user);

  try {
    const [metrics, notifs] = await Promise.all([
      getDashboardMetrics({
        division: activeDivision,
        viewerRole: user?.role,
        startDate: searchParams?.startDate,
        endDate: searchParams?.endDate,
      }),
      user ? getNotifications(user, { limit: 6 }) : Promise.resolve({ notifications: [], unreadCount: 0 }),
    ]);

    occupancy = metrics.occupancy;
    finance = metrics.finance;
    mealFulfillment = metrics.mealFulfillment;
    deliverySummary = metrics.deliverySummary;
    monthlyData = metrics.monthlyData;
    liveNotifications = notifs;
  } catch (err) {
    console.error("Dashboard database query error:", err);
    metricsUnavailable = true;
  }

  // Today's operations, people, money and charts (each block reports its own failure).
  const showMoney = hasPermission(user?.role, "finance.read");
  const [ops, cashInHand] = await Promise.all([
    getDashboardOps(activeDivision).catch((): DashboardOps => ({ today: null, custody: null, people: null, money: null, charts: null, tiffin: null, recent: null, failed: ["all"] })),
    showMoney && user
      ? previewDailyClosing(user, todayIsoDate, "COMBINED").then((pv) => pv.expectedCashBalance).catch(() => null)
      : Promise.resolve(null),
  ]);

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
    <DashboardView
      ownerName={ownerName}
      division={activeDivision}
      showMoney={showMoney}
      ops={ops}
      occupancy={occupancy}
      finance={finance}
      monthlyData={monthlyData}
      notifications={liveNotifications.notifications}
      cashInHand={cashInHand}
      metricsUnavailable={metricsUnavailable}
      exportSummary={exportSummary}
      startDate={searchParams?.startDate}
      endDate={searchParams?.endDate}
    />
  );
}
