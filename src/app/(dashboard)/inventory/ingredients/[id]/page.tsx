import Link from "next/link";
import { notFound } from "next/navigation";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { deactivateIngredient, getIngredient, listIngredientMovements, listIngredients, reactivateIngredient, updateIngredient } from "@/server/actions/inventory";
import { formatIST } from "@/lib/time";
import { IngredientForm } from "../../_components/IngredientForm";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { MergeIngredient } from "@/components/ik/MergeIngredient";
import type { IngredientInputT } from "@/lib/validators";

export const dynamic = "force-dynamic";

const MOVEMENT_LABELS = { RECEIPT: "Receipt", ISSUE: "Issue", ADJUSTMENT: "Adjustment" } as const;

export default async function IngredientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ingredient, movements] = await Promise.all([
    getIngredient(id),
    listIngredientMovements(id),
  ]);
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

      <section className="mt-8">
        <h3 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
          Movement history{movements.length >= 100 ? " (latest 100)" : ""}
        </h3>
        {movements.length === 0 ? (
          <p className="text-[12.5px] text-ik-ink-3">No stock movements recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m) => (
                <TableRow key={`${m.kind}-${m.id}`}>
                  <TableCell className="font-mono text-[12px]">
                    {formatIST(m.at, "yyyy-MM-dd HH:mm")}
                  </TableCell>
                  <TableCell>
                    <span className="text-[11.5px] font-medium uppercase tracking-wide text-ik-ink-2">
                      {MOVEMENT_LABELS[m.kind]}
                    </span>
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono ${m.qty.startsWith("-") ? "text-alert" : "text-positive"}`}
                  >
                    {m.qty} {ingredient.unit}
                  </TableCell>
                  <TableCell className="text-[12.5px]">{m.by ?? "—"}</TableCell>
                  <TableCell className="text-[12.5px] text-ik-ink-2">{m.detail || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}
