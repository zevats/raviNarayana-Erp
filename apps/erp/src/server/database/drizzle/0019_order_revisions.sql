-- Order editing and cancellation (additive). Before an order is changed, its previous items,
-- address, notes and totals are kept as a revision; a cancelled order keeps who cancelled it, when
-- and why. Orders are never deleted.
CREATE TABLE IF NOT EXISTS "order_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"revision_no" integer NOT NULL,
	"snapshot" text NOT NULL,
	"reason" text,
	"changed_by" text,
	"created_at" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_order_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_revisions" ADD CONSTRAINT "order_revisions_changed_by_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_order_revisions_no" ON "order_revisions" ("order_id", "revision_no");--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_at" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
