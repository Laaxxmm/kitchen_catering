import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listPurchaseRequisitions } from "@/server/actions/purchase-requisitions";


export const dynamic = "force-dynamic";

export default async function PRsPage() {
  const prs = await listPurchaseRequisitions();
  return (
    <>
      <PageHeader
        eyebrow="Procurement"
        title="Purchase requisitions"
        description="Internal ingredient requests. Auto-created from chef requisition shortages; can also be raised manually."
        actions={<Link href="/procurement/purchase-requisitions/new"><Button>New PR</Button></Link>}
      />
      {prs.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No PRs yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PR no</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>From chef req</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prs.map((pr) => (
              <TableRow key={pr.id}>
                <TableCell>
                  <Link href={`/procurement/purchase-requisitions/${pr.id}`} className="font-mono text-brand hover:underline">{pr.prNo}</Link>
                </TableCell>
                <TableCell>{pr.requestedBy?.name ?? "—"}</TableCell>
                <TableCell className="font-mono text-[12px]">{pr.order?.code ?? "—"}</TableCell>
                <TableCell className="font-mono text-[12px]">{pr.chefRequisition?.requisitionNo ?? "—"}</TableCell>
                <TableCell className="text-right">{pr._count.lines}</TableCell>
                <TableCell><StatusBadge status={pr.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
