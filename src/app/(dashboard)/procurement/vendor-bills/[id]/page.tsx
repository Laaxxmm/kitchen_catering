import Link from "next/link";
import { notFound } from "next/navigation";
import { PaymentMethod, Role, VendorBillStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import {
  applyVendorAdvanceToBill,
  approveVendorBill,
  getVendorBill,
  listOpenVendorAdvances,
  markVendorBillPaid,
  matchVendorBill,
} from "@/server/actions/procurement";
import { recordVendorBillPayment, reverseVendorBillPayment } from "@/server/actions/payments";
import { listDocuments } from "@/server/actions/documents";
import { isPayable } from "@/lib/vendor-bill-gates";
import { BillPaymentForm } from "./_components/BillPaymentForm";
import { MarkPaidModal } from "@/components/ik/finance/MarkPaidModal";
import { ActionResultButton } from "@/components/ik/ActionResultButton";
import { InlineReasonForm } from "@/components/ik/InlineReasonForm";
import { DocumentUploader } from "@/components/ik/DocumentUploader";
import { DocumentList } from "@/components/ik/DocumentList";
import { DocumentEntityType } from "@prisma/client";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function VendorBillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [bill, session] = await Promise.all([getVendorBill(id), auth()]);
  if (!bill) notFound();
  const role = session?.user?.role;
  const canMatch = bill.status === VendorBillStatus.DRAFT && !!bill.poId && (role === Role.ADMIN || role === Role.MANAGER || role === Role.STORE_KEEPER || role === Role.ACCOUNTS);
  // Edits allowed pre-approval — DRAFT/PENDING_MATCH, plus DISCREPANCY so a
  // failed match from a keying error isn't a dead end (H6). Same finance desk
  // as bill creation (BILL_WRITE_ROLES in the action; middleware gates route).
  const canEdit =
    (bill.status === VendorBillStatus.DRAFT ||
      bill.status === VendorBillStatus.PENDING_MATCH ||
      bill.status === VendorBillStatus.DISCREPANCY) &&
    (role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS);
  // Accounts approve supplier bills too (client item #12) — mirrors
  // BILL_APPROVE_ROLES in the action; PO approval stays admin/manager.
  const canApprove = (bill.status === VendorBillStatus.MATCHED || bill.status === VendorBillStatus.DISCREPANCY) && (role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS);
  // Approval signs off the supplier's own invoice — it has to be attached
  // first, so say that where the Approve button would otherwise be.
  const hasSupplierInvoice = canApprove
    ? (await listDocuments(DocumentEntityType.VENDOR_BILL, bill.id)).length > 0
    : false;
  const needsApprovalReason = bill.status === VendorBillStatus.DISCREPANCY;
  const canPay = isPayable(bill.status) && (role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS);
  // Unapplied advances for this supplier — offered on payable bills so money
  // already handed over settles the bill instead of being paid twice.
  const openAdvances = canPay ? await listOpenVendorAdvances(bill.vendorId) : [];

  async function doMatch() {
    "use server";
    return await matchVendorBill(id);
  }
  async function doApprove(reason?: string) {
    "use server";
    return await approveVendorBill(id, reason ?? null);
  }
  async function doPay(input: { amount: string; method: PaymentMethod; reference: string | null; notes: string | null; paidAt: string }) {
    "use server";
    return recordVendorBillPayment({ billId: id, ...input });
  }
  async function doMarkPaid(input: {
    method: PaymentMethod;
    reference: string | null;
    paidAt: string;
    notes: string | null;
  }) {
    "use server";
    return markVendorBillPaid({ id, ...input });
  }
  async function doReverse(paymentId: string, reason: string) {
    "use server";
    return await reverseVendorBillPayment({ paymentId, reason });
  }
  async function doApplyAdvance(advanceId: string) {
    "use server";
    return await applyVendorAdvanceToBill(advanceId, id);
  }

  let discrepancies: Array<{ line: string; field: string; poValue?: string; billValue: string; delta?: string }> = [];
  if (bill.discrepancyNote) {
    try {
      discrepancies = JSON.parse(bill.discrepancyNote);
    } catch {
      // Corrupt/legacy note must not take the whole bill page down.
      console.warn(`[vendor-bill] unparseable discrepancyNote on ${bill.billNo}`);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`Bill · ${bill.vendor.name}`}
        title={bill.billNo}
        description={bill.vendorBillNo ? `Vendor invoice #${bill.vendorBillNo}` : "No vendor invoice number"}
        actions={
          <div className="flex gap-2">
            <Link href="/procurement/vendor-bills"><Button variant="outline">Back</Button></Link>
            {canEdit && <Link href={`/procurement/vendor-bills/${bill.id}/edit`}><Button variant="outline">Edit</Button></Link>}
            {canMatch && <ActionResultButton action={doMatch} successMessage="3-way match complete">Run 3-way match</ActionResultButton>}
            {/* A mismatched bill is approved from the banner below, where the
                reason box is — never with a one-click button. */}
            {canApprove && hasSupplierInvoice && !needsApprovalReason && (
              <ActionResultButton action={doApprove} successMessage="Bill approved">Approve</ActionResultButton>
            )}
            {canPay && (
              <MarkPaidModal
                outstanding={(Number(bill.grandTotal) - Number(bill.amountPaid)).toFixed(2)}
                onSubmit={doMarkPaid}
              />
            )}
          </div>
        }
      />
      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <StatusBadge status={bill.status} />
        {bill.issueDate && <span className="text-ik-ink-3">Issued {formatIST(bill.issueDate, "yyyy-MM-dd")}</span>}
        {bill.dueDate && <span className="text-ik-ink-3">Due {formatIST(bill.dueDate, "yyyy-MM-dd")}</span>}
        {bill.po && <span className="text-ik-ink-3">PO <Link href={`/procurement/purchase-orders/${bill.po.id}`} className="font-mono text-brand hover:underline">{bill.po.poNo ?? bill.poId}</Link></span>}
        {bill.po?.order && (
          <span className="text-ik-ink-3">
            For order <Link href={`/orders/${bill.po.order.id}`} className="font-mono text-brand hover:underline">{bill.po.order.code}</Link>
            {" · "}{bill.po.order.customer.name}
          </span>
        )}
      </div>

      {canApprove && !hasSupplierInvoice && (
        <div className="mb-4 rounded-md border border-amber-wash bg-amber-wash p-3 text-[12.5px] text-ik-ink-2">
          <h3 className="mb-1 font-medium text-amber">Supplier&apos;s invoice not attached</h3>
          Upload the invoice the vendor gave you (bottom of this page) before approving. Approving
          is the sign-off on that document.
        </div>
      )}

      {(bill.discrepancyEditReason || bill.approvalNote) && (
        <div className="mb-4 grid gap-1 rounded-md border border-ik-rule bg-ik-card p-3 text-[12.5px] text-ik-ink-2">
          {bill.discrepancyEditReason && (
            <p><span className="text-ik-ink-3">Amounts corrected by accounts:</span> {bill.discrepancyEditReason}</p>
          )}
          {bill.approvalNote && (
            <p>
              <span className="text-ik-ink-3">Approved despite the mismatch</span>
              {bill.approvedBy ? ` by ${bill.approvedBy.name}` : ""}
              {bill.approvedAt ? ` on ${formatIST(bill.approvedAt, "yyyy-MM-dd")}` : ""}: {bill.approvalNote}
            </p>
          )}
        </div>
      )}

      {discrepancies.length > 0 && (
        <div className="mb-4 rounded-md border border-amber-wash bg-amber-wash p-3 text-[12.5px]">
          <h3 className="mb-1 font-medium text-amber">3-way match found {discrepancies.length} discrepancy(ies)</h3>
          <ul className="grid gap-1">
            {discrepancies.map((d, i) => (
              <li key={i}>
                <span className="font-mono">{d.line}</span> · <strong>{d.field}</strong>:
                PO {d.poValue ?? "—"} vs bill {d.billValue}
                {d.delta ? ` (Δ ${d.delta})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Separate from the list above: a DISCREPANCY bill whose note failed to
          parse still needs a way to be approved. */}
      {canApprove && needsApprovalReason && hasSupplierInvoice && (
        <div className="mb-4 rounded-md border border-amber-wash bg-amber-wash p-3 text-[12.5px]">
          <p className="mb-1.5 text-ik-ink-2">
            We pay for what was ordered and received. Either{" "}
            <Link href={`/procurement/vendor-bills/${bill.id}/edit`} className="text-brand hover:underline">edit the bill</Link>{" "}
            down to the correct amounts, or write why it&apos;s being approved as it stands.
          </p>
          <InlineReasonForm
            action={doApprove}
            submitLabel="Approve anyway"
            successMessage="Bill approved"
            placeholder="Reason for approving"
            inputClassName="h-8 w-full max-w-sm text-[12.5px]"
          />
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead>Unit</TableHead>
            <TableHead className="text-right">Unit ₹</TableHead>
            <TableHead className="text-right">GST %</TableHead>
            <TableHead className="text-right">Total ₹</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bill.lines.map((l) => (
            <TableRow key={l.id}>
              <TableCell>{l.description}</TableCell>
              <TableCell className="text-right font-mono">{l.quantity.toString()}</TableCell>
              <TableCell>{l.unit}</TableCell>
              <TableCell className="text-right font-mono">{l.unitPrice.toString()}</TableCell>
              <TableCell className="text-right font-mono">{l.gstRatePct.toString()}</TableCell>
              <TableCell className="text-right font-mono">{l.lineTotal.toString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-3 text-right font-mono text-[13px]">
        <div><span className="text-ik-ink-3">Subtotal</span> {bill.subtotal.toString()}</div>
        <div><span className="text-ik-ink-3">Tax</span> {bill.taxTotal.toString()}</div>
        <div className="font-medium"><span className="text-ik-ink-3">Grand total</span> {formatINR(bill.grandTotal)}</div>
        <div className="text-positive"><span className="text-ik-ink-3">Paid</span> {formatINR(bill.amountPaid)}</div>
      </div>

      {bill.payments.length > 0 && (
        <section className="mt-6 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
          <h3 className="mb-2 font-medium text-[14px] text-ik-ink">Payments</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bill.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-[12px]">{formatIST(p.paidAt, "yyyy-MM-dd")}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(p.amount)}</TableCell>
                  <TableCell>{p.method}</TableCell>
                  <TableCell className="font-mono text-[12px]">{p.reference ?? "—"}</TableCell>
                  <TableCell>
                    {canPay && (
                      <InlineReasonForm
                        action={doReverse.bind(null, p.id)}
                        submitLabel="Reverse"
                        successMessage="Payment reversed"
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <section className="mt-5 grid gap-3">
        <DocumentUploader
          entityType={DocumentEntityType.VENDOR_BILL}
          entityId={bill.id}
          label="Upload supplier bill"
        />
        <DocumentList
          entityType={DocumentEntityType.VENDOR_BILL}
          entityId={bill.id}
          title="Supplier-bill attachments"
        />
      </section>

      {openAdvances.length > 0 && (
        <section className="mt-6 rounded-2xl border border-brand-200 bg-brand-50 p-4 shadow-ik-card">
          <h3 className="mb-1 font-medium text-[14px] text-ik-ink">Advances already paid to {bill.vendor.name}</h3>
          <p className="mb-2 text-[12.5px] text-ik-ink-2">
            Applying an advance posts it as a payment on this bill — don&apos;t also record it below.
          </p>
          <div className="grid gap-2">
            {openAdvances.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className="font-mono">{formatINR(a.amount)}</span>
                <span className="text-ik-ink-3">
                  {formatIST(a.paidAt, "yyyy-MM-dd")} · {a.method}
                  {a.po?.poNo ? ` · for ${a.po.poNo}` : ""}
                  {a.reference ? ` · ref ${a.reference}` : ""}
                </span>
                <ActionResultButton
                  action={doApplyAdvance.bind(null, a.id)}
                  successMessage="Advance applied to this bill"
                >
                  Apply to this bill
                </ActionResultButton>
              </div>
            ))}
          </div>
        </section>
      )}

      {canPay && <BillPaymentForm outstanding={Number(bill.grandTotal) - Number(bill.amountPaid)} onSubmit={doPay} />}
    </>
  );
}
