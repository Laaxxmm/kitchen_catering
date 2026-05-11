import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listChefRequisitions } from "@/server/actions/chef-requisitions";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function RequisitionsPage() {
  const requisitions = await listChefRequisitions();
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Chef requisitions"
        description="Kitchen → store. Raised against approved orders; storekeeper fulfils each line from inventory (with optional send-to-procurement)."
      />
      {requisitions.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No requisitions yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Req no</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requisitions.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/requisitions/${r.id}`} className="font-mono text-brand hover:underline">{r.requisitionNo}</Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${r.orderId}`} className="font-mono text-brand hover:underline">{r.order.code}</Link>
                </TableCell>
                <TableCell>{r.order.customer.name}</TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(r.order.eventDate, "yyyy-MM-dd")}</TableCell>
                <TableCell className="text-right">{r._count.lines}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
