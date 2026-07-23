import Link from "next/link";
import { ShoppingBag, ChefHat, Package, Receipt, Users, Truck, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  orders: ShoppingBag,
  kitchen: ChefHat,
  stock: Package,
  bills: Receipt,
  customers: Users,
  deliveries: Truck,
};

export type SegTone = "approval" | "production" | "done" | "low" | "neutral";

/** Bar-fill + legend-dot colour per segment tone. Kept as static class
 *  strings so Tailwind's JIT sees them. */
const SEG: Record<SegTone, { bar: string; dot: string; text: string }> = {
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

export interface KpiCardData {
  key: string;
  icon: string;
  label: string;
  href: string;
  /** The one big figure. Omit for a plain nav tile (e.g. Customers). */
  hero?: number | string;
  /** Small line under the hero (e.g. "due", "waiting on stock"). */
  heroSub?: string;
  /** Tone for heroSub when it's a status, not a plain unit. */
  heroTone?: "amber" | "red" | "muted";
  /** When present, renders a single split bar + a legend with each count. */
  segments?: Segment[];
}

const HERO_SUB_TONE = {
  amber: "text-amber-700",
  red: "text-alert",
  muted: "text-ik-ink-3",
} as const;

/** One split bar: segments sized by share, tiny non-zero slices still show. */
function SplitBar({ segments }: { segments: Segment[] }) {
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

/**
 * Launcher KPI card: a big hero figure and either a single status line or a
 * three-way split bar with each category counted beneath it. The number is
 * the loudest thing on the card so the manager reads the state from across
 * the room; the bar shows the shape of the pipeline at a glance.
 */
export function KpiCard({ data }: { data: KpiCardData }) {
  const Icon = ICONS[data.icon] ?? ShoppingBag;
  return (
    <Link
      href={data.href}
      className="flex flex-col gap-3 rounded-2xl border border-ik-rule bg-ik-card p-5 transition hover:border-brand-300 hover:shadow-[0_4px_20px_rgba(20,25,20,0.06)]"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
          <Icon size={16} />
        </span>
        <span className="text-[13.5px] font-semibold text-ik-ink">{data.label}</span>
      </div>

      <div>
        {data.hero !== undefined && (
          <div className="text-[38px] font-bold leading-none tracking-tight text-ik-ink tabular-nums">
            {data.hero}
          </div>
        )}
        {data.heroSub && (
          <div
            className={
              (data.hero !== undefined ? "mt-1.5 " : "") +
              "text-[12.5px] font-medium " +
              HERO_SUB_TONE[data.heroTone ?? "muted"]
            }
          >
            {data.heroSub}
          </div>
        )}
      </div>

      {data.segments && (
        <div className="mt-auto flex flex-col gap-2">
          <SplitBar segments={data.segments} />
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {data.segments.map((s) => (
              <div key={s.label} className="flex items-baseline gap-1.5">
                <span className={"h-2 w-2 shrink-0 translate-y-[-1px] rounded-full " + SEG[s.tone].dot} />
                <span className="text-[16px] font-bold text-ik-ink tabular-nums">{s.value}</span>
                <span className="text-[10.5px] uppercase tracking-wide text-ik-ink-3">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Link>
  );
}
