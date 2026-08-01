-- Readable revision history per order (the audit log only stores a hash).
CREATE TABLE "OrderRevision" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "revisedById" TEXT NOT NULL,
    "note" TEXT,
    "beforeHeadcount" INTEGER NOT NULL,
    "afterHeadcount" INTEGER NOT NULL,
    "beforeContractValue" DECIMAL(14,2) NOT NULL,
    "afterContractValue" DECIMAL(14,2) NOT NULL,
    "beforeEventDate" TIMESTAMP(3) NOT NULL,
    "afterEventDate" TIMESTAMP(3) NOT NULL,
    "beforeMealType" "MealType" NOT NULL,
    "afterMealType" "MealType" NOT NULL,
    "lineChanges" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderRevision_orderId_createdAt_idx" ON "OrderRevision"("orderId", "createdAt");

ALTER TABLE "OrderRevision" ADD CONSTRAINT "OrderRevision_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderRevision" ADD CONSTRAINT "OrderRevision_revisedById_fkey"
  FOREIGN KEY ("revisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
