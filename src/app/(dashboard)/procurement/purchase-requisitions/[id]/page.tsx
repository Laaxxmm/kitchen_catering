import Link from "next/link";
import { notFound } from "next/navigation";
import { PurchaseRequisitionStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  approvePurchaseRequisition,
  cancelPurchaseRequisition,
  getPurchaseRequisition,
  rejectPurchaseRequisition,
  submitPurchaseRequisition,
} from "@/server/actions/purchase-requisitions";
import { Decimal } from "decimal.js";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function PRDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [pr, session] = await Promise.all([getPurchaseRequisition(id), auth()]);
  if (!pr) notFound();
  const role = session?.user?.role;
  const isApprover = role === Role.ADMIN || role === Role.MANAGER;
  const canSubmit = pr.status === PurchaseRequisitionStatus.DRAFT && (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);
  const canApprove = pr.status === PurchaseRequisitionStatus.PENDING_APPROVAL && isApprover;

  async function doSubmit() { "use server"; await submitPurchaseRequisition(id); }
  async function doApprove() { "use server"; await approvePurchaseRequisition(id); }
  async function doReject(formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim();
    if (reason) await rejectPurchaseRequisition(id, reason);
  }
  async function doCancel(formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim();
    if (reason) await cancelPurchaseRequisition(id, reason);
  }

  const total = pr.lines.reduce((s, l) => s.plus(new Decimal(l.requestedQty.toString()).times(new Decimal(l.unitCostSnapshot.toString()))), new Decimal(0));

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title={pr.prNo}
        description={pr.order ? `Linked to order ${pr.order.code}` : "Manual PR"}
        actions={
          <div className="flex gap-2">
            <Link href="/procurement/purchase-requisitions"><Button variant="outline">Back</Button></Link>
            {canSubmit && <form action={doSubmit}><Button type="submit">Submit</Button></form>}
            {canApprove && <form action={doApprove}><Button type="submit">Approve</Button></form>}
          </div>
        }
      />
      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <StatusBadge status={pr.status} />
        <span className="text-ik-ink-3">Requested by {pr.requestedBy?.name ?? "—"}</span>
        {pr.submittedAt && <span className="text-ik-ink-3">· Submitted {formatIST(pr.submittedAt)}</span>}
        {pr.approvedAt && <span className="text-ik-ink-3">· {pr.status === PurchaseRequisitionStatus.REJECTED ? "Rejected" : "Approved"} {formatIST(pr.approvedAt)} by {pr.approvedBy?.name ?? "—"}</span>}
      </div>
      {pr.rejectionReason && (
        <div className="mb-4 rounded-md border border-alert-wash bg-alert-wash p-3 text-[12.5px] text-alert">{pr.rejectionReason}</div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ingredient</TableHead>
            <TableHead className="text-right">Requested</TableHead>
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead className="text-right">Line ₹</TableHead>
            <TableHead className="text-right">On hand</TableHead>
            <TableHead>Notes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pr.lines.map((l) => {
            const lineTotal = new Decimal(l.requestedQty.toString()).times(new Decimal(l.unitCostSnapshot.toString())).toDecimalPlaces(2);
            return (
              <TableRow key={l.id}>
                <TableCell>{l.ingredient.name} <span className="text-ik-ink-3">· {l.ingredient.sku}</span></TableCell>
                <TableCell className="text-right font-mono">{l.requestedQty.toString()} {l.ingredient.unit}</TableCell>
                <TableCell className="text-right font-mono">{l.unitCostSnapshot.toString()}</TableCell>
                <TableCell className="text-right font-mono">{lineTotal.toString()}</TableCell>
                <TableCell className="text-right font-mono text-ik-ink-3">{l.ingredient.onHandQty.toString()}</TableCell>
                <TableCell className="text-ik-ink-2 text-[11.5px]">{l.notes ?? "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <div className="mt-3 text-right font-mono text-[14px]">
        <span className="text-ik-ink-3">Total snapshot</span> ₹{total.toDecimalPlaces(2).toString()}
      </div>

      {canApprove && (
        <form action={doReject} className="mt-6 rounded-md border border-alert-wash bg-alert-wash p-4 max-w-xl">
          <h3 className="mb-2 font-medium text-alert">Reject PR</h3>
          <textarea name="reason" rows={2} placeholder="Reason" className="mb-2 w-full rounded border border-ik-rule bg-ik-card px-2 py-1 text-[12.5px]" />
          <Button type="submit" variant="outline" size="sm">Reject</Button>
        </form>
      )}
      {pr.status !== PurchaseRequisitionStatus.CANCELLED && isApprover && (
        <form action={doCancel} className="mt-3 rounded-md border border-ik-rule bg-ik-paper-alt p-4 max-w-xl">
          <h3 className="mb-2 font-medium text-ik-ink-2">Cancel PR</h3>
          <textarea name="reason" rows={2} placeholder="Reason" className="mb-2 w-full rounded border border-ik-rule bg-ik-card px-2 py-1 text-[12.5px]" />
          <Button type="submit" variant="outline" size="sm">Cancel</Button>
        </form>
      )}
    </>
  );
}
