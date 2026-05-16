import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listHousekeepingStaff } from "@/server/actions/housekeeping";
import { StaffTable } from "./_components/StaffTable";

export const dynamic = "force-dynamic";

export default async function HousekeepingStaffPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const staff = await listHousekeepingStaff({ activeOnly: false });

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Staff"
        description="Housekeeping team members. You pick from this list when recording an issue to a room."
        actions={
          <Link href="/housekeeping">
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
        }
      />
      <StaffTable staff={staff} />
    </>
  );
}
