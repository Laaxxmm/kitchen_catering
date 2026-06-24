import Link from "next/link";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { getStoreStock } from "@/server/actions/store-stock";
import { StoreLanding } from "@/components/ik/StoreLanding";

export const dynamic = "force-dynamic";

export default async function HousekeepingLandingPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const stock = await getStoreStock("housekeeping");

  return (
    <StoreLanding
      title="Housekeeping"
      description="Hotel-side stockroom — soaps, towels, linens. What's low is up top."
      primary={
        <div className="flex flex-wrap gap-2">
          <Link href="/housekeeping/issues/new"><Button>New issue to room</Button></Link>
          <Link href="/housekeeping/returns/new"><Button variant="outline">Return linen</Button></Link>
          <Link href="/housekeeping/receipts/new"><Button variant="outline">Record receipt</Button></Link>
          <Link href="/housekeeping/adjust"><Button variant="outline">Adjust stock</Button></Link>
        </div>
      }
      tabs={[
        { label: "Items", href: "/housekeeping/items", active: true },
        { label: "Rooms", href: "/housekeeping/rooms" },
        { label: "Staff", href: "/housekeeping/staff" },
        { label: "Receipts", href: "/housekeeping/receipts" },
        { label: "Issues", href: "/housekeeping/issues" },
        { label: "Returns", href: "/housekeeping/returns/new" },
        { label: "Adjust stock", href: "/housekeeping/adjust" },
        { label: "Reports", href: "/housekeeping/reports" },
      ]}
      stock={stock}
      itemsHref="/housekeeping/items"
    />
  );
}
