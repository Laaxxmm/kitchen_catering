-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_ADMIN_APPROVAL';
ALTER TYPE "OrderStatus" ADD VALUE 'REJECTED_BY_ADMIN';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "adminDecision" "ApprovalDecision",
ADD COLUMN     "adminReviewNote" TEXT,
ADD COLUMN     "adminReviewedAt" TIMESTAMP(3),
ADD COLUMN     "adminReviewedById" TEXT;

-- CreateIndex
CREATE INDEX "Order_adminReviewedById_idx" ON "Order"("adminReviewedById");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_adminReviewedById_fkey" FOREIGN KEY ("adminReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
