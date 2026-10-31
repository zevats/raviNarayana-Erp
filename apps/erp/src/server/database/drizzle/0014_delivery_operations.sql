-- Migration 0014: delivery operations (round 11).
-- Additive except for two widened CHECK constraints (each is dropped and re-created with the
-- previous values plus the new ones, so every existing row still satisfies it). One backfill:
-- delivery_collections.service_date is copied from the delivery each collection belongs to.
--
-- 1. delivery_tasks: CANCELLED status (cancellation keeps the row, its events and collections),
--    who/when/why it was cancelled and whether the meal cutoff was overridden, and the
--    Manager's resolution of a problem delivery (EXCEPTION or partial) without changing its status.
-- 2. delivery_task_events: CANCELLED, RESOLVED and UPDATED (quantity changed by an override).
-- 3. delivery_task_items: structured item lines for deliveries that have no order behind them
--    (subscription and resident meals). No price: subscriptions are billed monthly.
-- 4. order_items.undelivered_disposition: what happened to an undelivered quantity.
-- 5. daily_meal_plans: when, how (AUTO/MANUAL) and by whom the delivery list was prepared.
-- 6. One delivery per subscription per meal plan, enforced by the database.
-- 7. subscription_day_overrides: skip today / extra today for one subscription and meal.
-- 8. Residents: room delivery per meal (standing preference and per-day record). Residents who
--    eat at the PG never become delivery stops.
-- 9. delivery_collections.service_date: the service date of the delivery a payment belongs to
--    (the cashbook uses the handover date; this keeps the original date with the payment), and
--    delivery_collections.transaction_id: the cashbook entry of a UPI payment booked directly.

ALTER TABLE "delivery_tasks" DROP CONSTRAINT IF EXISTS "chk_del_status";--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "chk_del_status" CHECK ("status" IN ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "cancelled_at" text;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "cutoff_override" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "resolved_at" text;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "resolved_by" text;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "resolution_note" text;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "chk_del_cutoff_override" CHECK ("cutoff_override" IN (0, 1));--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD CONSTRAINT "chk_del_cancel_reason" CHECK ("status" <> 'CANCELLED' OR ("cancel_reason" IS NOT NULL AND "cancelled_at" IS NOT NULL));--> statement-breakpoint

ALTER TABLE "delivery_task_events" DROP CONSTRAINT IF EXISTS "chk_del_evt_type";--> statement-breakpoint
ALTER TABLE "delivery_task_events" ADD CONSTRAINT "chk_del_evt_type" CHECK ("event_type" IN ('CREATED', 'ASSIGNED', 'REASSIGNED', 'DISPATCHED', 'DELIVERED', 'EXCEPTION', 'RETRIED', 'CANCELLED', 'RESOLVED', 'UPDATED'));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "delivery_task_items" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" text,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"delivered_quantity" integer,
	"undelivered_reason" text,
	"undelivered_disposition" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "uq_dti_task_line" UNIQUE("task_id", "line_no"),
	CONSTRAINT "chk_dti_qty" CHECK ("quantity" > 0),
	CONSTRAINT "chk_dti_delivered" CHECK ("delivered_quantity" IS NULL OR ("delivered_quantity" >= 0 AND "delivered_quantity" <= "quantity")),
	CONSTRAINT "chk_dti_disposition" CHECK ("undelivered_disposition" IS NULL OR "undelivered_disposition" IN ('RETURNED', 'WITH_STAFF', 'DISCARDED'))
);--> statement-breakpoint
ALTER TABLE "delivery_task_items" ADD CONSTRAINT "delivery_task_items_task_fk" FOREIGN KEY ("task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dti_task" ON "delivery_task_items" ("task_id");--> statement-breakpoint

ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "undelivered_disposition" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "chk_oi_disposition" CHECK ("undelivered_disposition" IS NULL OR "undelivered_disposition" IN ('RETURNED', 'WITH_STAFF', 'DISCARDED'));--> statement-breakpoint

ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "manifest_prepared_at" text;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "manifest_prepared_by" text;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "manifest_trigger" text;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "manifest_last_run_at" text;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "manifest_last_run_by" text;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD CONSTRAINT "chk_plan_manifest_trigger" CHECK ("manifest_trigger" IS NULL OR "manifest_trigger" IN ('AUTO', 'MANUAL'));--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_del_task_plan_subscription" ON "delivery_tasks" ("plan_id", "subscription_id") WHERE "subscription_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "subscription_day_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"service_date" text NOT NULL,
	"meal_type" text NOT NULL,
	"action" text NOT NULL,
	"quantity" integer,
	"reason" text,
	"after_cutoff" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "uq_sdo_sub_date_meal" UNIQUE("subscription_id", "service_date", "meal_type"),
	CONSTRAINT "chk_sdo_meal" CHECK ("meal_type" IN ('BREAKFAST', 'LUNCH', 'DINNER')),
	CONSTRAINT "chk_sdo_action" CHECK ("action" IN ('SKIP', 'EXTRA')),
	CONSTRAINT "chk_sdo_qty" CHECK (("action" = 'SKIP' AND "quantity" IS NULL) OR ("action" = 'EXTRA' AND "quantity" >= 1)),
	CONSTRAINT "chk_sdo_after_cutoff" CHECK ("after_cutoff" IN (0, 1)),
	CONSTRAINT "chk_sdo_cutoff_reason" CHECK ("after_cutoff" = 0 OR "reason" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "subscription_day_overrides" ADD CONSTRAINT "subscription_day_overrides_sub_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."tiffin_subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sdo_date_meal" ON "subscription_day_overrides" ("service_date", "meal_type");--> statement-breakpoint

ALTER TABLE "resident_meal_preferences" ADD COLUMN IF NOT EXISTS "lunch_room_delivery" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "resident_meal_preferences" ADD COLUMN IF NOT EXISTS "dinner_room_delivery" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "resident_meal_preferences" ADD CONSTRAINT "chk_meal_pref_lrd" CHECK ("lunch_room_delivery" IN (0, 1));--> statement-breakpoint
ALTER TABLE "resident_meal_preferences" ADD CONSTRAINT "chk_meal_pref_drd" CHECK ("dinner_room_delivery" IN (0, 1));--> statement-breakpoint
ALTER TABLE "resident_meal_records" ADD COLUMN IF NOT EXISTS "room_delivery" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "resident_meal_records" ADD CONSTRAINT "chk_res_meal_room_delivery" CHECK ("room_delivery" IN (0, 1));--> statement-breakpoint

ALTER TABLE "delivery_collections" ADD COLUMN IF NOT EXISTS "service_date" text;--> statement-breakpoint
-- UPI is paid straight into the PG account: such a payment is booked at once and linked here, so
-- it is never part of a staff member's custody or a cash handover.
ALTER TABLE "delivery_collections" ADD COLUMN IF NOT EXISTS "transaction_id" text;--> statement-breakpoint
UPDATE "delivery_collections" dc SET "service_date" = t."service_date" FROM "delivery_tasks" t WHERE t."id" = dc."delivery_task_id" AND dc."service_date" IS NULL;--> statement-breakpoint
