-- Task 01B.52: Resident Checkout, Final Settlement & Security Deposit Refunds

-- 1. Update financial_transactions check constraint to allow DEPOSIT_REFUND
DO $$ BEGIN
  ALTER TABLE "financial_transactions" DROP CONSTRAINT IF EXISTS "chk_fin_tx_type";
  ALTER TABLE "financial_transactions" ADD CONSTRAINT "chk_fin_tx_type" CHECK ("transaction_type" IN ('RENT_CHARGE', 'RENT_PAYMENT', 'SECURITY_DEPOSIT', 'EXPENSE', 'REVERSAL', 'TIFFIN_CHARGE', 'TIFFIN_PAYMENT', 'DEPOSIT_REFUND'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 2. Create resident_settlements table
CREATE TABLE IF NOT EXISTS "resident_settlements" (
  "id" text PRIMARY KEY NOT NULL,
  "resident_id" text NOT NULL,
  "stay_id" text NOT NULL,
  "room_id" text NOT NULL,
  "checkout_date" text NOT NULL,
  "outstanding_rent_amount" integer DEFAULT 0 NOT NULL,
  "deposit_held_amount" integer DEFAULT 0 NOT NULL,
  "deductions_amount" integer DEFAULT 0 NOT NULL,
  "deductions_breakdown" text,
  "deposit_applied_amount" integer DEFAULT 0 NOT NULL,
  "refund_amount" integer DEFAULT 0 NOT NULL,
  "refund_payment_method" text,
  "refund_transaction_id" text,
  "remaining_payable_amount" integer DEFAULT 0 NOT NULL,
  "payment_transaction_id" text,
  "settlement_status" text DEFAULT 'SETTLED' NOT NULL,
  "notes" text,
  "settled_by" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "resident_settlements_stay_id_unique" UNIQUE("stay_id")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "resident_settlements_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "resident_settlements_stay_id_resident_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."resident_stays"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "resident_settlements_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "resident_settlements_refund_tx_fk" FOREIGN KEY ("refund_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "resident_settlements_payment_tx_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."financial_transactions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "resident_settlements_settled_by_staff_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_resident_settlements_resident" ON "resident_settlements" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resident_settlements_status" ON "resident_settlements" USING btree ("settlement_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_resident_settlements_checkout_date" ON "resident_settlements" USING btree ("checkout_date");--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "chk_settlement_rent" CHECK ("outstanding_rent_amount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "chk_settlement_deposit" CHECK ("deposit_held_amount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "chk_settlement_deductions" CHECK ("deductions_amount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "chk_settlement_applied" CHECK ("deposit_applied_amount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "chk_settlement_refund" CHECK ("refund_amount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "chk_settlement_payable" CHECK ("remaining_payable_amount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "resident_settlements" ADD CONSTRAINT "chk_settlement_status" CHECK ("settlement_status" IN ('SETTLED', 'PENDING_PAYMENT'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
