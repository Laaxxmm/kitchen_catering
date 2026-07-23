"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordHousekeepingReceipt } from "@/server/actions/housekeeping";
import { isNextNavigationError } from "@/lib/next-error";

interface Item {
  id: string;
  name: string;
  unit: string;
}

interface Line {
  itemId: string;
  quantity: string;
  costPerUnit: string;
}

function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function ReceiptForm({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [receivedAt, setReceivedAt] = useState(nowLocal());
  const [sourceContact, setSourceContact] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { itemId: "", quantity: "", costPerUnit: "" },
  ]);

  function addLine() {
    setLines((l) => [...l, { itemId: "", quantity: "", costPerUnit: "" }]);
  }
  function removeLine(i: number) {
    setLines((l) => l.filter((_, idx) => idx !== i));
  }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function submit() {
    const cleanLines = lines
      .filter((l) => l.itemId && l.quantity.trim())
      .map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity.trim(),
        costPerUnit: l.costPerUnit.trim() || null,
      }));
    if (cleanLines.length === 0) {
      toast.error("Add at least one item line");
      return;
    }
    startTransition(async () => {
      try {
        const res = await recordHousekeepingReceipt({
          receivedAt,
          sourceContact: sourceContact.trim() || null,
          sourceNote: sourceNote.trim() || null,
          lines: cleanLines,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Receipt recorded");
        router.push("/housekeeping/receipts");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <div className="grid max-w-4xl gap-4">
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="receivedAt">Received at</Label>
            <input
              id="receivedAt"
              type="datetime-local"
              value={receivedAt}
              onChange={(e) => setReceivedAt(e.target.value)}
              className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sourceContact">From (person)</Label>
            <Input
              id="sourceContact"
              placeholder="e.g. Maintenance — Mr Kumar"
              value={sourceContact}
              onChange={(e) => setSourceContact(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sourceNote">Reference / note</Label>
            <Input
              id="sourceNote"
              placeholder="GRN, invoice ref, etc."
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-ik-ink-2">Items received</div>
          <Button size="sm" variant="outline" onClick={addLine}>
            + Add line
          </Button>
        </div>
        <div className="grid gap-2">
          {lines.map((line, i) => {
            const it = items.find((x) => x.id === line.itemId);
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr,140px,140px,80px]">
                <div className="grid gap-1.5">
                  <Label htmlFor={`item-${i}`}>Item</Label>
                  <select
                    id={`item-${i}`}
                    value={line.itemId}
                    onChange={(e) => updateLine(i, { itemId: e.target.value })}
                    className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
                  >
                    <option value="">— Pick an item —</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} ({it.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`qty-${i}`}>Quantity {it ? `(${it.unit})` : ""}</Label>
                  <Input
                    id={`qty-${i}`}
                    type="number"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`cost-${i}`}>Cost / unit (₹)</Label>
                  <Input
                    id={`cost-${i}`}
                    type="number"
                    inputMode="decimal"
                    placeholder="optional"
                    value={line.costPerUnit}
                    onChange={(e) => updateLine(i, { costPerUnit: e.target.value })}
                  />
                </div>
                <div>
                  {lines.length > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeLine(i)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save receipt"}
        </Button>
        <Button variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
