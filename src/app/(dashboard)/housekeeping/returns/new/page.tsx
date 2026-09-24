import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { gateRolePage } from "@/server/rbac";
import {
  listHousekeepingStaff,
  listReusableInCirculation,
  listRooms,
} from "@/server/actions/housekeeping";
import { ReturnForm } from "./_components/ReturnForm";

export const dynamic = "force-dynamic";

export default async function HousekeepingReturnPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const [items, rooms, staff] = await Promise.all([
    listReusableInCirculation(),
    listRooms({ activeOnly: true }),
    listHousekeepingStaff({ activeOnly: true }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping · Reusables"
        title="Return linen / towels"
        description="Bring reusable items back into clean stock after a wash — or write off any that were lost or damaged."
      />
      <ReturnForm
        items={items}
        rooms={rooms.map((r) => ({ id: r.id, number: r.number, name: r.name }))}
        staff={staff.map((s) => ({ id: s.id, name: s.name }))}
      />
    </>
  );
}
