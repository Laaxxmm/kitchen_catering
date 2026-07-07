"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OrderChannel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatIST } from "@/lib/time";
import { isNextNavigationError } from "@/lib/next-error";
import { recordBanquetIssue } from "@/server/actions/banquet";
import { markEventPrepReady } from "@/server/actions/deliveries";

interface Item { id: string; name: string; unit: string; currentStock: string }
interface Order {
  id: string; code: string; customerName: string; channel: OrderChannel;
  headcount: number; eventDate: string; deliveryAddress: string;
  prepReadyAt: string | null; prepReadyBy: string | null;
}
interface Line { itemId: string; quantity: string }

function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

/**
 * Cutlery/arrangements prep for an off-site event. Choose the banquet items
 * needed, issue what's in stock (linked to this order), request the rest from
 * the store, then mark the event prep ready.
 */
export function EventPrepForm({ order, items }: { order: Order; items: Item[] }) {
  const router = useRouter();
  const [issuing, startIssue] = useTransition();
  const [marking, startMark] = useTransition();
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: "" }]);

  function addLine() { setLines((l) => [...l, { itemId: "", quantity: "" }]); }
  function removeLine(i: number) { setLines((l) => l.filter((_, idx) => idx !== i)); }
  function setLine(i: number, patch: Partial<Line>) {
    setLines((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function issue() {
    const clean = lines.filter((l) => l.itemId && l.quantity.trim() && Number(l.quantity) > 0);
    if (clean.length === 0) return toast.error("Pick at least one item with a quantity");
    startIssue(async () => {
      try {
        const res = await recordBanquetIssue({
          issuedAt: nowLocal(),
          purpose: `Event cutlery — ${order.customerName} · ${order.code}`,
          orderId: order.id,
          notes: null,
          lines: clean.map((l) => ({ itemId: l.itemId, quantity: l.quantity.trim() })),
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Issued to the event — stock updated");
        setLines([{ itemId: "", quantity: "" }]);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not issue");
      }
    });
  }

  function markReady() {
    startMark(async () => {
      try {
        const res = await markEventPrepReady(order.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Marked ready — kitchen + management notified");
        router.push("/dashboard");
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not mark ready");
      }
    });
  }

  return (
    <div className="grid max-w-3xl gap-4">
      {/* Event summary */}
      <section className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="font-mono text-[12.5px] text-brand-700">{order.code}</span>
            <span className="ml-2 rounded-full bg-ik-paper-alt px-2 py-0.5 text-[10.5px] text-ik-ink-2 ring-1 ring-ik-rule">{order.channel}</span>
          </div>
          <span className="text-[12px] text-ik-ink-2">{formatIST(new Date(order.eventDate), "EEE d MMM · HH:mm")}</span>
        </div>
        <div className="mt-1 text-[13px] text-ik-ink"><strong>{order.customerName}</strong> · {order.headcount} pax</div>
        <div className="mt-0.5 text-[12.5px] text-ik-ink-2">{order.deliveryAddress}</div>
        {order.prepReadyAt && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-positive/10 px-2.5 py-1 text-[12px] font-medium text-positive">
            ✓ Already marked ready{order.prepReadyBy ? ` · ${order.prepReadyBy}` : ""}
          </div>
        )}
      </section>

      {/* Choose + issue cutlery */}
      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] font-medium text-ik-ink-2">Cutlery &amp; arrangements needed</div>
          <div className="flex items-center gap-2">
            <Link href="/banquet/request" className="text-[11.5px] text-brand hover:underline">Don&apos;t have it? Request from store</Link>
            <Button size="sm" variant="outline" onClick={addLine}>+ Add item</Button>
          </div>
        </div>
        <div className="grid gap-2">
          {lines.map((line, i) => {
            const it = items.find((x) => x.id === line.itemId);
            const overdraw = it && line.quantity.trim() !== "" && Number(line.quantity) > Number(it.currentStock);
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr,140px,80px]">
                <div className="grid gap-1.5">
                  <Label htmlFor={`item-${i}`}>Item</Label>
                  <select id={`item-${i}`} value={line.itemId} onChange={(e) => setLine(i, { itemId: e.target.value })} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]">
                    <option value="">— Pick item —</option>
                    {items.map((x) => <option key={x.id} value={x.id}>{x.name} (have {x.currentStock} {x.unit})</option>)}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`qty-${i}`}>Qty {it ? `(${it.unit})` : ""}</Label>
                  <Input id={`qty-${i}`} type="number" inputMode="decimal" value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} className={overdraw ? "border-alert" : ""} />
                  {overdraw && <span className="text-[10.5px] text-alert">More than in stock — issue what you have &amp; request the rest</span>}
                </div>
                <div>{lines.length > 1 && <Button size="sm" variant="outline" onClick={() => removeLine(i)}>Remove</Button>}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-3">
          <Button size="sm" variant="outline" disabled={issuing} onClick={issue}>{issuing ? "Issuing…" : "Issue to event"}</Button>
        </div>
      </section>

      {/* Final step */}
      <div className="flex flex-wrap gap-2">
        <Button disabled={marking} onClick={markReady}>
          {marking ? "Saving…" : order.prepReadyAt ? "Re-confirm ready" : "Mark cutlery & arrangements ready"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/dashboard")}>Back</Button>
      </div>
    </div>
  );
}
