"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IngredientInputT } from "@/lib/validators";
import { isNextNavigationError } from "@/lib/next-error";

interface Props {
  defaults?: Partial<IngredientInputT>;
  onSubmit: (input: IngredientInputT) => Promise<{ id: string }>;
  submitLabel?: string;
  redirectOnSuccess?: string;
  // When editing, opening fields are immutable (you'd need to re-seed history).
  hideOpeningFields?: boolean;
}

export function IngredientForm({ defaults, onSubmit, submitLabel = "Save", redirectOnSuccess, hideOpeningFields }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { register, handleSubmit, formState: { errors } } = useForm<IngredientInputT>({
    defaultValues: {
      sku: defaults?.sku ?? "",
      name: defaults?.name ?? "",
      category: defaults?.category ?? "",
      unit: defaults?.unit ?? "kg",
      openingQty: defaults?.openingQty ?? "0",
      openingAvgCost: defaults?.openingAvgCost ?? "0",
      reorderLevel: defaults?.reorderLevel ?? "0",
      hsnSac: defaults?.hsnSac ?? "",
      gstRatePct: defaults?.gstRatePct ?? "0",
      subStore: defaults?.subStore ?? "OTHER",
    },
  });

  function submit(values: IngredientInputT) {
    const cleaned: IngredientInputT = {
      ...values,
      category: values.category ? values.category : null,
      hsnSac: values.hsnSac ? values.hsnSac : null,
    };
    startTransition(async () => {
      try {
        const result = await onSubmit(cleaned);
        toast.success("Saved");
        if (redirectOnSuccess) router.push(redirectOnSuccess.replace(":id", result.id));
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-4 max-w-2xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" {...register("sku", { required: true })} />
          {errors.sku && <span className="text-[11px] text-alert">SKU is required</span>}
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register("name", { required: true })} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="grid gap-1">
          <Label htmlFor="category">Category</Label>
          <Input id="category" placeholder="Dairy, Spices, …" {...register("category")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="subStore">Sub-store</Label>
          <select
            id="subStore"
            {...register("subStore")}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            <option value="VEGETABLE">Vegetable</option>
            <option value="GROCERY">Grocery</option>
            <option value="MILK">Milk / dairy</option>
            <option value="WATER">Water bottles</option>
            <option value="OTHER">Other</option>
          </select>
          <p className="text-[10.5px] text-ik-ink-3">
            Drives the approval rule for chef requisitions.
          </p>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="unit">Unit</Label>
          <Input id="unit" placeholder="kg, g, L, mL, pcs" {...register("unit", { required: true })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="reorderLevel">Reorder level</Label>
          <Input id="reorderLevel" type="number" step="0.001" {...register("reorderLevel")} />
        </div>
      </div>

      {!hideOpeningFields && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="openingQty">Opening qty</Label>
            <Input id="openingQty" type="number" step="0.001" {...register("openingQty")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="openingAvgCost">Opening avg cost (₹)</Label>
            <Input id="openingAvgCost" type="number" step="0.0001" {...register("openingAvgCost")} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="hsnSac">HSN / SAC</Label>
          <Input id="hsnSac" {...register("hsnSac")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="gstRatePct">GST rate (%)</Label>
          <Input id="gstRatePct" type="number" step="0.01" {...register("gstRatePct")} />
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
