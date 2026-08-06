import Link from "next/link";
import { ProductionJobItemStatus } from "@prisma/client";
import { PageHeader } from "@/components/ui/page-header";
import { listProductionJobs } from "@/server/actions/production-jobs";
import { getOrdersWaitingOnIngredients } from "@/server/actions/dashboard";
import {
  formatIST,
  istDayWindow,
  istScopeWindow,
  istWeekWindow,
  type EventDateScope,
} from "@/lib/time";
import { EventScopePills } from "@/components/ik/EventScopePills";
import { toDecimal } from "@/lib/money";
import { KitchenBoard } from "./_components/KitchenBoard";

export const dynamic = "force-dynamic";

/**
 * Kitchen board — a compact stage-count strip (Queued → Prep → Cooking →
 * Ready) over job cards grouped by stage, each with a per-stage primary
 * action. Replaces the old four-column kanban that showed three empty
 * "Nothing here" columns for a single job.
 */

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; date?: string }>;
}) {
  const sp = await searchParams;
  // ?date=YYYY-MM-DD wins over ?scope=; anything unrecognised = today.
  const scope: EventDateScope =
    sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
      ? "date"
      : sp.scope === "tomorrow" || sp.scope === "week" || sp.scope === "all"
        ? sp.scope
        : "today";
  const window = istScopeWindow(sp.scope, sp.date);
  // Fetch the scoped board plus the unscoped list (drives the pill counts).
  const [jobs, allJobs, waiting] = await Promise.all([
    window ? listProductionJobs({ window }) : listProductionJobs(),
    listProductionJobs(),
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

  // Pill counts so the chef knows where the load is without clicking
  // through — computed from the unscoped list with the same IST windows
  // the DB filter uses.
  const inWindow = (d: Date, w: { from: Date; toExclusive: Date }) =>
    d.getTime() >= w.from.getTime() && d.getTime() < w.toExclusive.getTime();
  const todayW = istDayWindow();
  const tomorrowW = istDayWindow(new Date(), 1);
  const weekW = istWeekWindow();
  const pillCounts = {
    today: allJobs.filter((j) => inWindow(j.order.eventDate, todayW)).length,
    tomorrow: allJobs.filter((j) => inWindow(j.order.eventDate, tomorrowW)).length,
    week: allJobs.filter((j) => inWindow(j.order.eventDate, weekW)).length,
    all: allJobs.length,
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

      {/* Event-date scope pills (IST day boundaries) */}
      <div className="mb-4">
        <EventScopePills basePath="/kitchen" scope={scope} date={sp.date} counts={pillCounts} />
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
        <div className="mb-5 rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4 text-[13px] text-ik-ink-2">
          <strong>All clear on the board.</strong> When orders move past the <em>issuing</em> stage they
          appear here automatically. Approve incoming orders on{" "}
          <Link href="/queue/chef-approvals" className="text-brand hover:underline">chef approvals</Link>,
          then raise an ingredient requisition from the order page.
        </div>
      )}

      {/* Compact stage strip + grouped job cards with per-stage actions. */}
      {!boardEmpty && (
        <KitchenBoard
          jobs={jobs.map((j) => ({
            id: j.id,
            orderId: j.orderId,
            status: j.status as "QUEUED" | "PREP" | "COOKING" | "READY",
            code: j.order.code,
            channel: j.order.channel,
            // Drives the "job finished but the order never advanced" warning.
            orderStatus: j.order.status,
            handedToDelivery: j.order.handedToDeliveryAt != null,
            customerName: j.order.customer.name,
            scheduledReady: j.scheduledReady.toISOString(),
            items: j.items.map((it) => ({
              id: it.id,
              dishName: it.dish.name,
              portions: it.portions.toString(),
              ready: it.status === ProductionJobItemStatus.READY,
              status: it.status,
              handedOverAt: it.handedOverAt ? it.handedOverAt.toISOString() : null,
              handedOverBy: it.handedOverBy?.name ?? null,
            })),
          }))}
        />
      )}
    </>
  );
}
