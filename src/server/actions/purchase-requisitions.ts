"use server";

import { revalidatePath } from "next/cache";
import { Decimal } from "decimal.js";
import { PurchaseRequisitionStatus, Role } from "@prisma/client";
import { db } from "@/server/db";
import { AuthorizationError, requireRole } from "@/server/rbac";
import { PRLineInput, PurchaseRequisitionInput } from "@/lib/validators";
import { nextPRNumber } from "@/lib/sequences";
import { sha256Json } from "@/lib/audit";
import { toDecimal } from "@/lib/money";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];
const APPROVE_ROLES = [Role.ADMIN, Role.MANAGER];
const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS];

const OVER_BUDGET_THRESHOLD = new Decimal(100000); // ₹1 lakh — needs approval

export async function createPurchaseRequisition(raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = PurchaseRequisitionInput.parse(raw);

  const result = await db.$transaction(async (tx) => {
    const prNo = await nextPRNumber(tx);
    // Snapshot ingredient avg cost per line
    const ingredientIds = (input.lines ?? []).map((l) => l.ingredientId);
    const ingredients = ingredientIds.length
      ? await tx.ingredient.findMany({
          where: { id: { in: ingredientIds } },
          select: { id: true, avgUnitCost: true },
        })
      : [];
    const costMap = new Map(ingredients.map((i) => [i.id, i.avgUnitCost.toString()]));

    const pr = await tx.purchaseRequisition.create({
      data: {
        prNo,
        orderId: input.orderId ?? null,
        chefRequisitionId: input.chefRequisitionId ?? null,
        requestedById: session.user.id,
        status: PurchaseRequisitionStatus.DRAFT,
        notes: input.notes ?? null,
        lines: input.lines
          ? {
              create: input.lines.map((l) => ({
                ingredientId: l.ingredientId,
                requestedQty: l.requestedQty,
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
        action: "PR_CREATED",
        entity: "PurchaseRequisition",
        entityId: pr.id,
        payloadHash: sha256Json({ prNo, orderId: input.orderId ?? null }),
      },
    });
    return pr;
  });

  revalidatePath("/procurement/purchase-requisitions");
  return { id: result.id, prNo: result.prNo };
}

export async function addPRLine(prId: string, raw: unknown) {
  const session = await requireRole(WRITE_ROLES);
  const input = PRLineInput.parse(raw);
  await db.$transaction(async (tx) => {
    const pr = await tx.purchaseRequisition.findUnique({ where: { id: prId }, select: { status: true } });
    if (!pr) throw new Error("PR not found");
    if (pr.status !== PurchaseRequisitionStatus.DRAFT) {
      throw new AuthorizationError("Lines can only be added to DRAFT PRs");
    }
    const ingredient = await tx.ingredient.findUnique({
      where: { id: input.ingredientId },
      select: { avgUnitCost: true },
    });
    if (!ingredient) throw new Error("Ingredient not found");
    await tx.purchaseRequisitionLine.create({
      data: {
        prId,
        ingredientId: input.ingredientId,
        requestedQty: input.requestedQty,
        unitCostSnapshot: ingredient.avgUnitCost.toString(),
        notes: input.notes ?? null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PR_LINE_ADDED",
        entity: "PurchaseRequisition",
        entityId: prId,
      },
    });
  });
  revalidatePath(`/procurement/purchase-requisitions/${prId}`);
}

export async function removePRLine(lineId: string) {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    const line = await tx.purchaseRequisitionLine.findUnique({
      where: { id: lineId },
      include: { pr: { select: { id: true, status: true } } },
    });
    if (!line) throw new Error("Line not found");
    if (line.pr.status !== PurchaseRequisitionStatus.DRAFT) {
      throw new AuthorizationError("Lines can only be removed from DRAFT PRs");
    }
    await tx.purchaseRequisitionLine.delete({ where: { id: lineId } });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PR_LINE_REMOVED",
        entity: "PurchaseRequisition",
        entityId: line.pr.id,
      },
    });
  });
}

/**
 * Submit a draft PR. If the total cost (sum of requestedQty * unitCostSnapshot)
 * is under the threshold, auto-approve. Otherwise needs manager approval.
 */
export async function submitPurchaseRequisition(id: string) {
  const session = await requireRole(WRITE_ROLES);
  await db.$transaction(async (tx) => {
    const pr = await tx.purchaseRequisition.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!pr) throw new Error("PR not found");
    if (pr.status !== PurchaseRequisitionStatus.DRAFT) {
      throw new AuthorizationError("Only DRAFT PRs can be submitted");
    }
    if (pr.lines.length === 0) throw new Error("Add at least one line before submitting");

    const total = pr.lines.reduce(
      (s, l) => s.plus(toDecimal(l.requestedQty).times(toDecimal(l.unitCostSnapshot))),
      new Decimal(0),
    );
    const needsApproval = total.gte(OVER_BUDGET_THRESHOLD);
    const nextStatus = needsApproval
      ? PurchaseRequisitionStatus.PENDING_APPROVAL
      : PurchaseRequisitionStatus.APPROVED;

    await tx.purchaseRequisition.update({
      where: { id },
      data: {
        status: nextStatus,
        submittedAt: new Date(),
        needsApproval,
        ...(needsApproval ? {} : { approvedById: session.user.id, approvedAt: new Date() }),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: needsApproval ? "PR_SUBMITTED_FOR_APPROVAL" : "PR_AUTO_APPROVED",
        entity: "PurchaseRequisition",
        entityId: id,
        payloadHash: sha256Json({ total: total.toString(), needsApproval }),
      },
    });
  });
  revalidatePath(`/procurement/purchase-requisitions/${id}`);
  revalidatePath("/procurement/purchase-requisitions");
}

export async function approvePurchaseRequisition(id: string) {
  const session = await requireRole(APPROVE_ROLES);
  await db.$transaction(async (tx) => {
    const pr = await tx.purchaseRequisition.findUnique({ where: { id }, select: { status: true } });
    if (!pr) throw new Error("PR not found");
    if (pr.status !== PurchaseRequisitionStatus.PENDING_APPROVAL) {
      throw new AuthorizationError("PR is not awaiting approval");
    }
    await tx.purchaseRequisition.update({
      where: { id },
      data: {
        status: PurchaseRequisitionStatus.APPROVED,
        approvedById: session.user.id,
        approvedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PR_APPROVED",
        entity: "PurchaseRequisition",
        entityId: id,
      },
    });
  });
  revalidatePath(`/procurement/purchase-requisitions/${id}`);
}

export async function rejectPurchaseRequisition(id: string, reason: string) {
  const session = await requireRole(APPROVE_ROLES);
  if (!reason.trim()) throw new Error("Reason required");
  await db.$transaction(async (tx) => {
    const pr = await tx.purchaseRequisition.findUnique({ where: { id }, select: { status: true } });
    if (!pr) throw new Error("PR not found");
    if (pr.status !== PurchaseRequisitionStatus.PENDING_APPROVAL) {
      throw new AuthorizationError("PR is not awaiting approval");
    }
    await tx.purchaseRequisition.update({
      where: { id },
      data: {
        status: PurchaseRequisitionStatus.REJECTED,
        rejectionReason: reason,
        approvedById: session.user.id,
        approvedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PR_REJECTED",
        entity: "PurchaseRequisition",
        entityId: id,
        payloadHash: sha256Json({ reason }),
      },
    });
  });
  revalidatePath(`/procurement/purchase-requisitions/${id}`);
}

export async function cancelPurchaseRequisition(id: string, reason: string) {
  const session = await requireRole([Role.ADMIN, Role.MANAGER]);
  if (!reason.trim()) throw new Error("Reason required");
  await db.$transaction(async (tx) => {
    await tx.purchaseRequisition.update({
      where: { id },
      data: { status: PurchaseRequisitionStatus.CANCELLED, rejectionReason: reason, closedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PR_CANCELLED",
        entity: "PurchaseRequisition",
        entityId: id,
        payloadHash: sha256Json({ reason }),
      },
    });
  });
  revalidatePath(`/procurement/purchase-requisitions/${id}`);
}

// ─── Queries ─────────────────────────────────────────────────────────────

export async function listPurchaseRequisitions(opts: { status?: PurchaseRequisitionStatus[] } = {}) {
  await requireRole(READ_ROLES);
  return db.purchaseRequisition.findMany({
    where: opts.status ? { status: { in: opts.status } } : {},
    include: {
      requestedBy: { select: { name: true } },
      order: { select: { code: true } },
      chefRequisition: { select: { requisitionNo: true } },
      _count: { select: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getPurchaseRequisition(id: string) {
  await requireRole(READ_ROLES);
  return db.purchaseRequisition.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { name: true } },
      approvedBy: { select: { name: true } },
      order: { select: { id: true, code: true } },
      chefRequisition: { select: { id: true, requisitionNo: true } },
      lines: {
        include: { ingredient: { select: { name: true, sku: true, unit: true, onHandQty: true } } },
        orderBy: { ingredient: { name: "asc" } },
      },
    },
  });
}
