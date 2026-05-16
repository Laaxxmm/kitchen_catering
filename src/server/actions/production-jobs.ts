"use server";

import { revalidatePath } from "next/cache";
import {
  OrderStatus,
  ProductionJobItemStatus,
  ProductionJobStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  AuthorizationError,
  ORDER_KITCHEN_ROLES,
  ORDER_MANAGER_ROLES,
  requireRole,
  requireSession,
} from "@/server/rbac";
import { ProductionJobItemAssignInput } from "@/lib/validators";
import { nextProductionJobNo } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";

const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD, Role.STORE_KEEPER, Role.SALES, Role.ACCOUNTS,
];

/**
 * Internal helper: create the ProductionJob (+ one ProductionJobItem per
 * OrderItem) for an order. Idempotent on order: if a job already exists,
 * does nothing. Called from inside the chef-requisitions transaction once
 * the order auto-advances to READY_FOR_PRODUCTION.
 *
 * Schedules:
 *   scheduledStart = max(now, eventDate - 3h)
 *   scheduledReady = eventDate
 */
export async function createProductionJobForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
): Promise<string | null> {
  const existing = await tx.productionJob.findFirst({ where: { orderId } });
  if (existing) return existing.id;

  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!order) throw new Error("Order not found");
  if (order.items.length === 0) return null;

  const jobNo = await nextProductionJobNo(tx);
  const eventMs = order.eventDate.getTime();
  const startMs = Math.max(Date.now(), eventMs - 3 * 60 * 60 * 1000);

  const job = await tx.productionJob.create({
    data: {
      jobNo,
      orderId,
      status: ProductionJobStatus.QUEUED,
      scheduledStart: new Date(startMs),
      scheduledReady: order.eventDate,
      items: {
        create: order.items.map((it) => ({
          dishId: it.dishId,
          portions: it.portions,
          status: ProductionJobItemStatus.QUEUED,
        })),
      },
    },
  });
  return job.id;
}

export async function assignChef(raw: unknown) {
  const session = await requireRole([...ORDER_MANAGER_ROLES, ...ORDER_KITCHEN_ROLES]);
  const input = ProductionJobItemAssignInput.parse(raw);

  await db.$transaction(async (tx) => {
    const item = await tx.productionJobItem.findUnique({
      where: { id: input.itemId },
      select: { jobId: true },
    });
    if (!item) throw new Error("Production item not found");
    await tx.productionJobItem.update({
      where: { id: input.itemId },
      data: { chefUserId: input.chefUserId },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PRODUCTION_ITEM_ASSIGNED",
        entity: "ProductionJobItem",
        entityId: input.itemId,
        payloadHash: sha256Json({ chefUserId: input.chefUserId }),
      },
    });
  });

  revalidatePath("/kitchen");
}

export async function startProductionItem(itemId: string) {
  const session = await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);
  await db.$transaction(async (tx) => {
    const item = await tx.productionJobItem.findUnique({
      where: { id: itemId },
      select: { id: true, status: true, jobId: true, chefUserId: true },
    });
    if (!item) throw new Error("Production item not found");
    if (item.status !== ProductionJobItemStatus.QUEUED) {
      throw new AuthorizationError(`Cannot start item in status ${item.status}`);
    }
    await tx.productionJobItem.update({
      where: { id: itemId },
      data: {
        status: ProductionJobItemStatus.IN_PROGRESS,
        startedAt: new Date(),
        // Auto-attribute the chef on first "Start" — no manual
        // assignment step. Only set if not already assigned, so re-runs
        // don't overwrite a deliberate prior assignment.
        ...(item.chefUserId ? {} : { chefUserId: session.user.id }),
      },
    });

    // If this is the first item in PREP, cascade the parent job.
    const job = await tx.productionJob.findUnique({
      where: { id: item.jobId },
      select: { id: true, status: true, actualStart: true },
    });
    if (job && job.status === ProductionJobStatus.QUEUED) {
      await tx.productionJob.update({
        where: { id: job.id },
        data: {
          status: ProductionJobStatus.PREP,
          actualStart: job.actualStart ?? new Date(),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PRODUCTION_ITEM_STARTED",
        entity: "ProductionJobItem",
        entityId: itemId,
      },
    });
  });
  revalidatePath("/kitchen");
}

export async function markProductionItemReady(itemId: string) {
  const session = await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);
  await db.$transaction(async (tx) => {
    const item = await tx.productionJobItem.findUnique({
      where: { id: itemId },
      select: { id: true, status: true, jobId: true },
    });
    if (!item) throw new Error("Production item not found");
    if (item.status === ProductionJobItemStatus.READY) return;

    await tx.productionJobItem.update({
      where: { id: itemId },
      data: { status: ProductionJobItemStatus.READY, readyAt: new Date() },
    });

    // If every sibling item is READY, mark the job READY and cascade order.
    const siblings = await tx.productionJobItem.findMany({
      where: { jobId: item.jobId },
      select: { id: true, status: true },
    });
    const allReady = siblings.every((s) =>
      s.id === item.id ? true : s.status === ProductionJobItemStatus.READY || s.status === ProductionJobItemStatus.CANCELLED,
    );
    if (allReady) {
      const job = await tx.productionJob.update({
        where: { id: item.jobId },
        data: { status: ProductionJobStatus.READY, actualReady: new Date() },
      });
      // Cascade order: IN_PREP / READY_FOR_PRODUCTION -> READY
      await tx.order.update({
        where: { id: job.orderId },
        data: { status: OrderStatus.READY },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PRODUCTION_ITEM_READY",
        entity: "ProductionJobItem",
        entityId: itemId,
      },
    });
  });
  revalidatePath("/kitchen");
  revalidatePath("/orders");
}

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listProductionJobs(opts: { window?: "today" | "tomorrow" | "thisweek" } = {}) {
  await requireRole(READ_ROLES);

  // Window filter on scheduledReady (which equals eventDate).
  let dateFilter: { gte?: Date; lt?: Date } = {};
  if (opts.window) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayMs = 24 * 60 * 60 * 1000;
    if (opts.window === "today") {
      dateFilter = { gte: todayStart, lt: new Date(todayStart.getTime() + dayMs) };
    } else if (opts.window === "tomorrow") {
      dateFilter = { gte: new Date(todayStart.getTime() + dayMs), lt: new Date(todayStart.getTime() + 2 * dayMs) };
    } else {
      dateFilter = { gte: todayStart, lt: new Date(todayStart.getTime() + 7 * dayMs) };
    }
  }

  return db.productionJob.findMany({
    where: {
      ...(opts.window ? { scheduledReady: dateFilter } : {}),
      status: { not: ProductionJobStatus.CANCELLED },
    },
    include: {
      order: {
        select: {
          id: true, code: true, eventDate: true,
          customer: { select: { name: true } },
        },
      },
      items: {
        include: {
          dish: { select: { name: true } },
          chef: { select: { name: true } },
        },
      },
    },
    orderBy: { scheduledReady: "asc" },
    take: 200,
  });
}

export async function getProductionJob(id: string) {
  await requireSession();
  return db.productionJob.findUnique({
    where: { id },
    include: {
      order: { select: { id: true, code: true, eventDate: true, customer: { select: { name: true } } } },
      items: {
        include: {
          dish: { select: { name: true, unit: true } },
          chef: { select: { id: true, name: true } },
        },
        orderBy: { dish: { name: "asc" } },
      },
    },
  });
}

export async function listChefs() {
  await requireRole([...ORDER_KITCHEN_ROLES, Role.MANAGER]);
  return db.user.findMany({
    where: { active: true, role: { in: [Role.KITCHEN_HEAD, Role.ADMIN] } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}
