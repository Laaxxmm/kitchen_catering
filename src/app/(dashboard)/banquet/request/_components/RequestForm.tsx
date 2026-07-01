"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import { requestGoodsFromStore } from "@/server/actions/banquet";

interface Item { id: string; name: string; unit: string; currentStock: string }
interface Line { itemId: string; qty: string }

/**
 * F&B Service → store keeper "please procure this" form. Pick banquet items +
 * quantities and a needed-by date; the store keeper gets it as a high-priority
 * task + notification and raises the PO.
 */
export function RequestForm({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "" }]);
  const [neededBy, setNeededBy] = useState("");
  const [note, setNote] = useState("");

  function addLine() { setLines((l) => [...l, { itemId: "", qty: "" }]); }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }
  function setLine(i: number, patch: Partial<Line>) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function submit() {
    const clean = lines.filter((l) => l.itemId && l.qty.trim() && Number(l.qty) > 0);
    if (clean.length === 0) return toast.error("Pick at least one item with a quantity");

    // Compose a clean, itemised summary for the store keeper's task.
    const summary = clean
      .map((l) => {
        const it = items.find((x) => x.id === l.itemId);
        return `${l.qty.trim()} ${it?.unit ?? ""} × ${it?.name ?? "item"}`.trim();
      })
      .join("; ");
    const noteParts = [neededBy ? `Needed by ${neededBy}` : null, note.trim() || null].filter(Boolean);

    startTransition(async () => {
      try {
        await requestGoodsFromStore({ summary, note: noteParts.join(" · ") || undefined });
        toast.success("Request sent to the store keeper");
        router.push("/banquet");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not send the request");
      }
    });
  }

  return (
    <div className="grid max-w-2xl gap-4">
      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-ik-ink-2">Items needed</div>
          <Button size="sm" variant="outline" onClick={addLine}>+ Add item</Button>
        </div>
        <div className="grid gap-2">
          {lines.map((line, i) => {
            const it = items.find((x) => x.id === line.itemId);
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr,140px,80px]">
                <div className="grid gap-1.5">
                  <Label htmlFor={`item-${i}`}>Item</Label>
                  <select
                    id={`item-${i}`}
                    value={line.itemId}
                    onChange={(e) => setLine(i, { itemId: e.target.value })}
                    className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
                  >
                    <option value="">— Pick item —</option>
                    {items.map((x) => (
                      <option key={x.id} value={x.id}>{x.name} (have {x.currentStock} {x.unit})</option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`qty-${i}`}>Qty {it ? `(${it.unit})` : ""}</Label>
                  <Input id={`qty-${i}`} type="number" inputMode="decimal" value={line.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                </div>
                <div>
                  {lines.length > 1 && <Button size="sm" variant="outline" onClick={() => removeLine(i)}>Remove</Button>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-ik-ink-3">
          Need something not in the catalogue? Add it in the note below.
        </p>
      </section>

      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="neededBy">Needed by</Label>
          <input id="neededBy" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note">Note (optional)</Label>
          <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Preferred supplier, anything not in the list, etc." />
        </div>
      </section>

      <div className="flex gap-2">
        <Button disabled={pending} onClick={submit}>{pending ? "Sending…" : "Send request to store"}</Button>
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </div>
  );
}
