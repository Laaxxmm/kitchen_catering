-- Housekeeping and maintenance as self-run departments (14 Oct 2026).
--   * HousekeepingJob: the department's own work orders (open -> done),
--     closed with the items used, which are issued from the HK store.
--   * MaintenanceActivity: priority, startedAt, and staff optional while a
--     job is only reported.
--   * DeptPurchaseOrder (+lines): the department's stock request -> admin /
--     manager approval -> PO -> goods received into the department store.
--     Untied from the kitchen's VendorPO / GRN.
--   * Receipts link to the PO / PO line they arrived against.
-- Hand-edited after `prisma migrate diff`: two unrelated DROP INDEX lines
-- for kitchen indexes that exist outside the schema were removed.

-- CreateEnum
CREATE TYPE "HousekeepingJobType" AS ENUM ('CHECKOUT_CLEAN', 'STAYOVER_CLEAN', 'TURNDOWN', 'DEEP_CLEAN', 'GUEST_REQUEST', 'LAUNDRY', 'OTHER');

-- CreateEnum
CREATE TYPE "DeptJobStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "StoreDepartment" AS ENUM ('HOUSEKEEPING', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "DeptPurchaseStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "MaintenanceActivity" DROP CONSTRAINT "MaintenanceActivity_staffId_fkey";

-- AlterTable
ALTER TABLE "HousekeepingIssue" ADD COLUMN     "jobId" TEXT;

-- AlterTable
ALTER TABLE "HousekeepingReceipt" ADD COLUMN     "purchaseOrderId" TEXT,
ADD COLUMN     "supplierBillNo" TEXT;

-- AlterTable
ALTER TABLE "HousekeepingReceiptLine" ADD COLUMN     "poLineId" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceActivity" ADD COLUMN     "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "startedAt" TIMESTAMP(3),
ALTER COLUMN "staffId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MaintenanceReceipt" ADD COLUMN     "purchaseOrderId" TEXT,
ADD COLUMN     "supplierBillNo" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceReceiptLine" ADD COLUMN     "poLineId" TEXT;

-- CreateTable
CREATE TABLE "HousekeepingJob" (
    "id" TEXT NOT NULL,
    "type" "HousekeepingJobType" NOT NULL DEFAULT 'GUEST_REQUEST',
    "priority" "JobPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "DeptJobStatus" NOT NULL DEFAULT 'OPEN',
    "roomId" TEXT,
    "description" TEXT NOT NULL,
    "staffId" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "closedById" TEXT,
    "outcome" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousekeepingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeptPurchaseOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "department" "StoreDepartment" NOT NULL,
    "status" "DeptPurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "supplierName" TEXT,
    "supplierPhone" TEXT,
    "expectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "estimatedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "orderedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeptPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeptPurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hkItemId" TEXT,
    "mtItemId" TEXT,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "approvedQty" DECIMAL(14,3),
    "receivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "rate" DECIMAL(12,2),

    CONSTRAINT "DeptPurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingPONumberSequence" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "HousekeepingPONumberSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "MaintenancePONumberSequence" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MaintenancePONumberSequence_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE INDEX "HousekeepingJob_status_reportedAt_idx" ON "HousekeepingJob"("status", "reportedAt");

-- CreateIndex
CREATE INDEX "HousekeepingJob_roomId_idx" ON "HousekeepingJob"("roomId");

-- CreateIndex
CREATE INDEX "HousekeepingJob_staffId_idx" ON "HousekeepingJob"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "DeptPurchaseOrder_number_key" ON "DeptPurchaseOrder"("number");

-- CreateIndex
CREATE INDEX "DeptPurchaseOrder_department_status_idx" ON "DeptPurchaseOrder"("department", "status");

-- CreateIndex
CREATE INDEX "DeptPurchaseOrder_status_submittedAt_idx" ON "DeptPurchaseOrder"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "DeptPurchaseOrderLine_poId_sortOrder_idx" ON "DeptPurchaseOrderLine"("poId", "sortOrder");

-- CreateIndex
CREATE INDEX "DeptPurchaseOrderLine_hkItemId_idx" ON "DeptPurchaseOrderLine"("hkItemId");

-- CreateIndex
CREATE INDEX "DeptPurchaseOrderLine_mtItemId_idx" ON "DeptPurchaseOrderLine"("mtItemId");

-- CreateIndex
CREATE UNIQUE INDEX "HousekeepingIssue_jobId_key" ON "HousekeepingIssue"("jobId");

-- CreateIndex
CREATE INDEX "HousekeepingReceipt_purchaseOrderId_idx" ON "HousekeepingReceipt"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "HousekeepingReceiptLine_poLineId_idx" ON "HousekeepingReceiptLine"("poLineId");

-- CreateIndex
CREATE INDEX "MaintenanceReceipt_purchaseOrderId_idx" ON "MaintenanceReceipt"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "MaintenanceReceiptLine_poLineId_idx" ON "MaintenanceReceiptLine"("poLineId");

-- AddForeignKey
ALTER TABLE "HousekeepingReceipt" ADD CONSTRAINT "HousekeepingReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "DeptPurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingReceiptLine" ADD CONSTRAINT "HousekeepingReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "DeptPurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingIssue" ADD CONSTRAINT "HousekeepingIssue_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "HousekeepingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingJob" ADD CONSTRAINT "HousekeepingJob_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingJob" ADD CONSTRAINT "HousekeepingJob_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "HousekeepingStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingJob" ADD CONSTRAINT "HousekeepingJob_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingJob" ADD CONSTRAINT "HousekeepingJob_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceReceipt" ADD CONSTRAINT "MaintenanceReceipt_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "DeptPurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceReceiptLine" ADD CONSTRAINT "MaintenanceReceiptLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "DeptPurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceActivity" ADD CONSTRAINT "MaintenanceActivity_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "MaintenanceStaff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeptPurchaseOrder" ADD CONSTRAINT "DeptPurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeptPurchaseOrder" ADD CONSTRAINT "DeptPurchaseOrder_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeptPurchaseOrderLine" ADD CONSTRAINT "DeptPurchaseOrderLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "DeptPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeptPurchaseOrderLine" ADD CONSTRAINT "DeptPurchaseOrderLine_hkItemId_fkey" FOREIGN KEY ("hkItemId") REFERENCES "HousekeepingItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeptPurchaseOrderLine" ADD CONSTRAINT "DeptPurchaseOrderLine_mtItemId_fkey" FOREIGN KEY ("mtItemId") REFERENCES "MaintenanceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A PO line names exactly one item, from the store of its own department
-- (the department match itself is enforced in the action).
ALTER TABLE "DeptPurchaseOrderLine"
    ADD CONSTRAINT "DeptPurchaseOrderLine_one_item"
    CHECK (("hkItemId" IS NOT NULL)::int + ("mtItemId" IS NOT NULL)::int = 1);
ALTER TABLE "DeptPurchaseOrderLine"
    ADD CONSTRAINT "DeptPurchaseOrderLine_quantities_nonnegative"
    CHECK ("quantity" > 0 AND ("approvedQty" IS NULL OR "approvedQty" >= 0) AND "receivedQty" >= 0);
