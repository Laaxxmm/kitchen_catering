"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { MealType, type OrderStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/ik/Notice";
import { QuickAddDish, type QuickDishInput } from "@/components/ik/QuickAddDish";
import { isNextNavigationError } from "@/lib/next-error";
import { computeRevisionBand } from "@/lib/order-revision";
import { STATUS_LABEL } from "@/lib/order-status";
import type { ActionResult, ActionResultWith } from "@/lib/action-result";
import { CriticalReviseDialog } from "./CriticalReviseDialog";
import { criticalReasons } from "./critical-reasons";

interface Line {
  id: string;
  dishName: string;
  unit: string;
  portions: string;
  unitPrice: string;
  discountPct: string;
  gstRatePct: string;
}

interface DishOption {
  id: string;
  name: string;
  unit: string;
  unitPrice: string;
  gstRatePct: string;
}

const MEAL_LABEL: Record<MealType, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
  HIGH_TEA: "High tea",
  SNACKS: "Snacks",
  CUSTOM: "Custom",
};

interface Props {
  orderId: string;
  currentHeadcount: number;
  /** IST "yyyy-MM-ddTHH:mm" backing the datetime-local input. */
  currentEventDate: string;
  /** The same event as an unambiguous instant — the datetime-local string is
   *  IST wall time, which can't be banded against the browser's clock. */
  currentEventDateISO: string;
  /** Where the order stands now. Banded together with the event date to
   *  decide whether this revision needs a confirmation. */
  orderStatus: OrderStatus;
  currentMealType: MealType;
  /** Package-priced channel (banquet / buffet / ODC / packet) — contract
   *  value is the lump-sum package total, not the line sum. */
  packageChannel: boolean;
  currentContractValue: string;
  lines: Line[];
  /** Dishes from the order's channel menu, for the "Add dish" picker.
   *  Prices shown are indicative — the server re-prices from the catalogue. */
  dishes: DishOption[];
  /** Inline dish creator — counter sales often sell ad-hoc items, so the
   *  manager can add a brand-new dish without leaving the revision. */
  onQuickAddDish?: (input: QuickDishInput) => Promise<ActionResultWith<{ id: string }>>;
  onSubmit: (raw: unknown) => Promise<ActionResult>;
}

/** Mirror of the server's computeLine so the preview matches what will be
 *  stored: subtotal = p·u·(1−d), tax = subtotal·g, total rounded to 2dp. */
function lineTotal(portions: number, unitPrice: string, discountPct: string, gstRatePct: string): Decimal {
  const p = new Decimal(portions);
  const u = new Decimal(unitPrice || "0");
  const d = new Decimal(discountPct || "0").div(100);
  const g = new Decimal(gstRatePct || "0").div(100);
  const subtotal = p.times(u).times(new Decimal(1).minus(d));
  return subtotal.plus(subtotal.times(g)).toDecimalPlaces(2);
}

export function ReviseOrderForm({
  orderId,
  currentHeadcount,
  currentEventDate,
  currentEventDateISO,
  orderStatus,
  currentMealType,
  packageChannel,
  currentContractValue,
  lines,
  dishes,
  onQuickAddDish,
  onSubmit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [headcount, setHeadcount] = useState(String(currentHeadcount));
  const [portions, setPortions] = useState<Record<string, string>>(
    () => Object.fromEntries(lines.map((l) => [l.id, l.portions])),
  );
  const [packageTotal, setPackageTotal] = useState(currentContractValue);
  const [eventDate, setEventDate] = useState(currentEventDate);
  const dateChanged = eventDate !== currentEventDate;
  const [mealType, setMealType] = useState<MealType>(currentMealType);
  const [note, setNote] = useState("");
  // NEW dishes to add: { dishId, portions } rows. Priced server-side; the
  // preview uses the same catalogue price the server will read.
  const [added, setAdded] = useState<Array<{ dishId: string; portions: string }>>([]);
  const [pickDishId, setPickDishId] = useState("");
  // Local copy so a quick-added dish shows up immediately.
  const [dishList, setDishList] = useState<DishOption[]>(dishes);
  const dishById = useMemo(() => new Map(dishList.map((d) => [d.id, d])), [dishList]);
  // The payload waiting on a "yes, anyway" — set only when the band came back
  // CRITICAL, cleared when the manager backs out or the save lands.
  const [confirming, setConfirming] = useState<
    { payload: Record<string, unknown>; reasons: string[]; changes: string[] } | null
  >(null);
  // `now` is captured on the CLIENT after mount and passed explicitly into
  // computeRevisionBand. The server has no business rendering a countdown:
  // a `now` taken during SSR is already stale by the time it hydrates, and
  // the two renders would disagree. Null until mounted = no banner server-side.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  // Band the order AS IT STANDS — the event it's currently booked for and the
  // status it's currently in — because that's exactly what reviseOrder bands
  // server-side. Banding the *edited* date would ask for a confirmation the
  // server doesn't want, or skip one it does.
  const orderEventDate = useMemo(() => new Date(currentEventDateISO), [currentEventDateISO]);
  const band = now ? computeRevisionBand({ eventDate: orderEventDate, status: orderStatus, now }) : null;
  const hoursToEvent = now
    ? Math.round((orderEventDate.getTime() - now.getTime()) / 3_600_000)
    : 0;

  // Current vs new contract value. Package channels carry the typed lump
  // sum; per-dish channels re-sum the lines exactly like the server will.
  const newContractValue = useMemo(() => {
    if (packageChannel) {
      const v = packageTotal.trim();
      return v && !Number.isNaN(Number(v)) ? new Decimal(v).toDecimalPlaces(2) : null;
    }
    let sum = new Decimal(0);
    for (const l of lines) {
      const p = Math.trunc(Number(portions[l.id] ?? "0")) || 0;
      if (p <= 0) continue;
      sum = sum.plus(lineTotal(p, l.unitPrice, l.discountPct, l.gstRatePct));
    }
    for (const a of added) {
      const d = dishById.get(a.dishId);
      const p = Math.trunc(Number(a.portions)) || 0;
      if (!d || p <= 0) continue;
      sum = sum.plus(lineTotal(p, d.unitPrice, "0", d.gstRatePct));
    }
    return sum.toDecimalPlaces(2);
  }, [packageChannel, packageTotal, lines, portions, added, dishById]);

  const removedCount = lines.filter((l) => Number(portions[l.id] ?? "0") === 0).length;

  /** What the manager is about to change, in the order they'd say it out loud. */
  function summarise(
    pax: number,
    items: Array<{ id: string; portions: number }>,
    addDishes: Array<{ dishId: string; portions: number }>,
  ): string[] {
    const out: string[] = [];
    if (pax !== currentHeadcount) out.push(`Headcount: ${currentHeadcount} → ${pax} pax`);
    for (const l of lines) {
      const to = items.find((it) => it.id === l.id)?.portions;
      if (to === undefined || to === Number(l.portions)) continue;
      out.push(to === 0 ? `Remove ${l.dishName}` : `${l.dishName}: ${l.portions} → ${to} portions`);
    }
    for (const a of addDishes) {
      out.push(`Add ${dishById.get(a.dishId)?.name ?? "dish"} · ${a.portions} portions`);
    }
    if (dateChanged) out.push(`Event moved to ${eventDate.replace("T", " ")}`);
    if (mealType !== currentMealType) {
      out.push(`Meal: ${MEAL_LABEL[currentMealType]} → ${MEAL_LABEL[mealType]}`);
    }
    return out;
  }

  function send(payload: Record<string, unknown>, criticalConfirmed: boolean) {
    startTransition(async () => {
      try {
        const res = await onSubmit(criticalConfirmed ? { ...payload, criticalConfirmed: true } : payload);
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
        setConfirming(null);
        toast.success("Order revised — the kitchen has been notified");
        router.push(`/orders/${orderId}`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const pax = Number(headcount);
    if (!Number.isInteger(pax) || pax < 1) return toast.error("Headcount must be a whole number of at least 1");
    const items: Array<{ id: string; portions: number }> = [];
    for (const l of lines) {
      const p = Number(portions[l.id] ?? "");
      if (!Number.isInteger(p) || p < 0) {
        return toast.error(`Portions for “${l.dishName}” must be a whole number (0 removes the line)`);
      }
      items.push({ id: l.id, portions: p });
    }
    const addDishes: Array<{ dishId: string; portions: number }> = [];
    for (const a of added) {
      const p = Number(a.portions);
      const d = dishById.get(a.dishId);
      if (!Number.isInteger(p) || p < 1) {
        return toast.error(`Portions for the added “${d?.name ?? "dish"}” must be a whole number of at least 1`);
      }
      addDishes.push({ dishId: a.dishId, portions: p });
    }
    if (items.every((it) => it.portions === 0) && addDishes.length === 0) {
      return toast.error("At least one dish must keep portions — cancel the order instead of zeroing everything");
    }
    if (dateChanged && !eventDate) return toast.error("Pick the new event date & time");
    if (!note.trim()) return toast.error("A revision note is required — say why the quantities changed");
    if (packageChannel && (!packageTotal.trim() || Number.isNaN(Number(packageTotal)))) {
      return toast.error("Enter the revised package total");
    }
    const payload = {
      headcount: pax,
      items,
      ...(packageChannel ? { packageTotal: packageTotal.trim() } : {}),
      ...(dateChanged ? { eventDate } : {}),
      ...(mealType !== currentMealType ? { mealType } : {}),
      ...(addDishes.length > 0 ? { addDishes } : {}),
      revisionNote: note.trim(),
    };
    // Re-banded here rather than reusing the render-time band: a form left
    // open for an hour would otherwise wave through a revision that has since
    // become critical.
    const nowAtSubmit = new Date();
    const bandAtSubmit = computeRevisionBand({
      eventDate: orderEventDate,
      status: orderStatus,
      now: nowAtSubmit,
    });
    if (bandAtSubmit === "CRITICAL") {
      setConfirming({
        payload,
        reasons: criticalReasons({ eventDate: orderEventDate, status: orderStatus, now: nowAtSubmit }),
        changes: summarise(pax, items, addDishes),
      });
      return;
    }
    send(payload, false);
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-4">
      {/* URGENT doesn't block — it just makes sure the manager knows what the
          change costs before they commit to it. CRITICAL gets the dialog. */}
      {band === "URGENT" && (
        <Notice tone="amber">
          {hoursToEvent < 24 ? (
            <>
              The event is in {hoursToEvent <= 1 ? "about an hour" : `${hoursToEvent} hours`} — the chef
              may already have started prep. Change only what really changed.
            </>
          ) : (
            <>
              The kitchen and store have already committed to this order (
              {STATUS_LABEL[orderStatus].toLowerCase()}) — a change now means someone redoes work.
            </>
          )}
        </Notice>
      )}

      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <h3 className="mb-2 text-[14px] font-medium text-ik-ink">Headcount</h3>
        <div className="flex items-center gap-3 text-[13px]">
          <span className="text-ik-ink-3">
            Current: <strong className="font-mono text-ik-ink">{currentHeadcount}</strong> pax
          </span>
          <span className="text-ik-ink-3">→</span>
          <input
            type="number"
            min={1}
            step={1}
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
            className="h-9 w-28 rounded border border-ik-rule bg-ik-card px-2 text-right font-mono"
            aria-label="New headcount"
          />
          <span className="text-ik-ink-3">pax</span>
        </div>
      </section>

      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <h3 className="mb-2 text-[14px] font-medium text-ik-ink">Meal</h3>
        <div className="flex items-center gap-3 text-[13px]">
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value as MealType)}
            className="h-9 rounded border border-ik-rule bg-ik-card px-2 text-[13px]"
            aria-label="Meal type"
          >
            {(Object.keys(MEAL_LABEL) as MealType[]).map((m) => (
              <option key={m} value={m}>{MEAL_LABEL[m]}</option>
            ))}
          </select>
          {mealType !== currentMealType && (
            <span className="rounded-full bg-amber-wash px-2 py-0.5 text-[11.5px] font-medium text-amber-700">
              was {MEAL_LABEL[currentMealType]}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <h3 className="mb-1 text-[14px] font-medium text-ik-ink">Portions per dish</h3>
        <p className="mb-2 text-[12px] text-ik-ink-3">
          Whole numbers only. Setting a dish to <strong>0</strong> removes it from the order.
        </p>
        <table className="w-full text-[12.5px]">
          <thead className="border-b border-ik-rule text-left text-ik-ink-3">
            <tr>
              <th className="py-1 pr-2">Dish</th>
              <th className="w-28 py-1 pr-2 text-right">Portions</th>
              <th className="w-24 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const zero = Number(portions[l.id] ?? "0") === 0;
              return (
                <tr key={l.id} className="border-b border-ik-rule">
                  <td className={"py-1.5 pr-2 " + (zero ? "text-ik-ink-3 line-through" : "text-ik-ink")}>
                    {l.dishName}
                    <span className="ml-1 text-[11px] text-ik-ink-3">
                      (was {l.portions} {l.unit})
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={portions[l.id] ?? ""}
                      onChange={(e) => setPortions((prev) => ({ ...prev, [l.id]: e.target.value }))}
                      className="h-8 w-full rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                      aria-label={`Portions for ${l.dishName}`}
                    />
                  </td>
                  <td className="py-1.5 text-[11px] text-alert">{zero ? "will be removed" : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {removedCount > 0 && (
          <p className="mt-2 text-[12px] text-alert">
            {removedCount} dish{removedCount === 1 ? "" : "es"} will be removed from the order.
          </p>
        )}
      </section>

      {(dishList.length > 0 || onQuickAddDish) && (
        <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
          <h3 className="mb-1 text-[14px] font-medium text-ik-ink">Add dishes</h3>
          <p className="mb-2 text-[12px] text-ik-ink-3">
            New dishes are priced at the menu&apos;s current rate when you save.
          </p>
          {added.length > 0 && (
            <ul className="mb-2 grid gap-1.5">
              {added.map((a, idx) => {
                const d = dishById.get(a.dishId);
                if (!d) return null;
                return (
                  <li key={`${a.dishId}-${idx}`} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <span className="text-ik-ink">{d.name}</span>
                    <span className="text-[11px] text-ik-ink-3">₹{d.unitPrice}/{d.unit}</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={a.portions}
                      onChange={(e) =>
                        setAdded((prev) => prev.map((x, i) => (i === idx ? { ...x, portions: e.target.value } : x)))
                      }
                      className="h-8 w-24 rounded border border-ik-rule bg-ik-card px-1 text-right font-mono"
                      aria-label={`Portions for ${d.name}`}
                    />
                    <button
                      type="button"
                      className="text-alert"
                      aria-label={`Remove ${d.name}`}
                      onClick={() => setAdded((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[240px]">
              <Combobox
                value={pickDishId}
                onChange={setPickDishId}
                options={dishList.map((d) => ({ value: d.id, label: `${d.name} · ₹${d.unitPrice}` }))}
                placeholder="Type to search a dish…"
                emptyText="No dish matches"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!pickDishId}
              onClick={() => {
                if (!pickDishId) return;
                setAdded((prev) => [...prev, { dishId: pickDishId, portions: headcount || "1" }]);
                setPickDishId("");
              }}
            >
              + Add dish
            </Button>
            {onQuickAddDish && (
              <QuickAddDish
                onCreate={onQuickAddDish}
                onCreated={(d) => {
                  setDishList((prev) => [{ id: d.id, name: d.name, unit: "plate", unitPrice: d.unitPrice, gstRatePct: d.gstRatePct }, ...prev]);
                  setAdded((prev) => [...prev, { dishId: d.id, portions: headcount || "1" }]);
                }}
              />
            )}
          </div>
        </section>
      )}

      {packageChannel && (
        <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
          <h3 className="mb-2 text-[14px] font-medium text-ik-ink">Package total</h3>
          <p className="mb-2 text-[12px] text-ik-ink-3">
            This channel is priced as one lump-sum package — enter the renegotiated total for the new
            headcount.
          </p>
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-ik-ink-3">₹</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={packageTotal}
              onChange={(e) => setPackageTotal(e.target.value)}
              className="h-9 w-40 rounded border border-ik-rule bg-ik-card px-2 text-right font-mono"
              aria-label="Revised package total"
            />
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <h3 className="mb-2 text-[14px] font-medium text-ik-ink">Event date &amp; time</h3>
        <p className="mb-2 text-[12px] text-ik-ink-3">
          Change only if the client rescheduled — the kitchen and F&amp;B replan around this.
        </p>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <input
            type="datetime-local"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="h-9 rounded border border-ik-rule bg-ik-card px-2 font-mono"
            aria-label="Event date and time"
          />
          {dateChanged && (
            <span className="rounded-full bg-amber-wash px-2 py-0.5 text-[11.5px] font-medium text-amber-700">
              rescheduled
            </span>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <h3 className="mb-2 text-[14px] font-medium text-ik-ink">Revision note (required)</h3>
        <Textarea
          rows={2}
          placeholder="e.g. Client reduced the guest list from 50 to 30"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </section>

      <section className="rounded-md border border-brand-200 bg-brand-50 p-4 text-[13px]">
        <h3 className="mb-1 text-[14px] font-medium text-brand-700">Contract value</h3>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 font-mono">
          <span>
            <span className="text-ik-ink-3">Current </span>₹{currentContractValue}
          </span>
          <span>
            <span className="text-ik-ink-3">After revision </span>
            {newContractValue ? `₹${newContractValue.toString()}` : "—"}
          </span>
        </div>
      </section>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save revision"}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => router.push(`/orders/${orderId}`)}>
          Cancel
        </Button>
      </div>

      <CriticalReviseDialog
        open={confirming !== null}
        reasons={confirming?.reasons ?? []}
        changes={confirming?.changes ?? []}
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && send(confirming.payload, true)}
      />
    </form>
  );
}
