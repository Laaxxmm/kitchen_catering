import { OrderStatus } from "@prisma/client";
import { db } from "@/server/db";
import { deliveryVerdict, type DeliveryVerdict } from "@/lib/order-timeline";

/**
 * One row per order with an event in the range: when each desk touched it.
 *
 * Every stamp already exists — the app writes them as the work happens —
 * this just lines them up. Read-only, no "use server": the page and the
 * Excel export share it. Where a stage can happen more than once (the store
 * issues in several goes, a delivery is re-run) the row carries the first
 * and the last, which is what "when did the store issue" actually means.
 */
export interface OrderTimelineRow {
  id: string;
  code: string;
  customer: string;
  channel: string;
  status: OrderStatus;
  headcount: number;
  eventDate: Date;
  deliveryWindowStart: Date;
  taken: Date;
  accepted: Date | null;
  kitchenTook: Date | null;
  storeIssuedFirst: Date | null;
  storeIssuedLast: Date | null;
  cookingStarted: Date | null;
  cooked: Date | null;
  handedOver: Date | null;
  fnbReady: Date | null;
  manpowerRequested: Date | null;
  manpowerApproved: Date | null;
  dispatched: Date | null;
  delivered: Date | null;
  verdict: DeliveryVerdict;
  cancelled: Date | null;
}

export async function getOrderTimelines(from: Date, to: Date): Promise<OrderTimelineRow[]> {
  const orders = await db.order.findMany({
    where: { eventDate: { gte: from, lte: to }, status: { not: OrderStatus.DRAFT } },
    orderBy: { eventDate: "asc" },
    select: {
      id: true,
      code: true,
      channel: true,
      status: true,
      headcount: true,
      eventDate: true,
      deliveryWindowStart: true,
      createdAt: true,
      adminReviewedAt: true,
      adminDecision: true,
      chefReviewedAt: true,
      chefDecision: true,
      handedToDeliveryAt: true,
      eventPrepReadyAt: true,
      cancelledAt: true,
      customer: { select: { name: true } },
      productionJobs: {
        orderBy: { createdAt: "asc" },
        select: { actualStart: true, actualReady: true, items: { select: { startedAt: true, readyAt: true } } },
      },
      deliveries: {
        orderBy: { scheduledAt: "desc" },
        select: { dispatchedAt: true, deliveredAt: true, status: true },
      },
      manpowerRequests: {
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, approvedAt: true },
      },
    },
  });
  if (orders.length === 0) return [];

  // The store's issues carry the order id; first and last per order in one
  // grouped query rather than a round trip per row.
  const issues = await db.ingredientIssue.groupBy({
    by: ["orderId"],
    where: { orderId: { in: orders.map((o) => o.id) } },
    _min: { issuedAt: true },
    _max: { issuedAt: true },
  });
  const issuedBy = new Map(issues.map((i) => [i.orderId, i]));

  const earliest = (ds: Array<Date | null | undefined>): Date | null => {
    const real = ds.filter((d): d is Date => !!d);
    return real.length ? new Date(Math.min(...real.map((d) => d.getTime()))) : null;
  };
  const latest = (ds: Array<Date | null | undefined>): Date | null => {
    const real = ds.filter((d): d is Date => !!d);
    return real.length ? new Date(Math.max(...real.map((d) => d.getTime()))) : null;
  };

  return orders.map((o) => {
    const iss = issuedBy.get(o.id);
    // The job stamps its own start; fall back to the first item that moved,
    // for jobs created before actualStart existed.
    const cookingStarted = earliest([
      ...o.productionJobs.map((j) => j.actualStart),
      ...o.productionJobs.flatMap((j) => j.items.map((i) => i.startedAt)),
    ]);
    const cooked = latest([
      ...o.productionJobs.map((j) => j.actualReady),
      ...o.productionJobs.flatMap((j) => j.items.map((i) => i.readyAt)),
    ]);
    // The delivery that actually completed, else the most recent attempt.
    const done = o.deliveries.find((d) => d.deliveredAt) ?? o.deliveries[0];
    const delivered = done?.deliveredAt ?? null;
    return {
      id: o.id,
      code: o.code,
      customer: o.customer.name,
      channel: o.channel,
      status: o.status,
      headcount: o.headcount,
      eventDate: o.eventDate,
      deliveryWindowStart: o.deliveryWindowStart,
      taken: o.createdAt,
      accepted: o.adminDecision === "APPROVED" ? o.adminReviewedAt : null,
      kitchenTook: o.chefDecision === "APPROVED" ? o.chefReviewedAt : null,
      storeIssuedFirst: iss?._min.issuedAt ?? null,
      storeIssuedLast: iss?._max.issuedAt ?? null,
      cookingStarted,
      cooked,
      handedOver: o.handedToDeliveryAt,
      fnbReady: o.eventPrepReadyAt,
      manpowerRequested: o.manpowerRequests[0]?.createdAt ?? null,
      manpowerApproved: earliest(o.manpowerRequests.map((m) => m.approvedAt)),
      dispatched: done?.dispatchedAt ?? null,
      delivered,
      verdict: deliveryVerdict(delivered, o.deliveryWindowStart),
      cancelled: o.cancelledAt,
    };
  });
}
