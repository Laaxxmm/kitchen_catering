"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PaymentMethod } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResultWith } from "@/lib/action-result";

interface Props {
  outstanding: number;
  onSubmit: (input: { amount: string; method: PaymentMethod; reference: string | null; notes: string | null; paidAt: string }) => Promise<ActionResultWith<{ id: string }>>;
}

export function RecordPaymentForm({ outstanding, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [amount, setAmount] = useState(String(outstanding.toFixed(2)));
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.UPI);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return toast.error("Amount must be positive");
    startTransition(async () => {
      try {
        const res = await onSubmit({
          amount,
          method,
          reference: reference || null,
          notes: notes || null,
          paidAt,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Payment recorded");
        router.refresh();
        setAmount("");
        setReference("");
        setNotes("");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
      <h3 className="mb-3 font-medium text-[14px] text-ik-ink">Record payment</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="amount">Amount (₹)</Label>
          <Input id="amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="method">Method</Label>
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
            {Object.values(PaymentMethod).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="paidAt">Paid at</Label>
          <Input id="paidAt" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="reference">Reference</Label>
          <Input id="reference" placeholder="UPI ref / cheque no / NEFT ref" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record payment"}</Button>
      </div>
    </form>
  );
}
