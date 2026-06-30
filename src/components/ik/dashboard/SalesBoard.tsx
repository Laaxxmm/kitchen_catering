"use client";

import { useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OrderChannel, OrderStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { WorkTabs } from "@/components/ik/dashboard/WorkTabs";
import { Countdown } from "@/components/ik/dashboard/Countdown";
import { formatIST } from "@/lib/time";
import { isNextNavigationError } from "@/lib/next-error";
import { submitOrder } from "@/server/actions/orders";

export interface SalesOrder {
  id: string;
  code: string;
  status: OrderStatus;
  channel: OrderChannel;
  customerName: string;
  eventDate: string;
}

const CHANNEL_LABEL: Record<OrderChannel, string> = {
  BANQUET: "Banquet",
  ODC: "ODC",
  PACKET: "Packed food",
  ROOM_SERVICE: "Room service",
  ALACARTE: "À la carte",
  MANAGEMENT: "Management",
};

// Once an order is delivered / invoiced / paid / done / cancelled, the
// event date is in the past and there's nothing left to chase — so we hide
// the countdown timer (an "Overdue 35d" badge on a Paid order is just
// noise). The timer only matters for orders still in flight.
const DONE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DELIVERED,
  OrderStatus.INVOICED,
  OrderStatus.PAID,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED_BY_ADMIN,
  OrderStatus.REJECTED_BY_MANAGER,
]);

const STATUS_LABEL: Partial<Record<OrderStatus, string>> = {
  DRAFT: "Draft — not submitted",
  PENDING_ADMIN_APPROVAL: "Waiting on manager approval",
  PENDING_CHEF_APPROVAL: "With the chef",
  CHANGES_PROPOSED_BY_CHEF: "Chef suggested changes",
  CHEF_REQUISITION_PENDING: "Chef raising ingredients",
  ISSUING: "Store issuing ingredients",
  READY_FOR_PRODUCTION: "Ready to cook",
  IN_PREP: "Cooking",
  READY: "Cooked — ready to dispatch",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  INVOICED: "Invoiced",
  PAID: "Paid",
  COMPLETED: "Completed",
};

const TABS = [
  { key: "draft", label: "Drafts", hint: "Submit to start", statuses: [OrderStatus.DRAFT] },
  {
    key: "review",
    label: "In review",
    hint: "Awaiting approval",
    statuses: [
      OrderStatus.PENDING_ADMIN_APPROVAL,
      OrderStatus.PENDING_CHEF_APPROVAL,
      OrderStatus.CHANGES_PROPOSED_BY_CHEF,
    ],
  },
  {
    key: "kitchen",
    label: "In kitchen",
    hint: "Cooking & prep",
    statuses: [
      OrderStatus.CHEF_REQUISITION_PENDING,
      OrderStatus.ISSUING,
      OrderStatus.READY_FOR_PRODUCTION,
      OrderStatus.IN_PREP,
      OrderStatus.READY,
    ],
  },
  {
    key: "out",
    label: "Out / done",
    hint: "Delivery & billing",
    statuses: [
      OrderStatus.OUT_FOR_DELIVERY,
      OrderStatus.DELIVERED,
      OrderStatus.INVOICED,
      OrderStatus.PAID,
      OrderStatus.COMPLETED,
    ],
  },
] as const;

export function SalesBoard({ orders }: { orders: SalesOrder[] }) {
  const groups = useMemo(() => {
    const map: Record<string, SalesOrder[]> = {};
    for (const t of TABS) {
      map[t.key] = orders
        .filter((o) => (t.statuses as readonly OrderStatus[]).includes(o.status))
        .sort((a, b) => new Date(a.eventDate).getTime() - new Date(b.eventDate).getTime());
    }
    return map;
  }, [orders]);

  const tabs = TABS.map((t) => ({ key: t.key, label: t.label, hint: t.hint, count: groups[t.key].length }));

  return (
    <WorkTabs tabs={tabs} emptyHint="Nothing in {tab} right now.">
      {(active) => (
        <ul className="grid gap-2.5">
          {groups[active].map((o, i) => (
            <SalesCard key={o.id} order={o} highlight={i === 0 && active === "draft"} />
          ))}
        </ul>
      )}
    </WorkTabs>
  );
}

function SalesCard({ order, highlight }: { order: SalesOrder; highlight: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isDraft = order.status === OrderStatus.DRAFT;

  function submit() {
    startTransition(async () => {
      try {
        await submitOrder(order.id);
        toast.success("Order submitted");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not submit");
      }
    });
  }

  return (
    <li className={"rounded-md border border-ik-rule bg-ik-card p-3" + (highlight ? " ring-2 ring-brand-500" : "")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[12.5px] text-brand-700">{order.code}</span>
          <span className="rounded-full bg-ik-paper-alt px-2 py-0.5 text-[10.5px] text-ik-ink-2 ring-1 ring-ik-rule">
            {CHANNEL_LABEL[order.channel]}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[11.5px] text-ik-ink-3">{formatIST(new Date(order.eventDate), "EEE d MMM HH:mm")}</span>
          {!DONE_STATUSES.has(order.status) && <Countdown target={order.eventDate} />}
        </div>
      </div>
      <div className="mt-1 text-[13px] text-ik-ink"><strong>{order.customerName}</strong></div>
      <div className="mt-0.5 text-[12px] text-ik-ink-2">{STATUS_LABEL[order.status] ?? order.status}</div>
      <div className="mt-2.5 flex items-center gap-2">
        {isDraft && (
          <Button size="sm" disabled={pending} onClick={submit}>Submit order</Button>
        )}
        <Link href={`/orders/${order.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Open</Link>
      </div>
    </li>
  );
}
