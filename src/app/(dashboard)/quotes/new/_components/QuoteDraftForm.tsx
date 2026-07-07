"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { MealType } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import { QuickAddCustomer, type QuickCustomerInput } from "@/components/ik/QuickAddCustomer";
import type { QuoteCreateInputT } from "@/lib/validators";
import type { ActionResultWith } from "@/lib/action-result";

interface CustomerOption {
  id: string;
  name: string;
  stateCode: string;
}
interface DishOption {
  id: string;
  name: string;
  code: string | null;
  unit: string;
  unitPrice: string;
  gstRatePct: string;
  hsnSac: string | null;
}

interface DraftLine {
  dishId: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  gstRatePct: string;
  hsnSac: string;
}

interface Props {
  customers: CustomerOption[];
  dishes: DishOption[];
  onSubmit: (input: QuoteCreateInputT) => Promise<ActionResultWith<{ id: string; quoteNo: string }>>;
  /** Optional inline customer creator. When passed, the form shows a
   *  "+ Add new customer" toggle under the customer dropdown. */
  onQuickAddCustomer?: (
    input: QuickCustomerInput,
  ) => Promise<ActionResultWith<{ id: string; name: string; stateCode: string }>>;
}

function emptyLine(): DraftLine {
  return {
    dishId: "",
    description: "",
    unit: "portion",
    quantity: "10",
    unitPrice: "0",
    gstRatePct: "5",
    hsnSac: "",
  };
}

/**
 * Quote draft form. Header captures customer + event details (event date
 * + headcount + meal type are optional — a quote for a generic ask is
 * fine, you fill those in only when it's becoming concrete). Lines can
 * pick a dish to auto-fill, or be free-text for custom services.
 */
export function QuoteDraftForm({ customers, dishes, onSubmit, onQuickAddCustomer }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Local copy of customers so a quick-add can append to the dropdown
  // immediately without a router refresh.
  const [customerOptions, setCustomerOptions] = useState(customers);
  // ── Header
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [headcount, setHeadcount] = useState("");
  const [mealType, setMealType] = useState<MealType | "">("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");

  // ── Lines
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  const totals = useMemo(() => {
    let sub = new Decimal(0);
    let tax = new Decimal(0);
    for (const l of lines) {
      const q = new Decimal(l.quantity || "0");
      const u = new Decimal(l.unitPrice || "0");
      const g = new Decimal(l.gstRatePct || "0").div(100);
      const s = q.times(u);
      sub = sub.plus(s);
      tax = tax.plus(s.times(g));
    }
    return { sub: sub.toDecimalPlaces(2), tax: tax.toDecimalPlaces(2), grand: sub.plus(tax).toDecimalPlaces(2) };
  }, [lines]);

  function pickDish(idx: number, dishId: string) {
    const d = dishes.find((x) => x.id === dishId);
    setLines((prev) =>
      prev.map((line, i) =>
        i === idx
          ? {
              ...line,
              dishId,
              description: d?.name ?? line.description,
              unit: d?.unit ?? line.unit,
              unitPrice: d?.unitPrice ?? line.unitPrice,
              gstRatePct: d?.gstRatePct ?? line.gstRatePct,
              hsnSac: d?.hsnSac ?? "",
            }
          : line,
      ),
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId) return toast.error("Pick a customer");
    if (!title.trim()) return toast.error("Give the quote a title");
    const payloadLines = lines.filter(
      (l) => l.description.trim() && Number(l.quantity) > 0,
    );
    if (payloadLines.length === 0) return toast.error("Add at least one line");

    const customer = customerOptions.find((c) => c.id === customerId);
    if (!customer) return toast.error("Customer not found");

    startTransition(async () => {
      try {
        const r = await onSubmit({
          header: {
            customerId,
            title: title.trim(),
            eventDate: eventDate || undefined,
            headcount: headcount ? Number(headcount) : undefined,
            mealType: (mealType || undefined) as MealType | undefined,
            deliveryAddress: deliveryAddress || undefined,
            placeOfSupplyStateCode: customer.stateCode,
            validUntil: validUntil || undefined,
            notes: notes || null,
            termsMd: null,
          },
          lines: payloadLines.map((l) => ({
            dishId: l.dishId || null,
            description: l.description.trim(),
            unit: l.unit,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            gstRatePct: l.gstRatePct,
            hsnSac: l.hsnSac.trim() || null,
          })),
        });
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(`Quote ${r.quoteNo} created`);
        router.push(`/quotes/${r.id}`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <section className="grid gap-3 rounded-[14px] border border-ik-rule bg-ik-card p-4 max-w-4xl sm:p-5">
        <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Quote details</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="customerId">Customer<span className="text-gold" aria-hidden> *</span></Label>
            <select
              id="customerId"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {onQuickAddCustomer && (
              <QuickAddCustomer
                onCreate={onQuickAddCustomer}
                onCreated={(c) => {
                  setCustomerOptions((prev) => [c, ...prev]);
                  setCustomerId(c.id);
                }}
              />
            )}
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="e.g. Office lunch — 50 pax — 22 May"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="eventDate">Event date</Label>
            <Input id="eventDate" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="headcount">Headcount</Label>
            <Input id="headcount" type="number" min="1" value={headcount} onChange={(e) => setHeadcount(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="mealType">Meal type</Label>
            <select
              id="mealType"
              value={mealType}
              onChange={(e) => setMealType(e.target.value as MealType | "")}
              className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              <option value="">—</option>
              {(["BREAKFAST", "LUNCH", "DINNER", "HIGH_TEA", "CUSTOM"] as const).map((m) => (
                <option key={m} value={m}>{m.replace("_", " ")}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-1">
          <Label htmlFor="deliveryAddress">Delivery address</Label>
          <Input id="deliveryAddress" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="validUntil">Valid until</Label>
            <Input id="validUntil" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="rounded-[14px] border border-ik-rule bg-ik-card p-4 sm:p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="ik-accent-bar font-serif text-[15px] text-brand-700">Lines</h3>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>+ Add line</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead className="border-b border-ik-rule text-left text-ik-ink-3">
              <tr>
                <th className="py-1 pr-2">Dish</th>
                <th className="py-1 pr-2">Description</th>
                <th className="w-16 py-1 pr-2">Unit</th>
                <th className="w-20 py-1 pr-2 text-right">Qty</th>
                <th className="w-24 py-1 pr-2 text-right">Unit ₹</th>
                <th className="w-16 py-1 pr-2 text-right">GST %</th>
                <th className="w-28 py-1 pr-2 text-right">Total ₹</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => {
                const sub = new Decimal(l.quantity || "0").times(new Decimal(l.unitPrice || "0"));
                const tax = sub.times(new Decimal(l.gstRatePct || "0").div(100));
                return (
                  <tr key={idx} className="border-b border-ik-rule">
                    <td className="py-1 pr-2">
                      <select
                        value={l.dishId}
                        onChange={(e) => pickDish(idx, e.target.value)}
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1"
                      >
                        <option value="">— free text —</option>
                        {dishes.map((d) => (
                          <option key={d.id} value={d.id}>{d.code ? `${d.code} · ` : ""}{d.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        value={l.description}
                        onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))}
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        value={l.unit}
                        onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))}
                        className="h-8 w-14 rounded border border-ik-rule bg-ik-card px-1"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        step="any"
                        min="0.001"
                        value={l.quantity}
                        onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))}
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.unitPrice}
                        onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, unitPrice: e.target.value } : x)))}
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.gstRatePct}
                        onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, gstRatePct: e.target.value } : x)))}
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                      />
                    </td>
                    <td className="py-1 pr-2 text-right font-mono">{sub.plus(tax).toDecimalPlaces(2).toString()}</td>
                    <td>
                      <button
                        type="button"
                        className="text-alert"
                        onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="font-mono">
              <tr><td colSpan={6} className="py-1 pr-2 text-right text-ik-ink-3">Subtotal</td><td className="py-1 pr-2 text-right">{totals.sub.toString()}</td><td></td></tr>
              <tr><td colSpan={6} className="py-1 pr-2 text-right text-ik-ink-3">Tax</td><td className="py-1 pr-2 text-right">{totals.tax.toString()}</td><td></td></tr>
              <tr className="font-medium"><td colSpan={6} className="py-1 pr-2 text-right">Grand total</td><td className="py-1 pr-2 text-right">₹{totals.grand.toString()}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="grid gap-1 max-w-2xl">
        <Label htmlFor="notes">Notes / terms</Label>
        <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-ik-rule bg-ik-paper/90 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-ik-paper/75 md:-mx-6 md:px-6">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create draft quote"}</Button>
      </div>
    </form>
  );
}
