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
import { getSettingOr } from "@/lib/settings";

const WRITE_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];
const APPROVE_ROLES = [Role.ADMIN, Role.MANAGER];
const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.KITCHEN_HEAD, Role.ACCOUNTS];

/**
 * A store-keeper's ingredient request is routed by value, mirroring the
 * vendor-PO approval tiers (client rule: "below ₹5,000 → Manager approves,
 * ₹5,000 and above → Admin approves"). Nothing auto-approves any more —
 * every request gets a sign-off, just from the right authority. The
 * threshold is the same `po.approvalTiers.adminMin` Setting the PO engine
 * uses, so the two stay in lock-step.
 */
async function adminThreshold(): Promise<Decimal> {
  const value = await getSettingOr<{ adminMin: number }>("po.approvalTiers", { adminMin: 5000 });
  const adminMin =
    typeof value?.adminMin === "number" && value.adminMin >= 0 ? value.adminMin : 5000;
  return new Decimal(adminMin);
}

/** Sum of requestedQty × snapshot unit cost across a PR's lines. */
function prTotal(lines: { requestedQty: Decimal | string; unitCostSnapshot: Decimal | string }[]): Decimal {
  return lines.reduce(
    (s, l) => s.plus(toDecimal(l.requestedQty).times(toDecimal(l.unitCostSnapshot))),
    new Decimal(0),
  );
}

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
 * Submit a draft PR for approval. Every request now needs a sign-off —
 * nothing auto-approves. The request is routed by value: below the admin
 * threshold (default ₹5,000) the Manager approves; at-or-above it, the
 * Admin must. The actual gate is enforced in approvePurchaseRequisition;
 * here we just move it to PENDING_APPROVAL and record which tier it is.
 */
export async function submitPurchaseRequisition(id: string) {
  const session = await requireRole(WRITE_ROLES);
  const adminMin = await adminThreshold();
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

    const total = prTotal(pr.lines);
    const needsAdmin = total.gte(adminMin);

    await tx.purchaseRequisition.update({
      where: { id },
      data: {
        status: PurchaseRequisitionStatus.PENDING_APPROVAL,
        submittedAt: new Date(),
        needsApproval: true,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PR_SUBMITTED_FOR_APPROVAL",
        entity: "PurchaseRequisition",
        entityId: id,
        payloadHash: sha256Json({ total: total.toString(), tier: needsAdmin ? "admin" : "manager" }),
      },
    });
  });
  revalidatePath(`/procurement/purchase-requisitions/${id}`);
  revalidatePath("/procurement/purchase-requisitions");
}

export async function approvePurchaseRequisition(id: string) {
  const session = await requireRole(APPROVE_ROLES);
  const adminMin = await adminThreshold();
  await db.$transaction(async (tx) => {
    const pr = await tx.purchaseRequisition.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!pr) throw new Error("PR not found");
    if (pr.status !== PurchaseRequisitionStatus.PENDING_APPROVAL) {
      throw new AuthorizationError("PR is not awaiting approval");
    }

    // Value-routed sign-off: ≥ ₹5,000 requests are Admin's call; smaller
    // ones the Manager (or Admin) can clear.
    const total = prTotal(pr.lines);
    const needsAdmin = total.gte(adminMin);
    if (needsAdmin && session.user.role !== Role.ADMIN) {
      throw new AuthorizationError(
        `This request is ${total.toFixed(2)} (≥ ${adminMin.toFixed(0)}) — only an Admin can approve it.`,
      );
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
        payloadHash: sha256Json({ total: total.toString(), tier: needsAdmin ? "admin" : "manager" }),
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
