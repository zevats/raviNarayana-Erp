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
import { DashboardView, type DashboardDivisionView } from "./DashboardView";
import { NotificationItem, ClosingDivision } from "@/types";
import { getNotifications } from "@/server/notifications/notificationService";
import { ExportReportModal } from "./ExportReportModal";
import { MonthlyRevenueChart } from "./MonthlyRevenueChart";
import { businessToday } from "@/lib/businessDate";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

let lastRentCheck = 0;

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
  const activeDivision: ClosingDivision = searchParams?.division === "PG" || searchParams?.division === "TIFFIN" ? searchParams.division : "COMBINED";

  // All three views (All, PG, Tiffin) are loaded together, side by side, so switching between
  // them on the page is instant (no new request). Without finance access only "All" is shown.
  const showMoney = hasPermission(user?.role, "finance.read");
  const divisions: ClosingDivision[] = showMoney ? ["COMBINED", "PG", "TIFFIN"] : ["COMBINED"];

  // Monthly rent is generated on the first dashboard visit on or after the rent due day (Settings);
  // nothing happens when automatic rent is off or already done. Never blocks the page on failure.
  // Checked at most every 30 minutes per server (it reads the whole month's rent), so opening the
  // dashboard stays quick; the rent itself is created on the first check after the due day.
  if (user && Date.now() - lastRentCheck > 30 * 60_000) {
    lastRentCheck = Date.now();
    await runAutomaticRentIfDue(user);
  }

  const emptyOps = (): DashboardOps => ({ today: null, custody: null, people: null, money: null, charts: null, tiffin: null, recent: null, failed: ["all"] });
  const [perDivision, notifs, cashInHand] = await Promise.all([
    Promise.all(
      divisions.map(async (division) => {
        const [metrics, ops] = await Promise.all([
          getDashboardMetrics({ division, viewerRole: user?.role, startDate: searchParams?.startDate, endDate: searchParams?.endDate }).catch((err) => {
            console.error("Dashboard database query error:", err);
            return null;
          }),
          getDashboardOps(division).catch(emptyOps),
        ]);
        return { division, metrics, ops };
      })
    ),
    user ? getNotifications(user, { limit: 12 }).catch(() => ({ notifications: [], unreadCount: 0 })) : Promise.resolve({ notifications: [] as NotificationItem[], unreadCount: 0 }),
    showMoney && user ? previewDailyClosing(user, todayIsoDate, "COMBINED").then((pv) => pv.expectedCashBalance).catch(() => null) : Promise.resolve(null),
  ]);

  const views = {} as Record<ClosingDivision, DashboardDivisionView>;
  for (const { division, metrics, ops } of perDivision) {
    const occupancy = metrics?.occupancy ?? { totalRooms: 0, totalCapacity: 0, occupiedBeds: 0, vacantBeds: 0, occupancyRate: 0 };
    const finance = metrics?.finance ?? { currentMonthRent: 0, currentMonthExpenses: 0, totalRentCollected: 0, totalRentBilled: 0, totalExpensesPaid: 0, totalDepositsHeld: 0, outstandingRent: 0, overdueCount: 0, kitchenCosts: 0, tiffinRevenue: 0, tiffinNetResult: 0 };
    const meals = metrics?.mealFulfillment ?? { totals: { cooked: 0 } };
    const delivery = metrics?.deliverySummary ?? { totalTasks: 0, delivered: 0, exceptions: 0, completionRate: 0 };
    views[division] = {
      ops,
      occupancy,
      finance,
      monthlyData: metrics?.monthlyData ?? [],
      metricsUnavailable: !metrics,
      // Summary for the export dialog
      exportSummary: {
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
        totalMeals: meals.totals.cooked,
        totalDeliveryTasks: delivery.totalTasks,
        deliveredCount: delivery.delivered,
        deliveryExceptions: delivery.exceptions,
      },
    };
  }

  return (
    <DashboardView
      ownerName={ownerName}
      initialDivision={divisions.includes(activeDivision) ? activeDivision : "COMBINED"}
      divisions={divisions}
      showMoney={showMoney}
      views={views}
      notifications={notifs.notifications}
      cashInHand={cashInHand}
      startDate={searchParams?.startDate}
      endDate={searchParams?.endDate}
      renderedAt={Date.now()}
    />
  );
}
