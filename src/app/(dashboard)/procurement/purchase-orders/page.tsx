import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listVendorPOs } from "@/server/actions/procurement";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function VendorPOsPage() {
  const pos = await listVendorPOs();
  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Vendor POs"
        description="Approval by value: under ₹5,000 the Manager signs off; ₹5,000 and above needs Admin."
        actions={<Link href="/procurement/purchase-orders/new"><Button>New PO</Button></Link>}
      />
      {pos.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No POs yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO no</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pos.map((po) => (
              <TableRow key={po.id}>
                <TableCell><Link href={`/procurement/purchase-orders/${po.id}`} className="font-mono text-brand hover:underline">{po.poNo}</Link></TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(po.issueDate, "yyyy-MM-dd")}</TableCell>
                <TableCell>{po.vendor.name} <span className="text-ik-ink-3">· {po.vendor.code}</span></TableCell>
                <TableCell>{po.approvalTier}</TableCell>
                <TableCell className="text-right">{po._count.lines}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(po.grandTotal)}</TableCell>
                <TableCell><StatusBadge status={po.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
