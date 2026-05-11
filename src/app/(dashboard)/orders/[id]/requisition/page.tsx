import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getOrder } from "@/server/actions/orders";
import { listIngredients } from "@/server/actions/inventory";
import { createChefRequisition } from "@/server/actions/chef-requisitions";
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
    redirect(`/requisitions/${result.id}`);
  }

  return (
    <>
      <PageHeader
        eyebrow={`Order ${order.code}`}
        title="Raise chef requisition"
        description="Add the ingredients you need from the store. On submit the requisition starts in DRAFT — open it from /requisitions/[id] to submit for fulfilment."
      />
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
