"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface POLine {
  id: string;
  description: string;
  unit: string;
  ordered: string;
  alreadyReceived: string;
  remaining: string;
}

interface Props {
  poId: string;
  lines: POLine[];
  onSubmit: (input: { poId: string; notes: string | null; lines: Array<{ poLineId: string; acceptedQty: string; rejectedQty: string; reason: string | null }> }) => Promise<ActionResult | void>;
}

interface DraftRow { acceptedQty: string; rejectedQty: string; reason: string }

export function GRNForm({ poId, lines, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<Record<string, DraftRow>>(
    Object.fromEntries(lines.map((l) => [l.id, { acceptedQty: "0", rejectedQty: "0", reason: "" }])),
  );

  function setRow(id: string, patch: Partial<DraftRow>) {
    setRows((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
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
      }));
    if (payload.length === 0) return toast.error("Enter accepted or rejected qty on at least one line");
    startTransition(async () => {
      try {
        const res = await onSubmit({ poId, notes: notes || null, lines: payload });
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
      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
        <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Lines</h3>
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
                <td className="py-1 pr-2"><input type="number" step="any" min="0" max={l.remaining} value={rows[l.id].acceptedQty} onChange={(e) => setRow(l.id, { acceptedQty: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                <td className="py-1 pr-2"><input type="number" step="any" min="0" max={l.remaining} value={rows[l.id].rejectedQty} onChange={(e) => setRow(l.id, { rejectedQty: e.target.value })} className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono" /></td>
                <td className="py-1 pr-2"><input value={rows[l.id].reason} onChange={(e) => setRow(l.id, { reason: e.target.value })} placeholder="reject reason" className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1" /></td>
              </tr>
            ))}
          </tbody>
        </table>
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
