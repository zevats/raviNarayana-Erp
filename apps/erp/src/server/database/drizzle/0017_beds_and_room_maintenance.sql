-- Individual beds and room maintenance (additive; no existing row is changed or removed).
--
-- room_beds: one row per bed. Existing rooms get "Bed 1" … "Bed N" for their current capacity.
-- Existing resident stays keep bed_id NULL ("bed not chosen yet"): no resident is placed in a
-- particular bed by this migration. rooms.capacity stays and is kept equal to the room's bed count.
-- A bed holds at most one ACTIVE stay (unique partial index). A bed can be taken out of service
-- (not offered for new check-ins) without deleting it, so history keeps its bed.
CREATE TABLE IF NOT EXISTS "room_beds" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'IN_SERVICE' NOT NULL,
	"notes" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_room_beds_status" CHECK ("room_beds"."status" IN ('IN_SERVICE', 'OUT_OF_SERVICE'))
);--> statement-breakpoint
ALTER TABLE "room_beds" ADD CONSTRAINT "room_beds_room_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_room_beds_label" ON "room_beds" ("room_id", lower("label"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_room_beds_room" ON "room_beds" ("room_id");--> statement-breakpoint
ALTER TABLE "resident_stays" ADD COLUMN IF NOT EXISTS "bed_id" text;--> statement-breakpoint
ALTER TABLE "resident_stays" ADD CONSTRAINT "resident_stays_bed_fk" FOREIGN KEY ("bed_id") REFERENCES "public"."room_beds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_one_active_stay_per_bed" ON "resident_stays" ("bed_id") WHERE "status" = 'ACTIVE' AND "bed_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "room_beds" ("id", "room_id", "label", "status", "created_at", "updated_at")
SELECT 'bed_' || md5(r."id" || ':' || g.n::text), r."id", 'Bed ' || g.n::text, 'IN_SERVICE', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM "rooms" r
CROSS JOIN LATERAL generate_series(1, r."capacity") AS g(n)
WHERE NOT EXISTS (SELECT 1 FROM "room_beds" b WHERE b."room_id" = r."id");--> statement-breakpoint
-- Room maintenance: while a record is OPEN no new resident can be checked in or transferred into
-- the room. Residents already living there are not moved or checked out by it.
CREATE TABLE IF NOT EXISTS "room_maintenance" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"reason" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"completion_note" text,
	"started_by" text,
	"completed_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "chk_room_maintenance_status" CHECK ("room_maintenance"."status" IN ('OPEN', 'COMPLETED')),
	CONSTRAINT "chk_room_maintenance_dates" CHECK ("room_maintenance"."end_date" IS NULL OR "room_maintenance"."end_date" >= "room_maintenance"."start_date")
);--> statement-breakpoint
ALTER TABLE "room_maintenance" ADD CONSTRAINT "room_maintenance_room_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_maintenance" ADD CONSTRAINT "room_maintenance_started_by_fk" FOREIGN KEY ("started_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_maintenance" ADD CONSTRAINT "room_maintenance_completed_by_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_room_maintenance_one_open" ON "room_maintenance" ("room_id") WHERE "status" = 'OPEN';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_room_maintenance_room" ON "room_maintenance" ("room_id", "start_date");
