import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { removeSampleCatalogueItems } from "@/server/actions/catalogue-cleanup";
import { asAdmin, asChef, ensureSeeded, expectRefused, mustOk, stockUp } from "../harness";

/**
 * Taking the seeded sample catalogue back out of a system that is already
 * live.
 *
 * The client could not reset: the day's orders were already in. So the
 * cleanup has to be surgical — remove what the import did not create, and
 * never remove anything a document points at. An ingredient sitting on a
 * receipt or a recipe line is hidden instead, because deleting it would
 * take the document's own reading with it.
 */

async function sampleIngredient(sku: string, name: string) {
  return db.ingredient.create({
    data: { sku, name, unit: "kg", onHandQty: "0", avgUnitCost: "0" },
  });
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("removing the sample catalogue", () => {
  it("refuses anyone below manager", async () => {
    await asChef();
    expect(await expectRefused(() => removeSampleCatalogueItems(true))).toBeTruthy();
  });

  it("deletes an unused sample item and leaves the imported catalogue alone", async () => {
    const before = await db.ingredient.count({ where: { sku: { startsWith: "GP-" } } });
    await sampleIngredient("STR-9001", "Sample only, never used");
    await asAdmin();

    const preview = mustOk(await removeSampleCatalogueItems(true), "preview");
    expect(preview.kitchen.deleted).toBe(1);
    // A preview writes nothing.
    expect(await db.ingredient.findUnique({ where: { sku: "STR-9001" } })).not.toBeNull();

    mustOk(await removeSampleCatalogueItems(false), "cleanup");
    expect(await db.ingredient.findUnique({ where: { sku: "STR-9001" } })).toBeNull();
    expect(await db.ingredient.count({ where: { sku: { startsWith: "GP-" } } })).toBe(before);
  });

  it("hides — never deletes — a sample item a document points at", async () => {
    const used = await sampleIngredient("STR-9002", "Sample with a receipt against it");
    await stockUp(used.id, "5");
    await asAdmin();

    const preview = mustOk(await removeSampleCatalogueItems(true), "preview");
    expect(preview.kitchen.deactivated).toBe(1);
    expect(preview.kitchen.keptNames).toContain("Sample with a receipt against it");

    mustOk(await removeSampleCatalogueItems(false), "cleanup");
    const after = await db.ingredient.findUnique({ where: { sku: "STR-9002" } });
    // Still there for the receipt to read, out of the pickers.
    expect(after?.active).toBe(false);
    expect(await db.ingredientReceipt.count({ where: { ingredientId: used.id } })).toBe(1);
  });

  it("is a no-op once the catalogue is clean", async () => {
    await asAdmin();
    mustOk(await removeSampleCatalogueItems(false), "first pass");
    const second = mustOk(await removeSampleCatalogueItems(true), "second preview");
    expect(second.kitchen.deleted + second.fnb.deleted).toBe(0);
  });
});
