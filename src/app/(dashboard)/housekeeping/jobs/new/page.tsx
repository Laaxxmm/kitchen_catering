import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listHousekeepingStaff, listRooms } from "@/server/actions/housekeeping";
import { JobForm } from "./_components/JobForm";

export const dynamic = "force-dynamic";

export default async function NewHousekeepingJobPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const [rooms, staff] = await Promise.all([
    listRooms({ activeOnly: true }),
    listHousekeepingStaff({ activeOnly: true }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="New job"
        description="What needs doing, and where. Assign someone now or when it's started."
        actions={
          <Link href="/housekeeping/jobs">
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
        }
      />
      <JobForm
        rooms={rooms.map((r) => ({ id: r.id, number: r.number, name: r.name }))}
        staff={staff.map((s) => ({ id: s.id, name: s.name }))}
      />
    </>
  );
}
