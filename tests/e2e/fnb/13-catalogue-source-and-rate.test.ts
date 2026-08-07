// FIRST import, always — see db-url.ts.
import "./db-url";
import { beforeAll, describe, expect, it } from "vitest";
import { BanquetItemSource } from "@prisma/client";
import { db } from "@/server/db";
import {
  deactivateBanquetItem,
  deleteBanquetItem,
  listBanquetPickerItems,
  recordBanquetIssue,
  upsertBanquetItem,
} from "@/server/actions/banquet";
import {
  asAccounts,
  asChef,
  asDelivery,
  asManager,
  asStore,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  istInput,
  mustOk,
} from "../harness";

/**
 * The source/rate model. "Soup bowl" is an in-house item AND a hired Melamine
 * one AND a hired Bonechina one at three different rates, so the name is not
 * the identity — (name, source, category) is, and the GP code carries the
 * source. Three counters run independently: the kitchen's GP-nnn must never
 * be handed to an F&B item, and the two F&B ones must never collide.
 */

const now = () => istInput(new Date());

/** The 154 in-house + 42 hired rows the import lays down. */
const IMPORTED_INHOUSE = 154;
const IMPORTED_HIRED = 42;

/** The in-house item the manager creates below, reused by the delete guard. */
let inHouseId: string;

async function sequenceNext(
  table: "GPItemCodeSequence" | "GPInhouseItemCodeSequence" | "GPHiredItemCodeSequence",
): Promise<number> {
  const row =
    table === "GPItemCodeSequence"
      ? await db.gPItemCodeSequence.findUnique({ where: { year: 0 } })
      : table === "GPInhouseItemCodeSequence"
        ? await db.gPInhouseItemCodeSequence.findUnique({ where: { year: 0 } })
        : await db.gPHiredItemCodeSequence.findUnique({ where: { year: 0 } });
  return row?.next ?? 0;
}

async function itemById(id: string) {
  return db.banquetItem.findUniqueOrThrow({ where: { id } });
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("the catalogue the client actually goes live on", () => {
  it("holds 154 in-house and 42 hired items", async () => {
    const [inHouse, hired] = await Promise.all([
      db.banquetItem.count({ where: { source: BanquetItemSource.IN_HOUSE } }),
      db.banquetItem.count({ where: { source: BanquetItemSource.HIRED } }),
    ]);
    expect({ inHouse, hired }).toEqual({ inHouse: IMPORTED_INHOUSE, hired: IMPORTED_HIRED });
  });

  it("already carries the same-named bowls at three different rates", async () => {
    const bowls = await db.banquetItem.findMany({
      where: { name: { equals: "soup bowl", mode: "insensitive" } },
      orderBy: { sku: "asc" },
    });
    expect(
      bowls.map((b) => [b.sku, b.source, b.category, b.rate?.toString() ?? null]),
    ).toEqual([
      ["GP-HR-004", BanquetItemSource.HIRED, "Melamine", "2.5"],
      ["GP-HR-008", BanquetItemSource.HIRED, "Bonechina", "3.5"],
      ["GP-IN-070", BanquetItemSource.IN_HOUSE, "Crockery", "0"],
    ]);
  });
});

describe("only management may change the catalogue", () => {
  it("turns away the store, F&B, the kitchen and accounts on create", async () => {
    for (const become of [asStore, asDelivery, asChef, asAccounts]) {
      become();
      const why = await expectRefused(() =>
        upsertBanquetItem({ name: "E2E Sneaky Item", unit: "pcs" }),
      );
      expect(why).toMatch(/Requires one of: ADMIN, MANAGER/);
    }
    expect(await db.banquetItem.count({ where: { name: "E2E Sneaky Item" } })).toBe(0);
  });
});

describe("the manager adds an in-house item and a hired one", () => {
  let hiredId: string;
  let kitchenCounterBefore: number;

  beforeAll(async () => {
    kitchenCounterBefore = await sequenceNext("GPItemCodeSequence");
  });

  it("codes the in-house item off the in-house counter", async () => {
    asManager();
    const created = mustOk(
      await upsertBanquetItem({
        name: "E2E Charger Plate",
        source: BanquetItemSource.IN_HOUSE,
        category: "Crockery",
        unit: "pcs",
        rate: "12.50",
        openingStock: "40",
        minStock: "10",
      }),
      "create in-house item",
    );
    inHouseId = created.id;

    const item = await itemById(inHouseId);
    // 154 imported rows, so the next code out of the in-house counter is 155.
    expect(item.sku).toBe(`GP-IN-${IMPORTED_INHOUSE + 1}`);
    expect(item.source).toBe(BanquetItemSource.IN_HOUSE);
    expectDecimal(item.rate, "12.5", "rate");
    expectDecimal(item.currentStock, "40", "opening stock");
  });

  it("books the opening stock as a real receipt, not a bare number", async () => {
    const line = await db.banquetReceiptLine.findFirstOrThrow({
      where: { itemId: inHouseId },
      include: { receipt: true },
    });
    expect(line.receipt.sourceNote).toMatch(/Opening balance/);
    expectDecimal(line.quantity, "40", "opening receipt qty");
  });

  it("codes the hired item off the hired counter", async () => {
    asManager();
    const created = mustOk(
      await upsertBanquetItem({
        name: "E2E Charger Plate",
        source: BanquetItemSource.HIRED,
        category: "Bonechina",
        unit: "pcs",
        rate: "4.00",
      }),
      "create hired item",
    );
    hiredId = created.id;

    const item = await itemById(hiredId);
    expect(item.sku).toBe(`GP-HR-0${IMPORTED_HIRED + 1}`);
    expect(item.source).toBe(BanquetItemSource.HIRED);
    expectDecimal(item.rate, "4", "hire rate");
  });

  it("never hands out the kitchen's GP-nnn, and never touches its counter", async () => {
    for (const id of [inHouseId, hiredId]) {
      const { sku } = await itemById(id);
      expect(sku).not.toMatch(/^GP-\d+$/);
    }
    expect(await sequenceNext("GPItemCodeSequence")).toBe(kitchenCounterBefore);
  });

  it("lets the same name live in three places at three rates", async () => {
    asManager();
    const third = mustOk(
      await upsertBanquetItem({
        name: "E2E Charger Plate",
        source: BanquetItemSource.HIRED,
        category: "Melamine",
        unit: "pcs",
        rate: "2.75",
      }),
      "create the third grade",
    );

    const all = await db.banquetItem.findMany({
      where: { name: "E2E Charger Plate" },
      orderBy: { sku: "asc" },
    });
    expect(all).toHaveLength(3);
    expect(new Set(all.map((i) => i.sku)).size).toBe(3);
    expect(all.map((i) => i.rate?.toString()).sort()).toEqual(["12.5", "2.75", "4"]);
    expect(all.some((i) => i.id === third.id)).toBe(true);
  });

  it("refuses a fourth one at the same name, source and grade", async () => {
    asManager();
    const why = await expectRefused(() =>
      upsertBanquetItem({
        name: "E2E Charger Plate",
        source: BanquetItemSource.HIRED,
        category: "Melamine",
        unit: "pcs",
        rate: "9",
      }),
    );
    expect(why).toMatch(/already exists/i);
    expect(await db.banquetItem.count({ where: { name: "E2E Charger Plate" } })).toBe(3);
  });

  it("shows all three on the picker, each with its own code, grade and rate", async () => {
    asDelivery();
    const picker = await listBanquetPickerItems();
    const mine = picker.filter((i) => i.name === "E2E Charger Plate");
    expect(mine).toHaveLength(3);
    expect(mine.map((i) => `${i.sku}·${i.source}·${i.category}·${i.rate}`).sort()).toEqual([
      `GP-HR-0${IMPORTED_HIRED + 1}·HIRED·Bonechina·4`,
      `GP-HR-0${IMPORTED_HIRED + 2}·HIRED·Melamine·2.75`,
      `GP-IN-${IMPORTED_INHOUSE + 1}·IN_HOUSE·Crockery·12.5`,
    ]);
  });

  it("moves only the one that was picked", async () => {
    asDelivery();
    mustOk(
      await recordBanquetIssue({
        issuedAt: now(),
        purpose: "Head table dressing",
        lines: [{ itemId: inHouseId, quantity: "10" }],
      }),
      "issue the in-house plate",
    );
    expectDecimal((await itemById(inHouseId)).currentStock, "30", "in-house on hand");
    // The hired namesakes never had stock and must not have moved.
    expectDecimal((await itemById(hiredId)).currentStock, "0", "hired on hand");
  });

  it("keeps the code and the source immutable on edit", async () => {
    asManager();
    mustOk(
      await upsertBanquetItem(
        {
          name: "E2E Charger Plate (large)",
          source: BanquetItemSource.HIRED,
          category: "Crockery",
          unit: "pcs",
          rate: "15.00",
        },
        inHouseId,
      ),
      "edit the in-house item",
    );
    const item = await itemById(inHouseId);
    expect(item.name).toBe("E2E Charger Plate (large)");
    expect(item.category).toBe("Crockery");
    expectDecimal(item.rate, "15", "new rate");
    // A GP code is permanent, and its prefix encodes the source — a flip here
    // would silently re-point every issue and PO line that cites the item.
    expect(item.sku).toBe(`GP-IN-${IMPORTED_INHOUSE + 1}`);
    expect(item.source).toBe(BanquetItemSource.IN_HOUSE);
  });
});

describe("retiring and deleting a catalogue item", () => {
  let victimId: string;

  beforeAll(async () => {
    asManager();
    victimId = mustOk(
      await upsertBanquetItem({
        name: "E2E Doomed Item",
        source: BanquetItemSource.IN_HOUSE,
        unit: "pcs",
      }),
      "create the item under test",
    ).id;
  });

  it("is refused to the store, F&B, the kitchen and accounts", async () => {
    // The items screen only shows these buttons to admin/manager, but a
    // server action is a callable endpoint of its own — and retiring an item
    // drops it out of every picker, which is a bigger catalogue change than
    // the edit those same desks are already refused.
    for (const become of [asStore, asDelivery, asChef, asAccounts]) {
      become();
      expect(await expectRefused(() => deactivateBanquetItem(victimId))).toMatch(
        /Requires one of: ADMIN, MANAGER/,
      );
      expect(await expectRefused(() => deleteBanquetItem(victimId))).toMatch(
        /Requires one of: ADMIN, MANAGER/,
      );
    }
    expect((await itemById(victimId)).active).toBe(true);
  });

  it("is allowed to the manager while the item has no history", async () => {
    asManager();
    mustOk(await deactivateBanquetItem(victimId), "deactivate");
    expect((await itemById(victimId)).active).toBe(false);
    mustOk(await deleteBanquetItem(victimId), "delete");
    expect(await db.banquetItem.count({ where: { id: victimId } })).toBe(0);
  });

  it("refuses to delete an item that has already moved", async () => {
    asManager();
    const why = await expectRefused(() => deleteBanquetItem(inHouseId));
    expect(why).toMatch(/has history/i);
    expect(why).toMatch(/Deactivate instead/i);
  });
});
