import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { getEventPrepOrder } from "@/server/actions/deliveries";
import { getOrderCutleryLedger, listBanquetItems } from "@/server/actions/banquet";
import { EventPrepForm } from "./_components/EventPrepForm";

export const dynamic = "force-dynamic";

export default async function EventPrepPage({ params }: { params: Promise<{ orderId: string }> }) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY]);
  const { orderId } = await params;
  const [order, items, ledger] = await Promise.all([
    getEventPrepOrder(orderId),
    listBanquetItems({ activeOnly: true }),
    getOrderCutleryLedger(orderId),
  ]);
  if (!order) notFound();

  return (
    <>
      <PageHeader
        eyebrow="F&B Service · Event prep"
        title="Ready cutlery & arrangements"
        description="Choose what this event needs, issue what's in stock, request the rest from the store, then mark it ready. After the event, record what comes back — the balance stays on the client's account."
        actions={<Link href="/dashboard"><Button variant="outline" size="sm">← Back</Button></Link>}
      />
      <EventPrepForm
        order={order}
        items={items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, currentStock: i.currentStock.toString() }))}
        ledger={ledger}
      />
    </>
  );
}
