-- Task 01B.53: Daily Cashbook Closing & Multi-Channel Reconciliation

CREATE TABLE IF NOT EXISTS "daily_cashbook_closings" (
  "id" text PRIMARY KEY NOT NULL,
  "closing_date" text NOT NULL,
  "division" text DEFAULT 'COMBINED' NOT NULL,
  "opening_balance" integer DEFAULT 0 NOT NULL,
  "opening_cash_balance" integer DEFAULT 0 NOT NULL,
  "cash_inflow" integer DEFAULT 0 NOT NULL,
  "upi_inflow" integer DEFAULT 0 NOT NULL,
  "bank_transfer_inflow" integer DEFAULT 0 NOT NULL,
  "cheque_inflow" integer DEFAULT 0 NOT NULL,
  "other_inflow" integer DEFAULT 0 NOT NULL,
  "cash_outflow" integer DEFAULT 0 NOT NULL,
  "upi_outflow" integer DEFAULT 0 NOT NULL,
  "bank_transfer_outflow" integer DEFAULT 0 NOT NULL,
  "cheque_outflow" integer DEFAULT 0 NOT NULL,
  "other_outflow" integer DEFAULT 0 NOT NULL,
  "total_inflow" integer DEFAULT 0 NOT NULL,
  "total_outflow" integer DEFAULT 0 NOT NULL,
  "expected_closing_balance" integer DEFAULT 0 NOT NULL,
  "expected_cash_balance" integer DEFAULT 0 NOT NULL,
  "actual_cash_counted" integer,
  "actual_bank_verified" integer,
  "actual_total_balance" integer,
  "cash_discrepancy" integer DEFAULT 0 NOT NULL,
  "total_discrepancy" integer DEFAULT 0 NOT NULL,
  "discrepancy_reason" text,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "prepared_by" text NOT NULL,
  "finalized_by" text,
  "finalized_at" text,
  "reopened_by" text,
  "reopened_at" text,
  "reopen_reason" text,
  "notes" text,
  "snapshot_data" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "uq_closing_date_div" UNIQUE("closing_date", "division")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "daily_cashbook_closings" ADD CONSTRAINT "daily_cashbook_closings_prepared_by_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "daily_cashbook_closings" ADD CONSTRAINT "daily_cashbook_closings_finalized_by_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "daily_cashbook_closings" ADD CONSTRAINT "daily_cashbook_closings_reopened_by_fk" FOREIGN KEY ("reopened_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_closing_date" ON "daily_cashbook_closings"("closing_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_closing_status" ON "daily_cashbook_closings"("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_closing_division" ON "daily_cashbook_closings"("division");
