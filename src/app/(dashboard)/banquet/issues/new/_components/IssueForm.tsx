"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordBanquetIssue } from "@/server/actions/banquet";
import { isNextNavigationError } from "@/lib/next-error";

interface Item {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  currentStock: string;
}
interface Line { itemId: string; quantity: string; }

function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function IssueForm({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [issuedAt, setIssuedAt] = useState(nowLocal());
  const [purpose, setPurpose] = useState("");
  const [orderId, setOrderId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: "" }]);

  function addLine() { setLines((l) => [...l, { itemId: "", quantity: "" }]); }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }
  function updateLine(i: number, patch: Partial<Line>) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function submit() {
    if (purpose.trim().length < 2) { toast.error("Describe the purpose"); return; }
    const cleanLines = lines
      .filter((l) => l.itemId && l.quantity.trim())
      .map((l) => ({ itemId: l.itemId, quantity: l.quantity.trim() }));
    if (cleanLines.length === 0) { toast.error("Add at least one item"); return; }

    startTransition(async () => {
      try {
        await recordBanquetIssue({
          issuedAt,
          purpose: purpose.trim(),
          orderId: orderId.trim() || null,
          notes: notes.trim() || null,
          lines: cleanLines,
        });
        toast.success("Issue recorded — stock updated");
        router.push("/banquet/issues");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <div className="grid max-w-4xl gap-4">
      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="issuedAt">Issued at</Label>
            <input id="issuedAt" type="datetime-local" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="purpose">Purpose</Label>
            <Input id="purpose" placeholder="e.g. Wipro lunch ODC, Room 203 service, Banquet hall setup" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="orderId">Order ID (optional)</Label>
            <Input id="orderId" placeholder="paste internal order ID if linked" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
            <p className="text-[10.5px] text-ik-ink-3">
              Link a catering order so this consumption shows in its P&L.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-ik-ink-2">Items issued</div>
          <Button size="sm" variant="outline" onClick={addLine}>+ Add item</Button>
        </div>
        <div className="grid gap-2">
          {lines.map((line, i) => {
            const it = items.find((x) => x.id === line.itemId);
            const overdraw = it && line.quantity.trim() !== "" && Number(line.quantity) > Number(it.currentStock);
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr,160px,80px]">
                <div className="grid gap-1.5">
                  <Label htmlFor={`item-${i}`}>Item</Label>
                  <select id={`item-${i}`} value={line.itemId} onChange={(e) => updateLine(i, { itemId: e.target.value })} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
                    <option value="">— Pick item —</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} (have {it.currentStock} {it.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`qty-${i}`}>Qty {it ? `(${it.unit})` : ""}</Label>
                  <Input
                    id={`qty-${i}`}
                    type="number"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    className={overdraw ? "border-alert" : ""}
                  />
                  {overdraw && <span className="text-[10.5px] text-alert">Exceeds available</span>}
                </div>
                <div>
                  {lines.length > 1 && <Button size="sm" variant="outline" onClick={() => removeLine(i)}>Remove</Button>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>{pending ? "Saving…" : "Save issue"}</Button>
        <Button variant="outline" onClick={() => router.back()} disabled={pending}>Cancel</Button>
      </div>
    </div>
  );
}
