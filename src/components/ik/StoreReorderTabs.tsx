"use client";

import { useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/ik/StatusPill";
import type { StoreStock } from "@/components/ik/StoreLanding";

type Tab = "out" | "low" | "in";

/**
 * Clickable KPI tabs for the store landings (Housekeeping / Maintenance /
 * Banquet). Replaces the static summary chips: each card switches the table
 * below, and "Out of stock" carries an urgency dot so the storekeeper acts on
 * it first. The out/low rows come from `needsReorder`; in-stock items live on
 * the items page, so that tab links out.
 */
export function StoreReorderTabs({ stock, itemsHref }: { stock: StoreStock; itemsHref: string }) {
  // Default to the most urgent non-empty tab.
  const initial: Tab = stock.out > 0 ? "out" : stock.low > 0 ? "low" : "in";
  const [tab, setTab] = useState<Tab>(initial);

  const cards: { key: Tab; label: string; value: number; tone: "red" | "amber" | "green" }[] = [
    { key: "out", label: "Out of stock", value: stock.out, tone: "red" },
    { key: "low", label: "Running low", value: stock.low, tone: "amber" },
    { key: "in", label: "In stock", value: stock.inStock, tone: "green" },
  ];

  const rows = stock.needsReorder.filter((i) => (tab === "out" ? i.out : tab === "low" ? !i.out : false));

  return (
    <div>
      <div className="mb-4 grid grid-cols-3 gap-2">
        {cards.map((c) => {
          const active = tab === c.key;
          const numTone =
            c.tone === "red" && c.value > 0
              ? "text-alert"
              : c.tone === "amber" && c.value > 0
                ? "text-amber"
                : c.tone === "green"
                  ? "text-positive"
                  : "text-ik-ink";
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setTab(c.key)}
              className={
                "rounded-[12px] border p-3 text-left transition " +
                (active ? "border-brand-500 bg-brand-50" : "border-ik-rule bg-ik-card hover:border-brand-200")
              }
            >
              <div className={"font-mono text-[20px] leading-none " + numTone}>{c.value}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-ik-ink-2">
                {c.label}
                {c.key === "out" && c.value > 0 && (
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-alert" aria-label="urgent" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {tab === "in" ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-positive/30 bg-positive/5 p-4 text-[13px] text-positive">
          <span>✓ {stock.inStock} item{stock.inStock === 1 ? "" : "s"} comfortably in stock.</span>
          <Link href={itemsHref} className="shrink-0 text-[12px] font-medium text-brand hover:underline">All items →</Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-positive/30 bg-positive/5 p-4 text-[13px] font-medium text-positive">
          ✓ Nothing {tab === "out" ? "out of stock" : "running low"} right now.
        </div>
      ) : (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
              {tab === "out" ? "Out of stock" : "Running low"} · {rows.length}
            </h2>
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
              {rows.map((i) => (
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
    </div>
  );
}
