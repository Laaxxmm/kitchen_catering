import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listBanquetItems } from "@/server/actions/banquet";
import { canEditStockDirectly } from "@/lib/stock-movement";
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
  const canEditStock = canEditStockDirectly(session.user.role);
  const items = await listBanquetItems({ activeOnly: false });
  const serialised = items.map((i) => ({
    id: i.id,
    name: i.name,
    sku: i.sku,
    source: i.source,
    category: i.category,
    unit: i.unit,
    rate: i.rate?.toString() ?? null,
    currentStock: i.currentStock.toString(),
    minStock: i.minStock?.toString() ?? null,
    active: i.active,
  }));

  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Items"
        description="F&B catalogue — in-house stock and cutlery/crockery hired in from outside. Stock auto-updates from receipts and issues."
        actions={
          <div className="flex gap-2">
            {/* Direct stock editing is ADMIN/MANAGER only — everyone else
                would bounce off /banquet/stock-count into /forbidden. */}
            {canEditStock && (
              <Link href="/banquet/stock-count"><Button variant="outline" size="sm">Stock count (bulk)</Button></Link>
            )}
            <Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />
      <ItemsTable items={serialised} canManage={canManage} canCreate={canCreate} startOpen={sp.new === "1" && canCreate} />
    </>
  );
}
