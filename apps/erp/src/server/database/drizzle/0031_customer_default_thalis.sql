-- Corporate customers (owner, 2026-11-13): the usual number of thalis of a company. It only
-- pre-fills the order form with that many thalis; the count and the price are set on each order.
ALTER TABLE "tiffin_customers" ADD COLUMN IF NOT EXISTS "default_thali_quantity" integer;
