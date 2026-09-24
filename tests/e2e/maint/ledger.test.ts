// FIRST import, always — see harness/database-url.ts.
import "../harness/database-url";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { formatIST } from "@/lib/time";
import {
  deactivateMaintenanceItem,
  listMaintenanceActivities,
  recordMaintenanceActivity,
  recordMaintenanceReceipt,
  upsertMaintenanceItem,
  upsertMaintenanceStaff,
} from "@/server/actions/maintenance";
import {
  asMaintenance,
  desk,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  flushDeferred,
  istInput,
  mustOk,
} from "../harness";

/**
 * The maintenance spares ledger: every movement is a document (opening
 * balance, receipt, activity) and on-hand is the sum of them. The items,
 * staff and rooms survive the harness reset and the database is shared, so
 * every name carries a run tag.
 */

const tag = Date.now();
let n = 0;
let roomId: string;
let staffId: string;

async function newItem(over: Record<string, unknown> = {}): Promise<string> {
  asMaintenance();
  return mustOk(
    await upsertMaintenanceItem({ name: `Spare ${tag}-${++n}`, unit: "piece", ...over }),
    "create item",
  ).id;
}

async function stock(itemId: string): Promise<string> {
  const row = await db.maintenanceItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { currentStock: true },
  });
  return row.currentStock.toString();
}

function job(over: Record<string, unknown> = {}) {
  return {
    performedAt: istInput(new Date()),
    staffId,
    roomId,
    category: "GENERAL",
    status: "COMPLETED",
    issueReported: `Ledger job ${tag}-${++n}`,
    lines: [],
    ...over,
  };
}

beforeAll(async () => {
  await ensureSeeded();
  roomId = (await db.room.create({ data: { number: `MT-${tag}` } })).id;
  asMaintenance();
  staffId = mustOk(await upsertMaintenanceStaff({ name: `Fitter ${tag}` }), "create staff").id;
});

describe("stock in", () => {
  it("an opening balance is a receipt, not a bare number", async () => {
    const itemId = await newItem({ openingStock: "10" });
    expectDecimal(await stock(itemId), "10", "opening on hand");
    const lines = await db.maintenanceReceiptLine.findMany({
      where: { itemId },
      include: { receipt: { select: { sourceContact: true } } },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].receipt.sourceContact).toBe("Opening balance");
  });

  it("a receipt adds stock", async () => {
    const itemId = await newItem({ openingStock: "10" });
    mustOk(
      await recordMaintenanceReceipt({
        receivedAt: istInput(new Date()),
        lines: [{ itemId, quantity: "5", costPerUnit: "12.50" }],
      }),
      "receipt",
    );
    expectDecimal(await stock(itemId), "15", "on hand after receipt");
  });

  it("refuses a receipt for an item that is hidden or missing", async () => {
    const hidden = await newItem();
    mustOk(await deactivateMaintenanceItem(hidden), "hide the empty item");
    const why = await expectRefused(() =>
      recordMaintenanceReceipt({
        receivedAt: istInput(new Date()),
        lines: [{ itemId: hidden, quantity: "1" }],
      }),
    );
    expect(why).toMatch(/hidden/);
    expect(
      await expectRefused(() =>
        recordMaintenanceReceipt({
          receivedAt: istInput(new Date()),
          lines: [{ itemId: "nope", quantity: "1" }],
        }),
      ),
    ).toMatch(/not found/i);
  });
});

describe("stock out", () => {
  it("an activity with parts lowers stock; labour alone moves nothing", async () => {
    const itemId = await newItem({ openingStock: "12" });
    mustOk(await recordMaintenanceActivity(job({ lines: [{ itemId, quantity: "3" }] })), "parts job");
    expectDecimal(await stock(itemId), "9", "after parts");
    mustOk(await recordMaintenanceActivity(job()), "labour-only job");
    expectDecimal(await stock(itemId), "9", "after labour");
  });

  it("two lines for the same item are one draw — over the total, nothing moves", async () => {
    const itemId = await newItem({ openingStock: "12" });
    const issue = `Overdraw ${tag}`;
    const why = await expectRefused(() =>
      recordMaintenanceActivity(
        job({
          issueReported: issue,
          lines: [
            { itemId, quantity: "7" },
            { itemId, quantity: "6" },
          ],
        }),
      ),
    );
    expect(why).toMatch(/Not enough Spare/);
    expect(why).toMatch(/13/);
    expectDecimal(await stock(itemId), "12", "untouched");
    expect(await db.maintenanceActivity.count({ where: { issueReported: issue } })).toBe(0);
  });

  it("refuses CANCELLED on create, a quantity that rounds to nothing, and inactive staff / room", async () => {
    const itemId = await newItem({ openingStock: "5" });
    expect(await expectRefused(() => recordMaintenanceActivity(job({ status: "CANCELLED" })))).toMatch(
      /cancelled/i,
    );
    expect(
      await expectRefused(() =>
        recordMaintenanceActivity(job({ lines: [{ itemId, quantity: "0.0004" }] })),
      ),
    ).toMatch(/more than 0/);
    const deadRoom = await db.room.create({ data: { number: `MT-dead-${tag}`, active: false } });
    expect(
      await expectRefused(() => recordMaintenanceActivity(job({ roomId: deadRoom.id }))),
    ).toMatch(/inactive/);
    const deadStaff = mustOk(
      await upsertMaintenanceStaff({ name: `Retired ${tag}`, active: false }),
      "inactive staff",
    ).id;
    expect(
      await expectRefused(() => recordMaintenanceActivity(job({ staffId: deadStaff }))),
    ).toMatch(/inactive/);
    expectDecimal(await stock(itemId), "5", "untouched");
  });

  it("warns the desk once a day when a job takes an item to its floor", async () => {
    const itemId = await newItem({ openingStock: "10", minStock: "5" });
    const key = `maint-low:${itemId}:${formatIST(new Date(), "yyyy-MM-dd")}`;
    const forDesk = () =>
      db.notification.count({ where: { userId: desk("maintenance").id, dedupeKey: key } });

    mustOk(await recordMaintenanceActivity(job({ lines: [{ itemId, quantity: "6" }] })), "to 4");
    await flushDeferred();
    expect(await forDesk()).toBe(1);
    expect(
      await db.notification.count({ where: { userId: desk("manager").id, dedupeKey: key } }),
    ).toBe(1);

    // Back above the floor and down through it again the same day: no repeat.
    mustOk(
      await recordMaintenanceReceipt({
        receivedAt: istInput(new Date()),
        lines: [{ itemId, quantity: "2" }],
      }),
      "top up to 6",
    );
    mustOk(await recordMaintenanceActivity(job({ lines: [{ itemId, quantity: "2" }] })), "to 4 again");
    await flushDeferred();
    expect(await forDesk()).toBe(1);
  });
});

describe("the item card", () => {
  it("refuses negative figures and a duplicate name in any case", async () => {
    expect(
      await expectRefused(() => upsertMaintenanceItem({ name: `Neg ${tag}`, openingStock: "-1" })),
    ).toMatch(/cannot be negative/);
    expect(
      await expectRefused(() => upsertMaintenanceItem({ name: `Neg ${tag}`, minStock: "-1" })),
    ).toMatch(/cannot be negative/);
    const itemId = await newItem();
    const { name } = await db.maintenanceItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(await expectRefused(() => upsertMaintenanceItem({ name: name.toUpperCase() }))).toMatch(
      /already exists/,
    );
    expect(await expectRefused(() => upsertMaintenanceStaff({ name: `fitter ${tag}` }))).toMatch(
      /already exists/,
    );
  });

  it("keeps the unit once stock or history exists", async () => {
    const stocked = await newItem({ openingStock: "3" });
    const { name } = await db.maintenanceItem.findUniqueOrThrow({ where: { id: stocked } });
    expect(
      await expectRefused(() => upsertMaintenanceItem({ name, unit: "m" }, stocked)),
    ).toMatch(/Unit can't change/);
    const empty = await newItem();
    const fresh = await db.maintenanceItem.findUniqueOrThrow({ where: { id: empty } });
    mustOk(await upsertMaintenanceItem({ name: fresh.name, unit: "m" }, empty), "unit on an empty item");
  });

  it("will not hide an item that still has stock", async () => {
    const stocked = await newItem({ openingStock: "3" });
    expect(await expectRefused(() => deactivateMaintenanceItem(stocked))).toMatch(/still has 3/);
    expect((await db.maintenanceItem.findUniqueOrThrow({ where: { id: stocked } })).active).toBe(true);
  });
});

describe("the activity list", () => {
  it("from = to = today returns today's job; a malformed date is ignored", async () => {
    const issue = `Today ${tag}`;
    const created = mustOk(await recordMaintenanceActivity(job({ issueReported: issue })), "today");
    const today = formatIST(new Date(), "yyyy-MM-dd");
    const rows = await listMaintenanceActivities({ from: today, to: today, roomId });
    expect(rows.map((r) => r.id)).toContain(created.id);
    const loose = await listMaintenanceActivities({ from: "yesterday", to: "2026-13-45", roomId });
    expect(loose.map((r) => r.id)).toContain(created.id);
  });
});
