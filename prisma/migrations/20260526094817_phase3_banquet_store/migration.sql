-- CreateTable
CREATE TABLE "BanquetItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "currentStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(14,3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BanquetItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanquetReceipt" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "sourceNote" TEXT,
    "sourceContact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BanquetReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanquetReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "costPerUnit" DECIMAL(12,2),

    CONSTRAINT "BanquetReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanquetIssue" (
    "id" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "orderId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BanquetIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanquetIssueLine" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "BanquetIssueLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BanquetItem_active_idx" ON "BanquetItem"("active");

-- CreateIndex
CREATE INDEX "BanquetItem_category_idx" ON "BanquetItem"("category");

-- CreateIndex
CREATE UNIQUE INDEX "BanquetItem_name_key" ON "BanquetItem"("name");

-- CreateIndex
CREATE INDEX "BanquetReceipt_receivedAt_idx" ON "BanquetReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "BanquetReceiptLine_receiptId_idx" ON "BanquetReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "BanquetReceiptLine_itemId_idx" ON "BanquetReceiptLine"("itemId");

-- CreateIndex
CREATE INDEX "BanquetIssue_issuedAt_idx" ON "BanquetIssue"("issuedAt");

-- CreateIndex
CREATE INDEX "BanquetIssue_orderId_idx" ON "BanquetIssue"("orderId");

-- CreateIndex
CREATE INDEX "BanquetIssueLine_issueId_idx" ON "BanquetIssueLine"("issueId");

-- CreateIndex
CREATE INDEX "BanquetIssueLine_itemId_idx" ON "BanquetIssueLine"("itemId");

-- AddForeignKey
ALTER TABLE "BanquetReceipt" ADD CONSTRAINT "BanquetReceipt_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetReceiptLine" ADD CONSTRAINT "BanquetReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "BanquetReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetReceiptLine" ADD CONSTRAINT "BanquetReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BanquetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetIssue" ADD CONSTRAINT "BanquetIssue_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetIssue" ADD CONSTRAINT "BanquetIssue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetIssueLine" ADD CONSTRAINT "BanquetIssueLine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "BanquetIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanquetIssueLine" ADD CONSTRAINT "BanquetIssueLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "BanquetItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
