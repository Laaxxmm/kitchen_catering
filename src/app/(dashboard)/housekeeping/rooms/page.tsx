import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listRooms } from "@/server/actions/housekeeping";
import { RoomsTable } from "./_components/RoomsTable";

export const dynamic = "force-dynamic";

export default async function HousekeepingRoomsPage() {
  const session = await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER, Role.MAINTENANCE_MANAGER]);
  // Maintenance logs jobs against rooms, so it may add and edit them — but
  // taking a room out of service (or deleting it) stays housekeeping's call.
  // "Back" goes home rather than into a module they can't open.
  const maintenance = session.user.role === Role.MAINTENANCE_MANAGER;
  const rooms = await listRooms({ activeOnly: false });

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Rooms"
        description="Hotel rooms (and common areas). Housekeeping and maintenance jobs, and every issue of supplies, are logged against them."
        actions={
          <Link href={maintenance ? "/dashboard" : "/housekeeping"}>
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
        }
      />
      <RoomsTable rooms={rooms} canRetire={!maintenance} />
    </>
  );
}
