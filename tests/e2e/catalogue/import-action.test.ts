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
