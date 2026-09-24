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
    expect(result).toEqual({ merged: 1, created: 1, quantitiesChanged: 3, costsSet: 2, unitsChanged: 1, converted: 0 });

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

  it("moves a packet item to kilos with its history, value unchanged", async () => {
    await asAdmin();
    const admin = desk("admin").id;
    // 7.5 packets of 200 g at ₹102.86 a packet, two of them already issued.
    const made = mustOk(
      await createIngredient({ name: "Count Probe Masala 200gm", unit: "pct", openingQty: "7.5", openingAvgCost: "102.86" }),
      "masala",
    );
    const code = await sku(made.id);
    await db.ingredientIssue.create({
      data: { ingredientId: made.id, qty: "2", unitCostAtIssue: "102.86", issuedById: admin, issuedAt: new Date() },
    });
    const valueBefore = 7.5 * 102.86;

    const count: StockCountFile = {
      id: "2099-01-04", takenOn: "2099-01-04", source: "kg", merges: [],
      rows: [{ row: 2, code, name: "Count Probe Masala 200gm", unit: "kg", setUnit: "kg", unitFactor: "0.2" }],
    };
    const plan = await planStockCount(count);
    expect(plan.problems).toEqual([]);
    expect(plan.update).toEqual([
      expect.objectContaining({ code, qtyFrom: "7.5", qtyTo: "1.5", costFrom: "102.86", costTo: "514.3", unitFrom: "pct", unitTo: "kg", unitFactor: "0.2" }),
    ]);

    const result = await applyStockCountPlan(count, admin);
    expect(result).toEqual({ merged: 0, created: 0, quantitiesChanged: 0, costsSet: 0, unitsChanged: 0, converted: 1 });

    const item = await db.ingredient.findUniqueOrThrow({ where: { id: made.id } });
    expect(item.unit).toBe("kg");
    expect(item.onHandQty.toString()).toBe("1.5");
    expect(item.avgUnitCost.toString()).toBe("514.3");
    expect(item.onHandQty.times(item.avgUnitCost).toNumber()).toBeCloseTo(valueBefore, 2);
    // History followed: 2 packets became 0.4 kg at the kilo price; the
    // issue is worth exactly what it was.
    const issue = await db.ingredientIssue.findFirstOrThrow({ where: { ingredientId: made.id, qty: { gt: 0 } }, orderBy: { createdAt: "desc" } });
    expect(issue.qty.toString()).toBe("0.4");
    expect(issue.unitCostAtIssue.toString()).toBe("514.3");
    expect(issue.qty.times(issue.unitCostAtIssue).toNumber()).toBeCloseTo(2 * 102.86, 2);
    // A file that asks again finds it already in kilos and has nothing to do.
    const again = await planStockCount({ ...count, id: "2099-01-05" });
    expect(again.update).toEqual([]);
    expect(again.problems).toEqual([]);
  });

  it("refuses a row with neither a quantity nor a conversion", async () => {
    await asAdmin();
    const code = await sku(seeded().ingredients.plentiful);
    const plan = await planStockCount({
      id: "2099-01-06", takenOn: "2099-01-06", source: "blank", merges: [],
      rows: [{ row: 2, code, name: "Maida", unit: "kg" }],
    });
    expect(plan.problems).toEqual([expect.stringMatching(/no quantity/)]);
  });

  it("the real count files plan clean against the imported catalogue", async () => {
    await asAdmin();
    const { readFileSync } = await import("node:fs");
    const sept11 = JSON.parse(readFileSync("data/stock-counts/2026-09-11.json", "utf8")) as StockCountFile;
    const plan = await planStockCount(sept11);
    expect(plan.problems).toEqual([]);
    expect(plan.merges).toHaveLength(1);
    expect(plan.create).toHaveLength(4);
    expect(plan.update.length + plan.create.length).toBe(sept11.rows.length);

    // 12 Sep: 38 packet items back to kilos, one recount. The catalogue file
    // has said kilos for those 38 since, so against a fresh import every
    // convert row finds nothing to do and only the recount is left — the
    // conversion never runs twice.
    const sept12 = JSON.parse(readFileSync("data/stock-counts/2026-09-12.json", "utf8")) as StockCountFile;
    expect(sept12.rows.filter((r) => r.unitFactor)).toHaveLength(38);
    const plan12 = await planStockCount(sept12);
    expect(plan12.problems).toEqual([]);
    expect(plan12.update.map((u) => u.code)).toEqual(["GP-114"]);
  });
});
