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
import type { ActionResultWith } from "@/lib/action-result";

interface IngredientOption {
  id: string;
  name: string;
  sku: string;
  unit: string;
}

interface Props {
  ingredients: IngredientOption[];
  onSubmit: (input: IngredientReceiptInputT) => Promise<ActionResultWith<{ id: string }>>;
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
    // Drop empty-string optionals before sending — the validator's
    // isoDate / nullable-string types accept undefined but reject "".
    // Without this clean-up, leaving "Received at" blank threw
    //   ZodError: String must contain at least 1 character(s)
    // (visible in production as the masked "Server Components render"
    // error, since the throw bubbled up through the inline server
    // action call site).
    const cleaned: IngredientReceiptInputT = {
      ...values,
      supplier: values.supplier ? values.supplier : null,
      note: values.note ? values.note : null,
      receivedAt:
        values.receivedAt && values.receivedAt.trim()
          ? values.receivedAt
          : undefined,
    };
    startTransition(async () => {
      try {
        const res = await onSubmit(cleaned);
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
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
    <form onSubmit={handleSubmit(submit)} className="mx-auto grid max-w-2xl gap-4">
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">What came in</h3>
        <div className="grid gap-1">
          <Label htmlFor="ingredientId">Ingredient<span className="text-gold" aria-hidden> *</span></Label>
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
            <Label htmlFor="qty">Quantity<span className="text-gold" aria-hidden> *</span></Label>
            <Input id="qty" type="number" step="any" min="0.001" {...register("qty", { required: true })} />
            {errors.qty && <span className="text-[11px] text-alert">Required</span>}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="unitCost">Unit cost (₹)<span className="text-gold" aria-hidden> *</span></Label>
            <Input id="unitCost" type="number" step="any" min="0" {...register("unitCost", { required: true })} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="supplier">Supplier (free text)</Label>
            <Input id="supplier" {...register("supplier")} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="receivedAt">Received at</Label>
            <Input id="receivedAt" placeholder="Leave blank for now" {...register("receivedAt")} />
          </div>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="note">Note</Label>
          <Textarea id="note" rows={2} {...register("note")} />
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-ik-rule bg-ik-paper/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-ik-paper/75 md:-mx-6 md:px-6">
        <span className="text-[11.5px] text-ik-ink-3">Updates on-hand qty &amp; moving-average cost on save.</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record receipt"}</Button>
        </div>
      </div>
    </form>
  );
}
