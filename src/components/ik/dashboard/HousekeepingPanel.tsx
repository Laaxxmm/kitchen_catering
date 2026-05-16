import Link from "next/link";
import { housekeepingSummary } from "@/server/actions/housekeeping";

/**
 * Housekeeping-focused dashboard panel. Renders for HOUSEKEEPING_MANAGER
 * as their primary content and as a small overview for admin/manager on
 * the main dashboard when they also want a glance at hotel-side stock.
 */
export async function HousekeepingPanel({ compact = false }: { compact?: boolean }) {
  const s = await housekeepingSummary();

  return (
    <section className="rounded-md border border-ik-rule bg-ik-card">
      <header className="flex items-center justify-between border-b border-ik-rule p-3">
        <div className="text-[12px] font-medium text-ik-ink-2">
          Housekeeping{compact ? "" : " — today"}
        </div>
        <Link
          href="/housekeeping"
          className="text-[11px] text-ik-ink-3 hover:text-brand"
        >
          Module →
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-px bg-ik-rule sm:grid-cols-4">
        <KPI label="Items in catalog" value={s.itemCount} />
        <KPI label="Receipts (7d)" value={s.receiptsLastWeek} />
        <KPI label="Issues (7d)" value={s.issuesLastWeek} />
        <KPI
          label="Low-stock items"
          value={s.lowStock.length}
          alert={s.lowStock.length > 0}
        />
      </div>

      {!compact && (
        <div className="border-t border-ik-rule p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">
              Top consumed this week
            </div>
            <Link
              href="/housekeeping/reports"
              className="text-[11px] text-ik-ink-3 hover:text-brand"
            >
              All reports →
            </Link>
          </div>
          {s.topItemsThisWeek.length === 0 ? (
            <p className="text-[12.5px] text-ik-ink-3">
              No issues recorded in the last 7 days.
            </p>
          ) : (
            <ul className="grid gap-1.5 text-[12.5px]">
              {s.topItemsThisWeek.map((t) => (
                <li
                  key={t.itemId}
                  className="flex items-center justify-between gap-3"
                >
                  <span>{t.name}</span>
                  <span className="font-mono text-[11.5px]">
                    <span className="text-ik-ink">{t.consumed}</span>
                    <span className="text-ik-ink-3"> {t.unit}</span>
                  </span>
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
                <span>{i.name}</span>
                <span className="font-mono text-[11.5px]">
                  <span className="text-alert">{i.currentStock}</span>
                  <span className="text-ik-ink-3">
                    {" "}
                    / min {i.minStock} {i.unit}
                  </span>
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
  alert,
}: {
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div className="bg-ik-card p-3">
      <div className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{label}</div>
      <div
        className={
          "mt-1 font-mono text-[18px] " + (alert ? "text-alert" : "text-ik-ink")
        }
      >
        {value}
      </div>
    </div>
  );
}
