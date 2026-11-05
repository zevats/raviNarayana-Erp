-- Pay Later for delivery orders (additive).
-- 1. tiffin_customers.pay_later_enabled: the Owner or a Manager allows this customer to receive a
--    delivery without paying in full at the door. Who changed it last and when are kept here; every
--    change (previous and new state) is also an audit_logs entry. No credit limit.
-- 2. orders.payment_choice: what was chosen at the door (CASH, UPI or PAY_LATER); NULL for orders
--    delivered before this migration and for orders not yet delivered. The amount due, the amount
--    collected and the payment status are NOT stored: they come from the order lines and the
--    delivery collections that still count, so they cannot drift from the money actually received.
-- 3. orders.payment_review: set when a balance was left for a customer who is not approved for Pay
--    Later (e.g. an offline delivery synced after the approval was withdrawn). The delivery is kept;
--    a Manager reviews it (payment_reviewed_by / _at). payment_review_detail keeps the evidence.
ALTER TABLE "tiffin_customers" ADD COLUMN IF NOT EXISTS "pay_later_enabled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiffin_customers" ADD COLUMN IF NOT EXISTS "pay_later_updated_by" text;--> statement-breakpoint
ALTER TABLE "tiffin_customers" ADD COLUMN IF NOT EXISTS "pay_later_updated_at" text;--> statement-breakpoint
ALTER TABLE "tiffin_customers" ADD CONSTRAINT "chk_tiffin_cust_pay_later" CHECK ("pay_later_enabled" IN (0, 1));--> statement-breakpoint
ALTER TABLE "tiffin_customers" ADD CONSTRAINT "tiffin_customers_pay_later_by_fk" FOREIGN KEY ("pay_later_updated_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_choice" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_review" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_review_detail" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_reviewed_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "payment_reviewed_at" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_payment_choice" CHECK ("payment_choice" IS NULL OR "payment_choice" IN ('CASH', 'UPI', 'PAY_LATER'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_payment_review" CHECK ("payment_review" IS NULL OR "payment_review" IN ('PAY_LATER_NOT_APPROVED'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_reviewed_by_fk" FOREIGN KEY ("payment_reviewed_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_payment_review" ON "orders" ("service_date") WHERE "payment_review" IS NOT NULL AND "payment_reviewed_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_type_status_date" ON "orders" ("order_type", "status", "service_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dcol_order" ON "delivery_collections" ("order_id");
