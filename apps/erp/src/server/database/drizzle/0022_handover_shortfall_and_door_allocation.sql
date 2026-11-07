-- Cash handover shortfalls and door payments beyond the current order (additive).
-- 1. driver_cash_handovers: declared_cash is now the cash physically handed over; recorded_cash is
--    the cash the system had recorded for the collections in the declaration. The difference is a
--    shortfall that stays owed by the employee (their custody balance) until it is handed over later
--    or written off by the Owner with a reason (written_off_*). Existing declarations had handed =
--    recorded, so recorded_cash is filled from declared_cash and nothing changes for them.
-- 2. delivery_collections.allocation: what a door payment paid: the stop's own ORDER, an earlier
--    order's PREVIOUS_DUES, or an ADVANCE (customer credit). collected_at_task_id is the stop where
--    the money was taken, so custody and audit follow the cash. Existing rows are ORDER.
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "recorded_cash" integer;--> statement-breakpoint
UPDATE "driver_cash_handovers" SET "recorded_cash" = "declared_cash" WHERE "recorded_cash" IS NULL;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ALTER COLUMN "recorded_cash" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ALTER COLUMN "recorded_cash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "shortfall_reason" text;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "written_off_cash" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "written_off_by" text;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "written_off_at" text;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "write_off_reason" text;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD CONSTRAINT "chk_dch_recorded" CHECK ("recorded_cash" >= 0);--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD CONSTRAINT "chk_dch_written_off" CHECK ("written_off_cash" >= 0);--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD CONSTRAINT "driver_cash_handovers_written_off_by_fk" FOREIGN KEY ("written_off_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_collections" ADD COLUMN IF NOT EXISTS "allocation" text DEFAULT 'ORDER' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_collections" ADD COLUMN IF NOT EXISTS "collected_at_task_id" text;--> statement-breakpoint
ALTER TABLE "delivery_collections" ADD CONSTRAINT "chk_dcol_allocation" CHECK ("allocation" IN ('ORDER', 'PREVIOUS_DUES', 'ADVANCE'));--> statement-breakpoint
ALTER TABLE "delivery_collections" ADD CONSTRAINT "delivery_collections_collected_at_task_fk" FOREIGN KEY ("collected_at_task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE restrict ON UPDATE no action;
