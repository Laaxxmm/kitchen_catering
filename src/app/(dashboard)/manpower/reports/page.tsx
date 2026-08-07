import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { gateRolePage } from "@/server/rbac";
import { listManpowerRequestsInWindow } from "@/server/actions/manpower";
import { formatINR } from "@/lib/money";
import { formatIST } from "@/lib/time";
import { VIEW_ROLES } from "../_components/gates";
import { aggregateManpower, isMonthKey, monthWindow } from "./aggregate";

export const dynamic = "force-dynamic";

/**
 * "Recorded and generated as a report each month so we can see how much
 * manpower was arranged and for which order." The month comes from the
 * picker, never from a hardcoded "this month" — only the default does.
 */
export default async function ManpowerReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await gateRolePage(VIEW_ROLES);
  const sp = await searchParams;
  const month = isMonthKey(sp.month) ? sp.month : formatIST(new Date(), "yyyy-MM");
  const { from, to } = monthWindow(month);
  const report = aggregateManpower(await listManpowerRequestsInWindow(from, to));

  const monthLabel = formatIST(from, "MMMM yyyy");

  return (
    <>
      <PageHeader
        eyebrow="Manpower"
        title="Monthly report"
        description="How much hired labour was arranged, what it was estimated to cost, what it actually cost — and which order it belonged to."
        actions={<Link href="/manpower"><Button variant="outline" size="sm">← Back</Button></Link>}
      />

      <form className="mb-5 flex flex-wrap items-end gap-2" action="/manpower/reports">
        <div className="grid gap-1">
          <label htmlFor="month" className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">Month</label>
          <input
            id="month"
            type="month"
            name="month"
            defaultValue={month}
            className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">Show</Button>
      </form>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Requests raised" value={String(report.raised)} note={`${report.arranged} arranged · ${report.rejected} turned down · ${report.cancelled} called off`} />
        <Stat label="People-days arranged" value={String(report.peopleDays)} note="On the approved figures" />
        <Stat label="Estimated spend" value={formatINR(report.estimate)} note="Approved estimate, all arranged requests" />
        <Stat
          label="Actual spend"
          value={report.actual === null ? "Not settled" : formatINR(report.actual)}
          note={
            report.actual === null
              ? "Nothing settled yet this month"
              : `${report.settled} of ${report.arranged} settled · ${
                  report.variance === null
                    ? ""
                    : `${report.overrun ? "over by " : "under by "}${formatINR(report.variance.abs())}`
                }`
          }
          alert={report.overrun}
        />
      </div>

      <section>
        <h2 className="mb-2 text-[12px] font-medium text-ik-ink-2">By order · {monthLabel}</h2>
        {report.byOrder.length === 0 ? (
          <p className="text-[12.5px] text-ik-ink-3">No manpower was arranged in this month.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">People-days</TableHead>
                <TableHead className="text-right">Estimate</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.byOrder.map((line) => (
                <TableRow key={line.key}>
                  <TableCell>
                    {line.orderId ? (
                      <Link href={`/orders/${line.orderId}`} className="font-mono text-[12.5px] text-brand hover:underline">
                        {line.label}
                      </Link>
                    ) : (
                      <span className="text-[12.5px] text-ik-ink-3">{line.label}</span>
                    )}
                    {line.customerName && (
                      <div className="text-[11px] text-ik-ink-3">{line.customerName}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12.5px]">{line.requests}</TableCell>
                  <TableCell className="text-right font-mono text-[12.5px]">{line.peopleDays}</TableCell>
                  <TableCell className="text-right font-mono text-[12.5px]">{formatINR(line.estimate)}</TableCell>
                  <TableCell className="text-right font-mono text-[12.5px]">
                    {line.actual === null ? (
                      <span className="text-ik-ink-3">—</span>
                    ) : (
                      <>
                        {formatINR(line.actual)}
                        {line.settled < line.requests && (
                          <div className="text-[11px] text-ik-ink-3">{line.settled} of {line.requests} settled</div>
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell className={"text-right font-mono text-[12.5px] " + (line.overrun ? "text-alert" : "")}>
                    {line.variance === null ? (
                      <span className="text-ik-ink-3">—</span>
                    ) : (
                      <>
                        {line.overrun ? "+" : ""}{formatINR(line.variance)}
                        {line.overrun && <div className="text-[11px] text-alert">Overrun</div>}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, note, alert }: { label: string; value: string; note?: string; alert?: boolean }) {
  return (
    <div className="rounded-md border border-ik-rule bg-ik-card p-3">
      <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{label}</div>
      <div className={"mt-1 font-mono text-[20px] " + (alert ? "text-alert" : "")}>{value}</div>
      {note && <div className="text-[11px] text-ik-ink-3">{note}</div>}
    </div>
  );
}
