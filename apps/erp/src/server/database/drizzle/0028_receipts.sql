-- 0028: receipts as documents. A receipt is a numbered copy of money received (rent, tiffin,
-- deposit, other), kept on record with a share link. One receipt per payment; its copy is
-- refreshed if the payment is edited, the number and link stay. Additive.
CREATE TABLE IF NOT EXISTS "receipts" (
  "id" text PRIMARY KEY,
  "receipt_number" text NOT NULL,
  "share_token" text NOT NULL,
  "transaction_id" text NOT NULL REFERENCES "financial_transactions" ("id"),
  "account_name" text NOT NULL,
  "account_phone" text,
  "amount" numeric(12, 2) NOT NULL,
  "receipt_date" text NOT NULL,
  "snapshot" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_receipts_number" ON "receipts" ("receipt_number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_receipts_token" ON "receipts" ("share_token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_receipts_transaction" ON "receipts" ("transaction_id");
