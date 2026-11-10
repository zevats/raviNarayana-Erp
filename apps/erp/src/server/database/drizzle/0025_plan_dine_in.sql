-- 0025: a dine-in meal covered by the monthly plan of the customer costs nothing, so it has no
-- cashbook entry and is not Pay Later either. Such an order (total 0, no ledger link) is allowed.
-- Additive: every order that was valid before stays valid.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "chk_orders_links";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "chk_orders_links" CHECK (
	("order_type" = 'DELIVERY' AND "delivery_task_id" IS NOT NULL AND "financial_transaction_id" IS NULL)
	OR ("order_type" = 'DINE_IN' AND "delivery_task_id" IS NULL AND ("financial_transaction_id" IS NOT NULL OR "payment_choice" = 'PAY_LATER'))
	OR ("order_type" = 'DINE_IN' AND "delivery_task_id" IS NULL AND "financial_transaction_id" IS NULL AND "total_amount" = 0)
);
