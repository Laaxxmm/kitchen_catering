import {
  BanquetRequisitionLineStatus,
  BanquetRequisitionStatus,
  Prisma,
} from "@prisma/client";

// Shared banquet-store primitives used by more than one "use server" action
// module (banquet.ts and procurement.ts — GRN posting bumps banquet stock and
// flips requisition lines). Lives outside the action files so it never
// becomes a callable server-action endpoint and so the two action modules
// don't import each other (circular "use server" imports).

/**
 * Row-lock banquet items for the rest of the transaction. Every stock
 * movement (receipt / issue) reads or updates currentStock — without the
 * lock two concurrent movements read the same snapshot and one update is
 * silently lost (stock can even go negative past the availability check).
 * FOR UPDATE serialises them; ids are locked in a stable order so
 * concurrent multi-line movements can't deadlock.
 */
export async function lockBanquetItemRows(tx: Prisma.TransactionClient, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$executeRaw`SELECT 1 FROM "BanquetItem" WHERE "id" = ${id} FOR UPDATE`;
  }
}

const REQ_LINE_CLOSED: BanquetRequisitionLineStatus[] = [
  BanquetRequisitionLineStatus.ISSUED,
  BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
  BanquetRequisitionLineStatus.CANCELLED,
];

/**
 * Recompute a requisition's rolled-up status from its lines and stamp who
 * last touched it. All lines closed (issued / awaiting-PO / cancelled) →
 * FULLY_ISSUED + closedAt; any progress (issued / part / awaiting) but work
 * still open → PARTIALLY_ISSUED; otherwise SUBMITTED.
 */
export async function recomputeBanquetReqStatus(
  tx: Prisma.TransactionClient,
  reqId: string,
  fulfilledById: string,
): Promise<BanquetRequisitionStatus> {
  const lines = await tx.banquetRequisitionLine.findMany({
    where: { requisitionId: reqId },
    select: { status: true },
  });
  const allClosed = lines.every((l) => REQ_LINE_CLOSED.includes(l.status));
  const anyProgress = lines.some(
    (l) =>
      l.status === BanquetRequisitionLineStatus.ISSUED ||
      l.status === BanquetRequisitionLineStatus.PARTIALLY_ISSUED ||
      l.status === BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
  );
  const status = allClosed
    ? BanquetRequisitionStatus.FULLY_ISSUED
    : anyProgress
      ? BanquetRequisitionStatus.PARTIALLY_ISSUED
      : BanquetRequisitionStatus.SUBMITTED;
  await tx.banquetRequisition.update({
    where: { id: reqId },
    data: {
      status,
      lastFulfilledById: fulfilledById,
      closedAt: allClosed ? new Date() : null,
    },
  });
  return status;
}
