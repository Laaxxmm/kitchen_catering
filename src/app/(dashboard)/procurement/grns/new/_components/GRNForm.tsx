"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResultWith } from "@/lib/action-result";

interface POLine {
  id: string;
  description: string;
  unit: string;
  ordered: string;
  alreadyReceived: string;
  remaining: string;
}

/** An item from either catalogue, for the "they also brought this" picker. */
export interface CatalogueItem {
  key: string;
  ingredientId: string | null;
  banquetItemId: string | null;
  label: string;
  unit: string;
}

export interface GRNSubmitInput {
  poId: string;
  notes: string | null;
  lines: Array<{
    poLineId: string;
    acceptedQty: string;
    rejectedQty: string;
    reason: string | null;
    overReceiptReason?: string | null;
  }>;
  extraLines?: Array<{
    ingredientId: string | null;
    banquetItemId: string | null;
    quantity: string;
    unitPrice: string;
    reason: string;
  }>;
}

interface Props {
  poId: string;
  lines: POLine[];
  catalogue: CatalogueItem[];
  onSubmit: (
    input: GRNSubmitInput,
  ) => Promise<ActionResultWith<{ id: string; grnNo: string; warnings?: string[] }>>;
}

interface DraftRow {
  acceptedQty: string;
  rejectedQty: string;
  reason: string;
  /** Only asked for once the line goes over what the PO still has open. */
  overReceiptReason: string;
}

interface ExtraRow { key: string; quantity: string; unitPrice: string; reason: string }

export function GRNForm({ poId, lines, catalogue, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Record<string, DraftRow>>(
    Object.fromEntries(
      lines.map((l) => [l.id, { acceptedQty: "0", rejectedQty: "0", reason: "", overReceiptReason: "" }]),
    ),
  );
  const [extras, setExtras] = useState<ExtraRow[]>([]);

  function setRow(id: string, patch: Partial<DraftRow>) {
    setRows((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
  }

  /** Over what the PO still has open — 100 g ordered, 500 g delivered. */
  function isOver(l: POLine): boolean {
    const taking = Number(rows[l.id].acceptedQty || 0) + Number(rows[l.id].rejectedQty || 0);
    return taking > Number(l.remaining);
  }

  function setExtra(i: number, patch: Partial<ExtraRow>) {
    setExtras((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  /**
   * "The vendor didn't bring it." Leaving both boxes at 0 records nothing at
   * all — the line is dropped and the GRN has no lines to post — so the store
   * was stuck on a line it could not clear. Not received means rejecting the
   * whole outstanding quantity, which is a number the screen already knows.
   */
  function notReceived(l: POLine) {
    setRow(l.id, {
      acceptedQty: "0",
      rejectedQty: l.remaining,
      reason: rows[l.id].reason.trim() || "Not delivered by the vendor",
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = lines
      .filter((l) => Number(rows[l.id].acceptedQty) > 0 || Number(rows[l.id].rejectedQty) > 0)
      .map((l) => ({
        poLineId: l.id,
        acceptedQty: rows[l.id].acceptedQty,
        rejectedQty: rows[l.id].rejectedQty,
        reason: rows[l.id].reason || null,
        overReceiptReason: isOver(l) ? rows[l.id].overReceiptReason.trim() || null : null,
      }));

    const overMissingReason = lines.find((l) => isOver(l) && !rows[l.id].overReceiptReason.trim());
    if (overMissingReason) {
      return toast.error(
        `${overMissingReason.description}: more arrived than the PO has open. Say why you're taking the extra.`,
      );
    }

    const extraPayload = extras
      .filter((x) => x.key && Number(x.quantity) > 0)
      .map((x) => {
        const item = catalogue.find((c) => c.key === x.key)!;
        return {
          ingredientId: item.ingredientId,
          banquetItemId: item.banquetItemId,
          quantity: x.quantity,
          unitPrice: x.unitPrice || "0",
          reason: x.reason.trim(),
        };
      });
    const extraMissingReason = extraPayload.find((x) => !x.reason);
    if (extraMissingReason) {
      return toast.error("An added item needs a note saying why it's on the delivery.");
    }

    if (payload.length === 0 && extraPayload.length === 0) {
      return toast.error(
        "Nothing recorded yet — type what arrived under Accept, press “Not received” on a line the vendor didn't bring, or add an item they delivered that isn't on the PO.",
      );
    }
    startTransition(async () => {
      try {
        const res = await onSubmit({
          poId,
          notes: notes || null,
          lines: payload,
          extraLines: extraPayload.length > 0 ? extraPayload : undefined,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        // Unit-mismatch warnings: stock was NOT auto-posted for those
        // lines — keep them on screen long enough to actually read.
        for (const w of res.warnings ?? []) {
          toast.warning(w, { duration: 12000 });
        }
        toast.success(`GRN ${res.grnNo} posted`);
        router.push(`/procurement/grns/${res.id}`);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Lines</h3>
        <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="border-b border-ik-rule text-left text-ik-ink-3">
            <tr>
              <th className="py-1 pr-2">Description</th>
              <th className="w-24 py-1 pr-2 text-right">Ordered</th>
              <th className="w-24 py-1 pr-2 text-right">Already</th>
              <th className="w-24 py-1 pr-2 text-right">Remaining</th>
              <th className="w-24 py-1 pr-2 text-right">Accept</th>
              <th className="w-24 py-1 pr-2 text-right">Reject</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-ik-rule">
                <td className="py-1 pr-2">{l.description} <span className="text-ik-ink-3">({l.unit})</span></td>
                <td className="py-1 pr-2 text-right font-mono">{l.ordered}</td>
                <td className="py-1 pr-2 text-right font-mono">{l.alreadyReceived}</td>
                <td className="py-1 pr-2 text-right font-mono">{l.remaining}</td>
                {Number(l.remaining) <= 0 ? (
                  <td colSpan={3} className="py-1 pr-2 text-[12px] text-ik-ink-3">✓ fully received</td>
                ) : (
                  <>
                    {/* No max: more can turn up than was ordered, and the
                        shelf doesn't care what the PO said. Going over asks
                        for a reason below and raises the PO to match. */}
                    <td className="py-1 pr-2"><input type="number" step="any" min="0" value={rows[l.id].acceptedQty} onChange={(e) => setRow(l.id, { acceptedQty: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2"><input type="number" step="any" min="0" value={rows[l.id].rejectedQty} onChange={(e) => setRow(l.id, { rejectedQty: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                    <td className="py-1 pr-2">
                      <div className="flex items-center gap-1">
                        <input value={rows[l.id].reason} onChange={(e) => setRow(l.id, { reason: e.target.value })} placeholder="reject reason" className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1" />
                        <button
                          type="button"
                          onClick={() => notReceived(l)}
                          className="h-8 shrink-0 rounded border border-ik-rule px-2 text-[11.5px] text-ik-ink-2 hover:bg-ik-paper-alt"
                        >
                          Not received
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {/* The over-delivery prompt gets its own row so the table columns
                stay put — a reason box squeezed into the Reason cell would
                push Accept and Reject off the edge on a small screen. */}
            {lines.filter((l) => Number(l.remaining) > 0 && isOver(l)).map((l) => (
              <tr key={`over-${l.id}`} className="border-b border-amber-wash bg-amber-wash">
                <td colSpan={7} className="px-1 py-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="text-amber">
                      <strong>{l.description}</strong>: more arrived than the PO has open
                      ({l.remaining} {l.unit}). Taking it raises the PO to what came, so the
                      supplier&apos;s bill still matches.
                    </span>
                    <input
                      value={rows[l.id].overReceiptReason}
                      onChange={(e) => setRow(l.id, { overReceiptReason: e.target.value })}
                      placeholder="why you're taking the extra"
                      className="h-8 min-w-56 flex-1 rounded border border-ik-rule bg-ik-card px-1"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>

      {/* Things the vendor brought that the PO never listed. They join the
          PO as new lines and are received here, so the supplier's bill has
          something to reconcile against. */}
      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-[14px] text-ik-ink">They also delivered…</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setExtras((p) => [...p, { key: "", quantity: "", unitPrice: "", reason: "" }])}
          >
            + Add an item not on the PO
          </Button>
        </div>
        {extras.length === 0 ? (
          <p className="text-[12px] text-ik-ink-3">
            Only if something turned up that isn&apos;t listed above. It gets added to the PO at the
            price you enter and received in this same GRN.
          </p>
        ) : (
          <div className="grid gap-2">
            {extras.map((x, i) => {
              const item = catalogue.find((c) => c.key === x.key);
              return (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[minmax(0,2fr),90px,110px,minmax(0,1.5fr),70px]">
                  <div className="grid gap-1">
                    <Label htmlFor={`extra-item-${i}`}>Item</Label>
                    <select
                      id={`extra-item-${i}`}
                      value={x.key}
                      onChange={(e) => setExtra(i, { key: e.target.value })}
                      className="h-8 rounded border border-ik-rule bg-ik-card px-1 text-[12.5px]"
                    >
                      <option value="">— pick an item —</option>
                      {catalogue.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`extra-qty-${i}`}>Qty {item ? `(${item.unit})` : ""}</Label>
                    <input id={`extra-qty-${i}`} type="number" step="any" min="0" value={x.quantity} onChange={(e) => setExtra(i, { quantity: e.target.value })} className="h-8 rounded border border-ik-rule bg-ik-card px-1 text-right font-mono text-[12.5px]" />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`extra-rate-${i}`}>Rate ₹</Label>
                    <input id={`extra-rate-${i}`} type="number" step="any" min="0" value={x.unitPrice} onChange={(e) => setExtra(i, { unitPrice: e.target.value })} className="h-8 rounded border border-ik-rule bg-ik-card px-1 text-right font-mono text-[12.5px]" />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`extra-why-${i}`}>Why it&apos;s here</Label>
                    <input id={`extra-why-${i}`} value={x.reason} onChange={(e) => setExtra(i, { reason: e.target.value })} placeholder="e.g. sent in place of a short item" className="h-8 rounded border border-ik-rule bg-ik-card px-1 text-[12.5px]" />
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setExtras((p) => p.filter((_, idx) => idx !== i))}>
                    Remove
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="grid gap-1 max-w-2xl">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Post GRN"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
