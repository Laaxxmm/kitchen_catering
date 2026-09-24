// FIRST import, always — see harness/database-url.ts.
import "../harness/database-url";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { formatIST } from "@/lib/time";
import {
  activitiesByRoom,
  maintenanceConsumptionByItem,
  recordMaintenanceActivity,
  updateMaintenanceActivityStatus,
  upsertMaintenanceItem,
  upsertMaintenanceStaff,
} from "@/server/actions/maintenance";
import {
  asAdmin,
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
 * A job's life: reported (PENDING) → started → completed, or cancelled with
 * its spares back on the shelf. Names carry a run tag — see ledger.test.ts.
 */

const tag = Date.now();
let n = 0;
let roomId: string;
let staffId: string;
let itemId: string;

async function stock(): Promise<string> {
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
    category: "ELECTRICAL",
    status: "PENDING",
    issueReported: `Lifecycle job ${tag}-${++n}`,
    lines: [],
    ...over,
  };
}

async function activity(id: string) {
  return db.maintenanceActivity.findUniqueOrThrow({ where: { id } });
}

beforeAll(async () => {
  await ensureSeeded();
  roomId = (await db.room.create({ data: { number: `LC-${tag}` } })).id;
  asMaintenance();
  staffId = mustOk(await upsertMaintenanceStaff({ name: `Sparky ${tag}` }), "create staff").id;
  itemId = mustOk(
    await upsertMaintenanceItem({ name: `Fuse ${tag}`, unit: "piece", openingStock: "20" }),
    "create item",
  ).id;
});

describe("pending → in progress → completed", () => {
  it("stamps completedAt once and refuses a second completion", async () => {
    asMaintenance();
    const { id } = mustOk(await recordMaintenanceActivity(job()), "log pending");
    expect((await activity(id)).completedAt).toBeNull();

    mustOk(await updateMaintenanceActivityStatus(id, { status: "IN_PROGRESS" }), "start");
    expect((await activity(id)).status).toBe("IN_PROGRESS");
    expect(
      await expectRefused(() => updateMaintenanceActivityStatus(id, { status: "IN_PROGRESS" })),
    ).toMatch(/already in progress/);

    mustOk(
      await updateMaintenanceActivityStatus(id, { status: "COMPLETED", workDone: "Replaced fuse" }),
      "complete",
    );
    const done = await activity(id);
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.workDone).toBe("Replaced fuse");

    expect(
      await expectRefused(() => updateMaintenanceActivityStatus(id, { status: "COMPLETED" })),
    ).toMatch(/already completed/);
    expect(
      await expectRefused(() => updateMaintenanceActivityStatus(id, { status: "CANCELLED" })),
    ).toMatch(/already completed/);
    expect(
      await db.auditLog.count({
        where: { entity: "MaintenanceActivity", entityId: id, action: "MAINT_ACTIVITY_STATUS_CHANGED", payloadHash: { not: null } },
      }),
    ).toBe(2);
  });

  it("completing tells the manager, and whoever logged it", async () => {
    asAdmin();
    const { id } = mustOk(await recordMaintenanceActivity(job()), "admin logs");
    asMaintenance();
    mustOk(await updateMaintenanceActivityStatus(id, { status: "COMPLETED" }), "complete");
    await flushDeferred();
    const key = `maint-act-done:${id}`;
    for (const who of ["manager", "admin"] as const) {
      expect(
        await db.notification.count({ where: { userId: desk(who).id, dedupeKey: key } }),
      ).toBe(1);
    }
  });
});

describe("cancelling", () => {
  it("puts the spares back with a RESTORED record per line", async () => {
    asMaintenance();
    const before = Number(await stock());
    const { id } = mustOk(
      await recordMaintenanceActivity(
        job({
          status: "IN_PROGRESS",
          lines: [
            { itemId, quantity: "2" },
            { itemId, quantity: "3" },
          ],
        }),
      ),
      "job with parts",
    );
    expectDecimal(await stock(), String(before - 5), "drawn");

    mustOk(await updateMaintenanceActivityStatus(id, { status: "CANCELLED", note: "False alarm" }), "cancel");
    const row = await activity(id);
    expect(row.status).toBe("CANCELLED");
    expect(row.cancelledAt).toBeInstanceOf(Date);
    expect(row.notes).toBe("False alarm");
    expectDecimal(await stock(), String(before), "restored");

    // Both rows share the transaction's timestamp, so read them as a set.
    const restored = await db.maintenanceAdjustment.findMany({ where: { activityId: id } });
    expect(restored.map((r) => r.kind)).toEqual(["RESTORED", "RESTORED"]);
    expect(restored.map((r) => Number(r.delta)).sort()).toEqual([2, 3]);
    expect(Math.min(...restored.map((r) => Number(r.beforeQty)))).toBe(before - 5);
    expect(Math.max(...restored.map((r) => Number(r.afterQty)))).toBe(before);
    expect(restored.every((r) => r.reason === "Job cancelled")).toBe(true);

    await flushDeferred();
    expect(
      await db.notification.count({
        where: { userId: desk("manager").id, dedupeKey: `maint-act-cancel:${id}` },
      }),
    ).toBe(1);
    expect(
      await expectRefused(() => updateMaintenanceActivityStatus(id, { status: "IN_PROGRESS" })),
    ).toMatch(/was cancelled/);
  });

  it("drops out of every report", async () => {
    asMaintenance();
    const today = formatIST(new Date(), "yyyy-MM-dd");
    const room = (await db.room.create({ data: { number: `LC-rep-${tag}` } })).id;
    mustOk(
      await recordMaintenanceActivity(job({ roomId: room, status: "COMPLETED", lines: [{ itemId, quantity: "1" }] })),
      "kept",
    );
    const dropped = mustOk(
      await recordMaintenanceActivity(job({ roomId: room, lines: [{ itemId, quantity: "4" }] })),
      "to cancel",
    );
    mustOk(await updateMaintenanceActivityStatus(dropped.id, { status: "CANCELLED" }), "cancel");

    const byRoom = await activitiesByRoom("CUSTOM", { from: today, to: today });
    expect(byRoom.find((r) => r.roomId === room)?.count).toBe(1);
    const consumed = await maintenanceConsumptionByItem("CUSTOM", { from: today, to: today });
    const mine = consumed.find((c) => c.itemId === itemId);
    expect(mine).toBeDefined();
    // Only the kept job's 1: neither cancelled job (the 5 above, the 4 here)
    // counts as consumption — their spares are back on the shelf.
    expect(Number(mine!.consumed)).toBe(1);
  });
});

describe("housekeeping reports, maintenance takes over", () => {
  it("can log a PENDING job without parts, and the desk hears about it", async () => {
    asHousekeeping();
    const { id } = mustOk(
      await recordMaintenanceActivity(job({ status: "COMPLETED", issueReported: `Leaking tap ${tag}` })),
      "housekeeping reports",
    );
    expect((await activity(id)).status).toBe("PENDING");
    await flushDeferred();
    const note = await db.notification.findFirst({
      where: { userId: desk("maintenance").id, dedupeKey: `maint-act:${id}` },
    });
    expect(note?.link).toBe("/maintenance/activities?status=PENDING");
  });

  it("is refused with parts, and cannot move a job along", async () => {
    asHousekeeping();
    expect(
      await expectRefused(() =>
        recordMaintenanceActivity(job({ lines: [{ itemId, quantity: "1" }] })),
      ),
    ).toBe("Housekeeping can report a job, not draw spares");
    asMaintenance();
    const { id } = mustOk(await recordMaintenanceActivity(job()), "pending");
    asHousekeeping();
    expect(
      await expectRefused(() => updateMaintenanceActivityStatus(id, { status: "IN_PROGRESS" })),
    ).toMatch(/Requires one of/);
  });
});

describe("who is kept out", () => {
  it("the store keeper and the chef, on both actions", async () => {
    asMaintenance();
    const { id } = mustOk(await recordMaintenanceActivity(job()), "pending");
    for (const become of [asStore, asChef]) {
      become();
      expect(await expectRefused(() => recordMaintenanceActivity(job()))).toMatch(/Requires one of/);
      expect(
        await expectRefused(() => updateMaintenanceActivityStatus(id, { status: "COMPLETED" })),
      ).toMatch(/Requires one of/);
    }
    expect((await activity(id)).status).toBe("PENDING");
  });
});
