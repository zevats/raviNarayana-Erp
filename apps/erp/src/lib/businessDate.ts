/**
 * Business calendar helpers. The ERP operates in India, so "today" is the Asia/Kolkata date,
 * never the UTC date from Date#toISOString (which is a day behind between 00:00 and 05:30 IST).
 */
const BUSINESS_TIME_ZONE = "Asia/Kolkata";

/** YYYY-MM-DD in the business time zone. */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE }).format(now);
}

/** Adds whole days to a YYYY-MM-DD date (calendar arithmetic, no time-zone drift). */
export function addBusinessDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/** The meal being served now: lunch until 16:00 IST, dinner from 16:00 (no gap between them). */
export function businessMeal(now: Date = new Date()): "BREAKFAST" | "LUNCH" | "DINNER" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(now));
  // Breakfast until 11 am, lunch until 4 pm, dinner from 4 pm (the dinner list is prepared at 3:30 pm).
  return hour < 11 ? "BREAKFAST" : hour >= 16 ? "DINNER" : "LUNCH";
}

/** First day (YYYY-MM-01) of the business month containing `now`. */
export function businessMonthStart(now: Date = new Date()): string {
  return `${businessToday(now).slice(0, 7)}-01`;
}

/** YYYY-MM of the business month `offset` months from the one containing `now` (negative = earlier). */
export function businessMonthKey(offset = 0, now: Date = new Date()): string {
  const [y, m] = businessToday(now).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return d.toISOString().slice(0, 7);
}
