import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listIngredients } from "@/server/actions/inventory";
import { InventoryNav } from "../_components/InventoryNav";

export const dynamic = "force-dynamic";

export default async function IngredientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; low?: string }>;
}) {
  const sp = await searchParams;
  const ingredients = await listIngredients({
    query: sp.q,
    active: true,
    lowStock: sp.low === "1",
  });

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Ingredients"
        description="Raw materials with moving-average cost. Receipts update on-hand quantity and average cost in one transaction."
        actions={
          <Link href="/inventory/ingredients/new">
            <Button>New ingredient</Button>
          </Link>
        }
      />
      <InventoryNav active="ingredients" />

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/inventory/ingredients">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search by name or SKU…"
          className="h-9 w-64 rounded-md border border-ik-rule bg-ik-card px-3 text-[13px]"
        />
        <label className="flex items-center gap-1 text-[12px] text-ik-ink-2">
          <input type="checkbox" name="low" value="1" defaultChecked={sp.low === "1"} />
          Low stock only
        </label>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      {ingredients.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No ingredients.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">On hand</TableHead>
              <TableHead className="text-right">Avg cost</TableHead>
              <TableHead className="text-right">Reorder at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ingredients.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-mono text-[12px]">{i.sku}</TableCell>
                <TableCell>
                  <Link href={`/inventory/ingredients/${i.id}`} className="text-brand hover:underline">
                    {i.name}
                  </Link>
                </TableCell>
                <TableCell>{i.category ?? "—"}</TableCell>
                <TableCell>{i.unit}</TableCell>
                <TableCell className="text-right font-mono">{i.onHandQty.toString()}</TableCell>
                <TableCell className="text-right font-mono">{i.avgUnitCost.toString()}</TableCell>
                <TableCell className="text-right font-mono text-ik-ink-3">{i.reorderLevel.toString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
