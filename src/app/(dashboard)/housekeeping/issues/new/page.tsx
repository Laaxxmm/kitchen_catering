import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import {
  listHousekeepingItems,
  listHousekeepingStaff,
  listRooms,
} from "@/server/actions/housekeeping";
import { IssueForm } from "./_components/IssueForm";

export const dynamic = "force-dynamic";

export default async function NewIssuePage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);

  const [items, rooms, staff] = await Promise.all([
    listHousekeepingItems({ activeOnly: true }),
    listRooms({ activeOnly: true }),
    listHousekeepingStaff({ activeOnly: true }),
  ]);

  const missing: string[] = [];
  if (items.length === 0) missing.push("items");
  if (rooms.length === 0) missing.push("rooms");
  if (staff.length === 0) missing.push("staff");

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="New issue to room"
        description="Record items a housekeeping staff member took to a specific room."
        actions={
          <Link href="/housekeeping/issues">
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
        }
      />
      {missing.length > 0 ? (
        <div className="rounded-md border border-alert/30 bg-alert/5 p-4 text-[13px]">
          You need to add {missing.join(", ")} first.{" "}
          {items.length === 0 && (
            <Link href="/housekeeping/items" className="text-brand hover:underline">
              Add items
            </Link>
          )}
          {items.length === 0 && (rooms.length === 0 || staff.length === 0) && " · "}
          {rooms.length === 0 && (
            <Link href="/housekeeping/rooms" className="text-brand hover:underline">
              Add rooms
            </Link>
          )}
          {rooms.length === 0 && staff.length === 0 && " · "}
          {staff.length === 0 && (
            <Link href="/housekeeping/staff" className="text-brand hover:underline">
              Add staff
            </Link>
          )}
          .
        </div>
      ) : (
        <IssueForm
          items={items.map((i) => ({
            id: i.id,
            name: i.name,
            unit: i.unit,
            currentStock: i.currentStock.toString(),
          }))}
          rooms={rooms.map((r) => ({ id: r.id, number: r.number, name: r.name }))}
          staff={staff.map((s) => ({ id: s.id, name: s.name }))}
        />
      )}
    </>
  );
}
