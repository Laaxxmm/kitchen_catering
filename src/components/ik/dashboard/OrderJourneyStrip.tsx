import Link from "next/link";
import { OrderStatus } from "@prisma/client";

interface Props {
  /** Counts by OrderStatus from getDashboardSummary().stageCounts. */
  stageCounts: Record<string, number>;
  /** Status → true when an order has been sitting at that status past the
   *  per-stage threshold. Drives the amber "stuck" ring. */
  stageStuck?: Record<string, boolean> | null;
}

/**
 * Order Journey Strip — the centerpiece of the visual dashboard. Shows the
 * 8 happy-path stops from Draft through Invoiced as a horizontal flow,
 * with the live count of orders parked at each stop. Empty stops are
 * muted; active stops glow. Click any stop → filtered order list.
 *
 * The strip is pure SVG + Tailwind — no chart library. Horizontal scroll
 * on narrow screens so the chain never breaks across two lines.
 */

interface Stop {
  status: OrderStatus | OrderStatus[];
  label: string;
  icon: string; // emoji — readable, no asset pipeline needed
  href: string;
}

const STOPS: Stop[] = [
  { status: OrderStatus.DRAFT, label: "Draft", icon: "📝", href: "/orders?status=DRAFT" },
  { status: [OrderStatus.PENDING_CHEF_APPROVAL, OrderStatus.CHANGES_PROPOSED_BY_CHEF], label: "Chef review", icon: "👨‍🍳", href: "/queue/chef-approvals" },
  { status: [OrderStatus.CHEF_REQUISITION_PENDING, OrderStatus.ISSUING], label: "Ingredients", icon: "📦", href: "/queue/issuing" },
  { status: [OrderStatus.READY_FOR_PRODUCTION, OrderStatus.IN_PREP], label: "Cooking", icon: "🍳", href: "/kitchen" },
  { status: OrderStatus.READY, label: "Ready", icon: "🍱", href: "/orders?status=READY" },
  { status: OrderStatus.OUT_FOR_DELIVERY, label: "On the way", icon: "🛵", href: "/orders?status=OUT_FOR_DELIVERY" },
  { status: OrderStatus.DELIVERED, label: "Delivered", icon: "✅", href: "/orders?status=DELIVERED" },
  { status: OrderStatus.INVOICED, label: "Invoiced", icon: "🧾", href: "/orders?status=INVOICED" },
];

export function OrderJourneyStrip({ stageCounts, stageStuck }: Props) {
  // Resolve counts for each stop (may be union of multiple statuses).
  const counts = STOPS.map((s) => {
    const arr = Array.isArray(s.status) ? s.status : [s.status];
    return arr.reduce((sum, st) => sum + (stageCounts[st] ?? 0), 0);
  });
  // Stuck flag per stop — true when any underlying status is stuck.
  const stuckFlags = STOPS.map((s) => {
    if (!stageStuck) return false;
    const arr = Array.isArray(s.status) ? s.status : [s.status];
    return arr.some((st) => stageStuck[st]);
  });
  const totalActive = counts.reduce((s, c) => s + c, 0);
  // Earliest active stop = the one with the slowest order in the pipeline.
  // A stage is "truly done" only when this index is strictly to its
  // right; otherwise some order is still behind and that stage hasn't
  // happened yet for everyone.
  const firstActiveIndex = counts.findIndex((c) => c > 0);
  // List of active stages, used in the summary line below the strip when
  // work is spread across more than one stop.
  const activeStops = STOPS.map((s, i) => ({ stop: s, count: counts[i] })).filter((x) => x.count > 0);

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Live order map</h2>
        <span className="text-[11.5px] text-ik-ink-3">
          {totalActive} active order{totalActive === 1 ? "" : "s"} across the pipeline
        </span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <ol className="flex min-w-max items-start gap-0">
          {STOPS.map((s, i) => {
            const count = counts[i];
            const active = count > 0;
            const stuck = active && stuckFlags[i];
            // "Done" means *every* order has cleared this stage — i.e.
            // there's no active stop at or before this one. Stages
            // between two active stops are intentionally NOT marked
            // done, because the order parked behind hasn't passed
            // through them yet.
            const done =
              !active &&
              firstActiveIndex !== -1 &&
              i < firstActiveIndex;
            return (
              <li key={s.label} className="flex items-start">
                <Link
                  href={s.href}
                  className="group flex w-[110px] flex-col items-center text-center"
                  aria-label={
                    stuck
                      ? `${s.label}: ${count} orders — one or more stuck`
                      : `${s.label}: ${count} orders`
                  }
                  title={stuck ? "An order has been sitting here for too long" : undefined}
                >
                  <div
                    className={
                      "relative flex h-14 w-14 items-center justify-center rounded-full border-2 text-[22px] transition " +
                      (stuck
                        ? "border-amber bg-amber-wash ring-2 ring-amber/40 group-hover:bg-amber-wash"
                        : active
                          ? "border-brand-500 bg-brand-50 group-hover:bg-brand-100"
                          : done
                            ? "border-brand-500 bg-brand-500 text-white"
                            : "border-ik-rule bg-ik-paper-alt opacity-70 group-hover:opacity-100")
                    }
                  >
                    {done ? (
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12l4.5 4.5L19 7" />
                      </svg>
                    ) : (
                      <span aria-hidden>{s.icon}</span>
                    )}
                    {active && (
                      <span
                        className={
                          "absolute -right-1 -top-1 flex h-6 min-w-[24px] items-center justify-center rounded-full px-1 font-mono text-[11px] font-medium text-white " +
                          (stuck ? "bg-amber" : "bg-brand-500")
                        }
                      >
                        {count}
                      </span>
                    )}
                    {stuck && (
                      <span className="absolute -left-2 -bottom-1 rounded-full bg-amber px-1.5 py-0.5 text-[9px] font-medium text-white" title="Stuck">
                        ⚠
                      </span>
                    )}
                  </div>
                  <div
                    className={
                      "mt-2 text-[11.5px] " +
                      (stuck
                        ? "font-medium text-amber"
                        : active
                          ? "font-medium text-ik-ink"
                          : done
                            ? "text-brand-700"
                            : "text-ik-ink-3")
                    }
                  >
                    {s.label}
                  </div>
                </Link>
                {i < STOPS.length - 1 && (
                  <div
                    className={
                      "mt-7 h-[2px] w-6 " +
                      // Green only when the segment is behind every active
                      // stage — i.e. all orders have crossed it. Otherwise
                      // keep it muted so the visual doesn't lie.
                      (firstActiveIndex !== -1 && i < firstActiveIndex
                        ? "bg-brand-500"
                        : "bg-ik-rule")
                    }
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {/* Spread summary — only shown when work is at 2+ stops, so a
          single-stage pipeline doesn't get a redundant caption. */}
      {activeStops.length >= 2 ? (
        <p className="mt-2 text-[11.5px] text-ik-ink-2">
          Spread across:{" "}
          {activeStops.map((x, i) => (
            <span key={x.stop.label}>
              <span aria-hidden>{x.stop.icon}</span>{" "}
              <strong className="font-medium text-ik-ink">{x.count}</strong> {x.stop.label}
              {i < activeStops.length - 1 && <span className="text-ik-ink-3"> · </span>}
            </span>
          ))}
        </p>
      ) : (
        <p className="mt-2 text-[11.5px] text-ik-ink-3">
          Click any stop to see the orders parked there.
        </p>
      )}
    </section>
  );
}
