CREATE TABLE "tiffin_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"product_id" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"price" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"meal_types" text DEFAULT 'BOTH' NOT NULL,
	"service_days" text DEFAULT 'ALL_DAYS' NOT NULL,
	"quantity_per_meal" integer DEFAULT 1 NOT NULL,
	"pause_start_date" text,
	"pause_resume_date" text,
	"pause_reason" text,
	"cancelled_at" text,
	"cancellation_reason" text,
	"cancelled_by" text,
	"delivery_address" text NOT NULL,
	"delivery_instructions" text,
	"notes" text,
	"created_by" text NOT NULL,
	"updated_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_tiffin_sub_status" CHECK ("status" IN ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED')),
	CONSTRAINT "chk_tiffin_sub_meal_types" CHECK ("meal_types" IN ('LUNCH', 'DINNER', 'BOTH', 'BREAKFAST')),
	CONSTRAINT "chk_tiffin_sub_service_days" CHECK ("service_days" IN ('ALL_DAYS', 'MON_SAT', 'MON_FRI')),
	CONSTRAINT "chk_tiffin_sub_price" CHECK ("price" >= 0),
	CONSTRAINT "chk_tiffin_sub_qty" CHECK ("quantity_per_meal" >= 1)
);
--> statement-breakpoint

ALTER TABLE "tiffin_subscriptions" ADD CONSTRAINT "tiffin_subscriptions_customer_id_tiffin_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."tiffin_customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiffin_subscriptions" ADD CONSTRAINT "tiffin_subscriptions_product_id_tiffin_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."tiffin_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiffin_subscriptions" ADD CONSTRAINT "tiffin_subscriptions_cancelled_by_staff_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiffin_subscriptions" ADD CONSTRAINT "tiffin_subscriptions_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiffin_subscriptions" ADD CONSTRAINT "tiffin_subscriptions_updated_by_staff_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "idx_tiffin_sub_customer" ON "tiffin_subscriptions" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "idx_tiffin_sub_product" ON "tiffin_subscriptions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_tiffin_sub_status" ON "tiffin_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tiffin_sub_start_date" ON "tiffin_subscriptions" USING btree ("start_date");
