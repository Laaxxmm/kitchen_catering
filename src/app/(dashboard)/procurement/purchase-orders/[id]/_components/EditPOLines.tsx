"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Decimal } from "decimal.js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNextNavigationError } from "@/lib/next-error";
import { formatINR } from "@/lib/money";
import type { ActionResult } from "@/lib/action-result";

// Common purchase units for the datalist — free text is still allowed, the
// list only saves typing. Keep in sync with what the store actually buys in.
const UNIT_SUGGESTIONS = [
  "kg", "gm", "litre", "ml", "piece", "pkt", "box", "roll", "tray", "bunch", "pouch", "dozen",
];

export interface EditablePOLine {
  id: string;
  sku: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  gstRatePct: string;
  /** Unit the linked Ingredient / BanquetItem catalogue tracks, if linked. */
  catalogueUnit: string | null;
}

interface Props {
  /** Bound "use server" shim → updateVendorPOLines. Returns the result. */
  action: (
    lines: Array<{
      id: string;
      description: string;
      unit: string;
      quantity: string;
      unitPrice: string;
      gstRatePct: string;
    }>,
  ) => Promise<ActionResult>;
  lines: EditablePOLine[];
}

/**
 * Mirror of the server math (createVendorPOTx / updateVendorPOLines):
 * lineSubtotal = round2(q·u), lineTax = round2(q·u·gst/100). Returns null
 * while the row holds an unparsable / out-of-range draft value.
 */
function computeRow(row: { quantity: string; unitPrice: string; gstRatePct: string }) {
  try {
    const q = new Decimal(row.quantity);
    const u = new Decimal(row.unitPrice);
    const g = new Decimal(row.gstRatePct);
    if (q.lte(0) || u.lt(0) || g.lt(0) || g.gt(100)) return null;
    const sub = q.times(u);
    const tax = sub.times(g.div(100));
    return {
      subtotal: sub.toDecimalPlaces(2),
      tax: tax.toDecimalPlaces(2),
      total: sub.plus(tax).toDecimalPlaces(2),
    };
  } catch {
    return null;
  }
}

/**
 * Editable line table for a DRAFT PO. The shortfall flow pre-fills the
 * catalogue unit + per-catalogue-unit cost; the store keeper corrects it
 * here to what they actually buy (e.g. "piece" instead of "pkt") so the
 * total is right BEFORE the PO goes for approval.
 */
export function EditPOLines({ action, lines }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [rows, setRows] = useState<EditablePOLine[]>(() => lines.map((l) => ({ ...l })));

  function setRow(id: string, patch: Partial<EditablePOLine>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  const computed = useMemo(() => rows.map((r) => computeRow(r)), [rows]);
  const allValid = computed.every((c) => c !== null) &&
    rows.every((r) => r.description.trim().length > 0 && r.unit.trim().length > 0 && r.unit.trim().length <= 20);
  const totals = useMemo(() => {
    if (!allValid) return null;
    let subtotal = new Decimal(0);
    let tax = new Decimal(0);
    for (const c of computed) {
      if (!c) return null;
      subtotal = subtotal.plus(c.subtotal);
      tax = tax.plus(c.tax);
    }
    return { subtotal, tax, grand: subtotal.plus(tax) };
  }, [allValid, computed]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!allValid) {
      toast.error("Fix the highlighted lines first — qty must be positive, price non-negative.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await action(
          rows.map((r) => ({
            id: r.id,
            description: r.description.trim(),
            unit: r.unit.trim(),
            quantity: r.quantity,
            unitPrice: r.unitPrice,
            gstRatePct: r.gstRatePct,
          })),
        );
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("PO lines updated");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-ik-rule bg-ik-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-medium text-[14px] text-ik-ink">Edit lines</h3>
        <span className="text-[11.5px] text-ik-ink-3">
          Draft PO — fix unit / price / qty before submitting for approval.
        </span>
      </div>
      <datalist id="po-units">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="border-b border-ik-rule text-left text-ik-ink-3">
            <tr>
              <th className="py-1 pr-2">SKU</th>
              <th className="min-w-40 py-1 pr-2">Description</th>
              <th className="w-24 py-1 pr-2">Unit</th>
              <th className="w-24 py-1 pr-2 text-right">Qty</th>
              <th className="w-28 py-1 pr-2 text-right">₹ Unit price</th>
              <th className="w-20 py-1 pr-2 text-right">GST %</th>
              <th className="w-28 py-1 text-right">Line total ₹</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const c = computed[i];
              const unitDiffers =
                row.catalogueUnit != null &&
                row.catalogueUnit.trim().toLowerCase() !== row.unit.trim().toLowerCase();
              return (
                <tr key={row.id} className="border-b border-ik-rule align-top">
                  <td className="py-1.5 pr-2 font-mono text-[12px]">{row.sku}</td>
                  <td className="py-1.5 pr-2">
                    <input
                      value={row.description}
                      onChange={(e) => setRow(row.id, { description: e.target.value })}
                      required
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      list="po-units"
                      value={row.unit}
                      onChange={(e) => setRow(row.id, { unit: e.target.value })}
                      required
                      maxLength={20}
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1"
                    />
                    {unitDiffers && (
                      <div className="mt-0.5 text-[11px] text-amber-700">
                        catalogue tracks {row.catalogueUnit}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={row.quantity}
                      onChange={(e) => setRow(row.id, { quantity: e.target.value })}
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={row.unitPrice}
                      onChange={(e) => setRow(row.id, { unitPrice: e.target.value })}
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      value={row.gstRatePct}
                      onChange={(e) => setRow(row.id, { gstRatePct: e.target.value })}
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                    />
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {c ? c.total.toFixed(2) : <span className="text-alert">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-end justify-between gap-4">
        <Button type="submit" size="sm" disabled={pending || !allValid}>
          {pending ? "Saving…" : "Save lines"}
        </Button>
        <div className="text-right font-mono text-[13px]">
          <div>
            <span className="text-ik-ink-3">Subtotal</span> {totals ? totals.subtotal.toFixed(2) : "—"}
          </div>
          <div>
            <span className="text-ik-ink-3">Tax</span> {totals ? totals.tax.toFixed(2) : "—"}
          </div>
          <div className="font-medium">
            <span className="text-ik-ink-3">PO total</span> {totals ? formatINR(totals.grand.toString()) : "—"}
          </div>
        </div>
      </div>
    </form>
  );
}
