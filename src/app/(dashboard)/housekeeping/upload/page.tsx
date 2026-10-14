import { StoreDepartment } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { UPLOAD_ROLES } from "@/server/dept-stock-upload";
import { DeptStockUpload } from "@/components/ik/dept-stock-upload/DeptStockUpload";

export const dynamic = "force-dynamic";

export default async function HousekeepingUploadPage() {
  await gateRolePage(UPLOAD_ROLES.HOUSEKEEPING);
  return (
    <>
      <PageHeader
        eyebrow="Housekeeping · Stock"
        title="Upload stock"
        description="Load the department's stock once from a spreadsheet. From then on it moves through stock requests, issues and returns."
      />
      <DeptStockUpload department={StoreDepartment.HOUSEKEEPING} />
    </>
  );
}
