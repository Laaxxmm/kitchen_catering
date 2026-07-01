"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { OrderStatus } from "@prisma/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";
import { formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";

export interface CustomerOrderRow {
  id: string;
  code: string;
  eventDate: string;
  mealType: string;
  headcount: number;
  contractValue: string;
  status: OrderStatus;
}

type Group = "all" | "open" | "done" | "cancelled";

function groupOf(s: OrderStatus): Exclude<Group, "all"> {
  if (s === OrderStatus.PAID || s === OrderStatus.COMPLETED) return "done";
  if (s === OrderStatus.CANCELLED || s.startsWith("REJECTED")) return "cancelled";
  return "open";
}

const TONE: Record<Exclude<Group, "all">, PillTone> = { open: "amber", done: "green", cancelled: "grey" };

const FILTERS: { key: Group; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "done", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

/** A customer's whole order history with a status filter. */
export function CustomerOrders({ orders }: { orders: CustomerOrderRow[] }) {
  const [filter, setFilter] = useState<Group>("all");
  const rows = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => groupOf(o.status) === filter)),
    [orders, filter],
  );
  const counts = useMemo(() => {
    const c = { all: orders.length, open: 0, done: 0, cancelled: 0 } as Record<Group, number>;
    for (const o of orders) c[groupOf(o.status)] += 1;
    return c;
  }, [orders]);

  return (
    <section className="mt-8">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Order history · {orders.length}</h2>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={
                "rounded-full px-3 py-1 text-[12px] " +
                (filter === f.key ? "bg-brand-500 text-white" : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
              }
            >
              {f.label} <span className="font-mono text-[10.5px] opacity-70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-ik-rule bg-ik-card p-4 text-[13px] text-ik-ink-3">No orders in this filter.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Meal</TableHead>
              <TableHead className="text-right">Pax</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <Link href={`/orders/${o.id}`} className="font-mono text-[12px] text-brand hover:underline">{o.code}</Link>
                </TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(new Date(o.eventDate), "yyyy-MM-dd")}</TableCell>
                <TableCell className="text-[12.5px] text-ik-ink-2">{o.mealType}</TableCell>
                <TableCell className="text-right">{o.headcount}</TableCell>
                <TableCell className="text-right font-mono">{formatINRWhole(o.contractValue)}</TableCell>
                <TableCell><StatusPill tone={TONE[groupOf(o.status)]}>{o.status.replaceAll("_", " ").toLowerCase()}</StatusPill></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
