import Link from "next/link";
import { DeliveryStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/server/auth";
import { listDeliveries, listDeliveryCustomers } from "@/server/actions/deliveries";
import { formatIST, istToUtc, istMonthEnd } from "@/lib/time";
import { StatusPill, type PillTone } from "@/components/ik/StatusPill";

const STATUS_META: Record<DeliveryStatus, { label: string; tone: PillTone; active: boolean }> = {
  SCHEDULED: { label: "Scheduled", tone: "amber", active: true },
  DISPATCHED: { label: "Dispatched", tone: "amber", active: true },
  IN_TRANSIT: { label: "In transit", tone: "amber", active: true },
  DELIVERED: { label: "Delivered", tone: "green", active: false },
  FAILED: { label: "Failed", tone: "red", active: false },
  CANCELLED: { label: "Cancelled", tone: "grey", active: false },
};

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
        (() => {
          const inFlight = deliveries.filter((d) => STATUS_META[d.status].active);
          const done = deliveries.filter((d) => !STATUS_META[d.status].active);
          const section = (title: string, rows: typeof deliveries) =>
            rows.length === 0 ? null : (
              <section key={title}>
                <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{title} · {rows.length}</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Delivery</TableHead>
                      <TableHead>Customer</TableHead>
                      {!isDriver && <TableHead>Driver</TableHead>}
                      <TableHead>Scheduled</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((d) => {
                      const m = STATUS_META[d.status];
                      return (
                        <TableRow key={d.id}>
                          <TableCell>
                            <Link href={`/deliveries/${d.id}`} className="font-mono text-brand hover:underline">{d.deliveryNo}</Link>
                            <Link href={`/orders/${d.orderId}`} className="ml-2 font-mono text-[11px] text-ik-ink-3 hover:underline">{d.order.code}</Link>
                          </TableCell>
                          <TableCell>{d.order.customer.name}</TableCell>
                          {!isDriver && <TableCell>{d.driver?.name ?? "—"}</TableCell>}
                          <TableCell className="font-mono text-[12px]">{formatIST(d.scheduledAt, "yyyy-MM-dd HH:mm")}</TableCell>
                          <TableCell><StatusPill tone={m.tone}>{m.label}</StatusPill></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </section>
            );
          return <div className="grid gap-5">{section("In flight", inFlight)}{section("Delivered & closed", done)}</div>;
        })()
      )}
    </>
  );
}
