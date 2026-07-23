"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CustomerInputT } from "@/lib/validators";
import type { ActionResultWith } from "@/lib/action-result";
import { isNextNavigationError } from "@/lib/next-error";

interface Props {
  defaults?: Partial<CustomerInputT> & { id?: string };
  groups: Array<{ id: string; name: string }>;
  onSubmit: (input: CustomerInputT) => Promise<ActionResultWith<{ id: string }>>;
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
      billingCompanyName: defaults?.billingCompanyName ?? "",
      creditLimit: defaults?.creditLimit ?? "0",
      creditDays: defaults?.creditDays ?? 0,
    },
  });

  function submit(values: CustomerInputT) {
    // Empty strings → null for nullable fields. Phone is REQUIRED so
    // we let the validator catch the empty case server-side.
    const cleaned: CustomerInputT = {
      ...values,
      gstin: values.gstin ? values.gstin : null,
      pan: values.pan ? values.pan : null,
      shippingAddress: values.shippingAddress ? values.shippingAddress : null,
      contactName: values.contactName ? values.contactName : null,
      email: values.email ? values.email : null,
      notes: values.notes ? values.notes : null,
      groupId: values.groupId ? values.groupId : null,
      billingCompanyName: values.billingCompanyName ? values.billingCompanyName : null,
    };
    startTransition(async () => {
      try {
        const result = await onSubmit(cleaned);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
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
    <form onSubmit={handleSubmit(submit)} className="grid max-w-3xl gap-4">
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Identity</h3>
        <div className="grid gap-2">
          <Label htmlFor="name">Name<span className="text-gold" aria-hidden> *</span></Label>
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
      </section>

      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Addresses</h3>
        <div className="grid gap-2">
          <Label htmlFor="billingAddress">Billing address<span className="text-gold" aria-hidden> *</span></Label>
          <Textarea id="billingAddress" rows={2} {...register("billingAddress", { required: true })} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="shippingAddress">Shipping address</Label>
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
          <p className="text-[11.5px] text-ik-ink-3">
            {groups.length === 0 ? (
              <>
                Groups are optional buckets — useful when one parent company has many branches (e.g.
                &ldquo;Infosys → Bangalore office, Pune office&rdquo;), or for a category tag like
                &ldquo;Corporate&rdquo; vs &ldquo;Walk-in&rdquo;. None exist yet —{" "}
                <Link href="/customers/groups" target="_blank" className="text-brand hover:underline">
                  create one
                </Link>
                {" "}if you need it. Otherwise just leave as &ldquo;No group&rdquo;.
              </>
            ) : (
              <>
                Optional. Use to bucket related customers (e.g. branches of the same company).{" "}
                <Link href="/customers/groups" target="_blank" className="text-brand hover:underline">
                  Manage groups →
                </Link>
              </>
            )}
          </p>
        </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Contact</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="contactName">Contact name</Label>
          <Input id="contactName" {...register("contactName")} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="email">
            Email<span className="text-gold" aria-hidden> *</span>
          </Label>
          <Input
            id="email"
            type="email"
            placeholder="customer@example.com"
            {...register("email")}
          />
          <p className="text-[11.5px] text-ik-ink-3">
            Required to auto-send the proforma and tax invoice. Leave blank only if the
            customer truly has no email — invoices will need to be sent manually.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="phone">
            Phone<span className="text-gold" aria-hidden> *</span>
          </Label>
          <Input
            id="phone"
            placeholder="+91…"
            {...register("phone", { required: true, minLength: 7 })}
          />
          {errors.phone && (
            <span className="text-[11px] text-alert">
              Phone is required (min 7 digits)
            </span>
          )}
        </div>
        </div>
      </section>

      {/* "Bill to" + credit terms — drives invoice header + approval routing. */}
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Billing &amp; credit</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-2 sm:col-span-3">
          <Label htmlFor="billingCompanyName">Bill to company</Label>
          <Input
            id="billingCompanyName"
            placeholder="Defaults to customer name when blank"
            {...register("billingCompanyName")}
          />
          <p className="text-[11.5px] text-ik-ink-3">
            When the legal entity on the invoice differs from the contact
            (e.g. branch contact, parent company billing).
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="creditLimit">Credit limit (₹)</Label>
          <Input
            id="creditLimit"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="0"
            {...register("creditLimit")}
          />
          <p className="text-[11.5px] text-ik-ink-3">
            Max outstanding allowed across open invoices.
          </p>
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="creditDays">Credit duration (days)</Label>
          <Input
            id="creditDays"
            type="number"
            min="0"
            max="365"
            placeholder="0"
            {...register("creditDays", { valueAsNumber: true })}
          />
          <p className="text-[11.5px] text-ik-ink-3">
            <span className="font-medium">0</span> = cash / immediate ·{" "}
            <span className="font-medium">1–15</span> needs manager approval ·{" "}
            <span className="font-medium">&gt;15</span> needs admin or accounts.
            The save will fail if your role can&apos;t approve the duration
            you enter.
          </p>
        </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="notes">Internal notes</Label>
          <Textarea id="notes" rows={3} {...register("notes")} />
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-ik-rule bg-ik-paper/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-ik-paper/75 md:-mx-6 md:px-6">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
