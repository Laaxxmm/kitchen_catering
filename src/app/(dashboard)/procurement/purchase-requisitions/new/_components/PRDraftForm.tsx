"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { isNextNavigationError } from "@/lib/next-error";

interface Ingredient { id: string; sku: string; name: string; unit: string }

interface Props {
  ingredients: Ingredient[];
  onSubmit: (lines: Array<{ ingredientId: string; requestedQty: string; notes: string | null }>, notes: string | null) => Promise<void>;
}

interface DraftLine {
  ingredientId: string;
  requestedQty: string;
  notes: string;
}

/**
 * Storekeeper/chef-facing PR draft form. Intentionally price-free —
 * the requester just says *what* and *how much*, the manager (and the
 * vendor PO that follows) handles pricing.
 *
 * Schema-side we still snapshot the avg cost per line on save so the
 * approval-tier logic works server-side; that math is invisible here.
 */
export function PRDraftForm({ ingredients, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [headerNotes, setHeaderNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ingredientId: ingredients[0]?.id ?? "", requestedQty: "1", notes: "" }]);
  const ingredientOptions = useMemo(
    () => ingredients.map((i) => ({ value: i.id, label: `${i.sku} · ${i.name}` })),
    [ingredients],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = lines
      .filter((l) => l.ingredientId && Number(l.requestedQty) > 0)
      .map((l) => ({ ingredientId: l.ingredientId, requestedQty: l.requestedQty, notes: l.notes || null }));
    if (payload.length === 0) return toast.error("Add at least one line");
    startTransition(async () => {
      try {
        await onSubmit(payload, headerNotes || null);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <section className="rounded-[14px] border border-ik-rule bg-ik-card p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">What do we need?</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, { ingredientId: ingredients[0]?.id ?? "", requestedQty: "1", notes: "" }])}>+ Add line</Button>
        </div>
        <table className="w-full text-[12.5px]">
          <thead className="border-b border-ik-rule text-left text-ik-ink-3">
            <tr>
              <th className="py-1 pr-2">Ingredient</th>
              <th className="w-24 py-1 pr-2 text-right">Qty</th>
              <th className="w-16">Unit</th>
              <th>Notes</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const ing = ingredients.find((i) => i.id === l.ingredientId);
              return (
                <tr key={idx} className="border-b border-ik-rule">
                  <td className="py-1 pr-2 min-w-[220px]">
                    <Combobox
                      value={l.ingredientId}
                      onChange={(v) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, ingredientId: v } : x)))}
                      options={ingredientOptions}
                      placeholder="Search an ingredient…"
                      emptyText="No ingredient matches"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      type="number"
                      step="0.001"
                      min="0.001"
                      value={l.requestedQty}
                      onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, requestedQty: e.target.value } : x)))}
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                    />
                  </td>
                  <td className="py-1 pr-2 text-ik-ink-3">{ing?.unit ?? ""}</td>
                  <td className="py-1 pr-2">
                    <input
                      value={l.notes}
                      onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, notes: e.target.value } : x)))}
                      placeholder="e.g. brand preference, urgency"
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}
                      className="text-alert"
                      aria-label="Remove line"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="grid gap-1 max-w-2xl">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={2} value={headerNotes} onChange={(e) => setHeaderNotes(e.target.value)} placeholder="Anything else the manager should know (urgency, vendor preference, etc.)" />
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-ik-rule bg-ik-paper/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-ik-paper/75 md:-mx-6 md:px-6">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create request"}</Button>
      </div>
    </form>
  );
}
