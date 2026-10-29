/**
 * Finance, Rent & Cashbook Boundaries (Phase 4 Foundation)
 */

export type TransactionType = "RENT_PAYMENT" | "SECURITY_DEPOSIT" | "TIFFIN_PAYMENT" | "EXPENSE" | "REFUND" | "DEPOSIT_REFUND";
import {
  PaymentMethod as CanonicalPaymentMethod,
  CANONICAL_PAYMENT_METHODS,
  normalizePaymentMethod,
  tryNormalizePaymentMethod,
  formatPaymentMethodLabel,
  PAYMENT_METHOD_LABELS,
} from "@/types";

export type PaymentMethod = CanonicalPaymentMethod;
export {
  CANONICAL_PAYMENT_METHODS,
  normalizePaymentMethod,
  tryNormalizePaymentMethod,
  formatPaymentMethodLabel,
  PAYMENT_METHOD_LABELS,
};

export interface TransactionRecord {
  id: string;
  residentId?: string;
  amount: number;
  type: TransactionType;
  method: PaymentMethod;
  recordedByStaffId: string;
  referenceNumber?: string;
  createdAt: string;
  notes?: string;
}
