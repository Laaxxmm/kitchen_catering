"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OrderChannel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordBanquetIssue } from "@/server/actions/banquet";
import { BanquetItemPicker, type BanquetPickerItem } from "@/components/ik/BanquetItemPicker";
import { isNextNavigationError } from "@/lib/next-error";
import { formatIST } from "@/lib/time";

type Item = BanquetPickerItem & { currentStock: string };
interface EventOption {
  id: string;
  code: string;
  channel: OrderChannel;
  eventDate: string;
  customerName: string;
}
interface Line { itemId: string; quantity: string; }

function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function IssueForm({ items, events }: { items: Item[]; events: EventOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [issuedAt, setIssuedAt] = useState(nowLocal());
  // Either pick an event (links the order) or type a free-text purpose for
  // room service / housekeeping use.
  const [orderId, setOrderId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ itemId: "", quantity: "" }]);

  function pickEvent(id: string) {
    setOrderId(id);
    const ev = events.find((e) => e.id === id);
    // Auto-fill the purpose from the event so the record reads cleanly.
    setPurpose(ev ? `${ev.customerName} · ${ev.channel} · ${ev.code}` : "");
  }

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
        const res = await recordBanquetIssue({
          issuedAt,
          purpose: purpose.trim(),
          orderId: orderId.trim() || null,
          notes: notes.trim() || null,
          lines: cleanLines,
        });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
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
      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="issuedAt">Issued at</Label>
            <input id="issuedAt" type="datetime-local" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]" />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="event">Event</Label>
            <select
              id="event"
              value={orderId}
              onChange={(e) => pickEvent(e.target.value)}
              className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              <option value="">— General purpose (no event) —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.code} · {ev.customerName} · {ev.channel} · {formatIST(new Date(ev.eventDate), "d MMM")}
                </option>
              ))}
            </select>
            <p className="text-[10.5px] text-ik-ink-3">
              Pick the catering event so this consumption links to its order &amp; P&amp;L, or leave it general.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="purpose">Purpose</Label>
            <Input id="purpose" placeholder="e.g. Room 203 service, Banquet hall setup" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
            <p className="text-[10.5px] text-ik-ink-3">
              {orderId ? "Auto-filled from the event — edit if you like." : "Describe the use (auto-filled when you pick an event)."}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] font-medium text-ik-ink-2">Items issued</div>
          <div className="flex items-center gap-2">
            {/* Carry the picked event through, so the requisition reaches the
                store already linked to it. */}
            <Link
              href={orderId ? `/banquet/request?orderId=${orderId}` : "/banquet/request"}
              className="text-[11.5px] text-brand hover:underline"
            >
              Don&apos;t have it? Request from store
            </Link>
            <Button size="sm" variant="outline" onClick={addLine}>+ Add item</Button>
          </div>
        </div>
        <div className="grid gap-2">
          {lines.map((line, i) => {
            const it = items.find((x) => x.id === line.itemId);
            const overdraw = it && line.quantity.trim() !== "" && Number(line.quantity) > Number(it.currentStock);
            return (
              <div key={i} className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr),160px,80px]">
                <BanquetItemPicker
                  id={`item-${i}`}
                  items={items}
                  value={line.itemId}
                  onChange={(itemId) => updateLine(i, { itemId })}
                />
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
