import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createIngredient } from "@/server/actions/inventory";
import { applyStockCountPlan, planStockCount, type StockCountFile } from "@/server/stock-count-core";
import { asAdmin, desk, ensureSeeded, mustOk, seeded } from "../harness";

/**
 * The store's paper count, applied through the app's own paths.
 *
 * What matters is what the client said it must never do: create a twin. So
 * a "new" row whose name already exists updates that item instead, and a
 * count cannot be applied twice. Everything else — merge, create, unit,
 * quantity, price — is asserted against the row afterwards.
 */

const sku = async (id: string) =>
  (await db.ingredient.findUniqueOrThrow({ where: { id }, select: { sku: true } })).sku;

beforeAll(async () => {
  await ensureSeeded();
});

describe("applying a stock count", () => {
  it("does everything the sheet asks, and nothing twice", async () => {
    await asAdmin();
    const { ingredients } = seeded();
    const scarceSku = await sku(ingredients.scarce);

    // Two twins to merge, made the ordinary way.
    const keep = mustOk(await createIngredient({ name: "Count Probe Rice A", unit: "kg", openingQty: "10" }), "twin A");
    const fold = mustOk(await createIngredient({ name: "Count Probe Rice B", unit: "kg", openingQty: "4" }), "twin B");
    const keepSku = await sku(keep.id);
    const foldSku = await sku(fold.id);

    const count: StockCountFile = {
      id: "2099-01-01",
      takenOn: "2099-01-01",
      source: "test sheet",
      merges: [{ from: foldSku, into: keepSku }],
      rows: [
        { row: 2, code: scarceSku, name: "Paneer", unit: "kg", qty: "2.25", cost: "410" },
        // The merged survivor is then counted at the sheet's figure.
        { row: 3, code: keepSku, name: "Count Probe Rice A", unit: "kg", setUnit: "pct", qty: "9", cost: null },
        { row: 4, new: true, name: "Count Probe Brand New", unit: "btl", qty: "3", cost: "120" },
        // "new" but the name exists (different case) — must update, never duplicate.
        { row: 5, new: true, name: "MAIDA", unit: "kg", qty: "12.5", cost: "44" },
      ],
    };

    const plan = await planStockCount(count);
    expect(plan.alreadyApplied).toBe(false);
    expect(plan.problems).toEqual([]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.create.map((c) => c.name)).toEqual(["Count Probe Brand New"]);
    expect(plan.existing.map((e) => e.code)).toEqual([await sku(ingredients.plentiful)]);
    // A plan writes nothing.
    expect((await db.ingredient.findUniqueOrThrow({ where: { id: fold.id } })).active).toBe(true);

    const result = await applyStockCountPlan(count, desk("admin").id);
    expect(result).toEqual({ merged: 1, created: 1, quantitiesChanged: 3, costsSet: 2, unitsChanged: 1 });

    const [scarce, plentiful, kept, folded, created, twins] = await Promise.all([
      db.ingredient.findUniqueOrThrow({ where: { id: ingredients.scarce } }),
      db.ingredient.findUniqueOrThrow({ where: { id: ingredients.plentiful } }),
      db.ingredient.findUniqueOrThrow({ where: { id: keep.id } }),
      db.ingredient.findUniqueOrThrow({ where: { id: fold.id } }),
      db.ingredient.findFirstOrThrow({ where: { name: "Count Probe Brand New" } }),
      db.ingredient.count({ where: { name: { equals: "maida", mode: "insensitive" } } }),
    ]);
    expect(scarce.onHandQty.toString()).toBe("2.25");
    expect(scarce.avgUnitCost.toString()).toBe("410");
    // The "new" MAIDA row landed on the existing Maida, case and all.
    expect(plentiful.onHandQty.toString()).toBe("12.5");
    expect(plentiful.avgUnitCost.toString()).toBe("44");
    // Merged: B folded into A, retired; A then counted to 9 in its new unit.
    expect(folded.active).toBe(false);
    expect(kept.onHandQty.toString()).toBe("9");
    expect(kept.unit).toBe("pct");
    expect(created.onHandQty.toString()).toBe("3");
    expect(created.avgUnitCost.toString()).toBe("120");
    expect(created.unit).toBe("btl");
    // The whole point.
    expect(twins).toBe(1);

    // Applied once. The marker refuses a second pass.
    expect((await planStockCount(count)).alreadyApplied).toBe(true);
    await expect(applyStockCountPlan(count, desk("admin").id)).rejects.toThrow(/already been applied/);
  });

  it("refuses a sheet that counts the same item twice", async () => {
    await asAdmin();
    const code = await sku(seeded().ingredients.plentiful);
    const count: StockCountFile = {
      id: "2099-01-03", takenOn: "2099-01-03", source: "dup", merges: [],
      rows: [
        { row: 2, code, name: "Maida", unit: "kg", qty: "1", cost: null },
        { row: 9, new: true, name: "maida", unit: "kg", qty: "5", cost: null },
      ],
    };
    const plan = await planStockCount(count);
    expect(plan.problems).toEqual([expect.stringMatching(/already counted on row 2/)]);
    await expect(applyStockCountPlan(count, desk("admin").id)).rejects.toThrow(/Fix the count file/);
  });

  it("refuses to apply a file with a code the catalogue lacks, writing nothing", async () => {
    await asAdmin();
    const count: StockCountFile = {
      id: "2099-01-02", takenOn: "2099-01-02", source: "bad", merges: [],
      rows: [{ row: 2, code: "GP-99999", name: "Ghost", unit: "kg", qty: "1", cost: null }],
    };
    expect((await planStockCount(count)).problems).toHaveLength(1);
    await expect(applyStockCountPlan(count, desk("admin").id)).rejects.toThrow(/Fix the count file/);
    expect(await db.auditLog.count({ where: { entityId: "2099-01-02" } })).toBe(0);
  });

  it("the real count file plans clean against the imported catalogue", async () => {
    await asAdmin();
    const { readFileSync } = await import("node:fs");
    const count = JSON.parse(readFileSync("data/stock-counts/2026-09-11.json", "utf8")) as StockCountFile;
    const plan = await planStockCount(count);
    expect(plan.problems).toEqual([]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.create).toHaveLength(4);
    expect(plan.update.length + plan.create.length).toBe(count.rows.length);
  });
});
