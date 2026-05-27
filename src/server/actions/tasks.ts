"use server";

import { revalidatePath } from "next/cache";
import { Prisma, Role, TaskStatus } from "@prisma/client";
import { db } from "@/server/db";
import { requireRole, requireSession } from "@/server/rbac";
import { istToUtc } from "@/lib/time";
import {
  TaskAssignInput,
  TaskCancelInput,
  TaskReviewInput,
  TaskSubmitInput,
  TaskTemplateInput,
  TaskUpdateInput,
} from "@/lib/validators";
import { createNotification } from "@/server/actions/notifications";

// Admin/manager line-management tasks distinct from operational workflow.
// Lifecycle:
//   ASSIGNED → (assignee submits with remarks) → SUBMITTED
//   SUBMITTED → (assigner approves) → COMPLETED
//   SUBMITTED → (assigner rejects with reason) → REJECTED → assignee may re-submit
//   ASSIGNED/SUBMITTED → (assigner) → CANCELLED
//
// Audit log: every transition writes an AuditLog row inside the same
// transaction, matching CLAUDE.md hard rule.

const ASSIGNER_ROLES = [Role.ADMIN, Role.MANAGER];

// ─── Templates ────────────────────────────────────────────────────────

export async function upsertTaskTemplate(raw: unknown) {
  const session = await requireRole(ASSIGNER_ROLES);
  const input = TaskTemplateInput.parse(raw);

  const row = await db.$transaction(async (tx) => {
    if (input.id) {
      const updated = await tx.taskTemplate.update({
        where: { id: input.id },
        data: {
          title: input.title,
          description: input.description ?? null,
          active: input.active ?? true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "TASK_TEMPLATE_UPDATED",
          entity: "TaskTemplate",
          entityId: updated.id,
        },
      });
      return updated;
    }
    const created = await tx.taskTemplate.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        active: input.active ?? true,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "TASK_TEMPLATE_CREATED",
        entity: "TaskTemplate",
        entityId: created.id,
      },
    });
    return created;
  });

  revalidatePath("/tasks/admin");
  return { id: row.id };
}

export async function deactivateTaskTemplate(id: string) {
  const session = await requireRole(ASSIGNER_ROLES);
  await db.$transaction(async (tx) => {
    await tx.taskTemplate.update({ where: { id }, data: { active: false } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "TASK_TEMPLATE_DEACTIVATED",
        entity: "TaskTemplate",
        entityId: id,
      },
    });
  });
  revalidatePath("/tasks/admin");
}

export async function listTaskTemplates(opts: { activeOnly?: boolean } = {}) {
  await requireSession();
  return db.taskTemplate.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: [{ active: "desc" }, { title: "asc" }],
  });
}

// ─── Assigner: assign / edit / cancel ─────────────────────────────────

export async function assignTask(raw: unknown) {
  const session = await requireRole(ASSIGNER_ROLES);
  const input = TaskAssignInput.parse(raw);

  // Verify assignee exists + is active.
  const assignee = await db.user.findUnique({
    where: { id: input.assignedToId },
    select: { id: true, active: true },
  });
  if (!assignee || !assignee.active) {
    throw new Error("Assignee not found or inactive");
  }

  const targetUtc = istToUtc(input.targetDate);

  const task = await db.$transaction(async (tx) => {
    const row = await tx.task.create({
      data: {
        title: input.title.trim(),
        description: input.description?.trim() || null,
        priority: input.priority,
        targetDate: targetUtc,
        assignedToId: input.assignedToId,
        assignedById: session.user.id,
        templateId: input.templateId || null,
        status: TaskStatus.ASSIGNED,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "TASK_ASSIGNED",
        entity: "Task",
        entityId: row.id,
      },
    });
    return row;
  });

  // Notify the assignee that a new task is waiting for them. dedupe by
  // task id so a redundant re-fire doesn't create duplicates.
  await createNotification({
    userId: input.assignedToId,
    kind: "TASK_ASSIGNED",
    title: `New task: ${input.title.trim().slice(0, 80)}`,
    body: input.description?.slice(0, 200) ?? null,
    link: `/tasks/${task.id}`,
    dedupeKey: `task-assigned:${task.id}`,
  });

  revalidatePath("/tasks");
  revalidatePath("/tasks/admin");
  revalidatePath("/dashboard");
  return { id: task.id };
}

export async function updateTask(raw: unknown) {
  const session = await requireRole(ASSIGNER_ROLES);
  const input = TaskUpdateInput.parse(raw);

  await db.$transaction(async (tx) => {
    const existing = await tx.task.findUnique({ where: { id: input.id } });
    if (!existing) throw new Error("Task not found");
    // Only editable in ASSIGNED or REJECTED states.
    if (
      existing.status !== TaskStatus.ASSIGNED &&
      existing.status !== TaskStatus.REJECTED
    ) {
      throw new Error("This task can no longer be edited");
    }
    await tx.task.update({
      where: { id: input.id },
      data: {
        title: input.title ?? existing.title,
        description:
          input.description !== undefined ? input.description : existing.description,
        priority: input.priority ?? existing.priority,
        targetDate: input.targetDate ? istToUtc(input.targetDate) : existing.targetDate,
        assignedToId: input.assignedToId ?? existing.assignedToId,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "TASK_UPDATED",
        entity: "Task",
        entityId: input.id,
      },
    });
  });

  revalidatePath("/tasks");
  revalidatePath("/tasks/admin");
  revalidatePath(`/tasks/${input.id}`);
}

export async function cancelTask(raw: unknown) {
  const session = await requireRole(ASSIGNER_ROLES);
  const input = TaskCancelInput.parse(raw);

  await db.$transaction(async (tx) => {
    const t = await tx.task.findUnique({ where: { id: input.id } });
    if (!t) throw new Error("Task not found");
    if (t.status === TaskStatus.COMPLETED || t.status === TaskStatus.CANCELLED) {
      throw new Error("Task is already closed");
    }
    await tx.task.update({
      where: { id: input.id },
      data: {
        status: TaskStatus.CANCELLED,
        reviewedAt: new Date(),
        reviewedById: session.user.id,
        rejectionReason: input.reason || null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "TASK_CANCELLED",
        entity: "Task",
        entityId: input.id,
      },
    });
  });

  revalidatePath("/tasks");
  revalidatePath("/tasks/admin");
  revalidatePath(`/tasks/${input.id}`);
}

// ─── Assignee: submit ─────────────────────────────────────────────────

export async function submitTask(raw: unknown) {
  const session = await requireSession();
  const input = TaskSubmitInput.parse(raw);

  await db.$transaction(async (tx) => {
    const t = await tx.task.findUnique({ where: { id: input.id } });
    if (!t) throw new Error("Task not found");
    if (t.assignedToId !== session.user.id) {
      throw new Error("You cannot submit someone else's task");
    }
    if (t.status !== TaskStatus.ASSIGNED && t.status !== TaskStatus.REJECTED) {
      throw new Error("This task isn't open for submission");
    }
    await tx.task.update({
      where: { id: input.id },
      data: {
        status: TaskStatus.SUBMITTED,
        submittedAt: new Date(),
        completionRemarks: input.completionRemarks.trim(),
        completedAt: input.completedAt ? istToUtc(input.completedAt) : new Date(),
        // Clear any prior rejection state.
        rejectionReason: null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "TASK_SUBMITTED",
        entity: "Task",
        entityId: input.id,
      },
    });
  });

  // Notify the assigner that the task is awaiting their review.
  const taskAfter = await db.task.findUnique({
    where: { id: input.id },
    select: { title: true, assignedById: true, submittedAt: true },
  });
  if (taskAfter) {
    await createNotification({
      userId: taskAfter.assignedById,
      kind: "TASK_SUBMITTED",
      title: `Task ready for review: ${taskAfter.title.slice(0, 80)}`,
      body: "Tap to approve or reject the submission.",
      link: `/tasks/${input.id}`,
      // Re-submissions after a reject get a fresh dedupe key via the
      // submittedAt timestamp so the assigner sees each cycle.
      dedupeKey: `task-submitted:${input.id}:${taskAfter.submittedAt?.toISOString() ?? ""}`,
    });
  }

  revalidatePath("/tasks");
  revalidatePath("/tasks/admin");
  revalidatePath(`/tasks/${input.id}`);
  revalidatePath("/dashboard");
}

// ─── Assigner: review (approve / reject) ──────────────────────────────

export async function reviewTask(raw: unknown) {
  const session = await requireRole(ASSIGNER_ROLES);
  const input = TaskReviewInput.parse(raw);

  if (input.decision === "REJECT") {
    if (!input.rejectionReason || input.rejectionReason.trim().length < 3) {
      throw new Error("Rejection reason is required");
    }
  }

  await db.$transaction(async (tx) => {
    const t = await tx.task.findUnique({ where: { id: input.id } });
    if (!t) throw new Error("Task not found");
    if (t.status !== TaskStatus.SUBMITTED) {
      throw new Error("Only submitted tasks can be reviewed");
    }
    await tx.task.update({
      where: { id: input.id },
      data: {
        status:
          input.decision === "APPROVE" ? TaskStatus.COMPLETED : TaskStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedById: session.user.id,
        rejectionReason:
          input.decision === "REJECT" ? input.rejectionReason!.trim() : null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: input.decision === "APPROVE" ? "TASK_APPROVED" : "TASK_REJECTED",
        entity: "Task",
        entityId: input.id,
      },
    });
  });

  revalidatePath("/tasks");
  revalidatePath("/tasks/admin");
  revalidatePath(`/tasks/${input.id}`);
  revalidatePath("/dashboard");
}

// ─── Read helpers ─────────────────────────────────────────────────────

export type TaskTab = "PENDING" | "SUBMITTED" | "COMPLETED" | "REJECTED" | "ALL";

const STATUS_BY_TAB: Record<TaskTab, TaskStatus[] | undefined> = {
  PENDING: [TaskStatus.ASSIGNED, TaskStatus.REJECTED],
  SUBMITTED: [TaskStatus.SUBMITTED],
  COMPLETED: [TaskStatus.COMPLETED],
  REJECTED: [TaskStatus.REJECTED, TaskStatus.CANCELLED],
  ALL: undefined,
};

export interface ListTasksOpts {
  tab?: TaskTab;
  assignedToId?: string;
  assignedById?: string;
  // Date range applies to targetDate.
  from?: string;
  to?: string;
  /** Only my own tasks (assignee view). */
  scope?: "MINE" | "ASSIGNED_BY_ME" | "ANY";
}

export async function listTasks(opts: ListTasksOpts = {}) {
  const session = await requireSession();
  const where: Prisma.TaskWhereInput = {};

  const statuses = opts.tab ? STATUS_BY_TAB[opts.tab] : undefined;
  if (statuses) where.status = { in: statuses };

  if (opts.assignedToId) where.assignedToId = opts.assignedToId;
  if (opts.assignedById) where.assignedById = opts.assignedById;

  if (opts.from || opts.to) {
    where.targetDate = {};
    if (opts.from) (where.targetDate as Prisma.DateTimeFilter).gte = istToUtc(opts.from);
    if (opts.to) (where.targetDate as Prisma.DateTimeFilter).lte = istToUtc(opts.to);
  }

  // Scope enforcement: non-admins only see their own assignments by default.
  const role = session.user.role;
  const canSeeAll = role === Role.ADMIN || role === Role.MANAGER;
  if (!canSeeAll || opts.scope === "MINE") {
    where.assignedToId = session.user.id;
  } else if (opts.scope === "ASSIGNED_BY_ME") {
    where.assignedById = session.user.id;
  }

  return db.task.findMany({
    where,
    include: {
      assignedTo: { select: { id: true, name: true, role: true } },
      assignedBy: { select: { id: true, name: true, role: true } },
      reviewedBy: { select: { id: true, name: true, role: true } },
    },
    orderBy: [{ status: "asc" }, { targetDate: "asc" }],
  });
}

export async function getTaskById(id: string) {
  const session = await requireSession();
  const t = await db.task.findUnique({
    where: { id },
    include: {
      assignedTo: { select: { id: true, name: true, role: true, email: true } },
      assignedBy: { select: { id: true, name: true, role: true } },
      reviewedBy: { select: { id: true, name: true, role: true } },
      template: { select: { id: true, title: true } },
    },
  });
  if (!t) return null;
  const role = session.user.role;
  const isAssigner = role === Role.ADMIN || role === Role.MANAGER;
  const isAssignee = t.assignedToId === session.user.id;
  if (!isAssigner && !isAssignee) return null;
  return t;
}

/** Dashboard counters for the current user. */
export async function myTaskCounts() {
  const session = await requireSession();
  const groups = await db.task.groupBy({
    by: ["status"],
    where: { assignedToId: session.user.id },
    _count: { _all: true },
  });
  const out = { open: 0, submitted: 0, completed: 0, rejected: 0, overdue: 0 };
  for (const g of groups) {
    if (g.status === TaskStatus.ASSIGNED || g.status === TaskStatus.REJECTED)
      out.open += g._count._all;
    if (g.status === TaskStatus.SUBMITTED) out.submitted = g._count._all;
    if (g.status === TaskStatus.COMPLETED) out.completed = g._count._all;
    if (g.status === TaskStatus.REJECTED) out.rejected = g._count._all;
  }
  out.overdue = await db.task.count({
    where: {
      assignedToId: session.user.id,
      status: { in: [TaskStatus.ASSIGNED, TaskStatus.REJECTED] },
      targetDate: { lt: new Date() },
    },
  });
  return out;
}

/** Admin counters across all tasks. */
export async function adminTaskCounts() {
  await requireRole(ASSIGNER_ROLES);
  const groups = await db.task.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const out = {
    assigned: 0,
    submitted: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
    overdue: 0,
    longPending: 0,
  };
  for (const g of groups) {
    if (g.status === TaskStatus.ASSIGNED) out.assigned = g._count._all;
    if (g.status === TaskStatus.SUBMITTED) out.submitted = g._count._all;
    if (g.status === TaskStatus.COMPLETED) out.completed = g._count._all;
    if (g.status === TaskStatus.REJECTED) out.rejected = g._count._all;
    if (g.status === TaskStatus.CANCELLED) out.cancelled = g._count._all;
  }
  const now = new Date();
  out.overdue = await db.task.count({
    where: {
      status: { in: [TaskStatus.ASSIGNED, TaskStatus.REJECTED] },
      targetDate: { lt: now },
    },
  });
  // Long-pending = open + assigned >3 days ago. Used for the bell on admin
  // dashboard.
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  out.longPending = await db.task.count({
    where: {
      status: { in: [TaskStatus.ASSIGNED, TaskStatus.REJECTED] },
      assignedAt: { lt: threeDaysAgo },
    },
  });
  return out;
}

/** List "long pending" tasks for the admin notification panel. */
export async function listLongPendingTasks(limit = 8) {
  await requireRole(ASSIGNER_ROLES);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  return db.task.findMany({
    where: {
      status: { in: [TaskStatus.ASSIGNED, TaskStatus.REJECTED] },
      assignedAt: { lt: threeDaysAgo },
    },
    include: {
      assignedTo: { select: { id: true, name: true, role: true } },
    },
    orderBy: [{ priority: "desc" }, { targetDate: "asc" }],
    take: limit,
  });
}

/** Used by the "assign" form to populate the user dropdown. */
export async function listAssignableUsers() {
  await requireRole(ASSIGNER_ROLES);
  return db.user.findMany({
    where: { active: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
}
