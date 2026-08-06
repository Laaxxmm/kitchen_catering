import Link from "next/link";
import { notFound } from "next/navigation";
import { CustomerInvoiceStatus, PaymentMethod, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  approveCustomerInvoiceForRelease,
  cancelCustomerInvoice,
  emailTaxInvoice,
  getCustomerInvoice,
  holdCustomerInvoice,
  issueCustomerInvoice,
  markCustomerInvoicePaid,
  releaseCustomerInvoiceHold,
} from "@/server/actions/customer-invoices";
import { recordCustomerInvoicePayment } from "@/server/actions/payments";
import { RecordPaymentForm } from "./_components/RecordPaymentForm";
import { MarkPaidModal } from "@/components/ik/finance/MarkPaidModal";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { ActionReasonForm } from "@/components/ik/ActionReasonForm";
import { formatINR, toDecimal } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { mayReachCustomer } from "@/lib/customer-invoice-gates";

export const dynamic = "force-dynamic";

// Friendly meal labels for the consolidated order row (mirrors the PDF).
const MEAL_LABEL: Record<string, string> = {
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
  HIGH_TEA: "High tea",
  SNACKS: "Snacks",
  CUSTOM: "Custom",
};

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, session] = await Promise.all([getCustomerInvoice(id), auth()]);
  if (!invoice) notFound();
  const role = session?.user?.role;
  const canIssue = role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS;
  // Accounts records detailed payments via the form below; the
  // one-click "Mark paid" + manual email-to-customer are admin/manager
  // only, since they're commercial decisions.
  const canMarkPaid = role === Role.ADMIN || role === Role.MANAGER;
  const canPay = canIssue;
  // Billing hold — while held, payment + email controls disappear and a
  // banner explains why. Hold/release is the finance desk (WRITE_ROLES).
  const isHeld = !!invoice.onHoldAt;
  const canHold = canIssue;
  // Release approval — accounts prepare and edit, a manager signs off.
  const canApprove = role === Role.ADMIN || role === Role.MANAGER;
  const isApproved = !!invoice.approvedAt;
  const isDraft = invoice.status === CustomerInvoiceStatus.DRAFT;
  // Pax the bill is for. The invoice's own snapshot first — the live order
  // moves (100 booked, 120 fed) and the printed rate must divide the amount
  // this invoice actually carries. Legacy rows have no snapshot.
  const pax = invoice.finalHeadcount ?? invoice.order?.headcount ?? null;

  async function doIssue() {
    "use server";
    return await issueCustomerInvoice(id);
  }
  async function doEmailToCustomer() {
    "use server";
    return await emailTaxInvoice(id, { force: true });
  }
  async function doMarkPaid(input: {
    method: PaymentMethod;
    reference: string | null;
    paidAt: string;
    notes: string | null;
  }) {
    "use server";
    return markCustomerInvoicePaid({
      invoiceId: id,
      method: input.method,
      reference: input.reference,
      paidAt: input.paidAt,
      notes: input.notes,
    });
  }
  async function doCancel(reason: string) {
    "use server";
    return await cancelCustomerInvoice(id, reason);
  }
  async function doHold(reason: string) {
    "use server";
    return await holdCustomerInvoice(id, reason);
  }
  async function doReleaseHold(note: string) {
    "use server";
    return await releaseCustomerInvoiceHold(id, note || undefined);
  }
  async function doApprove(note: string) {
    "use server";
    return await approveCustomerInvoiceForRelease(id, note || null);
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
  return (
    <>
      <PageHeader
        eyebrow="Finance · Invoice"
        title={invoice.invoiceNo}
        description={`${invoice.customer.name} · ${invoice.kind} · ${formatINR(invoice.grandTotal)}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/api/invoices/${invoice.id}/pdf`} target="_blank"><Button variant="outline">Download PDF</Button></Link>
            {/* The share link 404s until the invoice is issued — same
                predicate the public page uses, so the button is only here
                when there is something for the customer to see. */}
            {mayReachCustomer(invoice.status) && (
              <Link href={`/i/${invoice.shareToken}`} target="_blank"><Button variant="outline">Public view</Button></Link>
            )}
            {!isHeld && invoice.status !== CustomerInvoiceStatus.DRAFT && invoice.status !== CustomerInvoiceStatus.CANCELLED && canMarkPaid && (
              <ActionResultButton action={doEmailToCustomer} successMessage="Invoice emailed to customer">
                {invoice.emailedAt ? "Resend by email" : "Send to customer"}
              </ActionResultButton>
            )}
            {!isHeld
              && invoice.status !== CustomerInvoiceStatus.PAID
              && invoice.status !== CustomerInvoiceStatus.CANCELLED
              && invoice.status !== CustomerInvoiceStatus.DRAFT
              && canMarkPaid && (
                <MarkPaidModal
                  outstanding={(
                    Number(invoice.grandTotal) - Number(invoice.amountPaid)
                  ).toFixed(2)}
                  onSubmit={doMarkPaid}
                />
              )}
            <Link href="/invoices"><Button variant="outline">Back</Button></Link>
            {isDraft && canIssue && (
              <>
                <Link href={`/invoices/${invoice.id}/edit`}><Button variant="outline">Edit lines & pax</Button></Link>
                {/* Issue is offered only once a manager has signed off. The
                    action refuses anyway; hiding the button means nobody
                    clicks it expecting the customer to get the bill. */}
                {isApproved && (
                  <ActionResultButton action={doIssue} successMessage="Invoice issued">Issue invoice</ActionResultButton>
                )}
              </>
            )}
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <StatusBadge status={invoice.status} />
        {invoice.issuedAt && <span className="text-ik-ink-3">Issued {formatIST(invoice.issuedAt)}</span>}
        {invoice.order && <span className="text-ik-ink-3">· Order <Link href={`/orders/${invoice.order.id}`} className="font-mono text-brand hover:underline">{invoice.order.code}</Link></span>}
      </div>

      {isHeld && (
        <div className="mb-4 rounded-md border border-amber-wash bg-amber-wash p-4 text-[13px]">
          <div className="font-semibold uppercase tracking-wide text-amber">On hold — {invoice.onHoldReason}</div>
          <div className="mt-1 text-ik-ink-2">
            Put on hold by {invoice.onHoldBy?.name ?? "—"}
            {invoice.onHoldAt && <> on {formatIST(invoice.onHoldAt)}</>}.
            Payments and customer emails are blocked until the hold is released.
          </div>
          {canHold && (
            <div className="mt-3 max-w-md">
              <ActionReasonForm
                action={doReleaseHold}
                heading="Release hold"
                submitLabel="Release hold"
                successMessage="Hold released"
                placeholder="Note (optional)"
                required={false}
                tone="warning"
              />
            </div>
          )}
        </div>
      )}

      {/* Release gate. A draft is not a customer document until a manager or
          admin has signed off the numbers on it — and any edit sends it back
          here, so the signature always belongs to the amount on screen. */}
      {isDraft && (
        isApproved ? (
          <div className="mb-4 rounded-md border border-positive-wash bg-positive-wash p-3 text-[12.5px]">
            <div className="font-medium text-positive">Approved for release</div>
            <div className="mt-1 text-ik-ink-2">
              Signed off by {invoice.approvedBy?.name ?? "—"}
              {invoice.approvedAt && <> on {formatIST(invoice.approvedAt)}</>}
              {invoice.approvalNote && <> — “{invoice.approvalNote}”</>}.
              Editing it now withdraws this approval and it will need signing off again.
            </div>
          </div>
        ) : (
          <div className="mb-4 rounded-md border border-amber-wash bg-amber-wash p-4 text-[13px]">
            <div className="font-semibold uppercase tracking-wide text-amber">Awaiting approval</div>
            <div className="mt-1 text-ik-ink-2">
              This invoice can&apos;t be issued to the customer until a manager or admin approves it.
            </div>
            {canApprove && (
              <div className="mt-3 max-w-md">
                <ActionReasonForm
                  action={doApprove}
                  heading="Approve for release"
                  description={`${formatINR(invoice.grandTotal)}${pax ? ` · ${pax} pax` : ""} — check the figures before you sign this off.`}
                  submitLabel="Approve for release"
                  successMessage="Approved — the invoice can now be issued"
                  placeholder="Note (optional)"
                  required={false}
                  tone="brand"
                  buttonVariant="default"
                />
              </div>
            )}
          </div>
        )
      )}

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
          <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
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
                {invoice.order ? (
                  // Order-linked bill: one consolidated row. Pax comes from
                  // the INVOICE's own finalHeadcount, so the printed rate
                  // (subtotal ÷ pax) always divides the amount actually
                  // invoiced. Reading the live order made the two disagree —
                  // change the order to 120 after invoicing and the document
                  // read "120 pax @ ₹416.67" while still totalling 100 pax.
                  // Legacy invoices predate the column and fall back to the
                  // order, i.e. exactly what they printed before.
                  <TableRow>
                    <TableCell>
                      {MEAL_LABEL[invoice.order.mealType] ?? invoice.order.mealType} catering — {invoice.order.code}
                    </TableCell>
                    <TableCell className="text-right font-mono">{pax ?? "—"} pax</TableCell>
                    <TableCell className="text-right font-mono">
                      {pax ? toDecimal(invoice.subtotal).div(pax).toDecimalPlaces(2).toString() : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {toDecimal(invoice.subtotal).gt(0)
                        ? toDecimal(invoice.taxTotal).div(toDecimal(invoice.subtotal)).times(100).toDecimalPlaces(1).toString()
                        : "0"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{invoice.grandTotal.toString()}</TableCell>
                  </TableRow>
                ) : (
                  invoice.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{l.description}</TableCell>
                      <TableCell className="text-right font-mono">{l.quantity.toString()} {l.unit}</TableCell>
                      <TableCell className="text-right font-mono">{l.unitPrice.toString()}</TableCell>
                      <TableCell className="text-right font-mono">{l.gstRatePct.toString()}</TableCell>
                      <TableCell className="text-right font-mono">{l.lineTotal.toString()}</TableCell>
                    </TableRow>
                  ))
                )}
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
            <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
              <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Payments</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Recorded by</TableHead>
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!isHeld && invoice.status === CustomerInvoiceStatus.ISSUED && canPay && (
            <RecordPaymentForm
              outstanding={Number(invoice.grandTotal) - Number(invoice.amountPaid)}
              onSubmit={doRecordPayment}
            />
          )}
        </section>

        <aside className="grid gap-4 text-[13px]">
          <div className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
            <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Customer</h3>
            <div>{invoice.customer.name}</div>
            {invoice.customer.gstin && <div className="font-mono text-[12px] text-ik-ink-2">{invoice.customer.gstin}</div>}
            <div className="text-ik-ink-2">{invoice.customer.billingAddress}</div>
            <div className="text-ik-ink-3">State {invoice.placeOfSupplyStateCode}</div>
          </div>

          {!isHeld
            && (invoice.status === CustomerInvoiceStatus.ISSUED || invoice.status === CustomerInvoiceStatus.PARTIAL)
            && canHold && (
              <ActionReasonForm
                action={doHold}
                heading="Put on hold"
                submitLabel="Put on hold"
                successMessage="Invoice put on hold"
                placeholder="Reason — wrong address / wrong client / wrong items / payment dispute"
                tone="warning"
              />
            )}

          {invoice.status === CustomerInvoiceStatus.DRAFT && canPay && (
            <ActionReasonForm
              action={doCancel}
              heading="Cancel draft"
              submitLabel="Cancel invoice"
              successMessage="Invoice cancelled"
            />
          )}
        </aside>
      </div>
    </>
  );
}
