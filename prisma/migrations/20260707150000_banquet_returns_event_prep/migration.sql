-- Cutlery lifecycle tracking (event prep):
--   1. Order.eventPrepNoCutlery — explicit "no cutlery required" log.
--   2. BanquetReturn / BanquetReturnLine — cutlery coming back from an
--      event; with the order-linked issues this gives a per-client
--      ledger (issued − returned = still out, chargeable).
--   3. Opening stock: every banquet-store item topped up to 100 pieces
--      per operations' instruction (adjust individual items from the
--      Banquet store screen afterwards if needed).

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "eventPrepNoCutlery" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BanquetReturn" (
    "id" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BanquetReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanquetReturnLine" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "BanquetReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BanquetReturn_returnedAt_idx" ON "BanquetReturn"("returnedAt");

-- CreateIndex
CREATE INDEX "BanquetReturn_orderId_idx" ON "BanquetReturn"("orderId");

-- CreateIndex
CREATE INDEX "BanquetReturnLine_returnId_idx" ON "BanquetReturnLine"("returnId");

-- CreateIndex
CREATE INDEX "BanquetReturnLine_itemId_idx" ON "BanquetReturnLine"("itemId");

-- AddForeignKey
ALTER TABLE "BanquetReturn" ADD CONSTRAINT "BanquetReturn_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetReturn" ADD CONSTRAINT "BanquetReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetReturnLine" ADD CONSTRAINT "BanquetReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "BanquetReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetReturnLine" ADD CONSTRAINT "BanquetReturnLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BanquetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Opening stock: top every active banquet-store item up to 100 pieces.
UPDATE "BanquetItem" SET "currentStock" = 100 WHERE "active" = true;
