import Link from "next/link";
import { DeptJobStatus, Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { db } from "@/server/db";
import { gateRolePage } from "@/server/rbac";
import { getStoreStock } from "@/server/actions/store-stock";
import { StoreLanding } from "@/components/ik/StoreLanding";

export const dynamic = "force-dynamic";

export default async function HousekeepingLandingPage() {
  const session = await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const [stock, openJobs] = await Promise.all([
    getStoreStock("housekeeping"),
    db.housekeepingJob.count({
      where: { status: { in: [DeptJobStatus.OPEN, DeptJobStatus.IN_PROGRESS] } },
    }),
  ]);
  // Stock arrives against approved stock requests; a direct receipt is the
  // manager's correction path only.
  const canPostReceipt = session.user.role === Role.ADMIN || session.user.role === Role.MANAGER;

  return (
    <StoreLanding
      title="Housekeeping"
      description="The department's own jobs and stockroom — soaps, towels, linens. What's low is up top."
      primary={
        <div className="flex flex-wrap gap-2">
          <Link href="/housekeeping/jobs/new"><Button>New job</Button></Link>
          <Link href="/housekeeping/issues/new"><Button variant="outline">Issue to room</Button></Link>
          <Link href="/housekeeping/returns/new"><Button variant="outline">Return linen</Button></Link>
          <Link href="/housekeeping/purchase"><Button variant="outline">Receive against a stock request</Button></Link>
          {canPostReceipt && (
            <Link href="/housekeeping/receipts/new"><Button variant="outline">Record receipt</Button></Link>
          )}
          <Link href="/housekeeping/adjust"><Button variant="outline">Adjust stock</Button></Link>
        </div>
      }
      tabs={[
        { label: openJobs > 0 ? `Jobs · ${openJobs} open` : "Jobs", href: "/housekeeping/jobs" },
        { label: "Issue to room", href: "/housekeeping/issues" },
        { label: "Returns", href: "/housekeeping/returns" },
        { label: "Items", href: "/housekeeping/items", active: true },
        { label: "Stock requests", href: "/housekeeping/purchase" },
        ...(canPostReceipt ? [{ label: "Upload stock", href: "/housekeeping/upload" }] : []),
        { label: "Receipts", href: "/housekeeping/receipts" },
        { label: "Rooms", href: "/housekeeping/rooms" },
        { label: "Staff", href: "/housekeeping/staff" },
        { label: "Reports", href: "/housekeeping/reports" },
      ]}
      stock={stock}
      itemsHref="/housekeeping/items"
    />
  );
}
