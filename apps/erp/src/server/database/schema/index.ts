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
    stayId: text("stay_id").references(() => residentStays.id, { onDelete: "restrict" }),
    category: text("category").notNull(),
    description: text("description"),
    billingPeriod: text("billing_period"),
    payeeVendor: text("payee_vendor"),
    idempotencyKey: text("idempotency_key").unique(),
    status: text("status").notNull().default("POSTED"),
    reversalOfId: text("reversal_of_id"),
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
    index("idx_fin_tx_stay").on(table.stayId),
    index("idx_fin_tx_category").on(table.category),
    index("idx_fin_tx_status").on(table.status),
    uniqueIndex("idx_fin_tx_idempotency").on(table.idempotencyKey),
    check(
      "chk_fin_tx_type",
      sql`${table.transactionType} IN ('RENT_CHARGE', 'RENT_PAYMENT', 'SECURITY_DEPOSIT', 'EXPENSE', 'REVERSAL')`
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
    guestCount: integer("guest_count").notNull().default(0),
    finalPreparationCount: integer("final_preparation_count").notNull().default(0),
    actualCookedCount: integer("actual_cooked_count"),
    status: text("status").notNull().default("DRAFT"),
    notes: text("notes"),
    createdBy: text("created_by")
      .notNull()
      .references(() => staffUsers.id),
    confirmedBy: text("confirmed_by").references(() => staffUsers.id),
    confirmedAt: text("confirmed_at"),
    completedBy: text("completed_by").references(() => staffUsers.id),
    completedAt: text("completed_at"),
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
    check("chk_plan_guest_cnt", sql`${table.guestCount} >= 0`),
    check("chk_plan_prep_cnt", sql`${table.finalPreparationCount} >= 0`),
    check("chk_plan_act_cook", sql`${table.actualCookedCount} IS NULL OR ${table.actualCookedCount} >= 0`),
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
    check("chk_del_order_type", sql`${table.orderType} IN ('RESIDENT', 'EXTERNAL')`),
    check("chk_del_meal_type", sql`${table.mealType} IN ('BREAKFAST', 'LUNCH', 'DINNER')`),
    check(
      "chk_del_status",
      sql`${table.status} IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')`
    ),
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

