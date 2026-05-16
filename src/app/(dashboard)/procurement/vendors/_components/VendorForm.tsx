"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { VendorCategory, VendorPaymentTerms } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { VendorInputT } from "@/lib/validators";
import { isNextNavigationError } from "@/lib/next-error";

interface Props {
  defaults?: Partial<VendorInputT>;
  onSubmit: (input: VendorInputT) => Promise<{ id: string }>;
  submitLabel?: string;
  redirectOnSuccess?: string;
}

export function VendorForm({ defaults, onSubmit, submitLabel = "Save", redirectOnSuccess }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { register, handleSubmit } = useForm<VendorInputT>({
    defaultValues: {
      name: defaults?.name ?? "",
      gstin: defaults?.gstin ?? "",
      pan: defaults?.pan ?? "",
      stateCode: defaults?.stateCode ?? "29",
      category: defaults?.category ?? VendorCategory.OTHER,
      msme: defaults?.msme ?? false,
      contactName: defaults?.contactName ?? "",
      phone: defaults?.phone ?? "",
      email: defaults?.email ?? "",
      address: defaults?.address ?? "",
      paymentTerms: defaults?.paymentTerms ?? VendorPaymentTerms.NET_30,
      notes: defaults?.notes ?? "",
    },
  });

  function submit(values: VendorInputT) {
    const cleaned: VendorInputT = {
      ...values,
      gstin: values.gstin || null,
      pan: values.pan || null,
      contactName: values.contactName || null,
      phone: values.phone || null,
      email: values.email || null,
      address: values.address || null,
      notes: values.notes || null,
    };
    startTransition(async () => {
      try {
        const r = await onSubmit(cleaned);
        toast.success("Saved");
        if (redirectOnSuccess) router.push(redirectOnSuccess.replace(":id", r.id));
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(submit)} className="grid max-w-2xl gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register("name", { required: true })} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="category">Category</Label>
          <select id="category" {...register("category")} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
            {Object.values(VendorCategory).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="gstin">GSTIN</Label>
          <Input id="gstin" {...register("gstin")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="pan">PAN</Label>
          <Input id="pan" {...register("pan")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="stateCode">State code</Label>
          <Input id="stateCode" maxLength={2} {...register("stateCode", { required: true })} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="contactName">Contact</Label>
          <Input id="contactName" {...register("contactName")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" {...register("phone")} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register("email")} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="address">Address</Label>
        <Textarea id="address" rows={2} {...register("address")} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="paymentTerms">Payment terms</Label>
          <select id="paymentTerms" {...register("paymentTerms")} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
            {Object.values(VendorPaymentTerms).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ik-ink-2 mt-6">
          <input type="checkbox" {...register("msme")} /> MSME registered
        </label>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={2} {...register("notes")} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
