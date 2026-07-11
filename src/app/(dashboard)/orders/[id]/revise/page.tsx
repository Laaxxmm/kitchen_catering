import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { getOrder, reviseOrder } from "@/server/actions/orders";
import { REVISABLE_ORDER_STATUSES, STATUS_LABEL } from "@/lib/order-status";
import { isPackagePricedChannel } from "@/lib/order-channels";
import { formatIST } from "@/lib/time";
import { ReviseOrderForm } from "./_components/ReviseOrderForm";

export const dynamic = "force-dynamic";

/**
 * Revise a confirmed order's quantities — the client changed the pax
 * (e.g. 50 → 30). Headcount, per-line portions (0 removes the line) and,
 * for package-priced channels, the renegotiated package total. Dish names
 * and prices are read-only here; the reviseOrder action re-validates
 * role, status and the 24-hour rule server-side.
 */
export default async function ReviseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.SALES]);
  const order = await getOrder(id);
  if (!order) notFound();

  async function doRevise(raw: unknown) {
    "use server";
    return reviseOrder(id, raw);
  }

  const revisable = REVISABLE_ORDER_STATUSES.includes(order.status);

  return (
    <>
      <PageHeader
        eyebrow={`Order ${order.code}`}
        title="Revise order"
        description={`${order.customer.name} · event ${formatIST(order.eventDate, "EEE d MMM yyyy HH:mm")} · currently ${order.headcount ?? "?"} pax. Adjust the headcount and portions; a note is required so the kitchen knows why.`}
        actions={<Link href={`/orders/${order.id}`}><Button variant="outline">Back to order</Button></Link>}
      />
      {!revisable ? (
        <div className="rounded-md border border-amber bg-amber-wash p-4 text-[13px] text-ik-ink">
          Too late — the order is <strong>{STATUS_LABEL[order.status].toLowerCase()}</strong>. Quantities
          can only be revised while the order is still in the kitchen&apos;s hands (up to “ready”).
        </div>
      ) : (
        <ReviseOrderForm
          orderId={order.id}
          currentHeadcount={order.headcount ?? 1}
          currentEventDate={formatIST(order.eventDate, "yyyy-MM-dd'T'HH:mm")}
          packageChannel={isPackagePricedChannel(order.channel)}
          currentContractValue={order.contractValue.toString()}
          lines={order.items.map((it) => ({
            id: it.id,
            dishName: it.dish.name,
            unit: it.dish.unit,
            portions: it.portions.toString(),
            unitPrice: it.unitPrice.toString(),
            discountPct: it.discountPct.toString(),
            gstRatePct: it.gstRatePct.toString(),
          }))}
          onSubmit={doRevise}
        />
      )}
    </>
  );
}
