"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResultWith } from "@/lib/action-result";
import { isNextNavigationError } from "@/lib/next-error";

interface Ingredient { id: string; sku: string; name: string; unit: string; system: string; avgCost: string }

interface Props {
  ingredients: Ingredient[];
  onSubmit: (input: {
    lines: Array<{ ingredientId: string; physicalCount: string }>;
    notes: string | null;
  }) => Promise<ActionResultWith<{ changes: Array<{ ingredient: string; from: string; to: string; delta: string }> }>>;
}

export function AuditForm({ ingredients, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(ingredients.map((i) => [i.id, i.system])),
  );

  const diffs = useMemo(() => {
    return ingredients.map((i) => {
      const physical = counts[i.id] ?? i.system;
      const sys = new Decimal(i.system);
      const phys = new Decimal(physical || "0");
      const delta = phys.minus(sys);
      const valueImpact = delta.times(new Decimal(i.avgCost)).toDecimalPlaces(2);
      return { ...i, physical, delta: delta.toString(), valueImpact: valueImpact.toString() };
    });
  }, [counts, ingredients]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = diffs
      .filter((d) => new Decimal(d.delta).abs().gt(0))
      .map((d) => ({ ingredientId: d.id, physicalCount: d.physical }));
    if (payload.length === 0) return toast.error("No differences to post.");
    startTransition(async () => {
      try {
        const r = await onSubmit({ lines: payload, notes: notes || null });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(`Posted ${r.changes.length} adjustment(s).`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <table className="w-full text-[12.5px]">
        <thead className="border-b border-ik-rule text-left text-ik-ink-3">
          <tr>
            <th className="py-1 pr-2">SKU</th>
            <th className="py-1 pr-2">Name</th>
            <th className="w-16">Unit</th>
            <th className="w-24 py-1 pr-2 text-right">System</th>
            <th className="w-32 py-1 pr-2 text-right">Physical</th>
            <th className="w-24 py-1 pr-2 text-right">Δ</th>
            <th className="w-32 py-1 pr-2 text-right">Cost impact ₹</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((d) => (
            <tr key={d.id} className={"border-b border-ik-rule " + (new Decimal(d.delta).eq(0) ? "" : "bg-amber-wash")}>
              <td className="py-1 pr-2 font-mono">{d.sku}</td>
              <td className="py-1 pr-2">{d.name}</td>
              <td className="py-1 pr-2">{d.unit}</td>
              <td className="py-1 pr-2 text-right font-mono">{d.system}</td>
              <td className="py-1 pr-2">
                <input
                  type="number" step="0.001" min="0"
                  value={d.physical}
                  onChange={(e) => setCounts((p) => ({ ...p, [d.id]: e.target.value }))}
                  className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                />
              </td>
              <td className={"py-1 pr-2 text-right font-mono " + (new Decimal(d.delta).gt(0) ? "text-positive" : new Decimal(d.delta).lt(0) ? "text-alert" : "")}>{d.delta}</td>
              <td className="py-1 pr-2 text-right font-mono">{d.valueImpact}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid gap-1 max-w-2xl">
        <Label htmlFor="notes">Notes (applied to every adjustment)</Label>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div>
        <Button type="submit" disabled={pending}>{pending ? "Posting…" : "Post adjustments"}</Button>
      </div>
    </form>
  );
}
