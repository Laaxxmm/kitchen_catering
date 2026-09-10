import { db } from "@/server/db";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { createIngredient, mergeIngredient } from "@/server/actions/inventory";
import { postInventoryAudit } from "@/server/actions/inventory-audit";

/**
 * A physical stock count taken on paper, applied to the kitchen catalogue.
 *
 * The store counts the shelves into a spreadsheet; that sheet is reconciled
 * against the catalogue by hand (names matched, kilos turned into packets,
 * which vendor's price to take) and lands here as one JSON file per count.
 * This module applies it through the app's own paths — the physical-count
 * posting for quantities, createIngredient for anything new, mergeIngredient
 * for twins — so every figure has a document, an audit row and a role gate
 * behind it, exactly as if the store had keyed it in.
 *
 * Nothing here reads the file: the action does, so this can be tested with
 * a count built inline.
 */

export interface StockCountRow {
  /** Row in the source sheet, for the report back. */
  row: number;
  /** GP code of an existing item. Absent when `new`. */
  code?: string;
  /** Create this item — unless one already exists by name, in which case it
   *  is updated instead. A count never creates a twin. */
  new?: boolean;
  name: string;
  unit: string;
  /** Change the catalogue unit to this before posting the quantity. */
  setUnit?: string;
  /** Counted quantity, already in the catalogue unit. */
  qty: string;
  /** Price per catalogue unit, or null to leave avg cost alone. */
  cost: string | null;
}

export interface StockCountFile {
  id: string;
  takenOn: string;
  source: string;
  merges: Array<{ from: string; into: string; why?: string }>;
  rows: StockCountRow[];
}

export interface StockCountPlan {
  id: string;
  alreadyApplied: boolean;
  merges: Array<{ from: string; into: string; fromName: string; intoName: string }>;
  create: Array<{ row: number; name: string; unit: string; qty: string; cost: string | null }>;
  /** `new` rows whose name already exists — updated, never duplicated. */
  existing: Array<{ row: number; name: string; code: string }>;
  update: Array<{
    row: number;
    code: string;
    name: string;
    qtyFrom: string;
    qtyTo: string;
    costFrom: string;
    costTo: string | null;
    unitFrom: string;
    unitTo: string | null;
  }>;
  /** Rows that cannot be applied, with the reason. Any of these blocks the run. */
  problems: string[];
}

const APPLIED_ACTION = "STOCK_COUNT_APPLIED";

export async function planStockCount(count: StockCountFile): Promise<StockCountPlan> {
  const applied = await db.auditLog.findFirst({
    where: { action: APPLIED_ACTION, entityId: count.id },
    select: { id: true },
  });
  const plan: StockCountPlan = {
    id: count.id,
    alreadyApplied: !!applied,
    merges: [],
    create: [],
    existing: [],
    update: [],
    problems: [],
  };

  const codes = [
    ...count.rows.map((r) => r.code).filter((c): c is string => !!c),
    ...count.merges.flatMap((m) => [m.from, m.into]),
  ];
  const items = await db.ingredient.findMany({
    where: { sku: { in: codes } },
    select: { id: true, sku: true, name: true, unit: true, onHandQty: true, avgUnitCost: true, active: true },
  });
  const bySku = new Map(items.map((i) => [i.sku, i]));

  for (const m of count.merges) {
    const from = bySku.get(m.from);
    const into = bySku.get(m.into);
    if (!from || !into) {
      plan.problems.push(`merge ${m.from} → ${m.into}: ${!from ? m.from : m.into} is not in the catalogue`);
      continue;
    }
    if (!from.active) continue; // already merged on a previous pass
    plan.merges.push({ from: m.from, into: m.into, fromName: from.name, intoName: into.name });
  }

  for (const r of count.rows) {
    if (r.new) {
      const twin = await db.ingredient.findFirst({
        where: { name: { equals: r.name.trim(), mode: "insensitive" } },
        select: { sku: true, name: true, unit: true, onHandQty: true, avgUnitCost: true },
      });
      if (twin) {
        const twice = plan.update.find((u) => u.code === twin.sku);
        if (twice) {
          plan.problems.push(`row ${r.row} ${r.name}: ${twin.sku} is already counted on row ${twice.row}`);
          continue;
        }
        plan.existing.push({ row: r.row, name: r.name, code: twin.sku });
        plan.update.push({
          row: r.row,
          code: twin.sku,
          name: twin.name,
          qtyFrom: toDecimal(twin.onHandQty).toString(),
          qtyTo: r.qty,
          costFrom: toDecimal(twin.avgUnitCost).toString(),
          costTo: r.cost,
          unitFrom: twin.unit,
          unitTo: r.unit !== twin.unit ? r.unit : null,
        });
      } else {
        plan.create.push({ row: r.row, name: r.name, unit: r.unit, qty: r.qty, cost: r.cost });
      }
      continue;
    }
    const item = r.code ? bySku.get(r.code) : undefined;
    if (!item) {
      plan.problems.push(`row ${r.row} ${r.name}: ${r.code ?? "no code"} is not in the catalogue`);
      continue;
    }
    if (!item.active) {
      plan.problems.push(`row ${r.row} ${r.name}: ${r.code} is hidden — unhide it or drop the row`);
      continue;
    }
    // The same item twice on one sheet is the duplicate the client asked
    // never to let through — two figures, no way to know which is right.
    const twice = plan.update.find((u) => u.code === item.sku);
    if (twice) {
      plan.problems.push(`row ${r.row} ${r.name}: ${item.sku} is already counted on row ${twice.row}`);
      continue;
    }
    plan.update.push({
      row: r.row,
      code: item.sku,
      name: item.name,
      qtyFrom: toDecimal(item.onHandQty).toString(),
      qtyTo: r.qty,
      costFrom: toDecimal(item.avgUnitCost).toString(),
      costTo: r.cost,
      unitFrom: item.unit,
      unitTo: r.setUnit && r.setUnit !== item.unit ? r.setUnit : null,
    });
  }
  return plan;
}

export interface StockCountResult {
  merged: number;
  created: number;
  quantitiesChanged: number;
  costsSet: number;
  unitsChanged: number;
}

/**
 * Apply in the order the figures depend on each other: merge twins first so
 * the count lands on the survivor, create what is missing so it has an id,
 * change units before quantities are read in that unit, post the count,
 * then set costs. Each step is one of the app's own gated actions or an
 * audited update, so a partial failure leaves ordinary, readable documents
 * behind and a re-run picks up where it stopped — createIngredient refuses
 * a twin, the count posting is a no-op on an unchanged figure, and the
 * marker written last is what stops a completed run being applied twice.
 */
export async function applyStockCountPlan(
  count: StockCountFile,
  actorId: string,
): Promise<StockCountResult> {
  const plan = await planStockCount(count);
  if (plan.alreadyApplied) throw new Error(`Stock count ${count.id} has already been applied.`);
  if (plan.problems.length > 0) {
    throw new Error(`Fix the count file first:\n${plan.problems.join("\n")}`);
  }

  const result: StockCountResult = { merged: 0, created: 0, quantitiesChanged: 0, costsSet: 0, unitsChanged: 0 };

  for (const m of plan.merges) {
    const [from, into] = await Promise.all([
      db.ingredient.findUniqueOrThrow({ where: { sku: m.from }, select: { id: true } }),
      db.ingredient.findUniqueOrThrow({ where: { sku: m.into }, select: { id: true } }),
    ]);
    const res = await mergeIngredient(from.id, into.id);
    if (!res.ok) throw new Error(`merge ${m.from} → ${m.into}: ${res.error}`);
    result.merged++;
  }

  // New items carry their count as opening stock — no adjustment needed.
  for (const c of plan.create) {
    const res = await createIngredient({
      name: c.name,
      unit: c.unit,
      openingQty: c.qty,
      openingAvgCost: c.cost ?? "0",
    });
    if (!res.ok) throw new Error(`create ${c.name}: ${res.error}`);
    result.created++;
  }

  const unitChanges = plan.update.filter((u) => u.unitTo);
  for (const u of unitChanges) {
    await db.$transaction(async (tx) => {
      const item = await tx.ingredient.findUniqueOrThrow({ where: { sku: u.code }, select: { id: true } });
      await tx.ingredient.update({ where: { id: item.id }, data: { unit: u.unitTo! } });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "INGREDIENT_UNIT_SET",
          entity: "Ingredient",
          entityId: item.id,
          payloadHash: sha256Json({ from: u.unitFrom, to: u.unitTo, countId: count.id }),
        },
      });
    });
    result.unitsChanged++;
  }

  const lines = [];
  for (const u of plan.update) {
    const item = await db.ingredient.findUniqueOrThrow({ where: { sku: u.code }, select: { id: true } });
    lines.push({ ingredientId: item.id, physicalCount: u.qtyTo });
  }
  if (lines.length > 0) {
    const posted = await postInventoryAudit({ lines, notes: `Stock count ${count.id} (${count.source})` });
    if (!posted.ok) throw new Error(`count posting: ${posted.error}`);
    result.quantitiesChanged = posted.changes.length;
  }

  for (const u of plan.update) {
    if (u.costTo === null || toDecimal(u.costTo).eq(toDecimal(u.costFrom))) continue;
    await db.$transaction(async (tx) => {
      const item = await tx.ingredient.findUniqueOrThrow({ where: { sku: u.code }, select: { id: true } });
      await tx.ingredient.update({
        where: { id: item.id },
        data: { avgUnitCost: toDecimal(u.costTo!).toDecimalPlaces(4).toString() },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: "INGREDIENT_COST_SET",
          entity: "Ingredient",
          entityId: item.id,
          payloadHash: sha256Json({ from: u.costFrom, to: u.costTo, countId: count.id }),
        },
      });
    });
    result.costsSet++;
  }

  await db.auditLog.create({
    data: {
      userId: actorId,
      action: APPLIED_ACTION,
      entity: "System",
      entityId: count.id,
      payloadHash: sha256Json({ count, result }),
    },
  });
  return result;
}
