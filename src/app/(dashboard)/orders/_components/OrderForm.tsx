"use client";
// TODO refactor: 319 lines — over 250-line component hard cap. Split the line-items table into a child component (OrderLinesEditor) when Phase 1 second-half adds "Clone & Edit" and edit-DRAFT flows.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MealType } from "@prisma/client";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { OrderCreateInputT, OrderItemInputT } from "@/lib/validators";

interface CustomerOption { id: string; name: string; stateCode: string }
interface DishOption { id: string; name: string; code: string | null; unitPrice: string; gstRatePct: string }

interface Props {
  customers: CustomerOption[];
  dishes: DishOption[];
  defaults?: Partial<OrderCreateInputT>;
  onSubmit: (input: OrderCreateInputT) => Promise<{ id: string; code: string }>;
  submitLabel?: string;
  redirectOnSuccess?: string;
}

interface DraftLine {
  dishId: string;
  portions: string;
  unitPrice: string;
  discountPct: string;
  gstRatePct: string;
  notes: string;
}

function emptyLine(): DraftLine {
  return { dishId: "", portions: "1", unitPrice: "0", discountPct: "0", gstRatePct: "5", notes: "" };
}

export function OrderForm({ customers, dishes, defaults, onSubmit, submitLabel = "Create draft", redirectOnSuccess }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const [customerId, setCustomerId] = useState(defaults?.customerId ?? customers[0]?.id ?? "");
  const [eventDate, setEventDate] = useState(defaults?.eventDate ?? "");
  const [headcount, setHeadcount] = useState(String(defaults?.headcount ?? "10"));
  const [mealType, setMealType] = useState<MealType>((defaults?.mealType as MealType) ?? MealType.LUNCH);
  const [deliveryAddress, setDeliveryAddress] = useState(defaults?.deliveryAddress ?? "");
  const [deliveryWindowStart, setDeliveryWindowStart] = useState(defaults?.deliveryWindowStart ?? "");
  const [deliveryWindowEnd, setDeliveryWindowEnd] = useState(defaults?.deliveryWindowEnd ?? "");
  const [placeOfSupplyStateCode, setPlaceOfSupplyStateCode] = useState(defaults?.placeOfSupplyStateCode ?? "29");
  const [notes, setNotes] = useState(defaults?.notes ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() => {
    if (defaults?.items && defaults.items.length > 0) {
      return defaults.items.map((it) => ({
        dishId: it.dishId,
        portions: String(it.portions),
        unitPrice: String(it.unitPrice),
        discountPct: String(it.discountPct ?? "0"),
        gstRatePct: String(it.gstRatePct ?? "5"),
        notes: it.notes ?? "",
      }));
    }
    return [emptyLine()];
  });

  function setLine(idx: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() { setLines((prev) => [...prev, emptyLine()]); }
  function removeLine(idx: number) { setLines((prev) => prev.filter((_, i) => i !== idx)); }

  function onDishChange(idx: number, dishId: string) {
    const dish = dishes.find((d) => d.id === dishId);
    setLine(idx, {
      dishId,
      ...(dish ? { unitPrice: String(dish.unitPrice), gstRatePct: String(dish.gstRatePct) } : {}),
    });
  }

  const totals = useMemo(() => {
    let subtotal = new Decimal(0);
    let tax = new Decimal(0);
    for (const l of lines) {
      const p = new Decimal(l.portions || "0");
      const u = new Decimal(l.unitPrice || "0");
      const d = new Decimal(l.discountPct || "0").div(100);
      const g = new Decimal(l.gstRatePct || "0").div(100);
      const gross = p.times(u);
      const s = gross.times(new Decimal(1).minus(d));
      const t = s.times(g);
      subtotal = subtotal.plus(s);
      tax = tax.plus(t);
    }
    return {
      subtotal: subtotal.toDecimalPlaces(2),
      tax: tax.toDecimalPlaces(2),
      total: subtotal.plus(tax).toDecimalPlaces(2),
    };
  }, [lines]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) return toast.error("Choose a customer");
    if (!eventDate) return toast.error("Event date is required");
    if (!deliveryAddress.trim()) return toast.error("Delivery address is required");
    const items: OrderItemInputT[] = lines
      .filter((l) => l.dishId)
      .map((l) => ({
        dishId: l.dishId,
        portions: l.portions,
        unitPrice: l.unitPrice,
        discountPct: l.discountPct || "0",
        gstRatePct: l.gstRatePct || "0",
        notes: l.notes || null,
      }));
    if (items.length === 0) return toast.error("Add at least one dish line");

    const payload: OrderCreateInputT = {
      customerId,
      eventDate,
      headcount: Number(headcount),
      mealType,
      deliveryAddress,
      deliveryWindowStart: deliveryWindowStart || eventDate,
      deliveryWindowEnd: deliveryWindowEnd || eventDate,
      placeOfSupplyStateCode,
      notes: notes || null,
      items,
    };

    startTransition(async () => {
      try {
        const result = await onSubmit(payload);
        toast.success(`Saved ${result.code}`);
        if (redirectOnSuccess) router.push(redirectOnSuccess.replace(":id", result.id));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <section className="grid gap-4 rounded-md border border-ik-rule bg-ik-card p-4 max-w-3xl">
        <h3 className="font-medium text-[14px] text-ik-ink">Customer & event</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="customerId">Customer</Label>
            <select
              id="customerId"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="placeOfSupplyStateCode">Place of supply (state code)</Label>
            <Input
              id="placeOfSupplyStateCode"
              maxLength={2}
              value={placeOfSupplyStateCode}
              onChange={(e) => setPlaceOfSupplyStateCode(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="eventDate">Event date</Label>
            <Input id="eventDate" type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="headcount">Headcount</Label>
            <Input id="headcount" type="number" min="1" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mealType">Meal</Label>
            <select
              id="mealType"
              value={mealType}
              onChange={(e) => setMealType(e.target.value as MealType)}
              className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              {Object.values(MealType).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="deliveryAddress">Delivery address</Label>
          <Textarea id="deliveryAddress" rows={2} value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="dws">Delivery window — start</Label>
            <Input id="dws" type="datetime-local" value={deliveryWindowStart} onChange={(e) => setDeliveryWindowStart(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="dwe">Delivery window — end</Label>
            <Input id="dwe" type="datetime-local" value={deliveryWindowEnd} onChange={(e) => setDeliveryWindowEnd(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 rounded-md border border-ik-rule bg-ik-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-[14px] text-ik-ink">Dishes</h3>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Add line</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="border-b border-ik-rule text-left text-ik-ink-3">
              <tr>
                <th className="py-1 pr-2">Dish</th>
                <th className="w-20 py-1 pr-2 text-right">Portions</th>
                <th className="w-24 py-1 pr-2 text-right">Unit ₹</th>
                <th className="w-16 py-1 pr-2 text-right">Disc %</th>
                <th className="w-16 py-1 pr-2 text-right">GST %</th>
                <th className="w-32 py-1 pr-2 text-right">Total ₹</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const p = new Decimal(l.portions || "0");
                const u = new Decimal(l.unitPrice || "0");
                const d = new Decimal(l.discountPct || "0").div(100);
                const g = new Decimal(l.gstRatePct || "0").div(100);
                const s = p.times(u).times(new Decimal(1).minus(d));
                const t = s.times(g);
                const total = s.plus(t).toDecimalPlaces(2);
                return (
                  <tr key={idx} className="border-b border-ik-rule align-top">
                    <td className="py-1 pr-2">
                      <select
                        value={l.dishId}
                        onChange={(e) => onDishChange(idx, e.target.value)}
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1"
                      >
                        <option value="">— choose —</option>
                        {dishes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                        type="number" step="0.001" min="0"
                        value={l.portions}
                        onChange={(e) => setLine(idx, { portions: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                        type="number" step="0.01" min="0"
                        value={l.unitPrice}
                        onChange={(e) => setLine(idx, { unitPrice: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                        type="number" step="0.01" min="0"
                        value={l.discountPct}
                        onChange={(e) => setLine(idx, { discountPct: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                        type="number" step="0.01" min="0"
                        value={l.gstRatePct}
                        onChange={(e) => setLine(idx, { gstRatePct: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">{total.toString()}</td>
                    <td className="py-1 text-right">
                      <button type="button" onClick={() => removeLine(idx)} className="text-alert">×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-mono text-ik-ink">
              <tr>
                <td colSpan={5} className="py-1 pr-2 text-right text-ik-ink-3">Subtotal</td>
                <td className="py-1 pr-2 text-right">{totals.subtotal.toString()}</td>
                <td></td>
              </tr>
              <tr>
                <td colSpan={5} className="py-1 pr-2 text-right text-ik-ink-3">GST</td>
                <td className="py-1 pr-2 text-right">{totals.tax.toString()}</td>
                <td></td>
              </tr>
              <tr className="font-medium">
                <td colSpan={5} className="py-1 pr-2 text-right">Total</td>
                <td className="py-1 pr-2 text-right">₹{totals.total.toString()}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="grid gap-2 max-w-3xl">
        <Label htmlFor="notes">Internal notes</Label>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </section>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
