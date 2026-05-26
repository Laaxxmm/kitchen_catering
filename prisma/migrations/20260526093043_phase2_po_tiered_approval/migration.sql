-- AlterTable
ALTER TABLE "VendorPO" ADD COLUMN     "adminApprovedAt" TIMESTAMP(3),
ADD COLUMN     "adminApprovedById" TEXT,
ADD COLUMN     "managerApprovedAt" TIMESTAMP(3),
ADD COLUMN     "managerApprovedById" TEXT,
ALTER COLUMN "approvalTier" SET DEFAULT 'tiered';

-- AddForeignKey
ALTER TABLE "VendorPO" ADD CONSTRAINT "VendorPO_managerApprovedById_fkey" FOREIGN KEY ("managerApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPO" ADD CONSTRAINT "VendorPO_adminApprovedById_fkey" FOREIGN KEY ("adminApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
