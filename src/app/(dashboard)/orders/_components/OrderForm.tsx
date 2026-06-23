"use client";
// TODO refactor: 319 lines — over 250-line component hard cap. Split the line-items table into a child component (OrderLinesEditor) when Phase 1 second-half adds "Clone & Edit" and edit-DRAFT flows.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MealType, OrderChannel } from "@prisma/client";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import type { OrderCreateInputT, OrderItemInputT } from "@/lib/validators";
import { isNextNavigationError } from "@/lib/next-error";
import { QuickAddCustomer, type QuickCustomerInput } from "@/components/ik/QuickAddCustomer";

interface CustomerOption { id: string; name: string; stateCode: string }
interface DishOption {
  id: string;
  name: string;
  code: string | null;
  unitPrice: string;
  gstRatePct: string;
  menu: "BANQUET" | "SERVICE" | "BOTH";
  category: string | null;
}

/** Which dish menu a channel draws from. */
function menuForChannel(channel: OrderChannel): "BANQUET" | "SERVICE" {
  switch (channel) {
    case OrderChannel.ROOM_SERVICE:
    case OrderChannel.ALACARTE:
    case OrderChannel.MANAGEMENT:
      return "SERVICE";
    default: // BANQUET, ODC, PACKET
      return "BANQUET";
  }
}

interface Props {
  customers: CustomerOption[];
  dishes: DishOption[];
  defaults?: Partial<OrderCreateInputT>;
  onSubmit: (input: OrderCreateInputT) => Promise<{ id: string; code: string }>;
  submitLabel?: string;
  redirectOnSuccess?: string;
  /** Optional inline customer creator — when present, shows a
   *  "+ Add new customer" toggle under the dropdown. */
  onQuickAddCustomer?: (input: QuickCustomerInput) => Promise<{ id: string; name: string; stateCode: string }>;
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

export function OrderForm({ customers, dishes, defaults, onSubmit, submitLabel = "Create draft", redirectOnSuccess, onQuickAddCustomer }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Local copy of customers so a quick-add can append immediately
  // without a router refresh.
  const [customerOptions, setCustomerOptions] = useState(customers);
  const [customerId, setCustomerId] = useState(defaults?.customerId ?? customers[0]?.id ?? "");
  const [channel, setChannel] = useState<OrderChannel>(
    (defaults?.channel as OrderChannel) ?? OrderChannel.BANQUET,
  );
  const [roomNumber, setRoomNumber] = useState(defaults?.roomNumber ?? "");
  const [tableNumber, setTableNumber] = useState(defaults?.tableNumber ?? "");
  // Lump-sum package price for ODC / PACKET bulk orders.
  const [packageTotal, setPackageTotal] = useState(
    defaults?.packageTotal != null ? String(defaults.packageTotal) : "",
  );
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

  // Dishes for the selected channel's menu (BANQUET vs SERVICE),
  // flattened into type-ahead options. Label includes the category so a
  // search like "biry" or "veg main" both match. Dishes marked "BOTH"
  // appear in either menu.
  const dishOptions: ComboOption[] = useMemo(() => {
    const wantMenu = menuForChannel(channel);
    return dishes
      .filter((d) => d.menu === wantMenu || d.menu === "BOTH")
      .sort((a, b) =>
        (a.category || "").localeCompare(b.category || "") ||
        a.name.localeCompare(b.name),
      )
      .map((d) => ({
        value: d.id,
        label: d.category ? `${d.name}  ·  ${d.category}` : d.name,
      }));
  }, [dishes, channel]);

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

    // Client-side validation that mirrors the server refinement —
    // friendlier inline message than the Zod default.
    if (
      (channel === OrderChannel.ROOM_SERVICE ||
        channel === OrderChannel.ALACARTE) &&
      !roomNumber.trim()
    ) {
      return toast.error("Room service and à la carte orders need a room number");
    }
    const isPackage =
      channel === OrderChannel.ODC || channel === OrderChannel.PACKET;
    if (isPackage && (!packageTotal.trim() || Number(packageTotal) <= 0)) {
      return toast.error("Enter the package total for this bulk order");
    }

    const payload: OrderCreateInputT = {
      customerId,
      channel,
      eventDate,
      headcount: Number(headcount),
      mealType,
      deliveryAddress,
      deliveryWindowStart: deliveryWindowStart || eventDate,
      deliveryWindowEnd: deliveryWindowEnd || eventDate,
      placeOfSupplyStateCode,
      roomNumber: roomNumber.trim() || null,
      tableNumber: tableNumber.trim() || null,
      packageTotal: isPackage ? packageTotal.trim() : null,
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
        if (isNextNavigationError(err)) throw err;
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
              {customerOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {onQuickAddCustomer && (
              <QuickAddCustomer
                onCreate={onQuickAddCustomer}
                onCreated={(c) => {
                  setCustomerOptions((prev) => [c, ...prev]);
                  setCustomerId(c.id);
                  setPlaceOfSupplyStateCode(c.stateCode);
                }}
              />
            )}
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

        {/* Channel — drives line rendering (ODC/PACKET hide rates),
            requires roomNumber for ROOM_SERVICE or tableNumber for
            ALACARTE. Defaults to BANQUET so the original corporate-
            catering flow keeps working untouched. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="grid gap-1">
            <Label htmlFor="channel">Channel</Label>
            <select
              id="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as OrderChannel)}
              className="h-9 w-full rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
            >
              <option value={OrderChannel.BANQUET}>Banquet (corporate catering)</option>
              <option value={OrderChannel.ODC}>ODC (outdoor catering)</option>
              <option value={OrderChannel.PACKET}>Packet food / take-away</option>
              <option value={OrderChannel.ROOM_SERVICE}>Room service</option>
              <option value={OrderChannel.ALACARTE}>À la carte (dine-in)</option>
              <option value={OrderChannel.MANAGEMENT}>Management (internal)</option>
            </select>
          </div>
          {(channel === OrderChannel.ROOM_SERVICE ||
            channel === OrderChannel.ALACARTE) && (
            <div className="grid gap-1">
              <Label htmlFor="roomNumber">
                Room number <span className="text-alert">*</span>
              </Label>
              <Input
                id="roomNumber"
                placeholder="e.g. 203"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
              />
            </div>
          )}
          {channel === OrderChannel.ALACARTE && (
            <div className="grid gap-1">
              <Label htmlFor="tableNumber">Table number (optional)</Label>
              <Input
                id="tableNumber"
                placeholder="e.g. T-7"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
              />
            </div>
          )}
          {(channel === OrderChannel.ODC || channel === OrderChannel.PACKET) && (
            <div className="grid gap-1">
              <Label htmlFor="packageTotal">Package total (₹)</Label>
              <Input
                id="packageTotal"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 25000"
                value={packageTotal}
                onChange={(e) => setPackageTotal(e.target.value)}
              />
              <p className="text-[11px] text-ik-ink-3">
                Bulk order — type the agreed lump-sum price. Dishes below
                are listed for the kitchen but their rates aren&apos;t used;
                this amount is the contract value.
              </p>
            </div>
          )}
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
                    <td className="py-1 pr-2 min-w-[220px]">
                      <Combobox
                        value={l.dishId}
                        onChange={(v) => onDishChange(idx, v)}
                        options={dishOptions}
                        placeholder="Type to search a dish…"
                        emptyText="No dish matches"
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                        type="number" step="1" min="1"
                        value={l.portions}
                        onChange={(e) => {
                          // Portions are whole units only — strip any
                          // decimals the user pastes / types.
                          const whole = e.target.value.replace(/[^\d]/g, "");
                          setLine(idx, { portions: whole });
                        }}
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
              {channel === OrderChannel.ODC || channel === OrderChannel.PACKET ? (
                // Bulk package — the lump-sum entered above is the contract
                // value; per-dish rates aren't summed.
                <tr className="font-medium">
                  <td colSpan={5} className="py-1 pr-2 text-right">
                    Package total
                  </td>
                  <td className="py-1 pr-2 text-right">
                    ₹{packageTotal ? Number(packageTotal).toFixed(2) : "0.00"}
                  </td>
                  <td></td>
                </tr>
              ) : (
                <>
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
                </>
              )}
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
