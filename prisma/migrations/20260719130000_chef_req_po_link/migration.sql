-- Chef requisition lines get the same PO back-link the banquet twin has,
-- so GRN arrival can flip waiting lines + notify instead of relying on
-- human memory (audit M16).
ALTER TABLE "ChefRequisitionLine" ADD COLUMN "vendorPOLineId" TEXT;
CREATE INDEX "ChefRequisitionLine_vendorPOLineId_idx" ON "ChefRequisitionLine"("vendorPOLineId");
ALTER TABLE "ChefRequisitionLine" ADD CONSTRAINT "ChefRequisitionLine_vendorPOLineId_fkey" FOREIGN KEY ("vendorPOLineId") REFERENCES "VendorPOLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
