"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { QuickAddIngredient, type QuickIngredientInput } from "@/components/ik/QuickAddIngredient";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult, ActionResultWith } from "@/lib/action-result";

interface Ingredient { id: string; name: string; sku: string; unit: string; avgCost: string }
interface OrderItem { id: string; dishName: string }

interface Props {
  ingredients: Ingredient[];
  orderItems: OrderItem[];
  onSubmit: (lines: Array<{ ingredientId: string; requestedQty: string; orderItemId: string | null; notes: string | null }>) => Promise<ActionResult | void>;
  /** Inline ingredient creator — lets the chef add a missing catalogue item without leaving the form. */
  onQuickAddIngredient?: (input: QuickIngredientInput) => Promise<ActionResultWith<{ id: string }>>;
}

interface DraftLine {
  ingredientId: string;
  requestedQty: string;
  orderItemId: string;
  notes: string;
}

function emptyLine(firstIngredientId = ""): DraftLine {
  return { ingredientId: firstIngredientId, requestedQty: "1", orderItemId: "", notes: "" };
}

export function RequisitionDraftForm({ ingredients, orderItems, onSubmit, onQuickAddIngredient }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  // Local copy so a quick-added ingredient shows up in the picker instantly.
  const [ingredientList, setIngredientList] = useState<Ingredient[]>(ingredients);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(ingredients[0]?.id ?? "")]);

  // Searchable ingredient options — the catalogue is long, so the chef types
  // to filter instead of scrolling a giant dropdown.
  const ingredientOptions = useMemo(
    () => ingredientList.map((i) => ({ value: i.id, label: `${i.sku} · ${i.name}` })),
    [ingredientList],
  );

  function setLine(idx: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  // A freshly quick-added ingredient (0 on hand, 0 avg cost) drops into the
  // first line that has no ingredient yet, or a new line.
  function onIngredientCreated(ing: { id: string; sku: string; name: string; unit: string }) {
    setIngredientList((prev) => [{ ...ing, avgCost: "0" }, ...prev]);
    setLines((prev) => {
      const emptyIdx = prev.findIndex((l) => !l.ingredientId);
      if (emptyIdx >= 0) {
        return prev.map((l, i) => (i === emptyIdx ? { ...l, ingredientId: ing.id } : l));
      }
      return [...prev, { ...emptyLine(), ingredientId: ing.id }];
    });
  }

  const totalCost = useMemo(() => {
    let sum = new Decimal(0);
    for (const l of lines) {
      const ing = ingredientList.find((i) => i.id === l.ingredientId);
      if (!ing) continue;
      sum = sum.plus(new Decimal(l.requestedQty || "0").times(new Decimal(ing.avgCost || "0")));
    }
    return sum.toDecimalPlaces(2);
  }, [lines, ingredientList]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = lines
      .filter((l) => l.ingredientId && Number(l.requestedQty) > 0)
      .map((l) => ({
        ingredientId: l.ingredientId,
        requestedQty: l.requestedQty,
        orderItemId: l.orderItemId || null,
        notes: l.notes || null,
      }));
    if (payload.length === 0) return toast.error("Add at least one line");
    startTransition(async () => {
      try {
        const res = await onSubmit(payload);
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-[14px] text-ik-ink">Lines</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, emptyLine(ingredientList[0]?.id ?? "")])}>
            + Add line
          </Button>
        </div>
        {onQuickAddIngredient && (
          <div className="mb-2 flex flex-wrap items-start gap-2">
            <QuickAddIngredient onCreate={onQuickAddIngredient} onCreated={onIngredientCreated} />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="border-b border-ik-rule text-left text-ik-ink-3">
              <tr>
                <th className="py-1 pr-2">Ingredient</th>
                <th className="w-24 py-1 pr-2 text-right">Qty</th>
                <th className="py-1 pr-2">Unit</th>
                <th className="py-1 pr-2">For dish</th>
                <th className="w-32 py-1 pr-2 text-right">Avg cost</th>
                <th className="w-32 py-1 pr-2 text-right">Line ₹</th>
                <th className="py-1 pr-2">Notes</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const ing = ingredientList.find((i) => i.id === l.ingredientId);
                const lineCost = ing
                  ? new Decimal(l.requestedQty || "0").times(new Decimal(ing.avgCost)).toDecimalPlaces(2)
                  : new Decimal(0);
                return (
                  <tr key={idx} className="border-b border-ik-rule">
                    <td className="py-1 pr-2 min-w-[220px]">
                      <Combobox
                        value={l.ingredientId}
                        onChange={(v) => setLine(idx, { ingredientId: v })}
                        options={ingredientOptions}
                        placeholder="Search an ingredient…"
                        emptyText="No ingredient matches"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number" step="any" min="0.001"
                        value={l.requestedQty}
                        onChange={(e) => setLine(idx, { requestedQty: e.target.value })}
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                      />
                    </td>
                    <td className="py-1 pr-2 text-ik-ink-3">{ing?.unit ?? ""}</td>
                    <td className="py-1 pr-2">
                      <select
                        value={l.orderItemId}
                        onChange={(e) => setLine(idx, { orderItemId: e.target.value })}
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1"
                      >
                        <option value="">— any —</option>
                        {orderItems.map((oi) => (
                          <option key={oi.id} value={oi.id}>{oi.dishName}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">{ing ? `₹${ing.avgCost}` : "—"}</td>
                    <td className="py-1 pr-2 text-right font-mono">₹{lineCost.toString()}</td>
                    <td className="py-1 pr-2">
                      <input
                        value={l.notes}
                        onChange={(e) => setLine(idx, { notes: e.target.value })}
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1"
                      />
                    </td>
                    <td className="py-1 text-right">
                      <button type="button" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))} className="text-alert">×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-mono text-ik-ink">
              <tr>
                <td colSpan={5} className="py-1 pr-2 text-right text-ik-ink-3">Planned total</td>
                <td className="py-1 pr-2 text-right font-medium">₹{totalCost.toString()}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create draft requisition"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
