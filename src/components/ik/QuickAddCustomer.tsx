"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResultWith } from "@/lib/action-result";
import { isNextNavigationError } from "@/lib/next-error";

interface Props {
  /** Server action that creates a customer and returns the new id. */
  onCreate: (
    input: QuickCustomerInput,
  ) => Promise<ActionResultWith<{ id: string; name: string; stateCode: string }>>;
  /** Called once the customer is created so the parent form can
   *  auto-select it in its dropdown. */
  onCreated: (customer: { id: string; name: string; stateCode: string }) => void;
}

export interface QuickCustomerInput {
  name: string;
  billingAddress: string;
  stateCode: string;
  email?: string;
  phone?: string;
  gstin?: string;
}

/**
 * Compact inline "+ Add new customer" toggle for the order + quote
 * forms. Captures the minimum fields needed to send an invoice later
 * (name, billing address, state code, email) without making the sales
 * person leave the form they're on.
 *
 * The full customer page exists for richer edits — this is a fast path
 * for the common "new lead just walked in" case.
 */
export function QuickAddCustomer({ onCreate, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [stateCode, setStateCode] = useState("29");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [gstin, setGstin] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Customer name is required");
    if (!billingAddress.trim()) return toast.error("Billing address is required");
    if (!/^\d{2}$/.test(stateCode)) return toast.error("State code must be 2 digits (e.g. 29 for Karnataka)");
    startTransition(async () => {
      try {
        const result = await onCreate({
          name: name.trim(),
          billingAddress: billingAddress.trim(),
          stateCode,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          gstin: gstin.trim() || undefined,
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Added ${result.name}`);
        onCreated({ id: result.id, name: result.name, stateCode: result.stateCode });
        // Reset + collapse
        setName("");
        setBillingAddress("");
        setEmail("");
        setPhone("");
        setGstin("");
        setOpen(false);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Failed to add customer");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11.5px] text-brand hover:underline"
      >
        + Add new customer
      </button>
    );
  }

  return (
    <div className="mt-2 grid gap-2 rounded-md border border-brand-200 bg-brand-50 p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[12px] font-medium text-brand-700">Add a new customer</div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] text-ik-ink-3 hover:text-ik-ink"
        >
          Cancel
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="qac-name" className="text-[11.5px]">Name</Label>
          <Input id="qac-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer / company name" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="qac-state" className="text-[11.5px]">State code (2 digits)</Label>
          <Input id="qac-state" value={stateCode} maxLength={2} onChange={(e) => setStateCode(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="qac-addr" className="text-[11.5px]">Billing address</Label>
        <Textarea id="qac-addr" rows={2} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="qac-email" className="text-[11.5px]">Email</Label>
          <Input id="qac-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="qac-phone" className="text-[11.5px]">Phone</Label>
          <Input id="qac-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="optional" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="qac-gstin" className="text-[11.5px]">GSTIN</Label>
          <Input id="qac-gstin" value={gstin} onChange={(e) => setGstin(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <div>
        <Button type="button" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Saving…" : "Save & select"}
        </Button>
      </div>
    </div>
  );
}
