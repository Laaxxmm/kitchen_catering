import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listCustomerInvoices } from "@/server/actions/customer-invoices";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const invoices = await listCustomerInvoices();
  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Tax invoices"
        description="Customer invoices, GST broken into CGST+SGST (intra-state) or IGST (inter-state). E-invoice IRN is Phase 3."
      />
      {invoices.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No invoices yet. Generate one from a DELIVERED order.</p>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((inv) => (
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
