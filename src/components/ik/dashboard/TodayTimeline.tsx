import Link from "next/link";
import type { OrderStatus } from "@prisma/client";

interface OrderPoint {
  id: string;
  code: string;
  status: OrderStatus;
  eventDate: string; // ISO
  mealType: string;
  customerName: string;
}

interface Props {
  orders: OrderPoint[];
}

/**
 * Today's orders plotted on a horizontal time axis (6 AM → 11 PM IST).
 * Each order is a colored dot at its event time; status drives color.
 * Hover shows the customer + status; click jumps to the order detail.
 *
 * Empty state: clean "No orders today" card. No fake placeholder data.
 */

// Status → color (matches the OrderJourneyStrip palette).
const STATUS_COLOR: Partial<Record<OrderStatus, string>> = {
  PENDING_CHEF_APPROVAL: "#BA7517", // amber
  CHANGES_PROPOSED_BY_CHEF: "#BA7517",
  CHEF_REQUISITION_PENDING: "#516056", // ink2
  ISSUING: "#516056",
  READY_FOR_PRODUCTION: "#0F6E56", // brand
  IN_PREP: "#0F6E56",
  READY: "#3B6D11", // positive
  OUT_FOR_DELIVERY: "#3B6D11",
  DELIVERED: "#3B6D11",
  INVOICED: "#0F6E56",
};

const STATUS_SHORT: Partial<Record<OrderStatus, string>> = {
  PENDING_CHEF_APPROVAL: "Chef review",
  CHANGES_PROPOSED_BY_CHEF: "Manager review",
  CHEF_REQUISITION_PENDING: "Raise requisition",
  ISSUING: "Issuing stock",
  READY_FOR_PRODUCTION: "Ready to cook",
  IN_PREP: "Cooking",
  READY: "Ready",
  OUT_FOR_DELIVERY: "On the way",
  DELIVERED: "Delivered",
  INVOICED: "Invoiced",
  DRAFT: "Draft",
};

// IST timezone, hour markers from 6 AM to 11 PM.
const START_HOUR = 6;
const END_HOUR = 23;

function istHourFraction(iso: string): number {
  // The DB stores UTC; the event time is meant to be IST. Convert by
  // adding 5h30m so the dot lands on the IST clock-time the user
  // intended when they set the event window.
  const d = new Date(iso);
  const utcMs = d.getTime();
  const istMs = utcMs + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  return h + m / 60;
}

export function TodayTimeline({ orders }: Props) {
  if (orders.length === 0) {
    return (
      <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
        <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Today&apos;s orders</div>
        <p className="mt-2 text-[12.5px] text-ik-ink-3">No orders scheduled for today.</p>
      </section>
    );
  }

  const hours = END_HOUR - START_HOUR; // total span in hours
  const ticks = [6, 9, 12, 15, 18, 21]; // 6am, 9, noon, 3pm, 6pm, 9pm

  return (
    <section className="rounded-2xl border border-ik-rule bg-ik-card shadow-ik-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div className="text-[11px] uppercase tracking-[0.12em] text-ik-ink-3">Today&apos;s orders</div>
        <div className="text-[11.5px] text-ik-ink-3">{orders.length} scheduled · 6 AM–11 PM IST</div>
      </div>
      <div className="relative h-20">
        {/* Hour grid */}
        <div className="absolute inset-x-0 top-9 h-[2px] bg-ik-rule" />
        {ticks.map((h) => {
          const pct = ((h - START_HOUR) / hours) * 100;
          const label =
            h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`;
          return (
            <div key={h} className="absolute" style={{ left: `${pct}%` }}>
              <div className="absolute top-9 h-2 w-[1px] bg-ik-rule" />
              <div className="absolute top-12 -translate-x-1/2 whitespace-nowrap text-[10.5px] text-ik-ink-3">
                {label}
              </div>
            </div>
          );
        })}
        {/* Order dots */}
        {orders.map((o) => {
          const hour = istHourFraction(o.eventDate);
          const clamped = Math.min(END_HOUR, Math.max(START_HOUR, hour));
          const pct = ((clamped - START_HOUR) / hours) * 100;
          const color = STATUS_COLOR[o.status] ?? "#0F6E56";
          const statusLabel = STATUS_SHORT[o.status] ?? o.status;
          return (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="group absolute"
              style={{ left: `${pct}%`, top: 28 }}
              title={`${o.code} · ${o.customerName} · ${statusLabel}`}
            >
              <span
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white transition group-hover:scale-110"
                style={{
                  background: color,
                  width: 14,
                  height: 14,
                }}
              />
              {/* Floating label above the dot */}
              <span
                className="absolute -translate-x-1/2 -translate-y-[36px] whitespace-nowrap rounded bg-ik-ink px-1.5 py-0.5 font-mono text-[9.5px] text-white opacity-0 transition group-hover:opacity-100"
              >
                {o.code} · {o.customerName}
              </span>
            </Link>
          );
        })}
      </div>
      {/* Legend */}
      <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-ik-ink-3">
        <LegendDot color="#BA7517" label="In review" />
        <LegendDot color="#516056" label="Awaiting stock" />
        <LegendDot color="#0F6E56" label="Cooking / soon to ship" />
        <LegendDot color="#3B6D11" label="Ready / out / delivered" />
      </div>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
