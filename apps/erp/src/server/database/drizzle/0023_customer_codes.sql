-- Readable tiffin customer codes (additive): TC-0001, TC-0002, ... in the order customers were added.
-- The internal id is unchanged (every link keeps working); the code is what people see and search.
ALTER TABLE "tiffin_customers" ADD COLUMN IF NOT EXISTS "customer_code" text;--> statement-breakpoint
UPDATE "tiffin_customers" AS c SET "customer_code" = 'TC-' || lpad(x.n::text, 4, '0')
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS n FROM "tiffin_customers") AS x
WHERE c."id" = x."id" AND c."customer_code" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_tiffin_customers_code" ON "tiffin_customers" ("customer_code") WHERE "customer_code" IS NOT NULL;
