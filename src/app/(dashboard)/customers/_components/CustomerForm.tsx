"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerInputT } from "@/lib/validators";

interface Props {
  defaults?: Partial<CustomerInputT> & { id?: string };
  groups: Array<{ id: string; name: string }>;
  onSubmit: (input: CustomerInputT) => Promise<{ id: string }>;
  submitLabel?: string;
  redirectOnSuccess?: string;
}

export function CustomerForm({ defaults, groups, onSubmit, submitLabel = "Save", redirectOnSuccess }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { register, handleSubmit, formState: { errors } } = useForm<CustomerInputT>({
    defaultValues: {
      name: defaults?.name ?? "",
      gstin: defaults?.gstin ?? "",
      pan: defaults?.pan ?? "",
      billingAddress: defaults?.billingAddress ?? "",
      shippingAddress: defaults?.shippingAddress ?? "",
      stateCode: defaults?.stateCode ?? "29",
      contactName: defaults?.contactName ?? "",
      email: defaults?.email ?? "",
      phone: defaults?.phone ?? "",
      notes: defaults?.notes ?? "",
      groupId: defaults?.groupId ?? "",
    },
  });

  function submit(values: CustomerInputT) {
    // Empty strings → null for nullable fields
    const cleaned: CustomerInputT = {
      ...values,
      gstin: values.gstin ? values.gstin : null,
      pan: values.pan ? values.pan : null,
      shippingAddress: values.shippingAddress ? values.shippingAddress : null,
      contactName: values.contactName ? values.contactName : null,
      email: values.email ? values.email : null,
      phone: values.phone ? values.phone : null,
      notes: values.notes ? values.notes : null,
      groupId: values.groupId ? values.groupId : null,
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
    <form onSubmit={handleSubmit(submit)} className="grid gap-4 max-w-3xl">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name", { required: true })} />
        {errors.name && <span className="text-[11px] text-alert">Name is required</span>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="gstin">GSTIN</Label>
          <Input id="gstin" placeholder="29AAACI0000A1Z5" {...register("gstin")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pan">PAN</Label>
          <Input id="pan" {...register("pan")} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="billingAddress">Billing address</Label>
        <Textarea id="billingAddress" rows={2} {...register("billingAddress", { required: true })} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="shippingAddress">Shipping address (optional)</Label>
        <Textarea id="shippingAddress" rows={2} {...register("shippingAddress")} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="stateCode">State code</Label>
          <Input id="stateCode" maxLength={2} {...register("stateCode", { required: true })} />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="groupId">Group</Label>
          <select
            id="groupId"
            {...register("groupId")}
            className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            <option value="">— No group —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="contactName">Contact name</Label>
          <Input id="contactName" {...register("contactName")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register("email")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" {...register("phone")} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="notes">Internal notes</Label>
        <Textarea id="notes" rows={3} {...register("notes")} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
