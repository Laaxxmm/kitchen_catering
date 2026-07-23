import { SplitBarWithLegend, type Segment } from "@/components/ik/dashboard/launcher/SplitBar";

/**
 * Role-board header: one big total figure and the same split-bar-with-legend
 * language used on the launcher KPI cards, so every role reads the shape of
 * their pipeline at a glance before the card list. Feeds off the arrays the
 * board already has — no extra queries.
 */
export function BoardHeader({
  total,
  unit,
  segments,
}: {
  total: number | string;
  unit: string;
  segments: Segment[];
}) {
  return (
    <div className="mb-4 rounded-2xl border border-ik-rule bg-ik-card p-5 shadow-ik-card">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex items-end gap-2.5">
          <span className="text-[42px] font-bold leading-none tracking-tight text-ik-ink tabular-nums">
            {total}
          </span>
          <span className="pb-1 text-[12.5px] font-medium text-ik-ink-3">{unit}</span>
        </div>
        <div className="min-w-[240px] flex-1">
          <SplitBarWithLegend segments={segments} />
        </div>
      </div>
    </div>
  );
}
