import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { BanquetItemSource } from "@prisma/client";
import { db } from "@/server/db";
import { resetEverythingKeepParties } from "@/server/actions/admin-reset";
import { importCatalogueFromFiles } from "@/server/actions/catalogue-import";
import { asAdmin, asStore, ensureSeeded, expectRefused, mustOk } from "../harness";

/**
 * The catalogue import behind a button, which is the only way go-live can
 * actually happen: production has no shell. 00-reset-and-import covers the
 * CLI; what this file pins is the part the CLI cannot have — the role gate,
 * the audit row, and the opening receipt landing on the admin who pressed it
 * rather than on whichever admin the script picks when nobody is signed in.
 *
 * Order matters: the erase/import rehearsal is last because it empties the
 * fixtures every earlier test reads.
 */

const OPENING_NOTE = "Opening balance (catalogue import)";

beforeAll(async () => {
  await ensureSeeded();
});

describe("import catalogue action", () => {
  it("refuses anyone but an admin", async () => {
    await asStore();
    const why = await expectRefused(() => importCatalogueFromFiles());
    expect(why).toBeTruthy();
  });

  it("is safe to press twice — updates, never re-posts opening stock", async () => {
    const before = await db.banquetReceipt.count({ where: { sourceNote: OPENING_NOTE } });
    await asAdmin();
    const res = mustOk(await importCatalogueFromFiles(), "import catalogue");
    expect({
      kitchenCreated: res.kitchenCreated,
      kitchenUpdated: res.kitchenUpdated,
      fnbCreated: res.fnbCreated,
      fnbUpdated: res.fnbUpdated,
      fnbOpeningLines: res.fnbOpeningLines,
    }).toEqual({
      kitchenCreated: 0,
      kitchenUpdated: 405,
      fnbCreated: 0,
      fnbUpdated: 196,
      fnbOpeningLines: 0,
    });
    const after = await db.banquetReceipt.count({ where: { sourceNote: OPENING_NOTE } });
    expect(after).toBe(before);
  });

  it("puts every item on its shelf, and never overrides the store's own choice or a live unit", async () => {
    await asAdmin();
    // The catalogue file names the shelf; the seeded rows started as OTHER.
    const shelf = async (sku: string) =>
      (await db.ingredient.findUniqueOrThrow({ where: { sku }, select: { subStore: true } })).subStore;
    expect(await shelf("GP-001")).toBe("MILK"); // Paneer
    expect(await shelf("GP-005")).toBe("GROCERY"); // Masoor Dal
    expect(await shelf("GP-186")).toBe("VEGETABLE"); // Cabbage
    expect(await shelf("GP-267")).toBe("FROZEN"); // Samosa
    expect(await shelf("GP-522")).toBe("OTHER"); // Soap

    // A shelf the store keeper set by hand, and a unit a stock count
    // converted, both survive the button being pressed again.
    await db.ingredient.update({ where: { sku: "GP-097" }, data: { subStore: "WATER" } });
    await db.ingredient.update({ where: { sku: "GP-098" }, data: { unit: "bag" } });
    mustOk(await importCatalogueFromFiles(), "import catalogue");
    expect(await shelf("GP-097")).toBe("WATER");
    expect((await db.ingredient.findUniqueOrThrow({ where: { sku: "GP-098" }, select: { unit: true } })).unit).toBe("bag");
    await db.ingredient.update({ where: { sku: "GP-097" }, data: { subStore: "GROCERY" } });
    await db.ingredient.update({ where: { sku: "GP-098" }, data: { unit: "kg" } });
  });

  it("records who ran it", async () => {
    const admin = await asAdmin();
    mustOk(await importCatalogueFromFiles(), "import catalogue");
    const audit = await db.auditLog.findFirst({
      where: { action: "CATALOGUE_IMPORT" },
      orderBy: { at: "desc" },
    });
    expect(audit?.userId).toBe(admin.id);
  });
});

describe("go-live: erase, then import from the button", () => {
  it("fills an emptied system and books the opening stock to the admin", async () => {
    const admin = await asAdmin();
    mustOk(await resetEverythingKeepParties("ERASE EVERYTHING"), "erase everything");
    expect(await db.ingredient.count()).toBe(0);
    expect(await db.banquetItem.count()).toBe(0);

    const res = mustOk(await importCatalogueFromFiles(), "import catalogue");
    expect({ kitchen: res.kitchenCreated, fnb: res.fnbCreated }).toEqual({
      kitchen: 405,
      fnb: 196,
    });

    const [kitchen, inhouse, hired] = await Promise.all([
      db.ingredient.count(),
      db.banquetItem.count({ where: { source: BanquetItemSource.IN_HOUSE } }),
      db.banquetItem.count({ where: { source: BanquetItemSource.HIRED } }),
    ]);
    expect({ kitchen, inhouse, hired }).toEqual({ kitchen: 405, inhouse: 154, hired: 42 });

    // Every kitchen item lands on a shelf from the file: only the nine
    // non-food consumables (gas, soap, scrubbers) are left as "other".
    const byShelf = await db.ingredient.groupBy({ by: ["subStore"], _count: { _all: true } });
    expect(Object.fromEntries(byShelf.map((r) => [r.subStore, r._count._all]))).toEqual({
      GROCERY: 156, FROZEN: 137, VEGETABLE: 89, MILK: 12, WATER: 2, OTHER: 9,
    });

    // The F&B opening count is a document, not a bare number on the item row
    // — that is what keeps the stock ledger agreeing with the shelf. It is
    // booked against whoever pressed the button.
    const receipt = await db.banquetReceipt.findFirst({
      where: { sourceNote: OPENING_NOTE },
      include: { lines: true },
    });
    expect(receipt?.recordedById).toBe(admin.id);
    expect(receipt?.lines.length).toBe(res.fnbOpeningLines);
    expect(res.fnbOpeningLines).toBeGreaterThan(0);
  });
});
