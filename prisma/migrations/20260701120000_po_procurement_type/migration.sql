-- Store local / online procurement always needs both Manager AND Admin
-- sign-off. Track the procurement type on the PO. Additive: new enum + a
-- NOT NULL column with a STANDARD default, so existing rows keep the value tier.
CREATE TYPE "ProcurementType" AS ENUM ('STANDARD', 'LOCAL', 'ONLINE');

ALTER TABLE "VendorPO" ADD COLUMN "procurementType" "ProcurementType" NOT NULL DEFAULT 'STANDARD';
