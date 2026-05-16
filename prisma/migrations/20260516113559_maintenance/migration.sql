-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('ELECTRICAL', 'MECHANICAL', 'GENERAL');

-- CreateEnum
CREATE TYPE "MaintenanceActivityStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MAINTENANCE_MANAGER';

-- CreateTable
CREATE TABLE "MaintenanceStaff" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "category" "MaintenanceCategory" NOT NULL DEFAULT 'GENERAL',
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "category" "MaintenanceCategory" NOT NULL DEFAULT 'GENERAL',
    "currentStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(14,3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceReceipt" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "sourceNote" TEXT,
    "sourceContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "costPerUnit" DECIMAL(12,2),

    CONSTRAINT "MaintenanceReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceActivity" (
    "id" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL,
    "status" "MaintenanceActivityStatus" NOT NULL DEFAULT 'COMPLETED',
    "issueReported" TEXT NOT NULL,
    "workDone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceActivityLine" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "MaintenanceActivityLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceStaff_active_idx" ON "MaintenanceStaff"("active");

-- CreateIndex
CREATE INDEX "MaintenanceStaff_category_idx" ON "MaintenanceStaff"("category");

-- CreateIndex
CREATE INDEX "MaintenanceItem_active_idx" ON "MaintenanceItem"("active");

-- CreateIndex
CREATE INDEX "MaintenanceItem_category_idx" ON "MaintenanceItem"("category");

-- CreateIndex
CREATE UNIQUE INDEX "MaintenanceItem_name_key" ON "MaintenanceItem"("name");

-- CreateIndex
CREATE INDEX "MaintenanceReceipt_receivedAt_idx" ON "MaintenanceReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "MaintenanceReceiptLine_receiptId_idx" ON "MaintenanceReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "MaintenanceReceiptLine_itemId_idx" ON "MaintenanceReceiptLine"("itemId");

-- CreateIndex
CREATE INDEX "MaintenanceActivity_performedAt_idx" ON "MaintenanceActivity"("performedAt");

-- CreateIndex
CREATE INDEX "MaintenanceActivity_roomId_idx" ON "MaintenanceActivity"("roomId");

-- CreateIndex
CREATE INDEX "MaintenanceActivity_staffId_idx" ON "MaintenanceActivity"("staffId");

-- CreateIndex
CREATE INDEX "MaintenanceActivity_status_idx" ON "MaintenanceActivity"("status");

-- CreateIndex
CREATE INDEX "MaintenanceActivity_category_idx" ON "MaintenanceActivity"("category");

-- CreateIndex
CREATE INDEX "MaintenanceActivityLine_activityId_idx" ON "MaintenanceActivityLine"("activityId");

-- CreateIndex
CREATE INDEX "MaintenanceActivityLine_itemId_idx" ON "MaintenanceActivityLine"("itemId");

-- AddForeignKey
ALTER TABLE "MaintenanceReceipt" ADD CONSTRAINT "MaintenanceReceipt_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceReceiptLine" ADD CONSTRAINT "MaintenanceReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "MaintenanceReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceReceiptLine" ADD CONSTRAINT "MaintenanceReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MaintenanceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceActivity" ADD CONSTRAINT "MaintenanceActivity_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceActivity" ADD CONSTRAINT "MaintenanceActivity_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "MaintenanceStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceActivity" ADD CONSTRAINT "MaintenanceActivity_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceActivityLine" ADD CONSTRAINT "MaintenanceActivityLine_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "MaintenanceActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceActivityLine" ADD CONSTRAINT "MaintenanceActivityLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MaintenanceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
