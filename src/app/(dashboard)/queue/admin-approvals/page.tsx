import Link from "next/link";
import { OrderStatus, Role } from "@prisma/client";
import { gateRolePage } from "@/server/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listOrders } from "@/server/actions/orders";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AdminApprovalsQueuePage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER]);
  const orders = await listOrders({ status: [OrderStatus.PENDING_ADMIN_APPROVAL] });
  return (
    <>
      <PageHeader
        eyebrow="Queue · Manager"
        title="Orders awaiting your approval"
        description="Every new catering order needs an explicit manager sign-off before the chef sees it. Approve or reject from each order's detail page."
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
              <TableHead className="text-right">Headcount</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Raised by</TableHead>
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
                <TableCell className="text-right">{o.headcount}</TableCell>
                <TableCell className="text-right font-mono">{formatINR(o.contractValue)}</TableCell>
                <TableCell className="text-[12.5px] text-ik-ink-2">—</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
