import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { gateRolePage } from "@/server/rbac";
import { maintenanceSummary } from "@/server/actions/maintenance";

export const dynamic = "force-dynamic";

const CAT_LABEL: Record<string, string> = {
  ELECTRICAL: "Electrical",
  MECHANICAL: "Mechanical",
  GENERAL: "General",
};

export default async function MaintenanceLandingPage() {
  await gateRolePage([Role.ADMIN, Role.MANAGER, Role.MAINTENANCE_MANAGER]);
  const s = await maintenanceSummary();

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Maintenance"
        description="Electrical + mechanical work at rooms, plus spares inventory (switches, pipes, bulbs, washers …). Reuses the same room directory as housekeeping."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/maintenance/activities/new"><Button>Log activity</Button></Link>
            <Link href="/maintenance/receipts/new"><Button variant="outline">Record receipt</Button></Link>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-5">
        <KPI label="Items in catalog" value={s.itemCount} />
        <KPI label="Receipts this week" value={s.receiptsLastWeek} />
        <KPI label="Activities this week" value={s.activitiesLastWeek} />
        <KPI label="Pending / in progress" value={s.pendingActivities} highlight={s.pendingActivities > 0} />
        <KPI label="Low-stock items" value={s.lowStock.length} alert={s.lowStock.length > 0} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-md border border-ik-rule bg-ik-card">
          <header className="flex items-center justify-between border-b border-ik-rule p-3">
            <div className="text-[12px] font-medium text-ik-ink-2">
              Low stock (at or below threshold)
            </div>
            <Link href="/maintenance/items" className="text-[11px] text-ik-ink-3 hover:text-brand">All items →</Link>
          </header>
          {s.lowStock.length === 0 ? (
            <p className="p-4 text-[12.5px] text-ik-ink-3">Nothing flagged.</p>
          ) : (
            <ul className="divide-y divide-ik-rule">
              {s.lowStock.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 p-3 text-[12.5px]">
                  <span>
                    {i.name}{" "}
                    <span className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
                      {CAT_LABEL[i.category]}
                    </span>
                  </span>
                  <span className="font-mono text-[11.5px]">
                    <span className="text-alert">{i.currentStock}</span>
                    <span className="text-ik-ink-3"> / min {i.minStock} {i.unit}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-ik-rule bg-ik-card">
          <header className="flex items-center justify-between border-b border-ik-rule p-3">
            <div className="text-[12px] font-medium text-ik-ink-2">
              Activities this week — by category
            </div>
            <Link href="/maintenance/reports" className="text-[11px] text-ik-ink-3 hover:text-brand">Full reports →</Link>
          </header>
          {s.byCategoryThisWeek.length === 0 ? (
            <p className="p-4 text-[12.5px] text-ik-ink-3">No activities recorded this week.</p>
          ) : (
            <ul className="divide-y divide-ik-rule">
              {s.byCategoryThisWeek.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-3 p-3 text-[12.5px]">
                  <span>{CAT_LABEL[c.category]}</span>
                  <span className="font-mono">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-[12px]">
        <Link href="/maintenance/items" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Items</Link>
        <Link href="/maintenance/staff" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Staff</Link>
        <Link href="/maintenance/receipts" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Receipts</Link>
        <Link href="/maintenance/activities" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Activities</Link>
        <Link href="/maintenance/reports" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Reports</Link>
        <Link href="/housekeeping/rooms" className="rounded-md border border-ik-rule bg-ik-card px-3 py-2 hover:border-brand-200">Rooms (shared)</Link>
      </div>
    </>
  );
}

function KPI({
  label,
  value,
  highlight,
  alert,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  alert?: boolean;
}) {
  return (
    <div
      className={
        "rounded-md border p-3 " +
        (alert
          ? "border-alert/30 bg-alert/5"
          : highlight
            ? "border-brand-200 bg-brand-50"
            : "border-ik-rule bg-ik-card")
      }
    >
      <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{label}</div>
      <div
        className={
          "mt-1 font-mono text-[20px] " +
          (alert ? "text-alert" : highlight ? "text-brand-700" : "text-ik-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}
