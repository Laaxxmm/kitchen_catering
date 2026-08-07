import { IngredientReturnStatus, StockStore } from "@prisma/client";
import { db } from "@/server/db";
import { toDecimal } from "@/lib/money";

/**
 * Per-item stock ledger for a store over a date range: opening balance
 * (everything before `from`), movements in the window (in / out / adjust),
 * and the closing balance. Read-only aggregation off the same movement rows
 * the app already writes on every receipt / issue / adjustment / return /
 * store transfer — so the ledger reconciles to what actually happened, item
 * by item. Anything that moves on-hand belongs in here.
 *
 * Kitchen covers every ingredient, which is where vegetables, frozen and
 * non-veg live (they are ingredient categories, not separate stores).
 * Banquet covers the F&B cutlery / disposables / equipment; returns count
 * as stock coming back in. Non-"use server" so the report page and the
 * Excel export can both call it directly.
 */
export type LedgerStore = "kitchen" | "banquet";

export interface LedgerRow {
  sku: string;
  name: string;
  category: string | null;
  unit: string;
  opening: number;
  inQty: number;
  outQty: number;
  adjustQty: number;
  closing: number;
  /** Closing × avg unit cost. null for banquet (no costed valuation). */
  value: number | null;
}

const n = (v: { toString(): string } | null | undefined) => (v == null ? 0 : Number(v.toString()));

/**
 * Quantities per item, split into "before the window" (opening) and "in the
 * window". Used for the two movements that can't be groupBy'd in SQL: the
 * kitchen return line's item lives on its issue, and a transfer's item ids
 * are polymorphic across three catalogues.
 *
 * ponytail: reads the documents whole and sums in JS. Both are low-volume
 * next to receipts and issues; push it into SQL if either table ever grows
 * to the point where the report drags.
 */
interface Buckets {
  before: Map<string, number>;
  window: Map<string, number>;
}
const emptyBuckets = (): Buckets => ({ before: new Map(), window: new Map() });

function bucket(b: Buckets, at: Date, from: Date, to: Date, id: string, qty: number) {
  if (at < from) b.before.set(id, (b.before.get(id) ?? 0) + qty);
  else if (at <= to) b.window.set(id, (b.window.get(id) ?? 0) + qty);
}

/** Stock the kitchen sent back, per ingredient. CONFIRMED only — a
 *  declaration the store hasn't counted in yet has moved nothing, so it
 *  would show up here as a movement that never happened. */
async function kitchenReturnBuckets(from: Date, to: Date): Promise<Buckets> {
  const rows = await db.ingredientReturnLine.findMany({
    where: {
      return: { returnedAt: { lte: to }, status: IngredientReturnStatus.CONFIRMED },
    },
    select: {
      quantity: true,
      issue: { select: { ingredientId: true } },
      return: { select: { returnedAt: true } },
    },
  });
  const b = emptyBuckets();
  for (const r of rows) {
    bucket(b, r.return.returnedAt, from, to, r.issue.ingredientId, n(r.quantity));
  }
  return b;
}

/** Transfers into and out of one store, per item on that store's side. */
async function transferBuckets(store: StockStore, from: Date, to: Date) {
  const rows = await db.stockTransfer.findMany({
    where: { transferredAt: { lte: to }, OR: [{ fromStore: store }, { toStore: store }] },
    select: {
      transferredAt: true,
      fromStore: true, fromItemId: true,
      toStore: true, toItemId: true,
      quantity: true,
    },
  });
  const into = emptyBuckets();
  const outOf = emptyBuckets();
  for (const r of rows) {
    if (r.fromStore === store) bucket(outOf, r.transferredAt, from, to, r.fromItemId, n(r.quantity));
    if (r.toStore === store) bucket(into, r.transferredAt, from, to, r.toItemId, n(r.quantity));
  }
  return { into, outOf };
}

async function kitchenLedger(from: Date, to: Date): Promise<LedgerRow[]> {
  const [ingredients, recBefore, issBefore, adjBefore, recIn, issIn, adjIn, returns, transfers] =
    await Promise.all([
    db.ingredient.findMany({
      where: { active: true },
      select: {
        id: true, sku: true, name: true, unit: true, category: true, avgUnitCost: true,
        // Stock the item started life with. It has no movement document
        // behind it — the catalogue import and the new-ingredient form both
        // write it straight onto the row — so it has to be added in here or
        // every balance below it is short by the opening figure.
        openingQty: true,
      },
    }),
    db.ingredientReceipt.groupBy({ by: ["ingredientId"], _sum: { qty: true }, where: { receivedAt: { lt: from } } }),
    db.ingredientIssue.groupBy({ by: ["ingredientId"], _sum: { qty: true }, where: { issuedAt: { lt: from } } }),
    db.ingredientAdjustment.groupBy({ by: ["ingredientId"], _sum: { delta: true }, where: { adjustedAt: { lt: from } } }),
    db.ingredientReceipt.groupBy({ by: ["ingredientId"], _sum: { qty: true }, where: { receivedAt: { gte: from, lte: to } } }),
    db.ingredientIssue.groupBy({ by: ["ingredientId"], _sum: { qty: true }, where: { issuedAt: { gte: from, lte: to } } }),
    db.ingredientAdjustment.groupBy({ by: ["ingredientId"], _sum: { delta: true }, where: { adjustedAt: { gte: from, lte: to } } }),
    kitchenReturnBuckets(from, to),
    transferBuckets(StockStore.KITCHEN, from, to),
  ]);

  const sum = (rows: Array<{ ingredientId: string; _sum: { qty?: unknown; delta?: unknown } }>, key: "qty" | "delta") => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.ingredientId, n(r._sum[key] as never));
    return m;
  };
  const rB = sum(recBefore, "qty"), iB = sum(issBefore, "qty"), aB = sum(adjBefore, "delta");
  const rI = sum(recIn, "qty"), iI = sum(issIn, "qty"), aI = sum(adjIn, "delta");

  return ingredients.map((g) => {
    // Opening stock plus everything before the window. Returns and
    // transfers-in are stock coming back on hand; transfers-out leave like an
    // issue. Every movement that touches onHandQty has to be here or the
    // closing balance stops matching the item's actual stock.
    const opening =
      n(g.openingQty)
      + (rB.get(g.id) ?? 0) - (iB.get(g.id) ?? 0) + (aB.get(g.id) ?? 0)
      + (returns.before.get(g.id) ?? 0)
      + (transfers.into.before.get(g.id) ?? 0)
      - (transfers.outOf.before.get(g.id) ?? 0);
    const inQty =
      (rI.get(g.id) ?? 0) + (returns.window.get(g.id) ?? 0) + (transfers.into.window.get(g.id) ?? 0);
    const outQty = (iI.get(g.id) ?? 0) + (transfers.outOf.window.get(g.id) ?? 0);
    const adjustQty = aI.get(g.id) ?? 0;
    const closing = opening + inQty - outQty + adjustQty;
    return {
      sku: g.sku,
      name: g.name,
      category: g.category,
      unit: g.unit,
      opening,
      inQty,
      outQty,
      adjustQty,
      closing,
      value: Number(toDecimal(closing).times(g.avgUnitCost).toDecimalPlaces(2)),
    };
  });
}

async function banquetLedger(from: Date, to: Date): Promise<LedgerRow[]> {
  const [items, recBefore, retBefore, issBefore, recIn, retIn, issIn, transfers] = await Promise.all([
    db.banquetItem.findMany({ where: { active: true }, select: { id: true, sku: true, name: true, unit: true, category: true } }),
    db.banquetReceiptLine.groupBy({ by: ["itemId"], _sum: { quantity: true }, where: { receipt: { receivedAt: { lt: from } } } }),
    db.banquetReturnLine.groupBy({ by: ["itemId"], _sum: { quantity: true }, where: { return: { returnedAt: { lt: from } } } }),
    db.banquetIssueLine.groupBy({ by: ["itemId"], _sum: { quantity: true }, where: { issue: { issuedAt: { lt: from } } } }),
    db.banquetReceiptLine.groupBy({ by: ["itemId"], _sum: { quantity: true }, where: { receipt: { receivedAt: { gte: from, lte: to } } } }),
    db.banquetReturnLine.groupBy({ by: ["itemId"], _sum: { quantity: true }, where: { return: { returnedAt: { gte: from, lte: to } } } }),
    db.banquetIssueLine.groupBy({ by: ["itemId"], _sum: { quantity: true }, where: { issue: { issuedAt: { gte: from, lte: to } } } }),
    transferBuckets(StockStore.FNB, from, to),
  ]);

  const sum = (rows: Array<{ itemId: string; _sum: { quantity: unknown } }>) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.itemId, n(r._sum.quantity as never));
    return m;
  };
  const rB = sum(recBefore), tB = sum(retBefore), iB = sum(issBefore);
  const rI = sum(recIn), tI = sum(retIn), iI = sum(issIn);

  return items.map((b) => {
    // Returns and transfers-in are stock coming back in.
    const opening =
      (rB.get(b.id) ?? 0) + (tB.get(b.id) ?? 0) - (iB.get(b.id) ?? 0)
      + (transfers.into.before.get(b.id) ?? 0)
      - (transfers.outOf.before.get(b.id) ?? 0);
    const inQty = (rI.get(b.id) ?? 0) + (tI.get(b.id) ?? 0) + (transfers.into.window.get(b.id) ?? 0);
    const outQty = (iI.get(b.id) ?? 0) + (transfers.outOf.window.get(b.id) ?? 0);
    const closing = opening + inQty - outQty;
    return { sku: b.sku ?? "", name: b.name, category: b.category, unit: b.unit, opening, inQty, outQty, adjustQty: 0, closing, value: null };
  });
}

export async function getStockLedger(store: LedgerStore, from: Date, to: Date) {
  const rows = store === "banquet" ? await banquetLedger(from, to) : await kitchenLedger(from, to);
  // Items with zero everywhere in the window and zero balance add only noise.
  const active = rows.filter((r) => r.opening || r.inQty || r.outQty || r.adjustQty || r.closing);
  active.sort((a, b) => b.outQty - a.outQty || a.name.localeCompare(b.name));
  const totals = active.reduce(
    (t, r) => ({
      inQty: t.inQty + r.inQty,
      outQty: t.outQty + r.outQty,
      value: t.value + (r.value ?? 0),
    }),
    { inQty: 0, outQty: 0, value: 0 },
  );
  return { rows: active, totals };
}
