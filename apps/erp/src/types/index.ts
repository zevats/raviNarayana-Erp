/**
 * Core ERP Domain Types
 */

export type StaffRole =
  | "SUPER_ADMIN"
  | "OPERATIONS_MANAGER"
  | "ACCOUNTANT"
  | "KITCHEN_OPERATIONS"
  | "DELIVERY_PERSON";

export interface StaffUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface StaffListFilter {
  search?: string;
  role?: StaffRole;
  isActive?: boolean;
}

export interface StaffStats {
  totalStaff: number;
  activeStaff: number;
  deactivatedStaff: number;
  superAdmins: number;
}

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: StaffRole;
}

export interface SessionRecord {
  id: string;
  sessionToken: string;
  staffId: string;
  expiresAt: string;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export const CANONICAL_BUSINESS_ROLES: readonly StaffRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_MANAGER",
  "DELIVERY_PERSON",
] as const;

export const ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: "Owner",
  OPERATIONS_MANAGER: "Manager",
  ACCOUNTANT: "Accountant (Legacy)",
  KITCHEN_OPERATIONS: "Kitchen Staff (Legacy)",
  DELIVERY_PERSON: "Delivery Boy",
};

export const ROLE_BADGE_STYLES: Record<StaffRole, { bg: string; text: string; border: string }> = {
  SUPER_ADMIN: {
    bg: "bg-[#1A2E20]/10",
    text: "text-[#1A2E20]",
    border: "border-[#1A2E20]/25",
  },
  OPERATIONS_MANAGER: {
    bg: "bg-[#B58A57]/15",
    text: "text-[#9E7443]",
    border: "border-[#B58A57]/30",
  },
  ACCOUNTANT: {
    bg: "bg-[#3D5240]/10",
    text: "text-[#263B2D]",
    border: "border-[#3D5240]/25",
  },
  KITCHEN_OPERATIONS: {
    bg: "bg-[#5D7656]/15",
    text: "text-[#2F6B24]",
    border: "border-[#5D7656]/30",
  },
  DELIVERY_PERSON: {
    bg: "bg-[#8E9F89]/20",
    text: "text-[#263B2D]",
    border: "border-[#8E9F89]/40",
  },
};

export type Permission =
  // Staff Administration
  | "staff.read"
  | "staff.create"
  | "staff.update"
  | "staff.deactivate"
  | "staff.assign_role"
  // Audit & System Governance
  | "audit.read"
  | "system.manage"
  // Operational Permissions (Standardized Phase 3-6 naming conventions)
  | "rooms.read"
  | "rooms.manage"
  | "residents.read"
  | "residents.manage"
  | "finance.read"
  | "finance.record"
  | "finance.manage"
  | "tiffin.read"
  | "tiffin.manage"
  | "kitchen.read"
  | "kitchen.manage"
  | "delivery.read"
  | "delivery.manage"
  | "delivery.update";

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditEventInput {
  actorId?: string | null;
  actorUsername?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, any> | null;
  ipAddress?: string | null;
}

export type RoomType = "SINGLE" | "DOUBLE_SHARING" | "TRIPLE_SHARING" | "EXECUTIVE_SUITE";

export interface RoomOccupant {
  residentId: string;
  stayId: string;
  fullName: string;
  phone: string;
  checkInDate: string;
  /** Bed the resident is in (null = not chosen yet, e.g. checked in before beds existed). */
  bedId?: string | null;
  bedLabel?: string | null;
}

/** One bed in a room (migration 0017). */
export interface RoomBed {
  id: string;
  roomId: string;
  label: string;
  status: "IN_SERVICE" | "OUT_OF_SERVICE";
  notes: string | null;
  occupant: { stayId: string; residentId: string; fullName: string } | null;
}

export interface RoomMaintenanceRecord {
  id: string;
  roomId: string;
  reason: string;
  startDate: string;
  endDate: string | null;
  status: "OPEN" | "COMPLETED";
  completionNote: string | null;
  startedByName: string | null;
  completedByName: string | null;
  createdAt: string;
}

export interface RoomWithOccupancy {
  id: string;
  roomNumber: string;
  floor: number;
  type: RoomType;
  capacity: number;
  occupiedBeds: number;
  availableBeds: number;
  baseRentMonthly: number;
  isActive: boolean;
  occupants?: RoomOccupant[];
  /** Individual beds (when migration 0017 is installed). */
  beds?: RoomBed[];
  /** Beds that can be given to a resident (in service; the whole room counts as 0 under maintenance). */
  inServiceBeds?: number;
  /** Open maintenance record, if the room is under maintenance. */
  maintenance?: RoomMaintenanceRecord | null;
  createdAt: string;
  updatedAt: string;
}

export type ResidentStatus = "ACTIVE" | "CHECKED_OUT";

export interface ResidentStayRecord {
  id: string;
  residentId: string;
  roomId: string;
  roomNumber?: string;
  floor?: number;
  checkInDate: string;
  checkOutDate: string | null;
  monthlyRent: number;
  securityDeposit: number;
  status: "ACTIVE" | "COMPLETED";
  createdAt: string;
}

export interface ResidentDetail {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  emergencyContact: string | null;
  notes: string | null;
  status: ResidentStatus;
  currentRoom: {
    roomId: string;
    roomNumber: string;
    floor: number;
    stayId: string;
    checkInDate: string;
    monthlyRent: number;
    securityDeposit: number;
  } | null;
  stays: ResidentStayRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ResidentListItem {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: ResidentStatus;
  currentRoomNumber: string | null;
  currentFloor: number | null;
  checkInDate: string | null;
  totalStayCount?: number;
  completedStayCount?: number;
  createdAt: string;
}

// ----------------------------------------------------------------------------
// RESIDENT ROOM TRANSFER TYPES (Task 01B.54)
// ----------------------------------------------------------------------------

export interface TransferResidentRoomInput {
  residentId: string;
  targetRoomId: string;
  transferDate: string;
  newMonthlyRent?: number;
  reason: string;
  /** Bed in the destination room (optional). */
  bedId?: string | null;
}

export interface ResidentTransferRecord {
  residentId: string;
  residentName: string;
  previousStayId: string;
  previousRoomId: string;
  previousRoomNumber: string;
  previousMonthlyRent: number;
  newStayId: string;
  newRoomId: string;
  newRoomNumber: string;
  newFloor: number;
  newMonthlyRent: number;
  transferDate: string;
  securityDepositCarried: number;
  reason: string;
  transferredAt: string;
}

// ----------------------------------------------------------------------------
// RESIDENT CHECKOUT & SETTLEMENT TYPES (Task 01B.52)
// ----------------------------------------------------------------------------

export interface ResidentSettlementDeduction {
  reason: string;
  amount: number;
}

export interface ResidentSettlementPreview {
  residentId: string;
  residentName: string;
  stayId: string;
  roomId: string;
  roomNumber: string;
  checkInDate: string;
  checkOutDate: string;
  monthlyRent: number;
  totalRentCharged: number;
  totalRentPaid: number;
  outstandingRentDue: number;
  totalDepositHeld: number;
  priorRefunds: number;
  refundableDepositAvailable: number;
  suggestedDepositApplied: number;
  suggestedRefund: number;
  suggestedRemainingPayable: number;
}

export interface FinalizeSettlementInput {
  residentId: string;
  checkOutDate: string;
  deductions?: ResidentSettlementDeduction[];
  depositAppliedAmount?: number;
  refundAmount?: number;
  refundPaymentMethod?: PaymentMethod;
  refundReference?: string;
  remainingPayableAmount?: number;
  paymentMethod?: PaymentMethod;
  paymentReference?: string;
  notes?: string;
  /** Internal: the Owner approving a Manager's settlement proposal (never taken from a request body). */
  approvingProposalId?: string;
  approvalNote?: string;
}

export interface ResidentSettlementRecord {
  id: string;
  residentId: string;
  stayId: string;
  roomId: string;
  roomNumber?: string | null;
  checkoutDate: string;
  outstandingRentAmount: number;
  depositHeldAmount: number;
  deductionsAmount: number;
  deductionsBreakdown: ResidentSettlementDeduction[] | null;
  depositAppliedAmount: number;
  refundAmount: number;
  refundPaymentMethod: PaymentMethod | null;
  refundTransactionId: string | null;
  remainingPayableAmount: number;
  paymentTransactionId: string | null;
  settlementStatus: "SETTLED" | "PENDING_PAYMENT";
  notes: string | null;
  settledBy: string;
  settledByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// PHASE 4: FINANCE, RENT PAYMENTS & CASHBOOK DOMAIN TYPES
// ============================================================================

export type TransactionType =
  | "RENT_CHARGE"
  | "RENT_PAYMENT"
  | "SECURITY_DEPOSIT"
  | "EXPENSE"
  | "REVERSAL"
  | "TIFFIN_CHARGE"
  | "TIFFIN_PAYMENT"
  | "DEPOSIT_REFUND";

export const CANONICAL_PAYMENT_METHODS = [
  "CASH",
  "UPI",
  "BANK_TRANSFER",
  "CHEQUE",
  "OTHER",
] as const;

export type PaymentMethod = (typeof CANONICAL_PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  UPI: "UPI / QR",
  BANK_TRANSFER: "Bank Transfer",
  CHEQUE: "Cheque",
  OTHER: "Card / Other",
};

/**
 * Normalizes input payment method strings or aliases to canonical PaymentMethod enum.
 * Rejects invalid strings with a descriptive validation error.
 */
export function normalizePaymentMethod(input: unknown): PaymentMethod {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Payment method is required. Must be CASH, UPI, BANK_TRANSFER, CHEQUE, or OTHER.");
  }
  const clean = input.trim().toUpperCase().replace(/[\s-]+/g, "_");

  switch (clean) {
    case "CASH":
      return "CASH";
    case "UPI":
    case "ONLINE":
    case "QR":
    case "GPAY":
    case "PHONEPE":
    case "PAYTM":
      return "UPI";
    case "BANK_TRANSFER":
    case "BANK":
    case "NEFT":
    case "RTGS":
    case "IMPS":
    case "TRANSFER":
    case "NET_BANKING":
    case "NETBANKING":
      return "BANK_TRANSFER";
    case "CHEQUE":
    case "CHECK":
      return "CHEQUE";
    case "OTHER":
    case "CARD":
    case "CREDIT_CARD":
    case "DEBIT_CARD":
    case "POS":
      return "OTHER";
    default:
      throw new Error(`Invalid payment method '${input}'. Supported methods: CASH, UPI, BANK_TRANSFER, CHEQUE, OTHER.`);
  }
}

/**
 * Safe version that returns null instead of throwing on invalid input.
 */
export function tryNormalizePaymentMethod(input: unknown): PaymentMethod | null {
  try {
    return normalizePaymentMethod(input);
  } catch {
    return null;
  }
}

/**
 * Formats a payment method code or raw string into user-friendly display text.
 */
export function formatPaymentMethodLabel(method: PaymentMethod | string | null | undefined): string {
  if (!method) return "—";
  const normalized = tryNormalizePaymentMethod(method);
  if (normalized && PAYMENT_METHOD_LABELS[normalized]) {
    return PAYMENT_METHOD_LABELS[normalized];
  }
  return String(method);
}

export type ExpenseCategory =
  | "GROCERY"
  | "UTILITIES"
  | "MAINTENANCE"
  | "STAFF_SALARY"
  | "KITCHEN_SUPPLIES"
  | "INTERNET"
  | "MARKETING"
  | "OTHER";

export type TransactionStatus = "POSTED" | "REVERSED";

export interface FinancialTransaction {
  id: string;
  transactionType: TransactionType;
  amount: number;
  transactionDate: string; // YYYY-MM-DD
  paymentMethod: PaymentMethod | null;
  referenceNumber: string | null;
  residentId: string | null;
  residentName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  stayId: string | null;
  roomNumber?: string | null;
  category: string;
  description: string | null;
  billingPeriod: string | null;
  payeeVendor: string | null;
  idempotencyKey: string | null;
  status: TransactionStatus;
  reversalOfId: string | null;
  invoiceId?: string | null;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResidentFinancialSummary {
  residentId: string;
  fullName: string;
  phone: string;
  status: ResidentStatus;
  currentRoomNumber: string | null;
  totalRentCharges: number;
  totalRentPaid: number;
  outstandingRentBalance: number;
  totalSecurityDepositHeld: number;
  transactions: FinancialTransaction[];
}

export interface CashbookSummary {
  startDate: string;
  endDate: string;
  division?: ClosingDivision;
  totalRentCollected: number;
  totalDepositsCollected: number;
  totalTiffinCollected?: number;
  totalExpensesPaid: number;
  netCashMovement: number;
  totalOutstandingRent: number;
  totalRentBilledInPeriod: number;
  transactionCount: number;
  /** Receipts and refunds of earlier receipts, unfloored (decision D9, option C). */
  breakdown?: {
    rentReceipts: number;
    rentRefunds: number;
    tiffinReceipts: number;
    tiffinRefunds: number;
    expensesPaid: number;
    expenseRefunds: number;
  };
  /** Net cash movement from the unfloored figures; can be negative. */
  netCashMovementExact?: number;
}

// ----------------------------------------------------------------------------
// INVOICING & BILLING ENGINE TYPES (Phase 1)
// ----------------------------------------------------------------------------

export type InvoiceType = "REGULAR_BILL" | "GST_TAX_INVOICE";

export type InvoiceStatus =
  | "DRAFT"
  | "ISSUED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "CANCELLED";

export type InvoiceCategory = "RESIDENT" | "TIFFIN";

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  subscriptionId?: string | null;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
  description: string;
  sacHsnCode: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalItemAmount: number;
  createdAt: string;
}

export interface InvoicePaymentAllocation {
  id: string;
  invoiceId: string;
  paymentTransactionId: string;
  paymentDate?: string | null;
  paymentMethod?: PaymentMethod | null;
  referenceNumber?: string | null;
  amount: number;
  allocatedAt: string;
  allocatedBy: string;
  allocatedByName?: string | null;
  notes: string | null;
  createdAt: string;
  /** The payment was reversed: the allocation is kept as history but no longer counts. */
  paymentReversed?: boolean;
}

export interface Invoice {
  id: string;
  invoiceNumber: string | null;
  invoiceType: InvoiceType;
  invoiceCategory?: InvoiceCategory;
  status: InvoiceStatus;
  residentId: string | null;
  residentName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  subscriptionId?: string | null;
  stayId: string | null;
  roomNumber?: string | null;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  billingPeriod: string;
  subtotal: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  companyName: string;
  companyAddress: string;
  companyGstin: string | null;
  companyStateCode: string;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string | null;
  recipientAddress: string | null;
  recipientGstin: string | null;
  recipientStateCode: string;
  rentChargeId: string | null;
  notes: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
  items?: InvoiceItem[];
  allocations?: InvoicePaymentAllocation[];
}

export interface CreateInvoiceItemInput {
  description: string;
  sacHsnCode?: string | null;
  quantity?: number;
  unitPrice: number;
  taxRate?: number;
  subscriptionId?: string | null;
  serviceStartDate?: string | null;
  serviceEndDate?: string | null;
}

export interface CreateInvoiceInput {
  residentId?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  invoiceCategory?: InvoiceCategory;
  stayId?: string | null;
  invoiceType: InvoiceType;
  issueDate: string;
  dueDate: string;
  billingPeriod: string;
  items: CreateInvoiceItemInput[];
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  recipientAddress?: string | null;
  recipientGstin?: string | null;
  recipientStateCode?: string | null;
  notes?: string | null;
  autoIssue?: boolean;
  linkExistingCharge?: boolean;
  /** One key per invoice-creation operation (stable across retries); migration 0020. */
  idempotencyKey?: string;
}

export interface AllocatePaymentInput {
  invoiceId: string;
  paymentTransactionId: string;
  amount?: number;
  notes?: string | null;
}


// ============================================================================
// PHASE 5: DAILY TIFFIN & KITCHEN OPERATIONS DOMAIN TYPES
// ============================================================================

export type MealType = "BREAKFAST" | "LUNCH" | "DINNER";

export type MealPlanStatus = "DRAFT" | "CONFIRMED" | "COMPLETED";

export type AttendanceStatus = "CONFIRMED" | "OPTED_OUT";

export interface DailyMealPlan {
  id: string;
  serviceDate: string; // YYYY-MM-DD
  mealType: MealType;
  plannedResidentCount: number;
  plannedTiffinCount?: number;
  guestCount: number;
  finalPreparationCount: number;
  actualCookedCount?: number | null;
  dispatchedCount?: number | null;
  leftoverCount?: number | null;
  wasteCount?: number | null;
  status: MealPlanStatus;
  notes: string | null;
  createdBy: string;
  createdByName?: string | null;
  confirmedBy?: string | null;
  confirmedByName?: string | null;
  confirmedAt?: string | null;
  completedBy?: string | null;
  completedByName?: string | null;
  completedAt?: string | null;
  reconciledBy?: string | null;
  reconciledByName?: string | null;
  reconciledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReconcileMealPlanInput {
  actualCookedCount: number;
  dispatchedCount?: number;
  leftoverCount?: number;
  wasteCount?: number;
  notes?: string;
}

export interface SubscriptionMealDemand {
  subscriptionId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerType: string;
  dietaryPreference: string;
  productId: string;
  productName: string;
  mealTypes: string;
  serviceDays: string;
  quantityPerMeal: number;
  deliveryAddress: string;
  deliveryInstructions: string | null;
}

export interface MealDemandSummary {
  mealType: MealType;
  residentDemand: number;
  tiffinDemand: number;
  totalRequired: number;
  subscriptions: SubscriptionMealDemand[];
  residentCount: number;
}

export interface DailyKitchenDemandResult {
  serviceDate: string;
  dayOfWeek: string;
  breakdown: {
    breakfast: MealDemandSummary;
    lunch: MealDemandSummary;
    dinner: MealDemandSummary;
  };
  totalResidents: number;
  totalSubscriptions: number;
  totalPortions: number;
}

export interface ResidentMealRecord {
  id: string;
  planId: string;
  residentId: string;
  residentName: string;
  roomNumber: string | null;
  stayId: string;
  serviceDate: string;
  mealType: MealType;
  status: AttendanceStatus;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MealPlanAdjustment {
  id: string;
  planId: string;
  previousResidentCount: number;
  newResidentCount: number;
  previousGuestCount: number;
  newGuestCount: number;
  previousTotal: number;
  newTotal: number;
  reason: string;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
}

export interface ResidentMealEligibility {
  residentId: string;
  fullName: string;
  phone: string;
  stayId: string;
  roomId: string;
  roomNumber: string;
  floor: number;
  checkInDate: string;
  isEligible: boolean;
  defaultOptIn: boolean;
}

export interface PreparationSheetData {
  plan: DailyMealPlan;
  residentRecords: ResidentMealRecord[];
  adjustments: MealPlanAdjustment[];
  tiffinSubscriptions?: SubscriptionMealDemand[];
  summary: {
    serviceDate: string;
    mealType: MealType;
    eligibleResidentCount: number;
    confirmedResidentCount: number;
    optedOutResidentCount: number;
    tiffinSubscriberCount?: number;
    guestCount: number;
    finalPreparationCount: number;
    actualCookedCount?: number | null;
    dispatchedCount?: number | null;
    leftoverCount?: number | null;
    wasteCount?: number | null;
    status: MealPlanStatus;
    lastUpdatedBy: string | null;
    lastUpdatedAt: string;
  };
}

export interface KitchenDashboardSummary {
  serviceDate: string;
  plans: {
    breakfast: DailyMealPlan | null;
    lunch: DailyMealPlan | null;
    dinner: DailyMealPlan | null;
  };
  metrics: {
    totalMealsPreparedToday: number;
    breakfastCount: number;
    lunchCount: number;
    dinnerCount: number;
    eligibleResidentsCount: number;
    tiffinSubscribersCount?: number;
    tiffinMealsCount?: number;
  };
}

// ============================================================================
// PHASE 6: TIFFIN DELIVERY & HANDOVER DOMAIN TYPES
// ============================================================================

export type DeliveryStatus =
  | "PENDING"
  | "ASSIGNED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "EXCEPTION"
  | "CANCELLED";

export type DeliveryExceptionType =
  | "RESIDENT_UNAVAILABLE"
  | "RESIDENT_DECLINED"
  | "LOCATION_UNCLEAR"
  | "MEAL_DAMAGED_OR_MISSING"
  | "OTHER";

export type DeliveryEventType =
  | "CREATED"
  | "ASSIGNED"
  | "REASSIGNED"
  | "DISPATCHED"
  | "DELIVERED"
  | "EXCEPTION"
  | "RETRIED"
  | "CANCELLED"
  | "RESOLVED"
  | "UPDATED";

/** What happened to an undelivered quantity (migration 0014). */
export type DeliveryDisposition = "RETURNED" | "WITH_STAFF" | "DISCARDED";

/** How a delivery is paid: at the door (one-off order), monthly invoice (subscription), or not charged (resident meal). */
export type DeliveryPaymentMode = "DOORSTEP" | "MONTHLY" | "NONE";

/**
 * One item line of a delivery, whatever its source: an order line (priced, collected at the door)
 * or a delivery task item (subscription/resident meal, no doorstep price).
 */
export interface DeliveryLine {
  lineId: string;
  source: "ORDER" | "TASK";
  productName: string;
  quantity: number;
  /** Saved order price; null for subscription/resident items (no doorstep amount). */
  unitPrice: number | null;
  /** null until the delivery outcome is recorded. */
  deliveredQuantity: number | null;
  undeliveredReason: string | null;
  disposition: DeliveryDisposition | null;
}

export type DeliveryOrderType = "RESIDENT" | "EXTERNAL";

export type DeliveryCollectionStatus = "NONE" | "COLLECTED" | "HANDED_OVER";

export type DriverHandoverStatus = "DECLARED" | "ACCEPTED" | "DISCREPANCY_FLAGGED";

export interface DeliveryTask {
  id: string;
  orderType: DeliveryOrderType;
  mealRecordId?: string | null;
  subscriptionId?: string | null;
  planId: string;
  serviceDate: string; // YYYY-MM-DD
  mealType: MealType;
  residentId?: string | null;
  residentName?: string | null;
  roomNumber?: string | null;
  floor?: number | null;
  stayId?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  invoiceId?: string | null;
  invoiceItemId?: string | null;
  billedAt?: string | null;
  collectionStatus?: DeliveryCollectionStatus;
  collectedAmount?: number;
  collectedPaymentMethod?: PaymentMethod | null;
  collectionTransactionId?: string | null;
  collectionIdempotencyKey?: string | null;
  handoverId?: string | null;
  status: DeliveryStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  dispatchedAt: string | null;
  dispatchedBy: string | null;
  deliveredAt: string | null;
  deliveredBy: string | null;
  deliveryNotes: string | null;
  items?: OrderItem[];
  /** Structured order behind this task (orders/order_items, migration 0012); absent for subscription runs. */
  orderId?: string | null;
  orderLines?: DeliveryOrderLine[];
  /** Order value at the saved prices. */
  orderTotal?: number | null;
  /** Amount due: delivered quantities × saved prices once completed, otherwise the order value. */
  expectedAmount?: number | null;
  /**
   * Still owed on this order. For a customer's delivered order: after the customer's pool of
   * payments is applied oldest first (an earlier advance can cover it); otherwise expectedAmount −
   * collectedAmount (never negative).
   */
  balanceDue?: number | null;
  /** Part of this order paid from the customer's credit (an earlier advance), not at this stop. */
  creditApplied?: number | null;
  /** Migration 0021, doorstep orders: the customer may pay later (a yes/no only; no balances). */
  payLaterAllowed?: boolean;
  /** Migration 0021: what was chosen at the door (null before delivery or for older orders). */
  paymentChoice?: PaymentChoice | null;
  /** Migration 0021: a balance was left without Pay Later approval and awaits a Manager's review. */
  paymentReview?: string | null;
  /**
   * The customer's balance from BEFORE this order (same rule as Finance -> Receivables, this order
   * excluded): earlier delivered orders still owed, open tiffin bills, less advances and unallocated
   * payments. Only these totals reach the delivery app.
   */
  customerBalance?: { previous: number; earlierOrders: number; bills: number; credit: number } | null;
  /** Every item line (order lines or task items); empty for legacy deliveries without lines. */
  lines?: DeliveryLine[];
  paymentMode?: DeliveryPaymentMode;
  /** Customer landmark and standing delivery instructions (read live from the customer record). */
  landmark?: string | null;
  deliveryInstructions?: string | null;
  recipientName: string | null;
  exceptionType: DeliveryExceptionType | null;
  exceptionReason: string | null;
  exceptionAt: string | null;
  exceptionBy: string | null;
  cancelledAt?: string | null;
  cancelledBy?: string | null;
  cancelReason?: string | null;
  /** The cancellation was made after the meal cutoff (Manager override with a reason). */
  cutoffOverride?: boolean;
  /** A Manager closed the follow-up on a partial or undelivered delivery (status unchanged). */
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryOrderLine {
  orderItemId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** null until the delivery outcome is recorded. */
  deliveredQuantity: number | null;
  undeliveredReason: string | null;
  undeliveredDisposition?: DeliveryDisposition | null;
}

/** Per-line outcome submitted when completing a delivery with item lines. */
export interface DeliveryLineOutcome {
  /** Order line id (order-backed deliveries); kept for existing clients and queued actions. */
  orderItemId?: string;
  /** DeliveryLine.lineId (either source). */
  lineId?: string;
  deliveredQuantity: number;
  /** Optional; when sent it must equal ordered − delivered. */
  undeliveredQuantity?: number;
  /** Reason for this line's shortfall (falls back to the delivery-level undeliveredReason). */
  reason?: string;
  /** Where the undelivered quantity went; required for a shortfall once migration 0014 is installed. */
  disposition?: DeliveryDisposition;
}

/** The payment chosen at the door for a delivery order (migration 0021). */
export type PaymentChoice = "CASH" | "UPI" | "PAY_LATER";

export interface CompleteDeliveryTaskInput {
  /** Required for order-backed tasks: one entry per order line. */
  lines?: DeliveryLineOutcome[];
  /** Cash or UPI (the amount in collectedAmount) or Pay Later (nothing collected). */
  paymentChoice?: PaymentChoice;
  /** Whether the phone showed the customer as approved for Pay Later when the choice was made. */
  payLaterAllowedAtSelection?: boolean;
  /** Set by the server for completions replayed from the offline queue (never by the client). */
  viaOfflineSync?: boolean;
  recipientName?: string;
  notes?: string;
  collectedAmount?: number;
  paymentMethod?: PaymentMethod;
  idempotencyKey?: string;
  deliveredQuantity?: number;
  undeliveredQuantity?: number;
  undeliveredReason?: string;
  itemsReconciliation?: ItemReconciliationRecord[];
}

export interface RecordDeliveryCollectionInput {
  collectedAmount: number;
  paymentMethod: PaymentMethod;
  idempotencyKey?: string;
  notes?: string;
}

export interface DriverCashHandover {
  id: string;
  driverId: string;
  driverName?: string | null;
  /** Cash the system had recorded for the collections in this declaration (migration 0022). */
  recordedCash?: number;
  /** recordedCash - declaredCash: cash recorded but not handed over (negative = an earlier shortfall paid back). */
  shortfallCash?: number;
  /** The employee's explanation when handing over less than recorded. */
  shortfallReason?: string | null;
  /** Shortfall the Owner wrote off on this handover, with who, when and why. */
  writtenOffCash?: number;
  writtenOffBy?: string | null;
  writtenOffAt?: string | null;
  writeOffReason?: string | null;
  shiftDate: string; // YYYY-MM-DD
  declaredCash: number;
  acceptedCash: number;
  /** acceptedCash − declaredCash (negative = cash short). */
  variance: number;
  varianceReason: string | null;
  status: DriverHandoverStatus;
  transactionId?: string | null;
  /** UPI/digital collections declared (computed from the linked collections). */
  declaredUpi?: number;
  /** UPI confirmed as received in the business account by the verifier. */
  acceptedUpi?: number;
  upiTransactionId?: string | null;
  /** Staff member who submitted the declaration (the employee, or a manager on their behalf). */
  declaredBy?: string | null;
  declaredByName?: string | null;
  /** Number of collections linked to this declaration. */
  collectionCount?: number;
  acceptedBy?: string | null;
  acceptedByName?: string | null;
  acceptedAt?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeclareCashHandoverInput {
  /** Manager/Owner declaring on an employee's behalf; ignored for delivery staff (always themselves). */
  driverId?: string;
  /** Defaults to today's business date. */
  shiftDate?: string;
  /** Optional: the cash the employee states. The declaration is computed from the recorded
   *  collections; a different figure is rejected (the verifier records any physical difference). */
  declaredCash?: number;
  notes?: string;
}

export interface AcceptCashHandoverInput {
  /** Cash physically counted. */
  acceptedCash: number;
  /** UPI confirmed as received; required when UPI was declared. */
  acceptedUpi?: number;
  /** Required (min 5 characters) when cash or UPI differs from the declaration. */
  varianceReason?: string;
  notes?: string;
  /** Stale-record protection: the declaration the verifier is looking at. */
  expectedDriverId?: string;
  expectedDeclaredCash?: number;
  expectedDeclaredUpi?: number;
}

/** One employee's custody ledger position (all amounts in whole rupees). */
export interface StaffCustodyRow {
  staffId: string;
  staffName: string;
  role: string;
  cashCollected: number;
  upiCollected: number;
  /** Collected, not yet in any declaration. */
  cashUndeclared: number;
  upiUndeclared: number;
  /** In a declaration awaiting verification. */
  cashAwaitingAcceptance: number;
  upiAwaitingAcceptance: number;
  /** Physically received / confirmed by a verifier (accepted and discrepancy-flagged handovers). */
  cashHandedOver: number;
  upiReconciled: number;
  /** Still held by the employee = undeclared + awaiting acceptance. */
  cashPending: number;
  upiPending: number;
  /**
   * Unresolved cash shortage: recorded in handovers but neither handed over (awaiting verification),
   * counted as received, nor written off by the Owner (positive = the employee still owes it).
   */
  cashShort: number;
  /** Cash the employee still has to hand over: undeclared collections + unresolved shortage. */
  cashOwed?: number;
  /** Shortage written off by the Owner (all time). */
  cashWrittenOff?: number;
  upiShort: number;
  pendingHandovers: number;
  discrepancies: number;
  status: "CLEAR" | "HOLDING" | "AWAITING_ACCEPTANCE" | "DISCREPANCY";
}

export interface StaffCustodyCollection {
  id: string;
  deliveryTaskId: string;
  orderId: string | null;
  customerName: string | null;
  serviceDate: string;
  amount: number;
  paymentMethod: string;
  collectedAt: string;
  handoverId: string | null;
  handoverStatus: DriverHandoverStatus | null;
  /** Paid straight into the PG account (UPI): booked at once, never held or handed over. */
  paidToAccount?: boolean;
  source: string;
}

export interface DriverCustodySummary {
  driverId: string;
  driverName: string;
  shiftDate: string;
  totalCashCollected: number;
  totalAcceptedHandover: number;
  cashInCustody: number;
  pendingCollectionTasksCount: number;
  activeDriverCount?: number;
}

export type BusinessOrderType = "DELIVERY" | "DINE_IN";
export type BusinessOrderStatus = "CONFIRMED" | "OUT_FOR_DELIVERY" | "DELIVERED" | "EXCEPTION" | "COMPLETED" | "CANCELLED";

export interface OrderItem {
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Recorded at delivery (structured orders only); null/absent until then. */
  deliveredQuantity?: number | null;
  undeliveredReason?: string | null;
}

export interface UnifiedOrder {
  /** Delivery task id (DELIVERY) or ledger sale id (DINE_IN); kept for existing UI actions. */
  id: string;
  /** orders.id since migration 0012; absent for legacy rows not yet backfilled. */
  orderId?: string;
  orderType: BusinessOrderType;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  serviceDate: string;
  mealType: MealType;
  items: OrderItem[];
  totalQuantity: number;
  totalAmount: number;
  paymentStatus: "PAID" | "PENDING" | "PARTIALLY_PAID";
  paymentMethod?: PaymentMethod | null;
  collectedAmount?: number;
  /** Amount due: delivered quantities × saved prices once the delivery is recorded, else the order total. */
  amountDue?: number;
  remainingAmount?: number;
  /** Delivery outcome once recorded: every item, some items, or nothing delivered. */
  deliveryOutcome?: "FULL" | "PARTIAL" | "NONE" | null;
  orderStatus: BusinessOrderStatus;
  deliveryTaskId?: string | null;
  deliveryStatus?: DeliveryStatus | null;
  assignedTo?: string | null;
  assignedToName?: string | null;
  notes?: string | null;
  /** Times the order was edited (migration 0019). */
  revision?: number;
  cancelReason?: string | null;
  createdAt: string;
}

export interface CreateOrderInput {
  orderType: BusinessOrderType;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  serviceDate: string;
  mealType: MealType;
  items: Array<{
    productId?: string;
    productName: string;
    quantity: number;
    unitPrice: number;
  }>;
  paymentMethod?: PaymentMethod;
  paymentStatus?: "PAID" | "PENDING";
  notes?: string;
  idempotencyKey?: string;
}

export interface ItemReconciliationRecord {
  productName: string;
  orderedQuantity: number;
  deliveredQuantity: number;
  undeliveredQuantity: number;
  undeliveredReason?: string;
  unitPrice: number;
}

export type OfflineQueueActionType = "COMPLETE_DELIVERY" | "REPORT_EXCEPTION" | "RECORD_COLLECTION";

export interface QueuedDeliveryAction {
  id: string;
  action: OfflineQueueActionType;
  taskId: string;
  userId?: string;
  payload: Record<string, any>;
  idempotencyKey: string;
  createdAt: string;
  retryCount: number;
  lastError?: string;
  status: "PENDING" | "SYNCING" | "FAILED" | "CONFLICT" | "COMPLETED" | "AUTH_FAILED";
}

export interface CreateExternalDeliveryTaskInput {
  serviceDate: string;
  mealType: MealType;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  notes?: string;
}

export interface BatchAssignDeliveryTasksInput {
  taskIds: string[];
  assignedToStaffId: string;
}

export interface BatchAssignDeliveryTasksResult {
  assignedCount: number;
  assignedStaffId: string;
  assignedStaffName: string;
  tasks: DeliveryTask[];
}

export interface BatchDispatchDeliveryTasksInput {
  taskIds: string[];
}

export interface BatchDispatchDeliveryTasksResult {
  dispatchedCount: number;
  tasks: DeliveryTask[];
}

export interface ListDeliveryTasksOptions {
  serviceDate?: string;
  mealType?: MealType;
  status?: DeliveryStatus;
  assignedTo?: string;
  orderType?: DeliveryOrderType;
  search?: string;
  limit?: number;
  offset?: number;
}

export type NotificationDomain =
  | "finance"
  | "tiffin"
  | "kitchen"
  | "delivery"
  | "FINANCE"
  | "DELIVERY"
  | "TIFFIN"
  | "KITCHEN"
  | "OCCUPANCY"
  | "SYSTEM";

export type NotificationType =
  | "danger"
  | "warning"
  | "info"
  | "success"
  | "ALERT"
  | "WARNING"
  | "INFO"
  | "SUCCESS";

export interface NotificationItem {
  id: string;
  domain: NotificationDomain;
  type: NotificationType;
  title: string;
  description: string;
  timestamp: string;
  timeAgo?: string;
  href?: string;
  link?: string;
  isRead: boolean;
  metadata?: Record<string, any>;
}

export interface DeliveryTaskEvent {
  id: string;
  taskId: string;
  eventType: DeliveryEventType;
  fromStatus: DeliveryStatus | null;
  toStatus: DeliveryStatus;
  actorId: string;
  actorName: string;
  notes: string | null;
  createdAt: string;
}

export interface DeliveryBatchGenerationResult {
  planId: string;
  serviceDate: string;
  mealType: MealType;
  createdCount: number;
  skippedCount: number;
  alreadyExistedCount: number;
  totalEligible: number;
  tasks: DeliveryTask[];
}

export interface DeliveryDashboardSummary {
  serviceDate: string;
  mealType: MealType | "ALL";
  totalTasks: number;
  pendingCount: number;
  assignedCount: number;
  outForDeliveryCount: number;
  deliveredCount: number;
  exceptionCount: number;
  unassignedCount: number;
  staffWorkload: Array<{
    staffId: string;
    staffName: string;
    assignedCount: number;
    deliveredCount: number;
    pendingCount: number;
    exceptionCount: number;
  }>;
}

// ============================================================================
// PHASE 7: TIFFIN CUSTOMER DIRECTORY & PRICING CATALOG (Task 01B.43)
// ============================================================================

export type CustomerType = "INDIVIDUAL" | "CORPORATE" | "RESIDENTIAL_PG";
export type DietaryPreference = "VEG" | "NON_VEG" | "JAIN";
export type CustomerStatus = "ACTIVE" | "INACTIVE";

export interface TiffinCustomer {
  id: string;
  /** Readable code (TC-0001), migration 0023; null before it. */
  customerCode?: string | null;
  /** Current balance (Receivables rule); included in customer lists. */
  balance?: {
    due: number;
    orders: number;
    bills: number;
    credit: number;
    unpaidOrders: number;
    oldestUnpaid: string | null;
  } | null;
  fullName: string;
  phone: string;
  alternatePhone: string | null;
  deliveryAddress: string;
  landmark: string | null;
  deliveryInstructions: string | null;
  customerType: CustomerType;
  dietaryPreference: DietaryPreference;
  status: CustomerStatus;
  notes: string | null;
  createdBy: string;
  createdByName?: string | null;
  updatedBy: string | null;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTiffinCustomerInput {
  fullName: string;
  phone: string;
  alternatePhone?: string | null;
  deliveryAddress: string;
  landmark?: string | null;
  deliveryInstructions?: string | null;
  customerType?: CustomerType;
  dietaryPreference?: DietaryPreference;
  notes?: string | null;
  confirmDuplicate?: boolean;
}

export interface UpdateTiffinCustomerInput {
  fullName?: string;
  phone?: string;
  alternatePhone?: string | null;
  deliveryAddress?: string;
  landmark?: string | null;
  deliveryInstructions?: string | null;
  customerType?: CustomerType;
  dietaryPreference?: DietaryPreference;
  notes?: string | null;
}

export type ProductCategory =
  | "STANDARD_MEAL"
  | "SUBSCRIPTION_PACKAGE"
  | "EXTRA"
  | "BEVERAGE"
  | "SPECIAL";

export type BillingUnit =
  | "PER_MEAL"
  | "PER_DAY"
  | "PER_MONTH"
  | "PER_PIECE"
  | "PER_PORTION";

export type ProductStatus = "ACTIVE" | "INACTIVE";

export interface TiffinProduct {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: ProductCategory;
  billingUnit: BillingUnit;
  price: number;
  currency: string;
  status: ProductStatus;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTiffinProductInput {
  code: string;
  name: string;
  description?: string | null;
  category: ProductCategory;
  billingUnit: BillingUnit;
  price: number;
  currency?: string;
}

export interface UpdateTiffinProductInput {
  name?: string;
  description?: string | null;
  category?: ProductCategory;
  billingUnit?: BillingUnit;
  price?: number;
}

// ============================================================================
// PHASE 8: TIFFIN SUBSCRIPTION MANAGEMENT & SERVICE SCHEDULING (Task 01B.44)
// ============================================================================

export type SubscriptionStatus = "ACTIVE" | "PAUSED" | "CANCELLED" | "COMPLETED";
export type SubscriptionMealTypes = "LUNCH" | "DINNER" | "BOTH" | "BREAKFAST";
export type SubscriptionServiceDays = "ALL_DAYS" | "MON_SAT" | "MON_FRI";

export interface TiffinSubscription {
  id: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  customerType?: CustomerType;
  dietaryPreference?: DietaryPreference;
  productId: string;
  productCode?: string;
  productName?: string;
  productCategory?: ProductCategory;
  status: SubscriptionStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD
  price: number;
  currency: string;
  mealTypes: SubscriptionMealTypes;
  serviceDays: SubscriptionServiceDays;
  quantityPerMeal: number;
  pauseStartDate: string | null;
  pauseResumeDate: string | null;
  pauseReason: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancelledBy: string | null;
  cancelledByName?: string | null;
  deliveryAddress: string;
  deliveryInstructions: string | null;
  notes: string | null;
  createdBy: string;
  createdByName?: string | null;
  updatedBy: string | null;
  updatedByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTiffinSubscriptionInput {
  customerId: string;
  productId: string;
  startDate: string;
  endDate?: string | null;
  customPrice?: number;
  mealTypes?: SubscriptionMealTypes;
  serviceDays?: SubscriptionServiceDays;
  quantityPerMeal?: number;
  deliveryAddress?: string;
  deliveryInstructions?: string | null;
  notes?: string | null;
}

export interface UpdateTiffinSubscriptionInput {
  endDate?: string | null;
  mealTypes?: SubscriptionMealTypes;
  serviceDays?: SubscriptionServiceDays;
  quantityPerMeal?: number;
  customPrice?: number;
  deliveryAddress?: string;
  deliveryInstructions?: string | null;
  notes?: string | null;
}

export interface PauseTiffinSubscriptionInput {
  pauseStartDate: string;
  pauseResumeDate?: string | null;
  pauseReason?: string | null;
}

export interface CancelTiffinSubscriptionInput {
  cancellationReason?: string | null;
}

// ============================================================================
// PHASE 7: TIFFIN BILLING & INVOICING DOMAIN TYPES (Task 01B.46)
// ============================================================================

export interface TiffinBillingCustomerPreview {
  customerId: string;
  customerName: string;
  phone: string;
  deliveryAddress: string;
  customerType: CustomerType;
  subscriptionId: string;
  subscriptionStatus: SubscriptionStatus;
  productCode: string;
  productName: string;
  billingUnit: BillingUnit;
  unitPrice: number;
  mealTypes: SubscriptionMealTypes;
  serviceDays: SubscriptionServiceDays;
  deliveredCount: number;
  excludedCount: number;
  alreadyBilledCount: number;
  billableQuantity: number;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  existingInvoiceId?: string | null;
  existingInvoiceNumber?: string | null;
  existingInvoiceStatus?: InvoiceStatus | null;
  alreadyBilled: boolean;
  warnings: string[];
  billableTasks: Array<{
    taskId: string;
    serviceDate: string;
    mealType: MealType;
    deliveredAt: string;
    deliveredBy: string | null;
  }>;
}

export interface TiffinBillingPeriodPreview {
  billingPeriod: string;
  startDate: string;
  endDate: string;
  totalEligibleCustomers: number;
  totalBillableDeliveredMeals: number;
  totalProjectedAmount: number;
  alreadyBilledInvoicesCount: number;
  customers: TiffinBillingCustomerPreview[];
}

export interface GenerateTiffinInvoicesInput {
  billingPeriod: string;
  startDate: string;
  endDate: string;
  dueDate: string;
  invoiceType?: InvoiceType;
  autoIssue?: boolean;
  customerIds?: string[];
  notes?: string | null;
}

export interface GenerateTiffinInvoicesResult {
  billingPeriod: string;
  generatedCount: number;
  skippedCount: number;
  invoices: Invoice[];
  skippedDetails: Array<{
    customerId: string;
    customerName: string;
    reason: string;
  }>;
}

export interface RecordTiffinPaymentInput {
  customerId: string;
  amount: number;
  transactionDate: string;
  paymentMethod: PaymentMethod | string;
  referenceNumber?: string | null;
  invoiceId?: string | null;
  notes?: string | null;
  idempotencyKey?: string | null;
}

export interface TiffinCustomerBalanceSummary {
  customerId: string;
  customerName: string;
  phone: string;
  totalCharged: number;
  totalPaid: number;
  outstandingBalance: number;
  unallocatedPaymentAmount: number;
  invoices: Invoice[];
  payments: FinancialTransaction[];
}

// -----------------------------------------------------------------------------
// Kitchen Raw Material Inventory & Recipe Consumption Types (Task 01B.48)
// -----------------------------------------------------------------------------

export type RawMaterialCategory =
  | "GRAINS"
  | "PULSES"
  | "VEGETABLES"
  | "DAIRY"
  | "SPICES"
  | "OILS"
  | "PACKAGING"
  | "OTHER";

export type RawMaterialBaseUnit = "G" | "ML" | "PCS";

export interface KitchenRawMaterial {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: RawMaterialCategory;
  baseUnit: RawMaterialBaseUnit;
  currentStock: number; // in canonical base unit
  reorderThreshold: number; // in canonical base unit
  isActive: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KitchenRecipe {
  id: string;
  name: string;
  description: string | null;
  mealType: MealType | null;
  productId: string | null;
  yieldServings: number;
  version: number;
  isActive: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  ingredients?: KitchenRecipeIngredient[];
}

export interface KitchenRecipeIngredient {
  id: string;
  recipeId: string;
  recipeVersion: number;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  category?: RawMaterialCategory;
  baseUnit?: RawMaterialBaseUnit;
  quantityBase: number; // canonical quantity per yieldServings
  displayUnit: string;
  displayQuantity: number;
  lossPercent: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StockMovementType =
  | "OPENING_BALANCE"
  | "RECEIPT"
  | "ADJUSTMENT_ADD"
  | "ADJUSTMENT_SUB"
  | "PRODUCTION_CONSUMPTION"
  | "PRODUCTION_REVERSAL"
  | "WASTE";

export type StockSourceType = "MANUAL" | "PRODUCTION_PLAN" | "WASTE_REPORT";

export interface KitchenStockMovement {
  id: string;
  materialId: string;
  materialCode?: string;
  materialName?: string;
  movementType: StockMovementType;
  quantityBase: number; // signed quantity in canonical base unit
  unit: string;
  sourceType: StockSourceType;
  sourceId: string | null;
  reason: string;
  actorId: string;
  actorName: string | null;
  createdAt: string;
}

export interface KitchenProductionConsumption {
  id: string;
  planId: string;
  mealType: MealType;
  serviceDate: string;
  recipeId: string;
  recipeName?: string;
  recipeVersion: number;
  producedServings: number;
  status: "POSTED" | "REVERSED";
  notes: string | null;
  postedBy: string;
  postedByName?: string | null;
  postedAt: string;
  reversedBy: string | null;
  reversedByName?: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  movements?: KitchenStockMovement[];
}

export interface ConsumptionPreviewIngredient {
  materialId: string;
  materialCode: string;
  materialName: string;
  category: RawMaterialCategory;
  baseUnit: RawMaterialBaseUnit;
  displayUnit: string;
  quantityPerServingBase: number;
  requiredQuantityBase: number;
  currentStockBase: number;
  isSufficient: boolean;
  shortageBase: number;
}

export interface ProductionConsumptionPreview {
  planId: string;
  serviceDate: string;
  mealType: MealType;
  planStatus: MealPlanStatus;
  actualCookedCount: number;
  recipe: {
    id: string;
    name: string;
    version: number;
    yieldServings: number;
  } | null;
  ingredients: ConsumptionPreviewIngredient[];
  canConfirm: boolean;
  hasShortages: boolean;
  existingConsumption: KitchenProductionConsumption | null;
}

// ============================================================================
// PHASE 10: PREPAID TIFFIN BILLING RECONCILIATION DOMAIN TYPES (TASK 01B.51)
// ============================================================================

export type PrepaidExceptionResolution =
  | "REVIEWED_NO_ACTION"
  | "CREDIT_PENDING_POLICY"
  | "RESOLVED_MANUAL_ADJUSTMENT";

export interface PrepaidBillingExceptionItem {
  taskId: string;
  serviceDate: string;
  mealType: MealType;
  orderType: "EXTERNAL";
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  subscriptionId: string;
  productName: string;
  billingUnit: string;
  agreedPrice: number;
  exceptionType: string | null;
  exceptionReason: string | null;
  exceptionAt: string | null;
  exceptionBy: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: InvoiceStatus | null;
  invoiceTotalAmount: number | null;
  invoiceAmountPaid: number | null;
  isCoveredByPaidInvoice: boolean;
  reconciliationStatus: "PENDING_REVIEW" | "RECONCILED";
  reconciliationResolution: PrepaidExceptionResolution | null;
  reconciliationNotes: string | null;
  reconciledAt: string | null;
  reconciledBy: string | null;
  reconciledByName?: string | null;
  policyNotes?: string;
}

export interface GetPrepaidBillingExceptionsOptions {
  customerId?: string;
  subscriptionId?: string;
  billingPeriod?: string; // YYYY-MM
  startDate?: string;
  endDate?: string;
  status?: "ALL" | "PENDING_REVIEW" | "RECONCILED";
}

export interface PrepaidBillingExceptionsSummary {
  totalExceptionsCount: number;
  pendingReviewCount: number;
  reconciledCount: number;
  coveredByPaidInvoiceCount: number;
  exceptions: PrepaidBillingExceptionItem[];
}

export interface ReconcilePrepaidExceptionInput {
  taskId: string;
  resolution: PrepaidExceptionResolution;
  notes?: string;
}

export interface ReconcilePrepaidExceptionResult {
  taskId: string;
  customerId: string;
  subscriptionId: string;
  resolution: PrepaidExceptionResolution;
  notes: string;
  reconciledAt: string;
  reconciledBy: string;
  reconciledByName: string;
  policyStatement: string;
}

// ============================================================================
// PHASE 12: DAILY CASHBOOK CLOSING & RECONCILIATION DOMAIN TYPES (TASK 01B.53)
// ============================================================================

export type ClosingDivision = "COMBINED" | "PG" | "TIFFIN";
export type ClosingStatus = "DRAFT" | "FINALIZED" | "REOPENED";

export interface ChannelMovementBreakdown {
  channel: PaymentMethod;
  inflow: number;
  outflow: number;
  net: number;
  transactionCount: number;
}

export interface DeliveryReconciliationSummary {
  totalTasks: number;
  residentTasks: number;
  externalTasks: number;
  deliveredCount: number;
  pendingCount: number;
  exceptionCount: number;
}

export interface DailyClosingPreview {
  closingDate: string; // YYYY-MM-DD
  division: ClosingDivision;
  openingBalance: number;
  openingCashBalance: number;
  channelBreakdown: Record<PaymentMethod, ChannelMovementBreakdown>;
  totalInflow: number;
  totalOutflow: number;
  netMovement: number;
  expectedClosingBalance: number;
  expectedCashBalance: number;
  existingClosing: DailyClosingRecord | null;
  hasLateTransactions: boolean;
  lateTransactionCount: number;
  lateTransactionDelta: number;
  deliverySummary: DeliveryReconciliationSummary;
  transactions: Array<{
    id: string;
    transactionType: string;
    amount: number;
    paymentMethod: PaymentMethod | null;
    referenceNumber: string | null;
    category: string;
    description: string | null;
    residentName?: string | null;
    customerName?: string | null;
    roomNumber?: string | null;
    status: string;
    createdAt: string;
  }>;
}

export interface SaveDailyClosingDraftInput {
  closingDate: string;
  division?: ClosingDivision;
  actualCashCounted?: number | null;
  actualBankVerified?: number | null;
  actualTotalBalance?: number | null;
  discrepancyReason?: string | null;
  notes?: string | null;
}

export interface FinalizeDailyClosingInput {
  closingDate: string;
  division?: ClosingDivision;
  actualCashCounted: number;
  actualBankVerified?: number | null;
  discrepancyReason?: string | null;
  notes?: string | null;
}

export interface ReopenDailyClosingInput {
  closingId: string;
  reason: string;
}

export interface DailyClosingRecord {
  id: string;
  closingDate: string;
  division: ClosingDivision;
  openingBalance: number;
  openingCashBalance: number;
  cashInflow: number;
  upiInflow: number;
  bankTransferInflow: number;
  chequeInflow: number;
  otherInflow: number;
  cashOutflow: number;
  upiOutflow: number;
  bankTransferOutflow: number;
  chequeOutflow: number;
  otherOutflow: number;
  totalInflow: number;
  totalOutflow: number;
  expectedClosingBalance: number;
  expectedCashBalance: number;
  actualCashCounted: number | null;
  actualBankVerified: number | null;
  actualTotalBalance: number | null;
  cashDiscrepancy: number;
  totalDiscrepancy: number;
  discrepancyReason: string | null;
  status: ClosingStatus;
  preparedBy: string;
  preparedByName?: string | null;
  finalizedBy: string | null;
  finalizedByName?: string | null;
  finalizedAt: string | null;
  reopenedBy: string | null;
  reopenedByName?: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  notes: string | null;
  snapshotData?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListDailyClosingsFilter {
  startDate?: string;
  endDate?: string;
  division?: ClosingDivision;
  status?: ClosingStatus;
  hasDiscrepancy?: boolean;
}

// ============================================================================
// PHASE 13: BUSINESS VIEWS, FINANCIAL REPORTING & OPERATIONAL RECONCILIATION (TASK 01B.55)
// ============================================================================

export interface DivisionFinancialMetrics {
  division: ClosingDivision;
  totalRevenue: number;
  rentCollected: number;
  depositsCollected: number;
  depositRefunds: number;
  tiffinCollected: number;
  expensesPaid: number;
  netCashMovement: number;
  receivablesBilled: number;
  outstandingReceivables: number;
  transactionCount: number;
}

export interface MultiDivisionFinancialReport {
  startDate: string;
  endDate: string;
  combined: DivisionFinancialMetrics;
  pg: DivisionFinancialMetrics;
  tiffin: DivisionFinancialMetrics;
  channelBreakdown: Record<PaymentMethod, { inflow: number; outflow: number; net: number; count: number }>;
}

export interface InvoiceAgeingItem {
  invoiceId: string;
  invoiceNumber: string;
  category: "RESIDENT" | "TIFFIN";
  recipientId: string;
  recipientName: string;
  roomNumber?: string | null;
  phone?: string | null;
  issueDate: string;
  dueDate: string;
  daysPastDue: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  bucket: "CURRENT" | "1_30" | "31_60" | "61_90" | "90_PLUS";
}

export interface DebtorAgeingSummary {
  recipientId: string;
  recipientName: string;
  category: "RESIDENT" | "TIFFIN";
  roomNumber?: string | null;
  phone?: string | null;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalBalanceDue: number;
  invoiceCount: number;
}

export interface InvoiceAgeingReport {
  asOfDate: string;
  division: ClosingDivision;
  totalOutstanding: number;
  totalInvoices: number;
  buckets: {
    current: { amount: number; count: number };
    days1To30: { amount: number; count: number };
    days31To60: { amount: number; count: number };
    days61To90: { amount: number; count: number };
    days90Plus: { amount: number; count: number };
  };
  debtors: DebtorAgeingSummary[];
  invoices: InvoiceAgeingItem[];
}

export interface KitchenReconciliationSummary {
  totalPlannedPortions: number;
  plannedResidentCount: number;
  plannedTiffinCount: number;
  actualCookedCount: number;
  dispatchedCount: number;
  leftoverCount: number;
  wasteCount: number;
  byMealType: {
    breakfast: { planned: number; cooked: number; dispatched: number; leftovers: number; waste: number };
    lunch: { planned: number; cooked: number; dispatched: number; leftovers: number; waste: number };
    dinner: { planned: number; cooked: number; dispatched: number; leftovers: number; waste: number };
  };
}

export interface InventoryReconciliationSummary {
  totalConsumptionMovements: number;
  totalWastageMovements: number;
  totalReceiptMovements: number;
  totalAdjustmentMovements: number;
  wasteCostInr: number;
  consumptionCostInr: number;
  topConsumedMaterials: Array<{ materialId: string; materialName: string; quantity: number; unit: string }>;
  topWastedMaterials: Array<{ materialId: string; materialName: string; quantity: number; unit: string; costInr: number }>;
}

export interface DeliveryReconciliationReportSummary {
  totalTasks: number;
  residentTasks: number;
  externalTasks: number;
  deliveredCount: number;
  outForDeliveryCount: number;
  assignedCount: number;
  pendingCount: number;
  exceptionCount: number;
  completionRate: number;
}

export interface OperationalReconciliationReport {
  startDate: string;
  endDate: string;
  division: ClosingDivision;
  kitchen: KitchenReconciliationSummary;
  inventory: InventoryReconciliationSummary;
  delivery: DeliveryReconciliationReportSummary;
}

export interface RoomCapacityAuditDetail {
  roomId: string;
  roomNumber: string;
  floor: number;
  type: string;
  capacity: number;
  occupiedBeds: number;
  availableBeds: number;
  isActive: boolean;
  statusNotes: string;
  occupants: Array<{ residentId: string; residentName: string; checkInDate: string }>;
}

export interface PropertyCapacityAuditReport {
  totalRooms: number;
  activeRooms: number;
  confirmedPhysicalBeds: number; // Exactly 39 confirmed beds per physical survey
  provisionedCapacity: number;   // 41 beds (includes 2 in M01 pending owner confirmation)
  unconfirmedBeds: number;       // 2 beds in M01 flagged as pending confirmation
  totalOccupiedBeds: number;
  totalVacantBeds: number;
  occupancyRate: number;
  masterSuiteStatus: {
    roomNumber: string;
    provisionedCapacity: number;
    physicalSurveyRange: string;
    status: string;
    currentOccupancy: number;
  };
  rooms: RoomCapacityAuditDetail[];
}

// -----------------------------------------------------------------------------
// Document Management & KYC Attachments (Task 01B.57)
// -----------------------------------------------------------------------------

export type DocumentCategory =
  | "RESIDENT_KYC"
  | "RESIDENT_ADDRESS_PROOF"
  | "RENT_RECEIPT"
  | "SECURITY_DEPOSIT_RECEIPT"
  | "CHECKOUT_SETTLEMENT_RECEIPT"
  | "EXPENSE_RECEIPT"
  | "OPERATIONAL_ATTACHMENT";

export type DocumentStatus = "ACTIVE" | "SUPERSEDED" | "ARCHIVED";

export interface DocumentAttachment {
  id: string;
  category: DocumentCategory;
  residentId: string | null;
  stayId: string | null;
  transactionId: string | null;
  invoiceId: string | null;
  settlementId: string | null;
  displayFilename: string;
  mimeType: string;
  fileSize: number;
  fileHash: string;
  storagePath: string;
  status: DocumentStatus;
  supersededBy: string | null;
  notes: string | null;
  uploadedBy: string;
  uploadedByName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UploadDocumentInput {
  category: DocumentCategory;
  residentId?: string;
  stayId?: string;
  transactionId?: string;
  invoiceId?: string;
  settlementId?: string;
  notes?: string;
  originalFilename: string;
  fileBuffer: Buffer;
  clientMimeType?: string;
}

export interface DocumentListFilter {
  category?: DocumentCategory;
  residentId?: string;
  stayId?: string;
  transactionId?: string;
  invoiceId?: string;
  settlementId?: string;
  status?: DocumentStatus;
}

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  RESIDENT_KYC: "Resident Identity (KYC)",
  RESIDENT_ADDRESS_PROOF: "Address Proof",
  RENT_RECEIPT: "Rent Payment Receipt",
  SECURITY_DEPOSIT_RECEIPT: "Security Deposit Receipt",
  CHECKOUT_SETTLEMENT_RECEIPT: "Checkout Settlement Slip",
  EXPENSE_RECEIPT: "Expense Invoice / Bill",
  OPERATIONAL_ATTACHMENT: "Operational Attachment",
};

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type AllowedDocumentMimeType = typeof ALLOWED_DOCUMENT_MIME_TYPES[number];

export const MAX_DOCUMENT_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB









// ============================================================================
// DELIVERY OPERATIONS (round 11, migration 0014): delivery lists, overrides, close-out
// ============================================================================

export interface DeliveryManifestStatus {
  /** Migration 0014 installed; when false, list preparation and overrides are switched off. */
  schemaReady: boolean;
  serviceDate: string;
  mealType: MealType;
  /** Automatic preparation time and cancellation cutoff (HH:MM, IST); null for meals without one. */
  prepareAt: string | null;
  cutoffAt: string | null;
  pastCutoff: boolean;
  /** Not prepared yet and its time has come (the page prepares it on open). */
  due: boolean;
  prepared: boolean;
  preparedAt: string | null;
  preparedByName: string | null;
  trigger: "AUTO" | "MANUAL" | null;
  lastRunAt: string | null;
  lastRunByName: string | null;
  /** Deliveries for this date and meal (excluding cancelled) and how many have nobody assigned. */
  taskCount: number;
  unassignedCount: number;
}

export interface DeliveryManifestRunResult {
  ran: boolean;
  /** Why an automatic run did nothing. */
  reason?: "NOT_DUE" | "ALREADY_PREPARED";
  created: number;
  alreadyExisted: number;
  /** Skipped for today (subscription skip, resident opted out). */
  skipped: number;
  autoAssigned: number;
  unassigned: number;
  status: DeliveryManifestStatus;
}

export type DayOverrideAction = "SKIP" | "EXTRA" | "CLEAR";

export interface SubscriptionDayRow {
  subscriptionId: string;
  customerName: string;
  customerPhone: string | null;
  productName: string;
  subscriptionStatus: string;
  quantityPerMeal: number;
  eligible: boolean;
  ineligibleReason: string | null;
  override: { action: "SKIP" | "EXTRA"; quantity: number | null; reason: string | null; afterCutoff: boolean } | null;
  /** Boxes for this meal after today's override (0 when skipped or not eligible). */
  effectiveQuantity: number;
  task: { id: string; status: DeliveryStatus; assignedToName: string | null; quantity: number | null } | null;
}

export interface ResidentMealDeliveryRow {
  residentId: string;
  residentName: string;
  roomNumber: string | null;
  floor: number | null;
  lunchRoomDelivery: boolean;
  dinnerRoomDelivery: boolean;
  /** Standing opt-in for the selected meal. */
  optedIn: boolean;
  /** Today's arrangement for the selected meal. */
  today: "ROOM_DELIVERY" | "AT_PG" | "SKIPPED" | "NOT_EATING";
  task: { id: string; status: DeliveryStatus } | null;
}

export interface DeliveryDayListing<T> {
  serviceDate: string;
  mealType: MealType;
  schemaReady: boolean;
  pastCutoff: boolean;
  cutoffAt: string | null;
  rows: T[];
}

export interface DeliveryShortfallRow {
  taskId: string;
  customerName: string;
  roomNumber: string | null;
  productName: string;
  ordered: number;
  delivered: number;
  undelivered: number;
  reason: string | null;
  disposition: DeliveryDisposition | null;
  staffName: string | null;
  resolved: boolean;
}

export interface DeliveryCloseout {
  serviceDate: string;
  mealType: MealType | "ALL";
  summary: import("@/lib/delivery/outcome").DeliveryDaySummary;
  items: Array<{ productName: string; ordered: number; delivered: number; undelivered: number; returned: number; withStaff: number; discarded: number; unrecorded: number }>;
  shortfalls: DeliveryShortfallRow[];
  cancelled: Array<{ taskId: string; customerName: string; reason: string | null; cutoffOverride: boolean; cancelledAt: string | null }>;
  /** Money collected for this day's deliveries, per staff member and method, with handover state. */
  collections: Array<{ staffId: string; staffName: string; cash: number; upi: number; undeclared: number; awaitingAcceptance: number; handedOver: number }>;
  /** Handovers accepted on this date (the cashbook date), with any discrepancy. */
  handovers: Array<{ id: string; staffName: string; declaredCash: number; declaredUpi: number; acceptedCash: number; acceptedUpi: number; status: DriverHandoverStatus; varianceReason: string | null; acceptedByName: string | null }>;
}

export interface DeliveryHistoryDay {
  serviceDate: string;
  mealType: MealType;
  total: number;
  delivered: number;
  partial: number;
  notDelivered: number;
  open: number;
  cancelled: number;
}

// ============================================================================
// SELF-SERVICE ACCOUNT (profile, password, email)
// ============================================================================

export interface MyAccount {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: StaffRole;
  memberSince: string;
  lastSignIn: string | null;
  /** Other signed-in devices (this one excluded). */
  otherSessions: number;
  /** Signed-in devices, this one first; never includes the session token. */
  devices: Array<{ id: string; label: string; current: boolean; signedInAt: string }>;
  /** Work summary (delivery staff). */
  summary: {
    monthLabel: string;
    stopsThisMonth: number;
    deliveredThisMonth: number;
    /** Delivered in full out of the stops finished this month (%). */
    deliveredRate: number | null;
    todayDone: number;
    todayStops: number;
    cashHandedOverThisMonth: number;
    handoversThisMonth: number;
    cashWithYou: number;
  } | null;
}
