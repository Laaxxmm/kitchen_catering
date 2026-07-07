"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResultWith } from "@/lib/action-result";
import { isNextNavigationError } from "@/lib/next-error";

export interface QuickDishInput {
  name: string;
  unitPrice: string;
  gstRatePct: string;
  unit: string;
  category?: string;
}

interface Props {
  /** Server action that creates the dish and returns the new id. */
  onCreate: (input: QuickDishInput) => Promise<ActionResultWith<{ id: string }>>;
  /** Called once created so the order form can drop it into a line. */
  onCreated: (dish: {
    id: string;
    name: string;
    unitPrice: string;
    gstRatePct: string;
    category: string | null;
  }) => void;
}

/**
 * Compact inline "+ New dish" toggle for the order form. Catering clients
 * routinely ask for customised dishes that aren't on the menu yet — this
 * lets sales/the manager add one (name + price is enough) and put it on
 * the order without leaving the screen. The full dish page remains the
 * place for richer edits (HSN, description, recipes).
 */
export function QuickAddDish({ onCreate, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [gstRatePct, setGstRatePct] = useState("5");
  const unit = "portion"; // fixed for quick-adds; edit on the dish page if needed
  const [category, setCategory] = useState("");

  function submit() {
    if (!name.trim()) return toast.error("Dish name is required");
    const price = Number(unitPrice);
    if (!unitPrice.trim() || Number.isNaN(price) || price < 0) {
      return toast.error("Enter the price per portion");
    }
    startTransition(async () => {
      try {
        const result = await onCreate({
          name: name.trim(),
          unitPrice: unitPrice.trim(),
          gstRatePct: gstRatePct.trim() || "5",
          unit: unit.trim() || "portion",
          category: category.trim() || undefined,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Dish "${name.trim()}" added to the menu`);
        onCreated({
          id: result.id,
          name: name.trim(),
          unitPrice: unitPrice.trim(),
          gstRatePct: gstRatePct.trim() || "5",
          category: category.trim() || null,
        });
        setName("");
        setUnitPrice("");
        setGstRatePct("5");
        setCategory("");
        setOpen(false);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed to add dish");
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        + New dish
      </Button>
    );
  }

  return (
    <div className="w-full rounded-md border border-ik-rule bg-ik-card p-3">
      <div className="mb-2 text-[12px] font-medium text-ik-ink">
        New customised dish — added to the menu and this order
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="qad-name">Dish name</Label>
          <Input id="qad-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jackfruit Biryani (client special)" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="grid gap-1">
            <Label htmlFor="qad-price">Price ₹</Label>
            <Input id="qad-price" type="number" step="any" min="0" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="qad-gst">GST %</Label>
            <Input id="qad-gst" type="number" step="any" min="0" value={gstRatePct} onChange={(e) => setGstRatePct(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="qad-cat">Category</Label>
            <Input id="qad-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="optional" />
          </div>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={submit}>
          Add dish
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
