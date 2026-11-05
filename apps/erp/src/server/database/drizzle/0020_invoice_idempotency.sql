-- Invoice idempotency and one active tiffin invoice per subscription and month (additive).
-- 1. idempotency_key: one invoice per invoice-creation operation; a retry of the same operation
--    (double click, network retry) returns the first invoice instead of creating another.
-- 2. billing_month: the canonical month (YYYY-MM) of the free-text billing_period, so "Nov 2026",
--    "November 2026" and "2026-11" are one month. Filled here for existing rows whose period is a
--    recognisable month; other text stays NULL and is not constrained.
-- 3. At most one active (not cancelled) TIFFIN invoice per customer, subscription and month. Manual
--    tiffin invoices (no subscription) and resident invoices are not constrained, so separate
--    invoices the business already issues stay possible. The migration STOPS (nothing is applied)
--    if existing data already breaks the rule; run scripts/scan-invoice-duplicates.js to list the
--    rows. No existing invoice is changed or deleted (only the new billing_month column is filled).
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "billing_month" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_billing_month" CHECK ("billing_month" IS NULL OR "billing_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoices_idempotency" ON "invoices" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
UPDATE "invoices" AS i SET "billing_month" = x.month
FROM (
  SELECT s.id,
    CASE
      WHEN s.p ~ '^[0-9]{4}[-/](0?[1-9]|1[0-2])$'
        THEN split_part(translate(s.p, '/', '-'), '-', 1) || '-' || lpad(split_part(translate(s.p, '/', '-'), '-', 2), 2, '0')
      WHEN s.p ~ '^(0?[1-9]|1[0-2])[-/][0-9]{4}$'
        THEN split_part(translate(s.p, '/', '-'), '-', 2) || '-' || lpad(split_part(translate(s.p, '/', '-'), '-', 1), 2, '0')
      WHEN s.p ~ '^[a-z]+\.?[ ,/-]*[0-9]{4}$'
        THEN (
          SELECT substring(s.p from '([0-9]{4})$') || '-' || lpad(mn.n::text, 2, '0')
          FROM (VALUES (1, 'january'), (2, 'february'), (3, 'march'), (4, 'april'), (5, 'may'), (6, 'june'),
                       (7, 'july'), (8, 'august'), (9, 'september'), (10, 'october'), (11, 'november'), (12, 'december')) AS mn(n, name)
          WHERE mn.name = substring(s.p from '^([a-z]+)')
             OR (length(substring(s.p from '^([a-z]+)')) >= 3 AND mn.name LIKE substring(s.p from '^([a-z]+)') || '%')
             OR (substring(s.p from '^([a-z]+)') = 'sept' AND mn.n = 9)
          ORDER BY mn.n
          LIMIT 1
        )
      ELSE NULL
    END AS month
  FROM (SELECT id, lower(regexp_replace(btrim("billing_period"), '\s+', ' ', 'g')) AS p FROM "invoices" WHERE "billing_month" IS NULL) AS s
) AS x
WHERE i.id = x.id AND x.month IS NOT NULL;--> statement-breakpoint
DO $$
DECLARE dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT "customer_id", "subscription_id", "billing_month"
    FROM "invoices"
    WHERE "status" <> 'CANCELLED' AND "invoice_category" = 'TIFFIN' AND "subscription_id" IS NOT NULL AND "billing_month" IS NOT NULL
    GROUP BY "customer_id", "subscription_id", "billing_month"
    HAVING COUNT(*) > 1
  ) AS d;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Migration 0020 stopped: % tiffin subscription month(s) already have more than one active invoice. Nothing was changed. Run scripts/scan-invoice-duplicates.js to list them and resolve them before applying this migration.', dup_count;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_invoices_tiffin_sub_month" ON "invoices" ("customer_id", "subscription_id", "billing_month") WHERE "status" <> 'CANCELLED' AND "invoice_category" = 'TIFFIN' AND "subscription_id" IS NOT NULL AND "billing_month" IS NOT NULL;
