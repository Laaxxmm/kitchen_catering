import Link from "next/link";
import { notFound } from "next/navigation";
import { ChefRequisitionLineStatus, ChefRequisitionStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  cancelChefRequisition,
  getChefRequisition,
  issueChefRequisitionLine,
  sendChefRequisitionLineToProcurement,
  submitChefRequisition,
} from "@/server/actions/chef-requisitions";
import { formatIST } from "@/lib/time";
import { LineFulfilControls } from "./_components/LineFulfilControls";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { ActionReasonForm } from "@/components/ik/ActionReasonForm";

export const dynamic = "force-dynamic";

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [requisition, session] = await Promise.all([getChefRequisition(id), auth()]);
  if (!requisition) notFound();
  const role = session?.user?.role;
  const isAdmin = role === Role.ADMIN;
  const isStore = role === Role.STORE_KEEPER || isAdmin;
  const isChef = role === Role.KITCHEN_HEAD || isAdmin;

  async function doSubmit() {
    "use server";
    return await submitChefRequisition(id);
  }
  async function doIssue(lineId: string, qty: string) {
    "use server";
    return await issueChefRequisitionLine({ lineId, qtyToIssue: qty });
  }
  async function doSendToProcurement(lineId: string, reason: string) {
    "use server";
    return await sendChefRequisitionLineToProcurement({ lineId, reason });
  }
  async function doCancel(reason: string) {
    "use server";
    return await cancelChefRequisition(id, reason || undefined);
  }

  const canSubmit = isChef && requisition.status === ChefRequisitionStatus.DRAFT;
  // Two closers (mirrors the server guards in cancelChefRequisition):
  //  - the chef who raised it: DRAFT/SUBMITTED, nothing issued, no PO running.
  //  - the store / admin / manager declining it (reason required): DRAFT,
  //    SUBMITTED or PARTIALLY_ISSUED.
  const isCreator = session?.user?.id === requisition.createdById;
  const isStoreClose =
    !isCreator &&
    !!role &&
    (role === Role.STORE_KEEPER || role === Role.ADMIN || role === Role.MANAGER);
  const creatorCanCancel =
    isCreator &&
    (requisition.status === ChefRequisitionStatus.DRAFT ||
      requisition.status === ChefRequisitionStatus.SUBMITTED) &&
    !requisition.lines.some((l) => Number(l.issuedQty.toString()) > 0) &&
    !requisition.lines.some((l) => l.status === ChefRequisitionLineStatus.AWAITING_PROCUREMENT);
  const storeCanClose =
    isStoreClose &&
    (requisition.status === ChefRequisitionStatus.DRAFT ||
      requisition.status === ChefRequisitionStatus.SUBMITTED ||
      requisition.status === ChefRequisitionStatus.PARTIALLY_ISSUED);
  const canCancel = creatorCanCancel || storeCanClose;
  const canFulfil =
    isStore &&
    (requisition.status === ChefRequisitionStatus.SUBMITTED ||
      requisition.status === ChefRequisitionStatus.PARTIALLY_ISSUED);
  // Short lines the store has flagged as out-of-stock → ready to put on a PO.
  const hasAwaiting = requisition.lines.some(
    (l) => l.status === ChefRequisitionLineStatus.AWAITING_PROCUREMENT,
  );

  return (
    <>
      <PageHeader
        eyebrow={requisition.order ? `Requisition · Order ${requisition.order.code}` : "Requisition · General kitchen request"}
        title={requisition.requisitionNo}
        description={
          requisition.order
            ? `${requisition.order.customer.name} · event ${formatIST(requisition.order.eventDate, "yyyy-MM-dd")}`
            : "Standalone kitchen stock request — not tied to any order."
        }
        actions={
          <div className="flex gap-2">
            {requisition.order
              ? <Link href={`/orders/${requisition.order.id}`}><Button variant="outline">Back to order</Button></Link>
              : <Link href="/requisitions"><Button variant="outline">Back to requisitions</Button></Link>}
            {canSubmit && (
              <ActionResultButton action={doSubmit} successMessage="Requisition submitted to store">
                Submit to store
              </ActionResultButton>
            )}
            {isStore && hasAwaiting && (
              <Link href={`/procurement/purchase-orders/new?reqId=${requisition.id}`}>
                <Button>Raise purchase order</Button>
              </Link>
            )}
          </div>
        }
      />

      {isStore && hasAwaiting && (
        <div className="mb-4 rounded-md border border-amber bg-amber-wash p-3 text-[13px] text-ik-ink-2">
          <strong>Some items are short.</strong> Hit <em>Raise purchase order</em> to buy them — the
          PO opens pre-filled with the shortfall and approximate prices. Once the vendor delivers and
          you record the GRN, come back here and issue those lines to the chef.
        </div>
      )}

      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <StatusBadge status={requisition.status} />
        <span className="text-ik-ink-3">Raised by {requisition.createdBy?.name ?? "—"}</span>
        {requisition.submittedAt && (
          <span className="text-ik-ink-3">· Submitted {formatIST(requisition.submittedAt)}</span>
        )}
        {requisition.lastFulfilledBy && (
          <span className="text-ik-ink-3">· Last touched by {requisition.lastFulfilledBy.name}</span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ingredient</TableHead>
            <TableHead className="text-right">Requested</TableHead>
            <TableHead className="text-right">Issued</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead>Status</TableHead>
            {canFulfil && <TableHead>Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {requisition.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                {l.ingredient.name}
                <span className="text-ik-ink-3"> · {l.ingredient.sku}</span>
              </TableCell>
              <TableCell className="text-right font-mono">
                {l.requestedQty.toString()} {l.unit}
              </TableCell>
              <TableCell className="text-right font-mono">{l.issuedQty.toString()}</TableCell>
              <TableCell className="text-right font-mono">{l.ingredient.onHandQty.toString()}</TableCell>
              <TableCell><StatusBadge status={l.status} /></TableCell>
              {canFulfil && (
                <TableCell>
                  <LineFulfilControls
                    lineId={l.id}
                    requestedQty={l.requestedQty.toString()}
                    issuedQty={l.issuedQty.toString()}
                    onHand={l.ingredient.onHandQty.toString()}
                    status={l.status}
                    onIssue={doIssue}
                    onSendToProcurement={doSendToProcurement}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
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
                : "Store can't fulfil this — the chef who raised it is told the reason."
            }
            submitLabel={isCreator ? "Cancel requisition" : "Close request"}
            successMessage={
              isCreator
                ? "Requisition cancelled — the store has been told to disregard it"
                : "Request closed — the chef has been notified"
            }
            placeholder={isCreator ? "Reason (optional)" : "Reason (required)"}
            required={!isCreator}
            redirectTo="/requisitions"
          />
        </div>
      )}
    </>
  );
}
