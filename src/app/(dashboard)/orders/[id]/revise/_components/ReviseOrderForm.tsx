"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface Line {
  id: string;
  dishName: string;
  unit: string;
  portions: string;
  unitPrice: string;
  discountPct: string;
  gstRatePct: string;
}

interface Props {
  orderId: string;
  currentHeadcount: number;
  /** IST "yyyy-MM-ddTHH:mm" backing the datetime-local input. */
  currentEventDate: string;
  /** Package-priced channel (banquet / buffet / ODC / packet) — contract
   *  value is the lump-sum package total, not the line sum. */
  packageChannel: boolean;
  currentContractValue: string;
  lines: Line[];
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
  packageChannel,
  currentContractValue,
  lines,
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
  const [note, setNote] = useState("");

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
    return sum.toDecimalPlaces(2);
  }, [packageChannel, packageTotal, lines, portions]);

  const removedCount = lines.filter((l) => Number(portions[l.id] ?? "0") === 0).length;

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
    if (items.every((it) => it.portions === 0)) {
      return toast.error("At least one dish must keep portions — cancel the order instead of zeroing everything");
    }
    if (dateChanged && !eventDate) return toast.error("Pick the new event date & time");
    if (!note.trim()) return toast.error("A revision note is required — say why the quantities changed");
    if (packageChannel && (!packageTotal.trim() || Number.isNaN(Number(packageTotal)))) {
      return toast.error("Enter the revised package total");
    }
    startTransition(async () => {
      try {
        const res = await onSubmit({
          headcount: pax,
          items,
          ...(packageChannel ? { packageTotal: packageTotal.trim() } : {}),
          ...(dateChanged ? { eventDate } : {}),
          revisionNote: note.trim(),
        });
        if (res && res.ok === false) {
          toast.error(res.error);
          return;
        }
        toast.success("Order revised — the kitchen has been notified");
        router.push(`/orders/${orderId}`);
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-4">
      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
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

      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
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

      {packageChannel && (
        <section className="rounded-md border border-ik-rule bg-ik-card p-4">
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

      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
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

      <section className="rounded-md border border-ik-rule bg-ik-card p-4">
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
    </form>
  );
}
