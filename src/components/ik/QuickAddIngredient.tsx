"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResultWith } from "@/lib/action-result";
import { isNextNavigationError } from "@/lib/next-error";

export const SUB_STORES = ["VEGETABLE", "GROCERY", "MILK", "WATER", "OTHER"] as const;
export type SubStore = (typeof SUB_STORES)[number];

export interface QuickIngredientInput {
  sku: string;
  name: string;
  unit: string;
  subStore: SubStore;
  category?: string;
}

interface Props {
  /** Server action that creates the ingredient and returns the new id. */
  onCreate: (input: QuickIngredientInput) => Promise<ActionResultWith<{ id: string }>>;
  /** Called once created so the requisition form can drop it into a line. */
  onCreated: (ingredient: { id: string; sku: string; name: string; unit: string }) => void;
}

/**
 * Compact inline "+ New ingredient" toggle for the chef's requisition
 * forms. When something isn't in the catalogue yet, the chef adds it on
 * the spot (name + unit is enough) instead of leaving for
 * /inventory/ingredients/new. New ingredients start at 0 on hand — the
 * requisition's shortage path (AWAITING_PROCUREMENT) handles that. The
 * full ingredient page remains the place for richer edits (opening stock,
 * reorder level, HSN, GST).
 */
export function QuickAddIngredient({ onCreate, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [subStore, setSubStore] = useState<SubStore>("OTHER");
  const [category, setCategory] = useState("");
  const [sku, setSku] = useState("");

  function reset() {
    setName("");
    setUnit("kg");
    setSubStore("OTHER");
    setCategory("");
    setSku("");
  }

  function submit() {
    if (!name.trim()) return toast.error("Ingredient name is required");
    if (!unit.trim()) return toast.error("Unit is required (e.g. kg, ltr, pcs)");
    // Chefs shouldn't have to invent SKUs — auto-generate a unique-enough
    // one when left blank. The server's duplicate check backstops clashes.
    const finalSku = sku.trim() || `CHF-${Date.now().toString(36).toUpperCase()}`;
    startTransition(async () => {
      try {
        const result = await onCreate({
          sku: finalSku,
          name: name.trim(),
          unit: unit.trim(),
          subStore,
          category: category.trim() || undefined,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Ingredient "${name.trim()}" added to the catalogue`);
        onCreated({ id: result.id, sku: finalSku, name: name.trim(), unit: unit.trim() });
        reset();
        setOpen(false);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed to add ingredient");
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        + New ingredient
      </Button>
    );
  }

  return (
    <div className="w-full rounded-md border border-ik-rule bg-ik-card p-3">
      <div className="mb-2 text-[12px] font-medium text-ik-ink">
        New ingredient — added to the catalogue and this request (starts at 0 stock)
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="qai-name">Ingredient name</Label>
          <Input id="qai-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Star Anise" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="qai-unit">Unit</Label>
            <Input id="qai-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg / ltr / pcs" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="qai-substore">Sub-store</Label>
            <select
              id="qai-substore"
              value={subStore}
              onChange={(e) => setSubStore(e.target.value as SubStore)}
              className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              {SUB_STORES.map((s) => (
                <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
              ))}
            </select>
            <span className="text-[11px] text-ik-ink-3">routes the approval</span>
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="qai-cat">Category</Label>
          <Input id="qai-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="optional" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="qai-sku">SKU</Label>
          <Input id="qai-sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="leave blank to auto-generate" />
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={submit}>
          Add ingredient
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
