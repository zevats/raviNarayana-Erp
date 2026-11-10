/**
 * Reused Intl formatters. `n.toLocaleString("en-IN")` and `date.toLocaleDateString(locale, options)`
 * build a new formatter on every call: measured in Edge at 28 µs and 150-170 µs per call, against
 * under 2 µs for a reused formatter. Lists format every amount and date on each render (each
 * keystroke in a search box), so table cells use these instead. Output is identical.
 */

const numberIN = new Intl.NumberFormat("en-IN");

/** Same output as `value.toLocaleString("en-IN")` (Indian grouping: 2,85,200). */
export function formatNumberIN(value: number): string {
  return numberIN.format(value);
}

/**
 * Rupees, whole, one style for negatives everywhere: −₹1,234 (minus sign before the symbol, never
 * ₹-1,234). `signed` also prefixes + for positive amounts (net movements).
 */
export function formatMoney(value: number, options?: { signed?: boolean }): string {
  const v = Number.isFinite(value) ? Math.round(value) : 0;
  const body = `₹${numberIN.format(Math.abs(v))}`;
  if (v < 0) return `−${body}`;
  return options?.signed && v > 0 ? `+${body}` : body;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** Same output as `date.toLocaleString(locale, options)` (and the date/time variants), cached per options. */
export function formatDateTime(date: Date | string | number, locale: string | undefined, options: Intl.DateTimeFormatOptions): string {
  const key = `${locale ?? ""}|${JSON.stringify(options)}`;
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, f);
  }
  return f.format(date instanceof Date ? date : new Date(date));
}

/**
 * A stored note as people read it: the old "Correction / Reversal of txn_…: reason" wording becomes
 * "Reversal: reason", and any other internal record id is left out.
 */
export function readableNote(note: string | null | undefined): string {
  if (!note) return "";
  return note
    .replace(/^Correction \/ Reversal of [A-Za-z0-9_-]+:\s*/, "Reversal: ")
    .replace(/\s*\(?\b[a-z]{2,6}_[A-Za-z0-9-]{6,}\b\)?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
