import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { deactivateIngredient, getIngredient, updateIngredient } from "@/server/actions/inventory";
import { IngredientForm } from "../../_components/IngredientForm";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import type { IngredientInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function IngredientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ingredient = await getIngredient(id);
  if (!ingredient) notFound();

  async function update(input: IngredientInputT) {
    "use server";
    const res = await updateIngredient(id, input);
    if (!res.ok) return res;
    return { ok: true as const, id };
  }
  async function deactivate() {
    "use server";
    return await deactivateIngredient(id);
  }

  return (
    <>
      <PageHeader
        eyebrow="Inventory · Ingredient"
        title={ingredient.name}
        description={`On hand: ${ingredient.onHandQty.toString()} ${ingredient.unit} · Avg cost ₹${ingredient.avgUnitCost.toString()}`}
        actions={
          <div className="flex gap-2">
            <Link href="/inventory/ingredients"><Button variant="outline">Back</Button></Link>
            {ingredient.active && (
              <ActionResultButton action={deactivate} variant="outline" successMessage="Ingredient deactivated">
                Deactivate
              </ActionResultButton>
            )}
          </div>
        }
      />
      <IngredientForm
        defaults={{
          sku: ingredient.sku,
          name: ingredient.name,
          category: ingredient.category,
          subStore: ingredient.subStore,
          unit: ingredient.unit,
          reorderLevel: ingredient.reorderLevel.toString(),
          hsnSac: ingredient.hsnSac,
          gstRatePct: ingredient.gstRatePct.toString(),
        }}
        hideOpeningFields
        onSubmit={update}
        submitLabel="Save changes"
      />
    </>
  );
}
