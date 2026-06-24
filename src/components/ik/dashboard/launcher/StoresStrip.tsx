import Link from "next/link";
import { db } from "@/server/db";

interface StoreMini {
  key: string;
  label: string;
  href: string;
  itemCount: number;
  low: number;
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
 * Lighter reference row for the launcher — item count + low-stock flags per
 * store, no 7-day consumption number (that lives on the Stock detail page).
 * Secondary surface + smaller than the task tiles so it doesn't compete.
 * Reuses the same queries as the old StoresOverviewPanel.
 */
export async function StoresStrip() {
  const [
    kitchenCount, kitchenLow,
    hkCount, hkLowAll,
    maintCount, maintLowAll,
    banquetCount, banquetLowAll,
  ] = await Promise.all([
    db.ingredient.count({ where: { active: true } }),
    db.ingredient.count({ where: { active: true, onHandQty: { lte: 0 } } }),
    db.housekeepingItem.count({ where: { active: true } }),
    db.housekeepingItem.findMany({ where: { active: true, minStock: { not: null } }, select: { currentStock: true, minStock: true } }),
    db.maintenanceItem.count({ where: { active: true } }),
    db.maintenanceItem.findMany({ where: { active: true, minStock: { not: null } }, select: { currentStock: true, minStock: true } }),
    db.banquetItem.count({ where: { active: true } }),
    db.banquetItem.findMany({ where: { active: true, minStock: { not: null } }, select: { currentStock: true, minStock: true } }),
  ]);

  const cards: StoreMini[] = [
    { key: "kitchen", label: "Kitchen", href: "/inventory/ingredients", itemCount: kitchenCount, low: kitchenLow },
    { key: "housekeeping", label: "Housekeeping", href: "/housekeeping", itemCount: hkCount, low: countLow(hkLowAll) },
    { key: "maintenance", label: "Maintenance", href: "/maintenance", itemCount: maintCount, low: countLow(maintLowAll) },
    { key: "banquet", label: "Banquet", href: "/banquet", itemCount: banquetCount, low: countLow(banquetLowAll) },
  ];

  if (cards.every((c) => c.itemCount === 0 && c.low === 0)) return null;
  const totalLow = cards.reduce((s, c) => s + c.low, 0);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Stores</h2>
        {totalLow > 0 ? (
          <span className="text-[11.5px] font-medium text-alert">{totalLow} low-stock flags</span>
        ) : (
          <span className="text-[11.5px] text-positive">all stocked</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className="rounded-md border border-ik-rule bg-ik-paper-alt p-3 transition hover:border-brand-200"
          >
            <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{c.label}</div>
            <div className="mt-1 text-[13px] text-ik-ink">{c.itemCount} items</div>
            <div className="mt-0.5 text-[11.5px]">
              {c.low > 0 ? (
                <span className="text-alert">{c.low} low</span>
              ) : (
                <span className="text-positive">all stocked</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
