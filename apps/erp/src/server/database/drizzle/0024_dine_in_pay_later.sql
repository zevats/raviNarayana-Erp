-- Dine-in orders can be Pay Later (additive): such an order has no cashbook entry until it is paid.
-- The link rule keeps every other case as before: a delivery order has a delivery task and no ledger
-- entry; a dine-in order has a ledger entry, or is marked PAY_LATER and waits for one.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "chk_orders_links";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_links" CHECK (
	("order_type" = 'DELIVERY' AND "delivery_task_id" IS NOT NULL AND "financial_transaction_id" IS NULL)
	OR ("order_type" = 'DINE_IN' AND "delivery_task_id" IS NULL AND ("financial_transaction_id" IS NOT NULL OR "payment_choice" = 'PAY_LATER'))
);
