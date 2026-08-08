import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { removeSampleCatalogueItems } from "@/server/actions/catalogue-cleanup";
import { asAdmin, asChef, ensureSeeded, expectRefused, mustOk, stockUp } from "../harness";

/**
 * Folding the seeded sample catalogue back into the client's own, on a
 * system that is already live.
 *
 * The shape of the real incident: the demo STR- items returned on a deploy,
 * the team received stock against them because those were the rows showing
 * figures, and the imported GP- items sat at zero. So a delete would have
 * taken the stock and its documents with it. Every sample row that has a GP
 * twin is merged instead — the figures move to the item the team is meant to
 * be picking.
 */

/**
 * A demo row as the seed leaves it: no GP code, stock straight on the row.
 *
 * Names carry a double space on purpose. `Ingredient_active_name_unique` is a
 * partial unique index on `lower(btrim(name))`, so a twin that differs only
 * in case or outer padding could not be active at the same time — which is
 * why the pairs in production differ inside the name instead. The cleanup's
 * matcher collapses internal whitespace, so it still recognises the pair.
 */
async function sampleIngredient(sku: string, name: string, unit = "kg", qty = "0") {
  return db.ingredient.create({
    data: { sku, name, unit, onHandQty: qty, avgUnitCost: "100" },
  });
}

async function gpTwin(sku: string, name: string, unit = "kg") {
  return db.ingredient.create({
    data: { sku, name, unit, onHandQty: "0", avgUnitCost: "0" },
  });
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("cleaning up the sample catalogue", () => {
  it("refuses anyone below manager", async () => {
    await asChef();
    expect(await expectRefused(() => removeSampleCatalogueItems(true))).toBeTruthy();
  });

  it("moves the stock and the history onto the GP twin", async () => {
    const twin = await gpTwin("GP-9101", "Cleanup Twin Rice");
    // The same item by any human reading: different case, and a double space
    // where the spreadsheet had one — which is how the pairs in production
    // slipped past the unique index.
    const sample = await sampleIngredient("STR-9101", "cleanup  twin  rice", "Kg", "0");
    await stockUp(sample.id, "12");
    await asAdmin();

    const preview = mustOk(await removeSampleCatalogueItems(true), "preview");
    const planned = preview.kitchen.merge.find((r) => r.sku === "STR-9101");
    expect(planned?.intoSku).toBe("GP-9101");
    // A preview writes nothing.
    expect((await db.ingredient.findUnique({ where: { id: twin.id } }))?.onHandQty.toString()).toBe("0");

    mustOk(await removeSampleCatalogueItems(false), "cleanup");

    const [after, source, receipts] = await Promise.all([
      db.ingredient.findUnique({ where: { id: twin.id } }),
      db.ingredient.findUnique({ where: { id: sample.id } }),
      db.ingredientReceipt.count({ where: { ingredientId: twin.id } }),
    ]);
    expect(after?.onHandQty.toString()).toBe("12");
    // The receipt the store booked now reads against the GP item.
    expect(receipts).toBe(1);
    // The demo row is retired, not deleted — the audit trail keeps its name.
    expect({ active: source?.active, qty: source?.onHandQty.toString() }).toEqual({
      active: false,
      qty: "0",
    });
  });

  it("refuses to merge across units rather than corrupting the figure", async () => {
    await gpTwin("GP-9102", "Cleanup Unit Clash", "kg");
    await sampleIngredient("STR-9102", "Cleanup  Unit  Clash", "pkt", "5");
    await asAdmin();

    const preview = mustOk(await removeSampleCatalogueItems(true), "preview");
    const blocked = preview.kitchen.blocked.find((r) => r.sku === "STR-9102");
    expect(blocked?.reason).toContain("pkt");

    mustOk(await removeSampleCatalogueItems(false), "cleanup");
    // Left exactly as it was: 5 pkt folded into kg would read as 5 kg.
    const still = await db.ingredient.findUnique({ where: { sku: "STR-9102" } });
    expect({ active: still?.active, qty: still?.onHandQty.toString() }).toEqual({
      active: true,
      qty: "5",
    });
  });

  it("deletes a sample item with no twin and nothing pointing at it", async () => {
    const before = await db.ingredient.count({ where: { sku: { startsWith: "GP-" } } });
    await sampleIngredient("STR-9103", "Cleanup Orphan, never used");
    await asAdmin();

    mustOk(await removeSampleCatalogueItems(false), "cleanup");
    expect(await db.ingredient.findUnique({ where: { sku: "STR-9103" } })).toBeNull();
    expect(await db.ingredient.count({ where: { sku: { startsWith: "GP-" } } })).toBe(before);
  });

  it("hides — never deletes — a twinless sample item a document points at", async () => {
    const used = await sampleIngredient("STR-9104", "Cleanup Orphan with a receipt");
    await stockUp(used.id, "3");
    await asAdmin();

    mustOk(await removeSampleCatalogueItems(false), "cleanup");
    const after = await db.ingredient.findUnique({ where: { id: used.id } });
    expect(after?.active).toBe(false);
    expect(await db.ingredientReceipt.count({ where: { ingredientId: used.id } })).toBe(1);
  });

  it("leaves nothing to do on a second run", async () => {
    await asAdmin();
    const plan = mustOk(await removeSampleCatalogueItems(true), "preview");
    expect({
      merge: plan.kitchen.merge.length,
      remove: plan.kitchen.remove.length + plan.fnb.remove.length,
      hide: plan.kitchen.hide.length + plan.fnb.hide.length,
    }).toEqual({ merge: 0, remove: 0, hide: 0 });
    // The unit clash is the one thing still standing — it needs a human, and
    // saying so every time is the point.
    expect(plan.kitchen.blocked.map((r) => r.sku)).toEqual(["STR-9102"]);
  });
});
