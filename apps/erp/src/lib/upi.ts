/**
 * The business UPI account customers pay at the door (shown as a QR in the delivery app). Set
 * NEXT_PUBLIC_UPI_ID / NEXT_PUBLIC_UPI_NAME at build time to change it without a code change.
 */
export const UPI_ID = (process.env.NEXT_PUBLIC_UPI_ID || "9060358005@axl").trim();
export const UPI_NAME = (process.env.NEXT_PUBLIC_UPI_NAME || "Ravinarayan").trim();

/** Standard UPI payment link (NPCI): any UPI app opens it with the payee and amount filled in. */
export function upiPayUri(amount: number, note?: string): string {
  const p = new URLSearchParams({ pa: UPI_ID, pn: UPI_NAME, cu: "INR" });
  if (Number.isFinite(amount) && amount > 0) p.set("am", String(Math.round(amount)));
  if (note) p.set("tn", note.slice(0, 60));
  return `upi://pay?${p.toString().replace(/\+/g, "%20")}`;
}
