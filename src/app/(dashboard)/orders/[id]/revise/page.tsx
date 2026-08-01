import Link from "next/link";
import { notFound } from "next/navigation";
import { OrderChannel, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { getOrder, reviseOrder } from "@/server/actions/orders";
import { listDishes } from "@/server/actions/dishes";
import { REVISABLE_ORDER_STATUSES, STATUS_LABEL } from "@/lib/order-status";
import { isPackagePricedChannel } from "@/lib/order-channels";
import { formatIST } from "@/lib/time";
import { ReviseOrderForm } from "./_components/ReviseOrderForm";

export const dynamic = "force-dynamic";

/** Which dish menu a channel draws from — mirrors OrderForm.menuForChannel. */
function menuForChannel(channel: OrderChannel): "BANQUET" | "SERVICE" {
  switch (channel) {
    case OrderChannel.ROOM_SERVICE:
    case OrderChannel.ALACARTE:
    case OrderChannel.MANAGEMENT:
      return "SERVICE";
    default: // BANQUET, ODC, PACKET
      return "BANQUET";
  }
}

/**
 * Revise a confirmed order's quantities — the client changed the pax
 * (e.g. 50 → 30). Headcount, per-line portions (0 removes the line),
 * the meal type, NEW dishes (priced server-side from the menu) and,
 * for package-priced channels, the renegotiated package total. Existing
 * prices are read-only here; the reviseOrder action re-validates
 * role, status and the 24-hour rule server-side.
 */
export default async function ReviseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.SALES]);
  const [order, allDishes] = await Promise.all([getOrder(id), listDishes({ active: true })]);
  if (!order) notFound();

  // Dishes the "Add dish" picker offers: the order's channel menu.
  const wantMenu = menuForChannel(order.channel);
  const menuDishes = allDishes.filter((d) => d.menu === wantMenu || d.menu === "BOTH");

  async function doRevise(raw: unknown) {
    "use server";
    return reviseOrder(id, raw);
  }

  const revisable = REVISABLE_ORDER_STATUSES.includes(order.status);

  // Inline dish creator — counter sales sell ad-hoc items; the manager adds
  // the dish here and it lands straight on the revision. createDish gates
  // roles server-side (admin/manager/chef/sales).
  async function quickAddDish(input: {
    name: string;
    unitPrice: string;
    gstRatePct: string;
    unit: string;
    category?: string;
  }) {
    "use server";
    const { createDish } = await import("@/server/actions/dishes");
    return await createDish({
      name: input.name,
      unitPrice: input.unitPrice,
      gstRatePct: input.gstRatePct,
      unit: input.unit,
      category: input.category ?? null,
      code: null,
      description: null,
      hsnSac: null,
    });
  }

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
          currentMealType={order.mealType}
          packageChannel={isPackagePricedChannel(order.channel)}
          currentContractValue={order.contractValue.toString()}
          dishes={menuDishes.map((d) => ({
            id: d.id,
            name: d.name,
            unit: d.unit,
            unitPrice: d.unitPrice.toString(),
            gstRatePct: d.gstRatePct.toString(),
          }))}
          lines={order.items.map((it) => ({
            id: it.id,
            dishName: it.dish.name,
            unit: it.dish.unit,
            portions: it.portions.toString(),
            unitPrice: it.unitPrice.toString(),
            discountPct: it.discountPct.toString(),
            gstRatePct: it.gstRatePct.toString(),
          }))}
          onQuickAddDish={quickAddDish}
          onSubmit={doRevise}
        />
      )}
    </>
  );
}
