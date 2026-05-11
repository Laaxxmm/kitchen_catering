import Link from "next/link";
import { notFound } from "next/navigation";
import { Role, VendorPOStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  approveVendorPO,
  cancelVendorPO,
  getVendorPO,
  sendVendorPO,
  submitVendorPO,
} from "@/server/actions/procurement";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function VendorPODetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [po, session] = await Promise.all([getVendorPO(id), auth()]);
  if (!po) notFound();
  const role = session?.user?.role;
  const canSubmit = po.status === VendorPOStatus.DRAFT && (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);
  const canApprove = po.status === VendorPOStatus.PENDING_APPROVAL && (role === Role.ADMIN || (role === Role.MANAGER && po.approvalTier !== "admin"));
  const canSend = po.status === VendorPOStatus.APPROVED && (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);
  const canReceive = (po.status === VendorPOStatus.APPROVED || po.status === VendorPOStatus.SENT || po.status === VendorPOStatus.PARTIALLY_RECEIVED) && (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER);

  async function doSubmit() { "use server"; await submitVendorPO(id); }
  async function doApprove() { "use server"; await approveVendorPO(id); }
  async function doSend() { "use server"; await sendVendorPO(id); }
  async function doCancel(formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim();
    if (reason) await cancelVendorPO(id, reason);
  }

  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title={po.poNo}
        description={`${po.vendor.name} · tier ${po.approvalTier} · ${formatINR(po.grandTotal)}`}
        actions={
          <div className="flex gap-2">
            <Link href="/procurement/purchase-orders"><Button variant="outline">Back</Button></Link>
            {canSubmit && <form action={doSubmit}><Button type="submit">Submit</Button></form>}
            {canApprove && <form action={doApprove}><Button type="submit">Approve</Button></form>}
            {canSend && <form action={doSend}><Button type="submit" variant="outline">Mark sent</Button></form>}
            {canReceive && <Link href={`/procurement/grns/new?poId=${po.id}`}><Button>Receive (GRN)</Button></Link>}
          </div>
        }
      />
      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <StatusBadge status={po.status} />
        <span className="text-ik-ink-3">Issued {formatIST(po.issueDate, "yyyy-MM-dd")}</span>
        {po.expectedDate && <span className="text-ik-ink-3">· Expected {formatIST(po.expectedDate, "yyyy-MM-dd")}</span>}
        {po.approvedAt && <span className="text-ik-ink-3">· Approved {formatIST(po.approvedAt)} by {po.approvedBy?.name ?? "—"}</span>}
        {po.sentAt && <span className="text-ik-ink-3">· Sent {formatIST(po.sentAt)}</span>}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <section className="md:col-span-2 grid gap-4">
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Lines</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Unit ₹</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Total ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-[12px]">{l.sku}</TableCell>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right font-mono">{l.quantity.toString()} {l.unit}</TableCell>
                    <TableCell className="text-right font-mono">{l.receivedQty.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.unitPrice.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.gstRatePct.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.lineTotal.toString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-2 text-right font-mono text-[13px]">
              <div><span className="text-ik-ink-3">Subtotal</span> {po.subtotal.toString()}</div>
              <div><span className="text-ik-ink-3">Tax</span> {po.taxTotal.toString()}</div>
              <div className="font-medium"><span className="text-ik-ink-3">Total</span> {formatINR(po.grandTotal)}</div>
            </div>
          </div>

          {po.grns.length > 0 && (
            <div className="rounded-md border border-ik-rule bg-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">GRNs</h3>
              <ul className="grid gap-1 text-[13px]">
                {po.grns.map((g) => (
                  <li key={g.id}><Link href={`/procurement/grns/${g.id}`} className="font-mono text-brand hover:underline">{g.grnNo}</Link> · {g.status} · {formatIST(g.receivedAt, "yyyy-MM-dd")}</li>
                ))}
              </ul>
            </div>
          )}
          {po.bills.length > 0 && (
            <div className="rounded-md border border-ik-rule bg-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Vendor bills</h3>
              <ul className="grid gap-1 text-[13px]">
                {po.bills.map((b) => (
                  <li key={b.id}><Link href={`/procurement/vendor-bills/${b.id}`} className="font-mono text-brand hover:underline">{b.billNo}</Link> · {b.status}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <aside className="grid gap-4 text-[13px]">
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Vendor</h3>
            <div><Link href={`/procurement/vendors/${po.vendor.id}`} className="text-brand hover:underline">{po.vendor.name}</Link></div>
            <div className="font-mono text-[12px] text-ik-ink-2">{po.vendor.code}</div>
            {po.vendor.gstin && <div className="font-mono text-[12px] text-ik-ink-2">{po.vendor.gstin}</div>}
            <div className="text-ik-ink-3">State {po.vendor.stateCode}</div>
          </div>
          {(role === Role.ADMIN || role === Role.MANAGER) && po.status !== VendorPOStatus.CANCELLED && (
            <form action={doCancel} className="rounded-md border border-alert-wash bg-alert-wash p-4">
              <h3 className="mb-2 font-medium text-alert">Cancel PO</h3>
              <textarea name="reason" rows={2} placeholder="Reason" className="mb-2 w-full rounded border border-ik-rule bg-ik-card px-2 py-1 text-[12.5px]" />
              <Button type="submit" variant="outline" size="sm">Cancel</Button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
