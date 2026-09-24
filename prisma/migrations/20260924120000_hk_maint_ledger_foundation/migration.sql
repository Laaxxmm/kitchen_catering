-- Housekeeping / maintenance go-live foundation.
--
-- 1. Readable records for every on-hand change that is not a receipt or an
--    issue (adjustments, linen returns and write-offs, spares restored on a
--    cancelled job). Until now these left only a sha256 hash in the audit
--    log, so on-hand could not be rebuilt and a write-off kept no quantity.
-- 2. A reusable snapshot on housekeeping issue lines, so inCirculation stays
--    rebuildable after the item's flag is toggled.
-- 3. completedAt / cancelledAt on maintenance activities, for the status
--    action that did not exist.
-- 4. Stock can no longer go below zero at the database, whatever the app
--    does. NOT VALID: enforced on every write from now on, existing rows are
--    left as they are so the deploy cannot fail on old data.

CREATE TYPE "StoreAdjustmentKind" AS ENUM ('ADJUSTED', 'RETURNED', 'LOST', 'RESTORED');

CREATE TABLE "HousekeepingAdjustment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "StoreAdjustmentKind" NOT NULL,
    "delta" DECIMAL(14,3) NOT NULL,
    "circulationDelta" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "beforeQty" DECIMAL(14,3) NOT NULL,
    "afterQty" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "roomId" TEXT,
    "staffId" TEXT,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HousekeepingAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HousekeepingAdjustment_itemId_at_idx" ON "HousekeepingAdjustment"("itemId", "at");
CREATE INDEX "HousekeepingAdjustment_kind_at_idx" ON "HousekeepingAdjustment"("kind", "at");

ALTER TABLE "HousekeepingAdjustment" ADD CONSTRAINT "HousekeepingAdjustment_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "HousekeepingItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HousekeepingAdjustment" ADD CONSTRAINT "HousekeepingAdjustment_byId_fkey"
    FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MaintenanceAdjustment" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "StoreAdjustmentKind" NOT NULL,
    "delta" DECIMAL(14,3) NOT NULL,
    "beforeQty" DECIMAL(14,3) NOT NULL,
    "afterQty" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "activityId" TEXT,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaintenanceAdjustment_itemId_at_idx" ON "MaintenanceAdjustment"("itemId", "at");
CREATE INDEX "MaintenanceAdjustment_kind_at_idx" ON "MaintenanceAdjustment"("kind", "at");

ALTER TABLE "MaintenanceAdjustment" ADD CONSTRAINT "MaintenanceAdjustment_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "MaintenanceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceAdjustment" ADD CONSTRAINT "MaintenanceAdjustment_byId_fkey"
    FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HousekeepingIssueLine" ADD COLUMN "reusable" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MaintenanceActivity"
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "HousekeepingItem"
    ADD CONSTRAINT "HousekeepingItem_stock_nonnegative"
    CHECK ("currentStock" >= 0 AND "inCirculation" >= 0) NOT VALID;
ALTER TABLE "MaintenanceItem"
    ADD CONSTRAINT "MaintenanceItem_stock_nonnegative"
    CHECK ("currentStock" >= 0) NOT VALID;
ALTER TABLE "BanquetItem"
    ADD CONSTRAINT "BanquetItem_stock_nonnegative"
    CHECK ("currentStock" >= 0) NOT VALID;
