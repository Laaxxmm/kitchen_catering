"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ThreeWayMatchInfo } from "@/components/ik/ThreeWayMatchInfo";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

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
  }) => Promise<ActionResult | void>;
  // Pre-fill when the bill is being recorded against a known PO (the
  // "Record supplier bill" button on the PO/GRN detail page).
  initialVendorId?: string | null;
  initialPoId?: string | null;
  initialLines?: DraftLine[] | null;
  // Edit mode (existing DRAFT / PENDING_MATCH bill): header fields come
  // pre-filled and the vendor + PO linkage is locked — same defaults
  // pattern as the customer/order forms.
  mode?: "create" | "edit";
  defaults?: {
    vendorBillNo?: string;
    issueDate?: string;
    dueDate?: string;
    notes?: string;
  };
  submitLabel?: string;
}

function empty(): DraftLine { return { description: "", quantity: "1", unit: "kg", unitPrice: "0", gstRatePct: "5" }; }

export function VendorBillForm({ vendors, pos, onSubmit, initialVendorId, initialPoId, initialLines, mode = "create", defaults, submitLabel }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const isEdit = mode === "edit";
  const [vendorId, setVendorId] = useState(initialVendorId || "");
  const [poId, setPoId] = useState<string>(initialPoId || "");
  const [vendorBillNo, setVendorBillNo] = useState(defaults?.vendorBillNo ?? "");
  const [issueDate, setIssueDate] = useState(defaults?.issueDate ?? "");
  const [dueDate, setDueDate] = useState(defaults?.dueDate ?? "");
  const [notes, setNotes] = useState(defaults?.notes ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    initialLines && initialLines.length > 0 ? initialLines : [empty()],
  );

  const filteredPos = pos.filter((p) => p.vendorId === vendorId);

  // Choosing a PO reloads the page with ?poId= so the server-side prefill
  // runs (vendor locked, lines defaulted to the GRN-received quantities,
  // unit prices + GST from the PO). Anything already typed is replaced —
  // the PO is the source of truth for the lines.
  function onPoChange(nextPoId: string) {
    if (isEdit) return;
    router.push(
      nextPoId
        ? `/procurement/vendor-bills/new?poId=${nextPoId}`
        : "/procurement/vendor-bills/new",
    );
  }

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
        const res = await onSubmit({
          vendorId,
          poId: poId || null,
          vendorBillNo: vendorBillNo || null,
          issueDate: issueDate || undefined,
          dueDate: dueDate || null,
          notes: notes || null,
          lines: payload,
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
      <div className="max-w-3xl">
        <ThreeWayMatchInfo />
      </div>
      <section className="grid gap-3 rounded-[14px] border border-ik-rule bg-ik-card p-4 max-w-3xl sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Bill details</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="vendorId">Vendor<span className="text-gold" aria-hidden> *</span></Label>
            {/* Vendor is locked once a PO is linked — the PO determines the supplier. */}
            <select id="vendorId" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPoId(""); }} disabled={isEdit || !!poId} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px] disabled:opacity-60">
              <option value="" disabled>— pick vendor —</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.code} · {v.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="poId">Linked PO (optional, prefills lines + enables 3-way match)</Label>
            <select id="poId" value={poId} onChange={(e) => onPoChange(e.target.value)} disabled={isEdit} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px] disabled:opacity-60">
              <option value="">— no PO —</option>
              {filteredPos.map((p) => <option key={p.id} value={p.id}>{p.poNo}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="vendorBillNo">Vendor invoice #</Label>
            <Input id="vendorBillNo" maxLength={60} value={vendorBillNo} onChange={(e) => setVendorBillNo(e.target.value)} />
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

      <section className="rounded-[14px] border border-ik-rule bg-ik-card p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Lines</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, empty()])}>+ Add line</Button>
        </div>
        <div className="overflow-x-auto">
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
                  <td className="py-1 pr-2"><input maxLength={500} value={l.description} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1" /></td>
                  <td className="py-1 pr-2"><input type="number" step="any" min="0.001" value={l.quantity} onChange={(e) => setLines((p) => p.map((x, i) => i === idx ? { ...x, quantity: e.target.value } : x))} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
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
        </div>
      </section>

      <div className="grid gap-1 max-w-2xl">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-ik-rule bg-ik-paper/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-ik-paper/75 md:-mx-6 md:px-6">
        <span className="text-[11.5px] text-ik-ink-3">
          {isEdit
            ? "Saving replaces the bill's lines and clears any previous match result — re-run the 3-way match after."
            : poId ? "3-way match (bill ↔ PO ↔ GRN) runs on save." : "Link a PO above to enable the 3-way match."}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel ?? "Create draft bill"}</Button>
        </div>
      </div>
    </form>
  );
}
