import {
  BanquetRequisitionLineStatus,
  BanquetRequisitionStatus,
  Prisma,
  VendorPOStatus,
} from "@prisma/client";
import { sha256Json } from "@/lib/audit";

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

const REQ_LINE_OPEN: BanquetRequisitionLineStatus[] = [
  BanquetRequisitionLineStatus.PENDING,
  BanquetRequisitionLineStatus.PARTIALLY_ISSUED,
  BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
];

/**
 * Cancel a set of banquet requisitions with their still-open lines, then deal
 * with any vendor PO those lines spawned for a shortfall (see
 * markBanquetLineAwaitingProcurement):
 *   - DRAFT / PENDING_APPROVAL PO → auto-cancel inline (same VENDOR_PO_CANCELLED
 *     audit + reason) since nothing's been ordered yet;
 *   - APPROVED / SENT / PARTIALLY_RECEIVED → left alone but returned as
 *     reviewPoNos so the caller can ask the store to review (goods may already
 *     be moving);
 *   - CANCELLED / CLOSED / RECEIVED → nothing to do.
 * The cancelled lines are terminal, so we deliberately skip cancelVendorPO's
 * un-strand (which would flip them back to PENDING).
 *
 * Shared by cancelBanquetRequisition (M17) and cancelOrder's cascade (H7).
 * Pure tx helper — no "use server", no notifications (callers own those).
 */
export async function cancelBanquetRequisitionsWithPOs(
  tx: Prisma.TransactionClient,
  reqIds: string[],
  userId: string,
  reason: string,
): Promise<{ requisitionNos: string[]; autoCancelledPoNos: string[]; reviewPoNos: string[] }> {
  if (reqIds.length === 0) return { requisitionNos: [], autoCancelledPoNos: [], reviewPoNos: [] };

  // Capture the PO lines the open (about-to-be-cancelled) lines are waiting on.
  const openLines = await tx.banquetRequisitionLine.findMany({
    where: { requisitionId: { in: reqIds }, status: { in: REQ_LINE_OPEN } },
    select: { vendorPOLineId: true },
  });
  const poLineIds = openLines
    .map((l) => l.vendorPOLineId)
    .filter((v): v is string => v !== null);

  await tx.banquetRequisitionLine.updateMany({
    where: { requisitionId: { in: reqIds }, status: { in: REQ_LINE_OPEN } },
    data: { status: BanquetRequisitionLineStatus.CANCELLED },
  });
  await tx.banquetRequisition.updateMany({
    where: { id: { in: reqIds } },
    data: { status: BanquetRequisitionStatus.CANCELLED, closedAt: new Date() },
  });
  const reqs = await tx.banquetRequisition.findMany({
    where: { id: { in: reqIds } },
    select: { id: true, requisitionNo: true },
  });
  for (const r of reqs) {
    await tx.auditLog.create({
      data: {
        userId,
        action: "BANQUET_REQUISITION_CANCELLED",
        entity: "BanquetRequisition",
        entityId: r.id,
        payloadHash: sha256Json({ reason }),
      },
    });
  }

  const autoCancelledPoNos: string[] = [];
  const reviewPoNos: string[] = [];
  if (poLineIds.length > 0) {
    const poLines = await tx.vendorPOLine.findMany({
      where: { id: { in: poLineIds } },
      select: { po: { select: { id: true, poNo: true, status: true } } },
    });
    const seen = new Set<string>();
    for (const { po } of poLines) {
      if (seen.has(po.id)) continue;
      seen.add(po.id);
      if (po.status === VendorPOStatus.DRAFT || po.status === VendorPOStatus.PENDING_APPROVAL) {
        await tx.vendorPO.update({
          where: { id: po.id },
          data: { status: VendorPOStatus.CANCELLED, closedAt: new Date(), notes: reason },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: "VENDOR_PO_CANCELLED",
            entity: "VendorPO",
            entityId: po.id,
            payloadHash: sha256Json({ reason }),
          },
        });
        autoCancelledPoNos.push(po.poNo);
      } else if (
        po.status === VendorPOStatus.APPROVED ||
        po.status === VendorPOStatus.SENT ||
        po.status === VendorPOStatus.PARTIALLY_RECEIVED
      ) {
        reviewPoNos.push(po.poNo);
      }
    }
  }
  return { requisitionNos: reqs.map((r) => r.requisitionNo), autoCancelledPoNos, reviewPoNos };
}
