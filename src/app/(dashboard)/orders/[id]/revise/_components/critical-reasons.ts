import { OrderStatus } from "@prisma/client";

const HOUR_MS = 60 * 60 * 1000;

/**
 * How a started order reads to a human. Only the statuses that make a
 * revision CRITICAL on their own (computeRevisionBand's CRITICAL_STATUSES)
 * have wording — everything else is explained by the clock.
 */
const WORK_STARTED_REASON: Partial<Record<OrderStatus, string>> = {
  [OrderStatus.IN_PREP]: "The kitchen is already cooking this order.",
  [OrderStatus.READY]: "The food is already cooked and waiting to go out.",
  [OrderStatus.OUT_FOR_DELIVERY]: "The order has already left for delivery.",
};

/**
 * Plain-words answers to "why is this revision critical?" — one sentence per
 * reason that actually applies, clock first, then the kitchen. computeRevisionBand
 * decides *whether* a revision is critical; this only explains it, so it always
 * returns at least one sentence even if the band's reasoning outgrows the
 * wording above.
 */
export function criticalReasons({
  eventDate,
  status,
  now,
}: {
  eventDate: Date;
  status: OrderStatus;
  now: Date;
}): string[] {
  const reasons: string[] = [];
  const ms = eventDate.getTime() - now.getTime();
  if (ms < HOUR_MS) {
    // Floored, deliberately: understating the time left is safe, overstating
    // it is not. A negative interval floors away from zero — "1 minute ago"
    // for an event 30 seconds overdue, never "0 minutes".
    const mins = Math.floor(ms / 60_000);
    reasons.push(
      mins < 0
        ? `This event was due to start ${gap(-mins)} ago.`
        : mins === 0
          ? "This event starts in under a minute."
          : `This event starts in ${gap(mins)}.`,
    );
  }
  const started = WORK_STARTED_REASON[status];
  if (started) reasons.push(started);
  if (reasons.length === 0) {
    reasons.push("This order is too far along for the kitchen to absorb a change quietly.");
  }
  return reasons;
}

/** "38 minutes" / "3 hours" — minutes stay minutes up to an hour and a half. */
function gap(mins: number): string {
  if (mins < 90) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
