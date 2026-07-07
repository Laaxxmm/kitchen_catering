"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DeliveryStatus, OrderChannel } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Countdown } from "@/components/ik/dashboard/Countdown";
import { formatIST } from "@/lib/time";
import { isNextNavigationError } from "@/lib/next-error";
import type { ActionResult } from "@/lib/action-result";
import {
  claimDelivery,
  dispatchDelivery,
  confirmDeliveryOTP,
  failDelivery,
} from "@/server/actions/deliveries";

export interface EventPrepOrder {
  id: string;
  code: string;
  channel: OrderChannel;
  headcount: number;
  eventDate: string;
  deliveryAddress: string;
  customerName: string;
  prepReadyAt: string | null;
  prepReadyBy: string | null;
}

export interface OrderLine {
  label: string;
  portions: string;
}

export interface PickupOrder {
  id: string;
  code: string;
  channel: OrderChannel;
  headcount: number;
  eventDate: string;
  roomNumber: string | null;
  deliveryAddress: string;
  customerName: string;
  items: OrderLine[];
}

export interface DriverDelivery {
  id: string;
  deliveryNo: string;
  status: DeliveryStatus;
  scheduledAt: string;
  orderCode: string;
  channel: OrderChannel;
  headcount: number;
  roomNumber: string | null;
  deliveryAddress: string;
  customerName: string;
  items: OrderLine[];
}

interface Props {
  eventPrep: EventPrepOrder[];
  pickups: PickupOrder[];
  deliveries: DriverDelivery[];
}

const CHANNEL_LABEL: Record<OrderChannel, string> = {
  BANQUET: "Banquet",
  BUFFET: "Buffet",
  ODC: "ODC",
  PACKET: "Packed food",
  ROOM_SERVICE: "Room service",
  ALACARTE: "À la carte",
  MANAGEMENT: "Management",
};

type TabKey = "prep" | "pickup" | "dispatch" | "out";

/**
 * The driver's whole job in big tabs — Event prep → Pickup → To dispatch →
 * Out for delivery — mirroring the chef board. Every card carries its one
 * action inline (Mark prep ready, Take delivery, Dispatch, Mark delivered),
 * so the driver never opens a detail page. Built for non-technical staff.
 *
 * "Event prep" covers off-site catering (banquet / ODC / packed) — the
 * delivery team readies cutlery + arrangements ahead of the event, and the
 * tab's urgency dot flags how many are still outstanding.
 */
export function DriverWorkScreen({ eventPrep, pickups, deliveries }: Props) {
  const groups = useMemo(() => {
    const dispatch = deliveries.filter((d) => d.status === DeliveryStatus.SCHEDULED);
    const out = deliveries.filter(
      (d) => d.status === DeliveryStatus.DISPATCHED || d.status === DeliveryStatus.IN_TRANSIT,
    );
    return { prep: eventPrep, pickup: pickups, dispatch, out };
  }, [eventPrep, pickups, deliveries]);

  // Outstanding prep (not yet marked ready) drives the tab badge + urgency.
  const prepOutstanding = groups.prep.filter((o) => !o.prepReadyAt).length;

  const TABS: { key: TabKey; label: string; hint: string; count: number; urgent?: boolean }[] = [
    { key: "prep", label: "Event prep", hint: "Ready cutlery", count: prepOutstanding, urgent: prepOutstanding > 0 },
    { key: "pickup", label: "Pickup", hint: "Take cooked orders", count: groups.pickup.length },
    { key: "dispatch", label: "To dispatch", hint: "Start the run", count: groups.dispatch.length },
    { key: "out", label: "Out for delivery", hint: "Mark delivered", count: groups.out.length },
  ];

  const firstWithWork = (TABS.find((t) => t.count > 0)?.key ?? "pickup") as TabKey;
  const [active, setActive] = useState<TabKey>(firstWithWork);
  const activeTab = TABS.find((t) => t.key === active) ?? TABS[0];

  return (
    <section>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TABS.map((t) => {
          const on = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              className={
                "rounded-md border p-3 text-left transition " +
                (on
                  ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                  : "border-ik-rule bg-ik-card hover:border-brand-200")
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ik-ink">
                  {t.label}
                  {t.urgent && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-alert" aria-label="urgent" />}
                </span>
                <span
                  className={
                    "grid min-h-[20px] min-w-[20px] place-items-center rounded-full px-1.5 font-mono text-[11px] font-bold leading-none " +
                    (t.count > 0 ? (t.urgent ? "bg-alert text-white" : "bg-brand-500 text-white") : "bg-ik-paper-alt text-ik-ink-3")
                  }
                >
                  {t.count}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-ik-ink-3">{t.hint}</div>
            </button>
          );
        })}
      </div>

      {active === "prep" ? (
        groups.prep.length === 0 ? (
          <Empty label={activeTab.label} />
        ) : (
          <ul className="grid gap-2.5">
            {groups.prep.map((o, i) => (
              <EventPrepCard key={o.id} order={o} highlight={!o.prepReadyAt && i === 0} />
            ))}
          </ul>
        )
      ) : active === "pickup" ? (
        groups.pickup.length === 0 ? (
          <Empty label={activeTab.label} />
        ) : (
          <ul className="grid gap-2.5">
            {groups.pickup.map((o, i) => (
              <PickupCard key={o.id} order={o} highlight={i === 0} />
            ))}
          </ul>
        )
      ) : (
        (() => {
          const list = active === "dispatch" ? groups.dispatch : groups.out;
          if (list.length === 0) return <Empty label={activeTab.label} />;
          return (
            <ul className="grid gap-2.5">
              {list.map((d, i) => (
                <DeliveryCard key={d.id} delivery={d} highlight={i === 0} />
              ))}
            </ul>
          );
        })()
      )}
    </section>
  );
}

function EventPrepCard({ order, highlight }: { order: EventPrepOrder; highlight: boolean }) {
  const ready = order.prepReadyAt != null;

  return (
    <li
      className={
        (ready ? "rounded-md border border-positive/40 bg-positive/5 p-3" : "rounded-md border border-amber bg-amber-wash p-3") +
        (highlight ? " ring-2 ring-brand-500" : "")
      }
    >
      <CardHeader
        code={order.code}
        channel={order.channel}
        roomNumber={null}
        timeLabel={formatIST(new Date(order.eventDate), "EEE d MMM HH:mm")}
        target={order.eventDate}
        highlight={highlight}
      />
      <div className="mt-1 text-[13px] text-ik-ink">
        <strong>{order.customerName}</strong>
        <span className="text-ik-ink-3"> · {order.headcount} pax</span>
      </div>
      <div className="mt-0.5 text-[12.5px] text-ik-ink-2">{order.deliveryAddress}</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {ready ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-positive/10 px-2.5 py-1 text-[12px] font-medium text-positive">
            ✓ Cutlery + arrangements ready{order.prepReadyBy ? ` · ${order.prepReadyBy}` : ""}
          </span>
        ) : (
          // Opens the prep page — choose cutlery, issue what's in stock,
          // request the rest, then mark ready. No longer a one-tap flag.
          <Link href={`/deliveries/event-prep/${order.id}`}>
            <Button size="sm">Prepare cutlery &amp; arrangements</Button>
          </Link>
        )}
        <Link href={ready ? `/deliveries/event-prep/${order.id}` : `/orders/${order.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">
          {ready ? "Issue more" : "Open"}
        </Link>
      </div>
    </li>
  );
}

/** Compact "what's in this order" list shown on the driver cards. */
function OrderItems({ items, headcount }: { items: OrderLine[]; headcount: number }) {
  if (items.length === 0) return null;
  return (
    <details className="mt-2 rounded-md bg-ik-paper-alt px-2.5 py-1.5 text-[12px]">
      <summary className="cursor-pointer text-ik-ink-2">
        {items.length} item{items.length === 1 ? "" : "s"} · {headcount} pax
      </summary>
      <ul className="mt-1.5 grid gap-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="text-ik-ink">{it.label}</span>
            <span className="font-mono text-ik-ink-2">{it.portions}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-md border border-ik-rule bg-ik-card p-5 text-[13px] text-ik-ink-2">
      Nothing in <strong>{label}</strong> right now.
    </div>
  );
}

function CardHeader({
  code,
  channel,
  roomNumber,
  timeLabel,
  target,
  highlight,
}: {
  code: string;
  channel: OrderChannel;
  roomNumber: string | null;
  timeLabel: string;
  target: string;
  highlight: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        {highlight && (
          <span className="rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Next up
          </span>
        )}
        <span className="font-mono text-[12.5px] text-brand-700">{code}</span>
        <span className="rounded-full bg-ik-card px-2 py-0.5 text-[10.5px] text-ik-ink-2 ring-1 ring-ik-rule">
          {CHANNEL_LABEL[channel]}
        </span>
        {roomNumber && <span className="text-[11.5px] font-medium text-ik-ink">Room {roomNumber}</span>}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-[11.5px] text-ik-ink-3">{timeLabel}</span>
        <Countdown target={target} />
      </div>
    </div>
  );
}

function PickupCard({ order, highlight }: { order: PickupOrder; highlight: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function take() {
    startTransition(async () => {
      try {
        const res = await claimDelivery(order.id);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success("Delivery is yours — it's now in “To dispatch”");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Could not take this delivery");
      }
    });
  }

  return (
    <li className={"rounded-md border border-amber bg-amber-wash p-3" + (highlight ? " ring-2 ring-brand-500" : "")}>
      <CardHeader
        code={order.code}
        channel={order.channel}
        roomNumber={order.roomNumber}
        timeLabel={formatIST(new Date(order.eventDate), "EEE d MMM HH:mm")}
        target={order.eventDate}
        highlight={highlight}
      />
      <div className="mt-1 text-[13px] text-ik-ink"><strong>{order.customerName}</strong></div>
      <div className="mt-0.5 text-[12.5px] text-ik-ink-2">{order.deliveryAddress}</div>
      <OrderItems items={order.items} headcount={order.headcount} />
      <div className="mt-2.5 flex items-center gap-2">
        <Button size="sm" disabled={pending} onClick={take}>Take delivery</Button>
        <Link href={`/orders/${order.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">Open</Link>
      </div>
    </li>
  );
}

function DeliveryCard({ delivery, highlight }: { delivery: DriverDelivery; highlight: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showFail, setShowFail] = useState(false);
  const [failReason, setFailReason] = useState("");
  const isScheduled = delivery.status === DeliveryStatus.SCHEDULED;

  function run(fn: () => Promise<ActionResult>, successMsg: string) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        toast.success(successMsg);
        setShowFail(false);
        setFailReason("");
        router.refresh();
      } catch (err) {
        if (isNextNavigationError(err)) throw err;
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  }

  return (
    <li className={"rounded-md border border-brand-200 bg-brand-50 p-3" + (highlight ? " ring-2 ring-brand-500" : "")}>
      <CardHeader
        code={delivery.orderCode}
        channel={delivery.channel}
        roomNumber={delivery.roomNumber}
        timeLabel={`Sched ${formatIST(new Date(delivery.scheduledAt), "EEE d MMM HH:mm")}`}
        target={delivery.scheduledAt}
        highlight={highlight}
      />
      <div className="mt-1 text-[13px] text-ik-ink">
        <strong>{delivery.customerName}</strong>
        <span className="text-ik-ink-3"> · {delivery.deliveryNo}</span>
      </div>
      <div className="mt-0.5 text-[12.5px] text-ik-ink-2">{delivery.deliveryAddress}</div>
      <OrderItems items={delivery.items} headcount={delivery.headcount} />

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {isScheduled ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() => run(() => dispatchDelivery(delivery.id), "Dispatched — on the way")}
          >
            Dispatch
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => confirmDeliveryOTP(delivery.id, { paymentCollected: false }), "Delivered — invoice sent to customer")
              }
            >
              Mark delivered
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setShowFail((v) => !v)}>
              Mark failed
            </Button>
          </>
        )}
        <Link href={`/deliveries/${delivery.id}`} className="ml-auto text-[11.5px] text-brand hover:underline">
          Open
        </Link>
      </div>

      {showFail && (
        <div className="mt-2 grid gap-2 rounded-md border border-ik-rule bg-ik-card p-2.5">
          <Textarea
            rows={2}
            placeholder="What went wrong? e.g. customer not reachable, address wrong"
            value={failReason}
            onChange={(e) => setFailReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !failReason.trim()}
              onClick={() => run(() => failDelivery(delivery.id, { reason: failReason }), "Marked failed")}
            >
              Confirm failed
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setShowFail(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
