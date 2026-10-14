"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { StoreDepartment } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import {
  createDeptPurchaseOrder,
  submitDeptPurchaseOrder,
  updateDeptPurchaseOrder,
} from "@/server/actions/dept-purchase";
import { DEPT } from "./meta";

export interface PickItem {
  id: string;
  name: string;
  unit: string;
  currentStock: string;
}
interface Line {
  itemId: string;
  quantity: string;
  rate: string;
}
export interface PurchaseFormInitial {
  id: string;
  reason: string;
  supplierName: string;
  supplierPhone: string;
  expectedAt: string;
  notes: string;
  lines: Line[];
}

const FIELD = "h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]";
const CARD = "grid gap-3 rounded-2xl border border-ik-rule bg-ik-card p-4 shadow-ik-card";
const blank = (): Line => ({ itemId: "", quantity: "", rate: "" });

export function PurchaseForm({
  department,
  items,
  initial,
}: {
  department: StoreDepartment;
  items: PickItem[];
  initial?: PurchaseFormInitial;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? "");
  const [supplierPhone, setSupplierPhone] = useState(initial?.supplierPhone ?? "");
  const [expectedAt, setExpectedAt] = useState(initial?.expectedAt ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(initial?.lines.length ? initial.lines : [blank()]);
  const base = `${DEPT[department].base}/purchase`;

  const update = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function save(andSubmit: boolean) {
    const half = lines.findIndex((l) => (l.itemId || l.quantity.trim() || l.rate.trim()) && !(l.itemId && l.quantity.trim()));
    if (half >= 0) {
      toast.error(`Line ${half + 1} needs both an item and a quantity — fill it in or remove it`);
      return;
    }
    const clean = lines
      .filter((l) => l.itemId)
      .map((l) => ({ itemId: l.itemId, quantity: l.quantity.trim(), rate: l.rate.trim() || null }));
    if (clean.length === 0) {
      toast.error("Add at least one item");
      return;
    }
    const payload = { reason, supplierName, supplierPhone, expectedAt, notes, lines: clean };
    startTransition(async () => {
      try {
        const res = initial
          ? await updateDeptPurchaseOrder(initial.id, payload)
          : await createDeptPurchaseOrder({ ...payload, department });
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        if (andSubmit) {
          const sub = await submitDeptPurchaseOrder(res.id);
          if (!sub.ok) {
            toast.error(`Saved as a draft, but not submitted: ${sub.error}`);
            router.push(`${base}/${res.id}`);
            return;
          }
        }
        toast.success(andSubmit ? "Sent for approval" : "Draft saved");
        router.push(`${base}/${res.id}`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <div className="grid max-w-4xl gap-4">
      <section className={CARD}>
        <div className="grid gap-1.5">
          <Label htmlFor="reason">Why is the stock needed?</Label>
          <Input id="reason" maxLength={500} placeholder="e.g. Running low before the weekend" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="supplierName">Supplier (if known)</Label>
            <Input id="supplierName" maxLength={160} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="supplierPhone">Supplier phone</Label>
            <Input id="supplierPhone" maxLength={20} inputMode="tel" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="expectedAt">Needed by</Label>
            <input id="expectedAt" type="date" className={FIELD} value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-ik-ink-2">Items</div>
          <Button size="sm" variant="outline" disabled={lines.length >= 100} onClick={() => setLines((ls) => [...ls, blank()])}>
            + Add line
          </Button>
        </div>
        {lines.map((line, i) => {
          const it = items.find((x) => x.id === line.itemId);
          const taken = new Set(lines.filter((_, idx) => idx !== i).map((l) => l.itemId));
          return (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr,130px,130px,80px]">
              <div className="grid gap-1.5">
                <Label htmlFor={`item-${i}`}>Item</Label>
                <select id={`item-${i}`} className={FIELD} value={line.itemId} onChange={(e) => update(i, { itemId: e.target.value })}>
                  <option value="">— Pick an item —</option>
                  {items.map((x) => (
                    <option key={x.id} value={x.id} disabled={taken.has(x.id)}>
                      {x.name} ({x.unit}) · {x.currentStock} in stock
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`qty-${i}`}>Quantity {it ? `(${it.unit})` : ""}</Label>
                <Input id={`qty-${i}`} type="number" inputMode="decimal" min="0" step="any" value={line.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`rate-${i}`}>Est. rate (₹)</Label>
                <Input id={`rate-${i}`} type="number" inputMode="decimal" min="0" step="any" placeholder="optional" value={line.rate} onChange={(e) => update(i, { rate: e.target.value })} />
              </div>
              <div>
                {lines.length > 1 && (
                  <Button size="sm" variant="outline" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                    Remove
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save(true)} disabled={pending}>
          {pending ? "Saving…" : "Save & send for approval"}
        </Button>
        <Button variant="outline" onClick={() => save(false)} disabled={pending}>
          Save draft
        </Button>
        <Button variant="ghost" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
