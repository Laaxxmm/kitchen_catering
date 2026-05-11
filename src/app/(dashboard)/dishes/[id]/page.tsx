import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deactivateDish, getDish, updateDish } from "@/server/actions/dishes";
import { DishForm } from "../_components/DishForm";
import { getSettingBool } from "@/lib/settings";
import type { DishInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function DishDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [dish, recipesEnabled] = await Promise.all([
    getDish(id),
    getSettingBool("recipe.suggestionsEnabled"),
  ]);
  if (!dish) notFound();

  async function update(input: DishInputT) {
    "use server";
    await updateDish(id, input);
    return { id };
  }
  async function deactivate() {
    "use server";
    await deactivateDish(id);
  }

  return (
    <>
      <PageHeader
        eyebrow={`Dish · ${dish.active ? "Active" : "Inactive"}`}
        title={dish.name}
        description={dish.code ? `Code ${dish.code}` : "No code"}
        actions={
          <div className="flex gap-2">
            <Link href="/dishes"><Button variant="outline">Back</Button></Link>
            {dish.active && (
              <form action={deactivate}>
                <Button variant="outline" type="submit">Deactivate</Button>
              </form>
            )}
          </div>
        }
      />

      <DishForm
        defaults={{
          code: dish.code,
          name: dish.name,
          category: dish.category,
          description: dish.description,
          unitPrice: dish.unitPrice.toString(),
          unit: dish.unit,
          hsnSac: dish.hsnSac,
          gstRatePct: dish.gstRatePct.toString(),
        }}
        onSubmit={update}
        submitLabel="Save changes"
      />

      <section className="mt-8 max-w-3xl">
        <h2 className="mb-2 font-medium text-[15px] text-ik-ink">Recipe</h2>
        {!recipesEnabled ? (
          <p className="rounded-md border border-ik-rule bg-ik-paper-alt p-3 text-[12.5px] text-ik-ink-2">
            Recipe editor is hidden until <code>recipe.suggestionsEnabled</code> is turned on in Admin settings.
            When on, this dish&apos;s recipe drives the chef-requisition pre-fill at order approval time.
          </p>
        ) : dish.recipe ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Wastage %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dish.recipe.ingredients.map((ri) => (
                <TableRow key={ri.id}>
                  <TableCell>{ri.ingredient.name}</TableCell>
                  <TableCell className="text-right font-mono">{ri.qty.toString()}</TableCell>
                  <TableCell>{ri.unit}</TableCell>
                  <TableCell className="text-right font-mono">{ri.wastagePercent.toString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="rounded-md border border-ik-rule bg-ik-paper-alt p-3 text-[12.5px] text-ik-ink-2">
            No recipe yet. The recipe-editor UI is part of Phase 1 follow-up; for now upsert via the
            <code className="mx-1">upsertRecipe</code> server action.
          </p>
        )}
      </section>
    </>
  );
}
