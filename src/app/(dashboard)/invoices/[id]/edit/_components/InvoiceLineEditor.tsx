"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/money";
import { isNextNavigationError } from "@/lib/next-error";

interface CustomerOption {
  id: string;
  name: string;
  stateCode: string;
  billingAddress: string;
  gstin: string | null;
}

interface DraftLine {
  description: string;
  hsnSac: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  gstRatePct: string;
}

interface CommonProps {
  defaults?: Partial<{
    customerId: string;
    placeOfSupplyStateCode: string;
    dueDate: string | null;
    notes: string | null;
    termsMd: string | null;
    poRef: string | null;
    lines: DraftLine[];
  }>;
  submitLabel: string;
}

interface CreateProps extends CommonProps {
  mode: "create";
  customers: CustomerOption[];
  onSubmit: (input: {
    customerId: string;
    placeOfSupplyStateCode: string;
    dueDate: string | null;
    notes: string | null;
    termsMd: string | null;
    poRef: string | null;
    lines: Array<{
      description: string;
      hsnSac: string | null;
      quantity: string;
      unit: string;
      unitPrice: string;
      discountPct: string;
      gstRatePct: string;
    }>;
  }) => Promise<void>;
}

interface EditProps extends CommonProps {
  mode: "edit";
  customerLabel: string; // immutable on edit
  onSubmit: (input: {
    placeOfSupplyStateCode: string;
    dueDate: string | null;
    notes: string | null;
    termsMd: string | null;
    poRef: string | null;
    lines: Array<{
      description: string;
      hsnSac: string | null;
      quantity: string;
      unit: string;
      unitPrice: string;
      discountPct: string;
      gstRatePct: string;
    }>;
  }) => Promise<void>;
}

type Props = CreateProps | EditProps;

function emptyLine(): DraftLine {
  return { description: "", hsnSac: "", quantity: "1", unit: "ea", unitPrice: "0", discountPct: "0", gstRatePct: "5" };
}

export function InvoiceLineEditor(props: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const d = props.defaults ?? {};

  const [customerId, setCustomerId] = useState<string>(d.customerId ?? (props.mode === "create" ? props.customers[0]?.id ?? "" : ""));
  const [placeOfSupplyStateCode, setPos] = useState<string>(d.placeOfSupplyStateCode ?? "29");
  const [dueDate, setDueDate] = useState<string>(d.dueDate ?? "");
  const [notes, setNotes] = useState<string>(d.notes ?? "");
  const [termsMd, setTermsMd] = useState<string>(d.termsMd ?? "");
  const [poRef, setPoRef] = useState<string>(d.poRef ?? "");
  const [lines, setLines] = useState<DraftLine[]>(d.lines && d.lines.length > 0 ? d.lines : [emptyLine()]);

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function removeLine(i: number) {
    setLines((p) => p.filter((_, idx) => idx !== i));
  }

  // When customer changes (create mode), auto-fill place of supply
  function onCustomer(id: string) {
    setCustomerId(id);
    if (props.mode === "create") {
      const c = props.customers.find((x) => x.id === id);
      if (c) setPos(c.stateCode);
    }
  }

  const totals = useMemo(() => {
    let subtotal = new Decimal(0);
    let tax = new Decimal(0);
    for (const l of lines) {
      const q = new Decimal(l.quantity || "0");
      const u = new Decimal(l.unitPrice || "0");
      const dec = new Decimal(l.discountPct || "0").div(100);
      const gst = new Decimal(l.gstRatePct || "0").div(100);
      const sub = q.times(u).times(new Decimal(1).minus(dec));
      subtotal = subtotal.plus(sub);
      tax = tax.plus(sub.times(gst));
    }
    return {
      subtotal: subtotal.toDecimalPlaces(2),
      tax: tax.toDecimalPlaces(2),
      grand: subtotal.plus(tax).toDecimalPlaces(2),
    };
  }, [lines]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (props.mode === "create" && !customerId) return toast.error("Choose a customer");
    if (!placeOfSupplyStateCode || placeOfSupplyStateCode.length !== 2) {
      return toast.error("Place of supply state code (2 digits)");
    }
    const payload = lines
      .filter((l) => l.description.trim() && Number(l.quantity) > 0)
      .map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac || null,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct || "0",
        gstRatePct: l.gstRatePct || "0",
      }));
    if (payload.length === 0) return toast.error("Add at least one line");

    startTransition(async () => {
      try {
        if (props.mode === "create") {
          await props.onSubmit({
            customerId,
            placeOfSupplyStateCode,
            dueDate: dueDate || null,
            notes: notes || null,
            termsMd: termsMd || null,
            poRef: poRef || null,
            lines: payload,
          });
        } else {
          await props.onSubmit({
            placeOfSupplyStateCode,
            dueDate: dueDate || null,
            notes: notes || null,
            termsMd: termsMd || null,
            poRef: poRef || null,
            lines: payload,
          });
        }
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4 max-w-3xl">
        <h3 className="font-medium text-[14px] text-ik-ink">Header</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="customerId">Customer</Label>
            {props.mode === "create" ? (
              <select id="customerId" value={customerId} onChange={(e) => onCustomer(e.target.value)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
                {props.customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            ) : (
              <div className="h-9 rounded-md border border-ik-rule bg-ik-paper-alt px-2 py-2 text-[13px] text-ik-ink-2">
                {props.customerLabel} <span className="text-ik-ink-3">(immutable on edit)</span>
              </div>
            )}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pos">Place of supply (state code)</Label>
            <Input id="pos" maxLength={2} value={placeOfSupplyStateCode} onChange={(e) => setPos(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="dueDate">Due date</Label>
            <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="poRef">Customer PO reference</Label>
            <Input id="poRef" value={poRef} onChange={(e) => setPoRef(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-[14px] text-ik-ink">Lines</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>+ Add line</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="border-b border-ik-rule text-left text-ik-ink-3">
              <tr>
                <th className="py-1 pr-2">Description</th>
                <th className="w-20 py-1 pr-2">HSN/SAC</th>
                <th className="w-20 py-1 pr-2 text-right">Qty</th>
                <th className="w-16 py-1 pr-2">Unit</th>
                <th className="w-24 py-1 pr-2 text-right">Rate ₹</th>
                <th className="w-16 py-1 pr-2 text-right">Disc %</th>
                <th className="w-16 py-1 pr-2 text-right">GST %</th>
                <th className="w-28 py-1 pr-2 text-right">Total ₹</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const q = new Decimal(l.quantity || "0");
                const u = new Decimal(l.unitPrice || "0");
                const dec = new Decimal(l.discountPct || "0").div(100);
                const gst = new Decimal(l.gstRatePct || "0").div(100);
                const sub = q.times(u).times(new Decimal(1).minus(dec));
                const tax = sub.times(gst);
                return (
                  <tr key={idx} className="border-b border-ik-rule">
                    <td className="py-1 pr-2"><input value={l.description} onChange={(e) => setLine(idx, { description: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1" /></td>
                    <td className="py-1 pr-2"><input value={l.hsnSac} onChange={(e) => setLine(idx, { hsnSac: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 font-mono" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.001" min="0.001" value={l.quantity} onChange={(e) => setLine(idx, { quantity: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2"><input value={l.unit} onChange={(e) => setLine(idx, { unit: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={l.unitPrice} onChange={(e) => setLine(idx, { unitPrice: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={l.discountPct} onChange={(e) => setLine(idx, { discountPct: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={l.gstRatePct} onChange={(e) => setLine(idx, { gstRatePct: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2 text-right font-mono">{sub.plus(tax).toDecimalPlaces(2).toString()}</td>
                    <td><button type="button" onClick={() => removeLine(idx)} className="text-alert">×</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-mono">
              <tr><td colSpan={7} className="py-1 pr-2 text-right text-ik-ink-3">Subtotal</td><td className="py-1 pr-2 text-right">{totals.subtotal.toString()}</td><td></td></tr>
              <tr><td colSpan={7} className="py-1 pr-2 text-right text-ik-ink-3">GST</td><td className="py-1 pr-2 text-right">{totals.tax.toString()}</td><td></td></tr>
              <tr className="font-medium"><td colSpan={7} className="py-1 pr-2 text-right">Grand total</td><td className="py-1 pr-2 text-right">{formatINR(totals.grand)}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="grid gap-3 max-w-3xl">
        <div className="grid gap-1">
          <Label htmlFor="notes">Notes (visible to customer)</Label>
          <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="termsMd">Terms (visible to customer)</Label>
          <Textarea id="termsMd" rows={2} value={termsMd} onChange={(e) => setTermsMd(e.target.value)} />
        </div>
      </section>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : props.submitLabel}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
