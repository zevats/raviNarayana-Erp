-- Business settings the Owner can change (business details, meal times and cutoffs, default
-- delivery partner, rent due day, notification preferences). One row per setting key; the value
-- is JSON. A key without a row uses the built-in default, so existing deployments behave as
-- before until the Owner saves a change. Changes are also written to audit_logs.
CREATE TABLE IF NOT EXISTS "business_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_by" text,
	"updated_at" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_updated_by_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;
