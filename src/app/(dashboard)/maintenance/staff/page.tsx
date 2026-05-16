import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listMaintenanceStaff } from "@/server/actions/maintenance";
import { StaffTable } from "./_components/StaffTable";

export const dynamic = "force-dynamic";

export default async function MaintenanceStaffPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER]);
  const staff = await listMaintenanceStaff({ activeOnly: false });

  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title="Staff"
        description="Electrical / mechanical staff. Each carries a primary skill, used when logging activities."
        actions={<Link href="/maintenance"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      <StaffTable staff={staff} />
    </>
  );
}
