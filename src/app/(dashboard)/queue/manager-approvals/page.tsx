import Link from "next/link";
import { OrderStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listOrders } from "@/server/actions/orders";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ManagerApprovalsQueuePage() {
  const orders = await listOrders({
    status: [OrderStatus.PENDING_MANAGER_APPROVAL, OrderStatus.REJECTED_BY_STORE],
  });
  return (
    <>
      <PageHeader
        eyebrow="Queue · Manager"
        title="Awaiting manager approval"
        description="Two columns: store-approved (waiting on manager sign-off) and store-rejected (manager may override with a reason)."
      />
      {orders.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">Queue is clear.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Store note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell>
                  <Link href={`/orders/${o.id}`} className="font-mono text-brand hover:underline">{o.code}</Link>
                </TableCell>
                <TableCell>{o.customer.name}</TableCell>
                <TableCell className="font-mono text-[12px]">{formatIST(o.eventDate, "yyyy-MM-dd")}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(o.contractValue)}</TableCell>
                <TableCell><StatusBadge status={o.status} /></TableCell>
                <TableCell className="text-[12px] text-ik-ink-2">{/* storeApprovalNote not in light list — see detail page */}—</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
