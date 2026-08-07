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
import { BanquetReturnPanel, type BanquetLedgerRow } from "@/components/ik/BanquetReturnPanel";
import { BanquetItemPicker, type BanquetPickerItem } from "@/components/ik/BanquetItemPicker";

type Item = BanquetPickerItem & { currentStock: string };
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
 * the store, then mark the event prep ready — either with cutlery issued or
 * with an explicit "no cutlery required". After the event, record what came
 * back; the ledger shows what's still out with the client.
 */
export function EventPrepForm({ order, items, ledger }: { order: Order; items: Item[]; ledger: BanquetLedgerRow[] }) {
  const router = useRouter();
  const [issuing, startIssue] = useTransition();
  const [marking, startMark] = useTransition();
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: "" }]);
  const [noCutlery, setNoCutlery] = useState(false);

  const hasIssues = ledger.length > 0;

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
        setNoCutlery(false);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not issue");
      }
    });
  }

  function markReady() {
    if (!hasIssues && !noCutlery) {
      return toast.error(
        "Issue the cutlery/arrangements first, or tick “No cutlery required for this event”.",
      );
    }
    startMark(async () => {
      try {
        const res = await markEventPrepReady(order.id, { noCutleryRequired: noCutlery });
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
      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px]">
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

      {/* What's out with this client — every banquet item issued to the
          order, with the boxes to book the rest back in. */}
      <BanquetReturnPanel orderId={order.id} ledger={ledger} />

      {/* Choose + issue cutlery */}
      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] font-medium text-ik-ink-2">Cutlery &amp; arrangements needed</div>
          <div className="flex items-center gap-2">
            {/* Carry the order through so the requisition is linked to this
                event — it used to land on a blank form where the event was an
                optional dropdown people forgot, and the store then had no idea
                which event the request was for. */}
            <Link href={`/banquet/request?orderId=${order.id}`} className="text-[11.5px] text-brand hover:underline">Don&apos;t have it? Request from store</Link>
            <Button size="sm" variant="outline" onClick={addLine}>+ Add item</Button>
          </div>
        </div>
        <div className="grid gap-2">
          {lines.map((line, i) => {
            const it = items.find((x) => x.id === line.itemId);
            const overdraw = it && line.quantity.trim() !== "" && Number(line.quantity) > Number(it.currentStock);
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr),140px,80px]">
                <BanquetItemPicker
                  id={`item-${i}`}
                  items={items}
                  value={line.itemId}
                  onChange={(itemId) => setLine(i, { itemId })}
                />
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

      {/* Final step — issuing something OR an explicit "no cutlery" is mandatory */}
      {!hasIssues && (
        <label className="flex items-start gap-2 rounded-md border border-ik-rule bg-ik-card p-3 text-[13px]">
          <input
            type="checkbox"
            checked={noCutlery}
            onChange={(e) => setNoCutlery(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span>
            <span className="font-medium">No cutlery required for this event</span>
            <span className="block text-[11.5px] text-ik-ink-2">
              Logged on the order — use only when the client provides their own or the packing needs nothing from the store.
            </span>
          </span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={marking || (!hasIssues && !noCutlery)} onClick={markReady}>
          {marking ? "Saving…" : order.prepReadyAt ? "Re-confirm ready" : "Mark cutlery & arrangements ready"}
        </Button>
        <Button variant="outline" onClick={() => router.push("/dashboard")}>Back</Button>
      </div>
      {!hasIssues && !noCutlery && !order.prepReadyAt && (
        <p className="text-[11.5px] text-ik-ink-3">
          To mark ready: issue at least one item above, or tick &ldquo;No cutlery required&rdquo;.
        </p>
      )}
    </div>
  );
}
