-- F&B allocates named serving staff to an event order once the kitchen
-- posts it ready. Free-text names (serving crew aren't app users).
CREATE TABLE "OrderStaffAllocation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "duty" TEXT,
    "allocatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStaffAllocation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderStaffAllocation_orderId_idx" ON "OrderStaffAllocation"("orderId");

ALTER TABLE "OrderStaffAllocation" ADD CONSTRAINT "OrderStaffAllocation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderStaffAllocation" ADD CONSTRAINT "OrderStaffAllocation_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
