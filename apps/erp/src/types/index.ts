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

export const ROLE_LABELS: Record<StaffRole, string> = {
  SUPER_ADMIN: "Owner",
  OPERATIONS_MANAGER: "Operations Manager",
  ACCOUNTANT: "Accountant / Office Staff",
  KITCHEN_OPERATIONS: "Kitchen / Tiffin Operations",
  DELIVERY_PERSON: "Delivery Person",
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

// ============================================================================
// PHASE 4: FINANCE, RENT PAYMENTS & CASHBOOK DOMAIN TYPES
// ============================================================================

export type TransactionType =
  | "RENT_CHARGE"
  | "RENT_PAYMENT"
  | "SECURITY_DEPOSIT"
  | "EXPENSE"
  | "REVERSAL";

export type PaymentMethod =
  | "CASH"
  | "UPI"
  | "BANK_TRANSFER"
  | "CHEQUE"
  | "OTHER";

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
  stayId: string | null;
  roomNumber?: string | null;
  category: string;
  description: string | null;
  billingPeriod: string | null;
  payeeVendor: string | null;
  idempotencyKey: string | null;
  status: TransactionStatus;
  reversalOfId: string | null;
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
  totalRentCollected: number;
  totalDepositsCollected: number;
  totalExpensesPaid: number;
  netCashMovement: number;
  totalOutstandingRent: number;
  totalRentBilledInPeriod: number;
  transactionCount: number;
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
  guestCount: number;
  finalPreparationCount: number;
  actualCookedCount?: number | null;
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
  createdAt: string;
  updatedAt: string;
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
  summary: {
    serviceDate: string;
    mealType: MealType;
    eligibleResidentCount: number;
    confirmedResidentCount: number;
    optedOutResidentCount: number;
    guestCount: number;
    finalPreparationCount: number;
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
  | "EXCEPTION";

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
  | "RETRIED";

export type DeliveryOrderType = "RESIDENT" | "EXTERNAL";

export interface DeliveryTask {
  id: string;
  orderType: DeliveryOrderType;
  mealRecordId?: string | null;
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
  recipientName: string | null;
  exceptionType: DeliveryExceptionType | null;
  exceptionReason: string | null;
  exceptionAt: string | null;
  exceptionBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExternalDeliveryTaskInput {
  serviceDate: string;
  mealType: MealType;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  notes?: string;
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

