-- Merge the F&B Service role. FNB_SERVICE is retired in favour of DELIVERY,
-- which now carries every F&B capability (deliveries + room service + banquet).
-- Reassign any existing F&B-service users onto the merged role. The enum value
-- FNB_SERVICE is intentionally kept (dropping a Postgres enum value is
-- disruptive) — it simply becomes unused. Data-only, idempotent.
UPDATE "User" SET "role" = 'DELIVERY' WHERE "role" = 'FNB_SERVICE';
