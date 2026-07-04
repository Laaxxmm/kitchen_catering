import Link from "next/link";
import { OrderStatus, Role } from "@prisma/client";
import { gateRolePage } from "@/server/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listOrders } from "@/server/actions/orders";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function ManagerApprovalsQueuePage() {
  // Redirects wrong-role visits instead of letting a deeper role gate
  // throw into the RSC render (which shows the generic crash page).
  await gateRolePage([Role.ADMIN, Role.MANAGER]);
  const orders = await listOrders({
    status: [OrderStatus.CHANGES_PROPOSED_BY_CHEF],
  });
  return (
    <>
      <PageHeader
        eyebrow="Queue · Manager"
        title="Chef-suggested changes"
        description="Orders where the chef has proposed changes. Review the chef's note on each order detail page, then approve (proforma sends) or reject."
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
