import Link from "next/link";
import { db } from "@/server/db";
import { kitchenStockCounts } from "@/server/reports/stock-health";

interface StoreCard {
  key: string;
  label: string;
  href: string;
  itemCount: number;
  issuesLast7d: number;
  lowStock: number;
}

/**
 * Admin/Manager-only panel that combines a snapshot of every stock
 * module — Kitchen ingredients, Housekeeping, Maintenance, Banquet —
 * into one row. Lets ops see where stock activity is concentrated
 * without bouncing between 4 separate dashboards.
 *
 * Each query is intentionally cheap (count + count) so the panel
 * never dominates dashboard load.
 */
export async function StoresOverviewPanel() {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const [
    kitchenCount,
    kitchenIssues,
    kitchenStock,
    hkCount,
    hkIssues,
    hkLowAll,
    maintCount,
    maintIssues,
    maintLowAll,
    banquetCount,
    banquetIssues,
    banquetLowAll,
  ] = await Promise.all([
    db.ingredient.count({ where: { active: true } }),
    db.ingredientIssue.count({ where: { issuedAt: { gte: oneWeekAgo } } }),
    // Same classifier as the stock page and the attention bar. The old
    // approximation here (onHandQty <= 0) counted every catalogue row that
    // had never been counted or drawn.
    kitchenStockCounts(),
    db.housekeepingItem.count({ where: { active: true } }),
    db.housekeepingIssue.count({ where: { issuedAt: { gte: oneWeekAgo } } }),
    db.housekeepingItem.findMany({
      where: { active: true, minStock: { not: null } },
      select: { currentStock: true, minStock: true },
    }),
    db.maintenanceItem.count({ where: { active: true } }),
    db.maintenanceActivity.count({
      where: { performedAt: { gte: oneWeekAgo } },
    }),
    db.maintenanceItem.findMany({
      where: { active: true, minStock: { not: null } },
      select: { currentStock: true, minStock: true },
    }),
    db.banquetItem.count({ where: { active: true } }),
    db.banquetIssue.count({ where: { issuedAt: { gte: oneWeekAgo } } }),
    db.banquetItem.findMany({
      where: { active: true, minStock: { not: null } },
      select: { currentStock: true, minStock: true },
    }),
  ]);

  function countLow(
    rows: Array<{ currentStock: { toString(): string } | number; minStock: { toString(): string } | number | null }>,
  ): number {
    return rows.filter((r) => {
      if (r.minStock == null) return false;
      return Number(r.currentStock.toString()) <= Number(r.minStock.toString());
    }).length;
  }

  const cards: StoreCard[] = [
    {
      key: "kitchen",
      label: "Kitchen",
      href: "/inventory/ingredients",
      itemCount: kitchenCount,
      issuesLast7d: kitchenIssues,
      lowStock: kitchenStock.toOrder,
    },
    {
      key: "housekeeping",
      label: "Housekeeping",
      href: "/housekeeping",
      itemCount: hkCount,
      issuesLast7d: hkIssues,
      lowStock: countLow(hkLowAll),
    },
    {
      key: "maintenance",
      label: "Maintenance",
      href: "/maintenance",
      itemCount: maintCount,
      issuesLast7d: maintIssues,
      lowStock: countLow(maintLowAll),
    },
    {
      key: "banquet",
      label: "Banquet",
      href: "/banquet",
      itemCount: banquetCount,
      issuesLast7d: banquetIssues,
      lowStock: countLow(banquetLowAll),
    },
  ];

  const anyActivity = cards.some(
    (c) => c.itemCount > 0 || c.issuesLast7d > 0 || c.lowStock > 0,
  );
  if (!anyActivity) return null;

  return (
    <section className="rounded-md border border-ik-rule bg-ik-card">
      <header className="flex items-center justify-between border-b border-ik-rule p-3">
        <div className="text-[12px] font-medium text-ik-ink-2">
          Stores — week at a glance
        </div>
        <span className="text-[11px] text-ik-ink-3">
          Issues / consumption · last 7 days
        </span>
      </header>
      <div className="grid grid-cols-2 gap-px bg-ik-rule sm:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className="bg-ik-card p-3 hover:bg-ik-paper-alt"
          >
            <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
              {c.label}
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-mono text-[20px] text-ik-ink">
                {c.issuesLast7d}
              </span>
              <span className="text-[10.5px] text-ik-ink-3">
                {c.itemCount} items
              </span>
            </div>
            <div className="mt-1 text-[10.5px]">
              {c.lowStock > 0 ? (
                <span className="text-alert">{c.lowStock} to order</span>
              ) : (
                <span className="text-ik-ink-3">nothing to order</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
