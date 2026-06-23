"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OrderChannel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { formatIST } from "@/lib/time";
import { isNextNavigationError } from "@/lib/next-error";
import { claimDelivery } from "@/server/actions/deliveries";

export interface PickupOrder {
  id: string;
  code: string;
  channel: OrderChannel;
  eventDate: string;
  roomNumber: string | null;
  deliveryAddress: string;
  customerName: string;
}

const CHANNEL_LABEL: Record<OrderChannel, string> = {
  BANQUET: "Banquet",
  ODC: "ODC",
  PACKET: "Packed food",
  ROOM_SERVICE: "Room service",
  ALACARTE: "À la carte",
  MANAGEMENT: "Management",
};

/**
 * Driver dashboard panel: orders the kitchen has cooked and handed off,
 * waiting for someone to take them out. One tap on "Take delivery" assigns
 * the order to this driver and it moves down into "My deliveries", where
 * they dispatch and confirm hand-over as normal.
 */
export function ReadyForPickup({ orders }: { orders: PickupOrder[] }) {
  if (orders.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">
        Ready for pickup
      </h2>
      <ul className="grid gap-2">
        {orders.map((o) => (
          <PickupCard key={o.id} order={o} />
        ))}
      </ul>
    </section>
  );
}

function PickupCard({ order }: { order: PickupOrder }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const where =
    order.roomNumber ? `Room ${order.roomNumber}` : null;

  function take() {
    startTransition(async () => {
      try {
        await claimDelivery(order.id);
        toast.success("Delivery is yours — see “My deliveries” below");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not take this delivery");
      }
    });
  }

  return (
    <li className="rounded-md border border-amber bg-amber-wash p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[12.5px] text-brand-700">{order.code}</span>
          <span className="rounded-full bg-ik-card px-2 py-0.5 text-[10.5px] text-ik-ink-2 ring-1 ring-ik-rule">
            {CHANNEL_LABEL[order.channel]}
          </span>
          {where && <span className="text-[11.5px] font-medium text-ik-ink">{where}</span>}
        </div>
        <span className="text-[11.5px] text-ik-ink-3">
          {formatIST(new Date(order.eventDate), "EEE d MMM HH:mm")}
        </span>
      </div>

      <div className="mt-1 text-[13px] text-ik-ink">
        <strong>{order.customerName}</strong>
      </div>
      <div className="mt-0.5 text-[12.5px] text-ik-ink-2">{order.deliveryAddress}</div>

      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={take}>
          Take delivery
        </Button>
        <Link href={`/orders/${order.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">
          Open
        </Link>
      </div>
    </li>
  );
}
