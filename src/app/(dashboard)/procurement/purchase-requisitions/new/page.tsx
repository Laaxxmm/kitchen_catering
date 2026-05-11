import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { listIngredients } from "@/server/actions/inventory";
import { createPurchaseRequisition } from "@/server/actions/purchase-requisitions";
import { PRDraftForm } from "./_components/PRDraftForm";

export const dynamic = "force-dynamic";

export default async function NewPRPage() {
  const ingredients = await listIngredients({ active: true });
  async function create(lines: Array<{ ingredientId: string; requestedQty: string; notes: string | null }>, notes: string | null) {
    "use server";
    const r = await createPurchaseRequisition({ lines, notes });
    redirect(`/procurement/purchase-requisitions/${r.id}`);
  }
  return (
    <>
      <PageHeader eyebrow="Procurement" title="New purchase requisition" description="Add ingredient lines, then Submit. PRs under ₹1L auto-approve; larger ones need a manager." />
      <PRDraftForm
        ingredients={ingredients.map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, avgCost: i.avgUnitCost.toString() }))}
        onSubmit={create}
      />
    </>
  );
}
