import { businessToday, businessMonthStart, addBusinessDays } from "@/lib/businessDate";

/**
 * Business-calendar (Asia/Kolkata) date utilities for Ravinarayan ERP Finance.
 * Prevents UTC timezone shifts in IST (UTC+5:30) and other positive offsets.
 */

export function toLocalDateString(date: Date = new Date()): string {
  return businessToday(date);
}

export function getLocalFirstDayOfMonth(date: Date = new Date()): string {
  return businessMonthStart(date);
}

export function getLocalDaysAgo(days: number, date: Date = new Date()): string {
  return addBusinessDays(businessToday(date), -days);
}

export function formatIndianDate(dateString: string | null | undefined): string {
  if (!dateString) return "—";
  try {
    const [year, month, day] = dateString.split("-").map(Number);
    if (!year || !month || !day) return dateString;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

export function validateDateRange(startDate: string, endDate: string): { isValid: boolean; error?: string } {
  if (!startDate || !endDate) {
    return { isValid: false, error: "Both start and end dates are required." };
  }
  if (startDate > endDate) {
    return { isValid: false, error: "Start date cannot be after end date." };
  }
  return { isValid: true };
}
