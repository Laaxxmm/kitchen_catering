"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

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
    procurementType: "STANDARD" | "LOCAL" | "ONLINE";
    placeOfSupplyStateCode: string;
    expectedDate: string | undefined;
    notes: string | null;
    lines: Array<{ ingredientId: string | null; sku: string; description: string; unit: string; quantity: string; unitPrice: string; gstRatePct: string }>;
  }) => Promise<ActionResult | void>;
  // Pre-fill when the PO is being spun out of an approved PR — the lines
  // come straight from the request so the user only has to fill in prices.
  initialVendorId?: string | null;
  initialLines?: DraftLine[] | null;
  // Inline vendor creator — lets the store add a brand-new supplier (e.g. for
  // a one-off online order) without leaving the PO form.
  onQuickAddVendor?: (input: { name: string; stateCode: string }) => Promise<
    | { ok: true; id: string; name: string; code: string; stateCode: string }
    | { ok: false; error: string }
  >;
}

function emptyLine(): DraftLine {
  return { ingredientId: "", sku: "", description: "", unit: "kg", quantity: "1", unitPrice: "0", gstRatePct: "5" };
}

export function VendorPOForm({ vendors, ingredients, onSubmit, initialVendorId, initialLines, onQuickAddVendor }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [vendorOptions, setVendorOptions] = useState(vendors);
  const [vendorId, setVendorId] = useState(initialVendorId || vendors[0]?.id || "");
  const [procurementType, setProcurementType] = useState<"STANDARD" | "LOCAL" | "ONLINE">("STANDARD");
  // Inline "add vendor" toggle.
  const [addingVendor, setAddingVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorState, setNewVendorState] = useState("29");
  const [addingVendorBusy, setAddingVendorBusy] = useState(false);

  async function saveNewVendor() {
    if (!onQuickAddVendor) return;
    if (newVendorName.trim().length < 2) return toast.error("Enter the vendor name");
    setAddingVendorBusy(true);
    try {
      const v = await onQuickAddVendor({ name: newVendorName.trim(), stateCode: newVendorState.trim() || "29" });
      if (!v.ok) {
        toast.error(v.error);
        return;
      }
      setVendorOptions((prev) => [{ id: v.id, name: v.name, code: v.code, stateCode: v.stateCode }, ...prev]);
      setVendorId(v.id);
      setAddingVendor(false);
      setNewVendorName("");
      toast.success(`Vendor ${v.name} added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add vendor");
    } finally {
      setAddingVendorBusy(false);
    }
  }
  const [placeOfSupplyStateCode, setPos] = useState("29");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(
    initialLines && initialLines.length > 0 ? initialLines : [emptyLine()],
  );

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
    // Rows that are entirely empty are ignored; a row with content but a
    // missing/zero quantity is an error, not a silent drop.
    const touched = lines.filter((l) => l.description.trim() || l.sku.trim() || l.quantity.trim() || l.unitPrice.trim());
    for (const l of touched) {
      if (!l.description.trim()) return toast.error("A line is missing its description");
      const q = Number(l.quantity);
      if (!l.quantity.trim() || Number.isNaN(q) || q <= 0) {
        return toast.error(`"${l.description.trim()}": enter a quantity above 0`);
      }
      if (l.unitPrice.trim() && Number.isNaN(Number(l.unitPrice))) {
        return toast.error(`"${l.description.trim()}": the unit price isn't a number`);
      }
    }
    const payload = touched.map((l) => ({
      ...l,
      quantity: l.quantity.trim(),
      unitPrice: l.unitPrice.trim() || "0",
      gstRatePct: (l.gstRatePct ?? "").trim() || "0",
    }));
    if (payload.length === 0) return toast.error("Add at least one line");
    startTransition(async () => {
      try {
        const res = await onSubmit({
          vendorId,
          procurementType,
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
        if (res && !res.ok) {
          toast.error(res.error);
          return;
        }
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <section className="grid gap-3 rounded-[14px] border border-ik-rule bg-ik-card p-4 max-w-3xl sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Supplier</h3>
        {/* Vendor gets its own full-width row — the name is the most
            important field here and was being truncated in the old
            three-up grid. */}
        <div className="grid gap-1">
          <Label htmlFor="vendorId">Vendor<span className="text-gold" aria-hidden> *</span></Label>
          <select
            id="vendorId"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            {vendorOptions.map((v) => <option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}
          </select>
          <div className="flex items-center justify-between">
            <p className="text-[11.5px] text-ik-ink-3">Who you&apos;re buying from. Pick the supplier, then set their prices below.</p>
            {onQuickAddVendor && !addingVendor && (
              <button type="button" className="text-[11.5px] text-brand hover:underline" onClick={() => setAddingVendor(true)}>
                + Add new vendor
              </button>
            )}
          </div>
          {onQuickAddVendor && addingVendor && (
            <div className="grid gap-2 rounded-md border border-brand-200 bg-brand-50 p-3 sm:grid-cols-[1fr,120px,auto]">
              <div className="grid gap-1">
                <Label htmlFor="newVendorName">New vendor name</Label>
                <Input id="newVendorName" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} placeholder="e.g. Amazon Business" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="newVendorState">State code</Label>
                <Input id="newVendorState" maxLength={2} value={newVendorState} onChange={(e) => setNewVendorState(e.target.value)} />
              </div>
              <div className="flex items-end gap-2">
                <Button type="button" size="sm" disabled={addingVendorBusy} onClick={saveNewVendor}>{addingVendorBusy ? "Adding…" : "Add"}</Button>
                <Button type="button" size="sm" variant="ghost" disabled={addingVendorBusy} onClick={() => setAddingVendor(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="procurementType">Procurement type</Label>
          <select
            id="procurementType"
            value={procurementType}
            onChange={(e) => setProcurementType(e.target.value as "STANDARD" | "LOCAL" | "ONLINE")}
            className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
          >
            <option value="STANDARD">Standard (vendor PO)</option>
            <option value="LOCAL">Local purchase</option>
            <option value="ONLINE">Online order</option>
          </select>
          <p className="text-[11.5px] text-ik-ink-3">
            Approval by value: under ₹5,000 the manager signs off; ₹5,000 and above needs admin.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="pos">Place of supply (state code)</Label>
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
        <p className="mb-3 rounded border border-ik-rule bg-ik-paper-alt p-2 text-[11.5px] text-ik-ink-2">
          <strong>About the prices:</strong> the <em>Est. unit ₹</em> and <em>GST %</em> are an
          estimate — they pre-fill from each ingredient&apos;s last paid cost so the system can compute a
          total and decide whether the manager or admin needs to approve. The supplier&apos;s actual price
          is captured later, when you record their bill against the delivery. Leave a row at 0 if you
          have no estimate.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="border-b border-ik-rule text-left text-ik-ink-3">
              <tr>
                <th className="py-1 pr-2">Ingredient (optional)</th>
                <th className="py-1 pr-2">SKU</th>
                <th className="py-1 pr-2">Description</th>
                <th className="py-1 pr-2">Unit</th>
                <th className="w-20 py-1 pr-2 text-right">Qty</th>
                <th className="w-24 py-1 pr-2 text-right" title="Estimated supplier rate — used to compute approval tier. Actual rate comes from the bill at delivery.">Est. unit ₹</th>
                <th className="w-16 py-1 pr-2 text-right">GST %</th>
                <th className="w-28 py-1 pr-2 text-right">Est. total ₹</th>
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
                    <td className="py-1 pr-2"><input type="number" step="any" min="0.001" value={l.quantity} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={l.unitPrice} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2"><input type="number" step="0.01" min="0" value={l.gstRatePct} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, gstRatePct: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2 text-right font-mono">{sub.plus(tax).toDecimalPlaces(2).toString()}</td>
                    <td><button type="button" className="text-alert" onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-mono">
              <tr><td colSpan={7} className="py-1 pr-2 text-right text-ik-ink-3">Est. subtotal</td><td className="py-1 pr-2 text-right">{totals.subtotal.toString()}</td><td></td></tr>
              <tr><td colSpan={7} className="py-1 pr-2 text-right text-ik-ink-3">Est. tax</td><td className="py-1 pr-2 text-right">{totals.tax.toString()}</td><td></td></tr>
              <tr className="font-medium"><td colSpan={7} className="py-1 pr-2 text-right">Est. total</td><td className="py-1 pr-2 text-right">₹{totals.total.toString()}</td><td></td></tr>
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
