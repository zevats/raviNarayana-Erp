-- 0027: bills as documents. A bill is a numbered copy of what an account owes on the day it is
-- made (GST or non-GST). It never changes what is owed: dues stay until money is received, and
-- more bills can be made for the same dues. A payment may name the bill it was paid against
-- (bill_payments); that is a record only, the money always settles the oldest dues first.
-- Additive: no existing table or row is changed.
CREATE TABLE IF NOT EXISTS "bill_counters" (
  "series" text PRIMARY KEY,
  "last_number" integer NOT NULL DEFAULT 0,
  "updated_at" text NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bills" (
  "id" text PRIMARY KEY,
  "bill_number" text NOT NULL,
  "share_token" text NOT NULL,
  "account_key" text NOT NULL,
  "account_kind" text NOT NULL,
  "account_name" text NOT NULL,
  "account_phone" text,
  "bill_type" text NOT NULL,
  "gst_rate" numeric(5, 2) NOT NULL DEFAULT 0,
  "issue_date" text NOT NULL,
  "total_amount" numeric(12, 2) NOT NULL,
  "taxable_amount" numeric(12, 2) NOT NULL,
  "cgst_amount" numeric(12, 2) NOT NULL DEFAULT 0,
  "sgst_amount" numeric(12, 2) NOT NULL DEFAULT 0,
  "snapshot" text NOT NULL,
  "batch_id" text,
  "created_by" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "chk_bills_type" CHECK ("bill_type" IN ('GST', 'NON_GST')),
  CONSTRAINT "chk_bills_kind" CHECK ("account_kind" IN ('RESIDENT', 'CUSTOMER', 'ORDER')),
  CONSTRAINT "chk_bills_total" CHECK ("total_amount" > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bills_number" ON "bills" ("bill_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bills_token" ON "bills" ("share_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bills_account" ON "bills" ("account_key", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bills_created" ON "bills" ("created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bill_payments" (
  "id" text PRIMARY KEY,
  "bill_id" text NOT NULL REFERENCES "bills" ("id"),
  "bill_number" text NOT NULL,
  "account_key" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "payment_method" text NOT NULL,
  "payment_date" text NOT NULL,
  "payment_key" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "chk_bill_payments_amount" CHECK ("amount" > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bill_payments_key" ON "bill_payments" ("payment_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bill_payments_bill" ON "bill_payments" ("bill_id");
