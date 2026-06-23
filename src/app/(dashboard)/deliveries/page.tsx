import Link from "next/link";
import { DeliveryStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { auth } from "@/server/auth";
import { listDeliveries, listDeliveryCustomers } from "@/server/actions/deliveries";
import { formatIST, istToUtc, istMonthEnd } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS: DeliveryStatus[] = [
  DeliveryStatus.SCHEDULED,
  DeliveryStatus.DISPATCHED,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.DELIVERED,
  DeliveryStatus.FAILED,
  DeliveryStatus.CANCELLED,
];

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; month?: string; date?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const customerId = sp.customerId?.trim() || undefined;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : undefined;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : undefined;
  const status =
    sp.status && (STATUS_OPTIONS as string[]).includes(sp.status)
      ? (sp.status as DeliveryStatus)
      : undefined;

  // A specific date wins over a month. Both are IST clock dates converted
  // to UTC bounds so the stored UTC scheduledAt filters correctly.
  let from: Date | undefined;
  let to: Date | undefined;
  if (date) {
    from = istToUtc(`${date}T00:00:00`);
    to = istToUtc(`${date}T23:59:59`);
  } else if (month) {
    from = istToUtc(`${month}-01T00:00:00`);
    to = istMonthEnd(from);
  }

  const [session, deliveries, customers] = await Promise.all([
    auth(),
    listDeliveries({ customerId, from, to, status: status ? [status] : undefined }),
    listDeliveryCustomers(),
  ]);
  const role = session?.user?.role as Role | undefined;
  const canSchedule = role === Role.ADMIN || role === Role.MANAGER;
  const isDriver = role === Role.DELIVERY;
  const hasFilter = !!(customerId || date || month || status);

  const inputCls = "h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]";

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title={isDriver ? "My deliveries" : "Deliveries"}
        description={
          isDriver
            ? "Deliveries assigned to you. Filter by company, date, or month."
            : "Schedule, dispatch, and confirm deliveries. Filter by company, date, or month."
        }
        actions={
          canSchedule ? (
            <Link href="/deliveries/new">
              <Button>Schedule delivery</Button>
            </Link>
          ) : null
        }
      />

      {/* Filter bar — plain GET form so filters live in the URL (shareable,
          back-button friendly). Date beats month when both are set. */}
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-md border border-ik-rule bg-ik-paper-alt p-3">
        <label className="grid gap-1">
          <span className="text-[11px] text-ik-ink-3">Company</span>
          <select name="customerId" defaultValue={customerId ?? ""} className={inputCls + " min-w-[180px]"}>
            <option value="">All companies</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] text-ik-ink-3">Month</span>
          <input type="month" name="month" defaultValue={month ?? ""} className={inputCls} />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] text-ik-ink-3">Exact date</span>
          <input type="date" name="date" defaultValue={date ?? ""} className={inputCls} />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] text-ik-ink-3">Status</span>
          <select name="status" defaultValue={status ?? ""} className={inputCls}>
            <option value="">Any status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm">Apply</Button>
          {hasFilter && (
            <Link href="/deliveries">
              <Button type="button" size="sm" variant="outline">Clear</Button>
            </Link>
          )}
        </div>
      </form>

      {deliveries.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">
          {hasFilter
            ? "No deliveries match these filters."
            : isDriver
              ? "No deliveries assigned to you yet."
              : "No deliveries yet."}
        </p>
      ) : (
        <>
          <p className="mb-2 text-[11.5px] text-ik-ink-3">
            {deliveries.length} {deliveries.length === 1 ? "delivery" : "deliveries"}
          </p>
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
        </>
      )}
    </>
  );
}
