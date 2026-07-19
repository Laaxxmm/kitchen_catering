"use client";

import Link from "next/link";
import type { ChefRequisitionStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { CappedList } from "@/components/ik/dashboard/CappedList";
import { EventDateBadge } from "@/components/ik/EventDateBadge";
import { StatusBadge } from "@/components/ui/status-badge";

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

/**
 * The store's work queue as date-first cards (one per requisition): big
 * event date top-right so the soonest job can't be missed, and a single
 * "Open to issue" action. Order-linked requests sort by soonest event
 * (overdue floats to the top since its date is earliest); order-less
 * general requests, which have no deadline, follow newest-first.
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
    <CappedList items={sorted} limit={8} className="grid gap-3" keyOf={(r) => r.id}>
      {(r) => (
        <li key={r.id} className="rounded-md border border-ik-rule bg-ik-card p-4">
          <div className="flex justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/requisitions/${r.id}`}
                  className="font-mono text-[13px] text-brand hover:underline"
                >
                  {r.requisitionNo}
                </Link>
                <StatusBadge status={r.status} />
              </div>
              <div className="mt-1.5 text-[13.5px] text-ik-ink">
                {r.orderCode ? (
                  <>
                    <strong>{r.customerName}</strong>
                    <span className="text-ik-ink-3"> · order {r.orderCode}</span>
                  </>
                ) : (
                  <span className="text-ik-ink-2">General kitchen request</span>
                )}
              </div>
              <div className="mt-0.5 text-[12px] text-ik-ink-2">
                {r.lines} {r.lines === 1 ? "line" : "lines"} ·{" "}
                {r.status === "PARTIALLY_ISSUED" ? "part issued" : "to issue"}
              </div>
            </div>
            <div className="shrink-0">
              {r.eventDate ? (
                <EventDateBadge target={r.eventDate} />
              ) : (
                <EventDateBadge target={r.createdAt} mode="raised" />
              )}
            </div>
          </div>
          <div className="mt-3.5">
            <Link href={`/requisitions/${r.id}`}>
              <Button className="w-full">Open to issue</Button>
            </Link>
          </div>
        </li>
      )}
    </CappedList>
  );
}
