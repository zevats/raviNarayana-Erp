-- Thalis carried by staff (owner, 2026-11-12). One row per movement:
--   HELD     a thali not delivered and brought back by the staff member (+ with them)
--   EXTRA    a thali delivered beyond the order at the door (- from what they hold)
--   DAMAGED  a damaged thali (a loss; - from what they hold when reported later)
--   RETURN   thalis handed back to the PG (- from them); verified by the owner or a manager,
--            the count received goes into the PG's spare stock
--   SHORT    on verification, thalis declared but not received stay with the staff member (+)
--   ISSUED   spare thalis from the PG given to a staff member for other deliveries (+ to them,
--            - from the PG's spare stock)
-- staff_delta / stock_delta are the effect on the staff member's count and on the PG's spare stock.
CREATE TABLE IF NOT EXISTS "thali_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"staff_delta" integer DEFAULT 0 NOT NULL,
	"stock_delta" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'DONE' NOT NULL,
	"task_id" text,
	"order_id" text,
	"product_name" text,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"verified_by" text,
	"verified_at" text,
	"verified_quantity" integer,
	CONSTRAINT "chk_thali_moves_kind" CHECK ("kind" IN ('HELD', 'EXTRA', 'DAMAGED', 'RETURN', 'SHORT', 'ISSUED')),
	CONSTRAINT "chk_thali_moves_status" CHECK ("status" IN ('DONE', 'PENDING', 'VERIFIED')),
	CONSTRAINT "chk_thali_moves_qty" CHECK ("quantity" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thali_moves_staff" ON "thali_moves" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thali_moves_status" ON "thali_moves" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_thali_moves_task" ON "thali_moves" USING btree ("task_id");
