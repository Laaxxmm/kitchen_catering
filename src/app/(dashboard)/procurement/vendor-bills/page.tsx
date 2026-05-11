import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listVendorBills } from "@/server/actions/procurement";
import { formatINR } from "@/lib/money";


export const dynamic = "force-dynamic";

export default async function VendorBillsPage() {
  const bills = await listVendorBills();
  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Vendor bills"
        description="3-way match: bill ↔ PO ↔ GRN. Tolerances: ±0.5% price, ±₹1 tax."
        actions={<Link href="/procurement/vendor-bills/new"><Button>New bill</Button></Link>}
      />
      {bills.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No vendor bills yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill no</TableHead>
              <TableHead>Vendor bill #</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>PO</TableHead>
              <TableHead className="text-right">Grand total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.map((b) => (
              <TableRow key={b.id}>
                <TableCell><Link href={`/procurement/vendor-bills/${b.id}`} className="font-mono text-brand hover:underline">{b.billNo}</Link></TableCell>
                <TableCell className="font-mono text-[12px]">{b.vendorBillNo ?? "—"}</TableCell>
                <TableCell>{b.vendor.name}</TableCell>
                <TableCell className="font-mono text-[12px]">{b.po?.poNo ?? "—"}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(b.grandTotal)}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(b.amountPaid)}</TableCell>
                <TableCell><StatusBadge status={b.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
