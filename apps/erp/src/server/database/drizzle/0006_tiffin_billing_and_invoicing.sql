-- 1. Extend invoices for Tiffin commercial billing
ALTER TABLE "invoices" ALTER COLUMN "resident_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "customer_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "subscription_id" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "invoice_category" text DEFAULT 'RESIDENT' NOT NULL;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_tiffin_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."tiffin_customers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_tiffin_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."tiffin_subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_category" CHECK ("invoice_category" IN ('RESIDENT', 'TIFFIN'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_invoices_customer" ON "invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_sub" ON "invoices" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_invoices_category" ON "invoices" USING btree ("invoice_category");--> statement-breakpoint

-- 2. Extend invoice_items with subscription and period tracking
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "subscription_id" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "service_start_date" text;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN IF NOT EXISTS "service_end_date" text;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_subscription_id_tiffin_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."tiffin_subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 3. Extend delivery_tasks for billing tracking and duplicate prevention
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "invoice_id" text;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "invoice_item_id" text;--> statement-breakpoint
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "billed_at" text;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "delivery_tasks" ADD CONSTRAINT "delivery_tasks_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_del_tasks_inv" ON "delivery_tasks" USING btree ("invoice_id");--> statement-breakpoint

-- 4. Extend financial_transactions for Tiffin charges and customer payments
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "customer_id" text;--> statement-breakpoint

DO $$ BEGIN
 ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_customer_id_tiffin_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."tiffin_customers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_fin_tx_customer" ON "financial_transactions" USING btree ("customer_id");--> statement-breakpoint

ALTER TABLE "financial_transactions" DROP CONSTRAINT IF EXISTS "chk_fin_tx_type";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "financial_transactions" ADD CONSTRAINT "chk_fin_tx_type" CHECK ("transaction_type" IN ('RENT_CHARGE', 'RENT_PAYMENT', 'SECURITY_DEPOSIT', 'EXPENSE', 'REVERSAL', 'TIFFIN_CHARGE', 'TIFFIN_PAYMENT'));
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
