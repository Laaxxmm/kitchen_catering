"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isNextNavigationError } from "@/lib/next-error";
import type { IngredientReturnInputT } from "@/lib/validators";
import type { ActionResultWith } from "@/lib/action-result";

export interface ReturnableIssue {
  id: string;
  issuedAt: string;
  ingredientName: string;
  sku: string;
  unit: string;
  orderCode: string | null;
  issuedQty: string;
  unitCostAtIssue: string;
  returnable: string;
}

interface Props {
  issues: ReturnableIssue[];
  onSubmit: (input: IngredientReturnInputT) => Promise<ActionResultWith<{ id: string }>>;
}

// Offered, not enforced — the store can type anything, but the three common
// answers shouldn't need typing.
const REASONS = ["Unused", "Excess", "Wrong item"];

export function ReturnForm({ issues, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [returnedAt, setReturnedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  type Row = { qty: string; reason: string };
  const [rows, setRows] = useState<Record<string, Row | undefined>>({});

  function setRow(id: string, patch: Partial<Row>) {
    setRows((r) => ({ ...r, [id]: { qty: "", reason: "", ...r[id], ...patch } }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const filled = issues
      .map((i) => ({ issue: i, row: rows[i.id] }))
      .filter((r): r is { issue: ReturnableIssue; row: Row } => Number(r.row?.qty ?? "") > 0);
    if (filled.length === 0) return toast.error("Enter a quantity on at least one line");
    const noReason = filled.find((r) => r.row.reason.trim().length < 2);
    if (noReason) {
      return toast.error(
        "Every line needs a reason — that's what makes the cost correction auditable",
      );
    }
    const overRun = filled.find((r) => Number(r.row.qty) > Number(r.issue.returnable));
    if (overRun) {
      return toast.error(
        `Only ${overRun.issue.returnable} ${overRun.issue.unit} of ${overRun.issue.ingredientName} is still returnable on that issue`,
      );
    }
    const lines = filled.map((r) => ({
      issueId: r.issue.id,
      quantity: r.row.qty,
      reason: r.row.reason.trim(),
    }));

    startTransition(async () => {
      try {
        const res = await onSubmit({ returnedAt, notes: notes.trim() || null, lines });
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success("Return recorded — stock is back on hand and the order has been credited");
        router.push("/inventory/returns");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  if (issues.length === 0) {
    return (
      <p className="text-[13px] text-ik-ink-3">
        Nothing is returnable — every recent issue has already come back in full.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <datalist id="return-reasons">
        {REASONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <div className="grid max-w-xs gap-1">
        <Label htmlFor="returnedAt">Returned on</Label>
        <Input
          id="returnedAt"
          type="date"
          value={returnedAt}
          onChange={(e) => setReturnedAt(e.target.value)}
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Issued</TableHead>
            <TableHead>Ingredient</TableHead>
            <TableHead>Order</TableHead>
            <TableHead className="text-right">Issued</TableHead>
            <TableHead className="text-right">Still returnable</TableHead>
            <TableHead className="text-right">Cost at issue</TableHead>
            <TableHead className="w-32">Return qty</TableHead>
            <TableHead className="w-56">Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((i) => (
            <TableRow key={i.id}>
              <TableCell className="font-mono text-[12px]">{i.issuedAt}</TableCell>
              <TableCell>
                {i.ingredientName} <span className="text-ik-ink-3">· {i.sku}</span>
              </TableCell>
              <TableCell className="font-mono text-[12px]">{i.orderCode ?? "—"}</TableCell>
              <TableCell className="text-right font-mono">
                {i.issuedQty} {i.unit}
              </TableCell>
              <TableCell className="text-right font-mono font-medium">
                {i.returnable} {i.unit}
              </TableCell>
              <TableCell className="text-right font-mono">₹{i.unitCostAtIssue}</TableCell>
              <TableCell>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  max={i.returnable}
                  value={rows[i.id]?.qty ?? ""}
                  onChange={(e) => setRow(i.id, { qty: e.target.value })}
                  placeholder="0"
                />
              </TableCell>
              <TableCell>
                <Input
                  list="return-reasons"
                  value={rows[i.id]?.reason ?? ""}
                  onChange={(e) => setRow(i.id, { reason: e.target.value })}
                  placeholder="Unused / excess…"
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="grid max-w-2xl gap-1">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Textarea
          id="notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. chef sent back the veg trolley after the Wipro lunch"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Record return"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
