import Link from "next/link";
import { CustomerInvoiceStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCustomerInvoices } from "@/server/actions/customer-invoices";
import { auth } from "@/server/auth";
import { toDecimal, formatINRWhole } from "@/lib/money";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill } from "@/components/ik/StatusPill";

export const dynamic = "force-dynamic";

type Inv = Awaited<ReturnType<typeof listCustomerInvoices>>[number];

export default async function InvoicesPage() {
  const [session, invoices] = await Promise.all([auth(), listCustomerInvoices()]);
  const role = session?.user?.role;
  const canCreate = role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS;
  const canMarkPaid = role === Role.ADMIN || role === Role.MANAGER;
  const now = new Date();

  const unpaid = invoices.filter((i) => i.status === CustomerInvoiceStatus.ISSUED || i.status === CustomerInvoiceStatus.PARTIAL);
  const paid = invoices.filter((i) => i.status === CustomerInvoiceStatus.PAID);
  // Drafts nobody has signed off can't reach the customer at all, so they
  // get their own section instead of being buried with the cancelled ones.
  const awaitingApproval = invoices.filter((i) => i.status === CustomerInvoiceStatus.DRAFT && !i.approvedAt);
  const other = invoices.filter(
    (i) => (i.status === CustomerInvoiceStatus.DRAFT && i.approvedAt) || i.status === CustomerInvoiceStatus.CANCELLED,
  );
  const outstanding = unpaid.reduce((s, i) => s.plus(toDecimal(i.grandTotal).minus(toDecimal(i.amountPaid))), toDecimal(0));

  return (
    <>
      <PageHeader
        eyebrow="Money"
        title="Invoices"
        description="Unpaid invoices are up top; paid ones below. GST split CGST+SGST / IGST as applicable."
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <Link href="/invoices/new"><Button variant="outline">New standalone</Button></Link>
              <Link href="/invoices/generate"><Button>Generate from orders</Button></Link>
            </div>
          ) : null
        }
      />

      <div className="mb-5">
        <SummaryStrip
          chips={[
            { label: "Unpaid invoices", value: unpaid.length, tone: unpaid.length > 0 ? "amber" : "grey" },
            { label: "Outstanding", value: formatINRWhole(outstanding), tone: outstanding.gt(0) ? "red" : "grey" },
            { label: "Awaiting approval", value: awaitingApproval.length, tone: awaitingApproval.length > 0 ? "amber" : "grey" },
            { label: "Paid", value: paid.length, tone: "green" },
          ]}
        />
      </div>

      {invoices.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No invoices yet. Generate one from a DELIVERED order, or create an ad-hoc invoice.</p>
      ) : (
        <div className="grid gap-5">
          {awaitingApproval.length > 0 && (
            <InvSection title="Awaiting manager approval — not yet releasable" rows={awaitingApproval} now={now} canMarkPaid={false} />
          )}
          {unpaid.length > 0 && <InvSection title="To collect" rows={unpaid} now={now} canMarkPaid={canMarkPaid} />}
          {paid.length > 0 && <InvSection title="Paid" rows={paid} now={now} canMarkPaid={false} />}
          {other.length > 0 && <InvSection title="Approved draft & cancelled" rows={other} now={now} canMarkPaid={false} />}
        </div>
      )}
    </>
  );
}

function InvSection({ title, rows, now, canMarkPaid }: { title: string; rows: Inv[]; now: Date; canMarkPaid: boolean }) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{title} · {rows.length}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead>Status</TableHead>
            {canMarkPaid && <TableHead>Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((inv) => {
            const overdue =
              (inv.status === CustomerInvoiceStatus.ISSUED || inv.status === CustomerInvoiceStatus.PARTIAL) &&
              !!inv.dueAt && inv.dueAt < now;
            const tone =
              inv.status === CustomerInvoiceStatus.PAID ? "green"
                : inv.status === CustomerInvoiceStatus.CANCELLED || inv.status === CustomerInvoiceStatus.DRAFT ? "grey"
                  : overdue ? "red" : "amber";
            const label =
              inv.status === CustomerInvoiceStatus.PARTIAL ? "Part paid"
                : overdue ? "Overdue"
                  : inv.status.charAt(0) + inv.status.slice(1).toLowerCase();
            return (
              <TableRow key={inv.id}>
                <TableCell>
                  <Link href={`/invoices/${inv.id}`} className="font-mono text-brand hover:underline">{inv.invoiceNo}</Link>
                  {inv.order?.code && <span className="ml-2 font-mono text-[11px] text-ik-ink-3">{inv.order.code}</span>}
                </TableCell>
                <TableCell>{inv.customer.name}</TableCell>
                <TableCell className="text-right font-mono">{formatINRWhole(inv.grandTotal)}</TableCell>
                <TableCell className="text-right font-mono text-ik-ink-3">{formatINRWhole(inv.amountPaid)}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1">
                    <StatusPill tone={tone}>{label}</StatusPill>
                    {inv.status === CustomerInvoiceStatus.DRAFT && !inv.approvedAt && (
                      <StatusPill tone="amber">NEEDS APPROVAL</StatusPill>
                    )}
                    {inv.onHoldAt && <StatusPill tone="red">ON HOLD</StatusPill>}
                  </span>
                </TableCell>
                {canMarkPaid && (
                  <TableCell>
                    <Link href={`/invoices/${inv.id}`}>
                      <Button type="button" size="sm" variant="outline">Mark paid…</Button>
                    </Link>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </section>
  );
}
