-- Leftover-return log for counter-sale / ODC events (traceability, no stock).
CREATE TYPE "LeftoverDisposition" AS ENUM ('REUSE_BREAKFAST', 'CHARITY', 'DISCARDED');

CREATE TABLE "OrderLeftoverReturn" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "disposition" "LeftoverDisposition" NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLeftoverReturn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderLeftoverReturn_orderId_idx" ON "OrderLeftoverReturn"("orderId");

ALTER TABLE "OrderLeftoverReturn" ADD CONSTRAINT "OrderLeftoverReturn_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderLeftoverReturn" ADD CONSTRAINT "OrderLeftoverReturn_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
