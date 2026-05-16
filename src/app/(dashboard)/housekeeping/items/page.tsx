import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listHousekeepingItems } from "@/server/actions/housekeeping";
import { ItemsTable } from "./_components/ItemsTable";

export const dynamic = "force-dynamic";

export default async function HousekeepingItemsPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const items = await listHousekeepingItems({ activeOnly: false });
  const serialised = items.map((i) => ({
    id: i.id,
    name: i.name,
    sku: i.sku,
    unit: i.unit,
    currentStock: i.currentStock.toString(),
    minStock: i.minStock?.toString() ?? null,
    active: i.active,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Items"
        description="Catalog of housekeeping supplies. Stock auto-updates from receipts and issues."
        actions={
          <Link href="/housekeeping">
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
        }
      />
      <ItemsTable items={serialised} />
    </>
  );
}
