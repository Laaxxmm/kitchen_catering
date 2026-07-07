-- Per-dish kitchen → delivery handover timestamps (delay accountability).
ALTER TABLE "ProductionJobItem" ADD COLUMN "handedOverAt" TIMESTAMP(3);
ALTER TABLE "ProductionJobItem" ADD COLUMN "handedOverById" TEXT;
ALTER TABLE "ProductionJobItem" ADD CONSTRAINT "ProductionJobItem_handedOverById_fkey" FOREIGN KEY ("handedOverById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
