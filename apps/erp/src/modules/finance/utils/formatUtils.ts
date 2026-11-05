import { TransactionType, TransactionStatus } from "@/types";
import { formatMoney } from "@/lib/format";

/**
 * Formats a numeric value into INR with standard Indian grouping (e.g. ₹2,85,200).
 * Uses a reused formatter: this runs for every amount in every list row on each render.
 */
export function formatINR(amount: number): string {
  // Negative amounts read −₹1,234 across the ERP (lib/format.ts).
  return formatMoney(amount);
}

/**
 * Returns formatted INR with semantic sign based on transaction type.
 * Rent payments and security deposits are inflows (+).
 * Expenses are outflows (-).
 * Rent charges are billing receivables (neutral, no +/- prefix).
 */
export function formatINRWithSign(
  amount: number,
  type: TransactionType,
  status: TransactionStatus
): { formatted: string; isPositive: boolean; isNegative: boolean; isNeutral: boolean } {
  const inr = formatINR(amount);
  if (status === "REVERSED") {
    return { formatted: inr, isPositive: false, isNegative: false, isNeutral: true };
  }

  if (type === "RENT_PAYMENT" || type === "SECURITY_DEPOSIT") {
    return { formatted: `+${inr}`, isPositive: true, isNegative: false, isNeutral: false };
  }
  if (type === "EXPENSE") {
    return { formatted: `-${inr}`, isPositive: false, isNegative: true, isNeutral: false };
  }
  if (type === "REVERSAL") {
    return { formatted: inr, isPositive: false, isNegative: false, isNeutral: true };
  }

  // RENT_CHARGE (billing entry, not cash)
  return { formatted: inr, isPositive: false, isNegative: false, isNeutral: true };
}
