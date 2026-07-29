-- Vendor names were stored untrimmed, so adding a supplier inline on the PO
-- form created "Smart Bazar " alongside the already-approved "Smart Bazar".
-- Because store-created vendors start PENDING_APPROVAL, the duplicate then
-- blocked POs even though the real vendor was approved.
--
-- 1. Trim the stored names so the two collapse to the same text.
UPDATE "Vendor" SET "name" = btrim("name") WHERE "name" <> btrim("name");

-- 2. Where trimming produced an exact-name twin, inherit the approval already
--    granted to the sibling. A pending duplicate of an approved vendor is
--    just the same supplier typed twice — it should not hold up a PO. Only
--    APPROVED is copied; nothing becomes approved that wasn't already.
UPDATE "Vendor" v
SET "approvalStatus" = 'APPROVED'::"VendorApprovalStatus"
WHERE v."approvalStatus" <> 'APPROVED'::"VendorApprovalStatus"
  AND EXISTS (
    SELECT 1 FROM "Vendor" o
    WHERE o.id <> v.id
      AND lower(o."name") = lower(v."name")
      AND o."approvalStatus" = 'APPROVED'::"VendorApprovalStatus"
  );
