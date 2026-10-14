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
  // Housekeeping reports a defect; it lands PENDING with no spares and no
  // technician — the maintenance desk assigns it — and they have no
  // business on the maintenance list afterwards.
  const reportOnly = session.user.role === Role.HOUSEKEEPING_MANAGER;
  const backHref = reportOnly ? "/housekeeping" : "/maintenance/activities";

  const [rooms, staff, items] = await Promise.all([
    listRooms({ activeOnly: true }),
    reportOnly ? [] : listMaintenanceStaff({ activeOnly: true }),
    reportOnly ? [] : listMaintenanceItems({ activeOnly: true }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title={reportOnly ? "Report a job" : "Log job"}
        description={
          reportOnly
            ? "Report a defect at a room — the maintenance desk picks it up from its pending list."
            : "Log a job at a room. Leave it pending to assign and close later, or record it done with the spares used."
        }
        actions={<Link href={backHref}><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      {rooms.length === 0 ? (
        <div className="rounded-md border border-alert/30 bg-alert/5 p-4 text-[13px]">
          You need to add rooms (shared with housekeeping) first.{" "}
          <Link href="/housekeeping/rooms" className="text-brand hover:underline">Add rooms</Link>.
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
