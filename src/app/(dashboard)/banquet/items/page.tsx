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
  // Editing / deactivating / deleting the catalogue stays with WRITE_ROLES.
  // The store keeper may only CREATE a new item (they add the SKU they're
  // receiving), mirroring the server-side gate on upsertBanquetItem.
  const WRITE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY];
  const canManage = WRITE_ROLES.includes(session.user.role);
  const canCreate = canManage || session.user.role === Role.STORE_KEEPER;
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
