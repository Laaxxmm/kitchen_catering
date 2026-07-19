"use client";

import Link from "next/link";
import type { ChefRequisitionStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { CappedList } from "@/components/ik/dashboard/CappedList";
import { eventPriority } from "@/components/ik/EventDateBadge";
import { Countdown } from "@/components/ik/dashboard/Countdown";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatIST } from "@/lib/time";

export interface ReqCard {
  id: string;
  requisitionNo: string;
  status: ChefRequisitionStatus;
  /** null for a standalone (order-less) general kitchen request. */
  orderCode: string | null;
  /** order.customer.name, null when there's no order. */
  customerName: string | null;
  /** ISO event date, null for a general request. */
  eventDate: string | null;
  /** ISO createdAt — the "raised" date for a general request. */
  createdAt: string;
  lines: number;
}

/** Left accent + border keyed to urgency, so the whole queue reads at a
 *  glance without reading a word: red = late/now, amber = soon, quiet
 *  otherwise. `days === null` is an order-less general request (no deadline). */
function accent(days: number | null): { bar: string; border: string } {
  if (days === null) return { bar: "bg-ik-rule-strong", border: "border-ik-rule" };
  if (days <= 0) return { bar: "bg-alert", border: "border-alert/35" };
  if (days <= 3) return { bar: "bg-amber", border: "border-amber/45" };
  return { bar: "bg-ik-rule-strong", border: "border-ik-rule" };
}

/**
 * The store's work queue as a scannable card GRID (2–3 across), not a wall
 * of full-width rows. Each card leads with the DATE — big and bold — with a
 * colour-coded urgency rail so the soonest / overdue job is impossible to
 * miss, then the customer + line count, then one full-width "Open to issue"
 * action. Order-linked requests sort soonest-event first (overdue floats up
 * since its date is earliest); order-less general requests follow newest-first.
 */
export function RequisitionCards({ items }: { items: ReqCard[] }) {
  const linked = items
    .filter((r) => r.eventDate)
    .sort((a, b) => a.eventDate!.localeCompare(b.eventDate!));
  const general = items
    .filter((r) => !r.eventDate)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const sorted = [...linked, ...general];

  return (
    <CappedList
      items={sorted}
      limit={9}
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      keyOf={(r) => r.id}
    >
      {(r) => {
        const prio = r.eventDate ? eventPriority(r.eventDate) : null;
        const target = r.eventDate ?? r.createdAt;
        const a = accent(prio ? prio.days : null);
        return (
          <li
            key={r.id}
            className={
              "relative flex flex-col overflow-hidden rounded-lg border bg-ik-card transition " +
              "hover:shadow-[0_3px_18px_rgba(20,25,20,0.07)] " +
              a.border
            }
          >
            <span className={"absolute inset-y-0 left-0 w-1 " + a.bar} aria-hidden />

            <div className="flex h-full flex-col gap-3 p-4 pl-5">
              {/* req no + urgency */}
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/requisitions/${r.id}`}
                  className="font-mono text-[12px] text-ik-ink-3 transition hover:text-brand"
                >
                  {r.requisitionNo}
                </Link>
                {prio ? (
                  <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide " + prio.cls}>
                    {prio.label}
                  </span>
                ) : (
                  <span className="rounded-full bg-ik-paper-alt px-2 py-0.5 text-[10px] font-bold tracking-wide text-ik-ink-2 ring-1 ring-ik-rule">
                    RAISED
                  </span>
                )}
              </div>

              {/* date hero */}
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[22px] font-bold leading-none tracking-tight text-ik-ink">
                    {formatIST(new Date(target), "EEE d MMM")}
                  </span>
                  <span className="text-[13.5px] font-semibold text-ik-ink-2">
                    {formatIST(new Date(target), "HH:mm")}
                  </span>
                </div>
                <div className="mt-1 text-[11.5px] font-medium">
                  {prio ? <Countdown target={target} /> : <span className="text-ik-ink-3">Raised</span>}
                </div>
              </div>

              {/* who / what */}
              <div className="border-t border-ik-rule pt-3">
                <StatusBadge status={r.status} />
                <div className="mt-1.5 truncate text-[13.5px] font-medium text-ik-ink">
                  {r.orderCode ? r.customerName : "General kitchen request"}
                </div>
                <div className="mt-0.5 text-[12px] text-ik-ink-3">
                  {r.orderCode ? <>order {r.orderCode} · </> : null}
                  {r.lines} {r.lines === 1 ? "line" : "lines"} ·{" "}
                  {r.status === "PARTIALLY_ISSUED" ? "part issued" : "to issue"}
                </div>
              </div>

              {/* action */}
              <Link
                href={`/requisitions/${r.id}`}
                className="mt-auto"
                aria-label={`Open ${r.requisitionNo} to issue`}
              >
                <Button className="h-11 w-full">Open to issue →</Button>
              </Link>
            </div>
          </li>
        );
      }}
    </CappedList>
  );
}
