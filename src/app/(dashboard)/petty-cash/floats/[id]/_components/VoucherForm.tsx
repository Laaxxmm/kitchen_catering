"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResultWith } from "@/lib/action-result";

interface Props {
  onSubmit: (input: {
    amount: string;
    category: string;
    paidTo: string;
    reason: string;
    paidAt: string;
  }) => Promise<ActionResultWith<{ warning?: string }>>;
}

/** Current local clock as a `datetime-local` input value (YYYY-MM-DDTHH:mm). */
function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * Record-voucher form for a petty-cash float. Calls the page's bound
 * "use server" shim and toasts the action's refusal (e.g. insufficient
 * balance) instead of silently swallowing it like the old bare
 * `<form action>` did.
 */
export function VoucherForm({ onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [paidTo, setPaidTo] = useState("");
  const [reason, setReason] = useState("");
  // Defaults to "now" but stays editable so a late entry can be recorded on
  // the day the cash actually went out.
  const [paidAt, setPaidAt] = useState(nowLocalInput);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || !category.trim() || !paidTo.trim() || !reason.trim() || !paidAt) {
      toast.error("Please fill in all fields");
      return;
    }
    startTransition(async () => {
      try {
        const res = await onSubmit({
          amount,
          category: category.trim(),
          paidTo: paidTo.trim(),
          reason: reason.trim(),
          paidAt,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Voucher recorded");
        if (res.warning) toast.warning(res.warning, { duration: 12000 });
        setAmount("");
        setCategory("");
        setPaidTo("");
        setReason("");
        setPaidAt(nowLocalInput());
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input id="amount" type="number" step="0.01" min="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="category">Category</Label>
          <Input id="category" placeholder="fuel, subzi, tea-coffee…" required value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="paidTo">Paid to</Label>
        <Input id="paidTo" required value={paidTo} onChange={(e) => setPaidTo(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="reason">Reason</Label>
        <Input id="reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="paidAt">Paid on</Label>
        <Input id="paidAt" type="datetime-local" required value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </div>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Record voucher"}</Button>
    </form>
  );
}
