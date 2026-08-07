import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { db } from "@/server/db";
import { getOrderBanquetLedger } from "@/server/actions/banquet";
import { BanquetReturnPanel } from "@/components/ik/BanquetReturnPanel";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * The F&B store's own way in to the order-wise return — the same movement the
 * delivery team's event-prep screen records, reached from the store instead of
 * from the event. Gate mirrors recordBanquetReturn (ISSUE_ROLES).
 */
export default async function BanquetOrderReturnPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await gateRolePage([
    Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER,
  ]);
  const { orderId } = await params;
  const [order, ledger] = await Promise.all([
    db.order.findUnique({
      where: { id: orderId },
      select: { id: true, code: true, eventDate: true, customer: { select: { name: true } } },
    }),
    getOrderBanquetLedger(orderId),
  ]);
  if (!order) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Banquet store · Returns"
        title={`${order.code} · ${order.customer.name}`}
        description={`${formatIST(order.eventDate, "EEE d MMM yyyy")} — everything issued from the F&B store to this order. Enter what came back; it goes straight back on the shelf as sellable stock.`}
        actions={
          <div className="flex gap-2">
            <Link href={`/orders/${order.id}`}><Button variant="outline" size="sm">Open order</Button></Link>
            <Link href="/banquet/returns"><Button variant="outline" size="sm">← Back</Button></Link>
          </div>
        }
      />
      {ledger.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          Nothing was issued from the F&amp;B store to this order, so there is nothing to take back.
        </p>
      ) : (
        <div className="grid max-w-3xl gap-4">
          <BanquetReturnPanel orderId={order.id} ledger={ledger} />
        </div>
      )}
    </>
  );
}
