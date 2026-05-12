import Link from "next/link";
import { OrderStatus, Role } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { auth } from "@/server/auth";
import { getDashboardSummary } from "@/server/actions/dashboard";
import { formatINR } from "@/lib/money";
import { STATUS_LABEL } from "@/lib/order-status";

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

      {summary.ar && (
        <section className="mt-6">
          <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Accounts receivable</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile eyebrow="Collected this month" value={formatINR(summary.ar.collectedThisMonth)} href="/payments" />
            <Tile eyebrow="Pending" value={formatINR(summary.ar.pending)} href="/payments/receivables" />
            <Tile eyebrow="Overdue" value={formatINR(summary.ar.overdue)} href="/payments/receivables?overdue=1" />
          </div>
        </section>
      )}

      {summary.stageCounts && (
        <section className="mt-6">
          <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Live orders by stage</h2>
          <div className="rounded-md border border-ik-rule bg-ik-card p-3">
            <ul className="grid gap-1 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(summary.stageCounts)
                .filter(([, count]) => count > 0)
                .map(([status, count]) => (
                  <li key={status} className="flex items-center justify-between border-b border-ik-rule py-1 last:border-b-0">
                    <Link
                      href={`/orders?status=${encodeURIComponent(status)}`}
                      className="text-ik-ink-2 hover:text-brand"
                    >
                      {STATUS_LABEL[status as OrderStatus] ?? status}
                    </Link>
                    <span className="font-mono text-ik-ink">{count}</span>
                  </li>
                ))}
              {Object.values(summary.stageCounts).every((c) => c === 0) && (
                <li className="text-ik-ink-3">No active orders.</li>
              )}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}
