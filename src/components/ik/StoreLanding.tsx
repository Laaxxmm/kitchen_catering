import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill } from "@/components/ik/StatusPill";

export interface StoreTab {
  label: string;
  href: string;
  active?: boolean;
}

export interface StoreStock {
  out: number;
  low: number;
  inStock: number;
  noThreshold: number;
  received: number;
  issued: number;
  needsReorder: Array<{ id: string; name: string; unit: string; currentStock: string; minStock: string | null; out: boolean }>;
}

/**
 * Shared status-first landing for the non-kitchen stores (Housekeeping,
 * Maintenance, Banquet). Mirrors the Kitchen-stock redesign: Out/Low/In
 * summary strip, low items led first (or a calm all-stocked line), a
 * "set reorder levels" nudge, and a clean tab row. These stores restock via
 * receipts (no PR flow), so the primary restock action stays in the header.
 */
export function StoreLanding({
  title,
  description,
  primary,
  tabs,
  stock,
  itemsHref,
  issuedLabel = "Issued",
}: {
  title: string;
  description: string;
  primary: ReactNode;
  tabs: StoreTab[];
  stock: StoreStock;
  itemsHref: string;
  issuedLabel?: string;
}) {
  return (
    <>
      <PageHeader eyebrow="Stores" title={title} description={description} actions={primary} />

      <nav className="mb-4 flex flex-wrap gap-1.5 border-b border-ik-rule pb-2">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={
              "rounded-md px-3 py-1.5 text-[12.5px] " +
              (t.active ? "bg-brand-50 font-medium text-brand-700" : "text-ik-ink-2 hover:bg-ik-paper-alt")
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="mb-2">
        <SummaryStrip
          chips={[
            { label: "Out of stock", value: stock.out, tone: stock.out > 0 ? "red" : "grey" },
            { label: "Running low", value: stock.low, tone: stock.low > 0 ? "amber" : "grey" },
            { label: "In stock", value: stock.inStock, tone: "green" },
          ]}
        />
      </div>
      <p className="mb-4 text-[11.5px] text-ik-ink-3">
        Received {stock.received} · {issuedLabel} {stock.issued} this week
      </p>

      {stock.noThreshold > 0 && (
        <div className="mb-4 rounded-md border border-amber/40 bg-amber-wash p-3 text-[12.5px] text-ik-ink-2">
          <strong>{stock.noThreshold}</strong> {stock.noThreshold === 1 ? "item has" : "items have"} no reorder level set —{" "}
          <Link href={itemsHref} className="text-brand hover:underline">set thresholds</Link> so low-stock alerts work.
        </div>
      )}

      {stock.needsReorder.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-positive/30 bg-positive/5 p-4 text-[13px] font-medium text-positive">
          ✓ All stocked — nothing below threshold.
        </div>
      ) : (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Needs reordering · {stock.needsReorder.length}</h2>
            <Link href={itemsHref} className="text-[11.5px] text-brand hover:underline">All items →</Link>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reorder at</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stock.needsReorder.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{i.name}</TableCell>
                  <TableCell className="text-right font-mono">{i.currentStock} <span className="text-ik-ink-3">{i.unit}</span></TableCell>
                  <TableCell className="text-right font-mono text-ik-ink-3">{i.minStock ?? "—"}</TableCell>
                  <TableCell>{i.out ? <StatusPill tone="red">Out</StatusPill> : <StatusPill tone="amber">Low</StatusPill>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </>
  );
}
