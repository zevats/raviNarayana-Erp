/**
 * Local calendar date utilities for Ravinarayan ERP Finance.
 * Prevents UTC timezone shifts in IST (UTC+5:30) and other positive offsets.
 */

export function toLocalDateString(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getLocalFirstDayOfMonth(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

export function getLocalDaysAgo(days: number, date: Date = new Date()): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() - days);
  return toLocalDateString(d);
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
