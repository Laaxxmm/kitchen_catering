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
  activitiesByCategory,
  activitiesByRoom,
  activitiesByStaff,
  maintenanceConsumptionByItem,
  type MaintenancePeriod,
} from "@/server/actions/maintenance";

export const dynamic = "force-dynamic";

const PERIODS: { key: MaintenancePeriod; label: string }[] = [
  { key: "WEEK", label: "Last 7 days" },
  { key: "MONTH", label: "Last 30 days" },
  { key: "QUARTER", label: "Last 90 days" },
  { key: "CUSTOM", label: "Custom range" },
];

const CAT_LABEL: Record<string, string> = {
  ELECTRICAL: "Electrical",
  MECHANICAL: "Mechanical",
  GENERAL: "General",
};

export default async function MaintenanceReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER]);
  const sp = await searchParams;
  const period: MaintenancePeriod =
    (PERIODS.find((p) => p.key === sp.period)?.key as MaintenancePeriod | undefined) ?? "WEEK";

  const [byCategory, byItem, byRoom, byStaff] = await Promise.all([
    activitiesByCategory(period, { from: sp.from, to: sp.to }),
    maintenanceConsumptionByItem(period, { from: sp.from, to: sp.to }),
    activitiesByRoom(period, { from: sp.from, to: sp.to }),
    activitiesByStaff(period, { from: sp.from, to: sp.to }),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Maintenance"
        title="Reports"
        description="Activity volume + spares consumption — broken down by category, item, room and staff."
        actions={<Link href="/maintenance"><Button variant="outline" size="sm">← Back</Button></Link>}
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
        <form className="mb-4 flex flex-wrap items-end gap-2" action="/maintenance/reports">
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

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {byCategory.length === 0 ? (
          <p className="text-[12.5px] text-ik-ink-3">No activities in this period.</p>
        ) : (
          byCategory.map((c) => (
            <div key={c.category} className="rounded-md border border-ik-rule bg-ik-card p-3">
              <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{CAT_LABEL[c.category]}</div>
              <div className="mt-1 font-mono text-[22px]">{c.count}</div>
              <div className="text-[11px] text-ik-ink-3">activities</div>
            </div>
          ))
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section>
          <h2 className="mb-2 text-[12px] font-medium text-ik-ink-2">Spares consumed</h2>
          {byItem.length === 0 ? (
            <p className="text-[12.5px] text-ik-ink-3">Nothing consumed.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byItem.map((r) => (
                  <TableRow key={r.itemId}>
                    <TableCell className="text-[12.5px]">
                      {r.name}
                      <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{CAT_LABEL[r.category]}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12.5px]">
                      {r.consumed} <span className="text-ik-ink-3">{r.unit}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12px] text-ik-ink-3">{r.currentStock}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-[12px] font-medium text-ik-ink-2">By room</h2>
          {byRoom.length === 0 ? (
            <p className="text-[12.5px] text-ik-ink-3">No activities.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead className="text-right">Activities</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byRoom.map((r) => (
                  <TableRow key={r.roomId}>
                    <TableCell className="text-[12.5px]">
                      <span className="font-mono">{r.roomNumber}</span>
                      {r.roomName && <span className="text-ik-ink-3"> — {r.roomName}</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12.5px]">{r.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-[12px] font-medium text-ik-ink-2">By staff</h2>
          {byStaff.length === 0 ? (
            <p className="text-[12.5px] text-ik-ink-3">No activities.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Activities</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byStaff.map((r) => (
                  <TableRow key={r.staffId}>
                    <TableCell className="text-[12.5px]">
                      {r.staffName}
                      <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{CAT_LABEL[r.category]}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[12.5px]">{r.count}</TableCell>
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
  return `/maintenance/reports${q ? `?${q}` : ""}`;
}
