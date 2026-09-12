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
  /**
   * Convert instead of count. One old unit equals this many `setUnit`s
   * (0.2 turns a 200 g packet into kilos): the item's on-hand, avg cost,
   * reorder level and every historical quantity and unit price are scaled
   * so stock value and past costs are unchanged. `qty` and `cost` are not
   * read — the figures come from the item itself.
   */
  unitFactor?: string;
  /** Counted quantity, already in the catalogue unit. Absent on a convert row. */
  qty?: string;
  /** Price per catalogue unit, or null to leave avg cost alone. Absent on a convert row. */
  cost?: string | null;
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
    /** Set on a convert row: qtyTo and costTo are the current figures scaled by it. */
    unitFactor: string | null;
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
    if (r.unitFactor === undefined && r.qty === undefined) {
      plan.problems.push(`row ${r.row} ${r.name}: no quantity`);
      continue;
    }
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
          qtyTo: r.qty!,
          costFrom: toDecimal(twin.avgUnitCost).toString(),
          costTo: r.cost ?? null,
          unitFrom: twin.unit,
          unitTo: r.unit !== twin.unit ? r.unit : null,
          unitFactor: null,
        });
      } else {
        plan.create.push({ row: r.row, name: r.name, unit: r.unit, qty: r.qty!, cost: r.cost ?? null });
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
    if (r.unitFactor !== undefined) {
      const f = toDecimal(r.unitFactor);
      if (!r.setUnit || !f.gt(0)) {
        plan.problems.push(`row ${r.row} ${r.name}: a convert row needs setUnit and a unitFactor above 0`);
        continue;
      }
      // Already in the target unit — converted on an earlier pass, or never
      // needed it. Nothing to scale.
      if (r.setUnit === item.unit) continue;
      const avg = toDecimal(item.avgUnitCost);
      plan.update.push({
        row: r.row,
        code: item.sku,
        name: item.name,
        qtyFrom: toDecimal(item.onHandQty).toString(),
        qtyTo: toDecimal(item.onHandQty).times(f).toDecimalPlaces(3).toString(),
        costFrom: avg.toString(),
        costTo: avg.eq(0) ? "0" : avg.div(f).toDecimalPlaces(4).toString(),
        unitFrom: item.unit,
        unitTo: r.setUnit,
        unitFactor: r.unitFactor,
      });
      continue;
    }
    plan.update.push({
      row: r.row,
      code: item.sku,
      name: item.name,
      qtyFrom: toDecimal(item.onHandQty).toString(),
      qtyTo: r.qty!,
      costFrom: toDecimal(item.avgUnitCost).toString(),
      costTo: r.cost ?? null,
      unitFrom: item.unit,
      unitTo: r.setUnit && r.setUnit !== item.unit ? r.setUnit : null,
      unitFactor: null,
    });
  }
  return plan;
}

/**
 * Move an item to another unit and carry its whole history with it, value
 * intact: quantities multiply by the factor, unit prices divide by it, so
 * on-hand value, every past issue's cost and every PO line's total stay
 * what they were — only the number they are counted in changes. One
 * transaction, one audit row. A re-run finds the unit already changed and
 * does nothing.
 */
async function convertIngredientUnit(
  u: StockCountPlan["update"][number],
  actorId: string,
  countId: string,
): Promise<boolean> {
  const f = toDecimal(u.unitFactor!).toString();
  return db.$transaction(async (tx) => {
    const item = await tx.ingredient.findUniqueOrThrow({ where: { sku: u.code }, select: { id: true, unit: true } });
    if (item.unit === u.unitTo) return false;
    const id = item.id;
    await tx.$executeRaw`UPDATE "Ingredient" SET "unit" = ${u.unitTo},
      "onHandQty" = "onHandQty" * ${f}::numeric, "avgUnitCost" = "avgUnitCost" / ${f}::numeric,
      "openingQty" = "openingQty" * ${f}::numeric, "openingAvgCost" = "openingAvgCost" / ${f}::numeric,
      "reorderLevel" = "reorderLevel" * ${f}::numeric
      WHERE "id" = ${id}`;
    await tx.$executeRaw`UPDATE "IngredientIssue" SET "qty" = "qty" * ${f}::numeric,
      "unitCostAtIssue" = "unitCostAtIssue" / ${f}::numeric
      WHERE "ingredientId" = ${id}`;
    await tx.$executeRaw`UPDATE "IngredientReturnLine" SET "quantity" = "quantity" * ${f}::numeric,
      "declaredQuantity" = "declaredQuantity" * ${f}::numeric, "unitCost" = "unitCost" / ${f}::numeric
      WHERE "issueId" IN (SELECT "id" FROM "IngredientIssue" WHERE "ingredientId" = ${id})`;
    await tx.$executeRaw`UPDATE "IngredientReceipt" SET "qty" = "qty" * ${f}::numeric,
      "unitCost" = "unitCost" / ${f}::numeric
      WHERE "ingredientId" = ${id}`;
    await tx.$executeRaw`UPDATE "IngredientAdjustment" SET "delta" = "delta" * ${f}::numeric,
      "beforeQty" = "beforeQty" * ${f}::numeric, "afterQty" = "afterQty" * ${f}::numeric
      WHERE "ingredientId" = ${id}`;
    await tx.$executeRaw`UPDATE "ChefRequisitionLine" SET "requestedQty" = "requestedQty" * ${f}::numeric,
      "issuedQty" = "issuedQty" * ${f}::numeric, "unitCostSnapshot" = "unitCostSnapshot" / ${f}::numeric
      WHERE "ingredientId" = ${id}`;
    await tx.$executeRaw`UPDATE "PurchaseRequisitionLine" SET "requestedQty" = "requestedQty" * ${f}::numeric,
      "issuedQty" = "issuedQty" * ${f}::numeric, "unitCostSnapshot" = "unitCostSnapshot" / ${f}::numeric
      WHERE "ingredientId" = ${id}`;
    await tx.$executeRaw`UPDATE "RecipeIngredient" SET "qty" = "qty" * ${f}::numeric
      WHERE "ingredientId" = ${id}`;
    await tx.$executeRaw`UPDATE "VendorPOLine" SET "quantity" = "quantity" * ${f}::numeric,
      "receivedQty" = "receivedQty" * ${f}::numeric, "unitPrice" = "unitPrice" / ${f}::numeric
      WHERE "ingredientId" = ${id}`;
    await tx.$executeRaw`UPDATE "GRNLine" SET "orderedQty" = "orderedQty" * ${f}::numeric,
      "acceptedQty" = "acceptedQty" * ${f}::numeric, "rejectedQty" = "rejectedQty" * ${f}::numeric
      WHERE "poLineId" IN (SELECT "id" FROM "VendorPOLine" WHERE "ingredientId" = ${id})`;
    await tx.$executeRaw`UPDATE "OrderBudgetLine" SET "quantity" = "quantity" * ${f}::numeric,
      "unitCost" = "unitCost" / ${f}::numeric
      WHERE "ingredientId" = ${id}`;
    await tx.auditLog.create({
      data: {
        userId: actorId,
        action: "INGREDIENT_UNIT_CONVERTED",
        entity: "Ingredient",
        entityId: id,
        payloadHash: sha256Json({ from: u.unitFrom, to: u.unitTo, factor: f, countId }),
      },
    });
    return true;
  });
}

export interface StockCountResult {
  merged: number;
  created: number;
  quantitiesChanged: number;
  costsSet: number;
  unitsChanged: number;
  /** Items moved to another unit with their history, not recounted. */
  converted: number;
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

  const result: StockCountResult = { merged: 0, created: 0, quantitiesChanged: 0, costsSet: 0, unitsChanged: 0, converted: 0 };

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

  // Conversions carry their own quantity and cost; they take no part in the
  // count posting or the cost pass below.
  for (const u of plan.update.filter((u) => u.unitFactor)) {
    if (await convertIngredientUnit(u, actorId, count.id)) result.converted++;
  }
  const counted = plan.update.filter((u) => !u.unitFactor);

  const unitChanges = counted.filter((u) => u.unitTo);
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
  for (const u of counted) {
    const item = await db.ingredient.findUniqueOrThrow({ where: { sku: u.code }, select: { id: true } });
    lines.push({ ingredientId: item.id, physicalCount: u.qtyTo });
  }
  if (lines.length > 0) {
    const posted = await postInventoryAudit({ lines, notes: `Stock count ${count.id} (${count.source})` });
    if (!posted.ok) throw new Error(`count posting: ${posted.error}`);
    result.quantitiesChanged = posted.changes.length;
  }

  for (const u of counted) {
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
