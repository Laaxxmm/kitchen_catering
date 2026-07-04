"use server";

import { revalidatePath } from "next/cache";
import {
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  OrderStatus,
  Role,
} from "@prisma/client";
import { db } from "@/server/db";
import { INACTIVE_ORDER_STATUSES } from "@/lib/order-status";
import {
  requireRole,
  REQUISITION_CREATE_ROLES,
  REQUISITION_FULFIL_ROLES,
} from "@/server/rbac";
import {
  ChefRequisitionCreateInput,
  ChefRequisitionIssueInput,
  ChefRequisitionLineInput,
  ChefRequisitionSendToProcurementInput,
  ChefRequisitionStandaloneInput,
} from "@/lib/validators";
import {
  ActionError,
  actionFailure,
  type ActionResult,
  type ActionResultWith,
} from "@/server/action-result";
import { nextChefRequisitionNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";
import { notifyRoles } from "@/server/actions/notifications";
import { createProductionJobForOrder } from "./production-jobs";


// =====================================================================
// CREATE / EDIT
// =====================================================================

/**
 * Create a DRAFT chef requisition for an APPROVED-onwards order. Snapshots
 * each line's ingredient avg cost so the planned-cost baseline survives
 * later cost moves.
 */
export async function createChefRequisition(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; requisitionNo: string }>> {
  try {
    return await createChefRequisitionInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createChefRequisitionInner(
  raw: unknown,
): Promise<{ ok: true; id: string; requisitionNo: string }> {
  const session = await requireRole(REQUISITION_CREATE_ROLES);
  const input = ChefRequisitionCreateInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { status: true },
    });
    if (!order) throw new ActionError("Order not found");
    const ok = order.status === OrderStatus.CHEF_REQUISITION_PENDING
      || order.status === OrderStatus.IN_PREP
      || order.status === OrderStatus.READY_FOR_PRODUCTION
      || order.status === OrderStatus.ISSUING;
    if (!ok) {
      throw new ActionError(`Order status ${order.status} doesn't allow a new requisition`);
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
  return { ok: true, id: result.id, requisitionNo: result.requisitionNo };
}

/**
 * Standalone (order-less) stock request. The chef needs ingredients for the
 * kitchen that aren't tied to any specific order — general prep, low kitchen
 * stock, spoilage replacement. Goes straight to the store (SUBMITTED) so they
 * can issue it, exactly like an order requisition, but with no order link.
 */
export async function createStandaloneChefRequisition(
  raw: unknown,
): Promise<ActionResultWith<{ id: string; requisitionNo: string }>> {
  try {
    return await createStandaloneChefRequisitionInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function createStandaloneChefRequisitionInner(
  raw: unknown,
): Promise<{ ok: true; id: string; requisitionNo: string }> {
  const session = await requireRole(REQUISITION_CREATE_ROLES);
  const input = ChefRequisitionStandaloneInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const requisitionNo = await nextChefRequisitionNumber(tx);

    const ingredientIds = input.lines.map((l) => l.ingredientId);
    const ingredients = await tx.ingredient.findMany({
      where: { id: { in: ingredientIds } },
      select: { id: true, avgUnitCost: true, unit: true },
    });
    const costMap = new Map(ingredients.map((i) => [i.id, i.avgUnitCost.toString()]));
    const unitMap = new Map(ingredients.map((i) => [i.id, i.unit]));

    const created = await tx.chefRequisition.create({
      data: {
        requisitionNo,
        orderId: null,
        // Straight to the store to fulfil — a standalone request is meant to
        // be issued, not parked as a draft.
        status: ChefRequisitionStatus.SUBMITTED,
        submittedAt: new Date(),
        notes: input.notes ?? null,
        createdById: session.user.id,
        lines: {
          create: input.lines.map((l) => ({
            ingredientId: l.ingredientId,
            requestedQty: l.requestedQty,
            unit: l.unit ?? unitMap.get(l.ingredientId) ?? "",
            unitCostSnapshot: costMap.get(l.ingredientId) ?? "0",
            notes: l.notes ?? null,
          })),
        },
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_CREATED",
        entity: "ChefRequisition",
        entityId: created.id,
        payloadHash: sha256Json({ orderId: null, standalone: true, lines: input.lines.length }),
      },
    });
    return created;
  });

  await notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
    kind: "GENERIC",
    title: `Kitchen stock request ${result.requisitionNo}`,
    body: `The chef raised a general stock request (no order). Open to issue line by line.`,
    link: `/requisitions/${result.id}`,
    dedupeKey: `chef-standalone-req:${result.id}`,
  });

  revalidatePath("/requisitions");
  return { ok: true, id: result.id, requisitionNo: result.requisitionNo };
}

/**
 * "Ingredients already available" — chef confirms the kitchen already
 * holds everything this order needs, so NO requisition / store-issue is
 * required. Advances the order straight from CHEF_REQUISITION_PENDING to
 * READY_FOR_PRODUCTION (skipping ISSUING).
 *
 * Note: because no IngredientIssue rows are created, this order's P&L
 * won't show ingredient cost. That's correct — the stock was already on
 * hand from a prior receipt; double-counting it here would understate
 * margin on whichever order it WAS issued against. The chef can still
 * raise a partial requisition later if they realise something's short.
 */
export async function markIngredientsAvailable(orderId: string, note?: string): Promise<ActionResult> {
  try {
    const session = await requireRole(REQUISITION_CREATE_ROLES);

    await db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (!order) throw new ActionError("Order not found");
      if (order.status !== OrderStatus.CHEF_REQUISITION_PENDING) {
        throw new ActionError(
          `Order status ${order.status} doesn't allow skipping the requisition`,
        );
      }
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.READY_FOR_PRODUCTION },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "ORDER_INGREDIENTS_ALREADY_AVAILABLE",
          entity: "Order",
          entityId: orderId,
          payloadHash: sha256Json({ note: note ?? null }),
        },
      });
    });

    revalidatePath(`/orders/${orderId}`);
    revalidatePath("/orders");
    revalidatePath("/kitchen");
    revalidatePath("/queue/issuing");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function addChefRequisitionLine(requisitionId: string, raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(REQUISITION_CREATE_ROLES);
    const input = ChefRequisitionLineInput.parse(raw);

    await db.$transaction(async (tx) => {
      const req = await tx.chefRequisition.findUnique({ where: { id: requisitionId }, select: { status: true } });
      if (!req) throw new ActionError("Requisition not found");
      if (req.status !== ChefRequisitionStatus.DRAFT) {
        throw new ActionError("Lines can only be edited on DRAFT requisitions");
      }
      const ingredient = await tx.ingredient.findUnique({
        where: { id: input.ingredientId },
        select: { unit: true, avgUnitCost: true },
      });
      if (!ingredient) throw new ActionError("Ingredient not found");

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
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

export async function removeChefRequisitionLine(lineId: string): Promise<ActionResult> {
  try {
    const session = await requireRole(REQUISITION_CREATE_ROLES);
    await db.$transaction(async (tx) => {
      const line = await tx.chefRequisitionLine.findUnique({
        where: { id: lineId },
        include: { requisition: { select: { id: true, status: true } } },
      });
      if (!line) throw new ActionError("Line not found");
      if (line.requisition.status !== ChefRequisitionStatus.DRAFT) {
        throw new ActionError("Lines can only be removed on DRAFT requisitions");
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
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// =====================================================================
// SUBMIT / FULFIL
// =====================================================================

export async function submitChefRequisition(id: string): Promise<ActionResult> {
  try {
    return await submitChefRequisitionInner(id);
  } catch (err) {
    return actionFailure(err);
  }
}

async function submitChefRequisitionInner(id: string): Promise<{ ok: true }> {
  const session = await requireRole(REQUISITION_CREATE_ROLES);

  await db.$transaction(async (tx) => {
    const req = await tx.chefRequisition.findUnique({
      where: { id },
      include: { lines: true, order: { select: { id: true, status: true } } },
    });
    if (!req) throw new ActionError("Requisition not found");
    if (req.status !== ChefRequisitionStatus.DRAFT) {
      throw new ActionError("Only DRAFT requisitions can be submitted");
    }
    if (req.lines.length === 0) throw new ActionError("Add at least one line before submitting");

    await tx.chefRequisition.update({
      where: { id },
      data: { status: ChefRequisitionStatus.SUBMITTED, submittedAt: new Date() },
    });

    // First requisition for the order? Transition order to ISSUING.
    // Standalone (order-less) requisitions have no order to advance.
    if (req.order && req.order.status === OrderStatus.CHEF_REQUISITION_PENDING) {
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
  return { ok: true };
}

/**
 * Issue stock for one line. Decrements ingredient.onHandQty, creates an
 * IngredientIssue, updates line.issuedQty + status, may flip the parent
 * requisition to PARTIALLY_ISSUED / FULLY_ISSUED, and (if every requisition
 * for the order is FULLY_ISSUED) auto-advances the order to
 * READY_FOR_PRODUCTION.
 */
export async function issueChefRequisitionLine(raw: unknown): Promise<ActionResult> {
  try {
    return await issueChefRequisitionLineInner(raw);
  } catch (err) {
    return actionFailure(err);
  }
}

async function issueChefRequisitionLineInner(raw: unknown): Promise<{ ok: true }> {
  const session = await requireRole(REQUISITION_FULFIL_ROLES);
  const input = ChefRequisitionIssueInput.parse(raw);

  await db.$transaction(async (tx) => {
    // Serialise concurrent issuers of the same line: lock the line row
    // BEFORE reading it, so the loser waits here and then sees the
    // winner's committed issuedQty/status instead of a stale snapshot.
    await tx.$executeRaw`SELECT 1 FROM "ChefRequisitionLine" WHERE "id" = ${input.lineId} FOR UPDATE`;
    const line = await tx.chefRequisitionLine.findUnique({
      where: { id: input.lineId },
      include: {
        requisition: { select: { id: true, status: true, orderId: true } },
      },
    });
    if (!line) throw new ActionError("Requisition line not found");
    if (line.status === ChefRequisitionLineStatus.CANCELLED) {
      throw new ActionError("Line is cancelled");
    }
    if (line.requisition.status !== ChefRequisitionStatus.SUBMITTED &&
        line.requisition.status !== ChefRequisitionStatus.PARTIALLY_ISSUED) {
      throw new ActionError(`Cannot issue against requisition with status ${line.requisition.status}`);
    }

    // Lock the parent requisition (status recompute below) and the
    // ingredient (stock decrement below) — always in this order so
    // concurrent issuers of sibling lines can't deadlock.
    await tx.$executeRaw`SELECT 1 FROM "ChefRequisition" WHERE "id" = ${line.requisition.id} FOR UPDATE`;
    await tx.$executeRaw`SELECT 1 FROM "Ingredient" WHERE "id" = ${line.ingredientId} FOR UPDATE`;
    // Re-read stock AFTER taking the lock — a value fetched before it can
    // be a stale snapshot from a concurrent receipt / issue / adjustment.
    const ingredient = await tx.ingredient.findUnique({
      where: { id: line.ingredientId },
      select: { onHandQty: true, avgUnitCost: true },
    });
    if (!ingredient) throw new ActionError("Ingredient not found");

    const onHand = toDecimal(ingredient.onHandQty);
    const toIssue = toDecimal(input.qtyToIssue);
    if (toIssue.lte(0)) throw new ActionError("Issue quantity must be positive");
    if (toIssue.gt(onHand)) {
      throw new ActionError(`Insufficient stock. On hand ${onHand.toString()}, requested ${toIssue.toString()}`);
    }
    const remaining = toDecimal(line.requestedQty).minus(toDecimal(line.issuedQty));
    if (toIssue.gt(remaining)) {
      throw new ActionError(`Cannot issue more than remaining requested qty (${remaining.toString()})`);
    }

    // 1. Create issue row
    await tx.ingredientIssue.create({
      data: {
        ingredientId: line.ingredientId,
        orderId: line.requisition.orderId,
        qty: input.qtyToIssue,
        unitCostAtIssue: ingredient.avgUnitCost.toString(),
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

    // 5. If every requisition for the order is fully issued, advance the
    //    order. Standalone (order-less) requisitions have nothing to advance —
    //    fulfilling them just decrements stock. Lock the order first and only
    //    then check sibling requisitions, so two issuers finishing different
    //    requisitions at once can't both read "everything done" and race the
    //    transition (the status guard on the update backstops that too).
    const reqOrderId = line.requisition.orderId;
    if (allDone && reqOrderId) {
      await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${reqOrderId} FOR UPDATE`;
      const allReqs = await tx.chefRequisition.findMany({
        where: { orderId: reqOrderId },
        select: { id: true, status: true },
      });
      const everyReqDone = allReqs.every((r) =>
        r.id === line.requisition.id
          ? true
          : r.status === ChefRequisitionStatus.FULLY_ISSUED || r.status === ChefRequisitionStatus.CANCELLED,
      );
      if (everyReqDone) {
        const advanced = await tx.order.updateMany({
          where: { id: reqOrderId, status: { not: OrderStatus.READY_FOR_PRODUCTION } },
          data: { status: OrderStatus.READY_FOR_PRODUCTION },
        });
        // Auto-create the production job. Idempotent on order; only the
        // caller that actually advanced the order attempts it.
        if (advanced.count > 0) {
          await createProductionJobForOrder(tx, reqOrderId);
        }
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
  return { ok: true };
}

/**
 * Flag a short chef-requisition line as awaiting a purchase. There's no
 * separate purchase-requisition document any more — the store raises a PO
 * for the shortfall directly (see /procurement/purchase-orders/new?reqId=).
 * Once the vendor delivers and the store records the GRN, stock comes back
 * in and the line becomes issuable again ("stock has arrived — issue now").
 */
export async function sendChefRequisitionLineToProcurement(raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(REQUISITION_FULFIL_ROLES);
    const input = ChefRequisitionSendToProcurementInput.parse(raw);

    await db.$transaction(async (tx) => {
      const line = await tx.chefRequisitionLine.findUnique({
        where: { id: input.lineId },
        select: { id: true, status: true, requestedQty: true, issuedQty: true },
      });
      if (!line) throw new ActionError("Line not found");
      if (line.status === ChefRequisitionLineStatus.ISSUED) {
        throw new ActionError("Line is already fully issued");
      }
      const shortfall = toDecimal(line.requestedQty).minus(toDecimal(line.issuedQty));
      if (shortfall.lte(0)) throw new ActionError("No shortfall to procure");

      await tx.chefRequisitionLine.update({
        where: { id: line.id },
        data: { status: ChefRequisitionLineStatus.AWAITING_PROCUREMENT, notes: input.reason },
      });

      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "CHEF_REQUISITION_LINE_AWAITING_PURCHASE",
          entity: "ChefRequisitionLine",
          entityId: line.id,
          payloadHash: sha256Json({ reason: input.reason, shortfall: shortfall.toString() }),
        },
      });
    });

    revalidatePath("/requisitions");
    revalidatePath("/queue/issuing");
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// =====================================================================
// QUERIES
// =====================================================================

const READ_ROLES = [
  Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD, Role.STORE_KEEPER, Role.SALES, Role.ACCOUNTS,
];

export async function listChefRequisitions(
  opts: { status?: ChefRequisitionStatus[]; orderId?: string; activeOrderOnly?: boolean } = {},
) {
  await requireRole(READ_ROLES);
  return db.chefRequisition.findMany({
    where: {
      ...(opts.status ? { status: { in: opts.status } } : {}),
      ...(opts.orderId ? { orderId: opts.orderId } : {}),
      // Hide requisitions whose order was cancelled / rejected / completed.
      // Standalone requisitions (no order) always pass — there's no order to
      // go inactive.
      ...(opts.activeOrderOnly
        ? { OR: [{ orderId: null }, { order: { status: { notIn: INACTIVE_ORDER_STATUSES } } }] }
        : {}),
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
