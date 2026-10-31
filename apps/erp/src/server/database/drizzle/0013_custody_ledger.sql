-- Migration 0013: staff-wise custody ledger (round 9).
-- Additive only: one new table, four new nullable/defaulted columns on driver_cash_handovers,
-- and a one-time copy of existing delivery collections. No existing row is modified.
--
-- Before this migration a delivery task held ONE running collected total and method, and custody
-- was credited to the task's ASSIGNED driver. A balance paid later, or money received by a
-- different staff member, could not be told apart, and handovers carried cash only.
-- delivery_collections records each payment separately: who collected it (stable staff id),
-- how (CASH / UPI ...), for which delivery/order, and which handover declared it.

CREATE TABLE IF NOT EXISTS "delivery_collections" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_task_id" text NOT NULL,
	"order_id" text,
	"collected_by" text NOT NULL,
	"amount" integer NOT NULL,
	"payment_method" text NOT NULL,
	"collected_at" text NOT NULL,
	"handover_id" text,
	"idempotency_key" text,
	"source" text DEFAULT 'APP' NOT NULL,
	"notes" text,
	"created_at" text NOT NULL,
	CONSTRAINT "delivery_collections_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "chk_dcol_amount" CHECK ("amount" > 0),
	CONSTRAINT "chk_dcol_method" CHECK ("payment_method" IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER')),
	CONSTRAINT "chk_dcol_source" CHECK ("source" IN ('APP', 'BACKFILL'))
);
--> statement-breakpoint
ALTER TABLE "delivery_collections" ADD CONSTRAINT "delivery_collections_task_fk" FOREIGN KEY ("delivery_task_id") REFERENCES "public"."delivery_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_collections" ADD CONSTRAINT "delivery_collections_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_collections" ADD CONSTRAINT "delivery_collections_collected_by_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_collections" ADD CONSTRAINT "delivery_collections_handover_fk" FOREIGN KEY ("handover_id") REFERENCES "public"."driver_cash_handovers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dcol_collector_handover" ON "delivery_collections" ("collected_by", "handover_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dcol_task" ON "delivery_collections" ("delivery_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dcol_handover" ON "delivery_collections" ("handover_id");--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "declared_upi" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "accepted_upi" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "upi_transaction_id" text;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD COLUMN IF NOT EXISTS "declared_by" text;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD CONSTRAINT "chk_dch_declared_upi" CHECK ("declared_upi" >= 0);--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD CONSTRAINT "chk_dch_accepted_upi" CHECK ("accepted_upi" >= 0);--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD CONSTRAINT "driver_cash_handovers_upi_tx_fk" FOREIGN KEY ("upi_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_cash_handovers" ADD CONSTRAINT "driver_cash_handovers_declared_by_fk" FOREIGN KEY ("declared_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- One-time copy of existing collections (deterministic ids, safe to re-run). Attributed to whoever
-- recorded the delivery (delivered_by), else the assigned driver; linked to its handover only when
-- that handover exists. Rows that cannot be attributed to any staff member are not copied.
INSERT INTO "delivery_collections" ("id", "delivery_task_id", "order_id", "collected_by", "amount", "payment_method", "collected_at", "handover_id", "idempotency_key", "source", "notes", "created_at")
SELECT
	'dcol_bf_' || t."id",
	t."id",
	o."id",
	COALESCE(t."delivered_by", t."assigned_to"),
	t."collected_amount",
	CASE WHEN t."collected_payment_method" IN ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER') THEN t."collected_payment_method" ELSE 'CASH' END,
	COALESCE(t."delivered_at", t."updated_at"),
	CASE WHEN t."collection_status" = 'HANDED_OVER' AND EXISTS (SELECT 1 FROM "driver_cash_handovers" h WHERE h."id" = t."handover_id") THEN t."handover_id" ELSE NULL END,
	NULL,
	'BACKFILL',
	'Copied from the delivery task total (migration 0013)',
	to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM "delivery_tasks" t
LEFT JOIN "orders" o ON o."delivery_task_id" = t."id"
WHERE t."collected_amount" > 0
	AND COALESCE(t."delivered_by", t."assigned_to") IS NOT NULL
	AND EXISTS (SELECT 1 FROM "staff_users" s WHERE s."id" = COALESCE(t."delivered_by", t."assigned_to"))
ON CONFLICT ("id") DO NOTHING;
