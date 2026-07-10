import Link from "next/link";
import { notFound } from "next/navigation";
import { BanquetRequisitionStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  getBanquetRequisition,
  issueBanquetRequisitionLine,
  markBanquetLineAwaitingProcurement,
} from "@/server/actions/banquet";
import { formatIST } from "@/lib/time";
import { LineFulfilControls } from "./_components/LineFulfilControls";

export const dynamic = "force-dynamic";

const ISSUE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.FNB_SERVICE, Role.DELIVERY, Role.STORE_KEEPER];

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

  async function doIssue(lineId: string, qty: string) {
    "use server";
    return await issueBanquetRequisitionLine({ requisitionLineId: lineId, issueQty: qty });
  }
  async function doSendToProcurement(lineId: string, reason: string) {
    "use server";
    return await markBanquetLineAwaitingProcurement({ requisitionLineId: lineId, reason });
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
          <Link href="/banquet/requisitions"><Button variant="outline">Back to requisitions</Button></Link>
        }
      />

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
                      requestedQty={requested}
                      issuedQty={issued}
                      inStock={l.item.currentStock.toString()}
                      status={l.status}
                      onIssue={doIssue}
                      onSendToProcurement={doSendToProcurement}
                    />
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
