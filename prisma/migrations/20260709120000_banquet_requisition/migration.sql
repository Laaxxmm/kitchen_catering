-- Banquet Requisition: F&B raises a stock request against the banquet
-- store; the store keeper fulfils line by line (issue full / partial /
-- raise PO on shortfall), mirroring the chef ingredient-requisition flow.

-- CreateEnum
CREATE TYPE "BanquetRequisitionStatus" AS ENUM ('SUBMITTED', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BanquetRequisitionLineStatus" AS ENUM ('PENDING', 'ISSUED', 'PARTIALLY_ISSUED', 'AWAITING_PROCUREMENT', 'CANCELLED');



-- CreateTable
CREATE TABLE "BanquetRequisitionNumberSequence" (
    "year" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BanquetRequisitionNumberSequence_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "BanquetRequisition" (
    "id" TEXT NOT NULL,
    "requisitionNo" TEXT NOT NULL,
    "orderId" TEXT,
    "status" "BanquetRequisitionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFulfilledById" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BanquetRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanquetRequisitionLine" (
    "id" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "requestedQty" DECIMAL(14,3) NOT NULL,
    "issuedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "status" "BanquetRequisitionLineStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,

    CONSTRAINT "BanquetRequisitionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BanquetRequisition_requisitionNo_key" ON "BanquetRequisition"("requisitionNo");

-- CreateIndex
CREATE INDEX "BanquetRequisition_status_idx" ON "BanquetRequisition"("status");

-- CreateIndex
CREATE INDEX "BanquetRequisition_orderId_idx" ON "BanquetRequisition"("orderId");

-- CreateIndex
CREATE INDEX "BanquetRequisition_createdById_idx" ON "BanquetRequisition"("createdById");

-- CreateIndex
CREATE INDEX "BanquetRequisitionLine_requisitionId_idx" ON "BanquetRequisitionLine"("requisitionId");

-- CreateIndex
CREATE INDEX "BanquetRequisitionLine_itemId_idx" ON "BanquetRequisitionLine"("itemId");

-- CreateIndex
CREATE INDEX "BanquetRequisitionLine_status_idx" ON "BanquetRequisitionLine"("status");



-- AddForeignKey
ALTER TABLE "BanquetRequisition" ADD CONSTRAINT "BanquetRequisition_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetRequisition" ADD CONSTRAINT "BanquetRequisition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetRequisition" ADD CONSTRAINT "BanquetRequisition_lastFulfilledById_fkey" FOREIGN KEY ("lastFulfilledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetRequisitionLine" ADD CONSTRAINT "BanquetRequisitionLine_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "BanquetRequisition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetRequisitionLine" ADD CONSTRAINT "BanquetRequisitionLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BanquetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
