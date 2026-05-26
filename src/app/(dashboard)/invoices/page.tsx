import Link from "next/link";
import { CustomerInvoiceStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listCustomerInvoices } from "@/server/actions/customer-invoices";
import { auth } from "@/server/auth";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const [session, invoices] = await Promise.all([auth(), listCustomerInvoices()]);
  const role = session?.user?.role;
  const canCreate = role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTS;
  // Mark-paid is admin / manager only — accounts still records detailed
  // payments via the invoice detail form.
  const canMarkPaid = role === Role.ADMIN || role === Role.MANAGER;

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Tax invoices"
        description="Customer invoices, GST broken into CGST+SGST (intra-state) or IGST (inter-state). Generate from a delivered order or create a standalone ad-hoc invoice."
        actions={
          canCreate ? (
            <Link href="/invoices/new"><Button>New standalone invoice</Button></Link>
          ) : null
        }
      />
      {invoices.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No invoices yet. Generate one from a DELIVERED order, or create an ad-hoc invoice.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice no</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Order</TableHead>
              <TableHead className="text-right">Grand total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Status</TableHead>
              {canMarkPaid && <TableHead>Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => {
              const canMark =
                canMarkPaid &&
                inv.status !== CustomerInvoiceStatus.PAID &&
                inv.status !== CustomerInvoiceStatus.CANCELLED &&
                inv.status !== CustomerInvoiceStatus.DRAFT;
              // Inline list-row mark-paid removed in Phase 1 — full
              // capture (ref / method / date) needs the modal on the
              // detail page, so we link the operator there instead.
              return (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link href={`/invoices/${inv.id}`} className="font-mono text-brand hover:underline">
                      {inv.invoiceNo}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-[12px]">
                    {inv.issuedAt ? formatIST(inv.issuedAt, "yyyy-MM-dd") : formatIST(inv.createdAt, "yyyy-MM-dd")}
                  </TableCell>
                  <TableCell>{inv.customer.name}</TableCell>
                  <TableCell className="font-mono text-[12px]">{inv.order?.code ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(inv.grandTotal)}</TableCell>
                  <TableCell className="text-right font-mono">{formatINR(inv.amountPaid)}</TableCell>
                  <TableCell><StatusBadge status={inv.status} /></TableCell>
                  {canMarkPaid && (
                    <TableCell>
                      {canMark ? (
                        <Link href={`/invoices/${inv.id}`}>
                          <Button type="button" size="sm" variant="outline">
                            Mark paid…
                          </Button>
                        </Link>
                      ) : (
                        <span className="text-[12px] text-ik-ink-3">—</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
