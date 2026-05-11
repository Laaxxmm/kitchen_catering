import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { listDeliveries } from "@/server/actions/deliveries";
import { formatIST } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function DeliveriesPage() {
  const deliveries = await listDeliveries();
  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Deliveries"
        description="Driver assignment, OTP-confirmed delivery, proof photos. Phase 1 logs OTP to server console; Phase 3 sends via SMS."
        actions={
          <Link href="/deliveries/new">
            <Button>Schedule delivery</Button>
          </Link>
        }
      />
      {deliveries.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No deliveries yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Delivery no</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Driver</TableHead>
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
                <TableCell>{d.driver?.name ?? "—"}</TableCell>
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
