-- Checkout settlements prepared by a Manager that move deposit money (refund, deduction or deposit
-- applied to rent) wait here for the Owner's approval. Nothing is posted and the stay stays open
-- until the Owner approves (the settlement is then finalized in the same transaction) or rejects.
CREATE TABLE IF NOT EXISTS "settlement_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"resident_id" text NOT NULL,
	"stay_id" text NOT NULL,
	"checkout_date" text NOT NULL,
	"payload" text NOT NULL,
	"refund_amount" integer DEFAULT 0 NOT NULL,
	"deductions_amount" integer DEFAULT 0 NOT NULL,
	"deposit_applied_amount" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"proposed_by" text NOT NULL,
	"decided_by" text,
	"decided_at" text,
	"decision_note" text,
	"settlement_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_settlement_proposals_status" CHECK ("settlement_proposals"."status" IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'))
);--> statement-breakpoint
ALTER TABLE "settlement_proposals" ADD CONSTRAINT "settlement_proposals_resident_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_proposals" ADD CONSTRAINT "settlement_proposals_stay_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."resident_stays"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_proposals" ADD CONSTRAINT "settlement_proposals_proposed_by_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_proposals" ADD CONSTRAINT "settlement_proposals_decided_by_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_settlement_proposals_one_pending" ON "settlement_proposals" ("stay_id") WHERE "status" = 'PENDING';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_settlement_proposals_status" ON "settlement_proposals" ("status", "created_at");
