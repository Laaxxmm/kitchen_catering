import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listRooms } from "@/server/actions/housekeeping";
import { RoomsTable } from "./_components/RoomsTable";

export const dynamic = "force-dynamic";

export default async function HousekeepingRoomsPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER, Role.MAINTENANCE_MANAGER]);
  const rooms = await listRooms({ activeOnly: false });

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Rooms"
        description="Hotel rooms (and common areas) where supplies are delivered. Used when recording each issue."
        actions={
          <Link href="/housekeeping">
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
        }
      />
      <RoomsTable rooms={rooms} />
    </>
  );
}
