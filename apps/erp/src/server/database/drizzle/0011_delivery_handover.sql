-- Task 01B.58: Delivery Collection Handover, Offline Resilience & Synchronization
-- Migration 0011: Add collection fields to delivery_tasks and create driver_cash_handovers table

ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "collection_status" text DEFAULT 'NONE' NOT NULL;
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "collected_amount" integer DEFAULT 0 NOT NULL;
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "collected_payment_method" text;
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "collection_transaction_id" text;
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "collection_idempotency_key" text;
ALTER TABLE "delivery_tasks" ADD COLUMN IF NOT EXISTS "handover_id" text;

CREATE INDEX IF NOT EXISTS "idx_del_tasks_collection_status" ON "delivery_tasks" ("collection_status");
CREATE INDEX IF NOT EXISTS "idx_del_tasks_handover" ON "delivery_tasks" ("handover_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_del_tasks_coll_idempotency" ON "delivery_tasks" ("collection_idempotency_key");

CREATE TABLE IF NOT EXISTS "driver_cash_handovers" (
  "id" text PRIMARY KEY NOT NULL,
  "driver_id" text NOT NULL REFERENCES "staff_users"("id") ON DELETE restrict,
  "shift_date" text NOT NULL,
  "declared_cash" integer DEFAULT 0 NOT NULL,
  "accepted_cash" integer DEFAULT 0 NOT NULL,
  "variance" integer DEFAULT 0 NOT NULL,
  "variance_reason" text,
  "status" text DEFAULT 'DECLARED' NOT NULL,
  "transaction_id" text REFERENCES "financial_transactions"("id") ON DELETE set null,
  "accepted_by" text REFERENCES "staff_users"("id") ON DELETE set null,
  "accepted_at" text,
  "notes" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "chk_dch_declared" CHECK ("declared_cash" >= 0),
  CONSTRAINT "chk_dch_accepted" CHECK ("accepted_cash" >= 0),
  CONSTRAINT "chk_dch_status" CHECK ("status" IN ('DECLARED', 'ACCEPTED', 'DISCREPANCY_FLAGGED'))
);

CREATE INDEX IF NOT EXISTS "idx_dch_driver" ON "driver_cash_handovers" ("driver_id");
CREATE INDEX IF NOT EXISTS "idx_dch_shift_date" ON "driver_cash_handovers" ("shift_date");
CREATE INDEX IF NOT EXISTS "idx_dch_status" ON "driver_cash_handovers" ("status");
CREATE INDEX IF NOT EXISTS "idx_dch_tx" ON "driver_cash_handovers" ("transaction_id");
