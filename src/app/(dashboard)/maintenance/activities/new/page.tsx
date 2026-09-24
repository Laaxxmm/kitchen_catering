import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import {
  listMaintenanceItems,
  listMaintenanceStaff,
} from "@/server/actions/maintenance";
import { listRooms } from "@/server/actions/housekeeping";
import { ActivityForm } from "./_components/ActivityForm";

export const dynamic = "force-dynamic";

export default async function NewActivityPage() {
  const session = await gateRolePage([
    Role.ADMIN,
    Role.MANAGER,
    Role.MAINTENANCE_MANAGER,
    Role.HOUSEKEEPING_MANAGER,
  ]);
  // Housekeeping reports a defect; it lands PENDING with no spares, and
  // they have no business on the maintenance list afterwards.
  const reportOnly = session.user.role === Role.HOUSEKEEPING_MANAGER;
  const backHref = reportOnly ? "/housekeeping" : "/maintenance/activities";

  const [rooms, staff] = await Promise.all([
    listRooms({ activeOnly: true }),
    listMaintenanceStaff({ activeOnly: true }),
  ]);
  const items: Awaited<ReturnType<typeof listMaintenanceItems>> = reportOnly
    ? []
    : await listMaintenanceItems({ activeOnly: true });

  const missing: string[] = [];
  if (rooms.length === 0) missing.push("rooms (shared with housekeeping)");
  if (staff.length === 0) missing.push("staff");

  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title={reportOnly ? "Report a job" : "Log activity"}
        description={
          reportOnly
            ? "Report a defect at a room — the maintenance desk picks it up from its pending list."
            : "Record one work visit at a room — what was reported, what was done, and any spares used."
        }
        actions={<Link href={backHref}><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      {missing.length > 0 ? (
        <div className="rounded-md border border-alert/30 bg-alert/5 p-4 text-[13px]">
          You need to add {missing.join(", ")} first.{" "}
          {rooms.length === 0 && (
            <Link href="/housekeeping/rooms" className="text-brand hover:underline">Add rooms</Link>
          )}
          {rooms.length === 0 && staff.length === 0 && " · "}
          {staff.length === 0 && (
            <Link href="/maintenance/staff" className="text-brand hover:underline">Add staff</Link>
          )}
          .
        </div>
      ) : (
        <ActivityForm
          items={items.map((i) => ({
            id: i.id,
            name: i.name,
            unit: i.unit,
            category: i.category,
            currentStock: i.currentStock.toString(),
          }))}
          rooms={rooms.map((r) => ({ id: r.id, number: r.number, name: r.name }))}
          staff={staff.map((s) => ({ id: s.id, name: s.name, category: s.category }))}
          reportOnly={reportOnly}
          doneHref={backHref}
        />
      )}
    </>
  );
}
