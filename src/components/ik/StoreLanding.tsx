import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { StoreReorderTabs } from "@/components/ik/StoreReorderTabs";

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

      <p className="mb-3 text-[11.5px] text-ik-ink-3">
        Received {stock.received} · {issuedLabel} {stock.issued} this week
      </p>

      {stock.noThreshold > 0 && (
        <div className="mb-4 rounded-md border border-amber/40 bg-amber-wash p-3 text-[12.5px] text-ik-ink-2">
          <strong>{stock.noThreshold}</strong> {stock.noThreshold === 1 ? "item has" : "items have"} no reorder level set —{" "}
          <Link href={itemsHref} className="text-brand hover:underline">set thresholds</Link> so low-stock alerts work.
        </div>
      )}

      {/* Clickable KPI tabs — Out / Low / In stock. "Out of stock" pulses when
          anything is empty so it gets acted on first. */}
      <StoreReorderTabs stock={stock} itemsHref={itemsHref} />
    </>
  );
}
