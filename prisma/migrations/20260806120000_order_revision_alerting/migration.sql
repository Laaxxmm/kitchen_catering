-- Make a revision visible downstream instead of leaving it buried on the
-- order page. reviseOrder stamps "lastRevisedAt" and clears both seen-stamps
-- in the same guarded write, so the chef and store boards can show what
-- changed since each team last looked, and each downstream document
-- (requisition / purchase order) carries its own "I re-checked this"
-- timestamp.
--
-- All columns nullable, no backfill: a NULL "lastRevisedAt" already reads as
-- "never revised", which is exactly right for every existing order, and a
-- NULL "revisionAckAt" makes an existing document fall back to its own
-- createdAt (see isStaleAfterRevision in src/lib/order-revision.ts).

ALTER TABLE "Order" ADD COLUMN "lastRevisedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "revisionSeenByChefAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "revisionSeenByStoreAt" TIMESTAMP(3);

ALTER TABLE "ChefRequisition" ADD COLUMN "revisionAckAt" TIMESTAMP(3);
ALTER TABLE "BanquetRequisition" ADD COLUMN "revisionAckAt" TIMESTAMP(3);
ALTER TABLE "VendorPO" ADD COLUMN "revisionAckAt" TIMESTAMP(3);
