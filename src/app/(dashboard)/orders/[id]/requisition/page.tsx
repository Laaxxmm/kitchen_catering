import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getOrder } from "@/server/actions/orders";
import { listIngredients } from "@/server/actions/inventory";
import { createChefRequisition } from "@/server/actions/chef-requisitions";
import { formatIST } from "@/lib/time";
import { RequisitionDraftForm } from "./_components/RequisitionDraftForm";

export const dynamic = "force-dynamic";

export default async function RaiseRequisitionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [order, ingredients] = await Promise.all([
    getOrder(id),
    listIngredients({ active: true }),
  ]);
  if (!order) notFound();

  async function create(lines: Array<{ ingredientId: string; requestedQty: string; orderItemId: string | null; notes: string | null }>) {
    "use server";
    const result = await createChefRequisition({
      orderId: id,
      lines: lines.map((l) => ({
        ingredientId: l.ingredientId,
        requestedQty: l.requestedQty,
        orderItemId: l.orderItemId,
        notes: l.notes,
      })),
    });
    if (!result.ok) return result;
    redirect(`/requisitions/${result.id}`);
  }

  // No inline ingredient creator — adding catalogue items is management-only
  // now (see CATALOG_CREATE_ROLES); the chef picks from what already exists.
  return (
    <>
      <PageHeader
        eyebrow={`Order ${order.code}`}
        title="Raise chef requisition"
        description="Add the ingredients you need from the store. On submit the requisition starts in DRAFT — open it from /requisitions/[id] to submit for fulfilment."
      />

      {/* The menu being cooked — in front of the chef while they provision,
          so they never have to flip back to the order to remember it. */}
      <section className="mb-4 rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Cooking for</h3>
          <span className="text-[12.5px] font-medium text-ik-ink">
            {order.headcount} pax · {order.mealType.replace("_", " ")} ·{" "}
            {formatIST(order.eventDate, "EEE d MMM, HH:mm")}
          </span>
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {order.items.map((it) => (
            <li
              key={it.id}
              className="rounded-full bg-ik-paper-alt px-2.5 py-1 text-[12px] text-ik-ink ring-1 ring-ik-rule"
            >
              <span className="font-medium">{it.dish.name}</span>
              <span className="text-ik-ink-3"> · {it.portions.toString()}</span>
            </li>
          ))}
        </ul>
      </section>

      <RequisitionDraftForm
        ingredients={ingredients.map((i) => ({
          id: i.id,
          name: i.name,
          sku: i.sku,
          unit: i.unit,
          avgCost: i.avgUnitCost.toString(),
        }))}
        orderItems={order.items.map((it) => ({ id: it.id, dishName: it.dish.name }))}
        onSubmit={create}
      />
    </>
  );
}
