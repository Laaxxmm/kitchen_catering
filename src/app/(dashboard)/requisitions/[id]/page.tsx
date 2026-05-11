import Link from "next/link";
import { notFound } from "next/navigation";
import { ChefRequisitionStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  getChefRequisition,
  issueChefRequisitionLine,
  sendChefRequisitionLineToProcurement,
  submitChefRequisition,
} from "@/server/actions/chef-requisitions";
import { formatIST } from "@/lib/time";
import { LineFulfilControls } from "./_components/LineFulfilControls";

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
    await submitChefRequisition(id);
  }
  async function doIssue(lineId: string, qty: string) {
    "use server";
    await issueChefRequisitionLine({ lineId, qtyToIssue: qty });
  }
  async function doSendToProcurement(lineId: string, reason: string) {
    "use server";
    await sendChefRequisitionLineToProcurement({ lineId, reason });
  }

  const canSubmit = isChef && requisition.status === ChefRequisitionStatus.DRAFT;
  const canFulfil =
    isStore &&
    (requisition.status === ChefRequisitionStatus.SUBMITTED ||
      requisition.status === ChefRequisitionStatus.PARTIALLY_ISSUED);

  return (
    <>
      <PageHeader
        eyebrow={`Requisition · Order ${requisition.order.code}`}
        title={requisition.requisitionNo}
        description={`${requisition.order.customer.name} · event ${formatIST(requisition.order.eventDate, "yyyy-MM-dd")}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/orders/${requisition.order.id}`}><Button variant="outline">Back to order</Button></Link>
            {canSubmit && (
              <form action={doSubmit}>
                <Button type="submit">Submit to store</Button>
              </form>
            )}
          </div>
        }
      />

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
    </>
  );
}
