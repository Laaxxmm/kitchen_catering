"use server";

import { revalidatePath } from "next/cache";
import { DeptJobStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole } from "@/server/rbac";
import { istToUtc } from "@/lib/time";
import { sha256Json } from "@/lib/audit";
import { deferAfterResponse } from "@/server/defer";
import { notifyRoles } from "@/server/notification-core";
import {
  dateRange,
  drawHousekeepingIssue,
  notifyHousekeepingLowStock,
  toQty,
} from "@/server/housekeeping-stock";
import {
  HK_JOB_TYPE_LABEL,
  HousekeepingJobCancelInput,
  HousekeepingJobCompleteInput,
  HousekeepingJobCreateInput,
  HousekeepingJobStartInput,
  HousekeepingJobUpdateInput,
} from "@/lib/housekeeping-job-validators";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";

/**
 * Housekeeping jobs — the department's own work orders. The housekeeping
 * head opens a job (room 102 checkout clean, guest wants extra towels),
 * assigns and starts it, and closes it with what was done and what was
 * used. Closing with items draws them from the housekeeping store as ONE
 * HousekeepingIssue linked to the job, in the same transaction. No
 * approvals anywhere: the department runs its own jobs.
 *
 * OPEN → IN_PROGRESS → DONE, or → CANCELLED from either open state. DONE
 * and CANCELLED are terminal. Every move is a status-guarded updateMany,
 * so two people pressing the same button can't both win.
 */

type Tx = Prisma.TransactionClient;

const JOB_ROLES = [Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER];
const LIVE: DeptJobStatus[] = [DeptJobStatus.OPEN, DeptJobStatus.IN_PROGRESS];

function revalidateJobs(id?: string) {
  revalidatePath("/housekeeping/jobs");
  if (id) revalidatePath(`/housekeeping/jobs/${id}`);
  revalidatePath("/housekeeping");
}

/** Read the job and refuse unless it is still OPEN / IN_PROGRESS. */
async function liveJob(tx: Tx, id: string) {
  const job = await tx.housekeepingJob.findUnique({
    where: { id },
    select: { id: true, status: true, type: true, description: true, roomId: true, staffId: true },
  });
  if (!job) throw new ActionError("Job not found");
  if (job.status === DeptJobStatus.DONE) throw new ActionError("This job is already done");
  if (job.status === DeptJobStatus.CANCELLED) throw new ActionError("This job was cancelled");
  return job;
}

async function assertActiveRoom(tx: Tx, roomId: string): Promise<string> {
  const room = await tx.room.findUnique({ where: { id: roomId }, select: { active: true, number: true } });
  if (!room?.active) throw new ActionError("Pick an active room");
  return room.number;
}

async function assertActiveStaff(tx: Tx, staffId: string) {
  const staff = await tx.housekeepingStaff.findUnique({ where: { id: staffId }, select: { active: true } });
  if (!staff?.active) throw new ActionError("Pick an active staff member");
}

function changedUnderYou(count: number) {
  if (count !== 1) throw new ActionError("This job changed under you — refresh and try again");
}

// ─── Open ─────────────────────────────────────────────────────────────

export async function createHousekeepingJob(raw: unknown): Promise<ActionResultWith<{ id: string }>> {
  try {
    const session = await requireRole(JOB_ROLES);
    const input = HousekeepingJobCreateInput.parse(raw);
    let reportedAt = new Date();
    if (input.reportedAt) {
      reportedAt = istToUtc(input.reportedAt);
      if (Number.isNaN(reportedAt.getTime())) throw new ActionError("Reported at isn't a valid date and time");
    }

    const job = await db.$transaction(async (tx) => {
      const roomNumber = input.roomId ? await assertActiveRoom(tx, input.roomId) : null;
      if (input.staffId) await assertActiveStaff(tx, input.staffId);
      const created = await tx.housekeepingJob.create({
        data: {
          type: input.type,
          priority: input.priority,
          roomId: input.roomId ?? null,
          staffId: input.staffId ?? null,
          description: input.description,
          notes: input.notes ?? null,
          reportedAt,
          reportedById: session.user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "HK_JOB_CREATED",
          entity: "HousekeepingJob",
          entityId: created.id,
          payloadHash: sha256Json({
            type: input.type,
            priority: input.priority,
            roomId: input.roomId ?? null,
            staffId: input.staffId ?? null,
            description: input.description,
            reportedAt: reportedAt.toISOString(),
          }),
        },
      });
      return { id: created.id, roomNumber };
    });

    // The desk runs its own jobs; one opened over its head is news to it.
    if (session.user.role !== Role.HOUSEKEEPING_MANAGER) {
      deferAfterResponse("housekeeping:job:opened", () =>
        notifyRoles([Role.HOUSEKEEPING_MANAGER], {
          kind: "GENERIC",
          title: `Housekeeping job opened — ${HK_JOB_TYPE_LABEL[input.type]}`,
          body: `${job.roomNumber ? `Room ${job.roomNumber}: ` : ""}${input.description} — by ${session.user.name ?? session.user.email}`,
          link: `/housekeeping/jobs/${job.id}`,
          dedupeKey: `hk-job:${job.id}`,
        }),
      );
    }

    revalidateJobs();
    return { ok: true, id: job.id };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Edit / assign ────────────────────────────────────────────────────

export async function updateHousekeepingJob(id: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(JOB_ROLES);
    const input = HousekeepingJobUpdateInput.parse(raw);

    await db.$transaction(async (tx) => {
      const job = await liveJob(tx, id);
      if (input.roomId) await assertActiveRoom(tx, input.roomId);
      if (input.staffId) await assertActiveStaff(tx, input.staffId);
      if (job.status === DeptJobStatus.IN_PROGRESS && input.staffId === null) {
        throw new ActionError("A job in progress needs someone on it — reassign instead of clearing");
      }
      const data = {
        type: input.type,
        priority: input.priority,
        roomId: input.roomId,
        staffId: input.staffId,
        description: input.description,
        notes: input.notes,
      };
      // Guarded on the status just read: the in-progress staff rule above
      // must still hold when the row is written.
      const res = await tx.housekeepingJob.updateMany({ where: { id, status: job.status }, data });
      changedUnderYou(res.count);
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "HK_JOB_UPDATED",
          entity: "HousekeepingJob",
          entityId: id,
          payloadHash: sha256Json(data),
        },
      });
    });

    revalidateJobs(id);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Start ────────────────────────────────────────────────────────────

export async function startHousekeepingJob(
  id: string,
  raw: { staffId?: string | null } = {},
): Promise<ActionResult> {
  try {
    const session = await requireRole(JOB_ROLES);
    const input = HousekeepingJobStartInput.parse(raw);

    await db.$transaction(async (tx) => {
      const job = await liveJob(tx, id);
      if (job.status !== DeptJobStatus.OPEN) throw new ActionError("This job is already in progress");
      const staffId = input.staffId ?? job.staffId;
      if (!staffId) throw new ActionError("Assign a staff member before starting the job");
      await assertActiveStaff(tx, staffId);
      const res = await tx.housekeepingJob.updateMany({
        where: { id, status: DeptJobStatus.OPEN },
        data: { status: DeptJobStatus.IN_PROGRESS, startedAt: new Date(), staffId },
      });
      changedUnderYou(res.count);
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "HK_JOB_STARTED",
          entity: "HousekeepingJob",
          entityId: id,
          payloadHash: sha256Json({ staffId }),
        },
      });
    });

    revalidateJobs(id);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Complete ─────────────────────────────────────────────────────────

export async function completeHousekeepingJob(
  id: string,
  raw: {
    outcome: string;
    items?: Array<{ itemId: string; qty: string }>;
    roomId?: string | null;
    staffId?: string | null;
  },
): Promise<ActionResultWith<{ issueId: string | null }>> {
  try {
    const session = await requireRole(JOB_ROLES);
    const input = HousekeepingJobCompleteInput.parse(raw);
    const lines = input.items.map((l, i) => ({ itemId: l.itemId, qty: toQty(l.qty, `Line ${i + 1}`) }));

    const outcome = await db.$transaction(async (tx) => {
      const job = await liveJob(tx, id);
      const roomId = input.roomId === undefined ? job.roomId : input.roomId;
      const staffId = input.staffId === undefined ? job.staffId : input.staffId;
      if (input.roomId) await assertActiveRoom(tx, input.roomId);
      if (input.staffId) await assertActiveStaff(tx, input.staffId);
      if (lines.length > 0 && (!roomId || !staffId)) {
        throw new ActionError("Items were used — pick the room and the staff member they went with");
      }

      // Flip first: the row lock this takes serialises a second Complete,
      // which then finds the job no longer live and draws nothing.
      const now = new Date();
      const res = await tx.housekeepingJob.updateMany({
        where: { id, status: { in: LIVE } },
        data: {
          status: DeptJobStatus.DONE,
          completedAt: now,
          closedById: session.user.id,
          outcome: input.outcome,
          roomId,
          staffId,
        },
      });
      changedUnderYou(res.count);

      const issue =
        lines.length > 0
          ? await drawHousekeepingIssue(tx, {
              recordedById: session.user.id,
              issuedAt: now,
              staffId: staffId!,
              roomId: roomId!,
              purpose: `${HK_JOB_TYPE_LABEL[job.type]}: ${job.description}`.slice(0, 200),
              notes: input.outcome,
              jobId: id,
              lines,
            })
          : null;

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "HK_JOB_COMPLETED",
          entity: "HousekeepingJob",
          entityId: id,
          payloadHash: sha256Json({
            outcome: input.outcome,
            roomId,
            staffId,
            issueId: issue?.id ?? null,
            items: lines.map((l) => ({ itemId: l.itemId, qty: l.qty.toString() })),
          }),
        },
      });
      return issue;
    });

    if (outcome) {
      notifyHousekeepingLowStock(outcome.crossed);
      revalidatePath("/housekeeping/issues");
      revalidatePath("/housekeeping/items");
    }
    revalidateJobs(id);
    return { ok: true, issueId: outcome?.id ?? null };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Cancel ───────────────────────────────────────────────────────────

export async function cancelHousekeepingJob(id: string, reason: string): Promise<ActionResult> {
  try {
    const session = await requireRole(JOB_ROLES);
    const input = HousekeepingJobCancelInput.parse({ reason });

    await db.$transaction(async (tx) => {
      await liveJob(tx, id);
      const res = await tx.housekeepingJob.updateMany({
        where: { id, status: { in: LIVE } },
        data: {
          status: DeptJobStatus.CANCELLED,
          cancelledAt: new Date(),
          closedById: session.user.id,
          outcome: input.reason,
        },
      });
      changedUnderYou(res.count);
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "HK_JOB_CANCELLED",
          entity: "HousekeepingJob",
          entityId: id,
          payloadHash: sha256Json({ reason: input.reason }),
        },
      });
    });

    revalidateJobs(id);
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// ─── Reads ────────────────────────────────────────────────────────────

export async function listHousekeepingJobs(
  opts: {
    status?: DeptJobStatus;
    roomId?: string;
    staffId?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {},
) {
  await requireRole(JOB_ROLES);
  const where: Prisma.HousekeepingJobWhereInput = {};
  if (opts.status) where.status = opts.status;
  if (opts.roomId) where.roomId = opts.roomId;
  if (opts.staffId) where.staffId = opts.staffId;
  const reportedAt = dateRange(opts.from, opts.to);
  if (reportedAt) where.reportedAt = reportedAt;
  const live = !opts.status || LIVE.includes(opts.status);

  return db.housekeepingJob.findMany({
    where,
    take: opts.limit ?? 300,
    // Live work: most urgent first, then oldest. History: newest first.
    orderBy: live ? [{ priority: "desc" }, { reportedAt: "asc" }] : [{ reportedAt: "desc" }],
    include: {
      room: { select: { id: true, number: true, name: true } },
      staff: { select: { id: true, name: true } },
      reportedBy: { select: { id: true, name: true } },
      issue: { select: { id: true } },
    },
  });
}

export async function getHousekeepingJob(id: string) {
  await requireRole(JOB_ROLES);
  return db.housekeepingJob.findUnique({
    where: { id },
    include: {
      room: { select: { id: true, number: true, name: true } },
      staff: { select: { id: true, name: true } },
      reportedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      issue: {
        include: {
          room: { select: { id: true, number: true, name: true } },
          staff: { select: { id: true, name: true } },
          lines: { include: { item: { select: { id: true, name: true, unit: true } } } },
        },
      },
    },
  });
}
