"use server";

import { revalidatePath } from "next/cache";
import {
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  OrderStatus,
  Role,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  AuthorizationError,
  requireRole,
  REQUISITION_CREATE_ROLES,
  REQUISITION_FULFIL_ROLES,
} from "@/server/rbac";
import {
  ChefRequisitionCreateInput,
  ChefRequisitionIssueInput,
  ChefRequisitionLineInput,
  ChefRequisitionSendToProcurementInput,
} from "@/lib/validators";
import { nextChefRequisitionNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { createProductionJobForOrder } from "./production-jobs";

// =====================================================================
// CREATE / EDIT
// =====================================================================

/**
 * Create a DRAFT chef requisition for an APPROVED-onwards order. Snapshots
 * each line's ingredient avg cost so the planned-cost baseline survives
 * later cost moves.
 */
export async function createChefRequisition(raw: unknown) {
  const session = await requireRole(REQUISITION_CREATE_ROLES);
  const input = ChefRequisitionCreateInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { status: true },
    });
    if (!order) throw new Error("Order not found");
    const ok = order.status === OrderStatus.CHEF_REQUISITION_PENDING
      || order.status === OrderStatus.IN_PREP
      || order.status === OrderStatus.READY_FOR_PRODUCTION
      || order.status === OrderStatus.ISSUING;
    if (!ok) {
      throw new AuthorizationError(`Order status ${order.status} doesn't allow a new requisition`);
    }

    const requisitionNo = await nextChefRequisitionNumber(tx);

    // Snapshot avg cost per ingredient at time of submit/create
    const ingredientIds = (input.lines ?? []).map((l) => l.ingredientId);
    const ingredients = ingredientIds.length
      ? await tx.ingredient.findMany({
          where: { id: { in: ingredientIds } },
          select: { id: true, avgUnitCost: true, unit: true },
        })
      : [];
    const costMap = new Map(ingredients.map((i) => [i.id, i.avgUnitCost.toString()]));
    const unitMap = new Map(ingredients.map((i) => [i.id, i.unit]));

    const created = await tx.chefRequisition.create({
      data: {
        requisitionNo,
        orderId: input.orderId,
        status: ChefRequisitionStatus.DRAFT,
        notes: input.notes ?? null,
        createdById: session.user.id,
        lines: input.lines
          ? {
              create: input.lines.map((l) => ({
                ingredientId: l.ingredientId,
                orderItemId: l.orderItemId ?? null,
                requestedQty: l.requestedQty,
                unit: l.unit ?? unitMap.get(l.ingredientId) ?? "",
                unitCostSnapshot: costMap.get(l.ingredientId) ?? "0",
                notes: l.notes ?? null,
              })),
            }
          : undefined,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_CREATED",
        entity: "ChefRequisition",
        entityId: created.id,
        payloadHash: sha256Json({ orderId: input.orderId, lines: input.lines?.length ?? 0 }),
      },
    });
    return created;
  });

  revalidatePath("/requisitions");
  revalidatePath(`/orders/${input.orderId}`);
  return { id: result.id, requisitionNo: result.requisitionNo };
}

export async function addChefRequisitionLine(requisitionId: string, raw: unknown) {
  const session = await requireRole(REQUISITION_CREATE_ROLES);
  const input = ChefRequisitionLineInput.parse(raw);

  await db.$transaction(async (tx) => {
    const req = await tx.chefRequisition.findUnique({ where: { id: requisitionId }, select: { status: true } });
    if (!req) throw new Error("Requisition not found");
    if (req.status !== ChefRequisitionStatus.DRAFT) {
      throw new AuthorizationError("Lines can only be edited on DRAFT requisitions");
    }
    const ingredient = await tx.ingredient.findUnique({
      where: { id: input.ingredientId },
      select: { unit: true, avgUnitCost: true },
    });
    if (!ingredient) throw new Error("Ingredient not found");

    await tx.chefRequisitionLine.create({
      data: {
        requisitionId,
        ingredientId: input.ingredientId,
        orderItemId: input.orderItemId ?? null,
        requestedQty: input.requestedQty,
        unit: input.unit ?? ingredient.unit,
        unitCostSnapshot: ingredient.avgUnitCost.toString(),
        notes: input.notes ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_LINE_ADDED",
        entity: "ChefRequisition",
        entityId: requisitionId,
        payloadHash: sha256Json({ ingredientId: input.ingredientId, qty: input.requestedQty }),
      },
    });
  });

  revalidatePath(`/requisitions/${requisitionId}`);
}

export async function removeChefRequisitionLine(lineId: string) {
  const session = await requireRole(REQUISITION_CREATE_ROLES);
  await db.$transaction(async (tx) => {
    const line = await tx.chefRequisitionLine.findUnique({
      where: { id: lineId },
      include: { requisition: { select: { id: true, status: true } } },
    });
    if (!line) throw new Error("Line not found");
    if (line.requisition.status !== ChefRequisitionStatus.DRAFT) {
      throw new AuthorizationError("Lines can only be removed on DRAFT requisitions");
    }
    await tx.chefRequisitionLine.delete({ where: { id: lineId } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_LINE_REMOVED",
        entity: "ChefRequisition",
        entityId: line.requisition.id,
      },
    });
  });
}

// =====================================================================
// SUBMIT / FULFIL
// =====================================================================

export async function submitChefRequisition(id: string) {
  const session = await requireRole(REQUISITION_CREATE_ROLES);

  await db.$transaction(async (tx) => {
    const req = await tx.chefRequisition.findUnique({
      where: { id },
      include: { lines: true, order: { select: { id: true, status: true } } },
    });
    if (!req) throw new Error("Requisition not found");
    if (req.status !== ChefRequisitionStatus.DRAFT) {
      throw new AuthorizationError("Only DRAFT requisitions can be submitted");
    }
    if (req.lines.length === 0) throw new Error("Add at least one line before submitting");

    await tx.chefRequisition.update({
      where: { id },
      data: { status: ChefRequisitionStatus.SUBMITTED, submittedAt: new Date() },
    });

    // First requisition for the order? Transition order to ISSUING.
    if (req.order.status === OrderStatus.CHEF_REQUISITION_PENDING) {
      await tx.order.update({ where: { id: req.order.id }, data: { status: OrderStatus.ISSUING } });
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_SUBMITTED",
        entity: "ChefRequisition",
        entityId: id,
      },
    });
  });

  revalidatePath(`/requisitions/${id}`);
  revalidatePath("/requisitions");
  revalidatePath("/queue/issuing");
}

/**
 * Issue stock for one line. Decrements ingredient.onHandQty, creates an
 * IngredientIssue, updates line.issuedQty + status, may flip the parent
 * requisition to PARTIALLY_ISSUED / FULLY_ISSUED, and (if every requisition
 * for the order is FULLY_ISSUED) auto-advances the order to
 * READY_FOR_PRODUCTION.
 */
export async function issueChefRequisitionLine(raw: unknown) {
  const session = await requireRole(REQUISITION_FULFIL_ROLES);
  const input = ChefRequisitionIssueInput.parse(raw);

  await db.$transaction(async (tx) => {
    const line = await tx.chefRequisitionLine.findUnique({
      where: { id: input.lineId },
      include: {
        ingredient: { select: { onHandQty: true, avgUnitCost: true, unit: true } },
        requisition: { select: { id: true, status: true, orderId: true } },
      },
    });
    if (!line) throw new Error("Requisition line not found");
    if (line.status === ChefRequisitionLineStatus.CANCELLED) {
      throw new Error("Line is cancelled");
    }
    if (line.requisition.status !== ChefRequisitionStatus.SUBMITTED &&
        line.requisition.status !== ChefRequisitionStatus.PARTIALLY_ISSUED) {
      throw new AuthorizationError(`Cannot issue against requisition with status ${line.requisition.status}`);
    }

    const onHand = toDecimal(line.ingredient.onHandQty);
    const toIssue = toDecimal(input.qtyToIssue);
    if (toIssue.lte(0)) throw new Error("Issue quantity must be positive");
    if (toIssue.gt(onHand)) {
      throw new Error(`Insufficient stock. On hand ${onHand.toString()}, requested ${toIssue.toString()}`);
    }
    const remaining = toDecimal(line.requestedQty).minus(toDecimal(line.issuedQty));
    if (toIssue.gt(remaining)) {
      throw new Error(`Cannot issue more than remaining requested qty (${remaining.toString()})`);
    }

    // 1. Create issue row
    await tx.ingredientIssue.create({
      data: {
        ingredientId: line.ingredientId,
        orderId: line.requisition.orderId,
        qty: input.qtyToIssue,
        unitCostAtIssue: line.ingredient.avgUnitCost.toString(),
        issuedById: session.user.id,
        issuedAt: new Date(),
        chefRequisitionLineId: line.id,
      },
    });

    // 2. Decrement on-hand
    await tx.ingredient.update({
      where: { id: line.ingredientId },
      data: { onHandQty: onHand.minus(toIssue).toDecimalPlaces(3).toString() },
    });

    // 3. Update line
    const newIssued = toDecimal(line.issuedQty).plus(toIssue);
    const fullyIssued = newIssued.gte(toDecimal(line.requestedQty));
    await tx.chefRequisitionLine.update({
      where: { id: line.id },
      data: {
        issuedQty: newIssued.toDecimalPlaces(3).toString(),
        status: fullyIssued ? ChefRequisitionLineStatus.ISSUED : ChefRequisitionLineStatus.PARTIALLY_ISSUED,
      },
    });

    // 4. Recompute requisition status from sibling lines
    const siblings = await tx.chefRequisitionLine.findMany({
      where: { requisitionId: line.requisition.id },
      select: { id: true, status: true, requestedQty: true, issuedQty: true },
    });
    const allDone = siblings.every((s) =>
      s.id === line.id
        ? fullyIssued
        : s.status === ChefRequisitionLineStatus.ISSUED || s.status === ChefRequisitionLineStatus.CANCELLED,
    );
    const reqStatus = allDone ? ChefRequisitionStatus.FULLY_ISSUED : ChefRequisitionStatus.PARTIALLY_ISSUED;
    await tx.chefRequisition.update({
      where: { id: line.requisition.id },
      data: {
        status: reqStatus,
        lastFulfilledById: session.user.id,
        closedAt: allDone ? new Date() : null,
      },
    });

    // 5. If every requisition for the order is fully issued, advance the order
    if (allDone) {
      const allReqs = await tx.chefRequisition.findMany({
        where: { orderId: line.requisition.orderId },
        select: { id: true, status: true },
      });
      const everyReqDone = allReqs.every((r) =>
        r.id === line.requisition.id
          ? true
          : r.status === ChefRequisitionStatus.FULLY_ISSUED || r.status === ChefRequisitionStatus.CANCELLED,
      );
      if (everyReqDone) {
        await tx.order.update({
          where: { id: line.requisition.orderId },
          data: { status: OrderStatus.READY_FOR_PRODUCTION },
        });
        // Auto-create the production job. Idempotent on order.
        await createProductionJobForOrder(tx, line.requisition.orderId);
      }
    }

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_LINE_ISSUED",
        entity: "ChefRequisitionLine",
        entityId: line.id,
        payloadHash: sha256Json({ qty: input.qtyToIssue }),
      },
    });
  });

  revalidatePath("/requisitions");
  revalidatePath("/queue/issuing");
  revalidatePath("/inventory/ingredients");
  revalidatePath("/inventory/issues");
}

/**
 * Mark a line as awaiting procurement. Phase 1 just flags the line — Phase 2
 * will auto-spawn a PR. AuditLog records the reason.
 */
export async function sendChefRequisitionLineToProcurement(raw: unknown) {
  const session = await requireRole(REQUISITION_FULFIL_ROLES);
  const input = ChefRequisitionSendToProcurementInput.parse(raw);

  await db.$transaction(async (tx) => {
    const line = await tx.chefRequisitionLine.findUnique({
      where: { id: input.lineId },
      select: { id: true, status: true, requisitionId: true },
    });
    if (!line) throw new Error("Line not found");
    if (line.status === ChefRequisitionLineStatus.ISSUED) {
      throw new Error("Line is already fully issued");
    }
    await tx.chefRequisitionLine.update({
      where: { id: line.id },
      data: { status: ChefRequisitionLineStatus.AWAITING_PROCUREMENT, notes: input.reason },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_LINE_SENT_TO_PROCUREMENT",
        entity: "ChefRequisitionLine",
        entityId: line.id,
        payloadHash: sha256Json({ reason: input.reason }),
      },
    });
  });

  revalidatePath("/requisitions");
  revalidatePath("/queue/issuing");
}

// =====================================================================
// QUERIES
// =====================================================================

const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD, Role.STORE_KEEPER, Role.SALES, Role.ACCOUNTS,
];

export async function listChefRequisitions(opts: { status?: ChefRequisitionStatus[]; orderId?: string } = {}) {
  await requireRole(READ_ROLES);
  return db.chefRequisition.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.orderId ? { orderId: opts.orderId } : {}),
    },
    include: {
      order: { select: { code: true, customer: { select: { name: true } }, eventDate: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getChefRequisition(id: string) {
  await requireRole(READ_ROLES);
  return db.chefRequisition.findUnique({
    where: { id },
    include: {
      order: {
        select: {
          id: true, code: true, status: true, eventDate: true,
          customer: { select: { id: true, name: true } },
        },
      },
      createdBy: { select: { name: true } },
      lastFulfilledBy: { select: { name: true } },
      lines: {
        include: {
          ingredient: { select: { name: true, sku: true, unit: true, onHandQty: true, avgUnitCost: true } },
        },
        orderBy: { ingredient: { name: "asc" } },
      },
    },
  });
}
