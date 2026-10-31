-- ISSUE-008 / ISSUE-024: first-class order storage.
-- Migration 0012: orders + order_items. Additive only; no existing table or row is modified.
--
-- Before this migration an order existed only as a delivery task (items serialized as
-- "[ORDER_JSON:{...}]" inside delivery_tasks.delivery_notes) or as a TIFFIN_WALKIN_SALE ledger
-- row (same JSON appended to financial_transactions.description). Legacy rows are converted by
-- the idempotent application backfill (orderService.backfillLegacyOrders / scripts/backfill-orders.js),
-- never by this migration, so the migration itself cannot fail on malformed legacy text.
--
-- Status ownership: orders.status is the order lifecycle (CONFIRMED -> COMPLETED, or CANCELLED).
-- Delivery progress (ASSIGNED / OUT_FOR_DELIVERY / DELIVERED / EXCEPTION) stays on delivery_tasks
-- and is read through orders.delivery_task_id, so there is exactly one writer per state.

CREATE TABLE IF NOT EXISTS "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"order_type" text NOT NULL,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"service_date" text NOT NULL,
	"meal_type" text NOT NULL,
	"customer_id" text,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"delivery_address" text,
	"delivery_task_id" text,
	"financial_transaction_id" text,
	"total_quantity" integer NOT NULL,
	"total_amount" integer NOT NULL,
	"payment_method" text,
	"notes" text,
	"idempotency_key" text,
	"source" text DEFAULT 'APP' NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "orders_delivery_task_id_unique" UNIQUE("delivery_task_id"),
	CONSTRAINT "orders_financial_transaction_id_unique" UNIQUE("financial_transaction_id"),
	CONSTRAINT "chk_orders_type" CHECK ("order_type" IN ('DELIVERY', 'DINE_IN')),
	CONSTRAINT "chk_orders_status" CHECK ("status" IN ('CONFIRMED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "chk_orders_meal" CHECK ("meal_type" IN ('BREAKFAST', 'LUNCH', 'DINNER')),
	CONSTRAINT "chk_orders_source" CHECK ("source" IN ('APP', 'LEGACY_BACKFILL')),
	CONSTRAINT "chk_orders_qty" CHECK ("total_quantity" > 0),
	CONSTRAINT "chk_orders_amount" CHECK ("total_amount" >= 0),
	CONSTRAINT "chk_orders_payment_method" CHECK ("payment_method" IS NULL OR "payment_method" IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER')),
	-- A delivery order is always backed by its delivery task; a dine-in order by its ledger sale.
	CONSTRAINT "chk_orders_links" CHECK (
		("order_type" = 'DELIVERY' AND "delivery_task_id" IS NOT NULL AND "financial_transaction_id" IS NULL)
		OR ("order_type" = 'DINE_IN' AND "financial_transaction_id" IS NOT NULL AND "delivery_task_id" IS NULL)
	)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" text,
	"product_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"line_total" integer NOT NULL,
	"delivered_quantity" integer,
	"undelivered_reason" text,
	"created_at" text NOT NULL,
	CONSTRAINT "order_items_order_line_unique" UNIQUE("order_id", "line_no"),
	CONSTRAINT "chk_order_items_qty" CHECK ("quantity" > 0),
	CONSTRAINT "chk_order_items_price" CHECK ("unit_price" >= 0),
	CONSTRAINT "chk_order_items_total" CHECK ("line_total" = "quantity" * "unit_price"),
	CONSTRAINT "chk_order_items_delivered" CHECK ("delivered_quantity" IS NULL OR ("delivered_quantity" >= 0 AND "delivered_quantity" <= "quantity"))
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_tiffin_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."tiffin_customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_task_id_delivery_tasks_id_fk" FOREIGN KEY ("delivery_task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_financial_transaction_id_financial_transactions_id_fk" FOREIGN KEY ("financial_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_tiffin_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."tiffin_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_service_date" ON "orders" ("service_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_customer" ON "orders" ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_customer_phone" ON "orders" ("customer_phone");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_orders_type_date" ON "orders" ("order_type", "service_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_order_items_product" ON "order_items" ("product_id");
