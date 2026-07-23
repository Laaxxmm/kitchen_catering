export type SegTone = "approval" | "production" | "done" | "low" | "neutral";

/** Bar-fill + legend-dot colour per segment tone. Static strings so
 *  Tailwind's JIT keeps them. */
export const SEG: Record<SegTone, { bar: string; dot: string; text: string }> = {
  approval: { bar: "bg-amber", dot: "bg-amber", text: "text-amber-700" },
  production: { bar: "bg-info", dot: "bg-info", text: "text-info" },
  done: { bar: "bg-brand-500", dot: "bg-brand-500", text: "text-brand-700" },
  low: { bar: "bg-alert", dot: "bg-alert", text: "text-alert" },
  neutral: { bar: "bg-ik-rule-strong", dot: "bg-ik-rule-strong", text: "text-ik-ink-2" },
};

export interface Segment {
  label: string;
  value: number;
  tone: SegTone;
}

/** One split bar: segments sized by share; tiny non-zero slices still show. */
export function SplitBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-ik-paper-alt" role="presentation">
      {total === 0
        ? null
        : segments.map((s) =>
            s.value === 0 ? null : (
              <span
                key={s.label}
                className={SEG[s.tone].bar}
                style={{ width: `${Math.max((s.value / total) * 100, 4)}%` }}
              />
            ),
          )}
    </div>
  );
}

/** Split bar + a legend row that counts each segment. The shared "big number
 *  + split bar" language used on the launcher KPI cards and the role boards. */
export function SplitBarWithLegend({ segments }: { segments: Segment[] }) {
  return (
    <div className="flex flex-col gap-2">
      <SplitBar segments={segments} />
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s) => (
          <div key={s.label} className="flex items-baseline gap-1.5">
            <span className={"h-2 w-2 shrink-0 translate-y-[-1px] rounded-full " + SEG[s.tone].dot} />
            <span className="text-[16px] font-bold text-ik-ink tabular-nums">{s.value}</span>
            <span className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
