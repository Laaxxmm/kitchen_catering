import Link from "next/link";
import { ShoppingBag, ChefHat, Package, Receipt, Users, Truck, type LucideIcon } from "lucide-react";

type Tone = "default" | "amber" | "red";

export interface TaskTile {
  key: string;
  label: string;
  status: string;
  href: string;
  icon: string;
  tone?: Tone;
}

const ICONS: Record<string, LucideIcon> = {
  orders: ShoppingBag,
  kitchen: ChefHat,
  stock: Package,
  bills: Receipt,
  customers: Users,
  deliveries: Truck,
};

const STATUS_TONE: Record<Tone, string> = {
  default: "text-ik-ink-2",
  amber: "text-amber-700",
  red: "text-alert",
};

/**
 * The launcher's main grid — large tappable cards, one per section. Icon +
 * name + a single status line. 3 cols on desktop, 2 on tablet, 2 on mobile.
 * Strong colour is reserved for the status line (amber/red) only.
 */
export function TaskTiles({ tiles }: { tiles: TaskTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {tiles.map((t) => {
        const Icon = ICONS[t.icon] ?? ShoppingBag;
        return (
          <Link
            key={t.key}
            href={t.href}
            className="flex min-h-[96px] flex-col justify-between rounded-md border border-ik-rule bg-ik-card p-4 transition hover:border-brand-300 hover:shadow-sm"
          >
            <div className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                <Icon size={18} />
              </span>
              <span className="text-[14px] font-semibold text-ik-ink">{t.label}</span>
            </div>
            <div className={"mt-2 text-[12.5px] " + STATUS_TONE[t.tone ?? "default"]}>{t.status}</div>
          </Link>
        );
      })}
    </div>
  );
}
