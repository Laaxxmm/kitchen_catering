"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Vendor { id: string; name: string; code: string }
interface PO { id: string; poNo: string; vendorId: string; vendorName: string }

interface DraftLine { description: string; quantity: string; unit: string; unitPrice: string; gstRatePct: string }

interface Props {
  vendors: Vendor[];
  pos: PO[];
  onSubmit: (input: {
    vendorId: string; poId: string | null; vendorBillNo: string | null;
    issueDate: string | undefined; dueDate: string | null; notes: string | null;
    lines: DraftLine[];
  }) => Promise<void>;
}

function empty(): DraftLine { return { description: "", quantity: "1", unit: "kg", unitPrice: "0", gstRatePct: "5" }; }

export function VendorBillForm({ vendors, pos, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [poId, setPoId] = useState<string>("");
  const [vendorBillNo, setVendorBillNo] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([empty()]);

  const filteredPos = pos.filter((p) => p.vendorId === vendorId);

  const totals = useMemo(() => {
    let sub = new Decimal(0);
    let tax = new Decimal(0);
    for (const l of lines) {
      const q = new Decimal(l.quantity || "0");
      const u = new Decimal(l.unitPrice || "0");
      const g = new Decimal(l.gstRatePct || "0").div(100);
      const s = q.times(u);
      sub = sub.plus(s);
      tax = tax.plus(s.times(g));
    }
    return { sub: sub.toDecimalPlaces(2), tax: tax.toDecimalPlaces(2), grand: sub.plus(tax).toDecimalPlaces(2) };
  }, [lines]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) return toast.error("Pick a vendor");
    const payload = lines.filter((l) => l.description && Number(l.quantity) > 0);
    if (payload.length === 0) return toast.error("Add at least one line");
    startTransition(async () => {
      try {
        await onSubmit({
          vendorId,
          poId: poId || null,
          vendorBillNo: vendorBillNo || null,
          issueDate: issueDate || undefined,
          dueDate: dueDate || null,
          notes: notes || null,
          lines: payload,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4 max-w-3xl">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="vendorId">Vendor</Label>
            <select id="vendorId" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPoId(""); }} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="poId">Linked PO (optional, enables 3-way match)</Label>
            <select id="poId" value={poId} onChange={(e) => setPoId(e.target.value)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              <option value="">— no PO —</option>
              {filteredPos.map((p) => <option key={p.id} value={p.id}>{p.poNo}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="vendorBillNo">Vendor invoice #</Label>
            <Input id="vendorBillNo" value={vendorBillNo} onChange={(e) => setVendorBillNo(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="issueDate">Issue date</Label>
            <Input id="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="dueDate">Due date</Label>
            <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-medium text-[14px] text-ik-ink">Lines</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, empty()])}>+ Add line</Button>
        </div>
        <table className="w-full text-[12.5px]">
          <thead className="border-b border-ik-rule text-left text-ik-ink-3">
            <tr>
              <th className="py-1 pr-2">Description</th>
              <th className="w-20 py-1 pr-2 text-right">Qty</th>
              <th className="w-16">Unit</th>
              <th className="w-24 py-1 pr-2 text-right">Unit ₹</th>
              <th className="w-16 py-1 pr-2 text-right">GST %</th>
              <th className="w-28 py-1 pr-2 text-right">Total ₹</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const sub = new Decimal(l.quantity || "0").times(new Decimal(l.unitPrice || "0"));
              const tax = sub.times(new Decimal(l.gstRatePct || "0").div(100));
              return (
                <tr key={idx} className="border-b border-ik-rule">
                  <td className="py-1 pr-2"><input value={l.description} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1" /></td>
                  <td className="py-1 pr-2"><input type="number" step="0.001" min="0.001" value={l.quantity} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                  <td className="py-1 pr-2"><input value={l.unit} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))} className="h-8 w-12 rounded border border-ik-rule bg-ik-card px-1" /></td>
                  <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={l.unitPrice} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                  <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={l.gstRatePct} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, gstRatePct: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                  <td className="py-1 pr-2 text-right font-mono">{sub.plus(tax).toDecimalPlaces(2).toString()}</td>
                  <td><button type="button" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))} className="text-alert">×</button></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="font-mono">
            <tr><td colSpan={5} className="py-1 pr-2 text-right text-ik-ink-3">Subtotal</td><td className="py-1 pr-2 text-right">{totals.sub.toString()}</td><td></td></tr>
            <tr><td colSpan={5} className="py-1 pr-2 text-right text-ik-ink-3">Tax</td><td className="py-1 pr-2 text-right">{totals.tax.toString()}</td><td></td></tr>
            <tr className="font-medium"><td colSpan={5} className="py-1 pr-2 text-right">Grand total</td><td className="py-1 pr-2 text-right">₹{totals.grand.toString()}</td><td></td></tr>
          </tfoot>
        </table>
      </section>

      <div className="grid gap-1 max-w-2xl">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create draft bill"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
