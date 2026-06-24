import Link from "next/link";
import { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { getStoreStock } from "@/server/actions/store-stock";
import { StoreLanding } from "@/components/ik/StoreLanding";

export const dynamic = "force-dynamic";

export default async function BanquetLandingPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE]);
  const stock = await getStoreStock("banquet");

  return (
    <StoreLanding
      title="Banquet store"
      description="F&B disposables — cups, trays, foil, takeaway boxes. What's low is up top."
      primary={
        <div className="flex flex-wrap gap-2">
          <Link href="/banquet/issues/new"><Button>Issue to event</Button></Link>
          <Link href="/banquet/receipts/new"><Button variant="outline">Record receipt</Button></Link>
        </div>
      }
      tabs={[
        { label: "Items", href: "/banquet/items", active: true },
        { label: "Receipts", href: "/banquet/receipts" },
        { label: "Issues", href: "/banquet/issues" },
        { label: "Reports", href: "/banquet/reports" },
      ]}
      stock={stock}
      itemsHref="/banquet/items"
    />
  );
}
