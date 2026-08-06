import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { listBanquetItems, listBanquetEvents, getBanquetEvent } from "@/server/actions/banquet";
import { RequestForm } from "./_components/RequestForm";

export const dynamic = "force-dynamic";

export default async function BanquetRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER]);
  // Arriving from an order's event-prep screen ("Don't have it? Request from
  // store") means the order is already known — carry it through and lock it,
  // instead of asking someone to re-pick it from a list they can forget.
  const { orderId } = await searchParams;
  const [items, events, lockedOrder] = await Promise.all([
    listBanquetItems({ activeOnly: true }),
    listBanquetEvents(),
    orderId ? getBanquetEvent(orderId) : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Banquet store"
        title="Raise a stock requisition"
        description="Ask the banquet store for cutlery / disposables. Pick items and quantities; the store keeper issues them line by line (or raises a PO for anything short)."
        actions={
          <div className="flex gap-2">
            <Link href="/banquet/requisitions"><Button variant="outline" size="sm">Requisitions</Button></Link>
            <Link href="/banquet"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />
      <RequestForm
        items={items.map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, currentStock: i.currentStock.toString() }))}
        events={events.map((e) => ({ id: e.id, code: e.code, customerName: e.customerName }))}
        lockedOrder={lockedOrder}
      />
    </>
  );
}
