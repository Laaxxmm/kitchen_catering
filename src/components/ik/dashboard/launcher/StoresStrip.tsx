import Link from "next/link";
import { db } from "@/server/db";
import { kitchenStockCounts } from "@/server/reports/stock-health";

interface StoreMini {
  key: string;
  label: string;
  href: string;
  itemCount: number;
  low: number;
  /** Kitchen only: items the kitchen is actually drawing. The other stores
   *  have no issue history to derive a rate from. */
  inUse?: number;
}

function countLow(
  rows: Array<{ currentStock: { toString(): string } | number; minStock: { toString(): string } | number | null }>,
): number {
  return rows.filter((r) => {
    if (r.minStock == null) return false;
    return Number(r.currentStock.toString()) <= Number(r.minStock.toString());
  }).length;
}

/**
 * Lighter reference row for the launcher — item count + what needs ordering
 * per store. Secondary surface, smaller than the task tiles.
 *
 * The kitchen figure used to be `onHandQty <= 0`, which read "243 low" out
 * of 421 items: nearly every one of them a catalogue row imported with no
 * opening count that has never been issued. It now comes from the shared
 * classifier, so this strip, the attention bar and the stock page all say
 * the same thing — and the kitchen card also shows how many items are in
 * regular use, which is the honest denominator for a 421-item catalogue.
 */
export async function StoresStrip() {
  const [
    kitchenCount, kitchenStock,
    hkCount, hkLowAll,
    maintCount, maintLowAll,
    banquetCount, banquetLowAll,
  ] = await Promise.all([
    db.ingredient.count({ where: { active: true } }),
    kitchenStockCounts(),
    db.housekeepingItem.count({ where: { active: true } }),
    db.housekeepingItem.findMany({ where: { active: true, minStock: { not: null } }, select: { currentStock: true, minStock: true } }),
    db.maintenanceItem.count({ where: { active: true } }),
    db.maintenanceItem.findMany({ where: { active: true, minStock: { not: null } }, select: { currentStock: true, minStock: true } }),
    db.banquetItem.count({ where: { active: true } }),
    db.banquetItem.findMany({ where: { active: true, minStock: { not: null } }, select: { currentStock: true, minStock: true } }),
  ]);

  const cards: StoreMini[] = [
    {
      key: "kitchen",
      label: "Kitchen",
      href: "/inventory/ingredients",
      itemCount: kitchenCount,
      low: kitchenStock.toOrder,
      inUse: kitchenStock.inRegularUse,
    },
    { key: "housekeeping", label: "Housekeeping", href: "/housekeeping", itemCount: hkCount, low: countLow(hkLowAll) },
    { key: "maintenance", label: "Maintenance", href: "/maintenance", itemCount: maintCount, low: countLow(maintLowAll) },
    { key: "banquet", label: "Banquet", href: "/banquet", itemCount: banquetCount, low: countLow(banquetLowAll) },
  ];

  if (cards.every((c) => c.itemCount === 0 && c.low === 0)) return null;
  const totalItems = cards.reduce((s, c) => s + c.itemCount, 0);
  const totalLow = cards.reduce((s, c) => s + c.low, 0);
  const stocked = Math.max(totalItems - totalLow, 0);
  // Low share of the bar; give a non-zero low count a visible minimum slice.
  const lowPct = totalItems > 0 ? Math.max((totalLow / totalItems) * 100, totalLow > 0 ? 4 : 0) : 0;

  return (
    <section className="rounded-2xl border border-ik-rule bg-ik-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {/* Hero: total items across every store */}
        <div>
          <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Stores</h2>
          <div className="mt-1 flex items-end gap-2.5">
            <span className="text-[42px] font-bold leading-none tracking-tight text-ik-ink tabular-nums">
              {totalItems}
            </span>
            <span className="pb-1 text-[12.5px] font-medium text-ik-ink-3">items in stores</span>
          </div>
        </div>
        <div className="flex items-baseline gap-4">
          <div className="text-right">
            <div className="text-[22px] font-bold leading-none text-brand-700 tabular-nums">{stocked}</div>
            <div className="mt-1 text-[10.5px] uppercase tracking-wide text-ik-ink-3">stocked</div>
          </div>
          <div className="text-right">
            <div className={"text-[22px] font-bold leading-none tabular-nums " + (totalLow > 0 ? "text-alert" : "text-ik-ink-3")}>
              {totalLow}
            </div>
            <div className="mt-1 text-[10.5px] uppercase tracking-wide text-ik-ink-3">to order</div>
          </div>
        </div>
      </div>

      {/* Stocked vs low split bar */}
      <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-ik-paper-alt" role="presentation">
        {totalLow > 0 && <span className="bg-alert" style={{ width: `${lowPct}%` }} />}
        <span className="bg-brand-500" style={{ width: `${100 - lowPct}%` }} />
      </div>

      {/* Per-store breakdown */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className="rounded-xl border border-ik-rule bg-ik-paper-alt p-3 transition hover:border-brand-200"
          >
            <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{c.label}</div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-[20px] font-bold text-ik-ink tabular-nums">{c.itemCount}</span>
              <span className="text-[11px] text-ik-ink-3">items</span>
            </div>
            <div className="mt-0.5 text-[11.5px]">
              {c.low > 0 ? (
                <span className="font-medium text-alert">{c.low} to order</span>
              ) : (
                <span className="text-positive">nothing to order</span>
              )}
              {/* The denominator that makes the number readable: 421 items
                  in the catalogue, a fraction of them actually in use. */}
              {c.inUse !== undefined && (
                <span className="text-ik-ink-3"> · {c.inUse} in use</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
