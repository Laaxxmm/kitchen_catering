import Link from "next/link";
import { maintenanceSummary } from "@/server/actions/maintenance";

const CAT_LABEL: Record<string, string> = {
  ELECTRICAL: "Electrical",
  MECHANICAL: "Mechanical",
  GENERAL: "General",
};

/**
 * Maintenance-focused dashboard panel — mirrors HousekeepingPanel.
 * Used as the primary content for MAINTENANCE_MANAGER role and as an
 * overview tile for admin/manager.
 */
export async function MaintenancePanel({ compact = false }: { compact?: boolean }) {
  const s = await maintenanceSummary();

  return (
    <section className="rounded-md border border-ik-rule bg-ik-card">
      <header className="flex items-center justify-between border-b border-ik-rule p-3">
        <div className="text-[12px] font-medium text-ik-ink-2">
          Maintenance{compact ? "" : " — today"}
        </div>
        <Link href="/maintenance" className="text-[11px] text-ik-ink-3 hover:text-brand">
          Module →
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-px bg-ik-rule sm:grid-cols-5">
        <KPI label="Items" value={s.itemCount} />
        <KPI label="Receipts (7d)" value={s.receiptsLastWeek} />
        <KPI label="Activities (7d)" value={s.activitiesLastWeek} />
        <KPI label="Open" value={s.pendingActivities} highlight={s.pendingActivities > 0} />
        <KPI label="Low stock" value={s.lowStock.length} alert={s.lowStock.length > 0} />
      </div>

      {!compact && (
        <div className="border-t border-ik-rule p-3">
          <div className="mb-2 text-[10.5px] uppercase tracking-wide text-ik-ink-3">
            Activities this week — by category
          </div>
          {s.byCategoryThisWeek.length === 0 ? (
            <p className="text-[12.5px] text-ik-ink-3">No activities recorded this week.</p>
          ) : (
            <ul className="grid gap-1.5 text-[12.5px]">
              {s.byCategoryThisWeek.map((c) => (
                <li key={c.category} className="flex items-center justify-between gap-3">
                  <span>{CAT_LABEL[c.category]}</span>
                  <span className="font-mono">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {s.lowStock.length > 0 && !compact && (
        <div className="border-t border-ik-rule p-3">
          <div className="mb-2 text-[10.5px] uppercase tracking-wide text-alert">
            Low stock — at or below threshold
          </div>
          <ul className="grid gap-1.5 text-[12.5px]">
            {s.lowStock.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
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
        </div>
      )}
    </section>
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
    <div className="bg-ik-card p-3">
      <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{label}</div>
      <div
        className={
          "mt-1 font-mono text-[18px] " +
          (alert ? "text-alert" : highlight ? "text-brand-700" : "text-ik-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}
