/**
 * Finance, Rent & Cashbook Boundaries (Phase 4 Foundation)
 */

export type TransactionType = "RENT_PAYMENT" | "SECURITY_DEPOSIT" | "TIFFIN_PAYMENT" | "EXPENSE" | "REFUND";
export type PaymentMethod = "UPI" | "BANK_TRANSFER" | "CASH" | "CARD";

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
