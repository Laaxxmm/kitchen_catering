"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Decimal } from "decimal.js";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ik/FormKit";
import { formatINR } from "@/lib/money";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";

interface BillItem { name: string; portions: string }
interface BillOrder {
  id: string;
  code: string;
  channel: string;
  room: string | null;
  table: string | null;
  customerId: string;
  customerName: string;
  istDate: string;
  dateLabel: string;
  total: string;
  items: BillItem[];
}

interface Folio {
  key: string;
  title: string;
  sub: string;
  orders: BillOrder[];
}

export function InHouseBilling({
  orders,
  todayIst,
  onGenerate,
}: {
  orders: BillOrder[];
  todayIst: string;
  onGenerate: (orderIds: string[]) => Promise<ActionResult | void>;
}) {
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(todayIst);
  // Orders the user has un-ticked (excluded from the bill). Default: all in.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const visible = useMemo(
    () => orders.filter((o) => !date || o.istDate === date),
    [orders, date],
  );

  // Group into folios: a room, else a table, else the customer.
  const folios: Folio[] = useMemo(() => {
    const map = new Map<string, Folio>();
    for (const o of visible) {
      const key = o.room
        ? `room:${o.room}:${o.customerId}`
        : o.table
          ? `table:${o.table}:${o.customerId}`
          : `cust:${o.customerId}`;
      const title = o.room ? `Room ${o.room}` : o.table ? `Table ${o.table}` : o.customerName;
      const g = map.get(key);
      if (g) g.orders.push(o);
      else map.set(key, { key, title, sub: o.customerName, orders: [o] });
    }
    return [...map.values()];
  }, [visible]);

  function toggle(id: string) {
    setExcluded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function generate(folio: Folio) {
    const ids = folio.orders.filter((o) => !excluded.has(o.id)).map((o) => o.id);
    if (ids.length === 0) {
      toast.error("Tick at least one order to bill");
      return;
    }
    setBusyKey(folio.key);
    startTransition(async () => {
      try {
        const res = await onGenerate(ids);
        if (res && !res.ok) {
          toast.error(res.error);
          return;
        }
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not generate the bill");
      } finally {
        setBusyKey(null);
      }
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="billdate" className="text-[12.5px] font-medium text-ik-ink-2">
          Date
        </label>
        <input
          id="billdate"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[13px]"
        />
        <button
          type="button"
          onClick={() => setDate("")}
          className={"text-[12px] hover:underline " + (date ? "text-brand-700" : "font-medium text-ik-ink")}
        >
          All dates
        </button>
        <span className="text-[12px] text-ik-ink-3">
          {visible.length} order{visible.length === 1 ? "" : "s"} to bill
        </span>
      </div>

      {folios.length === 0 ? (
        <EmptyState
          title="Nothing to bill"
          body="In-house orders appear here once they're cooked and marked “Served”. Take a room-service order, cook it, tap Served — then bill it here."
        />
      ) : (
        folios.map((f) => {
          const selected = f.orders.filter((o) => !excluded.has(o.id));
          const total = selected.reduce((s, o) => s.plus(new Decimal(o.total)), new Decimal(0));
          const busy = pending && busyKey === f.key;
          return (
            <section key={f.key} className="rounded-[14px] border border-ik-rule bg-ik-card p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="ik-accent-bar font-serif text-[16px] text-brand-700">{f.title}</h3>
                  <div className="text-[12px] text-ik-ink-3">{f.sub}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[18px] text-ik-ink">{formatINR(total)}</div>
                  <div className="text-[11px] text-ik-ink-3">
                    {selected.length} of {f.orders.length} order{f.orders.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <ul className="grid gap-2">
                {f.orders.map((o) => {
                  const on = !excluded.has(o.id);
                  return (
                    <li
                      key={o.id}
                      className={
                        "rounded-lg border border-ik-rule px-3 py-2 " +
                        (on ? "bg-ik-paper-alt" : "bg-ik-card opacity-60")
                      }
                    >
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(o.id)}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="font-mono text-[12px] text-ik-ink-2">
                              {o.code} · {o.dateLabel}
                            </span>
                            <span className="font-mono text-[13px] text-ik-ink">{formatINR(o.total)}</span>
                          </div>
                          <div className="mt-0.5 text-[11.5px] text-ik-ink-3">
                            {o.items.map((it) => `${it.name} ×${it.portions}`).join(", ") || "—"}
                          </div>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-3 flex justify-end">
                <Button type="button" disabled={busy || selected.length === 0} onClick={() => generate(f)}>
                  {busy ? "Billing…" : `Generate bill · ${formatINR(total)}`}
                </Button>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
