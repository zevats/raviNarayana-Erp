-- Production read-only checks before migrations 0016-0021 (release gate, 2026-11-05).
-- Run through scripts/prod-readonly-checks.js (no psql needed), or paste into the Neon SQL Editor after
-- deleting the lines that start with a backslash.
-- Everything runs inside one READ ONLY transaction and ends with ROLLBACK: the database refuses any write.
-- Output contains counts, ids, dates and amounts only: no names, no full phone numbers, no addresses.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

\echo '== Q0 session is read-only (must say on)'
SHOW transaction_read_only;

\echo '== Q1a migration level (expect applied 16, last 1792471200000)'
SELECT COUNT(*) AS applied, MAX(created_at) AS last_applied FROM drizzle.__drizzle_migrations;
\echo '== Q1b last three migrations (0015 hash must start 0f0652008797519f)'
SELECT created_at, left(hash, 16) AS hash_start FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 3;
\echo '== Q1c objects of 0016-0021 already present? (expect all false)'
SELECT to_regclass('public.business_settings') IS NOT NULL AS has_0016,
       to_regclass('public.room_beds') IS NOT NULL AS has_0017,
       to_regclass('public.settlement_proposals') IS NOT NULL AS has_0018,
       to_regclass('public.order_revisions') IS NOT NULL AS has_0019,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'invoices' AND column_name = 'billing_month') AS has_0020,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'payment_review') AS has_0021;

\echo '== Q2a customers sharing a phone (counts)'
SELECT COUNT(*) AS shared_phone_numbers, COALESCE(SUM(n), 0) AS customers_involved
FROM (SELECT phone, COUNT(*) AS n FROM tiffin_customers GROUP BY phone HAVING COUNT(*) > 1) d;
\echo '== Q2b each shared phone: masked number, customer ids, delivery orders linked'
SELECT '******' || right(c.phone, 4) AS phone_masked, COUNT(*) AS customers,
       string_agg(c.id, ', ' ORDER BY c.created_at) AS customer_ids,
       SUM((SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.order_type = 'DELIVERY')) AS delivery_orders
FROM tiffin_customers c
WHERE c.phone IN (SELECT phone FROM tiffin_customers GROUP BY phone HAVING COUNT(*) > 1)
GROUP BY c.phone ORDER BY 2 DESC LIMIT 50;

\echo '== Q3a delivered orders not marked COMPLETED (Receivables does not list them); reversed UPI excluded'
SELECT o.source, o.status, COUNT(*) AS orders, MIN(o.service_date) AS first_day, MAX(o.service_date) AS last_day,
       SUM(GREATEST(d.due - COALESCE(a.active, 0), 0)) AS outstanding_active_rule,
       SUM(GREATEST(d.due - COALESCE(r.all_rows, 0), 0)) AS outstanding_if_reversals_counted,
       COUNT(*) FILTER (WHERE d.due > COALESCE(a.active, 0)) AS orders_with_balance
FROM orders o
JOIN delivery_tasks t ON t.id = o.delivery_task_id AND t.status = 'DELIVERED'
JOIN (SELECT order_id, SUM(COALESCE(delivered_quantity, quantity) * unit_price) AS due FROM order_items GROUP BY order_id) d ON d.order_id = o.id
LEFT JOIN (SELECT dc.delivery_task_id, SUM(dc.amount) AS active FROM delivery_collections dc
           WHERE NOT EXISTS (SELECT 1 FROM financial_transactions rv WHERE rv.id = dc.transaction_id AND rv.status = 'REVERSED')
           GROUP BY dc.delivery_task_id) a ON a.delivery_task_id = o.delivery_task_id
LEFT JOIN (SELECT delivery_task_id, SUM(amount) AS all_rows FROM delivery_collections GROUP BY delivery_task_id) r ON r.delivery_task_id = o.delivery_task_id
WHERE o.order_type = 'DELIVERY' AND o.status <> 'COMPLETED'
GROUP BY 1, 2 ORDER BY 1, 2;
\echo '== Q3b delivered one-off tasks with no order row (Receivables cannot see them)'
SELECT COUNT(*) AS tasks, MIN(t.service_date) AS first_day, MAX(t.service_date) AS last_day,
       SUM(COALESCE(t.collected_amount, 0)) AS collected_recorded,
       COUNT(*) FILTER (WHERE t.delivery_notes LIKE '%[ORDER_JSON:%') AS with_order_details
FROM delivery_tasks t
WHERE t.order_type = 'EXTERNAL' AND t.subscription_id IS NULL AND t.status = 'DELIVERED'
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.delivery_task_id = t.id);
\echo '== Q3c payment history: differences between task totals and collection rows not explained by a UPI reversal (expect 0)'
SELECT COUNT(*) AS delivered_tasks,
       COUNT(*) FILTER (WHERE COALESCE(t.collected_amount, 0) <> COALESCE(c.collected, 0)) AS totals_differ,
       COUNT(*) FILTER (WHERE COALESCE(t.collected_amount, 0) <> COALESCE(c.collected, 0)
         AND NOT EXISTS (SELECT 1 FROM delivery_collections dc JOIN financial_transactions f ON f.id = dc.transaction_id
                         WHERE dc.delivery_task_id = t.id AND f.status = 'REVERSED')) AS differ_unexplained
FROM delivery_tasks t
LEFT JOIN (SELECT delivery_task_id, SUM(amount) AS collected FROM delivery_collections GROUP BY delivery_task_id) c ON c.delivery_task_id = t.id
WHERE t.status = 'DELIVERED' AND t.subscription_id IS NULL;

\echo '== Q4a delivery orders without a customer record'
SELECT COUNT(*) AS orders, COUNT(*) FILTER (WHERE o.status = 'COMPLETED') AS delivered,
       COUNT(*) FILTER (WHERE o.status = 'CONFIRMED') AS not_yet_delivered, MIN(o.service_date) AS first_day, MAX(o.service_date) AS last_day
FROM orders o WHERE o.order_type = 'DELIVERY' AND o.customer_id IS NULL;
\echo '== Q4b those with money still owed (each becomes its own account in Receivables; no Pay Later)'
SELECT o.id AS order_id, o.service_date, d.due, COALESCE(a.active, 0) AS collected, d.due - COALESCE(a.active, 0) AS outstanding
FROM orders o
JOIN delivery_tasks t ON t.id = o.delivery_task_id AND t.status = 'DELIVERED'
JOIN (SELECT order_id, SUM(COALESCE(delivered_quantity, quantity) * unit_price) AS due FROM order_items GROUP BY order_id) d ON d.order_id = o.id
LEFT JOIN (SELECT dc.delivery_task_id, SUM(dc.amount) AS active FROM delivery_collections dc
           WHERE NOT EXISTS (SELECT 1 FROM financial_transactions rv WHERE rv.id = dc.transaction_id AND rv.status = 'REVERSED')
           GROUP BY dc.delivery_task_id) a ON a.delivery_task_id = o.delivery_task_id
WHERE o.order_type = 'DELIVERY' AND o.customer_id IS NULL AND d.due > COALESCE(a.active, 0)
ORDER BY o.service_date LIMIT 50;

\echo '== Q5 rows and size of every table the batch alters or references'
SELECT 'invoices' AS tbl, (SELECT COUNT(*) FROM invoices) AS rows_exact, pg_size_pretty(pg_total_relation_size('invoices')) AS size
UNION ALL SELECT 'orders', (SELECT COUNT(*) FROM orders), pg_size_pretty(pg_total_relation_size('orders'))
UNION ALL SELECT 'tiffin_customers', (SELECT COUNT(*) FROM tiffin_customers), pg_size_pretty(pg_total_relation_size('tiffin_customers'))
UNION ALL SELECT 'resident_stays', (SELECT COUNT(*) FROM resident_stays), pg_size_pretty(pg_total_relation_size('resident_stays'))
UNION ALL SELECT 'delivery_collections', (SELECT COUNT(*) FROM delivery_collections), pg_size_pretty(pg_total_relation_size('delivery_collections'))
UNION ALL SELECT 'staff_users', (SELECT COUNT(*) FROM staff_users), pg_size_pretty(pg_total_relation_size('staff_users'))
UNION ALL SELECT 'rooms', (SELECT COUNT(*) FROM rooms), pg_size_pretty(pg_total_relation_size('rooms'))
UNION ALL SELECT 'residents', (SELECT COUNT(*) FROM residents), pg_size_pretty(pg_total_relation_size('residents'))
UNION ALL SELECT 'room capacity (beds 0017 will add)', (SELECT COALESCE(SUM(capacity), 0) FROM rooms), NULL;

ROLLBACK;
