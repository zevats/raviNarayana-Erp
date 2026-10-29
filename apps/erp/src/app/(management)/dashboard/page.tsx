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
import { NotificationItem, ClosingDivision } from "@/types";
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

  const ownerName = user?.fullName || "Dr. Ravinder Gulia";
  const todayIsoDate = new Date().toISOString().slice(0, 10);
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

  try {
    const [metrics, notifs] = await Promise.all([
      getDashboardMetrics({
        division: activeDivision,
        startDate: searchParams?.startDate,
        endDate: searchParams?.endDate,
      }),
      user ? getNotifications(user, { limit: 4 }) : Promise.resolve({ notifications: [], unreadCount: 0 }),
    ]);

    occupancy = metrics.occupancy;
    finance = metrics.finance;
    mealFulfillment = metrics.mealFulfillment;
    deliverySummary = metrics.deliverySummary;
    monthlyData = metrics.monthlyData;
    liveNotifications = notifs;
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
      {/* 1. EXECUTIVE HEADER & DIVISION FILTER CONTROLS                 */}
      {/* ============================================================== */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2">
        <div className="border-l-4 border-[#B58A57] pl-3.5">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold tracking-tight text-[#1A2E20]">
            Executive Overview
          </h1>
          <p className="text-xs sm:text-sm text-[#5A6C5E] mt-1 font-sans">
            Namaste, <strong className="font-semibold text-[#1A2E20]">{ownerName}</strong>. Here is your property&apos;s operational and financial summary.
          </p>
        </div>

        {/* Division Selector & Action Controls */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {/* Canonical 3-Way Division Filter */}
          <div className="inline-flex rounded-xl bg-[#FAF8F5] p-1 border border-[#8E9F89]/30 text-xs font-semibold shadow-2xs">
            <Link
              href="/dashboard?division=COMBINED"
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeDivision === "COMBINED"
                  ? "bg-[#1A2E20] text-white shadow-2xs"
                  : "text-[#5A6C5E] hover:text-[#1A2E20]"
              }`}
            >
              All Operations
            </Link>
            <Link
              href="/dashboard?division=PG"
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeDivision === "PG"
                  ? "bg-[#1A2E20] text-white shadow-2xs"
                  : "text-[#5A6C5E] hover:text-[#1A2E20]"
              }`}
            >
              PG Guesthouse
            </Link>
            <Link
              href="/dashboard?division=TIFFIN"
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeDivision === "TIFFIN"
                  ? "bg-[#1A2E20] text-white shadow-2xs"
                  : "text-[#5A6C5E] hover:text-[#1A2E20]"
              }`}
            >
              Tiffin Service
            </Link>
          </div>

          <ExportReportModal
            summary={exportSummary}
            division={activeDivision}
            startDate={searchParams?.startDate}
            endDate={searchParams?.endDate}
          />
        </div>
      </div>

      {/* Property Capacity & Room Audit Badge */}
      <div className="p-3.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#5A6C5E]">
        <div className="flex items-center gap-2.5">
          <Info className="w-4 h-4 text-[#B58A57] shrink-0" />
          <span>
            <strong>Property Capacity:</strong> 39 Confirmed Physical Beds across 21 rooms &bull; 41 Total Provisioned Beds in DB (Suite M01 has 1 or 2 beds pending physical owner confirmation).
          </span>
        </div>
        <div className="shrink-0 flex items-center gap-3 text-[11px] font-medium text-[#1A2E20]">
          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
            {occupancy.occupiedBeds} Beds Occupied
          </span>
          <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">
            {occupancy.vacantBeds} Beds Available
          </span>
        </div>
      </div>

      {/* ============================================================== */}
      {/* ROLE-AWARE MOBILE WORKFLOW BAR (Touch-Optimized for Phone)      */}
      {/* ============================================================== */}
      <div className="bg-white rounded-2xl border border-[#8E9F89]/25 p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#B58A57]" />
            <h2 className="text-xs font-serif font-bold uppercase tracking-wider text-[#1A2E20]">
              {user?.role === "ACCOUNTANT"
                ? "Accountant Workflows"
                : user?.role === "OPERATIONS_MANAGER"
                ? "Operations Workflows"
                : "Owner & Executive Workflows"}
            </h2>
          </div>
          <span className="text-[10px] font-mono text-[#5A6C5E] uppercase tracking-wider">
            {user?.role || "Staff"}
          </span>
        </div>

        {/* Quick-Access Touch Action Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
          {user?.role === "ACCOUNTANT" ? (
            <>
              <Link
                href="/finance"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <Lock className="w-4 h-4 text-[#B58A57] shrink-0" />
                <span className="truncate">Daily Closing</span>
              </Link>
              <Link
                href="/finance"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <CreditCard className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="truncate">Cashbook</span>
              </Link>
              <Link
                href="/finance"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <FileText className="w-4 h-4 text-[#B58A57] shrink-0" />
                <span className="truncate">Invoices &amp; Tax</span>
              </Link>
              <Link
                href="/tiffin"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <Users className="w-4 h-4 text-[#5D7656] shrink-0" />
                <span className="truncate">Tiffin Billing</span>
              </Link>
            </>
          ) : user?.role === "OPERATIONS_MANAGER" ? (
            <>
              <Link
                href="/kitchen"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <UtensilsCrossed className="w-4 h-4 text-[#B58A57] shrink-0" />
                <span className="truncate">Kitchen Plan</span>
              </Link>
              <Link
                href="/delivery"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <Truck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="truncate">Dispatch Board</span>
              </Link>
              <Link
                href="/residents"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <Users className="w-4 h-4 text-[#5D7656] shrink-0" />
                <span className="truncate">Residents</span>
              </Link>
              <Link
                href="/rooms"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <BedDouble className="w-4 h-4 text-[#654735] shrink-0" />
                <span className="truncate">Room Inventory</span>
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/finance"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <CreditCard className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="truncate">Finance &amp; Closing</span>
              </Link>
              <Link
                href="/residents"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <Users className="w-4 h-4 text-[#5D7656] shrink-0" />
                <span className="truncate">Resident Stays</span>
              </Link>
              <Link
                href="/kitchen"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <UtensilsCrossed className="w-4 h-4 text-[#B58A57] shrink-0" />
                <span className="truncate">Kitchen &amp; Meals</span>
              </Link>
              <Link
                href="/staff"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-[#FAF8F5] border border-[#8E9F89]/20 hover:border-[#1A2E20] text-xs font-semibold text-[#1A2E20] transition-colors shadow-2xs"
              >
                <UserCog className="w-4 h-4 text-[#654735] shrink-0" />
                <span className="truncate">Staff Admin</span>
              </Link>
            </>
          )}
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
