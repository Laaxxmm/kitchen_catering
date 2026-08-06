"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import { createBanquetRequisition } from "@/server/actions/banquet";

interface Item { id: string; sku: string | null; name: string; unit: string; currentStock: string }
interface Event { id: string; code: string; customerName: string }
interface Line { itemId: string; qty: string }

/**
 * F&B service → banquet store item-line requisition. Pick banquet items +
 * quantities (optionally tied to an event) and raise the requisition; the
 * store keeper then fulfils it line by line. Mirrors the chef standalone
 * requisition form.
 */
export function RequestForm({
  items,
  events,
  lockedOrder = null,
}: {
  items: Item[];
  events: Event[];
  /** Set when the form was opened from an order's event-prep screen. */
  lockedOrder?: { id: string; code: string; customerName: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<Line[]>([{ itemId: "", qty: "" }]);
  const [orderId, setOrderId] = useState(lockedOrder?.id ?? "");
  const [notes, setNotes] = useState("");

  function addLine() { setLines((l) => [...l, { itemId: "", qty: "" }]); }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }
  function setLine(i: number, patch: Partial<Line>) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function submit() {
    const clean = lines.filter((l) => l.itemId && l.qty.trim() && Number(l.qty) > 0);
    if (clean.length === 0) return toast.error("Pick at least one item with a quantity");

    startTransition(async () => {
      try {
        const res = await createBanquetRequisition({
          orderId: orderId || null,
          notes: notes.trim() || null,
          lines: clean.map((l) => ({ itemId: l.itemId, requestedQty: l.qty.trim() })),
        });
        if (res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success(`Requisition ${res.requisitionNo} raised`);
        router.push(`/banquet/requisitions/${res.id}`);
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not raise the requisition");
      }
    });
  }

  return (
    <div className="grid max-w-2xl gap-4">
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
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
                    {/* Code first so the browser's type-ahead finds "GP-045". */}
                    {items.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.sku ? `${x.sku} · ` : ""}{x.name} (have {x.currentStock} {x.unit})
                      </option>
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
      </section>

      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="order">Event / order</Label>
          {lockedOrder ? (
            <div className="flex h-9 items-center rounded-md border border-ik-rule bg-ik-paper-alt px-2 text-[13px] text-ik-ink">
              <span className="font-mono">{lockedOrder.code}</span>
              <span className="ml-2 truncate text-ik-ink-2">{lockedOrder.customerName}</span>
            </div>
          ) : (
            <select
              id="order"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              <option value="">— No order —</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>{e.code} · {e.customerName}</option>
              ))}
            </select>
          )}
          {lockedOrder && (
            <span className="text-[11px] text-ik-ink-3">
              Linked to the event you came from — the store sees which event this is for.
            </span>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note">Note (optional)</Label>
          <Textarea id="note" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="When you need these, anything special, etc." />
        </div>
      </section>

      <div className="flex gap-2">
        <Button disabled={pending} onClick={submit}>{pending ? "Raising…" : "Raise requisition"}</Button>
        <Button variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </div>
  );
}
