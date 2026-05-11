import Link from "next/link";
import { Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/server/auth";
import { getDashboardSummary } from "@/server/actions/dashboard";
import { formatINR } from "@/lib/money";

export const dynamic = "force-dynamic";

function Tile({ eyebrow, value, href }: { eyebrow: string; value: string | number; href?: string }) {
  const body = (
    <div className="rounded-md border border-ik-rule bg-ik-card p-4">
      <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">{eyebrow}</div>
      <div className="mt-1 font-mono text-[22px] text-ik-ink">{value}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

// Which KPI tiles each role sees. Keep tiles relevant to the role; the rest
// would just be noise / cause 403 on the linked page.
const TILE_VISIBILITY: Record<Role, ReadonlySet<"orders" | "deliveries" | "ar" | "lowstock">> = {
  ADMIN:        new Set(["orders", "deliveries", "ar", "lowstock"]),
  MANAGER:      new Set(["orders", "deliveries", "ar", "lowstock"]),
  SALES:        new Set(["orders"]),
  STORE_KEEPER: new Set(["orders", "lowstock"]),
  KITCHEN_HEAD: new Set(["orders", "lowstock"]),
  DELIVERY:     new Set(["deliveries"]),
  ACCOUNTS:     new Set(["orders", "ar"]),
};

export default async function DashboardPage() {
  const [session, summary] = await Promise.all([auth(), getDashboardSummary()]);
  const name = session?.user?.name ?? "there";
  const role = session?.user?.role as Role | undefined;
  const tiles = role ? TILE_VISIBILITY[role] : new Set<string>();

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={`Welcome, ${name}`}
        description="Snapshot of today's catering operations. Click any tile to drill in."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.has("orders") && (
          <Tile eyebrow="Today's orders" value={summary.todayOrders} href="/orders" />
        )}
        {tiles.has("deliveries") && (
          <Tile eyebrow="Today's deliveries" value={summary.todayDeliveries} href="/deliveries" />
        )}
        {tiles.has("ar") && (
          <Tile eyebrow="Outstanding AR" value={formatINR(summary.outstandingAR)} href="/payments/receivables" />
        )}
        {tiles.has("lowstock") && (
          <Tile eyebrow="Low stock" value={summary.lowStockCount} href="/inventory/ingredients?low=1" />
        )}
      </div>

      {summary.myQueue && (
        <section className="mt-6 max-w-2xl">
          <Link
            href={summary.myQueue.href}
            className="block rounded-md border border-brand-200 bg-brand-50 p-4 hover:border-brand-500"
          >
            <div className="text-[11px] uppercase tracking-[0.12em] text-brand-700">Pending my approval</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-mono text-[24px] font-medium text-brand-800">{summary.myQueue.count}</span>
              <span className="text-[14px] text-ik-ink-2">{summary.myQueue.label}</span>
            </div>
          </Link>
        </section>
      )}
    </>
  );
}
