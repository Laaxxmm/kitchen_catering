import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { auth } from "@/server/auth";
import { listDeliveries } from "@/server/actions/deliveries";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DeliveriesPage() {
  const [session, deliveries] = await Promise.all([auth(), listDeliveries()]);
  const role = session?.user?.role as Role | undefined;
  const canSchedule = role === Role.ADMIN || role === Role.MANAGER;
  const isDriver = role === Role.DELIVERY;

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title={isDriver ? "My deliveries" : "Deliveries"}
        description={
          isDriver
            ? "Deliveries assigned to you. Tap a row to dispatch or confirm hand-over."
            : "Schedule, dispatch, and confirm deliveries. The driver taps Confirm at the customer's door — the tax invoice is auto-generated and emailed at that moment."
        }
        // Only the people who can actually use the scheduler see the
        // button. Drivers and other read-only roles get a clean view.
        actions={
          canSchedule ? (
            <Link href="/deliveries/new">
              <Button>Schedule delivery</Button>
            </Link>
          ) : null
        }
      />
      {deliveries.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          {isDriver ? "No deliveries assigned to you yet." : "No deliveries yet."}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Delivery no</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              {!isDriver && <TableHead>Driver</TableHead>}
              <TableHead>Scheduled</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <Link href={`/deliveries/${d.id}`} className="font-mono text-brand hover:underline">
                    {d.deliveryNo}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/orders/${d.orderId}`} className="font-mono text-brand hover:underline">
                    {d.order.code}
                  </Link>
                </TableCell>
                <TableCell>{d.order.customer.name}</TableCell>
                {!isDriver && <TableCell>{d.driver?.name ?? "—"}</TableCell>}
                <TableCell className="font-mono text-[12px]">{formatIST(d.scheduledAt, "yyyy-MM-dd HH:mm")}</TableCell>
                <TableCell><StatusBadge status={d.status} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
