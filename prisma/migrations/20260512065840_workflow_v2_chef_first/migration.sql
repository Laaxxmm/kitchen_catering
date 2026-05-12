-- AlterEnum
ALTER TYPE "ApprovalDecision" ADD VALUE 'SUGGESTED_CHANGES';

-- AlterEnum
ALTER TYPE "CustomerInvoiceKind" ADD VALUE 'PROFORMA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PENDING_CHEF_APPROVAL';
ALTER TYPE "OrderStatus" ADD VALUE 'CHANGES_PROPOSED_BY_CHEF';
ALTER TYPE "OrderStatus" ADD VALUE 'CHEF_APPROVED';

-- AlterTable
ALTER TABLE "CustomerInvoice" ADD COLUMN     "emailedAt" TIMESTAMP(3),
ADD COLUMN     "emailedTo" TEXT;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "paymentAmount" DECIMAL(14,2),
ADD COLUMN     "paymentCollected" BOOLEAN DEFAULT false,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "paymentRecordedAt" TIMESTAMP(3),
ADD COLUMN     "paymentReference" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "chefDecision" "ApprovalDecision",
ADD COLUMN     "chefReviewedAt" TIMESTAMP(3),
ADD COLUMN     "chefReviewedById" TEXT,
ADD COLUMN     "chefSuggestionNotes" TEXT,
ADD COLUMN     "managerChangeDecision" "ApprovalDecision",
ADD COLUMN     "managerChangeNote" TEXT,
ADD COLUMN     "managerChangeReviewedAt" TIMESTAMP(3),
ADD COLUMN     "managerChangeReviewedById" TEXT;

-- CreateIndex
CREATE INDEX "Order_chefReviewedById_idx" ON "Order"("chefReviewedById");

-- CreateIndex
CREATE INDEX "Order_managerChangeReviewedById_idx" ON "Order"("managerChangeReviewedById");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_chefReviewedById_fkey" FOREIGN KEY ("chefReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_managerChangeReviewedById_fkey" FOREIGN KEY ("managerChangeReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
