-- 0026: a one-thali plan can be taken at any meal (lunch or dinner, the customer chooses each day).
-- Such a plan has meal_types ANY: no automatic daily delivery; the thali is taken as an order.
-- Additive: every subscription that was valid before stays valid.
ALTER TABLE "tiffin_subscriptions" DROP CONSTRAINT IF EXISTS "chk_tiffin_sub_meal_types";--> statement-breakpoint
ALTER TABLE "tiffin_subscriptions" ADD CONSTRAINT "chk_tiffin_sub_meal_types" CHECK ("meal_types" IN ('LUNCH', 'DINNER', 'BOTH', 'BREAKFAST', 'ANY'));
