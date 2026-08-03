import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listBanquetItems } from "@/server/actions/banquet";
import { ItemsTable } from "./_components/ItemsTable";

export const dynamic = "force-dynamic";

export default async function BanquetItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const sp = await searchParams;
  // The whole F&B Service team manages the banquet catalogue.
  const session = await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER]);
  // Catalogue changes (add / edit) are management-only — see upsertBanquetItem.
  const canManage = session.user.role === Role.ADMIN || session.user.role === Role.MANAGER;
  const canCreate = canManage;
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
        actions={
          <div className="flex gap-2">
            <Link href="/banquet/stock-count"><Button variant="outline" size="sm">Stock count (bulk)</Button></Link>
            <Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />
      <ItemsTable items={serialised} canManage={canManage} canCreate={canCreate} startOpen={sp.new === "1" && canCreate} />
    </>
  );
}
