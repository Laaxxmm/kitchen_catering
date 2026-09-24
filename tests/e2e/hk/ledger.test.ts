// FIRST import, always — pins DATABASE_URL to the e2e container.
import "../harness/database-url";
import { beforeAll, describe, expect, it } from "vitest";
import { RoomType, StoreAdjustmentKind } from "@prisma/client";
import { db } from "@/server/db";
import { formatIST } from "@/lib/time";
import {
  consumptionByItem,
  deactivateHousekeepingItem,
  listHousekeepingIssues,
  recordHousekeepingIssue,
  recordHousekeepingReceipt,
  returnHousekeepingStock,
  reusablesByItem,
  upsertHousekeepingItem,
  upsertHousekeepingStaff,
  upsertRoom,
} from "@/server/actions/housekeeping";
import {
  asChef,
  asHousekeeping,
  asMaintenance,
  asStore,
  desk,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  flushDeferred,
  istInput,
  mustOk,
} from "../harness";

/**
 * The housekeeping ledger, end to end, as the housekeeping manager: opening
 * balance → receipt → issue (consumable and reusable) → return / write-off,
 * with every refusal that keeps the two counters honest, and the reports
 * that read them back.
 *
 * The database is shared with other suites running at the same time, so
 * every row this file creates carries a unique suffix and every assertion
 * is scoped to those rows.
 */

const tag = Date.now();
const now = () => istInput(new Date());
const today = () => formatIST(new Date(), "yyyy-MM-dd");

let roomId: string;
let staffId: string;
let soap: string; // consumable
let towel: string; // reusable
let soapIssueId: string;

async function stock(id: string) {
  return db.housekeepingItem.findUniqueOrThrow({
    where: { id },
    select: { currentStock: true, inCirculation: true, active: true, notes: true },
  });
}

async function newItem(opts: {
  name: string;
  reusable?: boolean;
  opening?: string;
  minStock?: string;
  notes?: string;
}) {
  const res = mustOk(
    await upsertHousekeepingItem({
      name: `${opts.name} ${tag}`,
      unit: "piece",
      reusable: opts.reusable ?? false,
      minStock: opts.minStock ?? null,
      openingStock: opts.opening ?? null,
      notes: opts.notes ?? null,
      active: true,
    }),
    `create ${opts.name}`,
  );
  return res.id;
}

function issue(lines: Array<{ itemId: string; quantity: string }>) {
  return recordHousekeepingIssue({ issuedAt: now(), staffId, roomId, lines });
}

function receipt(itemId: string, quantity: string) {
  return recordHousekeepingReceipt({ receivedAt: now(), lines: [{ itemId, quantity }] });
}

async function notifications(userId: string, dedupeKey: string) {
  return db.notification.findMany({ where: { userId, dedupeKey } });
}

beforeAll(async () => {
  await ensureSeeded();
  asHousekeeping();
  roomId = mustOk(
    await upsertRoom({ number: `E2E-${tag}`, type: RoomType.STANDARD, active: true }),
    "room",
  ).id;
  staffId = mustOk(
    await upsertHousekeepingStaff({ name: `E2E Housekeeper ${tag}`, active: true }),
    "staff",
  ).id;
});

describe("stock in", () => {
  it("an item with an opening balance gets an opening receipt line", async () => {
    asHousekeeping();
    soap = await newItem({ name: "Soap", opening: "10", notes: "keep me" });
    const lines = await db.housekeepingReceiptLine.findMany({
      where: { itemId: soap },
      include: { receipt: { select: { sourceContact: true } } },
    });
    expect(lines).toHaveLength(1);
    expectDecimal(lines[0].quantity, "10", "opening line");
    expect(lines[0].receipt.sourceContact).toBe("Opening balance");
    expectDecimal((await stock(soap)).currentStock, "10", "stock");
  });

  it("a receipt adds stock", async () => {
    asHousekeeping();
    mustOk(await receipt(soap, "5"), "receipt");
    expectDecimal((await stock(soap)).currentStock, "15", "stock");
  });

  it("refuses a receipt for an inactive item, by name", async () => {
    asHousekeeping();
    const dead = await newItem({ name: "Retired sponge" });
    mustOk(await deactivateHousekeepingItem(dead), "deactivate empty item");
    const why = await expectRefused(() => receipt(dead, "1"));
    expect(why).toMatch(/Retired sponge .* is inactive/);
  });
});

describe("stock out", () => {
  it("a consumable issue lowers stock and snapshots reusable=false", async () => {
    asHousekeeping();
    soapIssueId = mustOk(await issue([{ itemId: soap, quantity: "4" }]), "issue").id;
    const s = await stock(soap);
    expectDecimal(s.currentStock, "11", "stock");
    expectDecimal(s.inCirculation, "0", "in circulation");
    const line = await db.housekeepingIssueLine.findFirstOrThrow({ where: { issueId: soapIssueId } });
    expect(line.reusable).toBe(false);
  });

  it("a reusable issue moves stock into circulation and snapshots reusable=true", async () => {
    asHousekeeping();
    towel = await newItem({ name: "Bath towel", reusable: true, opening: "20" });
    const id = mustOk(await issue([{ itemId: towel, quantity: "6" }]), "issue").id;
    const s = await stock(towel);
    expectDecimal(s.currentStock, "14", "clean stock");
    expectDecimal(s.inCirculation, "6", "in circulation");
    const line = await db.housekeepingIssueLine.findFirstOrThrow({ where: { issueId: id } });
    expect(line.reusable).toBe(true);
  });

  it("two lines for the same item that together exceed stock are refused and nothing moves", async () => {
    asHousekeeping();
    const before = await db.housekeepingIssue.count({ where: { roomId } });
    // 11 on hand; 7 + 7 = 14 — each line alone would pass.
    const why = await expectRefused(() =>
      issue([
        { itemId: soap, quantity: "7" },
        { itemId: soap, quantity: "7" },
      ]),
    );
    expect(why).toMatch(/Not enough Soap/);
    expect(why).toMatch(/14 piece/);
    expectDecimal((await stock(soap)).currentStock, "11", "stock untouched");
    expect(await db.housekeepingIssue.count({ where: { roomId } })).toBe(before);
  });

  it("issuing an inactive item is refused", async () => {
    asHousekeeping();
    const dead = await newItem({ name: "Retired duster" });
    mustOk(await deactivateHousekeepingItem(dead), "deactivate empty item");
    const why = await expectRefused(() => issue([{ itemId: dead, quantity: "1" }]));
    expect(why).toMatch(/inactive/);
  });

  it("a quantity that rounds to nothing at 3 dp is refused", async () => {
    asHousekeeping();
    const why = await expectRefused(() => issue([{ itemId: soap, quantity: "0.0004" }]));
    expect(why).toMatch(/at least 0\.001/);
  });
});

describe("the reusable loop", () => {
  it("a return moves units back to clean stock and writes a RETURNED record", async () => {
    asHousekeeping();
    mustOk(
      await returnHousekeepingStock({
        itemId: towel,
        qty: "4",
        outcome: "returned",
        roomId,
        staffId,
        note: "laundry batch 3",
      }),
      "return",
    );
    const s = await stock(towel);
    expectDecimal(s.currentStock, "18", "clean stock");
    expectDecimal(s.inCirculation, "2", "in circulation");
    const adj = await db.housekeepingAdjustment.findFirstOrThrow({
      where: { itemId: towel, kind: StoreAdjustmentKind.RETURNED },
    });
    expectDecimal(adj.delta, "4", "delta");
    expectDecimal(adj.circulationDelta, "-4", "circulation delta");
    expectDecimal(adj.beforeQty, "14", "before");
    expectDecimal(adj.afterQty, "18", "after");
    expect(adj.reason).toBe("Returned from room");
    expect(adj.note).toBe("laundry batch 3");
    expect(adj.roomId).toBe(roomId);
    expect(adj.staffId).toBe(staffId);
    expect(adj.byId).toBe(desk("housekeeping").id);
  });

  it("'lost' lowers circulation only, writes a LOST record and tells MANAGER + ADMIN", async () => {
    asHousekeeping();
    mustOk(
      await returnHousekeepingStock({ itemId: towel, qty: "1", outcome: "lost", note: "torn" }),
      "write-off",
    );
    const s = await stock(towel);
    expectDecimal(s.currentStock, "18", "clean stock unchanged");
    expectDecimal(s.inCirculation, "1", "in circulation");
    const adj = await db.housekeepingAdjustment.findFirstOrThrow({
      where: { itemId: towel, kind: StoreAdjustmentKind.LOST },
    });
    expectDecimal(adj.delta, "0", "delta");
    expectDecimal(adj.circulationDelta, "-1", "circulation delta");
    expect(adj.reason).toBe("Lost or damaged");

    await flushDeferred();
    for (const who of ["manager", "admin"] as const) {
      const rows = await notifications(desk(who).id, `hk-lost:${adj.id}`);
      expect(rows, `${who} told`).toHaveLength(1);
      expect(rows[0].body).toContain(`1 piece of Bath towel ${tag}`);
      expect(rows[0].body).toContain("torn");
    }
    expect(await notifications(desk("housekeeping").id, `hk-lost:${adj.id}`)).toHaveLength(0);
  });

  it("over-return is refused", async () => {
    asHousekeeping();
    const why = await expectRefused(() =>
      returnHousekeepingStock({ itemId: towel, qty: "5", outcome: "returned" }),
    );
    expect(why).toMatch(/Only 1 piece/);
    expectDecimal((await stock(towel)).inCirculation, "1", "in circulation untouched");
  });
});

describe("low-stock notification", () => {
  it("fires once per item per day, to the housekeeping manager and the manager", async () => {
    asHousekeeping();
    const tissue = await newItem({ name: "Tissue box", opening: "10", minStock: "5" });
    const key = `hk-low:${tissue}:${today()}`;

    mustOk(await issue([{ itemId: tissue, quantity: "6" }]), "issue 10 → 4");
    await flushDeferred();
    for (const who of ["housekeeping", "manager"] as const) {
      const rows = await notifications(desk(who).id, key);
      expect(rows, `${who} told`).toHaveLength(1);
      expect(rows[0].body).toBe(`Tissue box ${tag}: 4 piece left`);
      expect(rows[0].link).toBe("/housekeeping/items");
    }
    expect(await notifications(desk("admin").id, key)).toHaveLength(0);

    // Back above the line and down through it again — same day, no repeat.
    mustOk(await receipt(tissue, "6"), "restock 4 → 10");
    mustOk(await issue([{ itemId: tissue, quantity: "6" }]), "issue 10 → 4 again");
    await flushDeferred();
    expect(await notifications(desk("housekeeping").id, key)).toHaveLength(1);
  });
});

describe("item edits that would corrupt the ledger", () => {
  it("refuses a unit change while there is stock, keeps notes the form didn't send", async () => {
    asHousekeeping();
    const why = await expectRefused(() =>
      upsertHousekeepingItem(
        { name: `Soap ${tag}`, unit: "kg", reusable: false, minStock: null, active: true },
        soap,
      ),
    );
    expect(why).toMatch(/Can't change the unit/);

    mustOk(
      await upsertHousekeepingItem(
        { name: `Soap bar ${tag}`, unit: "piece", reusable: false, minStock: null, active: true },
        soap,
      ),
      "rename with the same unit",
    );
    expect((await stock(soap)).notes).toBe("keep me");
  });

  it("refuses reusable → consumable while units are out in rooms", async () => {
    asHousekeeping();
    const why = await expectRefused(() =>
      upsertHousekeepingItem(
        { name: `Bath towel ${tag}`, unit: "piece", reusable: false, minStock: null, active: true },
        towel,
      ),
    );
    expect(why).toMatch(/out in rooms/);
  });

  it("refuses deactivating an item that still has stock", async () => {
    asHousekeeping();
    const why = await expectRefused(() => deactivateHousekeepingItem(soap));
    expect(why).toMatch(/in stock/);
    expect((await stock(soap)).active).toBe(true);
  });

  it("refuses a second item with the same name in a different case", async () => {
    asHousekeeping();
    const why = await expectRefused(() =>
      upsertHousekeepingItem({ name: `SOAP BAR ${tag}`, unit: "piece", active: true }),
    );
    expect(why).toMatch(/already exists/);
  });
});

describe("reports", () => {
  it("consumption counts the consumable issue and excludes the reusable one", async () => {
    asHousekeeping();
    const range = { from: today(), to: today() };
    const byItem = await consumptionByItem("CUSTOM", range);
    const soapRow = byItem.find((r) => r.itemId === soap);
    expect(soapRow?.consumed).toBe("4");
    expect(byItem.find((r) => r.itemId === towel)).toBeUndefined();

    const linen = await reusablesByItem("CUSTOM", range);
    const towelRow = linen.find((r) => r.itemId === towel);
    expect(towelRow).toMatchObject({ issued: "6", returned: "4", lost: "1", inCirculation: "1" });
  });

  it("from = to = today includes today's issue; malformed dates are ignored, not fatal", async () => {
    asHousekeeping();
    const rows = await listHousekeepingIssues({ from: today(), to: today(), itemId: soap });
    expect(rows.map((r) => r.id)).toContain(soapIssueId);

    const loose = await listHousekeepingIssues({ from: "garbage", to: "2026-13-45", itemId: soap });
    expect(loose.map((r) => r.id)).toContain(soapIssueId);
  });
});

describe("who may post", () => {
  it("the store keeper and the chef are refused on recordHousekeepingIssue", async () => {
    for (const become of [asStore, asChef]) {
      become();
      const why = await expectRefused(() => issue([{ itemId: soap, quantity: "1" }]));
      expect(why).toMatch(/Requires one of: ADMIN, MANAGER, HOUSEKEEPING_MANAGER/);
    }
    expectDecimal((await stock(soap)).currentStock, "11", "stock untouched");
  });

  it("the maintenance manager is refused on recordHousekeepingReceipt", async () => {
    asMaintenance();
    const why = await expectRefused(() => receipt(soap, "1"));
    expect(why).toMatch(/Requires one of: ADMIN, MANAGER, HOUSEKEEPING_MANAGER/);
    expectDecimal((await stock(soap)).currentStock, "11", "stock untouched");
  });
});
