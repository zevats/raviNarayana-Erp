import {
  pgTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// -----------------------------------------------------------------------------
// 1. Staff Users
// -----------------------------------------------------------------------------
export const staffUsers = pgTable(
  "staff_users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    isActive: integer("is_active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastLoginAt: text("last_login_at"),
  },
  (table) => [
    uniqueIndex("idx_staff_username_lower").on(sql`lower(${table.username})`),
    uniqueIndex("idx_staff_email_lower").on(sql`lower(${table.email})`),
    index("idx_staff_users_role").on(table.role),
    index("idx_staff_users_active").on(table.isActive),
  ]
);

// -----------------------------------------------------------------------------
// 2. Sessions (Hashed at rest)
// -----------------------------------------------------------------------------
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").unique().notNull(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("idx_sessions_token_hash").on(table.tokenHash),
    index("idx_sessions_expires").on(table.expiresAt),
    index("idx_sessions_staff").on(table.staffId),
  ]
);

// -----------------------------------------------------------------------------
// 3. Login Attempts (Layered Rate Limiting)
// -----------------------------------------------------------------------------
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    ipAddress: text("ip_address").notNull(),
    attemptedAt: text("attempted_at").notNull(),
    success: integer("success").notNull(),
  },
  (table) => [
    index("idx_login_attempts_ip").on(table.ipAddress, table.attemptedAt),
    index("idx_login_attempts_ident_ip").on(table.identifier, table.ipAddress, table.attemptedAt),
    index("idx_login_attempts_ident").on(table.identifier, table.attemptedAt),
  ]
);

// -----------------------------------------------------------------------------
// 4. Audit Logs (Tamper-Evident History)
// -----------------------------------------------------------------------------
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id"),
    actorUsername: text("actor_username"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: text("metadata"),
    ipAddress: text("ip_address"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_audit_logs_created").on(table.createdAt),
    index("idx_audit_logs_action").on(table.action),
    index("idx_audit_logs_actor").on(table.actorId),
    index("idx_audit_logs_target").on(table.targetType, table.targetId),
  ]
);

// -----------------------------------------------------------------------------
// 5. Rooms (Case-insensitive room numbers, capacity > 0, base_rent >= 0)
// -----------------------------------------------------------------------------
export const rooms = pgTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    roomNumber: text("room_number").notNull(),
    floor: integer("floor").notNull(),
    type: text("type").notNull(),
    capacity: integer("capacity").notNull(),
    baseRentMonthly: integer("base_rent_monthly").notNull(),
    isActive: integer("is_active").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_rooms_number_nocase").on(sql`lower(${table.roomNumber})`),
    index("idx_rooms_number").on(table.roomNumber),
    index("idx_rooms_floor").on(table.floor),
    index("idx_rooms_active").on(table.isActive),
    check("chk_rooms_capacity", sql`${table.capacity} > 0`),
    check("chk_rooms_base_rent", sql`${table.baseRentMonthly} >= 0`),
  ]
);

// -----------------------------------------------------------------------------
// 6. Residents
// -----------------------------------------------------------------------------
export const residents = pgTable(
  "residents",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    phone: text("phone").unique().notNull(),
    email: text("email"),
    emergencyContact: text("emergency_contact"),
    notes: text("notes"),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_residents_phone").on(table.phone),
    index("idx_residents_status").on(table.status),
  ]
);

// -----------------------------------------------------------------------------
// 7. Resident Stays (Partial Unique Index: at most 1 active stay per resident)
// -----------------------------------------------------------------------------
export const residentStays = pgTable(
  "resident_stays",
  {
    id: text("id").primaryKey(),
    residentId: text("resident_id")
      .notNull()
      .references(() => residents.id, { onDelete: "restrict" }),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "restrict" }),
    checkInDate: text("check_in_date").notNull(),
    checkOutDate: text("check_out_date"),
    monthlyRent: integer("monthly_rent").notNull(),
    securityDeposit: integer("security_deposit").notNull().default(0),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_stays_resident_id").on(table.residentId),
    index("idx_stays_room_id").on(table.roomId),
    index("idx_stays_status").on(table.status),
    index("idx_stays_room_active").on(table.roomId, table.status),
    uniqueIndex("idx_unique_active_resident_stay")
      .on(table.residentId)
      .where(sql`${table.status} = 'ACTIVE'`),
    check("chk_stays_monthly_rent", sql`${table.monthlyRent} >= 0`),
    check("chk_stays_security_deposit", sql`${table.securityDeposit} >= 0`),
  ]
);

// -----------------------------------------------------------------------------
// 8. Financial Transactions (Ledger Invariants, whole INR, Idempotency)
// -----------------------------------------------------------------------------
export const financialTransactions = pgTable(
  "financial_transactions",
  {
    id: text("id").primaryKey(),
    transactionType: text("transaction_type").notNull(),
    amount: integer("amount").notNull(),
    transactionDate: text("transaction_date").notNull(),
    paymentMethod: text("payment_method"),
    referenceNumber: text("reference_number"),
    residentId: text("resident_id").references(() => residents.id, { onDelete: "restrict" }),
    customerId: text("customer_id").references(() => tiffinCustomers.id, { onDelete: "restrict" }),
    stayId: text("stay_id").references(() => residentStays.id, { onDelete: "restrict" }),
    category: text("category").notNull(),
    description: text("description"),
    billingPeriod: text("billing_period"),
    payeeVendor: text("payee_vendor"),
    idempotencyKey: text("idempotency_key").unique(),
    status: text("status").notNull().default("POSTED"),
    reversalOfId: text("reversal_of_id"),
    invoiceId: text("invoice_id"),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_fin_tx_type").on(table.transactionType),
    index("idx_fin_tx_date").on(table.transactionDate),
    index("idx_fin_tx_resident").on(table.residentId),
    index("idx_fin_tx_customer").on(table.customerId),
    index("idx_fin_tx_stay").on(table.stayId),
    index("idx_fin_tx_category").on(table.category),
    index("idx_fin_tx_status").on(table.status),
    index("idx_fin_tx_invoice").on(table.invoiceId),
    uniqueIndex("idx_fin_tx_idempotency").on(table.idempotencyKey),
    check(
      "chk_fin_tx_type",
      sql`${table.transactionType} IN ('RENT_CHARGE', 'RENT_PAYMENT', 'SECURITY_DEPOSIT', 'EXPENSE', 'REVERSAL', 'TIFFIN_CHARGE', 'TIFFIN_PAYMENT', 'DEPOSIT_REFUND')`
    ),
    check("chk_fin_tx_amount", sql`${table.amount} > 0`),
    check(
      "chk_fin_tx_status",
      sql`${table.status} IN ('POSTED', 'REVERSED')`
    ),
    check(
      "chk_fin_tx_payment_method",
      sql`${table.paymentMethod} IS NULL OR ${table.paymentMethod} IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER')`
    ),
  ]
);

// -----------------------------------------------------------------------------
// 9. Resident Meal Preferences
// -----------------------------------------------------------------------------
export const residentMealPreferences = pgTable(
  "resident_meal_preferences",
  {
    residentId: text("resident_id")
      .primaryKey()
      .references(() => residents.id, { onDelete: "restrict" }),
    breakfastOptIn: integer("breakfast_opt_in").notNull().default(1),
    lunchOptIn: integer("lunch_opt_in").notNull().default(1),
    dinnerOptIn: integer("dinner_opt_in").notNull().default(1),
    dietaryPreference: text("dietary_preference").notNull().default("VEG"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("chk_meal_pref_b", sql`${table.breakfastOptIn} IN (0, 1)`),
    check("chk_meal_pref_l", sql`${table.lunchOptIn} IN (0, 1)`),
    check("chk_meal_pref_d", sql`${table.dinnerOptIn} IN (0, 1)`),
  ]
);

// -----------------------------------------------------------------------------
// 10. Daily Meal Plans
// -----------------------------------------------------------------------------
export const dailyMealPlans = pgTable(
  "daily_meal_plans",
  {
    id: text("id").primaryKey(),
    serviceDate: text("service_date").notNull(),
    mealType: text("meal_type").notNull(),
    plannedResidentCount: integer("planned_resident_count").notNull().default(0),
    plannedTiffinCount: integer("planned_tiffin_count").notNull().default(0),
    guestCount: integer("guest_count").notNull().default(0),
    finalPreparationCount: integer("final_preparation_count").notNull().default(0),
    actualCookedCount: integer("actual_cooked_count"),
    dispatchedCount: integer("dispatched_count").default(0),
    leftoverCount: integer("leftover_count").default(0),
    wasteCount: integer("waste_count").default(0),
    status: text("status").notNull().default("DRAFT"),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    confirmedBy: text("confirmed_by").references(() => staffUsers.id),
    confirmedAt: text("confirmed_at"),
    completedBy: text("completed_by").references(() => staffUsers.id),
    completedAt: text("completed_at"),
    reconciledBy: text("reconciled_by").references(() => staffUsers.id),
    reconciledAt: text("reconciled_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_plan_date_meal").on(table.serviceDate, table.mealType),
    index("idx_meal_plans_date").on(table.serviceDate),
    index("idx_meal_plans_status").on(table.status),
    index("idx_meal_plans_date_meal").on(table.serviceDate, table.mealType),
    check("chk_meal_plan_type", sql`${table.mealType} IN ('BREAKFAST', 'LUNCH', 'DINNER')`),
    check("chk_meal_plan_status", sql`${table.status} IN ('DRAFT', 'CONFIRMED', 'COMPLETED')`),
    check("chk_plan_res_cnt", sql`${table.plannedResidentCount} >= 0`),
    check("chk_plan_tif_cnt", sql`${table.plannedTiffinCount} >= 0`),
    check("chk_plan_guest_cnt", sql`${table.guestCount} >= 0`),
    check("chk_plan_prep_cnt", sql`${table.finalPreparationCount} >= 0`),
    check("chk_plan_act_cook", sql`${table.actualCookedCount} IS NULL OR ${table.actualCookedCount} >= 0`),
    check("chk_plan_disp_cnt", sql`${table.dispatchedCount} IS NULL OR ${table.dispatchedCount} >= 0`),
    check("chk_plan_left_cnt", sql`${table.leftoverCount} IS NULL OR ${table.leftoverCount} >= 0`),
    check("chk_plan_waste_cnt", sql`${table.wasteCount} IS NULL OR ${table.wasteCount} >= 0`),
  ]
);

// -----------------------------------------------------------------------------
// 11. Resident Meal Records (Attendance)
// -----------------------------------------------------------------------------
export const residentMealRecords = pgTable(
  "resident_meal_records",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => dailyMealPlans.id, { onDelete: "restrict" }),
    residentId: text("resident_id")
      .notNull()
      .references(() => residents.id, { onDelete: "restrict" }),
    stayId: text("stay_id")
      .notNull()
      .references(() => residentStays.id, { onDelete: "restrict" }),
    serviceDate: text("service_date").notNull(),
    mealType: text("meal_type").notNull(),
    status: text("status").notNull().default("CONFIRMED"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uq_res_date_meal").on(table.residentId, table.serviceDate, table.mealType),
    index("idx_res_meal_plan").on(table.planId),
    index("idx_res_meal_resident").on(table.residentId),
    index("idx_res_meal_stay").on(table.stayId),
    index("idx_res_meal_date").on(table.serviceDate),
    index("idx_res_meal_status").on(table.status),
    check("chk_res_meal_type", sql`${table.mealType} IN ('BREAKFAST', 'LUNCH', 'DINNER')`),
    check("chk_res_meal_status", sql`${table.status} IN ('CONFIRMED', 'OPTED_OUT')`),
  ]
);

// -----------------------------------------------------------------------------
// 12. Meal Plan Adjustments (Append-only)
// -----------------------------------------------------------------------------
export const mealPlanAdjustments = pgTable(
  "meal_plan_adjustments",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => dailyMealPlans.id, { onDelete: "restrict" }),
    previousResidentCount: integer("previous_resident_count").notNull(),
    newResidentCount: integer("new_resident_count").notNull(),
    previousGuestCount: integer("previous_guest_count").notNull(),
    newGuestCount: integer("new_guest_count").notNull(),
    previousTotal: integer("previous_total").notNull(),
    newTotal: integer("new_total").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_meal_adj_plan").on(table.planId),
    index("idx_meal_adj_date").on(table.createdAt),
    check("chk_adj_prev_res", sql`${table.previousResidentCount} >= 0`),
    check("chk_adj_new_res", sql`${table.newResidentCount} >= 0`),
    check("chk_adj_prev_gst", sql`${table.previousGuestCount} >= 0`),
    check("chk_adj_new_gst", sql`${table.newGuestCount} >= 0`),
    check("chk_adj_prev_tot", sql`${table.previousTotal} >= 0`),
    check("chk_adj_new_tot", sql`${table.newTotal} >= 0`),
  ]
);

// -----------------------------------------------------------------------------
// 13. Delivery Tasks (Resident & External, Delivery State Machine)
// -----------------------------------------------------------------------------
export const deliveryTasks = pgTable(
  "delivery_tasks",
  {
    id: text("id").primaryKey(),
    orderType: text("order_type").notNull().default("RESIDENT"),
    mealRecordId: text("meal_record_id")
      .unique()
      .references(() => residentMealRecords.id, { onDelete: "restrict" }),
    subscriptionId: text("subscription_id").references(() => tiffinSubscriptions.id, { onDelete: "set null" }),
    planId: text("plan_id")
      .notNull()
      .references(() => dailyMealPlans.id, { onDelete: "restrict" }),
    serviceDate: text("service_date").notNull(),
    mealType: text("meal_type").notNull(),
    residentId: text("resident_id").references(() => residents.id, { onDelete: "restrict" }),
    residentName: text("resident_name"),
    roomNumber: text("room_number"),
    floor: integer("floor"),
    stayId: text("stay_id").references(() => residentStays.id, { onDelete: "restrict" }),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    deliveryAddress: text("delivery_address"),
    status: text("status").notNull().default("PENDING"),
    assignedTo: text("assigned_to").references(() => staffUsers.id, { onDelete: "set null" }),
    assignedToName: text("assigned_to_name"),
    assignedBy: text("assigned_by").references(() => staffUsers.id, { onDelete: "set null" }),
    assignedAt: text("assigned_at"),
    dispatchedAt: text("dispatched_at"),
    dispatchedBy: text("dispatched_by").references(() => staffUsers.id, { onDelete: "set null" }),
    deliveredAt: text("delivered_at"),
    deliveredBy: text("delivered_by").references(() => staffUsers.id, { onDelete: "set null" }),
    deliveryNotes: text("delivery_notes"),
    recipientName: text("recipient_name"),
    invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    invoiceItemId: text("invoice_item_id").references(() => invoiceItems.id, { onDelete: "set null" }),
    billedAt: text("billed_at"),
    collectionStatus: text("collection_status").notNull().default("NONE"),
    collectedAmount: integer("collected_amount").notNull().default(0),
    collectedPaymentMethod: text("collected_payment_method"),
    collectionTransactionId: text("collection_transaction_id"),
    collectionIdempotencyKey: text("collection_idempotency_key").unique(),
    handoverId: text("handover_id"),
    exceptionType: text("exception_type"),
    exceptionReason: text("exception_reason"),
    exceptionAt: text("exception_at"),
    exceptionBy: text("exception_by").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_del_tasks_date").on(table.serviceDate),
    index("idx_del_tasks_date_meal").on(table.serviceDate, table.mealType),
    index("idx_del_tasks_status").on(table.status),
    index("idx_del_tasks_assigned_to").on(table.assignedTo),
    index("idx_del_tasks_plan").on(table.planId),
    index("idx_del_tasks_resident").on(table.residentId),
    index("idx_del_tasks_order_type").on(table.orderType),
    index("idx_del_tasks_sub").on(table.subscriptionId),
    index("idx_del_tasks_inv").on(table.invoiceId),
    index("idx_del_tasks_collection_status").on(table.collectionStatus),
    index("idx_del_tasks_handover").on(table.handoverId),
    uniqueIndex("idx_del_tasks_coll_idempotency").on(table.collectionIdempotencyKey),
    check("chk_del_order_type", sql`${table.orderType} IN ('RESIDENT', 'EXTERNAL')`),
    check("chk_del_meal_type", sql`${table.mealType} IN ('BREAKFAST', 'LUNCH', 'DINNER')`),
    check(
      "chk_del_status",
      sql`${table.status} IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')`
    ),
    check(
      "chk_del_collection_status",
      sql`${table.collectionStatus} IN ('NONE', 'COLLECTED', 'HANDED_OVER')`
    ),
    check("chk_del_collected_amount", sql`${table.collectedAmount} >= 0`),
    check(
      "chk_del_exc_type",
      sql`${table.exceptionType} IS NULL OR ${table.exceptionType} IN ('RESIDENT_UNAVAILABLE', 'RESIDENT_DECLINED', 'LOCATION_UNCLEAR', 'MEAL_DAMAGED_OR_MISSING', 'OTHER')`
    ),
  ]
);

// -----------------------------------------------------------------------------
// 14. Delivery Task Events (Timeline history)
// -----------------------------------------------------------------------------
export const deliveryTaskEvents = pgTable(
  "delivery_task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => deliveryTasks.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => staffUsers.id),
    actorName: text("actor_name").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_del_events_task").on(table.taskId),
    index("idx_del_events_created").on(table.createdAt),
    check(
      "chk_del_evt_type",
      sql`${table.eventType} IN ('CREATED', 'ASSIGNED', 'REASSIGNED', 'DISPATCHED', 'DELIVERED', 'EXCEPTION', 'RETRIED')`
    ),
  ]
);

// -----------------------------------------------------------------------------
// 15. Staff Notification Reads (Cross-device unread tracking)
// -----------------------------------------------------------------------------
export const staffNotificationReads = pgTable(
  "staff_notification_reads",
  {
    staffId: text("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    notificationId: text("notification_id").notNull(),
    readAt: text("read_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.staffId, table.notificationId] }),
    index("idx_notif_reads_staff").on(table.staffId),
  ]
);

// -----------------------------------------------------------------------------
// 16. Auth Challenges (Email OTP, 10m expiry, max 3 attempts)
// -----------------------------------------------------------------------------
export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: text("id").primaryKey(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    otpHash: text("otp_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_auth_challenges_staff").on(table.staffId),
    index("idx_auth_challenges_expires").on(table.expiresAt),
    check("chk_auth_chal_attempts", sql`${table.attempts} >= 0`),
  ]
);

// -----------------------------------------------------------------------------
// 17. Password Resets (1h expiry, single-use, session wipe)
// -----------------------------------------------------------------------------
export const passwordResets = pgTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").unique().notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_password_resets_token").on(table.tokenHash),
    index("idx_password_resets_staff").on(table.staffId),
    index("idx_password_resets_expires").on(table.expiresAt),
  ]
);

// -----------------------------------------------------------------------------
// 18. Session Preemptions (Persistent Single Active Session Register)
// -----------------------------------------------------------------------------
export const sessionPreemptions = pgTable(
  "session_preemptions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").unique().notNull(),
    staffId: text("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    preemptedAt: text("preempted_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_session_preemptions_token").on(table.tokenHash),
    index("idx_session_preemptions_staff").on(table.staffId),
    index("idx_session_preemptions_expires").on(table.expiresAt),
  ]
);

// -----------------------------------------------------------------------------
// 19. Invoice Counters (Sequential, Gapless, Concurrency-Safe Numbering)
// -----------------------------------------------------------------------------
export const invoiceCounters = pgTable(
  "invoice_counters",
  {
    year: integer("year").primaryKey(),
    lastNumber: integer("last_number").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  }
);

// -----------------------------------------------------------------------------
// 20. Invoices (Regular Bill vs GST Tax Invoice, Immutable Numbering)
// -----------------------------------------------------------------------------
export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    invoiceNumber: text("invoice_number").unique(),
    invoiceType: text("invoice_type").notNull(),
    invoiceCategory: text("invoice_category").notNull().default("RESIDENT"),
    status: text("status").notNull().default("DRAFT"),
    residentId: text("resident_id").references(() => residents.id, { onDelete: "restrict" }),
    customerId: text("customer_id").references(() => tiffinCustomers.id, { onDelete: "restrict" }),
    subscriptionId: text("subscription_id").references(() => tiffinSubscriptions.id, { onDelete: "set null" }),
    stayId: text("stay_id").references(() => residentStays.id, { onDelete: "restrict" }),
    issueDate: text("issue_date").notNull(),
    dueDate: text("due_date").notNull(),
    billingPeriod: text("billing_period").notNull(),
    subtotal: integer("subtotal").notNull().default(0),
    cgstAmount: integer("cgst_amount").notNull().default(0),
    sgstAmount: integer("sgst_amount").notNull().default(0),
    igstAmount: integer("igst_amount").notNull().default(0),
    totalTax: integer("total_tax").notNull().default(0),
    totalAmount: integer("total_amount").notNull().default(0),
    amountPaid: integer("amount_paid").notNull().default(0),
    balanceDue: integer("balance_due").notNull().default(0),
    companyName: text("company_name").notNull(),
    companyAddress: text("company_address").notNull(),
    companyGstin: text("company_gstin"),
    companyStateCode: text("company_state_code").notNull().default("06"),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    recipientEmail: text("recipient_email"),
    recipientAddress: text("recipient_address"),
    recipientGstin: text("recipient_gstin"),
    recipientStateCode: text("recipient_state_code").notNull().default("06"),
    rentChargeId: text("rent_charge_id").references(() => financialTransactions.id, { onDelete: "set null" }),
    notes: text("notes"),
    cancelledAt: text("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_invoices_number").on(table.invoiceNumber),
    index("idx_invoices_resident").on(table.residentId),
    index("idx_invoices_customer").on(table.customerId),
    index("idx_invoices_sub").on(table.subscriptionId),
    index("idx_invoices_category").on(table.invoiceCategory),
    index("idx_invoices_stay").on(table.stayId),
    index("idx_invoices_status").on(table.status),
    index("idx_invoices_issue_date").on(table.issueDate),
    index("idx_invoices_billing_period").on(table.billingPeriod),
    check(
      "chk_invoices_type",
      sql`${table.invoiceType} IN ('REGULAR_BILL', 'GST_TAX_INVOICE')`
    ),
    check(
      "chk_invoices_category",
      sql`${table.invoiceCategory} IN ('RESIDENT', 'TIFFIN')`
    ),
    check(
      "chk_invoices_status",
      sql`${table.status} IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED')`
    ),
    check("chk_invoices_subtotal", sql`${table.subtotal} >= 0`),
    check("chk_invoices_cgst", sql`${table.cgstAmount} >= 0`),
    check("chk_invoices_sgst", sql`${table.sgstAmount} >= 0`),
    check("chk_invoices_igst", sql`${table.igstAmount} >= 0`),
    check("chk_invoices_total_tax", sql`${table.totalTax} >= 0`),
    check("chk_invoices_total_amount", sql`${table.totalAmount} >= 0`),
    check("chk_invoices_amount_paid", sql`${table.amountPaid} >= 0`),
    check("chk_invoices_balance_due", sql`${table.balanceDue} >= 0`),
  ]
);

// -----------------------------------------------------------------------------
// 21. Invoice Items (Itemized Charges, SAC/HSN codes, Tax breakdown)
// -----------------------------------------------------------------------------
export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    subscriptionId: text("subscription_id").references(() => tiffinSubscriptions.id, { onDelete: "set null" }),
    serviceStartDate: text("service_start_date"),
    serviceEndDate: text("service_end_date"),
    description: text("description").notNull(),
    sacHsnCode: text("sac_hsn_code"),
    quantity: integer("quantity").notNull().default(1),
    unitPrice: integer("unit_price").notNull(),
    amount: integer("amount").notNull(),
    taxRate: integer("tax_rate").notNull().default(0),
    cgstRate: integer("cgst_rate").notNull().default(0),
    sgstRate: integer("sgst_rate").notNull().default(0),
    igstRate: integer("igst_rate").notNull().default(0),
    cgstAmount: integer("cgst_amount").notNull().default(0),
    sgstAmount: integer("sgst_amount").notNull().default(0),
    igstAmount: integer("igst_amount").notNull().default(0),
    totalItemAmount: integer("total_item_amount").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_invoice_items_invoice").on(table.invoiceId),
    check("chk_invoice_items_qty", sql`${table.quantity} > 0`),
    check("chk_invoice_items_unit_price", sql`${table.unitPrice} >= 0`),
    check("chk_invoice_items_amount", sql`${table.amount} >= 0`),
    check("chk_invoice_items_tax_rate", sql`${table.taxRate} >= 0`),
    check("chk_invoice_items_total", sql`${table.totalItemAmount} >= 0`),
  ]
);

// -----------------------------------------------------------------------------
// 22. Invoice Payment Allocations (Audit-Proof Payment to Invoice Binding)
// -----------------------------------------------------------------------------
export const invoicePaymentAllocations = pgTable(
  "invoice_payment_allocations",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    paymentTransactionId: text("payment_transaction_id")
      .notNull()
      .references(() => financialTransactions.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    allocatedAt: text("allocated_at").notNull(),
    allocatedBy: text("allocated_by")
      .notNull()
      .references(() => staffUsers.id),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_inv_alloc_invoice").on(table.invoiceId),
    index("idx_inv_alloc_payment").on(table.paymentTransactionId),
    check("chk_inv_alloc_amount", sql`${table.amount} > 0`),
  ]
);

// -----------------------------------------------------------------------------
// 23. Tiffin Customers (Commercial Clients Directory)
// -----------------------------------------------------------------------------
export const tiffinCustomers = pgTable(
  "tiffin_customers",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    alternatePhone: text("alternate_phone"),
    deliveryAddress: text("delivery_address").notNull(),
    landmark: text("landmark"),
    deliveryInstructions: text("delivery_instructions"),
    customerType: text("customer_type").notNull().default("INDIVIDUAL"),
    dietaryPreference: text("dietary_preference").notNull().default("VEG"),
    status: text("status").notNull().default("ACTIVE"),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    updatedBy: text("updated_by").references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_tiffin_cust_phone").on(table.phone),
    index("idx_tiffin_cust_status").on(table.status),
    index("idx_tiffin_cust_name").on(table.fullName),
    check(
      "chk_tiffin_cust_type",
      sql`${table.customerType} IN ('INDIVIDUAL', 'CORPORATE', 'RESIDENTIAL_PG')`
    ),
    check(
      "chk_tiffin_cust_diet",
      sql`${table.dietaryPreference} IN ('VEG', 'NON_VEG', 'JAIN')`
    ),
    check(
      "chk_tiffin_cust_status",
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`
    ),
  ]
);

// -----------------------------------------------------------------------------
// 24. Tiffin Products & Meal Packages Catalog
// -----------------------------------------------------------------------------
export const tiffinProducts = pgTable(
  "tiffin_products",
  {
    id: text("id").primaryKey(),
    code: text("code").unique().notNull(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    billingUnit: text("billing_unit").notNull(),
    price: integer("price").notNull(),
    currency: text("currency").notNull().default("INR"),
    status: text("status").notNull().default("ACTIVE"),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_tiffin_prod_code").on(table.code),
    index("idx_tiffin_prod_category").on(table.category),
    index("idx_tiffin_prod_status").on(table.status),
    check(
      "chk_tiffin_prod_category",
      sql`${table.category} IN ('STANDARD_MEAL', 'SUBSCRIPTION_PACKAGE', 'EXTRA', 'BEVERAGE', 'SPECIAL')`
    ),
    check(
      "chk_tiffin_prod_unit",
      sql`${table.billingUnit} IN ('PER_MEAL', 'PER_DAY', 'PER_MONTH', 'PER_PIECE', 'PER_PORTION')`
    ),
    check("chk_tiffin_prod_price", sql`${table.price} >= 0`),
    check(
      "chk_tiffin_prod_status",
      sql`${table.status} IN ('ACTIVE', 'INACTIVE')`
    ),
  ]
);

// -----------------------------------------------------------------------------
// 25. Tiffin Customer Subscriptions & Service Schedules (Task 01B.44)
// -----------------------------------------------------------------------------
export const tiffinSubscriptions = pgTable(
  "tiffin_subscriptions",
  {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => tiffinCustomers.id),
    productId: text("product_id")
      .notNull()
      .references(() => tiffinProducts.id),
    status: text("status").notNull().default("ACTIVE"),
    startDate: text("start_date").notNull(),
    endDate: text("end_date"),
    price: integer("price").notNull(),
    currency: text("currency").notNull().default("INR"),
    mealTypes: text("meal_types").notNull().default("BOTH"),
    serviceDays: text("service_days").notNull().default("ALL_DAYS"),
    quantityPerMeal: integer("quantity_per_meal").notNull().default(1),
    pauseStartDate: text("pause_start_date"),
    pauseResumeDate: text("pause_resume_date"),
    pauseReason: text("pause_reason"),
    cancelledAt: text("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    cancelledBy: text("cancelled_by").references(() => staffUsers.id),
    deliveryAddress: text("delivery_address").notNull(),
    deliveryInstructions: text("delivery_instructions"),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    updatedBy: text("updated_by").references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_tiffin_sub_customer").on(table.customerId),
    index("idx_tiffin_sub_product").on(table.productId),
    index("idx_tiffin_sub_status").on(table.status),
    index("idx_tiffin_sub_start_date").on(table.startDate),
    check(
      "chk_tiffin_sub_status",
      sql`${table.status} IN ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED')`
    ),
    check(
      "chk_tiffin_sub_meal_types",
      sql`${table.mealTypes} IN ('LUNCH', 'DINNER', 'BOTH', 'BREAKFAST')`
    ),
    check(
      "chk_tiffin_sub_service_days",
      sql`${table.serviceDays} IN ('ALL_DAYS', 'MON_SAT', 'MON_FRI')`
    ),
    check("chk_tiffin_sub_price", sql`${table.price} >= 0`),
    check("chk_tiffin_sub_qty", sql`${table.quantityPerMeal} >= 1`),
  ]
);

// -----------------------------------------------------------------------------
// 26. Kitchen Raw Material Inventory & Recipe-Based Consumption (Task 01B.48)
// -----------------------------------------------------------------------------
export const kitchenRawMaterials = pgTable(
  "kitchen_raw_materials",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    baseUnit: text("base_unit").notNull(),
    currentStock: integer("current_stock").notNull().default(0),
    reorderThreshold: integer("reorder_threshold").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    updatedBy: text("updated_by").references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_krm_code").on(table.code),
    index("idx_krm_category").on(table.category),
    index("idx_krm_active").on(table.isActive),
    check(
      "chk_krm_category",
      sql`${table.category} IN ('GRAINS', 'PULSES', 'VEGETABLES', 'DAIRY', 'SPICES', 'OILS', 'PACKAGING', 'OTHER')`
    ),
    check(
      "chk_krm_base_unit",
      sql`${table.baseUnit} IN ('G', 'ML', 'PCS')`
    ),
    check("chk_krm_reorder", sql`${table.reorderThreshold} >= 0`),
  ]
);

export const kitchenRecipes = pgTable(
  "kitchen_recipes",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    mealType: text("meal_type"),
    productId: text("product_id").references(() => tiffinProducts.id, { onDelete: "set null" }),
    yieldServings: integer("yield_servings").notNull().default(1),
    version: integer("version").notNull().default(1),
    isActive: integer("is_active").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    updatedBy: text("updated_by").references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_kr_meal_type").on(table.mealType),
    index("idx_kr_product").on(table.productId),
    index("idx_kr_active").on(table.isActive),
    check("chk_kr_yield", sql`${table.yieldServings} >= 1`),
    check("chk_kr_version", sql`${table.version} >= 1`),
    check(
      "chk_kr_meal_type",
      sql`${table.mealType} IS NULL OR ${table.mealType} IN ('BREAKFAST', 'LUNCH', 'DINNER')`
    ),
  ]
);

export const kitchenRecipeIngredients = pgTable(
  "kitchen_recipe_ingredients",
  {
    id: text("id").primaryKey(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => kitchenRecipes.id, { onDelete: "cascade" }),
    recipeVersion: integer("recipe_version").notNull().default(1),
    materialId: text("material_id")
      .notNull()
      .references(() => kitchenRawMaterials.id, { onDelete: "restrict" }),
    quantityBase: integer("quantity_base").notNull(),
    displayUnit: text("display_unit").notNull(),
    displayQuantity: integer("display_quantity").notNull(),
    lossPercent: integer("loss_percent").notNull().default(0),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_kri_recipe").on(table.recipeId),
    index("idx_kri_material").on(table.materialId),
    uniqueIndex("idx_kri_recipe_ver_mat").on(table.recipeId, table.recipeVersion, table.materialId),
    check("chk_kri_qty", sql`${table.quantityBase} > 0`),
    check("chk_kri_loss", sql`${table.lossPercent} >= 0 AND ${table.lossPercent} <= 100`),
  ]
);

export const kitchenStockMovements = pgTable(
  "kitchen_stock_movements",
  {
    id: text("id").primaryKey(),
    materialId: text("material_id")
      .notNull()
      .references(() => kitchenRawMaterials.id, { onDelete: "restrict" }),
    movementType: text("movement_type").notNull(),
    quantityBase: integer("quantity_base").notNull(),
    unit: text("unit").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    reason: text("reason").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => staffUsers.id),
    actorName: text("actor_name"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_ksm_material").on(table.materialId),
    index("idx_ksm_type").on(table.movementType),
    index("idx_ksm_source").on(table.sourceType, table.sourceId),
    index("idx_ksm_created").on(table.createdAt),
    check(
      "chk_ksm_type",
      sql`${table.movementType} IN ('OPENING_BALANCE', 'RECEIPT', 'ADJUSTMENT_ADD', 'ADJUSTMENT_SUB', 'PRODUCTION_CONSUMPTION', 'PRODUCTION_REVERSAL', 'WASTE')`
    ),
    check(
      "chk_ksm_source_type",
      sql`${table.sourceType} IN ('MANUAL', 'PRODUCTION_PLAN', 'WASTE_REPORT')`
    ),
  ]
);

export const kitchenProductionConsumptions = pgTable(
  "kitchen_production_consumptions",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => dailyMealPlans.id, { onDelete: "restrict" }),
    mealType: text("meal_type").notNull(),
    serviceDate: text("service_date").notNull(),
    recipeId: text("recipe_id")
      .notNull()
      .references(() => kitchenRecipes.id, { onDelete: "restrict" }),
    recipeVersion: integer("recipe_version").notNull().default(1),
    producedServings: integer("produced_servings").notNull(),
    status: text("status").notNull().default("POSTED"),
    notes: text("notes"),
    postedBy: text("posted_by")
      .notNull()
      .references(() => staffUsers.id),
    postedAt: text("posted_at").notNull(),
    reversedBy: text("reversed_by").references(() => staffUsers.id),
    reversedAt: text("reversed_at"),
    reversalReason: text("reversal_reason"),
  },
  (table) => [
    index("idx_kpc_plan").on(table.planId),
    index("idx_kpc_date").on(table.serviceDate),
    index("idx_kpc_status").on(table.status),
    uniqueIndex("idx_kpc_plan_posted").on(table.planId, table.status),
    check("chk_kpc_status", sql`${table.status} IN ('POSTED', 'REVERSED')`),
    check("chk_kpc_servings", sql`${table.producedServings} > 0`),
  ]
);

// -----------------------------------------------------------------------------
// 27. Resident Checkout & Final Financial Settlements (Task 01B.52)
// -----------------------------------------------------------------------------
export const residentSettlements = pgTable(
  "resident_settlements",
  {
    id: text("id").primaryKey(),
    residentId: text("resident_id")
      .notNull()
      .references(() => residents.id, { onDelete: "restrict" }),
    stayId: text("stay_id")
      .notNull()
      .references(() => residentStays.id, { onDelete: "restrict" }),
    roomId: text("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "restrict" }),
    checkoutDate: text("checkout_date").notNull(),
    outstandingRentAmount: integer("outstanding_rent_amount").notNull().default(0),
    depositHeldAmount: integer("deposit_held_amount").notNull().default(0),
    deductionsAmount: integer("deductions_amount").notNull().default(0),
    deductionsBreakdown: text("deductions_breakdown"),
    depositAppliedAmount: integer("deposit_applied_amount").notNull().default(0),
    refundAmount: integer("refund_amount").notNull().default(0),
    refundPaymentMethod: text("refund_payment_method"),
    refundTransactionId: text("refund_transaction_id").references(() => financialTransactions.id, { onDelete: "set null" }),
    remainingPayableAmount: integer("remaining_payable_amount").notNull().default(0),
    paymentTransactionId: text("payment_transaction_id").references(() => financialTransactions.id, { onDelete: "set null" }),
    settlementStatus: text("settlement_status").notNull().default("SETTLED"),
    notes: text("notes"),
    settledBy: text("settled_by")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_resident_settlements_stay").on(table.stayId),
    index("idx_resident_settlements_resident").on(table.residentId),
    index("idx_resident_settlements_status").on(table.settlementStatus),
    index("idx_resident_settlements_checkout_date").on(table.checkoutDate),
    check("chk_settlement_rent", sql`${table.outstandingRentAmount} >= 0`),
    check("chk_settlement_deposit", sql`${table.depositHeldAmount} >= 0`),
    check("chk_settlement_deductions", sql`${table.deductionsAmount} >= 0`),
    check("chk_settlement_applied", sql`${table.depositAppliedAmount} >= 0`),
    check("chk_settlement_refund", sql`${table.refundAmount} >= 0`),
    check("chk_settlement_payable", sql`${table.remainingPayableAmount} >= 0`),
    check(
      "chk_settlement_status",
      sql`${table.settlementStatus} IN ('SETTLED', 'PENDING_PAYMENT')`
    ),
  ]
);

// -----------------------------------------------------------------------------
// 28. Daily Cashbook Closings & Reconciliation (Task 01B.53)
// -----------------------------------------------------------------------------
export const dailyCashbookClosings = pgTable(
  "daily_cashbook_closings",
  {
    id: text("id").primaryKey(),
    closingDate: text("closing_date").notNull(),
    division: text("division").notNull().default("COMBINED"),
    openingBalance: integer("opening_balance").notNull().default(0),
    openingCashBalance: integer("opening_cash_balance").notNull().default(0),
    cashInflow: integer("cash_inflow").notNull().default(0),
    upiInflow: integer("upi_inflow").notNull().default(0),
    bankTransferInflow: integer("bank_transfer_inflow").notNull().default(0),
    chequeInflow: integer("cheque_inflow").notNull().default(0),
    otherInflow: integer("other_inflow").notNull().default(0),
    cashOutflow: integer("cash_outflow").notNull().default(0),
    upiOutflow: integer("upi_outflow").notNull().default(0),
    bankTransferOutflow: integer("bank_transfer_outflow").notNull().default(0),
    chequeOutflow: integer("cheque_outflow").notNull().default(0),
    otherOutflow: integer("other_outflow").notNull().default(0),
    totalInflow: integer("total_inflow").notNull().default(0),
    totalOutflow: integer("total_outflow").notNull().default(0),
    expectedClosingBalance: integer("expected_closing_balance").notNull().default(0),
    expectedCashBalance: integer("expected_cash_balance").notNull().default(0),
    actualCashCounted: integer("actual_cash_counted"),
    actualBankVerified: integer("actual_bank_verified"),
    actualTotalBalance: integer("actual_total_balance"),
    cashDiscrepancy: integer("cash_discrepancy").notNull().default(0),
    totalDiscrepancy: integer("total_discrepancy").notNull().default(0),
    discrepancyReason: text("discrepancy_reason"),
    status: text("status").notNull().default("DRAFT"),
    preparedBy: text("prepared_by")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "restrict" }),
    finalizedBy: text("finalized_by").references(() => staffUsers.id, { onDelete: "set null" }),
    finalizedAt: text("finalized_at"),
    reopenedBy: text("reopened_by").references(() => staffUsers.id, { onDelete: "set null" }),
    reopenedAt: text("reopened_at"),
    reopenReason: text("reopen_reason"),
    notes: text("notes"),
    snapshotData: text("snapshot_data"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_unique_closing_date_div").on(table.closingDate, table.division),
    index("idx_closing_date").on(table.closingDate),
    index("idx_closing_status").on(table.status),
    index("idx_closing_division").on(table.division),
    check("chk_closing_status", sql`${table.status} IN ('DRAFT', 'FINALIZED', 'REOPENED')`),
    check("chk_closing_division", sql`${table.division} IN ('COMBINED', 'PG', 'TIFFIN')`),
  ]
);

// -----------------------------------------------------------------------------
// 29. Document Attachments & Secure KYC Management (Task 01B.57)
// -----------------------------------------------------------------------------
export const documentAttachments = pgTable(
  "document_attachments",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    residentId: text("resident_id").references(() => residents.id, { onDelete: "restrict" }),
    stayId: text("stay_id").references(() => residentStays.id, { onDelete: "set null" }),
    transactionId: text("transaction_id").references(() => financialTransactions.id, { onDelete: "set null" }),
    invoiceId: text("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
    settlementId: text("settlement_id").references(() => residentSettlements.id, { onDelete: "set null" }),
    displayFilename: text("display_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSize: integer("file_size").notNull(),
    fileHash: text("file_hash").notNull(),
    storagePath: text("storage_path").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    supersededBy: text("superseded_by"),
    notes: text("notes"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "restrict" }),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_docs_category").on(table.category),
    index("idx_docs_resident").on(table.residentId),
    index("idx_docs_stay").on(table.stayId),
    index("idx_docs_tx").on(table.transactionId),
    index("idx_docs_invoice").on(table.invoiceId),
    index("idx_docs_settlement").on(table.settlementId),
    index("idx_docs_status").on(table.status),
    check(
      "chk_doc_category",
      sql`${table.category} IN ('RESIDENT_KYC', 'RESIDENT_ADDRESS_PROOF', 'RENT_RECEIPT', 'SECURITY_DEPOSIT_RECEIPT', 'CHECKOUT_SETTLEMENT_RECEIPT', 'EXPENSE_RECEIPT', 'OPERATIONAL_ATTACHMENT')`
    ),
    check("chk_doc_status", sql`${table.status} IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED')`),
    check("chk_doc_file_size", sql`${table.fileSize} > 0 AND ${table.fileSize} <= 5242880`),
  ]
);

// -----------------------------------------------------------------------------
// 30. Driver Cash Handovers & Shift Settlements (Task 01B.58)
// -----------------------------------------------------------------------------
export const driverCashHandovers = pgTable(
  "driver_cash_handovers",
  {
    id: text("id").primaryKey(),
    driverId: text("driver_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "restrict" }),
    shiftDate: text("shift_date").notNull(),
    declaredCash: integer("declared_cash").notNull().default(0),
    acceptedCash: integer("accepted_cash").notNull().default(0),
    variance: integer("variance").notNull().default(0),
    varianceReason: text("variance_reason"),
    status: text("status").notNull().default("DECLARED"),
    transactionId: text("transaction_id").references(() => financialTransactions.id, { onDelete: "set null" }),
    acceptedBy: text("accepted_by").references(() => staffUsers.id, { onDelete: "set null" }),
    acceptedAt: text("accepted_at"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_dch_driver").on(table.driverId),
    index("idx_dch_shift_date").on(table.shiftDate),
    index("idx_dch_status").on(table.status),
    index("idx_dch_tx").on(table.transactionId),
    check("chk_dch_declared", sql`${table.declaredCash} >= 0`),
    check("chk_dch_accepted", sql`${table.acceptedCash} >= 0`),
    check(
      "chk_dch_status",
      sql`${table.status} IN ('DECLARED', 'ACCEPTED', 'DISCREPANCY_FLAGGED')`
    ),
  ]
);








// -----------------------------------------------------------------------------
// Orders (migration 0012, ISSUE-008 / ISSUE-024)
// -----------------------------------------------------------------------------
// orders.status is the order lifecycle only; delivery progress stays on delivery_tasks.
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    orderType: text("order_type").notNull(),
    status: text("status").notNull().default("CONFIRMED"),
    serviceDate: text("service_date").notNull(),
    mealType: text("meal_type").notNull(),
    customerId: text("customer_id").references(() => tiffinCustomers.id, { onDelete: "restrict" }),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    deliveryAddress: text("delivery_address"),
    deliveryTaskId: text("delivery_task_id")
      .unique()
      .references(() => deliveryTasks.id, { onDelete: "restrict" }),
    financialTransactionId: text("financial_transaction_id")
      .unique()
      .references(() => financialTransactions.id, { onDelete: "restrict" }),
    totalQuantity: integer("total_quantity").notNull(),
    totalAmount: integer("total_amount").notNull(),
    paymentMethod: text("payment_method"),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key").unique(),
    source: text("source").notNull().default("APP"),
    createdBy: text("created_by").references(() => staffUsers.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_orders_service_date").on(table.serviceDate),
    index("idx_orders_customer").on(table.customerId),
    index("idx_orders_customer_phone").on(table.customerPhone),
    index("idx_orders_type_date").on(table.orderType, table.serviceDate),
    check("chk_orders_type", sql`${table.orderType} IN ('DELIVERY', 'DINE_IN')`),
    check("chk_orders_status", sql`${table.status} IN ('CONFIRMED', 'COMPLETED', 'CANCELLED')`),
    check("chk_orders_meal", sql`${table.mealType} IN ('BREAKFAST', 'LUNCH', 'DINNER')`),
    check("chk_orders_source", sql`${table.source} IN ('APP', 'LEGACY_BACKFILL')`),
    check("chk_orders_qty", sql`${table.totalQuantity} > 0`),
    check("chk_orders_amount", sql`${table.totalAmount} >= 0`),
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    productId: text("product_id").references(() => tiffinProducts.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPrice: integer("unit_price").notNull(),
    lineTotal: integer("line_total").notNull(),
    deliveredQuantity: integer("delivered_quantity"),
    undeliveredReason: text("undelivered_reason"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("order_items_order_line_unique").on(table.orderId, table.lineNo),
    index("idx_order_items_product").on(table.productId),
    check("chk_order_items_qty", sql`${table.quantity} > 0`),
    check("chk_order_items_price", sql`${table.unitPrice} >= 0`),
    check("chk_order_items_total", sql`${table.lineTotal} = ${table.quantity} * ${table.unitPrice}`),
  ]
);
