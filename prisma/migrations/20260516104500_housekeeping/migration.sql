-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('STANDARD', 'DELUXE', 'SUITE', 'COMMON_AREA', 'OTHER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'HOUSEKEEPING_MANAGER';

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT,
    "type" "RoomType" NOT NULL DEFAULT 'STANDARD',
    "floor" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingStaff" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousekeepingStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "currentStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(14,3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousekeepingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingReceipt" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "sourceNote" TEXT,
    "sourceContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HousekeepingReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "costPerUnit" DECIMAL(12,2),

    CONSTRAINT "HousekeepingReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingIssue" (
    "id" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "purpose" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HousekeepingIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HousekeepingIssueLine" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "HousekeepingIssueLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_number_key" ON "Room"("number");

-- CreateIndex
CREATE INDEX "Room_active_idx" ON "Room"("active");

-- CreateIndex
CREATE INDEX "HousekeepingStaff_active_idx" ON "HousekeepingStaff"("active");

-- CreateIndex
CREATE INDEX "HousekeepingItem_active_idx" ON "HousekeepingItem"("active");

-- CreateIndex
CREATE UNIQUE INDEX "HousekeepingItem_name_key" ON "HousekeepingItem"("name");

-- CreateIndex
CREATE INDEX "HousekeepingReceipt_receivedAt_idx" ON "HousekeepingReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "HousekeepingReceiptLine_receiptId_idx" ON "HousekeepingReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "HousekeepingReceiptLine_itemId_idx" ON "HousekeepingReceiptLine"("itemId");

-- CreateIndex
CREATE INDEX "HousekeepingIssue_issuedAt_idx" ON "HousekeepingIssue"("issuedAt");

-- CreateIndex
CREATE INDEX "HousekeepingIssue_roomId_idx" ON "HousekeepingIssue"("roomId");

-- CreateIndex
CREATE INDEX "HousekeepingIssue_staffId_idx" ON "HousekeepingIssue"("staffId");

-- CreateIndex
CREATE INDEX "HousekeepingIssueLine_issueId_idx" ON "HousekeepingIssueLine"("issueId");

-- CreateIndex
CREATE INDEX "HousekeepingIssueLine_itemId_idx" ON "HousekeepingIssueLine"("itemId");

-- AddForeignKey
ALTER TABLE "HousekeepingReceipt" ADD CONSTRAINT "HousekeepingReceipt_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingReceiptLine" ADD CONSTRAINT "HousekeepingReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "HousekeepingReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingReceiptLine" ADD CONSTRAINT "HousekeepingReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HousekeepingItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingIssue" ADD CONSTRAINT "HousekeepingIssue_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingIssue" ADD CONSTRAINT "HousekeepingIssue_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "HousekeepingStaff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingIssue" ADD CONSTRAINT "HousekeepingIssue_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingIssueLine" ADD CONSTRAINT "HousekeepingIssueLine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "HousekeepingIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousekeepingIssueLine" ADD CONSTRAINT "HousekeepingIssueLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HousekeepingItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
