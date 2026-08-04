"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PaymentMethod } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox } from "@/components/ui/combobox";
import { isNextNavigationError } from "@/lib/next-error";
import { recordVendorAdvance } from "@/server/actions/procurement";

const METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: PaymentMethod.BANK_TRANSFER, label: "Bank transfer" },
  { value: PaymentMethod.UPI, label: "UPI" },
  { value: PaymentMethod.CASH, label: "Cash" },
  { value: PaymentMethod.CHEQUE, label: "Cheque" },
  { value: PaymentMethod.NEFT, label: "NEFT" },
];

export function AdvanceForm({
  vendors,
  pos,
}: {
  vendors: Array<{ id: string; name: string; code: string }>;
  pos: Array<{ id: string; poNo: string; vendorId: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [vendorId, setVendorId] = useState("");
  const [poId, setPoId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.BANK_TRANSFER);
  const [paidAt, setPaidAt] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const vendorPos = pos.filter((p) => p.vendorId === vendorId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) return toast.error("Pick the supplier");
    if (!(Number(amount) > 0)) return toast.error("Enter the amount paid");
    if (!paidAt) return toast.error("Enter the payment date");
    startTransition(async () => {
      try {
        const res = await recordVendorAdvance({
          vendorId,
          poId: poId || null,
          amount,
          method,
          reference: reference.trim() || null,
          notes: notes.trim() || null,
          paidAt,
        });
        if (!res.ok) return void toast.error(res.error);
        toast.success("Advance recorded — apply it from the bill page once the bill arrives");
        router.push("/procurement/vendor-bills");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-2xl gap-4">
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card sm:p-5">
        <div className="grid gap-1">
          <Label>Supplier<span className="text-gold" aria-hidden> *</span></Label>
          <Combobox
            value={vendorId}
            onChange={(v) => { setVendorId(v); setPoId(""); }}
            options={vendors.map((v) => ({ value: v.id, label: `${v.code} · ${v.name}` }))}
            placeholder="Type to search a supplier…"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="advAmount">Amount ₹<span className="text-gold" aria-hidden> *</span></Label>
            <Input id="advAmount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="advPaidAt">Paid on<span className="text-gold" aria-hidden> *</span></Label>
            <Input id="advPaidAt" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="advMethod">Method</Label>
            <select id="advMethod" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="advPo">Against PO (optional)</Label>
            <select id="advPo" value={poId} onChange={(e) => setPoId(e.target.value)} className="h-9 w-full min-w-0 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]" disabled={!vendorId}>
              <option value="">— not for a specific PO —</option>
              {vendorPos.map((p) => <option key={p.id} value={p.id}>{p.poNo}</option>)}
            </select>
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="advRef">Reference (UTR / cheque no, optional)</Label>
          <Input id="advRef" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="advNotes">Notes (optional)</Label>
          <Textarea id="advNotes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </section>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Record advance"}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
