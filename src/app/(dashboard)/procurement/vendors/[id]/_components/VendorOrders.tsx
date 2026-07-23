"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { VendorPOStatus } from "@prisma/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";
import { formatINRWhole } from "@/lib/money";
import { formatIST } from "@/lib/time";

export interface VendorPORow {
  id: string;
  poNo: string;
  issueDate: string;
  status: VendorPOStatus;
  grandTotal: string;
  orderCode: string | null;
}

type Group = "all" | "open" | "received" | "cancelled";

function groupOf(s: VendorPOStatus): Exclude<Group, "all"> {
  if (s === VendorPOStatus.RECEIVED || s === VendorPOStatus.CLOSED) return "received";
  if (s === VendorPOStatus.CANCELLED) return "cancelled";
  return "open";
}
const TONE: Record<Exclude<Group, "all">, PillTone> = { open: "amber", received: "green", cancelled: "grey" };
const FILTERS: { key: Group; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "received", label: "Received" },
  { key: "cancelled", label: "Cancelled" },
];

/** A vendor's purchase-order history with a status filter. */
export function VendorOrders({ pos }: { pos: VendorPORow[] }) {
  const [filter, setFilter] = useState<Group>("all");
  const rows = useMemo(
    () => (filter === "all" ? pos : pos.filter((p) => groupOf(p.status) === filter)),
    [pos, filter],
  );
  const counts = useMemo(() => {
    const c = { all: pos.length, open: 0, received: 0, cancelled: 0 } as Record<Group, number>;
    for (const p of pos) c[groupOf(p.status)] += 1;
    return c;
  }, [pos]);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Purchase orders raised to this vendor</h3>
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
        <p className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px] text-ik-ink-3">No purchase orders in this filter.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>For order</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/procurement/purchase-orders/${p.id}`} className="font-mono text-[12px] text-brand hover:underline">{p.poNo}</Link>
                </TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(new Date(p.issueDate), "yyyy-MM-dd")}</TableCell>
                <TableCell className="font-mono text-[12px] text-ik-ink-2">{p.orderCode ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{formatINRWhole(p.grandTotal)}</TableCell>
                <TableCell><StatusPill tone={TONE[groupOf(p.status)]}>{p.status.replaceAll("_", " ").toLowerCase()}</StatusPill></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
