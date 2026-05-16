"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { IngredientReceiptInputT } from "@/lib/validators";
import { isNextNavigationError } from "@/lib/next-error";

interface IngredientOption {
  id: string;
  name: string;
  sku: string;
  unit: string;
}

interface Props {
  ingredients: IngredientOption[];
  onSubmit: (input: IngredientReceiptInputT) => Promise<{ id: string }>;
  redirectOnSuccess?: string;
}

export function ReceiptForm({ ingredients, onSubmit, redirectOnSuccess }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { register, handleSubmit, formState: { errors } } = useForm<IngredientReceiptInputT>({
    defaultValues: {
      ingredientId: ingredients[0]?.id ?? "",
      qty: "",
      unitCost: "",
      supplier: "",
      note: "",
    },
  });

  function submit(values: IngredientReceiptInputT) {
    const cleaned: IngredientReceiptInputT = {
      ...values,
      supplier: values.supplier ? values.supplier : null,
      note: values.note ? values.note : null,
    };
    startTransition(async () => {
      try {
        await onSubmit(cleaned);
        toast.success("Receipt recorded");
        if (redirectOnSuccess) router.push(redirectOnSuccess);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-4 max-w-2xl">
      <div className="grid gap-1">
        <Label htmlFor="ingredientId">Ingredient</Label>
        <select
          id="ingredientId"
          {...register("ingredientId", { required: true })}
          className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
        >
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.sku} · {i.name} ({i.unit})
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="qty">Quantity</Label>
          <Input id="qty" type="number" step="0.001" min="0.001" {...register("qty", { required: true })} />
          {errors.qty && <span className="text-[11px] text-alert">Required</span>}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="unitCost">Unit cost (₹)</Label>
          <Input id="unitCost" type="number" step="0.0001" min="0" {...register("unitCost", { required: true })} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="supplier">Supplier (free text)</Label>
          <Input id="supplier" {...register("supplier")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="receivedAt">Received at (ISO; leave blank for now)</Label>
          <Input id="receivedAt" placeholder="2026-05-11T10:00:00" {...register("receivedAt")} />
        </div>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="note">Note</Label>
        <Textarea id="note" rows={2} {...register("note")} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record receipt"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
