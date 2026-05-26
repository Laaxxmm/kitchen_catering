import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listBanquetItems } from "@/server/actions/banquet";
import { ItemsTable } from "./_components/ItemsTable";

export const dynamic = "force-dynamic";

export default async function BanquetItemsPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE]);
  const items = await listBanquetItems({ activeOnly: false });
  const serialised = items.map((i) => ({
    id: i.id,
    name: i.name,
    sku: i.sku,
    category: i.category,
    unit: i.unit,
    currentStock: i.currentStock.toString(),
    minStock: i.minStock?.toString() ?? null,
    active: i.active,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Items"
        description="F&B disposables catalog. Stock auto-updates from receipts and issues."
        actions={<Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      <ItemsTable items={serialised} />
    </>
  );
}
