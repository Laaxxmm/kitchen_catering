import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerInvoiceStatus, PaymentMethod, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  cancelCustomerInvoice,
  getCustomerInvoice,
  issueCustomerInvoice,
} from "@/server/actions/customer-invoices";
import {
  recordCustomerInvoicePayment,
  reverseCustomerInvoicePayment,
} from "@/server/actions/payments";
import { RecordPaymentForm } from "./_components/RecordPaymentForm";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, session] = await Promise.all([getCustomerInvoice(id), auth()]);
  if (!invoice) notFound();
  const role = session?.user?.role;
  const canIssue = role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS;
  const canPay = canIssue;

  async function doIssue() {
    "use server";
    await issueCustomerInvoice(id);
  }
  async function doCancel(formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) return;
    await cancelCustomerInvoice(id, reason);
  }
  async function doRecordPayment(input: { amount: string; method: PaymentMethod; reference: string | null; notes: string | null; paidAt: string }) {
    "use server";
    return recordCustomerInvoicePayment({
      invoiceId: id,
      amount: input.amount,
      method: input.method,
      reference: input.reference,
      notes: input.notes,
      paidAt: input.paidAt,
    });
  }
  async function doReverse(paymentId: string, formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim();
    if (!reason) return;
    await reverseCustomerInvoicePayment({ paymentId, reason });
  }

  return (
    <>
      <PageHeader
        eyebrow="Finance · Invoice"
        title={invoice.invoiceNo}
        description={`${invoice.customer.name} · ${invoice.kind} · ${formatINR(invoice.grandTotal)}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/i/${invoice.shareToken}`} target="_blank"><Button variant="outline">Public view</Button></Link>
            <Link href="/invoices"><Button variant="outline">Back</Button></Link>
            {invoice.status === CustomerInvoiceStatus.DRAFT && canIssue && (
              <form action={doIssue}><Button type="submit">Issue invoice</Button></form>
            )}
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <StatusBadge status={invoice.status} />
        {invoice.issuedAt && <span className="text-ik-ink-3">Issued {formatIST(invoice.issuedAt)}</span>}
        {invoice.order && <span className="text-ik-ink-3">· Order <Link href={`/orders/${invoice.order.id}`} className="font-mono text-brand hover:underline">{invoice.order.code}</Link></span>}
      </div>

      {invoice.irn && (
        <div className="mb-4 rounded-md border border-positive-wash bg-positive-wash p-3 text-[12.5px]">
          <div className="font-medium text-positive">E-invoice generated</div>
          <div className="mt-1 grid gap-1 font-mono">
            <div><span className="text-ik-ink-3">IRN:</span> <span className="break-all">{invoice.irn}</span></div>
            <div><span className="text-ik-ink-3">Ack:</span> {invoice.ackNo} · {invoice.ackDate ? formatIST(invoice.ackDate) : "—"}</div>
            <div><span className="text-ik-ink-3">Provider:</span> {invoice.eInvoiceStatus}</div>
          </div>
        </div>
      )}
      {invoice.eInvoiceStatus === "PENDING" && (
        <div className="mb-4 rounded-md border border-amber-wash bg-amber-wash p-3 text-[12.5px] text-amber">
          IRN generation in progress — refresh in a moment.
        </div>
      )}
      {invoice.eInvoiceStatus === "FAILED" && (
        <div className="mb-4 rounded-md border border-alert-wash bg-alert-wash p-3 text-[12.5px] text-alert">
          IRN generation failed. See /admin/audit for the error log.
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <section className="md:col-span-2 grid gap-4">
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Line items</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit ₹</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Total ₹</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right font-mono">{l.quantity.toString()} {l.unit}</TableCell>
                    <TableCell className="text-right font-mono">{l.unitPrice.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.gstRatePct.toString()}</TableCell>
                    <TableCell className="text-right font-mono">{l.lineTotal.toString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="mt-3 grid gap-1 font-mono text-[13px] text-right">
              <div><span className="text-ik-ink-3">Subtotal</span> <span className="ml-2">{invoice.subtotal.toString()}</span></div>
              {Number(invoice.cgst) > 0 && <div><span className="text-ik-ink-3">CGST</span> <span className="ml-2">{invoice.cgst.toString()}</span></div>}
              {Number(invoice.sgst) > 0 && <div><span className="text-ik-ink-3">SGST</span> <span className="ml-2">{invoice.sgst.toString()}</span></div>}
              {Number(invoice.igst) > 0 && <div><span className="text-ik-ink-3">IGST</span> <span className="ml-2">{invoice.igst.toString()}</span></div>}
              <div className="font-medium"><span className="text-ik-ink-3">Grand total</span> <span className="ml-2">{formatINR(invoice.grandTotal)}</span></div>
              <div className="text-positive"><span className="text-ik-ink-3">Paid</span> <span className="ml-2">{formatINR(invoice.amountPaid)}</span></div>
            </div>
          </div>

          {invoice.payments.length > 0 && (
            <div className="rounded-md border border-ik-rule bg-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Payments</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Recorded by</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-[12px]">{formatIST(p.paidAt, "yyyy-MM-dd")}</TableCell>
                      <TableCell className="text-right font-mono">{formatINR(p.amount)}</TableCell>
                      <TableCell>{p.method}</TableCell>
                      <TableCell className="font-mono text-[12px]">{p.reference ?? "—"}</TableCell>
                      <TableCell>{p.recordedBy?.name}</TableCell>
                      <TableCell>
                        {canPay && (
                          <form action={doReverse.bind(null, p.id)} className="inline">
                            <input name="reason" placeholder="Reason" className="h-6 w-24 rounded border border-ik-rule bg-ik-card px-1 text-[11px]" />
                            <Button type="submit" size="sm" variant="outline" className="ml-1">Reverse</Button>
                          </form>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {invoice.status === CustomerInvoiceStatus.ISSUED && canPay && (
            <RecordPaymentForm
              outstanding={Number(invoice.grandTotal) - Number(invoice.amountPaid)}
              onSubmit={doRecordPayment}
            />
          )}
        </section>

        <aside className="grid gap-4 text-[13px]">
          <div className="rounded-md border border-ik-rule bg-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Customer</h3>
            <div>{invoice.customer.name}</div>
            {invoice.customer.gstin && <div className="font-mono text-[12px] text-ik-ink-2">{invoice.customer.gstin}</div>}
            <div className="text-ik-ink-2">{invoice.customer.billingAddress}</div>
            <div className="text-ik-ink-3">State {invoice.placeOfSupplyStateCode}</div>
          </div>

          {invoice.status === CustomerInvoiceStatus.DRAFT && canPay && (
            <form action={doCancel} className="rounded-md border border-alert-wash bg-alert-wash p-4">
              <h3 className="mb-2 font-medium text-alert">Cancel draft</h3>
              <textarea name="reason" rows={2} placeholder="Reason" className="mb-2 w-full rounded border border-ik-rule bg-ik-card px-2 py-1 text-[12.5px]" />
              <Button type="submit" variant="outline" size="sm">Cancel invoice</Button>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
