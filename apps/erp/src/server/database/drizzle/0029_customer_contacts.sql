-- Corporate customers (owner, 2026-11-12): the person the PG staff deal with, and a default thali
-- that only pre-fills the order form (the price always comes from the menu when the order is taken).
ALTER TABLE "tiffin_customers" ADD COLUMN IF NOT EXISTS "contact_person" text;--> statement-breakpoint
ALTER TABLE "tiffin_customers" ADD COLUMN IF NOT EXISTS "default_product_id" text;
