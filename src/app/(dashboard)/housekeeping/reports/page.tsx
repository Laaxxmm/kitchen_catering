import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { gateRolePage } from "@/server/rbac";
import {
  consumptionByItem,
  consumptionByRoom,
  consumptionByStaff,
  type ReportPeriod,
} from "@/server/actions/housekeeping";

export const dynamic = "force-dynamic";

const PERIODS: { key: ReportPeriod; label: string }[] = [
  { key: "WEEK", label: "Last 7 days" },
  { key: "MONTH", label: "Last 30 days" },
  { key: "QUARTER", label: "Last 90 days" },
  { key: "CUSTOM", label: "Custom range" },
];

export default async function HousekeepingReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.HOUSEKEEPING_MANAGER]);
  const sp = await searchParams;
  const period: ReportPeriod =
    (PERIODS.find((p) => p.key === sp.period)?.key as ReportPeriod | undefined) ??
    "WEEK";

  const [byItem, byRoom, byStaff] = await Promise.all([
    consumptionByItem(period, { from: sp.from, to: sp.to }),
    consumptionByRoom(period, { from: sp.from, to: sp.to }),
    consumptionByStaff(period, { from: sp.from, to: sp.to }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Housekeeping"
        title="Consumption reports"
        description="What's been issued, broken down by item, room and staff."
        actions={
          <Link href="/housekeeping">
            <Button variant="outline" size="sm">← Back</Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={buildHref({
              period: p.key,
              from: p.key === "CUSTOM" ? sp.from : undefined,
              to: p.key === "CUSTOM" ? sp.to : undefined,
            })}
            className={
              "rounded-full px-3 py-1 text-[12px] " +
              (period === p.key
                ? "bg-brand-500 text-white"
                : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
            }
          >
            {p.label}
          </Link>
        ))}
      </div>

      {period === "CUSTOM" && (
        <form className="mb-4 flex flex-wrap items-end gap-2" action="/housekeeping/reports">
          <input type="hidden" name="period" value="CUSTOM" />
          <div className="grid gap-1">
            <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">From</label>
            <input type="date" name="from" defaultValue={sp.from ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
          </div>
          <div className="grid gap-1">
            <label className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">To</label>
            <input type="date" name="to" defaultValue={sp.to ?? ""} className="h-9 rounded-md border border-ik-rule bg-ik-card px-2 text-[12.5px]" />
          </div>
          <Button type="submit" variant="outline" size="sm">Apply</Button>
        </form>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <section>
          <h2 className="mb-2 text-[12px] font-medium text-ik-ink-2">By item</h2>
          {byItem.length === 0 ? (
            <p className="text-[12.5px] text-ik-ink-3">No issues in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Consumed</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byItem.map((r) => (
                  <TableRow key={r.itemId}>
                    <TableCell className="text-[12.5px]">{r.name}</TableCell>
                    <TableCell className="text-right font-mono text-[12.5px]">
                      {r.consumed} <span className="text-ik-ink-3">{r.unit}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] text-ik-ink-3">
                      {r.currentStock}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-[12px] font-medium text-ik-ink-2">By room</h2>
          {byRoom.length === 0 ? (
            <p className="text-[12.5px] text-ik-ink-3">No issues in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead className="text-right">Total units</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byRoom.map((r) => (
                  <TableRow key={r.roomId}>
                    <TableCell className="text-[12.5px]">
                      <span className="font-mono">{r.roomNumber}</span>
                      {r.roomName && <span className="text-ik-ink-3"> — {r.roomName}</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12.5px]">
                      {r.totalUnits}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-[12px] font-medium text-ik-ink-2">By staff</h2>
          {byStaff.length === 0 ? (
            <p className="text-[12.5px] text-ik-ink-3">No issues in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Trips</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byStaff.map((r) => (
                  <TableRow key={r.staffId}>
                    <TableCell className="text-[12.5px]">{r.staffName}</TableCell>
                    <TableCell className="text-right font-mono text-[12.5px]">
                      {r.trips}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12.5px]">
                      {r.totalUnits}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
    </>
  );
}

function buildHref(sp: { period?: string; from?: string; to?: string }) {
  const params = new URLSearchParams();
  if (sp.period) params.set("period", sp.period);
  if (sp.from) params.set("from", sp.from);
  if (sp.to) params.set("to", sp.to);
  const q = params.toString();
  return `/housekeeping/reports${q ? `?${q}` : ""}`;
}
