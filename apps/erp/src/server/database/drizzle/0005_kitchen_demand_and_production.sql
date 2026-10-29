ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "planned_tiffin_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "dispatched_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "leftover_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "waste_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "reconciled_by" text;--> statement-breakpoint
ALTER TABLE "daily_meal_plans" ADD COLUMN IF NOT EXISTS "reconciled_at" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_meal_plans" ADD CONSTRAINT "chk_plan_tif_cnt" CHECK ("planned_tiffin_count" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_meal_plans" ADD CONSTRAINT "chk_plan_disp_cnt" CHECK ("dispatched_count" IS NULL OR "dispatched_count" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_meal_plans" ADD CONSTRAINT "chk_plan_left_cnt" CHECK ("leftover_count" IS NULL OR "leftover_count" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_meal_plans" ADD CONSTRAINT "chk_plan_waste_cnt" CHECK ("waste_count" IS NULL OR "waste_count" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_meal_plans" ADD CONSTRAINT "daily_meal_plans_reconciled_by_staff_users_id_fk" FOREIGN KEY ("reconciled_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "subscription_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_subscription_id_tiffin_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."tiffin_subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_del_tasks_sub" ON "delivery_tasks" USING btree ("subscription_id");
