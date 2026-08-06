-- Two movements the kitchen store never had.
--
-- 1. IngredientReturn — stock coming back from the kitchen. Each line names
--    the IngredientIssue it reverses ("issueId"), so the credit reaches the
--    order that was charged, and carries "unitCost" copied from that issue's
--    unitCostAtIssue, so the reversal is at the price the order paid and not
--    at today's moving average. Without both, returning stock silently
--    re-prices inventory and the event's food cost never truly reverses.
--
-- 2. StockTransfer — one document moving stock between the three stores.
--    The stores keep separate catalogues (Ingredient / BanquetItem /
--    HousekeepingItem), so the "from" and "to" ids point at different tables
--    and carry no FK. Item name and unit are snapshotted on the row instead:
--    a transfer document should read correctly forever, including after the
--    catalogue row is deleted. Units are stored per side and never converted.
--
-- New tables only — nothing on an existing table changes, so there is no
-- backfill to do on live data.

CREATE TABLE "IngredientReturn" (
    "id" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngredientReturn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IngredientReturn_returnedAt_idx" ON "IngredientReturn"("returnedAt");

ALTER TABLE "IngredientReturn" ADD CONSTRAINT "IngredientReturn_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "IngredientReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(12,4) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "IngredientReturnLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IngredientReturnLine_returnId_idx" ON "IngredientReturnLine"("returnId");
CREATE INDEX "IngredientReturnLine_issueId_idx" ON "IngredientReturnLine"("issueId");

-- CASCADE from the header (a line has no meaning without its document);
-- RESTRICT on the issue, because the issue is what the reversal is measured
-- against — losing it would strand the credit.
ALTER TABLE "IngredientReturnLine" ADD CONSTRAINT "IngredientReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "IngredientReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IngredientReturnLine" ADD CONSTRAINT "IngredientReturnLine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IngredientIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "StockStore" AS ENUM ('KITCHEN', 'FNB', 'HOUSEKEEPING');

CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "transferredAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "fromStore" "StockStore" NOT NULL,
    "toStore" "StockStore" NOT NULL,
    "fromItemId" TEXT NOT NULL,
    "fromItemName" TEXT NOT NULL,
    "fromUnit" TEXT NOT NULL,
    "toItemId" TEXT NOT NULL,
    "toItemName" TEXT NOT NULL,
    "toUnit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(12,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockTransfer_transferredAt_idx" ON "StockTransfer"("transferredAt");
CREATE INDEX "StockTransfer_fromItemId_idx" ON "StockTransfer"("fromItemId");
CREATE INDEX "StockTransfer_toItemId_idx" ON "StockTransfer"("toItemId");

ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
