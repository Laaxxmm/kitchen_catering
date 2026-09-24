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
  // Maintenance reads the room list (it logs activities against rooms) but
  // owns none of it: no write buttons, and "Back" goes home rather than
  // into a module they can't open.
  const readOnly = session.user.role === Role.MAINTENANCE_MANAGER;
  const rooms = await listRooms({ activeOnly: false });

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Rooms"
        description="Hotel rooms (and common areas) where supplies are delivered. Used when recording each issue."
        actions={
          <Link href={readOnly ? "/dashboard" : "/housekeeping"}>
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
        }
      />
      <RoomsTable rooms={rooms} canWrite={!readOnly} />
    </>
  );
}
