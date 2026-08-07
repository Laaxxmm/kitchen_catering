"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PaymentMethod } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  /** The settled figure, already formatted — the amount is not editable here;
   *  correcting it is a re-settle, which keeps the audit trail honest. */
  amountLabel: string;
  onPay: (input: {
    method: PaymentMethod;
    reference: string | null;
    paidAt: string;
  }) => Promise<ActionResult>;
}

export function PayForm({ amountLabel, onPay }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.CASH);
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 16));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!paidAt) return toast.error("Enter when it was paid");
    startTransition(async () => {
      try {
        const res = await onPay({ method, reference: reference.trim() || null, paidAt });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Payment recorded");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not record the payment");
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card">
      <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Pay {amountLabel}</h3>
      <p className="mb-3 text-[12px] text-ik-ink-3">
        Pays the settled figure. To pay a different amount, correct the actual cost first.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="payMethod">Method</Label>
          <select
            id="payMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            {Object.values(PaymentMethod).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="payRef">Reference</Label>
          <Input id="payRef" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Voucher / UPI ref" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="paidAt">Paid at</Label>
          <Input id="paidAt" type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
      </div>
      <div className="mt-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record payment"}</Button>
      </div>
    </form>
  );
}
