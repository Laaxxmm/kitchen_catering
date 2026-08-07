import "./db-url";

import { beforeAll, describe, expect, it } from "vitest";
import { StockStore } from "@prisma/client";
import { recordStockTransfer } from "@/server/actions/stock-transfer";
import {
  asStore,
  db,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  istInput,
  mustOk,
  read,
  spareIngredient,
  stockUp,
} from "./harness";

/**
 * Stock moving between the kitchen store and the F&B store. The two hold
 * DIFFERENT rows — foil in the kitchen is an Ingredient, foil in F&B is a
 * BanquetItem — so a transfer is never one quantity moving: it is one row
 * down and a different row up, in one transaction, with both rows named
 * explicitly by the user. Nothing is matched by name and nothing is
 * converted between units.
 */

let ingredientId: string;
/** An F&B row measured the same way as the kitchen one ("pcs" vs "nos"). */
let sameMeasure: { id: string; name: string; unit: string };
/** An F&B row in a genuinely different measure — a 1:1 move corrupts both. */
let otherMeasure: { id: string; name: string; unit: string };

const banquetStock = async (id: string) =>
  (await db.banquetItem.findUniqueOrThrow({ where: { id }, select: { currentStock: true } }))
    .currentStock;

function transfer(input: {
  fromStore: StockStore;
  fromItemId: string;
  toStore: StockStore;
  toItemId: string;
  quantity: string;
  unitsAcknowledged?: boolean;
}) {
  asStore();
  return recordStockTransfer({ transferredAt: istInput(new Date()), ...input });
}

beforeAll(async () => {
  await ensureSeeded();
  // The kitchen side: an untouched line counted in "nos".
  ingredientId = (
    await db.ingredient.findFirstOrThrow({
      where: { active: true, openingQty: 0, unit: "nos" },
      orderBy: { sku: "asc" },
      select: { id: true },
    })
  ).id;
  [sameMeasure, otherMeasure] = await Promise.all([
    // "pcs" and "nos" are the same measure spelled differently — that must
    // move straight through.
    db.banquetItem.findFirstOrThrow({
      where: { active: true, unit: "pcs" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unit: true },
    }),
    db.banquetItem.findFirstOrThrow({
      where: { active: true, unit: "kg" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, unit: true },
    }),
  ]);
  await stockUp(ingredientId, "20", "40");
});

describe("kitchen → F&B and back", () => {
  it("moves both sides in one go and carries the kitchen's cost across", async () => {
    const banquetBefore = await banquetStock(sameMeasure.id);

    const out = mustOk(
      await transfer({
        fromStore: StockStore.KITCHEN,
        fromItemId: ingredientId,
        toStore: StockStore.FNB,
        toItemId: sameMeasure.id,
        quantity: "5",
      }),
      "kitchen → F&B",
    );

    expectDecimal(await read.onHand(ingredientId), "15", "kitchen after the transfer out");
    expectDecimal(
      await banquetStock(sameMeasure.id),
      banquetBefore.plus(5).toString(),
      "F&B after the transfer in",
    );

    const row = await db.stockTransfer.findUniqueOrThrow({ where: { id: out.id } });
    // The document names both rows as they stood, not one shared item.
    expect(row.fromItemId).toBe(ingredientId);
    expect(row.toItemId).toBe(sameMeasure.id);
    expect(row.toItemName).toBe(sameMeasure.name);
    expect(row.fromItemName).not.toBe(row.toItemName);
    expectDecimal(row.quantity, "5", "transfer quantity");
    // Value leaves the kitchen at the kitchen's own average, and the average
    // itself does not move: a transfer out is not a re-pricing.
    expectDecimal(row.unitCost, "40", "cost carried across");
    expectDecimal(
      (await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).avgUnitCost,
      "40",
      "kitchen average after the transfer out",
    );

    // …and back again. F&B keeps no valuation, so the kitchen takes its own
    // stock back in at its own average rather than inventing a price.
    const back = mustOk(
      await transfer({
        fromStore: StockStore.FNB,
        fromItemId: sameMeasure.id,
        toStore: StockStore.KITCHEN,
        toItemId: ingredientId,
        quantity: "5",
      }),
      "F&B → kitchen",
    );
    expectDecimal(await read.onHand(ingredientId), "20", "kitchen after the return leg");
    expectDecimal(
      await banquetStock(sameMeasure.id),
      banquetBefore.toString(),
      "F&B after the return leg",
    );
    const after = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    expectDecimal(after.avgUnitCost, "40", "kitchen average after the return leg");
    expectDecimal(
      (await db.stockTransfer.findUniqueOrThrow({ where: { id: back.id } })).unitCost,
      "40",
      "cost on the return leg",
    );
  });
});

describe("a transfer that would be two wrong numbers", () => {
  it("is refused below zero, and leaves both sides exactly where they were", async () => {
    const kitchenBefore = await read.onHand(ingredientId);
    const banquetBefore = await banquetStock(sameMeasure.id);

    const refusal = await expectRefused(() =>
      transfer({
        fromStore: StockStore.KITCHEN,
        fromItemId: ingredientId,
        toStore: StockStore.FNB,
        toItemId: sameMeasure.id,
        quantity: "999",
      }),
    );
    expect(refusal).toMatch(/Only 20 nos .* can't transfer 999/i);

    expectDecimal(await read.onHand(ingredientId), kitchenBefore, "kitchen unchanged");
    expectDecimal(await banquetStock(sameMeasure.id), banquetBefore.toString(), "F&B unchanged");
  });

  it("is refused when both sides are the same store", async () => {
    const other = await spareIngredient();
    expect(
      await expectRefused(() =>
        transfer({
          fromStore: StockStore.KITCHEN,
          fromItemId: ingredientId,
          toStore: StockStore.KITCHEN,
          toItemId: other,
          quantity: "1",
        }),
      ),
    ).toMatch(/stock adjustment, not a transfer/i);
    expectDecimal(await read.onHand(ingredientId), "20", "kitchen unchanged");
  });
});

describe("units and identity", () => {
  it("needs the explicit acknowledgement before crossing measures, and converts nothing", async () => {
    const before = await banquetStock(otherMeasure.id);

    const refusal = await expectRefused(() =>
      transfer({
        fromStore: StockStore.KITCHEN,
        fromItemId: ingredientId,
        toStore: StockStore.FNB,
        toItemId: otherMeasure.id,
        quantity: "2",
      }),
    );
    expect(refusal).toMatch(/tracked in nos/i);
    expect(refusal).toMatch(new RegExp(`in ${otherMeasure.unit}`, "i"));
    expect(refusal).toMatch(/Nothing is converted/i);
    expectDecimal(await banquetStock(otherMeasure.id), before.toString(), "F&B unchanged");

    mustOk(
      await transfer({
        fromStore: StockStore.KITCHEN,
        fromItemId: ingredientId,
        toStore: StockStore.FNB,
        toItemId: otherMeasure.id,
        quantity: "2",
        unitsAcknowledged: true,
      }),
      "acknowledged cross-unit transfer",
    );
    // 2 nos left the kitchen and 2 kg arrived in F&B — no conversion, which
    // is exactly why the tick box exists.
    expectDecimal(await read.onHand(ingredientId), "18", "kitchen after the acknowledged move");
    expectDecimal(
      await banquetStock(otherMeasure.id),
      before.plus(2).toString(),
      "F&B after the acknowledged move",
    );
  });

  it("never resolves an item by name — the id has to belong to the store it names", async () => {
    const kitchenBefore = await read.onHand(ingredientId);
    const anotherKitchenItem = await spareIngredient();

    // A kitchen id handed to the F&B side. The row exists — just not in the
    // store it was named under — and no name lookup rescues it.
    expect(
      await expectRefused(() =>
        transfer({
          fromStore: StockStore.KITCHEN,
          fromItemId: ingredientId,
          toStore: StockStore.FNB,
          toItemId: anotherKitchenItem,
          quantity: "1",
        }),
      ),
    ).toMatch(/destination item no longer exists/i);

    expect(
      await expectRefused(() =>
        transfer({
          fromStore: StockStore.FNB,
          fromItemId: ingredientId,
          toStore: StockStore.KITCHEN,
          toItemId: ingredientId,
          quantity: "1",
        }),
      ),
    ).toMatch(/source item no longer exists/i);

    expectDecimal(await read.onHand(ingredientId), kitchenBefore, "kitchen unchanged");
  });
});
