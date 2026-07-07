import Link from "next/link";
import { OrderStatus, Role } from "@prisma/client";
import { gateRolePage } from "@/server/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listOrders } from "@/server/actions/orders";
import { formatINR } from "@/lib/money";
import { formatIST, istScopeWindow, type EventDateScope } from "@/lib/time";
import { EventScopePills } from "@/components/ik/EventScopePills";

export const dynamic = "force-dynamic";

export default async function ChefApprovalsQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; date?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.KITCHEN_HEAD]);
  const sp = await searchParams;
  // Same ?scope=/?date= contract as the chef dashboard and /kitchen, but the
  // approvals queue defaults to ALL — hiding a pending approval by default
  // would silently stall the order.
  const scope: EventDateScope =
    sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
      ? "date"
      : sp.scope === "today" || sp.scope === "tomorrow" || sp.scope === "week"
        ? sp.scope
        : "all";
  const window = scope === "all" ? null : istScopeWindow(sp.scope, sp.date);
  const orders = await listOrders({
    status: [OrderStatus.PENDING_CHEF_APPROVAL],
    ...(window ? { eventFrom: window.from, eventToExclusive: window.toExclusive } : {}),
  });
  return (
    <>
      <PageHeader
        eyebrow="Queue · Chef"
        title="Awaiting chef approval"
        description="Orders submitted by front desk or manager. Approve to send the proforma to the customer, or suggest changes for the manager to review."
      />
      <div className="mb-4">
        <EventScopePills basePath="/queue/chef-approvals" scope={scope} date={sp.date} />
      </div>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
