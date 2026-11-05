/**
 * Billing periods are free text on ledger rows and invoices ("November 2026", "Nov 2026",
 * "2026-11"…). Wherever a period decides whether a month is already charged, compare the canonical
 * month (YYYY-MM) instead of the text, so the same month written two ways is still one month.
 * Text that is not a recognisable month ("Verify Period 3", "Electricity Nov 2026") returns null and
 * callers keep their exact-text behaviour for it.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function monthNumber(name: string): number | null {
  if (name === "sept") return 9;
  const i = MONTHS.findIndex((m) => m === name || (name.length >= 3 && m.startsWith(name)));
  return i >= 0 ? i + 1 : null;
}

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** "Nov 2026", " november  2026 ", "NOV-2026", "2026-11", "11/2026" → "2026-11"; anything else → null. */
export function canonicalBillingMonth(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text.trim().toLowerCase().replace(/\s+/g, " ");
  let m = /^([a-z]+)\.?[\s,\-/]*(\d{4})$/.exec(s);
  if (m) {
    const month = monthNumber(m[1]);
    return month ? ym(Number(m[2]), month) : null;
  }
  m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return ym(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return ym(Number(m[2]), Number(m[1]));
  return null;
}

/** The label the monthly rent run writes for a month ("November 2026"). */
export function billingMonthLabel(month: string): string {
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

/**
 * Whether a rent charge belongs to a month: its period text names that month, or (when the text is
 * not a recognisable month) it is dated in that month — the same rule the monthly rent run uses for
 * hand-entered charges.
 */
export function chargeIsForMonth(row: { billing_period?: string | null; transaction_date?: string | null }, month: string): boolean {
  const named = canonicalBillingMonth(row.billing_period);
  if (named) return named === month;
  return typeof row.transaction_date === "string" && row.transaction_date.slice(0, 7) === month;
}
