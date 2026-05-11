import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listGRNs } from "@/server/actions/procurement";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function GRNsPage() {
  const grns = await listGRNs();
  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Goods receipts (GRNs)"
        description="GRN posting atomically updates ingredient stock + moving-average cost. Create from an APPROVED/SENT PO."
      />
      {grns.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No GRNs yet. Open a vendor PO and click the Receive (GRN) button.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>GRN no</TableHead>
              <TableHead>Received</TableHead>
              <TableHead>PO</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grns.map((g) => (
              <TableRow key={g.id}>
                <TableCell><Link href={`/procurement/grns/${g.id}`} className="font-mono text-brand hover:underline">{g.grnNo}</Link></TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(g.receivedAt, "yyyy-MM-dd HH:mm")}</TableCell>
                <TableCell><Link href={`/procurement/purchase-orders/${g.poId}`} className="font-mono text-brand hover:underline">{g.po.poNo}</Link></TableCell>
                <TableCell>{g.po.vendor.name}</TableCell>
                <TableCell className="text-right">{g._count.lines}</TableCell>
                <TableCell><StatusBadge status={g.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
