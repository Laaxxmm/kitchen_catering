-- Close the banquet procurement loop: a PO line can buy a BanquetItem
-- (GRN acceptance then auto-posts a banquet receipt), and a requisition
-- line remembers which PO line is buying its shortfall.
ALTER TABLE "VendorPOLine" ADD COLUMN "banquetItemId" TEXT;
ALTER TABLE "BanquetRequisitionLine" ADD COLUMN "vendorPOLineId" TEXT;

CREATE INDEX "VendorPOLine_banquetItemId_idx" ON "VendorPOLine"("banquetItemId");

ALTER TABLE "VendorPOLine" ADD CONSTRAINT "VendorPOLine_banquetItemId_fkey" FOREIGN KEY ("banquetItemId") REFERENCES "BanquetItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BanquetRequisitionLine" ADD CONSTRAINT "BanquetRequisitionLine_vendorPOLineId_fkey" FOREIGN KEY ("vendorPOLineId") REFERENCES "VendorPOLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
