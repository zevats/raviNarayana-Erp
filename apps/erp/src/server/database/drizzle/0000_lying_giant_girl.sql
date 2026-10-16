CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_username" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" text,
	"ip_address" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"otp_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_auth_chal_attempts" CHECK ("auth_challenges"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "daily_meal_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"service_date" text NOT NULL,
	"meal_type" text NOT NULL,
	"planned_resident_count" integer DEFAULT 0 NOT NULL,
	"guest_count" integer DEFAULT 0 NOT NULL,
	"final_preparation_count" integer DEFAULT 0 NOT NULL,
	"actual_cooked_count" integer,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"created_by" text NOT NULL,
	"confirmed_by" text,
	"confirmed_at" text,
	"completed_by" text,
	"completed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_meal_plan_type" CHECK ("daily_meal_plans"."meal_type" IN ('BREAKFAST', 'LUNCH', 'DINNER')),
	CONSTRAINT "chk_meal_plan_status" CHECK ("daily_meal_plans"."status" IN ('DRAFT', 'CONFIRMED', 'COMPLETED')),
	CONSTRAINT "chk_plan_res_cnt" CHECK ("daily_meal_plans"."planned_resident_count" >= 0),
	CONSTRAINT "chk_plan_guest_cnt" CHECK ("daily_meal_plans"."guest_count" >= 0),
	CONSTRAINT "chk_plan_prep_cnt" CHECK ("daily_meal_plans"."final_preparation_count" >= 0),
	CONSTRAINT "chk_plan_act_cook" CHECK ("daily_meal_plans"."actual_cooked_count" IS NULL OR "daily_meal_plans"."actual_cooked_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_task_events" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"notes" text,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_del_evt_type" CHECK ("delivery_task_events"."event_type" IN ('CREATED', 'ASSIGNED', 'REASSIGNED', 'DISPATCHED', 'DELIVERED', 'EXCEPTION', 'RETRIED'))
);
--> statement-breakpoint
CREATE TABLE "delivery_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"order_type" text DEFAULT 'RESIDENT' NOT NULL,
	"meal_record_id" text,
	"plan_id" text NOT NULL,
	"service_date" text NOT NULL,
	"meal_type" text NOT NULL,
	"resident_id" text,
	"resident_name" text,
	"room_number" text,
	"floor" integer,
	"stay_id" text,
	"customer_name" text,
	"customer_phone" text,
	"delivery_address" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"assigned_to" text,
	"assigned_to_name" text,
	"assigned_by" text,
	"assigned_at" text,
	"dispatched_at" text,
	"dispatched_by" text,
	"delivered_at" text,
	"delivered_by" text,
	"delivery_notes" text,
	"recipient_name" text,
	"exception_type" text,
	"exception_reason" text,
	"exception_at" text,
	"exception_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "delivery_tasks_meal_record_id_unique" UNIQUE("meal_record_id"),
	CONSTRAINT "chk_del_order_type" CHECK ("delivery_tasks"."order_type" IN ('RESIDENT', 'EXTERNAL')),
	CONSTRAINT "chk_del_meal_type" CHECK ("delivery_tasks"."meal_type" IN ('BREAKFAST', 'LUNCH', 'DINNER')),
	CONSTRAINT "chk_del_status" CHECK ("delivery_tasks"."status" IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')),
	CONSTRAINT "chk_del_exc_type" CHECK ("delivery_tasks"."exception_type" IS NULL OR "delivery_tasks"."exception_type" IN ('RESIDENT_UNAVAILABLE', 'RESIDENT_DECLINED', 'LOCATION_UNCLEAR', 'MEAL_DAMAGED_OR_MISSING', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "financial_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_type" text NOT NULL,
	"amount" integer NOT NULL,
	"transaction_date" text NOT NULL,
	"payment_method" text,
	"reference_number" text,
	"resident_id" text,
	"stay_id" text,
	"category" text NOT NULL,
	"description" text,
	"billing_period" text,
	"payee_vendor" text,
	"idempotency_key" text,
	"status" text DEFAULT 'POSTED' NOT NULL,
	"reversal_of_id" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "financial_transactions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "chk_fin_tx_type" CHECK ("financial_transactions"."transaction_type" IN ('RENT_CHARGE', 'RENT_PAYMENT', 'SECURITY_DEPOSIT', 'EXPENSE', 'REVERSAL')),
	CONSTRAINT "chk_fin_tx_amount" CHECK ("financial_transactions"."amount" > 0),
	CONSTRAINT "chk_fin_tx_status" CHECK ("financial_transactions"."status" IN ('POSTED', 'REVERSED')),
	CONSTRAINT "chk_fin_tx_payment_method" CHECK ("financial_transactions"."payment_method" IS NULL OR "financial_transactions"."payment_method" IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"ip_address" text NOT NULL,
	"attempted_at" text NOT NULL,
	"success" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plan_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"previous_resident_count" integer NOT NULL,
	"new_resident_count" integer NOT NULL,
	"previous_guest_count" integer NOT NULL,
	"new_guest_count" integer NOT NULL,
	"previous_total" integer NOT NULL,
	"new_total" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "chk_adj_prev_res" CHECK ("meal_plan_adjustments"."previous_resident_count" >= 0),
	CONSTRAINT "chk_adj_new_res" CHECK ("meal_plan_adjustments"."new_resident_count" >= 0),
	CONSTRAINT "chk_adj_prev_gst" CHECK ("meal_plan_adjustments"."previous_guest_count" >= 0),
	CONSTRAINT "chk_adj_new_gst" CHECK ("meal_plan_adjustments"."new_guest_count" >= 0),
	CONSTRAINT "chk_adj_prev_tot" CHECK ("meal_plan_adjustments"."previous_total" >= 0),
	CONSTRAINT "chk_adj_new_tot" CHECK ("meal_plan_adjustments"."new_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "resident_meal_preferences" (
	"resident_id" text PRIMARY KEY NOT NULL,
	"breakfast_opt_in" integer DEFAULT 1 NOT NULL,
	"lunch_opt_in" integer DEFAULT 1 NOT NULL,
	"dinner_opt_in" integer DEFAULT 1 NOT NULL,
	"dietary_preference" text DEFAULT 'VEG' NOT NULL,
	"notes" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_meal_pref_b" CHECK ("resident_meal_preferences"."breakfast_opt_in" IN (0, 1)),
	CONSTRAINT "chk_meal_pref_l" CHECK ("resident_meal_preferences"."lunch_opt_in" IN (0, 1)),
	CONSTRAINT "chk_meal_pref_d" CHECK ("resident_meal_preferences"."dinner_opt_in" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE "resident_meal_records" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"resident_id" text NOT NULL,
	"stay_id" text NOT NULL,
	"service_date" text NOT NULL,
	"meal_type" text NOT NULL,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_res_meal_type" CHECK ("resident_meal_records"."meal_type" IN ('BREAKFAST', 'LUNCH', 'DINNER')),
	CONSTRAINT "chk_res_meal_status" CHECK ("resident_meal_records"."status" IN ('CONFIRMED', 'OPTED_OUT'))
);
--> statement-breakpoint
CREATE TABLE "resident_stays" (
	"id" text PRIMARY KEY NOT NULL,
	"resident_id" text NOT NULL,
	"room_id" text NOT NULL,
	"check_in_date" text NOT NULL,
	"check_out_date" text,
	"monthly_rent" integer NOT NULL,
	"security_deposit" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_stays_monthly_rent" CHECK ("resident_stays"."monthly_rent" >= 0),
	CONSTRAINT "chk_stays_security_deposit" CHECK ("resident_stays"."security_deposit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"emergency_contact" text,
	"notes" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "residents_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" text PRIMARY KEY NOT NULL,
	"room_number" text NOT NULL,
	"floor" integer NOT NULL,
	"type" text NOT NULL,
	"capacity" integer NOT NULL,
	"base_rent_monthly" integer NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_rooms_capacity" CHECK ("rooms"."capacity" > 0),
	CONSTRAINT "chk_rooms_base_rent" CHECK ("rooms"."base_rent_monthly" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"staff_id" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "staff_notification_reads" (
	"staff_id" text NOT NULL,
	"notification_id" text NOT NULL,
	"read_at" text NOT NULL,
	CONSTRAINT "staff_notification_reads_staff_id_notification_id_pk" PRIMARY KEY("staff_id","notification_id")
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"is_active" integer DEFAULT 1 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"last_login_at" text
);
--> statement-breakpoint
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD CONSTRAINT "daily_meal_plans_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD CONSTRAINT "daily_meal_plans_confirmed_by_staff_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD CONSTRAINT "daily_meal_plans_completed_by_staff_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_task_events" ADD CONSTRAINT "delivery_task_events_task_id_delivery_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_task_events" ADD CONSTRAINT "delivery_task_events_actor_id_staff_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_meal_record_id_resident_meal_records_id_fk" FOREIGN KEY ("meal_record_id") REFERENCES "public"."resident_meal_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_plan_id_daily_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."daily_meal_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_stay_id_resident_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."resident_stays"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_assigned_to_staff_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_assigned_by_staff_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_dispatched_by_staff_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_delivered_by_staff_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_exception_by_staff_users_id_fk" FOREIGN KEY ("exception_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_stay_id_resident_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."resident_stays"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_adjustments" ADD CONSTRAINT "meal_plan_adjustments_plan_id_daily_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."daily_meal_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_adjustments" ADD CONSTRAINT "meal_plan_adjustments_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_meal_preferences" ADD CONSTRAINT "resident_meal_preferences_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_meal_records" ADD CONSTRAINT "resident_meal_records_plan_id_daily_meal_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."daily_meal_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_meal_records" ADD CONSTRAINT "resident_meal_records_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_meal_records" ADD CONSTRAINT "resident_meal_records_stay_id_resident_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."resident_stays"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_meal_records" ADD CONSTRAINT "resident_meal_records_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_stays" ADD CONSTRAINT "resident_stays_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_stays" ADD CONSTRAINT "resident_stays_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_notification_reads" ADD CONSTRAINT "staff_notification_reads_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_actor" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_target" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_auth_challenges_staff" ON "auth_challenges" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "idx_auth_challenges_expires" ON "auth_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_plan_date_meal" ON "daily_meal_plans" USING btree ("service_date","meal_type");--> statement-breakpoint
CREATE INDEX "idx_meal_plans_date" ON "daily_meal_plans" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX "idx_meal_plans_status" ON "daily_meal_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_meal_plans_date_meal" ON "daily_meal_plans" USING btree ("service_date","meal_type");--> statement-breakpoint
CREATE INDEX "idx_del_events_task" ON "delivery_task_events" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_del_events_created" ON "delivery_task_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_del_tasks_date" ON "delivery_tasks" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX "idx_del_tasks_date_meal" ON "delivery_tasks" USING btree ("service_date","meal_type");--> statement-breakpoint
CREATE INDEX "idx_del_tasks_status" ON "delivery_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_del_tasks_assigned_to" ON "delivery_tasks" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "idx_del_tasks_plan" ON "delivery_tasks" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_del_tasks_resident" ON "delivery_tasks" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "idx_del_tasks_order_type" ON "delivery_tasks" USING btree ("order_type");--> statement-breakpoint
CREATE INDEX "idx_fin_tx_type" ON "financial_transactions" USING btree ("transaction_type");--> statement-breakpoint
CREATE INDEX "idx_fin_tx_date" ON "financial_transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE INDEX "idx_fin_tx_resident" ON "financial_transactions" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "idx_fin_tx_stay" ON "financial_transactions" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "idx_fin_tx_category" ON "financial_transactions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_fin_tx_status" ON "financial_transactions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_fin_tx_idempotency" ON "financial_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_login_attempts_ip" ON "login_attempts" USING btree ("ip_address","attempted_at");--> statement-breakpoint
CREATE INDEX "idx_login_attempts_ident_ip" ON "login_attempts" USING btree ("identifier","ip_address","attempted_at");--> statement-breakpoint
CREATE INDEX "idx_login_attempts_ident" ON "login_attempts" USING btree ("identifier","attempted_at");--> statement-breakpoint
CREATE INDEX "idx_meal_adj_plan" ON "meal_plan_adjustments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_meal_adj_date" ON "meal_plan_adjustments" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_password_resets_token" ON "password_resets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_password_resets_staff" ON "password_resets" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "idx_password_resets_expires" ON "password_resets" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_res_date_meal" ON "resident_meal_records" USING btree ("resident_id","service_date","meal_type");--> statement-breakpoint
CREATE INDEX "idx_res_meal_plan" ON "resident_meal_records" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_res_meal_resident" ON "resident_meal_records" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "idx_res_meal_stay" ON "resident_meal_records" USING btree ("stay_id");--> statement-breakpoint
CREATE INDEX "idx_res_meal_date" ON "resident_meal_records" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX "idx_res_meal_status" ON "resident_meal_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_stays_resident_id" ON "resident_stays" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "idx_stays_room_id" ON "resident_stays" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "idx_stays_status" ON "resident_stays" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_stays_room_active" ON "resident_stays" USING btree ("room_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_unique_active_resident_stay" ON "resident_stays" USING btree ("resident_id") WHERE "resident_stays"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "idx_residents_phone" ON "residents" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "idx_residents_status" ON "residents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_rooms_number_nocase" ON "rooms" USING btree (lower("room_number"));--> statement-breakpoint
CREATE INDEX "idx_rooms_number" ON "rooms" USING btree ("room_number");--> statement-breakpoint
CREATE INDEX "idx_rooms_floor" ON "rooms" USING btree ("floor");--> statement-breakpoint
CREATE INDEX "idx_rooms_active" ON "rooms" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_staff" ON "sessions" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "idx_notif_reads_staff" ON "staff_notification_reads" USING btree ("staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_staff_username_lower" ON "staff_users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "idx_staff_email_lower" ON "staff_users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "idx_staff_users_role" ON "staff_users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_staff_users_active" ON "staff_users" USING btree ("is_active");