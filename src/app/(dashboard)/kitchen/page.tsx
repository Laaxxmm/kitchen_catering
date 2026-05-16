import Link from "next/link";
import { ProductionJobItemStatus, ProductionJobStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { listProductionJobs } from "@/server/actions/production-jobs";
import { getOrdersWaitingOnIngredients } from "@/server/actions/dashboard";
import { formatIST } from "@/lib/time";
import { toDecimal } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * Kitchen board — kanban-style view of every cooking job in the
 * selected time window. Columns mirror the ProductionJob state machine:
 * Queued → Prep → Cooking → Ready. Each card surfaces what the chef
 * needs at a glance — customer, dispatch time, dish count, portion
 * total, item-level progress, urgency.
 */

interface ColumnSpec {
  status: ProductionJobStatus;
  label: string;
  /** Header / left-rail accent colour for the column. */
  accent: string;
  /** Subheader explaining the column for a new chef. */
  hint: string;
}

const COLUMNS: ColumnSpec[] = [
  { status: ProductionJobStatus.QUEUED, label: "Queued", accent: "#516056", hint: "Issued, not yet started" },
  { status: ProductionJobStatus.PREP, label: "Prep", accent: "#BA7517", hint: "Mise en place" },
  { status: ProductionJobStatus.COOKING, label: "Cooking", accent: "#A32D2D", hint: "On the burner" },
  { status: ProductionJobStatus.READY, label: "Ready", accent: "#3B6D11", hint: "Plated, awaiting dispatch" },
];

/**
 * Human-friendly "time until ready-by" plus an urgency band. Anything
 * less than 2h to ready-by is red; less than 6h is amber; otherwise grey.
 */
function timing(d: Date): { label: string; tone: "overdue" | "urgent" | "soon" | "ok" } {
  const diffMs = d.getTime() - Date.now();
  if (diffMs < 0) {
    const lateMins = Math.floor(-diffMs / 60000);
    if (lateMins >= 60) return { label: `${Math.floor(lateMins / 60)}h late`, tone: "overdue" };
    return { label: `${lateMins}m late`, tone: "overdue" };
  }
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  const mins = Math.floor((diffMs % (60 * 60 * 1000)) / 60000);
  let label: string;
  if (hours >= 24) label = `${Math.floor(hours / 24)}d ${hours % 24}h`;
  else if (hours >= 1) label = `${hours}h ${mins}m`;
  else label = `${mins}m`;
  if (diffMs < 2 * 60 * 60 * 1000) return { label, tone: "urgent" };
  if (diffMs < 6 * 60 * 60 * 1000) return { label, tone: "soon" };
  return { label, tone: "ok" };
}

const TIMING_PILL: Record<"overdue" | "urgent" | "soon" | "ok", string> = {
  overdue: "bg-alert text-white",
  urgent: "bg-amber text-white",
  soon: "bg-amber-wash text-amber",
  ok: "bg-ik-paper-alt text-ik-ink-3",
};

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: "today" | "tomorrow" | "thisweek" }>;
}) {
  const sp = await searchParams;
  const win = sp.window ?? "today";
  const [jobs, waiting] = await Promise.all([
    listProductionJobs({ window: win }),
    getOrdersWaitingOnIngredients(8),
  ]);
  const boardEmpty = jobs.length === 0;

  // Aggregate stats for the header.
  const totalDishes = jobs.reduce((s, j) => s + j.items.length, 0);
  const totalPortions = jobs.reduce(
    (s, j) => s + j.items.reduce((acc, it) => acc + Number(it.portions), 0),
    0,
  );
  const earliestReady = jobs.length
    ? jobs.reduce((min, j) => (j.scheduledReady < min ? j.scheduledReady : min), jobs[0].scheduledReady)
    : null;

  // Window-tab counts so the chef knows where the load is without
  // clicking through.
  const [todayJobs, tomorrowJobs, weekJobs] = await Promise.all([
    listProductionJobs({ window: "today" }),
    listProductionJobs({ window: "tomorrow" }),
    listProductionJobs({ window: "thisweek" }),
  ]);
  const tabCounts: Record<"today" | "tomorrow" | "thisweek", number> = {
    today: todayJobs.length,
    tomorrow: tomorrowJobs.length,
    thisweek: weekJobs.length,
  };

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Kitchen board"
        description="Move each cooking job through Queued → Prep → Cooking → Ready. Tap a card to open the item-level checklist."
      />

      {/* Top summary bar */}
      {!boardEmpty && (
        <div className="mb-4 rounded-md border border-ik-rule bg-ik-card p-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[12.5px]">
            <span className="text-ik-ink-3">
              <strong className="text-ik-ink">{jobs.length}</strong> cooking job{jobs.length === 1 ? "" : "s"}
            </span>
            <span className="text-ik-ink-3">
              <strong className="text-ik-ink">{totalDishes}</strong> dish{totalDishes === 1 ? "" : "es"}
            </span>
            <span className="text-ik-ink-3">
              <strong className="text-ik-ink">{totalPortions}</strong> portion{totalPortions === 1 ? "" : "s"}
            </span>
            {earliestReady && (
              <span className="text-ik-ink-3">
                Next ready-by{" "}
                <strong className="font-mono text-ik-ink">{formatIST(earliestReady, "EEE HH:mm")}</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Window tabs */}
      <div className="mb-4 flex gap-2">
        {(["today", "tomorrow", "thisweek"] as const).map((w) => (
          <Link
            key={w}
            href={`/kitchen?window=${w}`}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] " +
              (win === w
                ? "bg-brand-500 text-white"
                : "bg-ik-paper-alt text-ik-ink-2 hover:bg-brand-50 hover:text-brand-700")
            }
          >
            {w === "thisweek" ? "This week" : w[0].toUpperCase() + w.slice(1)}
            <span
              className={
                "rounded-full px-1.5 text-[10.5px] " +
                (win === w ? "bg-white/20 text-white" : "bg-ik-rule text-ik-ink-3")
              }
            >
              {tabCounts[w]}
            </span>
          </Link>
        ))}
      </div>

      {boardEmpty && waiting.length > 0 && (
        <section className="mb-5 rounded-md border border-amber bg-amber-wash p-4">
          <h2 className="text-[14px] font-medium text-amber">Nothing to cook yet in this window</h2>
          <p className="mt-1 text-[12.5px] text-ik-ink-2">
            Cooking jobs appear here once the store finishes issuing ingredients. These orders are still
            waiting on stock — once everything is issued they&apos;ll land in the <strong>Queued</strong>{" "}
            column automatically.
          </p>
          <ul className="mt-3 grid gap-2 text-[12.5px]">
            {waiting.map((o) => {
              const lines = o.chefRequisitions.flatMap((r) => r.lines);
              return (
                <li key={o.id} className="rounded border border-ik-rule bg-ik-card p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/orders/${o.id}`} className="font-mono text-[12px] text-brand hover:underline">
                      {o.code}
                    </Link>
                    <span className="text-ik-ink-2">{o.customer.name}</span>
                    <span className="text-[11.5px] text-ik-ink-3">
                      Event {formatIST(o.eventDate, "EEE d MMM HH:mm")}
                    </span>
                  </div>
                  {lines.length > 0 ? (
                    <ul className="mt-2 grid gap-0.5 text-[11.5px] text-ik-ink-2">
                      {lines.slice(0, 4).map((l, i) => {
                        const remaining = toDecimal(l.requestedQty).minus(toDecimal(l.issuedQty));
                        return (
                          <li key={i}>
                            <span className="text-ik-ink-3">Still need:</span> {remaining.toString()}{" "}
                            {l.ingredient.unit} {l.ingredient.name}
                          </li>
                        );
                      })}
                      {lines.length > 4 && (
                        <li className="text-ik-ink-3">+ {lines.length - 4} more line{lines.length - 4 === 1 ? "" : "s"}…</li>
                      )}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[11.5px] text-ik-ink-3">
                      Requisition is still being prepared by the chef.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {boardEmpty && waiting.length === 0 && (
        <div className="mb-5 rounded-md border border-ik-rule bg-ik-card p-4 text-[13px] text-ik-ink-2">
          <strong>All clear on the board.</strong> When orders move past the <em>issuing</em> stage they
          appear here automatically. Approve incoming orders on{" "}
          <Link href="/queue/chef-approvals" className="text-brand hover:underline">chef approvals</Link>,
          then raise an ingredient requisition from the order page.
        </div>
      )}

      {/* Kanban columns */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const inCol = jobs.filter((j) => j.status === col.status);
          return (
            <section key={col.status} className="flex flex-col gap-2">
              <header
                className="rounded-md border-l-[3px] bg-ik-card px-3 py-2"
                style={{ borderLeftColor: col.accent }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[13px] text-ik-ink">{col.label}</span>
                  <span
                    className="rounded-full px-2 font-mono text-[11px]"
                    style={{ background: col.accent + "22", color: col.accent }}
                  >
                    {inCol.length}
                  </span>
                </div>
                <p className="mt-0.5 text-[10.5px] text-ik-ink-3">{col.hint}</p>
              </header>
              {inCol.length === 0 ? (
                <div className="rounded-md border border-dashed border-ik-rule bg-ik-paper-alt/40 px-3 py-6 text-center text-[11.5px] text-ik-ink-3">
                  Nothing here.
                </div>
              ) : (
                inCol.map((job) => {
                  const t = timing(job.scheduledReady);
                  const portionTotal = job.items.reduce((s, it) => s + Number(it.portions), 0);
                  const readyItems = job.items.filter((it) => it.status === ProductionJobItemStatus.READY).length;
                  return (
                    <Link
                      key={job.id}
                      href={`/kitchen/${job.id}`}
                      className="block rounded-md border border-ik-rule bg-ik-card p-3 transition hover:border-brand-300 hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-[13.5px] text-ik-ink">
                            {job.order.customer.name}
                          </div>
                          <div className="text-[11.5px] font-mono text-ik-ink-3">{job.order.code}</div>
                        </div>
                        <span
                          className={
                            "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium " + TIMING_PILL[t.tone]
                          }
                          title="Time to ready-by"
                        >
                          {t.label}
                        </span>
                      </div>
                      <div className="mt-2 text-[11.5px] text-ik-ink-2">
                        Ready by{" "}
                        <span className="font-mono text-ik-ink">
                          {formatIST(job.scheduledReady, "EEE HH:mm")}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-1 text-[11.5px] text-ik-ink-2">
                        {job.items.slice(0, 3).map((it) => (
                          <div key={it.id} className="flex items-baseline justify-between gap-2">
                            <span className="truncate">{it.dish.name}</span>
                            <span className="shrink-0 font-mono text-ik-ink-3">{it.portions.toString()}</span>
                          </div>
                        ))}
                        {job.items.length > 3 && (
                          <div className="text-[10.5px] text-ik-ink-3">+ {job.items.length - 3} more…</div>
                        )}
                      </div>
                      {/* Progress strip */}
                      <div className="mt-2 flex items-center gap-2 text-[10.5px] text-ik-ink-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ik-rule">
                          <div
                            className="h-full bg-brand-500 transition-all"
                            style={{
                              width:
                                job.items.length > 0
                                  ? `${(readyItems / job.items.length) * 100}%`
                                  : "0%",
                            }}
                          />
                        </div>
                        <span className="whitespace-nowrap">
                          {readyItems}/{job.items.length} ready
                        </span>
                      </div>
                      <div className="mt-1.5 text-[10.5px] text-ik-ink-3">
                        {portionTotal} portion{portionTotal === 1 ? "" : "s"} total
                      </div>
                    </Link>
                  );
                })
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
