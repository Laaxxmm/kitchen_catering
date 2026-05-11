"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Vendor { id: string; name: string; code: string; stateCode: string }
interface Ingredient { id: string; sku: string; name: string; unit: string; gstRatePct: string }

interface DraftLine {
  ingredientId: string;
  sku: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  gstRatePct: string;
}

interface Props {
  vendors: Vendor[];
  ingredients: Ingredient[];
  onSubmit: (input: {
    vendorId: string;
    placeOfSupplyStateCode: string;
    expectedDate: string | undefined;
    notes: string | null;
    lines: Array<{ ingredientId: string | null; sku: string; description: string; unit: string; quantity: string; unitPrice: string; gstRatePct: string }>;
  }) => Promise<void>;
}

function emptyLine(): DraftLine {
  return { ingredientId: "", sku: "", description: "", unit: "kg", quantity: "1", unitPrice: "0", gstRatePct: "5" };
}

export function VendorPOForm({ vendors, ingredients, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [placeOfSupplyStateCode, setPos] = useState("29");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  const totals = useMemo(() => {
    let subtotal = new Decimal(0);
    let tax = new Decimal(0);
    for (const l of lines) {
      const q = new Decimal(l.quantity || "0");
      const u = new Decimal(l.unitPrice || "0");
      const g = new Decimal(l.gstRatePct || "0").div(100);
      const s = q.times(u);
      subtotal = subtotal.plus(s);
      tax = tax.plus(s.times(g));
    }
    return { subtotal: subtotal.toDecimalPlaces(2), tax: tax.toDecimalPlaces(2), total: subtotal.plus(tax).toDecimalPlaces(2) };
  }, [lines]);

  function pickIngredient(idx: number, ingredientId: string) {
    const ing = ingredients.find((i) => i.id === ingredientId);
    setLines((p) => p.map((x, i) =>
      i === idx
        ? {
            ...x,
            ingredientId,
            sku: ing?.sku ?? x.sku,
            description: ing?.name ?? x.description,
            unit: ing?.unit ?? x.unit,
            gstRatePct: ing?.gstRatePct ?? x.gstRatePct,
          }
        : x,
    ));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vendorId) return toast.error("Pick a vendor");
    const payload = lines.filter((l) => l.description && Number(l.quantity) > 0);
    if (payload.length === 0) return toast.error("Add at least one line");
    startTransition(async () => {
      try {
        await onSubmit({
          vendorId,
          placeOfSupplyStateCode,
          expectedDate: expectedDate || undefined,
          notes: notes || null,
          lines: payload.map((l) => ({
            ingredientId: l.ingredientId || null,
            sku: l.sku,
            description: l.description,
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            gstRatePct: l.gstRatePct,
          })),
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
            <select id="vendorId" value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="pos">Place of supply</Label>
            <Input id="pos" maxLength={2} value={placeOfSupplyStateCode} onChange={(e) => setPos(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="expectedDate">Expected by</Label>
            <Input id="expectedDate" type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
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
                <th className="py-1 pr-2">Ingredient (optional)</th>
                <th className="py-1 pr-2">SKU</th>
                <th className="py-1 pr-2">Description</th>
                <th className="py-1 pr-2">Unit</th>
                <th className="w-20 py-1 pr-2 text-right">Qty</th>
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
                    <td className="py-1 pr-2">
                      <select value={l.ingredientId} onChange={(e) => pickIngredient(idx, e.target.value)} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1">
                        <option value="">— free text —</option>
                        {ingredients.map((i) => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}
                      </select>
                    </td>
                    <td className="py-1 pr-2"><input value={l.sku} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, sku: e.target.value } : x))} className="h-8 w-20 rounded border border-ik-rule bg-ik-card px-1 font-mono" /></td>
                    <td className="py-1 pr-2"><input value={l.description} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1" /></td>
                    <td className="py-1 pr-2"><input value={l.unit} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, unit: e.target.value } : x))} className="h-8 w-12 rounded border border-ik-rule bg-ik-card px-1" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.001" min="0.001" value={l.quantity} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={l.unitPrice} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={l.gstRatePct} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, gstRatePct: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2 text-right font-mono">{sub.plus(tax).toDecimalPlaces(2).toString()}</td>
                    <td><button type="button" className="text-alert" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-mono">
              <tr><td colSpan={7} className="py-1 pr-2 text-right text-ik-ink-3">Subtotal</td><td className="py-1 pr-2 text-right">{totals.subtotal.toString()}</td><td></td></tr>
              <tr><td colSpan={7} className="py-1 pr-2 text-right text-ik-ink-3">Tax</td><td className="py-1 pr-2 text-right">{totals.tax.toString()}</td><td></td></tr>
              <tr className="font-medium"><td colSpan={7} className="py-1 pr-2 text-right">Total</td><td className="py-1 pr-2 text-right">₹{totals.total.toString()}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="grid gap-1 max-w-2xl">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create draft PO"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
