"use server";

import { revalidatePath } from "next/cache";
import {
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  OrderStatus,
  Prisma,
  Role,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  INACTIVE_ORDER_STATUSES,
  REQUISITION_ELIGIBLE_ORDER_STATUSES,
  STATUS_LABEL,
  humanizeStatus,
} from "@/lib/order-status";
import {
  requireRole,
  requireSession,
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
import { createNotification, notifyRoles } from "@/server/notification-core";
import { deferAfterResponse } from "@/server/defer";
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
    if (!REQUISITION_ELIGIBLE_ORDER_STATUSES.includes(order.status)) {
      throw new ActionError(`This order is ${STATUS_LABEL[order.status].toLowerCase()} — a new requisition can't be raised`);
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

  deferAfterResponse("chef-standalone-req:notify", () =>
    notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
      kind: "GENERIC",
      title: `Kitchen stock request ${result.requisitionNo}`,
      body: `The chef raised a general stock request (no order). Open to issue line by line.`,
      link: `/requisitions/${result.id}`,
      dedupeKey: `chef-standalone-req:${result.id}`,
    }),
  );

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
          `This order is ${STATUS_LABEL[order.status].toLowerCase()} — the requisition can't be skipped`,
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

/**
 * Change a line's requested quantity while the requisition is still DRAFT
 * (#17 — the chef fixes a typo before submitting). Add/remove cover the
 * rest of draft editing.
 */
export async function updateChefRequisitionLineQty(lineId: string, qty: string): Promise<ActionResult> {
  try {
    const session = await requireRole(REQUISITION_CREATE_ROLES);
    const newQty = toDecimal(qty);
    if (newQty.lte(0)) throw new ActionError("Quantity must be above 0");

    await db.$transaction(async (tx) => {
      const line = await tx.chefRequisitionLine.findUnique({
        where: { id: lineId },
        include: { requisition: { select: { id: true, status: true } } },
      });
      if (!line) throw new ActionError("Line not found");
      if (line.requisition.status !== ChefRequisitionStatus.DRAFT) {
        throw new ActionError("Lines can only be edited on DRAFT requisitions");
      }
      await tx.chefRequisitionLine.update({
        where: { id: lineId },
        data: { requestedQty: newQty.toDecimalPlaces(3).toString() },
      });
      await tx.auditLog.create({
        data: {
          userId: session.user.id,
          action: "CHEF_REQUISITION_LINE_QTY_CHANGED",
          entity: "ChefRequisition",
          entityId: line.requisition.id,
          payloadHash: sha256Json({ lineId, from: line.requestedQty.toString(), to: newQty.toString() }),
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
 * requisition to PARTIALLY_ISSUED / FULLY_ISSUED, and — once the store has
 * ACTED on every line of the order's open requisitions (see
 * recomputeReqAndAdvance) — auto-advances the order to READY_FOR_PRODUCTION.
 *
 * Deliberately does NOT gate on the order's status: a top-up issued against
 * an order already in the kitchen is legitimate (see the no-regress guard in
 * recomputeReqAndAdvance). The requisition's own status is the gate.
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

  const outcome = await db.$transaction(async (tx) => {
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
      throw new ActionError(`Cannot issue against a requisition that's ${humanizeStatus(line.requisition.status)}`);
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

    // 4–5. Recompute the requisition status from its sibling lines and, if
    //      the store has now acted on every line the order is waiting on,
    //      advance the order to the kitchen board. Shared with the line-cancel
    //      and send-to-procurement actions so no path can disagree on "acted".
    const advance = await recomputeReqAndAdvance(
      tx,
      line.requisition.id,
      line.requisition.orderId,
      session.user.id,
    );

    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_LINE_ISSUED",
        entity: "ChefRequisitionLine",
        entityId: line.id,
        payloadHash: sha256Json({ qty: input.qtyToIssue }),
      },
    });
    return advance;
  });

  if (outcome.shortfall) notifyShortfallAdvance(outcome.shortfall);

  revalidatePath("/requisitions");
  revalidatePath("/queue/issuing");
  revalidatePath("/inventory/ingredients");
  revalidatePath("/inventory/issues");
  // A partial issue can now be what moves the order to the kitchen board.
  revalidatePath("/kitchen");
  return { ok: true };
}

/** Who to tell when the order left the store with something still owed. */
type ShortfallAdvance = { reqId: string; requisitionNo: string; createdById: string };

/**
 * The order moved on to the kitchen while the store still owes stock — a
 * part-issued line, or one waiting on a purchase. The chef who raised the
 * requisition is the person who has to cook around that gap, so they hear
 * about it once, the moment it happens. Deduped per requisition: later
 * top-up activity on the same requisition doesn't re-notify.
 */
function notifyShortfallAdvance(s: ShortfallAdvance) {
  deferAfterResponse("chef-req-shortfall-advance:notify", () =>
    createNotification({
      userId: s.createdById,
      kind: "GENERIC",
      title: "Order proceeding — shortfall pending",
      body:
        `The store has acted on every item of ${s.requisitionNo}, so the order has moved ` +
        `to the kitchen — start with what was issued. The shortfall stays open on the ` +
        `requisition and can be topped up once stock arrives.`,
      link: `/requisitions/${s.reqId}`,
      dedupeKey: `chef-req-shortfall-advance:${s.reqId}`,
    }),
  );
}

/**
 * Recompute a requisition's status from its lines and, when the store has
 * ACTED on every line of every open requisition for the order, advance the
 * order to READY_FOR_PRODUCTION and create its production job.
 *
 * "Acted" means the line is no longer PENDING: ISSUED, PARTIALLY_ISSUED,
 * CANCELLED or AWAITING_PROCUREMENT. It used to mean ISSUED or CANCELLED
 * only, which froze the order at ISSUING for as long as the store could
 * only part-issue a line or had to raise a PO for the shortfall — the
 * kitchen sat idle waiting on stock that might be days away, with no route
 * forward short of a manual status override. The store's job is done once
 * it has responded to every line; the kitchen starts with what arrived and
 * the shortfall keeps its own life (the requisition stays PARTIALLY_ISSUED
 * and therefore stays on the store's issuing queue; a GRN flipping an
 * AWAITING_PROCUREMENT line back to PENDING makes it issuable again as a
 * top-up, which REQUISITION_ELIGIBLE_ORDER_STATUSES already allows past
 * ISSUING).
 *
 * The REQUISITION roll-up is deliberately unchanged: FULLY_ISSUED only when
 * every line is ISSUED or CANCELLED. A part-issued requisition is not
 * "closed" just because the order moved on — that's what keeps the shortfall
 * visible and toppable-up.
 *
 * Assumes the caller already updated the triggering line's status and holds
 * the requisition FOR UPDATE lock. Shared by the issue, line-cancel and
 * send-to-procurement paths so no two of them can disagree on "acted".
 *
 * Returns `shortfall` (non-null) only when this call actually advanced the
 * order AND something is still owed — the caller notifies the chef.
 */
async function recomputeReqAndAdvance(
  tx: Prisma.TransactionClient,
  requisitionId: string,
  orderId: string | null,
  userId: string,
): Promise<{ allDone: boolean; shortfall: ShortfallAdvance | null }> {
  const siblings = await tx.chefRequisitionLine.findMany({
    where: { requisitionId },
    select: { status: true },
  });
  const allDone = siblings.every(
    (s) =>
      s.status === ChefRequisitionLineStatus.ISSUED ||
      s.status === ChefRequisitionLineStatus.CANCELLED,
  );
  const req = await tx.chefRequisition.update({
    where: { id: requisitionId },
    data: {
      status: allDone ? ChefRequisitionStatus.FULLY_ISSUED : ChefRequisitionStatus.PARTIALLY_ISSUED,
      lastFulfilledById: userId,
      closedAt: allDone ? new Date() : null,
    },
    select: { requisitionNo: true, createdById: true },
  });

  // Cheap pre-check on the lines already in hand: if THIS requisition still
  // has an untouched line the order can't be ready, so skip the order lock
  // entirely on the common mid-issue call. (allDone implies this holds.)
  const actedHere = siblings.every((s) => s.status !== ChefRequisitionLineStatus.PENDING);
  if (!actedHere || !orderId) return { allDone, shortfall: null };

  await tx.$executeRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
  // Every line the store still owes on, across the order's live requisitions.
  // A CANCELLED requisition is off the books; a DRAFT top-up the chef hasn't
  // submitted yet still counts as outstanding, exactly as before.
  const orderLines = await tx.chefRequisitionLine.findMany({
    where: { requisition: { orderId, status: { not: ChefRequisitionStatus.CANCELLED } } },
    select: { status: true },
  });
  const everyLineActed = orderLines.every((l) => l.status !== ChefRequisitionLineStatus.PENDING);
  if (!everyLineActed) return { allDone, shortfall: null };

  // No-regress: only advance an order still in the pre-cook issuing phase.
  // A top-up requisition acted on while the order is already
  // READY_FOR_PRODUCTION / IN_PREP (or beyond) must NOT knock it back to
  // READY_FOR_PRODUCTION — that would re-create a production job. The extra
  // stock is simply issued; the order's status is left untouched.
  const advanced = await tx.order.updateMany({
    where: {
      id: orderId,
      status: { in: [OrderStatus.CHEF_REQUISITION_PENDING, OrderStatus.ISSUING] },
    },
    data: { status: OrderStatus.READY_FOR_PRODUCTION },
  });
  if (advanced.count === 0) return { allDone, shortfall: null };

  await createProductionJobForOrder(tx, orderId);

  const stillOwed = orderLines.some(
    (l) =>
      l.status === ChefRequisitionLineStatus.PARTIALLY_ISSUED ||
      l.status === ChefRequisitionLineStatus.AWAITING_PROCUREMENT,
  );
  return {
    allDone,
    shortfall: stillOwed
      ? { reqId: requisitionId, requisitionNo: req.requisitionNo, createdById: req.createdById }
      : null,
  };
}

/**
 * Store keeper cancels a single requisition line it can't provide (item
 * discontinued, client dropped the dish, spoiled, etc.) with a mandatory
 * reason. The line becomes CANCELLED — which counts as the store having ACTED
 * on it — so the rest of the requisition still issues and the order proceeds
 * to the kitchen instead of freezing at the issuance stage. The chef who
 * raised it is told so they can adjust the dish. Already-issued qty on a
 * part-issued line stays issued; the cancel just stops any remainder.
 */
export async function cancelChefRequisitionLine(
  lineId: string,
  reason: string,
): Promise<ActionResult> {
  try {
    return await cancelChefRequisitionLineInner(lineId, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function cancelChefRequisitionLineInner(
  lineId: string,
  reason: string,
): Promise<{ ok: true }> {
  const session = await requireRole(REQUISITION_FULFIL_ROLES);
  if (!reason?.trim()) throw new ActionError("A reason is required to cancel an item.");

  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "ChefRequisitionLine" WHERE "id" = ${lineId} FOR UPDATE`;
    const line = await tx.chefRequisitionLine.findUnique({
      where: { id: lineId },
      include: {
        ingredient: { select: { name: true } },
        requisition: {
          select: { id: true, status: true, orderId: true, requisitionNo: true, createdById: true },
        },
      },
    });
    if (!line) throw new ActionError("Requisition line not found");
    if (line.status === ChefRequisitionLineStatus.ISSUED) {
      throw new ActionError("This item is already fully issued — nothing to cancel.");
    }
    if (line.status === ChefRequisitionLineStatus.CANCELLED) {
      throw new ActionError("This item is already cancelled.");
    }
    if (
      line.requisition.status !== ChefRequisitionStatus.SUBMITTED &&
      line.requisition.status !== ChefRequisitionStatus.PARTIALLY_ISSUED
    ) {
      throw new ActionError(
        `Can't change a requisition that's ${humanizeStatus(line.requisition.status)}.`,
      );
    }

    await tx.$executeRaw`SELECT 1 FROM "ChefRequisition" WHERE "id" = ${line.requisition.id} FOR UPDATE`;
    await tx.chefRequisitionLine.update({
      where: { id: lineId },
      data: {
        status: ChefRequisitionLineStatus.CANCELLED,
        notes: `Cancelled by store: ${reason.trim()}`,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_LINE_CANCELLED",
        entity: "ChefRequisitionLine",
        entityId: lineId,
        payloadHash: sha256Json({ reason: reason.trim(), ingredient: line.ingredient.name }),
      },
    });

    const { allDone, shortfall } = await recomputeReqAndAdvance(
      tx,
      line.requisition.id,
      line.requisition.orderId,
      session.user.id,
    );

    return {
      reqId: line.requisition.id,
      requisitionNo: line.requisition.requisitionNo,
      ingredientName: line.ingredient.name,
      orderId: line.requisition.orderId,
      createdById: line.requisition.createdById,
      reqClosed: allDone,
      shortfall,
    };
  });

  // Tell the chef an item won't come so they can adjust the dish, and note
  // when this un-blocked the order to the kitchen.
  deferAfterResponse("chef-line-cancel:notify", () =>
    createNotification({
      userId: result.createdById,
      kind: "GENERIC",
      title: `${result.ingredientName} cancelled on ${result.requisitionNo}`,
      body:
        `The store couldn't provide it — reason: ${reason.trim()}.` +
        (result.reqClosed ? " The rest is issued and the order has moved to the kitchen." : ""),
      link: `/requisitions/${result.reqId}`,
      dedupeKey: `chef-line-cancel:${lineId}`,
    }),
  );
  if (result.shortfall) notifyShortfallAdvance(result.shortfall);

  revalidatePath("/requisitions");
  revalidatePath(`/requisitions/${result.reqId}`);
  revalidatePath("/queue/issuing");
  revalidatePath("/dashboard");
  // A cancel can now move the order on even when the requisition itself stays
  // open (siblings part-issued / awaiting a purchase), so refresh the
  // order-facing pages whenever there was an order at all.
  if (result.orderId) {
    revalidatePath("/kitchen");
    revalidatePath(`/orders/${result.orderId}`);
  }
  return { ok: true };
}

/**
 * Flag a short chef-requisition line as awaiting a purchase. There's no
 * separate purchase-requisition document any more — the store raises a PO
 * for the shortfall directly (see /procurement/purchase-orders/new?reqId=).
 * Once the vendor delivers and the store records the GRN, stock comes back
 * in and the line becomes issuable again ("stock has arrived — issue now").
 *
 * Raising the purchase IS the store acting on the line, so this runs the same
 * recompute as issue / cancel: if it was the last line the order was waiting
 * on, the order moves to the kitchen with whatever was issued rather than
 * sitting at ISSUING until the vendor turns up days later.
 */
export async function sendChefRequisitionLineToProcurement(raw: unknown): Promise<ActionResult> {
  try {
    const session = await requireRole(REQUISITION_FULFIL_ROLES);
    const input = ChefRequisitionSendToProcurementInput.parse(raw);

    const outcome = await db.$transaction(async (tx) => {
      // Same lock order as the issue / cancel paths: line, then requisition,
      // then (inside the recompute) the order.
      await tx.$executeRaw`SELECT 1 FROM "ChefRequisitionLine" WHERE "id" = ${input.lineId} FOR UPDATE`;
      const line = await tx.chefRequisitionLine.findUnique({
        where: { id: input.lineId },
        select: {
          id: true,
          status: true,
          requestedQty: true,
          issuedQty: true,
          requisitionId: true,
          requisition: { select: { orderId: true } },
        },
      });
      if (!line) throw new ActionError("Line not found");
      if (line.status === ChefRequisitionLineStatus.ISSUED) {
        throw new ActionError("Line is already fully issued");
      }
      // A cancelled line has no shortfall to buy — and resurrecting it into
      // AWAITING_PROCUREMENT would re-open an already-closed requisition
      // through the recompute below.
      if (line.status === ChefRequisitionLineStatus.CANCELLED) {
        throw new ActionError("Line is cancelled");
      }
      const shortfall = toDecimal(line.requestedQty).minus(toDecimal(line.issuedQty));
      if (shortfall.lte(0)) throw new ActionError("No shortfall to procure");

      await tx.$executeRaw`SELECT 1 FROM "ChefRequisition" WHERE "id" = ${line.requisitionId} FOR UPDATE`;
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

      const advance = await recomputeReqAndAdvance(
        tx,
        line.requisitionId,
        line.requisition.orderId,
        session.user.id,
      );
      return { ...advance, orderId: line.requisition.orderId };
    });

    if (outcome.shortfall) notifyShortfallAdvance(outcome.shortfall);

    revalidatePath("/requisitions");
    revalidatePath("/queue/issuing");
    if (outcome.orderId) {
      revalidatePath("/kitchen");
      revalidatePath(`/orders/${outcome.orderId}`);
    }
    return { ok: true };
  } catch (err) {
    return actionFailure(err);
  }
}

// =====================================================================
// CANCEL
// =====================================================================

/**
 * The chef who raised a requisition can withdraw their own mistake before
 * the store acts on it. Creator-only (not a role gate — another chef's
 * requisition is not yours to kill), and only while nothing irreversible
 * has happened: no stock issued, no purchase running.
 */
export async function cancelChefRequisition(id: string, reason?: string): Promise<ActionResult> {
  try {
    return await cancelChefRequisitionInner(id, reason);
  } catch (err) {
    return actionFailure(err);
  }
}

async function cancelChefRequisitionInner(id: string, reason?: string): Promise<{ ok: true }> {
  const session = await requireSession();

  const result = await db.$transaction(async (tx) => {
    const req = await tx.chefRequisition.findUnique({
      where: { id },
      select: {
        status: true,
        createdById: true,
        requisitionNo: true,
        lines: { select: { issuedQty: true, status: true } },
      },
    });
    if (!req) throw new ActionError("Requisition not found");
    // Two closers: the CHEF who raised it (cancel a mistake, reason optional),
    // or the STORE / admin / manager declining a request it can't fulfil
    // (reason required — the chef is then told). The store path skips the
    // "ask the store to reconcile" refusals below since the store IS the one
    // acting, and may close a partially-issued request (keeping issued lines).
    const isCreator = req.createdById === session.user.id;
    const isStoreClose =
      !isCreator &&
      (session.user.role === Role.STORE_KEEPER ||
        session.user.role === Role.ADMIN ||
        session.user.role === Role.MANAGER);
    if (!isCreator && !isStoreClose) {
      throw new ActionError("Only the chef who raised this, or the store, can close it.");
    }
    if (isStoreClose && !reason?.trim()) {
      throw new ActionError("A reason is required to close another team's request.");
    }
    const closableStatuses: ChefRequisitionStatus[] = isStoreClose
      ? [ChefRequisitionStatus.DRAFT, ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED]
      : [ChefRequisitionStatus.DRAFT, ChefRequisitionStatus.SUBMITTED];
    if (!closableStatuses.includes(req.status)) {
      throw new ActionError(
        `This requisition is ${humanizeStatus(req.status)} and can no longer be closed.`,
      );
    }
    if (isCreator && req.lines.some((l) => toDecimal(l.issuedQty).gt(0))) {
      throw new ActionError(
        "Stock has already been issued against this — ask the store to reconcile instead.",
      );
    }
    if (isCreator && req.lines.some((l) => l.status === ChefRequisitionLineStatus.AWAITING_PROCUREMENT)) {
      throw new ActionError("A purchase is already running for a line — ask the store.");
    }

    // Status guard: a store keeper issuing (or the chef double-clicking)
    // while this cancel is in flight loses the race with a clear message.
    const updated = await tx.chefRequisition.updateMany({
      where: {
        id,
        status: { in: closableStatuses },
      },
      data: { status: ChefRequisitionStatus.CANCELLED, closedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ActionError("This requisition just changed — refresh the page.");
    }
    await tx.chefRequisitionLine.updateMany({
      where: {
        requisitionId: id,
        status: {
          notIn: [ChefRequisitionLineStatus.ISSUED, ChefRequisitionLineStatus.CANCELLED],
        },
      },
      data: { status: ChefRequisitionLineStatus.CANCELLED },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "CHEF_REQUISITION_CANCELLED",
        entity: "ChefRequisition",
        entityId: id,
        payloadHash: sha256Json({ reason: reason?.trim() || null }),
      },
    });
    return { requisitionNo: req.requisitionNo, createdById: req.createdById, isStoreClose };
  });

  const closedBy = session.user.name ?? "someone";
  if (result.isStoreClose) {
    // The store declined it — tell the chef who raised it (not the store).
    deferAfterResponse("chef-req-store-close:notify", () =>
      createNotification({
        userId: result.createdById,
        kind: "GENERIC",
        title: `${result.requisitionNo} closed by the store`,
        body: `${reason?.trim() || "No reason given"} — raise a fresh requisition if still needed.`,
        link: `/requisitions/${id}`,
        dedupeKey: `chef-req-store-close:${id}`,
      }),
    );
  } else {
    // The chef cancelled — tell the store so nobody is mid-pick.
    deferAfterResponse("chef-req-cancel:notify", () =>
      notifyRoles([Role.STORE_KEEPER, Role.ADMIN, Role.MANAGER], {
        kind: "GENERIC",
        title: `${result.requisitionNo} cancelled by ${closedBy}`,
        body: `${reason?.trim() || "No reason given"} — disregard this request; nothing needs issuing.`,
        link: `/requisitions/${id}`,
        dedupeKey: `chef-req-cancel:${id}`,
      }),
    );
  }

  revalidatePath("/requisitions");
  revalidatePath(`/requisitions/${id}`);
  revalidatePath("/queue/issuing");
  revalidatePath("/dashboard");
  return { ok: true };
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
      order: { select: { code: true, customer: { select: { name: true } }, eventDate: true, deliveryWindowStart: true, deliveryWindowEnd: true } },
      _count: { select: { lines: true } },
      // Line statuses ride along so boards can tell an issuable request from
      // one that's entirely waiting on a purchase (nothing to issue yet).
      lines: { select: { status: true } },
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
          headcount: true, mealType: true,
          customer: { select: { id: true, name: true } },
          // The menu being cooked — shown above the lines so the chef edits
          // the draft against the actual dishes (same panel as the raise page).
          items: {
            select: { id: true, portions: true, dish: { select: { name: true } } },
            orderBy: { sortOrder: "asc" },
          },
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
