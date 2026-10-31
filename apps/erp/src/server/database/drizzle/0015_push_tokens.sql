-- Phones of signed-in staff that receive new-order alerts (Firebase Cloud Messaging tokens).
-- One row per app install; the token moves to whoever signs in on that phone, and is removed on
-- sign-out or when Firebase reports it is no longer valid.
CREATE TABLE IF NOT EXISTS "push_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text DEFAULT 'android' NOT NULL,
	"created_at" text NOT NULL,
	"last_used_at" text
);--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_staff_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_tokens_token" ON "push_tokens" ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_push_tokens_staff" ON "push_tokens" ("staff_id");
