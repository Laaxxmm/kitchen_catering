// FIRST import, always — see harness/database-url.ts.
import "../harness/database-url";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { formatIST } from "@/lib/time";
import {
  assignMaintenanceActivity,
  deactivateMaintenanceItem,
  deactivateMaintenanceStaff,
  deleteMaintenanceItem,
  deleteMaintenanceStaff,
  getMaintenanceJobStats,
  listMaintenanceActivities,
  listMaintenanceStaff,
  recordMaintenanceActivity,
  recordMaintenanceReceipt,
  updateMaintenanceActivityStatus,
  upsertMaintenanceItem,
  upsertMaintenanceStaff,
} from "@/server/actions/maintenance";
import {
  asChef,
  asHousekeeping,
  asMaintenance,
  asManager,
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
 * Maintenance runs its own jobs: housekeeping reports a defect (PENDING, no
 * technician, no parts), the maintenance head assigns and starts it, and
 * closes it saying what was done and which spares went in — those leave
 * stock in the same transaction. Names carry a run tag: the database is
 * shared and items / staff / rooms survive the harness reset.
 */

const tag = Date.now();
let n = 0;
let roomId: string;
let staffId: string;
let bulbId: string;
let switchId: string;

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
    roomId,
    category: "ELECTRICAL",
    status: "PENDING",
    issueReported: `Dept job ${tag}-${++n}`,
    lines: [],
    ...over,
  };
}

async function activity(id: string) {
  return db.maintenanceActivity.findUniqueOrThrow({ where: { id }, include: { lines: true } });
}

/** A PENDING, unassigned job logged by the maintenance head. */
async function pendingJob(over: Record<string, unknown> = {}): Promise<string> {
  asMaintenance();
  return mustOk(await recordMaintenanceActivity(job(over)), "log pending").id;
}

beforeAll(async () => {
  await ensureSeeded();
  roomId = (await db.room.create({ data: { number: `DJ-${tag}` } })).id;
  asMaintenance();
  staffId = mustOk(await upsertMaintenanceStaff({ name: `Electrician ${tag}` }), "create staff").id;
  bulbId = mustOk(
    await upsertMaintenanceItem({ name: `LED bulb ${tag}`, unit: "piece", openingStock: "10" }),
    "create bulb",
  ).id;
  switchId = mustOk(
    await upsertMaintenanceItem({ name: `Switch ${tag}`, unit: "piece", openingStock: "4" }),
    "create switch",
  ).id;
});

describe("room 102 has an issue", () => {
  let jobId: string;

  it("housekeeping reports it: PENDING, nobody assigned, no parts", async () => {
    asHousekeeping();
    jobId = mustOk(
      await recordMaintenanceActivity(job({ priority: "HIGH", issueReported: `Bathroom light dead ${tag}` })),
      "housekeeping reports",
    ).id;
    const row = await activity(jobId);
    expect(row).toMatchObject({ status: "PENDING", staffId: null, priority: "HIGH", startedAt: null });
    expect(row.lines).toHaveLength(0);
  });

  it("the maintenance head assigns it, starts it, and startedAt is stamped", async () => {
    asMaintenance();
    mustOk(await assignMaintenanceActivity(jobId, staffId), "assign");
    expect((await activity(jobId)).staffId).toBe(staffId);
    expect(
      await db.auditLog.count({
        where: { entityId: jobId, action: "MAINT_ACTIVITY_ASSIGNED", payloadHash: { not: null } },
      }),
    ).toBe(1);

    mustOk(await updateMaintenanceActivityStatus(jobId, { status: "IN_PROGRESS" }), "start");
    const row = await activity(jobId);
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.startedAt).toBeInstanceOf(Date);
  });

  it("completing without saying what was done is refused", async () => {
    asMaintenance();
    for (const workDone of [undefined, "   "]) {
      expect(
        await expectRefused(() => updateMaintenanceActivityStatus(jobId, { status: "COMPLETED", workDone })),
      ).toMatch(/what work was done/);
    }
    expect((await activity(jobId)).status).toBe("IN_PROGRESS");
  });

  it("parts over stock are refused and nothing moves", async () => {
    asMaintenance();
    const before = { bulb: await stock(bulbId), sw: await stock(switchId) };
    // One spare, more than the shelf holds — refused by name.
    expect(
      await expectRefused(() =>
        updateMaintenanceActivityStatus(jobId, {
          status: "COMPLETED",
          workDone: "Replaced bulb",
          parts: [
            { itemId: bulbId, qty: "1" },
            { itemId: switchId, qty: "5" },
          ],
        }),
      ),
    ).toMatch(new RegExp(`Not enough Switch ${tag}`));
    // Two lines of one spare (each fits, together they don't): one line per spare.
    expect(
      await expectRefused(() =>
        updateMaintenanceActivityStatus(jobId, {
          status: "COMPLETED",
          workDone: "Replaced switch",
          parts: [
            { itemId: switchId, qty: "3" },
            { itemId: switchId, qty: "3" },
          ],
        }),
      ),
    ).toMatch(/Each spare once/);

    const row = await activity(jobId);
    expect(row.status).toBe("IN_PROGRESS");
    expect(row.completedAt).toBeNull();
    expect(row.lines).toHaveLength(0);
    expectDecimal(await stock(bulbId), before.bulb, "bulb untouched");
    expectDecimal(await stock(switchId), before.sw, "switch untouched");
  });

  it("completes with the work done and two parts: stock drops exactly, lines recorded", async () => {
    asMaintenance();
    const bulb = Number(await stock(bulbId));
    const sw = Number(await stock(switchId));
    mustOk(
      await updateMaintenanceActivityStatus(jobId, {
        status: "COMPLETED",
        workDone: "  Replaced bulb and the switch behind it  ",
        parts: [
          { itemId: bulbId, qty: "2" },
          { itemId: switchId, qty: "1.5" },
        ],
      }),
      "complete",
    );
    const row = await activity(jobId);
    expect(row.status).toBe("COMPLETED");
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.workDone).toBe("Replaced bulb and the switch behind it");
    expect(
      row.lines.map((l) => [l.itemId, Number(l.quantity)]).sort(),
    ).toEqual([[bulbId, 2], [switchId, 1.5]].sort());
    expectDecimal(await stock(bulbId), String(bulb - 2), "bulbs used");
    expectDecimal(await stock(switchId), String(sw - 1.5), "switch used");

    await flushDeferred();
    // Housekeeping logged it, so housekeeping hears it is done.
    expect(
      await db.notification.count({
        where: { userId: desk("housekeeping").id, dedupeKey: `maint-act-done:${jobId}` },
      }),
    ).toBe(1);
  });

  it("a second completion is refused and draws nothing", async () => {
    asMaintenance();
    const bulb = await stock(bulbId);
    expect(
      await expectRefused(() =>
        updateMaintenanceActivityStatus(jobId, {
          status: "COMPLETED",
          workDone: "Again",
          parts: [{ itemId: bulbId, qty: "1" }],
        }),
      ),
    ).toMatch(/already completed/);
    expect(await expectRefused(() => updateMaintenanceActivityStatus(jobId, { status: "CANCELLED" }))).toMatch(
      /already completed/,
    );
    expectDecimal(await stock(bulbId), bulb, "no second draw");
    expect((await activity(jobId)).lines).toHaveLength(2);
  });
});

describe("the rules on the way", () => {
  it("starting or completing an unassigned job needs a staff member; one can be named on the way", async () => {
    const id = await pendingJob();
    expect(await expectRefused(() => updateMaintenanceActivityStatus(id, { status: "IN_PROGRESS" }))).toMatch(
      /Assign a staff member before starting/,
    );
    expect(
      await expectRefused(() =>
        updateMaintenanceActivityStatus(id, { status: "COMPLETED", workDone: "Tightened" }),
      ),
    ).toMatch(/Assign a staff member before completing/);
    expect((await activity(id)).status).toBe("PENDING");

    // Straight from pending to done, naming the technician as it closes.
    mustOk(
      await updateMaintenanceActivityStatus(id, { status: "COMPLETED", workDone: "Tightened", staffId }),
      "complete with staff",
    );
    const row = await activity(id);
    expect(row).toMatchObject({ status: "COMPLETED", staffId });
    expect(row.startedAt).toBeInstanceOf(Date);
  });

  it("parts are only taken when completing", async () => {
    asMaintenance();
    const id = mustOk(await recordMaintenanceActivity(job({ staffId })), "assigned pending").id;
    expect(
      await expectRefused(() =>
        updateMaintenanceActivityStatus(id, { status: "IN_PROGRESS", parts: [{ itemId: bulbId, qty: "1" }] }),
      ),
    ).toMatch(/recorded when the job is completed/);
  });

  it("only a pending job waits unassigned, and a job logged done says what was done", async () => {
    asMaintenance();
    expect(await expectRefused(() => recordMaintenanceActivity(job({ status: "IN_PROGRESS" })))).toMatch(
      /only a pending job can wait unassigned/,
    );
    expect(
      await expectRefused(() => recordMaintenanceActivity(job({ status: "COMPLETED", staffId }))),
    ).toMatch(/what work was done/);
    const started = mustOk(await recordMaintenanceActivity(job({ status: "IN_PROGRESS", staffId })), "started").id;
    expect((await activity(started)).startedAt).toBeInstanceOf(Date);
  });

  it("spares are refused at logging; a job logged with spares before 14 Oct still restores on cancel", async () => {
    asMaintenance();
    // Spares come off once, at completion — never at logging (no double draw).
    const refused = await recordMaintenanceActivity(
      job({ status: "IN_PROGRESS", staffId, lines: [{ itemId: bulbId, quantity: "3" }] }),
    );
    expect(refused.ok).toBe(false);
    // A job logged the old way (spares drawn at logging), as production may hold.
    const before = Number(await stock(bulbId));
    const id = mustOk(await recordMaintenanceActivity(job({ status: "IN_PROGRESS", staffId })), "open job").id;
    await db.maintenanceActivityLine.create({ data: { activityId: id, itemId: bulbId, quantity: "3" } });
    await db.maintenanceItem.update({ where: { id: bulbId }, data: { currentStock: { decrement: 3 } } });
    expectDecimal(await stock(bulbId), String(before - 3), "drawn at logging (legacy)");
    mustOk(await updateMaintenanceActivityStatus(id, { status: "CANCELLED" }), "cancel");
    expectDecimal(await stock(bulbId), String(before), "restored");
    const restored = await db.maintenanceAdjustment.findMany({ where: { activityId: id } });
    expect(restored.map((r) => [r.kind, Number(r.delta)])).toEqual([["RESTORED", 3]]);
  });

  it("assigning: open jobs only, an active staff member, not the one it already has", async () => {
    asMaintenance();
    const id = await pendingJob();
    expect(await expectRefused(() => assignMaintenanceActivity(id, "nope"))).toMatch(/not found/);
    const retired = mustOk(
      await upsertMaintenanceStaff({ name: `Retired ${tag}`, active: false }),
      "inactive staff",
    ).id;
    expect(await expectRefused(() => assignMaintenanceActivity(id, retired))).toMatch(/inactive/);
    mustOk(await assignMaintenanceActivity(id, staffId), "assign");
    expect(await expectRefused(() => assignMaintenanceActivity(id, staffId))).toMatch(/already with/);
    mustOk(await updateMaintenanceActivityStatus(id, { status: "CANCELLED" }), "cancel");
    expect(await expectRefused(() => assignMaintenanceActivity(id, staffId))).toMatch(/only an open job/);
  });

  it("a completion that takes a spare to its floor tells the desk", async () => {
    asMaintenance();
    const itemId = mustOk(
      await upsertMaintenanceItem({ name: `Fuse ${tag}`, unit: "piece", openingStock: "5", minStock: "2" }),
      "item with a floor",
    ).id;
    const id = mustOk(await recordMaintenanceActivity(job({ staffId })), "pending").id;
    mustOk(
      await updateMaintenanceActivityStatus(id, {
        status: "COMPLETED",
        workDone: "Swapped fuses",
        parts: [{ itemId, qty: "3" }],
      }),
      "complete to the floor",
    );
    await flushDeferred();
    const key = `maint-low:${itemId}:${formatIST(new Date(), "yyyy-MM-dd")}`;
    expect(await db.notification.count({ where: { userId: desk("maintenance").id, dedupeKey: key } })).toBe(1);
  });
});

describe("the job desk", () => {
  it("lists most urgent first, filters unassigned, and counts open jobs by priority", async () => {
    asMaintenance();
    const low = await pendingJob({ priority: "LOW" });
    const urgent = await pendingJob({ priority: "URGENT" });
    const rows = await listMaintenanceActivities({ open: true, roomId, sort: "priority" });
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(urgent)).toBeLessThan(ids.indexOf(low));

    const unassigned = await listMaintenanceActivities({ open: true, roomId, unassigned: true });
    expect(unassigned.every((r) => r.staffId === null)).toBe(true);
    expect(unassigned.map((r) => r.id)).toContain(urgent);

    const stats = await getMaintenanceJobStats("WEEK");
    expect(stats.openByPriority.URGENT).toBeGreaterThanOrEqual(1);
    expect(stats.oldestOpenAt).toBeInstanceOf(Date);
    // Jobs above went start → complete this week, so there is a time to close.
    expect(stats.closedCount).toBeGreaterThanOrEqual(1);
    expect(stats.avgHoursToClose).not.toBeNull();
  });
});

describe("deleting an item", () => {
  it("refuses one that sits on a stock request line, by name, and leaves it in place", async () => {
    asMaintenance();
    const itemId = mustOk(await upsertMaintenanceItem({ name: `Requested ${tag}` }), "item").id;
    await db.deptPurchaseOrder.create({
      data: {
        number: `MT-PO-TEST-${tag}`,
        department: "MAINTENANCE",
        reason: "Restock",
        createdById: desk("maintenance").id,
        lines: { create: [{ mtItemId: itemId, itemName: `Requested ${tag}`, unit: "piece", quantity: "2" }] },
      },
    });
    expect(await expectRefused(() => deleteMaintenanceItem(itemId))).toMatch(
      /1 stock request line\). Deactivate instead/,
    );
    expect(await db.maintenanceItem.count({ where: { id: itemId } })).toBe(1);

    const unused = mustOk(await upsertMaintenanceItem({ name: `Unused ${tag}` }), "unused item").id;
    mustOk(await deleteMaintenanceItem(unused), "delete an item nothing names");
  });
});

describe("who may do what", () => {
  it("housekeeping cannot assign, move a job, or read the technician list", async () => {
    const id = await pendingJob();
    asHousekeeping();
    expect(await expectRefused(() => assignMaintenanceActivity(id, staffId))).toMatch(/Requires one of/);
    for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      expect(
        await expectRefused(() => updateMaintenanceActivityStatus(id, { status, workDone: "x", staffId })),
      ).toMatch(/Requires one of/);
    }
    expect(await expectRefused(() => listMaintenanceStaff())).toMatch(/Requires one of/);
    expect(await activity(id)).toMatchObject({ status: "PENDING", staffId: null });
  });

  it("the store keeper and the chef are refused on every maintenance write", async () => {
    const id = await pendingJob();
    const writes = [
      () => upsertMaintenanceStaff({ name: `Nope ${tag}` }),
      () => deactivateMaintenanceStaff(staffId),
      () => deleteMaintenanceStaff(staffId),
      () => upsertMaintenanceItem({ name: `Nope ${tag}` }),
      () => deactivateMaintenanceItem(bulbId),
      () => deleteMaintenanceItem(bulbId),
      () => recordMaintenanceReceipt({ receivedAt: istInput(new Date()), lines: [{ itemId: bulbId, quantity: "1" }] }),
      () => recordMaintenanceActivity(job({ staffId })),
      () => assignMaintenanceActivity(id, staffId),
      () => updateMaintenanceActivityStatus(id, { status: "IN_PROGRESS", staffId }),
      () => updateMaintenanceActivityStatus(id, { status: "CANCELLED" }),
    ];
    for (const become of [asStore, asChef]) {
      become();
      for (const write of writes) expect(await expectRefused(write)).toMatch(/Requires one of/);
    }
    expect(await activity(id)).toMatchObject({ status: "PENDING", staffId: null });
  });

  it("a direct receipt is the manager's correction, not the maintenance head's", async () => {
    const line = { receivedAt: istInput(new Date()), lines: [{ itemId: switchId, quantity: "2" }] };
    const before = Number(await stock(switchId));
    asMaintenance();
    expect(await expectRefused(() => recordMaintenanceReceipt(line))).toMatch(/Requires one of: ADMIN, MANAGER$/);
    expectDecimal(await stock(switchId), String(before), "not received");
    asManager();
    mustOk(await recordMaintenanceReceipt(line), "manager receipt");
    expectDecimal(await stock(switchId), String(before + 2), "received");
  });
});
