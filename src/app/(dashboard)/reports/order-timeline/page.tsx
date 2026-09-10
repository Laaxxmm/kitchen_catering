import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SummaryStrip } from "@/components/ik/StatChips";
import { StatusPill } from "@/components/ik/StatusPill";
import { gateRolePage } from "@/server/rbac";
import { getOrderTimelines } from "@/server/reports/order-timeline";
import { elapsed } from "@/lib/order-timeline";
import { STATUS_LABEL } from "@/lib/order-status";
import { formatIST, istMonthEnd, istMonthStart, istToUtc } from "@/lib/time";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const t = (d: Date | null) => (d ? formatIST(d, "d MMM HH:mm") : "—");

/**
 * Who touched each order, and when — from the moment it was taken to the
 * moment it was delivered, with a verdict against the delivery time.
 */
export default async function OrderTimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.ACCOUNTS]);
  const sp = await searchParams;
  const now = new Date();
  const fromStr = sp.from && DATE_RE.test(sp.from) ? sp.from : formatIST(istMonthStart(now), "yyyy-MM-dd");
  const toStr = sp.to && DATE_RE.test(sp.to) ? sp.to : formatIST(istMonthEnd(now), "yyyy-MM-dd");
  const rows = await getOrderTimelines(istToUtc(fromStr), istToUtc(`${toStr}T23:59:59.999`));

  const onTime = rows.filter((r) => r.verdict.kind === "on-time").length;
  const late = rows.filter((r) => r.verdict.kind === "late").length;
  const pending = rows.filter((r) => r.verdict.kind === "pending" && !r.cancelled).length;
  const dl = `/api/export/order-timeline?from=${fromStr}&to=${toStr}`;

  return (
    <>
      <PageHeader
        eyebrow="Reports"
        title="Order timeline"
        description={`Every order with an event between ${fromStr} and ${toStr}: when it was taken, accepted, picked up by the kitchen, issued by the store, cooked, handed over, readied by F&B, and delivered. On time means delivered at or before the delivery window starts.`}
        actions={
          <div className="flex gap-2">
            <a href={dl} download><Button>Download Excel</Button></a>
            <Link href="/reports"><Button variant="outline">Back</Button></Link>
          </div>
        }
      />

      <form action="/reports/order-timeline" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="from" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">From</label>
          <input id="from" type="date" name="from" defaultValue={fromStr} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <div className="grid gap-1">
          <label htmlFor="to" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">To</label>
          <input id="to" type="date" name="to" defaultValue={toStr} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
        </div>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      <div className="mb-5">
        <SummaryStrip
          chips={[
            { label: "Orders", value: rows.length },
            { label: "Delivered on time", value: onTime, tone: "green" },
            { label: "Delivered late", value: late, tone: late > 0 ? "red" : "grey" },
            { label: "Not yet delivered", value: pending, tone: pending > 0 ? "amber" : "grey" },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-ik-ink-3">No orders with an event in this range.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Taken</TableHead>
                <TableHead>Accepted</TableHead>
                <TableHead>Kitchen took it</TableHead>
                <TableHead>Store issued</TableHead>
                <TableHead>Cooking started</TableHead>
                <TableHead>Cooked</TableHead>
                <TableHead>Handed over</TableHead>
                <TableHead>F&amp;B ready</TableHead>
                <TableHead>Manpower</TableHead>
                <TableHead>Delivered</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/orders/${r.id}`} className="font-mono text-[12px] text-brand hover:underline">{r.code}</Link>
                    <div className="text-[12px] text-ik-ink-2">{r.customer} · {r.headcount} pax</div>
                    <div className="text-[10.5px] text-ik-ink-3">{STATUS_LABEL[r.status]}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[12px]">
                    {formatIST(r.eventDate, "d MMM")}
                    <div className="text-ik-ink-3">deliver by {formatIST(r.deliveryWindowStart, "HH:mm")}</div>
                  </TableCell>
                  <Stamp at={r.taken} />
                  <Stamp at={r.accepted} since={r.taken} />
                  <Stamp at={r.kitchenTook} since={r.accepted} />
                  <TableCell className="whitespace-nowrap text-[12px]">
                    {t(r.storeIssuedFirst)}
                    {r.storeIssuedLast && r.storeIssuedFirst && r.storeIssuedLast.getTime() !== r.storeIssuedFirst.getTime() && (
                      <div className="text-ik-ink-3">to {t(r.storeIssuedLast)}</div>
                    )}
                  </TableCell>
                  <Stamp at={r.cookingStarted} since={r.storeIssuedLast ?? r.kitchenTook} />
                  <Stamp at={r.cooked} since={r.cookingStarted} />
                  <Stamp at={r.handedOver} since={r.cooked} />
                  <Stamp at={r.fnbReady} />
                  <TableCell className="whitespace-nowrap text-[12px]">
                    {r.manpowerRequested ? (
                      <>
                        {t(r.manpowerRequested)}
                        <div className="text-ik-ink-3">{r.manpowerApproved ? `ok ${t(r.manpowerApproved)}` : "awaiting approval"}</div>
                      </>
                    ) : (
                      <span className="text-ik-ink-3">none</span>
                    )}
                  </TableCell>
                  <Stamp at={r.delivered} since={r.dispatched} />
                  <TableCell className="whitespace-nowrap">
                    {r.cancelled ? (
                      <StatusPill tone="grey">Cancelled</StatusPill>
                    ) : r.verdict.kind === "on-time" ? (
                      <StatusPill tone="green">On time{r.verdict.earlyMinutes > 0 ? ` · ${r.verdict.earlyMinutes}m early` : ""}</StatusPill>
                    ) : r.verdict.kind === "late" ? (
                      <StatusPill tone="red">Late · {r.verdict.lateMinutes}m</StatusPill>
                    ) : (
                      <StatusPill tone="amber">Pending</StatusPill>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}

/** A stamp, with how long it took since the previous stage when known. */
function Stamp({ at, since }: { at: Date | null; since?: Date | null }) {
  return (
    <TableCell className="whitespace-nowrap text-[12px]">
      {t(at)}
      {at && since && <div className="text-ik-ink-3">{elapsed(since, at)} after</div>}
    </TableCell>
  );
}
