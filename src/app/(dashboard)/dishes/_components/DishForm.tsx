"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DishInputT } from "@/lib/validators";

interface Props {
  defaults?: Partial<DishInputT>;
  onSubmit: (input: DishInputT) => Promise<{ id: string }>;
  submitLabel?: string;
  redirectOnSuccess?: string;
}

export function DishForm({ defaults, onSubmit, submitLabel = "Save", redirectOnSuccess }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { register, handleSubmit } = useForm<DishInputT>({
    defaultValues: {
      code: defaults?.code ?? "",
      name: defaults?.name ?? "",
      category: defaults?.category ?? "",
      description: defaults?.description ?? "",
      unitPrice: defaults?.unitPrice ?? "",
      unit: defaults?.unit ?? "portion",
      hsnSac: defaults?.hsnSac ?? "",
      gstRatePct: defaults?.gstRatePct ?? "5",
    },
  });

  function submit(values: DishInputT) {
    const cleaned: DishInputT = {
      ...values,
      code: values.code ? values.code : null,
      category: values.category ? values.category : null,
      description: values.description ? values.description : null,
      hsnSac: values.hsnSac ? values.hsnSac : null,
    };
    startTransition(async () => {
      try {
        const result = await onSubmit(cleaned);
        toast.success("Saved");
        if (redirectOnSuccess) router.push(redirectOnSuccess.replace(":id", result.id));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="grid gap-4 max-w-2xl">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="code">Code</Label>
          <Input id="code" placeholder="DSH-001" {...register("code")} />
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register("name", { required: true })} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="category">Category</Label>
          <Input id="category" placeholder="Mains, Rice, Bread, …" {...register("category")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="unit">Unit</Label>
          <Input id="unit" placeholder="portion, plate, kg" {...register("unit")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="unitPrice">Unit price (₹)</Label>
          <Input id="unitPrice" type="number" step="0.01" min="0" {...register("unitPrice", { required: true })} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="hsnSac">HSN / SAC</Label>
          <Input id="hsnSac" {...register("hsnSac")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="gstRatePct">GST rate (%)</Label>
          <Input id="gstRatePct" type="number" step="0.01" min="0" {...register("gstRatePct")} />
        </div>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
