import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";
import { deactivateIngredient, getIngredient, listIngredients, reactivateIngredient, updateIngredient } from "@/server/actions/inventory";
import { IngredientForm } from "../../_components/IngredientForm";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { MergeIngredient } from "@/components/ik/MergeIngredient";
import type { IngredientInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function IngredientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ingredient = await getIngredient(id);
  if (!ingredient) notFound();

  const session = await auth();
  const role = session?.user?.role as Role | undefined;
  const canMerge = role === Role.ADMIN || role === Role.MANAGER;
  // Target picker: active ingredients only, minus this one.
  const mergeTargets = canMerge
    ? (await listIngredients({ active: true }))
        .filter((i) => i.id !== id)
        .map((i) => ({ id: i.id, name: i.name, sku: i.sku }))
    : [];

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
  async function reactivate() {
    "use server";
    return await reactivateIngredient(id);
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
            {ingredient.active ? (
              <ActionResultButton action={deactivate} variant="outline" successMessage="Ingredient hidden — reactivate any time">
                Hide (deactivate)
              </ActionResultButton>
            ) : (
              <ActionResultButton action={reactivate} successMessage="Ingredient visible again">
                Unhide (reactivate)
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
      {canMerge && (
        <MergeIngredient sourceId={id} sourceName={ingredient.name} targets={mergeTargets} />
      )}
    </>
  );
}
