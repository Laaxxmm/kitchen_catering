"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { QuickAddIngredient, type QuickIngredientInput } from "@/components/ik/QuickAddIngredient";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResultWith } from "@/lib/action-result";
import { createStandaloneChefRequisition } from "@/server/actions/chef-requisitions";

interface Ingredient { id: string; sku: string; name: string; unit: string }
interface DraftLine { ingredientId: string; unit: string; requestedQty: string; notes: string }

function emptyLine(): DraftLine {
  return { ingredientId: "", unit: "", requestedQty: "1", notes: "" };
}

/**
 * Chef's order-less stock request. Pick ingredients + quantities; it goes
 * straight to the store to issue, with no order attached.
 */
export function StandaloneReqForm({
  ingredients,
  onQuickAddIngredient,
}: {
  ingredients: Ingredient[];
  /** Inline ingredient creator — lets the chef add a missing catalogue item without leaving the form. */
  onQuickAddIngredient?: (input: QuickIngredientInput) => Promise<ActionResultWith<{ id: string }>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState("");
  // Local copy so a quick-added ingredient shows up in the picker instantly.
  const [ingredientList, setIngredientList] = useState<Ingredient[]>(ingredients);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  const options = ingredientList.map((i) => ({ value: i.id, label: `${i.sku} · ${i.name}` }));

  function pick(idx: number, ingredientId: string) {
    const ing = ingredientList.find((i) => i.id === ingredientId);
    setLines((p) => p.map((x, i) => (i === idx ? { ...x, ingredientId, unit: ing?.unit ?? x.unit } : x)));
  }
  function setLine(idx: number, patch: Partial<DraftLine>) {
    setLines((p) => p.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  // A freshly quick-added ingredient (0 on hand) drops into the first line
  // that has no ingredient yet, or a new line, with its unit prefilled.
  function onIngredientCreated(ing: { id: string; sku: string; name: string; unit: string }) {
    setIngredientList((prev) => [ing, ...prev]);
    setLines((prev) => {
      const emptyIdx = prev.findIndex((l) => !l.ingredientId);
      if (emptyIdx >= 0) {
        return prev.map((l, i) => (i === emptyIdx ? { ...l, ingredientId: ing.id, unit: ing.unit } : l));
      }
      return [...prev, { ...emptyLine(), ingredientId: ing.id, unit: ing.unit }];
    });
  }

  function submit() {
    const payload = lines.filter((l) => l.ingredientId && Number(l.requestedQty) > 0);
    if (payload.length === 0) return toast.error("Add at least one ingredient with a quantity");
    startTransition(async () => {
      try {
        const res = await createStandaloneChefRequisition({
          notes: notes.trim() || undefined,
          lines: payload.map((l) => ({
            ingredientId: l.ingredientId,
            requestedQty: l.requestedQty,
            unit: l.unit || undefined,
            notes: l.notes.trim() || null,
          })),
        });
        if (res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success(`Stock request ${res.requisitionNo} sent to the store`);
        router.push("/requisitions");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not raise the request");
      }
    });
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-[14px] text-ik-ink">Ingredients</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>+ Add line</Button>
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
                <th className="w-16 py-1 pr-2">Unit</th>
                <th className="py-1 pr-2">Note</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx} className="border-b border-ik-rule align-top">
                  <td className="py-1 pr-2 min-w-[240px]">
                    <Combobox
                      value={l.ingredientId}
                      onChange={(v) => pick(idx, v)}
                      options={options}
                      placeholder="Search an ingredient…"
                      emptyText="No ingredient matches"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input type="number" step="any" min="0.001" value={l.requestedQty}
                      onChange={(e) => setLine(idx, { requestedQty: e.target.value })}
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" />
                  </td>
                  <td className="py-1 pr-2">
                    <input value={l.unit} onChange={(e) => setLine(idx, { unit: e.target.value })}
                      className="h-8 w-14 rounded border border-ik-rule bg-ik-card px-1" />
                  </td>
                  <td className="py-1 pr-2">
                    <input value={l.notes} onChange={(e) => setLine(idx, { notes: e.target.value })}
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1" />
                  </td>
                  <td className="py-1 text-right">
                    <button type="button" className="text-alert" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-1 max-w-2xl">
        <label htmlFor="notes" className="text-[12px] text-ik-ink-2">Notes (optional)</label>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why you need these, when, etc." />
      </div>

      <div className="flex gap-2">
        <Button disabled={pending} onClick={submit}>{pending ? "Sending…" : "Send request to store"}</Button>
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </div>
  );
}
