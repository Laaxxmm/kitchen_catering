/**
 * Helpers, constants and notifications shared by more than one stage of the procurement
 * lifecycle. Not a server-action module: nothing here is callable from the client.
 */

import { ChefRequisitionLineStatus, ChefRequisitionStatus, GRNStatus, Prisma, Role } from "@prisma/client";

export const APPROVE_ROLES = [Role.ADMIN, Role.MANAGER];

export const READ_ROLES = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER, Role.ACCOUNTS, Role.KITCHEN_HEAD];

/**
 * Recompute a chef requisition's rolled-up status after a GRN flips lines
 * back from AWAITING_PROCUREMENT to PENDING. Same semantics as the issue
 * path in chef-requisitions.ts: any issued progress → PARTIALLY_ISSUED,
 * otherwise SUBMITTED. FULLY_ISSUED is unreachable here (the flipped line
 * is PENDING), and the status guard keeps terminal requisitions
 * (CANCELLED / FULLY_ISSUED) untouched.
 */
export async function recomputeChefReqStatusTx(
  tx: Prisma.TransactionClient,
  reqId: string,
  userId: string,
) {
  const lines = await tx.chefRequisitionLine.findMany({
    where: { requisitionId: reqId },
    select: { status: true },
  });
  const anyProgress = lines.some(
    (l) =>
      l.status === ChefRequisitionLineStatus.ISSUED ||
      l.status === ChefRequisitionLineStatus.PARTIALLY_ISSUED,
  );
  await tx.chefRequisition.updateMany({
    where: {
      id: reqId,
      status: { in: [ChefRequisitionStatus.SUBMITTED, ChefRequisitionStatus.PARTIALLY_ISSUED] },
    },
    data: {
      status: anyProgress ? ChefRequisitionStatus.PARTIALLY_ISSUED : ChefRequisitionStatus.SUBMITTED,
      lastFulfilledById: userId,
    },
  });
}

/** GRN states that mean goods actually arrived (a REJECTED one means nothing did). */
export const RECEIVED_GRN_STATUSES = [GRNStatus.ACCEPTED, GRNStatus.PARTIALLY_ACCEPTED];
