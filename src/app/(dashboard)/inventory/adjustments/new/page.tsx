import { PageHeader } from "@/components/ui/page-header";
import { adjustIngredientStock, listIngredients } from "@/server/actions/inventory";
import type { IngredientAdjustmentInputT } from "@/lib/validators";
import { AdjustmentForm } from "../../_components/AdjustmentForm";

export const dynamic = "force-dynamic";

export default async function NewAdjustmentPage() {
  const ingredients = await listIngredients({ active: true });

  async function submit(input: IngredientAdjustmentInputT) {
    "use server";
    return adjustIngredientStock(input);
  }

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Adjust stock"
        description="Manual on-hand correction for ONE item (write-off, opening fix, spoilage). Setting many items? Use Stock count (bulk) — every ingredient in one table, enter quantities row-wise, post once. Average cost is not changed — for that, record a fresh receipt."
      />
      <AdjustmentForm
        ingredients={ingredients.map((i) => ({
          id: i.id,
          name: i.name,
          sku: i.sku,
          unit: i.unit,
          onHandQty: i.onHandQty.toString(),
        }))}
        onSubmit={submit}
        redirectOnSuccess="/inventory/adjustments"
      />
    </>
  );
}
