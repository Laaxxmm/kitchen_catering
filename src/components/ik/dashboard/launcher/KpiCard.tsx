import Link from "next/link";
import { ShoppingBag, ChefHat, Package, Receipt, Users, Truck, type LucideIcon } from "lucide-react";
import { SplitBarWithLegend, type Segment } from "./SplitBar";

const ICONS: Record<string, LucideIcon> = {
  orders: ShoppingBag,
  kitchen: ChefHat,
  stock: Package,
  bills: Receipt,
  customers: Users,
  deliveries: Truck,
};

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
        <div className="mt-auto">
          <SplitBarWithLegend segments={data.segments} />
        </div>
      )}
    </Link>
  );
}
