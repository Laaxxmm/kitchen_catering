import { StoreDepartment } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import { UPLOAD_ROLES } from "@/server/dept-stock-upload";
import { DeptStockUpload } from "@/components/ik/dept-stock-upload/DeptStockUpload";

export const dynamic = "force-dynamic";

export default async function MaintenanceUploadPage() {
  await gateRolePage(UPLOAD_ROLES.MAINTENANCE);
  return (
    <>
      <PageHeader
        eyebrow="Maintenance · Stock"
        title="Upload stock"
        description="Load the department's spares once from a spreadsheet. From then on they move through stock requests and jobs."
      />
      <DeptStockUpload department={StoreDepartment.MAINTENANCE} />
    </>
  );
}
