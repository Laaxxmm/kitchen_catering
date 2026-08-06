import Link from "next/link";
import { notFound } from "next/navigation";
import { BanquetRequisitionLineStatus, BanquetRequisitionStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  amendBanquetRequisitionLineQty,
  cancelBanquetRequisition,
  cancelBanquetRequisitionLine,
  getBanquetRequisition,
  issueBanquetRequisitionLine,
  sendBanquetRequisitionLineToProcurement,
} from "@/server/actions/banquet";
import { acknowledgeRevisedDocument } from "@/server/actions/orders";
import { db } from "@/server/db";
import { formatIST } from "@/lib/time";
import { LineFulfilControls } from "./_components/LineFulfilControls";
import { ActionReasonForm } from "@/components/ik/ActionReasonForm";
import {
  RevisionBanner,
  revisionOrderSelect,
} from "@/app/(dashboard)/requisitions/[id]/_components/RevisionBanner";

export const dynamic = "force-dynamic";

const ISSUE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER];
// Who the /procurement/purchase-orders/new page lets in — the "Raise PO for
// all short items" button is pointless for anyone else (they'd be bounced).
const PO_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.STORE_KEEPER];

export default async function BanquetRequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [requisition, session] = await Promise.all([getBanquetRequisition(id), auth()]);
  if (!requisition) notFound();
  const role = session?.user?.role;
  const canFulfil =
    !!role &&
    ISSUE_ROLES.includes(role) &&
    (requisition.status === BanquetRequisitionStatus.SUBMITTED ||
      requisition.status === BanquetRequisitionStatus.PARTIALLY_ISSUED);
  // Two closers (mirrors the server guards in cancelBanquetRequisition):
  //  - the F&B user who raised it withdraws a mistake (no stock issued yet).
  //  - the store / admin / manager declines a request it can't fulfil.
  const isCreator = session?.user?.id === requisition.createdById;
  const isStoreClose =
    !isCreator &&
    !!role &&
    (role === Role.STORE_KEEPER || role === Role.ADMIN || role === Role.MANAGER);
  const notTerminal =
    requisition.status !== BanquetRequisitionStatus.FULLY_ISSUED &&
    requisition.status !== BanquetRequisitionStatus.CANCELLED;
  const canCancel =
    notTerminal &&
    ((isCreator && !requisition.lines.some((l) => Number(l.issuedQty.toString()) > 0)) ||
      isStoreClose);

  // One PO for every line the store flagged out-of-stock, same screen the
  // kitchen uses. Counted with the exact filter the prefill applies (flagged,
  // not already back-linked to a PO line) so the button and the screen agree.
  const shortLineCount = requisition.lines.filter(
    (l) =>
      l.status === BanquetRequisitionLineStatus.AWAITING_PROCUREMENT && l.vendorPOLineId == null,
  ).length;
  const canRaisePO = canFulfil && !!role && PO_ROLES.includes(role) && shortLineCount > 0;

  // getBanquetRequisition doesn't carry the order's revision stamps, so read
  // them here. Skipped for a cancelled requisition — nothing left to chase,
  // same as the revision board's filter.
  const revisedOrder =
    requisition.order && requisition.status !== BanquetRequisitionStatus.CANCELLED
      ? await db.order.findUnique({
          where: { id: requisition.order.id },
          select: revisionOrderSelect,
        })
      : null;

  async function doAckRevision() {
    "use server";
    return await acknowledgeRevisedDocument("BANQUET_REQUISITION", id);
  }
  async function doIssue(lineId: string, qty: string) {
    "use server";
    return await issueBanquetRequisitionLine({ requisitionLineId: lineId, issueQty: qty });
  }
  // Flags the line only — no PO. The store then raises one PO for every
  // flagged line via the header link above.
  async function doSendToProcurement(lineId: string, reason: string) {
    "use server";
    return await sendBanquetRequisitionLineToProcurement({ requisitionLineId: lineId, reason });
  }
  async function doAmendQty(lineId: string, newQty: string, reason: string) {
    "use server";
    return await amendBanquetRequisitionLineQty(lineId, newQty, reason);
  }
  async function doCancelLine(lineId: string, reason: string) {
    "use server";
    return await cancelBanquetRequisitionLine(lineId, reason);
  }
  async function doCancel(reason: string) {
    "use server";
    return await cancelBanquetRequisition(id, reason);
  }

  return (
    <>
      <PageHeader
        eyebrow={requisition.order ? `Banquet requisition · Order ${requisition.order.code}` : "Banquet requisition"}
        title={requisition.requisitionNo}
        description={
          requisition.order
            ? `${requisition.order.customer.name} · event ${formatIST(requisition.order.eventDate, "yyyy-MM-dd")}`
            : "F&B stock request against the banquet store — not tied to any order."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {canRaisePO && (
              <Link href={`/procurement/purchase-orders/new?banquetReqId=${requisition.id}`}>
                <Button>
                  Raise PO for {shortLineCount} short item{shortLineCount === 1 ? "" : "s"}
                </Button>
              </Link>
            )}
            <Link href="/banquet/requisitions"><Button variant="outline">Back to requisitions</Button></Link>
          </div>
        }
      />

      <RevisionBanner
        order={revisedOrder}
        documentLabel="requisition"
        createdAt={requisition.createdAt}
        ackAt={requisition.revisionAckAt}
        canAcknowledge={!!role && ISSUE_ROLES.includes(role)}
        onAcknowledge={doAckRevision}
      >
        <p>
          <strong>What to do:</strong> check every line below against the new numbers. Where more is
          needed, raise the requested quantity on that line — the store then issues only the extra,
          not the whole amount again. Anything already issued stays issued.
        </p>
        {requisition.order && (
          <p className="mt-1.5">
            <Link href={`/orders/${requisition.order.id}`} className="text-brand hover:underline">
              Open the order
            </Link>{" "}
            to see what changed before you change anything here.
          </p>
        )}
      </RevisionBanner>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-[13px]">
        <StatusBadge status={requisition.status} />
        <span className="text-ik-ink-3">Raised by {requisition.createdBy?.name ?? "—"}</span>
        <span className="text-ik-ink-3">· {formatIST(requisition.submittedAt)}</span>
        {requisition.lastFulfilledBy && (
          <span className="text-ik-ink-3">· Last touched by {requisition.lastFulfilledBy.name}</span>
        )}
      </div>

      {requisition.notes && (
        <div className="mb-4 rounded-md border border-ik-rule bg-ik-card p-3 text-[13px] text-ik-ink-2">
          {requisition.notes}
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="text-right">Requested</TableHead>
            <TableHead className="text-right">Issued</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
            <TableHead className="text-right">In stock</TableHead>
            <TableHead>Status</TableHead>
            {canFulfil && <TableHead>Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {requisition.lines.map((l) => {
            const requested = l.requestedQty.toString();
            const issued = l.issuedQty.toString();
            const remaining = (Number(requested) - Number(issued)).toString();
            return (
              <TableRow key={l.id}>
                <TableCell>
                  {l.item.name}
                  {l.item.sku && <span className="text-ik-ink-3"> · {l.item.sku}</span>}
                </TableCell>
                <TableCell className="text-right font-mono">{requested} {l.item.unit}</TableCell>
                <TableCell className="text-right font-mono">{issued}</TableCell>
                <TableCell className="text-right font-mono">{remaining}</TableCell>
                <TableCell className="text-right font-mono">{l.item.currentStock.toString()}</TableCell>
                <TableCell><StatusBadge status={l.status} /></TableCell>
                {canFulfil && (
                  <TableCell>
                    <LineFulfilControls
                      lineId={l.id}
                      itemName={l.item.name}
                      unit={l.item.unit}
                      requestedQty={requested}
                      issuedQty={issued}
                      inStock={l.item.currentStock.toString()}
                      status={l.status}
                      poLink={
                        l.vendorPOLine
                          ? { poId: l.vendorPOLine.poId, poNo: l.vendorPOLine.po.poNo }
                          : null
                      }
                      onIssue={doIssue}
                      onSendToProcurement={doSendToProcurement}
                      onCancel={doCancelLine}
                      onAmendQty={doAmendQty}
                    />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {canCancel && (
        <div className="mt-6 max-w-sm">
          <ActionReasonForm
            action={doCancel}
            heading={isCreator ? "Cancel requisition" : "Close request"}
            description={
              isCreator
                ? "This tells the store to disregard the request."
                : "Store can't fulfil this — the F&B team that raised it is told the reason."
            }
            submitLabel={isCreator ? "Cancel requisition" : "Close request"}
            successMessage={
              isCreator
                ? "Requisition cancelled — the store has been told to disregard it"
                : "Request closed — the F&B team has been notified"
            }
            placeholder="Reason (required)"
            required
            redirectTo="/banquet/requisitions"
          />
        </div>
      )}
    </>
  );
}
