import { db } from "@/server/db";
import { toDecimal } from "@/lib/money";
import { classifyStock, type StockBucket } from "@/lib/stock-health";

/**
 * One definition of "does this item need ordering", shared by everything
 * that shows a number about kitchen stock.
 *
 * There used to be three, all of them variations on "on hand <= reorder
 * level" with reorder level defaulting to 0 — the stock page, the dashboard
 * attention bar ("258 to reorder") and the stores panel ("243 low"). Each
 * counted, in its own slightly different way, the ~285 catalogue rows that
 * were imported with no opening count and have never been issued. Three big
 * red numbers, none of them about anything anybody could act on.
 *
 * No auth here on purpose: this is a plain server module, so the callers —
 * a server action, a dashboard summary, a panel — each apply their own gate
 * rather than importing an action out of another "use server" module.
 */

export interface StockHealthRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  onHand: string;
  reorderLevel: string;
  avgCost: string;
  bucket: StockBucket;
  dailyRate: string;
  daysCover: number | null;
  suggestedQty: string;
  lastIssuedAt: string | null;
}

export async function stockHealthRows(now: Date = new Date()): Promise<StockHealthRow[]> {
  // Usage is aggregated per item, not fetched per row: the catalogue is
  // 400+ items and a query each would be 400+ round trips on a page load.
  const [items, issueStats, receiptStats] = await Promise.all([
    db.ingredient.findMany({
      where: { active: true },
      select: {
        id: true,
        sku: true,
        name: true,
        unit: true,
        onHandQty: true,
        reorderLevel: true,
        avgUnitCost: true,
      },
      orderBy: { name: "asc" },
    }),
    db.ingredientIssue.groupBy({
      by: ["ingredientId"],
      _sum: { qty: true },
      _min: { issuedAt: true },
      _max: { issuedAt: true },
    }),
    // First receipt counts too: an item received a fortnight ago and drawn
    // once yesterday has been in play a fortnight, not a day.
    db.ingredientReceipt.groupBy({
      by: ["ingredientId"],
      _min: { receivedAt: true },
    }),
  ]);

  const issues = new Map(issueStats.map((r) => [r.ingredientId, r]));
  const receipts = new Map(receiptStats.map((r) => [r.ingredientId, r]));

  return items.map((i) => {
    const issue = issues.get(i.id);
    const firstReceipt = receipts.get(i.id)?._min.receivedAt ?? null;
    const firstIssue = issue?._min.issuedAt ?? null;
    const firstMovementAt =
      firstReceipt && firstIssue
        ? firstReceipt < firstIssue
          ? firstReceipt
          : firstIssue
        : (firstReceipt ?? firstIssue);

    const health = classifyStock(
      {
        onHandQty: i.onHandQty,
        reorderLevel: i.reorderLevel,
        issuedQty: issue?._sum.qty ?? 0,
        firstMovementAt,
        lastIssuedAt: issue?._max.issuedAt ?? null,
      },
      now,
    );

    return {
      id: i.id,
      sku: i.sku,
      name: i.name,
      unit: i.unit,
      onHand: toDecimal(i.onHandQty).toString(),
      reorderLevel: toDecimal(i.reorderLevel).toString(),
      avgCost: toDecimal(i.avgUnitCost).toString(),
      bucket: health.bucket,
      dailyRate: health.dailyRate.toDecimalPlaces(3).toString(),
      daysCover: health.daysCover,
      suggestedQty: health.suggestedQty.toString(),
      lastIssuedAt: issue?._max.issuedAt?.toISOString() ?? null,
    };
  });
}

export interface KitchenStockCounts {
  /** Every active kitchen item. */
  total: number;
  /** Empty AND actually being used — order today. */
  outNeeded: number;
  /** Under a week of cover at the current rate. */
  runningOut: number;
  watch: number;
  healthy: number;
  /** In the catalogue, never issued. Not a shortage. */
  neverUsed: number;
  /** Stock on the shelf that nothing has drawn in two months. */
  dormant: number;
  /** The one number worth putting in an attention bar. */
  toOrder: number;
  /** Items the kitchen actually draws — everything with a live usage rate. */
  inRegularUse: number;
}

export async function kitchenStockCounts(now: Date = new Date()): Promise<KitchenStockCounts> {
  const rows = await stockHealthRows(now);
  const count = (b: StockBucket) => rows.filter((r) => r.bucket === b).length;
  const outNeeded = count("OUT_NEEDED");
  const runningOut = count("RUNNING_OUT");
  const watch = count("WATCH");
  const healthy = count("HEALTHY");
  return {
    total: rows.length,
    outNeeded,
    runningOut,
    watch,
    healthy,
    neverUsed: count("NEVER_USED"),
    dormant: count("DORMANT"),
    toOrder: outNeeded + runningOut,
    // Anything the kitchen is currently drawing, whatever its stock level.
    // "Not moving" and "never used" are deliberately excluded — that is the
    // difference between 421 items and the handful in daily use.
    inRegularUse: outNeeded + runningOut + watch + healthy,
  };
}
