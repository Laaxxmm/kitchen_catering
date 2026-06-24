import Link from "next/link";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { getStoreStock } from "@/server/actions/store-stock";
import { StoreLanding } from "@/components/ik/StoreLanding";

export const dynamic = "force-dynamic";

export default async function MaintenanceLandingPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER]);
  const stock = await getStoreStock("maintenance");

  return (
    <StoreLanding
      title="Maintenance"
      description="Electrical + mechanical spares (switches, pipes, bulbs, washers). What's low is up top."
      primary={
        <div className="flex flex-wrap gap-2">
          <Link href="/maintenance/activities/new"><Button>Log activity</Button></Link>
          <Link href="/maintenance/receipts/new"><Button variant="outline">Record receipt</Button></Link>
          <Link href="/maintenance/adjust"><Button variant="outline">Adjust stock</Button></Link>
        </div>
      }
      tabs={[
        { label: "Items", href: "/maintenance/items", active: true },
        { label: "Staff", href: "/maintenance/staff" },
        { label: "Receipts", href: "/maintenance/receipts" },
        { label: "Activities", href: "/maintenance/activities" },
        { label: "Adjust stock", href: "/maintenance/adjust" },
        { label: "Reports", href: "/maintenance/reports" },
      ]}
      stock={stock}
      itemsHref="/maintenance/items"
      issuedLabel="Activities"
    />
  );
}
