import Link from "next/link";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { getStoreStock } from "@/server/actions/store-stock";
import { getMaintenanceJobStats } from "@/server/actions/maintenance";
import { StoreLanding } from "@/components/ik/StoreLanding";
import { OpenJobsStrip } from "@/components/ik/dashboard/MaintenancePanel";

export const dynamic = "force-dynamic";

export default async function MaintenanceLandingPage() {
  const session = await gateRolePage([Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER]);
  // Stock arrives against an approved stock request; a bare receipt is
  // management's correction path.
  const canReceiptDirectly = session.user.role !== Role.MAINTENANCE_MANAGER;
  const [stock, jobs] = await Promise.all([getStoreStock("maintenance"), getMaintenanceJobStats()]);

  return (
    <>
      <StoreLanding
        title="Maintenance"
        description="Room jobs — logged, worked and closed with the spares used — and the spares store behind them."
        primary={
          <div className="flex flex-wrap gap-2">
            <Link href="/maintenance/activities/new"><Button>Log job</Button></Link>
            <Link href="/maintenance/purchase"><Button variant="outline">Receive against a stock request</Button></Link>
            {canReceiptDirectly && (
              <Link href="/maintenance/receipts/new"><Button variant="outline">Record receipt</Button></Link>
            )}
            <Link href="/maintenance/adjust"><Button variant="outline">Adjust stock</Button></Link>
          </div>
        }
        tabs={[
          { label: "Jobs", href: "/maintenance/activities" },
          { label: "Items", href: "/maintenance/items", active: true },
          { label: "Stock requests", href: "/maintenance/purchase" },
          { label: "Upload stock", href: "/maintenance/upload" },
          { label: "Rooms", href: "/housekeeping/rooms" },
          { label: "Staff", href: "/maintenance/staff" },
          { label: "Reports", href: "/maintenance/reports" },
          { label: "Receipts", href: "/maintenance/receipts" },
        ]}
        stock={stock}
        itemsHref="/maintenance/items"
        issuedLabel="Jobs"
      />
      <div className="mt-4">
        <OpenJobsStrip byPriority={jobs.openByPriority} oldestOpenAt={jobs.oldestOpenAt} />
      </div>
    </>
  );
}
