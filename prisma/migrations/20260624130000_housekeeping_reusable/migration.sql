-- Reusable housekeeping items (towels, linens): track clean vs in-circulation.
-- Additive + backfilled with safe defaults, so existing items are unaffected.
ALTER TABLE "HousekeepingItem" ADD COLUMN "reusable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HousekeepingItem" ADD COLUMN "inCirculation" DECIMAL(14,3) NOT NULL DEFAULT 0;
