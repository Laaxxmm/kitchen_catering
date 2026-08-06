-- A supplier bill can only be paid after accounts approve the vendor's
-- invoice, and a bill that failed the 3-way match can only be approved or
-- corrected with a written reason ("what we have ordered, what we have got,
-- we will pay only for that"). The decision has to be readable afterwards:
-- AuditLog stores a payload hash, so the reason and the approver go on the
-- bill itself.
--
-- All columns nullable, no backfill: existing bills carry NULL, which reads
-- correctly as "approved before we started recording this" — the payment
-- gate keys off "status", not off these columns, so live data is unaffected.

ALTER TABLE "VendorBill" ADD COLUMN "approvedByUserId" TEXT;
ALTER TABLE "VendorBill" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "VendorBill" ADD COLUMN "approvalNote" TEXT;
ALTER TABLE "VendorBill" ADD COLUMN "discrepancyEditReason" TEXT;

-- SET NULL on delete, matching "VendorBill_matchedByUserId_fkey": losing a
-- leaver's user row must not take the bill's financial record with it.
ALTER TABLE "VendorBill" ADD CONSTRAINT "VendorBill_approvedByUserId_fkey"
  FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
