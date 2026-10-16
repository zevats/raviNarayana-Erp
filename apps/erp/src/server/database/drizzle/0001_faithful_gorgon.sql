CREATE TABLE "session_preemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"staff_id" text NOT NULL,
	"preempted_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "session_preemptions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "session_preemptions" ADD CONSTRAINT "session_preemptions_staff_id_staff_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_session_preemptions_token" ON "session_preemptions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_session_preemptions_staff" ON "session_preemptions" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "idx_session_preemptions_expires" ON "session_preemptions" USING btree ("expires_at");