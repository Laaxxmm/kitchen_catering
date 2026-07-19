-- Vendor approval workflow (client #12): store-created vendors await
-- GM/Admin sign-off before POs can be raised. Existing vendors APPROVED.
CREATE TYPE "VendorApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED');
ALTER TABLE "Vendor" ADD COLUMN "approvalStatus" "VendorApprovalStatus" NOT NULL DEFAULT 'APPROVED';
