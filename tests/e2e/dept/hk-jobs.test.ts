// FIRST import, always — pins DATABASE_URL to the e2e container.
import "../harness/database-url";
import { beforeAll, describe, expect, it } from "vitest";
import { DeptJobStatus, HousekeepingJobType, JobPriority, RoomType } from "@prisma/client";
import { db } from "@/server/db";
import { formatIST } from "@/lib/time";
import {
  cancelHousekeepingJob,
  completeHousekeepingJob,
  createHousekeepingJob,
  getHousekeepingJob,
  listHousekeepingJobs,
  startHousekeepingJob,
  updateHousekeepingJob,
} from "@/server/actions/housekeeping-jobs";
import {
  deactivateRoom,
  deleteHousekeepingItem,
  deleteRoom,
  housekeepingSummary,
  jobsReport,
  recordHousekeepingReceipt,
  upsertHousekeepingItem,
  upsertHousekeepingStaff,
  upsertRoom,
} from "@/server/actions/housekeeping";
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
  read,
} from "../harness";

/**
 * Housekeeping jobs, as the department head runs them: open → start →
 * complete with the items used (drawn from the store as one issue linked to
 * the job) or cancel — no approval anywhere. Plus the module adjustments
 * that came with the department going self-run: direct receipts are a
 * manager's correction path, and the maintenance head may add rooms.
 *
 * Every row this file creates carries a unique suffix; assertions are
 * scoped to those rows.
 */

const tag = Date.now();
const today = () => formatIST(new Date(), "yyyy-MM-dd");

let roomId: string;
let staffId: string;
let soap: string; // consumable, 10 on hand
let towel: string; // reusable, 20 on hand
let doneJob: string;

async function stock(id: string) {
  return db.housekeepingItem.findUniqueOrThrow({
    where: { id },
    select: { currentStock: true, inCirculation: true },
  });
}

async function job(id: string) {
  return db.housekeepingJob.findUniqueOrThrow({ where: { id } });
}

async function newItem(name: string, opening: string, reusable = false, minStock: string | null = null) {
  return mustOk(
    await upsertHousekeepingItem({
      name: `${name} ${tag}`,
      unit: "piece",
      reusable,
      minStock,
      openingStock: opening,
      active: true,
    }),
    `create ${name}`,
  ).id;
}

async function openJob(extra: Record<string, unknown> = {}) {
  return mustOk(
    await createHousekeepingJob({
      type: HousekeepingJobType.GUEST_REQUEST,
      description: `Extra towels ${tag}`,
      ...extra,
    }),
    "open job",
  ).id;
}

beforeAll(async () => {
  await ensureSeeded();
  asHousekeeping();
  roomId = mustOk(
    await upsertRoom({ number: `J-${tag}`, type: RoomType.STANDARD, active: true }),
    "room",
  ).id;
  staffId = mustOk(await upsertHousekeepingStaff({ name: `Job runner ${tag}`, active: true }), "staff").id;
  soap = await newItem("Job soap", "10");
  towel = await newItem("Job towel", "20", true);
});

describe("the housekeeping head runs a job end to end", () => {
  it("opens, starts and completes with a consumable and a reusable — stock moves exactly, one linked issue", async () => {
    asHousekeeping();
    doneJob = await openJob({
      type: HousekeepingJobType.CHECKOUT_CLEAN,
      priority: JobPriority.HIGH,
      roomId,
      description: `Room checkout ${tag}`,
      reportedAt: istInput(new Date()),
    });
    const opened = await job(doneJob);
    expect(opened.status).toBe(DeptJobStatus.OPEN);
    expect(opened.reportedById).toBe(desk("housekeeping").id);

    const why = await expectRefused(() => startHousekeepingJob(doneJob));
    expect(why).toMatch(/Assign a staff member/);

    mustOk(await startHousekeepingJob(doneJob, { staffId }), "start");
    const started = await job(doneJob);
    expect(started.status).toBe(DeptJobStatus.IN_PROGRESS);
    expect(started.startedAt).not.toBeNull();
    expect(started.staffId).toBe(staffId);

    const { issueId } = mustOk(
      await completeHousekeepingJob(doneJob, {
        outcome: "Cleaned and restocked",
        items: [
          { itemId: soap, qty: "3" },
          { itemId: towel, qty: "2.5" },
        ],
      }),
      "complete",
    );

    const s = await stock(soap);
    expectDecimal(s.currentStock, "7", "soap on hand");
    expectDecimal(s.inCirculation, "0", "soap out");
    const t = await stock(towel);
    expectDecimal(t.currentStock, "17.5", "towel clean");
    expectDecimal(t.inCirculation, "2.5", "towel out");

    const issues = await db.housekeepingIssue.findMany({
      where: { jobId: doneJob },
      include: { lines: true },
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe(issueId);
    expect(issues[0].roomId).toBe(roomId);
    expect(issues[0].staffId).toBe(staffId);
    expect(issues[0].purpose).toBe(`Checkout clean: Room checkout ${tag}`);
    const byItem = new Map(issues[0].lines.map((l) => [l.itemId, l]));
    expect(byItem.get(soap)?.reusable).toBe(false);
    expect(byItem.get(towel)?.reusable).toBe(true);
    expectDecimal(byItem.get(towel)?.quantity, "2.5", "towel line");

    const done = await job(doneJob);
    expect(done.status).toBe(DeptJobStatus.DONE);
    expect(done.completedAt).not.toBeNull();
    expect(done.closedById).toBe(desk("housekeeping").id);
    expect(done.outcome).toBe("Cleaned and restocked");

    expect(await read.auditActions("HousekeepingJob", doneJob)).toEqual([
      "HK_JOB_CREATED",
      "HK_JOB_STARTED",
      "HK_JOB_COMPLETED",
    ]);
    expect(await read.auditActions("HousekeepingIssue", issueId!)).toEqual(["HK_ISSUE_CREATED"]);

    const shown = await getHousekeepingJob(doneJob);
    expect(shown?.issue?.lines).toHaveLength(2);
  });

  it("DONE is terminal — a second complete, a start, an edit and a cancel are refused, nothing moves", async () => {
    asHousekeeping();
    const again = await expectRefused(() =>
      completeHousekeepingJob(doneJob, { outcome: "again", items: [{ itemId: soap, qty: "1" }] }),
    );
    expect(again).toBe("This job is already done");
    expect(await expectRefused(() => startHousekeepingJob(doneJob, { staffId }))).toBe("This job is already done");
    expect(await expectRefused(() => updateHousekeepingJob(doneJob, { priority: "LOW" }))).toBe(
      "This job is already done",
    );
    expect(await expectRefused(() => cancelHousekeepingJob(doneJob, "changed my mind"))).toBe(
      "This job is already done",
    );
    expectDecimal((await stock(soap)).currentStock, "7", "soap untouched");
    expect(await db.housekeepingIssue.count({ where: { jobId: doneJob } })).toBe(1);
  });

  it("closing that takes an item below its reorder level tells the desk and the manager", async () => {
    asHousekeeping();
    const tissue = await newItem("Job tissue", "6", false, "5");
    const id = await openJob({ roomId, staffId });
    mustOk(await completeHousekeepingJob(id, { outcome: "Done", items: [{ itemId: tissue, qty: "2" }] }), "complete");
    await flushDeferred();
    for (const who of ["housekeeping", "manager"] as const) {
      const rows = await db.notification.findMany({
        where: { userId: desk(who).id, dedupeKey: `hk-low:${tissue}:${today()}` },
      });
      expect(rows, `${who} told`).toHaveLength(1);
      expect(rows[0].body).toBe(`Job tissue ${tag}: 4 piece left`);
    }
  });
});

describe("closing refusals keep the store and the job untouched", () => {
  it("two lines of the same item are refused", async () => {
    asHousekeeping();
    const id = await openJob({ roomId, staffId });
    const why = await expectRefused(() =>
      completeHousekeepingJob(id, {
        outcome: "Done",
        items: [
          { itemId: soap, qty: "4" },
          { itemId: soap, qty: "4" },
        ],
      }),
    );
    expect(why).toMatch(/same item is on two lines/);
    expectDecimal((await stock(soap)).currentStock, "7", "soap untouched");
    expect((await job(id)).status).toBe(DeptJobStatus.OPEN);
    expect(await db.housekeepingIssue.count({ where: { jobId: id } })).toBe(0);
  });

  it("more than is on hand is refused, and the job stays open", async () => {
    asHousekeeping();
    const id = await openJob({ roomId, staffId });
    const why = await expectRefused(() =>
      completeHousekeepingJob(id, {
        outcome: "Done",
        items: [
          { itemId: towel, qty: "1" },
          { itemId: soap, qty: "8" },
        ],
      }),
    );
    expect(why).toMatch(/Not enough Job soap/);
    expectDecimal((await stock(soap)).currentStock, "7", "soap untouched");
    const t = await stock(towel);
    expectDecimal(t.currentStock, "17.5", "towel untouched");
    expectDecimal(t.inCirculation, "2.5", "towel circulation untouched");
    const after = await job(id);
    expect(after.status).toBe(DeptJobStatus.OPEN);
    expect(after.completedAt).toBeNull();
    expect(await db.housekeepingIssue.count({ where: { jobId: id } })).toBe(0);
  });

  it("items need a room and a staff member", async () => {
    asHousekeeping();
    const id = await openJob();
    const why = await expectRefused(() =>
      completeHousekeepingJob(id, { outcome: "Done", items: [{ itemId: soap, qty: "1" }] }),
    );
    expect(why).toMatch(/pick the room and the staff member/);
    expect((await job(id)).status).toBe(DeptJobStatus.OPEN);
  });

  it("quantities: zero, negative and more than 3 decimals are refused", async () => {
    asHousekeeping();
    const id = await openJob({ roomId, staffId });
    for (const qty of ["0", "-1", "0.0004"]) {
      await expectRefused(() => completeHousekeepingJob(id, { outcome: "Done", items: [{ itemId: soap, qty }] }));
    }
    expectDecimal((await stock(soap)).currentStock, "7", "soap untouched");
  });

  it("without items, a job closes with no room or staff and draws nothing", async () => {
    asHousekeeping();
    const id = await openJob();
    const { issueId } = mustOk(await completeHousekeepingJob(id, { outcome: "Towels were in the room" }), "complete");
    expect(issueId).toBeNull();
    const done = await job(id);
    expect(done.status).toBe(DeptJobStatus.DONE);
    expect(done.roomId).toBeNull();
    expect(done.staffId).toBeNull();
    expect(await db.housekeepingIssue.count({ where: { jobId: id } })).toBe(0);
  });
});

describe("edit, assign and cancel", () => {
  it("assigns while open; a job in progress can't lose its staff member", async () => {
    asHousekeeping();
    const id = await openJob();
    mustOk(await updateHousekeepingJob(id, { roomId, staffId, priority: "URGENT" }), "assign");
    expect(await job(id)).toMatchObject({ roomId, staffId, priority: JobPriority.URGENT });
    mustOk(await startHousekeepingJob(id), "start with the assigned staff");
    const why = await expectRefused(() => updateHousekeepingJob(id, { staffId: null }));
    expect(why).toMatch(/needs someone on it/);
    expect((await job(id)).staffId).toBe(staffId);
  });

  it("cancels with a reason; CANCELLED is terminal", async () => {
    asHousekeeping();
    const id = await openJob({ roomId });
    expect(await expectRefused(() => cancelHousekeepingJob(id, " "))).toMatch(/Say why/);
    mustOk(await cancelHousekeepingJob(id, "Guest left early"), "cancel");
    const c = await job(id);
    expect(c.status).toBe(DeptJobStatus.CANCELLED);
    expect(c.cancelledAt).not.toBeNull();
    expect(c.outcome).toBe("Guest left early");
    expect(c.closedById).toBe(desk("housekeeping").id);

    expect(await expectRefused(() => startHousekeepingJob(id, { staffId }))).toBe("This job was cancelled");
    expect(await expectRefused(() => completeHousekeepingJob(id, { outcome: "did it anyway" }))).toBe(
      "This job was cancelled",
    );
    expect(await expectRefused(() => cancelHousekeepingJob(id, "again"))).toBe("This job was cancelled");
  });

  it("lists by status, most urgent first", async () => {
    asHousekeeping();
    const low = await openJob({ priority: "LOW", description: `Low one ${tag}` });
    const urgent = await openJob({ priority: "URGENT", description: `Urgent one ${tag}` });
    const rows = await listHousekeepingJobs({ status: DeptJobStatus.OPEN, from: today(), to: today() });
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(urgent)).toBeLessThan(ids.indexOf(low));
    expect(rows.every((r) => r.status === DeptJobStatus.OPEN)).toBe(true);
  });
});

describe("a job opened over the desk's head", () => {
  it("tells the housekeeping head when a manager opens it, and not when they open it themselves", async () => {
    asManager();
    const byManager = await openJob({ roomId, description: `Leaking shower ${tag}` });
    asHousekeeping();
    const byDesk = await openJob();
    await flushDeferred();

    const told = await db.notification.findMany({
      where: { userId: desk("housekeeping").id, dedupeKey: `hk-job:${byManager}` },
    });
    expect(told).toHaveLength(1);
    expect(told[0].link).toBe(`/housekeeping/jobs/${byManager}`);
    expect(told[0].body).toContain(`Room J-${tag}: Leaking shower ${tag}`);
    expect(
      await db.notification.count({ where: { dedupeKey: `hk-job:${byDesk}` } }),
    ).toBe(0);
  });
});

describe("who may touch a job", () => {
  it("the maintenance head, the store keeper and the chef are refused on every job action", async () => {
    asHousekeeping();
    const id = await openJob({ roomId, staffId });
    for (const become of [asMaintenance, asStore, asChef]) {
      become();
      const calls = [
        () => createHousekeepingJob({ type: "OTHER", description: "not mine" }),
        () => updateHousekeepingJob(id, { priority: "LOW" }),
        () => startHousekeepingJob(id),
        () => completeHousekeepingJob(id, { outcome: "not mine", items: [{ itemId: soap, qty: "1" }] }),
        () => cancelHousekeepingJob(id, "not mine"),
        () => listHousekeepingJobs(),
        () => getHousekeepingJob(id),
      ];
      for (const call of calls) {
        expect(await expectRefused(call)).toBe("Requires one of: ADMIN, MANAGER, HOUSEKEEPING_MANAGER");
      }
    }
    expect((await job(id)).status).toBe(DeptJobStatus.OPEN);
    expectDecimal((await stock(soap)).currentStock, "7", "soap untouched");
  });
});

describe("the department's module, adjusted", () => {
  it("the housekeeping head is refused a direct receipt; the manager posts one", async () => {
    asHousekeeping();
    const line = { receivedAt: istInput(new Date()), lines: [{ itemId: soap, quantity: "3" }] };
    expect(await expectRefused(() => recordHousekeepingReceipt(line))).toBe("Requires one of: ADMIN, MANAGER");
    expectDecimal((await stock(soap)).currentStock, "7", "soap untouched");
    asManager();
    mustOk(await recordHousekeepingReceipt(line), "manager receipt");
    expectDecimal((await stock(soap)).currentStock, "10", "soap restocked");
  });

  it("the maintenance head adds and edits rooms, but can't take one out of service or delete it", async () => {
    asMaintenance();
    const id = mustOk(
      await upsertRoom({ number: `M-${tag}`, type: RoomType.STANDARD, active: true }),
      "maintenance adds a room",
    ).id;
    mustOk(
      await upsertRoom({ number: `M-${tag}`, name: "Plant room", type: RoomType.OTHER, active: false }, id),
      "maintenance edits it",
    );
    const room = await db.room.findUniqueOrThrow({ where: { id } });
    expect(room).toMatchObject({ name: "Plant room", type: RoomType.OTHER, active: true });

    expect(await expectRefused(() => deleteRoom(id))).toBe("Requires one of: ADMIN, MANAGER, HOUSEKEEPING_MANAGER");
    expect(await expectRefused(() => deactivateRoom(id))).toBe(
      "Requires one of: ADMIN, MANAGER, HOUSEKEEPING_MANAGER",
    );
    expect((await db.room.findUniqueOrThrow({ where: { id } })).active).toBe(true);
  });

  it("a room with jobs can't be deleted — its history would lose the room", async () => {
    asHousekeeping();
    const why = await expectRefused(() => deleteRoom(roomId));
    expect(why).toMatch(/job/);
    expect(await db.room.count({ where: { id: roomId } })).toBe(1);
  });

  it("an item on a stock request line can't be deleted — it has history", async () => {
    asHousekeeping();
    const requested = await newItem("Requested shampoo", "0");
    const po = await db.deptPurchaseOrder.create({
      data: {
        number: `HK-PO-E2E-${tag}`,
        department: "HOUSEKEEPING",
        reason: "Running low",
        createdById: desk("housekeeping").id,
        lines: { create: [{ hkItemId: requested, itemName: `Requested shampoo ${tag}`, unit: "piece", quantity: "5" }] },
      },
    });
    const why = await expectRefused(() => deleteHousekeepingItem(requested));
    expect(why).toBe("This item has history (1 stock request line). Deactivate instead to keep the audit trail.");
    expect(await db.housekeepingItem.count({ where: { id: requested } })).toBe(1);
    expect(await db.deptPurchaseOrderLine.count({ where: { poId: po.id, hkItemId: requested } })).toBe(1);
  });

  it("the summary counts open jobs; the report counts the period", async () => {
    asHousekeeping();
    const live = await db.housekeepingJob.count({
      where: { status: { in: [DeptJobStatus.OPEN, DeptJobStatus.IN_PROGRESS] } },
    });
    expect((await housekeepingSummary()).openJobs).toBe(live);

    const r = await jobsReport("CUSTOM", { from: today(), to: today() });
    expect(r.openNow).toBe(live);
    const checkout = r.byType.find((t) => t.type === HousekeepingJobType.CHECKOUT_CLEAN);
    expect(checkout).toMatchObject({ opened: 1, done: 1 });
    expect(checkout?.avgHoursToClose).not.toBeNull();
    expect(r.done).toBe(r.byType.reduce((n, t) => n + t.done, 0));
  });
});
