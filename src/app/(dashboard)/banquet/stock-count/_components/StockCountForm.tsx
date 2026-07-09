"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResultWith } from "@/lib/action-result";
import { isNextNavigationError } from "@/lib/next-error";

interface Item {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  current: string;
}

interface Props {
  items: Item[];
  onSubmit: (input: {
    lines: Array<{ itemId: string; countedQty: string }>;
    notes: string | null;
  }) => Promise<ActionResultWith<{ changes: Array<{ name: string; before: string; after: string }> }>>;
}

function safeDecimal(v: string): Decimal | null {
  try {
    const d = new Decimal(v);
    return d.isNaN() ? null : d;
  } catch {
    return null;
  }
}

/**
 * Mirrors the kitchen AuditForm: one row per item, counted quantity on the
 * right, live Δ vs system on-hand. Blank input = "not counted" — the row is
 * skipped entirely; only rows whose count differs from on-hand are posted.
 */
export function StockCountForm({ items, onSubmit }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    return items.map((i) => {
      const raw = (counts[i.id] ?? "").trim();
      const counted = raw === "" ? null : safeDecimal(raw);
      const delta = counted === null ? null : counted.minus(new Decimal(i.current));
      return { ...i, raw, counted, delta };
    });
  }, [counts, items]);

  const changedCount = rows.filter((r) => r.delta !== null && !r.delta.eq(0)).length;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    for (const r of rows) {
      if (r.raw !== "" && r.counted === null) {
        return toast.error(`Counted quantity for ${r.name} is not a number.`);
      }
      if (r.counted?.lt(0)) {
        return toast.error(`Counted quantity for ${r.name} cannot be negative.`);
      }
    }
    const payload = rows
      .filter((r) => r.delta !== null && !r.delta.eq(0))
      .map((r) => ({ itemId: r.id, countedQty: r.raw }));
    if (payload.length === 0) {
      return toast.error("Nothing to post — no counted quantity differs from on-hand.");
    }
    startTransition(async () => {
      try {
        const r = await onSubmit({ lines: payload, notes: notes.trim() || null });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(`${r.changes.length} item${r.changes.length === 1 ? "" : "s"} updated.`);
        setCounts({});
        setNotes("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <table className="w-full text-[12.5px]">
        <thead className="border-b border-ik-rule text-left text-ik-ink-3">
          <tr>
            <th className="py-1 pr-2">Item</th>
            <th className="py-1 pr-2">Category</th>
            <th className="w-16">Unit</th>
            <th className="w-24 py-1 pr-2 text-right">On hand</th>
            <th className="w-32 py-1 pr-2 text-right">Counted</th>
            <th className="w-24 py-1 pr-2 text-right">Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const changed = r.delta !== null && !r.delta.eq(0);
            return (
              <tr key={r.id} className={"border-b border-ik-rule " + (changed ? "bg-amber-wash" : "")}>
                <td className="py-1 pr-2">{r.name}</td>
                <td className="py-1 pr-2 text-ik-ink-3">{r.category ?? "—"}</td>
                <td className="py-1 pr-2">{r.unit}</td>
                <td className="py-1 pr-2 text-right font-mono">{r.current}</td>
                <td className="py-1 pr-2">
                  <input
                    type="number" step="any" min="0"
                    placeholder="skip"
                    value={counts[r.id] ?? ""}
                    onChange={(e) => setCounts((p) => ({ ...p, [r.id]: e.target.value }))}
                    className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                  />
                </td>
                <td
                  className={
                    "py-1 pr-2 text-right font-mono " +
                    (r.delta === null ? "text-ik-ink-3" : r.delta.gt(0) ? "text-positive" : r.delta.lt(0) ? "text-alert" : "")
                  }
                >
                  {r.delta === null ? "—" : r.delta.toString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="grid gap-1 max-w-2xl">
        <Label htmlFor="notes">Notes (optional — kept with the posting)</Label>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Posting…" : changedCount > 0 ? `Post count (${changedCount} changed)` : "Post count"}
        </Button>
      </div>
    </form>
  );
}
