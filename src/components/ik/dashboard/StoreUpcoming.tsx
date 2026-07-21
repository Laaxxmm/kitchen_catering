"use client";

import Link from "next/link";
import type { OrderChannel, OrderStatus } from "@prisma/client";
import { CappedList } from "@/components/ik/dashboard/CappedList";
import { EventDateBadge } from "@/components/ik/EventDateBadge";
import { STATUS_LABEL } from "@/lib/order-status";

export interface UpcomingStoreOrder {
  id: string;
  code: string;
  channel: OrderChannel;
  status: OrderStatus;
  headcount: number;
  eventDate: string;
  customerName: string;
  /** Chef has already raised a (live) requisition against this order. */
  requisitionRaised: boolean;
}

// Same labels as the other work-screens (each board inlines its own map).
const CHANNEL_LABEL: Record<OrderChannel, string> = {
  BANQUET: "Banquet",
  BUFFET: "Buffet",
  ODC: "ODC",
  PACKET: "Packed food",
  COUNTER_SALE: "Counter sale",
  ROOM_SERVICE: "Room service",
  ALACARTE: "À la carte",
  MANAGEMENT: "Management",
};

/**
 * #5: read-only forward view for the store keeper — confirmed catering orders
 * they'll need to stock for, date-first (EventDateBadge) and capped. Each card
 * opens the order; the requisition hint tells them what's already in their
 * queue vs. still coming. The Today / This week / All / date scope pills live
 * in the store dashboard branch and drive the window server-side.
 */
export function StoreUpcoming({ orders }: { orders: UpcomingStoreOrder[] }) {
  if (orders.length === 0) {
    return (
      <p className="text-[12.5px] text-ik-ink-3">
        No confirmed orders to stock for in this window.
      </p>
    );
  }
  return (
    <CappedList items={orders} className="grid gap-3 sm:grid-cols-2" keyOf={(o) => o.id}>
      {(o) => (
        <li className="relative overflow-hidden rounded-lg border border-ik-rule bg-ik-card transition hover:shadow-[0_3px_18px_rgba(20,25,20,0.07)]">
          <Link href={`/orders/${o.id}`} className="flex h-full flex-col gap-2.5 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[12.5px] text-brand-700">{o.code}</span>
                <span className="rounded-full bg-ik-paper-alt px-2 py-0.5 text-[10.5px] text-ik-ink-2 ring-1 ring-ik-rule">
                  {CHANNEL_LABEL[o.channel]}
                </span>
              </div>
              <EventDateBadge target={o.eventDate} />
            </div>
            <div className="border-t border-ik-rule pt-2">
              <div className="truncate text-[13px] font-medium text-ik-ink">{o.customerName}</div>
              <div className="mt-0.5 text-[12px] text-ik-ink-3">{o.headcount} pax</div>
            </div>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="rounded-full bg-amber-wash px-2 py-0.5 text-[10.5px] font-medium text-amber-700">
                {STATUS_LABEL[o.status]}
              </span>
              <span
                className={
                  "text-[11px] font-medium " +
                  (o.requisitionRaised ? "text-ik-ink-2" : "text-ik-ink-3")
                }
              >
                {o.requisitionRaised ? "requisition raised ✓" : "requisition not yet raised"}
              </span>
            </div>
          </Link>
        </li>
      )}
    </CappedList>
  );
}
