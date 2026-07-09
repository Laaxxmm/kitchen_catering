import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { getOrder } from "@/server/actions/orders";
import { createIngredient, listIngredients } from "@/server/actions/inventory";
import { createChefRequisition } from "@/server/actions/chef-requisitions";
import type { ActionResultWith } from "@/lib/action-result";
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

  // Inline ingredient creator — the chef adds a missing catalogue item
  // right here instead of leaving for /inventory/ingredients/new. Opening
  // qty is omitted so it starts at 0 on hand; the requisition's shortage
  // path (AWAITING_PROCUREMENT) covers it. Gated inside createIngredient
  // (CATALOG_ROLES includes KITCHEN_HEAD).
  async function quickAddIngredient(input: {
    sku: string;
    name: string;
    unit: string;
    subStore: "VEGETABLE" | "GROCERY" | "MILK" | "WATER" | "OTHER";
    category?: string;
  }): Promise<ActionResultWith<{ id: string }>> {
    "use server";
    return await createIngredient({
      sku: input.sku,
      name: input.name,
      unit: input.unit,
      subStore: input.subStore,
      category: input.category ?? null,
    });
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
        onQuickAddIngredient={quickAddIngredient}
      />
    </>
  );
}
