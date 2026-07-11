-- The pre-PO-loop shortfall path left requisition lines AWAITING_PROCUREMENT
-- with no linked PO (vendorPOLineId NULL) and "Raise PO for … shortfall"
-- tasks. Flip those stranded lines back to PENDING so the new inline
-- Raise-PO (vendor picker) flow applies, reopen their parents, and close
-- the superseded tasks. Idempotent by construction.

UPDATE "BanquetRequisitionLine"
SET "status" = 'PENDING'
WHERE "status" = 'AWAITING_PROCUREMENT' AND "vendorPOLineId" IS NULL;

-- Reopen parents that were closed purely because lines sat in AWAITING.
UPDATE "BanquetRequisition" r
SET "status" = CASE
      WHEN EXISTS (SELECT 1 FROM "BanquetRequisitionLine" l
                   WHERE l."requisitionId" = r."id"
                     AND (l."status" IN ('ISSUED','PARTIALLY_ISSUED') OR l."issuedQty" > 0))
      THEN 'PARTIALLY_ISSUED'::"BanquetRequisitionStatus"
      ELSE 'SUBMITTED'::"BanquetRequisitionStatus"
    END,
    "closedAt" = NULL
WHERE r."status" = 'FULLY_ISSUED'
  AND EXISTS (SELECT 1 FROM "BanquetRequisitionLine" l
              WHERE l."requisitionId" = r."id" AND l."status" = 'PENDING');

UPDATE "Task"
SET "status" = 'COMPLETED',
    "submittedAt" = NOW(), "completedAt" = NOW(), "reviewedAt" = NOW(),
    "completionRemarks" = 'Superseded — raise the PO from the requisition line itself (Banquet → Requisitions → Raise PO for shortfall, now with a vendor picker).',
    "updatedAt" = NOW()
WHERE "title" LIKE 'Raise PO for %shortfall%'
  AND "status" IN ('ASSIGNED','SUBMITTED','REJECTED');
